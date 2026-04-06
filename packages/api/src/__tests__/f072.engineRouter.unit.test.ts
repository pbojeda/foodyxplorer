// Unit tests for F072 integration into runEstimationCascade.
//
// Verifies that:
// - cookingState / cookingMethod are accepted in EngineRouterOptions
// - resolveAndApplyYield is called with the result and rawFoodGroup
// - yieldAdjustment is included in the returned data
// - dish results have food_group = null → dish_always_as_served reason
// - food results thread rawFoodGroup from the level result

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import type { PrismaClient } from '@prisma/client';
import type { DB } from '../generated/kysely-types.js';

// ---------------------------------------------------------------------------
// Mock level lookups
// ---------------------------------------------------------------------------

const { mockLevel1Lookup } = vi.hoisted(() => ({ mockLevel1Lookup: vi.fn() }));
const { mockLevel2Lookup } = vi.hoisted(() => ({ mockLevel2Lookup: vi.fn() }));
const { mockLevel3Lookup } = vi.hoisted(() => ({ mockLevel3Lookup: vi.fn() }));

vi.mock('../estimation/level1Lookup.js', () => ({ level1Lookup: mockLevel1Lookup, offFallbackFoodMatch: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../estimation/level2Lookup.js', () => ({ level2Lookup: mockLevel2Lookup }));
vi.mock('../estimation/level3Lookup.js', () => ({ level3Lookup: mockLevel3Lookup }));

// ---------------------------------------------------------------------------
// Mock resolveAndApplyYield
// ---------------------------------------------------------------------------

const { mockResolveAndApplyYield } = vi.hoisted(() => ({ mockResolveAndApplyYield: vi.fn() }));

vi.mock('../estimation/applyYield.js', () => ({
  resolveAndApplyYield: mockResolveAndApplyYield,
}));

// ---------------------------------------------------------------------------
// Import module under test (after all vi.mock calls)
// ---------------------------------------------------------------------------

import { runEstimationCascade } from '../estimation/engineRouter.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_DB = {} as Kysely<DB>;
const MOCK_PRISMA = {} as PrismaClient;

const DISH_NUTRIENTS = {
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
  alcohol: 0,
  referenceBasis: 'per_serving' as const,
};

const FOOD_NUTRIENTS = {
  ...DISH_NUTRIENTS,
  referenceBasis: 'per_100g' as const,
};

const MOCK_DISH_RESULT = {
  entityType: 'dish' as const,
  entityId: 'fd000000-0072-4000-a000-000000000001',
  name: 'Big Mac',
  nameEs: 'Big Mac',
  restaurantId: 'fd000000-0072-4000-a000-000000000002',
  chainSlug: 'mcdonalds-es',
  portionGrams: 215,
  nutrients: DISH_NUTRIENTS,
  confidenceLevel: 'high' as const,
  estimationMethod: 'official' as const,
  source: {
    id: 'fd000000-0072-4000-a000-000000000003',
    name: "McDonald's Spain",
    type: 'official' as const,
    url: null,
  },
  similarityDistance: null,
};

const MOCK_FOOD_RESULT = {
  entityType: 'food' as const,
  entityId: 'fd000000-0072-4000-a000-000000000010',
  name: 'rice',
  nameEs: 'arroz',
  restaurantId: null,
  chainSlug: null,
  portionGrams: null,
  nutrients: FOOD_NUTRIENTS,
  confidenceLevel: 'high' as const,
  estimationMethod: 'official' as const,
  source: {
    id: 'fd000000-0072-4000-a000-000000000011',
    name: 'USDA',
    type: 'official' as const,
    url: null,
  },
  similarityDistance: null,
};

const MOCK_YIELD_ADJUSTMENT = {
  applied: false,
  cookingState: 'as_served' as const,
  cookingStateSource: 'none' as const,
  cookingMethod: null,
  yieldFactor: null,
  fatAbsorptionApplied: false,
  reason: 'dish_always_as_served' as const,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runEstimationCascade — F072 yield integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockLevel1Lookup.mockResolvedValue(null);
    mockLevel2Lookup.mockResolvedValue(null);
    mockLevel3Lookup.mockResolvedValue(null);
    // Default: resolveAndApplyYield returns passthrough
    mockResolveAndApplyYield.mockResolvedValue({
      result: MOCK_DISH_RESULT,
      yieldAdjustment: MOCK_YIELD_ADJUSTMENT,
    });
  });

  // -------------------------------------------------------------------------
  // yieldAdjustment in returned data
  // -------------------------------------------------------------------------

  it('L1 dish hit → resolveAndApplyYield called, yieldAdjustment in data', async () => {
    mockLevel1Lookup.mockResolvedValueOnce({
      matchType: 'exact_dish',
      result: MOCK_DISH_RESULT,
      rawFoodGroup: null,
    });

    const result = await runEstimationCascade({
      db: MOCK_DB,
      query: 'Big Mac',
      chainSlug: 'mcdonalds-es',
      prisma: MOCK_PRISMA,
    });

    expect(mockResolveAndApplyYield).toHaveBeenCalledOnce();
    expect(result.data.yieldAdjustment).toEqual(MOCK_YIELD_ADJUSTMENT);
  });

  it('L1 food hit → resolveAndApplyYield receives rawFoodGroup from level result', async () => {
    const foodL1Result = {
      matchType: 'exact_food' as const,
      result: MOCK_FOOD_RESULT,
      rawFoodGroup: 'Cereal Grains and Pasta',
    };
    mockLevel1Lookup.mockResolvedValueOnce(foodL1Result);
    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: MOCK_FOOD_RESULT,
      yieldAdjustment: { ...MOCK_YIELD_ADJUSTMENT, reason: 'cooked_state_applied', applied: true },
    });

    await runEstimationCascade({
      db: MOCK_DB,
      query: 'rice',
      cookingState: 'cooked',
      cookingMethod: 'boiled',
      prisma: MOCK_PRISMA,
    });

    expect(mockResolveAndApplyYield).toHaveBeenCalledWith(
      expect.objectContaining({
        result: MOCK_FOOD_RESULT,
        rawFoodGroup: 'Cereal Grains and Pasta',
        cookingState: 'cooked',
        cookingMethod: 'boiled',
      }),
    );
  });

  it('total miss → resolveAndApplyYield not called, yieldAdjustment is null', async () => {
    const result = await runEstimationCascade({
      db: MOCK_DB,
      query: 'unknown food item',
    });

    expect(mockResolveAndApplyYield).not.toHaveBeenCalled();
    expect(result.data.yieldAdjustment).toBeNull();
  });

  it('L2 hit → resolveAndApplyYield called with rawFoodGroup null (dish entity)', async () => {
    mockLevel2Lookup.mockResolvedValueOnce({
      matchType: 'ingredient_dish_exact',
      result: MOCK_DISH_RESULT,
      resolvedCount: 2,
      totalCount: 2,
      ingredientSources: [],
    });
    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: MOCK_DISH_RESULT,
      yieldAdjustment: MOCK_YIELD_ADJUSTMENT,
    });

    const result = await runEstimationCascade({
      db: MOCK_DB,
      query: 'pollo con verduras',
      prisma: MOCK_PRISMA,
    });

    expect(mockResolveAndApplyYield).toHaveBeenCalledWith(
      expect.objectContaining({
        rawFoodGroup: null,
      }),
    );
    expect(result.data.yieldAdjustment).toEqual(MOCK_YIELD_ADJUSTMENT);
  });

  it('L3 food hit → resolveAndApplyYield receives rawFoodGroup from L3 result', async () => {
    mockLevel3Lookup.mockResolvedValueOnce({
      matchType: 'similarity_food',
      result: MOCK_FOOD_RESULT,
      similarityDistance: 0.25,
      rawFoodGroup: 'Vegetables and Vegetable Products',
    });
    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: MOCK_FOOD_RESULT,
      yieldAdjustment: MOCK_YIELD_ADJUSTMENT,
    });

    await runEstimationCascade({
      db: MOCK_DB,
      query: 'brocolli',
      openAiApiKey: 'test-key',
      prisma: MOCK_PRISMA,
    });

    expect(mockResolveAndApplyYield).toHaveBeenCalledWith(
      expect.objectContaining({
        rawFoodGroup: 'Vegetables and Vegetable Products',
      }),
    );
  });

  it('cookingState and cookingMethod passed through to resolveAndApplyYield', async () => {
    mockLevel1Lookup.mockResolvedValueOnce({
      matchType: 'exact_food',
      result: MOCK_FOOD_RESULT,
      rawFoodGroup: 'Legumes and Legume Products',
    });

    await runEstimationCascade({
      db: MOCK_DB,
      query: 'lentils',
      cookingState: 'raw',
      cookingMethod: 'boiled',
      prisma: MOCK_PRISMA,
    });

    expect(mockResolveAndApplyYield).toHaveBeenCalledWith(
      expect.objectContaining({
        cookingState: 'raw',
        cookingMethod: 'boiled',
      }),
    );
  });

  // -------------------------------------------------------------------------
  // F074 — Test 35: L4 perIngredientYieldApplied path
  // -------------------------------------------------------------------------

  it('F074 test 35: when L4 returns perIngredientYieldApplied=true with yieldAdjustment, router uses it directly and does NOT call resolveAndApplyYield', async () => {
    const precomputedYieldAdjustment = {
      applied: true,
      cookingState: 'cooked' as const,
      cookingStateSource: 'llm_extracted' as const,
      cookingMethod: 'boiled',
      yieldFactor: 2.8,
      fatAbsorptionApplied: false,
      reason: 'per_ingredient_yield_applied' as const,
    };

    const mockL4Lookup = vi.fn().mockResolvedValueOnce({
      matchType: 'llm_ingredient_decomposition' as const,
      result: MOCK_FOOD_RESULT,
      rawFoodGroup: null,
      perIngredientYieldApplied: true,
      yieldAdjustment: precomputedYieldAdjustment,
    });

    const result = await runEstimationCascade({
      db: MOCK_DB,
      query: 'arroz con pollo cocido',
      prisma: MOCK_PRISMA,
      level4Lookup: mockL4Lookup,
    });

    // Router must NOT call resolveAndApplyYield — yield was already applied per-ingredient
    expect(mockResolveAndApplyYield).not.toHaveBeenCalled();

    // Router must use the pre-computed yieldAdjustment directly
    expect(result.data.yieldAdjustment).toEqual(precomputedYieldAdjustment);
    expect(result.data.matchType).toBe('llm_ingredient_decomposition');
    expect(result.levelHit).toBe(4);
  });
});
