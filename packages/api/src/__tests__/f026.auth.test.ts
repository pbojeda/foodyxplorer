// Route-level tests for F026 auth middleware.
//
// Uses buildApp().inject() with mocked Prisma, Redis, and cache helpers.
// A test-only route GET /test/auth-context is registered after buildApp()
// to make request.apiKeyContext observable.
//
// Rate limiting is skipped in NODE_ENV=test — rate limit tier tests are
// handled via pure unit tests of the exported getRateLimitMax and
// getRateLimitKeyGenerator functions from rateLimit.ts.

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockCacheGet,
  mockCacheSet,
  mockBuildKey,
} = vi.hoisted(() => ({
  mockCacheGet: vi.fn(),
  mockCacheSet: vi.fn(),
  mockBuildKey: vi.fn((entity: string, id: string) => `fxp:${entity}:${id}`),
}));

vi.mock('../lib/cache.js', () => ({
  cacheGet: mockCacheGet,
  cacheSet: mockCacheSet,
  buildKey: mockBuildKey,
}));

const {
  mockApiFindUnique,
  mockExecuteRaw,
} = vi.hoisted(() => ({
  mockApiFindUnique: vi.fn(),
  mockExecuteRaw: vi.fn().mockResolvedValue(1),
}));

const {
  mockRestaurantFindMany,
  mockRestaurantCount,
  mockDishFindMany,
  mockDishCount,
} = vi.hoisted(() => ({
  mockRestaurantFindMany: vi.fn().mockResolvedValue([]),
  mockRestaurantCount: vi.fn().mockResolvedValue(0),
  mockDishFindMany: vi.fn().mockResolvedValue([]),
  mockDishCount: vi.fn().mockResolvedValue(0),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    apiKey: {
      findUnique: mockApiFindUnique,
    },
    $executeRaw: mockExecuteRaw,
    restaurant: {
      findMany: mockRestaurantFindMany,
      count: mockRestaurantCount,
    },
    dish: {
      findMany: mockDishFindMany,
      count: mockDishCount,
    },
  } as unknown as PrismaClient,
}));

// Mock redis for rate-limit and cache.ts
const { mockRedisGet, mockRedisSet } = vi.hoisted(() => ({
  mockRedisGet: vi.fn().mockResolvedValue(null),
  mockRedisSet: vi.fn().mockResolvedValue('OK'),
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  },
}));

// Mock Kysely (needed by buildApp imports)
const { _mockKyselyExecute, mockKyselyChainStubs } = vi.hoisted(() => {
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

  return {
    _mockKyselyExecute: execute,
    mockKyselyChainStubs: stub,
  };
});

vi.mock('../lib/kysely.js', () => ({
  getKysely: () => mockKyselyChainStubs,
  destroyKysely: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
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

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

const VALID_FREE_KEY_RAW = 'fxp_' + 'a'.repeat(32);
const VALID_PRO_KEY_RAW  = 'fxp_' + 'b'.repeat(32);
const REVOKED_KEY_RAW    = 'fxp_' + 'c'.repeat(32);
const EXPIRED_KEY_RAW    = 'fxp_' + 'd'.repeat(32);

const VALID_FREE_DB_ROW = {
  id: 'fd000000-0001-4000-a000-000000000001',
  keyHash: hashKey(VALID_FREE_KEY_RAW),
  keyPrefix: VALID_FREE_KEY_RAW.slice(0, 8),
  name: 'Test Free Key',
  tier: 'free' as const,
  isActive: true,
  expiresAt: null,
  lastUsedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const VALID_PRO_DB_ROW = {
  ...VALID_FREE_DB_ROW,
  id: 'fd000000-0002-4000-a000-000000000002',
  keyHash: hashKey(VALID_PRO_KEY_RAW),
  keyPrefix: VALID_PRO_KEY_RAW.slice(0, 8),
  name: 'Test Pro Key',
  tier: 'pro' as const,
};

const REVOKED_DB_ROW = {
  ...VALID_FREE_DB_ROW,
  id: 'fd000000-0003-4000-a000-000000000003',
  keyHash: hashKey(REVOKED_KEY_RAW),
  keyPrefix: REVOKED_KEY_RAW.slice(0, 8),
  name: 'Revoked Key',
  isActive: false,
};

const EXPIRED_DB_ROW = {
  ...VALID_FREE_DB_ROW,
  id: 'fd000000-0004-4000-a000-000000000004',
  keyHash: hashKey(EXPIRED_KEY_RAW),
  keyPrefix: EXPIRED_KEY_RAW.slice(0, 8),
  name: 'Expired Key',
  expiresAt: new Date('2020-01-01T00:00:00Z'), // past date
};

/** Build app with test-only /test/auth-context route */
async function buildTestApp(config: Config = BASE_CONFIG): Promise<FastifyInstance> {
  const app = await buildApp({ config });

  // Test-only route to inspect apiKeyContext
  app.get('/test/auth-context', (req, reply) => {
    void reply.send({ apiKeyContext: req.apiKeyContext ?? null });
  });

  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Anonymous access
// ---------------------------------------------------------------------------

describe('Anonymous access (no X-API-Key header)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    vi.resetAllMocks();
    mockExecuteRaw.mockResolvedValue(1);
    mockCacheGet.mockResolvedValue(null);
    mockBuildKey.mockImplementation((entity: string, id: string) => `fxp:${entity}:${id}`);
    mockRestaurantFindMany.mockResolvedValue([]);
    mockRestaurantCount.mockResolvedValue(0);
  });

  it('GET /restaurants with no key returns 200 and no auth error', async () => {
    const res = await app.inject({ method: 'GET', url: '/restaurants' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /health with no key returns 200 (always exempt)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('apiKeyContext is null for anonymous callers', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/auth-context' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { apiKeyContext: unknown };
    expect(body.apiKeyContext).toBeNull();
  });

  it('query param apiKey is NOT treated as auth (header-only enforcement)', async () => {
    mockApiFindUnique.mockResolvedValue(null); // key not in DB anyway
    const res = await app.inject({
      method: 'GET',
      url: `/restaurants?apiKey=${VALID_FREE_KEY_RAW}`,
    });
    // Should succeed as anonymous (200), not fail with 401
    expect(res.statusCode).toBe(200);
    // No DB lookup should happen since no header was provided
    expect(mockApiFindUnique).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Valid key scenarios
// ---------------------------------------------------------------------------

describe('Valid API key scenarios', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    vi.resetAllMocks();
    mockExecuteRaw.mockResolvedValue(1);
    mockCacheGet.mockResolvedValue(null);
    mockCacheSet.mockResolvedValue(undefined);
    mockBuildKey.mockImplementation((entity: string, id: string) => `fxp:${entity}:${id}`);
    mockRestaurantFindMany.mockResolvedValue([]);
    mockRestaurantCount.mockResolvedValue(0);
  });

  it('valid free key → 200 OK', async () => {
    mockApiFindUnique.mockResolvedValue(VALID_FREE_DB_ROW);

    const res = await app.inject({
      method: 'GET',
      url: '/restaurants',
      headers: { 'x-api-key': VALID_FREE_KEY_RAW },
    });

    expect(res.statusCode).toBe(200);
  });

  it('valid free key → apiKeyContext.tier === "free"', async () => {
    mockApiFindUnique.mockResolvedValue(VALID_FREE_DB_ROW);

    const res = await app.inject({
      method: 'GET',
      url: '/test/auth-context',
      headers: { 'x-api-key': VALID_FREE_KEY_RAW },
    });

    const body = JSON.parse(res.body) as { apiKeyContext: { tier: string; keyId: string } | null };
    expect(body.apiKeyContext?.tier).toBe('free');
    expect(body.apiKeyContext?.keyId).toBe(VALID_FREE_DB_ROW.id);
  });

  it('valid pro key → apiKeyContext.tier === "pro"', async () => {
    mockApiFindUnique.mockResolvedValue(VALID_PRO_DB_ROW);

    const res = await app.inject({
      method: 'GET',
      url: '/test/auth-context',
      headers: { 'x-api-key': VALID_PRO_KEY_RAW },
    });

    const body = JSON.parse(res.body) as { apiKeyContext: { tier: string } | null };
    expect(body.apiKeyContext?.tier).toBe('pro');
  });

  it('valid key with expiresAt in the future → 200 OK', async () => {
    const futureRow = { ...VALID_FREE_DB_ROW, expiresAt: new Date('2099-01-01T00:00:00Z') };
    mockApiFindUnique.mockResolvedValue(futureRow);

    const res = await app.inject({
      method: 'GET',
      url: '/restaurants',
      headers: { 'x-api-key': VALID_FREE_KEY_RAW },
    });

    expect(res.statusCode).toBe(200);
  });

  it('Redis cache HIT → prisma.apiKey.findUnique NOT called', async () => {
    // Simulate cache hit: return serialized context
    mockCacheGet.mockResolvedValue({
      keyId: VALID_FREE_DB_ROW.id,
      tier: 'free',
      isActive: true,
      expiresAt: null,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/test/auth-context',
      headers: { 'x-api-key': VALID_FREE_KEY_RAW },
    });

    expect(res.statusCode).toBe(200);
    expect(mockApiFindUnique).not.toHaveBeenCalled();
    const body = JSON.parse(res.body) as { apiKeyContext: { tier: string } | null };
    expect(body.apiKeyContext?.tier).toBe('free');
  });

  it('Redis cache MISS → DB queried, result cached', async () => {
    mockCacheGet.mockResolvedValue(null);
    mockApiFindUnique.mockResolvedValue(VALID_FREE_DB_ROW);

    await app.inject({
      method: 'GET',
      url: '/test/auth-context',
      headers: { 'x-api-key': VALID_FREE_KEY_RAW },
    });

    expect(mockApiFindUnique).toHaveBeenCalledOnce();
    expect(mockCacheSet).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Invalid key scenarios
// ---------------------------------------------------------------------------

describe('Invalid API key scenarios', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    vi.resetAllMocks();
    mockExecuteRaw.mockResolvedValue(1);
    mockCacheGet.mockResolvedValue(null);
    mockCacheSet.mockResolvedValue(undefined);
    mockBuildKey.mockImplementation((entity: string, id: string) => `fxp:${entity}:${id}`);
    mockRestaurantFindMany.mockResolvedValue([]);
    mockRestaurantCount.mockResolvedValue(0);
  });

  it('key not found in DB → 401 UNAUTHORIZED', async () => {
    mockApiFindUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/restaurants',
      headers: { 'x-api-key': 'fxp_unknownkey12345678901234567890' },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body) as { success: boolean; error: { code: string; message: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('Invalid or expired API key');
  });

  it('key found but isActive=false → 403 FORBIDDEN', async () => {
    mockApiFindUnique.mockResolvedValue(REVOKED_DB_ROW);

    const res = await app.inject({
      method: 'GET',
      url: '/restaurants',
      headers: { 'x-api-key': REVOKED_KEY_RAW },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toBe('API key has been revoked');
  });

  it('key found but expiresAt is in the past → 401 UNAUTHORIZED', async () => {
    mockApiFindUnique.mockResolvedValue(EXPIRED_DB_ROW);

    const res = await app.inject({
      method: 'GET',
      url: '/restaurants',
      headers: { 'x-api-key': EXPIRED_KEY_RAW },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('key provided but DB throws → 500 DB_UNAVAILABLE (fail-closed)', async () => {
    mockApiFindUnique.mockRejectedValue(new Error('Connection timeout'));

    const res = await app.inject({
      method: 'GET',
      url: '/restaurants',
      headers: { 'x-api-key': 'fxp_' + 'e'.repeat(32) },
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body) as { error: { code: string } };
    expect(body.error.code).toBe('DB_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// Admin route auth
// ---------------------------------------------------------------------------

describe('Admin route auth (with ADMIN_API_KEY configured)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp(BASE_CONFIG);
  });

  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    vi.resetAllMocks();
    mockExecuteRaw.mockResolvedValue(1);
    mockCacheGet.mockResolvedValue(null);
    mockBuildKey.mockImplementation((entity: string, id: string) => `fxp:${entity}:${id}`);
    mockRestaurantFindMany.mockResolvedValue([]);
    mockRestaurantCount.mockResolvedValue(0);
  });

  it('POST /ingest/pdf with correct ADMIN_API_KEY → not 401 (passes auth, hits route)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ingest/pdf',
      headers: { 'x-api-key': ADMIN_API_KEY },
      payload: {},
    });

    // Auth passes — route handler will return 400 for bad input, not 401
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it('POST /ingest/pdf with no X-API-Key → 401 UNAUTHORIZED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ingest/pdf',
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('Admin API key required');
  });

  it('POST /ingest/pdf with wrong key → 401 UNAUTHORIZED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ingest/pdf',
      headers: { 'x-api-key': 'wrongkey' + 'z'.repeat(24) },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
  });

  it('admin route with DB-resident key (not ADMIN_API_KEY) → 401 (not DB lookup)', async () => {
    // The auth hook detects admin routes and calls validateAdminKey,
    // NOT prisma.apiKey.findUnique. So even a valid DB key fails.
    mockApiFindUnique.mockResolvedValue(VALID_FREE_DB_ROW);

    const res = await app.inject({
      method: 'POST',
      url: '/ingest/url',
      headers: { 'x-api-key': VALID_FREE_KEY_RAW },
      payload: { url: 'https://example.com' },
    });

    // Should fail admin auth (key is not ADMIN_API_KEY)
    expect(res.statusCode).toBe(401);
    // DB should NOT have been queried (admin route uses env var, not DB)
    expect(mockApiFindUnique).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Admin route auth — ADMIN_API_KEY absent in test env (skip auth)
// ---------------------------------------------------------------------------

describe('Admin route auth — ADMIN_API_KEY absent in NODE_ENV=test', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const configWithoutAdminKey: Config = {
      ...BASE_CONFIG,
      ADMIN_API_KEY: undefined,
    };
    app = await buildTestApp(configWithoutAdminKey);
  });

  afterAll(async () => { await app.close(); });

  it('POST /ingest/pdf with no key passes through (admin auth skipped in test env)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ingest/pdf',
      payload: {},
    });

    // Auth is skipped when ADMIN_API_KEY absent in test — route handler responds
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Admin route auth — ADMIN_API_KEY absent in non-test env (fail-closed)
// Tests via a minimal Fastify app with only auth middleware + error handler
// (avoids rate-limit Redis dependency in test env)
// ---------------------------------------------------------------------------

describe('Admin route auth — ADMIN_API_KEY absent in non-test env (fail-closed)', () => {
  it('admin route → 401 "Admin API key not configured" when ADMIN_API_KEY absent and NODE_ENV=development', async () => {
    const Fastify = (await import('fastify')).default;
    const { registerErrorHandler } = await import('../errors/errorHandler.js');
    const { registerAuthMiddleware: registerAuth } = await import('../plugins/auth.js');
    const { prisma: mockPrisma } = await import('../lib/prisma.js');

    const configDev: Config = {
      ...BASE_CONFIG,
      NODE_ENV: 'development',
      ADMIN_API_KEY: undefined,
    };

    const miniApp = Fastify({ logger: false });
    await registerAuth(miniApp, { prisma: mockPrisma, config: configDev });
    registerErrorHandler(miniApp);
    // Register a stub admin-prefixed route
    miniApp.post('/ingest/pdf', async () => ({ ok: true }));
    await miniApp.ready();

    const res = await miniApp.inject({ method: 'POST', url: '/ingest/pdf', payload: {} });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body) as { error: { message: string } };
    expect(body.error.message).toBe('Admin API key not configured');

    await miniApp.close();
  });
});

// ---------------------------------------------------------------------------
// Rate limit pure-function unit tests
// ---------------------------------------------------------------------------

import { getRateLimitMax, getRateLimitKeyGenerator } from '../plugins/rateLimit.js';
import type { ApiKeyContext } from '@foodxplorer/shared';

describe('getRateLimitMax — tier → limit mapping', () => {
  it('returns 30 for anonymous callers (no apiKeyContext)', () => {
    const req = { apiKeyContext: undefined } as { apiKeyContext?: ApiKeyContext };
    expect(getRateLimitMax(req)).toBe(30);
  });

  it('returns 100 for free tier', () => {
    const req = {
      apiKeyContext: { keyId: 'fd000000-0001-4000-a000-000000000001', tier: 'free' as const },
    };
    expect(getRateLimitMax(req)).toBe(100);
  });

  it('returns 1000 for pro tier', () => {
    const req = {
      apiKeyContext: { keyId: 'fd000000-0002-4000-a000-000000000002', tier: 'pro' as const },
    };
    expect(getRateLimitMax(req)).toBe(1000);
  });
});

describe('getRateLimitKeyGenerator — context → Redis key', () => {
  it('returns "ip:<ip>" for anonymous callers', () => {
    const req = { apiKeyContext: undefined, ip: '1.2.3.4' } as {
      apiKeyContext?: ApiKeyContext;
      ip: string;
    };
    expect(getRateLimitKeyGenerator(req)).toBe('ip:1.2.3.4');
  });

  it('returns "apiKey:<keyId>" for authenticated callers', () => {
    const keyId = 'fd000000-0001-4000-a000-000000000001';
    const req = {
      apiKeyContext: { keyId, tier: 'free' as const },
      ip: '1.2.3.4',
    };
    expect(getRateLimitKeyGenerator(req)).toBe(`apiKey:${keyId}`);
  });

  it('uses key ID not IP for pro tier (no cross-contamination)', () => {
    const keyId = 'fd000000-0002-4000-a000-000000000002';
    const req = {
      apiKeyContext: { keyId, tier: 'pro' as const },
      ip: '5.6.7.8',
    };
    expect(getRateLimitKeyGenerator(req)).toBe(`apiKey:${keyId}`);
    expect(getRateLimitKeyGenerator(req)).not.toContain('5.6.7.8');
  });
});
