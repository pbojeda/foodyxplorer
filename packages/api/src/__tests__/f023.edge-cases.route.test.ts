// F023 Edge-Case Route Tests — GET /estimate (QA Engineer)
//
// Covers route-level gaps identified in f023.estimate.route.test.ts.
// Mocks runEstimationCascade + Redis (same pattern as f023.estimate.route.test.ts).
//
// FINDINGS COVERED:
//   EDGE_CASE-F023-R01 — Route passes raw query (not normalizedQuery) to runEstimationCascade
//   EDGE_CASE-F023-R02 — Route forwards chainSlug and restaurantId to runEstimationCascade
//   EDGE_CASE-F023-R03 — Cache write stores cachedAt as ISO timestamp (not null)
//   EDGE_CASE-F023-R04 — Total miss is also written to cache (prevents repeat lookups)
//   EDGE_CASE-F023-R05 — Error path: cacheSet NOT called when router throws 500
//   EDGE_CASE-F023-R06 — Cache hit: cacheSet not called (no double-write)
//   EDGE_CASE-F023-R07 — Live response has cachedAt:null (write-to-cache uses different object)
//   EDGE_CASE-F023-R08 — Minimal request (query only): chainSlug/restaurantId are undefined
//   EDGE_CASE-F023-R09 — Missing query param → 400 Bad Request
//   EDGE_CASE-F023-R10 — Empty query string → 400 Bad Request
//   EDGE_CASE-F023-R11 — Query exceeding 255 chars → 400 Bad Request
//   EDGE_CASE-F023-R12 — chainSlug with uppercase → 400 Bad Request
//   EDGE_CASE-F023-R13 — restaurantId not a UUID → 400 Bad Request

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Mock runEstimationCascade (same path as f023.estimate.route.test.ts)
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
  } as unknown as Redis,
}));

// ---------------------------------------------------------------------------
// Mock Prisma + Kysely
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_ENTITY = {
  entityType: 'dish' as const,
  entityId: 'fd000000-0023-4000-a000-000000000001',
  name: 'Big Mac',
  nameEs: 'Big Mac',
  restaurantId: 'fd000000-0023-4000-a000-000000000002',
  chainSlug: 'mcdonalds-es',
  portionGrams: 215,
  nutrients: {
    calories: 520, proteins: 28, carbohydrates: 42, sugars: 8,
    fats: 24, saturatedFats: 9, fiber: 3, salt: 2.1, sodium: 840,
    transFats: 0.3, cholesterol: 75, potassium: 300,
    monounsaturatedFats: 10, polyunsaturatedFats: 3,
    referenceBasis: 'per_serving' as const,
  },
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
    result: BASE_ENTITY,
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

describe('GET /estimate — route edge cases (F023)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    // Default: router returns total miss
    mockRunEstimationCascade.mockResolvedValue(ROUTER_TOTAL_MISS);
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-R01: Route passes raw query (not normalizedQuery) to router
  // -------------------------------------------------------------------------

  it('EDGE_CASE-R01: route passes raw (Zod-trimmed) query to runEstimationCascade, not the lowercase cache key', async () => {
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L1_HIT);

    const app = await buildApp();
    await app.inject({
      method: 'GET',
      // Zod trims whitespace → 'Big Mac' (mixed case preserved)
      url: '/estimate?query=Big+Mac&chainSlug=mcdonalds-es',
    });

    expect(mockRunEstimationCascade).toHaveBeenCalledWith(
      expect.objectContaining({
        // The router must receive the post-Zod-trim raw value, NOT the lowercase cache key
        query: 'Big Mac',
      }),
    );
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-R02: Route forwards chainSlug and restaurantId to router
  // -------------------------------------------------------------------------

  it('EDGE_CASE-R02: route forwards chainSlug and restaurantId to runEstimationCascade', async () => {
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L1_HIT);

    const app = await buildApp();
    await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac&chainSlug=mcdonalds-es&restaurantId=fd000000-0023-4000-a000-000000000002',
    });

    expect(mockRunEstimationCascade).toHaveBeenCalledWith(
      expect.objectContaining({
        chainSlug: 'mcdonalds-es',
        restaurantId: 'fd000000-0023-4000-a000-000000000002',
      }),
    );
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-R03: Cache write stores cachedAt as non-null ISO timestamp
  // -------------------------------------------------------------------------

  it('EDGE_CASE-R03: cache write after L1 hit stores cachedAt as ISO timestamp string (not null)', async () => {
    const capturedValues: string[] = [];
    mockRedisSet.mockImplementation((_key: string, value: string) => {
      capturedValues.push(value);
      return Promise.resolve('OK');
    });
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L1_HIT);

    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/estimate?query=Big+Mac&chainSlug=mcdonalds-es' });

    expect(capturedValues).toHaveLength(1);
    const cached = JSON.parse(capturedValues[0]) as Record<string, unknown>;
    expect(cached['level1Hit']).toBe(true);
    expect(cached['cachedAt']).not.toBeNull();
    expect(typeof cached['cachedAt']).toBe('string');
    // Must be a valid ISO 8601 date
    expect(new Date(cached['cachedAt'] as string).getTime()).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-R04: Total miss also written to cache
  // -------------------------------------------------------------------------

  it('EDGE_CASE-R04: total miss is written to cache with non-null cachedAt (prevents repeat lookups)', async () => {
    const capturedValues: string[] = [];
    mockRedisSet.mockImplementation((_key: string, value: string) => {
      capturedValues.push(value);
      return Promise.resolve('OK');
    });
    // Default mock returns ROUTER_TOTAL_MISS

    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/estimate?query=unknown+dish' });

    expect(capturedValues).toHaveLength(1);
    const cached = JSON.parse(capturedValues[0]) as Record<string, unknown>;
    expect(cached['level1Hit']).toBe(false);
    expect(cached['level2Hit']).toBe(false);
    expect(cached['level3Hit']).toBe(false);
    expect(cached['result']).toBeNull();
    expect(cached['cachedAt']).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-R05: Error path — cacheSet NOT called when router throws
  // -------------------------------------------------------------------------

  it('EDGE_CASE-R05: router throws DB_UNAVAILABLE → cacheSet is NOT called (no partial cache write)', async () => {
    mockRunEstimationCascade.mockRejectedValueOnce(
      Object.assign(new Error('DB down'), { statusCode: 500, code: 'DB_UNAVAILABLE' }),
    );

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=test+dish',
    });

    expect(response.statusCode).toBe(500);
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-R06: Cache hit — cacheSet NOT called (no double-write)
  // -------------------------------------------------------------------------

  it('EDGE_CASE-R06: cache hit → cacheSet not called and runEstimationCascade not called', async () => {
    const cachedData = {
      query: 'Big Mac', chainSlug: 'mcdonalds-es',
      level1Hit: true, level2Hit: false, level3Hit: false, level4Hit: false,
      matchType: 'exact_dish', result: BASE_ENTITY,
      cachedAt: '2026-03-19T10:00:00.000Z',
    };
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(cachedData));

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac&chainSlug=mcdonalds-es',
    });

    expect(response.statusCode).toBe(200);
    expect(mockRunEstimationCascade).not.toHaveBeenCalled();
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-R07: Live response has cachedAt:null (write-to-cache uses different object)
  // -------------------------------------------------------------------------

  it('EDGE_CASE-R07: live response has cachedAt:null — only the cached version stores the timestamp', async () => {
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L1_HIT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac&chainSlug=mcdonalds-es',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { cachedAt: unknown } }>();
    // Route sends routerResult.data (cachedAt: null), not dataToCache (cachedAt: timestamp)
    expect(body.data.cachedAt).toBeNull();
    // But the cache write should have a timestamp
    expect(mockRedisSet).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-R08: Minimal request — chainSlug and restaurantId are undefined
  // -------------------------------------------------------------------------

  it('EDGE_CASE-R08: query-only request → runEstimationCascade receives chainSlug:undefined and restaurantId:undefined', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/estimate?query=pizza' });

    expect(mockRunEstimationCascade).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'pizza',
        chainSlug: undefined,
        restaurantId: undefined,
      }),
    );
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-R09: Missing query param → 400 Bad Request
  // -------------------------------------------------------------------------

  it('EDGE_CASE-R09: missing query param → 400 Bad Request, router not called', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/estimate' });

    expect(response.statusCode).toBe(400);
    expect(mockRunEstimationCascade).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-R10: Empty query string → 400 Bad Request (min(1) fails)
  // -------------------------------------------------------------------------

  it('EDGE_CASE-R10: empty query string → 400 Bad Request', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/estimate?query=' });

    expect(response.statusCode).toBe(400);
    expect(mockRunEstimationCascade).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-R11: Query exceeding 255 chars → 400 Bad Request (max(255) fails)
  // -------------------------------------------------------------------------

  it('EDGE_CASE-R11: query with 256 characters → 400 Bad Request', async () => {
    const longQuery = 'a'.repeat(256);
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/estimate?query=${encodeURIComponent(longQuery)}`,
    });

    expect(response.statusCode).toBe(400);
    expect(mockRunEstimationCascade).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-R12: chainSlug with uppercase → 400 Bad Request
  // -------------------------------------------------------------------------

  it('EDGE_CASE-R12: chainSlug with uppercase characters → 400 Bad Request (regex /^[a-z0-9-]+$/ fails)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=pizza&chainSlug=McDonalds-ES',
    });

    expect(response.statusCode).toBe(400);
    expect(mockRunEstimationCascade).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-R13: restaurantId not a UUID → 400 Bad Request
  // -------------------------------------------------------------------------

  it('EDGE_CASE-R13: restaurantId not a valid UUID → 400 Bad Request', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=pizza&restaurantId=not-a-valid-uuid',
    });

    expect(response.statusCode).toBe(400);
    expect(mockRunEstimationCascade).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE: query at exactly 255 chars → 200 OK (boundary value)
  // -------------------------------------------------------------------------

  it('query at exactly 255 characters → 200 OK (boundary — max allowed)', async () => {
    const boundaryQuery = 'a'.repeat(255);
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/estimate?query=${encodeURIComponent(boundaryQuery)}`,
    });

    // Zod allows up to 255; router is called
    expect(response.statusCode).toBe(200);
    expect(mockRunEstimationCascade).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE: Redis cacheGet throws → cache bypass (fail-open), router still called
  // -------------------------------------------------------------------------

  it('Redis cacheGet throws → request continues (fail-open), runEstimationCascade is called', async () => {
    mockRedisGet.mockRejectedValueOnce(new Error('Redis connection lost'));
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L1_HIT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac',
    });

    // Cache fail-open: request should succeed
    expect(response.statusCode).toBe(200);
    expect(mockRunEstimationCascade).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE: Redis cacheSet throws → response still succeeds (fail-open)
  // -------------------------------------------------------------------------

  it('Redis cacheSet throws → response still 200 (fail-open cache write)', async () => {
    mockRedisSet.mockRejectedValueOnce(new Error('Redis write failed'));
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L1_HIT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac',
    });

    // cacheSet failure must not propagate as HTTP 500
    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean }>();
    expect(body.success).toBe(true);
  });
});
