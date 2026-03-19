// Internal TypeScript types for the Estimation Engine (E003).
//
// Level1LookupOptions   — input to level1Lookup()
// Level1Result          — output of level1Lookup(), includes matchType + EstimateResult
// Level2LookupOptions   — input to level2Lookup()
// Level2Result          — output of level2Lookup(), includes matchType + EstimateResult + resolution counts
// Level3LookupOptions   — input to level3Lookup()
// Level3Result          — output of level3Lookup(), includes matchType + EstimateResult + similarityDistance
// DishQueryRow          — shape of a Kysely dish-strategy result row (before mapping)
// FoodQueryRow          — shape of a Kysely food-strategy result row (before mapping)
// DishSimilarityRow     — shape of a Kysely dish similarity search row
// FoodSimilarityRow     — shape of a Kysely food similarity search row
// IngredientNutrientRow — shape of a Kysely aggregating query row (Level 2)
// Mapping functions     — mapDishRowToResult, mapFoodRowToResult, mapLevel2RowToResult

import type {
  EstimateMatchType,
  EstimateResult,
  EstimateSource,
  EstimateNutrients,
} from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Lookup options
// ---------------------------------------------------------------------------

export interface Level1LookupOptions {
  chainSlug?: string;
  restaurantId?: string;
}

/**
 * Decoupled from Level1LookupOptions so F023 can evolve them independently.
 * Structurally identical for now.
 */
export interface Level2LookupOptions {
  chainSlug?: string;
  restaurantId?: string;
}

export interface Level3LookupOptions {
  chainSlug?: string;
  restaurantId?: string;
  /** Cosine distance threshold — matches below this value are returned. Default: 0.5. */
  threshold?: number;
  /** Pass undefined to skip Level 3 gracefully (no OpenAI call). */
  openAiApiKey: string | undefined;
}

// ---------------------------------------------------------------------------
// Level 1 result
// ---------------------------------------------------------------------------

export interface Level1Result {
  matchType: EstimateMatchType;
  result: EstimateResult;
}

// ---------------------------------------------------------------------------
// Level 2 result
// ---------------------------------------------------------------------------

export interface Level2Result {
  matchType: EstimateMatchType;
  result: EstimateResult;
  resolvedCount: number;
  totalCount: number;
  /** Food UUIDs that contributed to the aggregation. Empty in F021; F023 will populate. */
  ingredientSources: string[];
}

// ---------------------------------------------------------------------------
// Level 3 result
// ---------------------------------------------------------------------------

export interface Level3Result {
  matchType: EstimateMatchType;
  result: EstimateResult;
  /** Cosine distance of the winning match in [0.0, 2.0). */
  similarityDistance: number;
}

// ---------------------------------------------------------------------------
// Raw row shapes returned from Kysely queries
// ---------------------------------------------------------------------------

/**
 * Columns selected for dish strategies (strategy 1 + 2).
 * Decimal columns come back as strings from PostgreSQL via pg driver.
 */
export interface DishQueryRow {
  // dish columns
  dish_id: string;
  dish_name: string;
  dish_name_es: string | null;
  restaurant_id: string;
  chain_slug: string;
  portion_grams: string | null;
  // dish_nutrients columns
  calories: string;
  proteins: string;
  carbohydrates: string;
  sugars: string;
  fats: string;
  saturated_fats: string;
  fiber: string;
  salt: string;
  sodium: string;
  trans_fats: string;
  cholesterol: string;
  potassium: string;
  monounsaturated_fats: string;
  polyunsaturated_fats: string;
  reference_basis: string;
  // data_sources columns
  source_id: string;
  source_name: string;
  source_type: string;
  source_url: string | null;
}

/**
 * Columns selected for food strategies (strategy 3 + 4).
 */
export interface FoodQueryRow {
  // food columns
  food_id: string;
  food_name: string;
  food_name_es: string | null;
  // food_nutrients columns
  calories: string;
  proteins: string;
  carbohydrates: string;
  sugars: string;
  fats: string;
  saturated_fats: string;
  fiber: string;
  salt: string;
  sodium: string;
  trans_fats: string;
  cholesterol: string;
  potassium: string;
  monounsaturated_fats: string;
  polyunsaturated_fats: string;
  reference_basis: string;
  // data_sources columns
  source_id: string;
  source_name: string;
  source_type: string;
  source_url: string | null;
}

/**
 * Columns returned by the Level 2 aggregating query.
 * Dish identity + aggregated nutrient sums + resolution counts.
 *
 * Nutrient columns come back as string because:
 * - SUM(CASE ... ELSE 0 END) guarantees non-NULL results
 * - HAVING clause ensures ≥1 resolved ingredient (i.e., rows always have data)
 */
export interface IngredientNutrientRow {
  // dish columns
  dish_id: string;
  dish_name: string;
  dish_name_es: string | null;
  restaurant_id: string;
  chain_slug: string;
  portion_grams: string | null;
  dish_source_id: string;
  // resolution counts (cast to text in SQL)
  resolved_count: string;
  total_count: string;
  // aggregated nutrient totals (SUM * gram_weight / 100), cast to text
  calories: string;
  proteins: string;
  carbohydrates: string;
  sugars: string;
  fats: string;
  saturated_fats: string;
  fiber: string;
  salt: string;
  sodium: string;
  trans_fats: string;
  cholesterol: string;
  potassium: string;
  monounsaturated_fats: string;
  polyunsaturated_fats: string;
}

/** Raw row from the dish similarity search query (distance only — no nutrients). */
export interface DishSimilarityRow {
  dish_id: string;
  /** Float returned as string by the pg driver. */
  distance: string;
}

/** Raw row from the food similarity search query (distance only — no nutrients). */
export interface FoodSimilarityRow {
  food_id: string;
  /** Float returned as string by the pg driver. */
  distance: string;
}

// ---------------------------------------------------------------------------
// parseDecimal helper
// ---------------------------------------------------------------------------

/**
 * Parse a Decimal(8,2) string from PostgreSQL to a JS number.
 * Returns 0 if the value is null or not parseable.
 */
export function parseDecimal(value: string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

// ---------------------------------------------------------------------------
// Mapping functions
// ---------------------------------------------------------------------------

function mapSource(row: { source_id: string; source_name: string; source_type: string; source_url: string | null }): EstimateSource {
  return {
    id: row.source_id,
    name: row.source_name,
    type: row.source_type as EstimateSource['type'],
    url: row.source_url,
  };
}

function mapNutrients(row: {
  calories: string;
  proteins: string;
  carbohydrates: string;
  sugars: string;
  fats: string;
  saturated_fats: string;
  fiber: string;
  salt: string;
  sodium: string;
  trans_fats: string;
  cholesterol: string;
  potassium: string;
  monounsaturated_fats: string;
  polyunsaturated_fats: string;
  reference_basis: string;
}): EstimateNutrients {
  return {
    calories: parseDecimal(row.calories),
    proteins: parseDecimal(row.proteins),
    carbohydrates: parseDecimal(row.carbohydrates),
    sugars: parseDecimal(row.sugars),
    fats: parseDecimal(row.fats),
    saturatedFats: parseDecimal(row.saturated_fats),
    fiber: parseDecimal(row.fiber),
    salt: parseDecimal(row.salt),
    sodium: parseDecimal(row.sodium),
    transFats: parseDecimal(row.trans_fats),
    cholesterol: parseDecimal(row.cholesterol),
    potassium: parseDecimal(row.potassium),
    monounsaturatedFats: parseDecimal(row.monounsaturated_fats),
    polyunsaturatedFats: parseDecimal(row.polyunsaturated_fats),
    referenceBasis: row.reference_basis as EstimateNutrients['referenceBasis'],
  };
}

/**
 * Map a Kysely dish strategy result row to an EstimateResult.
 * Sets confidenceLevel='high', estimationMethod='official' (ADR-001).
 */
export function mapDishRowToResult(row: DishQueryRow): EstimateResult {
  const grams = parseDecimal(row.portion_grams);
  return {
    entityType: 'dish',
    entityId: row.dish_id,
    name: row.dish_name,
    nameEs: row.dish_name_es,
    restaurantId: row.restaurant_id,
    chainSlug: row.chain_slug,
    portionGrams: grams > 0 ? grams : null,
    nutrients: mapNutrients(row),
    confidenceLevel: 'high',
    estimationMethod: 'official',
    source: mapSource(row),
    similarityDistance: null,
  };
}

/**
 * Map a Kysely food strategy result row to an EstimateResult.
 * Foods have no portion_grams → portionGrams: null.
 * Sets confidenceLevel='high', estimationMethod='official' (ADR-001).
 */
export function mapFoodRowToResult(row: FoodQueryRow): EstimateResult {
  return {
    entityType: 'food',
    entityId: row.food_id,
    name: row.food_name,
    nameEs: row.food_name_es,
    restaurantId: null,
    chainSlug: null,
    portionGrams: null,
    nutrients: mapNutrients(row),
    confidenceLevel: 'high',
    estimationMethod: 'official',
    source: mapSource(row),
    similarityDistance: null,
  };
}

/**
 * Map a Level 2 aggregating query row to a structured result object.
 *
 * Does NOT use mapNutrients (row lacks reference_basis column — L2 hardcodes per_serving).
 * Does NOT use mapSource (source is synthetic — hardcoded name/type, url is null).
 * Uses parseDecimal directly for each nutrient field.
 *
 * confidence: resolved/total = 1.0 → 'medium', partial → 'low'
 */
export function mapLevel2RowToResult(row: IngredientNutrientRow): {
  result: EstimateResult;
  resolvedCount: number;
  totalCount: number;
} {
  const resolvedCount = parseInt(row.resolved_count, 10);
  const totalCount = parseInt(row.total_count, 10);
  const grams = parseDecimal(row.portion_grams);

  const confidenceLevel = resolvedCount === totalCount ? 'medium' as const : 'low' as const;

  const result: EstimateResult = {
    entityType: 'dish',
    entityId: row.dish_id,
    name: row.dish_name,
    nameEs: row.dish_name_es,
    restaurantId: row.restaurant_id,
    chainSlug: row.chain_slug,
    portionGrams: grams > 0 ? grams : null,
    nutrients: {
      calories: parseDecimal(row.calories),
      proteins: parseDecimal(row.proteins),
      carbohydrates: parseDecimal(row.carbohydrates),
      sugars: parseDecimal(row.sugars),
      fats: parseDecimal(row.fats),
      saturatedFats: parseDecimal(row.saturated_fats),
      fiber: parseDecimal(row.fiber),
      salt: parseDecimal(row.salt),
      sodium: parseDecimal(row.sodium),
      transFats: parseDecimal(row.trans_fats),
      cholesterol: parseDecimal(row.cholesterol),
      potassium: parseDecimal(row.potassium),
      monounsaturatedFats: parseDecimal(row.monounsaturated_fats),
      polyunsaturatedFats: parseDecimal(row.polyunsaturated_fats),
      referenceBasis: 'per_serving',
    },
    confidenceLevel,
    estimationMethod: 'ingredients',
    source: {
      id: row.dish_source_id,
      name: 'Computed from ingredients',
      type: 'estimated',
      url: null,
    },
    similarityDistance: null,
  };

  return { result, resolvedCount, totalCount };
}
