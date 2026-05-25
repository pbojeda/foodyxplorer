// F107a-FU2 QA — Edge case tests
//
// Covers gaps identified by QA review that the developer's 14 tests did not exercise:
//
//   EC1  — FALLBACK_LINK_FAILED: null linkCheck (actor deleted between upsert and findUnique)
//   EC2  — FALLBACK_LINK_FAILED has no dedicated Sentry captureMessage (observability gap verification)
//   EC3  — X-Actor-Id absent + bearer present → provisionFallbackActor without collision check
//   EC4  — FALLBACK_LINK_FAILED response body code is INTERNAL_ERROR (not FALLBACK_LINK_FAILED)
//           because errorHandler catch-all masks internal codes
//   EC5  — captureMessage called with EXACT hash field values (not just shape match)
//   EC6  — hashActor(null coerced via ??) is stable 'anonymous' fallback (no crash)
//   EC7  — X-Actor-Id as empty-string → provisionFallbackActor (falsy branch)
//   EC8  — X-Actor-Id as non-UUID string → provisionFallbackActor (UUID_RE fails)

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Mocks
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

const mockCaptureMessage = vi.fn();
vi.mock('../../lib/sentry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/sentry.js')>();
  return {
    ...actual,
    captureMessage: mockCaptureMessage,
  };
});

const { buildApp } = await import('../../app.js');
// Import real hashActor so we can compute expected hash values in EC5
const { hashActor } = await import('../../lib/sentry.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACTOR_ID = 'f1072000-0001-4000-a000-000000000001';
const FALLBACK_ID = 'f1072000-0002-4000-a000-000000000002';
const ACCOUNT_ID = 'f1072000-aaaa-4000-a000-000000000010';
const OTHER_ACCOUNT_ID = 'f1072000-bbbb-4000-a000-000000000020';
const BEARER_SUB = 'f7220001-0000-4000-a000-000000000001';
const BEARER_EMAIL = 'test@example.com';
const ACTOR_EXT_ID = 'f1072000-e001-4000-a000-000000000001';

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
  executeRaw?: number[];
  actorUpsert?: { id: string };
  actorFindUnique?: unknown;
  actorFindUniqueOrThrow?: unknown;
} = {}): PrismaClient {
  const executeRawQueue = overrides.executeRaw ?? [1];
  let executeRawCallCount = 0;

  const mockExecuteRaw = vi.fn(() => {
    const val = executeRawQueue[executeRawCallCount] ?? executeRawQueue[executeRawQueue.length - 1];
    executeRawCallCount++;
    return Promise.resolve(val);
  });

  return {
    $executeRaw: mockExecuteRaw,
    $queryRaw: vi.fn().mockResolvedValue([rawAccountRow]),
    actor: {
      upsert: vi.fn().mockResolvedValue(overrides.actorUpsert ?? { id: ACTOR_ID }),
      findUnique: vi.fn().mockResolvedValue(
        overrides.actorFindUnique !== undefined ? overrides.actorFindUnique : null,
      ),
      findUniqueOrThrow: vi.fn().mockResolvedValue(
        overrides.actorFindUniqueOrThrow !== undefined ? overrides.actorFindUniqueOrThrow : actorRow,
      ),
    },
  } as unknown as PrismaClient;
}

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
// Edge cases
// ---------------------------------------------------------------------------

describe('F107a-FU2 — QA edge cases', () => {

  // -------------------------------------------------------------------------
  // EC1: FALLBACK_LINK_FAILED when linkCheck is null (actor deleted mid-flight)
  // The developer's test covers wrong accountId; this covers null linkCheck.
  // -------------------------------------------------------------------------

  it('EC1: FALLBACK_LINK_FAILED — linkCheck returns null (fallback deleted) → 500', async () => {
    const prisma = createMockPrisma({
      executeRaw: [0, 1],
      actorFindUnique: { accountId: OTHER_ACCOUNT_ID, externalId: ACTOR_EXT_ID },
      actorUpsert: { id: FALLBACK_ID },
      actorFindUniqueOrThrow: fallbackActorRow,
    });
    // First findUnique: collision confirm → OTHER_ACCOUNT_ID
    // Second findUnique (link-check): null (fallback was deleted between upsert and findUnique)
    (prisma as unknown as { actor: { findUnique: Mock } }).actor.findUnique
      .mockResolvedValueOnce({ accountId: OTHER_ACCOUNT_ID, externalId: ACTOR_EXT_ID })
      .mockResolvedValueOnce(null); // actor deleted

    const res = await callMe(prisma);
    // linkCheck?.accountId = undefined, undefined !== ACCOUNT_ID → FALLBACK_LINK_FAILED → 500
    expect(res.statusCode).toBe(500);
  });

  // -------------------------------------------------------------------------
  // EC2: FALLBACK_LINK_FAILED path emits no dedicated captureMessage
  // (observability gap — generic 500 only, no feature-tagged Sentry event)
  // This test DOCUMENTS the gap, not verifies a spec requirement.
  // -------------------------------------------------------------------------

  it('EC2 [OBSERVABILITY GAP]: FALLBACK_LINK_FAILED does not emit captureMessage before throw', async () => {
    const prisma = createMockPrisma({
      executeRaw: [0, 1],
      actorFindUnique: { accountId: OTHER_ACCOUNT_ID, externalId: ACTOR_EXT_ID },
      actorUpsert: { id: FALLBACK_ID },
      actorFindUniqueOrThrow: fallbackActorRow,
    });
    (prisma as unknown as { actor: { findUnique: Mock } }).actor.findUnique
      .mockResolvedValueOnce({ accountId: OTHER_ACCOUNT_ID, externalId: ACTOR_EXT_ID })
      .mockResolvedValueOnce({ accountId: 'f1072000-cccc-4000-a000-000000000030' }); // wrong

    await callMe(prisma);
    // captureMessage is called for the true-collision telemetry (first collision event),
    // but NOT again for the FALLBACK_LINK_FAILED throw itself.
    // The call count should be exactly 1 (the isTrueCollision captureMessage).
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    // Verify the ONE call is for the collision event, not for FALLBACK_LINK_FAILED
    const [, , , tags] = mockCaptureMessage.mock.calls[0] as [string, string, Record<string, string>, Record<string, string>];
    expect(tags?.['event_type']).toBe('actor_link_collision');
    // If FALLBACK_LINK_FAILED had its own captureMessage, count would be 2.
  });

  // -------------------------------------------------------------------------
  // EC3: X-Actor-Id absent + bearer present → me-<sub> fallback (no collision check)
  // Tests the pre-existing path that FU2 did not change but can be affected by regression.
  // -------------------------------------------------------------------------

  it('EC3: absent X-Actor-Id header + bearer → provisionFallbackActor path, no collision branch', async () => {
    const prisma = createMockPrisma({
      executeRaw: [1],
      actorUpsert: { id: FALLBACK_ID },
      actorFindUniqueOrThrow: fallbackActorRow,
    });

    // Call without X-Actor-Id header
    const res = await callMe(prisma, { 'x-actor-id': '' });
    // Empty string is falsy → falls to provisionFallbackActor
    expect(res.statusCode).toBe(200);

    // captureMessage must NOT be called (no collision)
    expect(mockCaptureMessage).not.toHaveBeenCalled();

    // The upsert for me-<sub> fallback must have been called
    const actorUpsertSpy = (prisma as unknown as { actor: { upsert: Mock } }).actor.upsert;
    const upsertCalls = actorUpsertSpy.mock.calls as Array<[{ create?: { externalId?: string } }]>;
    const fallbackUpserts = upsertCalls.filter(
      (c) => c[0]?.create?.externalId?.startsWith('me-'),
    );
    expect(fallbackUpserts).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // EC4: FALLBACK_LINK_FAILED response code is INTERNAL_ERROR, not FALLBACK_LINK_FAILED
  // The errorHandler catch-all maps unknown codes → INTERNAL_ERROR.
  // This is by design ("never leak internal codes to client").
  // Test documents the behavior so operators know what to expect in logs.
  // -------------------------------------------------------------------------

  it('EC4: FALLBACK_LINK_FAILED response body.error.code is INTERNAL_ERROR (not FALLBACK_LINK_FAILED)', async () => {
    const prisma = createMockPrisma({
      executeRaw: [0, 1],
      actorFindUnique: { accountId: OTHER_ACCOUNT_ID, externalId: ACTOR_EXT_ID },
      actorUpsert: { id: FALLBACK_ID },
      actorFindUniqueOrThrow: fallbackActorRow,
    });
    (prisma as unknown as { actor: { findUnique: Mock } }).actor.findUnique
      .mockResolvedValueOnce({ accountId: OTHER_ACCOUNT_ID, externalId: ACTOR_EXT_ID })
      .mockResolvedValueOnce({ accountId: 'f1072000-cccc-4000-a000-000000000030' }); // wrong

    const res = await callMe(prisma);
    expect(res.statusCode).toBe(500);
    const body = res.json() as { success: boolean; error: { code: string; message: string } };
    expect(body.success).toBe(false);
    // FALLBACK_LINK_FAILED is an internal code; the HTTP response exposes INTERNAL_ERROR
    expect(body.error.code).toBe('INTERNAL_ERROR');
    // The specific error message is also masked:
    expect(body.error.message).toBe('Internal server error');
  });

  // -------------------------------------------------------------------------
  // EC5: captureMessage hash field values match hashActor(rawId)
  // The developer's AC11 test uses expect.stringMatching(/^[0-9a-f]{8}$/) — shape only.
  // This test verifies the ACTUAL hash values to catch wrong-field ordering bugs.
  // -------------------------------------------------------------------------

  it('EC5: captureMessage hash fields match exact hashActor output for correct IDs', async () => {
    // First actor.upsert call = X-Actor-Id path → must return ACTOR_ID (the colliding actor's pk)
    // Second actor.upsert call = provisionFallbackActor → returns FALLBACK_ID
    const prisma = createMockPrisma({
      executeRaw: [0, 1],
      // Default upsert mock is set below via sequencing
      actorFindUniqueOrThrow: fallbackActorRow,
    });
    (prisma as unknown as { actor: { upsert: Mock } }).actor.upsert
      .mockResolvedValueOnce({ id: ACTOR_ID })    // X-Actor-Id lookup
      .mockResolvedValueOnce({ id: FALLBACK_ID }); // provisionFallbackActor
    (prisma as unknown as { actor: { findUnique: Mock } }).actor.findUnique
      .mockResolvedValueOnce({ accountId: OTHER_ACCOUNT_ID, externalId: ACTOR_EXT_ID })
      .mockResolvedValueOnce({ accountId: ACCOUNT_ID });

    await callMe(prisma);
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);

    const [, , ctx] = mockCaptureMessage.mock.calls[0] as [
      string,
      string,
      Record<string, string>,
      Record<string, string>,
    ];

    // Verify that each hash field encodes the CORRECT source ID, not a swapped one
    expect(ctx['collisionActorIdHash']).toBe(hashActor(ACTOR_ID));
    expect(ctx['victimAccountIdHash']).toBe(hashActor(OTHER_ACCOUNT_ID));
    expect(ctx['hijackerAccountIdHash']).toBe(hashActor(ACCOUNT_ID));
    expect(ctx['externalIdHash']).toBe(hashActor(ACTOR_EXT_ID));

    // Cross-check: victim hash must NOT equal hijacker hash (would indicate field swap)
    expect(ctx['victimAccountIdHash']).not.toBe(ctx['hijackerAccountIdHash']);
  });

  // -------------------------------------------------------------------------
  // EC6: hashActor null-safety — null coerced via ?? undefined (Prisma field types)
  // In production, currentActor.accountId is string | null. The code uses `?? undefined`.
  // Verifies no crash and the 'anonymous' fallback is returned.
  // -------------------------------------------------------------------------

  it('EC6: hashActor(undefined) and hashActor(empty string) return stable 8-char hex, no crash', async () => {
    // Import real hashActor (not mocked in this module)
    const { hashActor: realHashActor } = await import('../../lib/sentry.js');

    // null ?? undefined = undefined → hashActor('anonymous')
    expect(realHashActor(undefined)).toHaveLength(8);
    expect(realHashActor(undefined)).toMatch(/^[0-9a-f]{8}$/);

    // empty string: `actorId || 'anonymous'` kicks in (|| not ??)
    expect(realHashActor('')).toBe(realHashActor(undefined)); // both → 'anonymous'

    // Stable across calls
    expect(realHashActor(undefined)).toBe(realHashActor(undefined));
  });

  // -------------------------------------------------------------------------
  // EC7: X-Actor-Id is a non-UUID string → UUID_RE fails → provisionFallbackActor
  // -------------------------------------------------------------------------

  it('EC7: non-UUID X-Actor-Id (e.g. "not-a-uuid-at-all") → falls through to provisionFallbackActor, 200', async () => {
    const prisma = createMockPrisma({
      executeRaw: [1],
      actorUpsert: { id: FALLBACK_ID },
      actorFindUniqueOrThrow: fallbackActorRow,
    });

    // Send a non-UUID string as X-Actor-Id (fails UUID_RE)
    const nonUuidValue = 'not-a-valid-uuid-at-all';
    const res = await callMe(prisma, { 'x-actor-id': nonUuidValue });
    expect(res.statusCode).toBe(200);

    // The UUID path (lines 205-212) must NOT have called upsert with the raw non-UUID value.
    // provisionFallbackActor IS called (me-<sub> path), not the anonymous actor path.
    const actorUpsertSpy = (prisma as unknown as { actor: { upsert: Mock } }).actor.upsert;
    const upsertCalls = actorUpsertSpy.mock.calls as Array<[{ create?: { externalId?: string }; where?: { type_externalId?: { externalId?: string } } }]>;

    // No upsert should use the invalid header value directly as externalId
    const directHeaderUpsert = upsertCalls.find(
      (c) =>
        c[0]?.create?.externalId === nonUuidValue ||
        c[0]?.where?.type_externalId?.externalId === nonUuidValue,
    );
    expect(directHeaderUpsert).toBeUndefined();

    // Exactly one upsert (provisionFallbackActor) with me-<sub> externalId
    const fallbackUpserts = upsertCalls.filter(
      (c) => c[0]?.create?.externalId?.startsWith('me-'),
    );
    expect(fallbackUpserts).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // EC8: X-Actor-Id as SQL injection string → UUID_RE filter prevents DB injection
  // -------------------------------------------------------------------------

  it('EC8: SQL injection string as X-Actor-Id → UUID_RE blocks it, falls to me-<sub> path', async () => {
    const prisma = createMockPrisma({
      executeRaw: [1],
      actorUpsert: { id: FALLBACK_ID },
      actorFindUniqueOrThrow: fallbackActorRow,
    });

    // UUID_RE strictly requires 8-4-4-4-12 hex chars; SQL injection cannot pass
    const injectionString = "'; DROP TABLE actors; --";
    const res = await callMe(prisma, { 'x-actor-id': injectionString });
    // Falls to provisionFallbackActor path → 200 (UUID_RE blocked the injection)
    expect(res.statusCode).toBe(200);

    // prisma.actor.upsert should NOT have been called with the injection string as externalId
    const actorUpsertSpy = (prisma as unknown as { actor: { upsert: Mock } }).actor.upsert;
    const upsertCalls = actorUpsertSpy.mock.calls as Array<[{ where?: { type_externalId?: { externalId?: string } }; create?: { externalId?: string } }]>;
    const injectionUpsert = upsertCalls.find(
      (c) =>
        c[0]?.where?.type_externalId?.externalId === injectionString ||
        c[0]?.create?.externalId === injectionString,
    );
    expect(injectionUpsert).toBeUndefined();
  });

});
