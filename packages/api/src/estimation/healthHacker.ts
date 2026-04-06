/**
 * F081 — Health-Hacker Chain Suggestions
 *
 * Rule-based engine that generates calorie-saving modification tips
 * for chain dish estimations. Tips are curated per chain category
 * (burger, pizza, chicken, sandwich, coffee) with estimated calorie savings.
 *
 * No DB migration needed — rules are static and deterministic.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import type { HealthHackerTip } from '@foodxplorer/shared';

// Re-export the shared type for consumers that import from this module.
export type { HealthHackerTip } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Chain category mapping
// ---------------------------------------------------------------------------

type ChainCategory = 'burger' | 'pizza' | 'chicken' | 'sandwich' | 'coffee';

const CHAIN_CATEGORY_MAP: Record<string, ChainCategory> = {
  'mcdonalds-es': 'burger',
  'mcdonalds-pt': 'burger',
  'burger-king-es': 'burger',
  'five-guys-es': 'burger',
  'telepizza-es': 'pizza',
  'dominos-es': 'pizza',
  'pizza-hut-es': 'pizza',
  'papa-johns-es': 'pizza',
  'kfc-es': 'chicken',
  'popeyes-es': 'chicken',
  'subway-es': 'sandwich',
  'pans-and-company-es': 'sandwich',
  'tim-hortons-es': 'coffee',
  'starbucks-es': 'coffee',
};

// ---------------------------------------------------------------------------
// Category rules — curated tips per chain category
// ---------------------------------------------------------------------------

const CATEGORY_RULES: Record<ChainCategory, HealthHackerTip[]> = {
  burger: [
    { tip: 'Pide sin queso: mismo sabor, menos grasa', caloriesSaved: 60 },
    { tip: 'Sin salsa especial: reduce calorías fácilmente', caloriesSaved: 80 },
    { tip: 'Ensalada en lugar de patatas fritas', caloriesSaved: 200 },
    { tip: 'Agua en lugar de refresco azucarado', caloriesSaved: 140 },
  ],
  pizza: [
    { tip: 'Elige masa fina en lugar de gruesa', caloriesSaved: 100 },
    { tip: 'Sin extra de queso: ahorra grasa saturada', caloriesSaved: 80 },
    { tip: 'Añade verduras en lugar de embutidos', caloriesSaved: 60 },
  ],
  chicken: [
    { tip: 'Pollo a la plancha en lugar de frito', caloriesSaved: 150 },
    { tip: 'Ensalada como acompañamiento en lugar de patatas', caloriesSaved: 180 },
    { tip: 'Sin salsa o pide la salsa aparte', caloriesSaved: 80 },
  ],
  sandwich: [
    { tip: 'Pan integral en lugar de pan blanco', caloriesSaved: 20 },
    { tip: 'Sin mayonesa ni salsas cremosas', caloriesSaved: 90 },
    { tip: 'Más verduras, menos queso', caloriesSaved: 50 },
  ],
  coffee: [
    { tip: 'Leche desnatada en lugar de entera', caloriesSaved: 60 },
    { tip: 'Sin nata montada (whip)', caloriesSaved: 80 },
    { tip: 'Pide sin sirope o con la mitad de azúcar', caloriesSaved: 70 },
  ],
};

// ---------------------------------------------------------------------------
// Minimum calorie threshold — don't show tips for low-calorie dishes
// ---------------------------------------------------------------------------

const MIN_CALORIES = 200;

/** Maximum tips returned per estimation. */
const MAX_TIPS = 3;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get calorie-saving modification tips for a chain dish.
 *
 * Returns an empty array when:
 * - chainSlug is unknown or null
 * - chainSlug is "cocina-espanola" (virtual, not a modifiable chain)
 * - calories < 200 (low-calorie dishes don't need saving tips)
 *
 * @param chainSlug - The chain slug (e.g., "mcdonalds-es")
 * @param _dishName - The dish name (reserved for future dish-specific rules)
 * @param calories - Total calories of the dish
 * @returns Array of up to 3 tips, most impactful first
 */
export function getHealthHackerTips(
  chainSlug: string,
  _dishName: string,
  calories: number,
): HealthHackerTip[] {
  if (!chainSlug || calories < MIN_CALORIES) {
    return [];
  }

  const category = CHAIN_CATEGORY_MAP[chainSlug];
  if (category === undefined) {
    return [];
  }

  const rules = CATEGORY_RULES[category];

  // Return top MAX_TIPS tips sorted by calorie savings (descending)
  return [...rules]
    .sort((a, b) => b.caloriesSaved - a.caloriesSaved)
    .slice(0, MAX_TIPS);
}

/**
 * Compute health-hacker tips from an EstimateResult.
 *
 * Threshold is applied to the final (scaled) calories — a half-portion
 * of a 300 kcal dish (150 kcal) should not show tips.
 *
 * Returns an empty object when no tips apply, or { healthHackerTips: [...] }
 * ready to spread into EstimateData.
 */
export function enrichWithTips(
  result: { chainSlug: string | null; nameEs: string | null; name: string; nutrients: { calories: number } } | null,
): { healthHackerTips?: HealthHackerTip[] } {
  if (result === null || !result.chainSlug) {
    return {};
  }

  const tips = getHealthHackerTips(
    result.chainSlug,
    result.nameEs ?? result.name,
    result.nutrients.calories,
  );

  return tips.length > 0 ? { healthHackerTips: tips } : {};
}
