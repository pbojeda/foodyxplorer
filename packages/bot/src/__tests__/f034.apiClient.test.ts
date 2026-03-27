// Unit tests for F034 ApiClient addition: analyzeMenu.
//
// Uses vi.stubGlobal to mock global fetch — same pattern as f031.apiClient.test.ts.

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

const ANALYSIS_RESULT = {
  mode: 'auto' as const,
  dishCount: 2,
  dishes: [
    {
      dishName: 'Big Mac',
      estimate: {
        result: {
          name: 'Big Mac',
          nameEs: 'Big Mac',
          nutrients: {
            calories: 550,
            proteins: 25,
            carbohydrates: 45,
            fats: 30,
            fiber: 0,
            saturatedFats: 0,
            sodium: 0,
            salt: 0,
          },
          portionGrams: 200,
          chainSlug: null,
          confidenceLevel: 'high',
        },
      },
    },
    {
      dishName: 'Hamburgesa Especial',
      estimate: null,
    },
  ],
  partial: false,
};

const BASE_PARAMS = {
  fileBuffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
  filename: 'photo.jpg',
  mimeType: 'image/jpeg',
  mode: 'auto' as const,
};

// ---------------------------------------------------------------------------
// analyzeMenu
// ---------------------------------------------------------------------------

describe('analyzeMenu', () => {
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

  it('calls POST /analyze/menu URL', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: ANALYSIS_RESULT }));

    await client.analyzeMenu(BASE_PARAMS);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/analyze/menu');
  });

  it('uses POST method', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: ANALYSIS_RESULT }));

    await client.analyzeMenu(BASE_PARAMS);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
  });

  it('sends FormData body (body instanceof FormData)', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: ANALYSIS_RESULT }));

    await client.analyzeMenu(BASE_PARAMS);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('does NOT manually set Content-Type header (fetch auto-sets with boundary)', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: ANALYSIS_RESULT }));

    await client.analyzeMenu(BASE_PARAMS);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
    expect(headers['content-type']).toBeUndefined();
  });

  it('uses X-API-Key: BOT_API_KEY (not ADMIN_API_KEY)', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: ANALYSIS_RESULT }));

    await client.analyzeMenu(BASE_PARAMS);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('test-api-key');
  });

  it('sends X-FXP-Source: bot header', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: ANALYSIS_RESULT }));

    await client.analyzeMenu(BASE_PARAMS);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-FXP-Source']).toBe('bot');
  });

  it('includes mode field in FormData', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: ANALYSIS_RESULT }));

    await client.analyzeMenu(BASE_PARAMS);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;
    expect(form.get('mode')).toBe('auto');
  });

  it('includes file field as a Blob instance', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: ANALYSIS_RESULT }));

    await client.analyzeMenu(BASE_PARAMS);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('uses identify mode when specified', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: { ...ANALYSIS_RESULT, mode: 'identify', dishCount: 1, dishes: [ANALYSIS_RESULT.dishes[0]] } }));

    await client.analyzeMenu({ ...BASE_PARAMS, mode: 'identify' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;
    expect(form.get('mode')).toBe('identify');
  });

  it('returns parsed MenuAnalysisData on 200', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: ANALYSIS_RESULT }));

    const result = await client.analyzeMenu(BASE_PARAMS);

    expect(result.mode).toBe('auto');
    expect(result.dishCount).toBe(2);
    expect(result.dishes).toHaveLength(2);
    expect(result.dishes[0]?.dishName).toBe('Big Mac');
    expect(result.dishes[1]?.estimate).toBeNull();
    expect(result.partial).toBe(false);
  });

  it('throws ApiError on non-2xx response (MENU_ANALYSIS_FAILED)', async () => {
    fetchMock.mockResolvedValue(makeResponse(422, {
      success: false,
      error: { code: 'MENU_ANALYSIS_FAILED', message: 'Could not identify any dishes' },
    }));

    await expect(client.analyzeMenu(BASE_PARAMS)).rejects.toMatchObject({
      statusCode: 422,
      code: 'MENU_ANALYSIS_FAILED',
    });
  });

  it('throws ApiError on INVALID_IMAGE (422)', async () => {
    fetchMock.mockResolvedValue(makeResponse(422, {
      success: false,
      error: { code: 'INVALID_IMAGE', message: 'Unsupported file type' },
    }));

    await expect(client.analyzeMenu(BASE_PARAMS)).rejects.toMatchObject({
      statusCode: 422,
      code: 'INVALID_IMAGE',
    });
  });

  it('throws ApiError on RATE_LIMIT_EXCEEDED (429)', async () => {
    fetchMock.mockResolvedValue(makeResponse(429, {
      success: false,
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' },
    }));

    await expect(client.analyzeMenu(BASE_PARAMS)).rejects.toMatchObject({
      statusCode: 429,
      code: 'RATE_LIMIT_EXCEEDED',
    });
  });

  it('throws ApiError(0, NETWORK_ERROR) on fetch rejection', async () => {
    fetchMock.mockRejectedValue(new Error('Network failure'));

    await expect(client.analyzeMenu(BASE_PARAMS)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  it('returns partial=true when API returns partial results', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, {
      success: true,
      data: { ...ANALYSIS_RESULT, partial: true },
    }));

    const result = await client.analyzeMenu(BASE_PARAMS);

    expect(result.partial).toBe(true);
  });
});
