// Route tests for the modified GET /estimate with query logging (F029)
//
// Tests: writeQueryLog called correctly for cache hit, cascade, source header,
//        apiKeyId, and that writeQueryLog failure does not change HTTP response.
//
// Uses hoisted mock pattern matching f023.estimate.route.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Mock writeQueryLog — hoisted so it can be inspected after request
// ---------------------------------------------------------------------------

const { mockWriteQueryLog } = vi.hoisted(() => ({
  mockWriteQueryLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/queryLogger.js', () => ({
  writeQueryLog: mockWriteQueryLog,
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
// Mock Kysely
// ---------------------------------------------------------------------------

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
  entityId: 'fd000000-0029-4000-b000-000000000001',
  name: 'Big Mac',
  nameEs: 'Big Mac',
  restaurantId: 'fd000000-0029-4000-b000-000000000002',
  chainSlug: 'mcdonalds-es',
  portionGrams: 215,
  nutrients: BASE_NUTRIENTS,
  confidenceLevel: 'high' as const,
  estimationMethod: 'official' as const,
  source: {
    id: 'fd000000-0029-4000-b000-000000000003',
    name: "McDonald's Official PDF",
    type: 'official' as const,
    url: 'https://example.com',
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
    result: { ...MOCK_RESULT, entityId: 'fd000000-0029-4000-b000-000000000020' },
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

// Cached L3 data (as it would appear from Redis)
const CACHED_L3_DATA = {
  query: 'hamburguesa',
  chainSlug: 'burger-king-es',
  level1Hit: false,
  level2Hit: false,
  level3Hit: true,
  level4Hit: false,
  matchType: 'similarity_dish',
  result: MOCK_RESULT,
  cachedAt: '2026-03-21T10:00:00.000Z',
};

// Cached total miss data (all flags false — was a miss but was cached)
const CACHED_TOTAL_MISS_DATA = {
  query: 'unknown dish',
  chainSlug: null,
  level1Hit: false,
  level2Hit: false,
  level3Hit: false,
  level4Hit: false,
  matchType: null,
  result: null,
  cachedAt: '2026-03-21T10:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Helper: wait for finish event (fire-and-forget)
// ---------------------------------------------------------------------------

async function waitForMock() {
  // The fire-and-forget fires on the 'finish' event of the response socket.
  // In Fastify's inject(), finish fires synchronously after send().
  // We yield once to let any pending microtasks resolve.
  await new Promise(resolve => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /estimate — query logging (F029)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRunEstimationCascade.mockResolvedValue(ROUTER_TOTAL_MISS);
    mockWriteQueryLog.mockResolvedValue(undefined);
  });

  // -------------------------------------------------------------------------
  // Cache hit path
  // -------------------------------------------------------------------------

  it('cache hit (L3) → writeQueryLog called with cacheHit:true, levelHit:l3', async () => {
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(CACHED_L3_DATA));

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=hamburguesa&chainSlug=burger-king-es',
    });

    await waitForMock();

    expect(response.statusCode).toBe(200);
    expect(mockWriteQueryLog).toHaveBeenCalledOnce();
    const [_prisma, entry] = mockWriteQueryLog.mock.calls[0] as [unknown, { cacheHit: boolean; levelHit: string | null }];
    expect(entry.cacheHit).toBe(true);
    expect(entry.levelHit).toBe('l3');
  });

  it('cache hit (L1) → writeQueryLog called with levelHit:l1', async () => {
    const cachedL1 = {
      ...CACHED_L3_DATA,
      level1Hit: true,
      level2Hit: false,
      level3Hit: false,
      level4Hit: false,
    };
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(cachedL1));

    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/estimate?query=big+mac' });
    await waitForMock();

    expect(mockWriteQueryLog).toHaveBeenCalledOnce();
    const [_prisma, entry] = mockWriteQueryLog.mock.calls[0] as [unknown, { levelHit: string | null }];
    expect(entry.levelHit).toBe('l1');
  });

  it('cache hit, all flags false (total miss was cached) → levelHit:null', async () => {
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(CACHED_TOTAL_MISS_DATA));

    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/estimate?query=unknown+dish' });
    await waitForMock();

    expect(mockWriteQueryLog).toHaveBeenCalledOnce();
    const [_prisma, entry] = mockWriteQueryLog.mock.calls[0] as [unknown, { cacheHit: boolean; levelHit: string | null }];
    expect(entry.cacheHit).toBe(true);
    expect(entry.levelHit).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Cascade path
  // -------------------------------------------------------------------------

  it('cascade L1 hit → writeQueryLog called with cacheHit:false, levelHit:l1', async () => {
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L1_HIT);

    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/estimate?query=Big+Mac&chainSlug=mcdonalds-es' });
    await waitForMock();

    expect(mockWriteQueryLog).toHaveBeenCalledOnce();
    const [_prisma, entry] = mockWriteQueryLog.mock.calls[0] as [unknown, { cacheHit: boolean; levelHit: string | null }];
    expect(entry.cacheHit).toBe(false);
    expect(entry.levelHit).toBe('l1');
  });

  it('cascade L3 hit → writeQueryLog called with cacheHit:false, levelHit:l3', async () => {
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L3_HIT);

    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/estimate?query=hamburguesa' });
    await waitForMock();

    expect(mockWriteQueryLog).toHaveBeenCalledOnce();
    const [_prisma, entry] = mockWriteQueryLog.mock.calls[0] as [unknown, { cacheHit: boolean; levelHit: string | null }];
    expect(entry.cacheHit).toBe(false);
    expect(entry.levelHit).toBe('l3');
  });

  it('cascade total miss → writeQueryLog called with cacheHit:false, levelHit:null', async () => {
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_TOTAL_MISS);

    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/estimate?query=unknown+dish' });
    await waitForMock();

    expect(mockWriteQueryLog).toHaveBeenCalledOnce();
    const [_prisma, entry] = mockWriteQueryLog.mock.calls[0] as [unknown, { cacheHit: boolean; levelHit: string | null }];
    expect(entry.cacheHit).toBe(false);
    expect(entry.levelHit).toBeNull();
  });

  // -------------------------------------------------------------------------
  // X-FXP-Source header
  // -------------------------------------------------------------------------

  it('X-FXP-Source: bot header → source:bot', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'GET',
      url: '/estimate?query=test',
      headers: { 'x-fxp-source': 'bot' },
    });
    await waitForMock();

    const [_prisma, entry] = mockWriteQueryLog.mock.calls[0] as [unknown, { source: string }];
    expect(entry.source).toBe('bot');
  });

  it('X-FXP-Source: bot,extra (comma-joined) → first token: source:bot', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'GET',
      url: '/estimate?query=test',
      headers: { 'x-fxp-source': 'bot, extra' },
    });
    await waitForMock();

    const [_prisma, entry] = mockWriteQueryLog.mock.calls[0] as [unknown, { source: string }];
    expect(entry.source).toBe('bot');
  });

  it('X-FXP-Source: other → source:api', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'GET',
      url: '/estimate?query=test',
      headers: { 'x-fxp-source': 'other' },
    });
    await waitForMock();

    const [_prisma, entry] = mockWriteQueryLog.mock.calls[0] as [unknown, { source: string }];
    expect(entry.source).toBe('api');
  });

  it('no X-FXP-Source header → source:api', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/estimate?query=test' });
    await waitForMock();

    const [_prisma, entry] = mockWriteQueryLog.mock.calls[0] as [unknown, { source: string }];
    expect(entry.source).toBe('api');
  });

  // -------------------------------------------------------------------------
  // apiKeyId passthrough
  // -------------------------------------------------------------------------

  it('anonymous request → apiKeyId:null in log entry', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/estimate?query=test' });
    await waitForMock();

    const [_prisma, entry] = mockWriteQueryLog.mock.calls[0] as [unknown, { apiKeyId: string | null }];
    expect(entry.apiKeyId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // writeQueryLog failure does not affect HTTP response
  // -------------------------------------------------------------------------

  it('writeQueryLog throws → estimate still returns 200 with correct body', async () => {
    mockWriteQueryLog.mockRejectedValueOnce(new Error('DB write failed'));
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L1_HIT);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac',
    });

    await waitForMock();

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean }>();
    expect(body.success).toBe(true);
  });

  // -------------------------------------------------------------------------
  // queryText and chainSlug passthrough
  // -------------------------------------------------------------------------

  it('queryText and chainSlug are passed to writeQueryLog', async () => {
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L1_HIT);

    const app = await buildApp();
    await app.inject({
      method: 'GET',
      url: '/estimate?query=Big+Mac&chainSlug=mcdonalds-es',
    });
    await waitForMock();

    const [_prisma, entry] = mockWriteQueryLog.mock.calls[0] as [unknown, { queryText: string; chainSlug: string | null }];
    expect(entry.queryText).toBe('Big Mac');
    expect(entry.chainSlug).toBe('mcdonalds-es');
  });

  it('no chainSlug → chainSlug:null in log entry', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/estimate?query=test' });
    await waitForMock();

    const [_prisma, entry] = mockWriteQueryLog.mock.calls[0] as [unknown, { chainSlug: string | null }];
    expect(entry.chainSlug).toBeNull();
  });
});
