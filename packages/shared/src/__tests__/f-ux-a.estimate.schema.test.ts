// F-UX-A — Schema-level invariant tests for the new base-nutrients pairing
// and `portionMultiplier === 1.0` mutual-exclusion rule.

import { describe, it, expect } from 'vitest';
import { EstimateDataSchema } from '../schemas/estimate';

function baseNutrients() {
  return {
    calories: 500,
    proteins: 20,
    carbohydrates: 60,
    sugars: 5,
    fats: 15,
    saturatedFats: 3,
    fiber: 4,
    salt: 0.8,
    sodium: 0.32,
    transFats: 0,
    cholesterol: 30,
    potassium: 400,
    monounsaturatedFats: 8,
    polyunsaturatedFats: 3,
    alcohol: 0,
    referenceBasis: 'per_serving' as const,
  };
}

function baseDataWithMultiplier(multiplier: number) {
  return {
    query: 'paella grande',
    chainSlug: null,
    portionMultiplier: multiplier,
    level1Hit: true,
    level2Hit: false,
    level3Hit: false,
    level4Hit: false,
    matchType: null,
    result: null,
    cachedAt: null,
  };
}

describe('F-UX-A — EstimateDataSchema invariants', () => {
  it('accepts a payload with no base fields when multiplier is 1.0', () => {
    const result = EstimateDataSchema.safeParse(baseDataWithMultiplier(1.0));
    expect(result.success).toBe(true);
  });

  it('accepts a payload with both baseNutrients AND basePortionGrams when multiplier !== 1.0', () => {
    const result = EstimateDataSchema.safeParse({
      ...baseDataWithMultiplier(1.5),
      baseNutrients: baseNutrients(),
      basePortionGrams: 200,
    });
    expect(result.success).toBe(true);
  });

  it('accepts null basePortionGrams paired with baseNutrients (unknown portion grams)', () => {
    const result = EstimateDataSchema.safeParse({
      ...baseDataWithMultiplier(1.5),
      baseNutrients: baseNutrients(),
      basePortionGrams: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects baseNutrients without basePortionGrams', () => {
    const result = EstimateDataSchema.safeParse({
      ...baseDataWithMultiplier(1.5),
      baseNutrients: baseNutrients(),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/both be present or both be absent/);
    }
  });

  it('rejects basePortionGrams without baseNutrients', () => {
    const result = EstimateDataSchema.safeParse({
      ...baseDataWithMultiplier(1.5),
      basePortionGrams: 200,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/both be present or both be absent/);
    }
  });

  it('rejects baseNutrients when portionMultiplier is 1.0 (no modifier)', () => {
    const result = EstimateDataSchema.safeParse({
      ...baseDataWithMultiplier(1.0),
      baseNutrients: baseNutrients(),
      basePortionGrams: 200,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /only allowed when portionMultiplier !== 1.0/.test(i.message))).toBe(true);
    }
  });
});
