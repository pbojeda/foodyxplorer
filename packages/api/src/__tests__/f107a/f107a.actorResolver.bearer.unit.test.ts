// F107a — actorResolver bearer extension unit tests (AC11, AC12, AC13, S1)
//
// Tests the bearer pre-check logic added to actorResolver.ts.
// Uses mock prisma and mock verifyBearerJwt.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// ---------------------------------------------------------------------------
// Mock verifyBearerJwt — controls AC11/AC12/AC13 scenarios
// ---------------------------------------------------------------------------

const mockVerifyBearerJwt = vi.fn();

vi.mock('../../plugins/authBearer.js', () => ({
  verifyBearerJwt: mockVerifyBearerJwt,
}));

// Import after mocking
const { registerActorResolver } = await import('../../plugins/actorResolver.js');

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockPrisma() {
  return {
    actor: {
      upsert: vi.fn().mockResolvedValue({ id: '00000000-0000-0000-0000-000000000099' }),
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
    routeOptions: { url: '/estimate' },
    actorId: undefined,
    accountId: undefined,
    authPayload: undefined,
    log: { warn: vi.fn() },
  };
}

function createMockReply() {
  return { header: vi.fn().mockReturnThis() };
}

// Minimal mock FastifyInstance
function createMockApp(onRequestHook: (req: unknown, reply: unknown) => Promise<void>) {
  return {
    addHook: vi.fn((_event: string, fn: typeof onRequestHook) => {
      onRequestHook = fn;
    }),
    _runHook: async (req: unknown, reply: unknown) => onRequestHook(req, reply),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F107a — actorResolver bearer extension', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let mockConfig: ReturnType<typeof createMockConfig>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    mockConfig = createMockConfig();
    mockVerifyBearerJwt.mockReset();
  });

  describe('AC11 — valid bearer → sets request.accountId', () => {
    it('sets request.accountId to payload.sub for valid bearer JWT', async () => {
      mockVerifyBearerJwt.mockResolvedValue({
        sub: 'auth-user-uuid-123',
        email: 'user@example.com',
        aud: 'authenticated',
        iss: 'https://test.supabase.co/auth/v1',
        exp: Math.floor(Date.now() / 1000) + 3600,
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

      const request = createMockRequest({
        authorization: 'Bearer eyJvalid.jwt.token',
        'x-actor-id': 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      });
      const reply = createMockReply();

      await capturedHook!(request, reply);

      expect(mockVerifyBearerJwt).toHaveBeenCalledWith(
        'Bearer eyJvalid.jwt.token',
        mockConfig.SUPABASE_JWKS_URL,
      );
      expect(request.accountId).toBe('auth-user-uuid-123');
    });
  });

  describe('AC12 — invalid bearer → throws immediately, no anonymous fallback', () => {
    it('throws INVALID_TOKEN when bearer is present but invalid', async () => {
      const tokenError = Object.assign(new Error('JWT is invalid'), { code: 'INVALID_TOKEN' });
      mockVerifyBearerJwt.mockRejectedValue(tokenError);

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

      const request = createMockRequest({
        authorization: 'Bearer invalid.jwt.here',
      });
      const reply = createMockReply();

      await expect(capturedHook!(request, reply)).rejects.toMatchObject({
        code: 'INVALID_TOKEN',
      });

      // Anonymous flow must NOT have been called
      expect(mockPrisma.actor.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.actor.create).not.toHaveBeenCalled();
    });

    it('throws TOKEN_EXPIRED when bearer JWT is expired', async () => {
      const expiredError = Object.assign(new Error('JWT has expired'), { code: 'TOKEN_EXPIRED' });
      mockVerifyBearerJwt.mockRejectedValue(expiredError);

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

      const request = createMockRequest({ authorization: 'Bearer expired.jwt.token' });
      const reply = createMockReply();

      await expect(capturedHook!(request, reply)).rejects.toMatchObject({
        code: 'TOKEN_EXPIRED',
      });
    });
  });

  describe('AC13 — absent Authorization header → anonymous flow unchanged', () => {
    it('falls through to anonymous actor creation when no Authorization header', async () => {
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

      const request = createMockRequest({}); // no authorization header
      const reply = createMockReply();

      await capturedHook!(request, reply);

      // verifyBearerJwt must NOT be called
      expect(mockVerifyBearerJwt).not.toHaveBeenCalled();
      // Anonymous flow triggered (actor.create called)
      expect(mockPrisma.actor.create).toHaveBeenCalled();
    });

    it('falls through to anonymous resolve when only X-Actor-Id header present', async () => {
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

      const request = createMockRequest({
        'x-actor-id': 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      });
      const reply = createMockReply();

      await capturedHook!(request, reply);

      expect(mockVerifyBearerJwt).not.toHaveBeenCalled();
      expect(mockPrisma.actor.upsert).toHaveBeenCalled();
    });
  });

  describe('S1 — non-Bearer scheme rejected immediately', () => {
    it('throws INVALID_TOKEN for Authorization: Basic xxx', async () => {
      const basicError = Object.assign(new Error('Authorization header must use Bearer scheme'), {
        code: 'INVALID_TOKEN',
      });
      mockVerifyBearerJwt.mockRejectedValue(basicError);

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

      const request = createMockRequest({ authorization: 'Basic dXNlcjpwYXNz' });
      const reply = createMockReply();

      await expect(capturedHook!(request, reply)).rejects.toMatchObject({
        code: 'INVALID_TOKEN',
      });
    });
  });
});
