// Internal TypeScript types for the Estimation Engine (E003).
//
// Level1LookupOptions — input to level1Lookup()
// Level1Result        — output of level1Lookup(), includes matchType + EstimateResult
// DishQueryRow        — shape of a Kysely dish-strategy result row (before mapping)
// FoodQueryRow        — shape of a Kysely food-strategy result row (before mapping)
// Mapping functions   — mapDishRowToResult, mapFoodRowToResult (Decimal strings → numbers)

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

// ---------------------------------------------------------------------------
// Level 1 result
// ---------------------------------------------------------------------------

export interface Level1Result {
  matchType: EstimateMatchType;
  result: EstimateResult;
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

// ---------------------------------------------------------------------------
// parseDecimal helper
// ---------------------------------------------------------------------------

/**
 * Parse a Decimal(8,2) string from PostgreSQL to a JS number.
 * Returns 0 if the value is null or not parseable.
 */
function parseDecimal(value: string | null | undefined): number {
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
    portionGrams: grams !== null && grams > 0 ? grams : null,
    nutrients: mapNutrients(row),
    confidenceLevel: 'high',
    estimationMethod: 'official',
    source: mapSource(row),
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
  };
}
