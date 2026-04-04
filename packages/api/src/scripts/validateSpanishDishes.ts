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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validateSpanishDishes(dishes: SpanishDishEntry[]): ValidationResult {
  const errors: string[] = [];
  let hasBlockingError = false;

  // Guard against null/undefined input
  if (!Array.isArray(dishes)) {
    return { valid: false, errors: ['Input must be an array of SpanishDishEntry'] };
  }

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
    const prefix = `[${i}] ${entry.externalId ?? '(missing)'}`;

    // Duplicate externalId
    if (seenExternalIds.has(entry.externalId)) {
      errors.push(`${prefix}: Duplicate externalId "${entry.externalId}"`);
      hasBlockingError = true;
    }
    seenExternalIds.add(entry.externalId);

    // dishId presence and format
    if (!entry.dishId || !UUID_REGEX.test(entry.dishId)) {
      errors.push(`${prefix}: Missing or invalid dishId "${entry.dishId}"`);
      hasBlockingError = true;
    }
    if (seenDishIds.has(entry.dishId)) {
      errors.push(`${prefix}: Duplicate dishId "${entry.dishId}"`);
      hasBlockingError = true;
    }
    seenDishIds.add(entry.dishId);

    // nutrientId presence and format
    if (!entry.nutrientId || !UUID_REGEX.test(entry.nutrientId)) {
      errors.push(`${prefix}: Missing or invalid nutrientId "${entry.nutrientId}"`);
      hasBlockingError = true;
    }
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

    // name must equal nameEs (Spanish cuisine — all names are Spanish)
    if (entry.name && entry.nameEs && entry.name !== entry.nameEs) {
      errors.push(`${prefix}: name "${entry.name}" must equal nameEs "${entry.nameEs}" for Spanish dishes`);
      hasBlockingError = true;
    }

    // Aliases must be an array
    if (!Array.isArray(entry.aliases)) {
      errors.push(`${prefix}: aliases must be an array, got ${typeof entry.aliases}`);
      hasBlockingError = true;
    }

    // Source validation
    if (!VALID_SOURCES.has(entry.source)) {
      errors.push(`${prefix}: Invalid source "${entry.source}", must be "bedca" or "recipe"`);
      hasBlockingError = true;
    }

    // Source / confidence / estimation consistency (blocking)
    if (entry.source === 'bedca' && (entry.confidenceLevel !== 'high' || entry.estimationMethod !== 'official')) {
      errors.push(`${prefix}: BEDCA source must have confidenceLevel='high' and estimationMethod='official'`);
      hasBlockingError = true;
    }
    if (entry.source === 'recipe' && (entry.confidenceLevel !== 'medium' || entry.estimationMethod !== 'ingredients')) {
      errors.push(`${prefix}: Recipe source must have confidenceLevel='medium' and estimationMethod='ingredients'`);
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
