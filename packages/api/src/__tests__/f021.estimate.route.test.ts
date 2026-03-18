// Route tests for GET /estimate — Level 2 integration (F021)
//
// Tests: L1 miss + L2 hit, L1 hit (L2 not called), total miss,
//        cache hit, Redis fail-open, L2 DB error → 500, schema validation.
//
// Uses buildApp().inject(). Mocks level1Lookup, level2Lookup, and Redis.
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
// Mock Redis — fail-open and cache hit scenarios
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
// Mock Prisma (not used by estimate route but required by buildApp)
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

const MOCK_LEVEL1_RESULT = {
  matchType: 'exact_dish' as const,
  result: {
    entityType: 'dish' as const,
    entityId: 'fd000000-0021-4000-a000-000000000001',
    name: 'Big Mac',
    nameEs: 'Big Mac',
    restaurantId: 'fd000000-0021-4000-a000-000000000002',
    chainSlug: 'mcdonalds-es',
    portionGrams: 215,
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
      referenceBasis: 'per_serving' as const,
    },
    confidenceLevel: 'high' as const,
    estimationMethod: 'official' as const,
    source: {
      id: 'fd000000-0021-4000-a000-000000000003',
      name: "McDonald's Spain Official PDF",
      type: 'official' as const,
      url: 'https://www.mcdonalds.es/nutritional.pdf',
    },
  },
};

const MOCK_LEVEL2_RESULT = {
  matchType: 'ingredient_dish_exact' as const,
  resolvedCount: 2,
  totalCount: 2,
  ingredientSources: [],
  result: {
    entityType: 'dish' as const,
    entityId: 'fd000000-0021-4000-a000-000000000010',
    name: 'Pollo con Verduras',
    nameEs: 'Pollo con Verduras',
    restaurantId: 'fd000000-0021-4000-a000-000000000011',
    chainSlug: 'mcdonalds-es',
    portionGrams: 300,
    nutrients: {
      calories: 320,
      proteins: 28,
      carbohydrates: 30,
      sugars: 5,
      fats: 8,
      saturatedFats: 2,
      fiber: 4,
      salt: 1.2,
      sodium: 480,
      transFats: 0,
      cholesterol: 60,
      potassium: 400,
      monounsaturatedFats: 3,
      polyunsaturatedFats: 1.5,
      referenceBasis: 'per_serving' as const,
    },
    confidenceLevel: 'medium' as const,
    estimationMethod: 'ingredients' as const,
    source: {
      id: 'fd000000-0021-4000-a000-000000000012',
      name: 'Computed from ingredients',
      type: 'estimated' as const,
      url: null,
    },
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /estimate — Level 2 integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: Redis returns null (cache miss)
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    // Default: L1 misses
    mockLevel1Lookup.mockResolvedValue(null);
    // Default: L2 misses
    mockLevel2Lookup.mockResolvedValue(null);
  });

  // -------------------------------------------------------------------------
  // L1 miss + L2 hit
  // -------------------------------------------------------------------------

  it('L1 miss + L2 hit → calls level2Lookup, returns level2Hit:true with 200', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(null);
    mockLevel2Lookup.mockResolvedValueOnce(MOCK_LEVEL2_RESULT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Pollo+con+Verduras&chainSlug=mcdonalds-es',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    expect(body.success).toBe(true);
    expect(body.data['level1Hit']).toBe(false);
    expect(body.data['level2Hit']).toBe(true);
    expect(body.data['matchType']).toBe('ingredient_dish_exact');
    expect(body.data['cachedAt']).toBeNull();
    expect(mockLevel2Lookup).toHaveBeenCalledTimes(1);
  });

  it('L1 miss + L2 hit → result has confidenceLevel=medium and estimationMethod=ingredients', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(null);
    mockLevel2Lookup.mockResolvedValueOnce(MOCK_LEVEL2_RESULT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Pollo+con+Verduras',
    });

    const body = response.json<{ data: { result: { confidenceLevel: string; estimationMethod: string } } }>();
    expect(body.data.result.confidenceLevel).toBe('medium');
    expect(body.data.result.estimationMethod).toBe('ingredients');
  });

  // -------------------------------------------------------------------------
  // L1 hit — L2 not called
  // -------------------------------------------------------------------------

  it('L1 hit → level2Lookup not called, level2Hit:false', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_RESULT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac&chainSlug=mcdonalds-es',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: Record<string, unknown> }>();
    expect(body.data['level1Hit']).toBe(true);
    expect(body.data['level2Hit']).toBe(false);
    expect(mockLevel2Lookup).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // L1 miss + L2 miss — total miss
  // -------------------------------------------------------------------------

  it('L1 miss + L2 miss → both hits false, result:null, 200', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(null);
    mockLevel2Lookup.mockResolvedValueOnce(null);

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
    expect(body.data['result']).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Cache hit — neither lookup called
  // -------------------------------------------------------------------------

  it('cache hit → neither level1Lookup nor level2Lookup called, cachedAt non-null', async () => {
    const cachedData = {
      query: 'Pollo con Verduras',
      chainSlug: 'mcdonalds-es',
      level1Hit: false,
      level2Hit: true,
      matchType: 'ingredient_dish_exact',
      result: MOCK_LEVEL2_RESULT.result,
      cachedAt: '2026-03-18T10:00:00.000Z',
    };
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(cachedData));

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Pollo+con+Verduras&chainSlug=mcdonalds-es',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: Record<string, unknown> }>();
    expect(body.data['cachedAt']).toBe('2026-03-18T10:00:00.000Z');
    expect(body.data['level2Hit']).toBe(true);
    expect(mockLevel1Lookup).not.toHaveBeenCalled();
    expect(mockLevel2Lookup).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Redis unavailable — fail-open
  // -------------------------------------------------------------------------

  it('Redis get unavailable → fail-open, lookups are called', async () => {
    mockRedisGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    mockLevel2Lookup.mockResolvedValueOnce(MOCK_LEVEL2_RESULT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Pollo+con+Verduras',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: Record<string, unknown> }>();
    expect(body.data['level2Hit']).toBe(true);
    // Both lookups were called despite Redis being down
    expect(mockLevel1Lookup).toHaveBeenCalledTimes(1);
    expect(mockLevel2Lookup).toHaveBeenCalledTimes(1);
  });

  it('Redis set unavailable → fail-open, result is returned normally', async () => {
    mockRedisGet.mockResolvedValueOnce(null);
    mockRedisSet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    mockLevel2Lookup.mockResolvedValueOnce(MOCK_LEVEL2_RESULT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Pollo+con+Verduras',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: Record<string, unknown> }>();
    expect(body.data['level2Hit']).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Level 2 DB error → 500
  // -------------------------------------------------------------------------

  it('level2Lookup throws DB_UNAVAILABLE → 500 response', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(null);
    mockLevel2Lookup.mockRejectedValueOnce(
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
  // Response schema validation
  // -------------------------------------------------------------------------

  it('L2 hit response validates against EstimateResponseSchema', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(null);
    mockLevel2Lookup.mockResolvedValueOnce(MOCK_LEVEL2_RESULT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Pollo+con+Verduras&chainSlug=mcdonalds-es',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const parsed = EstimateResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it('total miss response validates against EstimateResponseSchema', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(null);
    mockLevel2Lookup.mockResolvedValueOnce(null);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=completely+unknown',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const parsed = EstimateResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Unified cache key — level2Lookup receives normalized query
  // -------------------------------------------------------------------------

  it('level2Lookup receives normalized query (lowercased, collapsed whitespace)', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(null);
    mockLevel2Lookup.mockResolvedValueOnce(null);

    const app = await buildApp();
    await app.inject({
      method: 'GET',
      url: '/estimate?query=Pollo%20%20con%20Verduras',
    });

    expect(mockLevel2Lookup).toHaveBeenCalledWith(
      mockKyselyDb,
      'pollo con verduras', // normalized
      expect.any(Object),
    );
  });
});
