// Unit tests for apiClient.ts — ApiError, createApiClient(), fetch mock behavior.

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import type { ApiClient, ApiError as ApiErrorType } from '../apiClient.js';
import type { BotConfig } from '../config.js';
import { firstCallArg } from './helpers/mocks.js';

let ApiError: typeof ApiErrorType;
let createApiClient: (config: BotConfig) => ApiClient;

beforeAll(async () => {
  const mod = await import('../apiClient.js');
  ApiError = mod.ApiError as unknown as typeof ApiErrorType;
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

// ---------------------------------------------------------------------------
// ApiError class
// ---------------------------------------------------------------------------

describe('ApiError', () => {
  it('stores statusCode, code, and message', () => {
    // Import after beforeAll resolves
    const err = new (ApiError as unknown as new (statusCode: number, code: string, message: string) => ApiErrorType)(404, 'NOT_FOUND', 'not found');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('not found');
  });

  it('has name "ApiError"', () => {
    const err = new (ApiError as unknown as new (statusCode: number, code: string, message: string) => ApiErrorType)(500, 'SERVER_ERROR', 'error');
    expect(err.name).toBe('ApiError');
  });

  it('is an instance of Error', () => {
    const err = new (ApiError as unknown as new (statusCode: number, code: string, message: string) => ApiErrorType)(400, 'BAD_REQUEST', 'bad');
    expect(err instanceof Error).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createApiClient — fetch mock tests
// ---------------------------------------------------------------------------

describe('createApiClient', () => {
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

  // Helper to build a mock fetch Response
  function makeResponse(status: number, body: unknown): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }

  it('searchDishes returns items on happy path', async () => {
    const items = [{ id: '1', name: 'Big Mac' }];
    const pagination = { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 };
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: { items, pagination } }));

    const result = await client.searchDishes({ q: 'big mac', page: 1, pageSize: 10 });
    expect(result.items).toEqual(items);
    expect(result.pagination).toEqual(pagination);
  });

  it('searchDishes sends X-API-Key header', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: { items: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 } } }));

    await client.searchDishes({ q: 'test' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [_url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)?.['X-API-Key']).toBe('test-api-key');
  });

  it('all requests include X-FXP-Source: bot header (F029)', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: { items: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 } } }));

    await client.searchDishes({ q: 'test' });

    const [_url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)?.['X-FXP-Source']).toBe('bot');
  });

  it('throws ApiError with correct statusCode on 404 response', async () => {
    fetchMock.mockResolvedValue(makeResponse(404, { success: false, error: { code: 'NOT_FOUND', message: 'not found' } }));

    await expect(client.searchDishes({ q: 'xyz' })).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('throws ApiError with statusCode 429 on rate limit', async () => {
    fetchMock.mockResolvedValue(makeResponse(429, { success: false, error: { code: 'RATE_LIMIT', message: 'Too many requests' } }));

    await expect(client.searchDishes({ q: 'test' })).rejects.toMatchObject({
      statusCode: 429,
    });
  });

  it('throws ApiError with code TIMEOUT on AbortError', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);

    await expect(client.searchDishes({ q: 'test' })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('throws ApiError with code NETWORK_ERROR on fetch rejection', async () => {
    fetchMock.mockRejectedValue(new Error('Network failure'));

    await expect(client.searchDishes({ q: 'test' })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  it('healthCheck returns true on 2xx response', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { status: 'ok', timestamp: '2026-01-01T00:00:00Z' }));

    const result = await client.healthCheck();
    expect(result).toBe(true);
  });

  it('healthCheck returns false on non-2xx response', async () => {
    fetchMock.mockResolvedValue(makeResponse(503, {}));

    const result = await client.healthCheck();
    expect(result).toBe(false);
  });

  it('healthCheck returns false on network error (does not throw)', async () => {
    fetchMock.mockRejectedValue(new Error('network'));

    const result = await client.healthCheck();
    expect(result).toBe(false);
  });

  it('listChains always sends ?isActive=true', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: [] }));

    await client.listChains();

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('isActive=true');
  });

  it('listChains returns array from data field', async () => {
    const chains = [{ chainSlug: 'mcdonalds-es', name: 'McDonald\'s', nameEs: null, countryCode: 'ES', dishCount: 100, isActive: true }];
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: chains }));

    const result = await client.listChains();
    expect(result).toEqual(chains);
  });

  it('estimate returns EstimateData (never throws on null result)', async () => {
    const estimateData = {
      query: 'big mac',
      chainSlug: null,
      portionMultiplier: 1.0,
      level1Hit: true,
      level2Hit: false,
      level3Hit: false,
      level4Hit: false,
      matchType: 'exact_dish',
      result: null,
      cachedAt: null,
    };
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: estimateData }));

    const result = await client.estimate({ query: 'big mac' });
    expect(result.query).toBe('big mac');
    expect(result.result).toBeNull();
  });

  it('estimate sends portionMultiplier=1.5 in querystring', async () => {
    const estimateData = {
      query: 'big mac',
      chainSlug: null,
      portionMultiplier: 1.5,
      level1Hit: true,
      level2Hit: false,
      level3Hit: false,
      level4Hit: false,
      matchType: 'exact_dish',
      result: null,
      cachedAt: null,
    };
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: estimateData }));

    await client.estimate({ query: 'big mac', portionMultiplier: 1.5 });
    const url = new URL(firstCallArg<string>(fetchMock));
    expect(url.searchParams.get('portionMultiplier')).toBe('1.5');
  });

  it('estimate omits portionMultiplier when absent', async () => {
    const estimateData = {
      query: 'big mac',
      chainSlug: null,
      portionMultiplier: 1.0,
      level1Hit: true,
      level2Hit: false,
      level3Hit: false,
      level4Hit: false,
      matchType: 'exact_dish',
      result: null,
      cachedAt: null,
    };
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: estimateData }));

    await client.estimate({ query: 'big mac' });
    const url = new URL(firstCallArg<string>(fetchMock));
    expect(url.searchParams.has('portionMultiplier')).toBe(false);
  });

  it('estimate omits portionMultiplier when 1.0', async () => {
    const estimateData = {
      query: 'big mac',
      chainSlug: null,
      portionMultiplier: 1.0,
      level1Hit: true,
      level2Hit: false,
      level3Hit: false,
      level4Hit: false,
      matchType: 'exact_dish',
      result: null,
      cachedAt: null,
    };
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: estimateData }));

    await client.estimate({ query: 'big mac', portionMultiplier: 1.0 });
    const url = new URL(firstCallArg<string>(fetchMock));
    expect(url.searchParams.has('portionMultiplier')).toBe(false);
  });

  it('listRestaurants returns paginated result', async () => {
    const data = { items: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 } };
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data }));

    const result = await client.listRestaurants({ page: 1, pageSize: 10 });
    expect(result.items).toEqual([]);
  });

  it('listRestaurantDishes returns paginated result', async () => {
    const data = { items: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 } };
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data }));

    const result = await client.listRestaurantDishes('some-uuid', { page: 1, pageSize: 10 });
    expect(result.items).toEqual([]);
  });
});
