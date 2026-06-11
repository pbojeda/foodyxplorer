// GET /analytics/history-sample — Admin search history sample (F-ADMIN-ANALYTICS-UI B7)
//
// Admin-only: requireAdminBearer preHandler gate.
// Returns recent search_history rows (newest-first) within a lookback window.
// actorId is stripped from resultData before returning (PII-adjacent).
// Rows with unparseable result_jsonb are silently skipped (graceful degradation).

import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type { Kysely } from 'kysely';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { DB } from '../../generated/kysely-types.js';
import {
  HistorySampleParamsSchema,
  AdminResultDataSchema,
} from '@foodxplorer/shared';
import { makeRequireAdminBearer } from '../../plugins/requireAdminBearer.js';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

export interface HistorySamplePluginOptions {
  db: Kysely<DB>;
  prisma: PrismaClient;
  redis: Redis;
  config?: { NODE_ENV?: string };
}

// ---------------------------------------------------------------------------
// Internal DB row type
// ---------------------------------------------------------------------------

interface SearchHistoryRow {
  id: string;
  kind: string;
  query_text: string;
  result_jsonb: unknown;
  created_at: Date | string;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const historySamplePlugin: FastifyPluginAsync<HistorySamplePluginOptions> = async (
  app,
  opts,
) => {
  const { db, prisma, redis, config } = opts;
  const gate = makeRequireAdminBearer({ redis, prisma, config });

  // -------------------------------------------------------------------------
  // GET /analytics/history-sample
  // -------------------------------------------------------------------------

  app.get(
    '/analytics/history-sample',
    {
      preHandler: [gate],
      schema: {
        querystring: HistorySampleParamsSchema,
        tags: ['Analytics'],
        operationId: 'getHistorySample',
        summary: 'Admin search history sample',
        description:
          'Returns a sample of recent search_history rows within a lookback window. ' +
          'actorId is stripped from resultData. Admin-only.',
      },
    },
    async (request, reply) => {
      const { hours, limit, intent } = request.query as {
        hours: number;
        limit: number;
        intent?: string;
      };

      let rows: SearchHistoryRow[];

      try {
        rows = (await db
          .selectFrom('search_history')
          .select(['id', 'kind', 'query_text', 'result_jsonb', 'created_at'])
          .where('created_at', '>=', new Date(Date.now() - hours * 60 * 60 * 1000))
          .orderBy('created_at', 'desc')
          .limit(limit)
          .execute()) as SearchHistoryRow[];
      } catch (err) {
        throw Object.assign(
          new Error('Database query failed during history sample fetch'),
          { code: 'DB_UNAVAILABLE', statusCode: 500, cause: err },
        );
      }

      // -----------------------------------------------------------------------
      // In-memory intent filter.
      // JSONB operator filtering (->>)  is done post-fetch to keep Kysely queries
      // compatible with the strongly-typed builder (no sql.raw needed).
      // limit is applied at DB level; over-fetching risk is bounded by the limit
      // parameter (max 100) so in-memory filtering is safe at this scale.
      // -----------------------------------------------------------------------

      const filteredRows = intent
        ? rows.filter((row) => {
            const data = row.result_jsonb as Record<string, unknown>;
            return data['intent'] === intent;
          })
        : rows;

      // -----------------------------------------------------------------------
      // Map rows — parse resultData, strip actorId, skip unparseable rows
      // -----------------------------------------------------------------------

      const items = filteredRows.reduce<
        Array<{
          id: string;
          kind: string;
          queryText: string;
          resultData: Record<string, unknown>;
          createdAt: string;
        }>
      >((acc, row) => {
        const parsed = AdminResultDataSchema.safeParse(row.result_jsonb);
        if (!parsed.success) return acc; // skip unparseable rows

        acc.push({
          id: row.id,
          kind: row.kind,
          queryText: row.query_text,
          resultData: parsed.data as unknown as Record<string, unknown>,
          createdAt:
            row.created_at instanceof Date
              ? row.created_at.toISOString()
              : String(row.created_at),
        });
        return acc;
      }, []);

      return reply.send({
        success: true,
        data: {
          items,
          hours,
          limit,
          ...(intent !== undefined ? { intentFilter: intent } : {}),
        },
      });
    },
  );
};

export const historySampleRoutes = fastifyPlugin(historySamplePlugin);
