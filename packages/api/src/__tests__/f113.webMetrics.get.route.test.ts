// Route tests for GET /analytics/web-events (F113)
//
// Uses buildApp().inject() with hoisted mocks.
// Kysely db mock intercepts sql<T>`...`.execute(db) via getExecutor().executeQuery().
// The Promise.all in the handler runs 3 queries: scalar, intents, errors (in order).
//
// F-ADMIN-ANALYTICS-UI migration (ADR-031): analytics routes now use bearer-only auth.
// verifyBearerJwt is mocked; Prisma $queryRaw returns admin tier for requireAdminBearer.
// All GET requests that previously used x-api-key now use 'Authorization: Bearer test-token'.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';

// ---------------------------------------------------------------------------
// Kysely db mock — intercepts sql`...`.execute(db) via getExecutor
// ---------------------------------------------------------------------------

// sql<T>`...`.execute(db) calls:
//   1. db.getExecutor()
//   2. executor.compileQuery(compiled)  — but actually it calls executeQuery directly
//
// The actual call chain for sql`...`.execute(db):
//   1. sql`...` returns a RawBuilder
//   2. .execute(db) calls db.getExecutor().executeQuery(compiled)
//
// So we need getExecutor().executeQuery to return controlled rows per call.

const { dbContainer } = vi.hoisted(() => {
  const container = {
    queryResults: [] as unknown[][],
    shouldThrow: false,
    callIndex: 0,
  };
  return { dbContainer: container };
});

const { kyselyContainer } = vi.hoisted(() => {
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

  (container as Record<string, unknown>)['makeDb'] = () => {
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

    return {
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
      getExecutor: vi.fn().mockReturnValue(executor),
    };
  };

  return { kyselyContainer: container };
});

vi.mock('../lib/kysely.js', () => ({
  getKysely: () => {
    kyselyContainer.callIndex = 0;
    dbContainer.callIndex = 0;
    return (kyselyContainer as unknown as { makeDb: () => unknown }).makeDb();
  },
  destroyKysely: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock verifyBearerJwt (F-ADMIN-ANALYTICS-UI: bearer-only for analytics routes)
// ---------------------------------------------------------------------------

const { mockVerifyBearerJwt } = vi.hoisted(() => ({
  mockVerifyBearerJwt: vi.fn(),
}));

vi.mock('../plugins/authBearer.js', () => ({
  verifyBearerJwt: mockVerifyBearerJwt,
}));

// ---------------------------------------------------------------------------
// Prisma mock — $queryRaw returns admin tier for requireAdminBearer preHandler
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
    $queryRaw: vi.fn().mockResolvedValue([{ tier: 'admin' }]),
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

// F-ADMIN-ANALYTICS-UI migration: ADMIN_API_KEY no longer used for analytics routes.
// Kept as constant to avoid breaking other tests that may reference it.
const ADMIN_API_KEY = 'a'.repeat(32);

// Bearer token constants for F-ADMIN-ANALYTICS-UI bearer-only auth migration
const ADMIN_BEARER = 'Authorization';
const ADMIN_BEARER_VALUE = 'Bearer test-admin-token';
const ADMIN_SUB = 'f1130000-0001-4000-a000-000000000001';

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
  SUPABASE_JWKS_URL: 'https://test.supabase.co/auth/v1/.well-known/jwks.json',
};

// Set up 3 query results for the Promise.all: [scalar, intents, errors]
function setQueryResults(
  scalar: Record<string, unknown>[],
  intents: { intent: string; count: string }[],
  errors: { error_code: string; count: string }[],
): void {
  dbContainer.queryResults = [scalar, intents, errors];
  dbContainer.callIndex = 0;
  dbContainer.shouldThrow = false;
}

function setQueryThrows(): void {
  dbContainer.shouldThrow = true;
  dbContainer.callIndex = 0;
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
// GET /analytics/web-events tests
// ---------------------------------------------------------------------------

describe('GET /analytics/web-events', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: BASE_CONFIG, adminBypass: true });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    dbContainer.callIndex = 0;
    dbContainer.shouldThrow = false;
    // F-ADMIN-ANALYTICS-UI: set up bearer JWT mock for each test
    mockVerifyBearerJwt.mockResolvedValue({ sub: ADMIN_SUB });
  });

  it('returns 401 without bearer header (F-ADMIN-ANALYTICS-UI: no X-API-Key, no bearer)', async () => {
    // This test exercises the REAL bearer gate (not the legacy bypass) so it
    // builds its own app with adminBypass disabled. Other tests in this file
    // use the shared `app` from beforeAll which has adminBypass=true to keep
    // their pre-migration assertions (data-path logic, not auth).
    const gatedApp = await buildApp({ config: BASE_CONFIG, adminBypass: false });
    try {
      const res = await gatedApp.inject({
        method: 'GET',
        url: '/analytics/web-events',
        // No Authorization header
      });

      expect(res.statusCode).toBe(401);
    } finally {
      await gatedApp.close();
    }
  });

  it('returns 200 with aggregated data when valid X-API-Key and no query params', async () => {
    setQueryResults(
      [makeScalarRow()],
      [{ intent: 'nutritional_query', count: '180' }, { intent: 'comparison', count: '75' }],
      [{ error_code: 'NETWORK_ERROR', count: '15' }],
    );

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/web-events',
      headers: { [ADMIN_BEARER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      success: boolean;
      data: {
        eventCount: number;
        totalQueries: number;
        totalSuccesses: number;
        totalErrors: number;
        totalRetries: number;
        avgResponseTimeMs: number | null;
        topIntents: { intent: string; count: number }[];
        topErrors: { errorCode: string; count: number }[];
        timeRange: string;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.timeRange).toBe('7d');
    expect(body.data.eventCount).toBe(42);
    expect(body.data.totalQueries).toBe(310);
    expect(body.data.totalSuccesses).toBe(285);
    expect(body.data.totalErrors).toBe(25);
    expect(body.data.totalRetries).toBe(8);
    expect(typeof body.data.avgResponseTimeMs).toBe('number');
    expect(body.data.topIntents[0]?.intent).toBe('nutritional_query');
    expect(body.data.topErrors[0]?.errorCode).toBe('NETWORK_ERROR');
  });

  it('reflects timeRange=24h in the response', async () => {
    setQueryResults([makeScalarRow()], [], []);

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/web-events?timeRange=24h',
      headers: { [ADMIN_BEARER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { timeRange: string } };
    expect(body.data.timeRange).toBe('24h');
  });

  it('returns timeRange=all correctly (no time filter)', async () => {
    setQueryResults([makeScalarRow()], [], []);

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/web-events?timeRange=all',
      headers: { [ADMIN_BEARER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { timeRange: string } };
    expect(body.data.timeRange).toBe('all');
  });

  it('returns all-zero totals and null avgResponseTimeMs for empty table', async () => {
    setQueryResults(
      [{
        event_count: '0',
        total_queries: '0',
        total_successes: '0',
        total_errors: '0',
        total_retries: '0',
        weighted_time_sum: '0',
        weighted_time_count: '0',
      }],
      [],
      [],
    );

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/web-events',
      headers: { [ADMIN_BEARER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      data: { totalQueries: number; totalSuccesses: number; avgResponseTimeMs: number | null };
    };
    expect(body.data.totalQueries).toBe(0);
    expect(body.data.avgResponseTimeMs).toBeNull();
  });

  it('returns null avgResponseTimeMs when total_successes = 0', async () => {
    setQueryResults(
      [makeScalarRow({ total_successes: '0', weighted_time_sum: '0', weighted_time_count: '0' })],
      [],
      [],
    );

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/web-events',
      headers: { [ADMIN_BEARER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { avgResponseTimeMs: number | null } };
    expect(body.data.avgResponseTimeMs).toBeNull();
  });

  it('returns numeric avgResponseTimeMs when total_successes > 0', async () => {
    setQueryResults(
      [makeScalarRow({ total_successes: '10', weighted_time_sum: '5000', weighted_time_count: '10' })],
      [],
      [],
    );

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/web-events',
      headers: { [ADMIN_BEARER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { avgResponseTimeMs: number | null } };
    expect(body.data.avgResponseTimeMs).toBe(500);
  });

  it('topIntents sorted by count DESC, key ASC tie-break (DB returns pre-sorted)', async () => {
    setQueryResults(
      [makeScalarRow()],
      [
        { intent: 'z_intent', count: '100' },
        { intent: 'a_intent', count: '100' },
        { intent: 'b_intent', count: '50' },
      ],
      [],
    );

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/web-events',
      headers: { [ADMIN_BEARER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      data: { topIntents: { intent: string; count: number }[] };
    };
    expect(body.data.topIntents[0]?.intent).toBe('z_intent');
    expect(body.data.topIntents[1]?.intent).toBe('a_intent');
    expect(body.data.topIntents[2]?.intent).toBe('b_intent');
  });

  it('topErrors sorted by count DESC', async () => {
    setQueryResults(
      [makeScalarRow()],
      [],
      [
        { error_code: 'TIMEOUT', count: '20' },
        { error_code: 'NETWORK_ERROR', count: '5' },
      ],
    );

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/web-events',
      headers: { [ADMIN_BEARER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      data: { topErrors: { errorCode: string; count: number }[] };
    };
    expect(body.data.topErrors[0]?.errorCode).toBe('TIMEOUT');
    expect(body.data.topErrors[1]?.errorCode).toBe('NETWORK_ERROR');
  });

  it('returns 500 DB_UNAVAILABLE when Kysely throws', async () => {
    setQueryThrows();

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/web-events',
      headers: { [ADMIN_BEARER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(500);
  });
});
