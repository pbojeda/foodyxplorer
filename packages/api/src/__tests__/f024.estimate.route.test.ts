// Route tests for GET /estimate — F024 LLM Integration Layer (Level 4)
//
// Tests: L4 Strategy A hit, L4 Strategy B hit, total miss,
//        cache hit from prior L4 call, schema validation for L4 types,
//        level4Hit false in non-L4 responses, levelHit NOT in HTTP body,
//        level4Lookup wiring verification.
//
// Mocks runEstimationCascade directly (not individual lookups).
// Mock setup follows f023.estimate.route.test.ts pattern exactly.

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
import { level4Lookup } from '../estimation/level4Lookup.js';

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

const L4_FOOD_MATCH_NUTRIENTS = { ...BASE_NUTRIENTS, referenceBasis: 'per_100g' as const };

const L4_FOOD_MATCH_RESULT = {
  entityType: 'food' as const,
  entityId: 'fd000000-0024-4000-a000-000000000001',
  name: 'Pollo asado',
  nameEs: 'Pollo asado',
  restaurantId: null,
  chainSlug: null,
  portionGrams: null,
  nutrients: L4_FOOD_MATCH_NUTRIENTS,
  confidenceLevel: 'medium' as const,
  estimationMethod: 'llm' as const,
  source: {
    id: '00000000-0000-0000-0000-000000000017',
    name: 'LLM-assisted identification',
    type: 'estimated' as const,
    url: null,
  },
  similarityDistance: null,
};

const ROUTER_L4_FOOD_MATCH_HIT = {
  levelHit: 4 as const,
  data: {
    query: 'pollo asado desmenuzado',
    chainSlug: null,
    level1Hit: false,
    level2Hit: false,
    level3Hit: false,
    level4Hit: true,
    matchType: 'llm_food_match' as const,
    result: L4_FOOD_MATCH_RESULT,
    cachedAt: null,
  },
};

const ROUTER_L4_DECOMPOSITION_HIT = {
  levelHit: 4 as const,
  data: {
    query: 'ensalada mixta con atún',
    chainSlug: null,
    level1Hit: false,
    level2Hit: false,
    level3Hit: false,
    level4Hit: true,
    matchType: 'llm_ingredient_decomposition' as const,
    result: {
      entityType: 'food' as const,
      entityId: 'fd000000-0024-4000-a000-000000000002',
      name: 'ensalada mixta con atún',
      nameEs: null,
      restaurantId: null,
      chainSlug: null,
      portionGrams: 300,
      nutrients: { ...L4_FOOD_MATCH_NUTRIENTS, referenceBasis: 'per_serving' as const },
      confidenceLevel: 'medium' as const,
      estimationMethod: 'llm' as const,
      source: {
        id: '00000000-0000-0000-0000-000000000017',
        name: 'LLM-assisted identification',
        type: 'estimated' as const,
        url: null,
      },
      similarityDistance: null,
    },
    cachedAt: null,
  },
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
    result: {
      entityType: 'dish' as const,
      entityId: 'fd000000-0024-4000-a000-000000000010',
      name: 'Big Mac',
      nameEs: 'Big Mac',
      restaurantId: 'fd000000-0024-4000-a000-000000000011',
      chainSlug: 'mcdonalds-es',
      portionGrams: 215,
      nutrients: BASE_NUTRIENTS,
      confidenceLevel: 'high' as const,
      estimationMethod: 'official' as const,
      source: {
        id: 'fd000000-0024-4000-a000-000000000012',
        name: "McDonald's Spain Official PDF",
        type: 'official' as const,
        url: 'https://www.mcdonalds.es/nutritional.pdf',
      },
      similarityDistance: null,
    },
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
      entityType: 'dish' as const,
      entityId: 'fd000000-0024-4000-a000-000000000020',
      name: 'Hamburguesa Clásica',
      nameEs: 'Hamburguesa Clásica',
      restaurantId: 'fd000000-0024-4000-a000-000000000021',
      chainSlug: 'burger-king-es',
      portionGrams: 200,
      nutrients: BASE_NUTRIENTS,
      confidenceLevel: 'low' as const,
      estimationMethod: 'extrapolation' as const,
      source: {
        id: 'fd000000-0024-4000-a000-000000000022',
        name: 'Burger King Spain Official',
        type: 'official' as const,
        url: null,
      },
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

describe('GET /estimate — F024 LLM Integration Layer (Level 4)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: Redis cache miss
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    // Default: router returns total miss
    mockRunEstimationCascade.mockResolvedValue(ROUTER_TOTAL_MISS);
  });

  // -------------------------------------------------------------------------
  // Test 1: L4 Strategy A hit
  // -------------------------------------------------------------------------

  it('test 1: router returns L4 Strategy A hit → response has level4Hit:true, matchType:llm_food_match, HTTP 200', async () => {
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L4_FOOD_MATCH_HIT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=pollo+asado+desmenuzado',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    expect(body.success).toBe(true);
    expect(body.data['level4Hit']).toBe(true);
    expect(body.data['matchType']).toBe('llm_food_match');
    expect(body.data['level1Hit']).toBe(false);
    expect(body.data['level2Hit']).toBe(false);
    expect(body.data['level3Hit']).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 2: L4 Strategy B hit
  // -------------------------------------------------------------------------

  it('test 2: router returns L4 Strategy B hit → response has level4Hit:true, matchType:llm_ingredient_decomposition, HTTP 200', async () => {
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L4_DECOMPOSITION_HIT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=ensalada+mixta+con+at%C3%BAn',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    expect(body.success).toBe(true);
    expect(body.data['level4Hit']).toBe(true);
    expect(body.data['matchType']).toBe('llm_ingredient_decomposition');
  });

  // -------------------------------------------------------------------------
  // Test 3: Total miss → level4Hit:false
  // -------------------------------------------------------------------------

  it('test 3: router returns total miss → level4Hit:false, result:null, HTTP 200', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=unknown+dish',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    expect(body.success).toBe(true);
    expect(body.data['level4Hit']).toBe(false);
    expect(body.data['result']).toBeNull();
    expect(body.data['matchType']).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 4: Cache hit from prior L4 call
  // -------------------------------------------------------------------------

  it('test 4: cache hit from prior L4 call → runEstimationCascade not called, cachedAt non-null', async () => {
    const cachedData = {
      query: 'pollo asado desmenuzado',
      chainSlug: null,
      level1Hit: false,
      level2Hit: false,
      level3Hit: false,
      level4Hit: true,
      matchType: 'llm_food_match',
      result: L4_FOOD_MATCH_RESULT,
      cachedAt: '2026-03-19T10:00:00.000Z',
    };
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(cachedData));

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=pollo+asado+desmenuzado',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    expect(body.success).toBe(true);
    expect(body.data['level4Hit']).toBe(true);
    expect(body.data['cachedAt']).toBe('2026-03-19T10:00:00.000Z');
    expect(mockRunEstimationCascade).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 5: Schema validation — L4 food match
  // -------------------------------------------------------------------------

  it('test 5: L4 food match response validates against EstimateResponseSchema', async () => {
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L4_FOOD_MATCH_HIT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=pollo+asado+desmenuzado',
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
  // Test 6: Schema validation — L4 decomposition
  // -------------------------------------------------------------------------

  it('test 6: L4 decomposition response validates against EstimateResponseSchema', async () => {
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L4_DECOMPOSITION_HIT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=ensalada+mixta+con+at%C3%BAn',
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
  // Test 7: level4Hit is false in all non-L4 router responses
  // -------------------------------------------------------------------------

  it('test 7: level4Hit is false in L1 hit, L3 hit, and total miss responses', async () => {
    const app = await buildApp();

    // L1 hit
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L1_HIT);
    let response = await app.inject({ method: 'GET', url: '/estimate?query=Big+Mac&chainSlug=mcdonalds-es' });
    expect(response.json<{ data: Record<string, unknown> }>().data['level4Hit']).toBe(false);

    // L3 hit
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L3_HIT);
    response = await app.inject({ method: 'GET', url: '/estimate?query=hamburguesa&chainSlug=burger-king-es' });
    expect(response.json<{ data: Record<string, unknown> }>().data['level4Hit']).toBe(false);

    // Total miss (default mock)
    response = await app.inject({ method: 'GET', url: '/estimate?query=unknown' });
    expect(response.json<{ data: Record<string, unknown> }>().data['level4Hit']).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 8: levelHit NOT present in HTTP response body
  // -------------------------------------------------------------------------

  it('test 8: levelHit from router result is NOT present in the HTTP response body', async () => {
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L4_FOOD_MATCH_HIT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=pollo+asado+desmenuzado',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, unknown>>();
    // levelHit should not appear anywhere in the response
    expect(body['levelHit']).toBeUndefined();
    expect((body['data'] as Record<string, unknown>)?.['levelHit']).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Test 9: level4Lookup is passed in runEstimationCascade call args
  // -------------------------------------------------------------------------

  it('test 9: runEstimationCascade is called with the imported level4Lookup function', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/estimate?query=test+dish' });

    expect(mockRunEstimationCascade).toHaveBeenCalledOnce();
    const callArgs = mockRunEstimationCascade.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    expect(callArgs?.level4Lookup).toBe(level4Lookup);
  });
});
