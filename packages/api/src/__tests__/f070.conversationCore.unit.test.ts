// Unit tests for ConversationCore.processMessage() (F070, Step 7)
//
// Dependencies are injected directly — no vi.mock needed.
// All mocks are vi.fn() passed as ConversationRequest fields.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EstimateData, EstimateResult, ConversationTurnState } from '@foodxplorer/shared';
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

// F-MULTITURN-001 mocks
const { mockGetTurnState, mockSetTurnState } = vi.hoisted(() => ({
  mockGetTurnState: vi.fn(),
  mockSetTurnState: vi.fn(),
}));

vi.mock('../conversation/turnStateManager.js', () => ({
  getTurnState: mockGetTurnState,
  setTurnState: mockSetTurnState,
  TURN_STATE_TTL_SECONDS: 1800,
}));

const {
  mockDetectAttributeFollowUp,
  mockDetectRefinementFollowUp,
  mockApplyRefinement,
} = vi.hoisted(() => ({
  mockDetectAttributeFollowUp: vi.fn(),
  mockDetectRefinementFollowUp: vi.fn(),
  mockApplyRefinement: vi.fn(),
}));

vi.mock('../conversation/followUpClassifier.js', () => ({
  detectAttributeFollowUp: mockDetectAttributeFollowUp,
  detectRefinementFollowUp: mockDetectRefinementFollowUp,
  applyRefinement: mockApplyRefinement,
  ATTRIBUTE_CONFIDENCE_THRESHOLD: 0.75,
  REFINEMENT_CONFIDENCE_THRESHOLD: 0.70,
  // NUTRIENT_META_BY_KEY: keyed by canonical NutrientKey for O(1) lookup at the
  // call site in conversationCore (code-review MAJOR-1 fix replaced the dead-code
  // NUTRIENT_ALIASES lookup, so the mock must expose this map instead).
  NUTRIENT_META_BY_KEY: {
    carbohydrates: { nutrientKey: 'carbohydrates', label: 'Carbohidratos', unit: 'g' },
    proteins:      { nutrientKey: 'proteins',      label: 'Proteínas',     unit: 'g' },
    salt:          { nutrientKey: 'salt',          label: 'Sal',           unit: 'g' },
    calories:      { nutrientKey: 'calories',      label: 'Calorías',      unit: 'kcal' },
    fats:          { nutrientKey: 'fats',          label: 'Grasas',        unit: 'g' },
    fiber:         { nutrientKey: 'fiber',         label: 'Fibra',         unit: 'g' },
    sodium:        { nutrientKey: 'sodium',        label: 'Sodio',         unit: 'mg' },
    sugars:        { nutrientKey: 'sugars',        label: 'Azúcares',      unit: 'g' },
  },
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
    // F-MULTITURN-001: default to no turn state so existing tests are unaffected (AC-13)
    mockGetTurnState.mockResolvedValue(null);
    mockDetectAttributeFollowUp.mockReturnValue(null);
    mockDetectRefinementFollowUp.mockReturnValue(null);
    mockApplyRefinement.mockReturnValue({ mergedQuery: 'merged' });
    mockSetTurnState.mockResolvedValue(undefined);
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

// ---------------------------------------------------------------------------
// F-MULTITURN-001 — Step 1.5: Follow-Up Classification tests
// ---------------------------------------------------------------------------

// Shared fixtures for turn state tests
const PREV_TURN_NUTRIENTS = {
  calories: 450, proteins: 20, carbohydrates: 65, sugars: 4,
  fats: 12, saturatedFats: 2, fiber: 3, salt: 1.5, sodium: 600,
  transFats: 0, cholesterol: 80, potassium: 400,
  monounsaturatedFats: 6, polyunsaturatedFats: 3, alcohol: 0,
  referenceBasis: 'per_serving' as const,
};

const PREV_TURN_RESULT: EstimateResult = {
  entityType: 'dish',
  entityId: 'fd000000-0070-4000-a000-000000000011',
  name: 'Paella Valenciana',
  nameEs: 'Paella valenciana',
  restaurantId: null,
  chainSlug: null,
  portionGrams: 350,
  nutrients: PREV_TURN_NUTRIENTS,
  confidenceLevel: 'high',
  estimationMethod: 'official',
  source: { id: 'fd000000-0070-4000-a000-000000000099', name: 'Source', type: 'official', url: 'https://example.com' },
  similarityDistance: null,
};

const PREV_TURN_ESTIMATE: EstimateData = {
  query: 'paella valenciana',
  chainSlug: null,
  portionMultiplier: 1,
  level1Hit: true,
  level2Hit: false,
  level3Hit: false,
  level4Hit: false,
  matchType: 'exact_dish',
  result: PREV_TURN_RESULT,
  cachedAt: null,
};

const VALID_PREV_TURN: ConversationTurnState = {
  query: 'paella valenciana',
  chainSlug: null,
  estimation: PREV_TURN_ESTIMATE,
  portionMultiplier: 1,
  storedAt: Date.now() - 60_000,
};

describe('ConversationCore.processMessage() — F-MULTITURN-001 Step 1.5', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetContext.mockResolvedValue(null);
    mockSetContext.mockResolvedValue(undefined);
    mockResolveChain.mockReturnValue(null);
    mockEstimate.mockResolvedValue(ESTIMATE_DATA_L1);
    // Default: no turn state, no follow-up detected
    mockGetTurnState.mockResolvedValue(null);
    mockDetectAttributeFollowUp.mockReturnValue(null);
    mockDetectRefinementFollowUp.mockReturnValue(null);
    mockApplyRefinement.mockReturnValue({ mergedQuery: 'merged query' });
    mockSetTurnState.mockResolvedValue(undefined);
  });

  // -------------------------------------------------------------------------
  // AC-09: No turn state → skip follow-up classification
  // -------------------------------------------------------------------------

  it('AC-09: prevTurn = null → getTurnState called, classifiers NOT called, falls through to estimation', async () => {
    mockGetTurnState.mockResolvedValue(null);

    const result = await processMessage(makeRequest({ text: 'big mac' }));

    expect(mockGetTurnState).toHaveBeenCalledOnce();
    expect(mockDetectAttributeFollowUp).not.toHaveBeenCalled();
    expect(result.intent).toBe('estimation');
  });

  // -------------------------------------------------------------------------
  // AC-04: Attribute follow-up hit + AC-25 priorTurnQuery assertion
  // -------------------------------------------------------------------------

  it('AC-04 P1: attribute hit returns follow_up_attribute with correct data', async () => {
    mockGetTurnState.mockResolvedValue(VALID_PREV_TURN);
    mockDetectAttributeFollowUp.mockReturnValue({ nutrientKey: 'carbohydrates', confidence: 0.95 });
    mockDetectRefinementFollowUp.mockReturnValue(null);

    const result = await processMessage(makeRequest({ text: 'y los carbs?' }));

    expect(result.intent).toBe('follow_up_attribute');
    expect(result.followUpAttribute).toBeDefined();
    expect(result.followUpAttribute!['nutrientKey']).toBe('carbohydrates');
  });

  it('AC-25 P1: priorTurnQuery equals prevTurn.query (P1 standalone turn)', async () => {
    // P1: prevTurn.query === prevTurn.estimation.query (normal standalone case)
    mockGetTurnState.mockResolvedValue(VALID_PREV_TURN);
    mockDetectAttributeFollowUp.mockReturnValue({ nutrientKey: 'carbohydrates', confidence: 0.95 });

    const result = await processMessage(makeRequest({ text: 'y los carbs?' }));

    expect(result.followUpAttribute!['priorTurnQuery']).toBe('paella valenciana');
    // Confirm it equals prevTurn.query, NOT estimated.query
    expect(result.followUpAttribute!['priorTurnQuery']).toBe(VALID_PREV_TURN.query);
  });

  it('AC-25 P2: priorTurnQuery equals prevTurn.query even when prevTurn.query !== prevTurn.estimation.query (P2 refinement turn)', async () => {
    // P2: refinement was written — parseDishExpression normalised the query
    // prevTurn.query = 'paella valenciana de pollo' (what user typed as merged)
    // prevTurn.estimation.query = 'paella de pollo' (after parseDishExpression normalisation)
    const p2TurnState: ConversationTurnState = {
      query: 'paella valenciana de pollo',          // what we wrote to turn state
      chainSlug: null,
      estimation: {
        ...PREV_TURN_ESTIMATE,
        query: 'paella de pollo',                   // normalised by parseDishExpression
      },
      portionMultiplier: 1,
      storedAt: Date.now() - 30_000,
    };

    mockGetTurnState.mockResolvedValue(p2TurnState);
    mockDetectAttributeFollowUp.mockReturnValue({ nutrientKey: 'carbohydrates', confidence: 0.95 });

    const result = await processMessage(makeRequest({ text: 'y los carbs?' }));

    // Must come from prevTurn.query, NOT prevTurn.estimation.query
    expect(result.followUpAttribute!['priorTurnQuery']).toBe('paella valenciana de pollo');
    expect(result.followUpAttribute!['priorTurnQuery']).not.toBe('paella de pollo');
  });

  // -------------------------------------------------------------------------
  // AC-05: dishName population
  // -------------------------------------------------------------------------

  it('AC-05: dishName uses nameEs when available', async () => {
    mockGetTurnState.mockResolvedValue(VALID_PREV_TURN);
    mockDetectAttributeFollowUp.mockReturnValue({ nutrientKey: 'carbohydrates', confidence: 0.95 });

    const result = await processMessage(makeRequest({ text: 'y los carbs?' }));

    // PREV_TURN_RESULT.nameEs = 'Paella valenciana'
    expect(result.followUpAttribute!['dishName']).toBe('Paella valenciana');
  });

  it('AC-05: dishName falls back to name when nameEs is null', async () => {
    const prevTurnNoNameEs: ConversationTurnState = {
      ...VALID_PREV_TURN,
      estimation: {
        ...PREV_TURN_ESTIMATE,
        result: {
          ...PREV_TURN_RESULT,
          nameEs: null,
          name: 'Paella Valenciana',
        },
      },
    };
    mockGetTurnState.mockResolvedValue(prevTurnNoNameEs);
    mockDetectAttributeFollowUp.mockReturnValue({ nutrientKey: 'carbohydrates', confidence: 0.95 });

    const result = await processMessage(makeRequest({ text: 'y los carbs?' }));

    expect(result.followUpAttribute!['dishName']).toBe('Paella Valenciana');
  });

  // -------------------------------------------------------------------------
  // AC-06: priorEstimation equals full stored EstimateData
  // -------------------------------------------------------------------------

  it('AC-06: priorEstimation equals the full stored estimation', async () => {
    mockGetTurnState.mockResolvedValue(VALID_PREV_TURN);
    mockDetectAttributeFollowUp.mockReturnValue({ nutrientKey: 'carbohydrates', confidence: 0.95 });

    const result = await processMessage(makeRequest({ text: 'y los carbs?' }));

    expect(result.followUpAttribute!['priorEstimation']).toEqual(PREV_TURN_ESTIMATE);
  });

  // -------------------------------------------------------------------------
  // AC-10: Prior estimation result is null → attribute follow-up falls through
  // -------------------------------------------------------------------------

  it('AC-10: prevTurn.estimation.result = null → attribute fires but falls through to standalone', async () => {
    const nullResultTurn: ConversationTurnState = {
      ...VALID_PREV_TURN,
      estimation: { ...PREV_TURN_ESTIMATE, result: null },
    };
    mockGetTurnState.mockResolvedValue(nullResultTurn);
    mockDetectAttributeFollowUp.mockReturnValue({ nutrientKey: 'carbohydrates', confidence: 0.95 });
    mockDetectRefinementFollowUp.mockReturnValue(null);

    const result = await processMessage(makeRequest({ text: 'y los carbs?' }));

    expect(result.intent).not.toBe('follow_up_attribute');
  });

  // -------------------------------------------------------------------------
  // AC-07: Refinement hit
  // -------------------------------------------------------------------------

  it('AC-07: refinement hit returns follow_up_refinement with originalQuery, mergedQuery, estimation', async () => {
    mockGetTurnState.mockResolvedValue(VALID_PREV_TURN);
    mockDetectAttributeFollowUp.mockReturnValue(null);
    mockDetectRefinementFollowUp.mockReturnValue({ modificationText: 'de pollo', confidence: 0.85 });
    mockApplyRefinement.mockReturnValue({ mergedQuery: 'paella valenciana de pollo' });
    mockEstimate.mockResolvedValue(ESTIMATE_DATA_L1);

    const result = await processMessage(makeRequest({ text: 'hazlo de pollo' }));

    expect(result.intent).toBe('follow_up_refinement');
    expect(result.followUpRefinement).toBeDefined();
    expect(result.followUpRefinement!['originalQuery']).toBe('paella valenciana');
    expect(result.followUpRefinement!['mergedQuery']).toBe('paella valenciana de pollo');
    expect(result.followUpRefinement!['estimation']).toBeDefined();
  });

  it('AC-07 portion-override: portionMultiplierOverride passed to estimate()', async () => {
    mockGetTurnState.mockResolvedValue(VALID_PREV_TURN);
    mockDetectAttributeFollowUp.mockReturnValue(null);
    mockDetectRefinementFollowUp.mockReturnValue({ modificationText: 'menos cantidad', confidence: 0.90 });
    mockApplyRefinement.mockReturnValue({ mergedQuery: 'paella valenciana', portionMultiplierOverride: 0.5 });

    await processMessage(makeRequest({ text: 'menos cantidad' }));

    // estimate() should have been called with portionMultiplier: 0.5
    expect(mockEstimate).toHaveBeenCalledWith(
      expect.objectContaining({ portionMultiplier: 0.5 }),
    );
  });

  // -------------------------------------------------------------------------
  // AC-11: Turn-state write-back P1 and P2
  // -------------------------------------------------------------------------

  it('AC-11 P1: standalone estimation with non-null result → setTurnState called once', async () => {
    mockGetTurnState.mockResolvedValue(null);
    mockEstimate.mockResolvedValue(ESTIMATE_DATA_L1);

    await processMessage(makeRequest({ text: 'big mac' }));

    // Wait for the fire-and-forget to settle
    await vi.waitFor(() => {
      expect(mockSetTurnState).toHaveBeenCalledOnce();
    });
  });

  it('AC-11 P1: standalone estimation with null result → setTurnState NOT called', async () => {
    mockGetTurnState.mockResolvedValue(null);
    mockEstimate.mockResolvedValue(ESTIMATE_DATA_MISS);

    await processMessage(makeRequest({ text: 'unknown dish xyz' }));

    // Give a tick for any fire-and-forget
    await new Promise((r) => setTimeout(r, 10));
    expect(mockSetTurnState).not.toHaveBeenCalled();
  });

  it('AC-11 P2: refinement path → setTurnState called regardless of result nullness', async () => {
    mockGetTurnState.mockResolvedValue(VALID_PREV_TURN);
    mockDetectAttributeFollowUp.mockReturnValue(null);
    mockDetectRefinementFollowUp.mockReturnValue({ modificationText: 'de pollo', confidence: 0.85 });
    mockApplyRefinement.mockReturnValue({ mergedQuery: 'paella valenciana de pollo' });
    mockEstimate.mockResolvedValue(ESTIMATE_DATA_MISS); // null result

    await processMessage(makeRequest({ text: 'hazlo de pollo' }));

    await vi.waitFor(() => {
      expect(mockSetTurnState).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // AC-12: setTurnState NOT called for non-P1/P2 intents
  // -------------------------------------------------------------------------

  it('AC-12: context_set intent → setTurnState NOT called', async () => {
    mockGetTurnState.mockResolvedValue(null);
    mockResolveChain.mockReturnValue({ chainSlug: 'mcdonalds-es', chainName: "McDonald's" });

    await processMessage(makeRequest({ text: 'estoy en mcdonalds' }));

    await new Promise((r) => setTimeout(r, 10));
    expect(mockSetTurnState).not.toHaveBeenCalled();
  });

  it('AC-12: follow_up_attribute intent → setTurnState NOT called', async () => {
    mockGetTurnState.mockResolvedValue(VALID_PREV_TURN);
    mockDetectAttributeFollowUp.mockReturnValue({ nutrientKey: 'carbohydrates', confidence: 0.95 });
    mockDetectRefinementFollowUp.mockReturnValue(null);

    await processMessage(makeRequest({ text: 'y los carbs?' }));

    await new Promise((r) => setTimeout(r, 10));
    expect(mockSetTurnState).not.toHaveBeenCalled();
  });

  it('AC-12: text_too_long intent → setTurnState NOT called', async () => {
    await processMessage(makeRequest({ text: 'a'.repeat(501) }));

    await new Promise((r) => setTimeout(r, 10));
    expect(mockSetTurnState).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // AC-13: Regression — existing tests pass unchanged (prevTurn null → no change)
  // -------------------------------------------------------------------------

  it('AC-13: regression — no prevTurn → estimation path unchanged', async () => {
    mockGetTurnState.mockResolvedValue(null);
    mockEstimate.mockResolvedValue(ESTIMATE_DATA_L1);

    const result = await processMessage(makeRequest({ text: 'big mac' }));

    expect(result.intent).toBe('estimation');
    expect(result.estimation).toEqual(ESTIMATE_DATA_L1);
    // getTurnState called but classifiers are not (prevTurn is null)
    expect(mockDetectAttributeFollowUp).not.toHaveBeenCalled();
    expect(mockDetectRefinementFollowUp).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // AC-17: Observability — structured log events
  // -------------------------------------------------------------------------

  it('AC-17: attribute hit → logger.info called with tag F-MULTITURN-001', async () => {
    mockGetTurnState.mockResolvedValue(VALID_PREV_TURN);
    mockDetectAttributeFollowUp.mockReturnValue({ nutrientKey: 'carbohydrates', confidence: 0.95 });

    await processMessage(makeRequest({ text: 'y los carbs?' }));

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'F-MULTITURN-001', classifierType: 'attribute' }),
      expect.any(String),
    );
  });

  it('AC-17: no turn state → logger.debug called with reason: no_turn_state', async () => {
    mockGetTurnState.mockResolvedValue(null);

    await processMessage(makeRequest({ text: 'y los carbs?' }));

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'F-MULTITURN-001:miss', reason: 'no_turn_state' }),
      expect.any(String),
    );
  });

  it('AC-17: low-confidence attribute → logger.debug with reason: low_confidence', async () => {
    mockGetTurnState.mockResolvedValue(VALID_PREV_TURN);
    mockDetectAttributeFollowUp.mockReturnValue({ nutrientKey: 'carbohydrates', confidence: 0.50 }); // below threshold
    mockDetectRefinementFollowUp.mockReturnValue(null);

    await processMessage(makeRequest({ text: 'algo raro' }));

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'F-MULTITURN-001:miss', reason: 'low_confidence' }),
      expect.any(String),
    );
  });

  // -------------------------------------------------------------------------
  // followUpMeta presence on follow-up responses (observability — AC-17 sibling)
  // -------------------------------------------------------------------------

  it('follow_up_attribute response includes followUpMeta with classifier metadata', async () => {
    mockGetTurnState.mockResolvedValue(VALID_PREV_TURN);
    mockDetectAttributeFollowUp.mockReturnValue({ nutrientKey: 'carbohydrates', confidence: 0.95 });

    const result = await processMessage(makeRequest({ text: 'y los carbs?' }));

    expect(result.followUpMeta).toBeDefined();
    expect(result.followUpMeta!['classifierType']).toBe('attribute');
    expect(result.followUpMeta!['confidence']).toBe(0.95);
    expect(result.followUpMeta!['turnStateHit']).toBe(true);
  });

  it('follow_up_refinement response includes followUpMeta with classifier metadata', async () => {
    mockGetTurnState.mockResolvedValue(VALID_PREV_TURN);
    mockDetectAttributeFollowUp.mockReturnValue(null);
    mockDetectRefinementFollowUp.mockReturnValue({ modificationText: 'de pollo', confidence: 0.85 });
    mockApplyRefinement.mockReturnValue({ mergedQuery: 'paella valenciana de pollo' });

    const result = await processMessage(makeRequest({ text: 'hazlo de pollo' }));

    expect(result.followUpMeta).toBeDefined();
    expect(result.followUpMeta!['classifierType']).toBe('refinement');
    expect(result.followUpMeta!['confidence']).toBe(0.85);
    expect(result.followUpMeta!['turnStateHit']).toBe(true);
  });

  // -------------------------------------------------------------------------
  // AC-26: refinement preserves prior turn's chainSlug — does NOT fall through
  // to active conv:ctx context. Plan-R4 fix Codex IMP#2.
  // -------------------------------------------------------------------------

  it('AC-26: refinement preserves prevTurn.chainSlug=null despite active context with non-null chainSlug', async () => {
    // Active context has chainSlug='mcdonalds-es' (user has set context since the prior turn)
    mockGetContext.mockResolvedValueOnce({ chainSlug: 'mcdonalds-es', chainName: "McDonald's" });
    // Prior turn was generic (chainSlug = null)
    const prevTurnGeneric: ConversationTurnState = { ...VALID_PREV_TURN, chainSlug: null };
    mockGetTurnState.mockResolvedValue(prevTurnGeneric);
    mockDetectAttributeFollowUp.mockReturnValue(null);
    mockDetectRefinementFollowUp.mockReturnValue({ modificationText: 'de pollo', confidence: 0.85 });
    mockApplyRefinement.mockReturnValue({ mergedQuery: 'paella valenciana de pollo' });

    await processMessage(makeRequest({ text: 'hazlo de pollo' }));

    // Refinement must call estimate with chainSlug=undefined (prior was null), NOT 'mcdonalds-es'
    expect(mockEstimate).toHaveBeenCalledWith(
      expect.objectContaining({ chainSlug: undefined })
    );
  });

  it('AC-26: refinement preserves prevTurn.chainSlug non-null even if active context differs', async () => {
    // Active context is a different chain
    mockGetContext.mockResolvedValueOnce({ chainSlug: 'burger-king-es', chainName: 'Burger King' });
    // Prior turn was scoped to mcdonalds-es
    const prevTurnMcDonalds: ConversationTurnState = { ...VALID_PREV_TURN, chainSlug: 'mcdonalds-es' };
    mockGetTurnState.mockResolvedValue(prevTurnMcDonalds);
    mockDetectAttributeFollowUp.mockReturnValue(null);
    mockDetectRefinementFollowUp.mockReturnValue({ modificationText: 'menos cantidad', confidence: 0.85 });
    mockApplyRefinement.mockReturnValue({ mergedQuery: 'big mac', portionMultiplierOverride: 0.5 });

    await processMessage(makeRequest({ text: 'menos cantidad' }));

    // Refinement must use prior turn's chainSlug ('mcdonalds-es'), NOT current 'burger-king-es'
    expect(mockEstimate).toHaveBeenCalledWith(
      expect.objectContaining({ chainSlug: 'mcdonalds-es' })
    );
  });
});
