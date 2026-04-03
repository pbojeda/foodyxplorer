// Unit tests for the refactored handleNaturalLanguage (F070, Step 9)
//
// After refactor: handleNaturalLanguage calls apiClient.processMessage() and
// switches on data.intent. All formatters remain unchanged.
// Mock apiClient.processMessage via the ApiClient interface.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import type { ConversationMessageData, EstimateData } from '@foodxplorer/shared';
import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Mock conversationState.getState (for legacy chainContext read)
// ---------------------------------------------------------------------------

const { mockGetState } = vi.hoisted(() => ({
  mockGetState: vi.fn(),
}));

vi.mock('../lib/conversationState.js', () => ({
  getState: mockGetState,
  setState: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

import { handleNaturalLanguage } from '../handlers/naturalLanguage.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHAT_ID = 12345;
const ACTOR_UUID = 'fd000000-0070-4000-a000-000000000099';

const BASE_NUTRIENTS = {
  calories: 563, proteins: 26.5, carbohydrates: 45, sugars: 0,
  fats: 30, saturatedFats: 11, fiber: 0, salt: 0, sodium: 0,
  transFats: 0, cholesterol: 0, potassium: 0,
  monounsaturatedFats: 0, polyunsaturatedFats: 0,
  referenceBasis: 'per_serving' as const,
};

const MOCK_RESULT = {
  entityType: 'dish' as const, entityId: 'e1', name: 'Big Mac', nameEs: 'Big Mac',
  restaurantId: 'r1', chainSlug: 'mcdonalds-es', portionGrams: 200,
  nutrients: BASE_NUTRIENTS, confidenceLevel: 'high' as const,
  estimationMethod: 'official' as const,
  source: { id: 's1', name: 'src', type: 'official' as const, url: null },
  similarityDistance: null,
};

const ESTIMATE_DATA_L1: EstimateData = {
  query: 'big mac', chainSlug: 'mcdonalds-es',
  level1Hit: true, level2Hit: false, level3Hit: false, level4Hit: false,
  matchType: 'exact_dish', result: MOCK_RESULT, cachedAt: null, portionMultiplier: 1,
};

const ESTIMATE_DATA_MISS: EstimateData = {
  query: 'unknown', chainSlug: null,
  level1Hit: false, level2Hit: false, level3Hit: false, level4Hit: false,
  matchType: null, result: null, cachedAt: null, portionMultiplier: 1,
};

// Stub Redis
const mockRedis = {} as Redis;

// ---------------------------------------------------------------------------
// ApiClient mock factory
// ---------------------------------------------------------------------------

function makeApiClient(processMessageImpl: ApiClient['processMessage']): ApiClient {
  return {
    processMessage: processMessageImpl,
    // stubs for unused methods
    estimate: vi.fn(),
    searchDishes: vi.fn(),
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
  } as unknown as ApiClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleNaturalLanguage (F070 refactor)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetState.mockResolvedValue(null);
  });

  // -------------------------------------------------------------------------
  // estimation intent
  // -------------------------------------------------------------------------

  it('estimation intent → calls formatEstimate, returns string', async () => {
    const messageData: ConversationMessageData = {
      intent: 'estimation',
      actorId: ACTOR_UUID,
      estimation: ESTIMATE_DATA_L1,
      activeContext: null,
    };

    const apiClient = makeApiClient(vi.fn().mockResolvedValue(messageData));

    const result = await handleNaturalLanguage('big mac', CHAT_ID, mockRedis, apiClient);

    expect(typeof result).toBe('string');
    expect(result).toContain('Big Mac');
    expect(apiClient.processMessage).toHaveBeenCalledOnce();
    expect(apiClient.processMessage).toHaveBeenCalledWith('big mac', CHAT_ID, undefined);
  });

  it('estimation with null result → returns "no data" message', async () => {
    const messageData: ConversationMessageData = {
      intent: 'estimation',
      actorId: ACTOR_UUID,
      estimation: ESTIMATE_DATA_MISS,
      activeContext: null,
    };

    const apiClient = makeApiClient(vi.fn().mockResolvedValue(messageData));

    const result = await handleNaturalLanguage('unknown dish', CHAT_ID, mockRedis, apiClient);

    expect(typeof result).toBe('string');
    expect(result).toContain('No se encontraron');
  });

  // -------------------------------------------------------------------------
  // estimation with activeContext → appends context indicator
  // -------------------------------------------------------------------------

  it('estimation with activeContext and no explicit slug → appends context footer', async () => {
    const messageData: ConversationMessageData = {
      intent: 'estimation',
      actorId: ACTOR_UUID,
      estimation: ESTIMATE_DATA_L1,
      activeContext: { chainSlug: 'mcdonalds-es', chainName: "McDonald's" },
      usedContextFallback: true,
    };

    const apiClient = makeApiClient(vi.fn().mockResolvedValue(messageData));

    const result = await handleNaturalLanguage('big mac', CHAT_ID, mockRedis, apiClient);

    // Should include context indicator
    expect(result).toContain('Contexto activo');
  });

  // -------------------------------------------------------------------------
  // context_set resolved
  // -------------------------------------------------------------------------

  it('context_set resolved → calls formatContextConfirmation', async () => {
    const messageData: ConversationMessageData = {
      intent: 'context_set',
      actorId: ACTOR_UUID,
      contextSet: { chainSlug: 'mcdonalds-es', chainName: "McDonald's" },
      activeContext: { chainSlug: 'mcdonalds-es', chainName: "McDonald's" },
    };

    const apiClient = makeApiClient(vi.fn().mockResolvedValue(messageData));

    const result = await handleNaturalLanguage('estoy en mcdonalds', CHAT_ID, mockRedis, apiClient);

    expect(typeof result).toBe('string');
    // formatContextConfirmation output includes "Contexto establecido"
    expect(result).toContain('Contexto establecido');
  });

  // -------------------------------------------------------------------------
  // context_set ambiguous
  // -------------------------------------------------------------------------

  it('context_set ambiguous → returns ambiguity message', async () => {
    const messageData: ConversationMessageData = {
      intent: 'context_set',
      actorId: ACTOR_UUID,
      ambiguous: true,
      activeContext: null,
    };

    const apiClient = makeApiClient(vi.fn().mockResolvedValue(messageData));

    const result = await handleNaturalLanguage('estoy en burger', CHAT_ID, mockRedis, apiClient);

    expect(typeof result).toBe('string');
    expect(result).toContain('varias cadenas');
  });

  // -------------------------------------------------------------------------
  // comparison intent
  // -------------------------------------------------------------------------

  it('comparison intent → calls formatComparison, returns string', async () => {
    const messageData: ConversationMessageData = {
      intent: 'comparison',
      actorId: ACTOR_UUID,
      comparison: {
        dishA: ESTIMATE_DATA_L1,
        dishB: { ...ESTIMATE_DATA_L1, query: 'whopper' },
      },
      activeContext: null,
    };

    const apiClient = makeApiClient(vi.fn().mockResolvedValue(messageData));

    const result = await handleNaturalLanguage('compara big mac vs whopper', CHAT_ID, mockRedis, apiClient);

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // text_too_long intent
  // -------------------------------------------------------------------------

  it('text_too_long intent → returns TOO_LONG_MESSAGE constant', async () => {
    const messageData: ConversationMessageData = {
      intent: 'text_too_long',
      actorId: ACTOR_UUID,
      activeContext: null,
    };

    const apiClient = makeApiClient(vi.fn().mockResolvedValue(messageData));

    const result = await handleNaturalLanguage('a'.repeat(501), CHAT_ID, mockRedis, apiClient);

    expect(typeof result).toBe('string');
    // TOO_LONG_MESSAGE includes "específico" or "big mac"
    expect(result).toContain('big mac');
  });

  // -------------------------------------------------------------------------
  // Legacy chainContext passthrough
  // -------------------------------------------------------------------------

  it('legacy chainContext from bot:state passed to processMessage', async () => {
    mockGetState.mockResolvedValue({
      chainContext: { chainSlug: 'bk-es', chainName: 'Burger King' },
    });

    const messageData: ConversationMessageData = {
      intent: 'estimation',
      actorId: ACTOR_UUID,
      estimation: ESTIMATE_DATA_L1,
      activeContext: { chainSlug: 'bk-es', chainName: 'Burger King' },
    };

    const processMessageMock = vi.fn().mockResolvedValue(messageData);
    const apiClient = makeApiClient(processMessageMock);

    await handleNaturalLanguage('big mac', CHAT_ID, mockRedis, apiClient);

    expect(processMessageMock).toHaveBeenCalledWith(
      'big mac',
      CHAT_ID,
      { chainSlug: 'bk-es', chainName: 'Burger King' },
    );
  });

  it('no bot state → processMessage called with undefined chainContext', async () => {
    mockGetState.mockResolvedValue(null);

    const messageData: ConversationMessageData = {
      intent: 'estimation',
      actorId: ACTOR_UUID,
      estimation: ESTIMATE_DATA_L1,
      activeContext: null,
    };

    const processMessageMock = vi.fn().mockResolvedValue(messageData);
    const apiClient = makeApiClient(processMessageMock);

    await handleNaturalLanguage('big mac', CHAT_ID, mockRedis, apiClient);

    expect(processMessageMock).toHaveBeenCalledWith('big mac', CHAT_ID, undefined);
  });
});
