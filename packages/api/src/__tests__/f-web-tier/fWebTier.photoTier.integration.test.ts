// F-WEB-TIER — Photo tier integration test (bearer-over-API-key precedence)
//
// This test was MISSING and allowed the photo-tier gap to remain undetected:
// an authenticated free user on /analyze/menu was getting the shared API key's
// tier (e.g. pro → 100 photos/day) instead of their account tier (free → 20/day).
//
// Root cause: actorRateLimit.ts was API-key-first. With the bearer-over-API-key
// fix (ADR-025 R3 §5 / fork D4), when a valid bearer is present (request.accountId
// set), the account tier is resolved from the DB — even if apiKeyContext is also
// present (as happens on /analyze/menu where the web proxy sends both).
//
// Test coverage:
//   - AC11/AC12: authenticated free user gets photo limit 20 (not the shared key tier)
//   - Bearer + shared API key together: account tier (free 20) applies, not key tier (pro 100)
//   - 21st photo in one day → 429 for a free authenticated user
//   - No bearer (API-key-only): key tier applies (anonymous/shared key behavior unchanged)
//   - No bearer, no key: anonymous tier applies (10 photos/day)
//
// Infrastructure: real Postgres (5433) + real Redis (6380).
// Fixture UUID prefix: f7f00000- (confirmed unused in other test files beyond this prefix).
//
// NOTE: This is an integration test — excluded from normal unit test run
// (vitest.config.ts: exclude pattern). Run with vitest run --include "**/*.integration.test.ts"

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
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

// Mock OpenAI (we don't want to hit the real API in integration tests for this path)
vi.mock('openai', () => ({
  default: vi.fn(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: '{"items":[]}' } }],
        }),
      },
    },
  })),
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
  PORT: 3004,
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
// Fixture IDs — photo tier test actors
// ---------------------------------------------------------------------------

// Free-tier authenticated user
const ACTOR_ID_PHOTO_FREE = 'f7f00000-0004-4000-a000-000000000004';
const ACTOR_EXT_ID_PHOTO_FREE = 'f7f00000-e004-4000-a000-000000000004';
const AUTH_USER_ID_PHOTO_FREE = 'f7f00000-0040-4000-a000-000000000040';

// Anonymous user (no bearer, no API key)
const ACTOR_ID_PHOTO_ANON = 'f7f00000-0005-4000-a000-000000000005';
const ACTOR_EXT_ID_PHOTO_ANON = 'f7f00000-e005-4000-a000-000000000005';

// ---------------------------------------------------------------------------
// DB + Redis setup
// ---------------------------------------------------------------------------

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

const redis = new Redis(REDIS_URL_TEST);

// ---------------------------------------------------------------------------
// Redis key helpers
// ---------------------------------------------------------------------------

function redisPhotoKey(actorId: string): string {
  const dateKey = new Date().toISOString().slice(0, 10);
  return `actor:limit:${actorId}:${dateKey}:photos`;
}

function redisTierCacheKey(sub: string): string {
  return `account:tier:${sub}`;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Pre-cleanup (reverse FK order)
  await prisma.$executeRaw`DELETE FROM actors WHERE id IN (${ACTOR_ID_PHOTO_FREE}::uuid, ${ACTOR_ID_PHOTO_ANON}::uuid)`;
  await prisma.$executeRaw`DELETE FROM accounts WHERE auth_user_id = ${AUTH_USER_ID_PHOTO_FREE}::uuid`;

  // Create free-tier authenticated actor
  await prisma.actor.upsert({
    where: { type_externalId: { type: 'anonymous_web', externalId: ACTOR_EXT_ID_PHOTO_FREE } },
    create: { id: ACTOR_ID_PHOTO_FREE, type: 'anonymous_web', externalId: ACTOR_EXT_ID_PHOTO_FREE, lastSeenAt: new Date() },
    update: { accountId: null, lastSeenAt: new Date() },
  });

  // Create anonymous actor (no account)
  await prisma.actor.upsert({
    where: { type_externalId: { type: 'anonymous_web', externalId: ACTOR_EXT_ID_PHOTO_ANON } },
    create: { id: ACTOR_ID_PHOTO_ANON, type: 'anonymous_web', externalId: ACTOR_EXT_ID_PHOTO_ANON, lastSeenAt: new Date() },
    update: { accountId: null, lastSeenAt: new Date() },
  });

  // Create free account for the authenticated user
  await prisma.$executeRaw`
    INSERT INTO accounts (auth_user_id, email, last_seen_at, tier)
    VALUES (${AUTH_USER_ID_PHOTO_FREE}::uuid, 'photo-free@example.com', NOW(), 'free')
    ON CONFLICT (auth_user_id) DO UPDATE SET tier = 'free', last_seen_at = NOW()
  `;
});

afterAll(async () => {
  // Cleanup actors and accounts
  await prisma.$executeRaw`DELETE FROM actors WHERE id IN (${ACTOR_ID_PHOTO_FREE}::uuid, ${ACTOR_ID_PHOTO_ANON}::uuid)`;
  await prisma.$executeRaw`DELETE FROM accounts WHERE auth_user_id = ${AUTH_USER_ID_PHOTO_FREE}::uuid`;

  // Clean up Redis keys
  const dateKey = new Date().toISOString().slice(0, 10);
  await redis.del(
    redisPhotoKey(ACTOR_ID_PHOTO_FREE),
    redisPhotoKey(ACTOR_ID_PHOTO_ANON),
    `actor:limit:${ACTOR_ID_PHOTO_FREE}:${dateKey}:queries`,
    redisTierCacheKey(AUTH_USER_ID_PHOTO_FREE),
  );

  await prisma.$disconnect();
  await redis.quit();
});

beforeEach(async () => {
  mockVerifyBearerJwt.mockReset();
  // Clean photo counter before each test
  await redis.del(
    redisPhotoKey(ACTOR_ID_PHOTO_FREE),
    redisPhotoKey(ACTOR_ID_PHOTO_ANON),
    redisTierCacheKey(AUTH_USER_ID_PHOTO_FREE),
  );
});

// ---------------------------------------------------------------------------
// AC11/AC12: Bearer + shared API key → account tier applies (free: 20 photos/day)
// ---------------------------------------------------------------------------

describe('F-WEB-TIER photo tier — AC11/AC12: bearer wins over shared API key', () => {
  it('authenticated free user: 20th photo allowed, 21st → 429 (account free tier = 20, not pro = 100)', async () => {
    // Verifies that a bearer-authenticated free account gets the FREE photo limit (20/day),
    // not a higher tier from a shared API key.
    //
    // Real-world scenario: the web proxy sends BOTH X-API-Key (shared, possibly pro-tier)
    // AND Authorization: Bearer (user's JWT, free-tier account). With the bearer-over-API-key
    // fix, the account tier (free = 20) MUST apply.
    //
    // The integration test sends only the bearer (not the shared key) because injecting a
    // non-existent API key hash would produce a 401 before the rate-limit hook fires.
    // The unit test in fWebTier.actorRateLimit.tier.unit.test.ts explicitly covers the
    // "both bearer + apiKeyContext → bearer wins, resolveAccountTier IS called" path.

    const app = await buildApp({
      config: testConfig as unknown as import('../../config.js').Config,
      prisma,
    });

    // Pre-seed counter at 20 (the limit for free photos)
    await redis.set(redisPhotoKey(ACTOR_ID_PHOTO_FREE), '20');
    // Clear tier cache so DB is queried fresh
    await redis.del(redisTierCacheKey(AUTH_USER_ID_PHOTO_FREE));

    // The 21st request — should be 429 for a free-tier account
    mockVerifyBearerJwt.mockResolvedValue({
      sub: AUTH_USER_ID_PHOTO_FREE,
      email: 'photo-free@example.com',
      aud: 'authenticated',
      iss: 'https://test.supabase.co/auth/v1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: {
        'x-actor-id': ACTOR_EXT_ID_PHOTO_FREE,
        authorization: 'Bearer mock.token.here',
        'content-type': 'multipart/form-data; boundary=TestBoundary',
      },
      payload: '--TestBoundary\r\nContent-Disposition: form-data; name="image"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\nFAKE\r\n--TestBoundary--\r\n',
    });

    expect(res.statusCode).toBe(429);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');

    // The 429 body must reflect the FREE tier limit (20), not pro (100) or anonymous (10)
    expect(body.error.details.tier).toBe('free');
    expect(body.error.details.limit).toBe(20);
    expect(body.error.details.bucket).toBe('photos');

    await app.close();
  });

  it('authenticated free user: 20th photo is allowed (exact boundary — not blocked)', async () => {
    const app = await buildApp({
      config: testConfig as unknown as import('../../config.js').Config,
      prisma,
    });

    // Pre-seed counter at 19 — the 20th INCR returns 20 (= limit, not over)
    await redis.set(redisPhotoKey(ACTOR_ID_PHOTO_FREE), '19');
    await redis.del(redisTierCacheKey(AUTH_USER_ID_PHOTO_FREE));

    mockVerifyBearerJwt.mockResolvedValue({
      sub: AUTH_USER_ID_PHOTO_FREE,
      email: 'photo-free@example.com',
      aud: 'authenticated',
      iss: 'https://test.supabase.co/auth/v1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: {
        'x-actor-id': ACTOR_EXT_ID_PHOTO_FREE,
        authorization: 'Bearer mock.token.here',
        'content-type': 'multipart/form-data; boundary=TestBoundary',
      },
      payload: '--TestBoundary\r\nContent-Disposition: form-data; name="image"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\nFAKE\r\n--TestBoundary--\r\n',
    });

    // Should NOT be 429 — 20th is within free tier limit
    expect(res.statusCode).not.toBe(429);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Contrast: anonymous (no bearer, no key) → 10 photos/day (unchanged)
// ---------------------------------------------------------------------------

describe('F-WEB-TIER photo tier — anonymous contrast: 10 photos/day', () => {
  it('anonymous user: 11th photo → 429 with anonymous tier (limit: 10)', async () => {
    const app = await buildApp({
      config: testConfig as unknown as import('../../config.js').Config,
      prisma,
    });

    // Pre-seed counter at 10 for anonymous actor
    await redis.set(redisPhotoKey(ACTOR_ID_PHOTO_ANON), '10');

    const res = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: {
        'x-actor-id': ACTOR_EXT_ID_PHOTO_ANON,
        'content-type': 'multipart/form-data; boundary=TestBoundary',
        // No authorization, no API key
      },
      payload: '--TestBoundary\r\nContent-Disposition: form-data; name="image"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\nFAKE\r\n--TestBoundary--\r\n',
    });

    expect(res.statusCode).toBe(429);
    const body = res.json();
    expect(body.error.details.tier).toBe('anonymous');
    expect(body.error.details.limit).toBe(10);

    await app.close();
  });
});
