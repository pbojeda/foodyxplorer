// Route-level unit tests for F047 — GET /waitlist/count
//
// Uses buildApp().inject() with mocked Prisma and Redis.
// Mock setup duplicated from f046.waitlist.route.test.ts (Vitest module scope).

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
// Mock Kysely
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

vi.mock('../estimation/level1Lookup.js', () => ({ level1Lookup: vi.fn() }));
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
// GET /waitlist/count
// ---------------------------------------------------------------------------

describe('GET /waitlist/count', () => {
  it('returns count from DB on cache miss', async () => {
    mockRedisGet.mockResolvedValue(null);
    mockWaitlistCount.mockResolvedValue(15);

    const app = await buildApp({ config: TEST_CONFIG as Config });
    const res = await app.inject({ method: 'GET', url: '/waitlist/count' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({ success: true, data: { count: 15 } });
    expect(mockWaitlistCount).toHaveBeenCalledOnce();

    await app.close();
  });

  it('sets Cache-Control header', async () => {
    const app = await buildApp({ config: TEST_CONFIG as Config });
    const res = await app.inject({ method: 'GET', url: '/waitlist/count' });

    expect(res.headers['cache-control']).toBe('public, max-age=300');

    await app.close();
  });

  it('returns cached count without querying DB on cache hit', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(99));

    const app = await buildApp({ config: TEST_CONFIG as Config });
    const res = await app.inject({ method: 'GET', url: '/waitlist/count' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({ success: true, data: { count: 99 } });
    expect(mockWaitlistCount).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns 500 on DB error', async () => {
    mockRedisGet.mockResolvedValue(null);
    mockWaitlistCount.mockRejectedValue(new Error('DB down'));

    const app = await buildApp({ config: TEST_CONFIG as Config });
    const res = await app.inject({ method: 'GET', url: '/waitlist/count' });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);

    await app.close();
  });
});
