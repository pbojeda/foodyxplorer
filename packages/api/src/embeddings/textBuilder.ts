// Text builder for embedding generation.
//
// buildFoodText — formats a Food row into a text string for embedding.
// buildDishText — formats a Dish row into a text string for embedding.
//
// Both are pure functions with no I/O. Null fields are omitted from the output.

import type { FoodForEmbedding, DishForEmbedding } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Round a number to 1 decimal place for display. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Build the nutrition line from a set of nutrient values.
 * Returns null if ALL values are null (no nutrition data available).
 */
function buildNutritionLine(
  per: 'per 100g' | 'per serving',
  nutrients: {
    calories: number | null;
    proteins: number | null;
    carbohydrates: number | null;
    sugars: number | null;
    fats: number | null;
    saturatedFats: number | null;
    fiber: number | null;
    sodium: number | null;
  },
): string | null {
  const { calories, proteins, carbohydrates, sugars, fats, saturatedFats, fiber, sodium } = nutrients;

  // If all are null, skip the nutrition line entirely
  if (
    calories === null &&
    proteins === null &&
    carbohydrates === null &&
    sugars === null &&
    fats === null &&
    saturatedFats === null &&
    fiber === null &&
    sodium === null
  ) {
    return null;
  }

  const parts: string[] = [];
  if (calories !== null) parts.push(`${round1(calories)} kcal`);
  if (proteins !== null) parts.push(`${round1(proteins)}g protein`);
  if (carbohydrates !== null) parts.push(`${round1(carbohydrates)}g carbohydrates`);
  if (sugars !== null) parts.push(`${round1(sugars)}g sugars`);
  if (fats !== null) parts.push(`${round1(fats)}g fat`);
  if (saturatedFats !== null) parts.push(`${round1(saturatedFats)}g saturated fat`);
  if (fiber !== null) parts.push(`${round1(fiber)}g fiber`);
  if (sodium !== null) parts.push(`${round1(sodium)}mg sodium`);

  return `Nutrition ${per}: ${parts.join(', ')}.`;
}

// ---------------------------------------------------------------------------
// buildFoodText
// ---------------------------------------------------------------------------

/**
 * Build an embedding text string for a Food entity.
 *
 * Example output:
 * ```
 * Food: Chicken Breast. Spanish name: Pechuga de pollo. Type: generic. Category: Poultry Products.
 * Nutrition per 100g: 165 kcal, 31g protein, 0g carbohydrates, 0g sugars, 3.6g fat, 1g saturated fat, 0g fiber, 74mg sodium.
 * ```
 */
export function buildFoodText(food: FoodForEmbedding): string {
  const parts: string[] = [];

  // Line 1 — identity
  let line1 = `Food: ${food.name}. Spanish name: ${food.nameEs}. Type: ${food.foodType}.`;
  if (food.foodGroup !== null) {
    line1 += ` Category: ${food.foodGroup}.`;
  }
  parts.push(line1);

  // Line 2 — nutrition (optional)
  const nutritionLine = buildNutritionLine('per 100g', food);
  if (nutritionLine !== null) {
    parts.push(nutritionLine);
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// buildDishText
// ---------------------------------------------------------------------------

/**
 * Build an embedding text string for a Dish entity.
 *
 * Example output:
 * ```
 * Dish: Big Mac. Spanish name: Big Mac. Restaurant chain: mcdonalds-es.
 * Categories: burgers, sandwiches. Cooking methods: grilled. Serving size: 215g.
 * Nutrition per serving: 550 kcal, 25g protein, 46g carbohydrates, 9g sugars, 30g fat, 11g saturated fat, 3g fiber, 730mg sodium.
 * ```
 */
export function buildDishText(dish: DishForEmbedding): string {
  const parts: string[] = [];

  // Line 1 — identity
  let line1 = `Dish: ${dish.name}.`;
  if (dish.nameEs !== null) {
    line1 += ` Spanish name: ${dish.nameEs}.`;
  }
  line1 += ` Restaurant chain: ${dish.chainSlug}.`;
  parts.push(line1);

  // Line 2 — categories / cooking methods / serving size (optional)
  const line2Parts: string[] = [];
  if (dish.categorySlugs.length > 0) {
    line2Parts.push(`Categories: ${dish.categorySlugs.join(', ')}.`);
  }
  if (dish.cookingMethodSlugs.length > 0) {
    line2Parts.push(`Cooking methods: ${dish.cookingMethodSlugs.join(', ')}.`);
  }
  if (dish.portionGrams !== null) {
    line2Parts.push(`Serving size: ${round1(dish.portionGrams)}g.`);
  }
  if (line2Parts.length > 0) {
    parts.push(line2Parts.join(' '));
  }

  // Line 3 — nutrition (optional)
  const nutritionLine = buildNutritionLine('per serving', dish);
  if (nutritionLine !== null) {
    parts.push(nutritionLine);
  }

  return parts.join('\n');
}
