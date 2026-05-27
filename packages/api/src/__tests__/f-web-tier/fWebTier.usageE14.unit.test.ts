// F-WEB-TIER — E14 direct unit test: GET /me/usage when Redis GET throws
//
// Verifies that the usage endpoint returns 200 with used: 0 (NOT 500)
// when redis.get rejects for the counter keys.
//
// The route already has `.catch(() => null)` at auth.ts l.453, but no
// unit test isolated that path until this test was added (code-review #3).
//
// Why unit (not integration): mocking a real Redis instance to throw requires
// either stopping the server mid-test or injecting the Redis client, which is
// much easier to do at the route-function level with a mocked instance.
// This test builds a real Fastify app with a mock Redis that rejects on get().

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before dynamic imports
// ---------------------------------------------------------------------------

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithOtp: vi.fn(),
      admin: { signOut: vi.fn() },
    },
  })),
}));

const mockVerifyBearerJwt = vi.fn();

vi.mock('../../plugins/authBearer.js', () => ({
  verifyBearerJwt: mockVerifyBearerJwt,
}));

// Import after mocks
const { buildApp } = await import('../../app.js');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const REDIS_URL_TEST = 'redis://localhost:6380';

const testConfig = {
  NODE_ENV: 'test' as const,
  PORT: 3003,
  DATABASE_URL: DATABASE_URL_TEST,
  DATABASE_URL_TEST,
  LOG_LEVEL: 'error' as const,
  REDIS_URL: REDIS_URL_TEST,
  OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
  OPENAI_EMBEDDING_BATCH_SIZE: 100,
  OPENAI_EMBEDDING_RPM: 3000,
  OPENAI_CHAT_MAX_TOKENS: 512,
  VISION_MODEL: 'gpt-4o-mini' as const,
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'a'.repeat(100),
  SUPABASE_JWKS_URL: 'https://test.supabase.co/auth/v1/.well-known/jwks.json',
};

// ---------------------------------------------------------------------------
// Fixture IDs
// ---------------------------------------------------------------------------

const ACTOR_ID_E14 = 'f7f00000-0003-4000-a000-000000000003';
const ACTOR_EXT_ID_E14 = 'f7f00000-e003-4000-a000-000000000003';
const AUTH_USER_ID_E14 = 'f7f00000-0030-4000-a000-000000000030';

// ---------------------------------------------------------------------------
// DB + Redis setup (real DB for actor/account; mock Redis injected into app)
// ---------------------------------------------------------------------------

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

const redis = new Redis(REDIS_URL_TEST);

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Pre-cleanup
  await prisma.$executeRaw`DELETE FROM actors WHERE id = ${ACTOR_ID_E14}::uuid`;
  await prisma.$executeRaw`DELETE FROM accounts WHERE auth_user_id = ${AUTH_USER_ID_E14}::uuid`;

  // Create fixture actor
  await prisma.actor.upsert({
    where: { type_externalId: { type: 'anonymous_web', externalId: ACTOR_EXT_ID_E14 } },
    create: { id: ACTOR_ID_E14, type: 'anonymous_web', externalId: ACTOR_EXT_ID_E14, lastSeenAt: new Date() },
    update: { accountId: null, lastSeenAt: new Date() },
  });

  // Create free account
  await prisma.$executeRaw`
    INSERT INTO accounts (auth_user_id, email, last_seen_at, tier)
    VALUES (${AUTH_USER_ID_E14}::uuid, 'e14@example.com', NOW(), 'free')
    ON CONFLICT (auth_user_id) DO UPDATE SET tier = 'free', last_seen_at = NOW()
  `;

  // Seed the tier cache in real Redis so resolveAccountTier doesn't have to hit DB
  await redis.set(`account:tier:${AUTH_USER_ID_E14}`, 'free', 'EX', 60);

  // Cleanup after all
  return async () => {
    await prisma.$executeRaw`DELETE FROM actors WHERE id = ${ACTOR_ID_E14}::uuid`;
    await prisma.$executeRaw`DELETE FROM accounts WHERE auth_user_id = ${AUTH_USER_ID_E14}::uuid`;
    await redis.del(`account:tier:${AUTH_USER_ID_E14}`);
    await prisma.$disconnect();
    await redis.quit();
  };
});

// ---------------------------------------------------------------------------
// E14: Redis GET throws → 200 with used: 0 (no 500)
// ---------------------------------------------------------------------------

describe('F-WEB-TIER GET /me/usage — E14 direct: Redis GET throws → used: 0, no 500', () => {
  it('returns 200 with used: 0 for all buckets when redis.get rejects', async () => {
    // Build a mock Redis where:
    // - get() always rejects (simulates Redis connection error on counter reads)
    // - set() works (used by resolveAccountTier cache write — we bypass it by seeding real redis)
    // We use a proxy-based approach: delegate everything except get to real redis
    const mockRedis = {
      // Reject on counter gets — this is the E14 failure path
      get: vi.fn().mockRejectedValue(new Error('Redis connection refused (E14 test)')),
      // These must succeed for rate-limiting hooks + tier cache
      set: vi.fn().mockResolvedValue('OK'),
      incr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
      del: vi.fn().mockResolvedValue(1),
      quit: vi.fn().mockResolvedValue('OK'),
      disconnect: vi.fn(),
      on: vi.fn(),
      // Pipeline/multi not used in hot path — stubs for safety
      pipeline: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };

    // resolveAccountTier calls redis.get — we need it to return 'free' from cache.
    // Override: first get call (tier cache) returns 'free', subsequent calls (counters) reject.
    let getCallCount = 0;
    mockRedis.get.mockImplementation((_key: string) => {
      getCallCount++;
      if (getCallCount === 1) {
        // First call is the tier cache lookup → return cached 'free'
        return Promise.resolve('free');
      }
      // Subsequent calls are counter reads → reject (E14 scenario)
      return Promise.reject(new Error('Redis connection refused (E14 test)'));
    });

    mockVerifyBearerJwt.mockResolvedValue({
      sub: AUTH_USER_ID_E14,
      email: 'e14@example.com',
      aud: 'authenticated',
      iss: 'https://test.supabase.co/auth/v1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const app = await buildApp({
      config: testConfig as unknown as import('../../config.js').Config,
      prisma,
      redis: mockRedis as never,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me/usage',
      headers: {
        authorization: 'Bearer valid.mock.token',
        'x-actor-id': ACTOR_EXT_ID_E14,
      },
    });

    // Must return 200 — E14: Redis GET failure is non-fatal, degrades to used: 0
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);

    // All counters degrade to 0 (caught .catch(() => null) in route)
    expect(body.data.buckets.queries.used).toBe(0);
    expect(body.data.buckets.photos.used).toBe(0);
    expect(body.data.buckets.voice.used).toBe(0);

    // Limits should still be correct (from tier, not redis)
    expect(body.data.tier).toBe('free');
    expect(body.data.buckets.queries.limit).toBe(100);
    expect(body.data.buckets.photos.limit).toBe(20);
    expect(body.data.buckets.voice.limit).toBe(30);

    await app.close();
  });
});
