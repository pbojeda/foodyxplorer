// F043 QA Edge Cases — Dish Comparison via Bot
//
// Tests targeting gaps and bugs in the F043 implementation:
// 1. Leading ¿ (inverted question mark) blocks NL comparison detection
// 2. Same-entity detection missing from formatComparison
// 3. 'con' separator false positives with Spanish dish names containing 'con'
// 4. Trailing '?' in comparison queries leaks into API query
// 5. Article stripping inconsistency (una/un/el/la not stripped from dish expressions)
// 6. NL separator cross-product: all 5 prefixes × several separators
// 7. splitByComparator edge cases not covered by dev tests

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import type { Redis } from 'ioredis';
import type { EstimateData } from '@foodxplorer/shared';
import { ApiError } from '../apiClient.js';

function makeMockRedis() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    del: vi.fn(),
    ttl: vi.fn(),
  } as unknown as Redis;
}
import {
  splitByComparator,
  parseCompararArgs,
  parseDishExpression,
  extractComparisonQuery,
} from '../lib/comparisonParser.js';
import { formatComparison } from '../formatters/comparisonFormatter.js';
import { runComparison } from '../lib/comparisonRunner.js';
import { handleNaturalLanguage } from '../handlers/naturalLanguage.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const NUTRIENTS_A = {
  calories: 563, proteins: 26.5, carbohydrates: 45, sugars: 0,
  fats: 30, saturatedFats: 10, fiber: 3, salt: 2.5, sodium: 940,
  transFats: 0, cholesterol: 0, potassium: 0,
  monounsaturatedFats: 0, polyunsaturatedFats: 0,
  referenceBasis: 'per_serving' as const,
};

const NUTRIENTS_B = {
  calories: 672, proteins: 25, carbohydrates: 56, sugars: 0,
  fats: 35, saturatedFats: 14, fiber: 2, salt: 3, sodium: 860,
  transFats: 0, cholesterol: 0, potassium: 0,
  monounsaturatedFats: 0, polyunsaturatedFats: 0,
  referenceBasis: 'per_serving' as const,
};

const ENTITY_ID_A = 'fd000000-0001-4000-a000-000000000001';
const ENTITY_ID_B = 'fd000000-0001-4000-a000-000000000002';

function makeResult(overrides: Record<string, unknown> = {}) {
  return {
    entityType: 'dish' as const,
    entityId: ENTITY_ID_A,
    name: 'Big Mac',
    nameEs: 'Big Mac' as string | null,
    restaurantId: null as string | null,
    chainSlug: null as string | null,
    portionGrams: 200 as number | null,
    nutrients: NUTRIENTS_A,
    confidenceLevel: 'high' as const,
    estimationMethod: 'official' as const,
    source: { id: 'src-1', name: 'src', type: 'official' as const, url: null as string | null },
    similarityDistance: null as number | null,
    ...overrides,
  };
}

function makeEstimateData(overrides: Record<string, unknown> = {}): EstimateData {
  const { result: resultOverride, ...rest } = overrides;
  const base: EstimateData = {
    query: 'big mac',
    chainSlug: null,
    portionMultiplier: 1.0,
    level1Hit: true,
    level2Hit: false,
    level3Hit: false,
    level4Hit: false,
    matchType: 'exact_dish',
    cachedAt: null,
    result: resultOverride === null ? null : makeResult(resultOverride as Record<string, unknown> ?? {}),
    ...rest,
  };
  if (resultOverride === null) base.result = null;
  return base;
}

const DATA_A = makeEstimateData({
  query: 'big mac',
  result: { name: 'Big Mac', nameEs: 'Big Mac', nutrients: NUTRIENTS_A, confidenceLevel: 'high', entityId: ENTITY_ID_A },
});

const DATA_B = makeEstimateData({
  query: 'whopper',
  result: { name: 'Whopper', nameEs: 'Whopper', nutrients: NUTRIENTS_B, confidenceLevel: 'medium', entityId: ENTITY_ID_B },
});

const DATA_NULL = makeEstimateData({ query: 'xyz', result: null, level1Hit: false, matchType: null });

// ---------------------------------------------------------------------------
// Mock ApiClient
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
  };
}

// ===========================================================================
// BUG 1: Leading ¿ blocks NL comparison detection
// Spec problem statement (ticket line 15) uses "¿qué tiene más calorías..."
// as the motivating example — the exact input should trigger comparison detection.
// ===========================================================================

describe('F043 BUG-1: leading ¿ (inverted question mark) blocks comparison detection', () => {
  // extractComparisonQuery directly
  it('extractComparisonQuery returns null for "¿qué tiene más calorías, big mac o whopper" (leading ¿)', () => {
    // BUG: ^ anchors block detection because ¿ precedes qué
    // When this test FAILS it means the bug is confirmed (null instead of ParsedComparison)
    const result = extractComparisonQuery('¿qué tiene más calorías, big mac o whopper');
    expect(result).not.toBeNull(); // should detect comparison
  });

  it('extractComparisonQuery returns null for "¿compara big mac con whopper?" (leading ¿ and trailing ?)', () => {
    const result = extractComparisonQuery('¿compara big mac con whopper?');
    expect(result).not.toBeNull();
  });

  it('extractComparisonQuery returns null for "¿qué engorda más, pizza o hamburguesa?"', () => {
    const result = extractComparisonQuery('¿qué engorda más, pizza o hamburguesa?');
    expect(result).not.toBeNull();
  });

  // NL handler integration — comparison should fire instead of single-dish path.
  // After F070 refactor: handleNaturalLanguage calls apiClient.processMessage() with the raw text.
  // The server-side ConversationCore handles ¿ stripping and comparison detection.
  it('handleNaturalLanguage calls processMessage for "¿qué tiene más calorías, big mac o whopper"', async () => {
    const mock = makeMockClient();
    const messageData = {
      intent: 'comparison' as const,
      actorId: 'fd000000-0001-4000-a000-000000000099',
      comparison: { dishA: DATA_A, dishB: DATA_A },
      activeContext: null,
    };
    mock.processMessage.mockResolvedValue(messageData);
    await handleNaturalLanguage('¿qué tiene más calorías, big mac o whopper', 0, makeMockRedis(), mock as unknown as ApiClient);
    expect(mock.processMessage).toHaveBeenCalledOnce();
    expect(mock.processMessage).toHaveBeenCalledWith(
      '¿qué tiene más calorías, big mac o whopper', 0, undefined,
    );
    expect(mock.estimate).not.toHaveBeenCalled();
  });

  it('handleNaturalLanguage calls processMessage for "¿qué es más sano, la ensalada o el bollo?"', async () => {
    const mock = makeMockClient();
    const messageData = {
      intent: 'comparison' as const,
      actorId: 'fd000000-0001-4000-a000-000000000099',
      comparison: { dishA: DATA_A, dishB: DATA_A },
      activeContext: null,
    };
    mock.processMessage.mockResolvedValue(messageData);
    await handleNaturalLanguage('¿qué es más sano, la ensalada o el bollo?', 0, makeMockRedis(), mock as unknown as ApiClient);
    expect(mock.processMessage).toHaveBeenCalledOnce();
    expect(mock.estimate).not.toHaveBeenCalled();
  });

  // Without ¿ — should work (baseline to confirm bug is in ¿ handling specifically)
  it('extractComparisonQuery correctly detects comparison without leading ¿', () => {
    const result = extractComparisonQuery('qué tiene más calorías, big mac o whopper');
    expect(result).toEqual({ dishA: 'big mac', dishB: 'whopper', nutrientFocus: 'calorías' });
  });
});

// ===========================================================================
// BUG 2: Same-entity detection missing from formatComparison
// Spec line 302-303 requires a note when both dishes resolve to the same entityId.
// ===========================================================================

describe('F043 BUG-2: same-entity detection missing from formatComparison', () => {
  const SAME_ENTITY_DATA_A = makeEstimateData({
    query: 'big mac',
    result: {
      name: 'Big Mac', nameEs: 'Big Mac',
      nutrients: NUTRIENTS_A, confidenceLevel: 'high',
      entityId: ENTITY_ID_A,
    },
  });

  const SAME_ENTITY_DATA_B = makeEstimateData({
    query: 'mac big', // different query, same resolved entity
    result: {
      name: 'Big Mac', nameEs: 'Big Mac',
      nutrients: NUTRIENTS_A, confidenceLevel: 'high',
      entityId: ENTITY_ID_A, // same entityId!
    },
  });

  it('formatComparison appends same-entity note when both results have the same entityId', () => {
    const out = formatComparison(SAME_ENTITY_DATA_A, SAME_ENTITY_DATA_B);
    // BUG: this note is never added — test should fail to expose the missing behavior
    expect(out).toContain('Ambos platos corresponden al mismo resultado');
  });

  it('formatComparison does NOT show same-entity note when entityIds differ', () => {
    const out = formatComparison(DATA_A, DATA_B);
    expect(out).not.toContain('Ambos platos corresponden al mismo resultado');
  });
});

// ===========================================================================
// BUG 3: 'con' separator false positives with Spanish dish names
// Common Spanish dishes like "arroz con leche", "pollo con champiñones",
// "pizza con queso" contain 'con'. When used with 'vs' separator, 'con'
// wins because it appears earlier in COMPARISON_SEPARATORS.
// ===========================================================================

describe('F043 BUG-3: "con" separator causes false positives with dish names containing "con"', () => {
  // This is the critical case: user uses 'vs' explicitly but dish name contains 'con'
  it('splitByComparator("arroz con leche vs natillas") splits on "vs", not "con"', () => {
    const result = splitByComparator('arroz con leche vs natillas');
    // BUG: current impl splits on 'con' first → ['arroz', 'leche vs natillas']
    expect(result).toEqual(['arroz con leche', 'natillas']);
  });

  it('splitByComparator("pizza con queso vs hamburguesa") splits on "vs", not "con"', () => {
    const result = splitByComparator('pizza con queso vs hamburguesa');
    // BUG: splits on 'con' → ['pizza', 'queso vs hamburguesa']
    expect(result).toEqual(['pizza con queso', 'hamburguesa']);
  });

  it('splitByComparator("pollo con champiñones vs salmón") splits on "vs", not "con"', () => {
    const result = splitByComparator('pollo con champiñones vs salmón');
    expect(result).toEqual(['pollo con champiñones', 'salmón']);
  });

  it('parseCompararArgs("arroz con leche vs natillas") returns correct dishA and dishB', () => {
    const result = parseCompararArgs('arroz con leche vs natillas');
    expect(result).toEqual({ dishA: 'arroz con leche', dishB: 'natillas' });
  });

  // NL path: 'qué es más sano, pollo con verduras o hamburguesa'
  it('extractComparisonQuery("qué es más sano, pollo con verduras o hamburguesa") splits on last "o"', () => {
    const result = extractComparisonQuery('qué es más sano, pollo con verduras o hamburguesa');
    // BUG: con is tried before o → ['pollo', 'verduras o hamburguesa']
    expect(result).toEqual({ dishA: 'pollo con verduras', dishB: 'hamburguesa', nutrientFocus: undefined });
  });

  it('extractComparisonQuery("qué tiene menos calorías, arroz con leche o natillas") splits correctly', () => {
    const result = extractComparisonQuery('qué tiene menos calorías, arroz con leche o natillas');
    // After prefix strip: 'arroz con leche o natillas'
    // Should split on last 'o' → dishA='arroz con leche', dishB='natillas'
    // BUG: splits on 'con' → dishA='arroz', dishB='leche o natillas'
    expect(result).toEqual({ dishA: 'arroz con leche', dishB: 'natillas', nutrientFocus: 'calorías' });
  });

  // Multiple 'con' in remainder — should split on 'con' as separator only when that's the intent
  it('splitByComparator("arroz con leche con natillas") uses FIRST con (ambiguous — both sides are valid)', () => {
    // When only 'con' separator exists and it appears multiple times, behavior is deterministic
    // Implementation uses FIRST occurrence for 'con' (not last)
    // User intent is ambiguous here, but we document the actual behavior
    const result = splitByComparator('arroz con leche con natillas');
    // First 'con' wins → ['arroz', 'leche con natillas']
    // This may or may not match user intent, but it's consistent
    expect(result).not.toBeNull();
    // The split should return exactly two non-empty strings
    expect(result?.[0]).toBeTruthy();
    expect(result?.[1]).toBeTruthy();
  });
});

// ===========================================================================
// Trailing '?' in comparison dish queries leaks into API
// Users naturally append '?' to questions in Spanish text
// ===========================================================================

describe('F043: trailing punctuation in NL comparison queries', () => {
  it('extractComparisonQuery strips trailing ? from dishB', () => {
    const result = extractComparisonQuery('qué tiene más calorías, big mac o whopper?');
    // The '?' ends up in dishB: 'whopper?' instead of 'whopper'
    // This gets sent to the API as a query with trailing '?'
    if (result !== null) {
      expect(result.dishB).toBe('whopper');
    } else {
      // If null, the test fails with a clear message
      expect(result).not.toBeNull();
    }
  });

  it('parseDishExpression removes trailing punctuation from query', () => {
    const result = parseDishExpression('whopper?');
    // parseDishExpression does not strip trailing '?'
    // This documents the behavior — currently returns { query: 'whopper?', portionMultiplier: 1.0 }
    // Ideally it should strip the '?' before sending to API
    expect(result.query).toBe('whopper');
  });

  it('parseDishExpression removes trailing punctuation from "hamburguesa!"', () => {
    const result = parseDishExpression('hamburguesa!');
    expect(result.query).toBe('hamburguesa');
  });
});

// ===========================================================================
// Article stripping: NL comparison dishes get 'una X' instead of 'X' in API
// The single-dish NL path strips articles (una, un, el, la) via extractFoodQuery
// but parseDishExpression (used in comparison path) does not strip articles.
// ===========================================================================

describe('F043: article stripping inconsistency in comparison dish expressions', () => {
  it('parseDishExpression strips leading article "una" from dish expression', () => {
    // Currently returns { query: 'una big mac', portionMultiplier: 1.5 }
    // Should strip 'una' → { query: 'big mac', portionMultiplier: 1.5 }
    const result = parseDishExpression('una big mac grande');
    expect(result.query).toBe('big mac');
    expect(result.portionMultiplier).toBe(1.5);
  });

  it('parseDishExpression strips leading article "un" from dish expression', () => {
    const result = parseDishExpression('un whopper');
    expect(result.query).toBe('whopper');
  });

  it('parseDishExpression strips leading article "el" from dish expression', () => {
    const result = parseDishExpression('el pollo frito');
    expect(result.query).toBe('pollo frito');
  });

  it('parseDishExpression strips leading article "la" from dish expression', () => {
    const result = parseDishExpression('la pizza margarita');
    expect(result.query).toBe('pizza margarita');
  });

  // Document the actual API call from NL comparison path to verify consistency
  it('runComparison sends "big mac" not "una big mac" to API when NL text says "una big mac"', async () => {
    const mock = makeMockClient();
    mock.estimate.mockResolvedValue(DATA_A);
    await runComparison('una big mac', 'un whopper', undefined, mock as unknown as ApiClient);
    // First estimate call should have query: 'big mac', not 'una big mac'
    const calls = mock.estimate.mock.calls as Array<[Record<string, unknown>]>;
    expect(calls[0]?.[0]?.['query']).toBe('big mac');
    expect(calls[1]?.[0]?.['query']).toBe('whopper');
  });
});

// ===========================================================================
// NL prefix cross-product: each prefix with multiple separator variants
// The spec says ALL separators must work with ALL NL patterns.
// These cases are not in the developer test suite.
// ===========================================================================

describe('F043: NL prefix × separator cross-product (spec coverage gaps)', () => {
  // qué tiene más <nutrient> × all separators
  it('"qué tiene más proteínas, pollo versus salmón" → detected with "versus"', () => {
    expect(extractComparisonQuery('qué tiene más proteínas, pollo versus salmón'))
      .toEqual({ dishA: 'pollo', dishB: 'salmón', nutrientFocus: 'proteínas' });
  });

  it('"qué tiene más fibra, avena contra pan" → detected with "contra"', () => {
    expect(extractComparisonQuery('qué tiene más fibra, avena contra pan'))
      .toEqual({ dishA: 'avena', dishB: 'pan', nutrientFocus: 'fibra' });
  });

  it('"qué tiene más grasas, pizza y hamburguesa" → detected with "y"', () => {
    expect(extractComparisonQuery('qué tiene más grasas, pizza y hamburguesa'))
      .toEqual({ dishA: 'pizza', dishB: 'hamburguesa', nutrientFocus: 'grasas' });
  });

  // qué tiene menos <nutrient> × separators
  it('"qué tiene menos sodio, pizza versus hamburguesa" → detected with "versus"', () => {
    expect(extractComparisonQuery('qué tiene menos sodio, pizza versus hamburguesa'))
      .toEqual({ dishA: 'pizza', dishB: 'hamburguesa', nutrientFocus: 'sodio' });
  });

  it('"qué tiene menos carbohidratos, arroz y pasta" → detected with "y"', () => {
    expect(extractComparisonQuery('qué tiene menos carbohidratos, arroz y pasta'))
      .toEqual({ dishA: 'arroz', dishB: 'pasta', nutrientFocus: 'carbohidratos' });
  });

  // qué engorda más × separators
  it('"qué engorda más, pizza versus salmón" → "versus" separator', () => {
    expect(extractComparisonQuery('qué engorda más, pizza versus salmón'))
      .toEqual({ dishA: 'pizza', dishB: 'salmón', nutrientFocus: 'calorías' });
  });

  it('"qué engorda más, pizza contra salmón" → "contra" separator', () => {
    expect(extractComparisonQuery('qué engorda más, pizza contra salmón'))
      .toEqual({ dishA: 'pizza', dishB: 'salmón', nutrientFocus: 'calorías' });
  });

  it('"qué engorda más, pizza vs salmón" → "vs" separator', () => {
    expect(extractComparisonQuery('qué engorda más, pizza vs salmón'))
      .toEqual({ dishA: 'pizza', dishB: 'salmón', nutrientFocus: 'calorías' });
  });

  // qué es más sano × separators
  it('"qué es más sano, ensalada versus bollo" → "versus" separator', () => {
    expect(extractComparisonQuery('qué es más sano, ensalada versus bollo'))
      .toEqual({ dishA: 'ensalada', dishB: 'bollo', nutrientFocus: undefined });
  });

  it('"qué es más sana, ensalada o bollo" → "sana" variant detected', () => {
    // The prefix regex: /^qu[eé]\s+es\s+m[aá]s\s+san[oa],?\s+/i
    // "sana" has 'a' at the end → san[oa] should match
    expect(extractComparisonQuery('qué es más sana, ensalada o bollo'))
      .toEqual({ dishA: 'ensalada', dishB: 'bollo', nutrientFocus: undefined });
  });

  // compara[r] × separators
  it('"comparar arroz versus pasta" → detected with "versus"', () => {
    expect(extractComparisonQuery('comparar arroz versus pasta'))
      .toEqual({ dishA: 'arroz', dishB: 'pasta', nutrientFocus: undefined });
  });

  it('"compara pizza contra hamburguesa" → detected with "contra"', () => {
    expect(extractComparisonQuery('compara pizza contra hamburguesa'))
      .toEqual({ dishA: 'pizza', dishB: 'hamburguesa', nutrientFocus: undefined });
  });

  it('"compara pizza o hamburguesa" → detected with "o"', () => {
    expect(extractComparisonQuery('compara pizza o hamburguesa'))
      .toEqual({ dishA: 'pizza', dishB: 'hamburguesa', nutrientFocus: undefined });
  });

  it('"compara pizza y hamburguesa" → detected with "y"', () => {
    expect(extractComparisonQuery('compara pizza y hamburguesa'))
      .toEqual({ dishA: 'pizza', dishB: 'hamburguesa', nutrientFocus: undefined });
  });

  // Nutrient token 'sal' cross-product
  it('"qué tiene menos sal, pizza versus hamburguesa" → nutrientFocus sal', () => {
    expect(extractComparisonQuery('qué tiene menos sal, pizza versus hamburguesa'))
      .toEqual({ dishA: 'pizza', dishB: 'hamburguesa', nutrientFocus: 'sal' });
  });

  // "hidratos" alias for carbohidratos
  it('"qué tiene más hidratos, arroz versus pan" → nutrientFocus carbohidratos', () => {
    expect(extractComparisonQuery('qué tiene más hidratos, arroz versus pan'))
      .toEqual({ dishA: 'arroz', dishB: 'pan', nutrientFocus: 'carbohidratos' });
  });
});

// ===========================================================================
// splitByComparator: additional edge cases
// ===========================================================================

describe('F043: splitByComparator additional edge cases', () => {
  it('handles VERSUS (uppercase) case-insensitively', () => {
    expect(splitByComparator('big mac VERSUS whopper')).toEqual(['big mac', 'whopper']);
  });

  it('"o" inside a word is not matched (no word boundary issue since space-flanked)', () => {
    // "pollo" contains 'o' but it's not space-flanked
    expect(splitByComparator('pollo')).toBeNull();
  });

  it('"y" inside a word (e.g. "yogur") is not matched', () => {
    // "yogur" contains 'y' at start but not space-flanked
    expect(splitByComparator('yogur')).toBeNull();
  });

  it('multiple spaces around separator are handled', () => {
    // "big mac  vs  whopper" — double spaces
    // regex \b vs \.? (?=\s|$) — the \b should still match
    const result = splitByComparator('big mac  vs  whopper');
    // After split: left='big mac', right='whopper' (trimmed)
    expect(result).not.toBeNull();
  });

  it('separator at very start (left side empty) returns null', () => {
    expect(splitByComparator(' vs whopper')).toBeNull();
  });

  it('separator at very end (right side empty) returns null', () => {
    expect(splitByComparator('big mac vs ')).toBeNull();
  });

  it('only separator token, no dishes on either side', () => {
    expect(splitByComparator('vs')).toBeNull();
  });

  it('"pollo o cerdo o ternera" (three dishes) — last "o" splits correctly', () => {
    // Last 'o' wins → ['pollo o cerdo', 'ternera']
    const result = splitByComparator('pollo o cerdo o ternera');
    expect(result).toEqual(['pollo o cerdo', 'ternera']);
  });
});

// ===========================================================================
// parseDishExpression: additional edge cases
// ===========================================================================

describe('F043: parseDishExpression additional edge cases', () => {
  it('empty string returns empty query and portionMultiplier 1.0', () => {
    const result = parseDishExpression('');
    expect(result.query).toBe('');
    expect(result.portionMultiplier).toBe(1.0);
    expect(result.chainSlug).toBeUndefined();
  });

  it('only whitespace returns empty query', () => {
    const result = parseDishExpression('   ');
    expect(result.query).toBe('');
    expect(result.portionMultiplier).toBe(1.0);
  });

  it('chain slug with trailing dot in candidate is NOT extracted', () => {
    // 'big mac en mcdonalds-es.' — the slug has trailing dot, fails CHAIN_SLUG_REGEX
    const result = parseDishExpression('big mac en mcdonalds-es.');
    // CHAIN_SLUG_REGEX = /^[a-z0-9-]+-[a-z0-9-]+$/ — the '.' fails
    expect(result.chainSlug).toBeUndefined();
    expect(result.query).toContain('big mac');
  });

  it('chain slug with uppercase letters is NOT extracted (case-sensitive regex)', () => {
    // CHAIN_SLUG_REGEX only matches lowercase
    const result = parseDishExpression('big mac en McDonalds-ES');
    expect(result.chainSlug).toBeUndefined();
  });

  it('portion modifier "triple" extracts correctly', () => {
    const result = parseDishExpression('triple whopper');
    expect(result.portionMultiplier).toBe(3.0);
    expect(result.query).toBe('whopper');
  });

  it('portion modifier "media" extracts correctly', () => {
    const result = parseDishExpression('media pizza');
    expect(result.portionMultiplier).toBe(0.5);
    expect(result.query).toBe('pizza');
  });
});

// ===========================================================================
// runComparison: edge cases not in the developer test suite
// ===========================================================================

describe('F043: runComparison additional edge cases', () => {
  let client: MockApiClient;

  beforeEach(() => {
    client = makeMockClient();
  });

  it('both estimates reject with TIMEOUT → handleApiError(first error) is returned', async () => {
    client.estimate
      .mockRejectedValueOnce(new ApiError(408, 'TIMEOUT', 'Timeout'))
      .mockRejectedValueOnce(new ApiError(408, 'TIMEOUT', 'Timeout'));
    const result = await runComparison('big mac', 'whopper', undefined, client as unknown as ApiClient);
    // Both TIMEOUT → should return handleApiError error string
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // Should NOT throw — handled by both-reject path
  });

  it('first estimate rejects with TIMEOUT, second resolves → partial path with timeout note', async () => {
    client.estimate
      .mockRejectedValueOnce(new ApiError(408, 'TIMEOUT', 'Timeout'))
      .mockResolvedValueOnce(DATA_B);
    const result = await runComparison('big mac', 'whopper', undefined, client as unknown as ApiClient);
    expect(result).toContain('Tiempo de espera agotado');
  });

  it('second estimate rejects with non-ApiError → rethrows (wrapHandler catches it)', async () => {
    client.estimate
      .mockResolvedValueOnce(DATA_A)
      .mockRejectedValueOnce(new TypeError('Network crash'));
    await expect(
      runComparison('big mac', 'whopper', undefined, client as unknown as ApiClient),
    ).rejects.toThrow(TypeError);
  });

  it('first estimate rejects with non-ApiError → rethrows even though second would succeed', async () => {
    // The order matters: if first settlement is unknown error, it rethrows
    // before checking second
    client.estimate
      .mockRejectedValueOnce(new TypeError('Unknown crash'))
      .mockResolvedValueOnce(DATA_B);
    await expect(
      runComparison('big mac', 'whopper', undefined, client as unknown as ApiClient),
    ).rejects.toThrow(TypeError);
  });

  it('nutrientFocus "sal" is correctly passed to formatter (shows in foco label)', async () => {
    client.estimate.mockResolvedValue(DATA_A);
    const result = await runComparison('pizza', 'hamburguesa', 'sal', client as unknown as ApiClient);
    expect(result).toContain('(foco)');
    expect(result).toContain('Sal');
  });

  it('nutrientFocus "carbohidratos" shows foco label', async () => {
    client.estimate.mockResolvedValue(DATA_A);
    const result = await runComparison('arroz', 'pasta', 'carbohidratos', client as unknown as ApiClient);
    expect(result).toContain('(foco)');
    expect(result).toContain('Carbohidr');
  });

  it('parseDishExpression is called on both dish text arguments (portionMultiplier propagated)', async () => {
    client.estimate.mockResolvedValue(DATA_A);
    await runComparison('doble whopper', 'big mac grande', undefined, client as unknown as ApiClient);
    const calls = client.estimate.mock.calls as Array<[Record<string, unknown>]>;
    expect(calls[0]?.[0]?.['portionMultiplier']).toBe(2.0);
    expect(calls[1]?.[0]?.['portionMultiplier']).toBe(1.5);
  });

  it('both dishes resolve to null → returns both-null error message', async () => {
    client.estimate.mockResolvedValue(DATA_NULL);
    const result = await runComparison('unknownA', 'unknownB', undefined, client as unknown as ApiClient);
    expect(result).toContain('No se encontraron datos nutricionales para ninguno de los platos');
  });
});

// ===========================================================================
// formatComparison: MarkdownV2 correctness — additional checks
// ===========================================================================

describe('F043: formatComparison MarkdownV2 correctness edge cases', () => {
  it('hyphens in display names are escaped in the bold header', () => {
    const hyphenNameA = makeEstimateData({
      result: { name: 'Big-Mac', nameEs: 'Big-Mac', nutrients: NUTRIENTS_A, confidenceLevel: 'high' },
    });
    const out = formatComparison(hyphenNameA, DATA_B);
    const headerLine = out.split('\n')[0] ?? '';
    // '-' is reserved in MarkdownV2 — must be escaped outside code block
    expect(headerLine).toContain('Big\\-Mac');
  });

  it('parentheses in display names are escaped in the bold header', () => {
    const parenName = makeEstimateData({
      result: { name: 'Big Mac (Original)', nameEs: 'Big Mac (Original)', nutrients: NUTRIENTS_A, confidenceLevel: 'high' },
    });
    const out = formatComparison(parenName, DATA_B);
    const headerLine = out.split('\n')[0] ?? '';
    // '(' and ')' are reserved — must be escaped
    expect(headerLine).toContain('\\(Original\\)');
  });

  it('code block contains exactly one opening and one closing triple backtick', () => {
    const out = formatComparison(DATA_A, DATA_B);
    const backtickMatches = out.match(/```/g) ?? [];
    expect(backtickMatches.length).toBe(2);
  });

  it('confidence line is outside the code block (appears after closing ```)', () => {
    const out = formatComparison(DATA_A, DATA_B);
    const closeIdx = out.lastIndexOf('```');
    const confIdx = out.indexOf('_Confianza:');
    expect(confIdx).toBeGreaterThan(closeIdx);
  });

  it('nutrientFocus "sodio" renders focus row first with (foco) label', () => {
    const out = formatComparison(DATA_A, DATA_B, 'sodio');
    const codeBlock = out.match(/```\n([\s\S]*?)```/)?.[1] ?? '';
    const lines = codeBlock.split('\n').filter(l => l.trim());
    const firstDataRow = lines.find(l => l.includes('(foco)'));
    expect(firstDataRow).toContain('Sodio');
  });

  it('when both sodium values are equal, focus row shows "—" tie indicator', () => {
    const equalSodiumA = makeEstimateData({
      result: { name: 'A', nameEs: 'A', nutrients: { ...NUTRIENTS_A, sodium: 500 }, confidenceLevel: 'high' },
    });
    const equalSodiumB = makeEstimateData({
      result: { name: 'B', nameEs: 'B', nutrients: { ...NUTRIENTS_B, sodium: 500 }, confidenceLevel: 'high' },
    });
    const out = formatComparison(equalSodiumA, equalSodiumB, 'sodio');
    const codeBlock = out.match(/```\n([\s\S]*?)```/)?.[1] ?? '';
    const focusLine = codeBlock.split('\n').find(l => l.includes('(foco)'));
    expect(focusLine).toContain('—');
  });

  it('carbohydrates row shows NO ✅ by default (nutritionally ambiguous)', () => {
    const out = formatComparison(DATA_A, DATA_B);
    const codeBlock = out.match(/```\n([\s\S]*?)```/)?.[1] ?? '';
    const carbLine = codeBlock.split('\n').find(l => l.includes('Carbohidr'));
    // No ✅ indicator for carbs unless it's the nutrientFocus
    expect(carbLine).not.toContain('✅');
  });

  it('carbohydrates row shows ✅ on lower side when nutrientFocus is "carbohidratos"', () => {
    // DATA_A has carbs 45, DATA_B has carbs 56 → A is lower → A wins
    const out = formatComparison(DATA_A, DATA_B, 'carbohidratos');
    const codeBlock = out.match(/```\n([\s\S]*?)```/)?.[1] ?? '';
    const carbLine = codeBlock.split('\n').find(l => l.includes('Carbohidr'));
    expect(carbLine).toContain('✅');
    // ✅ should be before the higher value (56)
    const checkIdx = carbLine?.indexOf('✅') ?? -1;
    const val56Idx = carbLine?.indexOf('56') ?? -1;
    expect(checkIdx).toBeLessThan(val56Idx);
  });

  it('optional row shown when value is 0 in one dish but > 0 in the other', () => {
    const zeroFiberA = makeEstimateData({
      result: { name: 'A', nameEs: 'A', nutrients: { ...NUTRIENTS_A, fiber: 0 }, confidenceLevel: 'high' },
    });
    const nonZeroFiberB = makeEstimateData({
      result: { name: 'B', nameEs: 'B', nutrients: { ...NUTRIENTS_B, fiber: 2.5 }, confidenceLevel: 'high' },
    });
    const out = formatComparison(zeroFiberA, nonZeroFiberB);
    const codeBlock = out.match(/```\n([\s\S]*?)```/)?.[1] ?? '';
    // Fiber row MUST appear (B has fiber > 0)
    expect(codeBlock).toContain('Fibra');
  });

  it('error note partial path: A null with timeout, B available — shows timeout note', () => {
    const out = formatComparison(DATA_NULL, DATA_B, undefined, { errorNoteA: 'timeout' });
    expect(out).toContain('Tiempo de espera agotado');
    expect(out).toContain('Whopper');
  });

  it('error note partial path: A available, B null with error — shows no-data note', () => {
    const out = formatComparison(DATA_A, DATA_NULL, undefined, { errorNoteB: 'error' });
    expect(out).toContain('No se encontraron datos');
    expect(out).toContain('Big Mac');
  });

  it('portion multiplier line uses escaped dot for value in MarkdownV2 footer', () => {
    const bigA = makeEstimateData({
      query: 'big mac grande',
      portionMultiplier: 1.5,
      result: { name: 'Big Mac', nameEs: 'Big Mac', nutrients: NUTRIENTS_A, confidenceLevel: 'high' },
    });
    const out = formatComparison(bigA, DATA_B);
    // The portion line is outside code block, so '.' in '1.5' must be escaped
    // _Porción Big Mac: grande \(x1\.5\)_
    expect(out).toMatch(/x1\\\.5/);
  });

  it('chain slugs with hyphens are escaped in the footer line', () => {
    const chainA = makeEstimateData({
      query: 'big mac',
      result: {
        name: 'Big Mac', nameEs: 'Big Mac',
        nutrients: NUTRIENTS_A, confidenceLevel: 'high',
        chainSlug: 'mcdonalds-es',
      },
    });
    const chainB = makeEstimateData({
      query: 'whopper',
      result: {
        name: 'Whopper', nameEs: 'Whopper',
        nutrients: NUTRIENTS_B, confidenceLevel: 'medium',
        chainSlug: 'burger-king-es',
      },
    });
    const out = formatComparison(chainA, chainB);
    // Hyphens in chain slugs must be escaped outside code block
    expect(out).toContain('mcdonalds\\-es');
    expect(out).toContain('burger\\-king\\-es');
  });
});

// ===========================================================================
// bot.ts registration: /comparar command wiring
// ===========================================================================

describe('F043: bot.ts /comparar command registration', () => {
  it('/comparar regex matches bare command with no args', () => {
    const regex = /^\/comparar(?:@\w+)?(?:\s+(.+))?$/s;
    expect(regex.test('/comparar')).toBe(true);
  });

  it('/comparar regex matches with args', () => {
    const regex = /^\/comparar(?:@\w+)?(?:\s+(.+))?$/s;
    expect(regex.test('/comparar big mac vs whopper')).toBe(true);
  });

  it('/comparar regex matches with @botname', () => {
    const regex = /^\/comparar(?:@\w+)?(?:\s+(.+))?$/s;
    expect(regex.test('/comparar@mybot big mac vs whopper')).toBe(true);
  });

  it('/comparar regex captures args in group 1', () => {
    const regex = /^\/comparar(?:@\w+)?(?:\s+(.+))?$/s;
    const match = regex.exec('/comparar big mac vs whopper');
    expect(match?.[1]).toBe('big mac vs whopper');
  });

  it('/comparar regex handles multiline args (dotAll flag)', () => {
    // dotAll 's' flag allows '.' to match newlines
    const regex = /^\/comparar(?:@\w+)?(?:\s+(.+))?$/s;
    const match = regex.exec('/comparar big mac\nvs whopper');
    expect(match).not.toBeNull();
    expect(match?.[1]).toContain('big mac');
  });

  it('/comparar regex does NOT match /comparar2 or /compararx (wrong command)', () => {
    const regex = /^\/comparar(?:@\w+)?(?:\s+(.+))?$/s;
    // These should not match — different commands
    expect(regex.test('/compararx big mac vs whopper')).toBe(false);
    expect(regex.test('/comparar2')).toBe(false);
  });
});
