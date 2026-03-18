// Zod schemas for the Estimation Engine (E003) — Level 1 and beyond.
//
// EstimateQuerySchema     — query params for GET /estimate
// EstimateMatchTypeSchema — how the match was found
// EstimateSourceSchema    — data source traceability block
// EstimateNutrientsSchema — all 15 nutrient fields + referenceBasis
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

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

export const EstimateQuerySchema = z.object({
  query: z.string().trim().min(1).max(255),
  chainSlug: z.string().regex(/^[a-z0-9-]+$/).max(100).optional(),
  restaurantId: z.string().uuid().optional(),
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
  'ingredient_dish_exact',  // Level 2 — exact dish match via ingredient aggregation
  'ingredient_dish_fts',    // Level 2 — FTS dish match via ingredient aggregation
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
});

export type EstimateSource = z.infer<typeof EstimateSourceSchema>;

// ---------------------------------------------------------------------------
// Nutrient payload — all 15 nutrients as numbers + referenceBasis
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
});

export type EstimateResult = z.infer<typeof EstimateResultSchema>;

// ---------------------------------------------------------------------------
// Data payload — full response body data
// ---------------------------------------------------------------------------

export const EstimateDataSchema = z.object({
  query: z.string(),
  chainSlug: z.string().nullable(),
  level1Hit: z.boolean(),
  level2Hit: z.boolean(),
  matchType: EstimateMatchTypeSchema.nullable(),
  result: EstimateResultSchema.nullable(),
  cachedAt: z.string().nullable(),
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
