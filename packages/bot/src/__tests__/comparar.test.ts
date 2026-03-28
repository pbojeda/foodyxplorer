// Unit tests for /comparar command handler.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import type { EstimateData } from '@foodxplorer/shared';
import { handleComparar } from '../commands/comparar.js';

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
  };
}

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
      monounsaturatedFats: 0, polyunsaturatedFats: 0,
      referenceBasis: 'per_serving',
    },
    confidenceLevel: 'high',
    estimationMethod: 'official',
    source: { id: 'fd000000-0004-4000-a000-000000000001', name: 'src', type: 'official', url: null },
    similarityDistance: null,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let client: MockApiClient;

beforeEach(() => {
  client = makeMockClient();
});

describe('handleComparar', () => {
  it('returns usage hint when args is empty', async () => {
    const result = await handleComparar('', client as unknown as ApiClient);
    expect(result).toContain('/comparar');
    expect(result).toContain('vs');
    expect(client.estimate).not.toHaveBeenCalled();
  });

  it('returns usage hint for whitespace-only args', async () => {
    const result = await handleComparar('   ', client as unknown as ApiClient);
    expect(result).toContain('/comparar');
    expect(client.estimate).not.toHaveBeenCalled();
  });

  it('returns no-separator error when no recognised separator', async () => {
    const result = await handleComparar('big mac', client as unknown as ApiClient);
    expect(result).toContain('No encontr');
    expect(result).toContain('vs');
    expect(client.estimate).not.toHaveBeenCalled();
  });

  it('calls estimate twice for happy path "big mac vs whopper"', async () => {
    client.estimate.mockResolvedValue(ESTIMATE_DATA);
    const result = await handleComparar('big mac vs whopper', client as unknown as ApiClient);
    expect(client.estimate).toHaveBeenCalledTimes(2);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('propagates the formatted comparison string', async () => {
    client.estimate.mockResolvedValue(ESTIMATE_DATA);
    const result = await handleComparar('big mac vs whopper', client as unknown as ApiClient);
    // Should contain comparison card elements
    expect(result).toContain('Big Mac');
  });

  it('rethrows unknown errors from runComparison', async () => {
    client.estimate.mockRejectedValue(new Error('random crash'));
    await expect(
      handleComparar('big mac vs whopper', client as unknown as ApiClient),
    ).rejects.toThrow('random crash');
  });

  it('nutrientFocus is always undefined for slash command', async () => {
    client.estimate.mockResolvedValue(ESTIMATE_DATA);
    const result = await handleComparar('big mac vs whopper', client as unknown as ApiClient);
    // No (foco) label should appear in the result
    expect(result).not.toContain('(foco)');
  });
});
