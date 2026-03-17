// Unit tests for F019 embedding client — estimateTokens, callOpenAIEmbeddings, RateLimiter
//
// Mocks the openai SDK — no real API calls.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the openai package before importing our module
// ---------------------------------------------------------------------------

const mockEmbeddingsCreate = vi.fn();

vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      embeddings: {
        create: mockEmbeddingsCreate,
      },
    })),
  };
});

import {
  estimateTokens,
  callOpenAIEmbeddings,
  RateLimiter,
  type EmbeddingClientConfig,
} from '../embeddings/embeddingClient.js';

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe('estimateTokens', () => {
  it('returns Math.ceil(word_count * 1.3) for a simple text', () => {
    // 'hello world' = 2 words, ceil(2 * 1.3) = ceil(2.6) = 3
    expect(estimateTokens(['hello world'])).toBe(3);
  });

  it('counts words across multiple texts', () => {
    // 'hello world' = 2 words, 'foo bar baz' = 3 words → 5 words, ceil(5 * 1.3) = ceil(6.5) = 7
    expect(estimateTokens(['hello world', 'foo bar baz'])).toBe(7);
  });

  it('returns 0 for empty array', () => {
    expect(estimateTokens([])).toBe(0);
  });

  it('handles single-word text', () => {
    // 1 word → ceil(1 * 1.3) = ceil(1.3) = 2
    expect(estimateTokens(['food'])).toBe(2);
  });

  it('handles multi-word single text', () => {
    // 'a b c d e' = 5 words → ceil(5 * 1.3) = ceil(6.5) = 7
    expect(estimateTokens(['a b c d e'])).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// callOpenAIEmbeddings — happy path
// ---------------------------------------------------------------------------

describe('callOpenAIEmbeddings — happy path', () => {
  const config: EmbeddingClientConfig = {
    apiKey: 'sk-test',
    model: 'text-embedding-3-small',
    rpm: 60_000, // very high RPM to avoid throttling in tests
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 2D array of number vectors from SDK response', async () => {
    const mockEmbedding1 = Array(1536).fill(0.1);
    const mockEmbedding2 = Array(1536).fill(0.2);

    mockEmbeddingsCreate.mockResolvedValueOnce({
      data: [
        { embedding: mockEmbedding1 },
        { embedding: mockEmbedding2 },
      ],
    });

    const result = await callOpenAIEmbeddings(['text one', 'text two'], config);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(mockEmbedding1);
    expect(result[1]).toEqual(mockEmbedding2);
    expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: ['text one', 'text two'],
    });
  });
});

// ---------------------------------------------------------------------------
// callOpenAIEmbeddings — retry on 429
// ---------------------------------------------------------------------------

describe('callOpenAIEmbeddings — retry on 429', () => {
  const config: EmbeddingClientConfig = {
    apiKey: 'sk-test',
    model: 'text-embedding-3-small',
    rpm: 60_000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries once on 429 and succeeds on second attempt', async () => {
    const mockEmbedding = Array(1536).fill(0.1);
    const rateLimitError = Object.assign(new Error('Rate limit exceeded'), { status: 429 });

    mockEmbeddingsCreate
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce({ data: [{ embedding: mockEmbedding }] });

    const promise = callOpenAIEmbeddings(['text'], config);
    // Advance timers to unblock exponential backoff (1s first retry)
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(mockEmbedding);
    expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(2);
  });

  it('retries 3 times on 5xx errors then re-throws after 3 failures', async () => {
    const serverError = Object.assign(new Error('Server error'), { status: 503 });

    mockEmbeddingsCreate.mockImplementation(() => Promise.reject(serverError));

    // Run timers and await the rejection together to avoid unhandled rejection leaks
    const result = await Promise.allSettled([
      callOpenAIEmbeddings(['text'], config),
      vi.runAllTimersAsync(),
    ]);

    expect(result[0]?.status).toBe('rejected');
    expect((result[0] as PromiseRejectedResult).reason.message).toBe('Server error');
    expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on non-retryable 4xx error (e.g. 400)', async () => {
    const badRequestError = Object.assign(new Error('Bad request'), { status: 400 });

    mockEmbeddingsCreate.mockImplementation(() => Promise.reject(badRequestError));

    const result = await Promise.allSettled([
      callOpenAIEmbeddings(['text'], config),
      vi.runAllTimersAsync(),
    ]);

    expect(result[0]?.status).toBe('rejected');
    expect((result[0] as PromiseRejectedResult).reason.message).toBe('Bad request');
    // Only called once — no retry
    expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on non-retryable 401 error', async () => {
    const authError = Object.assign(new Error('Unauthorized'), { status: 401 });

    mockEmbeddingsCreate.mockImplementation(() => Promise.reject(authError));

    const result = await Promise.allSettled([
      callOpenAIEmbeddings(['text'], config),
      vi.runAllTimersAsync(),
    ]);

    expect(result[0]?.status).toBe('rejected');
    expect((result[0] as PromiseRejectedResult).reason.message).toBe('Unauthorized');
    expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// RateLimiter
// ---------------------------------------------------------------------------

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows calls within the RPM limit without delay', async () => {
    const limiter = new RateLimiter(60); // 60 RPM = 1 per second

    // The first call should be immediate
    const startTime = Date.now();
    vi.setSystemTime(startTime);

    await limiter.acquire();
    // No time should have elapsed yet
    expect(Date.now()).toBe(startTime);
  });

  it('delays when RPM is exceeded', async () => {
    const limiter = new RateLimiter(1); // 1 RPM for easy testing

    const startMs = 0;
    vi.setSystemTime(startMs);

    // First acquire should go through immediately
    await limiter.acquire();

    // Second acquire should block until the next minute window
    const secondAcquire = limiter.acquire();
    // Advance time by 60 seconds (next window)
    await vi.advanceTimersByTimeAsync(60_000);
    await secondAcquire;

    // Time should have advanced
    expect(Date.now()).toBeGreaterThanOrEqual(startMs + 60_000);
  });
});
