// F021 Edge-Case Tests — Route Integration (QA Engineer)
//
// Covers route-level edge cases not addressed by the developer's f021.estimate.route.test.ts.
// Kept in a separate file from f021.edge-cases.test.ts to avoid vi.mock hoisting
// conflicts: this file mocks level2Lookup (needed for route tests), while the
// other file imports the real level2Lookup for unit tests.
//
// FINDINGS COVERED:
//   FINDING-F021-08 (INFO) — Unified cache key format verified with all param combos
//   Route-level: cache write on L1 hit, L2 hit, total miss; response casing; options forwarding.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted before any imports)
// ---------------------------------------------------------------------------

const { mockLevel1Lookup } = vi.hoisted(() => ({
  mockLevel1Lookup: vi.fn(),
}));

vi.mock('../estimation/level1Lookup.js', () => ({
  level1Lookup: mockLevel1Lookup,
}));

const { mockLevel2Lookup } = vi.hoisted(() => ({
  mockLevel2Lookup: vi.fn(),
}));

vi.mock('../estimation/level2Lookup.js', () => ({
  level2Lookup: mockLevel2Lookup,
}));

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
  },
}));

import type { PrismaClient } from '@prisma/client';

vi.mock('../lib/prisma.js', () => ({
  prisma: {} as PrismaClient,
}));

vi.mock('../lib/kysely.js', () => ({
  getKysely: () => ({
    getExecutor: () => ({
      executeQuery: vi.fn().mockResolvedValue({ rows: [] }),
      compileQuery: (node: unknown) => ({ sql: '', parameters: [], query: node }),
      transformQuery: (node: unknown) => node,
      withPlugins: function () { return this; },
    }),
  }),
  destroyKysely: vi.fn(),
}));

import { buildApp } from '../app.js';
import { EstimateResponseSchema } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_L2_RESULT = {
  matchType: 'ingredient_dish_exact' as const,
  resolvedCount: 2,
  totalCount: 2,
  ingredientSources: [],
  result: {
    entityType: 'dish' as const,
    entityId: 'fd000000-0021-4000-a000-000000000010',
    name: 'Pollo Especial',
    nameEs: 'Pollo Especial',
    restaurantId: 'fd000000-0021-4000-a000-000000000011',
    chainSlug: 'mcdonalds-es',
    portionGrams: 300,
    nutrients: {
      calories: 320, proteins: 28, carbohydrates: 30, sugars: 5,
      fats: 8, saturatedFats: 2, fiber: 4, salt: 1.2, sodium: 480,
      transFats: 0, cholesterol: 60, potassium: 400,
      monounsaturatedFats: 3, polyunsaturatedFats: 1.5, alcohol: 0,
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
    similarityDistance: null,
  },
};

const MOCK_L1_RESULT = {
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
      calories: 550, proteins: 25, carbohydrates: 46, sugars: 9,
      fats: 28, saturatedFats: 10, fiber: 3, salt: 2.2, sodium: 880,
      transFats: 0.5, cholesterol: 80, potassium: 0,
      monounsaturatedFats: 0, polyunsaturatedFats: 0, alcohol: 0,
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
    similarityDistance: null,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Section C — Route integration edge cases (F021)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockLevel1Lookup.mockResolvedValue(null);
    mockLevel2Lookup.mockResolvedValue(null);
  });

  // -------------------------------------------------------------------------
  // FINDING-F021-08 — Unified cache key structure
  // -------------------------------------------------------------------------

  it('[FINDING-F021-08] cache key: fxp:estimate:<query>:<chainSlug>:<restaurantId>:<portionMultiplier> (all 3 params)', async () => {
    const capturedKeys: string[] = [];
    mockRedisGet.mockImplementation((key: string) => {
      capturedKeys.push(key);
      return Promise.resolve(null);
    });

    const app = await buildApp();
    await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac&chainSlug=mcdonalds-es&restaurantId=fd000000-0021-4000-a000-000000000002',
    });

    expect(capturedKeys).toHaveLength(1);
    // F072: cache key format: fxp:estimate:<query>:<chainSlug>:<restaurantId>:<portionMultiplier>:<cookingState>:<cookingMethod>
    // (empty strings for absent cookingState/cookingMethod)
    expect(capturedKeys[0]).toBe(
      'fxp:estimate:big mac:mcdonalds-es:fd000000-0021-4000-a000-000000000002:1::',
    );
  });

  it('[FINDING-F021-08] cache key uses empty strings for absent chainSlug and restaurantId', async () => {
    const capturedKeys: string[] = [];
    mockRedisGet.mockImplementation((key: string) => {
      capturedKeys.push(key);
      return Promise.resolve(null);
    });

    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/estimate?query=pollo' });

    expect(capturedKeys[0]).toBe('fxp:estimate:pollo:::1::');
  });

  it('[FINDING-F021-08] cache key with only chainSlug — restaurantId segment is empty string', async () => {
    const capturedKeys: string[] = [];
    mockRedisGet.mockImplementation((key: string) => {
      capturedKeys.push(key);
      return Promise.resolve(null);
    });

    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/estimate?query=pollo&chainSlug=burger-king-es' });

    expect(capturedKeys[0]).toBe('fxp:estimate:pollo:burger-king-es::1::');
  });

  it('[FINDING-F021-08] different queries produce different cache keys (case-insensitive)', async () => {
    const capturedKeys: string[] = [];
    mockRedisGet.mockImplementation((key: string) => {
      capturedKeys.push(key);
      return Promise.resolve(null);
    });

    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/estimate?query=BIG+MAC' });
    await app.inject({ method: 'GET', url: '/estimate?query=big+mac' });

    expect(capturedKeys[0]).toBe(capturedKeys[1]); // Same normalized key
    expect(capturedKeys[0]).toBe('fxp:estimate:big mac:::1::');
  });

  // -------------------------------------------------------------------------
  // level2Lookup receives correct normalized query and options
  // -------------------------------------------------------------------------

  it('level2Lookup receives same chainSlug and restaurantId as level1Lookup', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'GET',
      url: '/estimate?query=Pollo+Especial&chainSlug=mcdonalds-es&restaurantId=fd000000-0021-4000-a000-000000000002',
    });

    expect(mockLevel2Lookup).toHaveBeenCalledWith(
      expect.anything(),
      'pollo especial',
      { chainSlug: 'mcdonalds-es', restaurantId: 'fd000000-0021-4000-a000-000000000002' },
    );
  });

  it('level2Lookup is NOT called when L1 hits (short-circuit)', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_L1_RESULT);

    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/estimate?query=Big+Mac' });

    expect(mockLevel2Lookup).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // L1 DB error → 500 (L2 never reached)
  // -------------------------------------------------------------------------

  it('level1Lookup throws DB_UNAVAILABLE → 500, level2Lookup not called', async () => {
    mockLevel1Lookup.mockRejectedValueOnce(
      Object.assign(new Error('DB error'), { code: 'DB_UNAVAILABLE' }),
    );

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/estimate?query=anything' });

    expect(response.statusCode).toBe(500);
    expect(mockLevel2Lookup).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cache hit scenarios
  // -------------------------------------------------------------------------

  it('cache hit containing L2 result → level2Hit:true, cachedAt non-null, no lookups called', async () => {
    const cachedData = {
      query: 'Pollo Especial',
      chainSlug: 'mcdonalds-es',
      level1Hit: false,
      level2Hit: true,
      level3Hit: false,
      matchType: 'ingredient_dish_exact',
      result: MOCK_L2_RESULT.result,
      cachedAt: '2026-03-18T12:00:00.000Z',
    };
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(cachedData));

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Pollo+Especial&chainSlug=mcdonalds-es',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: Record<string, unknown> }>();
    expect(body.data['level2Hit']).toBe(true);
    expect(body.data['level1Hit']).toBe(false);
    expect(body.data['cachedAt']).toBe('2026-03-18T12:00:00.000Z');
    expect(mockLevel1Lookup).not.toHaveBeenCalled();
    expect(mockLevel2Lookup).not.toHaveBeenCalled();
  });

  it('cache hit containing L1 result → level1Hit:true, level2Hit:false, no lookups', async () => {
    const cachedData = {
      query: 'Big Mac',
      chainSlug: 'mcdonalds-es',
      level1Hit: true,
      level2Hit: false,
      level3Hit: false,
      matchType: 'exact_dish',
      result: MOCK_L1_RESULT.result,
      cachedAt: '2026-03-18T12:00:00.000Z',
    };
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(cachedData));

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac&chainSlug=mcdonalds-es',
    });

    const body = response.json<{ data: Record<string, unknown> }>();
    expect(body.data['level1Hit']).toBe(true);
    expect(body.data['level2Hit']).toBe(false);
    expect(mockLevel1Lookup).not.toHaveBeenCalled();
    expect(mockLevel2Lookup).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Response echoes original query casing (not normalized)
  // -------------------------------------------------------------------------

  it('response.data.query echoes original Zod-trimmed casing when L2 hits', async () => {
    mockLevel2Lookup.mockResolvedValueOnce(MOCK_L2_RESULT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Pollo+Especial',
    });

    const body = response.json<{ data: { query: string } }>();
    expect(body.data.query).toBe('Pollo Especial');
  });

  it('response.data.query echoes original casing on total miss', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Unknown+Dish+Name',
    });

    const body = response.json<{ data: { query: string } }>();
    expect(body.data.query).toBe('Unknown Dish Name');
  });

  // -------------------------------------------------------------------------
  // Cache write behavior
  // -------------------------------------------------------------------------

  it('L2 hit result is written to cache with non-null cachedAt', async () => {
    const capturedCacheValues: string[] = [];
    mockRedisSet.mockImplementation((_key: string, value: string) => {
      capturedCacheValues.push(value);
      return Promise.resolve('OK');
    });
    mockLevel2Lookup.mockResolvedValueOnce(MOCK_L2_RESULT);

    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/estimate?query=Pollo+Especial' });

    expect(capturedCacheValues).toHaveLength(1);
    const cached = JSON.parse(capturedCacheValues[0]) as Record<string, unknown>;
    expect(cached['level2Hit']).toBe(true);
    expect(cached['level1Hit']).toBe(false);
    expect(cached['cachedAt']).not.toBeNull();
    expect(typeof cached['cachedAt']).toBe('string');
  });

  it('total miss is also written to cache (prevents repeated lookups for unknown queries)', async () => {
    const capturedCacheValues: string[] = [];
    mockRedisSet.mockImplementation((_key: string, value: string) => {
      capturedCacheValues.push(value);
      return Promise.resolve('OK');
    });

    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/estimate?query=completely+unknown' });

    expect(capturedCacheValues).toHaveLength(1);
    const cached = JSON.parse(capturedCacheValues[0]) as Record<string, unknown>;
    expect(cached['level1Hit']).toBe(false);
    expect(cached['level2Hit']).toBe(false);
    expect(cached['result']).toBeNull();
    expect(cached['cachedAt']).not.toBeNull();
  });

  it('L1 hit writes level2Hit:false to cache (only one Redis set call)', async () => {
    const capturedValues: string[] = [];
    mockRedisSet.mockImplementation((_key: string, value: string) => {
      capturedValues.push(value);
      return Promise.resolve('OK');
    });
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_L1_RESULT);

    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/estimate?query=Big+Mac' });

    expect(capturedValues).toHaveLength(1);
    const cached = JSON.parse(capturedValues[0]) as Record<string, unknown>;
    expect(cached['level1Hit']).toBe(true);
    expect(cached['level2Hit']).toBe(false);
  });

  // -------------------------------------------------------------------------
  // L2 FTS result schema validation
  // -------------------------------------------------------------------------

  it('L2 FTS hit response validates against EstimateResponseSchema', async () => {
    const ftsResult = {
      ...MOCK_L2_RESULT,
      matchType: 'ingredient_dish_fts' as const,
      result: { ...MOCK_L2_RESULT.result, confidenceLevel: 'low' as const },
    };
    mockLevel2Lookup.mockResolvedValueOnce(ftsResult);

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/estimate?query=hamburguesa' });

    const body = response.json();
    const parsed = EstimateResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(`Schema validation failed: ${JSON.stringify(parsed.error.issues)}`);
    }
    expect(parsed.success).toBe(true);
    expect(body.data.matchType).toBe('ingredient_dish_fts');
    expect(body.data.level2Hit).toBe(true);
    expect(body.data.result.confidenceLevel).toBe('low');
  });

  // -------------------------------------------------------------------------
  // Missing query param → 400 (not 500)
  // -------------------------------------------------------------------------

  it('missing query param → 400 VALIDATION_ERROR (not 500 from route)', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/estimate' });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // Cache key is shared: same query → second request hits cache
  // -------------------------------------------------------------------------

  it('second request with same query hits cache (unified key)', async () => {
    let getCallCount = 0;
    mockRedisGet.mockImplementation(() => {
      getCallCount++;
      if (getCallCount === 1) return Promise.resolve(null); // first: cache miss
      // Second request: return the cached data
      return Promise.resolve(JSON.stringify({
        query: 'pollo',
        chainSlug: null,
        level1Hit: false,
        level2Hit: false,
        level3Hit: false,
        matchType: null,
        result: null,
        cachedAt: '2026-03-18T12:00:00.000Z',
      }));
    });

    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/estimate?query=pollo' });
    const response2 = await app.inject({ method: 'GET', url: '/estimate?query=pollo' });

    expect(response2.statusCode).toBe(200);
    const body2 = response2.json<{ data: { cachedAt: string } }>();
    // Second response should come from cache (cachedAt is set)
    expect(body2.data.cachedAt).toBe('2026-03-18T12:00:00.000Z');
    // Lookups should only have been called once (first request), not for the cached second
    expect(mockLevel1Lookup).toHaveBeenCalledTimes(1);
    expect(mockLevel2Lookup).toHaveBeenCalledTimes(1);
  });
});
