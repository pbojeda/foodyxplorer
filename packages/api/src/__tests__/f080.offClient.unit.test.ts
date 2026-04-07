/**
 * F080 — OFF Client Unit Tests
 *
 * Tests for fetchProductsByBrand() and fetchProductByBarcode().
 * All tests use injected fetchImpl (no real HTTP calls).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchProductsByBrand,
  fetchProductByBarcode,
  OffFetchError,
} from '../ingest/off/offClient.js';
import type { OffProduct } from '../ingest/off/types.js';

// ---------------------------------------------------------------------------
// Helper: build mock fetch responses
// ---------------------------------------------------------------------------

function makeSearchResponse(products: OffProduct[], page_size = 100, totalCount?: number): Response {
  const body = JSON.stringify({ products, count: totalCount ?? products.length, page_size });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeProductResponse(product: OffProduct | null): Response {
  if (product === null) {
    return new Response(JSON.stringify({ status: 0, product: {} }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ status: 1, product }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeErrorResponse(status: number): Response {
  return new Response(`Error ${status}`, { status });
}

function product(code: string): OffProduct {
  return {
    code,
    _id: code,
    product_name: `Product ${code}`,
    nutriments: {
      'energy-kcal_100g': 100,
      proteins_100g: 5,
      carbohydrates_100g: 10,
      fat_100g: 3,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchProductsByBrand', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends GET to OFF Search API with correct params', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeSearchResponse([product('001')]));

    const resultPromise = fetchProductsByBrand('hacendado', {
      fetchImpl: mockFetch,
      retryDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://world.openfoodfacts.org/api/v2/search');
    expect(url).toContain('brands_tags_contains=hacendado');
    expect(url).toContain('page_size=100');
    expect(url).toContain('page=1');
  });

  it('includes correct User-Agent header on every request', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeSearchResponse([product('001')]));

    const resultPromise = fetchProductsByBrand('hacendado', {
      fetchImpl: mockFetch,
      retryDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    await resultPromise;

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('nutriXplorer/1.0 (nutrixplorer@example.com)');
  });

  it('returns all products from a single-page response', async () => {
    const products = Array.from({ length: 3 }, (_, i) => product(`00${i}`));
    const mockFetch = vi.fn().mockResolvedValue(makeSearchResponse(products, 100));

    const resultPromise = fetchProductsByBrand('hacendado', {
      fetchImpl: mockFetch,
      retryDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toHaveLength(3);
  });

  it('paginates: returns 150 products when page 1 has 100 and page 2 has 50', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => product(`p1-${i}`));
    const page2 = Array.from({ length: 50 }, (_, i) => product(`p2-${i}`));

    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeSearchResponse(page1, 100, 150))
      .mockResolvedValueOnce(makeSearchResponse(page2, 100, 150));

    const resultPromise = fetchProductsByBrand('hacendado', {
      fetchImpl: mockFetch,
      retryDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toHaveLength(150);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('uses count to paginate — does not stop on intermediate pages with fewer products', async () => {
    // OFF API may return fewer products on intermediate pages (e.g., page 6 returns 99)
    const page1 = Array.from({ length: 100 }, (_, i) => product(`p1-${i}`));
    const page2 = Array.from({ length: 99 }, (_, i) => product(`p2-${i}`)); // partial intermediate
    const page3 = Array.from({ length: 30 }, (_, i) => product(`p3-${i}`)); // real last page

    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeSearchResponse(page1, 100, 229))
      .mockResolvedValueOnce(makeSearchResponse(page2, 100, 229))
      .mockResolvedValueOnce(makeSearchResponse(page3, 100, 229));

    const resultPromise = fetchProductsByBrand('hacendado', {
      fetchImpl: mockFetch,
      retryDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toHaveLength(229);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('terminates on last page when count indicates no more pages', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => product(`p1-${i}`));
    const page2 = Array.from({ length: 30 }, (_, i) => product(`p2-${i}`));

    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeSearchResponse(page1, 100, 130))
      .mockResolvedValueOnce(makeSearchResponse(page2, 100, 130));

    const resultPromise = fetchProductsByBrand('hacendado', {
      fetchImpl: mockFetch,
      retryDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toHaveLength(130);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('respects --limit: does not fetch page N+1 once limit is reached', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => product(`p1-${i}`));

    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeSearchResponse(page1, 100));

    const resultPromise = fetchProductsByBrand('hacendado', {
      fetchImpl: mockFetch,
      retryDelayMs: 0,
      limit: 50,
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    // Should return at most 50 and should NOT have fetched page 2
    expect(result.length).toBeLessThanOrEqual(50);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries 5xx responses up to 3 times with exponential backoff', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeErrorResponse(503))
      .mockResolvedValueOnce(makeErrorResponse(503))
      .mockResolvedValueOnce(makeErrorResponse(503))
      .mockResolvedValueOnce(makeSearchResponse([product('001')]));

    const resultPromise = fetchProductsByBrand('hacendado', {
      fetchImpl: mockFetch,
      retryDelayMs: 10,
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('does NOT retry 4xx responses (except 429)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeErrorResponse(400));

    let caughtError: unknown;
    const resultPromise = fetchProductsByBrand('hacendado', {
      fetchImpl: mockFetch,
      retryDelayMs: 0,
    }).catch((err) => { caughtError = err; });
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(caughtError).toBeInstanceOf(OffFetchError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries 429 (Too Many Requests) with exponential backoff', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeErrorResponse(429))
      .mockResolvedValueOnce(makeSearchResponse([product('001')]));

    const resultPromise = fetchProductsByBrand('hacendado', {
      fetchImpl: mockFetch,
      retryDelayMs: 10,
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries network errors', async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(makeSearchResponse([product('001')]));

    const resultPromise = fetchProductsByBrand('hacendado', {
      fetchImpl: mockFetch,
      retryDelayMs: 10,
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('queries both "hacendado" and "mercadona" when brand is "mercadona"', async () => {
    const hacendadoProducts = [product('h1'), product('h2')];
    const mercadonaProducts = [product('m1')];

    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeSearchResponse(hacendadoProducts))
      .mockResolvedValueOnce(makeSearchResponse(mercadonaProducts));

    const resultPromise = fetchProductsByBrand('mercadona', {
      fetchImpl: mockFetch,
      retryDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toHaveLength(3);
    // Both brand queries were made
    const urls = mockFetch.mock.calls.map(([url]: [string]) => url as string);
    expect(urls.some((u) => u.includes('hacendado'))).toBe(true);
    expect(urls.some((u) => u.includes('mercadona'))).toBe(true);
  });

  it('deduplicates products by code when merging mercadona + hacendado results', async () => {
    const shared = product('SHARED');
    const hacendadoProducts = [shared, product('h1')];
    const mercadonaProducts = [shared, product('m1')]; // SHARED appears in both

    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeSearchResponse(hacendadoProducts))
      .mockResolvedValueOnce(makeSearchResponse(mercadonaProducts));

    const resultPromise = fetchProductsByBrand('mercadona', {
      fetchImpl: mockFetch,
      retryDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    // SHARED counted once; total = 3 (SHARED + h1 + m1)
    expect(result).toHaveLength(3);
  });
});

describe('fetchProductByBarcode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends GET to OFF Product API with correct URL', async () => {
    const p = product('8480000123456');
    const mockFetch = vi.fn().mockResolvedValue(makeProductResponse(p));

    const resultPromise = fetchProductByBarcode('8480000123456', {
      fetchImpl: mockFetch,
      retryDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    await resultPromise;

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://world.openfoodfacts.org/api/v2/product/8480000123456.json',
    );
  });

  it('returns null for 404 response (product not found)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeProductResponse(null));

    const resultPromise = fetchProductByBarcode('0000000000000', {
      fetchImpl: mockFetch,
      retryDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBeNull();
  });

  it('returns the product object for a 200 response', async () => {
    const p = product('8480000123456');
    const mockFetch = vi.fn().mockResolvedValue(makeProductResponse(p));

    const resultPromise = fetchProductByBarcode('8480000123456', {
      fetchImpl: mockFetch,
      retryDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).not.toBeNull();
    expect(result?.code).toBe('8480000123456');
  });
});
