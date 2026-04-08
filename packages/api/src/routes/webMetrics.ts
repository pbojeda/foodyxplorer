// POST /analytics/web-events — receive web assistant metrics beacons (F113)
// GET  /analytics/web-events — aggregated metrics for admin dashboard (F113)
//
// POST: public (sendBeacon cannot set auth headers), rate-limited 10 req/min/IP,
//       accepts application/json and text/plain, fire-and-forget DB insert.
// GET:  admin-only (covered by /analytics/ prefix in ADMIN_PREFIXES),
//       Kysely aggregation with JSONB unnesting.

import { createHash } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { PrismaClient } from '@prisma/client';
import type { DB } from '../generated/kysely-types.js';
import {
  WebMetricsSnapshotSchema,
  WebMetricsQueryParamsSchema,
} from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

export interface WebMetricsPluginOptions {
  db: Kysely<DB>;
  prisma: PrismaClient;
}

// ---------------------------------------------------------------------------
// Internal types for Kysely query results
// ---------------------------------------------------------------------------

interface ScalarAggRow {
  event_count: string | number;
  total_queries: string | number;
  total_successes: string | number;
  total_errors: string | number;
  total_retries: string | number;
  weighted_time_sum: string | number;
  weighted_time_count: string | number;
}

interface IntentRow {
  intent: string;
  count: string | number;
}

interface ErrorRow {
  error_code: string;
  count: string | number;
}

// ---------------------------------------------------------------------------
// Time range SQL interval helper (same pattern as analytics.ts)
// ---------------------------------------------------------------------------

function timeRangeToInterval(timeRange: string): string {
  switch (timeRange) {
    case '24h': return '24 hours';
    case '7d':  return '7 days';
    case '30d': return '30 days';
    default:    return ''; // 'all' — no WHERE clause
  }
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const webMetricsRoutesPlugin: FastifyPluginAsync<WebMetricsPluginOptions> = async (
  app,
  opts,
) => {
  const { db, prisma } = opts;

  // -------------------------------------------------------------------------
  // POST /analytics/web-events
  // -------------------------------------------------------------------------

  app.post(
    '/analytics/web-events',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
      schema: {
        tags: ['Analytics'],
        operationId: 'postWebMetricsEvent',
        summary: 'Receive web assistant metrics beacon',
        description:
          'Receives a MetricsSnapshot from the web assistant on session end. ' +
          'Accepts application/json and text/plain (sendBeacon default). ' +
          'No auth required. Rate-limited 10 req/min/IP.',
      },
    },
    async (request, reply) => {
      // Step 1: Handle body — may be string (text/plain) or already-parsed object (application/json)
      let rawBody: unknown = request.body;

      if (typeof rawBody === 'string') {
        try {
          rawBody = JSON.parse(rawBody);
        } catch {
          return reply.status(400).send({
            success: false,
            error: {
              message: 'Validation failed',
              code: 'VALIDATION_ERROR',
            },
          });
        }
      }

      // Step 2: Zod validation
      const parsed = WebMetricsSnapshotSchema.safeParse(rawBody);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            message: 'Validation failed',
            code: 'VALIDATION_ERROR',
          },
        });
      }

      const {
        queryCount,
        successCount,
        errorCount,
        retryCount,
        intents,
        errors,
        avgResponseTimeMs,
        sessionStartedAt,
      } = parsed.data;

      // Step 3: Compute ipHash — SHA-256 of IP, or null when IP is unavailable
      const ip = request.ip;
      const ipHash = ip ? createHash('sha256').update(ip).digest('hex') : null;

      // Step 4: Fire-and-forget DB insert — log error, always return 202
      try {
        await prisma.webMetricsEvent.create({
          data: {
            queryCount,
            successCount,
            errorCount,
            retryCount,
            intents,
            errors,
            avgResponseTimeMs,
            sessionStartedAt: new Date(sessionStartedAt),
            ipHash,
          },
        });
      } catch (err) {
        request.log.error({ err }, 'F113: web_metrics_events insert failed');
      }

      // Step 5: Always return 202 Accepted (client ignores response body)
      return reply.code(202).send({ success: true });
    },
  );

  // -------------------------------------------------------------------------
  // GET /analytics/web-events
  // -------------------------------------------------------------------------

  app.get(
    '/analytics/web-events',
    {
      schema: {
        querystring: WebMetricsQueryParamsSchema,
        tags: ['Analytics'],
        operationId: 'getWebMetricsEvents',
        summary: 'Aggregated web metrics for admin',
        description:
          'Aggregates web_metrics_events rows into operational statistics. ' +
          'Admin-only. timeRange filters by received_at.',
      },
    },
    async (request, reply) => {
      const { timeRange } = request.query as { timeRange: string };
      const interval = timeRangeToInterval(timeRange);
      const hasTimeFilter = interval !== '';

      let scalarRows: ScalarAggRow[];
      let intentRows: IntentRow[];
      let errorRows: ErrorRow[];

      try {
        [scalarRows, intentRows, errorRows] = await Promise.all([
          // Query 1: scalar aggregates with COALESCE to handle empty result sets
          sql<ScalarAggRow[]>`
            SELECT
              COUNT(*)                                         AS event_count,
              COALESCE(SUM(query_count), 0)                   AS total_queries,
              COALESCE(SUM(success_count), 0)                 AS total_successes,
              COALESCE(SUM(error_count), 0)                   AS total_errors,
              COALESCE(SUM(retry_count), 0)                   AS total_retries,
              COALESCE(SUM(avg_response_time_ms * success_count), 0) AS weighted_time_sum,
              COALESCE(SUM(success_count), 0)                 AS weighted_time_count
            FROM web_metrics_events
            ${hasTimeFilter
              ? sql`WHERE received_at >= NOW() - INTERVAL ${sql.lit(interval)}`
              : sql``}
          `.execute(db).then((r) => r.rows),

          // Query 2: top intents via jsonb_each_text
          sql<IntentRow[]>`
            SELECT
              key AS intent,
              SUM(value::int) AS count
            FROM web_metrics_events,
              jsonb_each_text(intents)
            ${hasTimeFilter
              ? sql`WHERE received_at >= NOW() - INTERVAL ${sql.lit(interval)}`
              : sql``}
            GROUP BY key
            ORDER BY count DESC, key ASC
            LIMIT 10
          `.execute(db).then((r) => r.rows),

          // Query 3: top errors via jsonb_each_text
          sql<ErrorRow[]>`
            SELECT
              key AS error_code,
              SUM(value::int) AS count
            FROM web_metrics_events,
              jsonb_each_text(errors)
            ${hasTimeFilter
              ? sql`WHERE received_at >= NOW() - INTERVAL ${sql.lit(interval)}`
              : sql``}
            GROUP BY key
            ORDER BY count DESC, key ASC
            LIMIT 10
          `.execute(db).then((r) => r.rows),
        ]);
      } catch (err) {
        throw Object.assign(
          new Error('Database query failed during web metrics aggregation'),
          { code: 'DB_UNAVAILABLE', statusCode: 500, cause: err },
        );
      }

      // -----------------------------------------------------------------------
      // Assemble response
      // -----------------------------------------------------------------------

      const scalar = scalarRows[0];
      const eventCount    = Number(scalar?.['event_count']        ?? 0);
      const totalQueries  = Number(scalar?.['total_queries']      ?? 0);
      const totalSuccesses = Number(scalar?.['total_successes']   ?? 0);
      const totalErrors   = Number(scalar?.['total_errors']       ?? 0);
      const totalRetries  = Number(scalar?.['total_retries']      ?? 0);
      const weightedSum   = Number(scalar?.['weighted_time_sum']  ?? 0);

      // Weighted average — null when no successful queries (avoids division by zero)
      const avgResponseTimeMs = totalSuccesses === 0
        ? null
        : weightedSum / totalSuccesses;

      const topIntents = intentRows.map((r) => ({
        intent: r.intent,
        count:  Number(r.count),
      }));

      const topErrors = errorRows.map((r) => ({
        errorCode: r.error_code,
        count:     Number(r.count),
      }));

      return reply.send({
        success: true,
        data: {
          eventCount,
          totalQueries,
          totalSuccesses,
          totalErrors,
          totalRetries,
          avgResponseTimeMs,
          topIntents,
          topErrors,
          timeRange,
        },
      });
    },
  );
};

export const webMetricsRoutes = fastifyPlugin(webMetricsRoutesPlugin);
