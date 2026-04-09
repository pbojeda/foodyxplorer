// F077 — Alcohol field in Zod schemas
//
// Verifies that `alcohol` is accepted in all nutrient schemas.

import { describe, it, expect } from 'vitest';
import { EstimateNutrientsSchema } from '../schemas/estimate.js';
import { MenuEstimationTotalsSchema } from '../schemas/menuEstimation.js';
import { CreateFoodNutrientSchema } from '../schemas/foodNutrient.js';
import { RecipeNutrientsSchema } from '../schemas/recipeCalculate.js';

describe('F077 — Alcohol in Zod schemas', () => {
  it('EstimateNutrientsSchema accepts alcohol field', () => {
    const result = EstimateNutrientsSchema.parse({
      calories: 43, proteins: 0.5, carbohydrates: 3.6, sugars: 0,
      fats: 0, saturatedFats: 0, fiber: 0, salt: 0, sodium: 0,
      transFats: 0, cholesterol: 0, potassium: 0,
      monounsaturatedFats: 0, polyunsaturatedFats: 0,
      alcohol: 4.5,
      referenceBasis: 'per_100g',
    });
    expect(result.alcohol).toBe(4.5);
  });

  it('EstimateNutrientsSchema rejects missing alcohol', () => {
    expect(() => EstimateNutrientsSchema.parse({
      calories: 43, proteins: 0.5, carbohydrates: 3.6, sugars: 0,
      fats: 0, saturatedFats: 0, fiber: 0, salt: 0, sodium: 0,
      transFats: 0, cholesterol: 0, potassium: 0,
      monounsaturatedFats: 0, polyunsaturatedFats: 0,
      referenceBasis: 'per_100g',
    })).toThrow();
  });

  it('EstimateNutrientsSchema rejects negative alcohol', () => {
    expect(() => EstimateNutrientsSchema.parse({
      calories: 0, proteins: 0, carbohydrates: 0, sugars: 0,
      fats: 0, saturatedFats: 0, fiber: 0, salt: 0, sodium: 0,
      transFats: 0, cholesterol: 0, potassium: 0,
      monounsaturatedFats: 0, polyunsaturatedFats: 0,
      alcohol: -1,
      referenceBasis: 'per_100g',
    })).toThrow();
  });

  it('MenuEstimationTotalsSchema includes alcohol', () => {
    const result = MenuEstimationTotalsSchema.parse({
      calories: 500, proteins: 20, carbohydrates: 60, sugars: 10,
      fats: 15, saturatedFats: 5, fiber: 3, salt: 1, sodium: 0.4,
      transFats: 0, cholesterol: 0, potassium: 0,
      monounsaturatedFats: 0, polyunsaturatedFats: 0,
      alcohol: 9.0,
    });
    expect(result.alcohol).toBe(9.0);
  });

  it('CreateFoodNutrientSchema defaults alcohol to 0 when omitted', () => {
    const result = CreateFoodNutrientSchema.parse({
      foodId: '00000000-0000-4000-a000-000000000001',
      calories: 100, proteins: 10, carbohydrates: 20, sugars: 5,
      fats: 8, saturatedFats: 3, fiber: 2, salt: 0.5, sodium: 0.2,
      sourceId: '00000000-0000-4000-a000-000000000002',
      confidenceLevel: 'high',
    });
    expect(result.alcohol).toBe(0);
  });

  it('RecipeNutrientsSchema accepts nullable alcohol', () => {
    const result = RecipeNutrientsSchema.parse({
      calories: 100, proteins: 10, carbohydrates: 20, sugars: 5,
      fats: 8, saturatedFats: 3, fiber: 2, salt: 0.5, sodium: 0.2,
      transFats: 0, cholesterol: 0, potassium: 0,
      monounsaturatedFats: 0, polyunsaturatedFats: 0,
      alcohol: null,
      referenceBasis: 'per_serving',
    });
    expect(result.alcohol).toBeNull();
  });
});
