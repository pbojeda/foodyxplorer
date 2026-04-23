// Unit tests for F-NLP-CHAIN-ORDERING
//
// Covers:
//   Cycle 1: H5-A canonical + digit variant (AC1, AC2, AC3)
//   Cycle 2: Post-count normalization — CONTAINER_PATTERNS + POST_COUNT_SERVING_PATTERNS (AC4, AC5)
//   Cycle 3: Regression guards — no-wrapper+count, wrapper+no-count, wrapper+article (AC6, AC7, AC8, AC10)
//   Cycle 4: F076 menu contract preserved (AC9)
//   Cycle 5: Error safety (AC11)
//
// TDD — RED → GREEN per cycle. See Implementation Plan for per-cycle RED/GREEN transitions.

import { describe, it, expect } from 'vitest';
import {
  extractPortionModifier,
  extractFoodQuery,
  CONTAINER_PATTERNS,
} from '../conversation/entityExtractor.js';
import { detectMenuQuery } from '../conversation/menuDetector.js';

// POST_COUNT_SERVING_PATTERNS accessed via namespace import to allow runtime export check
import * as entityExtractor from '../conversation/entityExtractor.js';

// ---------------------------------------------------------------------------
// Cycle 1 — H5-A: wrapper + count extraction (AC1, AC2, AC3)
// ---------------------------------------------------------------------------

describe('Cycle 1 — H5-A: extractFoodQuery then extractPortionModifier on wrapper+count inputs', () => {

  it('extractPortionModifier on wrapper-stripped text: "dos cañas de cerveza" → multiplier 2', () => {
    // Simulates the corrected pipeline: wrapper already stripped by extractFoodQuery
    const r = extractPortionModifier('dos cañas de cerveza');
    expect(r.portionMultiplier).toBe(2);
  });

  it('extractPortionModifier on wrapper-stripped text: "dos cañas" → multiplier 2', () => {
    const r = extractPortionModifier('dos cañas');
    expect(r.portionMultiplier).toBe(2);
  });

  it('extractPortionModifier on wrapper-stripped text: "3 cañas" → multiplier 3', () => {
    const r = extractPortionModifier('3 cañas');
    expect(r.portionMultiplier).toBe(3);
  });

  it('full chain: extractFoodQuery then extractPortionModifier on "me he bebido dos cañas de cerveza" → multiplier 2', () => {
    // Pattern 1 matches "me he bebido " → strips wrapper
    const { query } = extractFoodQuery('me he bebido dos cañas de cerveza');
    const r = extractPortionModifier(query);
    expect(r.portionMultiplier).toBe(2);
  });

  it('full chain: extractFoodQuery then extractPortionModifier on "acabo de beberme dos cañas" → multiplier 2 (AC2)', () => {
    // RED until Step 3 (wrapper pattern 5 + clitic (?:me)? fix)
    // Pattern 5 currently: /^acabo\s+de\s+(?:comer|tomar|beber|...)\s+/i
    // "beberme" contains the clitic suffix "me" — does NOT match until fix
    const { query } = extractFoodQuery('acabo de beberme dos cañas');
    const r = extractPortionModifier(query);
    expect(r.portionMultiplier).toBe(2);
  });

  it('full chain: extractFoodQuery then extractPortionModifier on "acabo de beberme 3 cañas" → multiplier 3 (AC3)', () => {
    // RED until Step 3 (same clitic fix)
    const { query } = extractFoodQuery('acabo de beberme 3 cañas');
    const r = extractPortionModifier(query);
    expect(r.portionMultiplier).toBe(3);
  });

});

// ---------------------------------------------------------------------------
// Cycle 2 — Post-count normalization: CONTAINER_PATTERNS plural + POST_COUNT_SERVING_PATTERNS
// ---------------------------------------------------------------------------

describe('Cycle 2 — CONTAINER_PATTERNS plural forms (AC4)', () => {

  it('CONTAINER_PATTERNS: /platos? de/ matches "platos de paella" (plural form — RED until Step 4)', () => {
    // RED until CONTAINER_PATTERNS is extended with plural forms
    const matches = CONTAINER_PATTERNS.some((p) => p.test('platos de paella'));
    expect(matches).toBe(true);
  });

  it('CONTAINER_PATTERNS: still matches "plato de paella" (singular — backward compatible)', () => {
    const matches = CONTAINER_PATTERNS.some((p) => p.test('plato de paella'));
    expect(matches).toBe(true);
  });

  it('CONTAINER_PATTERNS: does NOT match "café con leche" (false-positive guard)', () => {
    const matches = CONTAINER_PATTERNS.some((p) => p.test('café con leche'));
    expect(matches).toBe(false);
  });

  it('CONTAINER_PATTERNS: does NOT match "cañas de cerveza" (drink serving — must not be stripped)', () => {
    const matches = CONTAINER_PATTERNS.some((p) => p.test('cañas de cerveza'));
    expect(matches).toBe(false);
  });

});

describe('Cycle 2 — POST_COUNT_SERVING_PATTERNS (AC5)', () => {

  it('POST_COUNT_SERVING_PATTERNS: exported from entityExtractor (RED until Step 4 adds the export)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime export check
    expect((entityExtractor as any)['POST_COUNT_SERVING_PATTERNS']).toBeDefined();
  });

  it('POST_COUNT_SERVING_PATTERNS: matches "tapas de croquetas" (AC5 — non-drink serving prefix)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime export check
    const patterns = (entityExtractor as any)['POST_COUNT_SERVING_PATTERNS'] as RegExp[];
    const matches = patterns.some((p) => p.test('tapas de croquetas'));
    expect(matches).toBe(true);
  });

  it('POST_COUNT_SERVING_PATTERNS: does NOT match "cañas de cerveza" (drink vessel — must not be stripped)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime export check
    const patterns = (entityExtractor as any)['POST_COUNT_SERVING_PATTERNS'] as RegExp[];
    const matches = patterns.some((p) => p.test('cañas de cerveza'));
    expect(matches).toBe(false);
  });

  it('POST_COUNT_SERVING_PATTERNS: does NOT match "platos de paella" (container, not serving)', () => {
    // Covered by CONTAINER_PATTERNS, not POST_COUNT_SERVING_PATTERNS
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime export check
    const patterns = (entityExtractor as any)['POST_COUNT_SERVING_PATTERNS'] as RegExp[];
    const matches = patterns.some((p) => p.test('platos de paella'));
    expect(matches).toBe(false);
  });

});

describe('Cycle 2 — stripContainerResidual full chain simulation (AC4, AC5)', () => {

  it('AC4 full chain: extractFoodQuery → extractPortionModifier → manual CONTAINER strip on "he comido dos platos de paella" → "paella"', () => {
    // Simulates: stripContainerResidual(cleanQuery) when portionMultiplier > 1
    const { query: stripped } = extractFoodQuery('he comido dos platos de paella');
    // stripped = "dos platos de paella" (wrapper "he comido " removed; "dos" is not an article)
    const { cleanQuery, portionMultiplier } = extractPortionModifier(stripped);
    // cleanQuery = "platos de paella", portionMultiplier = 2
    expect(portionMultiplier).toBe(2);

    // Simulate stripContainerResidual: iterate CONTAINER_PATTERNS
    let residual = cleanQuery;
    for (const p of CONTAINER_PATTERNS) {
      const s = residual.replace(p, '').trim();
      if (s !== residual && s.length > 0) { residual = s; break; }
    }
    expect(residual).toBe('paella');
  });

  it('AC5 full chain: extractFoodQuery → extractPortionModifier → manual POST_COUNT_SERVING strip on "me he tomado tres tapas de croquetas" → "croquetas"', () => {
    const { query: stripped } = extractFoodQuery('me he tomado tres tapas de croquetas');
    // wrapper "me he tomado " removed → "tres tapas de croquetas"
    const { cleanQuery, portionMultiplier } = extractPortionModifier(stripped);
    // cleanQuery = "tapas de croquetas", portionMultiplier = 3
    expect(portionMultiplier).toBe(3);

    // Simulate stripContainerResidual: CONTAINER_PATTERNS first (no match on "tapas de")
    // then POST_COUNT_SERVING_PATTERNS
    let residual = cleanQuery;

    // CONTAINER_PATTERNS pass (no match expected)
    for (const p of CONTAINER_PATTERNS) {
      const s = residual.replace(p, '').trim();
      if (s !== residual && s.length > 0) { residual = s; break; }
    }
    // Still "tapas de croquetas"

    // POST_COUNT_SERVING_PATTERNS pass
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime export check
    const postCountPatterns = (entityExtractor as any)['POST_COUNT_SERVING_PATTERNS'] as RegExp[];
    for (const p of postCountPatterns) {
      const s = residual.replace(p, '').trim();
      if (s !== residual && s.length > 0) { residual = s; break; }
    }
    expect(residual).toBe('croquetas');
  });

});

// ---------------------------------------------------------------------------
// Cycle 3 — Regression guards (AC6, AC7, AC8, AC10)
// ---------------------------------------------------------------------------

describe('Cycle 3 — Regression guards on existing pipeline paths', () => {

  it('regression AC6: extractFoodQuery("he comido paella") → query "paella", multiplier 1', () => {
    const { query } = extractFoodQuery('he comido paella');
    expect(query).toBe('paella');
    const r = extractPortionModifier(query);
    expect(r.portionMultiplier).toBe(1);
    expect(r.cleanQuery).toBe('paella');
  });

  it('regression AC7: extractFoodQuery("dos cañas de cerveza") is a no-op (no wrapper)', () => {
    // "dos" is not an article/wrapper — extractFoodQuery returns input unchanged
    const { query } = extractFoodQuery('dos cañas de cerveza');
    expect(query).toBe('dos cañas de cerveza');
  });

  it('regression AC7: extractPortionModifier("dos cañas de cerveza") → multiplier 2, cleanQuery "cañas de cerveza"', () => {
    const r = extractPortionModifier('dos cañas de cerveza');
    expect(r.portionMultiplier).toBe(2);
    expect(r.cleanQuery).toBe('cañas de cerveza');
  });

  it('regression AC8: full chain on "me he tomado un café con leche" → multiplier 1, cleanQuery "café con leche"', () => {
    // Wrapper "me he tomado " stripped → "un café con leche"
    // ARTICLE_PATTERN strips "un " → "café con leche"
    // extractPortionModifier("café con leche") → no leading count → multiplier 1
    // "con leche" is NOT in CONTAINER_PATTERNS — no false positive
    const { query } = extractFoodQuery('me he tomado un café con leche');
    expect(query).toBe('café con leche');
    const r = extractPortionModifier(query);
    expect(r.portionMultiplier).toBe(1);
    expect(r.cleanQuery).toBe('café con leche');
  });

  it('regression AC10: extractFoodQuery("2 bocadillos de jamón") is a no-op (no wrapper)', () => {
    const { query } = extractFoodQuery('2 bocadillos de jamón');
    expect(query).toBe('2 bocadillos de jamón');
  });

  it('regression AC10: extractPortionModifier("2 bocadillos de jamón") → multiplier 2, cleanQuery "bocadillos de jamón"', () => {
    const r = extractPortionModifier('2 bocadillos de jamón');
    expect(r.portionMultiplier).toBe(2);
    expect(r.cleanQuery).toBe('bocadillos de jamón');
  });

});

// ---------------------------------------------------------------------------
// Cycle 4 — F076 menu contract preserved (AC9)
// ---------------------------------------------------------------------------

describe('Cycle 4 — F076 menu contract: detectMenuQuery (AC9)', () => {

  it('regression AC9: detectMenuQuery("hoy he comido de menú: paella y vino") → non-null, 2 items', () => {
    // Verifies the existing F076 contract is intact.
    // Cross-reference: f076.menuDetector.unit.test.ts:183 asserts no trigger → null.
    const result = detectMenuQuery('hoy he comido de menú: paella y vino');
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result?.[0]).toMatch(/paella/i);
    expect(result?.[1]).toMatch(/vino/i);
  });

  it('regression: detectMenuQuery("gazpacho, pollo, flan") → null (no trigger keyword)', () => {
    // Mirrors f076.menuDetector.unit.test.ts:183
    const result = detectMenuQuery('gazpacho, pollo, flan');
    expect(result).toBeNull();
  });

});

// ---------------------------------------------------------------------------
// Cycle 5 — Error safety (AC11)
// ---------------------------------------------------------------------------

describe('Cycle 5 — Error safety on unparseable wrapped input (AC11)', () => {

  it('extractFoodQuery("me he comido algo muy rico") → non-empty query, no throw', () => {
    let result: { query: string } | undefined;
    expect(() => {
      result = extractFoodQuery('me he comido algo muy rico');
    }).not.toThrow();
    expect(result?.query).toBeTruthy();
  });

  it('extractPortionModifier after extractFoodQuery on "me he comido algo muy rico" → multiplier 1, no throw', () => {
    const { query } = extractFoodQuery('me he comido algo muy rico');
    let r: { portionMultiplier: number } | undefined;
    expect(() => {
      r = extractPortionModifier(query);
    }).not.toThrow();
    expect(r?.portionMultiplier).toBe(1);
  });

});
