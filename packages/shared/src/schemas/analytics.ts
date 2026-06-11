// Analytics schemas — F029, F-ADMIN-ANALYTICS-UI
//
// Zod schemas for the GET /analytics/queries endpoint (F029)
// and the GET /analytics/history-sample admin endpoint (F-ADMIN-ANALYTICS-UI B6).
// Query params, response shape, and sub-type schemas.

import { z } from 'zod';
import { ConversationIntentSchema, ConversationMessageDataSchema } from './conversation.js';
import { SearchHistoryKindSchema } from './history.js';

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

// ---------------------------------------------------------------------------
// F-ADMIN-ANALYTICS-UI — GET /analytics/history-sample
// ---------------------------------------------------------------------------

/**
 * AdminResultDataSchema — ConversationMessageData minus actorId.
 * actorId is PII-adjacent and stripped before serving to the admin dashboard.
 * The route handler also strips it at runtime (defence in depth).
 */
export const AdminResultDataSchema = ConversationMessageDataSchema.omit({ actorId: true });
export type AdminResultData = z.infer<typeof AdminResultDataSchema>;

/**
 * Query params for GET /analytics/history-sample.
 * - hours: lookback window, 1–720, default 24. Coerced from string (Fastify querystring).
 * - limit: max rows to return, 1–100, default 20. Coerced from string.
 * - intent: optional filter — one of the ConversationIntent enum values.
 */
export const HistorySampleParamsSchema = z.object({
  hours:  z.coerce.number().int().min(1).max(720).default(24),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
  intent: ConversationIntentSchema.optional(),
});
export type HistorySampleParams = z.infer<typeof HistorySampleParamsSchema>;

/**
 * A single entry in the admin history sample response.
 * resultData uses AdminResultDataSchema (no actorId).
 */
export const SearchHistorySampleEntrySchema = z.object({
  id:         z.string().uuid(),
  kind:       SearchHistoryKindSchema,
  queryText:  z.string(),
  resultData: AdminResultDataSchema,
  createdAt:  z.string(),
});
export type SearchHistorySampleEntry = z.infer<typeof SearchHistorySampleEntrySchema>;

/**
 * Data payload for GET /analytics/history-sample response.
 */
export const HistorySampleDataSchema = z.object({
  items:        z.array(SearchHistorySampleEntrySchema),
  hours:        z.number().int().min(1).max(720),
  limit:        z.number().int().min(1).max(100),
  intentFilter: ConversationIntentSchema.optional(),
});
export type HistorySampleData = z.infer<typeof HistorySampleDataSchema>;

/**
 * Full response envelope for GET /analytics/history-sample.
 */
export const HistorySampleResponseSchema = z.object({
  success: z.literal(true),
  data:    HistorySampleDataSchema,
});
export type HistorySampleResponse = z.infer<typeof HistorySampleResponseSchema>;
