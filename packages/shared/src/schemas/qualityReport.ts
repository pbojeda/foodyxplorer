// Quality Report Zod schemas — single source of truth for F018.
//
// Used by both the API route (packages/api/src/routes/quality.ts)
// and the CLI script (packages/api/src/scripts/quality-monitor.ts).
//
// All numeric fields are plain `number` (not Prisma Decimal).
// Check functions must call .toNumber() before populating these schemas.

import { z } from 'zod';
import { ConfidenceLevelSchema, EstimationMethodSchema } from './enums';

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

export const QualityReportQuerySchema = z.object({
  stalenessThresholdDays: z.coerce.number().int().min(1).default(90),
  chainSlug: z.string().regex(/^[a-z0-9-]+$/).max(100).optional(),
});

export type QualityReportQuery = z.infer<typeof QualityReportQuerySchema>;

// ---------------------------------------------------------------------------
// Chain summary (top-level per-chain overview)
// ---------------------------------------------------------------------------

export const QualityChainSummarySchema = z.object({
  chainSlug: z.string(),
  totalDishes: z.number().int().nonnegative(),
  nutrientCoveragePercent: z.number().nonnegative(),
  issueCount: z.number().int().nonnegative(),
});

export type QualityChainSummary = z.infer<typeof QualityChainSummarySchema>;

// ---------------------------------------------------------------------------
// 1. Nutrient Completeness
// ---------------------------------------------------------------------------

export const QualityNutrientCompletenessChainSchema = z.object({
  chainSlug: z.string(),
  dishesWithoutNutrients: z.number().int().nonnegative(),
  ghostRowCount: z.number().int().nonnegative(),
  zeroCaloriesCount: z.number().int().nonnegative(),
});

export type QualityNutrientCompletenessChain = z.infer<typeof QualityNutrientCompletenessChainSchema>;

export const QualityNutrientCompletenessSchema = z.object({
  dishesWithNutrients: z.number().int().nonnegative(),
  dishesWithoutNutrients: z.number().int().nonnegative(),
  dishesWithoutNutrientsPercent: z.number().nonnegative(),
  ghostRowCount: z.number().int().nonnegative(),
  zeroCaloriesCount: z.number().int().nonnegative(),
  byChain: z.array(QualityNutrientCompletenessChainSchema),
});

export type QualityNutrientCompleteness = z.infer<typeof QualityNutrientCompletenessSchema>;

// ---------------------------------------------------------------------------
// 2. Implausible Values
// ---------------------------------------------------------------------------

export const QualityImplausibleValuesChainSchema = z.object({
  chainSlug: z.string(),
  caloriesAboveThreshold: z.number().int().nonnegative(),
  ghostRows: z.number().int().nonnegative(),
  suspiciouslyRoundCalories: z.number().int().nonnegative(),
});

export type QualityImplausibleValuesChain = z.infer<typeof QualityImplausibleValuesChainSchema>;

export const QualityImplausibleValuesSchema = z.object({
  caloriesAboveThreshold: z.number().int().nonnegative(),
  ghostRows: z.number().int().nonnegative(),
  suspiciouslyRoundCalories: z.number().int().nonnegative(),
  caloriesThreshold: z.literal(5000),
  byChain: z.array(QualityImplausibleValuesChainSchema),
});

export type QualityImplausibleValues = z.infer<typeof QualityImplausibleValuesSchema>;

// ---------------------------------------------------------------------------
// 3. Data Gaps
// ---------------------------------------------------------------------------

export const QualityDataGapsSchema = z.object({
  dishesWithoutPortionGrams: z.number().int().nonnegative(),
  dishesWithoutPriceEur: z.number().int().nonnegative(),
  restaurantsWithoutDishes: z.number().int().nonnegative(),
});

export type QualityDataGaps = z.infer<typeof QualityDataGapsSchema>;

// ---------------------------------------------------------------------------
// 4. Duplicates
// ---------------------------------------------------------------------------

export const QualityDuplicateGroupSchema = z.object({
  name: z.string(),
  chainSlug: z.string(),
  count: z.number().int().min(2),
  dishIds: z.array(z.string()),
});

export type QualityDuplicateGroup = z.infer<typeof QualityDuplicateGroupSchema>;

export const QualityDuplicatesSchema = z.object({
  duplicateGroupCount: z.number().int().nonnegative(),
  totalDuplicateDishes: z.number().int().nonnegative(),
  groups: z.array(QualityDuplicateGroupSchema),
});

export type QualityDuplicates = z.infer<typeof QualityDuplicatesSchema>;

// ---------------------------------------------------------------------------
// 5. Confidence Distribution
// ---------------------------------------------------------------------------

export const QualityConfidenceByEstimationMethodSchema = z.object({
  official: z.number().int().nonnegative(),
  scraped: z.number().int().nonnegative(),
  ingredients: z.number().int().nonnegative(),
  extrapolation: z.number().int().nonnegative(),
});

export type QualityConfidenceByEstimationMethod = z.infer<typeof QualityConfidenceByEstimationMethodSchema>;

export const QualityConfidenceChainSchema = z.object({
  chainSlug: z.string(),
  high: z.number().int().nonnegative(),
  medium: z.number().int().nonnegative(),
  low: z.number().int().nonnegative(),
  byEstimationMethod: QualityConfidenceByEstimationMethodSchema,
});

export type QualityConfidenceChain = z.infer<typeof QualityConfidenceChainSchema>;

export const QualityConfidenceDistributionSchema = z.object({
  global: z.object({
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
  }),
  byEstimationMethod: QualityConfidenceByEstimationMethodSchema,
  byChain: z.array(QualityConfidenceChainSchema),
});

export type QualityConfidenceDistribution = z.infer<typeof QualityConfidenceDistributionSchema>;

// ---------------------------------------------------------------------------
// 6. Data Freshness
// ---------------------------------------------------------------------------

export const QualityStaleSourceSchema = z.object({
  sourceId: z.string(),
  name: z.string(),
  lastUpdated: z.string().nullable(),
  daysSinceUpdate: z.number().int().nonnegative().nullable(),
});

export type QualityStaleSource = z.infer<typeof QualityStaleSourceSchema>;

export const QualityDataFreshnessSchema = z.object({
  totalSources: z.number().int().nonnegative(),
  staleSources: z.number().int().nonnegative(),
  staleSourcesDetail: z.array(QualityStaleSourceSchema),
});

export type QualityDataFreshness = z.infer<typeof QualityDataFreshnessSchema>;

// ---------------------------------------------------------------------------
// Full report payload
// ---------------------------------------------------------------------------

export const QualityReportDataSchema = z.object({
  generatedAt: z.string(),
  totalDishes: z.number().int().nonnegative(),
  totalRestaurants: z.number().int().nonnegative(),
  stalenessThresholdDays: z.number().int().min(1),
  scopedToChain: z.string().nullable(),
  chainSummary: z.array(QualityChainSummarySchema),
  nutrientCompleteness: QualityNutrientCompletenessSchema,
  implausibleValues: QualityImplausibleValuesSchema,
  dataGaps: QualityDataGapsSchema,
  duplicates: QualityDuplicatesSchema,
  confidenceDistribution: QualityConfidenceDistributionSchema,
  dataFreshness: QualityDataFreshnessSchema,
});

export type QualityReportData = z.infer<typeof QualityReportDataSchema>;

// ---------------------------------------------------------------------------
// API response envelope
// ---------------------------------------------------------------------------

export const QualityReportResponseSchema = z.object({
  success: z.literal(true),
  data: QualityReportDataSchema,
});

export type QualityReportResponse = z.infer<typeof QualityReportResponseSchema>;

// Re-export enum schemas used in quality report (for consumers)
export { ConfidenceLevelSchema, EstimationMethodSchema };
