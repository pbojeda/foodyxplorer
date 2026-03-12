// Token-bucket rate limiter for the scraper pipeline.
//
// Used inside BaseScraper for any manual request orchestration outside the
// Crawlee queue. Crawlee's own maxRequestsPerMinute option handles rate
// limiting at the crawler level; this class is an additional guard.
//
// Minimum delay between requests: 3000 + Math.random() * 2000 ms (jitter).

const MIN_JITTER_MS = 3_000;
const JITTER_RANGE_MS = 2_000;

/**
 * Token-bucket rate limiter.
 *
 * Initialised with `requestsPerMinute` tokens. One token is consumed per
 * `acquire()` call. Tokens refill at a rate of one per
 * `60_000 / requestsPerMinute` ms. Token count never exceeds the initial
 * capacity.
 *
 * A per-request jitter delay (`3000 + Math.random() * 2000` ms) is applied
 * on every `acquire()` call in addition to any token-wait time.
 */
export class RateLimiter {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillIntervalMs: number;
  private lastRefillTime: number;
  private queue: Array<() => void> = [];
  private processing = false;

  /**
   * @param requestsPerMinute - Maximum number of requests allowed per minute.
   */
  constructor(requestsPerMinute: number) {
    this.capacity = requestsPerMinute;
    this.tokens = requestsPerMinute;
    this.refillIntervalMs = Math.floor(60_000 / requestsPerMinute);
    this.lastRefillTime = Date.now();
  }

  /**
   * Acquires a token from the bucket. Resolves when a token is available.
   * Applies an additional jitter delay to spread out requests.
   */
  async acquire(): Promise<void> {
    await this.waitForToken();
    await this.applyJitter();
  }

  /**
   * Waits until a token is available in the bucket, then consumes it.
   */
  private waitForToken(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      if (!this.processing) {
        void this.processQueue();
      }
    });
  }

  /**
   * Processes the queue sequentially, refilling tokens as time elapses.
   */
  private async processQueue(): Promise<void> {
    this.processing = true;

    while (this.queue.length > 0) {
      this.refill();

      if (this.tokens >= 1) {
        this.tokens -= 1;
        const resolve = this.queue.shift();
        if (resolve !== undefined) {
          resolve();
        }
      } else {
        // Wait until the next token is available
        const waitMs = this.refillIntervalMs - (Date.now() - this.lastRefillTime);
        if (waitMs > 0) {
          await this.sleep(waitMs);
        }
        this.refill();
        this.tokens = Math.max(0, this.tokens - 1);
        const resolve = this.queue.shift();
        if (resolve !== undefined) {
          resolve();
        }
      }
    }

    this.processing = false;
  }

  /**
   * Refills tokens based on elapsed time since the last refill.
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;
    const tokensToAdd = Math.floor(elapsed / this.refillIntervalMs);

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
      this.lastRefillTime = now - (elapsed % this.refillIntervalMs);
    }
  }

  /**
   * Applies the mandatory jitter delay between requests.
   * Delay = 3000 + Math.random() * 2000 ms.
   */
  private applyJitter(): Promise<void> {
    const jitterMs = MIN_JITTER_MS + Math.random() * JITTER_RANGE_MS;
    return this.sleep(jitterMs);
  }

  /**
   * Returns a Promise that resolves after `ms` milliseconds.
   * Compatible with vi.useFakeTimers().
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
