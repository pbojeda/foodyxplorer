// Web Metrics schemas — F113
//
// Zod schemas for POST /analytics/web-events (MetricsSnapshot inbound payload)
// and GET /analytics/web-events (query params + aggregation response).

import { z } from 'zod';

// ---------------------------------------------------------------------------
// WebMetricsSnapshotSchema — validates the inbound POST body
// ---------------------------------------------------------------------------

const intentOrErrorRecord = z
  .record(
    z.string().max(100),
    z.number().int().min(0),
  )
  .refine((v) => Object.keys(v).length <= 50, {
    message: 'Record must have at most 50 keys',
  });

export const WebMetricsSnapshotSchema = z
  .object({
    queryCount:       z.number().int().min(1),
    successCount:     z.number().int().min(0),
    errorCount:       z.number().int().min(0),
    retryCount:       z.number().int().min(0),
    intents:          intentOrErrorRecord,
    errors:           intentOrErrorRecord,
    avgResponseTimeMs: z.number().min(0).max(120000).transform(Math.round),
    sessionStartedAt: z.string().refine(
      (s) => {
        const ts = Date.parse(s);
        if (isNaN(ts)) return false;
        const now = Date.now();
        // Not more than 1 minute in the future (clock skew tolerance)
        if (ts > now + 60 * 1000) return false;
        // Not older than 24 hours
        if (ts < now - 24 * 60 * 60 * 1000) return false;
        return true;
      },
      {
        message:
          'sessionStartedAt must be a valid ISO date, not older than 24 hours, and not more than 1 minute in the future',
      },
    ),
  })
  .refine((v) => v.successCount <= v.queryCount, {
    message: 'successCount cannot exceed queryCount',
    path: ['successCount'],
  })
  .refine((v) => v.errorCount <= v.queryCount, {
    message: 'errorCount cannot exceed queryCount',
    path: ['errorCount'],
  });

export type WebMetricsSnapshot = z.infer<typeof WebMetricsSnapshotSchema>;

// ---------------------------------------------------------------------------
// WebMetricsQueryParamsSchema — GET endpoint query params
// ---------------------------------------------------------------------------

export const WebMetricsQueryParamsSchema = z.object({
  timeRange: z.enum(['24h', '7d', '30d', 'all']).default('7d'),
});

export type WebMetricsQueryParams = z.infer<typeof WebMetricsQueryParamsSchema>;

// ---------------------------------------------------------------------------
// WebMetricsAggregateSchema — GET response data shape
// ---------------------------------------------------------------------------

export const WebMetricsAggregateSchema = z.object({
  eventCount:        z.number().int().nonnegative(),
  totalQueries:      z.number().int().nonnegative(),
  totalSuccesses:    z.number().int().nonnegative(),
  totalErrors:       z.number().int().nonnegative(),
  totalRetries:      z.number().int().nonnegative(),
  avgResponseTimeMs: z.number().nonnegative().nullable(),
  topIntents:        z.array(z.object({ intent: z.string(), count: z.number().int().nonnegative() })),
  topErrors:         z.array(z.object({ errorCode: z.string(), count: z.number().int().nonnegative() })),
  timeRange:         z.enum(['24h', '7d', '30d', 'all']),
});

export type WebMetricsAggregate = z.infer<typeof WebMetricsAggregateSchema>;
