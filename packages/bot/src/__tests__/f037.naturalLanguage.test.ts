// F037 — handleNaturalLanguage with chain context injection and detection
//
// After F070 refactor: handleNaturalLanguage calls apiClient.processMessage().
// Context-set detection, chain resolution, and context injection now happen
// server-side in ConversationCore. The bot reads the intent from the response.
//
// These tests verify that:
// - The raw text is passed to processMessage unchanged
// - The legacy chainContext from bot:state Redis is forwarded to processMessage
// - The response intent drives the returned message format

import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import type { EstimateData, ConversationMessageData } from '@foodxplorer/shared';
import type { Redis } from 'ioredis';
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

function makeEstimationResponse(
  estimation: EstimateData,
  activeContext: ConversationMessageData['activeContext'] = null,
): ConversationMessageData {
  return {
    intent: 'estimation',
    actorId: 'fd000000-0001-4000-a000-000000000099',
    estimation,
    activeContext,
  };
}

const CHAT_ID = 0;

// ---------------------------------------------------------------------------
// Step 0 — Context-set detection (now server-side)
// ---------------------------------------------------------------------------

describe('handleNaturalLanguage — F037 context-set detection (Step 0)', () => {
  it('"estoy en mcdonalds-es" → processMessage returns context_set, returns confirmation', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient();
    const messageData: ConversationMessageData = {
      intent: 'context_set',
      actorId: 'fd000000-0001-4000-a000-000000000099',
      contextSet: { chainSlug: 'mcdonalds-es', chainName: "McDonald's" },
      activeContext: { chainSlug: 'mcdonalds-es', chainName: "McDonald's" },
    };
    client.processMessage.mockResolvedValue(messageData);

    const result = await handleNaturalLanguage('estoy en mcdonalds-es', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('Contexto establecido');
    expect(client.estimate).not.toHaveBeenCalled();
    expect(client.processMessage).toHaveBeenCalledWith('estoy en mcdonalds-es', CHAT_ID, undefined);
  });

  it('"estoy en mcdonalds" → processMessage returns context_set (prefix match done server-side)', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient();
    const messageData: ConversationMessageData = {
      intent: 'context_set',
      actorId: 'fd000000-0001-4000-a000-000000000099',
      contextSet: { chainSlug: 'mcdonalds-es', chainName: "McDonald's" },
      activeContext: { chainSlug: 'mcdonalds-es', chainName: "McDonald's" },
    };
    client.processMessage.mockResolvedValue(messageData);

    const result = await handleNaturalLanguage('estoy en mcdonalds', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('Contexto establecido');
    expect(client.processMessage).toHaveBeenCalledWith('estoy en mcdonalds', CHAT_ID, undefined);
  });

  it('"estoy en mcdonalds" → processMessage called (bot does not write Redis directly)', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient();
    const messageData: ConversationMessageData = {
      intent: 'context_set',
      actorId: 'fd000000-0001-4000-a000-000000000099',
      contextSet: { chainSlug: 'mcdonalds-es', chainName: "McDonald's" },
      activeContext: { chainSlug: 'mcdonalds-es', chainName: "McDonald's" },
    };
    client.processMessage.mockResolvedValue(messageData);

    await handleNaturalLanguage('estoy en mcdonalds', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    // The bot calls processMessage, not listChains+Redis directly
    expect(client.processMessage).toHaveBeenCalledOnce();
    expect(client.listChains).not.toHaveBeenCalled();
  });

  it('"estoy en xyz" (no chain found) → estimation intent (server falls through)', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient();
    const messageData: ConversationMessageData = makeEstimationResponse(ESTIMATE_DATA_NULL);
    client.processMessage.mockResolvedValue(messageData);

    const result = await handleNaturalLanguage('estoy en xyz', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).not.toContain('Contexto establecido');
    expect(client.processMessage).toHaveBeenCalledOnce();
  });

  it('"estoy en burger" → context_set ambiguous → returns ambiguity message', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient();
    const messageData: ConversationMessageData = {
      intent: 'context_set',
      actorId: 'fd000000-0001-4000-a000-000000000099',
      ambiguous: true,
      activeContext: null,
    };
    client.processMessage.mockResolvedValue(messageData);

    const result = await handleNaturalLanguage('estoy en burger', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('varias cadenas');
    expect(client.estimate).not.toHaveBeenCalled();
  });

  it('processMessage error propagates (no swallowing)', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient();
    client.processMessage.mockRejectedValue(new Error('service down'));

    await expect(
      handleNaturalLanguage('estoy en mcdonalds', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient),
    ).rejects.toThrow('service down');
  });
});

// ---------------------------------------------------------------------------
// Steps 1 & 2 — Context injection (now server-side via processMessage)
// ---------------------------------------------------------------------------

describe('handleNaturalLanguage — F037 context injection (Steps 1 & 2)', () => {
  it('legacy bot:state chainContext is forwarded to processMessage', async () => {
    const state = JSON.stringify({ chainContext: { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' } });
    const redis = makeMockRedis(state);
    const client = makeMockClient();
    const messageData = makeEstimationResponse(ESTIMATE_DATA_WITH_RESULT, { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' });
    client.processMessage.mockResolvedValue(messageData);

    await handleNaturalLanguage('big mac', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(client.processMessage).toHaveBeenCalledWith(
      'big mac', CHAT_ID, { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' },
    );
  });

  it('explicit chainSlug in query text → processMessage called with raw text, server resolves', async () => {
    const state = JSON.stringify({ chainContext: { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' } });
    const redis = makeMockRedis(state);
    const client = makeMockClient();
    const messageData = makeEstimationResponse(ESTIMATE_DATA_NULL);
    client.processMessage.mockResolvedValue(messageData);

    await handleNaturalLanguage('big mac en burger-king-es', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(client.processMessage).toHaveBeenCalledWith(
      'big mac en burger-king-es', CHAT_ID, { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' },
    );
  });

  it('active chain context → processMessage called with legacyChainContext', async () => {
    const state = JSON.stringify({ chainContext: { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' } });
    const redis = makeMockRedis(state);
    const client = makeMockClient();
    const messageData: ConversationMessageData = {
      intent: 'comparison',
      actorId: 'fd000000-0001-4000-a000-000000000099',
      comparison: { dishA: ESTIMATE_DATA_WITH_RESULT, dishB: ESTIMATE_DATA_WITH_RESULT },
      activeContext: { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' },
    };
    client.processMessage.mockResolvedValue(messageData);

    await handleNaturalLanguage('compara big mac con whopper', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(client.processMessage).toHaveBeenCalledWith(
      'compara big mac con whopper', CHAT_ID, { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' },
    );
  });

  it('no context → processMessage called with undefined legacyChainContext', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient();
    const messageData = makeEstimationResponse(ESTIMATE_DATA_NULL);
    client.processMessage.mockResolvedValue(messageData);

    await handleNaturalLanguage('big mac', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(client.processMessage).toHaveBeenCalledWith('big mac', CHAT_ID, undefined);
  });

  it('Redis fails → fail-open (processMessage called with undefined legacyChainContext)', async () => {
    const redis = makeMockRedis(null);
    redis.get.mockRejectedValue(new Error('redis down'));
    const client = makeMockClient();
    const messageData = makeEstimationResponse(ESTIMATE_DATA_NULL);
    client.processMessage.mockResolvedValue(messageData);

    const result = await handleNaturalLanguage('big mac', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(typeof result).toBe('string');
    expect(client.processMessage).toHaveBeenCalledWith('big mac', CHAT_ID, undefined);
  });
});
