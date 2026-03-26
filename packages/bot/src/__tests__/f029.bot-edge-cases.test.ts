// F029 Bot Edge-Case Tests — QA Engineer
//
// Tests that the existing apiClient test DOES NOT cover:
//   1. healthCheck does NOT send X-FXP-Source (separate fetch path, not fetchJson)
//   2. All fetchJson-based methods (estimate, search, etc.) DO send X-FXP-Source: bot
//   3. X-FXP-Source is sent even when the API returns a non-2xx error

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import type { BotConfig } from '../config.js';

let createApiClient: (config: BotConfig) => ApiClient;

beforeAll(async () => {
  const mod = await import('../apiClient.js');
  createApiClient = mod.createApiClient;
});

const TEST_CONFIG: BotConfig = {
  TELEGRAM_BOT_TOKEN: 'test-token',
  API_BASE_URL: 'http://localhost:3001',
  BOT_API_KEY: 'test-api-key',
  BOT_VERSION: '0.0.0',
  LOG_LEVEL: 'info',
  NODE_ENV: 'test',
  REDIS_URL: 'redis://localhost:6380',
  ALLOWED_CHAT_IDS: [],
};

function makeOkResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

describe('F029 bot edge cases — X-FXP-Source header coverage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: ApiClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    client = createApiClient(TEST_CONFIG);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // CRITICAL GAP: healthCheck uses a raw fetch (NOT fetchJson) and does NOT
  // include X-FXP-Source. The existing test suite DOES NOT verify header absence.
  // healthCheck traffic should NOT be logged as bot queries (it's infra traffic).
  it('[SPEC] healthCheck does NOT send X-FXP-Source header (separate fetch path)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
    });

    await client.healthCheck();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    // healthCheck only sends X-API-Key, no X-FXP-Source
    expect(headers).not.toHaveProperty('X-FXP-Source');
    // healthCheck DOES send X-API-Key (the /health endpoint is not public in this API)
    expect(headers).toHaveProperty('X-API-Key', 'test-api-key');
  });

  // Verify all fetchJson-based methods include the header (belt-and-suspenders)
  it('[SPEC] estimate sends X-FXP-Source: bot', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({
      success: true,
      data: { query: 'test', level1Hit: false, level2Hit: false, level3Hit: false, level4Hit: false, matchType: null, result: null, cachedAt: null, chainSlug: null },
    }));

    await client.estimate({ query: 'test food' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-FXP-Source']).toBe('bot');
  });

  it('[SPEC] listChains sends X-FXP-Source: bot', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ success: true, data: [] }));

    await client.listChains();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-FXP-Source']).toBe('bot');
  });

  it('[SPEC] listRestaurants sends X-FXP-Source: bot', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ success: true, data: { items: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 } } }));

    await client.listRestaurants({});

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-FXP-Source']).toBe('bot');
  });

  // X-FXP-Source should still be sent even when the server returns a non-2xx error.
  // The header is part of the outgoing request — it's attached regardless of response.
  it('[SPEC] X-FXP-Source sent even when API returns 500 (header is on request, not response)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Server error' } }),
    });

    await expect(client.estimate({ query: 'test' })).rejects.toThrow();

    // Verify the header was still included on the outbound request
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-FXP-Source']).toBe('bot');
  });
});
