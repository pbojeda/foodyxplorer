// Unit tests for ConversationCore.processMessage() (F070, Step 7)
//
// Dependencies are injected directly — no vi.mock needed.
// All mocks are vi.fn() passed as ConversationRequest fields.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EstimateData, EstimateResult } from '@foodxplorer/shared';
import type { ConversationRequest } from '../conversation/types.js';

// ---------------------------------------------------------------------------
// Subject (imported BEFORE mocking — pure DI, no module-level side effects)
// ---------------------------------------------------------------------------

// We need to mock the module-level imports inside conversationCore.ts.
// The cleanest approach: mock the modules it imports.

const { mockGetContext, mockSetContext } = vi.hoisted(() => ({
  mockGetContext: vi.fn(),
  mockSetContext: vi.fn(),
}));

vi.mock('../conversation/contextManager.js', () => ({
  getContext: mockGetContext,
  setContext: mockSetContext,
}));

const { mockResolveChain } = vi.hoisted(() => ({
  mockResolveChain: vi.fn(),
}));

vi.mock('../conversation/chainResolver.js', () => ({
  resolveChain: mockResolveChain,
  loadChainData: vi.fn().mockResolvedValue([]),
}));

const { mockEstimate } = vi.hoisted(() => ({
  mockEstimate: vi.fn(),
}));

vi.mock('../conversation/estimationOrchestrator.js', () => ({
  estimate: mockEstimate,
}));

import { processMessage } from '../conversation/conversationCore.js';

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

const MOCK_RESULT: EstimateResult = {
  entityType: 'dish', entityId: 'fd000000-0070-4000-a000-000000000001',
  name: 'Big Mac', nameEs: 'Big Mac',
  restaurantId: 'fd000000-0070-4000-a000-000000000002',
  chainSlug: 'mcdonalds-es', portionGrams: 215,
  nutrients: BASE_NUTRIENTS, confidenceLevel: 'high',
  estimationMethod: 'official',
  source: { id: 'src-1', name: 'Source', type: 'official', url: 'https://example.com' },
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

const ACTOR_ID = 'fd000000-0070-4000-a000-000000000099';

// Minimal logger stub
const mockLogger = {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  child: vi.fn(), trace: vi.fn(), fatal: vi.fn(), level: 'info', silent: vi.fn(),
} as unknown as ConversationRequest['logger'];

// Minimal stubs for db and redis
const mockDb = {} as ConversationRequest['db'];
const mockRedis = {} as ConversationRequest['redis'];

// ---------------------------------------------------------------------------
// Helper: build a minimal ConversationRequest
// ---------------------------------------------------------------------------

function makeRequest(overrides: Partial<ConversationRequest> = {}): ConversationRequest {
  return {
    text: 'big mac',
    actorId: ACTOR_ID,
    db: mockDb,
    redis: mockRedis,
    chainSlugs: [],
    chains: [],
    logger: mockLogger,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConversationCore.processMessage()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetContext.mockResolvedValue(null);
    mockSetContext.mockResolvedValue(undefined);
    mockResolveChain.mockReturnValue(null);
    mockEstimate.mockResolvedValue(ESTIMATE_DATA_L1);
  });

  // -------------------------------------------------------------------------
  // Context loaded first — activeContext echoed in all responses
  // -------------------------------------------------------------------------

  it('context loaded first → activeContext echoed when set', async () => {
    mockGetContext.mockResolvedValueOnce({ chainSlug: 'mcdonalds-es', chainName: "McDonald's" });

    const result = await processMessage(makeRequest({ text: 'big mac' }));

    expect(mockGetContext).toHaveBeenCalledWith(ACTOR_ID, mockRedis);
    expect(result.activeContext).toEqual({ chainSlug: 'mcdonalds-es', chainName: "McDonald's" });
  });

  it('no context → activeContext is null', async () => {
    mockGetContext.mockResolvedValueOnce(null);

    const result = await processMessage(makeRequest({ text: 'big mac' }));

    expect(result.activeContext).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Length guard (Step 1)
  // -------------------------------------------------------------------------

  it('text > 500 chars → intent text_too_long, no estimation', async () => {
    const longText = 'a'.repeat(501);
    mockGetContext.mockResolvedValueOnce({ chainSlug: 'bk-es', chainName: 'Burger King' });

    const result = await processMessage(makeRequest({ text: longText }));

    expect(result.intent).toBe('text_too_long');
    expect(result.actorId).toBe(ACTOR_ID);
    expect(result.activeContext).toEqual({ chainSlug: 'bk-es', chainName: 'Burger King' });
    expect(mockEstimate).not.toHaveBeenCalled();
    expect(mockResolveChain).not.toHaveBeenCalled();
  });

  it('text exactly 500 chars → NOT too long (passes to estimation)', async () => {
    const exactly500 = 'a'.repeat(500);

    const result = await processMessage(makeRequest({ text: exactly500 }));

    expect(result.intent).not.toBe('text_too_long');
  });

  // -------------------------------------------------------------------------
  // Context-set detection (Step 2)
  // -------------------------------------------------------------------------

  it('context_set resolved → setContext called, returns context_set intent', async () => {
    mockResolveChain.mockReturnValueOnce({ chainSlug: 'mcdonalds-es', chainName: "McDonald's" });

    const result = await processMessage(makeRequest({ text: 'estoy en mcdonalds' }));

    expect(result.intent).toBe('context_set');
    expect(result.contextSet).toEqual({ chainSlug: 'mcdonalds-es', chainName: "McDonald's" });
    expect(mockSetContext).toHaveBeenCalledWith(
      ACTOR_ID,
      { chainSlug: 'mcdonalds-es', chainName: "McDonald's" },
      mockRedis,
    );
    expect(result.activeContext).toEqual({ chainSlug: 'mcdonalds-es', chainName: "McDonald's" });
    expect(mockEstimate).not.toHaveBeenCalled();
  });

  it('context_set ambiguous → returns context_set + ambiguous:true, no setContext', async () => {
    mockResolveChain.mockReturnValueOnce('ambiguous');
    mockGetContext.mockResolvedValueOnce({ chainSlug: 'old-chain', chainName: 'Old Chain' });

    const result = await processMessage(makeRequest({ text: 'estoy en burger' }));

    expect(result.intent).toBe('context_set');
    expect(result.ambiguous).toBe(true);
    expect(result.contextSet).toBeUndefined();
    expect(mockSetContext).not.toHaveBeenCalled();
    // Previous context preserved
    expect(result.activeContext).toEqual({ chainSlug: 'old-chain', chainName: 'Old Chain' });
  });

  it('context_set detection → null chain (not found) → falls through to estimation', async () => {
    mockResolveChain.mockReturnValueOnce(null);
    mockEstimate.mockResolvedValueOnce(ESTIMATE_DATA_L1);

    const result = await processMessage(makeRequest({ text: 'estoy en mcdonalds' }));

    // detectContextSet matches "estoy en mcdonalds", resolveChain returns null → fall through
    expect(result.intent).toBe('estimation');
    expect(mockEstimate).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Comparison detection (Step 3)
  // -------------------------------------------------------------------------

  it('comparison → calls estimate twice via Promise.allSettled, returns comparison intent', async () => {
    const dishBData = { ...ESTIMATE_DATA_L1, query: 'whopper' };
    mockEstimate
      .mockResolvedValueOnce(ESTIMATE_DATA_L1)
      .mockResolvedValueOnce(dishBData);

    const result = await processMessage(makeRequest({
      text: 'compara big mac vs whopper',
    }));

    expect(result.intent).toBe('comparison');
    expect(result.comparison).toBeDefined();
    expect(result.comparison!.dishA).toBeDefined();
    expect(result.comparison!.dishB).toBeDefined();
    expect(mockEstimate).toHaveBeenCalledTimes(2);
  });

  it('comparison → one side error → that side result:null, HTTP 200', async () => {
    mockEstimate
      .mockResolvedValueOnce(ESTIMATE_DATA_L1)
      .mockRejectedValueOnce(new Error('cascade failed'));

    const result = await processMessage(makeRequest({
      text: 'compara big mac vs whopper',
    }));

    expect(result.intent).toBe('comparison');
    expect(result.comparison!.dishA.result).not.toBeNull();
    expect(result.comparison!.dishB.result).toBeNull();
  });

  it('comparison → both sides DB error → throws', async () => {
    const dbError = Object.assign(new Error('DB down'), { code: 'DB_UNAVAILABLE' });
    mockEstimate
      .mockRejectedValueOnce(dbError)
      .mockRejectedValueOnce(dbError);

    await expect(
      processMessage(makeRequest({ text: 'compara big mac vs whopper' })),
    ).rejects.toThrow();
  });

  it('comparison → both sides cascade miss (result:null) → HTTP 200 with both null', async () => {
    mockEstimate
      .mockResolvedValueOnce(ESTIMATE_DATA_MISS)
      .mockResolvedValueOnce(ESTIMATE_DATA_MISS);

    const result = await processMessage(makeRequest({
      text: 'compara unknown1 vs unknown2',
    }));

    expect(result.intent).toBe('comparison');
    expect(result.comparison!.dishA.result).toBeNull();
    expect(result.comparison!.dishB.result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Single-dish estimation (Step 4)
  // -------------------------------------------------------------------------

  it('single estimation → returns estimation intent with EstimateData', async () => {
    mockEstimate.mockResolvedValueOnce(ESTIMATE_DATA_L1);

    const result = await processMessage(makeRequest({ text: 'big mac' }));

    expect(result.intent).toBe('estimation');
    expect(result.estimation).toEqual(ESTIMATE_DATA_L1);
    expect(result.actorId).toBe(ACTOR_ID);
  });

  it('single estimation → fallback chainSlug injected from activeContext when no explicit slug', async () => {
    mockGetContext.mockResolvedValueOnce({ chainSlug: 'mcdonalds-es', chainName: "McDonald's" });
    mockEstimate.mockResolvedValueOnce(ESTIMATE_DATA_L1);

    await processMessage(makeRequest({ text: 'big mac' }));

    const callArgs = mockEstimate.mock.calls[0][0] as { chainSlug?: string };
    expect(callArgs.chainSlug).toBe('mcdonalds-es');
  });

  it('single estimation → no fallback injection when query has explicit chainSlug', async () => {
    mockGetContext.mockResolvedValueOnce({ chainSlug: 'mcdonalds-es', chainName: "McDonald's" });
    mockEstimate.mockResolvedValueOnce(ESTIMATE_DATA_L1);

    // "cuántas calorías tiene big mac en burger-king-es" — explicit slug in query
    await processMessage(makeRequest({ text: 'big mac en burger-king-es' }));

    const callArgs = mockEstimate.mock.calls[0][0] as { chainSlug?: string };
    // Explicit slug from query should be used, NOT the context slug
    expect(callArgs.chainSlug).toBe('burger-king-es');
  });

  // -------------------------------------------------------------------------
  // Legacy context fallback (legacyChainSlug / legacyChainName)
  // -------------------------------------------------------------------------

  it('legacy chainSlug used when conv:ctx is empty', async () => {
    mockGetContext.mockResolvedValueOnce(null);
    mockEstimate.mockResolvedValueOnce(ESTIMATE_DATA_L1);

    await processMessage(makeRequest({
      text: 'big mac',
      legacyChainSlug: 'mcdonalds-es',
      legacyChainName: "McDonald's",
    }));

    const callArgs = mockEstimate.mock.calls[0][0] as { chainSlug?: string };
    expect(callArgs.chainSlug).toBe('mcdonalds-es');
  });

  it('conv:ctx takes priority over legacy chainSlug', async () => {
    mockGetContext.mockResolvedValueOnce({ chainSlug: 'bk-es', chainName: 'Burger King' });
    mockEstimate.mockResolvedValueOnce(ESTIMATE_DATA_L1);

    await processMessage(makeRequest({
      text: 'big mac',
      legacyChainSlug: 'mcdonalds-es',
      legacyChainName: "McDonald's",
    }));

    const callArgs = mockEstimate.mock.calls[0][0] as { chainSlug?: string };
    expect(callArgs.chainSlug).toBe('bk-es');
  });

  // -------------------------------------------------------------------------
  // Redis fail-open (context errors)
  // -------------------------------------------------------------------------

  it('Redis error on getContext → activeContext null, request continues', async () => {
    mockGetContext.mockRejectedValueOnce(new Error('Redis down'));
    mockEstimate.mockResolvedValueOnce(ESTIMATE_DATA_L1);

    const result = await processMessage(makeRequest({ text: 'big mac' }));

    expect(result.activeContext).toBeNull();
    expect(result.intent).toBe('estimation');
  });
});
