// Schema tests for F087 — "El Tupper" Meal Prep
//
// Tests: portions field in body schema, portions + perPortion in data schema

import { describe, it, expect } from 'vitest';
import {
  RecipeCalculateBodySchema,
  RecipeCalculateDataSchema,
  type RecipeCalculateData,
} from '../schemas/recipeCalculate.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_NUTRIENTS = {
  calories: 500,
  proteins: 30,
  carbohydrates: 60,
  sugars: 5,
  fats: 15,
  saturatedFats: 3,
  fiber: 8,
  salt: 1,
  sodium: 400,
  transFats: 0,
  cholesterol: 20,
  potassium: 300,
  monounsaturatedFats: 5,
  polyunsaturatedFats: 3,
  alcohol: 0,
  referenceBasis: 'per_serving' as const,
};

const VALID_DATA_BASE: RecipeCalculateData = {
  mode: 'free-form',
  resolvedCount: 2,
  unresolvedCount: 0,
  confidenceLevel: 'medium',
  totalNutrients: VALID_NUTRIENTS,
  ingredients: [],
  unresolvedIngredients: [],
  cachedAt: null,
  portions: null,
  perPortion: null,
};

// ---------------------------------------------------------------------------
// Body schema — portions field
// ---------------------------------------------------------------------------

describe('RecipeCalculateBodySchema — portions (F087)', () => {
  it('structured mode accepts optional portions field', () => {
    const result = RecipeCalculateBodySchema.parse({
      mode: 'structured',
      ingredients: [{ name: 'arroz', grams: 200, portionMultiplier: 1.0 }],
      portions: 5,
    });
    expect(result.portions).toBe(5);
  });

  it('free-form mode accepts optional portions field', () => {
    const result = RecipeCalculateBodySchema.parse({
      mode: 'free-form',
      text: '200g arroz, 300g pollo',
      portions: 3,
    });
    expect(result.portions).toBe(3);
  });

  it('portions defaults to undefined when omitted', () => {
    const result = RecipeCalculateBodySchema.parse({
      mode: 'free-form',
      text: '200g arroz',
    });
    expect(result.portions).toBeUndefined();
  });

  it('portions = 1 is valid', () => {
    const result = RecipeCalculateBodySchema.parse({
      mode: 'free-form',
      text: '200g arroz',
      portions: 1,
    });
    expect(result.portions).toBe(1);
  });

  it('portions = 50 is valid (max)', () => {
    const result = RecipeCalculateBodySchema.parse({
      mode: 'free-form',
      text: '200g arroz',
      portions: 50,
    });
    expect(result.portions).toBe(50);
  });

  it('portions = 0 fails validation', () => {
    expect(() =>
      RecipeCalculateBodySchema.parse({
        mode: 'free-form',
        text: '200g arroz',
        portions: 0,
      }),
    ).toThrow();
  });

  it('portions = 51 fails validation', () => {
    expect(() =>
      RecipeCalculateBodySchema.parse({
        mode: 'free-form',
        text: '200g arroz',
        portions: 51,
      }),
    ).toThrow();
  });

  it('portions must be integer', () => {
    expect(() =>
      RecipeCalculateBodySchema.parse({
        mode: 'free-form',
        text: '200g arroz',
        portions: 2.5,
      }),
    ).toThrow();
  });

  it('portions = -1 fails validation', () => {
    expect(() =>
      RecipeCalculateBodySchema.parse({
        mode: 'free-form',
        text: '200g arroz',
        portions: -1,
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Data schema — portions + perPortion fields
// ---------------------------------------------------------------------------

describe('RecipeCalculateDataSchema — portions + perPortion (F087)', () => {
  it('accepts data with portions: null and perPortion: null', () => {
    const result = RecipeCalculateDataSchema.parse(VALID_DATA_BASE);
    expect(result.portions).toBeNull();
    expect(result.perPortion).toBeNull();
  });

  it('accepts data with portions and perPortion populated', () => {
    const perPortion = { ...VALID_NUTRIENTS, calories: 100, proteins: 6 };
    const result = RecipeCalculateDataSchema.parse({
      ...VALID_DATA_BASE,
      portions: 5,
      perPortion,
    });
    expect(result.portions).toBe(5);
    expect(result.perPortion?.calories).toBe(100);
    expect(result.perPortion?.proteins).toBe(6);
  });

  it('perPortion can have null nutrient values', () => {
    const perPortion = {
      ...VALID_NUTRIENTS,
      calories: null,
      proteins: null,
    };
    const result = RecipeCalculateDataSchema.parse({
      ...VALID_DATA_BASE,
      portions: 3,
      perPortion,
    });
    expect(result.perPortion?.calories).toBeNull();
    expect(result.perPortion?.proteins).toBeNull();
  });
});
