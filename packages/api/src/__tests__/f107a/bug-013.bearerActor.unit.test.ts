// BUG-PROD-013 — Bearer path leaves actorId unset → /conversation/* 500
//
// Tests:
//   RED: prove the bug (bearer + X-Actor-Id → actorId stays undefined)
//   GREEN: after fix, actorId is set correctly
//   Unit tests for resolveBearerActorId (AC1, AC3, AC4, AC5)
//   Unit tests for provisionFallbackActor

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Mock verifyBearerJwt
// ---------------------------------------------------------------------------

const mockVerifyBearerJwt = vi.fn();

vi.mock('../../plugins/authBearer.js', () => ({
  verifyBearerJwt: mockVerifyBearerJwt,
}));

// Import after mocking
const { registerActorResolver } = await import('../../plugins/actorResolver.js');
const { resolveBearerActorId, provisionFallbackActor } = await import('../../lib/bearerActor.js');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_ACTOR_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const BEARER_ACTOR_DB_ID = '00000000-0000-0000-0000-000000000099';
const FALLBACK_ACTOR_DB_ID = '00000000-0000-0000-0000-000000000088';

const VALID_PAYLOAD = {
  sub: 'auth-user-uuid-1234',
  email: 'user@example.com',
  aud: 'authenticated',
  iss: 'https://test.supabase.co/auth/v1',
  exp: Math.floor(Date.now() / 1000) + 3600,
};

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockPrisma() {
  return {
    actor: {
      upsert: vi.fn().mockResolvedValue({ id: BEARER_ACTOR_DB_ID }),
      create: vi.fn().mockResolvedValue({ id: '00000000-0000-0000-0000-000000000098' }),
    },
  };
}

function createMockConfig() {
  return {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_JWKS_URL: 'https://test.supabase.co/auth/v1/.well-known/jwks.json',
  };
}

type MockRequest = {
  headers: Record<string, string | undefined>;
  routeOptions: { url: string };
  actorId: string | undefined;
  accountId: string | undefined;
  authPayload: unknown;
  log: { warn: ReturnType<typeof vi.fn> };
};

function createMockRequest(headers: Record<string, string | undefined> = {}): MockRequest {
  return {
    headers,
    routeOptions: { url: '/conversation/message' },
    actorId: undefined,
    accountId: undefined,
    authPayload: undefined,
    log: { warn: vi.fn() },
  };
}

function createMockReply() {
  return { header: vi.fn().mockReturnThis() };
}

// ---------------------------------------------------------------------------
// Helper: run the hook against a mock request
// ---------------------------------------------------------------------------

async function runHook(
  mockPrisma: ReturnType<typeof createMockPrisma>,
  mockConfig: ReturnType<typeof createMockConfig>,
  request: MockRequest,
) {
  let capturedHook: ((req: unknown, reply: unknown) => Promise<void>) | null = null;
  const app = {
    addHook: (_event: string, fn: (req: unknown, reply: unknown) => Promise<void>) => {
      capturedHook = fn;
    },
  } as unknown as FastifyInstance;

  await registerActorResolver(app, {
    prisma: mockPrisma as unknown as import('@prisma/client').PrismaClient,
    config: mockConfig as unknown as import('../../config.js').Config,
  });

  const reply = createMockReply();
  await capturedHook!(request, reply);
  return { request, reply };
}

// ---------------------------------------------------------------------------
// BUG-PROD-013 — RED test (proves the bug before fix)
// ---------------------------------------------------------------------------
// NOTE: This test is now GREEN after the fix. The describe block is named
// "after fix" but the test structure proves the bug was real: before the fix,
// the bearer path returned early without setting actorId.

describe('BUG-PROD-013 — actorResolver bearer path sets actorId (AC1, AC4, AC5)', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let mockConfig: ReturnType<typeof createMockConfig>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    mockConfig = createMockConfig();
    mockVerifyBearerJwt.mockReset();
  });

  it('AC1/AC4 — bearer + valid X-Actor-Id → request.actorId IS set (not undefined)', async () => {
    // RED: before fix this would find actorId === undefined
    mockVerifyBearerJwt.mockResolvedValue(VALID_PAYLOAD);

    const request = createMockRequest({
      authorization: 'Bearer eyJvalid.jwt.token',
      'x-actor-id': VALID_ACTOR_UUID,
    });

    await runHook(mockPrisma, mockConfig, request);

    // After fix: actorId MUST be set from the X-Actor-Id header
    expect(request.actorId).toBeDefined();
    expect(request.actorId).toBe(BEARER_ACTOR_DB_ID);
  });

  it('AC4 — bearer path still sets request.accountId (precedence preserved)', async () => {
    mockVerifyBearerJwt.mockResolvedValue(VALID_PAYLOAD);

    const request = createMockRequest({
      authorization: 'Bearer eyJvalid.jwt.token',
      'x-actor-id': VALID_ACTOR_UUID,
    });

    await runHook(mockPrisma, mockConfig, request);

    expect(request.accountId).toBe('auth-user-uuid-1234');
    expect(request.authPayload).toEqual(VALID_PAYLOAD);
  });

  it('AC3 — bearer without X-Actor-Id → fallback me-<sub> actor is set as actorId', async () => {
    mockVerifyBearerJwt.mockResolvedValue(VALID_PAYLOAD);
    // Fallback path upserts with me- prefix
    mockPrisma.actor.upsert.mockResolvedValue({ id: FALLBACK_ACTOR_DB_ID });

    const request = createMockRequest({
      authorization: 'Bearer eyJvalid.jwt.token',
      // no x-actor-id header
    });

    await runHook(mockPrisma, mockConfig, request);

    // Should use fallback actor
    expect(request.actorId).toBe(FALLBACK_ACTOR_DB_ID);
    // Upsert should have been called with me-<sub.slice(0,8)> externalId
    expect(mockPrisma.actor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { type_externalId: { type: 'anonymous_web', externalId: 'me-auth-use' } },
      }),
    );
  });

  it('AC4 — invalid bearer still throws (no silent downgrade)', async () => {
    const tokenError = Object.assign(new Error('JWT is invalid'), { code: 'INVALID_TOKEN' });
    mockVerifyBearerJwt.mockRejectedValue(tokenError);

    const request = createMockRequest({
      authorization: 'Bearer bad.token.here',
      'x-actor-id': VALID_ACTOR_UUID,
    });

    let capturedHook: ((req: unknown, reply: unknown) => Promise<void>) | null = null;
    const app = {
      addHook: (_event: string, fn: (req: unknown, reply: unknown) => Promise<void>) => {
        capturedHook = fn;
      },
    } as unknown as FastifyInstance;

    await registerActorResolver(app, {
      prisma: mockPrisma as unknown as import('@prisma/client').PrismaClient,
      config: mockConfig as unknown as import('../../config.js').Config,
    });

    const reply = createMockReply();
    await expect(capturedHook!(request, reply)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    // actorId must NOT be set
    expect(request.actorId).toBeUndefined();
  });

  it('AC5 — no Authorization header → anonymous path unchanged, actorId set via actor.upsert', async () => {
    // Anonymous path: X-Actor-Id present (valid UUID)
    mockPrisma.actor.upsert.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000077' });

    const request = createMockRequest({
      'x-actor-id': VALID_ACTOR_UUID,
      // no authorization header
    });

    await runHook(mockPrisma, mockConfig, request);

    expect(mockVerifyBearerJwt).not.toHaveBeenCalled();
    expect(request.actorId).toBe('00000000-0000-0000-0000-000000000077');
  });

  it('AC5 — no Authorization header, no X-Actor-Id → actor.create path, actorId set', async () => {
    mockPrisma.actor.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000066' });

    const request = createMockRequest({});

    await runHook(mockPrisma, mockConfig, request);

    expect(mockVerifyBearerJwt).not.toHaveBeenCalled();
    expect(request.actorId).toBe('00000000-0000-0000-0000-000000000066');
  });

  // ---------------------------------------------------------------------------
  // Change #1: DB guard — resolveBearerActorId rejection must NOT propagate
  // ---------------------------------------------------------------------------

  it('DB guard — resolveBearerActorId rejects → hook does NOT throw, actorId stays undefined, accountId still set', async () => {
    // JWT verification succeeds (strict — outside try)
    mockVerifyBearerJwt.mockResolvedValue(VALID_PAYLOAD);
    // DB call rejects (transient DB error)
    mockPrisma.actor.upsert.mockRejectedValue(new Error('DB connection lost'));

    const request = createMockRequest({
      authorization: 'Bearer eyJvalid.jwt.token',
      'x-actor-id': VALID_ACTOR_UUID,
    });

    // Must NOT throw
    await expect(runHook(mockPrisma, mockConfig, request)).resolves.not.toThrow();

    // actorId must NOT be set (DB failed — leave undefined)
    expect(request.actorId).toBeUndefined();

    // accountId MUST still be set (JWT verification succeeded before the try block)
    expect(request.accountId).toBe(VALID_PAYLOAD.sub);

    // A warn log must have been emitted
    expect(request.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'bearer_actor_resolution_failed' }),
      expect.any(String),
    );
  });

  it('DB guard — invalid bearer still throws even when DB would also fail (strict JWT)', async () => {
    const tokenError = Object.assign(new Error('JWT is invalid'), { code: 'INVALID_TOKEN' });
    mockVerifyBearerJwt.mockRejectedValue(tokenError);
    // DB would fail too, but JWT check runs first and outside try
    mockPrisma.actor.upsert.mockRejectedValue(new Error('DB connection lost'));

    const request = createMockRequest({
      authorization: 'Bearer bad.token.here',
      'x-actor-id': VALID_ACTOR_UUID,
    });

    let capturedHook: ((req: unknown, reply: unknown) => Promise<void>) | null = null;
    const app = {
      addHook: (_event: string, fn: (req: unknown, reply: unknown) => Promise<void>) => {
        capturedHook = fn;
      },
    } as unknown as FastifyInstance;

    await registerActorResolver(app, {
      prisma: mockPrisma as unknown as import('@prisma/client').PrismaClient,
      config: mockConfig as unknown as import('../../config.js').Config,
    });

    const reply = createMockReply();
    // Invalid bearer MUST still throw (ADR-025 R3 §5 — outside try)
    await expect(capturedHook!(request, reply)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });
});

// ---------------------------------------------------------------------------
// Unit tests for resolveBearerActorId (AC1, AC3)
// ---------------------------------------------------------------------------

describe('resolveBearerActorId — shared lib unit tests', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
  });

  it('AC1 — valid X-Actor-Id UUID → upserts anonymous_web actor by that externalId', async () => {
    mockPrisma.actor.upsert.mockResolvedValue({ id: BEARER_ACTOR_DB_ID });

    const mockRequest = {
      headers: { 'x-actor-id': VALID_ACTOR_UUID },
      log: { warn: vi.fn() },
    };

    const result = await resolveBearerActorId(
      mockPrisma as unknown as import('@prisma/client').PrismaClient,
      VALID_PAYLOAD,
      mockRequest as unknown as import('fastify').FastifyRequest,
    );

    expect(result).toBe(BEARER_ACTOR_DB_ID);
    expect(mockPrisma.actor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { type_externalId: { type: 'anonymous_web', externalId: VALID_ACTOR_UUID } },
        create: expect.objectContaining({ type: 'anonymous_web', externalId: VALID_ACTOR_UUID }),
        update: expect.objectContaining({ lastSeenAt: expect.any(Date) }),
        select: { id: true },
      }),
    );
  });

  it('AC3 — missing X-Actor-Id → fallback provisionFallbackActor (me-<sub.slice(0,8)>)', async () => {
    mockPrisma.actor.upsert.mockResolvedValue({ id: FALLBACK_ACTOR_DB_ID });

    const mockRequest = {
      headers: {},
      log: { warn: vi.fn() },
    };

    const result = await resolveBearerActorId(
      mockPrisma as unknown as import('@prisma/client').PrismaClient,
      VALID_PAYLOAD,
      mockRequest as unknown as import('fastify').FastifyRequest,
    );

    // sub = 'auth-user-uuid-1234', slice(0,8) = 'auth-use' → externalId = 'me-auth-use'
    expect(result).toBe(FALLBACK_ACTOR_DB_ID);
    expect(mockPrisma.actor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          type_externalId: { type: 'anonymous_web', externalId: 'me-auth-use' },
        },
      }),
    );
  });

  it('AC3 — invalid (non-UUID) X-Actor-Id → fallback provisionFallbackActor', async () => {
    mockPrisma.actor.upsert.mockResolvedValue({ id: FALLBACK_ACTOR_DB_ID });

    const mockRequest = {
      headers: { 'x-actor-id': 'not-a-valid-uuid' },
      log: { warn: vi.fn() },
    };

    const result = await resolveBearerActorId(
      mockPrisma as unknown as import('@prisma/client').PrismaClient,
      VALID_PAYLOAD,
      mockRequest as unknown as import('fastify').FastifyRequest,
    );

    expect(result).toBe(FALLBACK_ACTOR_DB_ID);
    // Should use me- prefix (fallback), not the raw invalid value
    expect(mockPrisma.actor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          type_externalId: { type: 'anonymous_web', externalId: 'me-auth-use' },
        },
      }),
    );
  });

  it('AC4 — does not throw on valid payload (no exceptions)', async () => {
    mockPrisma.actor.upsert.mockResolvedValue({ id: BEARER_ACTOR_DB_ID });

    const mockRequest = {
      headers: { 'x-actor-id': VALID_ACTOR_UUID },
      log: { warn: vi.fn() },
    };

    await expect(
      resolveBearerActorId(
        mockPrisma as unknown as import('@prisma/client').PrismaClient,
        VALID_PAYLOAD,
        mockRequest as unknown as import('fastify').FastifyRequest,
      ),
    ).resolves.toBe(BEARER_ACTOR_DB_ID);
  });
});

// ---------------------------------------------------------------------------
// Unit tests for provisionFallbackActor
// ---------------------------------------------------------------------------

describe('provisionFallbackActor — shared lib unit tests (AC3)', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
  });

  it('upserts actor with me-<sub.slice(0,8)> externalId', async () => {
    mockPrisma.actor.upsert.mockResolvedValue({ id: FALLBACK_ACTOR_DB_ID });

    const result = await provisionFallbackActor(
      mockPrisma as unknown as import('@prisma/client').PrismaClient,
      'auth-user-uuid-1234',
    );

    expect(result).toEqual({ id: FALLBACK_ACTOR_DB_ID });
    expect(mockPrisma.actor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { type_externalId: { type: 'anonymous_web', externalId: 'me-auth-use' } },
        create: expect.objectContaining({
          type: 'anonymous_web',
          externalId: 'me-auth-use',
        }),
        update: expect.objectContaining({ lastSeenAt: expect.any(Date) }),
        select: { id: true },
      }),
    );
  });

  it('does NOT set account_id during upsert (no hijack surface)', async () => {
    mockPrisma.actor.upsert.mockResolvedValue({ id: FALLBACK_ACTOR_DB_ID });

    await provisionFallbackActor(
      mockPrisma as unknown as import('@prisma/client').PrismaClient,
      'some-sub-value',
    );

    const callArgs = mockPrisma.actor.upsert.mock.calls[0]?.[0];
    expect(callArgs?.create).not.toHaveProperty('accountId');
    expect(callArgs?.create).not.toHaveProperty('account_id');
    expect(callArgs?.update).not.toHaveProperty('accountId');
    expect(callArgs?.update).not.toHaveProperty('account_id');
  });

  it('is idempotent — same sub produces same externalId', async () => {
    mockPrisma.actor.upsert.mockResolvedValue({ id: FALLBACK_ACTOR_DB_ID });

    const sub = 'stable-sub-value-xyz';
    await provisionFallbackActor(
      mockPrisma as unknown as import('@prisma/client').PrismaClient,
      sub,
    );
    await provisionFallbackActor(
      mockPrisma as unknown as import('@prisma/client').PrismaClient,
      sub,
    );

    // Both calls use the same externalId
    const firstCall = mockPrisma.actor.upsert.mock.calls[0]?.[0];
    const secondCall = mockPrisma.actor.upsert.mock.calls[1]?.[0];
    expect(firstCall?.where).toEqual(secondCall?.where);
  });
});
