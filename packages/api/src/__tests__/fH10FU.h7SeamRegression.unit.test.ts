// F-H10-FU: H7-P5 seam regression tests (AC9)
//
// Verifies the interaction between F-H10-FU's guard-induced null returns
// and the H7-P5 retry seam in engineRouter.ts (lines 171-209).
//
// Uses MOCKED level1Lookup (via vi.hoisted + vi.mock) and REAL runEstimationCascade.
// Kept in a separate file from fH10FU.l1LexicalGuard.unit.test.ts to avoid
// module-mock hoisting conflict (mixing real + mocked imports of the same module
// in one file is impossible in Vitest without vi.importActual indirection).
//
// Pattern copied from packages/api/src/__tests__/f023.engineRouter.unit.test.ts:15-46.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import type { DB } from '../generated/kysely-types.js';

// ---------------------------------------------------------------------------
// Mock level1Lookup — must be hoisted before imports
// ---------------------------------------------------------------------------

const { mockLevel1Lookup } = vi.hoisted(() => ({
  mockLevel1Lookup: vi.fn(),
}));

vi.mock('../estimation/level1Lookup.js', () => ({
  level1Lookup: mockLevel1Lookup,
  offFallbackFoodMatch: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock level2Lookup
// ---------------------------------------------------------------------------

const { mockLevel2Lookup } = vi.hoisted(() => ({
  mockLevel2Lookup: vi.fn(),
}));

vi.mock('../estimation/level2Lookup.js', () => ({
  level2Lookup: mockLevel2Lookup,
}));

// ---------------------------------------------------------------------------
// Mock level3Lookup
// ---------------------------------------------------------------------------

const { mockLevel3Lookup } = vi.hoisted(() => ({
  mockLevel3Lookup: vi.fn(),
}));

vi.mock('../estimation/level3Lookup.js', () => ({
  level3Lookup: mockLevel3Lookup,
}));

// ---------------------------------------------------------------------------
// Import module under test (after all vi.mock calls)
// ---------------------------------------------------------------------------

import { runEstimationCascade } from '../estimation/engineRouter.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_DB = {} as Kysely<DB>;

const BASE_NUTRIENTS = {
  calories: 280,
  proteins: 22,
  carbohydrates: 15,
  sugars: 2,
  fats: 14,
  saturatedFats: 5,
  fiber: 1,
  salt: 0.8,
  sodium: 320,
  transFats: 0,
  cholesterol: 70,
  potassium: 250,
  monounsaturatedFats: 6,
  polyunsaturatedFats: 2,
  alcohol: 0,
  referenceBasis: 'per_serving' as const,
};

const POLLO_RESULT = {
  entityType: 'dish' as const,
  entityId: 'fd000000-fu10-4000-a000-000000000060',
  name: 'Pollo al ajillo',
  nameEs: 'Pollo al ajillo',
  restaurantId: 'fd000000-fu10-4000-a000-000000000061',
  chainSlug: 'generic-es',
  portionGrams: 250,
  nutrients: BASE_NUTRIENTS,
  confidenceLevel: 'high' as const,
  estimationMethod: 'official' as const,
  source: {
    id: 'fd000000-fu10-4000-a000-000000000062',
    name: 'Cocina Española',
    type: 'official' as const,
    url: null,
  },
  similarityDistance: null,
};

const MOCK_L1_POLLO_RESULT = {
  matchType: 'fts_dish' as const,
  result: POLLO_RESULT,
  rawFoodGroup: null,
};

// ---------------------------------------------------------------------------
// Tests — AC9 Path A + Path B
// ---------------------------------------------------------------------------

describe('H7-P5 seam regression — guard-induced null interaction (AC9)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: all levels miss
    mockLevel1Lookup.mockResolvedValue(null);
    mockLevel2Lookup.mockResolvedValue(null);
    mockLevel3Lookup.mockResolvedValue(null);
  });

  // ---------------------------------------------------------------------------
  // Path A: non-strippable query — seam does NOT fire
  // ---------------------------------------------------------------------------

  it('Path A: guard-induced null on non-strippable query — seam does NOT fire, L1 called once', async () => {
    // 'croquetas de jamon' is truly non-strippable: applyH7TrailingStrip returns same string
    // mockLevel1Lookup returns null (simulating guard-rejected FTS hit)
    mockLevel1Lookup.mockResolvedValue(null);
    mockLevel2Lookup.mockResolvedValue(null);
    mockLevel3Lookup.mockResolvedValue(null);

    const result = await runEstimationCascade({
      db: MOCK_DB,
      query: 'croquetas de jamon',
    });

    // Seam condition: h7StrippedQuery !== normalizedQuery is FALSE (strip identity)
    // → seam does NOT fire → level1Lookup called exactly ONCE (no retry)
    expect(mockLevel1Lookup).toHaveBeenCalledTimes(1);

    // level2Lookup WAS called (seam did not fire; cascade fell through to L2 directly)
    expect(mockLevel2Lookup).toHaveBeenCalledTimes(1);

    // All levels missed → null result
    expect(result.data.result).toBeNull();
    expect(result.levelHit).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Path B: strippable query — seam fires, retry succeeds (unmask path)
  // ---------------------------------------------------------------------------

  it('Path B: guard-induced null on strippable query — seam fires, retry succeeds (unmask)', async () => {
    // 'el pollo al ajillo está muy guisado?' normalizes to same (already lowercase)
    // applyH7TrailingStrip('el pollo al ajillo está muy guisado?') → 'el pollo al ajillo'
    // Strip differs → seam fires
    mockLevel1Lookup
      .mockResolvedValueOnce(null)              // first call (full normalized form) → null (guard rejected)
      .mockResolvedValueOnce(MOCK_L1_POLLO_RESULT); // second call (stripped form) → legitimate hit

    const result = await runEstimationCascade({
      db: MOCK_DB,
      query: 'el pollo al ajillo está muy guisado?',
    });

    // Seam fires: level1Lookup called TWICE (initial + retry)
    expect(mockLevel1Lookup).toHaveBeenCalledTimes(2);

    // First call was with the full normalized form
    expect(mockLevel1Lookup).toHaveBeenNthCalledWith(
      1,
      MOCK_DB,
      'el pollo al ajillo está muy guisado?',
      expect.any(Object),
    );

    // Second call was with the stripped form
    expect(mockLevel1Lookup).toHaveBeenNthCalledWith(
      2,
      MOCK_DB,
      'el pollo al ajillo',
      expect.any(Object),
    );

    // Retry succeeded → L1 hit, L2 not called
    expect(result.levelHit).toBe(1);
    expect(result.data.level1Hit).toBe(true);
    expect(result.data.matchType).toBe('fts_dish');
    expect(mockLevel2Lookup).not.toHaveBeenCalled();

    // "Echo raw query" invariant: data.query reflects the RAW original, not the stripped form
    expect(result.data.query).toBe('el pollo al ajillo está muy guisado?');
  });

  // ---------------------------------------------------------------------------
  // Path B (null retry): strippable query, retry also returns null — no infinite loop
  // ---------------------------------------------------------------------------

  it('Path B (null retry): strippable query, retry returns null — seam fires once, no loop', async () => {
    // Both calls return null: initial + retry both miss
    mockLevel1Lookup.mockResolvedValue(null);
    mockLevel2Lookup.mockResolvedValue(null);
    mockLevel3Lookup.mockResolvedValue(null);

    const result = await runEstimationCascade({
      db: MOCK_DB,
      query: 'el pollo al ajillo está muy guisado?',
    });

    // Seam fires exactly ONCE (retry produces null; seam is not re-evaluated after retry)
    // level1Lookup called: 1 (initial) + 1 (retry) = 2 total
    expect(mockLevel1Lookup).toHaveBeenCalledTimes(2);

    // After null retry, cascade falls through to L2 with ORIGINAL normalizedQuery
    expect(mockLevel2Lookup).toHaveBeenCalledTimes(1);

    // All levels missed → null result (no infinite loop)
    expect(result.data.result).toBeNull();
    expect(result.levelHit).toBeNull();
  });
});
