// Unit tests for conversationState.ts (F032)
//
// Uses a plain object mock for ioredis — no real Redis connection.
// All tests follow the fail-open contract: Redis errors must never throw.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getState, setState, clearState } from '../lib/conversationState.js';
import type { BotState } from '../lib/conversationState.js';
import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

function makeMockRedis() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  } as unknown as Redis;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getState', () => {
  let redis: Redis;

  beforeEach(() => {
    redis = makeMockRedis();
  });

  it('returns null on cache miss (redis.get returns null)', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await getState(redis, 123);

    expect(result).toBeNull();
  });

  it('returns parsed BotState on valid JSON', async () => {
    const state: BotState = {
      selectedRestaurant: { id: 'uuid-1', name: 'McDonald\'s Spain' },
      pendingSearch: 'mcdonalds',
    };
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(state));

    const result = await getState(redis, 456);

    expect(result).toEqual(state);
  });

  it('calls redis.get with the correct key pattern bot:state:{chatId}', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await getState(redis, 789);

    expect(redis.get).toHaveBeenCalledWith('bot:state:789');
  });

  it('returns null (fail-open) when redis.get throws', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Redis down'));

    const result = await getState(redis, 123);

    expect(result).toBeNull();
  });

  it('returns null (fail-open) when stored JSON is malformed', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue('not-valid-json{{{');

    const result = await getState(redis, 123);

    expect(result).toBeNull();
  });
});

describe('setState', () => {
  let redis: Redis;

  beforeEach(() => {
    redis = makeMockRedis();
  });

  it('calls redis.set with correct key, serialized data, EX, 7200', async () => {
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');

    const state: BotState = { pendingSearch: 'test restaurant' };
    await setState(redis, 100, state);

    expect(redis.set).toHaveBeenCalledWith(
      'bot:state:100',
      JSON.stringify(state),
      'EX',
      7200,
    );
  });

  it('does not throw when redis.set throws (fail-open)', async () => {
    (redis.set as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Redis down'));

    await expect(setState(redis, 100, {})).resolves.toBeUndefined();
  });

  it('stores searchResults correctly', async () => {
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');

    const state: BotState = {
      searchResults: { 'uuid-abc': 'Some Restaurant', 'uuid-def': 'Another Place' },
    };
    await setState(redis, 200, state);

    const [, serialized] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    expect(JSON.parse(serialized)).toEqual(state);
  });
});

describe('clearState', () => {
  let redis: Redis;

  beforeEach(() => {
    redis = makeMockRedis();
  });

  it('calls redis.del with the correct key', async () => {
    (redis.del as ReturnType<typeof vi.fn>).mockResolvedValue(1);

    await clearState(redis, 999);

    expect(redis.del).toHaveBeenCalledWith('bot:state:999');
  });

  it('does not throw when redis.del throws (fail-open)', async () => {
    (redis.del as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Redis down'));

    await expect(clearState(redis, 999)).resolves.toBeUndefined();
  });
});
