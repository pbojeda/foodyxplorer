// Unit tests for portionUtils.ts (F070 — Step 2)
//
// Verifies applyPortionMultiplier behaves identically to the inline function
// previously defined in routes/estimate.ts.

import { describe, it, expect } from 'vitest';
import { applyPortionMultiplier, NUMERIC_NUTRIENT_KEYS } from '../estimation/portionUtils.js';
import type { EstimateResult } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_RESULT: EstimateResult = {
  entityType: 'dish',
  entityId: 'fd000000-0001-4000-a000-000000000001',
  name: 'Big Mac',
  nameEs: 'Big Mac',
  restaurantId: 'fd000000-0001-4000-a000-000000000002',
  chainSlug: 'mcdonalds-es',
  portionGrams: 215,
  nutrients: {
    calories: 550,
    proteins: 25,
    carbohydrates: 46,
    sugars: 9,
    fats: 28,
    saturatedFats: 10,
    fiber: 3,
    salt: 2.2,
    sodium: 880,
    transFats: 0.5,
    cholesterol: 80,
    potassium: 300,
    monounsaturatedFats: 10,
    polyunsaturatedFats: 3,
    referenceBasis: 'per_serving',
  },
  confidenceLevel: 'high',
  estimationMethod: 'official',
  source: {
    id: 'fd000000-0001-4000-a000-000000000003',
    name: "McDonald's Spain",
    type: 'official',
    url: null,
  },
  similarityDistance: null,
};

// ---------------------------------------------------------------------------
// applyPortionMultiplier
// ---------------------------------------------------------------------------

describe('applyPortionMultiplier', () => {
  it('scales all numeric nutrients by the multiplier', () => {
    const result = applyPortionMultiplier(BASE_RESULT, 2);
    expect(result.nutrients.calories).toBe(1100);
    expect(result.nutrients.proteins).toBe(50);
    expect(result.nutrients.carbohydrates).toBe(92);
    expect(result.nutrients.fats).toBe(56);
  });

  it('scales portionGrams by the multiplier', () => {
    const result = applyPortionMultiplier(BASE_RESULT, 2);
    expect(result.nutrients.referenceBasis).toBe('per_serving');
    // portionGrams: 215 * 2 = 430 (rounded to 1 decimal)
    expect(result.portionGrams).toBe(430);
  });

  it('sets referenceBasis to per_serving regardless of input', () => {
    const withPer100g = {
      ...BASE_RESULT,
      nutrients: { ...BASE_RESULT.nutrients, referenceBasis: 'per_100g' as const },
    };
    const result = applyPortionMultiplier(withPer100g, 1.5);
    expect(result.nutrients.referenceBasis).toBe('per_serving');
  });

  it('handles null portionGrams gracefully', () => {
    const noGrams = { ...BASE_RESULT, portionGrams: null };
    const result = applyPortionMultiplier(noGrams, 2);
    expect(result.portionGrams).toBeNull();
  });

  it('does not mutate the original result', () => {
    const original = { ...BASE_RESULT };
    applyPortionMultiplier(BASE_RESULT, 2);
    expect(BASE_RESULT.nutrients.calories).toBe(original.nutrients.calories);
  });

  it('rounds nutrient values to 2 decimal places', () => {
    const result = applyPortionMultiplier(BASE_RESULT, 1.5);
    // 550 * 1.5 = 825 (exact)
    expect(result.nutrients.calories).toBe(825);
    // 2.2 * 1.5 = 3.3 (exact)
    expect(result.nutrients.salt).toBe(3.3);
  });

  it('multiplier of 1.0 returns identical nutrient values', () => {
    const result = applyPortionMultiplier(BASE_RESULT, 1.0);
    expect(result.nutrients.calories).toBe(BASE_RESULT.nutrients.calories);
    expect(result.nutrients.proteins).toBe(BASE_RESULT.nutrients.proteins);
  });
});

// ---------------------------------------------------------------------------
// NUMERIC_NUTRIENT_KEYS
// ---------------------------------------------------------------------------

describe('NUMERIC_NUTRIENT_KEYS', () => {
  it('contains all 14 numeric nutrient keys', () => {
    expect(NUMERIC_NUTRIENT_KEYS).toHaveLength(14);
  });

  it('does not contain referenceBasis', () => {
    expect(NUMERIC_NUTRIENT_KEYS).not.toContain('referenceBasis');
  });

  it('contains calories', () => {
    expect(NUMERIC_NUTRIENT_KEYS).toContain('calories');
  });
});
