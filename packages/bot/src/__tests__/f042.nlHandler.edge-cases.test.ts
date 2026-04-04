// F042 QA Edge Cases — handleNaturalLanguage after F070 refactor
//
// After F070: handleNaturalLanguage calls apiClient.processMessage(text, chatId, legacyChainContext).
// Portion modifier parsing, prefix stripping, and chain slug extraction now happen
// server-side (ConversationCore). The bot sends the raw text and the server decides.
//
// These tests verify:
// - processMessage is called with the raw text (no client-side transformation)
// - The returned ConversationMessageData is formatted correctly

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import type { Redis } from 'ioredis';
import type { EstimateData, ConversationMessageData } from '@foodxplorer/shared';
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

const ESTIMATE_DATA_WITH_RESULT: EstimateData = {
  query: 'big mac',
  chainSlug: null,
  portionMultiplier: 1.5,
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
    processMessage: vi.fn(),
    sendAudio: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleNaturalLanguage — F042 portionModifier edge cases (F070 refactor)', () => {
  let mock: MockApiClient;

  beforeEach(() => {
    mock = makeMockClient();
  });

  it('raw text is passed to processMessage unchanged — no client-side modifier extraction', async () => {
    const messageData: ConversationMessageData = {
      intent: 'estimation',
      actorId: 'fd000000-0001-4000-a000-000000000099',
      estimation: ESTIMATE_DATA_NULL,
      activeContext: null,
    };
    mock.processMessage.mockResolvedValue(messageData);

    await handleNaturalLanguage('grande big mac', 0, makeMockRedis(), mock as unknown as ApiClient);

    expect(mock.processMessage).toHaveBeenCalledWith('grande big mac', 0, undefined);
    expect(mock.estimate).not.toHaveBeenCalled();
  });

  it('"grande" input → processMessage called with raw text, no estimation call', async () => {
    const messageData: ConversationMessageData = {
      intent: 'estimation',
      actorId: 'fd000000-0001-4000-a000-000000000099',
      estimation: ESTIMATE_DATA_NULL,
      activeContext: null,
    };
    mock.processMessage.mockResolvedValue(messageData);

    await handleNaturalLanguage('grande', 0, makeMockRedis(), mock as unknown as ApiClient);

    expect(mock.processMessage).toHaveBeenCalledOnce();
    expect(mock.processMessage).toHaveBeenCalledWith('grande', 0, undefined);
    expect(mock.estimate).not.toHaveBeenCalled();
  });

  it('"triple sandwich de pollo" → processMessage called with raw text', async () => {
    const messageData: ConversationMessageData = {
      intent: 'estimation',
      actorId: 'fd000000-0001-4000-a000-000000000099',
      estimation: ESTIMATE_DATA_NULL,
      activeContext: null,
    };
    mock.processMessage.mockResolvedValue(messageData);

    await handleNaturalLanguage('triple sandwich de pollo', 0, makeMockRedis(), mock as unknown as ApiClient);

    expect(mock.processMessage).toHaveBeenCalledWith('triple sandwich de pollo', 0, undefined);
  });

  it('"calorías de una tortilla doble" → processMessage called with raw text', async () => {
    const messageData: ConversationMessageData = {
      intent: 'estimation',
      actorId: 'fd000000-0001-4000-a000-000000000099',
      estimation: ESTIMATE_DATA_NULL,
      activeContext: null,
    };
    mock.processMessage.mockResolvedValue(messageData);

    await handleNaturalLanguage('calorías de una tortilla doble', 0, makeMockRedis(), mock as unknown as ApiClient);

    expect(mock.processMessage).toHaveBeenCalledWith('calorías de una tortilla doble', 0, undefined);
  });

  it('"media ración de pollo en mcdonalds-es" → processMessage called with raw text', async () => {
    const messageData: ConversationMessageData = {
      intent: 'estimation',
      actorId: 'fd000000-0001-4000-a000-000000000099',
      estimation: ESTIMATE_DATA_NULL,
      activeContext: null,
    };
    mock.processMessage.mockResolvedValue(messageData);

    await handleNaturalLanguage('media ración de pollo en mcdonalds-es', 0, makeMockRedis(), mock as unknown as ApiClient);

    expect(mock.processMessage).toHaveBeenCalledWith('media ración de pollo en mcdonalds-es', 0, undefined);
  });

  it('"pizza mini" → processMessage called with raw text', async () => {
    const messageData: ConversationMessageData = {
      intent: 'estimation',
      actorId: 'fd000000-0001-4000-a000-000000000099',
      estimation: ESTIMATE_DATA_NULL,
      activeContext: null,
    };
    mock.processMessage.mockResolvedValue(messageData);

    await handleNaturalLanguage('pizza mini', 0, makeMockRedis(), mock as unknown as ApiClient);

    expect(mock.processMessage).toHaveBeenCalledWith('pizza mini', 0, undefined);
  });

  it('"half burger" → processMessage called with raw text', async () => {
    const messageData: ConversationMessageData = {
      intent: 'estimation',
      actorId: 'fd000000-0001-4000-a000-000000000099',
      estimation: ESTIMATE_DATA_NULL,
      activeContext: null,
    };
    mock.processMessage.mockResolvedValue(messageData);

    await handleNaturalLanguage('half burger', 0, makeMockRedis(), mock as unknown as ApiClient);

    expect(mock.processMessage).toHaveBeenCalledWith('half burger', 0, undefined);
  });

  it('"pizza medias" → processMessage called with raw text', async () => {
    const messageData: ConversationMessageData = {
      intent: 'estimation',
      actorId: 'fd000000-0001-4000-a000-000000000099',
      estimation: ESTIMATE_DATA_NULL,
      activeContext: null,
    };
    mock.processMessage.mockResolvedValue(messageData);

    await handleNaturalLanguage('pizza medias', 0, makeMockRedis(), mock as unknown as ApiClient);

    expect(mock.processMessage).toHaveBeenCalledWith('pizza medias', 0, undefined);
  });

  it('estimation with portionMultiplier result → formatEstimate shows result', async () => {
    const messageData: ConversationMessageData = {
      intent: 'estimation',
      actorId: 'fd000000-0001-4000-a000-000000000099',
      estimation: ESTIMATE_DATA_WITH_RESULT,
      activeContext: null,
    };
    mock.processMessage.mockResolvedValue(messageData);

    const result = await handleNaturalLanguage('grande big mac', 0, makeMockRedis(), mock as unknown as ApiClient);

    expect(typeof result).toBe('string');
    expect(result).toContain('Big Mac');
  });
});
