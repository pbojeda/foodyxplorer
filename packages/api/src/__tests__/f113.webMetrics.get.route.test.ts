// Route tests for GET /analytics/web-events (F113)
//
// Uses buildApp().inject() with hoisted mocks.
// Kysely db mock intercepts sql<T>`...`.execute(db) via getExecutor().executeQuery().
// The Promise.all in the handler runs 3 queries: scalar, intents, errors (in order).

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
// Prisma mock
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

  it('returns 401 without X-API-Key header (admin-only)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/analytics/web-events',
    });

    expect(res.statusCode).toBe(401);
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
      headers: { 'x-api-key': ADMIN_API_KEY },
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
      headers: { 'x-api-key': ADMIN_API_KEY },
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
      headers: { 'x-api-key': ADMIN_API_KEY },
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
      headers: { 'x-api-key': ADMIN_API_KEY },
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
      headers: { 'x-api-key': ADMIN_API_KEY },
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
      headers: { 'x-api-key': ADMIN_API_KEY },
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
      headers: { 'x-api-key': ADMIN_API_KEY },
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
      headers: { 'x-api-key': ADMIN_API_KEY },
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
      headers: { 'x-api-key': ADMIN_API_KEY },
    });

    expect(res.statusCode).toBe(500);
  });
});
