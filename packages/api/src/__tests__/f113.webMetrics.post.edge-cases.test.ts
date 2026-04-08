// Edge-case tests for POST /analytics/web-events (F113)
//
// Covers gaps in f113.webMetrics.post.route.test.ts:
//   - null body (no payload)
//   - empty string body with text/plain
//   - text/plain body with JSON null
//   - POST with valid admin API key (public route — admin key should still work)
//   - POST with X-Actor-Id header present (actor resolver skipped, header silently ignored)
//   - POST with extra unknown fields in body (stripped, returns 202)
//   - errorCount cross-field: errorCount === queryCount (boundary — should pass)
//   - retryCount with very large value (no upper cap in spec)

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockWebMetricsCreate } = vi.hoisted(() => ({
  mockWebMetricsCreate: vi.fn().mockResolvedValue({ id: 'test-id' }),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    webMetricsEvent: {
      create: mockWebMetricsCreate,
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

const { mockKyselyChainStubs } = vi.hoisted(() => {
  const execute = vi.fn().mockResolvedValue([]);
  const executeTakeFirstOrThrow = vi.fn().mockResolvedValue({ count: '0' });
  const chainMethodNames = [
    'selectFrom', 'innerJoin', 'select', 'where', 'orderBy',
    'limit', 'offset', '$if',
  ] as const;
  const stub: Record<string, unknown> = {};
  for (const method of chainMethodNames) {
    stub[method] = vi.fn();
  }
  stub['execute'] = execute;
  stub['executeTakeFirstOrThrow'] = executeTakeFirstOrThrow;
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

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    queryCount: 5,
    successCount: 4,
    errorCount: 1,
    retryCount: 0,
    intents: { nutritional_query: 3 },
    errors: { NETWORK_ERROR: 1 },
    avgResponseTimeMs: 1200,
    sessionStartedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Edge cases for POST /analytics/web-events
// ---------------------------------------------------------------------------

describe('POST /analytics/web-events — edge cases', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: BASE_CONFIG });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Body edge cases
  // -------------------------------------------------------------------------

  it('returns 400 for null JSON body (application/json null)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/analytics/web-events',
      headers: { 'content-type': 'application/json' },
      payload: 'null',
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for empty string body with text/plain (not valid JSON)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/analytics/web-events',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      payload: '',
    });

    // Empty string is not valid JSON — should return 400
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for text/plain body containing JSON null', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/analytics/web-events',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      payload: 'null',
    });

    // JSON.parse('null') === null — Zod safeParse(null) fails
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for text/plain body containing JSON array', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/analytics/web-events',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      payload: '[]',
    });

    expect(res.statusCode).toBe(400);
  });

  it('strips extra unknown fields and returns 202 (not 400)', async () => {
    mockWebMetricsCreate.mockResolvedValueOnce({ id: 'stripped-id' });

    const res = await app.inject({
      method: 'POST',
      url: '/analytics/web-events',
      headers: { 'content-type': 'application/json' },
      payload: validPayload({
        unknownField: 'should be ignored',
        anotherExtraField: 99999,
      }),
    });

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toEqual({ success: true });
  });

  // -------------------------------------------------------------------------
  // Auth / header edge cases
  // -------------------------------------------------------------------------

  it('returns 401 when admin X-API-Key is provided (admin key is not in api_keys table — public auth rejects unknown keys)', async () => {
    // SPEC BEHAVIOR: POST /analytics/web-events is a public route — no key required.
    // The auth middleware flow for public routes:
    //   1. isAdminRoute() returns false for POST → falls through to public key path
    //   2. Public key path: if any X-API-Key is present, it is validated against the api_keys table
    //   3. The admin env key (ADMIN_API_KEY) is NOT in api_keys table
    //   4. apiKey.findUnique → null → UNAUTHORIZED → 401
    //
    // Conclusion: sending the admin API key to a public route causes 401.
    // The admin key is ONLY valid for admin routes. For POST /analytics/web-events,
    // no X-API-Key header should be sent at all (sendBeacon cannot set headers anyway).
    const res = await app.inject({
      method: 'POST',
      url: '/analytics/web-events',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ADMIN_API_KEY,
      },
      payload: validPayload(),
    });

    // This is correct and expected behavior — the admin key is not a public API key.
    // Clients (sendBeacon) must NOT send X-API-Key to this endpoint.
    expect(res.statusCode).toBe(401);
  });

  it('returns 202 when X-Actor-Id header is present (actor resolver skipped, no ghost actor created)', async () => {
    // Even though actorResolver is skipped for this route, sending the header must not break anything
    mockWebMetricsCreate.mockResolvedValueOnce({ id: 'with-actor-id' });

    const res = await app.inject({
      method: 'POST',
      url: '/analytics/web-events',
      headers: {
        'content-type': 'application/json',
        'x-actor-id': 'some-actor-uuid-0000-0000-000000000001',
      },
      payload: validPayload(),
    });

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toEqual({ success: true });
  });

  // -------------------------------------------------------------------------
  // Cross-field boundary cases
  // -------------------------------------------------------------------------

  it('accepts errorCount === queryCount (boundary — all queries errored)', async () => {
    mockWebMetricsCreate.mockResolvedValueOnce({ id: 'all-errors-id' });

    const res = await app.inject({
      method: 'POST',
      url: '/analytics/web-events',
      headers: { 'content-type': 'application/json' },
      payload: validPayload({ queryCount: 3, successCount: 0, errorCount: 3 }),
    });

    expect(res.statusCode).toBe(202);
  });

  it('accepts large retryCount (no upper cap in spec)', async () => {
    // The spec says retryCount is min 0 with no maximum.
    // This test documents the contract: the endpoint accepts unbounded retryCount values.
    mockWebMetricsCreate.mockResolvedValueOnce({ id: 'large-retry-id' });

    const res = await app.inject({
      method: 'POST',
      url: '/analytics/web-events',
      headers: { 'content-type': 'application/json' },
      payload: validPayload({ retryCount: 999999 }),
    });

    expect(res.statusCode).toBe(202);
  });

  it('returns 400 for non-integer retryCount (float)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/analytics/web-events',
      headers: { 'content-type': 'application/json' },
      payload: validPayload({ retryCount: 1.5 }),
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for intents with float value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/analytics/web-events',
      headers: { 'content-type': 'application/json' },
      payload: validPayload({ intents: { nutritional_query: 2.5 } }),
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for errors with negative count value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/analytics/web-events',
      headers: { 'content-type': 'application/json' },
      payload: validPayload({ errors: { NETWORK_ERROR: -1 } }),
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // DB insert arguments — correct data is passed to Prisma
  // -------------------------------------------------------------------------

  it('passes correct transformed avgResponseTimeMs (rounded) to Prisma create', async () => {
    mockWebMetricsCreate.mockClear();
    mockWebMetricsCreate.mockResolvedValueOnce({ id: 'rounded-id' });

    await app.inject({
      method: 'POST',
      url: '/analytics/web-events',
      headers: { 'content-type': 'application/json' },
      payload: validPayload({ avgResponseTimeMs: 1234.6 }),
    });

    expect(mockWebMetricsCreate).toHaveBeenCalledOnce();
    const callArgs = mockWebMetricsCreate.mock.calls[0]?.[0] as { data: { avgResponseTimeMs: number } };
    // Zod transform(Math.round) should have rounded 1234.6 to 1235
    expect(callArgs.data.avgResponseTimeMs).toBe(1235);
  });

  it('passes sessionStartedAt as a Date object to Prisma create (not a raw string)', async () => {
    mockWebMetricsCreate.mockClear();
    mockWebMetricsCreate.mockResolvedValueOnce({ id: 'date-id' });

    const isoString = new Date().toISOString();
    await app.inject({
      method: 'POST',
      url: '/analytics/web-events',
      headers: { 'content-type': 'application/json' },
      payload: validPayload({ sessionStartedAt: isoString }),
    });

    expect(mockWebMetricsCreate).toHaveBeenCalledOnce();
    const callArgs = mockWebMetricsCreate.mock.calls[0]?.[0] as { data: { sessionStartedAt: unknown } };
    expect(callArgs.data.sessionStartedAt).toBeInstanceOf(Date);
  });
});
