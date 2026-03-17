// Internal TypeScript types for the embedding pipeline.
//
// These are NOT Zod schemas — they are typed query-result shapes for internal use only.
// FoodRowRaw / DishRowRaw reflect the exact PostgreSQL column names returned by $queryRaw
// (snake_case). The mapped types (FoodForEmbedding / DishForEmbedding) use camelCase
// and have Decimal strings parsed to numbers.

import type { EmbeddingTarget } from '@foodxplorer/shared';
import type { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Raw query result types (snake_case, matching PostgreSQL columns exactly)
// ---------------------------------------------------------------------------

export interface FoodRowRaw {
  id: string;
  name: string;
  name_es: string;                // NOT NULL in schema
  food_group: string | null;
  food_type: string;              // enum: generic/branded/composite
  calories: string | null;        // Decimal(8,2) → string from $queryRaw
  proteins: string | null;
  carbohydrates: string | null;
  sugars: string | null;
  fats: string | null;
  saturated_fats: string | null;
  fiber: string | null;
  sodium: string | null;
}

export interface DishRowRaw {
  id: string;
  name: string;
  name_es: string | null;           // nullable in schema
  chain_slug: string;
  portion_grams: string | null;     // Decimal(8,2) → string, nullable
  category_slugs: string | null;    // STRING_AGG from junction table
  cooking_method_slugs: string | null; // STRING_AGG from junction table
  calories: string | null;          // Decimal(8,2) → string from $queryRaw
  proteins: string | null;
  carbohydrates: string | null;
  sugars: string | null;
  fats: string | null;
  saturated_fats: string | null;
  fiber: string | null;
  sodium: string | null;
}

// ---------------------------------------------------------------------------
// Mapped domain types (camelCase, numbers parsed from Decimal strings)
// ---------------------------------------------------------------------------

export interface FoodForEmbedding {
  id: string;
  name: string;
  nameEs: string;
  foodGroup: string | null;
  foodType: string;
  calories: number | null;
  proteins: number | null;
  carbohydrates: number | null;
  sugars: number | null;
  fats: number | null;
  saturatedFats: number | null;
  fiber: number | null;
  sodium: number | null;
}

export interface DishForEmbedding {
  id: string;
  name: string;
  nameEs: string | null;
  chainSlug: string;
  portionGrams: number | null;
  categorySlugs: string[];
  cookingMethodSlugs: string[];
  calories: number | null;
  proteins: number | null;
  carbohydrates: number | null;
  sugars: number | null;
  fats: number | null;
  saturatedFats: number | null;
  fiber: number | null;
  sodium: number | null;
}

// ---------------------------------------------------------------------------
// Pipeline options
// ---------------------------------------------------------------------------

export interface EmbeddingPipelineOptions {
  target: EmbeddingTarget;
  chainSlug?: string;
  batchSize: number;
  force: boolean;
  dryRun: boolean;
  prisma: PrismaClient;
  openaiApiKey: string;
  embeddingModel: string;
  embeddingRpm: number;
}

// ---------------------------------------------------------------------------
// Mapping functions — snake_case raw rows → camelCase domain types
// ---------------------------------------------------------------------------

function parseDecimal(value: string | null): number | null {
  if (value === null) return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

export function mapFoodRow(raw: FoodRowRaw): FoodForEmbedding {
  return {
    id: raw.id,
    name: raw.name,
    nameEs: raw.name_es,
    foodGroup: raw.food_group,
    foodType: raw.food_type,
    calories: parseDecimal(raw.calories),
    proteins: parseDecimal(raw.proteins),
    carbohydrates: parseDecimal(raw.carbohydrates),
    sugars: parseDecimal(raw.sugars),
    fats: parseDecimal(raw.fats),
    saturatedFats: parseDecimal(raw.saturated_fats),
    fiber: parseDecimal(raw.fiber),
    sodium: parseDecimal(raw.sodium),
  };
}

export function mapDishRow(raw: DishRowRaw): DishForEmbedding {
  return {
    id: raw.id,
    name: raw.name,
    nameEs: raw.name_es,
    chainSlug: raw.chain_slug,
    portionGrams: parseDecimal(raw.portion_grams),
    categorySlugs: raw.category_slugs !== null ? raw.category_slugs.split(',') : [],
    cookingMethodSlugs: raw.cooking_method_slugs !== null ? raw.cooking_method_slugs.split(',') : [],
    calories: parseDecimal(raw.calories),
    proteins: parseDecimal(raw.proteins),
    carbohydrates: parseDecimal(raw.carbohydrates),
    sugars: parseDecimal(raw.sugars),
    fats: parseDecimal(raw.fats),
    saturatedFats: parseDecimal(raw.saturated_fats),
    fiber: parseDecimal(raw.fiber),
    sodium: parseDecimal(raw.sodium),
  };
}
