// F-WEB-TIER — resolveAccountTier unit tests (AC1, AC4, AC5)
//
// Tests the Redis-cached tier lookup helper.
// All Redis + Prisma calls are vi.fn() mocks — no real DB or Redis.
//
// AC1: verified bearer resolves to at least 'free' (never 'anonymous')
// AC4: cache hit returns cached tier without DB call
// AC5: fail-open 'free' on no-row or DB error

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();

const mockRedis = {
  get: mockRedisGet,
  set: mockRedisSet,
};

const mockQueryRaw = vi.fn();
const mockPrisma = {
  $queryRaw: mockQueryRaw,
};

const mockLogger = {
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
} as unknown as FastifyBaseLogger;

// ---------------------------------------------------------------------------
// Import under test (after mocks registered)
// ---------------------------------------------------------------------------

// We import directly — no vi.mock needed for this module itself
const { resolveAccountTier } = await import('../../lib/accountTier.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SUB = 'f7f00000-0001-4000-a000-000000000001';
const CACHE_KEY = `account:tier:${TEST_SUB}`;

beforeEach(() => {
  vi.clearAllMocks();
  mockRedisSet.mockResolvedValue('OK');
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveAccountTier — AC4: cache hit', () => {
  it('returns cached tier without calling DB when cache hit', async () => {
    mockRedisGet.mockResolvedValue('free');

    const result = await resolveAccountTier(
      mockRedis as never,
      mockPrisma as never,
      TEST_SUB,
      mockLogger,
    );

    expect(result).toBe('free');
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it('returns cached pro tier from cache', async () => {
    mockRedisGet.mockResolvedValue('pro');

    const result = await resolveAccountTier(
      mockRedis as never,
      mockPrisma as never,
      TEST_SUB,
      mockLogger,
    );

    expect(result).toBe('pro');
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it('returns cached admin tier from cache', async () => {
    mockRedisGet.mockResolvedValue('admin');

    const result = await resolveAccountTier(
      mockRedis as never,
      mockPrisma as never,
      TEST_SUB,
      mockLogger,
    );

    expect(result).toBe('admin');
  });
});

describe('resolveAccountTier — AC4/AC5: cache miss, DB hit', () => {
  it('calls DB on cache miss and returns tier from DB row', async () => {
    mockRedisGet.mockResolvedValue(null);
    mockQueryRaw.mockResolvedValue([{ tier: 'pro' }]);

    const result = await resolveAccountTier(
      mockRedis as never,
      mockPrisma as never,
      TEST_SUB,
      mockLogger,
    );

    expect(result).toBe('pro');
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it('caches result with key account:tier:<sub> and TTL 60', async () => {
    mockRedisGet.mockResolvedValue(null);
    mockQueryRaw.mockResolvedValue([{ tier: 'free' }]);

    await resolveAccountTier(
      mockRedis as never,
      mockPrisma as never,
      TEST_SUB,
      mockLogger,
    );

    // set is fire-and-forget so we need to yield the microtask queue
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(mockRedisSet).toHaveBeenCalledWith(CACHE_KEY, 'free', 'EX', 60);
  });
});

describe('resolveAccountTier — AC5: cache miss, no row (fail-open free)', () => {
  it('returns free when no accounts row exists for sub', async () => {
    mockRedisGet.mockResolvedValue(null);
    mockQueryRaw.mockResolvedValue([]); // empty result — no row

    const result = await resolveAccountTier(
      mockRedis as never,
      mockPrisma as never,
      TEST_SUB,
      mockLogger,
    );

    expect(result).toBe('free');
    // NEVER returns 'anonymous' for a verified bearer
    expect(result).not.toBe('anonymous');
  });
});

describe('resolveAccountTier — AC5: DB throws (fail-open free)', () => {
  it('returns free (NOT anonymous) when DB throws', async () => {
    mockRedisGet.mockResolvedValue(null);
    mockQueryRaw.mockRejectedValue(new Error('DB connection failed'));

    const result = await resolveAccountTier(
      mockRedis as never,
      mockPrisma as never,
      TEST_SUB,
      mockLogger,
    );

    expect(result).toBe('free');
    expect(result).not.toBe('anonymous');
  });
});

describe('resolveAccountTier — Redis GET throws (falls back to DB)', () => {
  it('falls back to DB when Redis GET throws', async () => {
    mockRedisGet.mockRejectedValue(new Error('Redis unavailable'));
    mockQueryRaw.mockResolvedValue([{ tier: 'free' }]);

    const result = await resolveAccountTier(
      mockRedis as never,
      mockPrisma as never,
      TEST_SUB,
      mockLogger,
    );

    expect(result).toBe('free');
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns free when both Redis GET and DB throw', async () => {
    mockRedisGet.mockRejectedValue(new Error('Redis unavailable'));
    mockQueryRaw.mockRejectedValue(new Error('DB also unavailable'));

    const result = await resolveAccountTier(
      mockRedis as never,
      mockPrisma as never,
      TEST_SUB,
      mockLogger,
    );

    expect(result).toBe('free');
    expect(result).not.toBe('anonymous');
  });
});
