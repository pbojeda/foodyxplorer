// F037 — handleEstimar with Redis context injection tests
// TDD: tests written BEFORE implementation

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import type { EstimateData } from '@foodxplorer/shared';
import type { Redis } from 'ioredis';
import { handleEstimar } from '../commands/estimar.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ESTIMATE_DATA_NULL: EstimateData = {
  query: 'xyz',
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

const ESTIMATE_DATA_WITH_RESULT: EstimateData = {
  query: 'big mac',
  chainSlug: null,
  portionMultiplier: 1.0,
  level1Hit: true,
  level2Hit: false,
  level3Hit: false,
  level4Hit: false,
  matchType: 'exact_dish',
  cachedAt: null,
  result: {
    entityType: 'dish',
    entityId: 'fd000000-0001-4000-a000-000000000001',
    name: 'Big Mac',
    nameEs: 'Big Mac',
    restaurantId: 'fd000000-0002-4000-a000-000000000001',
    chainSlug: 'mcdonalds-es',
    portionGrams: 200,
    confidenceLevel: 'high',
    estimationMethod: 'official',
    similarityDistance: null,
    source: { id: 'fd000000-0004-4000-a000-000000000001', name: 'src', type: 'official', url: null },
    nutrients: {
      calories: 563, proteins: 26.5, carbohydrates: 45, sugars: 0,
      fats: 30, saturatedFats: 0, fiber: 0, salt: 0, sodium: 0,
      transFats: 0, cholesterol: 0, potassium: 0,
      monounsaturatedFats: 0, polyunsaturatedFats: 0,
      referenceBasis: 'per_serving',
    },
  },
};

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

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
  };
}

function makeMockRedis(storedJson: string | null = null): {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  ttl: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn().mockResolvedValue(storedJson),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn(),
    ttl: vi.fn(),
  };
}

const CHAT_ID = 0;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleEstimar — F037 context injection', () => {
  let client: MockApiClient;

  beforeEach(() => {
    client = makeMockClient();
  });

  it('empty args → usage hint (no Redis read)', async () => {
    const redis = makeMockRedis(null);
    const result = await handleEstimar('', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('/estimar');
    expect(redis.get).not.toHaveBeenCalled();
    expect(client.estimate).not.toHaveBeenCalled();
  });

  it('explicit chainSlug in args → uses it, no Redis read', async () => {
    const redis = makeMockRedis(JSON.stringify({ chainContext: { chainSlug: 'burger-king-es', chainName: 'Burger King' } }));
    client.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await handleEstimar('big mac en mcdonalds-es', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(redis.get).not.toHaveBeenCalled();
    expect(client.estimate).toHaveBeenCalledWith({ query: 'big mac', chainSlug: 'mcdonalds-es' });
  });

  it('no explicit slug + active chain context → injects chainSlug from context', async () => {
    const redis = makeMockRedis(JSON.stringify({ chainContext: { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' } }));
    client.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);
    await handleEstimar('big mac', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(client.estimate).toHaveBeenCalledWith({ query: 'big mac', chainSlug: 'mcdonalds-es' });
  });

  it('no explicit slug + active chain context → appends context indicator to response', async () => {
    const redis = makeMockRedis(JSON.stringify({ chainContext: { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' } }));
    client.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);
    const result = await handleEstimar('big mac', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('Contexto activo');
    expect(result).toContain('McDonalds');
  });

  it('no explicit slug + no chain context → no chainSlug in estimate call', async () => {
    const redis = makeMockRedis(null);
    client.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await handleEstimar('big mac', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    const callArgs = client.estimate.mock.calls[0] as [Record<string, unknown>];
    expect(Object.prototype.hasOwnProperty.call(callArgs[0], 'chainSlug')).toBe(false);
  });

  it('Redis get throws → fail-open (no chainSlug injected, no error to user)', async () => {
    const redis = makeMockRedis(null);
    redis.get.mockRejectedValue(new Error('redis down'));
    client.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    const result = await handleEstimar('big mac', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    // Should not error out — fail open
    expect(typeof result).toBe('string');
    const callArgs = client.estimate.mock.calls[0] as [Record<string, unknown>];
    expect(Object.prototype.hasOwnProperty.call(callArgs[0], 'chainSlug')).toBe(false);
  });

  it('explicit slug in args → response does NOT contain context indicator', async () => {
    const redis = makeMockRedis(null);
    client.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);
    const result = await handleEstimar('big mac en mcdonalds-es', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).not.toContain('Contexto activo');
  });
});
