/**
 * F082 — Nutritional Substitutions
 *
 * Rule-based engine that suggests healthier food alternatives with
 * multi-nutrient comparisons. Triggers on food-name keyword matching
 * and applies to ALL estimations (not just chain dishes).
 *
 * Complements F081 Health-Hacker tips: F081 = chain-category modification
 * tips (calorie-only), F082 = food-name substitution pairs (full macros).
 *
 * No DB migration needed — rules are static and deterministic.
 */

import type { NutritionalSubstitution } from '@foodxplorer/shared';

export type { NutritionalSubstitution } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SubstitutionRule {
  /** Keywords that trigger this rule (matched against lowercase dish name) */
  patterns: string[];
  /** Display name for the original food component */
  original: string;
  /** Substitute suggestions with nutrient diffs (per typical serving) */
  substitutes: Array<{
    name: string;
    nutrientDiff: {
      calories: number;
      proteins: number;
      fats: number;
      carbohydrates: number;
      fiber: number;
    };
  }>;
}

// ---------------------------------------------------------------------------
// Substitution rules — curated pairs with per-serving nutrient diffs
// ---------------------------------------------------------------------------

// Rules are ordered by priority — first match wins. Do not reorder without review.
const SUBSTITUTION_RULES: SubstitutionRule[] = [
  // Sides
  {
    patterns: ['patatas fritas', 'papas fritas', 'french fries'],
    original: 'Patatas fritas',
    substitutes: [
      {
        name: 'Ensalada verde',
        nutrientDiff: { calories: -275, proteins: 1, fats: -15, carbohydrates: -38, fiber: 2 },
      },
      {
        name: 'Verduras al vapor',
        nutrientDiff: { calories: -240, proteins: 2, fats: -14, carbohydrates: -33, fiber: 3 },
      },
    ],
  },
  // Drinks
  {
    patterns: ['refresco', 'coca-cola', 'coca cola', 'fanta', 'pepsi', 'sprite'],
    original: 'Refresco azucarado',
    substitutes: [
      {
        name: 'Agua',
        nutrientDiff: { calories: -140, proteins: 0, fats: 0, carbohydrates: -35, fiber: 0 },
      },
      {
        name: 'Agua con gas',
        nutrientDiff: { calories: -140, proteins: 0, fats: 0, carbohydrates: -35, fiber: 0 },
      },
    ],
  },
  // Fried protein
  {
    patterns: ['pollo frito', 'rebozado', 'empanado'],
    original: 'Pollo frito',
    substitutes: [
      {
        name: 'Pollo a la plancha',
        nutrientDiff: { calories: -150, proteins: 5, fats: -15, carbohydrates: -8, fiber: 0 },
      },
      {
        name: 'Pollo al horno',
        nutrientDiff: { calories: -120, proteins: 3, fats: -12, carbohydrates: -5, fiber: 0 },
      },
    ],
  },
  // Sauces
  {
    patterns: ['mayonesa', 'mayo'],
    original: 'Mayonesa',
    substitutes: [
      {
        name: 'Mostaza',
        nutrientDiff: { calories: -85, proteins: 0, fats: -10, carbohydrates: 1, fiber: 0 },
      },
      {
        name: 'Vinagreta',
        nutrientDiff: { calories: -60, proteins: 0, fats: -5, carbohydrates: 1, fiber: 0 },
      },
    ],
  },
  // Bread
  {
    patterns: ['pan blanco', 'baguette', 'pan de molde'],
    original: 'Pan blanco',
    substitutes: [
      {
        name: 'Pan integral',
        nutrientDiff: { calories: -20, proteins: 2, fats: 0, carbohydrates: -5, fiber: 3 },
      },
    ],
  },
  // Dairy
  {
    patterns: ['leche entera'],
    original: 'Leche entera',
    substitutes: [
      {
        name: 'Leche desnatada',
        nutrientDiff: { calories: -30, proteins: 0, fats: -3, carbohydrates: 0, fiber: 0 },
      },
      {
        name: 'Bebida de avena',
        nutrientDiff: { calories: -15, proteins: -1, fats: -1, carbohydrates: 3, fiber: 1 },
      },
    ],
  },
  // Rice
  {
    patterns: ['arroz blanco'],
    original: 'Arroz blanco',
    substitutes: [
      {
        name: 'Quinoa',
        nutrientDiff: { calories: -30, proteins: 5, fats: 2, carbohydrates: -15, fiber: 3 },
      },
      {
        name: 'Arroz integral',
        nutrientDiff: { calories: -10, proteins: 1, fats: 0, carbohydrates: -5, fiber: 2 },
      },
    ],
  },
  // Cream/whip
  {
    patterns: ['nata montada', 'crema batida', 'nata para montar'],
    original: 'Nata montada',
    substitutes: [
      {
        name: 'Yogur natural',
        nutrientDiff: { calories: -200, proteins: 2, fats: -30, carbohydrates: 5, fiber: 0 },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_CALORIES = 200;
const MAX_SUBSTITUTIONS = 2;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get nutritional substitution suggestions for a food/dish.
 *
 * Returns an empty array when:
 * - dishName is empty
 * - calories < 200 (low-calorie items don't need substitution tips)
 * - No keyword match found in dishName
 *
 * Returns the first matching rule's substitutes (max 2), sorted by
 * calorie savings descending.
 */
export function getSubstitutions(
  dishName: string,
  calories: number,
): NutritionalSubstitution[] {
  if (!dishName || calories < MIN_CALORIES) {
    return [];
  }

  const lowerName = dishName.toLowerCase();

  for (const rule of SUBSTITUTION_RULES) {
    const matched = rule.patterns.some((p) => lowerName.includes(p));
    if (!matched) continue;

    const subs: NutritionalSubstitution[] = rule.substitutes.map((s) => ({
      original: rule.original,
      substitute: s.name,
      nutrientDiff: { ...s.nutrientDiff },
    }));

    // Sort by calorie savings (most negative first) and cap
    return subs
      .sort((a, b) => a.nutrientDiff.calories - b.nutrientDiff.calories)
      .slice(0, MAX_SUBSTITUTIONS);
  }

  return [];
}

/**
 * Compute substitution suggestions from an EstimateResult.
 *
 * Threshold is applied to the final (scaled) calories.
 *
 * Returns an empty object when no substitutions apply, or
 * { substitutions: [...] } ready to spread into EstimateData.
 */
export function enrichWithSubstitutions(
  result: { nameEs: string | null; name: string; nutrients: { calories: number } } | null,
): { substitutions?: NutritionalSubstitution[] } {
  if (result === null) {
    return {};
  }

  const dishName = result.nameEs ?? result.name;
  const subs = getSubstitutions(dishName, result.nutrients.calories);

  return subs.length > 0 ? { substitutions: subs } : {};
}
