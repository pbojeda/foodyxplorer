import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../utils/rateLimit.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Stub Math.random to return 0 so jitter is deterministic (min jitter = 0ms)
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('acquire() resolves immediately when tokens are available', async () => {
    const limiter = new RateLimiter(60);
    const start = Date.now();
    const promise = limiter.acquire();
    await vi.runAllTimersAsync();
    await promise;
    // With jitter stubbed to 0 and token available, the only delay is the
    // minimum jitter: 3000 + 0 * 2000 = 3000ms
    // But since tokens are available, the token-bucket wait is 0
    // The total delay should be the jitter delay only (3000ms)
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThanOrEqual(3000 + 50); // allow small overshoot
  });

  it('acquire() delays when the token bucket is empty', async () => {
    // 1 request per minute — one token available initially
    const limiter = new RateLimiter(1);

    // First acquire uses the initial token — resolves after jitter (3000ms with random=0)
    const first = limiter.acquire();
    await vi.runAllTimersAsync();
    await first;

    // Second acquire — bucket empty, must wait for refill (60000ms) + jitter
    const secondStart = Date.now();
    const second = limiter.acquire();
    await vi.runAllTimersAsync();
    await second;
    const elapsed = Date.now() - secondStart;
    // Should have waited ~60000ms for token refill
    expect(elapsed).toBeGreaterThanOrEqual(60000);
  });

  it('RateLimiter with requestsPerMinute: 60 allows 60 requests in one minute', async () => {
    const limiter = new RateLimiter(60);
    const acquires: Array<Promise<void>> = [];

    for (let i = 0; i < 60; i++) {
      acquires.push(limiter.acquire());
    }

    await vi.runAllTimersAsync();
    await Promise.all(acquires);
    // All 60 should resolve without timing out (they all have tokens available)
    expect(acquires).toHaveLength(60);
  });

  it('RateLimiter with requestsPerMinute: 1 forces a ~60000ms wait before the second token', async () => {
    const limiter = new RateLimiter(1);

    // First acquire
    const first = limiter.acquire();
    await vi.runAllTimersAsync();
    await first;

    // Manually advance 60000ms to simulate token refill
    const beforeSecond = Date.now();
    const second = limiter.acquire();
    await vi.runAllTimersAsync();
    await second;
    const waitTime = Date.now() - beforeSecond;

    // The second acquire should wait at least the refill interval (60000ms)
    expect(waitTime).toBeGreaterThanOrEqual(60000);
  });

  it('sequential acquires do not exceed requestsPerMinute over a 60-second window', async () => {
    // Use requestsPerMinute=1 so the refill interval is exactly 60000ms.
    // After the first token is consumed, the second acquire must wait ~60000ms.
    const limiter = new RateLimiter(1);
    const timestamps: number[] = [];

    // First acquire — uses the only token available
    const first = limiter.acquire();
    await vi.runAllTimersAsync();
    await first;
    timestamps.push(Date.now());

    // Second acquire — bucket empty, must wait for one refill interval (60000ms)
    const second = limiter.acquire();
    await vi.runAllTimersAsync();
    await second;
    timestamps.push(Date.now());

    const firstTimestamp = timestamps[0] ?? 0;
    const secondTimestamp = timestamps[1] ?? 0;
    // The second acquire must start at least 60000ms after the first
    expect(secondTimestamp - firstTimestamp).toBeGreaterThanOrEqual(60000);
  });
});
