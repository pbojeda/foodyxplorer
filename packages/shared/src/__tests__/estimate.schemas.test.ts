// Unit tests for estimate.ts Zod schemas
//
// Covers: EstimateQuerySchema, EstimateNutrientsSchema, EstimateResultSchema,
//         EstimateDataSchema, EstimateResponseSchema — valid inputs, invalid
//         inputs, edge cases.

import { describe, it, expect } from 'vitest';
import {
  EstimateQuerySchema,
  EstimateMatchTypeSchema,
  EstimateSourceSchema,
  EstimateNutrientsSchema,
  EstimateResultSchema,
  EstimateDataSchema,
  EstimateResponseSchema,
} from '../schemas/estimate.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_NUTRIENTS = {
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
  potassium: 0,
  monounsaturatedFats: 0,
  polyunsaturatedFats: 0,
  referenceBasis: 'per_serving' as const,
};

const VALID_SOURCE = {
  id: 'fd000000-0001-4000-a000-000000000001',
  name: "McDonald's Spain Official PDF",
  type: 'official' as const,
  url: 'https://www.mcdonalds.es/nutritional.pdf',
};

const VALID_RESULT = {
  entityType: 'dish' as const,
  entityId: 'fd000000-0001-4000-a000-000000000002',
  name: 'Big Mac',
  nameEs: 'Big Mac',
  restaurantId: 'fd000000-0001-4000-a000-000000000003',
  chainSlug: 'mcdonalds-es',
  portionGrams: 215,
  nutrients: VALID_NUTRIENTS,
  confidenceLevel: 'high' as const,
  estimationMethod: 'official' as const,
  source: VALID_SOURCE,
  similarityDistance: null,
};

// ---------------------------------------------------------------------------
// EstimateQuerySchema
// ---------------------------------------------------------------------------

describe('EstimateQuerySchema', () => {
  it('parses valid query with all fields', () => {
    const result = EstimateQuerySchema.safeParse({
      query: 'Big Mac',
      chainSlug: 'mcdonalds-es',
      restaurantId: 'fd000000-0001-4000-a000-000000000003',
    });
    expect(result.success).toBe(true);
  });

  it('parses valid query with only required field', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'pollo' });
    expect(result.success).toBe(true);
  });

  it('trims whitespace from query', () => {
    const result = EstimateQuerySchema.safeParse({ query: '  Big Mac  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.query).toBe('Big Mac');
    }
  });

  it('rejects missing query', () => {
    const result = EstimateQuerySchema.safeParse({ chainSlug: 'mcdonalds-es' });
    expect(result.success).toBe(false);
  });

  it('rejects empty query', () => {
    const result = EstimateQuerySchema.safeParse({ query: '' });
    expect(result.success).toBe(false);
  });

  it('rejects query exceeding 255 chars', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'a'.repeat(256) });
    expect(result.success).toBe(false);
  });

  it('accepts query of exactly 255 chars', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'a'.repeat(255) });
    expect(result.success).toBe(true);
  });

  it('rejects chainSlug with uppercase', () => {
    const result = EstimateQuerySchema.safeParse({
      query: 'pollo',
      chainSlug: 'McDonalds-ES',
    });
    expect(result.success).toBe(false);
  });

  it('rejects chainSlug with special characters', () => {
    const result = EstimateQuerySchema.safeParse({
      query: 'pollo',
      chainSlug: 'mcdonald_s',
    });
    expect(result.success).toBe(false);
  });

  it('accepts chainSlug with lowercase letters, digits, hyphens', () => {
    const result = EstimateQuerySchema.safeParse({
      query: 'pollo',
      chainSlug: 'burger-king-123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects chainSlug exceeding 100 chars', () => {
    const result = EstimateQuerySchema.safeParse({
      query: 'pollo',
      chainSlug: 'a'.repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID restaurantId', () => {
    const result = EstimateQuerySchema.safeParse({
      query: 'pollo',
      restaurantId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('accepts absent chainSlug and restaurantId', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'salad' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chainSlug).toBeUndefined();
      expect(result.data.restaurantId).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// EstimateMatchTypeSchema
// ---------------------------------------------------------------------------

describe('EstimateMatchTypeSchema', () => {
  it('accepts all valid match types', () => {
    for (const type of ['exact_dish', 'fts_dish', 'exact_food', 'fts_food'] as const) {
      expect(EstimateMatchTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it('accepts ingredient_dish_exact (Level 2)', () => {
    expect(EstimateMatchTypeSchema.safeParse('ingredient_dish_exact').success).toBe(true);
  });

  it('accepts ingredient_dish_fts (Level 2)', () => {
    expect(EstimateMatchTypeSchema.safeParse('ingredient_dish_fts').success).toBe(true);
  });

  it('rejects invalid match type', () => {
    expect(EstimateMatchTypeSchema.safeParse('exact_recipe').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EstimateSourceSchema
// ---------------------------------------------------------------------------

describe('EstimateSourceSchema', () => {
  it('parses valid source with url', () => {
    expect(EstimateSourceSchema.safeParse(VALID_SOURCE).success).toBe(true);
  });

  it('parses source with null url', () => {
    const result = EstimateSourceSchema.safeParse({ ...VALID_SOURCE, url: null });
    expect(result.success).toBe(true);
  });

  it('rejects non-UUID id', () => {
    const result = EstimateSourceSchema.safeParse({ ...VALID_SOURCE, id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid type', () => {
    const result = EstimateSourceSchema.safeParse({ ...VALID_SOURCE, type: 'unknown' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EstimateNutrientsSchema
// ---------------------------------------------------------------------------

describe('EstimateNutrientsSchema', () => {
  it('parses valid nutrients with all 15 fields', () => {
    const result = EstimateNutrientsSchema.safeParse(VALID_NUTRIENTS);
    expect(result.success).toBe(true);
  });

  it('accepts zero values for all numeric fields', () => {
    const zeroNutrients = {
      ...VALID_NUTRIENTS,
      calories: 0,
      proteins: 0,
      transFats: 0,
      cholesterol: 0,
      potassium: 0,
    };
    expect(EstimateNutrientsSchema.safeParse(zeroNutrients).success).toBe(true);
  });

  it('rejects negative calories', () => {
    const result = EstimateNutrientsSchema.safeParse({ ...VALID_NUTRIENTS, calories: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects negative proteins', () => {
    const result = EstimateNutrientsSchema.safeParse({ ...VALID_NUTRIENTS, proteins: -0.1 });
    expect(result.success).toBe(false);
  });

  it('rejects negative transFats', () => {
    const result = EstimateNutrientsSchema.safeParse({ ...VALID_NUTRIENTS, transFats: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects negative cholesterol', () => {
    const result = EstimateNutrientsSchema.safeParse({ ...VALID_NUTRIENTS, cholesterol: -5 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid referenceBasis', () => {
    const result = EstimateNutrientsSchema.safeParse({ ...VALID_NUTRIENTS, referenceBasis: 'per_item' });
    expect(result.success).toBe(false);
  });

  it('accepts all three referenceBasis values', () => {
    for (const basis of ['per_100g', 'per_serving', 'per_package'] as const) {
      const result = EstimateNutrientsSchema.safeParse({ ...VALID_NUTRIENTS, referenceBasis: basis });
      expect(result.success).toBe(true);
    }
  });

  it('requires all 15 nutrient fields', () => {
    const { transFats: _tf, ...withoutTransFats } = VALID_NUTRIENTS;
    const result = EstimateNutrientsSchema.safeParse(withoutTransFats);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EstimateResultSchema
// ---------------------------------------------------------------------------

describe('EstimateResultSchema', () => {
  it('parses valid dish result', () => {
    expect(EstimateResultSchema.safeParse(VALID_RESULT).success).toBe(true);
  });

  it('parses valid food result with null restaurantId and chainSlug', () => {
    const foodResult = {
      ...VALID_RESULT,
      entityType: 'food' as const,
      restaurantId: null,
      chainSlug: null,
      portionGrams: null,
    };
    expect(EstimateResultSchema.safeParse(foodResult).success).toBe(true);
  });

  it('rejects non-UUID entityId', () => {
    const result = EstimateResultSchema.safeParse({ ...VALID_RESULT, entityId: 'bad' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid entityType', () => {
    const result = EstimateResultSchema.safeParse({ ...VALID_RESULT, entityType: 'ingredient' });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive portionGrams', () => {
    const result = EstimateResultSchema.safeParse({ ...VALID_RESULT, portionGrams: 0 });
    expect(result.success).toBe(false);
  });

  it('accepts null portionGrams', () => {
    const result = EstimateResultSchema.safeParse({ ...VALID_RESULT, portionGrams: null });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EstimateDataSchema
// ---------------------------------------------------------------------------

describe('EstimateDataSchema', () => {
  it('parses a hit response', () => {
    const data = {
      query: 'Big Mac',
      chainSlug: 'mcdonalds-es',
      level1Hit: true,
      level2Hit: false,
      level3Hit: false,
      matchType: 'exact_dish',
      result: VALID_RESULT,
      cachedAt: null,
    };
    expect(EstimateDataSchema.safeParse(data).success).toBe(true);
  });

  it('parses a miss response', () => {
    const data = {
      query: 'pizza de atún con borde relleno',
      chainSlug: null,
      level1Hit: false,
      level2Hit: false,
      level3Hit: false,
      matchType: null,
      result: null,
      cachedAt: null,
    };
    expect(EstimateDataSchema.safeParse(data).success).toBe(true);
  });

  it('parses a cached response with non-null cachedAt', () => {
    const data = {
      query: 'Big Mac',
      chainSlug: 'mcdonalds-es',
      level1Hit: true,
      level2Hit: false,
      level3Hit: false,
      matchType: 'exact_dish',
      result: VALID_RESULT,
      cachedAt: '2026-03-17T14:00:00.000Z',
    };
    expect(EstimateDataSchema.safeParse(data).success).toBe(true);
  });

  it('parses a Level 2 hit with level2Hit:true', () => {
    const data = {
      query: 'Big Mac',
      chainSlug: 'mcdonalds-es',
      level1Hit: false,
      level2Hit: true,
      level3Hit: false,
      matchType: 'ingredient_dish_exact',
      result: {
        ...VALID_RESULT,
        confidenceLevel: 'medium' as const,
        estimationMethod: 'ingredients' as const,
        source: {
          id: 'fd000000-0001-4000-a000-000000000001',
          name: 'Computed from ingredients',
          type: 'estimated' as const,
          url: null,
        },
        nutrients: {
          ...VALID_NUTRIENTS,
          referenceBasis: 'per_serving' as const,
        },
      },
      cachedAt: null,
    };
    expect(EstimateDataSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing level2Hit', () => {
    const data = {
      query: 'Big Mac',
      chainSlug: null,
      level1Hit: false,
      // level2Hit intentionally omitted
      level3Hit: false,
      matchType: null,
      result: null,
      cachedAt: null,
    };
    expect(EstimateDataSchema.safeParse(data).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EstimateResponseSchema — round-trip from spec sample JSON
// ---------------------------------------------------------------------------

describe('EstimateResponseSchema', () => {
  it('round-trips the spec sample JSON for a hit', () => {
    const sampleJson = {
      success: true,
      data: {
        query: 'Big Mac',
        chainSlug: 'mcdonalds-es',
        level1Hit: true,
        level2Hit: false,
        level3Hit: false,
        matchType: 'exact_dish',
        result: {
          entityType: 'dish',
          entityId: 'fd000000-0001-4000-a000-000000000002',
          name: 'Big Mac',
          nameEs: 'Big Mac',
          restaurantId: 'fd000000-0001-4000-a000-000000000003',
          chainSlug: 'mcdonalds-es',
          portionGrams: 200,
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
            potassium: 0,
            monounsaturatedFats: 0,
            polyunsaturatedFats: 0,
            referenceBasis: 'per_serving',
          },
          confidenceLevel: 'high',
          estimationMethod: 'official',
          source: {
            id: 'fd000000-0001-4000-a000-000000000001',
            name: "McDonald's Spain Official PDF",
            type: 'official',
            url: 'https://www.mcdonalds.es/nutritional.pdf',
          },
          similarityDistance: null,
        },
        cachedAt: null,
      },
    };
    const result = EstimateResponseSchema.safeParse(sampleJson);
    expect(result.success).toBe(true);
  });

  it('round-trips the spec sample JSON for a miss', () => {
    const sampleJson = {
      success: true,
      data: {
        query: 'pizza de atún con borde relleno',
        chainSlug: null,
        level1Hit: false,
        level2Hit: false,
        level3Hit: false,
        matchType: null,
        result: null,
        cachedAt: null,
      },
    };
    expect(EstimateResponseSchema.safeParse(sampleJson).success).toBe(true);
  });

  it('rejects success:false', () => {
    const result = EstimateResponseSchema.safeParse({ success: false, data: {} });
    expect(result.success).toBe(false);
  });
});
