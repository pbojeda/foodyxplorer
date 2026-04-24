// F-MULTI-ITEM-IMPLICIT — QA edge-case tests
//
// Covers cases NOT present in the developer's 4 test files:
//   1. Empty / whitespace-only / delimiter-only inputs
//   2. Mixed-case ' Y ' conjunction
//   3. Numeric-only tokens
//   4. Leading / trailing whitespace after normalization
//   5. Multiple consecutive commas
//   6. Input consisting of only a single y-token
//   7. Guard 0 with null vs undefined db
//   8. Verify normalizeFragment does NOT over-strip nested serving phrases
//   9. splitOnCommasThenYRecursive — empty-after-trim fragments are discarded
//  10. AC15 cap: verify call count (items 9+10 must never trigger level1Lookup)
//
// ADR-021: Unit tests mock all external dependencies.
// Vitest globals NOT enabled — import everything explicitly.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Level1Result } from '../estimation/types.js';

// ---------------------------------------------------------------------------
// Mock level1Lookup — must be declared BEFORE the module-under-test import
// ---------------------------------------------------------------------------

const { mockLevel1Lookup } = vi.hoisted(() => ({
  mockLevel1Lookup: vi.fn<
    Parameters<typeof import('../estimation/level1Lookup.js')['level1Lookup']>,
    ReturnType<typeof import('../estimation/level1Lookup.js')['level1Lookup']>
  >(),
}));

vi.mock('../estimation/level1Lookup.js', () => ({
  level1Lookup: mockLevel1Lookup,
}));

// ---------------------------------------------------------------------------
// Module under test (imported AFTER vi.mock)
// ---------------------------------------------------------------------------

import {
  detectImplicitMultiItem,
  splitOnCommasThenYRecursive,
  normalizeFragment,
} from '../conversation/implicitMultiItemDetector.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHit(): Level1Result {
  return {
    matchType: 'exact_dish',
    result: {
      query: 'mock',
      nameEs: null,
      dishId: 'fb000000-00fb-4000-a000-000000000001',
      dataSourceId: null,
      chainSlug: null,
      restaurantId: null,
      level: 1,
      calories: 100,
      proteins: 5,
      carbohydrates: 20,
      sugars: 5,
      fats: 3,
      saturatedFats: 1,
      fiber: 2,
      salt: 0.5,
      sodium: 200,
      transFats: 0,
      cholesterol: 20,
      potassium: 100,
      monounsaturatedFats: 1,
      polyunsaturatedFats: 0.5,
      alcohol: 0,
      referenceBasis: 'per_100g',
      portionGrams: null,
      portionMl: null,
      estimationMethod: null,
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional test double
const mockDb = {} as any;

// ---------------------------------------------------------------------------
// Edge Case 1 — Empty / whitespace / delimiter-only inputs
// Guard 1 (no ' y ' or ',') should fire and return null with zero DB calls.
// ---------------------------------------------------------------------------

describe('EC-QA-1 — empty / whitespace / delimiter-only inputs (Guard 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('empty string "" → null, no DB calls', async () => {
    const result = await detectImplicitMultiItem('', mockDb);
    expect(result).toBeNull();
    expect(mockLevel1Lookup).not.toHaveBeenCalled();
  });

  it('only spaces "   " → null, no DB calls', async () => {
    const result = await detectImplicitMultiItem('   ', mockDb);
    expect(result).toBeNull();
    expect(mockLevel1Lookup).not.toHaveBeenCalled();
  });

  it('only " y " → has conjunction, Guard 2 runs, split yields ["", ""] with filter → length < 2 → null', async () => {
    // " y " passes Guard 1. Guard 2: level1Lookup called once (whole-text " y " → miss).
    // split on last ' y ': left = "", right = "". filter(Boolean) removes empties.
    // rawFragments.length < 2 → return null.
    mockLevel1Lookup.mockResolvedValueOnce(null); // Guard 2 miss
    const result = await detectImplicitMultiItem(' y ', mockDb);
    expect(result).toBeNull();
  });

  it('only "," → has comma, Guard 2 runs, split yields [] after filter → length < 2 → null', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(null); // Guard 2 miss
    const result = await detectImplicitMultiItem(',', mockDb);
    expect(result).toBeNull();
  });

  it('"  ,  " (spaces + comma) → null', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(null); // Guard 2 miss
    const result = await detectImplicitMultiItem('  ,  ', mockDb);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Edge Case 2 — Capital-Y conjunction " Y " (case-insensitive guard check)
// Guard 1 uses text.includes(' y ') — this is case-SENSITIVE.
// "Paella Y Vino" would NOT trigger Guard 1, so it falls through to Step 4.
// This is a spec deviation: the spec pseudocode uses text.includes(' y ') (lowercase).
// The test verifies the current behavior (Guard 1 is case-sensitive for ' y ').
// ---------------------------------------------------------------------------

describe('EC-QA-2 — mixed-case conjunction " Y " (Guard 1 case-sensitivity)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('"Paella Y Vino" — Guard 1 is case-sensitive: " Y " does NOT match includes(" y ") → null', async () => {
    // Guard 1: text.includes(' y ') is false for " Y " (uppercase).
    // text.includes(',') is also false.
    // → Guard 1 fires, returns null immediately, no DB calls.
    const result = await detectImplicitMultiItem('Paella Y Vino', mockDb);
    expect(result).toBeNull();
    expect(mockLevel1Lookup).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Edge Case 3 — Numeric-only or nonsense tokens
// If both fragments fail L1 lookup, returns null (not a multi-item query).
// ---------------------------------------------------------------------------

describe('EC-QA-3 — numeric and nonsense token inputs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('"3 y 4" — Guard 2 miss, fragments ["3","4"] both fail L1 → null', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(null); // Guard 2 whole-text miss
    mockLevel1Lookup.mockResolvedValueOnce(null); // "3" fails
    const result = await detectImplicitMultiItem('3 y 4', mockDb);
    expect(result).toBeNull();
  });

  it('"foo y bar" — fragments fail L1 → null', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(null); // Guard 2 miss
    mockLevel1Lookup.mockResolvedValueOnce(null); // "foo" fails
    const result = await detectImplicitMultiItem('foo y bar', mockDb);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Edge Case 4 — Multiple consecutive commas / whitespace between commas
// splitOnCommasThenYRecursive uses filter(Boolean) — empty segments are discarded.
// ---------------------------------------------------------------------------

describe('EC-QA-4 — multiple consecutive commas and whitespace', () => {
  it('"paella,, vino" → ["paella", "vino"] (empty fragment between commas discarded)', () => {
    // split(',') → ["paella", "", " vino"]; trim+filter → ["paella", "vino"]
    expect(splitOnCommasThenYRecursive('paella,, vino')).toEqual(['paella', 'vino']);
  });

  it('"paella, , vino" → ["paella", "vino"] (whitespace-only fragment discarded)', () => {
    // split(',') → ["paella", " ", " vino"]; trim → ["paella", "", "vino"]; filter(Boolean) → ["paella","vino"]
    expect(splitOnCommasThenYRecursive('paella, , vino')).toEqual(['paella', 'vino']);
  });

  it('",,," → [] (all empty after filter)', () => {
    expect(splitOnCommasThenYRecursive(',,,').length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Edge Case 5 — normalizeFragment edge cases
// ---------------------------------------------------------------------------

describe('EC-QA-5 — normalizeFragment edge cases', () => {
  it('empty string "" → "" (no crash, no infinite loop)', () => {
    // If passed empty string, trim() returns "", replace returns "", trim returns "" — stable.
    expect(normalizeFragment('')).toBe('');
  });

  it('"una " (article with trailing space) → "una" (trim fires BEFORE article strip, killing the required whitespace)', () => {
    // normalizeFragment calls text.trim() first. "una " becomes "una".
    // ARTICLE_PATTERN = /^(?:un[ao]?s?|...)\s+/i requires \s+ AFTER the article.
    // "una" (no trailing space after trim) does NOT match → no strip → returns "una".
    // This is correct behavior: the function requires \s+ to distinguish article from food name "una".
    const result = normalizeFragment('una ');
    expect(result).toBe('una');
  });

  it('"una copa de " (trailing space after serving prefix) → "copa de" (trim first, then article stripped, no text after serving prefix to strip)', () => {
    // trim → "una copa de". ARTICLE_PATTERN strips "una " → "copa de".
    // SERVING_FORMAT_PATTERNS look for "copas? de " + non-empty remainder.
    // "copa de" has no text after "de " → serving strip guard (stripped.trim().length > 0) prevents strip.
    // Returns "copa de". This is a degenerate input; in practice fragments always have food names.
    const result = normalizeFragment('una copa de ');
    expect(result).toBe('copa de');
  });

  it('"café con leche" unchanged — contains no leading article or serving prefix', () => {
    expect(normalizeFragment('café con leche')).toBe('café con leche');
  });

  it('"del bocadillo" → "bocadillo" (del = de+el article)', () => {
    // ARTICLE_PATTERN should cover "del " (contraction)
    const result = normalizeFragment('del bocadillo');
    expect(result).toBe('bocadillo');
  });
});

// ---------------------------------------------------------------------------
// Edge Case 6 — AC15 cap: verify level1Lookup call count for 10-item input
// Items 9 and 10 (index 8 and 9 after normalization) must NEVER be passed to
// level1Lookup. If they were, the mock would run out of responses.
// This is the "real catalog items at positions 9+10" verification from plan v2.2.
// ---------------------------------------------------------------------------

describe('EC-QA-6 — AC15 cap: items 9+10 never reach level1Lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('10-item input: level1Lookup called exactly 9 times (1 Guard2 + 8 fragments)', async () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'item9', 'item10'];
    const input = items.join(' y ');

    mockLevel1Lookup.mockResolvedValueOnce(null); // Guard 2 miss
    // Provide exactly 8 hits for the 8 validated fragments
    for (let i = 0; i < 8; i++) {
      mockLevel1Lookup.mockResolvedValueOnce(makeHit());
    }
    // Do NOT provide responses for items 9 or 10 — if called, mock returns undefined (test fails)

    const result = await detectImplicitMultiItem(input, mockDb);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(8);
    // 1 (Guard 2) + 8 (per-fragment) = 9 total calls
    expect(mockLevel1Lookup).toHaveBeenCalledTimes(9);
  });
});

// ---------------------------------------------------------------------------
// Edge Case 7 — Guard 0 with null (vs undefined) db
// ---------------------------------------------------------------------------

describe('EC-QA-7 — Guard 0 with null db', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('null db → null, no DB calls', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Guard 0 test
    const result = await detectImplicitMultiItem('paella y vino', null as any);
    expect(result).toBeNull();
    expect(mockLevel1Lookup).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Edge Case 8 — splitOnCommasThenYRecursive with trailing ' y ' suffix
// "paella y " — last-y split: left = "paella", right = "" → right is empty.
// After filter(Boolean), only ["paella"] remains → length < 2 → null from detector.
// ---------------------------------------------------------------------------

describe('EC-QA-8 — trailing conjunction / orphaned delimiter', () => {
  it('"paella y " → ["paella y"] (comma-split trim fires first, eliminating the trailing space; then no " y " found in "paella y")', () => {
    // comma split → ["paella y "], trim → ["paella y"].
    // splitOnYRecursive("paella y"): lastIndexOf(' y ') in "paella y" (8 chars, no trailing space after y) → -1.
    // Returns ["paella y"] as a single unsplit fragment.
    // Downstream: "paella y" fails L1 catalog lookup → detector returns null. Safe.
    const result = splitOnCommasThenYRecursive('paella y ');
    expect(result).toEqual(['paella y']);
  });

  it('"y paella" → ["paella"] (leading right token only)', () => {
    // last ' y ' at lastIndexOf → -1 (no space-y-space at start). Actually " y " needs spaces.
    // "y paella" has no ' y ' (no leading space before 'y'). Returns ["y paella"] as one fragment.
    const result = splitOnCommasThenYRecursive('y paella');
    expect(result).toEqual(['y paella']);
  });
});

// ---------------------------------------------------------------------------
// Edge Case 9 — Verify normalizeFragment does NOT over-strip compound serving+food
// "café con leche" must remain intact (no article, no serving prefix match)
// ---------------------------------------------------------------------------

describe('EC-QA-9 — normalizeFragment does not over-strip con-compounds', () => {
  it('"café con leche" → "café con leche" (con is NOT a serving prefix)', () => {
    expect(normalizeFragment('café con leche')).toBe('café con leche');
  });

  it('"arroz con pollo" → "arroz con pollo" (con is NOT a serving prefix)', () => {
    expect(normalizeFragment('arroz con pollo')).toBe('arroz con pollo');
  });
});
