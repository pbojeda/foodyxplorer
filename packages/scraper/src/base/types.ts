// Scraper-internal Zod schemas and derived TypeScript types.
//
// These schemas are NOT exported from packages/shared — they are implementation
// details of the scraper pipeline. Consumers outside packages/scraper should not
// depend on these types directly.

import { z } from 'zod';
import {
  ConfidenceLevelSchema,
  EstimationMethodSchema,
  DishAvailabilitySchema,
  NutrientReferenceBasisSchema,
} from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// 4.1 RawDishData — output of a chain scraper's page extraction
// ---------------------------------------------------------------------------

export const RawDishDataSchema = z.object({
  // Identity
  externalId: z.string().max(100).optional(),
  name: z.string().min(1).max(255),
  nameEs: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  aliases: z.array(z.string()).default([]),

  // Pricing and portioning
  portionGrams: z.number().positive().optional(),
  priceEur: z.number().nonnegative().optional(),

  // Raw nutrient values — all in the unit reported by the chain.
  // All fields are optional; absent means not disclosed by the chain.
  // Values may be numbers OR strings (e.g. "<1", "tr") — coercion
  // happens in normalizeNutrients(), not here in the schema.
  nutrients: z.object({
    calories: z.union([z.number(), z.string()]).optional(),
    proteins: z.union([z.number(), z.string()]).optional(),
    carbohydrates: z.union([z.number(), z.string()]).optional(),
    sugars: z.union([z.number(), z.string()]).optional(),
    fats: z.union([z.number(), z.string()]).optional(),
    saturatedFats: z.union([z.number(), z.string()]).optional(),
    fiber: z.union([z.number(), z.string()]).optional(),
    salt: z.union([z.number(), z.string()]).optional(),
    sodium: z.union([z.number(), z.string()]).optional(),
    transFats: z.union([z.number(), z.string()]).optional(),
    cholesterol: z.union([z.number(), z.string()]).optional(),
    potassium: z.union([z.number(), z.string()]).optional(),
    monounsaturatedFats: z.union([z.number(), z.string()]).optional(),
    polyunsaturatedFats: z.union([z.number(), z.string()]).optional(),
    extra: z.record(z.string(), z.number()).optional(),
  }),

  // Scraper metadata
  sourceUrl: z.string().url(),
  scrapedAt: z.string().datetime(),
});

export type RawDishData = z.infer<typeof RawDishDataSchema>;

// ---------------------------------------------------------------------------
// 4.2 NormalizedDishData — after normalization, ready for persistence
// ---------------------------------------------------------------------------

export const NormalizedDishDataSchema = z.object({
  // Dish fields matching CreateDishSchema from packages/shared
  name: z.string().min(1).max(255),
  nameEs: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  externalId: z.string().max(100).optional(),
  availability: DishAvailabilitySchema.default('available'),
  portionGrams: z.number().positive().optional(),
  priceEur: z.number().nonnegative().optional(),
  aliases: z.array(z.string()).default([]),

  // Nutrient fields — all values in grams (or kcal for calories), non-negative.
  // Required: calories, proteins, carbohydrates, fats (minimum viable nutrition data).
  nutrients: z.object({
    calories: z.number().nonnegative(),
    proteins: z.number().nonnegative(),
    carbohydrates: z.number().nonnegative(),
    sugars: z.number().nonnegative(),
    fats: z.number().nonnegative(),
    saturatedFats: z.number().nonnegative(),
    fiber: z.number().nonnegative(),
    salt: z.number().nonnegative(),
    sodium: z.number().nonnegative(),
    transFats: z.number().nonnegative().default(0),
    cholesterol: z.number().nonnegative().default(0),
    potassium: z.number().nonnegative().default(0),
    monounsaturatedFats: z.number().nonnegative().default(0),
    polyunsaturatedFats: z.number().nonnegative().default(0),
    referenceBasis: NutrientReferenceBasisSchema.default('per_serving'),
    extra: z.record(z.string(), z.number()).optional(),
  }),

  // Persistence metadata
  confidenceLevel: ConfidenceLevelSchema,
  estimationMethod: EstimationMethodSchema,
  sourceId: z.string().uuid(),
  restaurantId: z.string().uuid(),
});

export type NormalizedDishData = z.infer<typeof NormalizedDishDataSchema>;

// ---------------------------------------------------------------------------
// 4.3 ScraperConfig — per-chain configuration
// ---------------------------------------------------------------------------

export const ScraperConfigSchema = z.object({
  chainSlug: z.string().min(1).max(100),
  restaurantId: z.string().uuid(),
  sourceId: z.string().uuid(),
  baseUrl: z.string().url(),
  startUrls: z.array(z.string().url()).min(1),
  rateLimit: z.object({
    requestsPerMinute: z.number().int().min(1).max(60).default(10),
    concurrency: z.number().int().min(1).max(5).default(1),
  }),
  retryPolicy: z.object({
    maxRetries: z.number().int().min(0).max(5).default(3),
    backoffMs: z.number().int().min(100).default(1000),
    backoffMultiplier: z.number().min(1).max(5).default(2),
  }),
  selectors: z.record(z.string(), z.string()),
  headless: z.boolean().default(true),
  locale: z.string().default('es-ES'),
});

export type ScraperConfig = z.infer<typeof ScraperConfigSchema>;

// Convenience type alias for retry policy (used in withRetry signature)
export type RetryPolicy = ScraperConfig['retryPolicy'];

// ---------------------------------------------------------------------------
// 4.4 ScraperResult — summary returned after a full scraper run
// ---------------------------------------------------------------------------

export const ScraperResultSchema = z.object({
  chainSlug: z.string(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  pagesVisited: z.number().int().nonnegative(),
  dishesFound: z.number().int().nonnegative(),
  dishesUpserted: z.number().int().nonnegative(),
  dishesSkipped: z.number().int().nonnegative(),
  errors: z.array(
    z.object({
      url: z.string(),
      message: z.string(),
      code: z.string(),
    }),
  ),
  status: z.enum(['success', 'partial', 'failed']),
});

export type ScraperResult = z.infer<typeof ScraperResultSchema>;
