// BUG-PROD-013 — Integration test: POST /conversation/message with bearer + X-Actor-Id
//
// Proves AC1 + AC7 end-to-end at the real DB boundary:
//   AC1: bearer + X-Actor-Id → HTTP 200 (not 500 "Actor resolution failed")
//   AC7: query_logs row written with non-null actor_id
//
// Harness mirrors f107a.authRoutes.integration.test.ts:
//   - buildApp({ config: testConfig, prisma }) with real test DB
//   - vi.mock('../../plugins/authBearer.js') to control verifyBearerJwt
//   - vi.mock processMessage to avoid OpenAI calls
//   - vi.mock Kysely and Redis (module-level singletons)
//
// Fixture UUID prefix: fd013000 to avoid collisions with other test files.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Mock verifyBearerJwt — control JWT verification result without real JWKS
// ---------------------------------------------------------------------------

const mockVerifyBearerJwt = vi.fn();

vi.mock('../../plugins/authBearer.js', () => ({
  verifyBearerJwt: mockVerifyBearerJwt,
}));

// ---------------------------------------------------------------------------
// Mock processMessage — avoid OpenAI/cascade calls; return minimal valid shape
// ---------------------------------------------------------------------------

const { mockProcessMessage } = vi.hoisted(() => ({
  mockProcessMessage: vi.fn(),
}));

vi.mock('../../conversation/conversationCore.js', () => ({
  processMessage: mockProcessMessage,
}));

// ---------------------------------------------------------------------------
// Mock runEstimationCascade (imported transitively, needed to avoid errors)
// ---------------------------------------------------------------------------

vi.mock('../../estimation/engineRouter.js', () => ({
  runEstimationCascade: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock openaiClient (imported by conversation.ts — text route doesn't call it
// but the import must resolve)
// ---------------------------------------------------------------------------

vi.mock('../../lib/openaiClient.js', () => ({
  callWhisperTranscription: vi.fn(),
  isWhisperHallucination: vi.fn().mockReturnValue(false),
  getOpenAIClient: vi.fn(),
  isRetryableError: vi.fn(),
  sleep: vi.fn(),
  callChatCompletion: vi.fn(),
  callVisionCompletion: vi.fn(),
  callOpenAIEmbeddingsOnce: vi.fn(),
  WHISPER_HALLUCINATIONS: new Set(),
}));

// ---------------------------------------------------------------------------
// Mock Redis (module-level singleton — rate limiter + cache)
// ---------------------------------------------------------------------------

const { mockRedisGet, mockRedisSet, mockRedisIncr, mockRedisExpire } = vi.hoisted(() => ({
  mockRedisGet: vi.fn(),
  mockRedisSet: vi.fn(),
  mockRedisIncr: vi.fn(),
  mockRedisExpire: vi.fn(),
}));

vi.mock('../../lib/redis.js', () => ({
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
    incr: mockRedisIncr,
    expire: mockRedisExpire,
  },
}));

// ---------------------------------------------------------------------------
// Mock Kysely (module-level singleton — loadChainData on plugin init)
// ---------------------------------------------------------------------------

const { mockKyselyChainStubs } = vi.hoisted(() => {
  const execute = vi.fn().mockResolvedValue([]);
  const chainMethodNames = [
    'selectFrom', 'select', 'where', 'distinct', 'innerJoin',
    'orderBy', 'limit', 'offset', '$if',
  ] as const;
  const stub: Record<string, unknown> = {};
  for (const method of chainMethodNames) {
    stub[method] = vi.fn();
  }
  stub['execute'] = execute;
  stub['executeTakeFirstOrThrow'] = vi.fn().mockResolvedValue({});
  stub['fn'] = {
    countAll: vi.fn().mockReturnValue({ as: vi.fn().mockReturnValue('count') }),
  };
  for (const method of chainMethodNames) {
    (stub[method] as ReturnType<typeof vi.fn>).mockReturnValue(stub);
  }
  return { mockKyselyChainStubs: stub };
});

vi.mock('../../lib/kysely.js', () => ({
  getKysely: () => mockKyselyChainStubs,
  destroyKysely: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock @supabase/supabase-js (needed by authRoutes plugin loaded in buildApp)
// ---------------------------------------------------------------------------

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithOtp: vi.fn(),
      admin: { signOut: vi.fn() },
    },
  })),
}));

// Import AFTER all mocks
const { buildApp } = await import('../../app.js');

// ---------------------------------------------------------------------------
// Config (mirrors f107a.authRoutes.integration.test.ts)
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
// Real Prisma client against test DB
// ---------------------------------------------------------------------------

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

// ---------------------------------------------------------------------------
// Fixture constants — fd013000 prefix to avoid collisions
// ---------------------------------------------------------------------------

// actor.externalId used as X-Actor-Id header (must be a valid UUID)
const ACTOR_EXT_ID = 'fd013000-e001-4000-a000-000000000001';
// auth_user_id for the bearer sub
const AUTH_USER_ID = 'fd013000-0001-4000-a000-000000000001';

// A minimal valid processMessage response (estimate intent)
const MOCK_NUTRIENTS = {
  calories: 550, proteins: 25, carbohydrates: 45, sugars: 9,
  fats: 26, saturatedFats: 10, fiber: 2, salt: 2.2, sodium: 880,
  transFats: 0.2, cholesterol: 80, potassium: 320,
  monounsaturatedFats: 12, polyunsaturatedFats: 4, alcohol: 0,
  referenceBasis: 'per_serving' as const,
};

const MOCK_RESULT = {
  entityType: 'dish' as const,
  entityId: 'fd013000-0099-4000-a000-000000000099',
  name: 'Paella', nameEs: 'Paella',
  restaurantId: null, chainSlug: null, portionGrams: 350,
  nutrients: MOCK_NUTRIENTS, confidenceLevel: 'high' as const,
  estimationMethod: 'official' as const,
  source: { id: 'fd013000-0099-4000-a000-000000000099', name: 'Test', type: 'official' as const, url: 'https://example.com' },
  similarityDistance: null,
};

const MOCK_ESTIMATE_RESPONSE = {
  intent: 'estimation' as const,
  actorId: ACTOR_EXT_ID,
  activeContext: null,
  estimation: {
    query: 'paella',
    chainSlug: null,
    portionMultiplier: 1,
    level1Hit: true, level2Hit: false, level3Hit: false, level4Hit: false,
    matchType: 'exact_dish' as const,
    result: MOCK_RESULT,
    cachedAt: null,
  },
};

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Pre-cleanup: delete any query_logs rows for our fixture actor, then the actor itself
  await prisma.$executeRaw`
    DELETE FROM query_logs
    WHERE actor_id IN (
      SELECT id FROM actors WHERE external_id = ${ACTOR_EXT_ID}
    )
  `;
  await prisma.$executeRaw`
    DELETE FROM actors WHERE external_id = ${ACTOR_EXT_ID}
  `;
});

afterAll(async () => {
  // Teardown in FK order
  await prisma.$executeRaw`
    DELETE FROM query_logs
    WHERE actor_id IN (
      SELECT id FROM actors WHERE external_id = ${ACTOR_EXT_ID}
    )
  `;
  await prisma.$executeRaw`
    DELETE FROM actors WHERE external_id = ${ACTOR_EXT_ID}
  `;
  await prisma.$disconnect();
});

beforeEach(() => {
  mockVerifyBearerJwt.mockReset();
  mockProcessMessage.mockReset();
  mockRedisGet.mockReset();
  mockRedisSet.mockReset();
  mockRedisIncr.mockReset();
  mockRedisExpire.mockReset();

  // Rate limiter: allow up to 50 queries
  mockRedisIncr.mockResolvedValue(1);
  mockRedisExpire.mockResolvedValue(1);
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue('OK');
});

// ---------------------------------------------------------------------------
// AC1 + AC7 — Integration test at the real DB boundary
// ---------------------------------------------------------------------------

describe('BUG-PROD-013 — POST /conversation/message with bearer + X-Actor-Id (AC1 + AC7)', () => {
  it('AC1: valid bearer + X-Actor-Id → HTTP 200 (not 500 "Actor resolution failed")', async () => {
    mockVerifyBearerJwt.mockResolvedValue({
      sub: AUTH_USER_ID,
      email: 'user@example.com',
      aud: 'authenticated',
      iss: 'https://test.supabase.co/auth/v1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    mockProcessMessage.mockResolvedValue(MOCK_ESTIMATE_RESPONSE);

    const app = await buildApp({
      config: testConfig as unknown as import('../../config.js').Config,
      prisma,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/conversation/message',
      headers: {
        authorization: 'Bearer eyJtestvalid.jwt.token',
        'x-actor-id': ACTOR_EXT_ID,
        'content-type': 'application/json',
      },
      payload: { text: 'paella' },
    });

    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    // Must NOT be 500 INTERNAL_ERROR "Actor resolution failed"
    expect(body.error).toBeUndefined();
  });

  it('AC7: query_logs row written with non-null actor_id for bearer-authenticated request', async () => {
    mockVerifyBearerJwt.mockResolvedValue({
      sub: AUTH_USER_ID,
      email: 'user@example.com',
      aud: 'authenticated',
      iss: 'https://test.supabase.co/auth/v1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    mockProcessMessage.mockResolvedValue(MOCK_ESTIMATE_RESPONSE);

    const app = await buildApp({
      config: testConfig as unknown as import('../../config.js').Config,
      prisma,
    });

    // Pre-cleanup: remove any existing query_logs for this actor
    await prisma.$executeRaw`
      DELETE FROM query_logs
      WHERE actor_id IN (
        SELECT id FROM actors WHERE external_id = ${ACTOR_EXT_ID}
      )
    `;

    const res = await app.inject({
      method: 'POST',
      url: '/conversation/message',
      headers: {
        authorization: 'Bearer eyJtestvalid.jwt.token',
        'x-actor-id': ACTOR_EXT_ID,
        'content-type': 'application/json',
      },
      payload: { text: 'paella' },
    });

    expect(res.statusCode).toBe(200);

    // Flush the fire-and-forget 'finish' listener that calls writeQueryLog.
    // The listener is synchronously registered, but writeQueryLog involves a real
    // DB round-trip. Give it time to complete before querying.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Assert: query_logs row exists with non-null actor_id
    const rows = await prisma.$queryRaw<{ actor_id: string | null; query_text: string }[]>`
      SELECT ql.actor_id, ql.query_text
      FROM query_logs ql
      INNER JOIN actors a ON a.id = ql.actor_id
      WHERE a.external_id = ${ACTOR_EXT_ID}
      ORDER BY ql.queried_at DESC
      LIMIT 1
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.['actor_id']).not.toBeNull();
    expect(rows[0]?.['query_text']).toBe('paella');

    await app.close();
  });
});
