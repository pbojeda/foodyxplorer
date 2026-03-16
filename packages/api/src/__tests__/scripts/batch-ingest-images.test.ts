// Unit tests for scripts/batch-ingest-images.ts
//
// All tests inject a mock fetchImpl — no real HTTP calls.
// runImageBatch is called directly with a test registry.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runImageBatch } from '../../scripts/batch-ingest-images.js';
import type { ChainImageConfig } from '../../config/chains/chain-image-registry.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RESTAURANT_ID = '00000000-0000-4000-a000-000000000001';
const SOURCE_ID     = '00000000-0000-4000-a000-000000000002';

const dominos: ChainImageConfig = {
  chainSlug:       'dominos-es',
  name:            "Domino's Spain",
  countryCode:     'ES',
  imageUrls:       [
    'https://example.com/img/tabla1.jpg',
    'https://example.com/img/tabla2.jpg',
  ],
  restaurantId:    RESTAURANT_ID,
  sourceId:        SOURCE_ID,
  updateFrequency: 'unknown',
  enabled:         true,
};

const disabledChain: ChainImageConfig = {
  ...dominos,
  chainSlug: 'disabled-chain',
  name:      'Disabled Chain',
  enabled:   false,
};

const successResponseBody = JSON.stringify({
  success: true,
  data: {
    dishesFound:    10,
    dishesUpserted: 8,
    dishesSkipped:  2,
    dryRun:         false,
  },
});

const errorResponseBody = JSON.stringify({
  success: false,
  error: {
    code:    'OCR_FAILED',
    message: 'OCR extraction failed: WASM error',
  },
});

function makeOkResponse(body: string): Response {
  return {
    ok:     true,
    status: 200,
    json:   () => Promise.resolve(JSON.parse(body) as unknown),
  } as unknown as Response;
}

function makeErrorResponse(status: number, body: string): Response {
  return {
    ok:     false,
    status,
    json:   () => Promise.resolve(JSON.parse(body) as unknown),
  } as unknown as Response;
}

const defaultOpts = {
  dryRun:     false,
  apiBaseUrl: 'http://localhost:3001',
  concurrency: 1,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runImageBatch — URL iteration', () => {
  it('calls POST /ingest/image-url once per imageUrl in an entry', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse(successResponseBody));

    await runImageBatch([dominos], defaultOpts, mockFetch);

    // dominos has 2 imageUrls → 2 calls
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns one result per imageUrl (not per chain)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse(successResponseBody));

    const results = await runImageBatch([dominos], defaultOpts, mockFetch);

    // 2 imageUrls → 2 results
    expect(results).toHaveLength(2);
  });

  it('result carries the correct imageUrl for each call', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse(successResponseBody));

    const results = await runImageBatch([dominos], defaultOpts, mockFetch);

    expect(results[0]?.imageUrl).toBe(dominos.imageUrls[0]);
    expect(results[1]?.imageUrl).toBe(dominos.imageUrls[1]);
  });
});

describe('runImageBatch — continue on failure', () => {
  it('continues after a single URL failure without aborting remaining URLs', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeErrorResponse(422, errorResponseBody))
      .mockResolvedValueOnce(makeOkResponse(successResponseBody));

    const results = await runImageBatch([dominos], defaultOpts, mockFetch);

    expect(results).toHaveLength(2);
    expect(results[0]?.status).toBe('error');
    expect(results[1]?.status).toBe('success');
  });
});

describe('runImageBatch — chain filtering', () => {
  it('filters disabled chains when no chainSlug provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse(successResponseBody));

    const results = await runImageBatch([dominos, disabledChain], defaultOpts, mockFetch);

    // Only enabled chain runs → 2 URLs (dominos only)
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(results.every((r) => r.chain.chainSlug === 'dominos-es')).toBe(true);
  });

  it('throws when chainSlug is not found in registry', async () => {
    const mockFetch = vi.fn();

    await expect(
      runImageBatch([dominos], { ...defaultOpts, chainSlug: 'nonexistent' }, mockFetch),
    ).rejects.toThrow('Chain not found in registry: nonexistent');
  });

  it('returns empty array for disabled chain when filtered by chainSlug', async () => {
    const mockFetch = vi.fn();

    const results = await runImageBatch(
      [disabledChain],
      { ...defaultOpts, chainSlug: 'disabled-chain' },
      mockFetch,
    );

    expect(results).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns empty array when no enabled chains exist', async () => {
    const mockFetch = vi.fn();

    const results = await runImageBatch([disabledChain], defaultOpts, mockFetch);

    expect(results).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('runImageBatch — concurrency warning', () => {
  it('logs warning for concurrency > 1 and falls back to sequential', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse(successResponseBody));
    const warnSpy   = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await runImageBatch([dominos], { ...defaultOpts, concurrency: 3 }, mockFetch);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('concurrency > 1'));
    // Still ran all URLs sequentially
    expect(mockFetch).toHaveBeenCalledTimes(2);

    warnSpy.mockRestore();
  });
});

describe('runImageBatch — result shapes', () => {
  it('result.status is "success" with correct fields on 200 response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse(successResponseBody));

    const results = await runImageBatch(
      [{ ...dominos, imageUrls: ['https://example.com/img/tabla1.jpg'] }],
      defaultOpts,
      mockFetch,
    );

    const r = results[0];
    expect(r?.status).toBe('success');
    if (r?.status === 'success') {
      expect(r.dishesFound).toBe(10);
      expect(r.dishesUpserted).toBe(8);
      expect(r.dishesSkipped).toBe(2);
      expect(r.dryRun).toBe(false);
    }
  });

  it('result.status is "error" with errorCode and errorMessage on non-2xx response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeErrorResponse(422, errorResponseBody));

    const results = await runImageBatch(
      [{ ...dominos, imageUrls: ['https://example.com/img/tabla1.jpg'] }],
      defaultOpts,
      mockFetch,
    );

    const r = results[0];
    expect(r?.status).toBe('error');
    if (r?.status === 'error') {
      expect(r.errorCode).toBe('OCR_FAILED');
      expect(r.errorMessage).toBe('OCR extraction failed: WASM error');
    }
  });

  it('result.status is "error" with NETWORK_ERROR when fetch throws', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const results = await runImageBatch(
      [{ ...dominos, imageUrls: ['https://example.com/img/tabla1.jpg'] }],
      defaultOpts,
      mockFetch,
    );

    const r = results[0];
    expect(r?.status).toBe('error');
    if (r?.status === 'error') {
      expect(r.errorCode).toBe('NETWORK_ERROR');
      expect(r.errorMessage).toContain('ECONNREFUSED');
    }
  });

  it('result.status is "error" with UNEXPECTED_RESPONSE when response body is not valid JSON', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok:     true,
      status: 200,
      json:   () => Promise.reject(new Error('JSON parse error')),
    } as unknown as Response);

    const results = await runImageBatch(
      [{ ...dominos, imageUrls: ['https://example.com/img/tabla1.jpg'] }],
      defaultOpts,
      mockFetch,
    );

    const r = results[0];
    expect(r?.status).toBe('error');
    if (r?.status === 'error') {
      expect(r.errorCode).toBe('UNEXPECTED_RESPONSE');
    }
  });
});

describe('runImageBatch — API call body', () => {
  it('sends correct JSON body including chainSlug and imageUrl', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse(successResponseBody));

    await runImageBatch(
      [{ ...dominos, imageUrls: ['https://example.com/img/tabla1.jpg'] }],
      { ...defaultOpts, dryRun: true },
      mockFetch,
    );

    const call       = mockFetch.mock.calls[0] as [string, RequestInit];
    const bodyString = call[1]?.body as string;
    const bodyParsed = JSON.parse(bodyString) as Record<string, unknown>;

    expect(bodyParsed['url']).toBe('https://example.com/img/tabla1.jpg');
    expect(bodyParsed['restaurantId']).toBe(RESTAURANT_ID);
    expect(bodyParsed['sourceId']).toBe(SOURCE_ID);
    expect(bodyParsed['dryRun']).toBe(true);
    expect(bodyParsed['chainSlug']).toBe('dominos-es');
  });

  it('calls the /ingest/image-url endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse(successResponseBody));

    await runImageBatch(
      [{ ...dominos, imageUrls: ['https://example.com/img/tabla1.jpg'] }],
      defaultOpts,
      mockFetch,
    );

    const call = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toContain('/ingest/image-url');
  });
});
