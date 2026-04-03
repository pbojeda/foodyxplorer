// Route tests for GET /analytics/queries (F029)
//
// Tests: auth, validation, 200 response shape, zero-data edge case,
//        DB error → 500, chainSlug filter, timeRange scoping.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Hoisted Kysely mock
// We use a container object so we can swap out results between tests without
// re-initializing the module mock. The factory pattern creates fresh query
// builder chains per selectFrom() call, ordered by call index.
// ---------------------------------------------------------------------------

const { kyselyContainer } = vi.hoisted(() => {
  // Results keyed by selectFrom call index (order matches Promise.all order)
  const container = {
    results: [] as unknown[][],
    error: null as Error | null,
    callIndex: 0,
  };

  function makeBuilder(executeFn: () => Promise<unknown[]>) {
    const self: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      $if: vi.fn().mockImplementation((cond: unknown, cb: (qb: unknown) => unknown) => {
        if (cond) cb(self);
        return self;
      }),
      execute: vi.fn(executeFn),
    };
    return self;
  }

  (container as Record<string, unknown>)['makeDb'] = () => ({
    selectFrom: vi.fn().mockImplementation(() => {
      const idx = container.callIndex++;
      if (container.error) {
        return makeBuilder(() => Promise.reject(container.error));
      }
      const data = container.results[idx] ?? [];
      return makeBuilder(() => Promise.resolve(data));
    }),
    fn: {
      countAll: vi.fn().mockReturnValue({ as: vi.fn().mockReturnThis() }),
    },
    getExecutor: () => ({
      executeQuery: vi.fn().mockResolvedValue({ rows: [] }),
      compileQuery: (node: unknown) => ({ sql: '', parameters: [], query: node }),
      transformQuery: (node: unknown) => node,
      withPlugins: function () { return this; },
    }),
  });

  return { kyselyContainer: container };
});

vi.mock('../lib/kysely.js', () => ({
  getKysely: () => {
    kyselyContainer.callIndex = 0;
    return (kyselyContainer as unknown as { makeDb: () => unknown }).makeDb();
  },
  destroyKysely: vi.fn(),
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
// Mock runEstimationCascade
// ---------------------------------------------------------------------------

const { mockRunEstimationCascade } = vi.hoisted(() => ({
  mockRunEstimationCascade: vi.fn(),
}));

vi.mock('../estimation/engineRouter.js', () => ({
  runEstimationCascade: mockRunEstimationCascade,
}));

// ---------------------------------------------------------------------------
// Mock writeQueryLog
// ---------------------------------------------------------------------------

vi.mock('../lib/queryLogger.js', () => ({
  writeQueryLog: vi.fn().mockResolvedValue(undefined),
}));

import { buildApp } from '../app.js';

// ---------------------------------------------------------------------------
// Default result sets
// ---------------------------------------------------------------------------

const HAPPY_PATH_RESULTS = [
  // 0: consumed by conversationRoutes.loadChainData() during buildApp plugin init
  [],
  // 1: scalar
  [{ total_queries: 100, cache_hit_rate: '0.7500', avg_response_time_ms: '42.5' }],
  // 2: by level
  [
    { level_hit: 'l1', count: 60 },
    { level_hit: 'l2', count: 10 },
    { level_hit: 'l3', count: 20 },
    { level_hit: null, count: 10 },
  ],
  // 3: by chain
  [
    { chain_slug: 'mcdonalds-es', count: 80 },
    { chain_slug: 'subway-es', count: 20 },
  ],
  // 4: by source
  [
    { source: 'api', count: 70 },
    { source: 'bot', count: 30 },
  ],
  // 5: top queries
  [
    { query_text: 'big mac', count: 25 },
    { query_text: 'whopper', count: 15 },
  ],
];

const EMPTY_TABLE_RESULTS = [
  // 0: consumed by conversationRoutes.loadChainData() during buildApp plugin init
  [],
  [{ total_queries: 0, cache_hit_rate: null, avg_response_time_ms: null }],
  [],
  [],
  [],
  [],
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /analytics/queries (F029)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRunEstimationCascade.mockResolvedValue({ levelHit: null, data: {} });

    // Reset container to happy path
    kyselyContainer.results = HAPPY_PATH_RESULTS as unknown[][];
    kyselyContainer.error = null;
    kyselyContainer.callIndex = 0;
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  it('no admin key → 401 UNAUTHORIZED', async () => {
    const app = await buildApp({ config: { NODE_ENV: 'test', ADMIN_API_KEY: 'secret' } as never });
    const response = await app.inject({
      method: 'GET',
      url: '/analytics/queries',
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('valid admin key → 200', async () => {
    const app = await buildApp({ config: { NODE_ENV: 'test', ADMIN_API_KEY: 'secret' } as never });
    const response = await app.inject({
      method: 'GET',
      url: '/analytics/queries?timeRange=7d',
      headers: { 'x-api-key': 'secret' },
    });

    expect(response.statusCode).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  it('invalid timeRange → 400 VALIDATION_ERROR', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/analytics/queries?timeRange=bad',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('topN=150 → 400 VALIDATION_ERROR', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/analytics/queries?topN=150',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('topN=0 → 400 VALIDATION_ERROR', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/analytics/queries?topN=0',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // 200 response shape
  // -------------------------------------------------------------------------

  it('valid request returns 200 with all required fields', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/analytics/queries?timeRange=7d',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: Record<string, unknown> }>();
    expect(body.success).toBe(true);

    const data = body.data;
    expect(data['totalQueries']).toBe(100);
    expect(typeof data['cacheHitRate']).toBe('number');
    expect(data['avgResponseTimeMs']).not.toBeNull();
    expect(data['byLevel']).toBeDefined();
    expect(data['byChain']).toBeDefined();
    expect(data['bySource']).toBeDefined();
    expect(data['topQueries']).toBeDefined();
    expect(data['timeRange']).toBe('7d');
  });

  it('byLevel has l1, l2, l3, l4, miss keys — l4 zero-filled when absent', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/analytics/queries?timeRange=7d',
    });

    expect(response.statusCode).toBe(200);
    const data = response.json<{ data: { byLevel: Record<string, number> } }>().data;
    expect(typeof data.byLevel['l1']).toBe('number');
    expect(typeof data.byLevel['l2']).toBe('number');
    expect(typeof data.byLevel['l3']).toBe('number');
    expect(typeof data.byLevel['l4']).toBe('number');
    expect(typeof data.byLevel['miss']).toBe('number');
    expect(data.byLevel['l4']).toBe(0); // l4 not in HAPPY_PATH data
  });

  it('bySource has api and bot keys with correct values', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/analytics/queries',
    });

    expect(response.statusCode).toBe(200);
    const data = response.json<{ data: { bySource: Record<string, number> } }>().data;
    expect(data.bySource['api']).toBe(70);
    expect(data.bySource['bot']).toBe(30);
  });

  // -------------------------------------------------------------------------
  // Empty table edge case
  // -------------------------------------------------------------------------

  it('totalQueries=0 → avgResponseTimeMs:null, cacheHitRate:0, byLevel all zeros', async () => {
    kyselyContainer.results = EMPTY_TABLE_RESULTS as unknown[][];

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/analytics/queries?timeRange=all',
    });

    expect(response.statusCode).toBe(200);
    const data = response.json<{ data: Record<string, unknown> }>().data;
    expect(data['totalQueries']).toBe(0);
    expect(data['avgResponseTimeMs']).toBeNull();
    expect(data['cacheHitRate']).toBe(0);

    const byLevel = data['byLevel'] as Record<string, number>;
    expect(byLevel['l1']).toBe(0);
    expect(byLevel['l2']).toBe(0);
    expect(byLevel['l3']).toBe(0);
    expect(byLevel['l4']).toBe(0);
    expect(byLevel['miss']).toBe(0);

    const bySource = data['bySource'] as Record<string, number>;
    expect(bySource['api']).toBe(0);
    expect(bySource['bot']).toBe(0);

    expect(data['byChain']).toEqual([]);
    expect(data['topQueries']).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // DB error → 500
  // -------------------------------------------------------------------------

  it('DB error during aggregation → 500 DB_UNAVAILABLE', async () => {
    kyselyContainer.error = new Error('Connection refused');

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/analytics/queries',
    });

    expect(response.statusCode).toBe(500);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('DB_UNAVAILABLE');
  });

  // -------------------------------------------------------------------------
  // chainSlug filter
  // -------------------------------------------------------------------------

  it('chainSlug filter → scopedToChain echoed in response', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/analytics/queries?chainSlug=mcdonalds-es',
    });

    expect(response.statusCode).toBe(200);
    const data = response.json<{ data: Record<string, unknown> }>().data;
    expect(data['scopedToChain']).toBe('mcdonalds-es');
  });

  it('no chainSlug → scopedToChain absent from response', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/analytics/queries',
    });

    expect(response.statusCode).toBe(200);
    const data = response.json<{ data: Record<string, unknown> }>().data;
    expect(data['scopedToChain']).toBeUndefined();
  });
});
