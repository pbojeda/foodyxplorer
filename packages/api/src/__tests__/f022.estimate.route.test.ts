// Route tests for GET /estimate — Level 3 integration (F022)
//
// Tests: L1+L2 miss → L3 hit (dish), L1+L2 miss → L3 hit (food),
//        L3 total miss, L1 hit (L3 not called), L2 hit (L3 not called),
//        OpenAI failure → total miss (no 500), L3 DB error → 500,
//        cache hit returns level3Hit, response schema validation.
//
// Uses buildApp().inject(). Mocks level1Lookup, level2Lookup, level3Lookup, and Redis.
// No real DB calls.

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
  offFallbackFoodMatch: vi.fn().mockResolvedValue(undefined),
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
// Mock level3Lookup
// ---------------------------------------------------------------------------

const { mockLevel3Lookup } = vi.hoisted(() => ({
  mockLevel3Lookup: vi.fn(),
}));

vi.mock('../estimation/level3Lookup.js', () => ({
  level3Lookup: mockLevel3Lookup,
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
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  } as unknown as Redis,
}));

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

vi.mock('../lib/prisma.js', () => ({
  prisma: {} as PrismaClient,
}));

// ---------------------------------------------------------------------------
// Mock Kysely getKysely
// ---------------------------------------------------------------------------

const mockKyselyDb = {
  getExecutor: () => ({
    executeQuery: vi.fn().mockResolvedValue({ rows: [] }),
    compileQuery: (node: unknown) => ({ sql: '', parameters: [], query: node }),
    transformQuery: (node: unknown) => node,
    withPlugins: function () { return this; },
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

const MOCK_L3_DISH_RESULT = {
  matchType: 'similarity_dish' as const,
  similarityDistance: 0.18,
  result: {
    entityType: 'dish' as const,
    entityId: 'fd000000-0022-4000-a000-000000000001',
    name: 'Hamburguesa Clásica',
    nameEs: 'Hamburguesa Clásica',
    restaurantId: 'fd000000-0022-4000-a000-000000000002',
    chainSlug: 'burger-king-es',
    portionGrams: 200,
    nutrients: BASE_NUTRIENTS,
    confidenceLevel: 'low' as const,
    estimationMethod: 'extrapolation' as const,
    source: {
      id: 'fd000000-0022-4000-a000-000000000003',
      name: 'Burger King Spain Official',
      type: 'official' as const,
      url: null,
    },
    similarityDistance: 0.18,
  },
};

const MOCK_L3_FOOD_RESULT = {
  matchType: 'similarity_food' as const,
  similarityDistance: 0.25,
  result: {
    entityType: 'food' as const,
    entityId: 'fd000000-0022-4000-a000-000000000010',
    name: 'Carne de Ternera Picada',
    nameEs: 'Carne de Ternera Picada',
    restaurantId: null,
    chainSlug: null,
    portionGrams: null,
    nutrients: {
      ...BASE_NUTRIENTS,
      calories: 250,
      referenceBasis: 'per_100g' as const,
    },
    confidenceLevel: 'low' as const,
    estimationMethod: 'extrapolation' as const,
    source: {
      id: 'fd000000-0022-4000-a000-000000000011',
      name: 'BEDCA',
      type: 'official' as const,
      url: 'https://bedca.net',
    },
    similarityDistance: 0.25,
  },
};

const MOCK_LEVEL1_RESULT = {
  matchType: 'exact_dish' as const,
  result: {
    entityType: 'dish' as const,
    entityId: 'fd000000-0022-4000-a000-000000000020',
    name: 'Big Mac',
    nameEs: 'Big Mac',
    restaurantId: 'fd000000-0022-4000-a000-000000000021',
    chainSlug: 'mcdonalds-es',
    portionGrams: 215,
    nutrients: { ...BASE_NUTRIENTS, calories: 550 },
    confidenceLevel: 'high' as const,
    estimationMethod: 'official' as const,
    source: {
      id: 'fd000000-0022-4000-a000-000000000022',
      name: "McDonald's Spain Official PDF",
      type: 'official' as const,
      url: 'https://www.mcdonalds.es/nutritional.pdf',
    },
    similarityDistance: null,
  },
};

const MOCK_LEVEL2_RESULT = {
  matchType: 'ingredient_dish_exact' as const,
  resolvedCount: 2,
  totalCount: 2,
  ingredientSources: [],
  result: {
    entityType: 'dish' as const,
    entityId: 'fd000000-0022-4000-a000-000000000030',
    name: 'Pollo con Verduras',
    nameEs: 'Pollo con Verduras',
    restaurantId: 'fd000000-0022-4000-a000-000000000031',
    chainSlug: 'mcdonalds-es',
    portionGrams: 300,
    nutrients: { ...BASE_NUTRIENTS, calories: 320 },
    confidenceLevel: 'medium' as const,
    estimationMethod: 'ingredients' as const,
    source: {
      id: 'fd000000-0022-4000-a000-000000000032',
      name: 'Computed from ingredients',
      type: 'estimated' as const,
      url: null,
    },
    similarityDistance: null,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /estimate — Level 3 integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: Redis cache miss
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    // Default: all levels miss
    mockLevel1Lookup.mockResolvedValue(null);
    mockLevel2Lookup.mockResolvedValue(null);
    mockLevel3Lookup.mockResolvedValue(null);
  });

  // -------------------------------------------------------------------------
  // L1+L2 miss + L3 dish hit
  // -------------------------------------------------------------------------

  it('L1+L2 miss + L3 dish hit → level3Hit:true, matchType=similarity_dish, 200', async () => {
    mockLevel3Lookup.mockResolvedValueOnce(MOCK_L3_DISH_RESULT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=hamburguesa&chainSlug=burger-king-es',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    expect(body.success).toBe(true);
    expect(body.data['level1Hit']).toBe(false);
    expect(body.data['level2Hit']).toBe(false);
    expect(body.data['level3Hit']).toBe(true);
    expect(body.data['matchType']).toBe('similarity_dish');
    expect(body.data['cachedAt']).toBeNull();
  });

  it('L3 dish hit → result has confidenceLevel=low and estimationMethod=extrapolation', async () => {
    mockLevel3Lookup.mockResolvedValueOnce(MOCK_L3_DISH_RESULT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=hamburguesa',
    });

    const body = response.json<{ data: { result: { confidenceLevel: string; estimationMethod: string } } }>();
    expect(body.data.result.confidenceLevel).toBe('low');
    expect(body.data.result.estimationMethod).toBe('extrapolation');
  });

  it('L3 dish hit → result has similarityDistance in response', async () => {
    mockLevel3Lookup.mockResolvedValueOnce(MOCK_L3_DISH_RESULT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=hamburguesa',
    });

    const body = response.json<{ data: { result: { similarityDistance: number } } }>();
    expect(body.data.result.similarityDistance).toBeCloseTo(0.18, 5);
  });

  // -------------------------------------------------------------------------
  // L1+L2 miss + L3 food hit
  // -------------------------------------------------------------------------

  it('L1+L2 miss + L3 food hit → level3Hit:true, matchType=similarity_food, 200', async () => {
    mockLevel3Lookup.mockResolvedValueOnce(MOCK_L3_FOOD_RESULT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=ternera+picada',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    expect(body.data['level3Hit']).toBe(true);
    expect(body.data['matchType']).toBe('similarity_food');
  });

  // -------------------------------------------------------------------------
  // L1+L2+L3 total miss
  // -------------------------------------------------------------------------

  it('L1+L2+L3 total miss → all hit flags false, result:null, 200', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=completely+unknown+dish',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    expect(body.success).toBe(true);
    expect(body.data['level1Hit']).toBe(false);
    expect(body.data['level2Hit']).toBe(false);
    expect(body.data['level3Hit']).toBe(false);
    expect(body.data['result']).toBeNull();
    expect(body.data['matchType']).toBeNull();
  });

  // -------------------------------------------------------------------------
  // L1 hit — L2 and L3 not called
  // -------------------------------------------------------------------------

  it('L1 hit → level3Lookup not called, level3Hit:false', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_RESULT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: Record<string, unknown> }>();
    expect(body.data['level1Hit']).toBe(true);
    expect(body.data['level2Hit']).toBe(false);
    expect(body.data['level3Hit']).toBe(false);
    expect(mockLevel3Lookup).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // L2 hit — L3 not called
  // -------------------------------------------------------------------------

  it('L2 hit → level3Lookup not called, level3Hit:false', async () => {
    mockLevel2Lookup.mockResolvedValueOnce(MOCK_LEVEL2_RESULT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Pollo+con+Verduras',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: Record<string, unknown> }>();
    expect(body.data['level2Hit']).toBe(true);
    expect(body.data['level3Hit']).toBe(false);
    expect(mockLevel3Lookup).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // L3 called with same options as L1 and L2
  // -------------------------------------------------------------------------

  it('level3Lookup receives normalized query and chainSlug option', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'GET',
      url: '/estimate?query=Hamburguesa+Cl%C3%A1sica&chainSlug=burger-king-es',
    });

    // Verify level3Lookup was called with the normalized query and chainSlug.
    // openAiApiKey may be undefined in test env (OPENAI_API_KEY not set) — that's fine.
    expect(mockLevel3Lookup).toHaveBeenCalledWith(
      mockKyselyDb,
      'hamburguesa clásica', // normalized
      expect.objectContaining({
        chainSlug: 'burger-king-es',
      }),
    );
  });

  // -------------------------------------------------------------------------
  // OpenAI failure → total miss (no HTTP 500)
  // -------------------------------------------------------------------------

  it('level3Lookup returns null (OpenAI failed) → total miss, 200, no HTTP 500', async () => {
    // level3Lookup handles OpenAI failures internally and returns null
    mockLevel3Lookup.mockResolvedValueOnce(null);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=unknown+dish',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    expect(body.success).toBe(true);
    expect(body.data['level3Hit']).toBe(false);
    expect(body.data['result']).toBeNull();
  });

  // -------------------------------------------------------------------------
  // L3 DB error → 500
  // -------------------------------------------------------------------------

  it('level3Lookup throws DB_UNAVAILABLE → 500 response', async () => {
    mockLevel3Lookup.mockRejectedValueOnce(
      Object.assign(new Error('Database query failed'), { code: 'DB_UNAVAILABLE' }),
    );

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=test+dish',
    });

    expect(response.statusCode).toBe(500);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('DB_UNAVAILABLE');
  });

  // -------------------------------------------------------------------------
  // Cache hit containing L3 result
  // -------------------------------------------------------------------------

  it('cache hit with level3Hit:true → no lookups called, returns cached L3 data', async () => {
    const cachedData = {
      query: 'hamburguesa',
      chainSlug: 'burger-king-es',
      level1Hit: false,
      level2Hit: false,
      level3Hit: true,
      matchType: 'similarity_dish',
      result: MOCK_L3_DISH_RESULT.result,
      cachedAt: '2026-03-19T10:00:00.000Z',
    };
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(cachedData));

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=hamburguesa&chainSlug=burger-king-es',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: Record<string, unknown> }>();
    expect(body.data['level3Hit']).toBe(true);
    expect(body.data['matchType']).toBe('similarity_dish');
    expect(body.data['cachedAt']).toBe('2026-03-19T10:00:00.000Z');
    expect(mockLevel1Lookup).not.toHaveBeenCalled();
    expect(mockLevel2Lookup).not.toHaveBeenCalled();
    expect(mockLevel3Lookup).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Response schema validation
  // -------------------------------------------------------------------------

  it('L3 dish hit response validates against EstimateResponseSchema', async () => {
    mockLevel3Lookup.mockResolvedValueOnce(MOCK_L3_DISH_RESULT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=hamburguesa&chainSlug=burger-king-es',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const parsed = EstimateResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(`Schema validation failed: ${JSON.stringify(parsed.error.issues)}`);
    }
    expect(parsed.success).toBe(true);
  });

  it('total miss response validates against EstimateResponseSchema (with level3Hit:false)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=completely+unknown',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const parsed = EstimateResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(`Schema validation failed: ${JSON.stringify(parsed.error.issues)}`);
    }
    expect(parsed.success).toBe(true);
  });
});
