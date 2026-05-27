// F107a — Auth routes integration tests (AC4-AC10, AC14, AC15, AC16, AC27, S2)
//
// Uses buildApp() with real test DB + mocked Supabase SDK.
// JWT verification uses local RS256 keypair (no real Supabase needed).
//
// Fixture UUID prefix: f1070000 to avoid collisions with other test files.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { generateKeyPair, SignJWT } from 'jose';

// ---------------------------------------------------------------------------
// Mock @supabase/supabase-js before importing buildApp
// ---------------------------------------------------------------------------

const mockSignInWithOtp = vi.fn();
const mockSignOut = vi.fn();
const mockCreateClient = vi.fn(() => ({
  auth: {
    signInWithOtp: mockSignInWithOtp,
    admin: {
      signOut: mockSignOut,
    },
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: mockCreateClient,
}));

// Mock verifyBearerJwt for route-level tests — we control what it returns
// so we can simulate valid/invalid/expired tokens without real JWKS
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

const testConfig = {
  NODE_ENV: 'test' as const,
  PORT: 3002,
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
// DB setup
// ---------------------------------------------------------------------------

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

// Fixture IDs — f1070000 prefix (all valid UUIDs)
const ACTOR_ID_1 = 'f1070000-0001-4000-a000-000000000001';
const ACTOR_ID_2 = 'f1070000-0002-4000-a000-000000000002';
const AUTH_USER_ID_1 = 'f1070000-0003-4000-a000-000000000003';
// External IDs for actors (must be valid UUIDs for x-actor-id header)
const ACTOR_EXT_ID_1 = 'f1070000-e001-4000-a000-000000000001';
const ACTOR_EXT_ID_2 = 'f1070000-e002-4000-a000-000000000002';

// ---------------------------------------------------------------------------
// JWT fixtures
// ---------------------------------------------------------------------------

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;

  // Pre-cleanup (reverse FK order)
  await prisma.$executeRaw`DELETE FROM actors WHERE id IN (${ACTOR_ID_1}::uuid, ${ACTOR_ID_2}::uuid)`;
  await prisma.$executeRaw`DELETE FROM accounts WHERE auth_user_id = ${AUTH_USER_ID_1}::uuid`;

  // Create fixture actors (anonymous)
  await prisma.actor.upsert({
    where: { type_externalId: { type: 'anonymous_web', externalId: ACTOR_EXT_ID_1 } },
    create: { id: ACTOR_ID_1, type: 'anonymous_web', externalId: ACTOR_EXT_ID_1, lastSeenAt: new Date() },
    update: { accountId: null, lastSeenAt: new Date() },
  });
  await prisma.actor.upsert({
    where: { type_externalId: { type: 'anonymous_web', externalId: ACTOR_EXT_ID_2 } },
    create: { id: ACTOR_ID_2, type: 'anonymous_web', externalId: ACTOR_EXT_ID_2, lastSeenAt: new Date() },
    update: { accountId: null, lastSeenAt: new Date() },
  });
});

afterAll(async () => {
  // Teardown in FK order
  await prisma.$executeRaw`DELETE FROM actors WHERE id IN (${ACTOR_ID_1}::uuid, ${ACTOR_ID_2}::uuid)`;
  await prisma.$executeRaw`DELETE FROM accounts WHERE auth_user_id = ${AUTH_USER_ID_1}::uuid`;
  await prisma.$disconnect();
});

async function makeValidJwt(
  sub: string = AUTH_USER_ID_1,
  email: string = 'user@example.com',
): Promise<string> {
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
// POST /auth/login tests (AC4, AC5, AC16 partial)
// ---------------------------------------------------------------------------

describe('F107a — POST /auth/login', () => {
  beforeEach(() => {
    mockSignInWithOtp.mockReset();
    mockVerifyBearerJwt.mockReset();
  });

  it('AC4: returns 200 with success=true for valid email magic link request', async () => {
    mockSignInWithOtp.mockResolvedValue({ data: {}, error: null });

    const app = await buildApp({
      config: testConfig as unknown as import('../../config.js').Config,
      prisma,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        provider: 'email',
        email: 'user@example.com',
        redirectTo: 'https://app.nutrixplorer.com/auth/callback',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.provider).toBe('email');
    expect(body.data.success).toBe(true);
    expect(mockSignInWithOtp).toHaveBeenCalledWith({
      email: 'user@example.com',
      options: { emailRedirectTo: 'https://app.nutrixplorer.com/auth/callback' },
    });

    await app.close();
  });

  it('AC5: returns 400 PROVIDER_NOT_ENABLED for provider: google', async () => {
    const app = await buildApp({
      config: testConfig as unknown as import('../../config.js').Config,
      prisma,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        provider: 'google',
        redirectTo: 'https://app.nutrixplorer.com/auth/callback',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('PROVIDER_NOT_ENABLED');

    await app.close();
  });

  it('AC16: returns 503 when Supabase signInWithOtp fails', async () => {
    mockSignInWithOtp.mockResolvedValue({
      data: null,
      error: { message: 'Service unavailable', status: 503 },
    });

    const app = await buildApp({
      config: testConfig as unknown as import('../../config.js').Config,
      prisma,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        provider: 'email',
        email: 'user@example.com',
        redirectTo: 'https://app.nutrixplorer.com/auth/callback',
      },
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error.code).toBe('AUTH_PROVIDER_UNAVAILABLE');

    await app.close();
  });

  it('returns 400 VALIDATION_ERROR for missing email when provider=email', async () => {
    const app = await buildApp({
      config: testConfig as unknown as import('../../config.js').Config,
      prisma,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        provider: 'email',
        redirectTo: 'https://app.nutrixplorer.com/auth/callback',
        // email intentionally omitted
      },
    });

    expect(res.statusCode).toBe(400);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// POST /auth/logout tests (AC6)
// ---------------------------------------------------------------------------

describe('F107a — POST /auth/logout', () => {
  beforeEach(() => {
    mockSignOut.mockReset();
    mockVerifyBearerJwt.mockReset();
  });

  it('AC6: returns 204 for valid bearer logout', async () => {
    mockVerifyBearerJwt.mockResolvedValue({
      sub: AUTH_USER_ID_1,
      email: 'user@example.com',
      aud: 'authenticated',
      iss: 'https://test.supabase.co/auth/v1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    mockSignOut.mockResolvedValue({ error: null });

    const app = await buildApp({
      config: testConfig as unknown as import('../../config.js').Config,
      prisma,
    });

    const bearerToken = await makeValidJwt();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { authorization: bearerToken },
    });

    expect(res.statusCode).toBe(204);
    expect(mockSignOut).toHaveBeenCalled();

    await app.close();
  });

  it('returns 401 when no bearer present on logout', async () => {
    mockVerifyBearerJwt.mockRejectedValue(
      Object.assign(new Error('Authorization header required'), { code: 'INVALID_TOKEN' }),
    );

    const app = await buildApp({
      config: testConfig as unknown as import('../../config.js').Config,
      prisma,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
    });

    expect(res.statusCode).toBe(401);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// GET /me tests (AC7, AC8, AC9, AC10, AC14, AC15, S2)
// ---------------------------------------------------------------------------

describe('F107a — GET /me', () => {
  beforeEach(() => {
    mockVerifyBearerJwt.mockReset();
    // Reset account_id on fixture actors before each test
  });

  it('AC7, AC14: returns 200 MeResponse for first-login user (creates accounts row)', async () => {
    // First cleanup: unlink actors from account, then delete the account
    await prisma.$executeRaw`UPDATE actors SET account_id = NULL WHERE id IN (${ACTOR_ID_1}::uuid, ${ACTOR_ID_2}::uuid)`;
    await prisma.$executeRaw`DELETE FROM accounts WHERE auth_user_id = ${AUTH_USER_ID_1}::uuid`;
    // Ensure actor fixture exists (upsert for idempotency)
    await prisma.actor.upsert({
      where: { type_externalId: { type: 'anonymous_web', externalId: ACTOR_EXT_ID_1 } },
      create: { id: ACTOR_ID_1, type: 'anonymous_web', externalId: ACTOR_EXT_ID_1, lastSeenAt: new Date() },
      update: { accountId: null, lastSeenAt: new Date() },
    });

    mockVerifyBearerJwt.mockResolvedValue({
      sub: AUTH_USER_ID_1,
      email: 'user@example.com',
      aud: 'authenticated',
      iss: 'https://test.supabase.co/auth/v1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const app = await buildApp({
      config: testConfig as unknown as import('../../config.js').Config,
      prisma,
    });

    const bearerToken = await makeValidJwt();
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: {
        authorization: bearerToken,
        'x-actor-id': ACTOR_EXT_ID_1,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.account).toBeDefined();
    expect(body.data.account.authUserId).toBe(AUTH_USER_ID_1);
    expect(body.data.account.email).toBe('user@example.com');
    expect(body.data.actor).toBeDefined();

    await app.close();
  });

  it('AC8: returns 401 when no bearer present on /me', async () => {
    mockVerifyBearerJwt.mockRejectedValue(
      Object.assign(new Error('No bearer token'), { code: 'INVALID_TOKEN' }),
    );

    const app = await buildApp({
      config: testConfig as unknown as import('../../config.js').Config,
      prisma,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me',
    });

    expect(res.statusCode).toBe(401);

    await app.close();
  });

  it('AC9: returns 401 INVALID_TOKEN for invalid JWT', async () => {
    mockVerifyBearerJwt.mockRejectedValue(
      Object.assign(new Error('JWT is invalid'), { code: 'INVALID_TOKEN' }),
    );

    const app = await buildApp({
      config: testConfig as unknown as import('../../config.js').Config,
      prisma,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer bad.token.here' },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.code).toBe('INVALID_TOKEN');

    await app.close();
  });

  it('AC10: returns 401 TOKEN_EXPIRED for expired JWT', async () => {
    mockVerifyBearerJwt.mockRejectedValue(
      Object.assign(new Error('JWT has expired'), { code: 'TOKEN_EXPIRED' }),
    );

    const app = await buildApp({
      config: testConfig as unknown as import('../../config.js').Config,
      prisma,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer expired.token.here' },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.code).toBe('TOKEN_EXPIRED');

    await app.close();
  });

  it('AC15: second device reuses existing accounts row (same accounts.id)', async () => {
    // First: ensure account exists from a prior /me call
    await prisma.$executeRaw`UPDATE actors SET account_id = NULL WHERE id IN (${ACTOR_ID_1}::uuid, ${ACTOR_ID_2}::uuid)`;
    await prisma.$executeRaw`DELETE FROM accounts WHERE auth_user_id = ${AUTH_USER_ID_1}::uuid`;
    await prisma.$executeRaw`
      INSERT INTO accounts (auth_user_id, email, last_seen_at)
      VALUES (${AUTH_USER_ID_1}::uuid, 'user@example.com', now())
    `;

    mockVerifyBearerJwt.mockResolvedValue({
      sub: AUTH_USER_ID_1,
      email: 'user@example.com',
      aud: 'authenticated',
      iss: 'https://test.supabase.co/auth/v1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const app = await buildApp({
      config: testConfig as unknown as import('../../config.js').Config,
      prisma,
    });

    // First call
    const res1 = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: await makeValidJwt(), 'x-actor-id': ACTOR_EXT_ID_1 },
    });
    // Second call (simulates second device)
    const res2 = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: await makeValidJwt(), 'x-actor-id': ACTOR_EXT_ID_2 },
    });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    const body1 = res1.json();
    const body2 = res2.json();

    // Both devices see the same account.id (same auth_user_id)
    expect(body1.data.account.id).toBe(body2.data.account.id);

    await app.close();
  });

  it('F-WEB-TIER AC15: GET /me response includes tier field (free by default)', async () => {
    // Ensure clean state
    await prisma.$executeRaw`UPDATE actors SET account_id = NULL WHERE id IN (${ACTOR_ID_1}::uuid, ${ACTOR_ID_2}::uuid)`;
    await prisma.$executeRaw`DELETE FROM accounts WHERE auth_user_id = ${AUTH_USER_ID_1}::uuid`;
    await prisma.actor.upsert({
      where: { type_externalId: { type: 'anonymous_web', externalId: ACTOR_EXT_ID_1 } },
      create: { id: ACTOR_ID_1, type: 'anonymous_web', externalId: ACTOR_EXT_ID_1, lastSeenAt: new Date() },
      update: { accountId: null, lastSeenAt: new Date() },
    });

    mockVerifyBearerJwt.mockResolvedValue({
      sub: AUTH_USER_ID_1,
      email: 'user@example.com',
      aud: 'authenticated',
      iss: 'https://test.supabase.co/auth/v1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const app = await buildApp({
      config: testConfig as unknown as import('../../config.js').Config,
      prisma,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: {
        authorization: await makeValidJwt(),
        'x-actor-id': ACTOR_EXT_ID_1,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.account).toBeDefined();
    // F-WEB-TIER: tier must be present and default to 'free'
    expect(body.data.account.tier).toBe('free');

    await app.close();
  });

  it('S2: concurrent first-login requests produce same accounts.id (upsert determinism)', async () => {
    // Clean up any prior account
    await prisma.$executeRaw`UPDATE actors SET account_id = NULL WHERE id IN (${ACTOR_ID_1}::uuid, ${ACTOR_ID_2}::uuid)`;
    await prisma.$executeRaw`DELETE FROM accounts WHERE auth_user_id = ${AUTH_USER_ID_1}::uuid`;

    mockVerifyBearerJwt.mockResolvedValue({
      sub: AUTH_USER_ID_1,
      email: 'user@example.com',
      aud: 'authenticated',
      iss: 'https://test.supabase.co/auth/v1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const app = await buildApp({
      config: testConfig as unknown as import('../../config.js').Config,
      prisma,
    });

    // Fire two requests concurrently (same JWT = same auth_user_id)
    const bearer = await makeValidJwt();
    const [res1, res2] = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: bearer, 'x-actor-id': ACTOR_EXT_ID_1 },
      }),
      app.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: bearer, 'x-actor-id': ACTOR_EXT_ID_1 },
      }),
    ]);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    const id1 = res1.json().data.account.id;
    const id2 = res2.json().data.account.id;

    // Both must see the same account ID — upsert ON CONFLICT is atomic
    expect(id1).toBe(id2);

    await app.close();
  });
});
