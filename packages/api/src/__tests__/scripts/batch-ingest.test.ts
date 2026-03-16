// Unit tests for batch-ingest.ts — runBatch() function.
//
// All tests inject a mock fetchImpl — no real API server, no DB.
// Tests cover: happy path, chain failures, network errors, filtering,
// dry-run, custom apiBaseUrl, disabled chains, JSON parse errors.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runBatch } from '../../scripts/batch-ingest.js';
import type { RunBatchOptions } from '../../scripts/batch-ingest.js';
import type { ChainPdfConfig } from '../../config/chains/chain-pdf-registry.js';
import { CHAIN_SEED_IDS } from '../../config/chains/chain-seed-ids.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_OPTS: RunBatchOptions = {
  dryRun: false,
  apiBaseUrl: 'http://localhost:3001',
  concurrency: 1,
};

/** Build a minimal ChainPdfConfig entry for test usage. */
function makeChain(overrides: Partial<ChainPdfConfig> & { chainSlug: string }): ChainPdfConfig {
  return {
    name:            `Test chain ${overrides.chainSlug}`,
    countryCode:     'ES',
    pdfUrl:          `https://example.com/${overrides.chainSlug}.pdf`,
    restaurantId:    '00000000-0000-0000-0006-000000000099',
    sourceId:        '00000000-0000-0000-0000-000000000099',
    updateFrequency: 'unknown',
    enabled:         true,
    ...overrides,
  };
}

/** Build a mock Response-like object for the ingest endpoint. */
function makeOkResponse(data: {
  dishesFound: number;
  dishesUpserted: number;
  dishesSkipped: number;
  dryRun?: boolean;
}): Response {
  return {
    ok:     true,
    status: 200,
    json:   () => Promise.resolve({ success: true, data }),
  } as unknown as Response;
}

function makeErrorResponse(status: number, code: string, message: string): Response {
  return {
    ok:     false,
    status,
    json:   () => Promise.resolve({ success: false, error: { code, message } }),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runBatch()', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('all 4 enabled chains succeed → returns 4 success results', async () => {
    const registry: ChainPdfConfig[] = [
      makeChain({ chainSlug: 'chain-a', restaurantId: '00000000-0000-0000-0006-000000000001', sourceId: '00000000-0000-0000-0000-000000000001' }),
      makeChain({ chainSlug: 'chain-b', restaurantId: '00000000-0000-0000-0006-000000000002', sourceId: '00000000-0000-0000-0000-000000000002' }),
      makeChain({ chainSlug: 'chain-c', restaurantId: '00000000-0000-0000-0006-000000000003', sourceId: '00000000-0000-0000-0000-000000000003' }),
      makeChain({ chainSlug: 'chain-d', restaurantId: '00000000-0000-0000-0006-000000000004', sourceId: '00000000-0000-0000-0000-000000000004' }),
    ];

    mockFetch.mockResolvedValue(
      makeOkResponse({ dishesFound: 10, dishesUpserted: 9, dishesSkipped: 1 }),
    );

    const results = await runBatch(registry, BASE_OPTS, mockFetch);

    expect(results).toHaveLength(4);
    expect(results.every((r) => r.status === 'success')).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('happy path: result contains correct dish counts', async () => {
    const registry = [makeChain({ chainSlug: 'chain-a' })];
    mockFetch.mockResolvedValue(
      makeOkResponse({ dishesFound: 52, dishesUpserted: 50, dishesSkipped: 2 }),
    );

    const results = await runBatch(registry, BASE_OPTS, mockFetch);

    expect(results[0]?.status).toBe('success');
    if (results[0]?.status === 'success') {
      expect(results[0].dishesFound).toBe(52);
      expect(results[0].dishesUpserted).toBe(50);
      expect(results[0].dishesSkipped).toBe(2);
    }
  });

  // -------------------------------------------------------------------------
  // One chain fails with 4xx response
  // -------------------------------------------------------------------------

  it('one chain returns 404 NOT_FOUND → that chain is error, others succeed', async () => {
    const registry = [
      makeChain({ chainSlug: 'chain-a', restaurantId: '00000000-0000-0000-0006-000000000001', sourceId: '00000000-0000-0000-0000-000000000001' }),
      makeChain({ chainSlug: 'chain-b', restaurantId: '00000000-0000-0000-0006-000000000002', sourceId: '00000000-0000-0000-0000-000000000002' }),
      makeChain({ chainSlug: 'chain-c', restaurantId: '00000000-0000-0000-0006-000000000003', sourceId: '00000000-0000-0000-0000-000000000003' }),
    ];

    mockFetch
      .mockResolvedValueOnce(makeOkResponse({ dishesFound: 10, dishesUpserted: 10, dishesSkipped: 0 }))
      .mockResolvedValueOnce(makeErrorResponse(404, 'NOT_FOUND', 'Restaurant not found'))
      .mockResolvedValueOnce(makeOkResponse({ dishesFound: 5, dishesUpserted: 5, dishesSkipped: 0 }));

    const results = await runBatch(registry, BASE_OPTS, mockFetch);

    expect(results).toHaveLength(3);
    expect(results[0]?.status).toBe('success');
    expect(results[1]?.status).toBe('error');
    expect(results[2]?.status).toBe('success');

    if (results[1]?.status === 'error') {
      expect(results[1].errorCode).toBe('NOT_FOUND');
      expect(results[1].errorMessage).toBe('Restaurant not found');
    }
  });

  // -------------------------------------------------------------------------
  // Network error on one chain
  // -------------------------------------------------------------------------

  it('one chain throws ECONNREFUSED → that chain is NETWORK_ERROR, others continue', async () => {
    const registry = [
      makeChain({ chainSlug: 'chain-a', restaurantId: '00000000-0000-0000-0006-000000000001', sourceId: '00000000-0000-0000-0000-000000000001' }),
      makeChain({ chainSlug: 'chain-b', restaurantId: '00000000-0000-0000-0006-000000000002', sourceId: '00000000-0000-0000-0000-000000000002' }),
    ];

    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(makeOkResponse({ dishesFound: 5, dishesUpserted: 5, dishesSkipped: 0 }));

    const results = await runBatch(registry, BASE_OPTS, mockFetch);

    expect(results).toHaveLength(2);
    expect(results[0]?.status).toBe('error');
    expect(results[1]?.status).toBe('success');

    if (results[0]?.status === 'error') {
      expect(results[0].errorCode).toBe('NETWORK_ERROR');
      expect(results[0].errorMessage).toContain('ECONNREFUSED');
    }
  });

  // -------------------------------------------------------------------------
  // Single-chain filter via chainSlug option
  // -------------------------------------------------------------------------

  it('chainSlug: kfc-es → exactly 1 fetch call with correct restaurantId and sourceId', async () => {
    const registry: ChainPdfConfig[] = [
      makeChain({ chainSlug: 'burger-king-es', restaurantId: CHAIN_SEED_IDS.BURGER_KING_ES.RESTAURANT_ID, sourceId: CHAIN_SEED_IDS.BURGER_KING_ES.SOURCE_ID }),
      makeChain({ chainSlug: 'kfc-es', restaurantId: CHAIN_SEED_IDS.KFC_ES.RESTAURANT_ID, sourceId: CHAIN_SEED_IDS.KFC_ES.SOURCE_ID }),
      makeChain({ chainSlug: 'telepizza-es', restaurantId: CHAIN_SEED_IDS.TELEPIZZA_ES.RESTAURANT_ID, sourceId: CHAIN_SEED_IDS.TELEPIZZA_ES.SOURCE_ID }),
    ];

    mockFetch.mockResolvedValue(
      makeOkResponse({ dishesFound: 38, dishesUpserted: 38, dishesSkipped: 0 }),
    );

    const results = await runBatch(registry, { ...BASE_OPTS, chainSlug: 'kfc-es' }, mockFetch);

    expect(results).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify the request body contains the correct IDs
    const [_url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      restaurantId: string;
      sourceId: string;
    };
    expect(body.restaurantId).toBe(CHAIN_SEED_IDS.KFC_ES.RESTAURANT_ID);
    expect(body.sourceId).toBe(CHAIN_SEED_IDS.KFC_ES.SOURCE_ID);
  });

  // -------------------------------------------------------------------------
  // dryRun: true
  // -------------------------------------------------------------------------

  it('dryRun: true → all request bodies have dryRun: true', async () => {
    const registry = [
      makeChain({ chainSlug: 'chain-a', restaurantId: '00000000-0000-0000-0006-000000000001', sourceId: '00000000-0000-0000-0000-000000000001' }),
      makeChain({ chainSlug: 'chain-b', restaurantId: '00000000-0000-0000-0006-000000000002', sourceId: '00000000-0000-0000-0000-000000000002' }),
    ];

    mockFetch.mockResolvedValue(
      makeOkResponse({ dishesFound: 5, dishesUpserted: 0, dishesSkipped: 0, dryRun: true }),
    );

    await runBatch(registry, { ...BASE_OPTS, dryRun: true }, mockFetch);

    for (const [_url, init] of mockFetch.mock.calls as [string, RequestInit][]) {
      const body = JSON.parse(init.body as string) as { dryRun: boolean };
      expect(body.dryRun).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Custom apiBaseUrl
  // -------------------------------------------------------------------------

  it('custom apiBaseUrl → all fetch calls use staging URL', async () => {
    const registry = [
      makeChain({ chainSlug: 'chain-a' }),
    ];

    mockFetch.mockResolvedValue(
      makeOkResponse({ dishesFound: 5, dishesUpserted: 5, dishesSkipped: 0 }),
    );

    await runBatch(registry, { ...BASE_OPTS, apiBaseUrl: 'http://staging.example.com' }, mockFetch);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('staging.example.com');
    expect(url).toContain('/ingest/pdf-url');
  });

  // -------------------------------------------------------------------------
  // Unknown chainSlug → throws immediately
  // -------------------------------------------------------------------------

  it('chainSlug: nonexistent → throws Error with message about chain not found', async () => {
    const registry = [makeChain({ chainSlug: 'chain-a' })];

    await expect(
      runBatch(registry, { ...BASE_OPTS, chainSlug: 'nonexistent' }, mockFetch),
    ).rejects.toThrow('Chain not found in registry: nonexistent');

    expect(mockFetch).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // All chains disabled → returns empty array, no fetch calls
  // -------------------------------------------------------------------------

  it('all chains disabled → returns empty array, no fetch calls', async () => {
    const registry = [
      makeChain({ chainSlug: 'chain-a', enabled: false }),
      makeChain({ chainSlug: 'chain-b', enabled: false }),
    ];

    const results = await runBatch(registry, BASE_OPTS, mockFetch);

    expect(results).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // JSON parse error on response → UNEXPECTED_RESPONSE
  // -------------------------------------------------------------------------

  it('response.json() rejects → chain recorded as UNEXPECTED_RESPONSE error', async () => {
    const registry = [makeChain({ chainSlug: 'chain-a' })];

    mockFetch.mockResolvedValue({
      ok:     true,
      status: 200,
      json:   () => Promise.reject(new Error('Unexpected token')),
    } as unknown as Response);

    const results = await runBatch(registry, BASE_OPTS, mockFetch);

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('error');
    if (results[0]?.status === 'error') {
      expect(results[0].errorCode).toBe('UNEXPECTED_RESPONSE');
    }
  });

  // -------------------------------------------------------------------------
  // concurrency > 1 warning (Phase 1: sequential)
  // -------------------------------------------------------------------------

  it('concurrency > 1 → still processes all chains sequentially (no throw)', async () => {
    const registry = [
      makeChain({ chainSlug: 'chain-a', restaurantId: '00000000-0000-0000-0006-000000000001', sourceId: '00000000-0000-0000-0000-000000000001' }),
      makeChain({ chainSlug: 'chain-b', restaurantId: '00000000-0000-0000-0006-000000000002', sourceId: '00000000-0000-0000-0000-000000000002' }),
    ];

    mockFetch.mockResolvedValue(
      makeOkResponse({ dishesFound: 5, dishesUpserted: 5, dishesSkipped: 0 }),
    );

    const results = await runBatch(registry, { ...BASE_OPTS, concurrency: 4 }, mockFetch);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'success')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Request structure
  // -------------------------------------------------------------------------

  it('request uses POST method and Content-Type: application/json', async () => {
    const registry = [makeChain({ chainSlug: 'chain-a' })];

    mockFetch.mockResolvedValue(
      makeOkResponse({ dishesFound: 5, dishesUpserted: 5, dishesSkipped: 0 }),
    );

    await runBatch(registry, BASE_OPTS, mockFetch);

    const [_url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('request body contains url, restaurantId, sourceId, dryRun fields', async () => {
    const chain = makeChain({
      chainSlug:    'chain-a',
      pdfUrl:       'https://example.com/menu.pdf',
      restaurantId: '00000000-0000-0000-0006-000000000001',
      sourceId:     '00000000-0000-0000-0000-000000000001',
    });

    mockFetch.mockResolvedValue(
      makeOkResponse({ dishesFound: 5, dishesUpserted: 5, dishesSkipped: 0 }),
    );

    await runBatch([chain], BASE_OPTS, mockFetch);

    const [_url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      url: string;
      restaurantId: string;
      sourceId: string;
      dryRun: boolean;
    };

    expect(body.url).toBe('https://example.com/menu.pdf');
    expect(body.restaurantId).toBe('00000000-0000-0000-0006-000000000001');
    expect(body.sourceId).toBe('00000000-0000-0000-0000-000000000001');
    expect(body.dryRun).toBe(false);
  });
});
