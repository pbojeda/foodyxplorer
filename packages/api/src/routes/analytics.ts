// GET /analytics/queries — Query log aggregation endpoint (F029)
//
// Admin-only (guarded by /analytics/ prefix in ADMIN_PREFIXES).
// Runs 5 Kysely aggregation queries concurrently via Promise.all.
// Returns totalQueries, cacheHitRate, avgResponseTimeMs, byLevel,
// byChain, bySource, topQueries.
//
// Zero-fills byLevel and bySource for keys absent in GROUP BY results.
// avgResponseTimeMs is null when totalQueries=0.
// cacheHitRate is 0 when totalQueries=0.

import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '../generated/kysely-types.js';
import { AnalyticsQueryParamsSchema } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

export interface AnalyticsPluginOptions {
  db: Kysely<DB>;
}

// ---------------------------------------------------------------------------
// Internal types for query results
// ---------------------------------------------------------------------------

interface ScalarRow {
  total_queries: number | string;
  cache_hit_rate: string | number | null;
  avg_response_time_ms: string | number | null;
}

interface LevelRow {
  level_hit: string | null;
  count: number | string;
}

interface ChainRow {
  chain_slug: string;
  count: number | string;
}

interface SourceRow {
  source: string;
  count: number | string;
}

interface TopQueryRow {
  query_text: string;
  count: number | string;
}

// ---------------------------------------------------------------------------
// Time range SQL interval helper
// ---------------------------------------------------------------------------

function timeRangeInterval(timeRange: string): string {
  switch (timeRange) {
    case '24h': return '24 hours';
    case '7d':  return '7 days';
    case '30d': return '30 days';
    default:    return '';
  }
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const analyticsRoutesPlugin: FastifyPluginAsync<AnalyticsPluginOptions> = async (
  app,
  opts,
) => {
  const { db } = opts;

  app.get(
    '/analytics/queries',
    {
      schema: {
        querystring: AnalyticsQueryParamsSchema,
        tags: ['Analytics'],
        operationId: 'getQueryAnalytics',
        summary: 'Query log analytics',
        description:
          'Aggregates query_logs into operational metrics. Admin-only. ' +
          'Returns totalQueries, cacheHitRate, avgResponseTimeMs, byLevel, ' +
          'byChain, bySource, and topQueries. ' +
          'timeRange filters queried_at; chainSlug scopes all aggregations.',
      },
    },
    async (request, reply) => {
      const { timeRange, chainSlug, topN } = request.query as {
        timeRange: string;
        chainSlug?: string;
        topN: number;
      };

      const interval = timeRangeInterval(timeRange);
      const hasTimeFilter = interval !== '';
      const hasChainFilter = chainSlug !== undefined;

      let scalarRows: ScalarRow[];
      let levelRows: LevelRow[];
      let chainRows: ChainRow[];
      let sourceRows: SourceRow[];
      let topQueryRows: TopQueryRow[];

      try {
        [scalarRows, levelRows, chainRows, sourceRows, topQueryRows] = await Promise.all([
          // Query 1: scalar aggregates — total count, cache hit rate, avg response time
          db.selectFrom('query_logs')
            .select([
              db.fn.countAll<number>().as('total_queries'),
              sql<string>`ROUND(AVG(cache_hit::int)::numeric, 4)`.as('cache_hit_rate'),
              sql<string>`AVG(response_time_ms)`.as('avg_response_time_ms'),
            ])
            .$if(hasTimeFilter, qb =>
              qb.where(sql<boolean>`queried_at >= NOW() - INTERVAL ${sql.lit(interval)}`),
            )
            .$if(hasChainFilter, qb =>
              qb.where('chain_slug', '=', chainSlug!),
            )
            .execute() as Promise<ScalarRow[]>,

          // Query 2: breakdown by level_hit (l1, l2, l3, l4, null=miss)
          db.selectFrom('query_logs')
            .select([
              'level_hit',
              db.fn.countAll<number>().as('count'),
            ])
            .$if(hasTimeFilter, qb =>
              qb.where(sql<boolean>`queried_at >= NOW() - INTERVAL ${sql.lit(interval)}`),
            )
            .$if(hasChainFilter, qb =>
              qb.where('chain_slug', '=', chainSlug!),
            )
            .groupBy('level_hit')
            .execute() as Promise<LevelRow[]>,

          // Query 3: breakdown by chain_slug (null chains excluded)
          db.selectFrom('query_logs')
            .select([
              'chain_slug',
              db.fn.countAll<number>().as('count'),
            ])
            .where('chain_slug', 'is not', null)
            .$if(hasTimeFilter, qb =>
              qb.where(sql<boolean>`queried_at >= NOW() - INTERVAL ${sql.lit(interval)}`),
            )
            .$if(hasChainFilter, qb =>
              qb.where('chain_slug', '=', chainSlug!),
            )
            .groupBy('chain_slug')
            .orderBy(db.fn.countAll(), 'desc')
            .execute() as Promise<ChainRow[]>,

          // Query 4: breakdown by source (api, bot)
          db.selectFrom('query_logs')
            .select([
              'source',
              db.fn.countAll<number>().as('count'),
            ])
            .$if(hasTimeFilter, qb =>
              qb.where(sql<boolean>`queried_at >= NOW() - INTERVAL ${sql.lit(interval)}`),
            )
            .$if(hasChainFilter, qb =>
              qb.where('chain_slug', '=', chainSlug!),
            )
            .groupBy('source')
            .execute() as Promise<SourceRow[]>,

          // Query 5: top query terms by frequency
          db.selectFrom('query_logs')
            .select([
              'query_text',
              db.fn.countAll<number>().as('count'),
            ])
            .$if(hasTimeFilter, qb =>
              qb.where(sql<boolean>`queried_at >= NOW() - INTERVAL ${sql.lit(interval)}`),
            )
            .$if(hasChainFilter, qb =>
              qb.where('chain_slug', '=', chainSlug!),
            )
            .groupBy('query_text')
            .orderBy(db.fn.countAll(), 'desc')
            .limit(topN)
            .execute() as Promise<TopQueryRow[]>,
        ]);
      } catch (err) {
        throw Object.assign(
          new Error('Database query failed during analytics aggregation'),
          { code: 'DB_UNAVAILABLE', statusCode: 500, cause: err },
        );
      }

      // -----------------------------------------------------------------------
      // Assemble response
      // -----------------------------------------------------------------------

      const scalarRow = scalarRows[0];
      const totalQueries = Number(scalarRow?.total_queries ?? 0);

      const cacheHitRate = totalQueries === 0
        ? 0
        : Number(scalarRow?.cache_hit_rate ?? 0);

      const avgResponseTimeMs = totalQueries === 0
        ? null
        : Number(scalarRow?.avg_response_time_ms ?? 0);

      // byLevel — zero-fill missing keys (GROUP BY omits zero-count levels)
      const levelMap = new Map<string | null, number>();
      for (const row of levelRows) {
        levelMap.set(row.level_hit, Number(row.count));
      }
      const byLevel = {
        l1:   levelMap.get('l1')   ?? 0,
        l2:   levelMap.get('l2')   ?? 0,
        l3:   levelMap.get('l3')   ?? 0,
        l4:   levelMap.get('l4')   ?? 0,
        miss: levelMap.get(null)   ?? 0,
      };

      // byChain
      const byChain = chainRows.map(row => ({
        chainSlug: row.chain_slug,
        count:     Number(row.count),
      }));

      // bySource — zero-fill missing keys
      const sourceMap = new Map<string, number>();
      for (const row of sourceRows) {
        sourceMap.set(row.source, Number(row.count));
      }
      const bySource = {
        api: sourceMap.get('api') ?? 0,
        bot: sourceMap.get('bot') ?? 0,
      };

      // topQueries
      const topQueries = topQueryRows.map(row => ({
        queryText: row.query_text,
        count:     Number(row.count),
      }));

      const data = {
        totalQueries,
        cacheHitRate,
        avgResponseTimeMs,
        byLevel,
        byChain,
        bySource,
        topQueries,
        timeRange,
        ...(hasChainFilter && { scopedToChain: chainSlug }),
      };

      return reply.send({ success: true, data });
    },
  );
};

export const analyticsRoutes = fastifyPlugin(analyticsRoutesPlugin);
