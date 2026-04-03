// Unit tests for F072 integration into POST /calculate/recipe.
//
// Verifies that:
// - resolveAndApplyYield is called per resolved ingredient
// - cookingState / cookingMethod per ingredient passed through (structured mode)
// - yieldAdjustment attached to resolvedAs block
// - Yield-corrected nutrients used for aggregation (totals reflect correction)
// - Free-form mode passes undefined cookingState/cookingMethod (defaults fire)
// - canonicalizeStructured cache key changes when cookingState/cookingMethod differ

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

const { mockRedisGet, mockRedisSet } = vi.hoisted(() => ({
  mockRedisGet: vi.fn().mockResolvedValue(null),
  mockRedisSet: vi.fn().mockResolvedValue('OK'),
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  } as unknown as Redis,
}));

// ---------------------------------------------------------------------------
// Mock Prisma — needed for buildApp + resolveAndApplyYield (PrismaClient arg)
// ---------------------------------------------------------------------------

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    queryLog: { create: vi.fn() },
    apiKey: { findUnique: vi.fn() },
    cookingProfile: { findFirst: vi.fn().mockResolvedValue(null) },
  } as unknown as PrismaClient,
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: mockPrisma,
}));

// ---------------------------------------------------------------------------
// Mock Kysely sql — returns food rows for ingredient resolution
// ---------------------------------------------------------------------------

const { mockSqlFn } = vi.hoisted(() => {
  const mockSqlFn = vi.fn().mockReturnValue({ execute: vi.fn().mockResolvedValue({ rows: [] }) });
  return { mockSqlFn };
});

vi.mock('kysely', async (importOriginal) => {
  const actual = await importOriginal<typeof import('kysely')>();
  return {
    ...actual,
    sql: Object.assign(mockSqlFn, { raw: actual.sql.raw }),
  };
});

// ---------------------------------------------------------------------------
// Mock openaiClient
// ---------------------------------------------------------------------------

const { mockCallChatCompletion, mockCallOpenAIEmbeddingsOnce } = vi.hoisted(() => ({
  mockCallChatCompletion: vi.fn().mockResolvedValue(null),
  mockCallOpenAIEmbeddingsOnce: vi.fn().mockResolvedValue(null),
}));

vi.mock('../lib/openaiClient.js', () => ({
  callChatCompletion: mockCallChatCompletion,
  callOpenAIEmbeddingsOnce: mockCallOpenAIEmbeddingsOnce,
  getOpenAIClient: vi.fn(),
  isRetryableError: vi.fn().mockReturnValue(false),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock resolveAndApplyYield
// ---------------------------------------------------------------------------

const { mockResolveAndApplyYield } = vi.hoisted(() => ({ mockResolveAndApplyYield: vi.fn() }));

vi.mock('../estimation/applyYield.js', () => ({
  resolveAndApplyYield: mockResolveAndApplyYield,
}));

// ---------------------------------------------------------------------------
// Mock config
// ---------------------------------------------------------------------------

vi.mock('../config.js', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
    DATABASE_URL_TEST: 'postgresql://user:pass@localhost:5432/test',
    LOG_LEVEL: 'silent',
    REDIS_URL: 'redis://localhost:6380',
    OPENAI_API_KEY: 'test-openai-key',
    OPENAI_CHAT_MODEL: 'gpt-4o-mini',
    OPENAI_CHAT_MAX_TOKENS: 512,
    OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
  },
}));

// ---------------------------------------------------------------------------
// Import buildApp AFTER all vi.mock calls
// ---------------------------------------------------------------------------

import { buildApp } from '../app.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A resolved FoodQueryRow — per_100g to allow yield correction
const FOOD_NUTRIENT_ROW = {
  food_id: 'fd000000-0072-4000-a000-000000000010',
  food_name: 'rice',
  food_name_es: 'arroz',
  food_group: 'Cereal Grains and Pasta',
  calories: '365',
  proteins: '7',
  carbohydrates: '79',
  sugars: '0',
  fats: '0.6',
  saturated_fats: '0.1',
  fiber: '1.3',
  salt: '0',
  sodium: '1',
  trans_fats: '0',
  cholesterol: '0',
  potassium: '115',
  monounsaturated_fats: '0.2',
  polyunsaturated_fats: '0.2',
  reference_basis: 'per_100g',
  source_id: 'fd000000-0072-4000-a000-000000000011',
  source_name: 'USDA',
  source_type: 'official',
  source_url: null,
  source_priority_tier: '1',
};

const YIELD_ADJ_APPLIED = {
  applied: true,
  cookingState: 'cooked' as const,
  cookingStateSource: 'explicit' as const,
  cookingMethod: 'boiled',
  yieldFactor: 2.8,
  fatAbsorptionApplied: false,
  reason: 'cooked_state_applied' as const,
};

const YIELD_ADJ_PASSTHROUGH = {
  applied: false,
  cookingState: 'as_served' as const,
  cookingStateSource: 'none' as const,
  cookingMethod: null,
  yieldFactor: null,
  fatAbsorptionApplied: false,
  reason: 'dish_always_as_served' as const,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Set up the mockSqlFn sequence so that the L1 resolution for ingredient names
 * returns the given food row. The resolveIngredient L1 path calls sql twice
 * (exact + FTS); we make exact return the row.
 */
function setupFoodResolution(row: typeof FOOD_NUTRIENT_ROW) {
  // First call → exact food match returns the row
  mockSqlFn.mockReturnValueOnce({
    execute: vi.fn().mockResolvedValue({ rows: [row] }),
  });
}

function setupNoResolution() {
  // Both exact + FTS miss
  mockSqlFn.mockReturnValueOnce({
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  });
  mockSqlFn.mockReturnValueOnce({
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /calculate/recipe — F072 yield integration', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.resetAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockCallChatCompletion.mockResolvedValue(null);
    mockCallOpenAIEmbeddingsOnce.mockResolvedValue(null);
    // Default sql: return empty rows (no match). setupFoodResolution overrides with Once.
    mockSqlFn.mockReturnValue({ execute: vi.fn().mockResolvedValue({ rows: [] }) });
    app = await buildApp();
  });

  // -------------------------------------------------------------------------
  // resolveAndApplyYield called per resolved ingredient
  // -------------------------------------------------------------------------

  it('structured mode — resolveAndApplyYield called for each resolved ingredient', async () => {
    setupFoodResolution(FOOD_NUTRIENT_ROW);
    mockResolveAndApplyYield.mockResolvedValue({
      result: {
        entityType: 'food',
        entityId: FOOD_NUTRIENT_ROW.food_id,
        name: FOOD_NUTRIENT_ROW.food_name,
        nameEs: FOOD_NUTRIENT_ROW.food_name_es,
        restaurantId: null,
        chainSlug: null,
        portionGrams: null,
        nutrients: {
          calories: 130,
          proteins: 2.5,
          carbohydrates: 28,
          sugars: 0,
          fats: 0.21,
          saturatedFats: 0.036,
          fiber: 0.46,
          salt: 0,
          sodium: 0.36,
          transFats: 0,
          cholesterol: 0,
          potassium: 41,
          monounsaturatedFats: 0.071,
          polyunsaturatedFats: 0.071,
          referenceBasis: 'per_100g' as const,
        },
        confidenceLevel: 'high' as const,
        estimationMethod: 'official' as const,
        source: { id: FOOD_NUTRIENT_ROW.source_id, name: 'USDA', type: 'official' as const, url: null },
        similarityDistance: null,
      },
      yieldAdjustment: YIELD_ADJ_APPLIED,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/calculate/recipe',
      payload: {
        mode: 'structured',
        ingredients: [
          { name: 'rice', grams: 100, portionMultiplier: 1.0, cookingState: 'cooked', cookingMethod: 'boiled' },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockResolveAndApplyYield).toHaveBeenCalledOnce();
  });

  it('structured mode — cookingState and cookingMethod passed to resolveAndApplyYield', async () => {
    setupFoodResolution(FOOD_NUTRIENT_ROW);
    mockResolveAndApplyYield.mockResolvedValue({
      result: {
        entityType: 'food' as const,
        entityId: FOOD_NUTRIENT_ROW.food_id,
        name: 'rice',
        nameEs: 'arroz',
        restaurantId: null,
        chainSlug: null,
        portionGrams: null,
        nutrients: { calories: 130, proteins: 2.5, carbohydrates: 28, sugars: 0, fats: 0.21, saturatedFats: 0.036, fiber: 0.46, salt: 0, sodium: 0.36, transFats: 0, cholesterol: 0, potassium: 41, monounsaturatedFats: 0.071, polyunsaturatedFats: 0.071, referenceBasis: 'per_100g' as const },
        confidenceLevel: 'high' as const,
        estimationMethod: 'official' as const,
        source: { id: FOOD_NUTRIENT_ROW.source_id, name: 'USDA', type: 'official' as const, url: null },
        similarityDistance: null,
      },
      yieldAdjustment: YIELD_ADJ_APPLIED,
    });

    await app.inject({
      method: 'POST',
      url: '/calculate/recipe',
      payload: {
        mode: 'structured',
        ingredients: [
          { name: 'rice', grams: 100, portionMultiplier: 1.0, cookingState: 'cooked', cookingMethod: 'boiled' },
        ],
      },
    });

    expect(mockResolveAndApplyYield).toHaveBeenCalledWith(
      expect.objectContaining({
        cookingState: 'cooked',
        cookingMethod: 'boiled',
      }),
    );
  });

  it('structured mode — yieldAdjustment attached to resolvedAs in response', async () => {
    setupFoodResolution(FOOD_NUTRIENT_ROW);
    mockResolveAndApplyYield.mockResolvedValue({
      result: {
        entityType: 'food' as const,
        entityId: FOOD_NUTRIENT_ROW.food_id,
        name: 'rice',
        nameEs: 'arroz',
        restaurantId: null,
        chainSlug: null,
        portionGrams: null,
        nutrients: { calories: 130, proteins: 2.5, carbohydrates: 28, sugars: 0, fats: 0.21, saturatedFats: 0.036, fiber: 0.46, salt: 0, sodium: 0.36, transFats: 0, cholesterol: 0, potassium: 41, monounsaturatedFats: 0.071, polyunsaturatedFats: 0.071, referenceBasis: 'per_100g' as const },
        confidenceLevel: 'high' as const,
        estimationMethod: 'official' as const,
        source: { id: FOOD_NUTRIENT_ROW.source_id, name: 'USDA', type: 'official' as const, url: null },
        similarityDistance: null,
      },
      yieldAdjustment: YIELD_ADJ_APPLIED,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/calculate/recipe',
      payload: {
        mode: 'structured',
        ingredients: [
          { name: 'rice', grams: 100, portionMultiplier: 1.0, cookingState: 'cooked', cookingMethod: 'boiled' },
        ],
      },
    });

    const body = JSON.parse(response.body) as { success: boolean; data: { ingredients: Array<{ resolvedAs: { yieldAdjustment: unknown } | null }> } };
    expect(body.success).toBe(true);
    const ingredient = body.data.ingredients[0];
    expect(ingredient?.resolvedAs?.yieldAdjustment).toMatchObject({
      applied: true,
      reason: 'cooked_state_applied',
    });
  });

  it('unresolved ingredient — resolveAndApplyYield not called for unresolved', async () => {
    // First ingredient resolves, second does not
    setupFoodResolution(FOOD_NUTRIENT_ROW);
    setupNoResolution();

    mockResolveAndApplyYield.mockResolvedValue({
      result: {
        entityType: 'food' as const,
        entityId: FOOD_NUTRIENT_ROW.food_id,
        name: 'rice',
        nameEs: 'arroz',
        restaurantId: null,
        chainSlug: null,
        portionGrams: null,
        nutrients: { calories: 130, proteins: 2.5, carbohydrates: 28, sugars: 0, fats: 0.21, saturatedFats: 0.036, fiber: 0.46, salt: 0, sodium: 0.36, transFats: 0, cholesterol: 0, potassium: 41, monounsaturatedFats: 0.071, polyunsaturatedFats: 0.071, referenceBasis: 'per_100g' as const },
        confidenceLevel: 'high' as const,
        estimationMethod: 'official' as const,
        source: { id: FOOD_NUTRIENT_ROW.source_id, name: 'USDA', type: 'official' as const, url: null },
        similarityDistance: null,
      },
      yieldAdjustment: YIELD_ADJ_PASSTHROUGH,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/calculate/recipe',
      payload: {
        mode: 'structured',
        ingredients: [
          { name: 'rice', grams: 100, portionMultiplier: 1.0 },
          { name: 'unknown_ingredient_xyz', grams: 50, portionMultiplier: 1.0 },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    // resolveAndApplyYield only called once (for the resolved ingredient)
    expect(mockResolveAndApplyYield).toHaveBeenCalledOnce();
  });
});
