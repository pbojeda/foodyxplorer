// F037 — comparisonRunner fallbackChainSlug tests
// TDD: tests written BEFORE implementation

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import type { EstimateData } from '@foodxplorer/shared';
import { runComparison } from '../lib/comparisonRunner.js';

// ---------------------------------------------------------------------------
// MockApiClient
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NUTRIENTS = {
  calories: 563, proteins: 26.5, carbohydrates: 45, sugars: 0,
  fats: 30, saturatedFats: 0, fiber: 0, salt: 0, sodium: 0,
  transFats: 0, cholesterol: 0, potassium: 0,
  monounsaturatedFats: 0, polyunsaturatedFats: 0, alcohol: 0,
  referenceBasis: 'per_serving' as const,
};

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
    nutrients: NUTRIENTS,
    confidenceLevel: 'high',
    estimationMethod: 'official',
    source: { id: 'fd000000-0004-4000-a000-000000000001', name: 'src', type: 'official', url: null },
    similarityDistance: null,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runComparison — fallbackChainSlug (F037)', () => {
  let client: MockApiClient;

  beforeEach(() => {
    client = makeMockClient();
    client.estimate.mockResolvedValue(ESTIMATE_DATA);
  });

  it('fallbackChainSlug passed when neither dish has explicit slug', async () => {
    await runComparison('big mac', 'whopper', undefined, client as unknown as ApiClient, 'mcdonalds-es');

    const callsA = client.estimate.mock.calls[0] as [{ query: string; chainSlug?: string }];
    const callsB = client.estimate.mock.calls[1] as [{ query: string; chainSlug?: string }];
    expect(callsA[0].chainSlug).toBe('mcdonalds-es');
    expect(callsB[0].chainSlug).toBe('mcdonalds-es');
  });

  it('explicit slug in dishA overrides fallback', async () => {
    await runComparison('big mac en mcdonalds-es', 'whopper', undefined, client as unknown as ApiClient, 'burger-king-es');

    const callsA = client.estimate.mock.calls[0] as [{ query: string; chainSlug?: string }];
    const callsB = client.estimate.mock.calls[1] as [{ query: string; chainSlug?: string }];
    // dishA has explicit "mcdonalds-es" slug
    expect(callsA[0].chainSlug).toBe('mcdonalds-es');
    // dishB has no explicit slug → fallback
    expect(callsB[0].chainSlug).toBe('burger-king-es');
  });

  it('explicit slug in dishB overrides fallback', async () => {
    await runComparison('big mac', 'whopper en burger-king-es', undefined, client as unknown as ApiClient, 'mcdonalds-es');

    const callsA = client.estimate.mock.calls[0] as [{ query: string; chainSlug?: string }];
    const callsB = client.estimate.mock.calls[1] as [{ query: string; chainSlug?: string }];
    // dishA has no explicit slug → fallback
    expect(callsA[0].chainSlug).toBe('mcdonalds-es');
    // dishB has explicit "burger-king-es" slug
    expect(callsB[0].chainSlug).toBe('burger-king-es');
  });

  it('no fallback → no chainSlug injected (5th arg absent)', async () => {
    await runComparison('big mac', 'whopper', undefined, client as unknown as ApiClient);

    const callsA = client.estimate.mock.calls[0] as [{ query: string; chainSlug?: string }];
    const callsB = client.estimate.mock.calls[1] as [{ query: string; chainSlug?: string }];
    expect(Object.prototype.hasOwnProperty.call(callsA[0], 'chainSlug')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(callsB[0], 'chainSlug')).toBe(false);
  });

  it('fallback undefined → no chainSlug injected', async () => {
    await runComparison('big mac', 'whopper', undefined, client as unknown as ApiClient, undefined);

    const callsA = client.estimate.mock.calls[0] as [{ query: string; chainSlug?: string }];
    expect(Object.prototype.hasOwnProperty.call(callsA[0], 'chainSlug')).toBe(false);
  });
});
