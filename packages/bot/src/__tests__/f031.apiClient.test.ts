// Unit tests for F031 ApiClient additions: uploadImage and uploadPdf.
//
// Uses vi.stubGlobal to mock global fetch — same pattern as f032.apiClient.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import type { ApiError as ApiErrorType } from '../apiClient.js';
import type { BotConfig } from '../config.js';

let _ApiError: typeof ApiErrorType;
let createApiClient: (config: BotConfig) => ApiClient;

beforeAll(async () => {
  const mod = await import('../apiClient.js');
  _ApiError = mod.ApiError as unknown as typeof ApiErrorType;
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
  ALLOWED_CHAT_IDS: [],
};

const TEST_CONFIG_NO_ADMIN: BotConfig = {
  ...TEST_CONFIG,
  ADMIN_API_KEY: undefined,
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

const INGEST_RESULT = {
  dishesFound: 5,
  dishesUpserted: 4,
  dishesSkipped: 1,
  dryRun: false,
  dishes: [],
  skippedReasons: [],
};

// ---------------------------------------------------------------------------
// uploadImage
// ---------------------------------------------------------------------------

describe('uploadImage', () => {
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

  const BASE_PARAMS = {
    fileBuffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
    filename: 'photo.jpg',
    mimeType: 'image/jpeg',
    restaurantId: 'f3100000-0000-4000-a000-000000000001',
    sourceId: '00000000-0000-0000-0000-000000000099',
  };

  it('calls POST /ingest/image URL', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: INGEST_RESULT }));

    await client.uploadImage(BASE_PARAMS);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/ingest/image');
  });

  it('uses POST method', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: INGEST_RESULT }));

    await client.uploadImage(BASE_PARAMS);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
  });

  it('sends FormData body (body instanceof FormData)', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: INGEST_RESULT }));

    await client.uploadImage(BASE_PARAMS);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('does NOT manually set Content-Type header (fetch auto-sets with boundary)', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: INGEST_RESULT }));

    await client.uploadImage(BASE_PARAMS);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
    expect(headers['content-type']).toBeUndefined();
  });

  it('uses X-API-Key: ADMIN_API_KEY (not BOT_API_KEY)', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: INGEST_RESULT }));

    await client.uploadImage(BASE_PARAMS);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('test-admin-key');
  });

  it('sends X-FXP-Source: bot header', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: INGEST_RESULT }));

    await client.uploadImage(BASE_PARAMS);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-FXP-Source']).toBe('bot');
  });

  it('includes restaurantId, sourceId as FormData fields', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: INGEST_RESULT }));

    await client.uploadImage(BASE_PARAMS);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;
    expect(form.get('restaurantId')).toBe(BASE_PARAMS.restaurantId);
    expect(form.get('sourceId')).toBe(BASE_PARAMS.sourceId);
  });

  it('includes file field as a Blob instance', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: INGEST_RESULT }));

    await client.uploadImage(BASE_PARAMS);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('includes optional chainSlug when provided', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: INGEST_RESULT }));

    await client.uploadImage({ ...BASE_PARAMS, chainSlug: 'mcdonalds-es' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;
    expect(form.get('chainSlug')).toBe('mcdonalds-es');
  });

  it('does NOT include chainSlug field when absent', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: INGEST_RESULT }));

    await client.uploadImage(BASE_PARAMS);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;
    expect(form.get('chainSlug')).toBeNull();
  });

  it('returns parsed data envelope on 200', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: INGEST_RESULT }));

    const result = await client.uploadImage(BASE_PARAMS);

    expect(result.dishesFound).toBe(5);
    expect(result.dishesUpserted).toBe(4);
    expect(result.dishesSkipped).toBe(1);
  });

  it('throws ApiError(0, NETWORK_ERROR) on fetch rejection', async () => {
    fetchMock.mockRejectedValue(new Error('Network failure'));

    await expect(client.uploadImage(BASE_PARAMS)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  it('throws ApiError on non-2xx response', async () => {
    fetchMock.mockResolvedValue(makeResponse(422, {
      success: false,
      error: { code: 'INVALID_IMAGE', message: 'Not a valid image' },
    }));

    await expect(client.uploadImage(BASE_PARAMS)).rejects.toMatchObject({
      statusCode: 422,
      code: 'INVALID_IMAGE',
    });
  });

  it('throws ApiError(500, CONFIG_ERROR) immediately when ADMIN_API_KEY is undefined (no fetch call)', async () => {
    const clientNoAdmin = createApiClient(TEST_CONFIG_NO_ADMIN);

    await expect(clientNoAdmin.uploadImage(BASE_PARAMS)).rejects.toMatchObject({
      statusCode: 500,
      code: 'CONFIG_ERROR',
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// uploadPdf
// ---------------------------------------------------------------------------

describe('uploadPdf', () => {
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

  const BASE_PARAMS = {
    fileBuffer: Buffer.from('%PDF-1.4'),
    filename: 'menu.pdf',
    restaurantId: 'f3100000-0000-4000-a000-000000000001',
    sourceId: '00000000-0000-0000-0000-000000000099',
  };

  it('calls POST /ingest/pdf URL', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: INGEST_RESULT }));

    await client.uploadPdf(BASE_PARAMS);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/ingest/pdf');
  });

  it('uses X-API-Key: ADMIN_API_KEY', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: INGEST_RESULT }));

    await client.uploadPdf(BASE_PARAMS);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('test-admin-key');
  });

  it('sends FormData body with file as Blob', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: INGEST_RESULT }));

    await client.uploadPdf(BASE_PARAMS);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBeInstanceOf(Blob);
  });

  it('returns parsed data envelope on 200', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: INGEST_RESULT }));

    const result = await client.uploadPdf(BASE_PARAMS);

    expect(result.dishesFound).toBe(5);
    expect(result.dishesUpserted).toBe(4);
  });

  it('throws ApiError(500, CONFIG_ERROR) immediately when ADMIN_API_KEY is undefined', async () => {
    const clientNoAdmin = createApiClient(TEST_CONFIG_NO_ADMIN);

    await expect(clientNoAdmin.uploadPdf(BASE_PARAMS)).rejects.toMatchObject({
      statusCode: 500,
      code: 'CONFIG_ERROR',
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws ApiError on non-2xx response', async () => {
    fetchMock.mockResolvedValue(makeResponse(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: 'Restaurant not found' },
    }));

    await expect(client.uploadPdf(BASE_PARAMS)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('throws ApiError(0, NETWORK_ERROR) on fetch rejection', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));

    await expect(client.uploadPdf(BASE_PARAMS)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  it('includes optional chainSlug when provided', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: INGEST_RESULT }));

    await client.uploadPdf({ ...BASE_PARAMS, chainSlug: 'telepizza-es' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;
    expect(form.get('chainSlug')).toBe('telepizza-es');
  });
});
