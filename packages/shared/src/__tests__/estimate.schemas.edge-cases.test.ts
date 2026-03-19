// Edge-case tests for estimate.ts Zod schemas — F022 QA review.
//
// Targets gaps in estimate.schemas.test.ts:
//   - L3 match types (similarity_dish, similarity_food) not in EstimateMatchTypeSchema tests
//   - similarityDistance with non-null value (L3 result) not validated
//   - EstimateDataSchema with level3Hit:true
//   - EstimateResultSchema rejects similarityDistance outside [0, 2]
//   - Full L3 round-trip through EstimateResponseSchema
//   - EstimateDataSchema: only one of level1Hit/level2Hit/level3Hit true at once (schema allows
//     multiple true simultaneously — documenting permissiveness)

import { describe, it, expect } from 'vitest';
import {
  EstimateMatchTypeSchema,
  EstimateResultSchema,
  EstimateDataSchema,
  EstimateResponseSchema,
} from '../schemas/estimate.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_NUTRIENTS = {
  calories: 520,
  proteins: 28,
  carbohydrates: 42,
  sugars: 8,
  fats: 24,
  saturatedFats: 9,
  fiber: 3,
  salt: 2.1,
  sodium: 840,
  transFats: 0.3,
  cholesterol: 75,
  potassium: 300,
  monounsaturatedFats: 10,
  polyunsaturatedFats: 3,
  referenceBasis: 'per_serving' as const,
};

const VALID_SOURCE = {
  id: 'fd000000-ec22-4000-a000-000000000001',
  name: 'Burger King Spain Official',
  type: 'official' as const,
  url: null,
};

const VALID_L3_DISH_RESULT = {
  entityType: 'dish' as const,
  entityId: 'fd000000-ec22-4000-a000-000000000002',
  name: 'Hamburguesa Clásica',
  nameEs: 'Hamburguesa Clásica',
  restaurantId: 'fd000000-ec22-4000-a000-000000000003',
  chainSlug: 'burger-king-es',
  portionGrams: 200,
  nutrients: VALID_NUTRIENTS,
  confidenceLevel: 'low' as const,
  estimationMethod: 'extrapolation' as const,
  source: VALID_SOURCE,
  similarityDistance: 0.18,
};

const VALID_L3_FOOD_RESULT = {
  entityType: 'food' as const,
  entityId: 'fd000000-ec22-4000-a000-000000000010',
  name: 'Carne de Ternera Picada',
  nameEs: 'Carne de Ternera Picada',
  restaurantId: null,
  chainSlug: null,
  portionGrams: null,
  nutrients: { ...VALID_NUTRIENTS, calories: 250, referenceBasis: 'per_100g' as const },
  confidenceLevel: 'low' as const,
  estimationMethod: 'extrapolation' as const,
  source: {
    id: 'fd000000-ec22-4000-a000-000000000011',
    name: 'BEDCA',
    type: 'official' as const,
    url: 'https://bedca.net',
  },
  similarityDistance: 0.25,
};

// ---------------------------------------------------------------------------
// EstimateMatchTypeSchema — L3 types (NOT covered in developer's tests)
// ---------------------------------------------------------------------------

describe('EstimateMatchTypeSchema — Level 3 values', () => {
  it('accepts similarity_dish (Level 3)', () => {
    expect(EstimateMatchTypeSchema.safeParse('similarity_dish').success).toBe(true);
  });

  it('accepts similarity_food (Level 3)', () => {
    expect(EstimateMatchTypeSchema.safeParse('similarity_food').success).toBe(true);
  });

  it('rejects similarity_recipe (not a valid type)', () => {
    expect(EstimateMatchTypeSchema.safeParse('similarity_recipe').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EstimateResultSchema — similarityDistance non-null (L3)
// The developer's tests only test similarityDistance: null.
// ---------------------------------------------------------------------------

describe('EstimateResultSchema — similarityDistance field', () => {
  it('accepts similarityDistance: 0.18 (typical L3 dish match)', () => {
    const result = EstimateResultSchema.safeParse(VALID_L3_DISH_RESULT);
    expect(result.success).toBe(true);
  });

  it('accepts similarityDistance: 0.0 (exact match — minimum boundary)', () => {
    const result = EstimateResultSchema.safeParse({ ...VALID_L3_DISH_RESULT, similarityDistance: 0.0 });
    expect(result.success).toBe(true);
  });

  it('accepts similarityDistance: 2.0 (maximum boundary — opposite vectors)', () => {
    const result = EstimateResultSchema.safeParse({ ...VALID_L3_DISH_RESULT, similarityDistance: 2.0 });
    expect(result.success).toBe(true);
  });

  it('rejects similarityDistance: -0.01 (below minimum of 0)', () => {
    const result = EstimateResultSchema.safeParse({ ...VALID_L3_DISH_RESULT, similarityDistance: -0.01 });
    expect(result.success).toBe(false);
  });

  it('rejects similarityDistance: 2.01 (above maximum of 2)', () => {
    const result = EstimateResultSchema.safeParse({ ...VALID_L3_DISH_RESULT, similarityDistance: 2.01 });
    expect(result.success).toBe(false);
  });

  it('accepts similarityDistance: null (L1/L2 results)', () => {
    const result = EstimateResultSchema.safeParse({ ...VALID_L3_DISH_RESULT, similarityDistance: null });
    expect(result.success).toBe(true);
  });

  it('rejects missing similarityDistance (field required, not optional)', () => {
    const { similarityDistance: _sd, ...withoutDistance } = VALID_L3_DISH_RESULT;
    const result = EstimateResultSchema.safeParse(withoutDistance);
    expect(result.success).toBe(false);
  });

  it('accepts L3 food result with similarityDistance: 0.25', () => {
    const result = EstimateResultSchema.safeParse(VALID_L3_FOOD_RESULT);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EstimateDataSchema — Level 3 hit (level3Hit: true not tested by developer)
// ---------------------------------------------------------------------------

describe('EstimateDataSchema — Level 3 hit', () => {
  it('parses a Level 3 dish hit with level3Hit:true, matchType=similarity_dish', () => {
    const data = {
      query: 'hamburguesa',
      chainSlug: 'burger-king-es',
      level1Hit: false,
      level2Hit: false,
      level3Hit: true,
      level4Hit: false,
      matchType: 'similarity_dish',
      result: VALID_L3_DISH_RESULT,
      cachedAt: null,
    };
    expect(EstimateDataSchema.safeParse(data).success).toBe(true);
  });

  it('parses a Level 3 food hit with level3Hit:true, matchType=similarity_food', () => {
    const data = {
      query: 'ternera picada',
      chainSlug: null,
      level1Hit: false,
      level2Hit: false,
      level3Hit: true,
      level4Hit: false,
      matchType: 'similarity_food',
      result: VALID_L3_FOOD_RESULT,
      cachedAt: null,
    };
    expect(EstimateDataSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing level3Hit field', () => {
    const data = {
      query: 'hamburguesa',
      chainSlug: null,
      level1Hit: false,
      level2Hit: false,
      // level3Hit intentionally omitted
      matchType: null,
      result: null,
      cachedAt: null,
    };
    expect(EstimateDataSchema.safeParse(data).success).toBe(false);
  });

  it('schema allows level3Hit:true and level1Hit:true simultaneously (no cross-field constraint)', () => {
    // The schema does not enforce mutual exclusivity of hit flags.
    // This documents the schema permissiveness — enforcement is in application logic.
    const data = {
      query: 'hamburguesa',
      chainSlug: null,
      level1Hit: true,
      level2Hit: false,
      level3Hit: true, // logically impossible but schema allows it
      level4Hit: false,
      matchType: 'exact_dish',
      result: { ...VALID_L3_DISH_RESULT, similarityDistance: null },
      cachedAt: null,
    };
    // Schema parses successfully — no cross-field validation
    expect(EstimateDataSchema.safeParse(data).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EstimateResponseSchema — full L3 round-trip
// The developer's round-trip tests only use L1 results. These cover L3.
// ---------------------------------------------------------------------------

describe('EstimateResponseSchema — Level 3 round-trip', () => {
  it('round-trips a complete L3 dish hit response', () => {
    const response = {
      success: true as const,
      data: {
        query: 'hamburguesa',
        chainSlug: 'burger-king-es',
        level1Hit: false,
        level2Hit: false,
        level3Hit: true,
        level4Hit: false,
        matchType: 'similarity_dish',
        result: VALID_L3_DISH_RESULT,
        cachedAt: null,
      },
    };
    const result = EstimateResponseSchema.safeParse(response);
    if (!result.success) {
      throw new Error(`Schema failed: ${JSON.stringify(result.error.issues)}`);
    }
    expect(result.success).toBe(true);
    // Verify the parsed similarityDistance is preserved
    if (result.data.data.result) {
      expect(result.data.data.result.similarityDistance).toBeCloseTo(0.18, 5);
    }
  });

  it('round-trips a complete L3 food hit response', () => {
    const response = {
      success: true as const,
      data: {
        query: 'ternera picada',
        chainSlug: null,
        level1Hit: false,
        level2Hit: false,
        level3Hit: true,
        level4Hit: false,
        matchType: 'similarity_food',
        result: VALID_L3_FOOD_RESULT,
        cachedAt: null,
      },
    };
    const result = EstimateResponseSchema.safeParse(response);
    if (!result.success) {
      throw new Error(`Schema failed: ${JSON.stringify(result.error.issues)}`);
    }
    expect(result.success).toBe(true);
  });

  it('round-trips an L3 cached response with cachedAt timestamp', () => {
    const response = {
      success: true as const,
      data: {
        query: 'hamburguesa',
        chainSlug: 'burger-king-es',
        level1Hit: false,
        level2Hit: false,
        level3Hit: true,
        level4Hit: false,
        matchType: 'similarity_dish',
        result: VALID_L3_DISH_RESULT,
        cachedAt: '2026-03-19T11:00:00.000Z',
      },
    };
    expect(EstimateResponseSchema.safeParse(response).success).toBe(true);
  });

  it('total miss with level3Hit:false validates correctly', () => {
    const response = {
      success: true as const,
      data: {
        query: 'something completely unknown',
        chainSlug: null,
        level1Hit: false,
        level2Hit: false,
        level3Hit: false,
        level4Hit: false,
        matchType: null,
        result: null,
        cachedAt: null,
      },
    };
    expect(EstimateResponseSchema.safeParse(response).success).toBe(true);
  });
});
