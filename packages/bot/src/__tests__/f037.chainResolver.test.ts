// F037 — chainResolver unit tests
// TDD: tests written BEFORE implementation

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import type { ChainListItem } from '@foodxplorer/shared';
import { resolveChain } from '../lib/chainResolver.js';

// ---------------------------------------------------------------------------
// Fixture chains
// ---------------------------------------------------------------------------

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

const CHAIN_KFC: ChainListItem = {
  chainSlug: 'kfc-es',
  name: 'KFC',
  nameEs: null,
  countryCode: 'ES',
  dishCount: 80,
  isActive: true,
};

// Chain with accented nameEs
const CHAIN_TELEPIZZA: ChainListItem = {
  chainSlug: 'telepizza-es',
  name: 'Telepizza',
  nameEs: 'Telepizzá',
  countryCode: 'ES',
  dishCount: 60,
  isActive: true,
};

// ---------------------------------------------------------------------------
// MockApiClient helpers
// ---------------------------------------------------------------------------

type MockApiClient = {
  [K in keyof ApiClient]: ReturnType<typeof vi.fn>;
};

function makeMockClient(chains: ChainListItem[]): MockApiClient {
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
    processMessage: vi.fn(),
    sendAudio: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveChain', () => {
  let client: MockApiClient;

  beforeEach(() => {
    client = makeMockClient([CHAIN_MCDONALDS, CHAIN_BURGER_KING, CHAIN_KFC, CHAIN_TELEPIZZA]);
  });

  // --- min length ---

  it('query shorter than 3 chars → null (no API call)', async () => {
    const result = await resolveChain('mc', client as unknown as ApiClient);
    expect(result).toBeNull();
    expect(client.listChains).not.toHaveBeenCalled();
  });

  it('empty query → null (no API call)', async () => {
    const result = await resolveChain('', client as unknown as ApiClient);
    expect(result).toBeNull();
    expect(client.listChains).not.toHaveBeenCalled();
  });

  it('3-char query passes min length check and calls listChains', async () => {
    const result = await resolveChain('kfc', client as unknown as ApiClient);
    expect(client.listChains).toHaveBeenCalled();
    // KFC slug is "kfc-es" — no exact name match for "kfc" but prefix match on slug
    expect(result).not.toBeNull();
  });

  // --- Tier 1: exact slug ---

  it('exact slug match → returns ResolvedChain with correct chainSlug', async () => {
    const result = await resolveChain('mcdonalds-es', client as unknown as ApiClient);
    expect(result).not.toBeNull();
    expect(result).not.toBe('ambiguous');
    if (result && result !== 'ambiguous') {
      expect(result.chainSlug).toBe('mcdonalds-es');
    }
  });

  it('exact slug match → chainName is nameEs when available', async () => {
    const result = await resolveChain('mcdonalds-es', client as unknown as ApiClient);
    expect(result).not.toBeNull();
    expect(result).not.toBe('ambiguous');
    if (result && result !== 'ambiguous') {
      expect(result.chainName).toBe('McDonalds');
    }
  });

  it('exact slug match → chainName falls back to name when nameEs is null', async () => {
    const result = await resolveChain('kfc-es', client as unknown as ApiClient);
    expect(result).not.toBeNull();
    expect(result).not.toBe('ambiguous');
    if (result && result !== 'ambiguous') {
      expect(result.chainSlug).toBe('kfc-es');
      expect(result.chainName).toBe('KFC');
    }
  });

  // --- Tier 2: exact name ---

  it('exact name match (nameEs) → returns ResolvedChain', async () => {
    const result = await resolveChain('burger king', client as unknown as ApiClient);
    expect(result).not.toBeNull();
    expect(result).not.toBe('ambiguous');
    if (result && result !== 'ambiguous') {
      expect(result.chainSlug).toBe('burger-king-es');
    }
  });

  it('exact name match (name, no nameEs) → returns ResolvedChain', async () => {
    const result = await resolveChain('kfc', client as unknown as ApiClient);
    // KFC has nameEs=null, so checks chain.name: "KFC"
    // normalized "kfc" === normalize("KFC") = "kfc" → tier 2 exact match
    expect(result).not.toBeNull();
    expect(result).not.toBe('ambiguous');
    if (result && result !== 'ambiguous') {
      expect(result.chainSlug).toBe('kfc-es');
    }
  });

  // --- Tier 3: prefix ---

  it('prefix match on slug → returns ResolvedChain', async () => {
    const result = await resolveChain('mcdonalds', client as unknown as ApiClient);
    // "mcdonalds" is prefix of "mcdonalds-es"
    expect(result).not.toBeNull();
    expect(result).not.toBe('ambiguous');
    if (result && result !== 'ambiguous') {
      expect(result.chainSlug).toBe('mcdonalds-es');
    }
  });

  it('prefix match on name → returns ResolvedChain', async () => {
    const result = await resolveChain('burger', client as unknown as ApiClient);
    // "burger" is prefix of "Burger King" (normalized)
    expect(result).not.toBeNull();
    expect(result).not.toBe('ambiguous');
    if (result && result !== 'ambiguous') {
      expect(result.chainSlug).toBe('burger-king-es');
    }
  });

  // --- Tier 4: substring ---

  it('substring match → returns ResolvedChain', async () => {
    const result = await resolveChain('king', client as unknown as ApiClient);
    // "king" is substring of "burger king"
    expect(result).not.toBeNull();
    expect(result).not.toBe('ambiguous');
    if (result && result !== 'ambiguous') {
      expect(result.chainSlug).toBe('burger-king-es');
    }
  });

  // --- ambiguous ---

  it('multiple matches in same tier → "ambiguous"', async () => {
    // Add another chain whose slug starts with "burger"
    const anotherBurger: ChainListItem = {
      chainSlug: 'burger-another-es',
      name: 'Burger Another',
      nameEs: null,
      countryCode: 'ES',
      dishCount: 10,
      isActive: true,
    };
    const ambiguousClient = makeMockClient([CHAIN_BURGER_KING, anotherBurger]);
    const result = await resolveChain('burger', ambiguousClient as unknown as ApiClient);
    expect(result).toBe('ambiguous');
  });

  // --- no match ---

  it('no match at all → null', async () => {
    const result = await resolveChain('subway', client as unknown as ApiClient);
    expect(result).toBeNull();
  });

  // --- normalization ---

  it('accent normalization: "telepizza" matches "Telepizzá" nameEs', async () => {
    const result = await resolveChain('telepizza', client as unknown as ApiClient);
    // "telepizza" normalizes diacritics → "telepizza"
    // "Telepizzá" → normalize NFD → "telepizza"
    // tier 2 exact name or tier 3 prefix — either way matches
    expect(result).not.toBeNull();
    expect(result).not.toBe('ambiguous');
    if (result && result !== 'ambiguous') {
      expect(result.chainSlug).toBe('telepizza-es');
    }
  });

  it('apostrophe removal: "mcdonalds" matches slug containing no apostrophe', async () => {
    // McDonald's nameEs is "McDonalds" (no apostrophe)
    const result = await resolveChain("mcdonald's", client as unknown as ApiClient);
    expect(result).not.toBeNull();
    expect(result).not.toBe('ambiguous');
    if (result && result !== 'ambiguous') {
      expect(result.chainSlug).toBe('mcdonalds-es');
    }
  });

  // --- API throws ---

  it('listChains throws → rethrows the error', async () => {
    const throwingClient = makeMockClient([]);
    throwingClient.listChains.mockRejectedValue(new Error('network error'));
    await expect(
      resolveChain('mcdonalds', throwingClient as unknown as ApiClient),
    ).rejects.toThrow('network error');
  });
});
