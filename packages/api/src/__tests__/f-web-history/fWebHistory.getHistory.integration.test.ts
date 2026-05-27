// F-WEB-HISTORY — GET /history integration tests (AC8–AC16, AC65)
//
// Uses real PG test DB (:5433) + real Redis (:6380).
// Fixture UUID prefix: f8000000- (unique to F-WEB-HISTORY).
//
// NOTE: verifyBearerJwt is called TWICE per bearer request:
//   1. By actorResolver plugin (sets request.accountId, resolves actorId)
//   2. By the route handler itself (same JWT verification pattern as /me/usage)
// Therefore, tests use mockResolvedValue (not mockResolvedValueOnce) so that
// both calls succeed with the same payload. Tests that need a single-call rejection
// (AC9) use mockRejectedValue which also covers all calls.
//
// AC8:  no bearer → 401
// AC9:  expired token → 401
// AC10: valid bearer but no accounts row → 200 { entries: [], nextCursor: null }
//       and assert account count is still 0
// AC11: 15 history rows inserted → GET with limit=10 → 10 entries, nextCursor non-null
// AC12: GET with nextCursor from AC11 → 5 entries, nextCursor: null
// AC13: limit=51 → 400 VALIDATION_ERROR
// AC14: cursor=malformed → 400 INVALID_CURSOR
// AC15: two accounts → each only sees their own rows
// AC16: GET /history does not consume any rate-limit bucket
// AC65: DB error in resolveAccountIdFromSub → 500 (not 200 [])

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
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
  PORT: 3002,
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
// Fixture IDs — f8000000- prefix
// ---------------------------------------------------------------------------

// Account A (primary test account)
const AUTH_USER_ID_A = 'f8000000-0001-4000-a000-000000000001';
const ACCOUNT_ID_A = 'f8000000-0002-4000-a000-000000000002';

// Account B (isolation test)
const AUTH_USER_ID_B = 'f8000000-0003-4000-a000-000000000003';
const ACCOUNT_ID_B = 'f8000000-0004-4000-a000-000000000004';

// Auth user with NO account row (AC10) — use a UUID that won't collide with fixture accounts
const AUTH_USER_ID_NO_ACCOUNT = 'f8000000-0099-4000-a000-000000000099';

// Actor for AC16 rate-limit test
const ACTOR_ID_A = 'f8000000-0006-4000-a000-000000000006';
const ACTOR_EXT_ID_A = 'f8000000-e006-4000-a000-000000000006';

// ---------------------------------------------------------------------------
// DB + Redis
// ---------------------------------------------------------------------------

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

const redis = new Redis(REDIS_URL_TEST);

// Minimal valid result_jsonb
const RESULT_JSONB = JSON.stringify({
  intent: 'text_too_long',
  actorId: '00000000-0000-0000-0000-000000000001',
  activeContext: null,
});

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Pre-cleanup (reverse FK order)
  await prisma.$executeRaw`DELETE FROM search_history WHERE account_id IN (${ACCOUNT_ID_A}::uuid, ${ACCOUNT_ID_B}::uuid)`;
  await prisma.$executeRaw`DELETE FROM actors WHERE id = ${ACTOR_ID_A}::uuid`;
  await prisma.$executeRaw`DELETE FROM accounts WHERE id IN (${ACCOUNT_ID_A}::uuid, ${ACCOUNT_ID_B}::uuid)`;
  await prisma.$executeRaw`DELETE FROM accounts WHERE auth_user_id = ${AUTH_USER_ID_NO_ACCOUNT}::uuid`;

  // Create account A (with fixed id)
  await prisma.$executeRaw`
    INSERT INTO accounts (id, auth_user_id, email)
    VALUES (${ACCOUNT_ID_A}::uuid, ${AUTH_USER_ID_A}::uuid, 'history-a@example.com')
    ON CONFLICT (id) DO NOTHING
  `;
  // Create account B
  await prisma.$executeRaw`
    INSERT INTO accounts (id, auth_user_id, email)
    VALUES (${ACCOUNT_ID_B}::uuid, ${AUTH_USER_ID_B}::uuid, 'history-b@example.com')
    ON CONFLICT (id) DO NOTHING
  `;
  // Create actor for AC16
  await prisma.actor.upsert({
    where: { type_externalId: { type: 'anonymous_web', externalId: ACTOR_EXT_ID_A } },
    create: { id: ACTOR_ID_A, type: 'anonymous_web', externalId: ACTOR_EXT_ID_A, lastSeenAt: new Date() },
    update: { lastSeenAt: new Date() },
  });
});

afterAll(async () => {
  // Teardown reverse FK order
  await prisma.$executeRaw`DELETE FROM search_history WHERE account_id IN (${ACCOUNT_ID_A}::uuid, ${ACCOUNT_ID_B}::uuid)`;
  await prisma.$executeRaw`DELETE FROM actors WHERE id = ${ACTOR_ID_A}::uuid`;
  await prisma.$executeRaw`DELETE FROM accounts WHERE id IN (${ACCOUNT_ID_A}::uuid, ${ACCOUNT_ID_B}::uuid)`;
  await prisma.$executeRaw`DELETE FROM accounts WHERE auth_user_id = ${AUTH_USER_ID_NO_ACCOUNT}::uuid`;
  await prisma.$disconnect();
  await redis.quit();
});

beforeEach(() => {
  mockVerifyBearerJwt.mockReset();
});

// ---------------------------------------------------------------------------
// Shared app builder
// ---------------------------------------------------------------------------

async function getApp() {
  return buildApp({
    config: testConfig as unknown as import('../../config.js').Config,
    prisma,
    redis,
  });
}

// ---------------------------------------------------------------------------
// AC8: No bearer → 401
// ---------------------------------------------------------------------------

describe('AC8: no bearer → 401', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/history' });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});

// ---------------------------------------------------------------------------
// AC9: Expired token → 401
// ---------------------------------------------------------------------------

describe('AC9: expired token → 401', () => {
  it('returns 401 when verifyBearerJwt rejects with TOKEN_EXPIRED', async () => {
    // mockRejectedValue (not Once) — both actorResolver and route handler calls reject
    mockVerifyBearerJwt.mockRejectedValue(
      Object.assign(new Error('Token expired'), { code: 'TOKEN_EXPIRED' }),
    );

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/history',
      headers: { authorization: 'Bearer expired.token.here' },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.code).toBe('TOKEN_EXPIRED');
  });
});

// ---------------------------------------------------------------------------
// AC10: Valid bearer but no accounts row → 200 empty (no write)
// ---------------------------------------------------------------------------

describe('AC10: no accounts row → 200 empty, no account created', () => {
  it('returns empty list without creating an account row', async () => {
    // mockResolvedValue: both actorResolver + route handler calls succeed
    mockVerifyBearerJwt.mockResolvedValue({
      sub: AUTH_USER_ID_NO_ACCOUNT,
      email: 'noexist@example.com',
    });

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/history',
      headers: { authorization: 'Bearer sometoken' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.entries).toHaveLength(0);
    expect(body.data.nextCursor).toBeNull();

    // Verify NO account row was created (cross-model C1 — read-only GET)
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM accounts WHERE auth_user_id = ${AUTH_USER_ID_NO_ACCOUNT}::uuid
    `;
    expect(Number(rows[0]?.['count'])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC11: 15 rows → limit=10 → 10 entries, nextCursor non-null, newest first
// ---------------------------------------------------------------------------

describe('AC11: pagination first page', () => {
  beforeAll(async () => {
    await prisma.$executeRaw`DELETE FROM search_history WHERE account_id = ${ACCOUNT_ID_A}::uuid`;

    // Insert 15 rows with distinct created_at timestamps (1 second apart for deterministic order)
    for (let i = 0; i < 15; i++) {
      const ts = new Date(Date.now() - (15 - i) * 1000).toISOString();
      await prisma.$executeRaw`
        INSERT INTO search_history (account_id, kind, query_text, result_jsonb, created_at)
        VALUES (
          ${ACCOUNT_ID_A}::uuid,
          'text'::search_history_kind,
          ${`query ${i + 1}`},
          ${RESULT_JSONB}::jsonb,
          ${ts}::timestamptz
        )
      `;
    }
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM search_history WHERE account_id = ${ACCOUNT_ID_A}::uuid`;
  });

  it('returns 10 entries and a non-null nextCursor', async () => {
    mockVerifyBearerJwt.mockResolvedValue({ sub: AUTH_USER_ID_A });

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/history?limit=10',
      headers: { authorization: 'Bearer sometoken' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.entries).toHaveLength(10);
    expect(body.data.nextCursor).not.toBeNull();
    expect(typeof body.data.nextCursor).toBe('string');

    // Verify newest first (query 15 was inserted last = most recent)
    expect(body.data.entries[0].queryText).toBe('query 15');
  });
});

// ---------------------------------------------------------------------------
// AC12: Use nextCursor from AC11 → 5 entries, nextCursor: null
// ---------------------------------------------------------------------------

describe('AC12: pagination second page', () => {
  let savedNextCursor: string;

  beforeAll(async () => {
    await prisma.$executeRaw`DELETE FROM search_history WHERE account_id = ${ACCOUNT_ID_A}::uuid`;
    for (let i = 0; i < 15; i++) {
      const ts = new Date(Date.now() - (15 - i) * 1000).toISOString();
      await prisma.$executeRaw`
        INSERT INTO search_history (account_id, kind, query_text, result_jsonb, created_at)
        VALUES (
          ${ACCOUNT_ID_A}::uuid,
          'text'::search_history_kind,
          ${`query ${i + 1}`},
          ${RESULT_JSONB}::jsonb,
          ${ts}::timestamptz
        )
      `;
    }

    // Fetch first page to get cursor (needs 2 mock calls)
    mockVerifyBearerJwt.mockResolvedValue({ sub: AUTH_USER_ID_A });
    const app = await getApp();
    const res1 = await app.inject({
      method: 'GET',
      url: '/history?limit=10',
      headers: { authorization: 'Bearer sometoken' },
    });
    const body1 = res1.json();
    savedNextCursor = body1.data.nextCursor as string;
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM search_history WHERE account_id = ${ACCOUNT_ID_A}::uuid`;
  });

  it('returns 5 entries and nextCursor: null', async () => {
    mockVerifyBearerJwt.mockResolvedValue({ sub: AUTH_USER_ID_A });

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/history?limit=10&cursor=${encodeURIComponent(savedNextCursor)}`,
      headers: { authorization: 'Bearer sometoken' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.entries).toHaveLength(5);
    expect(body.data.nextCursor).toBeNull();
    // The 5 oldest entries (query 1 to query 5)
    expect(body.data.entries[0].queryText).toBe('query 5');
  });
});

// ---------------------------------------------------------------------------
// AC13: limit=51 → 400 VALIDATION_ERROR
// ---------------------------------------------------------------------------

describe('AC13: limit out of range → 400', () => {
  it('returns 400 VALIDATION_ERROR when limit=51', async () => {
    mockVerifyBearerJwt.mockResolvedValue({ sub: AUTH_USER_ID_A });

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/history?limit=51',
      headers: { authorization: 'Bearer sometoken' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when limit=0', async () => {
    mockVerifyBearerJwt.mockResolvedValue({ sub: AUTH_USER_ID_A });

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/history?limit=0',
      headers: { authorization: 'Bearer sometoken' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// AC14: Malformed cursor → 400 INVALID_CURSOR
// ---------------------------------------------------------------------------

describe('AC14: malformed cursor → 400 INVALID_CURSOR', () => {
  it('returns 400 INVALID_CURSOR for malformed cursor', async () => {
    mockVerifyBearerJwt.mockResolvedValue({ sub: AUTH_USER_ID_A });

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/history?cursor=not-valid-base64-lol',
      headers: { authorization: 'Bearer sometoken' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('INVALID_CURSOR');
  });
});

// ---------------------------------------------------------------------------
// AC15: Two accounts — each only sees their own rows
// ---------------------------------------------------------------------------

describe('AC15: cross-account isolation', () => {
  beforeAll(async () => {
    await prisma.$executeRaw`DELETE FROM search_history WHERE account_id IN (${ACCOUNT_ID_A}::uuid, ${ACCOUNT_ID_B}::uuid)`;

    await prisma.$executeRaw`
      INSERT INTO search_history (account_id, kind, query_text, result_jsonb)
      VALUES (${ACCOUNT_ID_A}::uuid, 'text'::search_history_kind, 'account-a query', ${RESULT_JSONB}::jsonb)
    `;
    await prisma.$executeRaw`
      INSERT INTO search_history (account_id, kind, query_text, result_jsonb)
      VALUES (${ACCOUNT_ID_B}::uuid, 'text'::search_history_kind, 'account-b query', ${RESULT_JSONB}::jsonb)
    `;
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM search_history WHERE account_id IN (${ACCOUNT_ID_A}::uuid, ${ACCOUNT_ID_B}::uuid)`;
  });

  it('account A only sees its own row', async () => {
    mockVerifyBearerJwt.mockResolvedValue({ sub: AUTH_USER_ID_A });
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/history',
      headers: { authorization: 'Bearer sometoken' },
    });
    const body = res.json();
    expect(body.data.entries).toHaveLength(1);
    expect(body.data.entries[0].queryText).toBe('account-a query');
  });

  it('account B only sees its own row', async () => {
    mockVerifyBearerJwt.mockResolvedValue({ sub: AUTH_USER_ID_B });
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/history',
      headers: { authorization: 'Bearer sometoken' },
    });
    const body = res.json();
    expect(body.data.entries).toHaveLength(1);
    expect(body.data.entries[0].queryText).toBe('account-b query');
  });
});

// ---------------------------------------------------------------------------
// AC16: GET /history does NOT consume any rate-limit bucket
// ---------------------------------------------------------------------------

describe('AC16: GET /history does not consume rate-limit buckets', () => {
  it('Redis queries bucket unchanged after 3 GET /history calls', async () => {
    const dateKey = new Date().toISOString().slice(0, 10);
    const queriesKey = `actor:limit:${ACTOR_ID_A}:${dateKey}:queries`;

    // Seed a known value
    await redis.set(queriesKey, '5');

    mockVerifyBearerJwt.mockResolvedValue({ sub: AUTH_USER_ID_A });
    const app = await getApp();

    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'GET',
        url: '/history',
        headers: { authorization: 'Bearer sometoken' },
      });
    }

    const after = await redis.get(queriesKey);
    expect(after).toBe('5'); // unchanged

    await redis.del(queriesKey);
  });
});

// ---------------------------------------------------------------------------
// AC65: DB error in resolveAccountIdFromSub → 500 (not 200 [])
// ---------------------------------------------------------------------------

describe('AC65: DB error during account resolution → 500', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /history → 500 when $queryRaw rejects (not 200 [])', async () => {
    mockVerifyBearerJwt.mockResolvedValue({ sub: AUTH_USER_ID_A });

    // Spy on the same prisma instance passed to buildApp (used by resolveAccountIdFromSub)
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('db down'));

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/history',
      headers: { authorization: 'Bearer sometoken' },
    });

    expect(res.statusCode).toBe(500);
  });
});
