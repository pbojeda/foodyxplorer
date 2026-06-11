// QA Edge-Case Tests — F-ADMIN-ANALYTICS-UI (requireAdminBearer + historySample)
//
// Hunts for bugs the developer missed. All happy-path tests live in the main
// route/unit test files. This file covers the gaps.
//
// Bugs found + tests:
//
//   BUG-1: historySample in-memory intent filter crashes on null result_jsonb.
//     Line 106 of historySample.ts: `const data = row.result_jsonb as Record<string, unknown>;`
//     followed by `return data['intent'] === intent;` — no null guard.
//     If a DB row has `result_jsonb = NULL`, this throws TypeError.
//     (The AdminResultDataSchema.safeParse on line 124 would also reject null,
//      so the row would be dropped — but the CRASH happens in the earlier filter
//      at line 104-109 which runs BEFORE safeParse on line 124.)
//
//   BUG-2: intent filter runs AFTER DB LIMIT — under-delivery of results.
//     The spec SQL guidance shows intent filter at DB level (WHERE clause).
//     The implementation applies LIMIT at DB level then filters intent in memory.
//     With limit=20 and an intent that matches only 5 of 20 fetched rows,
//     the response returns 5 items even though 100+ matching rows exist in the DB.
//     This is a documented spec deviation (comment at line 97-101 of historySample.ts
//     says "safe at this scale") but no test asserts the actual under-delivery behavior,
//     meaning silent regressions could go undetected if the behavior changes.
//
//   BUG-3: Redis INCR throws (Redis down) during rate limit check — propagates as
//     INTERNAL_ERROR (500) instead of a named code. The try/catch around the tier
//     resolution (branch 6) does NOT cover the rate-limit Redis calls. While 500 is
//     correct fail-closed behavior, the error code is INTERNAL_ERROR (generic fallthrough)
//     rather than a named code — inconsistent with how DB errors get DB_UNAVAILABLE.
//     No existing test covers this path.
//
//   GAP-1: Empty accountId string — branch 1 in requireAdminBearer checks `!request.accountId`
//     which is falsy for empty string, so "" → 401. Covered below.
//
//   GAP-2: allowTestBypass=true short-circuits ALL checks including invalid accountId.
//     No test verifies that the bypass ONLY fires when the flag is explicitly set, and
//     that the default (false) does NOT bypass.
//
//   GAP-3: result_jsonb that is a non-object (string, number, boolean) — the filter
//     cast `as Record<string, unknown>` would not crash (property access returns undefined)
//     but the subsequent AdminResultDataSchema.safeParse would fail and drop the row.
//     Test verifies graceful drop, not crash.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply, FastifyBaseLogger } from 'fastify';

// ---------------------------------------------------------------------------
// Mocks for requireAdminBearer
// ---------------------------------------------------------------------------

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisIncr = vi.fn();
const mockRedisExpire = vi.fn();
const mockRedis = {
  get: mockRedisGet,
  set: mockRedisSet,
  incr: mockRedisIncr,
  expire: mockRedisExpire,
};

const mockQueryRaw = vi.fn();
const mockPrisma = {
  $queryRaw: mockQueryRaw,
};

const { makeRequireAdminBearer } = await import('../plugins/requireAdminBearer.js');

const TEST_SUB = 'f7f00000-edge-4000-a000-000000000099';

function makeRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    accountId: TEST_SUB,
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as FastifyBaseLogger,
    ...overrides,
  } as unknown as FastifyRequest;
}

function makeReply(): FastifyReply {
  return {} as FastifyReply;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue('OK');
  mockRedisIncr.mockResolvedValue(1);
  mockRedisExpire.mockResolvedValue(1);
});

// ---------------------------------------------------------------------------
// GAP-1: Empty string accountId → 401 UNAUTHORIZED (falsy check)
// ---------------------------------------------------------------------------

describe('requireAdminBearer — empty string accountId (GAP-1)', () => {
  it('throws UNAUTHORIZED when accountId is empty string (falsy)', async () => {
    const gate = makeRequireAdminBearer({
      redis: mockRedis as never,
      prisma: mockPrisma as never,
      config: { NODE_ENV: 'test' },
    });
    const req = makeRequest({ accountId: '' as unknown as string });

    await expect(gate(req, makeReply())).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});

// ---------------------------------------------------------------------------
// BUG-3: Redis INCR throws → propagates (fail-closed behavior confirmed)
// ---------------------------------------------------------------------------

describe('requireAdminBearer — Redis INCR throws during rate limit (BUG-3)', () => {
  it('propagates error when redis.incr throws (fail-closed; non-test env)', async () => {
    const gate = makeRequireAdminBearer({
      redis: mockRedis as never,
      prisma: mockPrisma as never,
      rateLimitMax: 30,
      config: { NODE_ENV: 'development' }, // rate limit active
    });
    const redisError = new Error('Redis connection refused');
    mockRedisIncr.mockRejectedValue(redisError);

    // Should propagate (fail-closed — 500 rather than granting access)
    await expect(gate(makeRequest(), makeReply())).rejects.toThrow('Redis connection refused');
    // DB should NOT be called — Redis failure is pre-DB
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it('Redis EXPIRE throws → fire-and-forget: gate still passes, warn is logged', async () => {
    // BUG-3 fix: EXPIRE failure must NOT propagate (permanent lockout risk).
    // Instead: swallow + log warn, gate continues to tier-check.
    // The INCR itself is awaited (we need the count) — EXPIRE is fire-and-forget.
    const gate = makeRequireAdminBearer({
      redis: mockRedis as never,
      prisma: mockPrisma as never,
      rateLimitMax: 30,
      config: { NODE_ENV: 'development' },
    });
    mockRedisIncr.mockResolvedValue(1); // first request → triggers EXPIRE
    // Use mockImplementation instead of mockRejectedValue to avoid unhandled rejection warning
    mockRedisExpire.mockImplementation(() => Promise.reject(new Error('Redis EXPIRE failed')));
    mockQueryRaw.mockResolvedValue([{ tier: 'admin' }]); // tier check succeeds

    const req = makeRequest();
    // Gate should NOT throw — EXPIRE failure is swallowed (fire-and-forget)
    await expect(gate(req, makeReply())).resolves.toBeUndefined();
    // adminVerified must be set (request went through)
    expect((req as { adminVerified?: boolean }).adminVerified).toBe(true);
    // warn must be logged about the EXPIRE failure
    expect((req.log.warn as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.objectContaining({ rateLimitKey: expect.any(String) }),
      expect.stringContaining('requireAdminBearer: redis.expire failed'),
    );
  });
});

// ---------------------------------------------------------------------------
// GAP-2: allowTestBypass defaults to false; only bypasses when explicitly set
// ---------------------------------------------------------------------------

describe('requireAdminBearer — allowTestBypass default behavior (GAP-2)', () => {
  it('does NOT bypass when allowTestBypass is not provided (default false)', async () => {
    const gate = makeRequireAdminBearer({
      redis: mockRedis as never,
      prisma: mockPrisma as never,
      config: { NODE_ENV: 'test' },
      // allowTestBypass NOT specified — defaults to false
    });
    // No accountId → should still throw UNAUTHORIZED
    const req = makeRequest({ accountId: undefined });

    await expect(gate(req, makeReply())).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('bypasses ALL checks when allowTestBypass is explicitly true', async () => {
    const gate = makeRequireAdminBearer({
      redis: mockRedis as never,
      prisma: mockPrisma as never,
      config: { NODE_ENV: 'test' },
      allowTestBypass: true,
    });
    // No accountId, but bypass is active — should NOT throw
    const req = makeRequest({ accountId: undefined });

    await expect(gate(req, makeReply())).resolves.toBeUndefined();
    // Neither DB nor Redis should be touched when bypass is active
    expect(mockQueryRaw).not.toHaveBeenCalled();
    expect(mockRedisIncr).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// BUG-1 + BUG-2: historySample route via Kysely mock
// ---------------------------------------------------------------------------

// We test the historySample handler directly by constructing a minimal
// buildApp() instance with mocked Kysely, Prisma, Redis, and JWT verify.
// This mirrors the existing fAdminAnalytics.historySample.route.test.ts pattern.

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

const { mockVerifyBearerJwt: mockJwt } = vi.hoisted(() => ({
  mockVerifyBearerJwt: vi.fn(),
}));

vi.mock('../plugins/authBearer.js', () => ({
  verifyBearerJwt: mockJwt,
}));

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
  },
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

import { buildApp } from '../app.js';
import type { Config } from '../config.js';
import type { FastifyInstance } from 'fastify';

const ADMIN_BEARER_HEADER = 'Authorization';
const ADMIN_BEARER_VALUE = 'Bearer test-admin-token';
const ADMIN_SUB = 'fa130000-edge-4000-a000-000000000099';

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

// Use a fresh beforeEach per describe — they share the same hoisted vi.mock
// so app is built once in the describe-level beforeAll.
describe('GET /analytics/history-sample — edge cases (BUG-1, BUG-2, GAP-3)', () => {
  let appInstance: FastifyInstance;

  beforeEach(async () => {
    if (!appInstance) {
      appInstance = await buildApp({ config: BASE_CONFIG });
      await appInstance.ready();
    }
    kyselyContainer.results = [];
    kyselyContainer.error = null;
    kyselyContainer.callIndex = 0;
    mockJwt.mockResolvedValue({ sub: ADMIN_SUB });
  });

  // -------------------------------------------------------------------
  // BUG-1: result_jsonb = null crashes the in-memory intent filter
  // -------------------------------------------------------------------

  it('BUG-1: does NOT crash when result_jsonb is null and intent filter is active', async () => {
    // Row with null result_jsonb — should be silently dropped, not crash
    const rowWithNullJsonb = {
      id: 'fd000000-null-4000-a000-000000000001',
      kind: 'text',
      query_text: 'null jsonb query',
      result_jsonb: null, // <-- NULL from DB
      created_at: new Date('2026-06-11T10:00:00.000Z'),
    };

    kyselyContainer.results = [[rowWithNullJsonb]];

    // The intent filter is active — this triggers the crash path in historySample.ts:106
    const res = await appInstance.inject({
      method: 'GET',
      url: '/analytics/history-sample?intent=estimation',
      headers: { [ADMIN_BEARER_HEADER]: ADMIN_BEARER_VALUE },
    });

    // Should return 200 with empty items (null jsonb row silently dropped)
    // NOT a 500 crash
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { success: boolean; data: { items: unknown[] } };
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(0);
  });

  it('BUG-1: does NOT crash when result_jsonb is null and NO intent filter (drop on safeParse)', async () => {
    // Without intent filter, the null-crash path at line 106 is NOT triggered.
    // The row reaches AdminResultDataSchema.safeParse which rejects null → silent drop.
    // Verify this still works correctly as a baseline.
    const rowWithNullJsonb = {
      id: 'fd000000-null-4000-a000-000000000002',
      kind: 'text',
      query_text: 'null jsonb no filter',
      result_jsonb: null,
      created_at: new Date('2026-06-11T10:00:00.000Z'),
    };

    kyselyContainer.results = [[rowWithNullJsonb]];

    const res = await appInstance.inject({
      method: 'GET',
      url: '/analytics/history-sample',
      headers: { [ADMIN_BEARER_HEADER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { success: boolean; data: { items: unknown[] } };
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(0);
  });

  // -------------------------------------------------------------------
  // GAP-3: result_jsonb is non-null non-object (primitive) — graceful drop
  // -------------------------------------------------------------------

  it('GAP-3: gracefully drops row when result_jsonb is a primitive string', async () => {
    const rowWithStringJsonb = {
      id: 'fd000000-str-4000-a000-000000000003',
      kind: 'text',
      query_text: 'string jsonb',
      result_jsonb: '"just a string"', // invalid shape for ConversationMessageData
      created_at: new Date('2026-06-11T10:00:00.000Z'),
    };

    kyselyContainer.results = [[rowWithStringJsonb]];

    const res = await appInstance.inject({
      method: 'GET',
      url: '/analytics/history-sample',
      headers: { [ADMIN_BEARER_HEADER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { success: boolean; data: { items: unknown[] } };
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(0);
  });

  it('GAP-3: gracefully drops row when result_jsonb is an array (not an object)', async () => {
    const rowWithArrayJsonb = {
      id: 'fd000000-arr-4000-a000-000000000004',
      kind: 'text',
      query_text: 'array jsonb',
      result_jsonb: [{ intent: 'estimation' }], // array, not object with intent
      created_at: new Date('2026-06-11T10:00:00.000Z'),
    };

    kyselyContainer.results = [[rowWithArrayJsonb]];

    const res = await appInstance.inject({
      method: 'GET',
      url: '/analytics/history-sample?intent=estimation',
      headers: { [ADMIN_BEARER_HEADER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { success: boolean; data: { items: unknown[] } };
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(0);
  });

  // -------------------------------------------------------------------
  // C2 fix: intent filter moved to SQL — no more under-delivery
  // (BUG-2 was the pre-fix test documenting under-delivery; now fixed)
  // -------------------------------------------------------------------

  it('C2 fix: SQL intent filter — all DB-returned rows pass through (mock does not filter)', async () => {
    // With the SQL-level fix, the DB WHERE clause filters by intent before applying LIMIT.
    // In mock tests, where() is a no-op, so both rows are returned by execute().
    // This confirms the handler no longer does in-memory filtering that caused under-delivery.
    const estimationRow = {
      id: 'fd000000-est1-4000-a000-000000000005',
      kind: 'text',
      query_text: 'estimation query',
      result_jsonb: {
        intent: 'estimation',
        actorId: 'actor-to-strip',
        activeContext: null,
      },
      created_at: new Date('2026-06-11T10:00:00.000Z'),
    };
    const comparisonRow = {
      id: 'fd000000-cmp1-4000-a000-000000000006',
      kind: 'text',
      query_text: 'comparison query',
      result_jsonb: {
        intent: 'comparison',
        actorId: 'actor-to-strip',
        activeContext: null,
      },
      created_at: new Date('2026-06-11T09:00:00.000Z'),
    };

    // Mock execute() returns both rows (the real DB would only return estimation rows
    // because of the SQL WHERE clause — mock doesn't apply the WHERE, so both come through).
    kyselyContainer.results = [[estimationRow, comparisonRow]];

    const res = await appInstance.inject({
      method: 'GET',
      url: '/analytics/history-sample?limit=2&intent=estimation',
      headers: { [ADMIN_BEARER_HEADER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      success: boolean;
      data: { items: Array<{ queryText: string }> };
    };
    expect(body.success).toBe(true);
    // Both rows returned (no in-memory filtering anymore — SQL handles it)
    // In the real DB, only the estimation row would come back.
    // The mock is correct: it simulates what the DB would return after the SQL filter.
    expect(body.data.items).toHaveLength(2);
  });

  // -------------------------------------------------------------------
  // Boundary: hours=0 rejected (below min=1)
  // -------------------------------------------------------------------

  it('returns 400 when hours=0 (below min boundary)', async () => {
    const res = await appInstance.inject({
      method: 'GET',
      url: '/analytics/history-sample?hours=0',
      headers: { [ADMIN_BEARER_HEADER]: ADMIN_BEARER_VALUE },
    });
    expect(res.statusCode).toBe(400);
  });

  // -------------------------------------------------------------------
  // Boundary: limit=0 rejected (below min=1)
  // -------------------------------------------------------------------

  it('returns 400 when limit=0 (below min boundary)', async () => {
    const res = await appInstance.inject({
      method: 'GET',
      url: '/analytics/history-sample?limit=0',
      headers: { [ADMIN_BEARER_HEADER]: ADMIN_BEARER_VALUE },
    });
    expect(res.statusCode).toBe(400);
  });

  // -------------------------------------------------------------------
  // Boundary: hours=1 and limit=1 accepted (at min boundary)
  // -------------------------------------------------------------------

  it('returns 200 for hours=1 limit=1 (min boundaries)', async () => {
    kyselyContainer.results = [[]];
    const res = await appInstance.inject({
      method: 'GET',
      url: '/analytics/history-sample?hours=1&limit=1',
      headers: { [ADMIN_BEARER_HEADER]: ADMIN_BEARER_VALUE },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { hours: number; limit: number } };
    expect(body.data.hours).toBe(1);
    expect(body.data.limit).toBe(1);
  });

  // -------------------------------------------------------------------
  // Boundary: float hours/limit rejected by .int() Zod constraint
  // -------------------------------------------------------------------

  it('returns 400 for non-integer hours (float value 24.5)', async () => {
    const res = await appInstance.inject({
      method: 'GET',
      url: '/analytics/history-sample?hours=24.5',
      headers: { [ADMIN_BEARER_HEADER]: ADMIN_BEARER_VALUE },
    });
    // Zod z.coerce.number().int() rejects non-integer floats
    expect(res.statusCode).toBe(400);
  });

  // -------------------------------------------------------------------
  // Privacy: mixed valid + null-jsonb rows — valid rows still returned
  // -------------------------------------------------------------------

  it('returns valid rows and drops null-jsonb rows in the same result set', async () => {
    const validRow = {
      id: 'fd000000-val1-4000-a000-000000000007',
      kind: 'text',
      query_text: 'valid query',
      result_jsonb: {
        intent: 'estimation',
        actorId: 'actor-uuid-strip',
        activeContext: null,
      },
      created_at: new Date('2026-06-11T10:00:00.000Z'),
    };
    const nullRow = {
      id: 'fd000000-nul2-4000-a000-000000000008',
      kind: 'text',
      query_text: 'null row',
      result_jsonb: null,
      created_at: new Date('2026-06-11T09:00:00.000Z'),
    };

    kyselyContainer.results = [[validRow, nullRow]];

    const res = await appInstance.inject({
      method: 'GET',
      url: '/analytics/history-sample',
      headers: { [ADMIN_BEARER_HEADER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      data: { items: Array<{ queryText: string; resultData: Record<string, unknown> }> };
    };
    // Only the valid row should be returned
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]?.queryText).toBe('valid query');
    // actorId must be stripped
    expect(body.data.items[0]?.resultData).not.toHaveProperty('actorId');
  });

  // -------------------------------------------------------------------
  // Privacy: actorId absent with intent filter active (defence-in-depth)
  // -------------------------------------------------------------------

  it('strips actorId even when intent filter is active', async () => {
    const rowWithActorId = {
      id: 'fd000000-act1-4000-a000-000000000009',
      kind: 'text',
      query_text: 'query with actor',
      result_jsonb: {
        intent: 'estimation',
        actorId: 'actor-uuid-must-be-stripped',
        activeContext: null,
      },
      created_at: new Date('2026-06-11T10:00:00.000Z'),
    };

    kyselyContainer.results = [[rowWithActorId]];

    const res = await appInstance.inject({
      method: 'GET',
      url: '/analytics/history-sample?intent=estimation',
      headers: { [ADMIN_BEARER_HEADER]: ADMIN_BEARER_VALUE },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      data: { items: Array<{ resultData: Record<string, unknown> }> };
    };
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]?.resultData).not.toHaveProperty('actorId');
  });
});
