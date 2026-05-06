// Unit tests for turnStateManager.ts (F-MULTITURN-001, Step 2)
//
// Tests Redis get/set for conv:turn:{actorId} turn state.
// Redis is mocked via vi.fn() — no real Redis connection.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConversationTurnState } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Mock turnStateManager — we test the real implementation via import
// ---------------------------------------------------------------------------

import {
  getTurnState,
  setTurnState,
  TURN_STATE_TTL_SECONDS,
} from '../conversation/turnStateManager.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACTOR_ID = 'fd000000-0070-4000-a000-000000000099';

const VALID_TURN_STATE: ConversationTurnState = {
  query: 'paella valenciana',
  chainSlug: null,
  estimation: {
    query: 'paella valenciana',
    chainSlug: null,
    portionMultiplier: 1,
    level1Hit: true,
    level2Hit: false,
    level3Hit: false,
    level4Hit: false,
    matchType: 'exact_dish',
    result: null, // null result is valid (R3-1 fix)
    cachedAt: null,
  },
  portionMultiplier: 1,
  storedAt: 1700000000000,
};

// ---------------------------------------------------------------------------
// Helper: build a mock Redis object
// ---------------------------------------------------------------------------

function buildMockRedis(overrides: Partial<{ get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> }> = {}) {
  return {
    get: overrides['get'] ?? vi.fn(),
    set: overrides['set'] ?? vi.fn(),
  } as unknown as import('ioredis').Redis;
}

// ---------------------------------------------------------------------------
// TURN_STATE_TTL_SECONDS constant
// ---------------------------------------------------------------------------

describe('TURN_STATE_TTL_SECONDS', () => {
  it('equals 1800 (30 minutes)', () => {
    expect(TURN_STATE_TTL_SECONDS).toBe(1800);
  });
});

// ---------------------------------------------------------------------------
// getTurnState
// ---------------------------------------------------------------------------

describe('getTurnState', () => {
  it('returns ConversationTurnState when Redis has a valid JSON string', async () => {
    const mockRedis = buildMockRedis({
      get: vi.fn().mockResolvedValue(JSON.stringify(VALID_TURN_STATE)),
    });

    const result = await getTurnState(ACTOR_ID, mockRedis);

    expect(result).toEqual(VALID_TURN_STATE);
  });

  it('uses key format conv:turn:{actorId}', async () => {
    const mockGet = vi.fn().mockResolvedValue(null);
    const mockRedis = buildMockRedis({ get: mockGet });

    await getTurnState(ACTOR_ID, mockRedis);

    expect(mockGet).toHaveBeenCalledWith(`conv:turn:${ACTOR_ID}`);
  });

  it('returns null when Redis key does not exist (miss)', async () => {
    const mockRedis = buildMockRedis({
      get: vi.fn().mockResolvedValue(null),
    });

    const result = await getTurnState(ACTOR_ID, mockRedis);

    expect(result).toBeNull();
  });

  it('returns null (fail-open) when Redis throws', async () => {
    const mockRedis = buildMockRedis({
      get: vi.fn().mockRejectedValue(new Error('Redis connection refused')),
    });

    const result = await getTurnState(ACTOR_ID, mockRedis);

    expect(result).toBeNull();
  });

  it('returns null (fail-open) when Redis returns malformed JSON', async () => {
    const mockRedis = buildMockRedis({
      get: vi.fn().mockResolvedValue('{invalid json'),
    });

    const result = await getTurnState(ACTOR_ID, mockRedis);

    expect(result).toBeNull();
  });

  it('returns null when Redis returns empty string', async () => {
    const mockRedis = buildMockRedis({
      get: vi.fn().mockResolvedValue(''),
    });

    const result = await getTurnState(ACTOR_ID, mockRedis);

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setTurnState
// ---------------------------------------------------------------------------

describe('setTurnState', () => {
  it('calls redis.set with correct key, JSON string, EX, and TTL', async () => {
    const mockSet = vi.fn().mockResolvedValue('OK');
    const mockRedis = buildMockRedis({ set: mockSet });

    await setTurnState(ACTOR_ID, VALID_TURN_STATE, mockRedis);

    expect(mockSet).toHaveBeenCalledWith(
      `conv:turn:${ACTOR_ID}`,
      JSON.stringify(VALID_TURN_STATE),
      'EX',
      TURN_STATE_TTL_SECONDS,
    );
  });

  it('does NOT rethrow when Redis.set throws (fail-open)', async () => {
    const mockRedis = buildMockRedis({
      set: vi.fn().mockRejectedValue(new Error('Redis write error')),
    });

    // Must resolve normally, not throw
    await expect(setTurnState(ACTOR_ID, VALID_TURN_STATE, mockRedis)).resolves.toBeUndefined();
  });

  it('resolves to undefined (void) on success', async () => {
    const mockRedis = buildMockRedis({
      set: vi.fn().mockResolvedValue('OK'),
    });

    const result = await setTurnState(ACTOR_ID, VALID_TURN_STATE, mockRedis);

    expect(result).toBeUndefined();
  });
});
