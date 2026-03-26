// aggregateNutrients — pure function for recipe nutrient aggregation (F035).
//
// Formula per ingredient:
//   ingredient_nutrient = food_nutrient_per_100g * grams / 100 * portionMultiplier
//
// Null handling:
//   - If a nutrient is null for a specific ingredient → treat as 0 when summing
//     with non-null values; but store null for that ingredient's per-ingredient entry.
//   - If a nutrient is null for ALL resolved ingredients → return null for that
//     nutrient in both per-ingredient and totals (not 0).
//
// Rounding:
//   - Per-ingredient values are rounded to 2 decimal places (half-up) first.
//   - Totals = sum of already-rounded per-ingredient values.

import type { FoodQueryRow } from '../estimation/types.js';
import type { RecipeNutrients } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolvedIngredientForAggregation {
  grams: number;
  portionMultiplier: number;
  nutrientRow: FoodQueryRow;
}

// ---------------------------------------------------------------------------
// Constants — the 14 nutrient keys
// ---------------------------------------------------------------------------

const NUTRIENT_KEYS = [
  'calories',
  'proteins',
  'carbohydrates',
  'sugars',
  'fats',
  'saturated_fats',
  'fiber',
  'salt',
  'sodium',
  'trans_fats',
  'cholesterol',
  'potassium',
  'monounsaturated_fats',
  'polyunsaturated_fats',
] as const;

type NutrientKey = (typeof NUTRIENT_KEYS)[number];

// Mapping from DB column name to RecipeNutrients camelCase key
const KEY_MAP: Record<NutrientKey, keyof Omit<RecipeNutrients, 'referenceBasis'>> = {
  calories: 'calories',
  proteins: 'proteins',
  carbohydrates: 'carbohydrates',
  sugars: 'sugars',
  fats: 'fats',
  saturated_fats: 'saturatedFats',
  fiber: 'fiber',
  salt: 'salt',
  sodium: 'sodium',
  trans_fats: 'transFats',
  cholesterol: 'cholesterol',
  potassium: 'potassium',
  monounsaturated_fats: 'monounsaturatedFats',
  polyunsaturated_fats: 'polyunsaturatedFats',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundHalfUp(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseNullable(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

// ---------------------------------------------------------------------------
// aggregateNutrients
// ---------------------------------------------------------------------------

export function aggregateNutrients(
  ingredients: ResolvedIngredientForAggregation[],
): { perIngredient: RecipeNutrients[]; totals: RecipeNutrients } {
  if (ingredients.length === 0) {
    const zeroNutrients: RecipeNutrients = {
      calories: 0,
      proteins: 0,
      carbohydrates: 0,
      sugars: 0,
      fats: 0,
      saturatedFats: 0,
      fiber: 0,
      salt: 0,
      sodium: 0,
      transFats: 0,
      cholesterol: 0,
      potassium: 0,
      monounsaturatedFats: 0,
      polyunsaturatedFats: 0,
      referenceBasis: 'per_serving',
    };
    return { perIngredient: [], totals: zeroNutrients };
  }

  // Step 1: Compute per-ingredient scaled (raw, pre-rounding) and track null status per key
  // perRaw[i][key] = number | null (null if row value was null)
  const perRaw: Array<Partial<Record<NutrientKey, number | null>>> = ingredients.map((ing) => {
    const factor = (ing.grams / 100) * ing.portionMultiplier;
    const row: Partial<Record<NutrientKey, number | null>> = {};

    for (const key of NUTRIENT_KEYS) {
      const rawValue = parseNullable(ing.nutrientRow[key]);
      row[key] = rawValue === null ? null : rawValue * factor;
    }

    return row;
  });

  // Step 2: For each nutrient key, determine if ALL ingredients have null
  const allNull: Record<NutrientKey, boolean> = {} as Record<NutrientKey, boolean>;
  for (const key of NUTRIENT_KEYS) {
    allNull[key] = perRaw.every((row) => row[key] === null);
  }

  // Step 3: Build per-ingredient RecipeNutrients with rounding applied
  const perIngredient: RecipeNutrients[] = perRaw.map((row) => {
    const nutrients: RecipeNutrients = {
      calories: null,
      proteins: null,
      carbohydrates: null,
      sugars: null,
      fats: null,
      saturatedFats: null,
      fiber: null,
      salt: null,
      sodium: null,
      transFats: null,
      cholesterol: null,
      potassium: null,
      monounsaturatedFats: null,
      polyunsaturatedFats: null,
      referenceBasis: 'per_serving',
    };

    for (const key of NUTRIENT_KEYS) {
      const camelKey = KEY_MAP[key];
      const rawValue = row[key];

      if (rawValue === null || rawValue === undefined) {
        // Keep null — the row had no data for this nutrient
        nutrients[camelKey] = null;
      } else {
        nutrients[camelKey] = roundHalfUp(rawValue);
      }
    }

    return nutrients;
  });

  // Step 4: Compute totals by summing already-rounded per-ingredient values
  // - If allNull[key] → total is null
  // - Otherwise → sum of non-null rounded values (null treated as 0)
  const totals: RecipeNutrients = {
    calories: null,
    proteins: null,
    carbohydrates: null,
    sugars: null,
    fats: null,
    saturatedFats: null,
    fiber: null,
    salt: null,
    sodium: null,
    transFats: null,
    cholesterol: null,
    potassium: null,
    monounsaturatedFats: null,
    polyunsaturatedFats: null,
    referenceBasis: 'per_serving',
  };

  for (const key of NUTRIENT_KEYS) {
    const camelKey = KEY_MAP[key];

    if (allNull[key]) {
      totals[camelKey] = null;
    } else {
      // Sum the rounded per-ingredient values; treat null as 0
      let sum = 0;
      for (const ing of perIngredient) {
        const val = ing[camelKey];
        if (val !== null) {
          sum += val;
        }
      }
      totals[camelKey] = roundHalfUp(sum);
    }
  }

  return { perIngredient, totals };
}
