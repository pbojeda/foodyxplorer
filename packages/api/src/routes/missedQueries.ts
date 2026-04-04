// GET  /analytics/missed-queries       — Top missed queries (F079)
// POST /analytics/missed-queries/:id/status — Update tracking status (F079)
// POST /analytics/missed-queries/track      — Batch track missed queries (F079)
//
// Demand-driven expansion pipeline endpoints. Surfaces queries that hit
// the estimation cascade and returned null (levelHit IS NULL in query_logs),
// aggregated by normalized query_text with frequency counts.
//
// Admin-only (guarded by /analytics/ prefix in ADMIN_PREFIXES).

import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type { PrismaClient } from '@prisma/client';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '../generated/kysely-types.js';
import {
  MissedQueriesParamsSchema,
  UpdateMissedQueryStatusBodySchema,
  UpdateMissedQueryStatusParamsSchema,
  BatchTrackBodySchema,
} from '@foodxplorer/shared';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

export interface MissedQueriesPluginOptions {
  db: Kysely<DB>;
  prisma: PrismaClient;
}

// ---------------------------------------------------------------------------
// Internal types for query results
// ---------------------------------------------------------------------------

interface MissedQueryRow {
  query_text: string;
  count: number | string;
  tracking_id: string | null;
  tracking_status: string | null;
}

interface TotalMissRow {
  total_miss_count: number | string;
}

// ---------------------------------------------------------------------------
// Time range SQL interval helper (shared with analytics.ts)
// ---------------------------------------------------------------------------

function timeRangeInterval(timeRange: string): string {
  switch (timeRange) {
    case '24h': return '24 hours';
    case '7d':  return '7 days';
    case '30d': return '30 days';
    case 'all': return '';
    default:    return '';
  }
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const missedQueriesRoutesPlugin: FastifyPluginAsync<MissedQueriesPluginOptions> = async (
  app,
  opts,
) => {
  const { db, prisma } = opts;

  // -------------------------------------------------------------------------
  // GET /analytics/missed-queries
  // -------------------------------------------------------------------------

  app.get(
    '/analytics/missed-queries',
    {
      schema: {
        querystring: MissedQueriesParamsSchema,
        tags: ['Analytics'],
        operationId: 'getMissedQueries',
        summary: 'Top missed queries',
        description:
          'Surfaces the most frequently missed queries (estimation cascade returning null). ' +
          'LEFT JOINs missed_query_tracking to include tracking status. ' +
          'Filters short queries (< 3 chars) and respects timeRange.',
      },
    },
    async (request, reply) => {
      const { timeRange, topN, minCount } = request.query as z.infer<typeof MissedQueriesParamsSchema>;

      const interval = timeRangeInterval(timeRange);
      const hasTimeFilter = interval !== '';

      const timeClause = hasTimeFilter
        ? sql`AND ql.queried_at >= NOW() - INTERVAL ${sql.lit(interval)}`
        : sql``;

      try {
        // Two concurrent queries: total miss count + top missed queries
        const [totalRows, missedRows] = await Promise.all([
          // Query 1: total miss count (for context)
          sql<TotalMissRow>`
            SELECT COUNT(*)::text AS total_miss_count
            FROM query_logs ql
            WHERE ql.level_hit IS NULL
            AND LENGTH(ql.query_text) >= 3
            ${timeClause}
          `.execute(db),

          // Query 2: top missed queries with tracking status
          sql<MissedQueryRow>`
            SELECT
              ql.query_text,
              COUNT(*)::text AS count,
              mqt.id::text AS tracking_id,
              mqt.status::text AS tracking_status
            FROM query_logs ql
            LEFT JOIN missed_query_tracking mqt ON mqt.query_text = ql.query_text
            WHERE ql.level_hit IS NULL
            AND LENGTH(ql.query_text) >= 3
            ${timeClause}
            GROUP BY ql.query_text, mqt.id, mqt.status
            HAVING COUNT(*) >= ${minCount}
            ORDER BY COUNT(*) DESC
            LIMIT ${topN}
          `.execute(db),
        ]);

        const totalMissCount = Number(totalRows.rows[0]?.total_miss_count ?? 0);

        const missedQueries = missedRows.rows.map(row => ({
          queryText: row.query_text,
          count: Number(row.count),
          trackingId: row.tracking_id ?? null,
          trackingStatus: row.tracking_status ?? null,
        }));

        return reply.send({
          success: true,
          data: {
            missedQueries,
            totalMissCount,
            timeRange,
          },
        });
      } catch (err) {
        throw Object.assign(
          new Error('Database query failed during missed queries aggregation'),
          { code: 'DB_UNAVAILABLE', statusCode: 500, cause: err },
        );
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /analytics/missed-queries/track — batch track queries
  // Must be registered BEFORE :id/status to avoid route conflict
  // -------------------------------------------------------------------------

  app.post(
    '/analytics/missed-queries/track',
    {
      schema: {
        body: BatchTrackBodySchema,
        tags: ['Analytics'],
        operationId: 'batchTrackMissedQueries',
        summary: 'Batch track missed queries',
        description:
          'Creates tracking entries for missed queries (upsert on query_text). ' +
          'Used by the monthly expansion batch process.',
      },
    },
    async (request, reply) => {
      const { queries } = request.body as z.infer<typeof BatchTrackBodySchema>;

      try {
        const tracked = await prisma.$transaction(
          queries.map(q =>
            prisma.missedQueryTracking.upsert({
              where: { queryText: q.queryText },
              update: { hitCount: q.hitCount },
              create: {
                queryText: q.queryText,
                hitCount: q.hitCount,
                status: 'pending',
              },
            }),
          ),
        );

        const data = tracked.map(t => ({
          id: t.id,
          queryText: t.queryText,
          hitCount: t.hitCount,
          status: t.status,
          resolvedDishId: t.resolvedDishId,
          notes: t.notes,
          createdAt: t.createdAt.toISOString(),
          updatedAt: t.updatedAt.toISOString(),
        }));

        return reply.send({ success: true, data: { tracked: data } });
      } catch (err) {
        throw Object.assign(
          new Error('Failed to batch track missed queries'),
          { code: 'DB_UNAVAILABLE', statusCode: 500, cause: err },
        );
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /analytics/missed-queries/:id/status
  // -------------------------------------------------------------------------

  app.post(
    '/analytics/missed-queries/:id/status',
    {
      schema: {
        params: UpdateMissedQueryStatusParamsSchema,
        body: UpdateMissedQueryStatusBodySchema,
        tags: ['Analytics'],
        operationId: 'updateMissedQueryStatus',
        summary: 'Update missed query tracking status',
        description:
          'Updates the status of a tracked missed query (pending → resolved/ignored). ' +
          'Optionally links to the dish that was added (resolvedDishId).',
      },
    },
    async (request, reply) => {
      const { id } = request.params as z.infer<typeof UpdateMissedQueryStatusParamsSchema>;
      const { status, resolvedDishId, notes } = request.body as z.infer<typeof UpdateMissedQueryStatusBodySchema>;

      // Check existence outside try/catch to avoid 404 being swallowed as 500
      const existing = await prisma.missedQueryTracking.findUnique({ where: { id } });
      if (!existing) {
        throw Object.assign(
          new Error('Tracking entry not found'),
          { statusCode: 404, code: 'NOT_FOUND' },
        );
      }

      try {
        const updated = await prisma.missedQueryTracking.update({
          where: { id },
          data: {
            status: status as 'pending' | 'resolved' | 'ignored',
            ...(resolvedDishId !== undefined && { resolvedDishId }),
            ...(notes !== undefined && { notes }),
          },
        });

        return reply.send({
          success: true,
          data: {
            id: updated.id,
            queryText: updated.queryText,
            hitCount: updated.hitCount,
            status: updated.status,
            resolvedDishId: updated.resolvedDishId,
            notes: updated.notes,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
          },
        });
      } catch (err) {
        throw Object.assign(
          new Error('Failed to update missed query tracking status'),
          { code: 'DB_UNAVAILABLE', statusCode: 500, cause: err },
        );
      }
    },
  );
};

export const missedQueriesRoutes = fastifyPlugin(missedQueriesRoutesPlugin);
