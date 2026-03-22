// Analytics schemas — F029
//
// Zod schemas for the GET /analytics/queries endpoint.
// Query params, response shape, and sub-type schemas.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// AnalyticsTimeRangeSchema
// ---------------------------------------------------------------------------

export const AnalyticsTimeRangeSchema = z.enum(['24h', '7d', '30d', 'all']);
export type AnalyticsTimeRange = z.infer<typeof AnalyticsTimeRangeSchema>;

// ---------------------------------------------------------------------------
// AnalyticsQueryParamsSchema
// ---------------------------------------------------------------------------

export const AnalyticsQueryParamsSchema = z.object({
  timeRange: AnalyticsTimeRangeSchema.default('7d'),
  chainSlug: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'chainSlug must be lowercase alphanumeric with hyphens')
    .optional(),
  topN: z.coerce.number().int().min(1).max(100).default(10),
});
export type AnalyticsQueryParams = z.infer<typeof AnalyticsQueryParamsSchema>;

// ---------------------------------------------------------------------------
// LevelDistributionSchema
// ---------------------------------------------------------------------------

export const LevelDistributionSchema = z.object({
  l1:   z.number().int().nonnegative(),
  l2:   z.number().int().nonnegative(),
  l3:   z.number().int().nonnegative(),
  l4:   z.number().int().nonnegative(),
  miss: z.number().int().nonnegative(),
});
export type LevelDistribution = z.infer<typeof LevelDistributionSchema>;

// ---------------------------------------------------------------------------
// ChainQueryCountSchema
// ---------------------------------------------------------------------------

export const ChainQueryCountSchema = z.object({
  chainSlug: z.string(),
  count:     z.number().int().nonnegative(),
});
export type ChainQueryCount = z.infer<typeof ChainQueryCountSchema>;

// ---------------------------------------------------------------------------
// TopQueryTermSchema
// ---------------------------------------------------------------------------

export const TopQueryTermSchema = z.object({
  queryText: z.string(),
  count:     z.number().int().nonnegative(),
});
export type TopQueryTerm = z.infer<typeof TopQueryTermSchema>;

// ---------------------------------------------------------------------------
// SourceDistributionSchema
// ---------------------------------------------------------------------------

export const SourceDistributionSchema = z.object({
  api: z.number().int().nonnegative(),
  bot: z.number().int().nonnegative(),
});
export type SourceDistribution = z.infer<typeof SourceDistributionSchema>;

// ---------------------------------------------------------------------------
// AnalyticsDataSchema
// ---------------------------------------------------------------------------

export const AnalyticsDataSchema = z.object({
  totalQueries:      z.number().int().nonnegative(),
  cacheHitRate:      z.number().min(0).max(1),
  avgResponseTimeMs: z.number().nonnegative().nullable(),
  byLevel:           LevelDistributionSchema,
  byChain:           z.array(ChainQueryCountSchema),
  bySource:          SourceDistributionSchema,
  topQueries:        z.array(TopQueryTermSchema),
  scopedToChain:     z.string().optional(),
  timeRange:         AnalyticsTimeRangeSchema,
});
export type AnalyticsData = z.infer<typeof AnalyticsDataSchema>;

// ---------------------------------------------------------------------------
// AnalyticsResponseSchema
// ---------------------------------------------------------------------------

export const AnalyticsResponseSchema = z.object({
  success: z.literal(true),
  data:    AnalyticsDataSchema,
});
export type AnalyticsResponse = z.infer<typeof AnalyticsResponseSchema>;
