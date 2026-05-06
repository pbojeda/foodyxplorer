// F-MULTITURN-001 Step 6 — Bot naturalLanguage handler tests for new intents
//
// Tests the two new cases in handleNaturalLanguage switch:
//   case 'follow_up_attribute'
//   case 'follow_up_refinement'
// AC-22: neither case reaches the default (_exhaustive: never) branch.

import { describe, it, expect, vi } from 'vitest';
import type { Redis } from 'ioredis';
import type { ApiClient } from '../apiClient.js';
import type { ConversationMessageData } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Mock conversationState (getState)
// ---------------------------------------------------------------------------

vi.mock('../lib/conversationState.js', () => ({
  getState: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Mock formatEstimate (used for follow_up_refinement)
// ---------------------------------------------------------------------------

const { mockFormatEstimate } = vi.hoisted(() => ({
  mockFormatEstimate: vi.fn().mockReturnValue('*Paella de pollo* — 420 kcal'),
}));

vi.mock('../formatters/estimateFormatter.js', () => ({
  formatEstimate: mockFormatEstimate,
}));

import { handleNaturalLanguage } from '../handlers/naturalLanguage.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_NUTRIENTS = {
  calories: 550, proteins: 25, carbohydrates: 45, sugars: 9,
  fats: 26, saturatedFats: 10, fiber: 2, salt: 2.2, sodium: 880,
  transFats: 0.2, cholesterol: 80, potassium: 320,
  monounsaturatedFats: 12, polyunsaturatedFats: 4, alcohol: 0,
  referenceBasis: 'per_serving' as const,
};

const MOCK_RESULT = {
  entityType: 'dish' as const,
  entityId: 'fd000000-0070-4000-a000-000000000001',
  name: 'Paella Valenciana', nameEs: 'Paella valenciana',
  restaurantId: null, chainSlug: null, portionGrams: 350,
  nutrients: BASE_NUTRIENTS, confidenceLevel: 'high' as const,
  estimationMethod: 'official' as const,
  source: { id: 'fd000000-0070-4000-a000-000000000099', name: 'Source', type: 'official' as const, url: 'https://example.com' },
  similarityDistance: null,
};

const MOCK_ESTIMATE_DATA = {
  query: 'paella valenciana de pollo',
  chainSlug: null,
  portionMultiplier: 1,
  level1Hit: true, level2Hit: false, level3Hit: false, level4Hit: false,
  matchType: 'exact_dish' as const,
  result: MOCK_RESULT,
  cachedAt: null,
};

const ACTOR_UUID = 'fd000000-0070-4000-a000-000000000099';

// Build a mock processMessage response for follow_up_attribute
function buildAttributeResponse(): ConversationMessageData {
  return {
    intent: 'follow_up_attribute',
    actorId: ACTOR_UUID,
    activeContext: null,
    followUpAttribute: {
      nutrientKey: 'carbohydrates',
      nutrientLabel: 'Carbohidratos',
      value: 45,
      unit: 'g',
      dishName: 'Paella valenciana',
      priorTurnQuery: 'paella valenciana', // Plan-R5 fix: required field
      priorEstimation: MOCK_ESTIMATE_DATA,
    },
    followUpMeta: { classifierType: 'attribute', confidence: 0.95, turnStateHit: true },
  };
}

// Build a mock processMessage response for follow_up_refinement
function buildRefinementResponse(): ConversationMessageData {
  return {
    intent: 'follow_up_refinement',
    actorId: ACTOR_UUID,
    activeContext: null,
    followUpRefinement: {
      originalQuery: 'paella valenciana', // Plan-R6 fix: required field
      mergedQuery: 'paella valenciana de pollo',
      estimation: MOCK_ESTIMATE_DATA,
    },
    followUpMeta: { classifierType: 'refinement', confidence: 0.85, turnStateHit: true },
  };
}

// Build a minimal mock ApiClient
function buildMockApiClient(response: ConversationMessageData): ApiClient {
  return {
    processMessage: vi.fn().mockResolvedValue(response),
    sendAudio: vi.fn(),
    getMenuImage: vi.fn(),
    processMenuImage: vi.fn(),
  } as unknown as ApiClient;
}

const mockRedis = {} as Redis;
const CHAT_ID = 123456789;

// ---------------------------------------------------------------------------
// Tests — follow_up_attribute
// ---------------------------------------------------------------------------

describe('handleNaturalLanguage — follow_up_attribute (F-MULTITURN-001)', () => {
  it('returns formatted string with dish name, nutrient label, value, and unit', async () => {
    const apiClient = buildMockApiClient(buildAttributeResponse());

    const result = await handleNaturalLanguage('y los carbs?', CHAT_ID, mockRedis, apiClient);

    expect(result).toContain('Paella valenciana');
    expect(result).toContain('Carbohidratos');
    expect(result).toContain('45');
    expect(result).toContain('g');
  });

  it('does NOT reach the default exhaustive branch', async () => {
    const apiClient = buildMockApiClient(buildAttributeResponse());

    const result = await handleNaturalLanguage('y los carbs?', CHAT_ID, mockRedis, apiClient);

    // If default branch was hit, result would start with "Intent desconocido"
    expect(result).not.toContain('Intent desconocido');
  });

  it('handles missing followUpAttribute gracefully (returns fallback message)', async () => {
    const apiClient = buildMockApiClient({
      intent: 'follow_up_attribute',
      actorId: ACTOR_UUID,
      activeContext: null,
      // followUpAttribute intentionally absent
    });

    const result = await handleNaturalLanguage('y los carbs?', CHAT_ID, mockRedis, apiClient);

    expect(result).toContain('No se encontraron');
  });
});

// ---------------------------------------------------------------------------
// Tests — follow_up_refinement
// ---------------------------------------------------------------------------

describe('handleNaturalLanguage — follow_up_refinement (F-MULTITURN-001)', () => {
  it('returns string starting with refinement prefix line', async () => {
    const apiClient = buildMockApiClient(buildRefinementResponse());

    const result = await handleNaturalLanguage('hazlo de pollo', CHAT_ID, mockRedis, apiClient);

    expect(result).toContain('refinado');
    expect(result).toContain('paella valenciana de pollo');
  });

  it('calls formatEstimate with followUpRefinement.estimation', async () => {
    vi.clearAllMocks();
    mockFormatEstimate.mockReturnValue('*Paella de pollo* — 420 kcal');

    const apiClient = buildMockApiClient(buildRefinementResponse());

    await handleNaturalLanguage('hazlo de pollo', CHAT_ID, mockRedis, apiClient);

    expect(mockFormatEstimate).toHaveBeenCalledWith(MOCK_ESTIMATE_DATA);
  });

  it('does NOT reach the default exhaustive branch', async () => {
    const apiClient = buildMockApiClient(buildRefinementResponse());

    const result = await handleNaturalLanguage('hazlo de pollo', CHAT_ID, mockRedis, apiClient);

    expect(result).not.toContain('Intent desconocido');
  });

  it('handles missing followUpRefinement gracefully', async () => {
    const apiClient = buildMockApiClient({
      intent: 'follow_up_refinement',
      actorId: ACTOR_UUID,
      activeContext: null,
      // followUpRefinement intentionally absent
    });

    const result = await handleNaturalLanguage('hazlo de pollo', CHAT_ID, mockRedis, apiClient);

    expect(result).toContain('No se encontraron');
  });
});

// ---------------------------------------------------------------------------
// AC-22: Exhaustive switch — TypeScript confirms all intents handled
// ---------------------------------------------------------------------------

describe('AC-22: exhaustive switch — new intents do not reach default', () => {
  it('follow_up_attribute is handled before default branch', async () => {
    const apiClient = buildMockApiClient(buildAttributeResponse());
    const result = await handleNaturalLanguage('y los carbs?', CHAT_ID, mockRedis, apiClient);
    // TypeScript would have caught this at compile time if the case was missing
    expect(result).not.toMatch(/Intent desconocido/);
  });

  it('follow_up_refinement is handled before default branch', async () => {
    const apiClient = buildMockApiClient(buildRefinementResponse());
    const result = await handleNaturalLanguage('hazlo de pollo', CHAT_ID, mockRedis, apiClient);
    expect(result).not.toMatch(/Intent desconocido/);
  });
});
