// F037 — handleComparar with Redis context injection tests
// TDD: tests written BEFORE implementation

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import type { EstimateData } from '@foodxplorer/shared';
import type { Redis } from 'ioredis';
import { handleComparar } from '../commands/comparar.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ESTIMATE_DATA: EstimateData = {
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
    chainSlug: null,
    portionGrams: 200,
    nutrients: {
      calories: 563, proteins: 26.5, carbohydrates: 45, sugars: 0,
      fats: 30, saturatedFats: 0, fiber: 0, salt: 0, sodium: 0,
      transFats: 0, cholesterol: 0, potassium: 0,
      monounsaturatedFats: 0, polyunsaturatedFats: 0, alcohol: 0,
      referenceBasis: 'per_serving',
    },
    confidenceLevel: 'high',
    estimationMethod: 'official',
    source: { id: 'fd000000-0004-4000-a000-000000000001', name: 'src', type: 'official', url: null },
    similarityDistance: null,
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
    processMessage: vi.fn(),
    sendAudio: vi.fn(),
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

describe('handleComparar — F037 context injection', () => {
  let client: MockApiClient;

  beforeEach(() => {
    client = makeMockClient();
    client.estimate.mockResolvedValue(ESTIMATE_DATA);
  });

  it('empty args → usage hint', async () => {
    const redis = makeMockRedis(null);
    const result = await handleComparar('', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('/comparar');
    expect(client.estimate).not.toHaveBeenCalled();
  });

  it('no separator → error message', async () => {
    const redis = makeMockRedis(null);
    const result = await handleComparar('big mac', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('No encontr');
    expect(client.estimate).not.toHaveBeenCalled();
  });

  it('active chain context → fallbackChainSlug passed to runComparison', async () => {
    const state = JSON.stringify({ chainContext: { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' } });
    const redis = makeMockRedis(state);
    await handleComparar('big mac vs whopper', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    // Both estimate calls should have chainSlug from context (neither dish has explicit slug)
    const callsA = client.estimate.mock.calls[0] as [{ query: string; chainSlug?: string }];
    const callsB = client.estimate.mock.calls[1] as [{ query: string; chainSlug?: string }];
    expect(callsA[0].chainSlug).toBe('mcdonalds-es');
    expect(callsB[0].chainSlug).toBe('mcdonalds-es');
  });

  it('no chain context → no fallbackChainSlug', async () => {
    const redis = makeMockRedis(null);
    await handleComparar('big mac vs whopper', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    const callsA = client.estimate.mock.calls[0] as [{ query: string; chainSlug?: string }];
    expect(Object.prototype.hasOwnProperty.call(callsA[0], 'chainSlug')).toBe(false);
  });

  it('Redis fails → fail-open (no chainSlug injected)', async () => {
    const redis = makeMockRedis(null);
    redis.get.mockRejectedValue(new Error('redis down'));
    await handleComparar('big mac vs whopper', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    const callsA = client.estimate.mock.calls[0] as [{ query: string; chainSlug?: string }];
    expect(Object.prototype.hasOwnProperty.call(callsA[0], 'chainSlug')).toBe(false);
  });

  it('happy path with context → returns formatted comparison', async () => {
    const state = JSON.stringify({ chainContext: { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' } });
    const redis = makeMockRedis(state);
    const result = await handleComparar('big mac vs whopper', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
