// Route tests for GET /analytics/history-sample (F-ADMIN-ANALYTICS-UI B7)
//
// Uses buildApp().inject() with hoisted mocks.
// Kysely selectFrom() mock returns controlled rows per call.
// requireAdminBearer gate is active (not bypassed).
// verifyBearerJwt is mocked to return admin sub.
// Prisma $queryRaw returns admin tier.
//
// Endpoint: GET /analytics/history-sample?hours=24&limit=20&intent=estimation
// Guards: requireAdminBearer preHandler
// Returns: { success: true, data: { items, hours, limit, intentFilter? } }
// actorId is stripped from each resultData before returning.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';

// ---------------------------------------------------------------------------
// Kysely mock — selectFrom returns controlled rows
// ---------------------------------------------------------------------------

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
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
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
    getExecutor: vi.fn().mockReturnValue({
      executeQuery: vi.fn().mockResolvedValue({ rows: [] }),
      compileQuery: (n: unknown) => ({ sql: '', parameters: [], query: n }),
      transformQuery: (n: unknown) => n,
      withPlugins: function () { return this; },
      withTransformedRows: function () { return this; },
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
// Mock verifyBearerJwt — admin bearer auth
// ---------------------------------------------------------------------------

const { mockVerifyBearerJwt } = vi.hoisted(() => ({
  mockVerifyBearerJwt: vi.fn(),
}));

vi.mock('../plugins/authBearer.js', () => ({
  verifyBearerJwt: mockVerifyBearerJwt,
}));

// ---------------------------------------------------------------------------
// Prisma mock — $queryRaw returns admin tier
// ---------------------------------------------------------------------------

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    actor: {
      create: vi.fn().mockResolvedValue({ id: 'actor-id' }),
      upsert: vi.fn().mockResolvedValue({ id: 'actor-id' }),
    },
    apiKey: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([{ tier: 'admin' }]),
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
// Setup
// ---------------------------------------------------------------------------

import { buildApp } from '../app.js';

const ADMIN_BEARER = 'Authorization';
const ADMIN_BEARER_VALUE = 'Bearer test-admin-token';
const ADMIN_SUB = 'fa130000-0001-4000-a000-000000000001';

const BASE_CONFIG: Config = {
  NODE_ENV: 'test',
  PORT: 3001,
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_JWKS_URL: 'https://test.supabase.co/auth/v1/.well-known/jwks.json',
  OPENAI_API_KEY: 'test-openai-key',
  ADMIN_API_KEY: 'a'.repeat(32),
  LOG_LEVEL: 'silent',
  CORS_ORIGIN: 'http://localhost:3000',
  SESSION_SECRET: 'test-session-secret-32-chars-long!!',
  JWT_SECRET: 'test-jwt-secret',
  RATE_LIMIT_MAX: 100,
  RATE_LIMIT_WINDOW_MS: 60000,
  REDIS_URL: 'redis://localhost:6379',
};

// Fixture row with actorId that should be stripped
const FIXTURE_ROW = {
  id: 'fd000000-0001-4000-a000-000000000001',
  kind: 'text',
  query_text: 'Big Mac',
  result_jsonb: {
    intent: 'estimation',
    actorId: 'actor-uuid-should-be-stripped',
    activeContext: null,
  },
  created_at: new Date('2026-06-11T10:00:00.000Z'),
};

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ config: BASE_CONFIG });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  kyselyContainer.results = [];
  kyselyContainer.error = null;
  kyselyContainer.callIndex = 0;
  mockVerifyBearerJwt.mockResolvedValue({ sub: ADMIN_SUB });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /analytics/history-sample', () => {
  it('returns 200 with empty items when no rows', async () => {
    kyselyContainer.results = [[]];

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/history-sample',
      headers: { [ADMIN_BEARER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { success: boolean; data: { items: unknown[] } };
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(0);
  });

  it('returns 200 with defaults hours=24 limit=20', async () => {
    kyselyContainer.results = [[]];

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/history-sample',
      headers: { [ADMIN_BEARER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { hours: number; limit: number } };
    expect(body.data.hours).toBe(24);
    expect(body.data.limit).toBe(20);
  });

  it('returns 200 with custom hours and limit', async () => {
    kyselyContainer.results = [[]];

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/history-sample?hours=48&limit=10',
      headers: { [ADMIN_BEARER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { hours: number; limit: number } };
    expect(body.data.hours).toBe(48);
    expect(body.data.limit).toBe(10);
  });

  it('strips actorId from resultData', async () => {
    kyselyContainer.results = [[FIXTURE_ROW]];

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/history-sample',
      headers: { [ADMIN_BEARER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      data: { items: Array<{ resultData: Record<string, unknown> }> };
    };
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]?.['resultData']).not.toHaveProperty('actorId');
    expect(body.data.items[0]?.['resultData']['intent']).toBe('estimation');
  });

  it('echoes intentFilter when intent param provided', async () => {
    kyselyContainer.results = [[]];

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/history-sample?intent=estimation',
      headers: { [ADMIN_BEARER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { intentFilter: string } };
    expect(body.data.intentFilter).toBe('estimation');
  });

  it('returns 401 when no bearer token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/analytics/history-sample',
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 NOT_PROVISIONED when accounts row absent', async () => {
    mockVerifyBearerJwt.mockResolvedValueOnce({ sub: ADMIN_SUB });
    // $queryRaw returns empty → no accounts row
    const { prisma: mockPrisma } = await import('../lib/prisma.js') as { prisma: PrismaClient };
    const $queryRaw = vi.fn().mockResolvedValueOnce([]);
    (mockPrisma as unknown as Record<string, unknown>)['$queryRaw'] = $queryRaw;

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/analytics/history-sample',
        headers: { [ADMIN_BEARER]: ADMIN_BEARER_VALUE },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body) as { error: { code: string } };
      expect(body.error.code).toBe('NOT_PROVISIONED');
    } finally {
      // Restore
      (mockPrisma as unknown as Record<string, unknown>)['$queryRaw'] = vi.fn().mockResolvedValue([{ tier: 'admin' }]);
    }
  });

  it('returns 400 when hours is out of range', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/analytics/history-sample?hours=721',
      headers: { [ADMIN_BEARER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when limit is out of range', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/analytics/history-sample?limit=101',
      headers: { [ADMIN_BEARER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 500 when DB throws', async () => {
    kyselyContainer.error = new Error('connection refused');

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/history-sample',
      headers: { [ADMIN_BEARER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body) as { error: { code: string } };
    expect(body.error.code).toBe('DB_UNAVAILABLE');
  });

  // -----------------------------------------------------------------------
  // C2 fix: SQL-level intent filter returns correct count (not under-delivery)
  // -----------------------------------------------------------------------

  it('C2: SQL-level intent filter — returns up to limit items all matching intent', async () => {
    // Simulates the fixed behavior: DB-level WHERE filters by intent, so all
    // returned rows match the intent. With old in-memory filter, if DB returned
    // 20 mixed rows only a few would match. Now DB returns exactly the matching rows.
    // Seed 20 rows all with intent=menu_estimation (DB WHERE clause filters them).
    const menuEstimationRows = Array.from({ length: 20 }, (_, i) => ({
      id: `fd000000-me${String(i).padStart(2, '0')}-4000-a000-000000000001`,
      kind: 'text',
      query_text: `menu query ${i}`,
      result_jsonb: {
        intent: 'menu_estimation',
        actorId: 'actor-strip',
        activeContext: null,
      },
      created_at: new Date(Date.now() - i * 1000),
    }));

    kyselyContainer.results = [menuEstimationRows];

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/history-sample?intent=menu_estimation&limit=20',
      headers: { [ADMIN_BEARER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      success: boolean;
      data: { items: Array<{ resultData: Record<string, unknown> }> };
    };
    expect(body.success).toBe(true);
    // All 20 rows returned — SQL filter pre-selected matching rows
    expect(body.data.items).toHaveLength(20);
    // All items must have intent=menu_estimation (no mixed results)
    for (const item of body.data.items) {
      expect(item.resultData['intent']).toBe('menu_estimation');
    }
  });

  // -----------------------------------------------------------------------
  // BUG-1 fix: NULL result_jsonb rows are safely excluded by SQL ->> operator
  // (SQL WHERE result_jsonb->>'intent' = ? returns NULL != 'menu_estimation')
  // -----------------------------------------------------------------------

  it('BUG-1+C2: NULL result_jsonb rows excluded by SQL filter — returns 200 not 500', async () => {
    // With SQL-level intent filter, NULL result_jsonb rows never reach the handler.
    // Even if they somehow did, the AdminResultDataSchema.safeParse drops them.
    // Verify: null rows in DB result set → 200 with those rows excluded.
    const nullJsonbRow = {
      id: 'fd000000-nul3-4000-a000-000000000010',
      kind: 'text',
      query_text: 'null jsonb row',
      result_jsonb: null,
      created_at: new Date('2026-06-11T10:00:00.000Z'),
    };
    const validRow = {
      id: 'fd000000-val2-4000-a000-000000000011',
      kind: 'text',
      query_text: 'valid estimation',
      result_jsonb: {
        intent: 'menu_estimation',
        actorId: 'actor-strip',
        activeContext: null,
      },
      created_at: new Date('2026-06-11T10:00:00.000Z'),
    };

    // Even if DB leaks a null row through (edge case), handler must not crash
    kyselyContainer.results = [[nullJsonbRow, validRow]];

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/history-sample?intent=menu_estimation',
      headers: { [ADMIN_BEARER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      success: boolean;
      data: { items: Array<{ queryText: string }> };
    };
    expect(body.success).toBe(true);
    // Only the valid row returned, null row dropped
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]?.['queryText']).toBe('valid estimation');
  });
});

// ---------------------------------------------------------------------------
// I2: allowTestBypass propagated to historySample — bypass test
// ---------------------------------------------------------------------------

describe('GET /analytics/history-sample — allowTestBypass (I2)', () => {
  let bypassApp: import('fastify').FastifyInstance;

  beforeAll(async () => {
    bypassApp = await buildApp({ config: BASE_CONFIG, adminBypass: true });
    await bypassApp.ready();
  });

  afterAll(async () => {
    await bypassApp.close();
  });

  beforeEach(() => {
    kyselyContainer.results = [];
    kyselyContainer.error = null;
    kyselyContainer.callIndex = 0;
  });

  it('I2: returns 200 without bearer when adminBypass=true (bypass active)', async () => {
    // No Authorization header — gate is bypassed (same as other 3 analytics routes)
    kyselyContainer.results = [[]];

    const res = await bypassApp.inject({
      method: 'GET',
      url: '/analytics/history-sample',
      // No bearer token
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { success: boolean; data: { items: unknown[] } };
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(0);
  });
});
