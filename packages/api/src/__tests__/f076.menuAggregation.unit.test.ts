// F076 — Unit tests for ConversationCore menu estimation step (Step 3.5)
//
// Tests the full pipeline: detectMenuQuery → parallel estimate → aggregate → return

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EstimateData, EstimateResult } from '@foodxplorer/shared';
import type { ConversationRequest } from '../conversation/types.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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

const { mockDetectMenuQuery } = vi.hoisted(() => ({
  mockDetectMenuQuery: vi.fn(),
}));

vi.mock('../conversation/menuDetector.js', () => ({
  detectMenuQuery: mockDetectMenuQuery,
}));

import { processMessage } from '../conversation/conversationCore.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACTOR_ID = 'fd000000-0076-4000-a000-000000000001';

const makeNutrients = (cal: number) => ({
  calories: cal, proteins: 10, carbohydrates: 20, sugars: 5,
  fats: 8, saturatedFats: 3, fiber: 2, salt: 0.5, sodium: 200,
  transFats: 0, cholesterol: 30, potassium: 100,
  monounsaturatedFats: 3, polyunsaturatedFats: 1, alcohol: 0,
  referenceBasis: 'per_serving' as const,
});

const makeResult = (name: string, cal: number): EstimateResult => ({
  entityType: 'dish',
  entityId: `fd000000-0076-4000-a000-${String(cal).padStart(12, '0')}`,
  name,
  nameEs: name,
  restaurantId: null,
  chainSlug: null,
  portionGrams: 200,
  nutrients: makeNutrients(cal),
  confidenceLevel: 'high',
  estimationMethod: 'official',
  source: { id: 'src-1', name: 'BEDCA', type: 'official', url: null },
  similarityDistance: null,
});

const makeEstimateData = (query: string, cal: number): EstimateData => ({
  query,
  chainSlug: null,
  level1Hit: true, level2Hit: false, level3Hit: false, level4Hit: false,
  matchType: 'exact_dish',
  result: makeResult(query, cal),
  cachedAt: null,
  portionMultiplier: 1,
});

const NULL_ESTIMATE: EstimateData = {
  query: 'unknown',
  chainSlug: null,
  level1Hit: false, level2Hit: false, level3Hit: false, level4Hit: false,
  matchType: null,
  result: null,
  cachedAt: null,
  portionMultiplier: 1,
};

const mockLogger = {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  child: vi.fn(), trace: vi.fn(), fatal: vi.fn(), level: 'info', silent: vi.fn(),
} as unknown as ConversationRequest['logger'];

const mockDb = {} as ConversationRequest['db'];
const mockRedis = {} as ConversationRequest['redis'];

function makeRequest(text: string, overrides: Partial<ConversationRequest> = {}): ConversationRequest {
  return {
    text,
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

describe('ConversationCore — menu estimation (F076)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetContext.mockResolvedValue(null);
    mockSetContext.mockResolvedValue(undefined);
    mockResolveChain.mockReturnValue(null);
    mockDetectMenuQuery.mockReturnValue(null); // default: no menu
    mockEstimate.mockResolvedValue(makeEstimateData('big mac', 550));
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('menu detected → returns menu_estimation intent with items and totals', async () => {
    mockDetectMenuQuery.mockReturnValue(['gazpacho', 'pollo', 'flan']);
    mockEstimate
      .mockResolvedValueOnce(makeEstimateData('gazpacho', 120))
      .mockResolvedValueOnce(makeEstimateData('pollo', 350))
      .mockResolvedValueOnce(makeEstimateData('flan', 200));

    const result = await processMessage(makeRequest('menú: gazpacho, pollo, flan'));

    expect(result.intent).toBe('menu_estimation');
    expect(result.menuEstimation).toBeDefined();
    expect(result.menuEstimation!.items).toHaveLength(3);
    expect(result.menuEstimation!.itemCount).toBe(3);
    expect(result.menuEstimation!.matchedCount).toBe(3);

    // Verify totals
    expect(result.menuEstimation!.totals.calories).toBe(120 + 350 + 200);
    expect(result.menuEstimation!.totals.proteins).toBe(30); // 10 * 3
  });

  it('estimate called once per item', async () => {
    mockDetectMenuQuery.mockReturnValue(['a', 'b']);
    mockEstimate.mockResolvedValue(makeEstimateData('a', 100));

    await processMessage(makeRequest('menú: a, b'));

    expect(mockEstimate).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Partial matches
  // -------------------------------------------------------------------------

  it('partial match — one null result excluded from totals', async () => {
    mockDetectMenuQuery.mockReturnValue(['gazpacho', 'unknown', 'flan']);
    mockEstimate
      .mockResolvedValueOnce(makeEstimateData('gazpacho', 120))
      .mockResolvedValueOnce(NULL_ESTIMATE)
      .mockResolvedValueOnce(makeEstimateData('flan', 200));

    const result = await processMessage(makeRequest('menú: gazpacho, unknown, flan'));

    expect(result.menuEstimation!.matchedCount).toBe(2);
    expect(result.menuEstimation!.itemCount).toBe(3);
    expect(result.menuEstimation!.totals.calories).toBe(320); // 120 + 200
    // The null-result item is still in items array
    expect(result.menuEstimation!.items[1]!.estimation.result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // All items null result
  // -------------------------------------------------------------------------

  it('all items null result → zero-filled totals, matchedCount=0', async () => {
    mockDetectMenuQuery.mockReturnValue(['x', 'y']);
    mockEstimate.mockResolvedValue(NULL_ESTIMATE);

    const result = await processMessage(makeRequest('menú: x, y'));

    expect(result.menuEstimation!.matchedCount).toBe(0);
    expect(result.menuEstimation!.totals.calories).toBe(0);
    expect(result.menuEstimation!.totals.proteins).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Rejected promises — partial success
  // -------------------------------------------------------------------------

  it('one item rejects → caught, mapped to null-result, partial success', async () => {
    mockDetectMenuQuery.mockReturnValue(['gazpacho', 'broken']);
    mockEstimate
      .mockResolvedValueOnce(makeEstimateData('gazpacho', 120))
      .mockRejectedValueOnce(new Error('DB_UNAVAILABLE'));

    const result = await processMessage(makeRequest('menú: gazpacho, broken'));

    expect(result.intent).toBe('menu_estimation');
    expect(result.menuEstimation!.matchedCount).toBe(1);
    expect(result.menuEstimation!.items[1]!.estimation.result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // ALL items reject → propagate first error
  // -------------------------------------------------------------------------

  it('ALL items reject → throws first error', async () => {
    mockDetectMenuQuery.mockReturnValue(['a', 'b']);
    mockEstimate.mockRejectedValue(new Error('DB_UNAVAILABLE'));

    await expect(processMessage(makeRequest('menú: a, b'))).rejects.toThrow('DB_UNAVAILABLE');
  });

  // -------------------------------------------------------------------------
  // Menu not detected → falls through to single-dish
  // -------------------------------------------------------------------------

  it('detectMenuQuery returns null → single-dish estimation', async () => {
    mockDetectMenuQuery.mockReturnValue(null);

    const result = await processMessage(makeRequest('big mac'));

    expect(result.intent).toBe('estimation');
    expect(result.menuEstimation).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Context injection
  // -------------------------------------------------------------------------

  it('chain context injected into each item estimation', async () => {
    mockGetContext.mockResolvedValueOnce({ chainSlug: 'bk-es', chainName: 'Burger King' });
    mockDetectMenuQuery.mockReturnValue(['whopper', 'fries']);
    mockEstimate.mockResolvedValue(makeEstimateData('whopper', 600));

    await processMessage(makeRequest('menú: whopper, fries'));

    // Each estimate call should receive the effective chain slug
    for (const call of mockEstimate.mock.calls) {
      expect(call[0]).toHaveProperty('chainSlug', 'bk-es');
    }
  });

  // -------------------------------------------------------------------------
  // activeContext echoed
  // -------------------------------------------------------------------------

  it('activeContext echoed in menu_estimation response', async () => {
    mockGetContext.mockResolvedValueOnce({ chainSlug: 'bk-es', chainName: 'Burger King' });
    mockDetectMenuQuery.mockReturnValue(['a', 'b']);
    mockEstimate.mockResolvedValue(makeEstimateData('a', 100));

    const result = await processMessage(makeRequest('menú: a, b'));

    expect(result.activeContext).toEqual({ chainSlug: 'bk-es', chainName: 'Burger King' });
  });

  // -------------------------------------------------------------------------
  // actorId echoed
  // -------------------------------------------------------------------------

  it('actorId echoed in menu_estimation response', async () => {
    mockDetectMenuQuery.mockReturnValue(['a', 'b']);
    mockEstimate.mockResolvedValue(makeEstimateData('a', 100));

    const result = await processMessage(makeRequest('menú: a, b'));

    expect(result.actorId).toBe(ACTOR_ID);
  });

  // -------------------------------------------------------------------------
  // Totals rounding
  // -------------------------------------------------------------------------

  it('totals are rounded to 2 decimal places', async () => {
    mockDetectMenuQuery.mockReturnValue(['a', 'b', 'c']);
    // Each has proteins=10, so total=30, but with floating point:
    // Let's use a case where rounding matters
    const data = makeEstimateData('a', 100);
    // Override nutrient to trigger rounding
    data.result!.nutrients.salt = 0.333;
    mockEstimate.mockResolvedValue(data);

    const result = await processMessage(makeRequest('menú: a, b, c'));

    // 0.333 * 3 = 0.999, rounded to 1.0
    expect(result.menuEstimation!.totals.salt).toBe(1);
  });
});
