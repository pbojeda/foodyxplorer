// Unit tests for handleReceta command handler (F041).
//
// ApiClient and Redis are injected as plain mock objects — no real HTTP, no real Redis.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import type { ApiClient } from '../apiClient.js';
import type { RecipeCalculateData } from '@foodxplorer/shared';
import { ApiError } from '../apiClient.js';
import { handleReceta } from '../commands/receta.js';

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

function makeMockRedis() {
  return {
    incr: vi.fn(),
    expire: vi.fn(),
  } as unknown as Redis;
}

type MockApiClient = {
  [K in keyof ApiClient]: ReturnType<typeof vi.fn>;
};

function makeMockClient(): MockApiClient {
  return {
    searchDishes: vi.fn(),
    estimate: vi.fn(),
    listRestaurants: vi.fn(),
    listRestaurantDishes: vi.fn(),
    listChains: vi.fn(),
    healthCheck: vi.fn(),
    searchRestaurants: vi.fn(),
    createRestaurant: vi.fn(),
    uploadImage: vi.fn(),
    uploadPdf: vi.fn(),
    analyzeMenu: vi.fn(),
    calculateRecipe: vi.fn(),
    processMessage: vi.fn(),
    sendAudio: vi.fn(),
  };
}

const RECIPE_RESULT: RecipeCalculateData = {
  mode: 'free-form',
  resolvedCount: 2,
  unresolvedCount: 0,
  confidenceLevel: 'medium',
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
    referenceBasis: 'per_serving',
  },
  ingredients: [
    {
      input: { foodId: null, name: 'pollo', grams: 200, portionMultiplier: 1.0 },
      resolved: true,
      resolvedAs: { entityId: 'uuid-1', name: 'Chicken', nameEs: 'Pollo', matchType: 'exact_food' },
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
        referenceBasis: 'per_serving',
      },
    },
    {
      input: { foodId: null, name: 'arroz', grams: 100, portionMultiplier: 1.0 },
      resolved: true,
      resolvedAs: { entityId: 'uuid-2', name: 'Rice', nameEs: 'Arroz', matchType: 'exact_food' },
      nutrients: {
        calories: 120,
        proteins: 4,
        carbohydrates: 28,
        sugars: null,
        fats: 0,
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
        referenceBasis: 'per_serving',
      },
    },
  ],
  unresolvedIngredients: [],
  cachedAt: null,
  portions: null,
  perPortion: null,
};

const CHAT_ID = 42;

// ---------------------------------------------------------------------------
// Input guards (no API call)
// ---------------------------------------------------------------------------

describe('handleReceta — input guards', () => {
  let mock: MockApiClient;
  let redis: Redis;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = makeMockClient();
    redis = makeMockRedis();
  });

  it('returns usage hint for empty args', async () => {
    const result = await handleReceta('', CHAT_ID, mock as unknown as ApiClient, redis);
    expect(result).toContain('/receta');
    expect(mock.calculateRecipe).not.toHaveBeenCalled();
  });

  it('returns usage hint for whitespace-only args', async () => {
    const result = await handleReceta('   ', CHAT_ID, mock as unknown as ApiClient, redis);
    expect(result).toContain('/receta');
    expect(mock.calculateRecipe).not.toHaveBeenCalled();
  });

  it('returns length error message when args > 2000 chars', async () => {
    const longText = 'a'.repeat(2001);
    const result = await handleReceta(longText, CHAT_ID, mock as unknown as ApiClient, redis);
    expect(result).toContain('2000');
    expect(mock.calculateRecipe).not.toHaveBeenCalled();
  });

  it('proceeds normally when args are exactly 2000 chars', async () => {
    const exactText = 'a'.repeat(2000);
    // Rate limit: return 1 (under limit)
    (redis.incr as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (redis.expire as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    mock.calculateRecipe.mockResolvedValue(RECIPE_RESULT);

    await handleReceta(exactText, CHAT_ID, mock as unknown as ApiClient, redis);

    expect(mock.calculateRecipe).toHaveBeenCalled();
  });

  it('trims args before checking length', async () => {
    const textWith2001Chars = 'a'.repeat(2001);
    const result = await handleReceta(textWith2001Chars, CHAT_ID, mock as unknown as ApiClient, redis);
    expect(result).toContain('2000');
    expect(mock.calculateRecipe).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

describe('handleReceta — rate limiting', () => {
  let mock: MockApiClient;
  let redis: Redis;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = makeMockClient();
    redis = makeMockRedis();
    mock.calculateRecipe.mockResolvedValue(RECIPE_RESULT);
  });

  it('calls redis.incr with key fxp:receta:hourly:<chatId>', async () => {
    (redis.incr as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (redis.expire as ReturnType<typeof vi.fn>).mockResolvedValue(1);

    await handleReceta('200g pollo', CHAT_ID, mock as unknown as ApiClient, redis);

    expect(redis.incr).toHaveBeenCalledWith(`fxp:receta:hourly:${CHAT_ID}`);
  });

  it('calls redis.expire on first request (count === 1)', async () => {
    (redis.incr as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (redis.expire as ReturnType<typeof vi.fn>).mockResolvedValue(1);

    await handleReceta('200g pollo', CHAT_ID, mock as unknown as ApiClient, redis);

    expect(redis.expire).toHaveBeenCalledWith(`fxp:receta:hourly:${CHAT_ID}`, 3600);
  });

  it('does NOT call redis.expire when count > 1 (TTL already set)', async () => {
    (redis.incr as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    (redis.expire as ReturnType<typeof vi.fn>).mockResolvedValue(1);

    await handleReceta('200g pollo', CHAT_ID, mock as unknown as ApiClient, redis);

    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('allows exactly 5 requests (incr returns 5 → proceed)', async () => {
    (redis.incr as ReturnType<typeof vi.fn>).mockResolvedValue(5);
    (redis.expire as ReturnType<typeof vi.fn>).mockResolvedValue(1);

    await handleReceta('200g pollo', CHAT_ID, mock as unknown as ApiClient, redis);

    expect(mock.calculateRecipe).toHaveBeenCalled();
  });

  it('blocks 6th request (incr returns 6 → rate limited)', async () => {
    (redis.incr as ReturnType<typeof vi.fn>).mockResolvedValue(6);

    const result = await handleReceta('200g pollo', CHAT_ID, mock as unknown as ApiClient, redis);

    expect(result).toContain('límite');
    expect(mock.calculateRecipe).not.toHaveBeenCalled();
  });

  it('fails open when redis.incr throws (proceeds to API call)', async () => {
    (redis.incr as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Redis connection failed'));

    await handleReceta('200g pollo', CHAT_ID, mock as unknown as ApiClient, redis);

    // Despite Redis error, the API call should still happen (fail-open)
    expect(mock.calculateRecipe).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('handleReceta — happy path', () => {
  let mock: MockApiClient;
  let redis: Redis;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = makeMockClient();
    redis = makeMockRedis();
    (redis.incr as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (redis.expire as ReturnType<typeof vi.fn>).mockResolvedValue(1);
  });

  it('calls calculateRecipe with trimmed args', async () => {
    mock.calculateRecipe.mockResolvedValue(RECIPE_RESULT);

    await handleReceta('  200g pollo, 100g arroz  ', CHAT_ID, mock as unknown as ApiClient, redis);

    expect(mock.calculateRecipe).toHaveBeenCalledWith('200g pollo, 100g arroz', undefined);
  });

  it('returns formatted result containing *Resultado de la receta*', async () => {
    mock.calculateRecipe.mockResolvedValue(RECIPE_RESULT);

    const result = await handleReceta('200g pollo, 100g arroz', CHAT_ID, mock as unknown as ApiClient, redis);

    expect(result).toContain('*Resultado de la receta*');
  });

  it('returns result containing the calories total', async () => {
    mock.calculateRecipe.mockResolvedValue(RECIPE_RESULT);

    const result = await handleReceta('200g pollo, 100g arroz', CHAT_ID, mock as unknown as ApiClient, redis);

    expect(result).toContain('450');
  });
});

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

describe('handleReceta — error mapping', () => {
  let mock: MockApiClient;
  let redis: Redis;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = makeMockClient();
    redis = makeMockRedis();
    (redis.incr as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (redis.expire as ReturnType<typeof vi.fn>).mockResolvedValue(1);
  });

  it('RECIPE_UNRESOLVABLE → message contains "ningún ingrediente"', async () => {
    mock.calculateRecipe.mockRejectedValue(
      new ApiError(422, 'RECIPE_UNRESOLVABLE', 'No ingredients could be resolved'),
    );

    const result = await handleReceta('xyz123 abc', CHAT_ID, mock as unknown as ApiClient, redis);

    expect(result).toContain('ningún ingrediente');
  });

  it('FREE_FORM_PARSE_FAILED → message contains "200g pollo"', async () => {
    mock.calculateRecipe.mockRejectedValue(
      new ApiError(422, 'FREE_FORM_PARSE_FAILED', 'LLM could not parse'),
    );

    const result = await handleReceta('not a real recipe text', CHAT_ID, mock as unknown as ApiClient, redis);

    expect(result).toContain('200g pollo');
  });

  it('ApiError(429) delegates to handleApiError → message contains "Demasiadas consultas"', async () => {
    mock.calculateRecipe.mockRejectedValue(
      new ApiError(429, 'RATE_LIMIT', 'Too many requests'),
    );

    const result = await handleReceta('200g pollo', CHAT_ID, mock as unknown as ApiClient, redis);

    expect(result).toContain('Demasiadas consultas');
  });

  it('ApiError(408, TIMEOUT) → message contains "tardo demasiado"', async () => {
    mock.calculateRecipe.mockRejectedValue(
      new ApiError(408, 'TIMEOUT', 'Request timed out'),
    );

    const result = await handleReceta('200g pollo', CHAT_ID, mock as unknown as ApiClient, redis);

    expect(result).toContain('tardo demasiado');
  });

  it('ApiError(500) → message contains "no esta disponible"', async () => {
    mock.calculateRecipe.mockRejectedValue(
      new ApiError(500, 'SERVER_ERROR', 'Internal error'),
    );

    const result = await handleReceta('200g pollo', CHAT_ID, mock as unknown as ApiClient, redis);

    expect(result).toContain('no esta disponible');
  });

  it('ApiError(0, NETWORK_ERROR) → message contains "conectar"', async () => {
    mock.calculateRecipe.mockRejectedValue(
      new ApiError(0, 'NETWORK_ERROR', 'Network failure'),
    );

    const result = await handleReceta('200g pollo', CHAT_ID, mock as unknown as ApiClient, redis);

    expect(result).toContain('conectar');
  });

  it('RECIPE_UNRESOLVABLE does NOT return "error inesperado" (has specific message)', async () => {
    mock.calculateRecipe.mockRejectedValue(
      new ApiError(422, 'RECIPE_UNRESOLVABLE', 'No ingredients resolved'),
    );

    const result = await handleReceta('xyz', CHAT_ID, mock as unknown as ApiClient, redis);

    expect(result).not.toContain('error inesperado');
  });
});
