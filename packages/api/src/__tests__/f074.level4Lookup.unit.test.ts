// Unit tests for F074 — L4 Strategy B per-ingredient yield correction.
//
// Tests 20-35 from the F074 spec.
// Uses the same mock infrastructure as f024.level4Lookup.unit.test.ts.
//
// Key behaviors tested:
// - Backward compat: old LLM format [{name, grams}] still works
// - Prompt parsing: state, cookingMethod extraction and validation
// - Graceful degradation: no prisma → no yield
// - Core yield path: per-ingredient correction before aggregation
// - cookingStateSource aggregate precedence
// - Explicit override precedence

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

// ---------------------------------------------------------------------------
// Mock Prisma client (F074: stubs cookingProfile.findFirst)
// ---------------------------------------------------------------------------

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

/** Mock chat completion response helper */
function makeChatResponse(content: string, promptTokens = 50, completionTokens = 5) {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
    model: 'gpt-4o-mini',
  };
}

/** Food nutrient row for arroz (rice) — F074: includes food_group */
const MOCK_FOOD_ROW_ARROZ = {
  food_id: 'fd000000-0074-4000-a000-000000000010',
  food_name: 'White rice',
  food_name_es: 'Arroz blanco',
  food_group: 'Cereal Grains and Pasta',
  calories: '360.00',   // raw rice: ~360 kcal per 100g
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

/** Food nutrient row for pollo (chicken) — F074: includes food_group */
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

/** Helper: build a mock yield adjustment */
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

/** Build the nutrients shape returned by resolveAndApplyYield (corrected per_100g) */
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
    referenceBasis: 'per_100g' as const,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Strategy B — per-ingredient yield (F074)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockConfig.OPENAI_CHAT_MODEL = 'gpt-4o-mini';
    mockConfig.OPENAI_CHAT_MAX_TOKENS = 512;
    MockOpenAI.mockImplementation(() => ({
      chat: { completions: { create: mockChatCreate } },
    }));
  });

  // -------------------------------------------------------------------------
  // Test 20: Backward compat — old LLM format (no state field)
  // -------------------------------------------------------------------------

  it('test 20: old format [{name, grams}] with prisma present → cookingStateSource=default_assumption in aggregate', async () => {
    // Strategy A: no trigram candidates
    // Strategy B: resolves arroz
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })                     // trigram
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] }); // arroz exact match

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('[{"name": "arroz", "grams": 200}]'),
    );

    // resolveAndApplyYield returns a passthrough (default_assumption → as_served → passthrough)
    // We override the cookingStateSource externally to simulate default_assumption
    const correctedNutrients = makeCorrectedNutrients(360);
    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: {
        entityType: 'food',
        entityId: MOCK_FOOD_ROW_ARROZ.food_id,
        name: 'arroz',
        nameEs: null,
        restaurantId: null,
        chainSlug: null,
        portionGrams: null,
        nutrients: correctedNutrients,
        confidenceLevel: 'high',
        estimationMethod: 'official',
        source: { id: MOCK_FOOD_ROW_ARROZ.source_id, name: MOCK_FOOD_ROW_ARROZ.source_name, type: 'official', url: null, priorityTier: 1 },
        similarityDistance: null,
      },
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
    const result = await level4Lookup(db, '200g arroz', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
    });

    expect(result).not.toBeNull();
    expect(result?.perIngredientYieldApplied).toBe(true);
    expect(result?.yieldAdjustment?.cookingStateSource).toBe('default_assumption');
    expect(result?.yieldAdjustment?.reason).toBe('per_ingredient_yield_applied');
  });

  // -------------------------------------------------------------------------
  // Test 21: LLM returns state='cooked' → cookingStateSource=llm_extracted
  // -------------------------------------------------------------------------

  it('test 21: LLM returns state="cooked" per ingredient → cookingStateSource=llm_extracted', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "arroz", "grams": 200, "state": "cooked"}]}'),
    );

    const correctedNutrients = makeCorrectedNutrients(128.57); // 360 / 2.8
    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: {
        entityType: 'food',
        entityId: MOCK_FOOD_ROW_ARROZ.food_id,
        name: 'arroz',
        nameEs: null,
        restaurantId: null,
        chainSlug: null,
        portionGrams: null,
        nutrients: correctedNutrients,
        confidenceLevel: 'high',
        estimationMethod: 'official',
        source: { id: MOCK_FOOD_ROW_ARROZ.source_id, name: MOCK_FOOD_ROW_ARROZ.source_name, type: 'official', url: null, priorityTier: 1 },
        similarityDistance: null,
      },
      yieldAdjustment: makeYieldAdj({
        applied: true,
        cookingState: 'cooked',
        cookingStateSource: 'explicit', // resolveAndApplyYield always returns 'explicit' when we pass a state
        cookingMethod: null,
        yieldFactor: 2.8,
        reason: 'cooked_state_applied',
      }),
    });

    const mockPrisma = buildMockPrisma();
    const db = buildMockDb() as never;
    const result = await level4Lookup(db, '200g arroz cocido', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
    });

    expect(result).not.toBeNull();
    expect(result?.perIngredientYieldApplied).toBe(true);
    // F074: override cookingStateSource to llm_extracted (not 'explicit' from resolveAndApplyYield)
    expect(result?.yieldAdjustment?.cookingStateSource).toBe('llm_extracted');
    expect(result?.yieldAdjustment?.applied).toBe(true);
    // Verify resolveAndApplyYield was called with the LLM-extracted state
    expect(mockResolveAndApplyYield).toHaveBeenCalledWith(
      expect.objectContaining({
        cookingState: 'cooked',
        foodName: 'arroz',
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Test 22: cookingMethod='grilled' but no state → infer state='cooked'
  // -------------------------------------------------------------------------

  it('test 22: LLM returns cookingMethod="grilled" but no state → infer state="cooked", cookingStateSource=llm_extracted', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "pollo", "grams": 150, "cookingMethod": "grilled"}]}'),
    );

    const correctedNutrients = makeCorrectedNutrients(165 / 0.85); // chicken yield ~0.85
    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: {
        entityType: 'food',
        entityId: MOCK_FOOD_ROW_POLLO.food_id,
        name: 'pollo',
        nameEs: null,
        restaurantId: null,
        chainSlug: null,
        portionGrams: null,
        nutrients: correctedNutrients,
        confidenceLevel: 'high',
        estimationMethod: 'official',
        source: { id: MOCK_FOOD_ROW_POLLO.source_id, name: MOCK_FOOD_ROW_POLLO.source_name, type: 'official', url: null, priorityTier: 1 },
        similarityDistance: null,
      },
      yieldAdjustment: makeYieldAdj({
        applied: true,
        cookingState: 'cooked',
        cookingStateSource: 'explicit',
        cookingMethod: 'grilled',
        yieldFactor: 0.85,
        reason: 'cooked_state_applied',
      }),
    });

    const mockPrisma = buildMockPrisma();
    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pollo a la plancha', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
    });

    expect(result).not.toBeNull();
    expect(result?.perIngredientYieldApplied).toBe(true);
    expect(result?.yieldAdjustment?.cookingStateSource).toBe('llm_extracted');
    // resolveAndApplyYield must be called with inferred cooked state and grilled method
    expect(mockResolveAndApplyYield).toHaveBeenCalledWith(
      expect.objectContaining({
        cookingState: 'cooked',
        cookingMethod: 'grilled',
        foodName: 'pollo',
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Test 23: LLM returns invalid state → falls back to default_assumption
  // -------------------------------------------------------------------------

  it('test 23: LLM returns state="INVALID_VALUE" → falls back to default assumption, cookingStateSource=default_assumption', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "arroz", "grams": 200, "state": "INVALID_VALUE"}]}'),
    );

    // resolveAndApplyYield called with cookingState=undefined (default_assumption path)
    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: {
        entityType: 'food',
        entityId: MOCK_FOOD_ROW_ARROZ.food_id,
        name: 'arroz',
        nameEs: null,
        restaurantId: null,
        chainSlug: null,
        portionGrams: null,
        nutrients: makeCorrectedNutrients(360),
        confidenceLevel: 'high',
        estimationMethod: 'official',
        source: { id: MOCK_FOOD_ROW_ARROZ.source_id, name: MOCK_FOOD_ROW_ARROZ.source_name, type: 'official', url: null, priorityTier: 1 },
        similarityDistance: null,
      },
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
    const result = await level4Lookup(db, '200g arroz', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
    });

    expect(result).not.toBeNull();
    expect(result?.yieldAdjustment?.cookingStateSource).toBe('default_assumption');
    // resolveAndApplyYield must be called with cookingState=undefined (default path)
    expect(mockResolveAndApplyYield).toHaveBeenCalledWith(
      expect.objectContaining({
        cookingState: undefined,
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Test 24: LLM returns unrecognized cookingMethod → falls back to getDefaultCookingMethod
  // -------------------------------------------------------------------------

  it('test 24: LLM returns cookingMethod="wok_fried" (not in canonical list) → invalid method stripped, resolveAndApplyYield called with cookingMethod=undefined', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "arroz", "grams": 200, "state": "cooked", "cookingMethod": "wok_fried"}]}'),
    );

    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: {
        entityType: 'food',
        entityId: MOCK_FOOD_ROW_ARROZ.food_id,
        name: 'arroz',
        nameEs: null,
        restaurantId: null,
        chainSlug: null,
        portionGrams: null,
        nutrients: makeCorrectedNutrients(128.57),
        confidenceLevel: 'high',
        estimationMethod: 'official',
        source: { id: MOCK_FOOD_ROW_ARROZ.source_id, name: MOCK_FOOD_ROW_ARROZ.source_name, type: 'official', url: null, priorityTier: 1 },
        similarityDistance: null,
      },
      yieldAdjustment: makeYieldAdj({
        applied: true,
        cookingState: 'cooked',
        cookingStateSource: 'explicit',
        cookingMethod: null,
        yieldFactor: 2.8,
        reason: 'cooked_state_applied',
      }),
    });

    const mockPrisma = buildMockPrisma();
    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'arroz wok', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
    });

    expect(result).not.toBeNull();
    // wok_fried is not in canonical list → cookingMethod stripped → undefined passed to resolveAndApplyYield
    expect(mockResolveAndApplyYield).toHaveBeenCalledWith(
      expect.objectContaining({
        cookingState: 'cooked',
        cookingMethod: undefined,
      }),
    );
    // state='cooked' was valid → cookingStateSource=llm_extracted
    expect(result?.yieldAdjustment?.cookingStateSource).toBe('llm_extracted');
  });

  // -------------------------------------------------------------------------
  // Test 25: No prisma injected → graceful degradation
  // -------------------------------------------------------------------------

  it('test 25: no prisma injected → returns result without perIngredientYieldApplied, no yieldAdjustment', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "arroz", "grams": 200, "state": "cooked"}]}'),
    );

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, '200g arroz cocido', {
      openAiApiKey: 'sk-test-key',
      // prisma intentionally absent
    });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('llm_ingredient_decomposition');
    // perIngredientYieldApplied must be absent/falsy — graceful degradation
    expect(result?.perIngredientYieldApplied).toBeFalsy();
    expect(result?.yieldAdjustment).toBeUndefined();
    // resolveAndApplyYield must NOT be called
    expect(mockResolveAndApplyYield).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 26: Single ingredient with yield applied (core path)
  // -------------------------------------------------------------------------

  it('test 26: single ingredient (arroz 200g, state=cooked, yieldFactor=2.80) → corrected nutrients; perIngredientYieldApplied=true', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "arroz", "grams": 200, "state": "cooked", "cookingMethod": "boiled"}]}'),
    );

    // yieldFactor=2.80: raw rice ÷ 2.8 = corrected per-100g
    const correctedCalPer100 = 360 / 2.8; // 128.57...
    const correctedNutrients = {
      calories: correctedCalPer100,
      proteins: 7.0 / 2.8,
      carbohydrates: 79.0 / 2.8,
      sugars: 0.1 / 2.8,
      fats: 0.7 / 2.8,
      saturatedFats: 0.2 / 2.8,
      fiber: 1.3 / 2.8,
      salt: 0.0,
      sodium: 1.0 / 2.8,
      transFats: 0.0,
      cholesterol: 0.0,
      potassium: 115.0 / 2.8,
      monounsaturatedFats: 0.2 / 2.8,
      polyunsaturatedFats: 0.3 / 2.8,
      referenceBasis: 'per_100g' as const,
    };

    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: {
        entityType: 'food',
        entityId: MOCK_FOOD_ROW_ARROZ.food_id,
        name: 'arroz',
        nameEs: null,
        restaurantId: null,
        chainSlug: null,
        portionGrams: null,
        nutrients: correctedNutrients,
        confidenceLevel: 'high',
        estimationMethod: 'official',
        source: { id: MOCK_FOOD_ROW_ARROZ.source_id, name: MOCK_FOOD_ROW_ARROZ.source_name, type: 'official', url: null, priorityTier: 1 },
        similarityDistance: null,
      },
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
    const result = await level4Lookup(db, '200g arroz cocido', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
    });

    expect(result).not.toBeNull();
    expect(result?.perIngredientYieldApplied).toBe(true);
    expect(result?.yieldAdjustment?.applied).toBe(true);
    expect(result?.yieldAdjustment?.reason).toBe('per_ingredient_yield_applied');
    expect(result?.yieldAdjustment?.cookingStateSource).toBe('llm_extracted');
    expect(result?.yieldAdjustment?.yieldFactor).toBeCloseTo(2.8);
    // Final calories = 200 * (360/2.8) / 100 = 200 * 1.2857 = 257.14
    const expectedCals = 200 * (correctedCalPer100 / 100);
    expect(result?.result.nutrients.calories).toBeCloseTo(expectedCals);
  });

  // -------------------------------------------------------------------------
  // Test 27: Two ingredients — dominant ingredient (arroz) wins for aggregate
  // -------------------------------------------------------------------------

  it('test 27: two ingredients (arroz 200g + pollo 150g) → arroz is dominant (higher raw cal contribution), aggregate uses arroz yield metadata', async () => {
    // arroz raw contribution: 200 * 360/100 = 720 kcal
    // pollo raw contribution: 150 * 165/100 = 247.5 kcal → arroz dominates
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })                      // trigram
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] })  // arroz
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] }); // pollo

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "arroz", "grams": 200, "state": "cooked", "cookingMethod": "boiled"}, {"name": "pollo", "grams": 150, "state": "cooked", "cookingMethod": "grilled"}]}'),
    );

    const arrozCorrectedCals = 360 / 2.8;
    const polloCorrectedCals = 165 / 0.85;

    // Mock for arroz (called first)
    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: {
        entityType: 'food',
        entityId: MOCK_FOOD_ROW_ARROZ.food_id,
        name: 'arroz',
        nameEs: null,
        restaurantId: null,
        chainSlug: null,
        portionGrams: null,
        nutrients: makeCorrectedNutrients(arrozCorrectedCals),
        confidenceLevel: 'high',
        estimationMethod: 'official',
        source: { id: MOCK_FOOD_ROW_ARROZ.source_id, name: MOCK_FOOD_ROW_ARROZ.source_name, type: 'official', url: null, priorityTier: 1 },
        similarityDistance: null,
      },
      yieldAdjustment: makeYieldAdj({
        applied: true,
        cookingState: 'cooked',
        cookingStateSource: 'explicit',
        cookingMethod: 'boiled',
        yieldFactor: 2.8,
        reason: 'cooked_state_applied',
      }),
    });

    // Mock for pollo (called second)
    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: {
        entityType: 'food',
        entityId: MOCK_FOOD_ROW_POLLO.food_id,
        name: 'pollo',
        nameEs: null,
        restaurantId: null,
        chainSlug: null,
        portionGrams: null,
        nutrients: makeCorrectedNutrients(polloCorrectedCals),
        confidenceLevel: 'high',
        estimationMethod: 'official',
        source: { id: MOCK_FOOD_ROW_POLLO.source_id, name: MOCK_FOOD_ROW_POLLO.source_name, type: 'official', url: null, priorityTier: 1 },
        similarityDistance: null,
      },
      yieldAdjustment: makeYieldAdj({
        applied: true,
        cookingState: 'cooked',
        cookingStateSource: 'explicit',
        cookingMethod: 'grilled',
        yieldFactor: 0.85,
        reason: 'cooked_state_applied',
      }),
    });

    const mockPrisma = buildMockPrisma();
    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'arroz con pollo', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
    });

    expect(result).not.toBeNull();
    expect(result?.perIngredientYieldApplied).toBe(true);
    expect(result?.yieldAdjustment?.applied).toBe(true);
    // Dominant ingredient is arroz (720 kcal raw vs 247.5 kcal)
    // Aggregate cookingMethod should be 'boiled' (from arroz)
    expect(result?.yieldAdjustment?.cookingMethod).toBe('boiled');
    expect(result?.yieldAdjustment?.yieldFactor).toBeCloseTo(2.8);
    expect(result?.yieldAdjustment?.cookingStateSource).toBe('llm_extracted');
    expect(result?.yieldAdjustment?.reason).toBe('per_ingredient_yield_applied');
  });

  // -------------------------------------------------------------------------
  // Test 28: Two ingredients, only one has a profile found
  // -------------------------------------------------------------------------

  it('test 28: two ingredients, only arroz has a profile (pollo returns no_profile_found) → applied=true (at least one corrected)', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "arroz", "grams": 200, "state": "cooked"}, {"name": "pollo", "grams": 150, "state": "cooked"}]}'),
    );

    // arroz: yield applied
    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: {
        entityType: 'food',
        entityId: MOCK_FOOD_ROW_ARROZ.food_id,
        name: 'arroz',
        nameEs: null,
        restaurantId: null,
        chainSlug: null,
        portionGrams: null,
        nutrients: makeCorrectedNutrients(360 / 2.8),
        confidenceLevel: 'high',
        estimationMethod: 'official',
        source: { id: MOCK_FOOD_ROW_ARROZ.source_id, name: MOCK_FOOD_ROW_ARROZ.source_name, type: 'official', url: null, priorityTier: 1 },
        similarityDistance: null,
      },
      yieldAdjustment: makeYieldAdj({
        applied: true,
        cookingState: 'cooked',
        cookingStateSource: 'explicit',
        cookingMethod: null,
        yieldFactor: 2.8,
        reason: 'cooked_state_applied',
      }),
    });

    // pollo: no profile found
    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: {
        entityType: 'food',
        entityId: MOCK_FOOD_ROW_POLLO.food_id,
        name: 'pollo',
        nameEs: null,
        restaurantId: null,
        chainSlug: null,
        portionGrams: null,
        nutrients: makeCorrectedNutrients(165), // unchanged
        confidenceLevel: 'high',
        estimationMethod: 'official',
        source: { id: MOCK_FOOD_ROW_POLLO.source_id, name: MOCK_FOOD_ROW_POLLO.source_name, type: 'official', url: null, priorityTier: 1 },
        similarityDistance: null,
      },
      yieldAdjustment: makeYieldAdj({
        applied: false,
        cookingState: 'cooked',
        cookingStateSource: 'explicit',
        cookingMethod: null,
        yieldFactor: null,
        reason: 'no_profile_found',
      }),
    });

    const mockPrisma = buildMockPrisma();
    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'arroz con pollo', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
    });

    expect(result).not.toBeNull();
    expect(result?.perIngredientYieldApplied).toBe(true);
    // At least one ingredient was corrected → applied=true
    expect(result?.yieldAdjustment?.applied).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 29: state='raw' → raw_state_no_correction, nutrients pass through
  // -------------------------------------------------------------------------

  it('test 29: single ingredient with state="raw" → reason=raw_state_no_correction, applied=false', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "pollo", "grams": 150, "state": "raw"}]}'),
    );

    // raw → passthrough, applied=false
    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: {
        entityType: 'food',
        entityId: MOCK_FOOD_ROW_POLLO.food_id,
        name: 'pollo',
        nameEs: null,
        restaurantId: null,
        chainSlug: null,
        portionGrams: null,
        nutrients: makeCorrectedNutrients(165), // unchanged for raw
        confidenceLevel: 'high',
        estimationMethod: 'official',
        source: { id: MOCK_FOOD_ROW_POLLO.source_id, name: MOCK_FOOD_ROW_POLLO.source_name, type: 'official', url: null, priorityTier: 1 },
        similarityDistance: null,
      },
      yieldAdjustment: makeYieldAdj({
        applied: false,
        cookingState: 'raw',
        cookingStateSource: 'explicit',
        cookingMethod: null,
        yieldFactor: null,
        reason: 'raw_state_no_correction',
      }),
    });

    const mockPrisma = buildMockPrisma();
    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pollo crudo', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
    });

    expect(result).not.toBeNull();
    expect(result?.perIngredientYieldApplied).toBe(true);
    expect(result?.yieldAdjustment?.applied).toBe(false);
    expect(result?.yieldAdjustment?.cookingState).toBe('raw');
    expect(result?.yieldAdjustment?.cookingStateSource).toBe('llm_extracted');
  });

  // -------------------------------------------------------------------------
  // Test 30: No state + food_group=null → getDefaultCookingState(null)=as_served → passthrough
  // -------------------------------------------------------------------------

  it('test 30: no state, food_group=null → default as_served → passthrough, cookingStateSource=default_assumption', async () => {
    const rowWithNullGroup = { ...MOCK_FOOD_ROW_ARROZ, food_group: null };
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [rowWithNullGroup] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "arroz", "grams": 200}]}'),
    );

    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: {
        entityType: 'food',
        entityId: MOCK_FOOD_ROW_ARROZ.food_id,
        name: 'arroz',
        nameEs: null,
        restaurantId: null,
        chainSlug: null,
        portionGrams: null,
        nutrients: makeCorrectedNutrients(360),
        confidenceLevel: 'high',
        estimationMethod: 'official',
        source: { id: MOCK_FOOD_ROW_ARROZ.source_id, name: MOCK_FOOD_ROW_ARROZ.source_name, type: 'official', url: null, priorityTier: 1 },
        similarityDistance: null,
      },
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
    const result = await level4Lookup(db, '200g arroz', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
    });

    expect(result).not.toBeNull();
    expect(result?.yieldAdjustment?.cookingStateSource).toBe('default_assumption');
    expect(result?.yieldAdjustment?.applied).toBe(false);
    // resolveAndApplyYield called with cookingState=undefined (default path)
    expect(mockResolveAndApplyYield).toHaveBeenCalledWith(
      expect.objectContaining({
        cookingState: undefined,
        rawFoodGroup: null,
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Test 31: Mixed sources → llm_extracted wins over default_assumption
  // -------------------------------------------------------------------------

  it('test 31: one ingredient llm_extracted, another default_assumption → aggregate=llm_extracted', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });

    // arroz: state given (llm_extracted), pollo: no state (default_assumption)
    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "arroz", "grams": 200, "state": "cooked"}, {"name": "pollo", "grams": 150}]}'),
    );

    // arroz → llm_extracted
    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: {
        entityType: 'food',
        entityId: MOCK_FOOD_ROW_ARROZ.food_id,
        name: 'arroz',
        nameEs: null,
        restaurantId: null,
        chainSlug: null,
        portionGrams: null,
        nutrients: makeCorrectedNutrients(360 / 2.8),
        confidenceLevel: 'high',
        estimationMethod: 'official',
        source: { id: MOCK_FOOD_ROW_ARROZ.source_id, name: MOCK_FOOD_ROW_ARROZ.source_name, type: 'official', url: null, priorityTier: 1 },
        similarityDistance: null,
      },
      yieldAdjustment: makeYieldAdj({ applied: true, yieldFactor: 2.8, reason: 'cooked_state_applied' }),
    });

    // pollo → default_assumption
    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: {
        entityType: 'food',
        entityId: MOCK_FOOD_ROW_POLLO.food_id,
        name: 'pollo',
        nameEs: null,
        restaurantId: null,
        chainSlug: null,
        portionGrams: null,
        nutrients: makeCorrectedNutrients(165),
        confidenceLevel: 'high',
        estimationMethod: 'official',
        source: { id: MOCK_FOOD_ROW_POLLO.source_id, name: MOCK_FOOD_ROW_POLLO.source_name, type: 'official', url: null, priorityTier: 1 },
        similarityDistance: null,
      },
      yieldAdjustment: makeYieldAdj({ applied: false, reason: 'as_served_passthrough' }),
    });

    const mockPrisma = buildMockPrisma();
    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'arroz con pollo', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
    });

    expect(result).not.toBeNull();
    // llm_extracted wins over default_assumption
    expect(result?.yieldAdjustment?.cookingStateSource).toBe('llm_extracted');
  });

  // -------------------------------------------------------------------------
  // Test 32: ALL ingredients default_assumption → aggregate=default_assumption
  // -------------------------------------------------------------------------

  it('test 32: all ingredients have default_assumption → aggregate=default_assumption', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });

    // Neither has state
    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "arroz", "grams": 200}, {"name": "pollo", "grams": 150}]}'),
    );

    // Both → default_assumption
    mockResolveAndApplyYield
      .mockResolvedValueOnce({
        result: {
          entityType: 'food',
          entityId: MOCK_FOOD_ROW_ARROZ.food_id,
          name: 'arroz',
          nameEs: null,
          restaurantId: null,
          chainSlug: null,
          portionGrams: null,
          nutrients: makeCorrectedNutrients(360),
          confidenceLevel: 'high',
          estimationMethod: 'official',
          source: { id: MOCK_FOOD_ROW_ARROZ.source_id, name: MOCK_FOOD_ROW_ARROZ.source_name, type: 'official', url: null, priorityTier: 1 },
          similarityDistance: null,
        },
        yieldAdjustment: makeYieldAdj({ applied: false, reason: 'as_served_passthrough' }),
      })
      .mockResolvedValueOnce({
        result: {
          entityType: 'food',
          entityId: MOCK_FOOD_ROW_POLLO.food_id,
          name: 'pollo',
          nameEs: null,
          restaurantId: null,
          chainSlug: null,
          portionGrams: null,
          nutrients: makeCorrectedNutrients(165),
          confidenceLevel: 'high',
          estimationMethod: 'official',
          source: { id: MOCK_FOOD_ROW_POLLO.source_id, name: MOCK_FOOD_ROW_POLLO.source_name, type: 'official', url: null, priorityTier: 1 },
          similarityDistance: null,
        },
        yieldAdjustment: makeYieldAdj({ applied: false, reason: 'as_served_passthrough' }),
      });

    const mockPrisma = buildMockPrisma();
    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'arroz con pollo', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
    });

    expect(result).not.toBeNull();
    expect(result?.yieldAdjustment?.cookingStateSource).toBe('default_assumption');
  });

  // -------------------------------------------------------------------------
  // Test 33: Explicit cookingState overrides LLM-extracted per-ingredient state
  // -------------------------------------------------------------------------

  it('test 33: explicit cookingState="cooked" overrides LLM-extracted state="raw" → aggregate cookingStateSource=explicit', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] });

    // LLM returns state='raw' but explicit param says 'cooked'
    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "arroz", "grams": 200, "state": "raw"}]}'),
    );

    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: {
        entityType: 'food',
        entityId: MOCK_FOOD_ROW_ARROZ.food_id,
        name: 'arroz',
        nameEs: null,
        restaurantId: null,
        chainSlug: null,
        portionGrams: null,
        nutrients: makeCorrectedNutrients(360 / 2.8),
        confidenceLevel: 'high',
        estimationMethod: 'official',
        source: { id: MOCK_FOOD_ROW_ARROZ.source_id, name: MOCK_FOOD_ROW_ARROZ.source_name, type: 'official', url: null, priorityTier: 1 },
        similarityDistance: null,
      },
      yieldAdjustment: makeYieldAdj({
        applied: true,
        cookingState: 'cooked',
        cookingStateSource: 'explicit',
        yieldFactor: 2.8,
        reason: 'cooked_state_applied',
      }),
    });

    const mockPrisma = buildMockPrisma();
    const db = buildMockDb() as never;
    const result = await level4Lookup(db, '200g arroz', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
      cookingState: 'cooked',  // explicit override
    });

    expect(result).not.toBeNull();
    // Explicit param wins → aggregate cookingStateSource=explicit
    expect(result?.yieldAdjustment?.cookingStateSource).toBe('explicit');
    // resolveAndApplyYield must be called with the EXPLICIT cookingState (not LLM-extracted 'raw')
    expect(mockResolveAndApplyYield).toHaveBeenCalledWith(
      expect.objectContaining({
        cookingState: 'cooked',
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Test 34: Explicit cookingMethod overrides LLM-extracted cookingMethod
  // -------------------------------------------------------------------------

  it('test 34: explicit cookingMethod="boiled" overrides LLM-extracted cookingMethod="grilled" → aggregate cookingStateSource=explicit', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });

    // LLM says grilled but explicit param says boiled
    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "pollo", "grams": 150, "state": "cooked", "cookingMethod": "grilled"}]}'),
    );

    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: {
        entityType: 'food',
        entityId: MOCK_FOOD_ROW_POLLO.food_id,
        name: 'pollo',
        nameEs: null,
        restaurantId: null,
        chainSlug: null,
        portionGrams: null,
        nutrients: makeCorrectedNutrients(165 / 0.85),
        confidenceLevel: 'high',
        estimationMethod: 'official',
        source: { id: MOCK_FOOD_ROW_POLLO.source_id, name: MOCK_FOOD_ROW_POLLO.source_name, type: 'official', url: null, priorityTier: 1 },
        similarityDistance: null,
      },
      yieldAdjustment: makeYieldAdj({
        applied: true,
        cookingState: 'cooked',
        cookingStateSource: 'explicit',
        cookingMethod: 'boiled', // explicit boiled wins
        yieldFactor: 0.9,
        reason: 'cooked_state_applied',
      }),
    });

    const mockPrisma = buildMockPrisma();
    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pollo', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
      cookingState: 'cooked',
      cookingMethod: 'boiled',  // explicit override
    });

    expect(result).not.toBeNull();
    expect(result?.yieldAdjustment?.cookingStateSource).toBe('explicit');
    // resolveAndApplyYield must be called with the EXPLICIT method
    expect(mockResolveAndApplyYield).toHaveBeenCalledWith(
      expect.objectContaining({
        cookingState: 'cooked',
        cookingMethod: 'boiled',
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Bonus: verify resolveAndApplyYield is called with item.name (not DB food name)
  // -------------------------------------------------------------------------

  it('test bonus: resolveAndApplyYield is called with ingredient name (item.name), not DB food name', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] }); // DB name is 'White rice'

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "arroz", "grams": 200, "state": "cooked"}]}'),
    );

    mockResolveAndApplyYield.mockResolvedValueOnce({
      result: {
        entityType: 'food',
        entityId: MOCK_FOOD_ROW_ARROZ.food_id,
        name: 'arroz',
        nameEs: null,
        restaurantId: null,
        chainSlug: null,
        portionGrams: null,
        nutrients: makeCorrectedNutrients(360 / 2.8),
        confidenceLevel: 'high',
        estimationMethod: 'official',
        source: { id: MOCK_FOOD_ROW_ARROZ.source_id, name: MOCK_FOOD_ROW_ARROZ.source_name, type: 'official', url: null, priorityTier: 1 },
        similarityDistance: null,
      },
      yieldAdjustment: makeYieldAdj({ applied: true, yieldFactor: 2.8 }),
    });

    const mockPrisma = buildMockPrisma();
    const db = buildMockDb() as never;
    await level4Lookup(db, 'arroz cocido', {
      openAiApiKey: 'sk-test-key',
      prisma: mockPrisma,
    });

    // Must be called with foodName='arroz' (LLM ingredient name), NOT 'White rice' (DB name)
    expect(mockResolveAndApplyYield).toHaveBeenCalledWith(
      expect.objectContaining({
        foodName: 'arroz',
      }),
    );
  });
});
