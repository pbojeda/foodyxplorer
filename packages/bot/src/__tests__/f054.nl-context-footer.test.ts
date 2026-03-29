// F054: NL handler should append "Contexto activo" footer when fallback chain is used.
//
// Mirrors the behavior of /estimar (estimar.ts:90-93) where the footer is
// appended when chainContext was injected (not explicit in query).

import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import type { EstimateData } from '@foodxplorer/shared';
import type { Redis } from 'ioredis';
import { handleNaturalLanguage } from '../handlers/naturalLanguage.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ESTIMATE_DATA_WITH_RESULT: EstimateData = {
  query: 'big mac',
  chainSlug: 'mcdonalds-es',
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
    listChains: vi.fn().mockResolvedValue([]),
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

// ==========================================================================
// F054 — NL handler "Contexto activo" footer
// ==========================================================================

describe('F054 — NL handler appends "Contexto activo" footer', () => {
  it('appends footer when fallback chain context is used', async () => {
    const state = JSON.stringify({
      chainContext: { chainSlug: 'mcdonalds-es', chainName: "McDonald's Spain" },
    });
    const redis = makeMockRedis(state);
    const client = makeMockClient();
    client.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);

    const result = await handleNaturalLanguage('big mac', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);

    expect(result).toContain('Contexto activo');
    expect(result).toContain("McDonald's Spain");
  });

  it('does NOT append footer when explicit chainSlug in query', async () => {
    const state = JSON.stringify({
      chainContext: { chainSlug: 'mcdonalds-es', chainName: "McDonald's Spain" },
    });
    const redis = makeMockRedis(state);
    const client = makeMockClient();
    client.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);

    const result = await handleNaturalLanguage('big mac en burger-king-es', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);

    expect(result).not.toContain('Contexto activo');
  });

  it('does NOT append footer when no context is active', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient();
    client.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);

    const result = await handleNaturalLanguage('big mac', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);

    expect(result).not.toContain('Contexto activo');
  });

  it('footer format matches /estimar — italic MarkdownV2', async () => {
    const state = JSON.stringify({
      chainContext: { chainSlug: 'mcdonalds-es', chainName: "McDonald's Spain" },
    });
    const redis = makeMockRedis(state);
    const client = makeMockClient();
    client.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);

    const result = await handleNaturalLanguage('big mac', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);

    // Must use italic delimiters and escaped chain name — same as estimar.ts
    expect(result).toMatch(/_Contexto activo: McDonald's Spain_/);
  });
});
