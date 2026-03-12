// Exponential back-off retry utility for the scraper pipeline.
//
// Transient errors (network failures, HTTP 429, HTTP 503) are retried.
// Non-retryable errors (HTTP 403, HTTP 404, ScraperBlockedError) are re-thrown
// immediately without consuming retry budget.

import { ScraperBlockedError, ScraperNetworkError, ScraperStructureError } from '../base/errors.js';
import type { RetryPolicy } from '../base/types.js';

const MAX_BACKOFF_MS = 30_000;

/**
 * Returns true when the error should trigger a retry attempt.
 */
function isTransient(error: unknown): boolean {
  if (error instanceof ScraperNetworkError) return true;
  if (error instanceof Error) {
    const msg = error.message;
    return msg.includes('429') || msg.includes('503');
  }
  return false;
}

/**
 * Returns true when the error should cause an immediate re-throw without retry.
 */
function isNonRetryable(error: unknown): boolean {
  if (error instanceof ScraperBlockedError) return true;
  if (error instanceof ScraperStructureError) return true;
  if (error instanceof Error) {
    const msg = error.message;
    return msg.includes('403') || msg.includes('404');
  }
  return false;
}

/**
 * Delay execution for the given number of milliseconds.
 * Compatible with vi.useFakeTimers() in tests.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps an async function with exponential back-off retry logic.
 *
 * @param fn - The async function to execute.
 * @param policy - Retry policy from ScraperConfig.retryPolicy.
 * @param context - Descriptive label for log messages (e.g. "McDonald's: product page").
 * @returns The resolved value of fn on success.
 * @throws The last error when retries are exhausted or the error is non-retryable.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  context: string,
): Promise<T> {
  const { maxRetries, backoffMs, backoffMultiplier } = policy;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Non-retryable errors — abort immediately
      if (isNonRetryable(error)) {
        throw error;
      }

      // If we've exhausted all attempts, throw
      if (attempt >= maxRetries) {
        break;
      }

      // Compute back-off delay
      const waitMs = Math.min(
        backoffMs * Math.pow(backoffMultiplier, attempt),
        MAX_BACKOFF_MS,
      );

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      console.warn(
        `[withRetry] ${context} — attempt ${attempt + 1} failed: ${errorMessage}. Retrying in ${waitMs}ms...`,
      );

      await delay(waitMs);
    }
  }

  // Exhausted retries — wrap in ScraperNetworkError if not already one
  if (lastError instanceof ScraperNetworkError) {
    throw lastError;
  }

  const message =
    lastError instanceof Error
      ? lastError.message
      : `Unknown error in ${context}`;
  throw new ScraperNetworkError(
    `${context} failed after ${maxRetries} retries: ${message}`,
  );
}
