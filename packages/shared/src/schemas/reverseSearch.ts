// Zod schemas for F086 — Reverse Search (calorie/protein constraint filtering).
//
// ReverseSearchQuerySchema   — query params for GET /reverse-search
// ReverseSearchResultSchema  — single dish result with macros + proteinDensity
// ReverseSearchDataSchema    — full response data payload

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

export const ReverseSearchQuerySchema = z.object({
  chainSlug: z.string().regex(/^[a-z0-9-]+$/).max(100),
  maxCalories: z.coerce.number().min(100).max(3000),
  minProtein: z.coerce.number().min(0).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

export type ReverseSearchQuery = z.infer<typeof ReverseSearchQuerySchema>;

// ---------------------------------------------------------------------------
// Single result — dish matching constraints
// ---------------------------------------------------------------------------

export const ReverseSearchResultSchema = z.object({
  name: z.string(),
  nameEs: z.string().nullable(),
  calories: z.number().nonnegative(),
  proteins: z.number().nonnegative(),
  fats: z.number().nonnegative(),
  carbohydrates: z.number().nonnegative(),
  portionGrams: z.number().positive().nullable(),
  proteinDensity: z.number().nonnegative(),
});

export type ReverseSearchResult = z.infer<typeof ReverseSearchResultSchema>;

// ---------------------------------------------------------------------------
// Data payload — full response body data
// ---------------------------------------------------------------------------

export const ReverseSearchDataSchema = z.object({
  chainSlug: z.string(),
  chainName: z.string(),
  maxCalories: z.number(),
  minProtein: z.number().nullable(),
  results: z.array(ReverseSearchResultSchema),
  totalMatches: z.number().int().nonnegative(),
});

export type ReverseSearchData = z.infer<typeof ReverseSearchDataSchema>;
