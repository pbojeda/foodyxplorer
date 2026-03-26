// Zod schemas for the Recipe Calculation endpoint (F035).
//
// RecipeIngredientInputSchema — one ingredient item in structured mode
// RecipeCalculateBodySchema   — discriminated union on mode ("structured" | "free-form")
// ParsedIngredientSchema      — one LLM-parsed ingredient
// LlmParseOutputSchema        — array of ParsedIngredientSchema (LLM output validation)
// ResolvedIngredientSchema    — per-ingredient response item
// RecipeCalculateDataSchema   — full response data payload
// RecipeCalculateResponseSchema — API response envelope

import { z } from 'zod';
import {
  ConfidenceLevelSchema,
  NutrientReferenceBasisSchema,
} from './enums.js';
import { EstimateMatchTypeSchema, EstimateNutrientsSchema } from './estimate.js';

// ---------------------------------------------------------------------------
// RecipeIngredientInputSchema
// One ingredient in structured mode: either foodId OR name (not both), plus grams.
// ---------------------------------------------------------------------------

export const RecipeIngredientInputSchema = z
  .object({
    foodId: z.string().uuid().optional(),
    name: z.string().min(1).max(255).optional(),
    grams: z.number().positive().max(5000),
    portionMultiplier: z.number().min(0.1).max(5.0).default(1.0),
  })
  .refine(
    (data) => {
      const hasFoodId = data.foodId !== undefined;
      const hasName = data.name !== undefined;
      // Exactly one of foodId or name must be provided
      return hasFoodId !== hasName;
    },
    {
      message: 'Exactly one of foodId or name must be provided (not both, not neither)',
      path: ['foodId'],
    },
  );

export type RecipeIngredientInput = z.infer<typeof RecipeIngredientInputSchema>;

// ---------------------------------------------------------------------------
// RecipeCalculateBodySchema — discriminated union on mode
// ---------------------------------------------------------------------------

const StructuredBodySchema = z.object({
  mode: z.literal('structured'),
  ingredients: z.array(RecipeIngredientInputSchema).min(1).max(50),
});

const FreeFormBodySchema = z.object({
  mode: z.literal('free-form'),
  text: z.string().min(1).max(2000),
});

export const RecipeCalculateBodySchema = z.discriminatedUnion('mode', [
  StructuredBodySchema,
  FreeFormBodySchema,
]);

export type RecipeCalculateBody = z.infer<typeof RecipeCalculateBodySchema>;

// ---------------------------------------------------------------------------
// ParsedIngredientSchema — one LLM-parsed ingredient
// ---------------------------------------------------------------------------

export const ParsedIngredientSchema = z.object({
  name: z.string().min(1).max(255),
  grams: z.number().positive(),
  portionMultiplier: z.number().min(0.1).max(5.0).default(1.0),
});

export type ParsedIngredient = z.infer<typeof ParsedIngredientSchema>;

// ---------------------------------------------------------------------------
// LlmParseOutputSchema — validates raw LLM JSON output (1–50 items)
// ---------------------------------------------------------------------------

export const LlmParseOutputSchema = z.array(ParsedIngredientSchema).min(1).max(50);

export type LlmParseOutput = z.infer<typeof LlmParseOutputSchema>;

// ---------------------------------------------------------------------------
// ResolvedAsSchema — the entity that was matched for a resolved ingredient
// ---------------------------------------------------------------------------

export const ResolvedAsSchema = z.object({
  entityId: z.string().uuid(),
  name: z.string(),
  nameEs: z.string().nullable(),
  matchType: EstimateMatchTypeSchema,
});

export type ResolvedAs = z.infer<typeof ResolvedAsSchema>;

// ---------------------------------------------------------------------------
// RecipeNutrientsSchema — same 14 fields as EstimateNutrients but nullable fields
// For per-ingredient and total, some nutrients may be null (no data for any resolved ingredient).
// ---------------------------------------------------------------------------

export const RecipeNutrientsSchema = z.object({
  calories: z.number().nonnegative().nullable(),
  proteins: z.number().nonnegative().nullable(),
  carbohydrates: z.number().nonnegative().nullable(),
  sugars: z.number().nonnegative().nullable(),
  fats: z.number().nonnegative().nullable(),
  saturatedFats: z.number().nonnegative().nullable(),
  fiber: z.number().nonnegative().nullable(),
  salt: z.number().nonnegative().nullable(),
  sodium: z.number().nonnegative().nullable(),
  transFats: z.number().nonnegative().nullable(),
  cholesterol: z.number().nonnegative().nullable(),
  potassium: z.number().nonnegative().nullable(),
  monounsaturatedFats: z.number().nonnegative().nullable(),
  polyunsaturatedFats: z.number().nonnegative().nullable(),
  referenceBasis: NutrientReferenceBasisSchema,
});

export type RecipeNutrients = z.infer<typeof RecipeNutrientsSchema>;

// ---------------------------------------------------------------------------
// ResolvedIngredientSchema — per-ingredient response item
// ---------------------------------------------------------------------------

export const RecipeIngredientDisplaySchema = z.object({
  foodId: z.string().uuid().nullable(),
  name: z.string().nullable(),
  grams: z.number().positive(),
  portionMultiplier: z.number().min(0.1).max(5.0),
});

export const ResolvedIngredientSchema = z.object({
  input: RecipeIngredientDisplaySchema,
  resolved: z.boolean(),
  resolvedAs: ResolvedAsSchema.nullable(),
  nutrients: RecipeNutrientsSchema.nullable(),
});

export type ResolvedIngredient = z.infer<typeof ResolvedIngredientSchema>;

// ---------------------------------------------------------------------------
// RecipeCalculateDataSchema — full response data payload
// ---------------------------------------------------------------------------

export const RecipeCalculateDataSchema = z.object({
  mode: z.enum(['structured', 'free-form']),
  resolvedCount: z.number().int().nonnegative(),
  unresolvedCount: z.number().int().nonnegative(),
  confidenceLevel: ConfidenceLevelSchema,
  totalNutrients: RecipeNutrientsSchema,
  ingredients: z.array(ResolvedIngredientSchema),
  unresolvedIngredients: z.array(z.string()),
  /** Present only in free-form mode — the LLM-extracted ingredient list */
  parsedIngredients: z.array(ParsedIngredientSchema).optional(),
  cachedAt: z.string().nullable(),
});

export type RecipeCalculateData = z.infer<typeof RecipeCalculateDataSchema>;

// ---------------------------------------------------------------------------
// RecipeCalculateResponseSchema — API response envelope
// ---------------------------------------------------------------------------

export const RecipeCalculateResponseSchema = z.object({
  success: z.literal(true),
  data: RecipeCalculateDataSchema,
});

export type RecipeCalculateResponse = z.infer<typeof RecipeCalculateResponseSchema>;

// Re-export NutrientReferenceBasisSchema usage to avoid import issues in consumers
export { EstimateNutrientsSchema };
