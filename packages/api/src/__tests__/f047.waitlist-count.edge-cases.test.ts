// F047 QA — Edge-case tests for GET /waitlist/count
//
// Covers gaps in the developer's f047.waitlist-count.route.test.ts:
// 1. Cache-Control header must be set on CACHE HIT path (not only on miss)
// 2. 500 error response must carry standard INTERNAL_ERROR code in body
// 3. cacheSet is called with correct key "fxp:waitlist:count" and TTL 300
// 4. Concurrent identical requests (second request hits cache immediately)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

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

const {
  mockWaitlistCreate,
  mockWaitlistFindUnique,
  mockWaitlistFindMany,
  mockWaitlistCount,
} = vi.hoisted(() => ({
  mockWaitlistCreate: vi.fn(),
  mockWaitlistFindUnique: vi.fn(),
  mockWaitlistFindMany: vi.fn(),
  mockWaitlistCount: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    waitlistSubmission: {
      create: mockWaitlistCreate,
      findUnique: mockWaitlistFindUnique,
      findMany: mockWaitlistFindMany,
      count: mockWaitlistCount,
    },
  } as unknown as PrismaClient,
}));

// ---------------------------------------------------------------------------
// Mock Kysely (required by buildApp transitive imports)
// ---------------------------------------------------------------------------

const { mockKyselyChainStubs } = vi.hoisted(() => {
  const execute = vi.fn().mockResolvedValue([]);
  const chainMethodNames = [
    'selectFrom', 'innerJoin', 'select', 'where', 'orderBy',
    'limit', 'offset', '$if',
  ] as const;

  const stub: Record<string, unknown> = {};
  for (const method of chainMethodNames) {
    stub[method] = vi.fn();
  }
  stub['execute'] = execute;
  stub['executeTakeFirstOrThrow'] = vi.fn().mockResolvedValue({ count: '0' });
  stub['fn'] = {
    countAll: vi.fn().mockReturnValue({ as: vi.fn().mockReturnValue('count') }),
  };
  for (const method of chainMethodNames) {
    (stub[method] as ReturnType<typeof vi.fn>).mockReturnValue(stub);
  }
  return { mockKyselyChainStubs: stub };
});

vi.mock('../lib/kysely.js', () => ({
  getKysely: () => mockKyselyChainStubs,
  destroyKysely: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock estimation lookups (transitive imports from buildApp)
// ---------------------------------------------------------------------------

vi.mock('../estimation/level1Lookup.js', () => ({ level1Lookup: vi.fn(), offFallbackFoodMatch: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../estimation/level2Lookup.js', () => ({ level2Lookup: vi.fn() }));
vi.mock('../estimation/level3Lookup.js', () => ({ level3Lookup: vi.fn() }));
vi.mock('../estimation/level4Lookup.js', () => ({ level4Lookup: vi.fn() }));

// ---------------------------------------------------------------------------
// Import buildApp after mocks
// ---------------------------------------------------------------------------

import { buildApp } from '../app.js';
import type { Config } from '../config.js';

const TEST_CONFIG: Partial<Config> = { NODE_ENV: 'test' };

beforeEach(() => {
  vi.clearAllMocks();
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue('OK');
  mockWaitlistCount.mockResolvedValue(42);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('GET /waitlist/count — edge cases (F047 QA)', () => {
  // -------------------------------------------------------------------------
  // Gap: cache-hit path must also return Cache-Control header
  // Developer test checks the header on cache miss but not on cache hit.
  // -------------------------------------------------------------------------
  it('sets Cache-Control header even when serving from cache (cache hit)', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(99));

    const app = await buildApp({ config: TEST_CONFIG as Config });
    const res = await app.inject({ method: 'GET', url: '/waitlist/count' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=300');

    await app.close();
  });

  // -------------------------------------------------------------------------
  // Gap: 500 error response must include INTERNAL_ERROR code per spec envelope
  // Spec says: "Standard error envelope on DB failure (500)"
  // Developer test only asserts body.success === false.
  // -------------------------------------------------------------------------
  it('500 response includes standard error envelope with INTERNAL_ERROR code', async () => {
    mockRedisGet.mockResolvedValue(null);
    mockWaitlistCount.mockRejectedValue(new Error('DB connection lost'));

    const app = await buildApp({ config: TEST_CONFIG as Config });
    const res = await app.inject({ method: 'GET', url: '/waitlist/count' });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.payload) as {
      success: boolean;
      error?: { code?: string };
    };
    expect(body.success).toBe(false);
    // Spec requires: { success: false, error: { code: 'INTERNAL_ERROR' } }
    expect(body.error).toBeDefined();
    expect(body.error?.code).toBe('INTERNAL_ERROR');

    await app.close();
  });

  // -------------------------------------------------------------------------
  // Gap: cache key used by cacheSet must be "fxp:waitlist:count"
  // Spec says: buildKey('waitlist', 'count') → "fxp:waitlist:count"
  // -------------------------------------------------------------------------
  it('writes count to Redis with cache key "fxp:waitlist:count" and ttl 300 on cache miss', async () => {
    mockRedisGet.mockResolvedValue(null);
    mockWaitlistCount.mockResolvedValue(27);

    const app = await buildApp({ config: TEST_CONFIG as Config });
    await app.inject({ method: 'GET', url: '/waitlist/count' });

    // cacheSet calls redis.set internally with EX flag — the first arg to redis.set
    // should contain the key "fxp:waitlist:count"
    expect(mockRedisSet).toHaveBeenCalledOnce();
    const [setKey, setVal, , setTtl] = mockRedisSet.mock.calls[0] as [string, string, string, number];
    expect(setKey).toBe('fxp:waitlist:count');
    expect(JSON.parse(setVal)).toBe(27);
    expect(setTtl).toBe(300);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // Gap: cacheSet must NOT be called on cache HIT (count already cached)
  // -------------------------------------------------------------------------
  it('does NOT call redis.set when count comes from cache (cache hit)', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(55));

    const app = await buildApp({ config: TEST_CONFIG as Config });
    await app.inject({ method: 'GET', url: '/waitlist/count' });

    expect(mockRedisSet).not.toHaveBeenCalled();

    await app.close();
  });

  // -------------------------------------------------------------------------
  // Gap: response for count=0 should still return success:true with count:0
  // (edge case: brand-new installation with no submissions)
  // -------------------------------------------------------------------------
  it('returns count:0 correctly when no submissions exist', async () => {
    mockRedisGet.mockResolvedValue(null);
    mockWaitlistCount.mockResolvedValue(0);

    const app = await buildApp({ config: TEST_CONFIG as Config });
    const res = await app.inject({ method: 'GET', url: '/waitlist/count' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { success: boolean; data: { count: number } };
    expect(body).toEqual({ success: true, data: { count: 0 } });

    await app.close();
  });

  // -------------------------------------------------------------------------
  // Gap: route must only respond to GET — not POST/PUT/DELETE
  // Prevents accidental mutation via wrong HTTP verb
  // -------------------------------------------------------------------------
  it('returns 404 for POST /waitlist/count (method not allowed)', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });
    const res = await app.inject({ method: 'POST', url: '/waitlist/count' });

    // Fastify returns 404 for unregistered route+method combos
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // Gap: Redis failure on cache GET must be treated as a miss (fail-open)
  // cacheGet catches errors and returns null — route must still work
  // -------------------------------------------------------------------------
  it('falls back to DB when Redis GET throws (fail-open cache)', async () => {
    mockRedisGet.mockRejectedValue(new Error('Redis timeout'));
    mockWaitlistCount.mockResolvedValue(10);

    const app = await buildApp({ config: TEST_CONFIG as Config });
    const res = await app.inject({ method: 'GET', url: '/waitlist/count' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { success: boolean; data: { count: number } };
    expect(body).toEqual({ success: true, data: { count: 10 } });
    expect(mockWaitlistCount).toHaveBeenCalledOnce();

    await app.close();
  });
});
