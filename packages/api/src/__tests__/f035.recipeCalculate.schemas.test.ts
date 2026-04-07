// F035 — Schema unit tests for recipeCalculate.ts
//
// Tests all Zod schemas defined in packages/shared/src/schemas/recipeCalculate.ts:
//   - RecipeIngredientInputSchema
//   - RecipeCalculateBodySchema (discriminated union)
//   - ParsedIngredientSchema
//   - LlmParseOutputSchema
//   - ResolvedIngredientSchema
//   - RecipeCalculateDataSchema
//   - RecipeCalculateResponseSchema
//
// Also tests that 'direct_id' was added to EstimateMatchTypeSchema.

import { describe, it, expect } from 'vitest';
import {
  RecipeIngredientInputSchema,
  RecipeCalculateBodySchema,
  ParsedIngredientSchema,
  LlmParseOutputSchema,
  ResolvedIngredientSchema,
  RecipeCalculateDataSchema,
  RecipeCalculateResponseSchema,
  EstimateMatchTypeSchema,
} from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// EstimateMatchTypeSchema — 'direct_id' added
// ---------------------------------------------------------------------------

describe('EstimateMatchTypeSchema', () => {
  it('accepts direct_id', () => {
    expect(() => EstimateMatchTypeSchema.parse('direct_id')).not.toThrow();
  });

  it('still accepts all previous match types', () => {
    const types = [
      'exact_dish', 'fts_dish', 'exact_food', 'fts_food',
      'ingredient_dish_exact', 'ingredient_dish_fts',
      'similarity_dish', 'similarity_food',
      'llm_food_match', 'llm_ingredient_decomposition',
    ];
    for (const t of types) {
      expect(() => EstimateMatchTypeSchema.parse(t)).not.toThrow();
    }
  });

  it('rejects unknown match types', () => {
    expect(() => EstimateMatchTypeSchema.parse('unknown_type')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// RecipeIngredientInputSchema
// ---------------------------------------------------------------------------

describe('RecipeIngredientInputSchema', () => {
  it('accepts valid ingredient with name and grams', () => {
    const result = RecipeIngredientInputSchema.parse({ name: 'pollo', grams: 200 });
    expect(result).toMatchObject({ name: 'pollo', grams: 200, portionMultiplier: 1.0 });
  });

  it('accepts valid ingredient with foodId and grams', () => {
    const result = RecipeIngredientInputSchema.parse({
      foodId: 'fd000000-0001-4000-a000-000000000001',
      grams: 100,
    });
    expect(result).toMatchObject({ foodId: 'fd000000-0001-4000-a000-000000000001', grams: 100 });
  });

  it('accepts portionMultiplier in valid range', () => {
    const result = RecipeIngredientInputSchema.parse({ name: 'arroz', grams: 100, portionMultiplier: 0.7 });
    expect(result.portionMultiplier).toBe(0.7);
  });

  it('defaults portionMultiplier to 1.0 when absent', () => {
    const result = RecipeIngredientInputSchema.parse({ name: 'arroz', grams: 100 });
    expect(result.portionMultiplier).toBe(1.0);
  });

  it('rejects when both foodId and name are provided', () => {
    expect(() =>
      RecipeIngredientInputSchema.parse({
        foodId: 'fd000000-0001-4000-a000-000000000001',
        name: 'pollo',
        grams: 100,
      })
    ).toThrow();
  });

  it('rejects when neither foodId nor name is provided', () => {
    expect(() => RecipeIngredientInputSchema.parse({ grams: 100 })).toThrow();
  });

  it('rejects grams = 0', () => {
    expect(() => RecipeIngredientInputSchema.parse({ name: 'pollo', grams: 0 })).toThrow();
  });

  it('rejects grams > 5000', () => {
    expect(() => RecipeIngredientInputSchema.parse({ name: 'pollo', grams: 5001 })).toThrow();
  });

  it('rejects grams = 5000 is valid boundary', () => {
    expect(() => RecipeIngredientInputSchema.parse({ name: 'pollo', grams: 5000 })).not.toThrow();
  });

  it('rejects portionMultiplier = 0', () => {
    expect(() =>
      RecipeIngredientInputSchema.parse({ name: 'pollo', grams: 100, portionMultiplier: 0 })
    ).toThrow();
  });

  it('rejects portionMultiplier > 5.0', () => {
    expect(() =>
      RecipeIngredientInputSchema.parse({ name: 'pollo', grams: 100, portionMultiplier: 5.1 })
    ).toThrow();
  });

  it('accepts portionMultiplier at boundary 0.1', () => {
    expect(() =>
      RecipeIngredientInputSchema.parse({ name: 'pollo', grams: 100, portionMultiplier: 0.1 })
    ).not.toThrow();
  });

  it('accepts portionMultiplier at boundary 5.0', () => {
    expect(() =>
      RecipeIngredientInputSchema.parse({ name: 'pollo', grams: 100, portionMultiplier: 5.0 })
    ).not.toThrow();
  });

  it('rejects name longer than 255 chars', () => {
    expect(() =>
      RecipeIngredientInputSchema.parse({ name: 'a'.repeat(256), grams: 100 })
    ).toThrow();
  });

  it('rejects invalid UUID for foodId', () => {
    expect(() =>
      RecipeIngredientInputSchema.parse({ foodId: 'not-a-uuid', grams: 100 })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// RecipeCalculateBodySchema — discriminated union
// ---------------------------------------------------------------------------

describe('RecipeCalculateBodySchema', () => {
  describe('structured mode', () => {
    it('accepts valid structured body', () => {
      const result = RecipeCalculateBodySchema.parse({
        mode: 'structured',
        ingredients: [{ name: 'pollo', grams: 200 }],
      });
      expect(result.mode).toBe('structured');
    });

    it('rejects empty ingredients array', () => {
      expect(() =>
        RecipeCalculateBodySchema.parse({ mode: 'structured', ingredients: [] })
      ).toThrow();
    });

    it('rejects more than 50 ingredients', () => {
      const ingredients = Array.from({ length: 51 }, (_, i) => ({ name: `food${i}`, grams: 10 }));
      expect(() =>
        RecipeCalculateBodySchema.parse({ mode: 'structured', ingredients })
      ).toThrow();
    });

    it('accepts exactly 50 ingredients', () => {
      const ingredients = Array.from({ length: 50 }, (_, i) => ({ name: `food${i}`, grams: 10 }));
      expect(() =>
        RecipeCalculateBodySchema.parse({ mode: 'structured', ingredients })
      ).not.toThrow();
    });

    it('rejects structured body without ingredients', () => {
      expect(() =>
        RecipeCalculateBodySchema.parse({ mode: 'structured' })
      ).toThrow();
    });
  });

  describe('free-form mode', () => {
    it('accepts valid free-form body', () => {
      const result = RecipeCalculateBodySchema.parse({
        mode: 'free-form',
        text: '200g de pechuga de pollo',
      });
      expect(result.mode).toBe('free-form');
    });

    it('rejects empty text', () => {
      expect(() =>
        RecipeCalculateBodySchema.parse({ mode: 'free-form', text: '' })
      ).toThrow();
    });

    it('rejects text longer than 2000 chars', () => {
      expect(() =>
        RecipeCalculateBodySchema.parse({ mode: 'free-form', text: 'a'.repeat(2001) })
      ).toThrow();
    });

    it('accepts text of exactly 2000 chars', () => {
      expect(() =>
        RecipeCalculateBodySchema.parse({ mode: 'free-form', text: 'a'.repeat(2000) })
      ).not.toThrow();
    });

    it('rejects free-form body without text', () => {
      expect(() =>
        RecipeCalculateBodySchema.parse({ mode: 'free-form' })
      ).toThrow();
    });
  });

  it('rejects unknown mode', () => {
    expect(() =>
      RecipeCalculateBodySchema.parse({ mode: 'unknown', ingredients: [] })
    ).toThrow();
  });

  it('rejects missing mode', () => {
    expect(() =>
      RecipeCalculateBodySchema.parse({ ingredients: [{ name: 'pollo', grams: 100 }] })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ParsedIngredientSchema
// ---------------------------------------------------------------------------

describe('ParsedIngredientSchema', () => {
  it('accepts valid parsed ingredient', () => {
    const result = ParsedIngredientSchema.parse({ name: 'pollo', grams: 200, portionMultiplier: 1.0 });
    expect(result).toMatchObject({ name: 'pollo', grams: 200, portionMultiplier: 1.0 });
  });

  it('defaults portionMultiplier to 1.0', () => {
    const result = ParsedIngredientSchema.parse({ name: 'arroz', grams: 100 });
    expect(result.portionMultiplier).toBe(1.0);
  });

  it('rejects grams = 0', () => {
    expect(() => ParsedIngredientSchema.parse({ name: 'pollo', grams: 0 })).toThrow();
  });

  it('rejects empty name', () => {
    expect(() => ParsedIngredientSchema.parse({ name: '', grams: 100 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// LlmParseOutputSchema
// ---------------------------------------------------------------------------

describe('LlmParseOutputSchema', () => {
  it('accepts array of 1 parsed ingredient', () => {
    expect(() =>
      LlmParseOutputSchema.parse([{ name: 'pollo', grams: 200 }])
    ).not.toThrow();
  });

  it('accepts array of up to 50 ingredients', () => {
    const arr = Array.from({ length: 50 }, (_, i) => ({ name: `food${i}`, grams: 10 }));
    expect(() => LlmParseOutputSchema.parse(arr)).not.toThrow();
  });

  it('rejects empty array', () => {
    expect(() => LlmParseOutputSchema.parse([])).toThrow();
  });

  it('rejects array of > 50 items', () => {
    const arr = Array.from({ length: 51 }, (_, i) => ({ name: `food${i}`, grams: 10 }));
    expect(() => LlmParseOutputSchema.parse(arr)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ResolvedIngredientSchema
// ---------------------------------------------------------------------------

describe('ResolvedIngredientSchema', () => {
  it('accepts resolved ingredient', () => {
    const result = ResolvedIngredientSchema.parse({
      input: { foodId: null, name: 'pollo', grams: 200, portionMultiplier: 1.0 },
      resolved: true,
      resolvedAs: {
        entityId: 'fd000000-0001-4000-a000-000000000001',
        name: 'Chicken, breast',
        nameEs: 'Pechuga de pollo',
        matchType: 'fts_food',
      },
      nutrients: {
        calories: 165,
        proteins: 31,
        carbohydrates: 0,
        sugars: 0,
        fats: 3.6,
        saturatedFats: 1,
        fiber: 0,
        salt: 0.1,
        sodium: 74,
        transFats: 0,
        cholesterol: 85,
        potassium: 220,
        monounsaturatedFats: 1.2,
        polyunsaturatedFats: 0.8,
        alcohol: 0,
        referenceBasis: 'per_serving',
      },
    });
    expect(result.resolved).toBe(true);
  });

  it('accepts unresolved ingredient', () => {
    const result = ResolvedIngredientSchema.parse({
      input: { foodId: null, name: 'ingrediente raro', grams: 50, portionMultiplier: 1.0 },
      resolved: false,
      resolvedAs: null,
      nutrients: null,
    });
    expect(result.resolved).toBe(false);
    expect(result.resolvedAs).toBeNull();
    expect(result.nutrients).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RecipeCalculateDataSchema
// ---------------------------------------------------------------------------

describe('RecipeCalculateDataSchema', () => {
  const baseTotalNutrients = {
    calories: 330,
    proteins: 62,
    carbohydrates: 0,
    sugars: 0,
    fats: 7.2,
    saturatedFats: 2,
    fiber: 0,
    salt: 0.2,
    sodium: 148,
    transFats: 0,
    cholesterol: 170,
    potassium: 440,
    monounsaturatedFats: 2.4,
    polyunsaturatedFats: 1.6,
    alcohol: 0,
    referenceBasis: 'per_serving' as const,
  };

  it('accepts valid structured mode response data', () => {
    const result = RecipeCalculateDataSchema.parse({
      mode: 'structured',
      resolvedCount: 1,
      unresolvedCount: 0,
      confidenceLevel: 'medium',
      totalNutrients: baseTotalNutrients,
      ingredients: [],
      unresolvedIngredients: [],
      cachedAt: null,
      portions: null,
      perPortion: null,
    });
    expect(result.mode).toBe('structured');
  });

  it('accepts free-form mode response with parsedIngredients', () => {
    const result = RecipeCalculateDataSchema.parse({
      mode: 'free-form',
      resolvedCount: 1,
      unresolvedCount: 0,
      confidenceLevel: 'medium',
      totalNutrients: baseTotalNutrients,
      ingredients: [],
      unresolvedIngredients: [],
      parsedIngredients: [{ name: 'pollo', grams: 200, portionMultiplier: 1.0 }],
      cachedAt: null,
      portions: null,
      perPortion: null,
    });
    expect(result.mode).toBe('free-form');
  });

  it('accepts cachedAt as ISO string', () => {
    const result = RecipeCalculateDataSchema.parse({
      mode: 'structured',
      resolvedCount: 1,
      unresolvedCount: 0,
      confidenceLevel: 'medium',
      totalNutrients: baseTotalNutrients,
      ingredients: [],
      unresolvedIngredients: [],
      cachedAt: '2026-03-25T10:00:00.000Z',
      portions: null,
      perPortion: null,
    });
    expect(result.cachedAt).toBe('2026-03-25T10:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// RecipeCalculateResponseSchema
// ---------------------------------------------------------------------------

describe('RecipeCalculateResponseSchema', () => {
  it('accepts valid response envelope', () => {
    const result = RecipeCalculateResponseSchema.parse({
      success: true,
      data: {
        mode: 'structured',
        resolvedCount: 0,
        unresolvedCount: 0,
        confidenceLevel: 'medium',
        totalNutrients: {
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
          alcohol: 0,
          referenceBasis: 'per_serving',
        },
        ingredients: [],
        unresolvedIngredients: [],
        cachedAt: null,
        portions: null,
        perPortion: null,
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects success: false', () => {
    expect(() =>
      RecipeCalculateResponseSchema.parse({ success: false, data: {} })
    ).toThrow();
  });
});
