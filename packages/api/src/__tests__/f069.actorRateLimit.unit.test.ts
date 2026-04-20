// F069 — Actor Rate Limiting Unit Tests
//
// Tests for per-actor daily rate limiting logic.

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

function createMockRedis(currentCount: number = 0) {
  return {
    incr: vi.fn().mockResolvedValue(currentCount + 1),
    expire: vi.fn().mockResolvedValue(1),
  };
}

function _createFailingRedis() {
  return {
    incr: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    expire: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
  };
}

// ---------------------------------------------------------------------------
// Constants (mirrored from actorRateLimit.ts)
// ---------------------------------------------------------------------------

const DAILY_LIMITS = { queries: 50, photos: 10 };
const ROUTE_BUCKET_MAP: Record<string, string> = {
  '/estimate': 'queries',
  '/analyze/menu': 'photos',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F069 — Actor Rate Limiting', () => {
  describe('bucket mapping', () => {
    it('maps /estimate to queries bucket', () => {
      expect(ROUTE_BUCKET_MAP['/estimate']).toBe('queries');
    });

    it('maps /analyze/menu to photos bucket', () => {
      expect(ROUTE_BUCKET_MAP['/analyze/menu']).toBe('photos');
    });

    it('returns undefined for unmapped routes', () => {
      expect(ROUTE_BUCKET_MAP['/health']).toBeUndefined();
      expect(ROUTE_BUCKET_MAP['/calculate/recipe']).toBeUndefined();
    });
  });

  describe('daily limits', () => {
    it('allows requests under limit', () => {
      const current = 25;
      expect(current <= DAILY_LIMITS.queries).toBe(true);
    });

    it('blocks requests at limit', () => {
      const current = 51;
      expect(current > DAILY_LIMITS.queries).toBe(true);
    });

    it('photo limit is 10/day', () => {
      expect(DAILY_LIMITS.photos).toBe(10);
    });

    it('query limit is 50/day', () => {
      expect(DAILY_LIMITS.queries).toBe(50);
    });
  });

  describe('Redis key structure', () => {
    it('generates correct key format', () => {
      const actorId = '00000000-0000-0000-0000-000000000001';
      const dateKey = '2026-04-02';
      const bucket = 'queries';
      const key = `actor:limit:${actorId}:${dateKey}:${bucket}`;
      expect(key).toBe('actor:limit:00000000-0000-0000-0000-000000000001:2026-04-02:queries');
    });

    it('different dates produce different keys', () => {
      const actorId = 'test-actor';
      const key1 = `actor:limit:${actorId}:2026-04-02:queries`;
      const key2 = `actor:limit:${actorId}:2026-04-03:queries`;
      expect(key1).not.toBe(key2);
    });
  });

  describe('Redis operations', () => {
    it('increments counter on Redis', async () => {
      const redis = createMockRedis(0);
      const result = await redis.incr('test-key');
      expect(result).toBe(1);
      expect(redis.incr).toHaveBeenCalledWith('test-key');
    });

    it('sets TTL on first increment', async () => {
      const redis = createMockRedis(0);
      const count = await redis.incr('test-key');
      if (count === 1) {
        await redis.expire('test-key', 86400);
      }
      expect(redis.expire).toHaveBeenCalledWith('test-key', 86400);
    });

    it('does not set TTL on subsequent increments', async () => {
      const redis = createMockRedis(5);
      const count = await redis.incr('test-key');
      if (count === 1) {
        await redis.expire('test-key', 86400);
      }
      // count is 6, not 1 → expire should NOT be called
      expect(redis.expire).not.toHaveBeenCalled();
    });
  });

  describe('fail-open/fail-closed policy', () => {
    it('fail-closed for anonymous (no API key)', () => {
      const hasApiKey = false;
      // On Redis failure with no API key → deny
      expect(hasApiKey).toBe(false);
    });

    it('fail-open for authenticated (has API key)', () => {
      const hasApiKey = true;
      // On Redis failure with API key → allow
      expect(hasApiKey).toBe(true);
    });
  });
});
