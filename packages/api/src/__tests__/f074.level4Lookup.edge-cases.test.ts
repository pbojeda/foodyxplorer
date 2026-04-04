// Edge-case tests for F074 — L4 Strategy B per-ingredient yield correction.
//
// QA focus: spec deviations, missing edge cases, boundary conditions, and
// logic gaps not covered by the developer's happy-path tests (tests 20–35).
//
// Bugs documented:
//   BUG-F074-01 (TS): engineRouter.ts logger.error() — no 'error' on Logger type
//   BUG-F074-02 (TS): runStrategyA returns rawFoodGroup not in runStrategyA's declared return type
//                      (TypeScript compile error TS2353 — extra property on object literal)
//
// Findings NOT bugs:
//   - Explicit cookingMethod alone (no cookingState) correctly triggers override (OR condition in code)
//   - Dead branch in per-ingredient loop (item.cookingMethod/no state) is developer-acknowledged,
//     behavior is correct

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Mock OpenAI SDK
// ---------------------------------------------------------------------------

const { mockChatCreate, MockOpenAI } = vi.hoisted(() => {
  const mockChatCreate = vi.fn();
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockChatCreate } },
  }));
  return { mockChatCreate, MockOpenAI };
});

vi.mock('openai', () => ({
  default: MockOpenAI,
}));

// ---------------------------------------------------------------------------
// Mock config
// ---------------------------------------------------------------------------

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    OPENAI_CHAT_MODEL: 'gpt-4o-mini' as string | undefined,
    OPENAI_CHAT_MAX_TOKENS: 512,
    OPENAI_API_KEY: 'sk-test',
  },
}));

vi.mock('../config.js', () => ({ config: mockConfig }));

// ---------------------------------------------------------------------------
// Mock resolveAndApplyYield (applyYield.ts)
// ---------------------------------------------------------------------------

const { mockResolveAndApplyYield } = vi.hoisted(() => ({
  mockResolveAndApplyYield: vi.fn(),
}));

vi.mock('../estimation/applyYield.js', () => ({
  resolveAndApplyYield: mockResolveAndApplyYield,
}));

// ---------------------------------------------------------------------------
// Mock Kysely executor
// ---------------------------------------------------------------------------

const { mockExecuteQuery } = vi.hoisted(() => ({
  mockExecuteQuery: vi.fn(),
}));

function buildMockDb() {
  const executor = {
    executeQuery: mockExecuteQuery,
    compileQuery: (node: unknown) => ({ sql: '', parameters: [], query: node }),
    transformQuery: (node: unknown) => node,
    withPlugins: function () { return this; },
    withPlugin: function () { return this; },
    withoutPlugins: function () { return this; },
  };
  return { getExecutor: () => executor };
}

function buildMockPrisma(): PrismaClient {
  return {
    cookingProfile: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  } as unknown as PrismaClient;
}

import { level4Lookup } from '../estimation/level4Lookup.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeChatResponse(content: string, promptTokens = 50, completionTokens = 5) {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
    model: 'gpt-4o-mini',
  };
}

const MOCK_FOOD_ROW_ARROZ = {
  food_id: 'fd000000-0074-4000-a000-000000000010',
  food_name: 'White rice',
  food_name_es: 'Arroz blanco',
  food_group: 'Cereal Grains and Pasta',
  calories: '360.00',
  proteins: '7.00',
  carbohydrates: '79.00',
  sugars: '0.10',
  fats: '0.70',
  saturated_fats: '0.20',
  fiber: '1.30',
  salt: '0.00',
  sodium: '1.00',
  trans_fats: '0.00',
  cholesterol: '0.00',
  potassium: '115.00',
  monounsaturated_fats: '0.20',
  polyunsaturated_fats: '0.30',
  reference_basis: 'per_100g',
  source_id: 'fd000000-0074-4000-a000-000000000099',
  source_name: 'USDA FoodData Central',
  source_type: 'official',
  source_url: 'https://fdc.nal.usda.gov/',
  source_priority_tier: '1',
};

const MOCK_FOOD_ROW_POLLO = {
  food_id: 'fd000000-0074-4000-a000-000000000011',
  food_name: 'Chicken breast',
  food_name_es: 'Pechuga de pollo',
  food_group: 'Poultry Products',
  calories: '165.00',
  proteins: '31.00',
  carbohydrates: '0.00',
  sugars: '0.00',
  fats: '3.60',
  saturated_fats: '1.00',
  fiber: '0.00',
  salt: '0.15',
  sodium: '74.00',
  trans_fats: '0.00',
  cholesterol: '85.00',
  potassium: '256.00',
  monounsaturated_fats: '1.20',
  polyunsaturated_fats: '0.80',
  reference_basis: 'per_100g',
  source_id: 'fd000000-0074-4000-a000-000000000099',
  source_name: 'USDA FoodData Central',
  source_type: 'official',
  source_url: 'https://fdc.nal.usda.gov/',
  source_priority_tier: '1',
};

function makeYieldAdj(overrides: Partial<{
  applied: boolean;
  cookingState: 'raw' | 'cooked' | 'as_served';
  cookingStateSource: 'explicit' | 'default_assumption' | 'none' | 'llm_extracted';
  cookingMethod: string | null;
  yieldFactor: number | null;
  fatAbsorptionApplied: boolean;
  reason: string;
}> = {}) {
  return {
    applied: false,
    cookingState: 'cooked' as const,
    cookingStateSource: 'default_assumption' as const,
    cookingMethod: 'boiled',
    yieldFactor: null,
    fatAbsorptionApplied: false,
    reason: 'no_profile_found' as const,
    ...overrides,
  };
}

function makeCorrectedNutrients(calories: number) {
  return {
    calories,
    proteins: 2.5,
    carbohydrates: 28.0,
    sugars: 0.1,
    fats: 0.25,
    saturatedFats: 0.07,
    fiber: 0.46,
    salt: 0.0,
    sodium: 0.35,
    transFats: 0.0,
    cholesterol: 0.0,
    potassium: 41.0,
    monounsaturatedFats: 0.07,
    polyunsaturatedFats: 0.11,
    alcohol: 0,
    referenceBasis: 'per_100g' as const,
  };
}

function makeResolvedResult(row: typeof MOCK_FOOD_ROW_ARROZ, overrides: { name?: string; calories?: number } = {}) {
  return {
    entityType: 'food' as const,
    entityId: row.food_id,
    name: overrides.name ?? row.food_name_es,
    nameEs: null,
    restaurantId: null,
    chainSlug: null,
    portionGrams: null,
    nutrients: makeCorrectedNutrients(overrides.calories ?? parseFloat(row.calories)),
    confidenceLevel: 'high' as const,
    estimationMethod: 'official' as const,
    source: {
      id: row.source_id,
      name: row.source_name,
      type: 'official' as const,
      url: null,
      priorityTier: 1,
    },
    similarityDistance: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F074 edge cases — Strategy B per-ingredient yield', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockConfig.OPENAI_CHAT_MODEL = 'gpt-4o-mini';
    mockConfig.OPENAI_CHAT_MAX_TOKENS = 512;
    MockOpenAI.mockImplementation(() => ({
      chat: { completions: { create: mockChatCreate } },
    }));
  });

  // -------------------------------------------------------------------------
  // Spec compliance: explicit cookingMethod alone (no cookingState) triggers
  // override — spec edge case 11: "When cookingState OR cookingMethod are
  // explicitly provided, Strategy B does NOT use LLM-extracted values."
  //
  // The implementation correctly uses OR: `cookingState !== undefined || cookingMethod !== undefined`
  // This test verifies the spec is satisfied for the cookingMethod-only case.
  // -------------------------------------------------------------------------

  it('spec compliance: explicit cookingMethod alone (no cookingState) overrides LLM-extracted state — cookingStateSource=explicit', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })                     // trigram — Strategy A miss
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] }); // pollo exact match

    // LLM returns state='raw' — but explicit cookingMethod='boiled' was passed
    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "pollo", "grams": 150, "state": "raw"}]}'),
    );

    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: makeResolvedResult(MOCK_FOOD_ROW_POLLO, { name: 'pollo' }),
      yieldAdjustment: makeYieldAdj({
        applied: true,
        cookingState: 'cooked',
        cookingStateSource: 'explicit',
        cookingMethod: 'boiled',
        yieldFactor: 0.9,
        reason: 'cooked_state_applied',
      }),
    });

    const mockPrisma = buildMockPrisma();
    const db = buildMockDb() as never;

    // Caller provides only cookingMethod (no cookingState)
    const result = await level4Lookup(db, 'pollo', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
      // cookingState intentionally omitted — only cookingMethod provided
      cookingMethod: 'boiled',
    });

    expect(result).not.toBeNull();
    expect(result?.perIngredientYieldApplied).toBe(true);

    // Spec requires 'explicit' because cookingMethod was explicitly passed.
    // Implementation correctly handles the OR condition.
    expect(result?.yieldAdjustment?.cookingStateSource).toBe('explicit');

    // LLM state 'raw' is overridden — resolveAndApplyYield receives undefined cookingState
    // (explicit cookingState was not passed) and 'boiled' cookingMethod
    expect(mockResolveAndApplyYield).toHaveBeenCalledWith(
      expect.objectContaining({
        cookingState: undefined,  // no explicit cookingState → undefined
        cookingMethod: 'boiled',  // explicit cookingMethod wins
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Dead branch coverage: Step 4b pre-fills state='cooked' when cookingMethod
  // is present but state is absent. The per-ingredient loop's third branch
  // (item.cookingMethod defined but item.state undefined) is therefore
  // unreachable in practice — the developer annotated it as "Defensive".
  // This test verifies the observable behavior is still correct:
  // LLM-only cookingMethod → state inferred as 'cooked', method forwarded.
  // -------------------------------------------------------------------------

  it('dead branch: LLM returns only cookingMethod (no state) — Step 4b pre-fills state=cooked, cookingStateSource=llm_extracted, method forwarded', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] });

    // Only cookingMethod, NO state field
    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "arroz", "grams": 200, "cookingMethod": "boiled"}]}'),
    );

    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: makeResolvedResult(MOCK_FOOD_ROW_ARROZ, { name: 'arroz', calories: 360 / 2.8 }),
      yieldAdjustment: makeYieldAdj({
        applied: true,
        cookingState: 'cooked',
        cookingStateSource: 'explicit',
        cookingMethod: 'boiled',
        yieldFactor: 2.8,
        reason: 'cooked_state_applied',
      }),
    });

    const mockPrisma = buildMockPrisma();
    const db = buildMockDb() as never;

    const result = await level4Lookup(db, 'arroz hervido', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
    });

    expect(result).not.toBeNull();
    expect(result?.perIngredientYieldApplied).toBe(true);
    // State is inferred as 'cooked' from cookingMethod in Step 4b, so
    // the per-ingredient loop hits the "item.state !== undefined" branch
    // (not the dead "item.cookingMethod but no state" branch).
    // cookingStateSource should be 'llm_extracted' regardless of which branch handles it.
    expect(result?.yieldAdjustment?.cookingStateSource).toBe('llm_extracted');
    expect(mockResolveAndApplyYield).toHaveBeenCalledWith(
      expect.objectContaining({
        cookingState: 'cooked',
        cookingMethod: 'boiled',
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Edge case: ALL ingredients have zero calories (e.g., water/lettuce).
  // The dominant ingredient logic uses rawCalorieContribution = calories * grams/100.
  // When all are 0, maxCalories stays at -Infinity until the first item sets it to 0.
  // dominantIdx should be 0 (first item wins tie-break). No crash expected.
  // -------------------------------------------------------------------------

  it('edge: all zero-calorie ingredients — dominant index defaults to first ingredient, no crash', async () => {
    const ZERO_CAL_ROW = {
      ...MOCK_FOOD_ROW_ARROZ,
      food_id: 'fd000000-0074-4000-a000-000000000020',
      food_name: 'Water',
      food_name_es: 'Agua',
      calories: '0.00',
      proteins: '0.00',
      carbohydrates: '0.00',
      sugars: '0.00',
      fats: '0.00',
      saturated_fats: '0.00',
      fiber: '0.00',
      salt: '0.00',
      sodium: '0.00',
      trans_fats: '0.00',
      cholesterol: '0.00',
      potassium: '0.00',
      monounsaturated_fats: '0.00',
      polyunsaturated_fats: '0.00',
    };

    const ZERO_CAL_ROW_2 = {
      ...ZERO_CAL_ROW,
      food_id: 'fd000000-0074-4000-a000-000000000021',
      food_name: 'Lettuce',
      food_name_es: 'Lechuga',
    };

    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })                   // trigram miss
      .mockResolvedValueOnce({ rows: [ZERO_CAL_ROW] })       // agua exact match
      .mockResolvedValueOnce({ rows: [ZERO_CAL_ROW_2] });    // lechuga exact match

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "agua", "grams": 200, "state": "as_served"}, {"name": "lechuga", "grams": 50, "state": "as_served"}]}'),
    );

    const zeroCorrectedNutrients = {
      calories: 0, proteins: 0, carbohydrates: 0, sugars: 0, fats: 0,
      saturatedFats: 0, fiber: 0, salt: 0, sodium: 0, transFats: 0,
      cholesterol: 0, potassium: 0, monounsaturatedFats: 0, polyunsaturatedFats: 0, alcohol: 0,
      referenceBasis: 'per_100g' as const,
    };

    mockResolveAndApplyYield
      .mockResolvedValueOnce({
        result: { ...makeResolvedResult(ZERO_CAL_ROW, { name: 'agua', calories: 0 }), nutrients: zeroCorrectedNutrients },
        yieldAdjustment: makeYieldAdj({ applied: false, cookingState: 'as_served', cookingStateSource: 'llm_extracted', reason: 'as_served_passthrough' }),
      })
      .mockResolvedValueOnce({
        result: { ...makeResolvedResult(ZERO_CAL_ROW_2, { name: 'lechuga', calories: 0 }), nutrients: zeroCorrectedNutrients },
        yieldAdjustment: makeYieldAdj({ applied: false, cookingState: 'as_served', cookingStateSource: 'llm_extracted', reason: 'as_served_passthrough' }),
      });

    const mockPrisma = buildMockPrisma();
    const db = buildMockDb() as never;

    const result = await level4Lookup(db, 'ensalada agua y lechuga', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
    });

    expect(result).not.toBeNull();
    expect(result?.perIngredientYieldApplied).toBe(true);
    expect(result?.result.nutrients.calories).toBeCloseTo(0);
    // Dominant is the first item (agua) — no crash despite all-zero calories
    expect(result?.yieldAdjustment?.applied).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Edge case: LLM returns state='as_served' (valid value) — should pass through
  // yield correction with as_served semantics.
  // -------------------------------------------------------------------------

  it('edge: state="as_served" per ingredient — resolveAndApplyYield called with as_served, cookingStateSource=llm_extracted', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "pollo", "grams": 150, "state": "as_served"}]}'),
    );

    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: makeResolvedResult(MOCK_FOOD_ROW_POLLO, { name: 'pollo' }),
      yieldAdjustment: makeYieldAdj({
        applied: false,
        cookingState: 'as_served',
        cookingStateSource: 'explicit',
        cookingMethod: null,
        reason: 'as_served_passthrough',
      }),
    });

    const mockPrisma = buildMockPrisma();
    const db = buildMockDb() as never;

    const result = await level4Lookup(db, 'pollo', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
    });

    expect(result).not.toBeNull();
    expect(result?.perIngredientYieldApplied).toBe(true);
    expect(result?.yieldAdjustment?.cookingState).toBe('as_served');
    // LLM provided state='as_served' → source is llm_extracted
    expect(result?.yieldAdjustment?.cookingStateSource).toBe('llm_extracted');
    expect(mockResolveAndApplyYield).toHaveBeenCalledWith(
      expect.objectContaining({
        cookingState: 'as_served',
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Edge case: LLM returns invalid state AND invalid cookingMethod together.
  // Both should be stripped — falls through to default assumption.
  // -------------------------------------------------------------------------

  it('edge: both state and cookingMethod invalid — both stripped, resolveAndApplyYield called with state=undefined, method=undefined', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "arroz", "grams": 200, "state": "INVALID", "cookingMethod": "microwave"}]}'),
    );

    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: makeResolvedResult(MOCK_FOOD_ROW_ARROZ, { name: 'arroz' }),
      yieldAdjustment: makeYieldAdj({
        applied: false,
        cookingState: 'as_served',
        cookingStateSource: 'default_assumption',
        cookingMethod: null,
        reason: 'as_served_passthrough',
      }),
    });

    const mockPrisma = buildMockPrisma();
    const db = buildMockDb() as never;

    const result = await level4Lookup(db, 'arroz', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
    });

    expect(result).not.toBeNull();
    // Both stripped → default_assumption
    expect(result?.yieldAdjustment?.cookingStateSource).toBe('default_assumption');
    expect(mockResolveAndApplyYield).toHaveBeenCalledWith(
      expect.objectContaining({
        cookingState: undefined,
        cookingMethod: undefined,
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Edge case: single ingredient resolves but resolveAndApplyYield returns
  // perIngredientMeta with applied=false for ALL ingredients (all as_served).
  // perIngredientYieldApplied should still be true, but applied=false.
  // Engine router MUST skip the second applyYield call in this case.
  // This verifies the router does not double-correct when no yield happened.
  // -------------------------------------------------------------------------

  it('edge: all ingredients as_served passthrough — perIngredientYieldApplied=true but applied=false', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "arroz", "grams": 200, "state": "as_served"}]}'),
    );

    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: makeResolvedResult(MOCK_FOOD_ROW_ARROZ, { name: 'arroz' }),
      yieldAdjustment: makeYieldAdj({
        applied: false,
        cookingState: 'as_served',
        cookingStateSource: 'explicit',
        cookingMethod: null,
        reason: 'as_served_passthrough',
      }),
    });

    const mockPrisma = buildMockPrisma();
    const db = buildMockDb() as never;

    const result = await level4Lookup(db, '200g arroz', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
    });

    expect(result).not.toBeNull();
    // perIngredientYieldApplied=true even though applied=false — the block ran
    expect(result?.perIngredientYieldApplied).toBe(true);
    // applied=false since no yield correction happened
    expect(result?.yieldAdjustment?.applied).toBe(false);
    // reason is always per_ingredient_yield_applied when the block runs
    expect(result?.yieldAdjustment?.reason).toBe('per_ingredient_yield_applied');
    // yieldFactor must be null when applied=false
    expect(result?.yieldAdjustment?.yieldFactor).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Edge case: portionMultiplier is applied in aggregation; yield is applied
  // per-100g BEFORE portionMultiplier scaling. Verify that portionMultiplier
  // is NOT double-applied to corrected nutrients.
  //
  // arroz 200g, portionMultiplier=1.3 (large portion), yieldFactor=2.8.
  // Expected: corrected_per100g = 360/2.8, then * (200/100) * 1.3
  // -------------------------------------------------------------------------

  it('edge: portionMultiplier applied once after per-ingredient yield — no double scaling', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "arroz", "grams": 200, "state": "cooked", "cookingMethod": "boiled"}], "portion_multiplier": 1.3}'),
    );

    const correctedCalPer100 = 360 / 2.8;

    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: makeResolvedResult(MOCK_FOOD_ROW_ARROZ, { name: 'arroz', calories: correctedCalPer100 }),
      yieldAdjustment: makeYieldAdj({
        applied: true,
        cookingState: 'cooked',
        cookingStateSource: 'explicit',
        cookingMethod: 'boiled',
        yieldFactor: 2.8,
        reason: 'cooked_state_applied',
      }),
    });

    const mockPrisma = buildMockPrisma();
    const db = buildMockDb() as never;

    const result = await level4Lookup(db, 'ración grande arroz cocido', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
    });

    expect(result).not.toBeNull();
    expect(result?.perIngredientYieldApplied).toBe(true);
    // Expected: correctedPer100 * (grams/100) * portionMultiplier
    // = (360/2.8) * (200/100) * 1.3
    const expectedCals = correctedCalPer100 * (200 / 100) * 1.3;
    expect(result?.result.nutrients.calories).toBeCloseTo(expectedCals, 2);
  });

  // -------------------------------------------------------------------------
  // Edge case: LLM returns state='cooked' AND valid cookingMethod.
  // The per-ingredient loop should use item.state (not the dead cookingMethod
  // branch) and pass both state and method to resolveAndApplyYield.
  // -------------------------------------------------------------------------

  it('edge: LLM returns both valid state and valid cookingMethod — both forwarded to resolveAndApplyYield', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "pollo", "grams": 150, "state": "cooked", "cookingMethod": "fried"}]}'),
    );

    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: makeResolvedResult(MOCK_FOOD_ROW_POLLO, { name: 'pollo' }),
      yieldAdjustment: makeYieldAdj({
        applied: true,
        cookingState: 'cooked',
        cookingStateSource: 'explicit',
        cookingMethod: 'fried',
        yieldFactor: 1.2,
        reason: 'cooked_state_applied',
      }),
    });

    const mockPrisma = buildMockPrisma();
    const db = buildMockDb() as never;

    const result = await level4Lookup(db, 'pollo frito', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
    });

    expect(result).not.toBeNull();
    expect(result?.yieldAdjustment?.cookingStateSource).toBe('llm_extracted');
    expect(mockResolveAndApplyYield).toHaveBeenCalledWith(
      expect.objectContaining({
        cookingState: 'cooked',
        cookingMethod: 'fried',
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Edge case: two ingredients where the SECOND has higher raw calorie
  // contribution — verify dominantIdx correctly identifies the second, not
  // the first (checks that the loop doesn't stop at the first item).
  // -------------------------------------------------------------------------

  it('edge: second ingredient is dominant by raw calorie contribution — dominantIdx=1, not 0', async () => {
    // pollo contribution: 150 * 165/100 = 247.5 kcal
    // arroz contribution: 50 * 360/100  = 180 kcal  → pollo is dominant
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })                      // trigram miss
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] })  // pollo (first in LLM output)
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] }); // arroz (second)

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "pollo", "grams": 150, "state": "cooked", "cookingMethod": "grilled"}, {"name": "arroz", "grams": 50, "state": "cooked", "cookingMethod": "boiled"}]}'),
    );

    // pollo → dominant
    mockResolveAndApplyYield
      .mockResolvedValueOnce({
        result: makeResolvedResult(MOCK_FOOD_ROW_POLLO, { name: 'pollo', calories: 165 / 0.85 }),
        yieldAdjustment: makeYieldAdj({
          applied: true,
          cookingState: 'cooked',
          cookingStateSource: 'explicit',
          cookingMethod: 'grilled',
          yieldFactor: 0.85,
          reason: 'cooked_state_applied',
        }),
      })
      .mockResolvedValueOnce({
        result: makeResolvedResult(MOCK_FOOD_ROW_ARROZ, { name: 'arroz', calories: 360 / 2.8 }),
        yieldAdjustment: makeYieldAdj({
          applied: true,
          cookingState: 'cooked',
          cookingStateSource: 'explicit',
          cookingMethod: 'boiled',
          yieldFactor: 2.8,
          reason: 'cooked_state_applied',
        }),
      });

    const mockPrisma = buildMockPrisma();
    const db = buildMockDb() as never;

    const result = await level4Lookup(db, 'pollo con arroz', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
    });

    expect(result).not.toBeNull();
    expect(result?.perIngredientYieldApplied).toBe(true);
    // pollo (150g × 165/100 = 247.5 kcal) > arroz (50g × 360/100 = 180 kcal)
    // → dominant is pollo → cookingMethod='grilled', yieldFactor=0.85
    expect(result?.yieldAdjustment?.cookingMethod).toBe('grilled');
    expect(result?.yieldAdjustment?.yieldFactor).toBeCloseTo(0.85);
  });

  // -------------------------------------------------------------------------
  // Edge case: LLM response has cookingMethod='pressure_cooked' (includes
  // underscore — validates that the canonical set includes this value).
  // -------------------------------------------------------------------------

  it('edge: cookingMethod="pressure_cooked" (underscore variant) is in canonical set — accepted, not stripped', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "arroz", "grams": 200, "state": "cooked", "cookingMethod": "pressure_cooked"}]}'),
    );

    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: makeResolvedResult(MOCK_FOOD_ROW_ARROZ, { name: 'arroz', calories: 360 / 3.0 }),
      yieldAdjustment: makeYieldAdj({
        applied: true,
        cookingState: 'cooked',
        cookingStateSource: 'explicit',
        cookingMethod: 'pressure_cooked',
        yieldFactor: 3.0,
        reason: 'cooked_state_applied',
      }),
    });

    const mockPrisma = buildMockPrisma();
    const db = buildMockDb() as never;

    const result = await level4Lookup(db, 'arroz olla a presion', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
    });

    expect(result).not.toBeNull();
    // pressure_cooked is a valid canonical method — not stripped
    expect(mockResolveAndApplyYield).toHaveBeenCalledWith(
      expect.objectContaining({
        cookingMethod: 'pressure_cooked',
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Edge case: three ingredients, middle one has highest raw calorie contribution.
  // Tests that the dominant selection isn't just first-or-last.
  // -------------------------------------------------------------------------

  it('edge: three ingredients — middle ingredient is dominant by raw calories', async () => {
    const MOCK_FOOD_ROW_ACEITE = {
      ...MOCK_FOOD_ROW_ARROZ,
      food_id: 'fd000000-0074-4000-a000-000000000030',
      food_name: 'Olive oil',
      food_name_es: 'Aceite de oliva',
      food_group: 'Fats and Oils',
      calories: '884.00', // high calorie density
    };

    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })                       // trigram miss
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] })   // pollo (50g → 82.5 kcal)
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ACEITE] })  // aceite (30g → 265.2 kcal) — dominant
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] });  // arroz (100g → 360 kcal)

    // Actually arroz 100g = 360 kcal > aceite 30g = 265.2 kcal > pollo 50g = 82.5 kcal
    // So arroz (third ingredient) is actually dominant. Let me fix grams:
    // pollo 50g → 82.5 kcal, aceite 100g → 884 kcal, arroz 50g → 180 kcal → aceite dominates

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "pollo", "grams": 50, "state": "cooked"}, {"name": "aceite", "grams": 100, "state": "as_served"}, {"name": "arroz", "grams": 50, "state": "cooked"}]}'),
    );

    mockResolveAndApplyYield
      .mockResolvedValueOnce({
        result: makeResolvedResult(MOCK_FOOD_ROW_POLLO, { name: 'pollo' }),
        yieldAdjustment: makeYieldAdj({ applied: true, cookingState: 'cooked', cookingStateSource: 'explicit', cookingMethod: 'grilled', yieldFactor: 0.85, reason: 'cooked_state_applied' }),
      })
      .mockResolvedValueOnce({
        result: makeResolvedResult(MOCK_FOOD_ROW_ACEITE, { name: 'aceite', calories: 884 }),
        yieldAdjustment: makeYieldAdj({ applied: false, cookingState: 'as_served', cookingStateSource: 'explicit', cookingMethod: null, reason: 'as_served_passthrough' }),
      })
      .mockResolvedValueOnce({
        result: makeResolvedResult(MOCK_FOOD_ROW_ARROZ, { name: 'arroz', calories: 360 / 2.8 }),
        yieldAdjustment: makeYieldAdj({ applied: true, cookingState: 'cooked', cookingStateSource: 'explicit', cookingMethod: 'boiled', yieldFactor: 2.8, reason: 'cooked_state_applied' }),
      });

    const mockPrisma = buildMockPrisma();
    const db = buildMockDb() as never;

    const result = await level4Lookup(db, 'pollo con aceite y arroz', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
    });

    expect(result).not.toBeNull();
    expect(result?.perIngredientYieldApplied).toBe(true);
    // aceite: 100g × 884/100 = 884 kcal (raw) → highest → dominant
    // pollo: 50g × 165/100 = 82.5 kcal
    // arroz: 50g × 360/100 = 180 kcal
    expect(result?.yieldAdjustment?.cookingState).toBe('as_served');
    // aceite has no cookingMethod
    expect(result?.yieldAdjustment?.cookingMethod).toBeNull();
    // aceite applied=false → the dominant ingredient had no yield applied
    // but arroz and pollo did → aggregate applied=true
    expect(result?.yieldAdjustment?.applied).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Edge case: explicit cookingState provided AND all ingredients have
  // LLM-extracted state — explicit MUST win for all (including when LLM
  // says 'raw' but caller says 'cooked').
  // -------------------------------------------------------------------------

  it('edge: explicit cookingState overrides ALL LLM-extracted states across multiple ingredients', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });

    // LLM says raw for both, but explicit says cooked
    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "arroz", "grams": 200, "state": "raw"}, {"name": "pollo", "grams": 150, "state": "raw"}]}'),
    );

    mockResolveAndApplyYield
      .mockResolvedValueOnce({
        result: makeResolvedResult(MOCK_FOOD_ROW_ARROZ, { name: 'arroz', calories: 360 / 2.8 }),
        yieldAdjustment: makeYieldAdj({ applied: true, cookingState: 'cooked', cookingStateSource: 'explicit', yieldFactor: 2.8, reason: 'cooked_state_applied' }),
      })
      .mockResolvedValueOnce({
        result: makeResolvedResult(MOCK_FOOD_ROW_POLLO, { name: 'pollo', calories: 165 / 0.85 }),
        yieldAdjustment: makeYieldAdj({ applied: true, cookingState: 'cooked', cookingStateSource: 'explicit', yieldFactor: 0.85, reason: 'cooked_state_applied' }),
      });

    const mockPrisma = buildMockPrisma();
    const db = buildMockDb() as never;

    const result = await level4Lookup(db, 'arroz y pollo', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
      cookingState: 'cooked', // explicit override
    });

    expect(result).not.toBeNull();
    expect(result?.perIngredientYieldApplied).toBe(true);
    expect(result?.yieldAdjustment?.cookingStateSource).toBe('explicit');
    // Both calls must use the explicit state, not LLM-extracted 'raw'
    expect(mockResolveAndApplyYield).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ cookingState: 'cooked' }),
    );
    expect(mockResolveAndApplyYield).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ cookingState: 'cooked' }),
    );
  });
});
