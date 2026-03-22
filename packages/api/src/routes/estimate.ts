// GET /estimate — Level 1 + Level 2 + Level 3 + Level 4 lookup (Estimation Engine E003).
//
// Validates query params with EstimateQuerySchema.
// Checks Redis cache (unified key) before executing lookup cascade.
// Delegates cascade to runEstimationCascade() (F023 Engine Router).
// Returns EstimateData with level1Hit/level2Hit/level3Hit/level4Hit flags.
// Cache TTL: 300 seconds. Cache is fail-open (bypass on Redis errors).
//
// F029: Every call is logged asynchronously to query_logs (fire-and-forget —
// never affects response timing or status). The log fires on reply.raw 'finish'
// event, AFTER the HTTP response is sent. Failures are swallowed silently.

import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type { Kysely } from 'kysely';
import type { PrismaClient } from '@prisma/client';
import {
  EstimateQuerySchema,
  type EstimateQuery,
  type EstimateData,
} from '@foodxplorer/shared';
import type { DB } from '../generated/kysely-types.js';
import { runEstimationCascade } from '../estimation/engineRouter.js';
import { level4Lookup } from '../estimation/level4Lookup.js';
import { buildKey, cacheGet, cacheSet } from '../lib/cache.js';
import { config } from '../config.js';
import { writeQueryLog } from '../lib/queryLogger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEVEL_MAP: Record<1 | 2 | 3 | 4, 'l1' | 'l2' | 'l3' | 'l4'> = {
  1: 'l1',
  2: 'l2',
  3: 'l3',
  4: 'l4',
};

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

interface EstimatePluginOptions {
  db: Kysely<DB>;
  prisma: PrismaClient;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const estimateRoutesPlugin: FastifyPluginAsync<EstimatePluginOptions> = async (
  app,
  opts,
) => {
  const { db, prisma } = opts;

  app.get(
    '/estimate',
    {
      schema: {
        querystring: EstimateQuerySchema,
        tags: ['Estimation'],
        operationId: 'estimateAllLevels',
        summary: 'Level 1 + Level 2 + Level 3 + Level 4 — official data, ingredient, similarity and LLM-assisted estimation',
        description:
          'Searches dishes and foods for an exact or FTS match against the official ' +
          'nutritional database (Level 1). On Level 1 miss, falls back to Level 2 ' +
          'ingredient-based estimation. On Level 1+2 miss, falls back to Level 3 ' +
          'pgvector similarity extrapolation. On Level 1+2+3 miss, falls back to Level 4 ' +
          'LLM-assisted identification (pg_trgm food match or ingredient decomposition). ' +
          'Cascade is orchestrated by runEstimationCascade() (F023/F024). ' +
          'Returns level1Hit, level2Hit, level3Hit and level4Hit flags. ' +
          'Returns all hit flags false when no match is found (not a 404). ' +
          'Responses are cached in Redis for 300 seconds under a unified cache key. ' +
          'Every call is logged asynchronously to query_logs (fire-and-forget — never affects response timing or status).',
      },
    },
    async (request, reply) => {
      const startMs = performance.now();

      const { query, chainSlug, restaurantId } =
        request.query as EstimateQuery;

      // Parse X-FXP-Source header (array or comma-delimited string)
      const rawSource = request.headers['x-fxp-source'];
      const firstVal = Array.isArray(rawSource)
        ? rawSource[0]
        : typeof rawSource === 'string'
        ? rawSource.split(',')[0]?.trim()
        : undefined;
      const source = firstVal === 'bot' ? 'bot' as const : 'api' as const;

      // Normalize for cache key only. Router normalizes internally for DB lookups.
      const normalizedQuery = query.replace(/\s+/g, ' ').trim().toLowerCase();

      // Unified cache key: fxp:estimate:<query>:<chainSlug>:<restaurantId>
      const cacheKey = buildKey(
        'estimate',
        `${normalizedQuery}:${chainSlug ?? ''}:${restaurantId ?? ''}`,
      );

      // Log entry variables — set in both code paths before reply.send()
      let cacheHit: boolean;
      let levelHit: 'l1' | 'l2' | 'l3' | 'l4' | null;

      // Fire-and-forget log write — fires AFTER the HTTP response is sent.
      // Both code paths (cache hit / cascade) set cacheHit and levelHit
      // before calling reply.send(), so the closured variables are ready.
      reply.raw.once('finish', () => {
        const responseTimeMs = Math.round(performance.now() - startMs);
        void writeQueryLog(
          prisma,
          {
            queryText:     query,
            chainSlug:     chainSlug ?? null,
            restaurantId:  restaurantId ?? null,
            levelHit,
            cacheHit,
            responseTimeMs,
            apiKeyId:      request.apiKeyContext?.keyId ?? null,
            source,
          },
          request.log,
        ).catch(() => {});
      });

      // --- Cache check ---
      const cached = await cacheGet<EstimateData>(cacheKey, request.log);
      if (cached !== null) {
        cacheHit = true;
        // Derive levelHit from cached EstimateData flags (first true wins)
        if (cached.level1Hit) {
          levelHit = 'l1';
        } else if (cached.level2Hit) {
          levelHit = 'l2';
        } else if (cached.level3Hit) {
          levelHit = 'l3';
        } else if (cached.level4Hit) {
          levelHit = 'l4';
        } else {
          levelHit = null;
        }

        return reply.send({ success: true, data: cached });
      }

      // --- Estimation cascade (L1→L2→L3→L4) ---
      const routerResult = await runEstimationCascade({
        db,
        query,
        chainSlug,
        restaurantId,
        openAiApiKey: config.OPENAI_API_KEY,
        level4Lookup,
        logger: request.log,
      });

      cacheHit = false;
      levelHit = routerResult.levelHit !== null ? LEVEL_MAP[routerResult.levelHit] : null;

      // --- Cache write (with cachedAt timestamp) ---
      const dataToCache: EstimateData = {
        ...routerResult.data,
        cachedAt: new Date().toISOString(),
      };
      await cacheSet(cacheKey, dataToCache, request.log);

      return reply.send({ success: true, data: routerResult.data });
    },
  );
};

// Wrap with fastify-plugin so the route is registered on the root scope,
// allowing the root-level error handler to apply to estimate route errors.
export const estimateRoutes = fastifyPlugin(estimateRoutesPlugin);
