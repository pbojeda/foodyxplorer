// Unit tests for F072 cookingProfile schemas
//
// Covers: CookingStateSchema, CookingStateSourceSchema, YieldAdjustmentReasonSchema,
//         YieldAdjustmentSchema, CookingProfileSchema
// Also covers: extensions to EstimateQuerySchema, EstimateDataSchema,
//              RecipeIngredientInputSchema, ResolvedAsSchema

import { describe, it, expect } from 'vitest';
import {
  CookingStateSchema,
  CookingStateSourceSchema,
  YieldAdjustmentReasonSchema,
  YieldAdjustmentSchema,
  CookingProfileSchema,
} from '../schemas/cookingProfile.js';
import { EstimateQuerySchema, EstimateDataSchema } from '../schemas/estimate.js';
import { RecipeIngredientInputSchema, ResolvedAsSchema } from '../schemas/recipeCalculate.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_YIELD_ADJUSTMENT = {
  applied: true,
  cookingState: 'cooked',
  cookingStateSource: 'explicit',
  cookingMethod: 'boiled',
  yieldFactor: 2.8,
  fatAbsorptionApplied: false,
  reason: 'cooked_state_applied',
};

const VALID_NUTRIENTS = {
  calories: 130,
  proteins: 2.7,
  carbohydrates: 28.2,
  sugars: 0.1,
  fats: 0.3,
  saturatedFats: 0.1,
  fiber: 0.4,
  salt: 0.0,
  sodium: 1.0,
  transFats: 0.0,
  cholesterol: 0.0,
  potassium: 35.0,
  monounsaturatedFats: 0.1,
  polyunsaturatedFats: 0.1,
  alcohol: 0,
  referenceBasis: 'per_100g' as const,
};

const VALID_SOURCE = {
  id: 'fd000000-0001-4000-a000-000000000001',
  name: 'USDA',
  type: 'official' as const,
  url: null,
};

const VALID_RESULT = {
  entityType: 'food' as const,
  entityId: 'fd000000-0001-4000-a000-000000000002',
  name: 'Rice',
  nameEs: 'Arroz',
  restaurantId: null,
  chainSlug: null,
  portionGrams: null,
  nutrients: VALID_NUTRIENTS,
  confidenceLevel: 'high' as const,
  estimationMethod: 'official' as const,
  source: VALID_SOURCE,
  similarityDistance: null,
};

// ---------------------------------------------------------------------------
// CookingStateSchema
// ---------------------------------------------------------------------------

describe('CookingStateSchema', () => {
  it('accepts "raw"', () => {
    expect(CookingStateSchema.safeParse('raw').success).toBe(true);
  });

  it('accepts "cooked"', () => {
    expect(CookingStateSchema.safeParse('cooked').success).toBe(true);
  });

  it('accepts "as_served"', () => {
    expect(CookingStateSchema.safeParse('as_served').success).toBe(true);
  });

  it('rejects "baked"', () => {
    expect(CookingStateSchema.safeParse('baked').success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(CookingStateSchema.safeParse('').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CookingStateSourceSchema
// ---------------------------------------------------------------------------

describe('CookingStateSourceSchema', () => {
  it('accepts "explicit"', () => {
    expect(CookingStateSourceSchema.safeParse('explicit').success).toBe(true);
  });

  it('accepts "default_assumption"', () => {
    expect(CookingStateSourceSchema.safeParse('default_assumption').success).toBe(true);
  });

  it('accepts "none"', () => {
    expect(CookingStateSourceSchema.safeParse('none').success).toBe(true);
  });

  it('accepts "llm_extracted" (F074)', () => {
    expect(CookingStateSourceSchema.safeParse('llm_extracted').success).toBe(true);
  });

  it('rejects "unknown"', () => {
    expect(CookingStateSourceSchema.safeParse('unknown').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// YieldAdjustmentReasonSchema
// ---------------------------------------------------------------------------

describe('YieldAdjustmentReasonSchema', () => {
  const validReasons = [
    'cooked_state_applied',
    'raw_state_no_correction',
    'as_served_passthrough',
    'no_profile_found',
    'dish_always_as_served',
    'nutrients_not_per_100g',
    'db_food_already_cooked',
    'cannot_reverse_cooked_to_raw',
    'invalid_yield_factor',
    'per_ingredient_yield_applied',  // F074
  ];

  it('accepts all 10 valid reason values (including F074 per_ingredient_yield_applied)', () => {
    for (const reason of validReasons) {
      expect(YieldAdjustmentReasonSchema.safeParse(reason).success).toBe(true);
    }
  });

  it('rejects "unknown_reason"', () => {
    expect(YieldAdjustmentReasonSchema.safeParse('unknown_reason').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// YieldAdjustmentSchema
// ---------------------------------------------------------------------------

describe('YieldAdjustmentSchema', () => {
  it('parses a valid full yield adjustment with fat absorption', () => {
    const input = {
      ...VALID_YIELD_ADJUSTMENT,
      fatAbsorptionApplied: true,
    };
    expect(YieldAdjustmentSchema.safeParse(input).success).toBe(true);
  });

  it('parses applied=false adjustment with null yieldFactor', () => {
    const input = {
      applied: false,
      cookingState: 'raw',
      cookingStateSource: 'default_assumption',
      cookingMethod: null,
      yieldFactor: null,
      fatAbsorptionApplied: false,
      reason: 'raw_state_no_correction',
    };
    expect(YieldAdjustmentSchema.safeParse(input).success).toBe(true);
  });

  it('parses dish_always_as_served scenario', () => {
    const input = {
      applied: false,
      cookingState: 'as_served',
      cookingStateSource: 'none',
      cookingMethod: null,
      yieldFactor: null,
      fatAbsorptionApplied: false,
      reason: 'dish_always_as_served',
    };
    expect(YieldAdjustmentSchema.safeParse(input).success).toBe(true);
  });

  it('rejects missing required field "applied"', () => {
    const { applied: _a, ...withoutApplied } = VALID_YIELD_ADJUSTMENT;
    expect(YieldAdjustmentSchema.safeParse(withoutApplied).success).toBe(false);
  });

  it('rejects missing required field "reason"', () => {
    const { reason: _r, ...withoutReason } = VALID_YIELD_ADJUSTMENT;
    expect(YieldAdjustmentSchema.safeParse(withoutReason).success).toBe(false);
  });

  it('rejects invalid reason value', () => {
    const input = { ...VALID_YIELD_ADJUSTMENT, reason: 'not_a_reason' };
    expect(YieldAdjustmentSchema.safeParse(input).success).toBe(false);
  });

  it('rejects invalid cookingStateSource value', () => {
    const input = { ...VALID_YIELD_ADJUSTMENT, cookingStateSource: 'implicit' };
    expect(YieldAdjustmentSchema.safeParse(input).success).toBe(false);
  });

  it('rejects yieldFactor of 0 (must be positive or null)', () => {
    const input = { ...VALID_YIELD_ADJUSTMENT, yieldFactor: 0 };
    expect(YieldAdjustmentSchema.safeParse(input).success).toBe(false);
  });

  it('rejects negative yieldFactor', () => {
    const input = { ...VALID_YIELD_ADJUSTMENT, yieldFactor: -1.0 };
    expect(YieldAdjustmentSchema.safeParse(input).success).toBe(false);
  });

  it('accepts yieldFactor > 1 (absorbs water like grains)', () => {
    const input = { ...VALID_YIELD_ADJUSTMENT, yieldFactor: 2.8 };
    expect(YieldAdjustmentSchema.safeParse(input).success).toBe(true);
  });

  it('accepts yieldFactor < 1 (loses moisture like meat)', () => {
    const input = { ...VALID_YIELD_ADJUSTMENT, yieldFactor: 0.75 };
    expect(YieldAdjustmentSchema.safeParse(input).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CookingProfileSchema
// ---------------------------------------------------------------------------

describe('CookingProfileSchema', () => {
  const VALID_PROFILE = {
    id: 'fd000000-0001-4000-a000-000000000010',
    foodGroup: 'grains',
    foodName: 'rice',
    cookingMethod: 'boiled',
    yieldFactor: 2.8,
    fatAbsorption: null,
    source: 'USDA retention factors',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('parses a valid profile', () => {
    expect(CookingProfileSchema.safeParse(VALID_PROFILE).success).toBe(true);
  });

  it('parses a sentinel foodName "*"', () => {
    const input = { ...VALID_PROFILE, foodName: '*' };
    expect(CookingProfileSchema.safeParse(input).success).toBe(true);
  });

  it('parses a profile with non-null fatAbsorption (fried foods)', () => {
    const input = { ...VALID_PROFILE, foodName: 'potato', cookingMethod: 'fried', fatAbsorption: 14.0 };
    expect(CookingProfileSchema.safeParse(input).success).toBe(true);
  });

  it('rejects non-UUID id', () => {
    const input = { ...VALID_PROFILE, id: 'not-a-uuid' };
    expect(CookingProfileSchema.safeParse(input).success).toBe(false);
  });

  it('rejects non-positive yieldFactor', () => {
    const input = { ...VALID_PROFILE, yieldFactor: 0 };
    expect(CookingProfileSchema.safeParse(input).success).toBe(false);
  });

  it('rejects negative fatAbsorption', () => {
    const input = { ...VALID_PROFILE, fatAbsorption: -1 };
    expect(CookingProfileSchema.safeParse(input).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EstimateQuerySchema — extended with cookingState / cookingMethod
// ---------------------------------------------------------------------------

describe('EstimateQuerySchema — F072 extensions', () => {
  it('accepts cookingState "raw"', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'arroz', cookingState: 'raw' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.cookingState).toBe('raw');
  });

  it('accepts cookingState "cooked"', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'arroz', cookingState: 'cooked' });
    expect(result.success).toBe(true);
  });

  it('accepts cookingState "as_served"', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'arroz', cookingState: 'as_served' });
    expect(result.success).toBe(true);
  });

  it('accepts cookingMethod string', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'arroz', cookingMethod: 'boiled' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.cookingMethod).toBe('boiled');
  });

  it('rejects invalid cookingState value', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'arroz', cookingState: 'grilled' });
    expect(result.success).toBe(false);
  });

  it('rejects cookingMethod exceeding 100 chars', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'arroz', cookingMethod: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('omitting cookingState and cookingMethod still parses', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'arroz' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cookingState).toBeUndefined();
      expect(result.data.cookingMethod).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// EstimateDataSchema — extended with yieldAdjustment
// ---------------------------------------------------------------------------

describe('EstimateDataSchema — F072 yieldAdjustment extension', () => {
  const BASE_DATA = {
    query: 'arroz',
    chainSlug: null,
    portionMultiplier: 1.0,
    level1Hit: true,
    level2Hit: false,
    level3Hit: false,
    level4Hit: false,
    matchType: 'exact_food' as const,
    result: VALID_RESULT,
    cachedAt: null,
  };

  it('accepts null yieldAdjustment (no correction applied)', () => {
    const result = EstimateDataSchema.safeParse({ ...BASE_DATA, yieldAdjustment: null });
    expect(result.success).toBe(true);
  });

  it('accepts valid yieldAdjustment object', () => {
    const result = EstimateDataSchema.safeParse({
      ...BASE_DATA,
      yieldAdjustment: VALID_YIELD_ADJUSTMENT,
    });
    expect(result.success).toBe(true);
  });

  it('accepts missing yieldAdjustment field (backward compatibility)', () => {
    // yieldAdjustment is nullable with a default — existing responses without it are valid
    const result = EstimateDataSchema.safeParse(BASE_DATA);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RecipeIngredientInputSchema — extended with cookingState / cookingMethod
// ---------------------------------------------------------------------------

describe('RecipeIngredientInputSchema — F072 extensions', () => {
  const VALID_INPUT = {
    foodId: 'fd000000-0001-4000-a000-000000000001',
    grams: 100,
  };

  it('accepts cookingState "cooked" alongside foodId', () => {
    const result = RecipeIngredientInputSchema.safeParse({
      ...VALID_INPUT,
      cookingState: 'cooked',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.cookingState).toBe('cooked');
  });

  it('accepts cookingMethod alongside foodId', () => {
    const result = RecipeIngredientInputSchema.safeParse({
      ...VALID_INPUT,
      cookingMethod: 'boiled',
    });
    expect(result.success).toBe(true);
  });

  it('accepts both cookingState and cookingMethod', () => {
    const result = RecipeIngredientInputSchema.safeParse({
      ...VALID_INPUT,
      cookingState: 'raw',
      cookingMethod: 'grilled',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid cookingState', () => {
    const result = RecipeIngredientInputSchema.safeParse({
      ...VALID_INPUT,
      cookingState: 'medium_rare',
    });
    expect(result.success).toBe(false);
  });

  it('omitting cookingState and cookingMethod still parses (backward compat)', () => {
    const result = RecipeIngredientInputSchema.safeParse(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cookingState).toBeUndefined();
      expect(result.data.cookingMethod).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// ResolvedAsSchema — extended with yieldAdjustment
// ---------------------------------------------------------------------------

describe('ResolvedAsSchema — F072 yieldAdjustment extension', () => {
  const VALID_RESOLVED_AS = {
    entityId: 'fd000000-0001-4000-a000-000000000001',
    name: 'Rice',
    nameEs: 'Arroz',
    matchType: 'exact_food' as const,
  };

  it('accepts null yieldAdjustment', () => {
    const result = ResolvedAsSchema.safeParse({
      ...VALID_RESOLVED_AS,
      yieldAdjustment: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid yieldAdjustment', () => {
    const result = ResolvedAsSchema.safeParse({
      ...VALID_RESOLVED_AS,
      yieldAdjustment: VALID_YIELD_ADJUSTMENT,
    });
    expect(result.success).toBe(true);
  });

  it('accepts missing yieldAdjustment (backward compat)', () => {
    const result = ResolvedAsSchema.safeParse(VALID_RESOLVED_AS);
    expect(result.success).toBe(true);
  });
});
