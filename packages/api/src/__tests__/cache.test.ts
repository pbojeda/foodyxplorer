// Unit tests for lib/cache.ts
//
// Mocks lib/redis.ts with a hand-crafted vi.fn() spy object. The mock is
// created in vi.hoisted() so it is available when vi.mock() factory runs.
// Tests use an in-memory Map to simulate Redis state.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';

// ---------------------------------------------------------------------------
// Create the mock in vi.hoisted so it is available in the vi.mock factory.
// vi.hoisted() runs synchronously before vi.mock() factories.
// ---------------------------------------------------------------------------

const { mockRedis, store } = vi.hoisted(() => {
  const store = new Map<string, string>();

  const mockRedis = {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    ttl: vi.fn(),
    scan: vi.fn(),
    pipeline: vi.fn(),
    flushall: vi.fn(),
  };

  return { mockRedis, store };
});

vi.mock('../lib/redis.js', () => ({
  redis: mockRedis,
}));

// ---------------------------------------------------------------------------
// Helper: reset implementations before each test
// ---------------------------------------------------------------------------

function setupMockImplementations() {
  mockRedis.get.mockImplementation(async (key: string) => {
    return store.get(key) ?? null;
  });

  mockRedis.set.mockImplementation(async (key: string, value: string) => {
    store.set(key, value);
    return 'OK';
  });

  mockRedis.del.mockImplementation(async (...keys: string[]) => {
    let count = 0;
    for (const key of keys) { if (store.delete(key)) count++; }
    return count;
  });

  mockRedis.ttl.mockReturnValue(Promise.resolve(-1));

  mockRedis.scan.mockImplementation(async (_cursor: string, _match: string, pattern: string, _count: string, _countVal: number) => {
    const allKeys = [...store.keys()];
    const regexStr = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const regex = new RegExp(`^${regexStr}$`);
    const matched = allKeys.filter((k) => regex.test(k));
    return ['0', matched];
  });

  mockRedis.pipeline.mockImplementation(() => {
    const delOps: string[] = [];
    const pipe = {
      del: vi.fn((key: string) => { delOps.push(key); return pipe; }),
      exec: vi.fn(async () => {
        for (const key of delOps) { store.delete(key); }
        return delOps.map(() => [null, 1]);
      }),
    };
    return pipe;
  });

  mockRedis.flushall.mockImplementation(async () => {
    store.clear();
    return 'OK';
  });
}

// ---------------------------------------------------------------------------
// Stub logger
// ---------------------------------------------------------------------------

const logger = {
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn(),
  level: 'warn',
  silent: vi.fn(),
} as unknown as FastifyBaseLogger;

// ---------------------------------------------------------------------------
// Import cache functions after mock is set up
// ---------------------------------------------------------------------------

import {
  buildKey,
  cacheGet,
  cacheSet,
  cacheDel,
  cacheInvalidatePattern,
} from '../lib/cache.js';

// ---------------------------------------------------------------------------
// Reset state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  setupMockImplementations();
});

// ---------------------------------------------------------------------------
// buildKey
// ---------------------------------------------------------------------------

describe('buildKey()', () => {
  it('returns "fxp:<entity>:<id>" format', () => {
    expect(buildKey('food', 'abc-123')).toBe('fxp:food:abc-123');
  });

  it('works for different entity types', () => {
    expect(buildKey('dish', 'uuid-456')).toBe('fxp:dish:uuid-456');
    expect(buildKey('query', 'sha256hash')).toBe('fxp:query:sha256hash');
  });
});

// ---------------------------------------------------------------------------
// cacheGet
// ---------------------------------------------------------------------------

describe('cacheGet()', () => {
  it('returns null on cache miss', async () => {
    const result = await cacheGet<{ name: string }>('fxp:food:nonexistent', logger);
    expect(result).toBeNull();
  });

  it('returns the deserialised object on cache hit', async () => {
    const value = { name: 'Apple', calories: 52 };
    store.set('fxp:food:apple', JSON.stringify(value));

    const result = await cacheGet<typeof value>('fxp:food:apple', logger);
    expect(result).toEqual(value);
  });

  it('returns null and calls logger.warn when redis throws', async () => {
    mockRedis.get.mockRejectedValueOnce(new Error('Redis down'));

    const result = await cacheGet<{ name: string }>('fxp:food:any', logger);

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('cacheGet'),
    );
  });
});

// ---------------------------------------------------------------------------
// cacheSet
// ---------------------------------------------------------------------------

describe('cacheSet()', () => {
  it('stores a JSON-serialised value with default TTL 300', async () => {
    const value = { name: 'Banana', calories: 89 };
    await cacheSet('fxp:food:banana', value, logger);

    expect(mockRedis.set).toHaveBeenCalledWith(
      'fxp:food:banana',
      JSON.stringify(value),
      'EX',
      300,
    );
    expect(store.get('fxp:food:banana')).toBe(JSON.stringify(value));
  });

  it('stores value with custom TTL when options.ttl provided', async () => {
    const value = { name: 'Restaurant 1' };
    await cacheSet('fxp:restaurant:1', value, logger, { ttl: 3600 });

    expect(mockRedis.set).toHaveBeenCalledWith(
      'fxp:restaurant:1',
      JSON.stringify(value),
      'EX',
      3600,
    );
  });

  it('is a no-op when value is null', async () => {
    await cacheSet('fxp:food:nullval', null, logger);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('is a no-op when value is undefined', async () => {
    await cacheSet('fxp:food:undefval', undefined, logger);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('does not throw and calls logger.warn when redis throws', async () => {
    mockRedis.set.mockRejectedValueOnce(new Error('Redis down'));

    await expect(
      cacheSet('fxp:food:any', { name: 'test' }, logger),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('cacheSet'),
    );
  });
});

// ---------------------------------------------------------------------------
// cacheDel
// ---------------------------------------------------------------------------

describe('cacheDel()', () => {
  it('removes a key from redis', async () => {
    store.set('fxp:food:deleteme', JSON.stringify({ name: 'Del' }));

    await cacheDel('fxp:food:deleteme', logger);

    expect(mockRedis.del).toHaveBeenCalledWith('fxp:food:deleteme');
    expect(store.has('fxp:food:deleteme')).toBe(false);
  });

  it('does not throw and calls logger.warn when redis throws', async () => {
    mockRedis.del.mockRejectedValueOnce(new Error('Redis down'));

    await expect(cacheDel('fxp:food:any', logger)).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('cacheDel'),
    );
  });
});

// ---------------------------------------------------------------------------
// cacheInvalidatePattern
// ---------------------------------------------------------------------------

describe('cacheInvalidatePattern()', () => {
  it('deletes all keys matching a glob pattern using cursor-based SCAN', async () => {
    store.set('fxp:food:1', 'a');
    store.set('fxp:food:2', 'b');
    store.set('fxp:dish:1', 'c');

    await cacheInvalidatePattern('fxp:food:*', logger);

    // food keys should be gone
    expect(store.has('fxp:food:1')).toBe(false);
    expect(store.has('fxp:food:2')).toBe(false);
    // unrelated key must survive
    expect(store.has('fxp:dish:1')).toBe(true);
  });

  it('does not throw and calls logger.warn when redis throws', async () => {
    mockRedis.scan.mockRejectedValueOnce(new Error('Redis down'));

    await expect(
      cacheInvalidatePattern('fxp:food:*', logger),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('cacheInvalidatePattern'),
    );
  });

  it('is a no-op when no keys match the pattern', async () => {
    // Should not throw
    await expect(
      cacheInvalidatePattern('fxp:nonexistent:*', logger),
    ).resolves.toBeUndefined();
  });
});
