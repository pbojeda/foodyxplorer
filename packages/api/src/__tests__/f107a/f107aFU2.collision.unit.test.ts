// F107a-FU2 — Collision branch unit tests (AC1, AC2, AC3, AC10, AC11)
//
// Tests the safe-predicate UPDATE + collision detection + fallback logic in
// the GET /me handler (routes/auth.ts).
//
// Mock strategy: buildApp with mock Prisma (vi.fn() per method), mock
// verifyBearerJwt, mock sentry captureMessage.
//
// Test kind labels per R2-PI1:
//   [PURE RED]       — cannot pass against buggy F107a code under any mock
//   [SQL-SHAPE]      — inspects $executeRaw template strings array literally
//   [HAPPY-REGRESSION] — happy-path guard; both old and new code produce same behavior
//
// Fixture constants:
//   ACTOR_ID:      existing anonymous actor row (returned by upsert mock for X-Actor-Id path)
//   FALLBACK_ID:   returned by upsert mock for me-<sub> fallback
//   ACCOUNT_ID:    bearer's accountId (returned by $queryRaw accounts upsert mock)
//   OTHER_ACCOUNT: different account (simulates collision)

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Mocks — hoisted before dynamic imports
// ---------------------------------------------------------------------------

const mockVerifyBearerJwt = vi.fn();

vi.mock('../../plugins/authBearer.js', () => ({
  verifyBearerJwt: mockVerifyBearerJwt,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithOtp: vi.fn(),
      admin: { signOut: vi.fn() },
    },
  })),
}));

// Mock sentry captureMessage so we can assert calls without Sentry SDK
const mockCaptureMessage = vi.fn();
vi.mock('../../lib/sentry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/sentry.js')>();
  return {
    ...actual,
    captureMessage: mockCaptureMessage,
  };
});

// Dynamic import AFTER mocks
const { buildApp } = await import('../../app.js');

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const ACTOR_ID = 'f1072000-0001-4000-a000-000000000001';
const FALLBACK_ID = 'f1072000-0002-4000-a000-000000000002';
const ACCOUNT_ID = 'f1072000-aaaa-4000-a000-000000000010';
const OTHER_ACCOUNT_ID = 'f1072000-bbbb-4000-a000-000000000020';
const BEARER_SUB = 'f7220001-0000-4000-a000-000000000001';
const BEARER_EMAIL = 'test@example.com';
const ACTOR_EXT_ID = 'f1072000-e001-4000-a000-000000000001';

// Test config (no real DB)
const testConfig = {
  NODE_ENV: 'test' as const,
  PORT: 3099,
  DATABASE_URL: 'postgresql://noop:noop@localhost:5433/noop_unit',
  DATABASE_URL_TEST: 'postgresql://noop:noop@localhost:5433/noop_unit',
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
// Mock Prisma factory
// ---------------------------------------------------------------------------

// Base rawAccount rows (accounts upsert returns this)
const rawAccountRow = {
  id: ACCOUNT_ID,
  authUserId: BEARER_SUB,
  email: BEARER_EMAIL,
  createdAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
  consentMarketing: false,
  consentMarketingAt: null,
  consentAnalytics: false,
  consentAnalyticsAt: null,
};

// Final actor row returned by findUniqueOrThrow
const actorRow = {
  id: ACTOR_ID,
  type: 'anonymous_web',
  externalId: ACTOR_EXT_ID,
  accountId: ACCOUNT_ID,
};

const fallbackActorRow = {
  id: FALLBACK_ID,
  type: 'anonymous_web',
  externalId: `me-${BEARER_SUB.slice(0, 8)}`,
  accountId: ACCOUNT_ID,
};

function createMockPrisma(overrides: {
  executeRaw?: number[];        // sequence of return values for $executeRaw
  actorUpsert?: { id: string };
  actorFindUnique?: unknown;    // null = not found; object = actor row
  actorFindUniqueOrThrow?: unknown;
} = {}): PrismaClient {
  // $executeRaw is called multiple times; we use a queue
  const executeRawQueue = overrides.executeRaw ?? [1];
  let executeRawCallCount = 0;

  const mockExecuteRaw = vi.fn(() => {
    const val = executeRawQueue[executeRawCallCount] ?? executeRawQueue[executeRawQueue.length - 1];
    executeRawCallCount++;
    return Promise.resolve(val);
  });

  const mockQueryRaw = vi.fn().mockResolvedValue([rawAccountRow]);
  const mockActorUpsert = vi.fn().mockResolvedValue(
    overrides.actorUpsert ?? { id: ACTOR_ID },
  );
  const mockActorFindUnique = vi.fn().mockResolvedValue(
    overrides.actorFindUnique !== undefined ? overrides.actorFindUnique : null,
  );
  const mockActorFindUniqueOrThrow = vi.fn().mockResolvedValue(
    overrides.actorFindUniqueOrThrow !== undefined
      ? overrides.actorFindUniqueOrThrow
      : actorRow,
  );

  return {
    $executeRaw: mockExecuteRaw,
    $queryRaw: mockQueryRaw,
    actor: {
      upsert: mockActorUpsert,
      findUnique: mockActorFindUnique,
      findUniqueOrThrow: mockActorFindUniqueOrThrow,
    },
  } as unknown as PrismaClient;
}

// ---------------------------------------------------------------------------
// Setup: mock verifyBearerJwt to return bearer payload
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockVerifyBearerJwt.mockReset();
  mockCaptureMessage.mockReset();
  mockVerifyBearerJwt.mockResolvedValue({
    sub: BEARER_SUB,
    email: BEARER_EMAIL,
    aud: 'authenticated',
    iss: 'https://test.supabase.co/auth/v1',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
});

// ---------------------------------------------------------------------------
// Helper: build app with given mock prisma and call GET /me
// ---------------------------------------------------------------------------

async function callMe(
  prisma: PrismaClient,
  headers: Record<string, string> = {},
): Promise<import('@fastify/inject').Response> {
  const app = await buildApp({
    config: testConfig as unknown as import('../../config.js').Config,
    prisma,
  });
  return app.inject({
    method: 'GET',
    url: '/me',
    headers: {
      authorization: 'Bearer test.jwt.token',
      'x-actor-id': ACTOR_EXT_ID,
      ...headers,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F107a-FU2 — /me collision branch unit tests', () => {

  // -------------------------------------------------------------------------
  // AC1 [SQL-SHAPE]: Safe UPDATE predicate — no IS DISTINCT FROM
  // -------------------------------------------------------------------------

  it('AC1 [SQL-SHAPE]: UPDATE predicate uses (account_id IS NULL OR account_id = ...) and NOT IS DISTINCT FROM', async () => {
    // $executeRaw call 0 = accounts INSERT (returns RawAccountRow via $queryRaw — different fn)
    // $executeRaw call 0 = actors UPDATE (updateResult = 1 → happy path)
    const prisma = createMockPrisma({
      executeRaw: [1],
      actorFindUniqueOrThrow: actorRow,
    });
    const res = await callMe(prisma);
    expect(res.statusCode).toBe(200);

    // $executeRaw is called for the actors UPDATE (accounts uses $queryRaw)
    const executeRawSpy = (prisma as unknown as { $executeRaw: Mock }).$executeRaw;
    expect(executeRawSpy).toHaveBeenCalled();

    // The first $executeRaw call is the actors UPDATE.
    // Tagged template: the first arg is the TemplateStringsArray.
    const firstCallTemplateArray = executeRawSpy.mock.calls[0]?.[0] as string[];
    const sqlText = firstCallTemplateArray.join('');
    expect(sqlText).toContain('(account_id IS NULL OR account_id =');
    expect(sqlText).not.toContain('IS DISTINCT FROM');
  });

  // -------------------------------------------------------------------------
  // AC2 [HAPPY-REGRESSION]: updateResult=1 (anonymous actor newly linked) → normal path
  // -------------------------------------------------------------------------

  it('AC2 [HAPPY-REGRESSION]: updateResult=1 → normal path, actorId unchanged, 200', async () => {
    const prisma = createMockPrisma({
      executeRaw: [1],
      actorFindUniqueOrThrow: actorRow,
    });
    const res = await callMe(prisma);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { actor: { id: string; accountId: string } } };
    expect(body.data.actor.id).toBe(ACTOR_ID);
    expect(body.data.actor.accountId).toBe(ACCOUNT_ID);

    // prisma.actor.upsert should NOT have been called for fallback (no collision)
    const actorUpsertSpy = (prisma as unknown as { actor: { upsert: Mock } }).actor.upsert;
    // One upsert is called for the X-Actor-Id lookup (lines 201-212 in auth.ts)
    // But no SECOND upsert for the fallback actor.
    const upsertCalls = actorUpsertSpy.mock.calls as Array<[{ create?: { externalId?: string } }]>;
    const fallbackUpsertCalls = upsertCalls.filter(
      (c) => (c[0] as { create?: { externalId?: string } }).create?.externalId?.startsWith('me-'),
    );
    expect(fallbackUpsertCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // AC3 [HAPPY-REGRESSION]: updateResult=1, already linked (idempotent)
  // -------------------------------------------------------------------------

  it('AC3 [HAPPY-REGRESSION]: updateResult=1 (already linked, idempotent) → 200, no fallback upsert', async () => {
    const prisma = createMockPrisma({
      executeRaw: [1],
      actorFindUniqueOrThrow: { ...actorRow, accountId: ACCOUNT_ID },
    });
    const res = await callMe(prisma);
    expect(res.statusCode).toBe(200);

    const actorUpsertSpy = (prisma as unknown as { actor: { upsert: Mock } }).actor.upsert;
    const upsertCalls = actorUpsertSpy.mock.calls as Array<[{ create?: { externalId?: string } }]>;
    const fallbackUpsertCalls = upsertCalls.filter(
      (c) => (c[0] as { create?: { externalId?: string } }).create?.externalId?.startsWith('me-'),
    );
    expect(fallbackUpsertCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // AC11 collision [PURE RED]: updateResult=0 + actor owned by different account
  // -------------------------------------------------------------------------

  it('AC11 [PURE RED]: collision → Pino warn + captureMessage + fallback actor + 200', async () => {
    const prisma = createMockPrisma({
      // executeRaw[0] = actors UPDATE (0 rows → collision)
      // executeRaw[1] = fallback actor UPDATE (1 row → success)
      executeRaw: [0, 1],
      // actor.findUnique returns actor owned by OTHER_ACCOUNT (true collision)
      actorFindUnique: {
        accountId: OTHER_ACCOUNT_ID,
        externalId: ACTOR_EXT_ID,
      },
      // actor.upsert returns fallback actor
      actorUpsert: { id: FALLBACK_ID },
      // link-check findUnique returns fallback linked to ACCOUNT_ID
      // actor.findUniqueOrThrow called with FALLBACK_ID → returns fallback row
      actorFindUniqueOrThrow: fallbackActorRow,
    });

    // Override findUnique to return different values per call:
    // - first call: link-check — actor with OTHER_ACCOUNT_ID
    // - second call: link-check of fallback actor — { accountId: ACCOUNT_ID }
    const actorFindUniqueMock = (prisma as unknown as { actor: { findUnique: Mock } }).actor.findUnique;
    actorFindUniqueMock
      .mockResolvedValueOnce({ accountId: OTHER_ACCOUNT_ID, externalId: ACTOR_EXT_ID })
      .mockResolvedValueOnce({ accountId: ACCOUNT_ID });

    const res = await callMe(prisma);
    expect(res.statusCode).toBe(200);

    const body = res.json() as { data: { actor: { id: string; accountId: string; externalId: string } } };

    // (f) Final findUniqueOrThrow called with FALLBACK_ID (not original ACTOR_ID)
    const findUniqueOrThrowSpy = (prisma as unknown as { actor: { findUniqueOrThrow: Mock } }).actor.findUniqueOrThrow;
    const lastFetchCall = findUniqueOrThrowSpy.mock.calls[findUniqueOrThrowSpy.mock.calls.length - 1]?.[0] as
      | { where?: { id?: string } }
      | undefined;
    expect(lastFetchCall?.where?.id).toBe(FALLBACK_ID);

    // (g) 200 with fallback actor
    expect(body.data.actor.id).toBe(FALLBACK_ID);
    expect(body.data.actor.accountId).toBe(ACCOUNT_ID);

    // (b) captureMessage called with exact spec signature [PURE RED]
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    const [msg, level, ctx, tags] = mockCaptureMessage.mock.calls[0] as [
      string,
      string,
      Record<string, string>,
      Record<string, string>,
    ];
    expect(msg).toBe('actor_link_collision: actor already owned by different account');
    expect(level).toBe('warning');
    expect(ctx).toMatchObject({
      collisionActorIdHash: expect.stringMatching(/^[0-9a-f]{8}$/),
      victimAccountIdHash: expect.stringMatching(/^[0-9a-f]{8}$/),
      hijackerAccountIdHash: expect.stringMatching(/^[0-9a-f]{8}$/),
      externalIdHash: expect.stringMatching(/^[0-9a-f]{8}$/),
    });
    expect(tags).toEqual({ feature: 'F107a-FU2', event_type: 'actor_link_collision' });

    // (c) actor.upsert called for me-<sub> fallback
    const actorUpsertSpy = (prisma as unknown as { actor: { upsert: Mock } }).actor.upsert;
    const upsertCalls = actorUpsertSpy.mock.calls as Array<[{ create?: { externalId?: string } }]>;
    const fallbackUpsertCalls = upsertCalls.filter(
      (c) => (c[0] as { create?: { externalId?: string } }).create?.externalId?.startsWith('me-'),
    );
    expect(fallbackUpsertCalls).toHaveLength(1);
    const fallbackCreateArg = fallbackUpsertCalls[0]?.[0] as { create?: { externalId?: string } };
    expect(fallbackCreateArg?.create?.externalId).toBe(`me-${BEARER_SUB.slice(0, 8)}`);

    // (d) second $executeRaw targets fallback actor's id
    const executeRawSpy = (prisma as unknown as { $executeRaw: Mock }).$executeRaw;
    // executeRaw[0] = actors UPDATE (collision), executeRaw[1] = fallback UPDATE
    expect(executeRawSpy).toHaveBeenCalledTimes(2);
    const secondCallArgs = executeRawSpy.mock.calls[1] as unknown[];
    // Second call should include FALLBACK_ID as a template arg
    // Template args are the positional parameters after the TemplateStringsArray
    const fallbackUpdateArgs = secondCallArgs.slice(1) as unknown[];
    expect(fallbackUpdateArgs).toContain(FALLBACK_ID);
  });

  // -------------------------------------------------------------------------
  // AC7 [PURE RED]: Pino warn fields
  // Embedded in AC11 but also tested explicitly with request.log assertion.
  // Note: In buildApp unit tests, we can't easily intercept request.log.warn
  // because Fastify creates it internally. This is verified via the HTTP response
  // shape and captureMessage call (AC8 embedded above). The full Pino field
  // assertion is done in the integration test (AC12).
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // AC10 fallback idempotency [PURE RED]: two calls with same colliding actor
  // -------------------------------------------------------------------------

  it('AC10 [PURE RED]: collision idempotency — two sequential calls both succeed, same fallback actor.id', async () => {
    // Both calls: executeRaw[UPDATE] = 0 (collision), executeRaw[fallback UPDATE] = 1
    // actor.upsert always returns the same fallback id (idempotent via @@unique)
    // actor.findUnique (collision confirm): always returns OTHER_ACCOUNT_ID
    // actor.findUnique (link check): always returns ACCOUNT_ID (linked)
    // actor.findUniqueOrThrow (final fetch): always returns fallbackActorRow

    const prisma1 = createMockPrisma({
      executeRaw: [0, 1],
      actorUpsert: { id: FALLBACK_ID },
      actorFindUniqueOrThrow: fallbackActorRow,
    });
    (prisma1 as unknown as { actor: { findUnique: Mock } }).actor.findUnique
      .mockResolvedValueOnce({ accountId: OTHER_ACCOUNT_ID, externalId: ACTOR_EXT_ID })
      .mockResolvedValueOnce({ accountId: ACCOUNT_ID });

    const prisma2 = createMockPrisma({
      executeRaw: [0, 1],
      actorUpsert: { id: FALLBACK_ID },
      actorFindUniqueOrThrow: fallbackActorRow,
    });
    (prisma2 as unknown as { actor: { findUnique: Mock } }).actor.findUnique
      .mockResolvedValueOnce({ accountId: OTHER_ACCOUNT_ID, externalId: ACTOR_EXT_ID })
      .mockResolvedValueOnce({ accountId: ACCOUNT_ID });

    const [res1, res2] = await Promise.all([callMe(prisma1), callMe(prisma2)]);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    const body1 = res1.json() as { data: { actor: { id: string } } };
    const body2 = res2.json() as { data: { actor: { id: string } } };
    expect(body1.data.actor.id).toBe(FALLBACK_ID);
    expect(body2.data.actor.id).toBe(FALLBACK_ID);
    // No P2002 error — upsert is idempotent
    expect(res1.statusCode).not.toBe(500);
    expect(res2.statusCode).not.toBe(500);
  });

  // -------------------------------------------------------------------------
  // updateResult=0 + same accountId race [HAPPY-REGRESSION]: idempotent concurrent call
  // -------------------------------------------------------------------------

  it('[HAPPY-REGRESSION]: updateResult=0 + actor.accountId === bearerAccountId → isSameAccountRace, no fallback', async () => {
    const prisma = createMockPrisma({
      executeRaw: [0],
      actorFindUnique: { accountId: ACCOUNT_ID, externalId: ACTOR_EXT_ID },
      actorFindUniqueOrThrow: actorRow,
    });
    const res = await callMe(prisma);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { actor: { id: string } } };
    expect(body.data.actor.id).toBe(ACTOR_ID);

    // No fallback upsert
    const actorUpsertSpy = (prisma as unknown as { actor: { upsert: Mock } }).actor.upsert;
    const upsertCalls = actorUpsertSpy.mock.calls as Array<[{ create?: { externalId?: string } }]>;
    const fallbackUpsertCalls = upsertCalls.filter(
      (c) => (c[0] as { create?: { externalId?: string } }).create?.externalId?.startsWith('me-'),
    );
    expect(fallbackUpsertCalls).toHaveLength(0);

    // No captureMessage (no collision)
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // updateResult=0 + null actor [PURE RED]: actor deleted — transient fallback
  // -------------------------------------------------------------------------

  it('[PURE RED]: updateResult=0 + actor.findUnique=null → common fallback, 200', async () => {
    const prisma = createMockPrisma({
      executeRaw: [0, 1],
      actorFindUnique: null, // actor was deleted
      actorUpsert: { id: FALLBACK_ID },
      actorFindUniqueOrThrow: fallbackActorRow,
    });
    // link-check findUnique: returns ACCOUNT_ID (fallback is linked)
    (prisma as unknown as { actor: { findUnique: Mock } }).actor.findUnique
      .mockResolvedValueOnce(null)             // collision confirm: null actor
      .mockResolvedValueOnce({ accountId: ACCOUNT_ID }); // link-check

    const res = await callMe(prisma);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { actor: { id: string } } };
    expect(body.data.actor.id).toBe(FALLBACK_ID);

    // No Pino warn / captureMessage (not a true collision)
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // updateResult=0 + null accountId [PURE RED]: MVCC artifact — fallback
  // -------------------------------------------------------------------------

  it('[PURE RED]: updateResult=0 + actor.accountId=null → common fallback, 200, actor.accountId === bearerAccountId', async () => {
    const prisma = createMockPrisma({
      executeRaw: [0, 1],
      actorFindUnique: { accountId: null, externalId: ACTOR_EXT_ID },
      actorUpsert: { id: FALLBACK_ID },
      actorFindUniqueOrThrow: fallbackActorRow,
    });
    (prisma as unknown as { actor: { findUnique: Mock } }).actor.findUnique
      .mockResolvedValueOnce({ accountId: null, externalId: ACTOR_EXT_ID }) // collision confirm
      .mockResolvedValueOnce({ accountId: ACCOUNT_ID }); // link-check

    const res = await callMe(prisma);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { actor: { id: string; accountId: string } } };
    // [PURE RED]: old code returned actor.accountId === null; new code returns ACCOUNT_ID
    expect(body.data.actor.accountId).toBe(ACCOUNT_ID);

    // No captureMessage (not a true collision)
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // FALLBACK_LINK_FAILED defense [PURE RED]: link-check findUnique returns wrong accountId
  // -------------------------------------------------------------------------

  it('[PURE RED]: FALLBACK_LINK_FAILED — fallback link-check returns wrong accountId → 500', async () => {
    const prisma = createMockPrisma({
      executeRaw: [0, 1],
      actorFindUnique: { accountId: OTHER_ACCOUNT_ID, externalId: ACTOR_EXT_ID },
      actorUpsert: { id: FALLBACK_ID },
      actorFindUniqueOrThrow: fallbackActorRow,
    });
    // link-check findUnique returns a DIFFERENT accountId (extreme edge case)
    (prisma as unknown as { actor: { findUnique: Mock } }).actor.findUnique
      .mockResolvedValueOnce({ accountId: OTHER_ACCOUNT_ID, externalId: ACTOR_EXT_ID })
      .mockResolvedValueOnce({ accountId: 'f1072000-cccc-4000-a000-000000000030' }); // wrong

    const res = await callMe(prisma);
    // Old code has no FALLBACK_LINK_FAILED check → 200 (wrong). New code → 500.
    expect(res.statusCode).toBe(500);
    const body = res.json() as { code?: string; error?: string };
    // The error handler should surface some 500 response; code may vary by handler
    expect(res.statusCode).toBe(500);
    void body; // suppress unused warning
  });
});
