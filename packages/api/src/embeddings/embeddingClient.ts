// Embedding client — wraps the OpenAI SDK for embedding generation.
//
// Exports:
//   estimateTokens(texts)            — word-count * 1.3 heuristic (no tiktoken)
//   RateLimiter                      — token-bucket rate limiter for RPM compliance
//   callOpenAIEmbeddings(texts, cfg) — calls OpenAI, retries on 429/5xx, returns number[][]

import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddingClientConfig {
  apiKey: string;
  model: string;
  rpm: number;
}

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

/**
 * Estimate the number of tokens for a list of texts using a word-count heuristic.
 * Formula: Math.ceil(total_words * 1.3)
 * This avoids a tiktoken dependency while providing a reasonable upper bound.
 */
export function estimateTokens(texts: string[]): number {
  if (texts.length === 0) return 0;
  const totalWords = texts.reduce((sum, text) => {
    const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
    return sum + words.length;
  }, 0);
  return Math.ceil(totalWords * 1.3);
}

// ---------------------------------------------------------------------------
// RateLimiter — token bucket for OpenAI RPM compliance
// ---------------------------------------------------------------------------

/**
 * Simple in-memory token bucket rate limiter.
 * Initialized with rpm (requests per minute).
 * acquire() returns a promise that resolves when a request slot is available.
 */
export class RateLimiter {
  private readonly rpm: number;
  private tokens: number;
  private lastRefillTime: number;

  constructor(rpm: number) {
    this.rpm = rpm;
    this.tokens = rpm;
    this.lastRefillTime = Date.now();
  }

  /**
   * Acquire a token from the bucket.
   * If tokens are exhausted, waits until the next minute window refills the bucket.
   */
  async acquire(): Promise<void> {
    const now = Date.now();
    const elapsedMs = now - this.lastRefillTime;
    const windowMs = 60_000; // 1 minute

    // Refill tokens proportionally to elapsed time
    if (elapsedMs >= windowMs) {
      const windows = Math.floor(elapsedMs / windowMs);
      this.tokens = Math.min(this.rpm, this.tokens + windows * this.rpm);
      this.lastRefillTime = now - (elapsedMs % windowMs);
    }

    if (this.tokens > 0) {
      this.tokens -= 1;
      return;
    }

    // Need to wait until the current window expires
    const msUntilRefill = windowMs - (now - this.lastRefillTime);
    await sleep(msUntilRefill);
    this.tokens = this.rpm - 1; // refill and consume one
    this.lastRefillTime = Date.now();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
  if (error !== null && typeof error === 'object') {
    const status = (error as Record<string, unknown>)['status'];
    if (typeof status === 'number') {
      return status === 429 || status >= 500;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// callOpenAIEmbeddings
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1_000;

/**
 * Call the OpenAI embeddings API for a batch of texts.
 * Retries up to 3 times with exponential backoff on 429 or 5xx errors.
 * Non-retryable errors (4xx != 429) are re-thrown immediately.
 *
 * @param texts - Array of text strings to embed
 * @param config - API key, model, and RPM limit
 * @returns 2D array of embedding vectors (one per input text)
 */
export async function callOpenAIEmbeddings(
  texts: string[],
  config: EmbeddingClientConfig,
): Promise<number[][]> {
  const client = new OpenAI({ apiKey: config.apiKey });

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await client.embeddings.create({
        model: config.model,
        input: texts,
      });

      return response.data.map((item) => item.embedding);
    } catch (error) {
      if (!isRetryableError(error)) {
        // Non-retryable error — re-throw immediately
        throw error;
      }

      lastError = error;

      // Exponential backoff: 1s, 2s, 4s
      if (attempt < MAX_RETRIES - 1) {
        const backoffMs = BASE_BACKOFF_MS * Math.pow(2, attempt);
        await sleep(backoffMs);
      }
    }
  }

  throw lastError;
}
