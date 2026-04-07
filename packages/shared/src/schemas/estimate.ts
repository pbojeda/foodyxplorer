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
  caloriesMin: z.number().nonnegative(),
  /** Upper bound of the estimated calorie range. */
  caloriesMax: z.number().nonnegative(),
  /** Uncertainty percentage used to compute the range (e.g., 10 for ±10%). */
  percentage: z.number().min(0).max(100),
});

export type UncertaintyRange = z.infer<typeof UncertaintyRangeSchema>;

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
