// F107a-FU2 — Collision integration tests (AC9, AC9b, AC12, AC13, AC14)
//
// Tests the two-bearer hijack prevention and concurrent idempotency scenarios
// against a real Postgres test container (port 5433, foodxplorer_test DB).
//
// Per Codex P-I3 R1: Phase 3 tests are post-GREEN integration verification,
// NOT strict TDD RED-before-GREEN. They run against the live HTTP handler +
// real Postgres to confirm the unit-test mocks weren't lying.
//
// Fixture UUID prefix: f7220000- (distinct from f1070000- used in F107a tests)
//
// User sub UUIDs differ in the first 8 hex chars so fallback externalIds
// (me-<sub.slice(0,8)>) don't collide:
//   User A → f7220001 → fallback externalId: me-f7220001
//   User B → f7220002 → fallback externalId: me-f7220002
//   User C → f7220003 → fallback externalId: me-f7220003

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { generateKeyPair, SignJWT } from 'jose';

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

// Dynamic import AFTER mocks
const { buildApp } = await import('../../app.js');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const testConfig = {
  NODE_ENV: 'test' as const,
  PORT: 3003,
  DATABASE_URL: DATABASE_URL_TEST,
  DATABASE_URL_TEST,
  LOG_LEVEL: 'error' as const,
  REDIS_URL: 'redis://localhost:6380',
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
// DB client
// ---------------------------------------------------------------------------

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

// ---------------------------------------------------------------------------
// Fixture constants (per R2-PI2: all 5 actor externalIds must be in cleanup)
// ---------------------------------------------------------------------------

// User A: f7220001-0000-4000-a000-000000000001 → fallback externalId: me-f7220001
const AUTH_USER_A_ID = 'f7220001-0000-4000-a000-000000000001';
// User B: f7220002-0000-4000-a000-000000000002 → fallback externalId: me-f7220002
const AUTH_USER_B_ID = 'f7220002-0000-4000-a000-000000000002';
// User C: f7220003-0000-4000-a000-000000000003 → fallback externalId: me-f7220003 (AC14)
const AUTH_USER_C_ID = 'f7220003-0000-4000-a000-000000000003';

// Shared actor that AC12 uses (first bearer links it; second bearer triggers collision)
const SHARED_ACTOR_EXT_ID = 'f7220000-e001-4000-a000-000000000001';
// Separate actor for AC14 idempotency test
const IDEMPOTENT_ACTOR_EXT_ID = 'f7220000-e002-4000-a000-000000000002';

// Derived fallback externalIds (must be cleaned up)
const FALLBACK_A_EXT_ID = 'me-f7220001';
const FALLBACK_B_EXT_ID = 'me-f7220002';
const FALLBACK_C_EXT_ID = 'me-f7220003';

// ---------------------------------------------------------------------------
// JWT keypair + helpers
// ---------------------------------------------------------------------------

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

async function makeJwtForUser(sub: string, email: string): Promise<string> {
  const token = await new SignJWT({
    sub,
    email,
    aud: 'authenticated',
    iss: 'https://test.supabase.co/auth/v1',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
    .setExpirationTime('1h')
    .setIssuedAt()
    .sign(privateKey);
  return `Bearer ${token}`;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;

  // Pre-cleanup (reverse FK order: actors reference accounts)
  await prisma.$executeRaw`
    DELETE FROM actors WHERE external_id IN (
      ${SHARED_ACTOR_EXT_ID},
      ${IDEMPOTENT_ACTOR_EXT_ID},
      ${FALLBACK_A_EXT_ID},
      ${FALLBACK_B_EXT_ID},
      ${FALLBACK_C_EXT_ID}
    )
  `;
  await prisma.$executeRaw`
    DELETE FROM accounts WHERE auth_user_id IN (
      ${AUTH_USER_A_ID}::uuid,
      ${AUTH_USER_B_ID}::uuid,
      ${AUTH_USER_C_ID}::uuid
    )
  `;

  // Create anonymous actor fixtures
  await prisma.actor.upsert({
    where: { type_externalId: { type: 'anonymous_web', externalId: SHARED_ACTOR_EXT_ID } },
    create: { type: 'anonymous_web', externalId: SHARED_ACTOR_EXT_ID, lastSeenAt: new Date() },
    update: { accountId: null, lastSeenAt: new Date() },
  });
  await prisma.actor.upsert({
    where: { type_externalId: { type: 'anonymous_web', externalId: IDEMPOTENT_ACTOR_EXT_ID } },
    create: { type: 'anonymous_web', externalId: IDEMPOTENT_ACTOR_EXT_ID, lastSeenAt: new Date() },
    update: { accountId: null, lastSeenAt: new Date() },
  });
});

afterAll(async () => {
  // Cleanup (reverse FK order)
  await prisma.$executeRaw`
    DELETE FROM actors WHERE external_id IN (
      ${SHARED_ACTOR_EXT_ID},
      ${IDEMPOTENT_ACTOR_EXT_ID},
      ${FALLBACK_A_EXT_ID},
      ${FALLBACK_B_EXT_ID},
      ${FALLBACK_C_EXT_ID}
    )
  `;
  await prisma.$executeRaw`
    DELETE FROM accounts WHERE auth_user_id IN (
      ${AUTH_USER_A_ID}::uuid,
      ${AUTH_USER_B_ID}::uuid,
      ${AUTH_USER_C_ID}::uuid
    )
  `;
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F107a-FU2 — Collision integration tests (AC9, AC9b, AC12, AC13, AC14)', () => {

  // -------------------------------------------------------------------------
  // AC12: Two-bearer hijack prevention (AC6, AC9, AC9b, AC5 all verified here)
  // -------------------------------------------------------------------------

  it('AC12: two-bearer hijack prevention — User B gets fallback actor, User A actor untouched', async () => {
    const app = await buildApp({
      config: testConfig as unknown as import('../../config.js').Config,
      prisma,
    });

    const bearerA = await makeJwtForUser(AUTH_USER_A_ID, 'a@example.com');
    const bearerB = await makeJwtForUser(AUTH_USER_B_ID, 'b@example.com');

    // Arrange: User A calls /me with SHARED_ACTOR_EXT_ID → actor linked to account_A
    // mockResolvedValue (not Once) because actorResolver also calls verifyBearerJwt.
    mockVerifyBearerJwt.mockResolvedValue({
      sub: AUTH_USER_A_ID,
      email: 'a@example.com',
      aud: 'authenticated',
      iss: 'https://test.supabase.co/auth/v1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const res1 = await app.inject({
      method: 'GET',
      url: '/me',
      headers: {
        authorization: bearerA,
        'x-actor-id': SHARED_ACTOR_EXT_ID,
      },
    });
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json() as {
      data: { actor: { id: string; externalId: string; accountId: string } };
    };
    expect(body1.data.actor.accountId).toBeDefined();

    // Act: User B calls /me with the SAME shared actor
    mockVerifyBearerJwt.mockResolvedValue({
      sub: AUTH_USER_B_ID,
      email: 'b@example.com',
      aud: 'authenticated',
      iss: 'https://test.supabase.co/auth/v1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const res2 = await app.inject({
      method: 'GET',
      url: '/me',
      headers: {
        authorization: bearerB,
        'x-actor-id': SHARED_ACTOR_EXT_ID,
      },
    });

    // AC6: 200 on collision (not 409)
    expect(res2.statusCode).toBe(200);

    const body2 = res2.json() as {
      data: { actor: { id: string; externalId: string; accountId: string } };
    };

    // AC9: fallback actor returned — externalId starts with "me-"
    const actorB = body2.data.actor;
    expect(actorB.externalId).toMatch(/^me-/);

    // R2-S1 Gemini: explicit different-actor assertion at response level
    expect(actorB.id).not.toBe(body1.data.actor.id);

    // AC9b (DB assertion): fallback actor is linked to account_B
    const accountBRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text FROM accounts WHERE auth_user_id = ${AUTH_USER_B_ID}::uuid
    `;
    expect(accountBRows).toHaveLength(1);
    const accountBId = accountBRows[0]?.['id'];
    expect(accountBId).toBeDefined();

    const fallbackRows = await prisma.$queryRaw<Array<{ account_id: string }>>`
      SELECT account_id::text FROM actors WHERE id = ${actorB.id}::uuid
    `;
    expect(fallbackRows).toHaveLength(1);
    expect(fallbackRows[0]?.['account_id']).toBe(accountBId);

    // AC5 (DB assertion): original actor's account_id is still account_A's id — NOT hijacked
    const accountARows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text FROM accounts WHERE auth_user_id = ${AUTH_USER_A_ID}::uuid
    `;
    expect(accountARows).toHaveLength(1);
    const accountAId = accountARows[0]?.['id'];
    expect(accountAId).toBeDefined();

    const originalRows = await prisma.$queryRaw<Array<{ account_id: string }>>`
      SELECT account_id::text FROM actors WHERE external_id = ${SHARED_ACTOR_EXT_ID}
    `;
    expect(originalRows).toHaveLength(1);
    // AC5: original actor still owned by account_A — NOT overwritten to account_B
    expect(originalRows[0]?.['account_id']).toBe(accountAId);
    expect(originalRows[0]?.['account_id']).not.toBe(accountBId);
  });

  // -------------------------------------------------------------------------
  // AC14: Concurrent same-bearer same-actor → idempotent (no P2002)
  // -------------------------------------------------------------------------

  it('AC14: concurrent /me calls from same bearer + same X-Actor-Id → both 200, same actor id', async () => {
    const app = await buildApp({
      config: testConfig as unknown as import('../../config.js').Config,
      prisma,
    });

    const bearerC = await makeJwtForUser(AUTH_USER_C_ID, 'c@example.com');

    // Both concurrent calls with the same IDEMPOTENT_ACTOR_EXT_ID
    mockVerifyBearerJwt.mockResolvedValue({
      sub: AUTH_USER_C_ID,
      email: 'c@example.com',
      aud: 'authenticated',
      iss: 'https://test.supabase.co/auth/v1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const [r1, r2] = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/me',
        headers: {
          authorization: bearerC,
          'x-actor-id': IDEMPOTENT_ACTOR_EXT_ID,
        },
      }),
      app.inject({
        method: 'GET',
        url: '/me',
        headers: {
          authorization: bearerC,
          'x-actor-id': IDEMPOTENT_ACTOR_EXT_ID,
        },
      }),
    ]);

    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);

    const b1 = r1.json() as { data: { actor: { id: string; accountId: string } } };
    const b2 = r2.json() as { data: { actor: { id: string; accountId: string } } };

    // Both return same actor id (idempotent — one call linked it, the other's safe UPDATE matches `account_id = bearer` clause)
    expect(b1.data.actor.id).toBe(b2.data.actor.id);
    expect(b1.data.actor.accountId).toBeDefined();
    expect(b2.data.actor.accountId).toBeDefined();
  });

});
