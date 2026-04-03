// Unit tests for contextManager.ts (F070 — Step 5)
//
// Tests getContext() and setContext() — fail-open Redis helpers
// using raw redis.get / redis.set (NOT cacheGet/cacheSet).
// Key pattern: conv:ctx:{actorId}, TTL: 7200s.

import { describe, it, expect, vi } from 'vitest';
import { getContext, setContext } from '../conversation/contextManager.js';
import type { ConversationContext } from '../conversation/types.js';

// ---------------------------------------------------------------------------
// Helpers — mock Redis
// ---------------------------------------------------------------------------

function createMockRedis(getReturn: string | null = null) {
  return {
    get: vi.fn().mockResolvedValue(getReturn),
    set: vi.fn().mockResolvedValue('OK'),
  };
}

function createFailingRedis() {
  return {
    get: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    set: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
  };
}

const ACTOR_ID = 'fd000000-0001-4000-a000-000000000001';
const EXPECTED_KEY = `conv:ctx:${ACTOR_ID}`;

// ---------------------------------------------------------------------------
// getContext
// ---------------------------------------------------------------------------

describe('getContext', () => {
  it('returns parsed ConversationContext on cache hit', async () => {
    const context: ConversationContext = {
      chainSlug: 'mcdonalds-es',
      chainName: "McDonald's",
    };
    const redis = createMockRedis(JSON.stringify(context));

    const result = await getContext(ACTOR_ID, redis as never);

    expect(redis.get).toHaveBeenCalledWith(EXPECTED_KEY);
    expect(result).toEqual(context);
  });

  it('returns null on cache miss (redis returns null)', async () => {
    const redis = createMockRedis(null);

    const result = await getContext(ACTOR_ID, redis as never);

    expect(redis.get).toHaveBeenCalledWith(EXPECTED_KEY);
    expect(result).toBeNull();
  });

  it('returns null when stored value is empty string', async () => {
    const redis = createMockRedis('');

    const result = await getContext(ACTOR_ID, redis as never);

    expect(result).toBeNull();
  });

  it('returns null on Redis error (fail-open)', async () => {
    const redis = createFailingRedis();

    const result = await getContext(ACTOR_ID, redis as never);

    expect(result).toBeNull();
  });

  it('returns null when stored JSON is malformed (fail-open)', async () => {
    const redis = createMockRedis('not-valid-json{');

    const result = await getContext(ACTOR_ID, redis as never);

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setContext
// ---------------------------------------------------------------------------

describe('setContext', () => {
  it('writes context to Redis with correct key and TTL', async () => {
    const context: ConversationContext = {
      chainSlug: 'mcdonalds-es',
      chainName: "McDonald's",
    };
    const redis = createMockRedis();

    await setContext(ACTOR_ID, context, redis as never);

    expect(redis.set).toHaveBeenCalledWith(
      EXPECTED_KEY,
      JSON.stringify(context),
      'EX',
      7200,
    );
  });

  it('does NOT throw on Redis error (fail-open)', async () => {
    const redis = createFailingRedis();

    // Should not throw
    await expect(
      setContext(ACTOR_ID, { chainSlug: 'mcdonalds-es', chainName: "McDonald's" }, redis as never),
    ).resolves.toBeUndefined();
  });

  it('uses raw redis.set — NOT cacheGet/cacheSet (key has no fxp: prefix)', async () => {
    const context: ConversationContext = { chainSlug: 'test-es', chainName: 'Test' };
    const redis = createMockRedis();

    await setContext(ACTOR_ID, context, redis as never);

    const [[key]] = (redis.set as ReturnType<typeof vi.fn>).mock.calls;
    // Key must be conv:ctx:{actorId} — NOT fxp:...:...
    expect(key).toBe(EXPECTED_KEY);
    expect(key).not.toContain('fxp:');
  });

  it('writes TTL as 7200 seconds', async () => {
    const redis = createMockRedis();

    await setContext(ACTOR_ID, { chainSlug: 'test-es', chainName: 'Test' }, redis as never);

    const [, , , ttl] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(ttl).toBe(7200);
  });
});
