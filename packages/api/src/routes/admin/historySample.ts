// GET /analytics/history-sample — Admin search history sample (F-ADMIN-ANALYTICS-UI B7)
//
// Admin-only: requireAdminBearer preHandler gate.
// Returns recent search_history rows (newest-first) within a lookback window.
// actorId is stripped from resultData before returning (PII-adjacent).
// Rows with unparseable result_jsonb are silently skipped (graceful degradation).

import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
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
  /** Legacy test bypass — propagated from buildApp adminBypass option (I2 fix). */
  allowTestBypass?: boolean;
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
  const { db, prisma, redis, config, allowTestBypass = false } = opts;
  const gate = makeRequireAdminBearer({ redis, prisma, config, allowTestBypass });

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
        // Build base query
        let query = db
          .selectFrom('search_history')
          .select(['id', 'kind', 'query_text', 'result_jsonb', 'created_at'])
          .where('created_at', '>=', new Date(Date.now() - hours * 60 * 60 * 1000));

        // BUG-1+C2 fix: push intent filter into SQL (parameterised ->> fragment).
        // Avoids: (1) in-memory filter crashing on null result_jsonb (BUG-1);
        //         (2) limit applied before intent filter causing under-delivery (C2).
        // `intent` is validated by Zod against ConversationIntentSchema (closed enum)
        // before reaching this handler — safe to use as a parameterised SQL value.
        if (intent) {
          query = query.where(sql<boolean>`result_jsonb->>'intent' = ${intent}`);
        }

        rows = (await query
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
      // Map rows — parse resultData, strip actorId, skip unparseable rows.
      // null/malformed result_jsonb rows are silently dropped by safeParse.
      // -----------------------------------------------------------------------

      const items = rows.reduce<
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
