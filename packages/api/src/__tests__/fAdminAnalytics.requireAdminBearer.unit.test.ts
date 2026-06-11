// Unit tests for requireAdminBearer preHandler (F-ADMIN-ANALYTICS-UI B3)
//
// All 6 branches per the plan:
//   1. No accountId on request → 401 UNAUTHORIZED
//   2. Rate limit exceeded → 429 RATE_LIMIT_EXCEEDED
//   3. resolveAccountTierStrict returns null → 403 NOT_PROVISIONED (hint message)
//   4. tier === 'admin' → passes; sets request.adminVerified = true
//   5. tier === 'free'/'pro' → 403 FORBIDDEN
//   6. resolveAccountTierStrict throws → 500 DB_UNAVAILABLE
//
// NODE_ENV=test: rate limit branch is skipped (mirrors rateLimit.ts:107 pattern).
// Gate (accountId + tier check + 403 branches) stays ACTIVE in all environments.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply, FastifyBaseLogger } from 'fastify';

// ---------------------------------------------------------------------------
// Mocks for Redis and Prisma (passed to makeRequireAdminBearer)
// ---------------------------------------------------------------------------

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisIncr = vi.fn();
const mockRedisExpire = vi.fn();
const mockRedis = {
  get: mockRedisGet,
  set: mockRedisSet,
  incr: mockRedisIncr,
  expire: mockRedisExpire,
};

const mockQueryRaw = vi.fn();
const mockPrisma = {
  $queryRaw: mockQueryRaw,
};

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

const { makeRequireAdminBearer } = await import('../plugins/requireAdminBearer.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SUB = 'f7f00000-0003-4000-a000-000000000001';

function makeRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    accountId: TEST_SUB,
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as FastifyBaseLogger,
    ...overrides,
  } as unknown as FastifyRequest;
}

function makeReply(): FastifyReply {
  return {} as FastifyReply;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: rate limit not exceeded
  mockRedisGet.mockResolvedValue(null); // no cached tier
  mockRedisSet.mockResolvedValue('OK');
  mockRedisIncr.mockResolvedValue(1);
  mockRedisExpire.mockResolvedValue(1);
});

// ---------------------------------------------------------------------------
// Branch 1: No accountId → 401 UNAUTHORIZED
// ---------------------------------------------------------------------------

describe('requireAdminBearer — branch 1: no accountId', () => {
  it('throws UNAUTHORIZED when request.accountId is undefined', async () => {
    const gate = makeRequireAdminBearer({ redis: mockRedis as never, prisma: mockPrisma as never });
    const req = makeRequest({ accountId: undefined });

    await expect(gate(req, makeReply())).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});

// ---------------------------------------------------------------------------
// Branch 2: Rate limit exceeded → 429 RATE_LIMIT_EXCEEDED
// (only in non-test mode — rate-limit branch skipped when NODE_ENV=test)
// ---------------------------------------------------------------------------

describe('requireAdminBearer — branch 2: rate limit exceeded', () => {
  it('throws RATE_LIMIT_EXCEEDED when Redis incr > rateLimitMax (non-test mode)', async () => {
    const gate = makeRequireAdminBearer({
      redis: mockRedis as never,
      prisma: mockPrisma as never,
      rateLimitMax: 30,
      config: { NODE_ENV: 'development' },
    });
    mockRedisIncr.mockResolvedValue(31); // exceeds limit of 30

    const req = makeRequest();
    await expect(gate(req, makeReply())).rejects.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
    });
  });

  it('skips rate limit check when NODE_ENV=test (does NOT throw for count > 30)', async () => {
    const gate = makeRequireAdminBearer({
      redis: mockRedis as never,
      prisma: mockPrisma as never,
      rateLimitMax: 30,
      config: { NODE_ENV: 'test' },
    });
    mockRedisIncr.mockResolvedValue(999); // would exceed limit
    mockQueryRaw.mockResolvedValue([{ tier: 'admin' }]); // DB returns admin

    const req = makeRequest();
    // Should not throw
    await gate(req, makeReply());
    // adminVerified should be set
    expect((req as { adminVerified?: boolean }).adminVerified).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Branch 3: No accounts row → 403 NOT_PROVISIONED
// ---------------------------------------------------------------------------

describe('requireAdminBearer — branch 3: no accounts row', () => {
  it('throws NOT_PROVISIONED with hint message when DB returns no row', async () => {
    const gate = makeRequireAdminBearer({
      redis: mockRedis as never,
      prisma: mockPrisma as never,
      config: { NODE_ENV: 'test' }, // skip rate limit
    });
    mockQueryRaw.mockResolvedValue([]); // no row

    const req = makeRequest();
    await expect(gate(req, makeReply())).rejects.toMatchObject({
      code: 'NOT_PROVISIONED',
      message: expect.stringContaining('GET /me'),
    });
  });

  it('NOT_PROVISIONED code is distinct from FORBIDDEN', async () => {
    const gate = makeRequireAdminBearer({
      redis: mockRedis as never,
      prisma: mockPrisma as never,
      config: { NODE_ENV: 'test' },
    });
    mockQueryRaw.mockResolvedValue([]);

    const req = makeRequest();
    const thrown = await gate(req, makeReply()).catch((e: unknown) => e);
    expect((thrown as { code: string }).code).toBe('NOT_PROVISIONED');
    expect((thrown as { code: string }).code).not.toBe('FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------
// Branch 4: tier === 'admin' → passes
// ---------------------------------------------------------------------------

describe('requireAdminBearer — branch 4: admin tier', () => {
  it('does not throw and sets request.adminVerified = true for admin tier', async () => {
    const gate = makeRequireAdminBearer({
      redis: mockRedis as never,
      prisma: mockPrisma as never,
      config: { NODE_ENV: 'test' },
    });
    mockQueryRaw.mockResolvedValue([{ tier: 'admin' }]);

    const req = makeRequest();
    await expect(gate(req, makeReply())).resolves.toBeUndefined();
    expect((req as { adminVerified?: boolean }).adminVerified).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Branch 5: tier === 'free'/'pro' → 403 FORBIDDEN
// ---------------------------------------------------------------------------

describe('requireAdminBearer — branch 5: non-admin tier', () => {
  it('throws FORBIDDEN for free tier (row exists, not admin)', async () => {
    const gate = makeRequireAdminBearer({
      redis: mockRedis as never,
      prisma: mockPrisma as never,
      config: { NODE_ENV: 'test' },
    });
    mockQueryRaw.mockResolvedValue([{ tier: 'free' }]);

    const req = makeRequest();
    await expect(gate(req, makeReply())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('throws FORBIDDEN for pro tier (row exists, not admin)', async () => {
    const gate = makeRequireAdminBearer({
      redis: mockRedis as never,
      prisma: mockPrisma as never,
      config: { NODE_ENV: 'test' },
    });
    mockQueryRaw.mockResolvedValue([{ tier: 'pro' }]);

    const req = makeRequest();
    await expect(gate(req, makeReply())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('FORBIDDEN has no hint message (user IS provisioned, just not admin)', async () => {
    const gate = makeRequireAdminBearer({
      redis: mockRedis as never,
      prisma: mockPrisma as never,
      config: { NODE_ENV: 'test' },
    });
    mockQueryRaw.mockResolvedValue([{ tier: 'free' }]);

    const req = makeRequest();
    const thrown = await gate(req, makeReply()).catch((e: unknown) => e);
    expect((thrown as { code: string }).code).toBe('FORBIDDEN');
    expect((thrown as { message: string }).message).not.toContain('GET /me');
  });
});

// ---------------------------------------------------------------------------
// Branch 6: DB throws → 500 DB_UNAVAILABLE
// ---------------------------------------------------------------------------

describe('requireAdminBearer — branch 6: DB error', () => {
  it('throws DB_UNAVAILABLE when resolveAccountTierStrict throws', async () => {
    const gate = makeRequireAdminBearer({
      redis: mockRedis as never,
      prisma: mockPrisma as never,
      config: { NODE_ENV: 'test' },
    });
    mockQueryRaw.mockRejectedValue(new Error('connection timeout'));

    const req = makeRequest();
    await expect(gate(req, makeReply())).rejects.toMatchObject({
      code: 'DB_UNAVAILABLE',
    });
  });

  it('DB_UNAVAILABLE is distinct from NOT_PROVISIONED and FORBIDDEN', async () => {
    const gate = makeRequireAdminBearer({
      redis: mockRedis as never,
      prisma: mockPrisma as never,
      config: { NODE_ENV: 'test' },
    });
    mockQueryRaw.mockRejectedValue(new Error('DB error'));

    const req = makeRequest();
    const thrown = await gate(req, makeReply()).catch((e: unknown) => e);
    expect((thrown as { code: string }).code).toBe('DB_UNAVAILABLE');
    expect((thrown as { code: string }).code).not.toBe('NOT_PROVISIONED');
    expect((thrown as { code: string }).code).not.toBe('FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------
// Redis rate-limit key pattern
// ---------------------------------------------------------------------------

describe('requireAdminBearer — rate limit key', () => {
  it('uses admin:bearer:ratelimit:<sub> key', async () => {
    const gate = makeRequireAdminBearer({
      redis: mockRedis as never,
      prisma: mockPrisma as never,
      rateLimitMax: 30,
      config: { NODE_ENV: 'development' },
    });
    mockRedisIncr.mockResolvedValue(1);
    mockQueryRaw.mockResolvedValue([{ tier: 'admin' }]);

    const req = makeRequest();
    await gate(req, makeReply());

    expect(mockRedisIncr).toHaveBeenCalledWith(`admin:bearer:ratelimit:${TEST_SUB}`);
  });

  it('sets TTL only on first increment (count === 1)', async () => {
    const gate = makeRequireAdminBearer({
      redis: mockRedis as never,
      prisma: mockPrisma as never,
      config: { NODE_ENV: 'development' },
    });
    mockRedisIncr.mockResolvedValue(1); // first increment
    mockQueryRaw.mockResolvedValue([{ tier: 'admin' }]);

    const req = makeRequest();
    await gate(req, makeReply());

    expect(mockRedisExpire).toHaveBeenCalledWith(`admin:bearer:ratelimit:${TEST_SUB}`, 60);
  });

  it('does NOT set TTL when count > 1', async () => {
    const gate = makeRequireAdminBearer({
      redis: mockRedis as never,
      prisma: mockPrisma as never,
      config: { NODE_ENV: 'development' },
    });
    mockRedisIncr.mockResolvedValue(5); // not first increment
    mockQueryRaw.mockResolvedValue([{ tier: 'admin' }]);

    const req = makeRequest();
    await gate(req, makeReply());

    expect(mockRedisExpire).not.toHaveBeenCalled();
  });
});
