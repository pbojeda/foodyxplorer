// GET /estimate — Level 1 + Level 2 + Level 3 lookup (Estimation Engine E003).
//
// Validates query params with EstimateQuerySchema.
// Checks Redis cache (unified key) before executing lookup cascade.
// L1 miss triggers Level 2 ingredient-based estimation.
// L1+L2 miss triggers Level 3 pgvector similarity extrapolation.
// Returns EstimateData with level1Hit/level2Hit/level3Hit flags.
// Cache TTL: 300 seconds. Cache is fail-open (bypass on Redis errors).

import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type { Kysely } from 'kysely';
import {
  EstimateQuerySchema,
  type EstimateQuery,
  type EstimateData,
} from '@foodxplorer/shared';
import type { DB } from '../generated/kysely-types.js';
import { level1Lookup } from '../estimation/level1Lookup.js';
import { level2Lookup } from '../estimation/level2Lookup.js';
import { level3Lookup } from '../estimation/level3Lookup.js';
import { buildKey, cacheGet, cacheSet } from '../lib/cache.js';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

interface EstimatePluginOptions {
  db: Kysely<DB>;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const estimateRoutesPlugin: FastifyPluginAsync<EstimatePluginOptions> = async (
  app,
  opts,
) => {
  const { db } = opts;

  app.get(
    '/estimate',
    {
      schema: {
        querystring: EstimateQuerySchema,
        tags: ['Estimation'],
        operationId: 'estimateLevel1And2And3',
        summary: 'Level 1 + Level 2 + Level 3 — official data, ingredient and similarity estimation',
        description:
          'Searches dishes and foods for an exact or FTS match against the official ' +
          'nutritional database (Level 1). On Level 1 miss, falls back to Level 2 ' +
          'ingredient-based estimation. On Level 1+2 miss, falls back to Level 3 ' +
          'pgvector similarity extrapolation. ' +
          'Returns level1Hit, level2Hit and level3Hit flags. ' +
          'Returns all hit flags false when no match is found (not a 404). ' +
          'Responses are cached in Redis for 300 seconds under a unified cache key.',
      },
    },
    async (request, reply) => {
      const { query, chainSlug, restaurantId } =
        request.query as EstimateQuery;

      // Preserve original query for response echo (after Zod trim).
      // Normalize for cache key + DB lookup: collapse whitespace + lowercase.
      const normalizedQuery = query.replace(/\s+/g, ' ').toLowerCase();

      // Unified cache key: fxp:estimate:<query>:<chainSlug>:<restaurantId>
      // Single key stores final response regardless of which level produced it.
      const cacheKey = buildKey(
        'estimate',
        `${normalizedQuery}:${chainSlug ?? ''}:${restaurantId ?? ''}`,
      );

      // --- Cache check ---
      const cached = await cacheGet<EstimateData>(cacheKey, request.log);
      if (cached !== null) {
        return reply.send({ success: true, data: cached });
      }

      // --- Level 1 lookup ---
      let lookupResult1;
      try {
        lookupResult1 = await level1Lookup(db, normalizedQuery, { chainSlug, restaurantId });
      } catch (err) {
        throw Object.assign(
          new Error('Database query failed'),
          { statusCode: 500, code: 'DB_UNAVAILABLE', cause: err },
        );
      }

      // --- Level 1 hit: build response and cache ---
      if (lookupResult1 !== null) {
        const data: EstimateData = {
          query,
          chainSlug: chainSlug ?? null,
          level1Hit: true,
          level2Hit: false,
          level3Hit: false,
          matchType: lookupResult1.matchType,
          result: lookupResult1.result,
          cachedAt: null,
        };
        const dataToCache: EstimateData = { ...data, cachedAt: new Date().toISOString() };
        await cacheSet(cacheKey, dataToCache, request.log);
        return reply.send({ success: true, data });
      }

      // --- Level 2 fallback (L1 miss) ---
      let lookupResult2;
      try {
        lookupResult2 = await level2Lookup(db, normalizedQuery, { chainSlug, restaurantId });
      } catch (err) {
        throw Object.assign(
          new Error('Database query failed'),
          { statusCode: 500, code: 'DB_UNAVAILABLE', cause: err },
        );
      }

      // --- Level 2 hit: build response and cache ---
      if (lookupResult2 !== null) {
        const data: EstimateData = {
          query,
          chainSlug: chainSlug ?? null,
          level1Hit: false,
          level2Hit: true,
          level3Hit: false,
          matchType: lookupResult2.matchType,
          result: lookupResult2.result,
          cachedAt: null,
        };
        const dataToCache: EstimateData = { ...data, cachedAt: new Date().toISOString() };
        await cacheSet(cacheKey, dataToCache, request.log);
        return reply.send({ success: true, data });
      }

      // --- Level 3 fallback (L1+L2 miss) ---
      let lookupResult3;
      try {
        lookupResult3 = await level3Lookup(db, normalizedQuery, {
          chainSlug,
          restaurantId,
          openAiApiKey: config.OPENAI_API_KEY,
        });
      } catch (err) {
        throw Object.assign(
          new Error('Database query failed'),
          { statusCode: 500, code: 'DB_UNAVAILABLE', cause: err },
        );
      }

      // --- Build response data (L3 hit or total miss) ---
      const data: EstimateData = lookupResult3 !== null
        ? {
            query,
            chainSlug: chainSlug ?? null,
            level1Hit: false,
            level2Hit: false,
            level3Hit: true,
            matchType: lookupResult3.matchType,
            result: lookupResult3.result,
            cachedAt: null,
          }
        : {
            query,
            chainSlug: chainSlug ?? null,
            level1Hit: false,
            level2Hit: false,
            level3Hit: false,
            matchType: null,
            result: null,
            cachedAt: null,
          };

      // --- Cache write (with cachedAt timestamp) ---
      const dataToCache: EstimateData = { ...data, cachedAt: new Date().toISOString() };
      await cacheSet(cacheKey, dataToCache, request.log);

      return reply.send({ success: true, data });
    },
  );
};

// Wrap with fastify-plugin so the route is registered on the root scope,
// allowing the root-level error handler to apply to estimate route errors.
export const estimateRoutes = fastifyPlugin(estimateRoutesPlugin);
