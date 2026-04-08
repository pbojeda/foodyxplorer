// Edge-case tests for GET /analytics/web-events (F113)
//
// Covers gaps in f113.webMetrics.get.route.test.ts:
//   - timeRange=30d (not tested in base suite)
//   - invalid timeRange value → 400 from Fastify/Zod query param validation
//   - GET with wrong X-API-Key → 401
//   - GET with empty X-API-Key header → 401
//   - Response shape conformance: all required fields present and typed correctly
//   - avgResponseTimeMs is a non-integer float (weighted average can yield decimals)
//   - topIntents and topErrors are empty arrays when DB returns no rows (not undefined)
//   - Scalar row missing (scalarRows[0] undefined) — handled by nullish coalescing

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';

// ---------------------------------------------------------------------------
// Kysely mock — same pattern as f113.webMetrics.get.route.test.ts
// ---------------------------------------------------------------------------

const { dbContainer } = vi.hoisted(() => {
  const container = {
    queryResults: [] as unknown[][],
    shouldThrow: false,
    callIndex: 0,
  };
  return { dbContainer: container };
});

vi.mock('../lib/kysely.js', () => {
  const executor = {
    executeQuery: vi.fn().mockImplementation(async () => {
      if (dbContainer.shouldThrow) {
        throw new Error('DB query failed');
      }
      const idx = dbContainer.callIndex++;
      return { rows: dbContainer.queryResults[idx] ?? [] };
    }),
    compileQuery: (node: unknown) => ({ sql: '', parameters: [], query: node }),
    transformQuery: (node: unknown) => node,
    withPlugins: function () { return this; },
    withTransformedRows: function () { return this; },
  };

  const db = {
    getExecutor: vi.fn().mockReturnValue(executor),
  };

  return {
    getKysely: () => {
      dbContainer.callIndex = 0;
      return db;
    },
    destroyKysely: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Other mocks
// ---------------------------------------------------------------------------

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    webMetricsEvent: {
      create: vi.fn().mockResolvedValue({ id: 'test-id' }),
    },
    actor: {
      create: vi.fn().mockResolvedValue({ id: 'actor-id' }),
      upsert: vi.fn().mockResolvedValue({ id: 'actor-id' }),
    },
    apiKey: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
    restaurant: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    dish: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  } as unknown as PrismaClient,
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  },
}));

vi.mock('../lib/cache.js', () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  buildKey: vi.fn((entity: string, id: string) => `fxp:${entity}:${id}`),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { buildApp } from '../app.js';

const ADMIN_API_KEY = 'a'.repeat(32);
const WRONG_API_KEY = 'b'.repeat(32);

const BASE_CONFIG: Config = {
  NODE_ENV: 'test',
  PORT: 3001,
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
  LOG_LEVEL: 'silent' as Config['LOG_LEVEL'],
  REDIS_URL: 'redis://localhost:6380',
  OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
  OPENAI_EMBEDDING_BATCH_SIZE: 100,
  OPENAI_EMBEDDING_RPM: 3000,
  OPENAI_CHAT_MAX_TOKENS: 512,
  ADMIN_API_KEY,
};

function setQueryResults(
  scalar: Record<string, unknown>[],
  intents: { intent: string; count: string }[],
  errors: { error_code: string; count: string }[],
): void {
  dbContainer.queryResults = [scalar, intents, errors];
  dbContainer.callIndex = 0;
  dbContainer.shouldThrow = false;
}

function makeScalarRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_count: '42',
    total_queries: '310',
    total_successes: '285',
    total_errors: '25',
    total_retries: '8',
    weighted_time_sum: '279300',
    weighted_time_count: '285',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /analytics/web-events — edge cases', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: BASE_CONFIG });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    dbContainer.callIndex = 0;
    dbContainer.shouldThrow = false;
  });

  // -------------------------------------------------------------------------
  // timeRange variants — 30d was not in base suite
  // -------------------------------------------------------------------------

  it('returns 200 with timeRange=30d in response', async () => {
    setQueryResults([makeScalarRow()], [], []);

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/web-events?timeRange=30d',
      headers: { 'x-api-key': ADMIN_API_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { timeRange: string } };
    expect(body.data.timeRange).toBe('30d');
  });

  it('returns 400 for invalid timeRange value (not in enum)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/analytics/web-events?timeRange=invalid',
      headers: { 'x-api-key': ADMIN_API_KEY },
    });

    // Fastify with Zod validator should reject the invalid query param
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for timeRange=1d (not in enum)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/analytics/web-events?timeRange=1d',
      headers: { 'x-api-key': ADMIN_API_KEY },
    });

    expect(res.statusCode).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Auth edge cases
  // -------------------------------------------------------------------------

  it('returns 401 with wrong X-API-Key value', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/analytics/web-events',
      headers: { 'x-api-key': WRONG_API_KEY },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with empty X-API-Key header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/analytics/web-events',
      headers: { 'x-api-key': '' },
    });

    expect(res.statusCode).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Response shape conformance
  // -------------------------------------------------------------------------

  it('response contains all required fields with correct types', async () => {
    setQueryResults(
      [makeScalarRow()],
      [{ intent: 'nutritional_query', count: '100' }],
      [{ error_code: 'TIMEOUT', count: '5' }],
    );

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/web-events',
      headers: { 'x-api-key': ADMIN_API_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      success: boolean;
      data: Record<string, unknown>;
    };

    expect(body.success).toBe(true);
    const data = body.data;

    // All scalar fields must be numbers
    expect(typeof data['eventCount']).toBe('number');
    expect(typeof data['totalQueries']).toBe('number');
    expect(typeof data['totalSuccesses']).toBe('number');
    expect(typeof data['totalErrors']).toBe('number');
    expect(typeof data['totalRetries']).toBe('number');
    expect(typeof data['timeRange']).toBe('string');

    // avgResponseTimeMs is number (non-null when totalSuccesses > 0)
    expect(typeof data['avgResponseTimeMs']).toBe('number');

    // topIntents and topErrors are arrays
    expect(Array.isArray(data['topIntents'])).toBe(true);
    expect(Array.isArray(data['topErrors'])).toBe(true);

    // Verify array element shapes
    const topIntents = data['topIntents'] as { intent: string; count: number }[];
    expect(typeof topIntents[0]?.intent).toBe('string');
    expect(typeof topIntents[0]?.count).toBe('number');

    const topErrors = data['topErrors'] as { errorCode: string; count: number }[];
    expect(typeof topErrors[0]?.errorCode).toBe('string');
    expect(typeof topErrors[0]?.count).toBe('number');
  });

  it('topIntents and topErrors are empty arrays (not undefined/null) when DB returns no rows', async () => {
    setQueryResults([makeScalarRow()], [], []);

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/web-events',
      headers: { 'x-api-key': ADMIN_API_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { topIntents: unknown; topErrors: unknown } };
    expect(body.data.topIntents).toEqual([]);
    expect(body.data.topErrors).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // avgResponseTimeMs — can be a float (weighted average)
  // -------------------------------------------------------------------------

  it('avgResponseTimeMs is a non-integer float when weighted sum does not divide evenly', async () => {
    // weighted_time_sum=100, total_successes=3 → 100/3 = 33.333...
    setQueryResults(
      [makeScalarRow({ total_successes: '3', weighted_time_sum: '100', weighted_time_count: '3' })],
      [],
      [],
    );

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/web-events',
      headers: { 'x-api-key': ADMIN_API_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { avgResponseTimeMs: number } };
    expect(body.data.avgResponseTimeMs).toBeCloseTo(33.333, 2);
  });

  // -------------------------------------------------------------------------
  // Scalar row handling — scalarRows[0] undefined (completely empty DB result)
  // -------------------------------------------------------------------------

  it('handles empty scalarRows array gracefully (no rows returned at all)', async () => {
    // The route uses scalarRows[0]?.['field'] ?? 0 — this should produce all-zeros
    setQueryResults([], [], []);

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/web-events',
      headers: { 'x-api-key': ADMIN_API_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      data: {
        eventCount: number;
        totalQueries: number;
        totalSuccesses: number;
        totalErrors: number;
        totalRetries: number;
        avgResponseTimeMs: number | null;
      };
    };
    expect(body.data.eventCount).toBe(0);
    expect(body.data.totalQueries).toBe(0);
    expect(body.data.totalSuccesses).toBe(0);
    expect(body.data.totalErrors).toBe(0);
    expect(body.data.totalRetries).toBe(0);
    // No successes → avgResponseTimeMs should be null
    expect(body.data.avgResponseTimeMs).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Numeric DB string coercion — count fields returned as strings from Postgres
  // -------------------------------------------------------------------------

  it('coerces DB string count values to numbers in topIntents', async () => {
    setQueryResults(
      [makeScalarRow()],
      [{ intent: 'test_intent', count: '42' }],
      [],
    );

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/web-events',
      headers: { 'x-api-key': ADMIN_API_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      data: { topIntents: { intent: string; count: number }[] };
    };
    // Must be a JS number, not a string
    expect(typeof body.data.topIntents[0]?.count).toBe('number');
    expect(body.data.topIntents[0]?.count).toBe(42);
  });

  it('coerces DB string count values to numbers in topErrors', async () => {
    setQueryResults(
      [makeScalarRow()],
      [],
      [{ error_code: 'NETWORK_ERROR', count: '15' }],
    );

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/web-events',
      headers: { 'x-api-key': ADMIN_API_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      data: { topErrors: { errorCode: string; count: number }[] };
    };
    expect(typeof body.data.topErrors[0]?.count).toBe('number');
    expect(body.data.topErrors[0]?.count).toBe(15);
  });
});
