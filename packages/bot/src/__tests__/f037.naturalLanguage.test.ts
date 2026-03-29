// F037 — handleNaturalLanguage with chain context injection and detection

import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import type { EstimateData, ChainListItem } from '@foodxplorer/shared';
import type { Redis } from 'ioredis';
import { ApiError } from '../apiClient.js';
import { handleNaturalLanguage } from '../handlers/naturalLanguage.js';

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

const CHAIN_MCDONALDS: ChainListItem = {
  chainSlug: 'mcdonalds-es',
  name: "McDonald's",
  nameEs: 'McDonalds',
  countryCode: 'ES',
  dishCount: 150,
  isActive: true,
};

const CHAIN_BURGER_KING: ChainListItem = {
  chainSlug: 'burger-king-es',
  name: 'Burger King',
  nameEs: 'Burger King',
  countryCode: 'ES',
  dishCount: 100,
  isActive: true,
};

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type MockApiClient = {
  [K in keyof ApiClient]: ReturnType<typeof vi.fn>;
};

function makeMockClient(chains: ChainListItem[] = []): MockApiClient {
  return {
    searchDishes: vi.fn(),
    estimate: vi.fn(),
    listRestaurants: vi.fn(),
    listRestaurantDishes: vi.fn(),
    listChains: vi.fn().mockResolvedValue(chains),
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
// Step 0 — Context-set detection
// ---------------------------------------------------------------------------

describe('handleNaturalLanguage — F037 context-set detection (Step 0)', () => {
  it('"estoy en mcdonalds-es" → resolves chain, sets context, returns confirmation', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient([CHAIN_MCDONALDS]);
    client.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);

    const result = await handleNaturalLanguage('estoy en mcdonalds-es', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('Contexto establecido');
    expect(client.estimate).not.toHaveBeenCalled();
  });

  it('"estoy en mcdonalds" → resolves to mcdonalds-es (prefix match), sets context', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient([CHAIN_MCDONALDS]);

    const result = await handleNaturalLanguage('estoy en mcdonalds', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('Contexto establecido');
    expect(redis.set).toHaveBeenCalled();
  });

  it('"estoy en mcdonalds" → saves chainContext to Redis', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient([CHAIN_MCDONALDS]);

    await handleNaturalLanguage('estoy en mcdonalds', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(redis.set).toHaveBeenCalled();
    const setCall = redis.set.mock.calls[0] as [string, string, string, number];
    const saved = JSON.parse(setCall[1]) as { chainContext?: { chainSlug: string } };
    expect(saved.chainContext?.chainSlug).toBe('mcdonalds-es');
  });

  it('"estoy en xyz" (no chain found) → null → falls through to single-dish path', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient([]);
    client.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);

    // "estoy en xyz" — no chain resolved → falls through silently to single-dish
    const result = await handleNaturalLanguage('estoy en xyz', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    // Should call estimate (single-dish path) — NOT show confirmation
    expect(result).not.toContain('Contexto establecido');
    expect(client.estimate).toHaveBeenCalled();
  });

  it('"estoy en burger" → ambiguous → returns ambiguity message directly', async () => {
    const anotherBurger: ChainListItem = {
      chainSlug: 'burger-another-es',
      name: 'Burger Another',
      nameEs: null,
      countryCode: 'ES',
      dishCount: 10,
      isActive: true,
    };
    const redis = makeMockRedis(null);
    const client = makeMockClient([CHAIN_BURGER_KING, anotherBurger]);

    const result = await handleNaturalLanguage('estoy en burger', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('Encontré varias cadenas');
    expect(client.estimate).not.toHaveBeenCalled();
  });

  it('ApiError from listChains in Step 0 → falls through silently (null return → continue)', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient([]);
    client.listChains.mockRejectedValue(new ApiError(503, 'SERVICE_UNAVAILABLE', 'down'));
    client.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);

    // ApiError in context-set → return null → fall through to single-dish
    const result = await handleNaturalLanguage('estoy en mcdonalds', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    // Falls through to single-dish: estimate called with "estoy en mcdonalds"
    expect(client.estimate).toHaveBeenCalled();
    expect(result).not.toContain('Contexto establecido');
  });
});

// ---------------------------------------------------------------------------
// Steps 1 & 2 — Context injection into existing paths
// ---------------------------------------------------------------------------

describe('handleNaturalLanguage — F037 context injection (Steps 1 & 2)', () => {
  it('active chain context → injected into single-dish estimate call', async () => {
    const state = JSON.stringify({ chainContext: { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' } });
    const redis = makeMockRedis(state);
    const client = makeMockClient([]);
    client.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);

    await handleNaturalLanguage('big mac', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(client.estimate).toHaveBeenCalledWith({ query: 'big mac', chainSlug: 'mcdonalds-es' });
  });

  it('explicit chainSlug in query overrides context', async () => {
    const state = JSON.stringify({ chainContext: { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' } });
    const redis = makeMockRedis(state);
    const client = makeMockClient([]);
    client.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);

    await handleNaturalLanguage('big mac en burger-king-es', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(client.estimate).toHaveBeenCalledWith({ query: 'big mac', chainSlug: 'burger-king-es' });
  });

  it('active chain context → injected into comparison path', async () => {
    const state = JSON.stringify({ chainContext: { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' } });
    const redis = makeMockRedis(state);
    const client = makeMockClient([]);
    client.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);

    await handleNaturalLanguage('compara big mac con whopper', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(client.estimate).toHaveBeenCalledTimes(2);
    const callsA = client.estimate.mock.calls[0] as [{ query: string; chainSlug?: string }];
    expect(callsA[0].chainSlug).toBe('mcdonalds-es');
  });

  it('no context → no chainSlug injected', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient([]);
    client.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);

    await handleNaturalLanguage('big mac', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    const args = (client.estimate.mock.calls[0] as [Record<string, unknown>])[0];
    expect(Object.prototype.hasOwnProperty.call(args, 'chainSlug')).toBe(false);
  });

  it('Redis fails → fail-open (no chainSlug injected)', async () => {
    const redis = makeMockRedis(null);
    redis.get.mockRejectedValue(new Error('redis down'));
    const client = makeMockClient([]);
    client.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);

    const result = await handleNaturalLanguage('big mac', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(typeof result).toBe('string');
    const args = (client.estimate.mock.calls[0] as [Record<string, unknown>])[0];
    expect(Object.prototype.hasOwnProperty.call(args, 'chainSlug')).toBe(false);
  });
});
