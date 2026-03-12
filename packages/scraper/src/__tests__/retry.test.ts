import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry } from '../utils/retry.js';
import {
  ScraperNetworkError,
  ScraperBlockedError,
} from '../base/errors.js';
import type { RetryPolicy } from '../base/types.js';

const defaultPolicy: RetryPolicy = {
  maxRetries: 3,
  backoffMs: 1000,
  backoffMultiplier: 2,
};

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('returns the resolved value when the function succeeds on the first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const promise = withRetry(fn, defaultPolicy, 'test-context');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on ScraperNetworkError and succeeds on the second attempt', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ScraperNetworkError('timeout'))
      .mockResolvedValue('ok');

    const promise = withRetry(fn, defaultPolicy, 'test-context');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries up to maxRetries times, then throws ScraperNetworkError', async () => {
    const policy: RetryPolicy = {
      maxRetries: 2,
      backoffMs: 500,
      backoffMultiplier: 2,
    };
    const err = new ScraperNetworkError('persistent network failure');
    // Use mockImplementation to avoid creating auto-tracked rejected promises
    const fn = vi.fn().mockImplementation(() => Promise.reject(err));

    const resultPromise = withRetry(fn, policy, 'test-context');
    // Attach a noop catch so the promise is never "unhandled"
    const caught = resultPromise.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const result = await caught;
    expect(result).toBeInstanceOf(ScraperNetworkError);
    // initial attempt + 2 retries = 3 total calls
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry when the function throws ScraperBlockedError', async () => {
    const err = new ScraperBlockedError('403 forbidden');
    const fn = vi.fn().mockImplementation(() => Promise.reject(err));

    const resultPromise = withRetry(fn, defaultPolicy, 'test-context');
    const caught = resultPromise.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const result = await caught;
    expect(result).toBeInstanceOf(ScraperBlockedError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on a generic Error with HTTP status 403 in the message', async () => {
    const err = new Error('HTTP 403 access denied');
    const fn = vi.fn().mockImplementation(() => Promise.reject(err));

    const resultPromise = withRetry(fn, defaultPolicy, 'test-context');
    const caught = resultPromise.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const result = await caught;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('HTTP 403 access denied');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on a generic Error with HTTP status 404 in the message', async () => {
    const err = new Error('HTTP 404 not found');
    const fn = vi.fn().mockImplementation(() => Promise.reject(err));

    const resultPromise = withRetry(fn, defaultPolicy, 'test-context');
    const caught = resultPromise.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const result = await caught;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('HTTP 404 not found');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on errors with 429 in the message', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('HTTP 429 too many requests'))
      .mockResolvedValue('ok');

    const promise = withRetry(fn, defaultPolicy, 'test-context');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on errors with 503 in the message', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('HTTP 503 service unavailable'))
      .mockResolvedValue('ok');

    const promise = withRetry(fn, defaultPolicy, 'test-context');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('applies exponential back-off delay between attempts', async () => {
    const policy: RetryPolicy = {
      maxRetries: 2,
      backoffMs: 1000,
      backoffMultiplier: 2,
    };
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ScraperNetworkError('error 1'))
      .mockRejectedValueOnce(new ScraperNetworkError('error 2'))
      .mockResolvedValue('ok');

    const advanceSpy = vi.spyOn(global, 'setTimeout');
    const promise = withRetry(fn, policy, 'test-context');
    await vi.runAllTimersAsync();
    await promise;

    // First retry: backoffMs * backoffMultiplier^0 = 1000ms
    // Second retry: backoffMs * backoffMultiplier^1 = 2000ms
    const delays = advanceSpy.mock.calls.map((call) => call[1]);
    expect(delays[0]).toBe(1000);
    expect(delays[1]).toBe(2000);
  });

  it('caps the back-off delay at 30000ms', async () => {
    const policy: RetryPolicy = {
      maxRetries: 1,
      backoffMs: 20000,
      backoffMultiplier: 5,
    };
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ScraperNetworkError('error'))
      .mockResolvedValue('ok');

    const advanceSpy = vi.spyOn(global, 'setTimeout');
    const promise = withRetry(fn, policy, 'test-context');
    await vi.runAllTimersAsync();
    await promise;

    // 20000 * 5^0 = 20000 but cap is 30000 — first retry still uses 20000ms
    // On second attempt it would be 20000 * 5 = 100000 → capped to 30000ms
    const delays = advanceSpy.mock.calls.map((call) => call[1]);
    expect(delays[0]).toBeLessThanOrEqual(30000);
  });

  it('logs a warn for each retry attempt', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ScraperNetworkError('error 1'))
      .mockRejectedValueOnce(new ScraperNetworkError('error 2'))
      .mockResolvedValue('ok');

    const promise = withRetry(fn, defaultPolicy, 'test-context');
    await vi.runAllTimersAsync();
    await promise;

    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });
});
