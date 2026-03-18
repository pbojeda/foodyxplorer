// GET /estimate — Level 1 official data lookup (Estimation Engine E003).
//
// Validates query params with EstimateQuerySchema.
// Checks Redis cache before executing the Level 1 lookup cascade.
// Returns EstimateData with level1Hit:true on match, false on miss.
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
import { buildKey, cacheGet, cacheSet } from '../lib/cache.js';

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
        summary: 'Level 1 — official data lookup',
        description:
          'Searches dishes and foods for an exact or FTS match against the official ' +
          'nutritional database. Returns confidenceLevel=high when found (Level 1 hit). ' +
          'Returns level1Hit:false when no match is found (not a 404). ' +
          'Responses are cached in Redis for 300 seconds.',
      },
    },
    async (request, reply) => {
      const { query, chainSlug, restaurantId } =
        request.query as EstimateQuery;

      // Preserve original query for response echo (after Zod trim).
      // Normalize for cache key + DB lookup: collapse whitespace + lowercase.
      const normalizedQuery = query.replace(/\s+/g, ' ').toLowerCase();

      // Cache key: fxp:estimate:l1:<query>:<chainSlug>:<restaurantId>
      const cacheKey = buildKey(
        'estimate:l1',
        `${normalizedQuery}:${chainSlug ?? ''}:${restaurantId ?? ''}`,
      );

      // --- Cache check ---
      const cached = await cacheGet<EstimateData>(cacheKey, request.log);
      if (cached !== null) {
        return reply.send({ success: true, data: cached });
      }

      // --- Level 1 lookup ---
      let lookupResult;
      try {
        lookupResult = await level1Lookup(db, normalizedQuery, { chainSlug, restaurantId });
      } catch (err) {
        throw Object.assign(
          new Error('Database query failed'),
          { statusCode: 500, code: 'DB_UNAVAILABLE', cause: err },
        );
      }

      // --- Build response data ---
      const data: EstimateData = lookupResult !== null
        ? {
            query,
            chainSlug: chainSlug ?? null,
            level1Hit: true,
            matchType: lookupResult.matchType,
            result: lookupResult.result,
            cachedAt: null,
          }
        : {
            query,
            chainSlug: chainSlug ?? null,
            level1Hit: false,
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
