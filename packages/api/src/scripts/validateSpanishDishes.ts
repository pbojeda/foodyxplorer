/**
 * F073 — Spanish Canonical Dishes seed data validation.
 * Pure function, no DB dependencies.
 */

import type { SpanishDishEntry } from './spanishDishesTypes.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const VALID_SOURCES = new Set(['bedca', 'recipe']);
const NUTRIENT_FIELDS = [
  'calories', 'proteins', 'carbohydrates', 'sugars',
  'fats', 'saturatedFats', 'fiber', 'salt', 'sodium',
] as const;

export function validateSpanishDishes(dishes: SpanishDishEntry[]): ValidationResult {
  const errors: string[] = [];
  let hasBlockingError = false;

  // Minimum count
  if (dishes.length < 250) {
    errors.push(`Dataset must contain at least 250 entries, got ${dishes.length}`);
    hasBlockingError = true;
  }

  // Uniqueness checks
  const seenExternalIds = new Set<string>();
  const seenDishIds = new Set<string>();
  const seenNutrientIds = new Set<string>();

  for (let i = 0; i < dishes.length; i++) {
    const entry = dishes[i]!;
    const prefix = `[${i}] ${entry.externalId}`;

    // Duplicate externalId
    if (seenExternalIds.has(entry.externalId)) {
      errors.push(`${prefix}: Duplicate externalId "${entry.externalId}"`);
      hasBlockingError = true;
    }
    seenExternalIds.add(entry.externalId);

    // Duplicate dishId
    if (seenDishIds.has(entry.dishId)) {
      errors.push(`${prefix}: Duplicate dishId "${entry.dishId}"`);
      hasBlockingError = true;
    }
    seenDishIds.add(entry.dishId);

    // Duplicate nutrientId
    if (seenNutrientIds.has(entry.nutrientId)) {
      errors.push(`${prefix}: Duplicate nutrientId "${entry.nutrientId}"`);
      hasBlockingError = true;
    }
    seenNutrientIds.add(entry.nutrientId);

    // Required string fields
    if (!entry.name || entry.name.trim().length === 0) {
      errors.push(`${prefix}: Missing or empty name`);
      hasBlockingError = true;
    }
    if (!entry.nameEs || entry.nameEs.trim().length === 0) {
      errors.push(`${prefix}: Missing or empty nameEs`);
      hasBlockingError = true;
    }

    // Source validation
    if (!VALID_SOURCES.has(entry.source)) {
      errors.push(`${prefix}: Invalid source "${entry.source}", must be "bedca" or "recipe"`);
      hasBlockingError = true;
    }

    // Portion grams range
    if (entry.portionGrams < 10 || entry.portionGrams > 800) {
      errors.push(`${prefix}: portionGrams ${entry.portionGrams} out of range [10, 800]`);
      hasBlockingError = true;
    }

    // Nutrient validation
    for (const field of NUTRIENT_FIELDS) {
      const value = entry.nutrients[field];
      if (typeof value !== 'number' || value < 0) {
        errors.push(`${prefix}: negative or missing nutrient "${field}" = ${value}`);
        hasBlockingError = true;
      }
    }

    // Calorie limits
    if (entry.nutrients.calories > 3000) {
      errors.push(`${prefix}: calories ${entry.nutrients.calories} exceeds 3000 per serving`);
      hasBlockingError = true;
    } else if (entry.nutrients.calories > 2000) {
      errors.push(`[WARN] ${prefix}: high calories ${entry.nutrients.calories} per serving (>2000)`);
    }
  }

  return {
    valid: !hasBlockingError,
    errors,
  };
}
