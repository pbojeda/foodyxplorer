// Unit tests for F032 ApiClient additions: searchRestaurants and createRestaurant.
//
// Uses vi.stubGlobal to mock global fetch — same pattern as apiClient.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import type { ApiError as ApiErrorType } from '../apiClient.js';
import type { BotConfig } from '../config.js';

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
  ADMIN_API_KEY: 'test-admin-key',
  REDIS_URL: 'redis://localhost:6380',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// searchRestaurants
// ---------------------------------------------------------------------------

describe('searchRestaurants', () => {
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

  it('calls the correct URL with q parameter', async () => {
    const data = { items: [], pagination: { page: 1, pageSize: 5, totalItems: 0, totalPages: 0 } };
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data }));

    await client.searchRestaurants('mcdonalds');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/restaurants');
    expect(url).toContain('q=mcdonalds');
  });

  it('returns data envelope (items + pagination)', async () => {
    const items = [{ id: 'uuid-1', name: 'Test Restaurant', chainSlug: 'test-es', countryCode: 'ES', isActive: true, dishCount: 5, nameEs: null, logoUrl: null, website: null }];
    const pagination = { page: 1, pageSize: 5, totalItems: 1, totalPages: 1 };
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: { items, pagination } }));

    const result = await client.searchRestaurants('test');

    expect(result.items).toEqual(items);
    expect(result.pagination).toEqual(pagination);
  });

  it('sends X-FXP-Source: bot header', async () => {
    const data = { items: [], pagination: { page: 1, pageSize: 5, totalItems: 0, totalPages: 0 } };
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data }));

    await client.searchRestaurants('test');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)?.['X-FXP-Source']).toBe('bot');
  });

  it('throws ApiError on non-2xx response', async () => {
    fetchMock.mockResolvedValue(makeResponse(500, { success: false, error: { code: 'SERVER_ERROR', message: 'internal error' } }));

    await expect(client.searchRestaurants('test')).rejects.toMatchObject({
      statusCode: 500,
      code: 'SERVER_ERROR',
    });
  });
});

// ---------------------------------------------------------------------------
// createRestaurant
// ---------------------------------------------------------------------------

describe('createRestaurant', () => {
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

  const CREATE_BODY = {
    name: 'New Restaurant',
    countryCode: 'ES',
  };

  const CREATED_RESTAURANT = {
    id: 'new-uuid-1234',
    name: 'New Restaurant',
    nameEs: null,
    chainSlug: 'independent-new-restaurant-abcd',
    countryCode: 'ES',
    isActive: true,
    address: null,
    googleMapsUrl: null,
    latitude: null,
    longitude: null,
    logoUrl: null,
    website: null,
    createdAt: '2026-03-24T00:00:00.000Z',
    updatedAt: '2026-03-24T00:00:00.000Z',
  };

  it('calls POST /restaurants with correct body', async () => {
    fetchMock.mockResolvedValue(makeResponse(201, { success: true, data: CREATED_RESTAURANT }));

    await client.createRestaurant(CREATE_BODY);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/restaurants');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(CREATE_BODY);
  });

  it('sends X-FXP-Source: bot header', async () => {
    fetchMock.mockResolvedValue(makeResponse(201, { success: true, data: CREATED_RESTAURANT }));

    await client.createRestaurant(CREATE_BODY);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)?.['X-FXP-Source']).toBe('bot');
  });

  it('sends X-API-Key header with ADMIN_API_KEY value (overrides regular key)', async () => {
    fetchMock.mockResolvedValue(makeResponse(201, { success: true, data: CREATED_RESTAURANT }));

    await client.createRestaurant(CREATE_BODY);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)?.['X-API-Key']).toBe('test-admin-key');
  });

  it('returns created restaurant data', async () => {
    fetchMock.mockResolvedValue(makeResponse(201, { success: true, data: CREATED_RESTAURANT }));

    const result = await client.createRestaurant(CREATE_BODY);

    expect(result.id).toBe(CREATED_RESTAURANT.id);
    expect(result.name).toBe('New Restaurant');
  });

  it('throws ApiError(409) on duplicate restaurant', async () => {
    fetchMock.mockResolvedValue(makeResponse(409, { success: false, error: { code: 'CONFLICT', message: 'Restaurant already exists' } }));

    await expect(client.createRestaurant(CREATE_BODY)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
    });
  });

  it('throws ApiError on network error', async () => {
    fetchMock.mockRejectedValue(new Error('Network failure'));

    await expect(client.createRestaurant(CREATE_BODY)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });
});
