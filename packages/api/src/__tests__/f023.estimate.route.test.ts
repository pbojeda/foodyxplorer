// Route tests for GET /estimate — Engine Router refactor (F023)
//
// Tests: cache hit bypasses router, L1 hit, L3 hit, total miss,
//        DB_UNAVAILABLE → 500, backward compat (EstimateResponseSchema),
//        levelHit from router result NOT exposed in HTTP response.
//
// Mocks runEstimationCascade directly (not individual lookups).
// Cache and infrastructure mocks follow the same pattern as f022.estimate.route.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { EstimateResponseSchema } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Mock runEstimationCascade
// ---------------------------------------------------------------------------

const { mockRunEstimationCascade } = vi.hoisted(() => ({
  mockRunEstimationCascade: vi.fn(),
}));

vi.mock('../estimation/engineRouter.js', () => ({
  runEstimationCascade: mockRunEstimationCascade,
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

const MOCK_RESULT = {
  entityType: 'dish' as const,
  entityId: 'fd000000-0023-4000-a000-000000000001',
  name: 'Big Mac',
  nameEs: 'Big Mac',
  restaurantId: 'fd000000-0023-4000-a000-000000000002',
  chainSlug: 'mcdonalds-es',
  portionGrams: 215,
  nutrients: BASE_NUTRIENTS,
  confidenceLevel: 'high' as const,
  estimationMethod: 'official' as const,
  source: {
    id: 'fd000000-0023-4000-a000-000000000003',
    name: "McDonald's Spain Official PDF",
    type: 'official' as const,
    url: 'https://www.mcdonalds.es/nutritional.pdf',
  },
  similarityDistance: null,
};

const ROUTER_L1_HIT = {
  levelHit: 1 as const,
  data: {
    query: 'Big Mac',
    chainSlug: 'mcdonalds-es',
    level1Hit: true,
    level2Hit: false,
    level3Hit: false,
    level4Hit: false,
    matchType: 'exact_dish' as const,
    result: MOCK_RESULT,
    cachedAt: null,
  },
};

const ROUTER_L3_HIT = {
  levelHit: 3 as const,
  data: {
    query: 'hamburguesa',
    chainSlug: 'burger-king-es',
    level1Hit: false,
    level2Hit: false,
    level3Hit: true,
    level4Hit: false,
    matchType: 'similarity_dish' as const,
    result: {
      ...MOCK_RESULT,
      entityId: 'fd000000-0023-4000-a000-000000000020',
      confidenceLevel: 'low' as const,
      estimationMethod: 'extrapolation' as const,
      similarityDistance: 0.18,
    },
    cachedAt: null,
  },
};

const ROUTER_TOTAL_MISS = {
  levelHit: null,
  data: {
    query: 'unknown dish',
    chainSlug: null,
    level1Hit: false,
    level2Hit: false,
    level3Hit: false,
    level4Hit: false,
    matchType: null,
    result: null,
    cachedAt: null,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /estimate — Engine Router refactor (F023)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: Redis cache miss
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    // Default: router returns total miss
    mockRunEstimationCascade.mockResolvedValue(ROUTER_TOTAL_MISS);
  });

  // -------------------------------------------------------------------------
  // Cache hit bypasses router
  // -------------------------------------------------------------------------

  it('cache hit → runEstimationCascade not called, returns cached data', async () => {
    const cachedData = {
      query: 'hamburguesa',
      chainSlug: 'burger-king-es',
      level1Hit: false,
      level2Hit: false,
      level3Hit: true,
      level4Hit: false,
      matchType: 'similarity_dish',
      result: MOCK_RESULT,
      cachedAt: '2026-03-19T10:00:00.000Z',
    };
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(cachedData));

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=hamburguesa&chainSlug=burger-king-es',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    expect(body.success).toBe(true);
    expect(body.data['level3Hit']).toBe(true);
    expect(body.data['cachedAt']).toBe('2026-03-19T10:00:00.000Z');
    expect(mockRunEstimationCascade).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // L1 hit from router
  // -------------------------------------------------------------------------

  it('router returns L1 hit → response has level1Hit:true, 200', async () => {
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L1_HIT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac&chainSlug=mcdonalds-es',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    expect(body.success).toBe(true);
    expect(body.data['level1Hit']).toBe(true);
    expect(body.data['level2Hit']).toBe(false);
    expect(body.data['level3Hit']).toBe(false);
    expect(body.data['matchType']).toBe('exact_dish');
    expect(body.data['cachedAt']).toBeNull();
  });

  // -------------------------------------------------------------------------
  // L3 hit from router
  // -------------------------------------------------------------------------

  it('router returns L3 hit → response has level3Hit:true, matchType=similarity_dish, 200', async () => {
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L3_HIT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=hamburguesa&chainSlug=burger-king-es',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    expect(body.success).toBe(true);
    expect(body.data['level3Hit']).toBe(true);
    expect(body.data['matchType']).toBe('similarity_dish');
  });

  // -------------------------------------------------------------------------
  // Total miss
  // -------------------------------------------------------------------------

  it('router returns total miss → all hit flags false, result:null, 200', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=unknown+dish',
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
  // DB_UNAVAILABLE → 500
  // -------------------------------------------------------------------------

  it('router throws DB_UNAVAILABLE → 500 response with code:DB_UNAVAILABLE', async () => {
    mockRunEstimationCascade.mockRejectedValueOnce(
      Object.assign(new Error('Database query failed'), {
        statusCode: 500,
        code: 'DB_UNAVAILABLE',
      }),
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
  // Backward compatibility — EstimateResponseSchema validates
  // -------------------------------------------------------------------------

  it('L1 hit response validates against EstimateResponseSchema', async () => {
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L1_HIT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac&chainSlug=mcdonalds-es',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const parsed = EstimateResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(`Schema validation failed: ${JSON.stringify(parsed.error.issues)}`);
    }
    expect(parsed.success).toBe(true);
  });

  it('total miss response validates against EstimateResponseSchema', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=unknown+dish',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const parsed = EstimateResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(`Schema validation failed: ${JSON.stringify(parsed.error.issues)}`);
    }
    expect(parsed.success).toBe(true);
  });

  // -------------------------------------------------------------------------
  // levelHit NOT exposed in HTTP response
  // -------------------------------------------------------------------------

  it('levelHit from router result is NOT present in the HTTP response body', async () => {
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L1_HIT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, unknown>>();
    // levelHit should not appear anywhere in the response
    expect(body['levelHit']).toBeUndefined();
    expect((body['data'] as Record<string, unknown>)?.['levelHit']).toBeUndefined();
  });
});
