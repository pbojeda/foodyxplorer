// Unit tests for lib/redis.ts
//
// Uses vi.mock('ioredis') to intercept the Redis constructor so tests run
// without a real Redis server. The mock implements connect(), quit(), and ping()
// so all code-paths in redis.ts are exercisable in isolation.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock ioredis before importing redis.ts
// ---------------------------------------------------------------------------

const mockConnect = vi.fn();
const mockQuit = vi.fn();
const mockPing = vi.fn();

vi.mock('ioredis', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      connect: mockConnect,
      quit: mockQuit,
      ping: mockPing,
    })),
  };
});

// ---------------------------------------------------------------------------
// Import after mock is set up
// ---------------------------------------------------------------------------

let connectRedis: () => Promise<boolean>;
let disconnectRedis: () => Promise<void>;

beforeEach(async () => {
  vi.resetModules();

  mockConnect.mockReset();
  mockQuit.mockReset();
  mockPing.mockReset();

  // Re-import so the module-level singleton uses the fresh mock
  const mod = await import('../lib/redis.js');
  connectRedis = mod.connectRedis;
  disconnectRedis = mod.disconnectRedis;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// connectRedis
// ---------------------------------------------------------------------------

describe('connectRedis()', () => {
  it('returns true and logs [redis] Connected when connect() resolves', async () => {
    mockConnect.mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = await connectRedis();

    expect(result).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[redis] Connected'),
    );

    consoleSpy.mockRestore();
  });

  it('returns false and logs [redis] Redis unavailable when connect() rejects', async () => {
    mockConnect.mockRejectedValue(new Error('ECONNREFUSED'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await connectRedis();

    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[redis] Redis unavailable'),
    );

    warnSpy.mockRestore();
  });

  it('does not throw even when connect() rejects', async () => {
    mockConnect.mockRejectedValue(new Error('Network unreachable'));

    await expect(connectRedis()).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// disconnectRedis
// ---------------------------------------------------------------------------

describe('disconnectRedis()', () => {
  it('calls quit() on the redis instance', async () => {
    mockQuit.mockResolvedValue('OK');

    await disconnectRedis();

    expect(mockQuit).toHaveBeenCalled();
  });

  it('does not throw when quit() rejects (swallows error)', async () => {
    mockQuit.mockRejectedValue(new Error('already closed'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(disconnectRedis()).resolves.toBeUndefined();

    warnSpy.mockRestore();
  });

  it('logs [redis] Error during disconnect when quit() rejects', async () => {
    mockQuit.mockRejectedValue(new Error('connection lost'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await disconnectRedis();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[redis] Error during disconnect'),
    );

    warnSpy.mockRestore();
  });
});
