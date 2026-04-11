// Route tests for POST /analytics/web-events (F113)
//
// Uses buildApp().inject() with hoisted mocks.
// Rate limiting is disabled in NODE_ENV=test — rate limit config is asserted
// via route registration options, not by triggering 429s.

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

const { mockActorCreate, mockActorUpsert } = vi.hoisted(() => ({
  mockActorCreate: vi.fn().mockResolvedValue({ id: 'actor-id' }),
  mockActorUpsert: vi.fn().mockResolvedValue({ id: 'actor-id' }),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    webMetricsEvent: {
      create: mockWebMetricsCreate,
    },
    actor: {
      create: mockActorCreate,
      upsert: mockActorUpsert,
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

// Kysely mock (needed for analytics and other routes in app)
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

import type { RouteOptions } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { buildApp } from '../app.js';
import { webMetricsRoutes } from '../routes/webMetrics.js';

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
// POST /analytics/web-events tests
// ---------------------------------------------------------------------------

describe('POST /analytics/web-events', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: BASE_CONFIG });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts valid JSON body (application/json) and returns 202', async () => {
    mockWebMetricsCreate.mockResolvedValueOnce({ id: 'new-id' });

    const res = await app.inject({
      method: 'POST',
      url: '/analytics/web-events',
      headers: { 'content-type': 'application/json' },
      payload: validPayload(),
    });

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toEqual({ success: true });
    expect(mockWebMetricsCreate).toHaveBeenCalledOnce();
  });

  it('accepts text/plain content-type (sendBeacon format) and returns 202', async () => {
    mockWebMetricsCreate.mockResolvedValueOnce({ id: 'new-id-2' });

    const res = await app.inject({
      method: 'POST',
      url: '/analytics/web-events',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      payload: JSON.stringify(validPayload()),
    });

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toEqual({ success: true });
  });

  it('returns 400 VALIDATION_ERROR when text/plain body is not valid JSON', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/analytics/web-events',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      payload: 'this is not json {{',
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when Zod validation fails (queryCount: 0)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/analytics/web-events',
      headers: { 'content-type': 'application/json' },
      payload: validPayload({ queryCount: 0 }),
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for cross-field violation (successCount > queryCount)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/analytics/web-events',
      headers: { 'content-type': 'application/json' },
      payload: validPayload({ queryCount: 2, successCount: 5 }),
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 202 even when DB insert throws (fire-and-forget)', async () => {
    mockWebMetricsCreate.mockRejectedValueOnce(new Error('DB connection lost'));

    const res = await app.inject({
      method: 'POST',
      url: '/analytics/web-events',
      headers: { 'content-type': 'application/json' },
      payload: validPayload(),
    });

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toEqual({ success: true });
  });

  it('returns 202 with no X-Actor-Id header (actor middleware skipped)', async () => {
    mockActorCreate.mockClear();
    mockActorUpsert.mockClear();

    const res = await app.inject({
      method: 'POST',
      url: '/analytics/web-events',
      headers: { 'content-type': 'application/json' },
      payload: validPayload(),
    });

    expect(res.statusCode).toBe(202);
    // actorResolver must be skipped — no ghost actor created
    expect(mockActorCreate).not.toHaveBeenCalled();
    expect(mockActorUpsert).not.toHaveBeenCalled();
  });

  it('returns 202 with no auth header (not admin-only for POST)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/analytics/web-events',
      headers: { 'content-type': 'application/json' },
      // No X-API-Key
      payload: validPayload(),
    });

    expect(res.statusCode).toBe(202);
  });

  it('GET /analytics/web-events with no auth returns 401 (admin route not exempted for GET)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/analytics/web-events',
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 400 VALIDATION_ERROR for malformed application/json body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/analytics/web-events',
      headers: { 'content-type': 'application/json' },
      payload: 'not json{{',
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('route config has rateLimit options (max: 10, timeWindow: 1 minute)', async () => {
    // Use onRoute hook to capture route config before route registration completes.
    // Rate limiting is disabled in NODE_ENV=test — we verify config metadata only.
    let capturedConfig: { rateLimit?: { max?: number; timeWindow?: string } } | undefined;

    const miniApp = Fastify({ logger: false });
    miniApp.setValidatorCompiler(validatorCompiler);
    miniApp.setSerializerCompiler(serializerCompiler);
    miniApp.addHook('onRoute', (routeOptions: RouteOptions) => {
      if (
        routeOptions.url === '/analytics/web-events' &&
        routeOptions.method === 'POST'
      ) {
        capturedConfig = routeOptions.config as typeof capturedConfig;
      }
    });
    await miniApp.register(webMetricsRoutes, {
      db: {} as Parameters<typeof webMetricsRoutes>[1]['db'],
      prisma: {} as Parameters<typeof webMetricsRoutes>[1]['prisma'],
    });
    await miniApp.ready();
    await miniApp.close();

    expect(capturedConfig).toBeDefined();
    expect(capturedConfig?.rateLimit).toBeDefined();
    expect(capturedConfig?.rateLimit?.max).toBe(10);
    expect(capturedConfig?.rateLimit?.timeWindow).toBe('1 minute');
  });
});
