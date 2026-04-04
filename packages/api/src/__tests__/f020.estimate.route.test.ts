// Route tests for GET /estimate
//
// Uses buildApp().inject(). Mocks level1Lookup and Redis at module level.
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
// Mock level2Lookup — stub only, full tests in f021.estimate.route.test.ts
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
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
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
    entityId: 'fd000000-0001-4000-a000-000000000001',
    name: 'Big Mac',
    nameEs: 'Big Mac',
    restaurantId: 'fd000000-0001-4000-a000-000000000002',
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
      alcohol: 0,
      referenceBasis: 'per_serving' as const,
    },
    confidenceLevel: 'high' as const,
    estimationMethod: 'official' as const,
    source: {
      id: 'fd000000-0001-4000-a000-000000000003',
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

describe('GET /estimate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: Redis returns null (cache miss)
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    // Default: level2Lookup returns null (L1 tests don't exercise L2)
    mockLevel2Lookup.mockResolvedValue(null);
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  it('returns 400 VALIDATION_ERROR when query param is missing', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/estimate' });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when query is empty string', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/estimate?query=' });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when query exceeds 255 chars', async () => {
    const app = await buildApp();
    const longQuery = 'a'.repeat(256);
    const response = await app.inject({ method: 'GET', url: `/estimate?query=${longQuery}` });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when restaurantId is not a valid UUID', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=burger&restaurantId=not-a-uuid',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when chainSlug has invalid characters', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=burger&chainSlug=McDonalds_ES',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // Cache miss — live result
  // -------------------------------------------------------------------------

  it('cache miss → calls level1Lookup, returns 200 with level1Hit:true', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_RESULT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac&chainSlug=mcdonalds-es',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    expect(body.success).toBe(true);
    expect(body.data['level1Hit']).toBe(true);
    expect(body.data['matchType']).toBe('exact_dish');
    expect(body.data['cachedAt']).toBeNull();
    expect(mockLevel1Lookup).toHaveBeenCalledTimes(1);
  });

  it('cache miss → level1Lookup returns null → 200 with level1Hit:false', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(null);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=something+completely+unknown',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    expect(body.success).toBe(true);
    expect(body.data['level1Hit']).toBe(false);
    expect(body.data['matchType']).toBeNull();
    expect(body.data['result']).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Cache hit
  // -------------------------------------------------------------------------

  it('cache hit → returns cached data with non-null cachedAt, level1Lookup not called', async () => {
    const cachedData = {
      query: 'Big Mac',
      chainSlug: 'mcdonalds-es',
      portionMultiplier: 1.0,
      level1Hit: true,
      level2Hit: false,
      level3Hit: false,
      level4Hit: false,
      matchType: 'exact_dish',
      result: MOCK_LEVEL1_RESULT.result,
      cachedAt: '2026-03-17T14:00:00.000Z',
    };
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(cachedData));

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac&chainSlug=mcdonalds-es',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    expect(body.success).toBe(true);
    expect(body.data['cachedAt']).toBe('2026-03-17T14:00:00.000Z');
    expect(body.data['level1Hit']).toBe(true);
    // level1Lookup should NOT be called on cache hit
    expect(mockLevel1Lookup).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Redis unavailable — fail-open
  // -------------------------------------------------------------------------

  it('Redis unavailable → fail-open, returns live result without error', async () => {
    mockRedisGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_RESULT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    expect(body.success).toBe(true);
    expect(body.data['level1Hit']).toBe(true);
    // level1Lookup was called despite Redis being down
    expect(mockLevel1Lookup).toHaveBeenCalledTimes(1);
  });

  it('Redis set failure does not cause error — fail-open on write', async () => {
    mockRedisGet.mockResolvedValueOnce(null);
    mockRedisSet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_RESULT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac',
    });

    // Should still return 200 even if cache write fails
    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    expect(body.success).toBe(true);
  });

  // -------------------------------------------------------------------------
  // DB error → 500
  // -------------------------------------------------------------------------

  it('level1Lookup throws DB_UNAVAILABLE → 500', async () => {
    mockLevel1Lookup.mockRejectedValueOnce(
      Object.assign(new Error('Database query failed'), { code: 'DB_UNAVAILABLE' }),
    );

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac',
    });

    expect(response.statusCode).toBe(500);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('DB_UNAVAILABLE');
  });

  // -------------------------------------------------------------------------
  // Response schema validation
  // -------------------------------------------------------------------------

  it('response validates against EstimateResponseSchema (hit case)', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_RESULT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac&chainSlug=mcdonalds-es',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const parsed = EstimateResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it('response validates against EstimateResponseSchema (miss case)', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(null);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=unknown',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const parsed = EstimateResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Query normalization — whitespace collapsed + lowercased in cache key
  // -------------------------------------------------------------------------

  it('passes normalized query to level1Lookup', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(null);

    const app = await buildApp();
    await app.inject({
      method: 'GET',
      url: '/estimate?query=Big%20%20Mac',
    });

    expect(mockLevel1Lookup).toHaveBeenCalledWith(
      mockKyselyDb,      // db instance passed from app.ts via getKysely()
      'big mac',         // Zod trims; normalization collapses spaces + lowercases
      expect.any(Object),
    );
  });

  // -------------------------------------------------------------------------
  // portionMultiplier behaviour
  // -------------------------------------------------------------------------

  describe('portionMultiplier behaviour', () => {
    it('L1 hit with portionMultiplier=1.5 → nutrients multiplied ×1.5', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_RESULT);

      const app = await buildApp();
      const response = await app.inject({
        method: 'GET',
        url: '/estimate?query=Big+Mac&portionMultiplier=1.5',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
      expect(body.data['portionMultiplier']).toBe(1.5);
      const result = body.data['result'] as Record<string, unknown>;
      const nutrients = result['nutrients'] as Record<string, unknown>;
      expect(nutrients['calories']).toBe(825);       // 550 × 1.5
      expect(nutrients['proteins']).toBe(37.5);      // 25 × 1.5
      expect(nutrients['salt']).toBe(3.3);           // 2.2 × 1.5
      expect(nutrients['sodium']).toBe(1320);        // 880 × 1.5
      expect(result['portionGrams']).toBe(322.5);    // 215 × 1.5
      expect(nutrients['referenceBasis']).toBe('per_serving');
    });

    it('absent portionMultiplier → data.portionMultiplier === 1.0, nutrients unchanged', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_RESULT);

      const app = await buildApp();
      const response = await app.inject({
        method: 'GET',
        url: '/estimate?query=Big+Mac',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
      expect(body.data['portionMultiplier']).toBe(1);
      const result = body.data['result'] as Record<string, unknown>;
      const nutrients = result['nutrients'] as Record<string, unknown>;
      expect(nutrients['calories']).toBe(550);
    });

    it('explicit portionMultiplier=1.0 → nutrients unchanged', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_RESULT);

      const app = await buildApp();
      const response = await app.inject({
        method: 'GET',
        url: '/estimate?query=Big+Mac&portionMultiplier=1.0',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
      expect(body.data['portionMultiplier']).toBe(1);
      const result = body.data['result'] as Record<string, unknown>;
      const nutrients = result['nutrients'] as Record<string, unknown>;
      expect(nutrients['calories']).toBe(550);
    });

    it('total miss with portionMultiplier=1.5 → result null, multiplier echoed', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(null);

      const app = await buildApp();
      const response = await app.inject({
        method: 'GET',
        url: '/estimate?query=unknown&portionMultiplier=1.5',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
      expect(body.data['portionMultiplier']).toBe(1.5);
      expect(body.data['result']).toBeNull();
    });

    it('portionMultiplier=0 → 400 VALIDATION_ERROR', async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: 'GET',
        url: '/estimate?query=Big+Mac&portionMultiplier=0',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ success: false; error: { code: string } }>();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('portionMultiplier=6 → 400 VALIDATION_ERROR', async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: 'GET',
        url: '/estimate?query=Big+Mac&portionMultiplier=6',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ success: false; error: { code: string } }>();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('portionMultiplier=abc → 400 VALIDATION_ERROR', async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: 'GET',
        url: '/estimate?query=Big+Mac&portionMultiplier=abc',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ success: false; error: { code: string } }>();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('cache key includes multiplier segment :1.5', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_RESULT);

      const app = await buildApp();
      await app.inject({
        method: 'GET',
        url: '/estimate?query=Big+Mac&portionMultiplier=1.5',
      });

      expect(mockRedisGet).toHaveBeenCalledTimes(1);
      const cacheKey = mockRedisGet.mock.calls[0]![0] as string;
      // F072: cache key now includes cookingState and cookingMethod segments (empty when absent)
      expect(cacheKey).toMatch(/:1\.5::/);
    });

    it('cache key uses ":1" when multiplier absent', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_RESULT);

      const app = await buildApp();
      await app.inject({
        method: 'GET',
        url: '/estimate?query=Big+Mac',
      });

      expect(mockRedisGet).toHaveBeenCalledTimes(1);
      const cacheKey = mockRedisGet.mock.calls[0]![0] as string;
      // F072: cache key now includes cookingState and cookingMethod segments (empty when absent)
      expect(cacheKey).toMatch(/:1::/);
    });

    it('response with portionMultiplier=1.5 validates against EstimateResponseSchema', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_RESULT);

      const app = await buildApp();
      const response = await app.inject({
        method: 'GET',
        url: '/estimate?query=Big+Mac&portionMultiplier=1.5',
      });

      expect(response.statusCode).toBe(200);
      const parsed = EstimateResponseSchema.safeParse(response.json());
      expect(parsed.success).toBe(true);
    });
  });
});
