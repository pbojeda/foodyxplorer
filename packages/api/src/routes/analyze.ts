// POST /analyze/menu — Menu Analysis Route Plugin (F034).
//
// Accepts a multipart photo or PDF of a restaurant menu (or a single dish photo).
// Extracts dish names via OCR or Vision API depending on mode, then runs
// runEstimationCascade on each dish name to return nutritional estimates.
//
// This endpoint is stateless — it does NOT write to any database table.
//
// Auth: API key required. Anonymous requests → 401 UNAUTHORIZED.
//       The auth middleware sets request.apiKeyContext but does NOT reject anonymous
//       callers — the route itself enforces key presence.
//
// Rate limiting: 10 analyses/hour per API key (Redis counter fxp:analyze:hourly:<sha256(keyId)>).
//   - Fail-open on Redis error (request proceeds).
//   - Bot key exempt: if config.BOT_KEY_ID matches request.apiKeyContext.keyId, skip the counter.
//
// Timeout: 60 seconds, cooperative (AbortSignal passed to analyzeMenu).
//   analyzeMenu checks signal.aborted between cascade iterations and returns partial results.
//
// See ADR-011 for routing decisions.

import { createHash } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type { Kysely } from 'kysely';
import type { PrismaClient } from '@prisma/client';
import type { MultipartValue, MultipartFile as MultipartFilePart } from '@fastify/multipart';
import { AnalyzeMenuBodySchema } from '@foodxplorer/shared';
import type { DB } from '../generated/kysely-types.js';
import { redis } from '../lib/redis.js';
import { config } from '../config.js';
import { analyzeMenu } from '../analyze/menuAnalyzer.js';
import { level4Lookup } from '../estimation/level4Lookup.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROUTE_TIMEOUT_MS = 60_000;
const ANALYZE_RATE_LIMIT = 10; // per hour per API key
const ANALYZE_RATE_LIMIT_TTL = 3600; // seconds

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

interface AnalyzePluginOptions {
  db: Kysely<DB>;
  prisma: PrismaClient;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const analyzeRoutesPlugin: FastifyPluginAsync<AnalyzePluginOptions> = async (
  app,
  opts,
) => {
  const { db } = opts;

  app.post('/analyze/menu', async (request, reply) => {
    // -------------------------------------------------------------------------
    // Step 1: Guard — API key required (auth middleware may leave context unset for anonymous)
    // -------------------------------------------------------------------------
    if (!request.apiKeyContext) {
      throw Object.assign(
        new Error('API key required for menu analysis'),
        { code: 'UNAUTHORIZED' },
      );
    }

    // -------------------------------------------------------------------------
    // Step 2: Parse multipart stream (same pattern as ingest/image.ts)
    // -------------------------------------------------------------------------
    const fields: Record<string, string> = {};
    let fileBuffer: Buffer | undefined;

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (fileBuffer === undefined) {
          const filePart = part as MultipartFilePart;
          fileBuffer = await filePart.toBuffer();
        } else {
          // Drain extra file parts without buffering (memory safety)
          const stream = (part as MultipartFilePart).file;
          stream.resume();
        }
      } else {
        const fieldPart = part as MultipartValue<string>;
        const fieldName = fieldPart.fieldname;
        const fieldValue = fieldPart.value;
        if (typeof fieldValue === 'string') {
          fields[fieldName] = fieldValue;
        }
      }
    }

    // -------------------------------------------------------------------------
    // Step 3: Guard — file part must be present
    // -------------------------------------------------------------------------
    if (fileBuffer === undefined) {
      throw Object.assign(
        new Error('Missing file part in multipart request'),
        { statusCode: 400, code: 'VALIDATION_ERROR' },
      );
    }

    // -------------------------------------------------------------------------
    // Step 4: Validate mode field
    // -------------------------------------------------------------------------
    const parseResult = AnalyzeMenuBodySchema.safeParse(fields);
    if (!parseResult.success) {
      throw parseResult.error; // ZodError → 400 VALIDATION_ERROR via error handler
    }
    const { mode } = parseResult.data;

    // -------------------------------------------------------------------------
    // Step 5: Analysis-specific rate limit check (10/hour per API key)
    //   - Exempt: bot key (identified by config.BOT_KEY_ID matching keyId)
    //   - Fail-open on Redis error
    // -------------------------------------------------------------------------
    const isBotKey =
      config.BOT_KEY_ID !== undefined &&
      request.apiKeyContext.keyId === config.BOT_KEY_ID;

    if (!isBotKey) {
      const keyHash = createHash('sha256').update(request.apiKeyContext.keyId).digest('hex');
      const counterKey = `fxp:analyze:hourly:${keyHash}`;

      try {
        const counter = await redis.incr(counterKey);
        if (counter === 1) {
          // First request in this window — set TTL (NX: only if key has no expiry)
          await redis.expire(counterKey, ANALYZE_RATE_LIMIT_TTL, 'NX');
        }
        if (counter > ANALYZE_RATE_LIMIT) {
          throw Object.assign(
            new Error('Analysis rate limit exceeded (10 per hour)'),
            { code: 'RATE_LIMIT_EXCEEDED' },
          );
        }
      } catch (err) {
        const asAny = err as Record<string, unknown>;
        if (typeof asAny['code'] === 'string' && asAny['code'] === 'RATE_LIMIT_EXCEEDED') {
          throw err;
        }
        // Redis failure → fail-open (log and continue)
        request.log.warn({ err }, 'analyze rate limit counter unavailable — failing open');
      }
    }

    // -------------------------------------------------------------------------
    // Step 6: Run analysis with cooperative 60-second timeout
    // -------------------------------------------------------------------------
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS);

    try {
      const result = await analyzeMenu({
        fileBuffer,
        mode,
        db,
        openAiApiKey: config.OPENAI_API_KEY,
        level4Lookup,
        logger: request.log,
        signal: controller.signal,
      });

      clearTimeout(timer);

      return reply.status(200).send({
        success: true,
        data: {
          mode: result.mode,
          dishCount: result.dishes.length,
          dishes: result.dishes,
          partial: result.partial,
        },
      });
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  });
};

// Wrap with fastify-plugin so the route registers on the root scope,
// allowing the global error handler to apply.
export const analyzeRoutes = fastifyPlugin(analyzeRoutesPlugin);
