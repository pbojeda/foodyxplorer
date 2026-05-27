// F-WEB-HISTORY — DELETE /history/:id + DELETE /history integration tests (AC17–AC24, AC65)
//
// Uses real PG test DB (:5433) + real Redis (:6380).
// Fixture UUID prefix: f8100000- (unique to F-WEB-HISTORY delete tests).
//
// NOTE: verifyBearerJwt is called twice per bearer request (actorResolver + route).
// Tests use mockResolvedValue (not Once).
//
// DELETE /history/:id:
//   AC17: no bearer → 401
//   AC18: invalid UUID param → 400 VALIDATION_ERROR
//   AC19: entry not found (non-existent id) → 404 NOT_FOUND
//   AC20: entry owned by different account → 404 NOT_FOUND (no enumeration)
//   AC21: valid delete → 204
//
// DELETE /history:
//   AC22: no bearer → 401
//   AC23: valid clear → 204, all rows gone
//   AC24: clear with no rows (idempotent) → 204
//
// AC65: DB error in resolveAccountIdFromSub → 500 (not 404 / 204)

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

// ---------------------------------------------------------------------------
// Mocks
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
// Fixture IDs — f8100000- prefix
// ---------------------------------------------------------------------------

const AUTH_USER_ID_DEL = 'f8100000-0001-4000-a000-000000000001';
const ACCOUNT_ID_DEL = 'f8100000-0002-4000-a000-000000000002';

const AUTH_USER_ID_OTHER = 'f8100000-0003-4000-a000-000000000003';
const ACCOUNT_ID_OTHER = 'f8100000-0004-4000-a000-000000000004';

// ---------------------------------------------------------------------------
// DB + Redis
// ---------------------------------------------------------------------------

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

const redis = new Redis(REDIS_URL_TEST);

const RESULT_JSONB = JSON.stringify({
  intent: 'text_too_long',
  actorId: '00000000-0000-0000-0000-000000000001',
  activeContext: null,
});

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await prisma.$executeRaw`DELETE FROM search_history WHERE account_id IN (${ACCOUNT_ID_DEL}::uuid, ${ACCOUNT_ID_OTHER}::uuid)`;
  await prisma.$executeRaw`DELETE FROM accounts WHERE id IN (${ACCOUNT_ID_DEL}::uuid, ${ACCOUNT_ID_OTHER}::uuid)`;

  await prisma.$executeRaw`
    INSERT INTO accounts (id, auth_user_id, email)
    VALUES (${ACCOUNT_ID_DEL}::uuid, ${AUTH_USER_ID_DEL}::uuid, 'delete-test@example.com')
    ON CONFLICT (id) DO NOTHING
  `;
  await prisma.$executeRaw`
    INSERT INTO accounts (id, auth_user_id, email)
    VALUES (${ACCOUNT_ID_OTHER}::uuid, ${AUTH_USER_ID_OTHER}::uuid, 'other-test@example.com')
    ON CONFLICT (id) DO NOTHING
  `;
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM search_history WHERE account_id IN (${ACCOUNT_ID_DEL}::uuid, ${ACCOUNT_ID_OTHER}::uuid)`;
  await prisma.$executeRaw`DELETE FROM accounts WHERE id IN (${ACCOUNT_ID_DEL}::uuid, ${ACCOUNT_ID_OTHER}::uuid)`;
  await prisma.$disconnect();
  await redis.quit();
});

beforeEach(() => {
  mockVerifyBearerJwt.mockReset();
});

async function getApp() {
  return buildApp({
    config: testConfig as unknown as import('../../config.js').Config,
    prisma,
    redis,
  });
}

// Helper: insert a search_history row and return its id
async function insertHistoryRow(accountId: string): Promise<string> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO search_history (account_id, kind, query_text, result_jsonb)
    VALUES (${accountId}::uuid, 'text'::search_history_kind, 'test query', ${RESULT_JSONB}::jsonb)
    RETURNING id
  `;
  return rows[0]?.['id'] ?? '';
}

// ---------------------------------------------------------------------------
// DELETE /history/:id — AC17: no bearer → 401
// ---------------------------------------------------------------------------

describe('AC17: DELETE /history/:id — no bearer → 401', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/history/00000000-0000-0000-0000-000000000001',
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});

// ---------------------------------------------------------------------------
// AC18: DELETE /history/:id — invalid UUID → 400 VALIDATION_ERROR
// ---------------------------------------------------------------------------

describe('AC18: DELETE /history/:id — invalid UUID → 400', () => {
  it('returns 400 when id is not a valid UUID', async () => {
    mockVerifyBearerJwt.mockResolvedValue({ sub: AUTH_USER_ID_DEL });
    const app = await getApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/history/not-a-uuid',
      headers: { authorization: 'Bearer sometoken' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// AC19: DELETE /history/:id — entry not found → 404
// ---------------------------------------------------------------------------

describe('AC19: DELETE /history/:id — not found → 404', () => {
  it('returns 404 when the entry does not exist', async () => {
    mockVerifyBearerJwt.mockResolvedValue({ sub: AUTH_USER_ID_DEL });
    const app = await getApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/history/11111111-0000-0000-0000-000000000000',
      headers: { authorization: 'Bearer sometoken' },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// AC20: DELETE /history/:id — cross-account → 404 (no enumeration)
// ---------------------------------------------------------------------------

describe('AC20: DELETE /history/:id — cross-account → 404 (no enumeration)', () => {
  it('returns 404 when entry is owned by a different account', async () => {
    // Create row owned by OTHER account
    const otherId = await insertHistoryRow(ACCOUNT_ID_OTHER);

    // DEL user tries to delete OTHER user's entry
    mockVerifyBearerJwt.mockResolvedValue({ sub: AUTH_USER_ID_DEL });
    const app = await getApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/history/${otherId}`,
      headers: { authorization: 'Bearer sometoken' },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe('NOT_FOUND');

    // Cleanup
    await prisma.$executeRaw`DELETE FROM search_history WHERE id = ${otherId}::uuid`;
  });
});

// ---------------------------------------------------------------------------
// AC21: DELETE /history/:id — valid delete → 204
// ---------------------------------------------------------------------------

describe('AC21: DELETE /history/:id — valid delete → 204', () => {
  it('deletes the entry and returns 204', async () => {
    const entryId = await insertHistoryRow(ACCOUNT_ID_DEL);

    mockVerifyBearerJwt.mockResolvedValue({ sub: AUTH_USER_ID_DEL });
    const app = await getApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/history/${entryId}`,
      headers: { authorization: 'Bearer sometoken' },
    });
    expect(res.statusCode).toBe(204);

    // Verify gone
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM search_history WHERE id = ${entryId}::uuid
    `;
    expect(Number(rows[0]?.['count'])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// DELETE /history — AC22: no bearer → 401
// ---------------------------------------------------------------------------

describe('AC22: DELETE /history — no bearer → 401', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'DELETE', url: '/history' });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});

// ---------------------------------------------------------------------------
// AC23: DELETE /history — clears all rows → 204
// ---------------------------------------------------------------------------

describe('AC23: DELETE /history — clears all rows → 204', () => {
  it('deletes all history rows for the account', async () => {
    // Insert 3 rows
    await insertHistoryRow(ACCOUNT_ID_DEL);
    await insertHistoryRow(ACCOUNT_ID_DEL);
    await insertHistoryRow(ACCOUNT_ID_DEL);

    // Verify 3 rows exist
    const before = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM search_history WHERE account_id = ${ACCOUNT_ID_DEL}::uuid
    `;
    expect(Number(before[0]?.['count'])).toBeGreaterThanOrEqual(3);

    mockVerifyBearerJwt.mockResolvedValue({ sub: AUTH_USER_ID_DEL });
    const app = await getApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/history',
      headers: { authorization: 'Bearer sometoken' },
    });
    expect(res.statusCode).toBe(204);

    // Verify all gone
    const after = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM search_history WHERE account_id = ${ACCOUNT_ID_DEL}::uuid
    `;
    expect(Number(after[0]?.['count'])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC24: DELETE /history — no rows (idempotent) → 204
// ---------------------------------------------------------------------------

describe('AC24: DELETE /history — no rows, idempotent → 204', () => {
  it('returns 204 even when there are no rows to delete', async () => {
    // Ensure no rows exist
    await prisma.$executeRaw`DELETE FROM search_history WHERE account_id = ${ACCOUNT_ID_DEL}::uuid`;

    mockVerifyBearerJwt.mockResolvedValue({ sub: AUTH_USER_ID_DEL });
    const app = await getApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/history',
      headers: { authorization: 'Bearer sometoken' },
    });
    expect(res.statusCode).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// AC65: DB error in resolveAccountIdFromSub → 500 (not 404 / 204)
// ---------------------------------------------------------------------------

describe('AC65: DB error during account resolution → 500', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('DELETE /history/:id → 500 when $queryRaw rejects (not 404)', async () => {
    mockVerifyBearerJwt.mockResolvedValue({ sub: AUTH_USER_ID_DEL });

    // Spy on the same prisma instance passed to buildApp (used by resolveAccountIdFromSub)
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('db down'));

    const app = await getApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/history/11111111-0000-0000-0000-000000000000',
      headers: { authorization: 'Bearer sometoken' },
    });

    expect(res.statusCode).toBe(500);
  });

  it('DELETE /history → 500 when $queryRaw rejects (not 204)', async () => {
    mockVerifyBearerJwt.mockResolvedValue({ sub: AUTH_USER_ID_DEL });

    // Spy on the same prisma instance passed to buildApp (used by resolveAccountIdFromSub)
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('db down'));

    const app = await getApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/history',
      headers: { authorization: 'Bearer sometoken' },
    });

    expect(res.statusCode).toBe(500);
  });
});
