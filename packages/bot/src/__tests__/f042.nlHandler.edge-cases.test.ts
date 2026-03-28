// F042 QA Edge Cases — handleNaturalLanguage portionModifier integration
//
// Focuses on scenarios not covered by the existing portionModifier integration
// tests in naturalLanguage.test.ts:
//  - Modifier-only input (no food name after extraction)
//  - Modifier at START of query
//  - Prefix query stripping AFTER modifier stripping (full pipeline)
//  - apiClient not called with portionMultiplier when fallback returns 1.0

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import type { Redis } from 'ioredis';
import type { EstimateData } from '@foodxplorer/shared';
import { handleNaturalLanguage } from '../handlers/naturalLanguage.js';

function makeMockRedis() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    del: vi.fn(),
    ttl: vi.fn(),
  } as unknown as Redis;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ESTIMATE_DATA_NULL: EstimateData = {
  query: 'grande',
  chainSlug: null,
  portionMultiplier: 1.0,
  level1Hit: false,
  level2Hit: false,
  level3Hit: false,
  level4Hit: false,
  matchType: null,
  result: null,
  cachedAt: null,
};

// ---------------------------------------------------------------------------
// MockApiClient
// ---------------------------------------------------------------------------

type MockApiClient = { [K in keyof ApiClient]: ReturnType<typeof vi.fn> };

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
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleNaturalLanguage — F042 portionModifier edge cases', () => {
  let mock: MockApiClient;

  beforeEach(() => {
    mock = makeMockClient();
  });

  it('"grande" (modifier-only) → fallback keeps "grande" as query, portionMultiplier absent', async () => {
    // extractPortionModifier('grande') returns cleanQuery:'grande', multiplier:1.0 (empty-after-strip fallback)
    // portionMultiplier=1.0 → NOT passed to apiClient per spec
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await handleNaturalLanguage('grande', 0, makeMockRedis(), mock as unknown as ApiClient);

    const args = mock.estimate.mock.calls[0]![0] as Record<string, unknown>;
    expect(args['query']).toBe('grande');
    expect(Object.prototype.hasOwnProperty.call(args, 'portionMultiplier')).toBe(false);
  });

  it('"grande big mac" → modifier at start → cleanQuery: "big mac", portionMultiplier: 1.5', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await handleNaturalLanguage('grande big mac', 0, makeMockRedis(), mock as unknown as ApiClient);

    expect(mock.estimate).toHaveBeenCalledWith({
      query: 'big mac',
      portionMultiplier: 1.5,
    });
  });

  it('"triple sandwich de pollo" → modifier at start → cleanQuery: "sandwich de pollo", portionMultiplier: 3.0', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await handleNaturalLanguage('triple sandwich de pollo', 0, makeMockRedis(), mock as unknown as ApiClient);

    expect(mock.estimate).toHaveBeenCalledWith({
      query: 'sandwich de pollo',
      portionMultiplier: 3.0,
    });
  });

  it('"calorías de una tortilla doble" → modifier stripped first, then prefix → query: "tortilla", portionMultiplier: 2.0', async () => {
    // Pipeline: extractPortionModifier('calorías de una tortilla doble')
    //   → cleanQuery: 'calorías de una tortilla', portionMultiplier: 2.0
    // Then extractFoodQuery('calorías de una tortilla')
    //   → query: 'tortilla'
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await handleNaturalLanguage('calorías de una tortilla doble', 0, makeMockRedis(), mock as unknown as ApiClient);

    expect(mock.estimate).toHaveBeenCalledWith({
      query: 'tortilla',
      portionMultiplier: 2.0,
    });
  });

  it('"media ración de pollo en mcdonalds-es" → modifier + chain slug both handled', async () => {
    // extractPortionModifier strips 'media ración' → cleanQuery: 'de pollo en mcdonalds-es', mult: 0.5
    // extractFoodQuery('de pollo en mcdonalds-es'):
    //   Splits on ' en mcdonalds-es' → query candidate: 'de pollo', chainSlug: 'mcdonalds-es'
    //   NOTE: bare 'de' is NOT in the ARTICLE_PATTERN (only del, un, una, el, la etc.)
    //   so the query remains 'de pollo', not 'pollo'.
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await handleNaturalLanguage('media ración de pollo en mcdonalds-es', 0, makeMockRedis(), mock as unknown as ApiClient);

    expect(mock.estimate).toHaveBeenCalledWith({
      query: 'de pollo',
      chainSlug: 'mcdonalds-es',
      portionMultiplier: 0.5,
    });
  });

  it('"pizza mini" → portionMultiplier: 0.7 sent to apiClient', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await handleNaturalLanguage('pizza mini', 0, makeMockRedis(), mock as unknown as ApiClient);

    expect(mock.estimate).toHaveBeenCalledWith({
      query: 'pizza',
      portionMultiplier: 0.7,
    });
  });

  it('"half burger" → portionMultiplier: 0.5 sent to apiClient', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await handleNaturalLanguage('half burger', 0, makeMockRedis(), mock as unknown as ApiClient);

    expect(mock.estimate).toHaveBeenCalledWith({
      query: 'burger',
      portionMultiplier: 0.5,
    });
  });

  it('"pizza medias" (standalone medias) → portionMultiplier: 0.5, cleanQuery: "pizza"', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await handleNaturalLanguage('pizza medias', 0, makeMockRedis(), mock as unknown as ApiClient);

    expect(mock.estimate).toHaveBeenCalledWith({
      query: 'pizza',
      portionMultiplier: 0.5,
    });
  });
});
