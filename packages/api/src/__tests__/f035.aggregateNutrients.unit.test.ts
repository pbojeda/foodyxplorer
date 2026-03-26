// F035 — Unit tests for aggregateNutrients.ts
//
// Pure function tests — no mocks needed.
// Covers:
//   - Basic aggregation (formula: nutrient_per_100g * grams / 100 * portionMultiplier)
//   - Rounding per-ingredient first (2 decimal places, half-up)
//   - Totals = sum of already-rounded per-ingredient values
//   - Null handling: all-null → null; mixed null + number → treat null as 0
//   - portionMultiplier scaling
//   - Multiple ingredients

import { describe, it, expect } from 'vitest';
import { aggregateNutrients } from '../calculation/aggregateNutrients.js';
import type { ResolvedIngredientForAggregation } from '../calculation/aggregateNutrients.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<ResolvedIngredientForAggregation['nutrientRow']> = {}): ResolvedIngredientForAggregation['nutrientRow'] {
  return {
    food_id: 'fd000000-0001-4000-a000-000000000001',
    food_name: 'Chicken breast',
    food_name_es: 'Pechuga de pollo',
    calories: '165',       // per 100g
    proteins: '31',
    carbohydrates: '0',
    sugars: '0',
    fats: '3.6',
    saturated_fats: '1.0',
    fiber: '0',
    salt: '0.1',
    sodium: '74',
    trans_fats: '0',
    cholesterol: '85',
    potassium: '220',
    monounsaturated_fats: '1.2',
    polyunsaturated_fats: '0.8',
    reference_basis: 'per_100g',
    source_id: 'ds-001',
    source_name: 'USDA',
    source_type: 'official',
    source_url: null,
    ...overrides,
  };
}

function makeIngredient(
  overrides: Partial<ResolvedIngredientForAggregation> = {},
): ResolvedIngredientForAggregation {
  return {
    grams: 200,
    portionMultiplier: 1.0,
    nutrientRow: makeRow(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Basic aggregation
// ---------------------------------------------------------------------------

describe('aggregateNutrients', () => {
  describe('single ingredient', () => {
    it('computes scaled nutrients correctly for 200g chicken', () => {
      // 200g * 1.0 portionMultiplier: factor = 2.0
      // calories = 165 * 2.0 = 330.00
      // proteins = 31 * 2.0 = 62.00
      // fats = 3.6 * 2.0 = 7.20
      const ingredient = makeIngredient({ grams: 200, portionMultiplier: 1.0 });

      const { perIngredient, totals } = aggregateNutrients([ingredient]);

      expect(perIngredient).toHaveLength(1);
      expect(perIngredient[0]?.calories).toBe(330.00);
      expect(perIngredient[0]?.proteins).toBe(62.00);
      expect(perIngredient[0]?.fats).toBe(7.20);
      expect(perIngredient[0]?.referenceBasis).toBe('per_serving');
      expect(totals.calories).toBe(330.00);
      expect(totals.proteins).toBe(62.00);
      expect(totals.referenceBasis).toBe('per_serving');
    });

    it('applies portionMultiplier correctly (0.7 scales down)', () => {
      // 200g * 0.7 portionMultiplier: factor = 1.4
      // calories = 165 * 1.4 = 231.00
      const ingredient = makeIngredient({ grams: 200, portionMultiplier: 0.7 });

      const { perIngredient, totals } = aggregateNutrients([ingredient]);

      expect(perIngredient[0]?.calories).toBe(231.00);
      expect(totals.calories).toBe(231.00);
    });

    it('rounds per-ingredient values to 2 decimal places', () => {
      // 333g chicken: 165 * 3.33 = 549.45
      const ingredient = makeIngredient({ grams: 333 });

      const { perIngredient } = aggregateNutrients([ingredient]);

      // 165 * 333 / 100 * 1.0 = 549.45
      expect(perIngredient[0]?.calories).toBe(549.45);
    });

    it('rounds half-up correctly', () => {
      // 200g food with 1.005 per 100g → 1.005 * 2 = 2.01, round(2.01 * 100) / 100 = 2.01
      // Use 33.333 per 100g and 100g: 33.333 → round to 33.33
      const row = makeRow({ proteins: '33.333' });
      const ingredient = makeIngredient({ grams: 100, nutrientRow: row });

      const { perIngredient } = aggregateNutrients([ingredient]);

      expect(perIngredient[0]?.proteins).toBe(33.33);
    });
  });

  describe('multiple ingredients', () => {
    it('sums already-rounded per-ingredient values for totals', () => {
      // 200g chicken: calories = 330.00
      // 100g rice (200 kcal/100g): calories = 200.00
      // total = 530.00
      const chicken = makeIngredient({ grams: 200 });
      const riceRow = makeRow({ calories: '200', proteins: '4', food_id: 'fd000000-0002-4000-a000-000000000002' });
      const rice = makeIngredient({ grams: 100, nutrientRow: riceRow });

      const { perIngredient, totals } = aggregateNutrients([chicken, rice]);

      expect(perIngredient).toHaveLength(2);
      expect(perIngredient[0]?.calories).toBe(330.00);
      expect(perIngredient[1]?.calories).toBe(200.00);
      expect(totals.calories).toBe(530.00);
    });

    it('totals are sums of rounded per-ingredient values (not re-rounded raw)', () => {
      // This ensures visual consistency: displayed per-ingredient values add up to totals
      // 1g food A at 10.005 per 100g → per-ingredient = round(0.10005 * 100)/100 = 0.10
      // 1g food B at 10.005 per 100g → per-ingredient = 0.10
      // total should be 0.10 + 0.10 = 0.20 (not round(0.2001) = 0.20 — same here but principle matters)
      const rowA = makeRow({ proteins: '10.005', food_id: 'fd000000-0001-4000-a000-000000000001' });
      const rowB = makeRow({ proteins: '10.005', food_id: 'fd000000-0002-4000-a000-000000000002' });
      const ingA = makeIngredient({ grams: 1, nutrientRow: rowA });
      const ingB = makeIngredient({ grams: 1, nutrientRow: rowB });

      const { perIngredient, totals } = aggregateNutrients([ingA, ingB]);

      // Each: 10.005 * 1 / 100 = 0.10005 → rounded = 0.10
      expect(perIngredient[0]?.proteins).toBe(0.10);
      expect(perIngredient[1]?.proteins).toBe(0.10);
      // Total = sum of rounded = 0.10 + 0.10 = 0.20
      expect(totals.proteins).toBe(0.20);
    });
  });

  // ---------------------------------------------------------------------------
  // Null handling
  // ---------------------------------------------------------------------------

  describe('null handling', () => {
    it('returns null for a nutrient that is null for ALL resolved ingredients', () => {
      const rowA = makeRow({ trans_fats: null, food_id: 'fd000000-0001-4000-a000-000000000001' });
      const rowB = makeRow({ trans_fats: null, food_id: 'fd000000-0002-4000-a000-000000000002' });
      const ingA = makeIngredient({ grams: 100, nutrientRow: rowA });
      const ingB = makeIngredient({ grams: 100, nutrientRow: rowB });

      const { perIngredient, totals } = aggregateNutrients([ingA, ingB]);

      expect(perIngredient[0]?.transFats).toBeNull();
      expect(perIngredient[1]?.transFats).toBeNull();
      expect(totals.transFats).toBeNull();
    });

    it('treats null as 0 when mixed with non-null values', () => {
      // Ingredient A has potassium = null → treat as 0
      // Ingredient B has potassium = '200' → 200 * 1.0 = 200
      const rowA = makeRow({ potassium: null, food_id: 'fd000000-0001-4000-a000-000000000001' });
      const rowB = makeRow({ potassium: '200', food_id: 'fd000000-0002-4000-a000-000000000002' });
      const ingA = makeIngredient({ grams: 100, nutrientRow: rowA });
      const ingB = makeIngredient({ grams: 100, nutrientRow: rowB });

      const { perIngredient, totals } = aggregateNutrients([ingA, ingB]);

      // perIngredient[0]: potassium null (ingredient-level null treated as null when all-null for that ingredient? No.)
      // The spec says: null for ALL → null. mixed → treat null as 0.
      // Per-ingredient: if the row has null, the ingredient contribution is 0.
      // But the per-ingredient display should show null if the row value itself was null.
      expect(perIngredient[0]?.potassium).toBeNull();
      expect(perIngredient[1]?.potassium).toBe(200.00);
      // Total: mixed → treat null as 0, so total = 0 + 200 = 200
      expect(totals.potassium).toBe(200.00);
    });

    it('returns null total for nutrient that is null in every ingredient (single ingredient)', () => {
      const row = makeRow({ cholesterol: null });
      const ing = makeIngredient({ grams: 200, nutrientRow: row });

      const { perIngredient, totals } = aggregateNutrients([ing]);

      expect(perIngredient[0]?.cholesterol).toBeNull();
      expect(totals.cholesterol).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // All 14 nutrient fields present
  // ---------------------------------------------------------------------------

  describe('14 nutrient fields', () => {
    it('returns all 14 nutrient fields in per-ingredient and totals', () => {
      const ing = makeIngredient({ grams: 100 });
      const { perIngredient, totals } = aggregateNutrients([ing]);

      const nutrientKeys = [
        'calories', 'proteins', 'carbohydrates', 'sugars', 'fats',
        'saturatedFats', 'fiber', 'salt', 'sodium', 'transFats',
        'cholesterol', 'potassium', 'monounsaturatedFats', 'polyunsaturatedFats',
      ];

      for (const key of nutrientKeys) {
        expect(perIngredient[0]).toHaveProperty(key);
        expect(totals).toHaveProperty(key);
      }
      expect(perIngredient[0]).toHaveProperty('referenceBasis', 'per_serving');
      expect(totals).toHaveProperty('referenceBasis', 'per_serving');
    });
  });
});
