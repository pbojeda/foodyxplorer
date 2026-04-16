// Zod schemas for the Estimation Engine (E003) — Level 1 and beyond.
//
// EstimateQuerySchema     — query params for GET /estimate
// EstimateMatchTypeSchema — how the match was found
// EstimateSourceSchema    — data source traceability block
// EstimateNutrientsSchema — all 16 nutrient fields + referenceBasis
// EstimateResultSchema    — matched entity + nutritional data
// EstimateDataSchema      — full response data payload
// EstimateResponseSchema  — API response envelope

import { z } from 'zod';
import {
  ConfidenceLevelSchema,
  EstimationMethodSchema,
  NutrientReferenceBasisSchema,
  DataSourceTypeSchema,
} from './enums.js';
import { CookingStateSchema, YieldAdjustmentSchema } from './cookingProfile.js';

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

export const EstimateQuerySchema = z.object({
  query: z.string().trim().min(1).max(255),
  chainSlug: z.string().regex(/^[a-z0-9-]+$/).max(100).optional(),
  restaurantId: z.string().uuid().optional(),
  portionMultiplier: z.coerce.number().min(0.1).max(5.0).optional(),
  /** F072 — whether the queried quantity refers to raw or cooked food */
  cookingState: CookingStateSchema.optional(),
  /** F072 — optional cooking method (e.g., "boiled", "fried", "grilled") */
  cookingMethod: z.string().min(1).max(100).optional(),
});

export type EstimateQuery = z.infer<typeof EstimateQuerySchema>;

// ---------------------------------------------------------------------------
// Match type
// ---------------------------------------------------------------------------

export const EstimateMatchTypeSchema = z.enum([
  'exact_dish',
  'fts_dish',
  'exact_food',
  'fts_food',
  'ingredient_dish_exact',        // Level 2 — exact dish match via ingredient aggregation
  'ingredient_dish_fts',          // Level 2 — FTS dish match via ingredient aggregation
  'similarity_dish',              // Level 3 — pgvector nearest-neighbour in dishes.embedding
  'similarity_food',              // Level 3 — pgvector nearest-neighbour in foods.embedding
  'llm_food_match',               // Level 4 — LLM identifies closest known food in DB
  'llm_ingredient_decomposition', // Level 4 — LLM decomposes dish into known ingredients → L2-style aggregation
  'direct_id',                    // F035 — direct UUID lookup in food_nutrients
]);

export type EstimateMatchType = z.infer<typeof EstimateMatchTypeSchema>;

// ---------------------------------------------------------------------------
// Source traceability
// ---------------------------------------------------------------------------

export const EstimateSourceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: DataSourceTypeSchema,
  url: z.string().nullable(),
  priorityTier: z.number().int().min(0).max(3).nullable().optional(),
  /** F080: ODbL attribution note. Present for OFF-sourced results; null otherwise. */
  attributionNote: z.string().nullable().optional(),
  /** F080: Data license identifier. "ODbL 1.0" for OFF results; null otherwise. */
  license: z.string().nullable().optional(),
  /** F080: Product URL on OFF. Present when barcode is available; null otherwise. */
  sourceUrl: z.string().url().nullable().optional(),
});

export type EstimateSource = z.infer<typeof EstimateSourceSchema>;

// ---------------------------------------------------------------------------
// Nutrient payload — all 16 nutrients as numbers + referenceBasis
// ---------------------------------------------------------------------------

export const EstimateNutrientsSchema = z.object({
  calories: z.number().nonnegative(),
  proteins: z.number().nonnegative(),
  carbohydrates: z.number().nonnegative(),
  sugars: z.number().nonnegative(),
  fats: z.number().nonnegative(),
  saturatedFats: z.number().nonnegative(),
  fiber: z.number().nonnegative(),
  salt: z.number().nonnegative(),
  sodium: z.number().nonnegative(),
  transFats: z.number().nonnegative(),
  cholesterol: z.number().nonnegative(),
  potassium: z.number().nonnegative(),
  monounsaturatedFats: z.number().nonnegative(),
  polyunsaturatedFats: z.number().nonnegative(),
  alcohol: z.number().nonnegative(),
  referenceBasis: NutrientReferenceBasisSchema,
});

export type EstimateNutrients = z.infer<typeof EstimateNutrientsSchema>;

// ---------------------------------------------------------------------------
// Result — matched entity + nutritional data
// ---------------------------------------------------------------------------

export const EstimateResultSchema = z.object({
  entityType: z.enum(['dish', 'food']),
  entityId: z.string().uuid(),
  name: z.string(),
  nameEs: z.string().nullable(),
  restaurantId: z.string().uuid().nullable(),
  chainSlug: z.string().nullable(),
  portionGrams: z.number().positive().nullable(),
  nutrients: EstimateNutrientsSchema,
  confidenceLevel: ConfidenceLevelSchema,
  estimationMethod: EstimationMethodSchema,
  source: EstimateSourceSchema,
  similarityDistance: z.number().min(0).max(2).nullable(), // null for L1/L2; cosine distance for L3
});

export type EstimateResult = z.infer<typeof EstimateResultSchema>;

// ---------------------------------------------------------------------------
// F081 — Health-Hacker chain modification tips
// ---------------------------------------------------------------------------

export const HealthHackerTipSchema = z.object({
  /** Human-readable modification tip in Spanish. */
  tip: z.string(),
  /** Estimated calories saved by applying this modification. */
  caloriesSaved: z.number().positive(),
});

export type HealthHackerTip = z.infer<typeof HealthHackerTipSchema>;

// ---------------------------------------------------------------------------
// F082 — Nutritional substitution suggestions
// ---------------------------------------------------------------------------

export const NutritionalSubstitutionSchema = z.object({
  /** Display name of the original food component. */
  original: z.string(),
  /** Display name of the suggested substitute. */
  substitute: z.string(),
  /** Per-serving nutrient difference (substitute minus original). Negative = fewer. */
  nutrientDiff: z.object({
    calories: z.number(),
    proteins: z.number(),
    fats: z.number(),
    carbohydrates: z.number(),
    fiber: z.number(),
  }),
});

export type NutritionalSubstitution = z.infer<typeof NutritionalSubstitutionSchema>;

// ---------------------------------------------------------------------------
// F083 — Detected allergen from food/dish name keyword matching
// ---------------------------------------------------------------------------

export const DetectedAllergenSchema = z.object({
  /** EU allergen category name in Spanish. */
  allergen: z.string(),
  /** Keywords that triggered the detection. */
  keyword: z.string(),
});

export type DetectedAllergen = z.infer<typeof DetectedAllergenSchema>;

// ---------------------------------------------------------------------------
// F084 — Uncertainty range for calorie estimation
// ---------------------------------------------------------------------------

export const UncertaintyRangeSchema = z.object({
  /** Lower bound of the estimated calorie range. */
  caloriesMin: z.number().int().nonnegative(),
  /** Upper bound of the estimated calorie range. */
  caloriesMax: z.number().int().nonnegative(),
  /** Uncertainty percentage used to compute the range (e.g., 10 for ±10%). */
  percentage: z.number().min(0).max(100),
});

export type UncertaintyRange = z.infer<typeof UncertaintyRangeSchema>;

// ---------------------------------------------------------------------------
// F085 — Portion sizing context from Spanish portion terms
// ---------------------------------------------------------------------------

export const PortionSizingSchema = z.object({
  /** Detected Spanish portion term (e.g., "media ración"). */
  term: z.string(),
  /** Lower bound of typical gram weight for this portion. */
  gramsMin: z.number().int().positive(),
  /** Upper bound of typical gram weight for this portion. */
  gramsMax: z.number().int().positive(),
  /** Human-readable description in Spanish. */
  description: z.string(),
});

export type PortionSizing = z.infer<typeof PortionSizingSchema>;

// ---------------------------------------------------------------------------
// F-UX-B — Per-dish portion assumption with 3-tier fallback chain
// ---------------------------------------------------------------------------

export const PortionAssumptionSchema = z.object({
  /** Canonical DB key: 'pintxo' | 'tapa' | 'media_racion' | 'racion' */
  term: z.enum(['pintxo', 'tapa', 'media_racion', 'racion']),
  /** User-typed variant from the original query (e.g., "pincho" or "pintxo"). */
  termDisplay: z.string().min(1),
  /** Whether this assumption came from a DB row (per_dish) or the F085 generic map (generic). */
  source: z.enum(['per_dish', 'generic']),
  /** Post-F042-multiplier gram estimate. For generic: Math.round((gramsMin + gramsMax) / 2). */
  grams: z.number().int().positive(),
  /**
   * Post-F042 piece count. null when basePieces × multiplier < 0.75 (low-multiplier fall-through)
   * or when the dish is non-countable (gazpacho, salmorejo).
   * Must be null when source === 'generic'.
   */
  pieces: z.number().int().min(1).nullable(),
  /** Literal string from seed data — no runtime pluralization. null iff pieces is null. */
  pieceName: z.string().min(1).nullable(),
  /** Only present when source === 'generic' — the F085 global [gramsMin, gramsMax] range. */
  gramsRange: z.tuple([z.number().int().positive(), z.number().int().positive()]).nullable(),
  /** From seed data. null when source === 'generic'. */
  confidence: z.enum(['high', 'medium', 'low']).nullable(),
  /**
   * Observability discriminator for Tier 3 fallbacks.
   * - null when source === 'per_dish' (Tier 1 or Tier 2 hit)
   * - 'no_row' when generic because no row exists for this (dishId, term)
   * - 'tier2_rejected_tapa' / 'tier2_rejected_pintxo' when generic because a ración row
   *   existed but Tier 2 refused to derive a ratio for tapa/pintxo queries.
   * Consumed by structured logs / future analytics. Ignored by render layers.
   */
  fallbackReason: z.enum(['no_row', 'tier2_rejected_tapa', 'tier2_rejected_pintxo']).nullable(),
}).superRefine((d, ctx) => {
  function issue(message: string) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  }

  if (d.source === 'per_dish') {
    if (d.gramsRange !== null) issue('gramsRange must be null for per_dish');
    if (d.confidence === null) issue('confidence must be non-null for per_dish');
    if (d.fallbackReason !== null) issue('fallbackReason must be null for per_dish');
    if ((d.pieces === null) !== (d.pieceName === null)) {
      issue('pieces and pieceName must both be null or both non-null');
    }
  }

  if (d.source === 'generic') {
    if (d.gramsRange === null) {
      issue('gramsRange must be present for generic');
    } else {
      if (d.gramsRange[0] <= 0 || d.gramsRange[1] <= d.gramsRange[0]) {
        issue('gramsRange must be [positiveMin, min < max]');
      }
      const derived = Math.round((d.gramsRange[0] + d.gramsRange[1]) / 2);
      if (d.grams !== derived) {
        issue(`grams must equal Math.round(gramsRange midpoint) = ${derived}`);
      }
    }
    if (d.pieces !== null) issue('pieces must be null for generic');
    if (d.pieceName !== null) issue('pieceName must be null for generic');
    if (d.confidence !== null) issue('confidence must be null for generic');
    if (d.fallbackReason === null) issue('fallbackReason must be non-null for generic');
  }
});

export type PortionAssumption = z.infer<typeof PortionAssumptionSchema>;

// ---------------------------------------------------------------------------
// Data payload — full response body data
// ---------------------------------------------------------------------------

export const EstimateDataSchema = z.object({
  query: z.string(),
  chainSlug: z.string().nullable(),
  portionMultiplier: z.number().min(0.1).max(5.0),
  level1Hit: z.boolean(),
  level2Hit: z.boolean(),
  level3Hit: z.boolean(),  // true when Level 3 produced a similarity match
  level4Hit: z.boolean(),  // true when Level 4 (LLM) produced a match
  matchType: EstimateMatchTypeSchema.nullable(),
  result: EstimateResultSchema.nullable(),
  cachedAt: z.string().nullable(),
  /** F072 — yield adjustment details; null when no correction was attempted */
  yieldAdjustment: YieldAdjustmentSchema.nullable().optional(),
  /** F081 — Health-Hacker calorie-saving tips for chain dishes. Empty/absent = no tips. */
  healthHackerTips: z.array(HealthHackerTipSchema).optional(),
  /** F082 — Nutritional substitution suggestions. Empty/absent = no substitutions. */
  substitutions: z.array(NutritionalSubstitutionSchema).optional(),
  /** F083 — Detected allergens from food/dish name keywords. Empty/absent = none detected. */
  allergens: z.array(DetectedAllergenSchema).optional(),
  /** F084 — Calorie uncertainty range based on confidence + estimation method. */
  uncertaintyRange: UncertaintyRangeSchema.optional(),
  /** F085 — Detected Spanish portion term with standard gram range. */
  portionSizing: PortionSizingSchema.optional(),
  /**
   * F-UX-B — Per-dish portion assumption with 3-tier fallback.
   * Absent when no Spanish portion term was detected in the query.
   * `source: 'per_dish'` = DB row found; `source: 'generic'` = F085 global range.
   */
  portionAssumption: PortionAssumptionSchema.optional(),
  /**
   * F-UX-A — Pre-multiplier nutrient row, only present when `portionMultiplier !== 1.0`.
   * When present, `basePortionGrams` MUST also be present. The frontend renders
   * a `base: {N} kcal` subtitle under the scaled calorie number so users can
   * see both the normal serving and the estimation used for the calculation.
   * Absence of this field means `portionMultiplier === 1.0` (no modifier).
   */
  baseNutrients: EstimateNutrientsSchema.optional(),
  /**
   * F-UX-A — Pre-multiplier portion grams, paired with `baseNutrients`. Same
   * presence rule: both appear together when `portionMultiplier !== 1.0`,
   * both absent when the multiplier is 1.0.
   */
  basePortionGrams: z.number().positive().nullable().optional(),
}).superRefine((data, ctx) => {
  // F-UX-A invariant: `baseNutrients` and `basePortionGrams` must either
  // both be present or both be absent. They are a pair — callers never
  // need one without the other.
  const hasBase = data.baseNutrients !== undefined;
  const hasGrams = data.basePortionGrams !== undefined;
  if (hasBase !== hasGrams) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'F-UX-A invariant: baseNutrients and basePortionGrams must both be present or both be absent',
      path: ['baseNutrients'],
    });
  }
  // And both are only meaningful when portionMultiplier !== 1.0 — if the
  // multiplier is 1.0 the base equals the scaled value so there is no point.
  if (hasBase && data.portionMultiplier === 1.0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'F-UX-A invariant: baseNutrients is only allowed when portionMultiplier !== 1.0',
      path: ['baseNutrients'],
    });
  }
});

export type EstimateData = z.infer<typeof EstimateDataSchema>;

// ---------------------------------------------------------------------------
// Response envelope
// ---------------------------------------------------------------------------

export const EstimateResponseSchema = z.object({
  success: z.literal(true),
  data: EstimateDataSchema,
});

export type EstimateResponse = z.infer<typeof EstimateResponseSchema>;
