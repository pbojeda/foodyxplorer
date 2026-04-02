// POST /conversation/message — Conversation Core route plugin (F070, Step 8)
//
// Validates body with ConversationMessageBodySchema.
// Delegates to processMessage() with all dependencies injected.
// Wraps response in { success: true, data } envelope.
// Fire-and-forget writeQueryLog on reply.raw 'finish' event.
// Rate limit: shares 'queries' bucket with GET /estimate (50/day per actor).

import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type { Kysely } from 'kysely';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { ConversationMessageBodySchema } from '@foodxplorer/shared';
import type { DB } from '../generated/kysely-types.js';
import { level4Lookup } from '../estimation/level4Lookup.js';
import { loadChainData } from '../conversation/chainResolver.js';
import { processMessage } from '../conversation/conversationCore.js';
import { config } from '../config.js';
import { writeQueryLog } from '../lib/queryLogger.js';
import type { ChainRow } from '../conversation/types.js';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

interface ConversationPluginOptions {
  db: Kysely<DB>;
  prisma: PrismaClient;
  redis: Redis;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const conversationRoutesPlugin: FastifyPluginAsync<ConversationPluginOptions> = async (
  app,
  opts,
) => {
  const { db, prisma, redis } = opts;

  // Load chain data once at plugin init for context resolution
  let chains: ChainRow[] = [];
  let chainSlugs: string[] = [];
  try {
    chains = await loadChainData(db);
    chainSlugs = chains.map((c) => c.chainSlug);
  } catch (err) {
    app.log.warn({ err }, 'F070: Failed to load chain data, context-set and brand detection disabled');
  }

  app.post(
    '/conversation/message',
    {
      schema: {
        body: ConversationMessageBodySchema,
        tags: ['Conversation'],
        operationId: 'conversationMessage',
        summary: 'Process a natural language message',
        description:
          'Processes a plain-text natural language query. Returns a structured ConversationMessageData ' +
          'with intent, estimation/comparison/contextSet data. Rate-limited to 50/day per actor (shared with GET /estimate).',
      },
    },
    async (request, reply) => {
      const startMs = performance.now();

      const body = request.body as {
        text: string;
        chainSlug?: string;
        chainName?: string;
      };

      const actorId = request.actorId;
      if (!actorId) {
        return reply.code(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Actor resolution failed' },
        });
      }
      // Capture as string | null for query log entries (actorId is `string` after guard above,
      // but TypeScript does not narrow closure variables — explicit cast avoids type error).
      const actorIdForLog: string | null = actorId;

      // Parse X-FXP-Source header
      const rawSource = request.headers['x-fxp-source'];
      const firstVal = Array.isArray(rawSource)
        ? rawSource[0]
        : typeof rawSource === 'string'
        ? rawSource.split(',')[0]?.trim()
        : undefined;
      const source = firstVal === 'bot' ? 'bot' as const : 'api' as const;

      // capturedData is set after processMessage resolves and read by logQueryAfterReply.
      let capturedData: import('@foodxplorer/shared').ConversationMessageData | null = null;

      // Fire-and-forget query log — registered before processMessage so the 'finish'
      // listener is always in place, even if processMessage throws (no-op when capturedData is null).
      reply.raw.once('finish', () => {
        const responseTimeMs = Math.round(performance.now() - startMs);
        void logQueryAfterReply(responseTimeMs).catch(() => {});
      });

      // Run the conversation pipeline
      const data = await processMessage({
        text: body.text,
        actorId,
        db,
        redis,
        openAiApiKey: config.OPENAI_API_KEY,
        level4Lookup,
        chainSlugs,
        chains,
        logger: request.log,
        legacyChainSlug: body.chainSlug,
        legacyChainName: body.chainName,
      });

      // Capture result data for query log (must be before reply.send)
      capturedData = data;

      return reply.send({ success: true, data });

      // -----------------------------------------------------------------------
      // Query logging helper (fire-and-forget, called from 'finish' listener)
      // -----------------------------------------------------------------------

      async function logQueryAfterReply(responseTimeMs: number): Promise<void> {
        if (!capturedData) return;

        const intent = capturedData.intent;
        const apiKeyId = request.apiKeyContext?.keyId ?? null;

        if (intent === 'estimation' && capturedData.estimation) {
          const est = capturedData.estimation;
          let levelHit: 'l1' | 'l2' | 'l3' | 'l4' | null = null;
          if (est.level1Hit) levelHit = 'l1';
          else if (est.level2Hit) levelHit = 'l2';
          else if (est.level3Hit) levelHit = 'l3';
          else if (est.level4Hit) levelHit = 'l4';

          await writeQueryLog(
            prisma,
            {
              queryText: est.query,
              chainSlug: est.chainSlug ?? null,
              restaurantId: null,
              levelHit,
              cacheHit: est.cachedAt !== null,
              responseTimeMs,
              apiKeyId,
              actorId: actorIdForLog,
              source,
            },
            request.log,
          );
        } else if (intent === 'comparison' && capturedData.comparison) {
          const { dishA, dishB } = capturedData.comparison;

          const getLevelHit = (est: typeof dishA): 'l1' | 'l2' | 'l3' | 'l4' | null => {
            if (est.level1Hit) return 'l1';
            if (est.level2Hit) return 'l2';
            if (est.level3Hit) return 'l3';
            if (est.level4Hit) return 'l4';
            return null;
          };

          await writeQueryLog(
            prisma,
            {
              queryText: dishA.query,
              chainSlug: dishA.chainSlug ?? null,
              restaurantId: null,
              levelHit: getLevelHit(dishA),
              cacheHit: false, // comparisons don't get cache hits (parallel queries)
              responseTimeMs,
              apiKeyId,
              actorId: actorIdForLog,
              source,
            },
            request.log,
          );

          await writeQueryLog(
            prisma,
            {
              queryText: dishB.query,
              chainSlug: dishB.chainSlug ?? null,
              restaurantId: null,
              levelHit: getLevelHit(dishB),
              cacheHit: false,
              responseTimeMs,
              apiKeyId,
              actorId: actorIdForLog,
              source,
            },
            request.log,
          );
        } else if (intent === 'context_set') {
          await writeQueryLog(
            prisma,
            {
              queryText: body.text,
              chainSlug: null,
              restaurantId: null,
              levelHit: null,
              cacheHit: false,
              responseTimeMs,
              apiKeyId,
              actorId: actorIdForLog,
              source,
            },
            request.log,
          );
        } else if (intent === 'text_too_long') {
          await writeQueryLog(
            prisma,
            {
              queryText: body.text.slice(0, 500),
              chainSlug: null,
              restaurantId: null,
              levelHit: null,
              cacheHit: false,
              responseTimeMs,
              apiKeyId,
              actorId: actorIdForLog,
              source,
            },
            request.log,
          );
        }
      }
    },
  );
};

// Wrap with fastify-plugin so the route is registered on the root scope,
// allowing the root-level error handler to apply to conversation route errors.
export const conversationRoutes = fastifyPlugin(conversationRoutesPlugin);
