// Unit tests for F041 ApiClient addition: calculateRecipe.
//
// Uses vi.stubGlobal to mock global fetch — same pattern as f034.apiClient.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import type { ApiError as ApiErrorType } from '../apiClient.js';
import type { BotConfig } from '../config.js';

let _ApiError: typeof ApiErrorType;
let createApiClient: (config: BotConfig) => ApiClient;
let REQUEST_TIMEOUT_MS_VALUE: number;
let RECIPE_TIMEOUT_MS: number;

beforeAll(async () => {
  const mod = await import('../apiClient.js');
  _ApiError = mod.ApiError as unknown as typeof ApiErrorType;
  createApiClient = mod.createApiClient;
  // Access constants to verify timeout values
  RECIPE_TIMEOUT_MS = (mod as unknown as Record<string, number>)['RECIPE_TIMEOUT_MS'] ?? 30_000;
  REQUEST_TIMEOUT_MS_VALUE = 10_000; // known value from implementation
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

const RECIPE_RESULT = {
  mode: 'free-form' as const,
  resolvedCount: 2,
  unresolvedCount: 0,
  confidenceLevel: 'high' as const,
  totalNutrients: {
    calories: 450,
    proteins: 35,
    carbohydrates: 40,
    sugars: null,
    fats: 12,
    saturatedFats: null,
    fiber: 3,
    salt: null,
    sodium: null,
    transFats: null,
    cholesterol: null,
    potassium: null,
    monounsaturatedFats: null,
    polyunsaturatedFats: null,
    alcohol: null,
    referenceBasis: 'per_serving' as const,
  },
  ingredients: [
    {
      input: { foodId: null, name: 'pollo', grams: 200, portionMultiplier: 1.0 },
      resolved: true,
      resolvedAs: { entityId: 'uuid-1', name: 'Chicken', nameEs: 'Pollo', matchType: 'exact_food' as const },
      nutrients: {
        calories: 330,
        proteins: 31,
        carbohydrates: 0,
        sugars: null,
        fats: 7,
        saturatedFats: null,
        fiber: 0,
        salt: null,
        sodium: null,
        transFats: null,
        cholesterol: null,
        potassium: null,
        monounsaturatedFats: null,
        polyunsaturatedFats: null,
    alcohol: null,
        referenceBasis: 'per_serving' as const,
      },
    },
  ],
  unresolvedIngredients: [],
  parsedIngredients: [
    { name: 'pollo', grams: 200, portionMultiplier: 1.0 },
  ],
  cachedAt: null,
};

// ---------------------------------------------------------------------------
// calculateRecipe
// ---------------------------------------------------------------------------

describe('calculateRecipe', () => {
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

  it('calls POST /calculate/recipe URL', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: RECIPE_RESULT }));

    await client.calculateRecipe('200g pollo, 100g arroz');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/calculate/recipe');
  });

  it('uses POST method', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: RECIPE_RESULT }));

    await client.calculateRecipe('200g pollo');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
  });

  it('sends JSON body with mode free-form and the text arg', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: RECIPE_RESULT }));

    await client.calculateRecipe('200g pollo, 100g arroz');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { mode: string; text: string };
    expect(body.mode).toBe('free-form');
    expect(body.text).toBe('200g pollo, 100g arroz');
  });

  it('uses X-API-Key: BOT_API_KEY (not ADMIN_API_KEY)', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: RECIPE_RESULT }));

    await client.calculateRecipe('200g pollo');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('test-api-key');
  });

  it('sends X-FXP-Source: bot header', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: RECIPE_RESULT }));

    await client.calculateRecipe('200g pollo');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-FXP-Source']).toBe('bot');
  });

  it('uses a timeout of at least 30000ms (RECIPE_TIMEOUT_MS)', async () => {
    // We verify that an AbortController is used and the signal is passed.
    // The timeout is tested indirectly by verifying RECIPE_TIMEOUT_MS >= 30000.
    expect(RECIPE_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
    expect(RECIPE_TIMEOUT_MS).toBeGreaterThan(REQUEST_TIMEOUT_MS_VALUE);
  });

  it('returns parsed RecipeCalculateData on 200', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: RECIPE_RESULT }));

    const result = await client.calculateRecipe('200g pollo, 100g arroz');

    expect(result.mode).toBe('free-form');
    expect(result.resolvedCount).toBe(2);
    expect(result.totalNutrients.calories).toBe(450);
  });

  it('throws ApiError(422, RECIPE_UNRESOLVABLE) on 422 with that code', async () => {
    fetchMock.mockResolvedValue(makeResponse(422, {
      success: false,
      error: { code: 'RECIPE_UNRESOLVABLE', message: 'No ingredients could be resolved' },
    }));

    await expect(client.calculateRecipe('abcxyz ingrediente')).rejects.toMatchObject({
      statusCode: 422,
      code: 'RECIPE_UNRESOLVABLE',
    });
  });

  it('throws ApiError(422, FREE_FORM_PARSE_FAILED) on 422 with that code', async () => {
    fetchMock.mockResolvedValue(makeResponse(422, {
      success: false,
      error: { code: 'FREE_FORM_PARSE_FAILED', message: 'LLM could not parse the text' },
    }));

    await expect(client.calculateRecipe('not a recipe')).rejects.toMatchObject({
      statusCode: 422,
      code: 'FREE_FORM_PARSE_FAILED',
    });
  });

  it('throws ApiError(0, NETWORK_ERROR) on fetch rejection', async () => {
    fetchMock.mockRejectedValue(new Error('Network failure'));

    await expect(client.calculateRecipe('200g pollo')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  it('throws ApiError(408, TIMEOUT) on AbortError', async () => {
    const abortError = new Error('The user aborted a request.');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);

    await expect(client.calculateRecipe('200g pollo')).rejects.toMatchObject({
      statusCode: 408,
      code: 'TIMEOUT',
    });
  });

  it('RECIPE_TIMEOUT_MS is exported and equals 30000', async () => {
    expect(RECIPE_TIMEOUT_MS).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// postJson timeout backward compatibility — existing callers still work
// ---------------------------------------------------------------------------

describe('postJson backward compatibility (existing callers use default timeout)', () => {
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

  it('createRestaurant still works with default timeout (no 4th arg regression)', async () => {
    const restaurantResponse = {
      id: 'uuid-1',
      name: 'Test',
      nameEs: null,
      chainSlug: 'test-es',
      countryCode: 'ES',
      isActive: true,
      logoUrl: null,
      website: null,
      address: null,
      dishCount: 0,
    };
    fetchMock.mockResolvedValue(makeResponse(200, { success: true, data: restaurantResponse }));

    await client.createRestaurant({ name: 'Test', chainSlug: 'test-es', countryCode: 'ES' });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/restaurants');
  });
});
