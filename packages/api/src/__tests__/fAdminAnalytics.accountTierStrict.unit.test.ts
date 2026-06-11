// Unit tests for resolveAccountTierStrict (F-ADMIN-ANALYTICS-UI B4)
//
// resolveAccountTierStrict is a strict variant of resolveAccountTier that:
//   - Returns null when no accounts row exists (NOT fail-open 'free')
//   - Does NOT cache the no-row case (prevents blocking post-/me provisioning)
//   - Rethrows DB errors (does NOT fail-open)
//
// Back-compat tests confirm resolveAccountTier (fail-open wrapper) unchanged.

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
// Import under test
// ---------------------------------------------------------------------------

const { resolveAccountTierStrict, resolveAccountTier } = await import('../lib/accountTier.js');

const TEST_SUB = 'f7f00000-0099-4000-a000-000000000001';
const CACHE_KEY = `account:tier:${TEST_SUB}`;

beforeEach(() => {
  vi.clearAllMocks();
  mockRedisSet.mockResolvedValue('OK');
});

// ---------------------------------------------------------------------------
// resolveAccountTierStrict — cache hit
// ---------------------------------------------------------------------------

describe('resolveAccountTierStrict — cache hit', () => {
  it('returns "admin" from cache without DB call', async () => {
    mockRedisGet.mockResolvedValue('admin');

    const result = await resolveAccountTierStrict(
      mockRedis as never,
      mockPrisma as never,
      TEST_SUB,
      mockLogger,
    );

    expect(result).toBe('admin');
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it('returns "pro" from cache without DB call', async () => {
    mockRedisGet.mockResolvedValue('pro');

    const result = await resolveAccountTierStrict(
      mockRedis as never,
      mockPrisma as never,
      TEST_SUB,
      mockLogger,
    );

    expect(result).toBe('pro');
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it('returns "free" from cache without DB call', async () => {
    mockRedisGet.mockResolvedValue('free');

    const result = await resolveAccountTierStrict(
      mockRedis as never,
      mockPrisma as never,
      TEST_SUB,
      mockLogger,
    );

    expect(result).toBe('free');
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// resolveAccountTierStrict — cache miss, DB hit
// ---------------------------------------------------------------------------

describe('resolveAccountTierStrict — cache miss, DB hit', () => {
  it('returns tier from DB and caches it with TTL 60', async () => {
    mockRedisGet.mockResolvedValue(null);
    mockQueryRaw.mockResolvedValue([{ tier: 'admin' }]);

    const result = await resolveAccountTierStrict(
      mockRedis as never,
      mockPrisma as never,
      TEST_SUB,
      mockLogger,
    );

    expect(result).toBe('admin');
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    // Yield microtask queue for fire-and-forget cache write
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(mockRedisSet).toHaveBeenCalledWith(CACHE_KEY, 'admin', 'EX', 60);
  });
});

// ---------------------------------------------------------------------------
// resolveAccountTierStrict — cache miss, no DB row
// ---------------------------------------------------------------------------

describe('resolveAccountTierStrict — cache miss, no accounts row', () => {
  it('returns null when no accounts row exists', async () => {
    mockRedisGet.mockResolvedValue(null);
    mockQueryRaw.mockResolvedValue([]); // empty — no row

    const result = await resolveAccountTierStrict(
      mockRedis as never,
      mockPrisma as never,
      TEST_SUB,
      mockLogger,
    );

    expect(result).toBeNull();
  });

  it('does NOT cache the no-row result (redis.set must not be called)', async () => {
    mockRedisGet.mockResolvedValue(null);
    mockQueryRaw.mockResolvedValue([]);

    await resolveAccountTierStrict(
      mockRedis as never,
      mockPrisma as never,
      TEST_SUB,
      mockLogger,
    );

    // Yield microtask queue to catch any fire-and-forget set calls
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(mockRedisSet).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// resolveAccountTierStrict — DB throws (NOT fail-open)
// ---------------------------------------------------------------------------

describe('resolveAccountTierStrict — DB throws', () => {
  it('rethrows the DB error (does NOT return free)', async () => {
    mockRedisGet.mockResolvedValue(null);
    const dbErr = new Error('DB connection failed');
    mockQueryRaw.mockRejectedValue(dbErr);

    await expect(
      resolveAccountTierStrict(
        mockRedis as never,
        mockPrisma as never,
        TEST_SUB,
        mockLogger,
      ),
    ).rejects.toThrow('DB connection failed');
  });
});

// ---------------------------------------------------------------------------
// Provisioning coherence — no stale negative cache blocking post-/me callers
// ---------------------------------------------------------------------------

describe('resolveAccountTierStrict — provisioning coherence', () => {
  it('first call returns null (no cache), second call after /me returns tier (no stale block)', async () => {
    // First call: no row yet
    mockRedisGet.mockResolvedValueOnce(null);
    mockQueryRaw.mockResolvedValueOnce([]);

    const first = await resolveAccountTierStrict(
      mockRedis as never,
      mockPrisma as never,
      TEST_SUB,
      mockLogger,
    );
    expect(first).toBeNull();

    // /me upsert "simulated" — next DB call returns the provisioned row
    // Cache still empty (no negative cache was written)
    mockRedisGet.mockResolvedValueOnce(null); // still no cache entry
    mockQueryRaw.mockResolvedValueOnce([{ tier: 'admin' }]);

    const second = await resolveAccountTierStrict(
      mockRedis as never,
      mockPrisma as never,
      TEST_SUB,
      mockLogger,
    );
    expect(second).toBe('admin');
  });
});

// ---------------------------------------------------------------------------
// I3: Corrupted cache value — falls through to DB lookup (not bogus tier)
// ---------------------------------------------------------------------------

describe('resolveAccountTierStrict — corrupted cache value (I3)', () => {
  it('falls through to DB when cache contains invalid value "__none__"', async () => {
    // Corrupted/poisoned cache — returns unexpected string not in AccountTier enum
    mockRedisGet.mockResolvedValue('__none__');
    mockQueryRaw.mockResolvedValue([{ tier: 'admin' }]); // DB has correct tier

    const result = await resolveAccountTierStrict(
      mockRedis as never,
      mockPrisma as never,
      TEST_SUB,
      mockLogger,
    );

    // Must NOT return '__none__' as AccountTier — must query DB instead
    expect(result).toBe('admin');
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it('falls through to DB when cache contains invalid value "invalid"', async () => {
    mockRedisGet.mockResolvedValue('invalid');
    mockQueryRaw.mockResolvedValue([{ tier: 'pro' }]);

    const result = await resolveAccountTierStrict(
      mockRedis as never,
      mockPrisma as never,
      TEST_SUB,
      mockLogger,
    );

    // 'invalid' is not a valid AccountTier — must NOT be returned
    expect(result).toBe('pro');
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns valid tier from cache without DB call (happy path unchanged)', async () => {
    // Confirm valid values still use cache path
    mockRedisGet.mockResolvedValue('free');

    const result = await resolveAccountTierStrict(
      mockRedis as never,
      mockPrisma as never,
      TEST_SUB,
      mockLogger,
    );

    expect(result).toBe('free');
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Back-compat: resolveAccountTier (fail-open wrapper) — unchanged behavior
// ---------------------------------------------------------------------------

describe('resolveAccountTier — back-compat wrapper (null → free)', () => {
  it('returns "free" when no accounts row exists (fail-open)', async () => {
    mockRedisGet.mockResolvedValue(null);
    mockQueryRaw.mockResolvedValue([]);

    const result = await resolveAccountTier(
      mockRedis as never,
      mockPrisma as never,
      TEST_SUB,
      mockLogger,
    );

    expect(result).toBe('free');
  });

  it('returns "free" when DB throws (fail-open)', async () => {
    mockRedisGet.mockResolvedValue(null);
    mockQueryRaw.mockRejectedValue(new Error('DB error'));

    const result = await resolveAccountTier(
      mockRedis as never,
      mockPrisma as never,
      TEST_SUB,
      mockLogger,
    );

    expect(result).toBe('free');
  });
});
