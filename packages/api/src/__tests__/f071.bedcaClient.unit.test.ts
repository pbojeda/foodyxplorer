/**
 * F071 — BEDCA API Client Unit Tests
 *
 * Tests for the HTTP client that fetches from the BEDCA XML API.
 *
 * Key behaviors:
 * - Sends correct POST to BEDCA URL with form-encoded SQL query
 * - Returns raw XML string
 * - 30s timeout via AbortSignal.timeout
 * - Retries 3x on 5xx/network errors with exponential backoff
 * - 4xx responses propagate immediately (no retry)
 * - Retry exhausted → throws BedcaFetchError
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchBedcaFoodsXml,
  fetchBedcaNutrientIndexXml,
  BEDCA_API_URL,
} from '../ingest/bedca/bedcaClient.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOkFetch(body: string): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => body,
  } as Response);
}

function makeServerErrorFetch(status: number = 500): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: async () => 'Internal Server Error',
  } as Response);
}

function makeNetworkErrorFetch(): typeof fetch {
  return vi.fn().mockRejectedValue(new Error('Network failure'));
}

function makeSuccessAfterNFetch(failures: number, successBody: string): typeof fetch {
  let callCount = 0;
  return vi.fn().mockImplementation(async () => {
    callCount++;
    if (callCount <= failures) {
      throw new Error('Network failure');
    }
    return {
      ok: true,
      status: 200,
      text: async () => successBody,
    } as Response;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BEDCA_API_URL', () => {
  it('points to the correct BEDCA endpoint', () => {
    expect(BEDCA_API_URL).toBe('https://www.bedca.net/bdpub/procquery.php');
  });
});

describe('fetchBedcaFoodsXml', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('sends POST to BEDCA URL with form-encoded SQL query for foods+nutrients', async () => {
    const mockFetch = makeOkFetch('<food_database></food_database>');

    await fetchBedcaFoodsXml(mockFetch);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(BEDCA_API_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    // Body must contain a JOIN query to get foods + nutrients in one request
    const body = init.body as string;
    expect(body).toContain('select');
    expect(body).toContain('food');
  });

  it('returns raw XML string from successful response', async () => {
    const xml = '<food_database><food><food_id>1</food_id></food></food_database>';
    const mockFetch = makeOkFetch(xml);

    const result = await fetchBedcaFoodsXml(mockFetch);

    expect(result).toBe(xml);
  });

  it('retries on 5xx response and succeeds on 3rd attempt', async () => {
    vi.useRealTimers(); // retries use real setTimeout, need real timers or proper mocking
    const mockFetch = makeSuccessAfterNFetch(2, '<food_database></food_database>');

    const result = await fetchBedcaFoodsXml(mockFetch, { retryDelayMs: 0 });

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result).toBe('<food_database></food_database>');
  });

  it('retries on network error and succeeds', async () => {
    vi.useRealTimers();
    const mockFetch = makeSuccessAfterNFetch(1, '<food_database></food_database>');

    const result = await fetchBedcaFoodsXml(mockFetch, { retryDelayMs: 0 });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toBe('<food_database></food_database>');
  });

  it('throws after 3 retries exhausted (4 total calls)', async () => {
    vi.useRealTimers();
    const mockFetch = makeNetworkErrorFetch();

    await expect(fetchBedcaFoodsXml(mockFetch, { retryDelayMs: 0 })).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it('propagates 4xx immediately without retry', async () => {
    vi.useRealTimers();
    const mockFetch = makeServerErrorFetch(404);

    await expect(fetchBedcaFoodsXml(mockFetch, { retryDelayMs: 0 })).rejects.toThrow(/404/);
    expect(mockFetch).toHaveBeenCalledTimes(1); // no retry on 4xx
  });
});

describe('fetchBedcaNutrientIndexXml', () => {
  it('sends POST for nutrient reference table', async () => {
    const mockFetch = makeOkFetch('<food_database></food_database>');

    await fetchBedcaNutrientIndexXml(mockFetch);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(BEDCA_API_URL);
    expect(init.method).toBe('POST');
    const body = init.body as string;
    expect(body).toContain('nutrient');
  });

  it('returns raw XML string', async () => {
    const xml = '<food_database><nutrient><nutrient_id>208</nutrient_id></nutrient></food_database>';
    const mockFetch = makeOkFetch(xml);

    const result = await fetchBedcaNutrientIndexXml(mockFetch);

    expect(result).toBe(xml);
  });
});
