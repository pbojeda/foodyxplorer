// F042 QA Edge Cases — GET /estimate portionMultiplier route behaviour
//
// Focuses on gaps NOT covered by the portionMultiplier describe block in f020.estimate.route.test.ts:
//  - referenceBasis per_100g → per_serving conversion when multiplier != 1.0
//  - referenceBasis preserved (NOT converted) when multiplier == 1.0
//  - Boundary portionMultiplier values 0.1 and 5.0 accepted (route-level)
//  - Large portionGrams scaling (5.0 × 500) — no cap
//  - Rounding: nutrients to 2dp, portionGrams to 1dp
//  - portionMultiplier applied to food result (non-dish entity with portionGrams=null)
//  - portionMultiplier=0.09 rejected (just below minimum)
//  - portionMultiplier=5.1 rejected (just above maximum)
//  - portionMultiplier response on cache hit preserves stored multiplier

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { EstimateResponseSchema } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Mock level1Lookup
// ---------------------------------------------------------------------------

const { mockLevel1Lookup } = vi.hoisted(() => ({
  mockLevel1Lookup: vi.fn(),
}));

vi.mock('../estimation/level1Lookup.js', () => ({
  level1Lookup: mockLevel1Lookup,
}));

// ---------------------------------------------------------------------------
// Mock level2Lookup
// ---------------------------------------------------------------------------

const { mockLevel2Lookup } = vi.hoisted(() => ({
  mockLevel2Lookup: vi.fn(),
}));

vi.mock('../estimation/level2Lookup.js', () => ({
  level2Lookup: mockLevel2Lookup,
}));

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

const { mockRedisGet, mockRedisSet } = vi.hoisted(() => ({
  mockRedisGet: vi.fn(),
  mockRedisSet: vi.fn(),
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
  } as unknown as Redis,
}));

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

vi.mock('../lib/prisma.js', () => ({
  prisma: {} as PrismaClient,
}));

// ---------------------------------------------------------------------------
// Mock Kysely
// ---------------------------------------------------------------------------

const mockKyselyDb = {
  getExecutor: () => ({
    executeQuery: vi.fn().mockResolvedValue({ rows: [] }),
    compileQuery: (node: unknown) => ({ sql: '', parameters: [], query: node }),
    transformQuery: (node: unknown) => node,
    withPlugins: function() { return this; },
  }),
};

vi.mock('../lib/kysely.js', () => ({
  getKysely: () => mockKyselyDb,
  destroyKysely: vi.fn(),
}));

import { buildApp } from '../app.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_NUTRIENTS = {
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

const MOCK_LEVEL1_DISH = {
  matchType: 'exact_dish' as const,
  result: {
    entityType: 'dish' as const,
    entityId: 'fd000000-0001-4000-a000-000000000001',
    name: 'Big Mac',
    nameEs: 'Big Mac',
    restaurantId: 'fd000000-0001-4000-a000-000000000002',
    chainSlug: 'mcdonalds-es',
    portionGrams: 215,
    nutrients: { ...BASE_NUTRIENTS },
    confidenceLevel: 'high' as const,
    estimationMethod: 'official' as const,
    source: {
      id: 'fd000000-0001-4000-a000-000000000003',
      name: "McDonald's Official",
      type: 'official' as const,
      url: null,
    },
    similarityDistance: null,
  },
};

// Food result with per_100g referenceBasis (common for food-level matches)
const MOCK_LEVEL1_FOOD_PER100G = {
  matchType: 'exact_food' as const,
  result: {
    entityType: 'food' as const,
    entityId: 'fd000000-0002-4000-a000-000000000001',
    name: 'Pollo asado',
    nameEs: 'Pollo asado',
    restaurantId: null,
    chainSlug: null,
    portionGrams: null,
    nutrients: { ...BASE_NUTRIENTS, referenceBasis: 'per_100g' as const },
    confidenceLevel: 'medium' as const,
    estimationMethod: 'standard' as const,
    source: {
      id: 'fd000000-0002-4000-a000-000000000003',
      name: 'USDA',
      type: 'official' as const,
      url: null,
    },
    similarityDistance: null,
  },
};

// Dish with large portionGrams for extreme multiplier test
const MOCK_LEVEL1_LARGE_PORTION = {
  ...MOCK_LEVEL1_DISH,
  result: {
    ...MOCK_LEVEL1_DISH.result,
    portionGrams: 500,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /estimate — F042 portionMultiplier edge cases', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockLevel2Lookup.mockResolvedValue(null);
  });

  // -------------------------------------------------------------------------
  // referenceBasis must change to per_serving when multiplier != 1.0
  // Spec §4: "When portionMultiplier !== 1.0 is applied, referenceBasis must be set to per_serving"
  // -------------------------------------------------------------------------

  it('food result with per_100g + portionMultiplier=1.5 → referenceBasis becomes per_serving', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_FOOD_PER100G);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=pollo&portionMultiplier=1.5',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    const result = body.data['result'] as Record<string, unknown>;
    const nutrients = result['nutrients'] as Record<string, unknown>;
    expect(nutrients['referenceBasis']).toBe('per_serving');
  });

  it('food result with per_100g + portionMultiplier=1.0 → referenceBasis stays per_100g (no transform)', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_FOOD_PER100G);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=pollo&portionMultiplier=1.0',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    const result = body.data['result'] as Record<string, unknown>;
    const nutrients = result['nutrients'] as Record<string, unknown>;
    // Multiplier == 1.0 → no transformation → referenceBasis unchanged
    expect(nutrients['referenceBasis']).toBe('per_100g');
  });

  it('food result with per_100g + absent portionMultiplier → referenceBasis stays per_100g', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_FOOD_PER100G);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=pollo',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    const result = body.data['result'] as Record<string, unknown>;
    const nutrients = result['nutrients'] as Record<string, unknown>;
    expect(nutrients['referenceBasis']).toBe('per_100g');
  });

  // -------------------------------------------------------------------------
  // Boundary values accepted at route level
  // -------------------------------------------------------------------------

  it('portionMultiplier=0.1 (minimum boundary) → 200, multiplier echoed', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_DISH);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac&portionMultiplier=0.1',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    expect(body.data['portionMultiplier']).toBe(0.1);
    const result = body.data['result'] as Record<string, unknown>;
    const nutrients = result['nutrients'] as Record<string, unknown>;
    // 550 * 0.1 = 55.0 — rounded to 2dp
    expect(nutrients['calories']).toBe(55);
    expect(result['portionGrams']).toBe(21.5); // 215 * 0.1 = 21.5
  });

  it('portionMultiplier=5.0 (maximum boundary) → 200, nutrients scaled ×5', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_DISH);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac&portionMultiplier=5.0',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    expect(body.data['portionMultiplier']).toBe(5);
    const result = body.data['result'] as Record<string, unknown>;
    const nutrients = result['nutrients'] as Record<string, unknown>;
    // 550 * 5 = 2750
    expect(nutrients['calories']).toBe(2750);
    // 25 * 5 = 125
    expect(nutrients['proteins']).toBe(125);
  });

  // -------------------------------------------------------------------------
  // Out-of-range boundaries rejected
  // -------------------------------------------------------------------------

  it('portionMultiplier=0.09 (just below minimum) → 400 VALIDATION_ERROR', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac&portionMultiplier=0.09',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('portionMultiplier=5.1 (just above maximum) → 400 VALIDATION_ERROR', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac&portionMultiplier=5.1',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // Large portionGrams — no cap (spec: display field only)
  // -------------------------------------------------------------------------

  it('portionGrams=500 × multiplier=5.0 → portionGrams=2500 (no cap)', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_LARGE_PORTION);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac&portionMultiplier=5.0',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    const result = body.data['result'] as Record<string, unknown>;
    expect(result['portionGrams']).toBe(2500);
  });

  // -------------------------------------------------------------------------
  // Rounding precision
  // -------------------------------------------------------------------------

  it('portionMultiplier=1.5 → salt (2.2 × 1.5 = 3.3) rounded to 2dp correctly', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_DISH);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac&portionMultiplier=1.5',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    const result = body.data['result'] as Record<string, unknown>;
    const nutrients = result['nutrients'] as Record<string, unknown>;
    expect(nutrients['salt']).toBe(3.3);
    // transFats: 0.5 * 1.5 = 0.75
    expect(nutrients['transFats']).toBe(0.75);
  });

  it('portionMultiplier=1.5 → portionGrams 215 × 1.5 = 322.5 (rounded to 1dp)', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_DISH);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac&portionMultiplier=1.5',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    const result = body.data['result'] as Record<string, unknown>;
    expect(result['portionGrams']).toBe(322.5);
  });

  // -------------------------------------------------------------------------
  // food result (portionGrams=null) with multiplier applied → portionGrams stays null
  // -------------------------------------------------------------------------

  it('food result with portionGrams=null + portionMultiplier=1.5 → portionGrams remains null', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_FOOD_PER100G);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=pollo&portionMultiplier=1.5',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    const result = body.data['result'] as Record<string, unknown>;
    expect(result['portionGrams']).toBeNull();
    // Nutrients still scaled
    const nutrients = result['nutrients'] as Record<string, unknown>;
    expect(nutrients['calories']).toBe(825); // 550 * 1.5
  });

  // -------------------------------------------------------------------------
  // Response schema compliance for all new variants
  // -------------------------------------------------------------------------

  it('portionMultiplier=0.1 response validates against EstimateResponseSchema', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_DISH);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac&portionMultiplier=0.1',
    });

    const parsed = EstimateResponseSchema.safeParse(response.json());
    expect(parsed.success).toBe(true);
  });

  it('portionMultiplier=5.0 response validates against EstimateResponseSchema', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_DISH);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac&portionMultiplier=5.0',
    });

    const parsed = EstimateResponseSchema.safeParse(response.json());
    expect(parsed.success).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Cache key distinction between portionMultiplier=1.0 and portionMultiplier=1.5
  // (regression: ensure both keys coexist without cross-contamination)
  // -------------------------------------------------------------------------

  it('portionMultiplier=1.5 and portionMultiplier=1.0 produce distinct cache keys', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_DISH);
    const app = await buildApp();

    await app.inject({ method: 'GET', url: '/estimate?query=Big+Mac&portionMultiplier=1.5' });
    const key15 = mockRedisGet.mock.calls[0]![0] as string;

    vi.resetAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_DISH);
    mockLevel2Lookup.mockResolvedValue(null);

    await app.inject({ method: 'GET', url: '/estimate?query=Big+Mac' });
    const key10 = mockRedisGet.mock.calls[0]![0] as string;

    expect(key15).not.toBe(key10);
    expect(key15).toMatch(/:1\.5$/);
    expect(key10).toMatch(/:1$/);
  });

  // -------------------------------------------------------------------------
  // Cache hit with portionMultiplier stored → returned correctly in response
  // -------------------------------------------------------------------------

  it('cache hit with portionMultiplier=1.5 stored → response echoes portionMultiplier=1.5', async () => {
    const cachedData = {
      query: 'Big Mac',
      chainSlug: null,
      portionMultiplier: 1.5,
      level1Hit: true,
      level2Hit: false,
      level3Hit: false,
      level4Hit: false,
      matchType: 'exact_dish',
      result: { ...MOCK_LEVEL1_DISH.result, portionGrams: 322.5, nutrients: { ...BASE_NUTRIENTS, calories: 825 } },
      cachedAt: '2026-03-28T10:00:00.000Z',
    };
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(cachedData));

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac&portionMultiplier=1.5',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    expect(body.data['portionMultiplier']).toBe(1.5);
    // level1Lookup NOT called (cache hit)
    expect(mockLevel1Lookup).not.toHaveBeenCalled();
    // cachedAt preserved
    expect(body.data['cachedAt']).toBe('2026-03-28T10:00:00.000Z');
  });
});
