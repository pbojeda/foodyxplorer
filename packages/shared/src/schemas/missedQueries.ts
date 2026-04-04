// Missed Queries schemas — F079
//
// Zod schemas for the demand-driven expansion pipeline endpoints:
//   GET  /analytics/missed-queries
//   POST /analytics/missed-queries/:id/status

import { z } from 'zod';
import { AnalyticsTimeRangeSchema } from './analytics';

// ---------------------------------------------------------------------------
// MissedQueryStatusSchema
// ---------------------------------------------------------------------------

export const MissedQueryStatusSchema = z.enum(['pending', 'resolved', 'ignored']);
export type MissedQueryStatus = z.infer<typeof MissedQueryStatusSchema>;

// ---------------------------------------------------------------------------
// MissedQueriesParamsSchema — GET query params
// ---------------------------------------------------------------------------

export const MissedQueriesParamsSchema = z.object({
  timeRange: AnalyticsTimeRangeSchema.default('30d'),
  topN: z.coerce.number().int().min(1).max(100).default(20),
  minCount: z.coerce.number().int().min(1).default(2),
});
export type MissedQueriesParams = z.infer<typeof MissedQueriesParamsSchema>;

// ---------------------------------------------------------------------------
// MissedQueryItemSchema — single item in response
// ---------------------------------------------------------------------------

export const MissedQueryItemSchema = z.object({
  queryText: z.string(),
  count: z.number().int().nonnegative(),
  trackingId: z.string().uuid().nullable(),
  trackingStatus: MissedQueryStatusSchema.nullable(),
});
export type MissedQueryItem = z.infer<typeof MissedQueryItemSchema>;

// ---------------------------------------------------------------------------
// MissedQueriesResponseSchema — GET response
// ---------------------------------------------------------------------------

export const MissedQueriesResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    missedQueries: z.array(MissedQueryItemSchema),
    totalMissCount: z.number().int().nonnegative(),
    timeRange: AnalyticsTimeRangeSchema,
  }),
});
export type MissedQueriesResponse = z.infer<typeof MissedQueriesResponseSchema>;

// ---------------------------------------------------------------------------
// UpdateMissedQueryStatusBodySchema — POST body
// ---------------------------------------------------------------------------

export const UpdateMissedQueryStatusBodySchema = z.object({
  status: MissedQueryStatusSchema,
  resolvedDishId: z.string().uuid().optional(),
  notes: z.string().max(1000).optional(),
});
export type UpdateMissedQueryStatusBody = z.infer<typeof UpdateMissedQueryStatusBodySchema>;

// ---------------------------------------------------------------------------
// UpdateMissedQueryStatusParamsSchema — POST path params
// ---------------------------------------------------------------------------

export const UpdateMissedQueryStatusParamsSchema = z.object({
  id: z.string().uuid(),
});
export type UpdateMissedQueryStatusParams = z.infer<typeof UpdateMissedQueryStatusParamsSchema>;

// ---------------------------------------------------------------------------
// MissedQueryTrackingSchema — tracking entry response
// ---------------------------------------------------------------------------

export const MissedQueryTrackingSchema = z.object({
  id: z.string().uuid(),
  queryText: z.string(),
  hitCount: z.number().int().nonnegative(),
  status: MissedQueryStatusSchema,
  resolvedDishId: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MissedQueryTracking = z.infer<typeof MissedQueryTrackingSchema>;

// ---------------------------------------------------------------------------
// UpdateMissedQueryStatusResponseSchema — POST response
// ---------------------------------------------------------------------------

export const UpdateMissedQueryStatusResponseSchema = z.object({
  success: z.literal(true),
  data: MissedQueryTrackingSchema,
});
export type UpdateMissedQueryStatusResponse = z.infer<typeof UpdateMissedQueryStatusResponseSchema>;

// ---------------------------------------------------------------------------
// BatchTrackBodySchema — POST /analytics/missed-queries/track body
// ---------------------------------------------------------------------------

export const BatchTrackBodySchema = z.object({
  queries: z.array(z.object({
    queryText: z.string().min(3).max(255),
    hitCount: z.number().int().min(1),
  })).min(1).max(100),
});
export type BatchTrackBody = z.infer<typeof BatchTrackBodySchema>;
