// Pure validation functions for USDA SR Legacy seed data.
// No DB dependency — unit-testable in isolation.

import type { UsdaSrLegacyFoodEntry, NameEsMap } from './types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const CORE_NUTRIENT_FIELDS = [
  'calories',
  'proteins',
  'carbohydrates',
  'sugars',
  'fats',
  'saturatedFats',
  'fiber',
  'sodium',
  'salt',
] as const;

/**
 * Validates the curated USDA SR Legacy foods array and name-es translation map.
 * Collects all errors in a single pass (does not short-circuit).
 * Returns valid:true only when there are zero blocking errors.
 * [WARN] entries in the errors array are non-blocking (calories > 900).
 */
export function validateSeedData(
  foods: UsdaSrLegacyFoodEntry[],
  nameEsMap: NameEsMap,
): ValidationResult {
  const errors: string[] = [];

  // 1. Minimum count
  if (foods.length < 500) {
    errors.push(
      `Minimum 500 foods required, found ${foods.length}`,
    );
  }

  // 2. Duplicate fdcIds
  const seenIds = new Set<number>();
  const duplicates = new Set<number>();
  for (const food of foods) {
    if (seenIds.has(food.fdcId)) {
      duplicates.add(food.fdcId);
    }
    seenIds.add(food.fdcId);
  }
  if (duplicates.size > 0) {
    errors.push(
      `Duplicate fdcIds found: ${[...duplicates].join(', ')}`,
    );
  }

  // 3. Missing/invalid Spanish names + required nutrient fields + calorie warnings + negative nutrients
  const missingNames: number[] = [];
  for (const food of foods) {
    // Missing or invalid Spanish name (undefined, empty, or whitespace-only)
    const nameEs = nameEsMap[String(food.fdcId)];
    if (nameEs === undefined || nameEs.trim() === '') {
      missingNames.push(food.fdcId);
    }

    // Required nutrient fields (present and not undefined)
    for (const field of CORE_NUTRIENT_FIELDS) {
      if (food.nutrients[field] === undefined) {
        errors.push(
          `fdcId ${food.fdcId}: missing required nutrient field "${field}"`,
        );
      }
    }

    // Negative nutrient values (violate DB CHECK constraints and Zod nonnegative schema)
    const allNutrientFields = [
      'calories',
      'proteins',
      'carbohydrates',
      'sugars',
      'fats',
      'saturatedFats',
      'fiber',
      'sodium',
      'salt',
      'transFats',
      'cholesterol',
      'potassium',
      'monounsaturatedFats',
      'polyunsaturatedFats',
    ] as const;
    for (const field of allNutrientFields) {
      const value = food.nutrients[field];
      if (typeof value === 'number' && value < 0) {
        errors.push(
          `fdcId ${food.fdcId}: nutrient field "${field}" has negative value ${value} (must be >= 0)`,
        );
      }
    }

    // Calorie warning (non-blocking) — calories > 900 would violate DB CHECK constraint
    if (food.nutrients.calories > 900) {
      errors.push(
        `[WARN] fdcId ${food.fdcId} (${food.description}): calories ${food.nutrients.calories} > 900 (likely data error)`,
      );
    }
  }

  if (missingNames.length > 0) {
    errors.push(
      `Missing Spanish names for fdcIds: ${missingNames.join(', ')}`,
    );
  }

  // Determine validity: invalid if any error that is NOT a [WARN]
  const blockingErrors = errors.filter((e) => !e.startsWith('[WARN]'));
  return {
    valid: blockingErrors.length === 0,
    errors,
  };
}

/** Returns the externalId string for a USDA SR Legacy food. */
export function buildExternalId(fdcId: number): string {
  return `USDA-SR-${fdcId}`;
}

/** Computes salt (g) from sodium (g). */
export function computeSalt(sodiumGrams: number): number {
  return sodiumGrams * 2.54;
}
