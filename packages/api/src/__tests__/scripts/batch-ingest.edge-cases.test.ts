// Edge-case tests for batch-ingest.ts
//
// These tests focus on the paths NOT covered by batch-ingest.test.ts:
//   - parseCliArgs edge cases (missing values, bad types, unknown flags)
//   - runBatch() robustness: malformed success/error bodies, disabled single-chain
//   - printSummary with empty results
//   - ingestChain null-safety on partial API response shapes

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runBatch } from '../../scripts/batch-ingest.js';
import type { RunBatchOptions } from '../../scripts/batch-ingest.js';
import type { ChainPdfConfig } from '../../config/chains/chain-pdf-registry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_OPTS: RunBatchOptions = {
  dryRun: false,
  apiBaseUrl: 'http://localhost:3001',
  concurrency: 1,
};

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
// runBatch() — disabled single-chain path
// ---------------------------------------------------------------------------

describe('runBatch() — disabled single-chain', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it('chainSlug pointing to a disabled chain → returns empty array, no fetch calls', async () => {
    // The spec §9.4: "if not enabled → print warning, exit(0)" — runBatch returns []
    const registry = [
      makeChain({ chainSlug: 'disabled-chain', enabled: false }),
      makeChain({ chainSlug: 'enabled-chain', enabled: true }),
    ];

    const results = await runBatch(
      registry,
      { ...BASE_OPTS, chainSlug: 'disabled-chain' },
      mockFetch,
    );

    expect(results).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('chainSlug pointing to a disabled chain → other enabled chains are NOT processed', async () => {
    // Spec: when --chain is given and it is disabled, the runner stops — it does NOT
    // fall through to process the rest of the registry
    const registry = [
      makeChain({ chainSlug: 'disabled-chain', enabled: false }),
      makeChain({ chainSlug: 'enabled-chain',  enabled: true }),
    ];

    mockFetch.mockResolvedValue(makeOkResponse({ dishesFound: 5, dishesUpserted: 5, dishesSkipped: 0 }));

    const results = await runBatch(
      registry,
      { ...BASE_OPTS, chainSlug: 'disabled-chain' },
      mockFetch,
    );

    // Should NOT have called fetch for the enabled chain
    expect(mockFetch).not.toHaveBeenCalled();
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// runBatch() — malformed success response body (null-safety)
// ---------------------------------------------------------------------------

describe('runBatch() — malformed API response body', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it('success response with null data field → records UNEXPECTED_RESPONSE', async () => {
    const registry = [makeChain({ chainSlug: 'chain-a' })];

    mockFetch.mockResolvedValue({
      ok:     true,
      status: 200,
      json:   () => Promise.resolve({ success: true, data: null }),
    } as unknown as Response);

    const results = await runBatch(registry, BASE_OPTS, mockFetch);

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('error');
    if (results[0]?.status === 'error') {
      expect(results[0].errorCode).toBe('UNEXPECTED_RESPONSE');
      expect(results[0].errorMessage).toBe('API response missing data field');
    }
  });

  it('success response with missing data field → does not crash with TypeError', async () => {
    // Same class of bug: {success: true} with no data key
    const registry = [makeChain({ chainSlug: 'chain-a' })];

    mockFetch.mockResolvedValue({
      ok:     true,
      status: 200,
      json:   () => Promise.resolve({ success: true }),
    } as unknown as Response);

    // This MUST NOT throw an unhandled TypeError — the chain should record an error
    await expect(
      runBatch(registry, BASE_OPTS, mockFetch),
    ).resolves.toHaveLength(1);

    const results = await runBatch(registry, BASE_OPTS, mockFetch);
    expect(results[0]?.status).toBe('error');
  });

  it('error response with missing .error key → does not crash with TypeError', async () => {
    // Bug: line 174 does `(body as ...).error.code` — if `.error` is missing,
    // this throws TypeError caught by outer catch as NETWORK_ERROR.
    // The actual error body shape is wrong but should NOT crash.
    const registry = [makeChain({ chainSlug: 'chain-a' })];

    mockFetch.mockResolvedValue({
      ok:     false,
      status: 500,
      json:   () => Promise.resolve({ success: false }), // missing .error key
    } as unknown as Response);

    // Must not throw — must record an error result
    const results = await runBatch(registry, BASE_OPTS, mockFetch);

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('error');
  });

  it('error response with null .error field → does not crash with TypeError', async () => {
    const registry = [makeChain({ chainSlug: 'chain-a' })];

    mockFetch.mockResolvedValue({
      ok:     false,
      status: 503,
      json:   () => Promise.resolve({ success: false, error: null }),
    } as unknown as Response);

    const results = await runBatch(registry, BASE_OPTS, mockFetch);

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('error');
  });

  it('error response with non-string error.code → records error without crashing', async () => {
    const registry = [makeChain({ chainSlug: 'chain-a' })];

    mockFetch.mockResolvedValue({
      ok:     false,
      status: 422,
      json:   () => Promise.resolve({ success: false, error: { code: 42, message: null } }),
    } as unknown as Response);

    const results = await runBatch(registry, BASE_OPTS, mockFetch);

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('error');
  });

  it('non-JSON success body (text/plain "OK") → chain recorded as UNEXPECTED_RESPONSE', async () => {
    // Different from the existing test which uses promise.reject() from .json().
    // This tests a response where json() returns a non-object primitive.
    const registry = [makeChain({ chainSlug: 'chain-a' })];

    mockFetch.mockResolvedValue({
      ok:     true,
      status: 200,
      json:   () => Promise.resolve('OK'), // parsed as string, not object
    } as unknown as Response);

    const results = await runBatch(registry, BASE_OPTS, mockFetch);

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// runBatch() — empty registry (not the same as "all disabled")
// ---------------------------------------------------------------------------

describe('runBatch() — empty registry', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it('empty registry array → returns empty array, no fetch calls', async () => {
    // Spec §9.4: "if chains.length === 0 → print 'No enabled chains found', exit(0)"
    const results = await runBatch([], BASE_OPTS, mockFetch);

    expect(results).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('empty registry with chainSlug set → throws "Chain not found"', async () => {
    // chainSlug filter on empty registry must still throw
    await expect(
      runBatch([], { ...BASE_OPTS, chainSlug: 'burger-king-es' }, mockFetch),
    ).rejects.toThrow('Chain not found in registry: burger-king-es');
  });
});

// ---------------------------------------------------------------------------
// runBatch() — concurrency boundary validation
// ---------------------------------------------------------------------------

describe('runBatch() — concurrency edge cases', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it('concurrency 0 → falls through to default (1), still processes chain', async () => {
    // parseCliArgs rejects concurrency <= 0 (keeps default 1).
    // runBatch itself receives whatever parseCliArgs returns.
    // If somehow concurrency=0 reaches runBatch, the warn branch (>1) is skipped
    // but processing must still happen.
    const registry = [makeChain({ chainSlug: 'chain-a' })];
    mockFetch.mockResolvedValue(makeOkResponse({ dishesFound: 5, dishesUpserted: 5, dishesSkipped: 0 }));

    const results = await runBatch(registry, { ...BASE_OPTS, concurrency: 0 }, mockFetch);

    // Phase 1: always sequential regardless of concurrency value
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('success');
  });

  it('concurrency NaN → still processes chains sequentially', async () => {
    const registry = [makeChain({ chainSlug: 'chain-a' })];
    mockFetch.mockResolvedValue(makeOkResponse({ dishesFound: 5, dishesUpserted: 5, dishesSkipped: 0 }));

    const results = await runBatch(registry, { ...BASE_OPTS, concurrency: NaN }, mockFetch);

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('success');
  });
});

// ---------------------------------------------------------------------------
// runBatch() — URL construction
// ---------------------------------------------------------------------------

describe('runBatch() — URL construction', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it('apiBaseUrl with trailing slash → trailing slash is stripped before URL construction', async () => {
    const registry = [makeChain({ chainSlug: 'chain-a' })];
    mockFetch.mockResolvedValue(makeOkResponse({ dishesFound: 5, dishesUpserted: 5, dishesSkipped: 0 }));

    await runBatch(
      registry,
      { ...BASE_OPTS, apiBaseUrl: 'http://localhost:3001/' },
      mockFetch,
    );

    const [calledUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('http://localhost:3001/ingest/pdf-url');
  });

  it('apiBaseUrl without trailing slash → constructs correct endpoint URL', async () => {
    const registry = [makeChain({ chainSlug: 'chain-a' })];
    mockFetch.mockResolvedValue(makeOkResponse({ dishesFound: 5, dishesUpserted: 5, dishesSkipped: 0 }));

    await runBatch(
      registry,
      { ...BASE_OPTS, apiBaseUrl: 'http://localhost:3001' },
      mockFetch,
    );

    const [calledUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('http://localhost:3001/ingest/pdf-url');
  });
});

// ---------------------------------------------------------------------------
// runBatch() — result ordering guarantee
// ---------------------------------------------------------------------------

describe('runBatch() — result ordering', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it('results array preserves registry order regardless of which chains fail', async () => {
    // Spec §3.4: "collect results" — must preserve insertion order for accurate reporting
    const registry = [
      makeChain({ chainSlug: 'chain-a', restaurantId: '00000000-0000-0000-0006-000000000001', sourceId: '00000000-0000-0000-0000-000000000001' }),
      makeChain({ chainSlug: 'chain-b', restaurantId: '00000000-0000-0000-0006-000000000002', sourceId: '00000000-0000-0000-0000-000000000002' }),
      makeChain({ chainSlug: 'chain-c', restaurantId: '00000000-0000-0000-0006-000000000003', sourceId: '00000000-0000-0000-0000-000000000003' }),
    ];

    mockFetch
      .mockResolvedValueOnce(makeOkResponse({ dishesFound: 1, dishesUpserted: 1, dishesSkipped: 0 }))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(makeOkResponse({ dishesFound: 3, dishesUpserted: 3, dishesSkipped: 0 }));

    const results = await runBatch(registry, BASE_OPTS, mockFetch);

    expect(results).toHaveLength(3);
    expect(results[0]?.chain.chainSlug).toBe('chain-a');
    expect(results[1]?.chain.chainSlug).toBe('chain-b');
    expect(results[2]?.chain.chainSlug).toBe('chain-c');

    expect(results[0]?.status).toBe('success');
    expect(results[1]?.status).toBe('error');
    expect(results[2]?.status).toBe('success');
  });
});

// ---------------------------------------------------------------------------
// runBatch() — dryRun field in result
// ---------------------------------------------------------------------------

describe('runBatch() — dryRun field in success result', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it('dryRun: true and API returns dryRun: true in data → result.dryRun is true', async () => {
    const registry = [makeChain({ chainSlug: 'chain-a' })];
    mockFetch.mockResolvedValue(makeOkResponse({ dishesFound: 5, dishesUpserted: 0, dishesSkipped: 0, dryRun: true }));

    const results = await runBatch(registry, { ...BASE_OPTS, dryRun: true }, mockFetch);

    expect(results[0]?.status).toBe('success');
    if (results[0]?.status === 'success') {
      expect(results[0].dryRun).toBe(true);
    }
  });

  it('dryRun: true and API omits dryRun from data → result.dryRun falls back to opts.dryRun (true)', async () => {
    // The implementation uses `data.dryRun ?? opts.dryRun` as a fallback
    const registry = [makeChain({ chainSlug: 'chain-a' })];
    mockFetch.mockResolvedValue({
      ok:     true,
      status: 200,
      json:   () => Promise.resolve({ success: true, data: { dishesFound: 5, dishesUpserted: 5, dishesSkipped: 0 } }),
    } as unknown as Response);

    const results = await runBatch(registry, { ...BASE_OPTS, dryRun: true }, mockFetch);

    expect(results[0]?.status).toBe('success');
    if (results[0]?.status === 'success') {
      // Should fall back to opts.dryRun when API data doesn't include dryRun
      expect(results[0].dryRun).toBe(true);
    }
  });

  it('dryRun: false and API returns dryRun: false → result.dryRun is false', async () => {
    const registry = [makeChain({ chainSlug: 'chain-a' })];
    mockFetch.mockResolvedValue(makeOkResponse({ dishesFound: 5, dishesUpserted: 5, dishesSkipped: 0, dryRun: false }));

    const results = await runBatch(registry, { ...BASE_OPTS, dryRun: false }, mockFetch);

    expect(results[0]?.status).toBe('success');
    if (results[0]?.status === 'success') {
      expect(results[0].dryRun).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// runBatch() — 5xx error handling
// ---------------------------------------------------------------------------

describe('runBatch() — 5xx server errors', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it('502 Bad Gateway → chain recorded as error, continues with next chain', async () => {
    const registry = [
      makeChain({ chainSlug: 'chain-a', restaurantId: '00000000-0000-0000-0006-000000000001', sourceId: '00000000-0000-0000-0000-000000000001' }),
      makeChain({ chainSlug: 'chain-b', restaurantId: '00000000-0000-0000-0006-000000000002', sourceId: '00000000-0000-0000-0000-000000000002' }),
    ];

    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(502, 'BAD_GATEWAY', 'Upstream failure'))
      .mockResolvedValueOnce(makeOkResponse({ dishesFound: 5, dishesUpserted: 5, dishesSkipped: 0 }));

    const results = await runBatch(registry, BASE_OPTS, mockFetch);

    expect(results).toHaveLength(2);
    expect(results[0]?.status).toBe('error');
    expect(results[1]?.status).toBe('success');
    if (results[0]?.status === 'error') {
      expect(results[0].errorCode).toBe('BAD_GATEWAY');
    }
  });

  it('500 DB_UNAVAILABLE → chain recorded as error, continues', async () => {
    const registry = [
      makeChain({ chainSlug: 'chain-a', restaurantId: '00000000-0000-0000-0006-000000000001', sourceId: '00000000-0000-0000-0000-000000000001' }),
      makeChain({ chainSlug: 'chain-b', restaurantId: '00000000-0000-0000-0006-000000000002', sourceId: '00000000-0000-0000-0000-000000000002' }),
    ];

    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(500, 'DB_UNAVAILABLE', 'Database connection lost'))
      .mockResolvedValueOnce(makeOkResponse({ dishesFound: 10, dishesUpserted: 10, dishesSkipped: 0 }));

    const results = await runBatch(registry, BASE_OPTS, mockFetch);

    expect(results).toHaveLength(2);
    expect(results[0]?.status).toBe('error');
    if (results[0]?.status === 'error') {
      expect(results[0].errorCode).toBe('DB_UNAVAILABLE');
    }
    expect(results[1]?.status).toBe('success');
  });

  it('all chains fail with 5xx → returns all error results (no throws)', async () => {
    const registry = [
      makeChain({ chainSlug: 'chain-a', restaurantId: '00000000-0000-0000-0006-000000000001', sourceId: '00000000-0000-0000-0000-000000000001' }),
      makeChain({ chainSlug: 'chain-b', restaurantId: '00000000-0000-0000-0006-000000000002', sourceId: '00000000-0000-0000-0000-000000000002' }),
      makeChain({ chainSlug: 'chain-c', restaurantId: '00000000-0000-0000-0006-000000000003', sourceId: '00000000-0000-0000-0000-000000000003' }),
    ];

    mockFetch.mockResolvedValue(makeErrorResponse(500, 'INTERNAL_ERROR', 'Server error'));

    const results = await runBatch(registry, BASE_OPTS, mockFetch);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === 'error')).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// runBatch() — mixed error types in single batch
// ---------------------------------------------------------------------------

describe('runBatch() — mixed failure types', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it('network error then 4xx then success → all 3 results recorded correctly', async () => {
    const registry = [
      makeChain({ chainSlug: 'chain-a', restaurantId: '00000000-0000-0000-0006-000000000001', sourceId: '00000000-0000-0000-0000-000000000001' }),
      makeChain({ chainSlug: 'chain-b', restaurantId: '00000000-0000-0000-0006-000000000002', sourceId: '00000000-0000-0000-0000-000000000002' }),
      makeChain({ chainSlug: 'chain-c', restaurantId: '00000000-0000-0000-0006-000000000003', sourceId: '00000000-0000-0000-0000-000000000003' }),
    ];

    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(makeErrorResponse(422, 'INVALID_PDF', 'Content-Type is not PDF'))
      .mockResolvedValueOnce(makeOkResponse({ dishesFound: 20, dishesUpserted: 18, dishesSkipped: 2 }));

    const results = await runBatch(registry, BASE_OPTS, mockFetch);

    expect(results).toHaveLength(3);

    if (results[0]?.status === 'error') {
      expect(results[0].errorCode).toBe('NETWORK_ERROR');
    } else {
      expect.fail('chain-a should be error');
    }

    if (results[1]?.status === 'error') {
      expect(results[1].errorCode).toBe('INVALID_PDF');
    } else {
      expect.fail('chain-b should be error');
    }

    if (results[2]?.status === 'success') {
      expect(results[2].dishesFound).toBe(20);
    } else {
      expect.fail('chain-c should be success');
    }
  });
});

// ---------------------------------------------------------------------------
// ChainPdfConfigSchema — https enforcement
// ---------------------------------------------------------------------------

describe('ChainPdfConfigSchema — pdfUrl validation', () => {
  it('http:// URL is rejected by schema (https:// enforced)', async () => {
    const { ChainPdfConfigSchema } = await import('../../config/chains/chain-pdf-registry.js');

    const entry = {
      chainSlug:       'test-chain',
      name:            'Test Chain',
      countryCode:     'ES',
      pdfUrl:          'http://insecure.example.com/menu.pdf',
      restaurantId:    '00000000-0000-0000-0006-000000000001',
      sourceId:        '00000000-0000-0000-0000-000000000001',
      updateFrequency: 'unknown' as const,
      enabled:         true,
    };

    expect(() => ChainPdfConfigSchema.parse(entry)).toThrow();
  });

  it('ftp:// URL is rejected by schema (https:// enforced)', async () => {
    const { ChainPdfConfigSchema } = await import('../../config/chains/chain-pdf-registry.js');

    const entry = {
      chainSlug:       'test-chain',
      name:            'Test Chain',
      countryCode:     'ES',
      pdfUrl:          'ftp://files.example.com/menu.pdf',
      restaurantId:    '00000000-0000-0000-0006-000000000001',
      sourceId:        '00000000-0000-0000-0000-000000000001',
      updateFrequency: 'unknown' as const,
      enabled:         true,
    };

    expect(() => ChainPdfConfigSchema.parse(entry)).toThrow();
  });

  it('empty string pdfUrl is rejected (min(1) is not on pdfUrl, but url() validator catches it)', async () => {
    const { ChainPdfConfigSchema } = await import('../../config/chains/chain-pdf-registry.js');

    const entry = {
      chainSlug:       'test-chain',
      name:            'Test Chain',
      countryCode:     'ES',
      pdfUrl:          '',
      restaurantId:    '00000000-0000-0000-0006-000000000001',
      sourceId:        '00000000-0000-0000-0000-000000000001',
      updateFrequency: 'unknown' as const,
      enabled:         true,
    };

    expect(() => ChainPdfConfigSchema.parse(entry)).toThrow();
  });

  it('pdfUrl exceeding 2048 characters is rejected (max enforced)', async () => {
    const { ChainPdfConfigSchema } = await import('../../config/chains/chain-pdf-registry.js');

    const longPath = 'a'.repeat(2040);
    const entry = {
      chainSlug:       'test-chain',
      name:            'Test Chain',
      countryCode:     'ES',
      pdfUrl:          `https://example.com/${longPath}.pdf`,
      restaurantId:    '00000000-0000-0000-0006-000000000001',
      sourceId:        '00000000-0000-0000-0000-000000000001',
      updateFrequency: 'unknown' as const,
      enabled:         true,
    };

    expect(() => ChainPdfConfigSchema.parse(entry)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ChainPdfConfigSchema — chainSlug boundary conditions
// ---------------------------------------------------------------------------

describe('ChainPdfConfigSchema — chainSlug boundary conditions', () => {
  async function tryParse(chainSlug: string): Promise<boolean> {
    const { ChainPdfConfigSchema } = await import('../../config/chains/chain-pdf-registry.js');
    try {
      ChainPdfConfigSchema.parse({
        chainSlug,
        name:            'Test Chain',
        countryCode:     'ES',
        pdfUrl:          'https://example.com/menu.pdf',
        restaurantId:    '00000000-0000-0000-0006-000000000001',
        sourceId:        '00000000-0000-0000-0000-000000000001',
        updateFrequency: 'unknown' as const,
        enabled:         true,
      });
      return true;
    } catch {
      return false;
    }
  }

  it('chainSlug with uppercase letters is rejected', async () => {
    expect(await tryParse('Burger-King-ES')).toBe(false);
  });

  it('chainSlug with underscore is rejected', async () => {
    expect(await tryParse('burger_king_es')).toBe(false);
  });

  it('chainSlug with spaces is rejected', async () => {
    expect(await tryParse('burger king es')).toBe(false);
  });

  it('empty chainSlug is rejected', async () => {
    expect(await tryParse('')).toBe(false);
  });

  it('chainSlug at exactly 100 characters is accepted', async () => {
    const slug = 'a'.repeat(97) + '-es'; // 100 chars, matches regex
    expect(await tryParse(slug)).toBe(true);
  });

  it('chainSlug at 101 characters is rejected', async () => {
    const slug = 'a'.repeat(98) + '-es'; // 101 chars
    expect(await tryParse(slug)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ChainPdfConfigSchema — countryCode boundary conditions
// ---------------------------------------------------------------------------

describe('ChainPdfConfigSchema — countryCode boundary conditions', () => {
  async function tryParse(countryCode: string): Promise<boolean> {
    const { ChainPdfConfigSchema } = await import('../../config/chains/chain-pdf-registry.js');
    try {
      ChainPdfConfigSchema.parse({
        chainSlug:       'test-chain',
        name:            'Test Chain',
        countryCode,
        pdfUrl:          'https://example.com/menu.pdf',
        restaurantId:    '00000000-0000-0000-0006-000000000001',
        sourceId:        '00000000-0000-0000-0000-000000000001',
        updateFrequency: 'unknown' as const,
        enabled:         true,
      });
      return true;
    } catch {
      return false;
    }
  }

  it('lowercase country code is rejected', async () => {
    expect(await tryParse('es')).toBe(false);
  });

  it('single character country code is rejected', async () => {
    expect(await tryParse('E')).toBe(false);
  });

  it('3-character country code is rejected', async () => {
    expect(await tryParse('ESP')).toBe(false);
  });

  it('country code with digits is rejected', async () => {
    expect(await tryParse('E1')).toBe(false);
  });

  it('valid 2-letter uppercase code is accepted', async () => {
    expect(await tryParse('PT')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ChainPdfConfigSchema — updateFrequency enum
// ---------------------------------------------------------------------------

describe('ChainPdfConfigSchema — updateFrequency enum', () => {
  async function tryParse(updateFrequency: string): Promise<boolean> {
    const { ChainPdfConfigSchema } = await import('../../config/chains/chain-pdf-registry.js');
    try {
      ChainPdfConfigSchema.parse({
        chainSlug:       'test-chain',
        name:            'Test Chain',
        countryCode:     'ES',
        pdfUrl:          'https://example.com/menu.pdf',
        restaurantId:    '00000000-0000-0000-0006-000000000001',
        sourceId:        '00000000-0000-0000-0000-000000000001',
        updateFrequency,
        enabled:         true,
      });
      return true;
    } catch {
      return false;
    }
  }

  it('invalid updateFrequency "daily" is rejected', async () => {
    expect(await tryParse('daily')).toBe(false);
  });

  it('invalid updateFrequency "weekly" is rejected', async () => {
    expect(await tryParse('weekly')).toBe(false);
  });

  it('empty string updateFrequency is rejected', async () => {
    expect(await tryParse('')).toBe(false);
  });

  it('all valid updateFrequency values are accepted', async () => {
    for (const freq of ['static', 'monthly', 'quarterly', 'yearly', 'unknown']) {
      expect(await tryParse(freq)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// CHAIN_SEED_IDS — no overlap between restaurantId and sourceId patterns
// ---------------------------------------------------------------------------

describe('CHAIN_SEED_IDS — segment isolation', () => {
  it('no restaurantId value matches any sourceId value across chains', async () => {
    const { CHAIN_SEED_IDS } = await import('../../config/chains/chain-seed-ids.js');

    const restaurantIds = Object.values(CHAIN_SEED_IDS).map((c) => c.RESTAURANT_ID);
    const sourceIds     = Object.values(CHAIN_SEED_IDS).map((c) => c.SOURCE_ID);

    // restaurantIds use segment 6, sourceIds use segment 0 — they must not overlap
    const overlap = restaurantIds.filter((id) => sourceIds.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it('all restaurantIds use segment pattern ...0006-...', async () => {
    const { CHAIN_SEED_IDS } = await import('../../config/chains/chain-seed-ids.js');

    for (const chain of Object.values(CHAIN_SEED_IDS)) {
      expect(chain.RESTAURANT_ID).toMatch(/^00000000-0000-0000-0006-/);
    }
  });

  it('all sourceIds use segment pattern ...0000-...', async () => {
    const { CHAIN_SEED_IDS } = await import('../../config/chains/chain-seed-ids.js');

    for (const chain of Object.values(CHAIN_SEED_IDS)) {
      expect(chain.SOURCE_ID).toMatch(/^00000000-0000-0000-0000-/);
    }
  });

  it('IDs starting at ...0010 — no collision with existing seed range ...0001-...0009', async () => {
    const { CHAIN_SEED_IDS } = await import('../../config/chains/chain-seed-ids.js');

    const existingRestaurantRange = [
      '00000000-0000-0000-0006-000000000001',
      '00000000-0000-0000-0006-000000000002',
      '00000000-0000-0000-0006-000000000003',
      '00000000-0000-0000-0006-000000000004',
      '00000000-0000-0000-0006-000000000005',
      '00000000-0000-0000-0006-000000000006',
      '00000000-0000-0000-0006-000000000007',
      '00000000-0000-0000-0006-000000000008',
      '00000000-0000-0000-0006-000000000009',
    ];
    const existingSourceRange = [
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000004',
      '00000000-0000-0000-0000-000000000005',
      '00000000-0000-0000-0000-000000000006',
      '00000000-0000-0000-0000-000000000007',
      '00000000-0000-0000-0000-000000000008',
      '00000000-0000-0000-0000-000000000009',
    ];

    for (const chain of Object.values(CHAIN_SEED_IDS)) {
      expect(existingRestaurantRange).not.toContain(chain.RESTAURANT_ID);
      expect(existingSourceRange).not.toContain(chain.SOURCE_ID);
    }
  });
});

// ---------------------------------------------------------------------------
// CHAIN_PDF_REGISTRY — notes field
// ---------------------------------------------------------------------------

describe('CHAIN_PDF_REGISTRY — notes field', () => {
  it('burger-king-es has a notes field (monthly URL rotation requires documentation)', async () => {
    // Spec: BK's URL is monthly — notes must be present and non-empty
    const { CHAIN_PDF_REGISTRY } = await import('../../config/chains/chain-pdf-registry.js');
    const bk = CHAIN_PDF_REGISTRY.find((c) => c.chainSlug === 'burger-king-es');
    expect(bk?.notes).toBeDefined();
    expect(bk?.notes?.length).toBeGreaterThan(0);
  });

  it('notes field (when present) is a non-empty string for all chains that have it', async () => {
    const { CHAIN_PDF_REGISTRY } = await import('../../config/chains/chain-pdf-registry.js');
    for (const entry of CHAIN_PDF_REGISTRY) {
      if (entry.notes !== undefined) {
        expect(typeof entry.notes).toBe('string');
        expect(entry.notes.length).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// runBatch() — request body completeness for all registry entries
// ---------------------------------------------------------------------------

describe('runBatch() — request body structure for real registry', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it('each request body contains the required fields: url, restaurantId, sourceId, dryRun, chainSlug', async () => {
    // Ensure all expected fields are present in the request body
    const { CHAIN_PDF_REGISTRY } = await import('../../config/chains/chain-pdf-registry.js');

    mockFetch.mockResolvedValue(makeOkResponse({ dishesFound: 5, dishesUpserted: 5, dishesSkipped: 0 }));

    await runBatch(CHAIN_PDF_REGISTRY, BASE_OPTS, mockFetch);

    const enabledChains = CHAIN_PDF_REGISTRY.filter((c) => c.enabled);
    expect(mockFetch).toHaveBeenCalledTimes(enabledChains.length);

    for (const [, init] of mockFetch.mock.calls as [string, RequestInit][]) {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      const keys = Object.keys(body).sort();
      expect(keys).toEqual(['chainSlug', 'dryRun', 'restaurantId', 'sourceId', 'url']);
    }
  });

  it('each request is sent to the correct endpoint path /ingest/pdf-url', async () => {
    const { CHAIN_PDF_REGISTRY } = await import('../../config/chains/chain-pdf-registry.js');

    mockFetch.mockResolvedValue(makeOkResponse({ dishesFound: 5, dishesUpserted: 5, dishesSkipped: 0 }));

    await runBatch(CHAIN_PDF_REGISTRY, BASE_OPTS, mockFetch);

    for (const [url] of mockFetch.mock.calls as [string, RequestInit][]) {
      expect(url).toBe('http://localhost:3001/ingest/pdf-url');
    }
  });
});
