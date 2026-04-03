// Unit tests for F072 — applyYield.ts (resolveAndApplyYield)
//
// Covers all 11 edge cases from the spec + all 9 reason enum values:
//   1.  dish entityType → dish_always_as_served
//   2.  referenceBasis = per_serving → nutrients_not_per_100g
//   3.  isAlreadyCookedFood + cookingState=cooked → db_food_already_cooked
//   4.  isAlreadyCookedFood + cookingState=raw → cannot_reverse_cooked_to_raw (+ warn)
//   5.  cookingState=as_served (explicit) → as_served_passthrough
//   6.  cookingState=raw → raw_state_no_correction
//   7.  cookingState=cooked, profile found → cooked_state_applied (nutrients corrected)
//   8.  cookingState=cooked, no profile → no_profile_found
//   9.  Default cooking state fires (grains → cooked, meat → raw)
//   10. cookingStateSource: explicit vs default_assumption
//   11. Fat absorption: fried with fatAbsorption → applied; non-fried with fatAbsorption → warn
//   12. Invalid yield factor → invalid_yield_factor

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EstimateResult } from '@foodxplorer/shared';
import { resolveAndApplyYield } from '../estimation/applyYield.js';
import type { ApplyYieldOptions } from '../estimation/applyYield.js';
import * as cookingProfileService from '../estimation/cookingProfileService.js';
import type { CookingProfileRow } from '../estimation/cookingProfileService.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../estimation/cookingProfileService.js');
const mockGetCookingProfile = vi.mocked(cookingProfileService.getCookingProfile);

const mockLogger = {
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDecimal(value: number): import('@prisma/client').Prisma.Decimal {
  return {
    valueOf: () => value,
    toNumber: () => value,
    toString: () => String(value),
    [Symbol.toPrimitive]: (_hint: string) => value,
  } as unknown as import('@prisma/client').Prisma.Decimal;
}

const BASE_NUTRIENTS = {
  calories: 360,
  proteins: 7.0,
  carbohydrates: 79.0,
  sugars: 0.1,
  fats: 0.6,
  saturatedFats: 0.1,
  fiber: 1.3,
  salt: 0.0,
  sodium: 1.0,
  transFats: 0.0,
  cholesterol: 0.0,
  potassium: 100.0,
  monounsaturatedFats: 0.1,
  polyunsaturatedFats: 0.1,
  referenceBasis: 'per_100g' as const,
};

function makeFoodResult(overrides: Partial<EstimateResult> = {}): EstimateResult {
  return {
    entityType: 'food',
    entityId: 'fd000000-0001-4000-a000-000000000001',
    name: 'White rice',
    nameEs: 'Arroz blanco',
    restaurantId: null,
    chainSlug: null,
    portionGrams: null,
    nutrients: { ...BASE_NUTRIENTS },
    confidenceLevel: 'high',
    estimationMethod: 'official',
    source: {
      id: 'src-001',
      name: 'USDA',
      type: 'official',
      url: null,
      priorityTier: null,
    },
    similarityDistance: null,
    ...overrides,
  };
}

function makeDishResult(): EstimateResult {
  return {
    entityType: 'dish',
    entityId: 'fd000000-0002-4000-a000-000000000001',
    name: 'Big Mac',
    nameEs: null,
    restaurantId: 'rest-001',
    chainSlug: 'mcdonalds',
    portionGrams: 200,
    nutrients: { ...BASE_NUTRIENTS },
    confidenceLevel: 'high',
    estimationMethod: 'official',
    source: {
      id: 'src-002',
      name: 'McDonalds',
      type: 'official',
      url: null,
      priorityTier: null,
    },
    similarityDistance: null,
  };
}

const MOCK_PRISMA = {} as unknown as import('@prisma/client').PrismaClient;

function makeRiceProfile(yieldFactor: number = 2.8): { profile: CookingProfileRow } {
  return {
    profile: {
      id: 'e0000000-0001-4000-0000-000000000001',
      foodGroup: 'grains',
      foodName: 'rice',
      cookingMethod: 'boiled',
      yieldFactor: makeDecimal(yieldFactor),
      fatAbsorption: null,
      source: 'USDA retention factors',
      createdAt: new Date('2026-04-03'),
      updatedAt: new Date('2026-04-03'),
    },
  };
}

function makeChickenProfile(cookingMethod: string = 'fried', fatAbsorption: number | null = null): { profile: CookingProfileRow } {
  return {
    profile: {
      id: 'e0000000-0005-4000-0000-000000000001',
      foodGroup: 'meat',
      foodName: 'chicken',
      cookingMethod,
      yieldFactor: makeDecimal(0.85),
      fatAbsorption: fatAbsorption !== null ? makeDecimal(fatAbsorption) : null,
      source: 'USDA retention factors',
      createdAt: new Date('2026-04-03'),
      updatedAt: new Date('2026-04-03'),
    },
  };
}

function baseOpts(overrides: Partial<ApplyYieldOptions> = {}): ApplyYieldOptions {
  return {
    result: makeFoodResult(),
    foodName: 'White rice',
    rawFoodGroup: 'Cereal Grains',
    cookingState: undefined,
    cookingMethod: undefined,
    prisma: MOCK_PRISMA,
    logger: mockLogger,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveAndApplyYield', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Edge case 1: dish entity → always as_served
  // -------------------------------------------------------------------------
  it('returns dish_always_as_served for dish entityType', async () => {
    // Arrange
    const opts = baseOpts({ result: makeDishResult() });

    // Act
    const { result, yieldAdjustment } = await resolveAndApplyYield(opts);

    // Assert
    expect(yieldAdjustment.reason).toBe('dish_always_as_served');
    expect(yieldAdjustment.applied).toBe(false);
    expect(yieldAdjustment.fatAbsorptionApplied).toBe(false);
    expect(result.nutrients).toEqual(makeDishResult().nutrients);
    expect(mockGetCookingProfile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Edge case 2: per_serving reference basis → cannot apply yield
  // -------------------------------------------------------------------------
  it('returns nutrients_not_per_100g when referenceBasis is per_serving', async () => {
    // Arrange
    const result = makeFoodResult({
      nutrients: { ...BASE_NUTRIENTS, referenceBasis: 'per_serving' },
    });
    const opts = baseOpts({ result });

    // Act
    const { yieldAdjustment } = await resolveAndApplyYield(opts);

    // Assert
    expect(yieldAdjustment.reason).toBe('nutrients_not_per_100g');
    expect(yieldAdjustment.applied).toBe(false);
    expect(mockGetCookingProfile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Edge case 3: already-cooked food + cookingState=cooked → db_food_already_cooked
  // -------------------------------------------------------------------------
  it('returns db_food_already_cooked for already-cooked food with cooked state', async () => {
    // Arrange — "Arroz hervido" contains "hervido" keyword
    const opts = baseOpts({
      foodName: 'Arroz hervido',
      cookingState: 'cooked',
    });

    // Act
    const { yieldAdjustment } = await resolveAndApplyYield(opts);

    // Assert
    expect(yieldAdjustment.reason).toBe('db_food_already_cooked');
    expect(yieldAdjustment.applied).toBe(false);
    expect(yieldAdjustment.cookingState).toBe('cooked');
    expect(yieldAdjustment.cookingStateSource).toBe('explicit');
    expect(mockGetCookingProfile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Edge case 4: already-cooked food + cookingState=raw → cannot_reverse_cooked_to_raw
  // -------------------------------------------------------------------------
  it('returns cannot_reverse_cooked_to_raw for already-cooked food with raw state, logs warn', async () => {
    // Arrange
    const opts = baseOpts({
      foodName: 'Chicken boiled',
      cookingState: 'raw',
    });

    // Act
    const { yieldAdjustment } = await resolveAndApplyYield(opts);

    // Assert
    expect(yieldAdjustment.reason).toBe('cannot_reverse_cooked_to_raw');
    expect(yieldAdjustment.applied).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledOnce();
    expect(mockGetCookingProfile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Edge case 5: explicit as_served → as_served_passthrough
  // -------------------------------------------------------------------------
  it('returns as_served_passthrough for explicit as_served cookingState', async () => {
    // Arrange
    const opts = baseOpts({ cookingState: 'as_served' });

    // Act
    const { yieldAdjustment } = await resolveAndApplyYield(opts);

    // Assert
    expect(yieldAdjustment.reason).toBe('as_served_passthrough');
    expect(yieldAdjustment.applied).toBe(false);
    expect(yieldAdjustment.cookingState).toBe('as_served');
    expect(yieldAdjustment.cookingStateSource).toBe('explicit');
    expect(mockGetCookingProfile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Edge case 6: explicit raw → raw_state_no_correction
  // -------------------------------------------------------------------------
  it('returns raw_state_no_correction for explicit raw cookingState', async () => {
    // Arrange
    const opts = baseOpts({ cookingState: 'raw', rawFoodGroup: 'Beef Products' });

    // Act
    const { yieldAdjustment } = await resolveAndApplyYield(opts);

    // Assert
    expect(yieldAdjustment.reason).toBe('raw_state_no_correction');
    expect(yieldAdjustment.applied).toBe(false);
    expect(yieldAdjustment.cookingState).toBe('raw');
    expect(yieldAdjustment.cookingStateSource).toBe('explicit');
    expect(mockGetCookingProfile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Edge case 7: cooked state + profile found → cooked_state_applied
  // -------------------------------------------------------------------------
  it('applies yield correction when cooked state and profile found', async () => {
    // Arrange
    mockGetCookingProfile.mockResolvedValueOnce(makeRiceProfile(2.8));
    const opts = baseOpts({
      cookingState: 'cooked',
      cookingMethod: 'boiled',
      rawFoodGroup: 'Cereal Grains',
    });

    // Act
    const { result, yieldAdjustment } = await resolveAndApplyYield(opts);

    // Assert
    expect(yieldAdjustment.reason).toBe('cooked_state_applied');
    expect(yieldAdjustment.applied).toBe(true);
    expect(yieldAdjustment.yieldFactor).toBe(2.8);
    expect(yieldAdjustment.fatAbsorptionApplied).toBe(false);
    expect(yieldAdjustment.cookingStateSource).toBe('explicit');

    // Nutrients should be divided by 2.8
    expect(result.nutrients.calories).toBeCloseTo(BASE_NUTRIENTS.calories / 2.8);
    expect(result.nutrients.proteins).toBeCloseTo(BASE_NUTRIENTS.proteins / 2.8);
    expect(result.nutrients.carbohydrates).toBeCloseTo(BASE_NUTRIENTS.carbohydrates / 2.8);
    // referenceBasis unchanged
    expect(result.nutrients.referenceBasis).toBe('per_100g');
  });

  // -------------------------------------------------------------------------
  // Edge case 8: cooked state + no profile → no_profile_found
  // -------------------------------------------------------------------------
  it('returns no_profile_found when cooked state but no profile in DB', async () => {
    // Arrange
    mockGetCookingProfile.mockResolvedValueOnce(null);
    const opts = baseOpts({
      cookingState: 'cooked',
      cookingMethod: 'boiled',
    });

    // Act
    const { result, yieldAdjustment } = await resolveAndApplyYield(opts);

    // Assert
    expect(yieldAdjustment.reason).toBe('no_profile_found');
    expect(yieldAdjustment.applied).toBe(false);
    // Nutrients unchanged
    expect(result.nutrients.calories).toBe(BASE_NUTRIENTS.calories);
  });

  // -------------------------------------------------------------------------
  // Edge case 9: default cooking state fires correctly
  // -------------------------------------------------------------------------
  it('uses default cooked state for grains when cookingState omitted', async () => {
    // Arrange — grains default to cooked
    mockGetCookingProfile.mockResolvedValueOnce(makeRiceProfile(2.8));
    const opts = baseOpts({
      cookingState: undefined,
      rawFoodGroup: 'Cereal Grains',  // normalizes to 'grains'
    });

    // Act
    const { yieldAdjustment } = await resolveAndApplyYield(opts);

    // Assert — default assumption fires
    expect(yieldAdjustment.cookingStateSource).toBe('default_assumption');
    expect(yieldAdjustment.cookingState).toBe('cooked');
    expect(yieldAdjustment.reason).toBe('cooked_state_applied');
  });

  it('uses default raw state for meat when cookingState omitted', async () => {
    // Arrange — meat defaults to raw, so no profile lookup needed
    const opts = baseOpts({
      cookingState: undefined,
      rawFoodGroup: 'Beef Products',  // normalizes to 'meat'
      foodName: 'Beef steak',
    });

    // Act
    const { yieldAdjustment } = await resolveAndApplyYield(opts);

    // Assert
    expect(yieldAdjustment.cookingStateSource).toBe('default_assumption');
    expect(yieldAdjustment.cookingState).toBe('raw');
    expect(yieldAdjustment.reason).toBe('raw_state_no_correction');
    expect(mockGetCookingProfile).not.toHaveBeenCalled();
  });

  it('uses default as_served for unknown food group when cookingState omitted', async () => {
    // Arrange — null group maps to as_served
    const opts = baseOpts({
      cookingState: undefined,
      rawFoodGroup: null,
      foodName: 'Some composite dish',
    });

    // Act
    const { yieldAdjustment } = await resolveAndApplyYield(opts);

    // Assert
    expect(yieldAdjustment.cookingStateSource).toBe('default_assumption');
    expect(yieldAdjustment.cookingState).toBe('as_served');
    expect(yieldAdjustment.reason).toBe('as_served_passthrough');
  });

  // -------------------------------------------------------------------------
  // Edge case 10: cookingStateSource explicit vs default_assumption
  // -------------------------------------------------------------------------
  it('sets cookingStateSource=explicit when cookingState is provided', async () => {
    // Arrange
    const opts = baseOpts({ cookingState: 'as_served' });

    // Act
    const { yieldAdjustment } = await resolveAndApplyYield(opts);

    // Assert
    expect(yieldAdjustment.cookingStateSource).toBe('explicit');
  });

  it('sets cookingStateSource=default_assumption when cookingState is omitted', async () => {
    // Arrange — grains default to cooked
    mockGetCookingProfile.mockResolvedValueOnce(null);
    const opts = baseOpts({ cookingState: undefined, rawFoodGroup: 'Cereal Grains' });

    // Act
    const { yieldAdjustment } = await resolveAndApplyYield(opts);

    // Assert
    expect(yieldAdjustment.cookingStateSource).toBe('default_assumption');
  });

  // -------------------------------------------------------------------------
  // Edge case 11a: Fat absorption applied for fried cookingMethod
  // -------------------------------------------------------------------------
  it('applies fat absorption to fats and calories for fried cooking method', async () => {
    // Arrange — beef fried with fatAbsorption=4.5 g/100g raw
    const chickenFriedProfile = makeChickenProfile('fried', 4.5);
    mockGetCookingProfile.mockResolvedValueOnce(chickenFriedProfile);

    const chickenNutrients = {
      ...BASE_NUTRIENTS,
      calories: 165,
      fats: 3.6,
      saturatedFats: 1.0,
    };
    const result = makeFoodResult({ nutrients: chickenNutrients, name: 'Chicken breast' });
    const opts = baseOpts({
      result,
      foodName: 'Chicken breast',
      rawFoodGroup: 'Poultry Products',
      cookingState: 'cooked',
      cookingMethod: 'fried',
    });

    // Act
    const { result: corrected, yieldAdjustment } = await resolveAndApplyYield(opts);

    // Assert
    expect(yieldAdjustment.applied).toBe(true);
    expect(yieldAdjustment.fatAbsorptionApplied).toBe(true);
    expect(yieldAdjustment.reason).toBe('cooked_state_applied');

    // fats: (3.6 + 4.5) / 0.85 ≈ 9.529
    expect(corrected.nutrients.fats).toBeCloseTo((3.6 + 4.5) / 0.85, 3);
    // saturatedFats: 1.0 / 0.85 (NOT modified by fat absorption)
    expect(corrected.nutrients.saturatedFats).toBeCloseTo(1.0 / 0.85, 3);
    // calories: (165 + 4.5 * 9) / 0.85
    expect(corrected.nutrients.calories).toBeCloseTo((165 + 4.5 * 9) / 0.85, 3);
  });

  // -------------------------------------------------------------------------
  // Edge case 11b: Fat absorption NOT applied for non-fried + warn logged
  // -------------------------------------------------------------------------
  it('does not apply fat absorption for non-fried method even if profile has it, logs warn', async () => {
    // Arrange — profile has fatAbsorption but cookingMethod is grilled (not fried)
    const grilledProfileWithFat = makeChickenProfile('grilled', 4.5);
    mockGetCookingProfile.mockResolvedValueOnce(grilledProfileWithFat);

    const opts = baseOpts({
      cookingState: 'cooked',
      cookingMethod: 'grilled',
      rawFoodGroup: 'Poultry Products',
      foodName: 'Chicken breast',
    });

    // Act
    const { result: corrected, yieldAdjustment } = await resolveAndApplyYield(opts);

    // Assert
    expect(yieldAdjustment.applied).toBe(true);
    expect(yieldAdjustment.fatAbsorptionApplied).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledOnce();

    // fats divided by yieldFactor only (no absorption)
    expect(corrected.nutrients.fats).toBeCloseTo(BASE_NUTRIENTS.fats / 0.85, 3);
    // calories divided by yieldFactor only
    expect(corrected.nutrients.calories).toBeCloseTo(BASE_NUTRIENTS.calories / 0.85, 3);
  });

  // -------------------------------------------------------------------------
  // Edge case 12: invalid yield factor → invalid_yield_factor
  // -------------------------------------------------------------------------
  it('returns invalid_yield_factor when service returns error discriminant', async () => {
    // Arrange
    mockGetCookingProfile.mockResolvedValueOnce({ error: 'invalid_yield_factor' });
    const opts = baseOpts({
      cookingState: 'cooked',
      cookingMethod: 'boiled',
    });

    // Act
    const { result, yieldAdjustment } = await resolveAndApplyYield(opts);

    // Assert
    expect(yieldAdjustment.reason).toBe('invalid_yield_factor');
    expect(yieldAdjustment.applied).toBe(false);
    expect(mockLogger.error).toHaveBeenCalledOnce();
    // Nutrients unchanged
    expect(result.nutrients.calories).toBe(BASE_NUTRIENTS.calories);
  });

  // -------------------------------------------------------------------------
  // cookingMethod threading — correct values passed to getCookingProfile
  // -------------------------------------------------------------------------
  it('passes normalized group and effective cooking method to getCookingProfile', async () => {
    // Arrange
    mockGetCookingProfile.mockResolvedValueOnce(null);
    const opts = baseOpts({
      cookingState: 'cooked',
      cookingMethod: 'steamed',
      rawFoodGroup: 'Cereal Grains',
      foodName: 'Quinoa',
    });

    // Act
    await resolveAndApplyYield(opts);

    // Assert — called with normalized group 'grains', exact foodName, explicit method 'steamed'
    expect(mockGetCookingProfile).toHaveBeenCalledWith(
      MOCK_PRISMA,
      'grains',
      'Quinoa',
      'steamed',
    );
  });

  it('uses default cooking method when cookingMethod omitted', async () => {
    // Arrange — grains default to 'boiled'
    mockGetCookingProfile.mockResolvedValueOnce(null);
    const opts = baseOpts({
      cookingState: 'cooked',
      cookingMethod: undefined,
      rawFoodGroup: 'Cereal Grains',
      foodName: 'Oats',
    });

    // Act
    await resolveAndApplyYield(opts);

    // Assert — default method for grains is 'boiled'
    expect(mockGetCookingProfile).toHaveBeenCalledWith(
      MOCK_PRISMA,
      'grains',
      'Oats',
      'boiled',
    );
  });
});
