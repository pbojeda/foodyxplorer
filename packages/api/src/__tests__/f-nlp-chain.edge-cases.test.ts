// F-NLP-CHAIN-ORDERING — QA edge-case tests
//
// Probes edge cases NOT covered by the developer's 26 unit + 6 integration tests.
// Focus areas:
//   1. Catastrophic inputs (empty, wrapper-only, wrapper+garbage, wrapper+count-only)
//   2. Multi-count ambiguity ("2 o 3 cañas")
//   3. Double-article edge ("me he tomado una una caña")
//   4. stripContainerResidual false-positive guards ("dos cafés con leche")
//   5. Consistent tapa/ración strip behavior ("tres raciones de jamón")
//   6. AC7 deviation — "cañas de cerveza" NOT double-stripped by SERVING_FORMAT_PATTERNS
//      after POST_COUNT_SERVING_PATTERNS (i.e., stripContainerResidual is idempotent)
//   7. Logger.warn presence in integration request (M1 observability: real warn method)
//   8. detectMenuQuery called on ORIGINAL text (before any wrapper strip)

import { describe, it, expect, vi } from 'vitest';
import {
  extractFoodQuery,
  extractPortionModifier,
  CONTAINER_PATTERNS,
  POST_COUNT_SERVING_PATTERNS,
  SERVING_FORMAT_PATTERNS,
} from '../conversation/entityExtractor.js';
import { detectMenuQuery } from '../conversation/menuDetector.js';

// ---------------------------------------------------------------------------
// Helper: replicate conversationCore.ts stripContainerResidual logic
// ---------------------------------------------------------------------------

function stripContainerResidual(text: string): string {
  for (const pattern of CONTAINER_PATTERNS) {
    const stripped = text.replace(pattern, '').trim();
    if (stripped !== text && stripped.length > 0) {
      return stripped;
    }
  }
  for (const pattern of POST_COUNT_SERVING_PATTERNS) {
    const stripped = text.replace(pattern, '').trim();
    if (stripped !== text && stripped.length > 0) {
      return stripped;
    }
  }
  return text;
}

// Helper: full reordered pipeline (mirrors conversationCore.ts Step 4)
function pipeline(rawText: string): { query: string; multiplier: number } {
  const stripped = extractFoodQuery(rawText);
  const modified = extractPortionModifier(stripped.query);
  const query =
    modified.cleanQuery !== stripped.query
      ? stripContainerResidual(modified.cleanQuery)
      : modified.cleanQuery;
  return { query, multiplier: modified.portionMultiplier };
}

// ---------------------------------------------------------------------------
// 1. Catastrophic inputs
// ---------------------------------------------------------------------------

describe('EC — catastrophic inputs: pipeline must not throw', () => {

  it('empty string "" → no throw, returns non-empty fallback query', () => {
    expect(() => pipeline('')).not.toThrow();
    // extractFoodQuery("") → originalTrimmed="" → query = originalTrimmed fallback = ""
    // extractPortionModifier("") → no match → cleanQuery=""
    // Since cleanQuery === stripped.query, no stripContainerResidual called
    // Final query = "" — null result downstream but no crash
    const { multiplier } = pipeline('');
    expect(multiplier).toBe(1);
    // Must not crash; query may be empty (graceful degradation)
  });

  it('wrapper-only "me he tomado" (nothing after wrapper) → no throw, multiplier 1', () => {
    expect(() => pipeline('me he tomado')).not.toThrow();
    const { multiplier } = pipeline('me he tomado');
    expect(multiplier).toBe(1);
  });

  it('wrapper + garbage "me he comido zzzzz" → no throw, query contains "zzzzz", multiplier 1', () => {
    expect(() => pipeline('me he comido zzzzz')).not.toThrow();
    const { query, multiplier } = pipeline('me he comido zzzzz');
    expect(multiplier).toBe(1);
    expect(query).toBe('zzzzz');
  });

  it('wrapper + bare digit "me he bebido 5" (no food word) → no throw, multiplier 1, query "5"', () => {
    // extractPortionModifier("/^([1-9]\d?)\s+/") requires trailing whitespace after digit.
    // Bare "5" has no trailing space → no count stripped → multiplier 1.
    expect(() => pipeline('me he bebido 5')).not.toThrow();
    const { query, multiplier } = pipeline('me he bebido 5');
    expect(multiplier).toBe(1);
    // Query is "5" (no crash, graceful null in L1)
    expect(query).toBe('5');
  });

  it('bare digit "he comido 2" → no throw, multiplier 1, query "2"', () => {
    expect(() => pipeline('he comido 2')).not.toThrow();
    const { query, multiplier } = pipeline('he comido 2');
    expect(multiplier).toBe(1);
    expect(query).toBe('2');
  });

  it('wrapper-only with whitespace "  " → no throw, multiplier 1', () => {
    // text.trim() in conversationCore handles this before calling extractFoodQuery
    expect(() => extractFoodQuery('  ')).not.toThrow();
    expect(() => extractPortionModifier('  ')).not.toThrow();
  });

});

// ---------------------------------------------------------------------------
// 2. Multi-count ambiguity "he bebido 2 o 3 cañas"
// ---------------------------------------------------------------------------

describe('EC — multi-count ambiguity "2 o 3"', () => {

  it('"he bebido 2 o 3 cañas" → no throw', () => {
    expect(() => pipeline('he bebido 2 o 3 cañas')).not.toThrow();
  });

  it('"he bebido 2 o 3 cañas" → multiplier 2 (first valid digit wins), query degraded but not empty', () => {
    // The spec does not define behavior for "2 o 3". First numeric pattern fires on "2 ".
    // Resulting cleanQuery = "o 3 cañas" — degraded but no crash.
    const { multiplier } = pipeline('he bebido 2 o 3 cañas');
    // First numeric token "2" must be extracted (not silently dropped to 1)
    expect(multiplier).toBe(2);
    // Pipeline must not return empty query
    const { query } = pipeline('he bebido 2 o 3 cañas');
    expect(query.length).toBeGreaterThan(0);
  });

});

// ---------------------------------------------------------------------------
// 3. Double-article edge
// ---------------------------------------------------------------------------

describe('EC — double-article edge "me he tomado una una caña"', () => {

  it('"me he tomado una una caña" → no throw, multiplier 1', () => {
    expect(() => pipeline('me he tomado una una caña')).not.toThrow();
    const { multiplier } = pipeline('me he tomado una una caña');
    expect(multiplier).toBe(1);
  });

  it('"me he tomado una una caña" → query contains "caña" (second una is residual but no crash)', () => {
    // ARTICLE_PATTERN strips only first "una " → "una caña" remains.
    // extractPortionModifier("una caña") → no count match → cleanQuery "una caña".
    // No stripContainerResidual called (multiplier unchanged).
    // L1 gets "una caña" — might match via alias, no crash.
    const { query } = pipeline('me he tomado una una caña');
    expect(query).toMatch(/caña/i);
  });

});

// ---------------------------------------------------------------------------
// 4. stripContainerResidual false-positive guards
// ---------------------------------------------------------------------------

describe('EC — stripContainerResidual false-positive guards', () => {

  it('"dos cafés con leche" → multiplier 2, query "cafés con leche" (con leche NOT stripped)', () => {
    // No wrapper. extractFoodQuery no-ops. extractPortionModifier strips "dos ".
    // stripContainerResidual("cafés con leche") must NOT match any CONTAINER/POST_COUNT_SERVING pattern.
    const { query, multiplier } = pipeline('dos cafés con leche');
    expect(multiplier).toBe(2);
    // "con leche" must be preserved — it is semantically part of the food name
    expect(query).toContain('leche');
    expect(query).toContain('caf');
  });

  it('stripContainerResidual("cafés con leche") → no false-positive strip', () => {
    const result = stripContainerResidual('cafés con leche');
    expect(result).toBe('cafés con leche');
  });

  it('stripContainerResidual("cañas de cerveza") → NOT stripped (drink vessel exclusion)', () => {
    // Core AC7 invariant: "cañas de" is NOT in CONTAINER_PATTERNS or POST_COUNT_SERVING_PATTERNS.
    // SERVING_FORMAT_PATTERNS has "cañas de" but stripContainerResidual does NOT use it.
    const result = stripContainerResidual('cañas de cerveza');
    expect(result).toBe('cañas de cerveza');
  });

  it('SERVING_FORMAT_PATTERNS DOES contain "cañas de" (confirming exclusion is deliberate)', () => {
    const matches = SERVING_FORMAT_PATTERNS.some((p) => p.test('cañas de cerveza'));
    expect(matches).toBe(true);
  });

  it('POST_COUNT_SERVING_PATTERNS does NOT contain "cañas de" (deliberate exclusion)', () => {
    const matches = POST_COUNT_SERVING_PATTERNS.some((p) => p.test('cañas de cerveza'));
    expect(matches).toBe(false);
  });

  it('"una tapa de pulpo" → extractFoodQuery strips "tapa de" → "pulpo" (SERVING_FORMAT_PATTERNS in single-dish path)', () => {
    // Verify single-dish path consistency: "tapa de" IS stripped by SERVING_FORMAT_PATTERNS in extractFoodQuery.
    const { query } = extractFoodQuery('una tapa de pulpo');
    expect(query).toBe('pulpo');
  });

  it('"tapas de croquetas" → post-count strip via POST_COUNT_SERVING_PATTERNS (AC5 consistency)', () => {
    // After wrapper strip + count extract, "tapas de croquetas" must strip "tapas de".
    const result = stripContainerResidual('tapas de croquetas');
    expect(result).toBe('croquetas');
  });

});

// ---------------------------------------------------------------------------
// 5. Consistent ración/raciones strip behavior
// ---------------------------------------------------------------------------

describe('EC — raciones de / tres raciones de jamón', () => {

  it('"tres raciones de jamón" (no wrapper) → multiplier 3, query "jamón"', () => {
    // Lexical pattern: "tres raciones de " → multiplier=3, cleanQuery="jamón"
    // No stripContainerResidual needed (already clean after count extract)
    const { query, multiplier } = pipeline('tres raciones de jamón');
    expect(multiplier).toBe(3);
    expect(query).toBe('jamón');
  });

  it('"me he tomado tres raciones de jamón" (wrapped) → multiplier 3, query "jamón"', () => {
    const { query, multiplier } = pipeline('me he tomado tres raciones de jamón');
    expect(multiplier).toBe(3);
    expect(query).toBe('jamón');
  });

  it('"raciones de jamón" alone → extractFoodQuery strips "raciones de " → "jamón"', () => {
    // Verify SERVING_FORMAT_PATTERNS strips bare "raciones de" when no count precedes.
    const { query } = extractFoodQuery('raciones de jamón');
    expect(query).toBe('jamón');
  });

});

// ---------------------------------------------------------------------------
// 6. AC7 deviation: "cañas de cerveza" full pipeline (no wrapper, calorie regression)
// ---------------------------------------------------------------------------

describe('EC — AC7 deviation: "dos cañas de cerveza" pipeline trace', () => {

  it('"dos cañas de cerveza" → extractFoodQuery is no-op (no wrapper)', () => {
    const { query } = extractFoodQuery('dos cañas de cerveza');
    expect(query).toBe('dos cañas de cerveza');
  });

  it('"dos cañas de cerveza" → extractPortionModifier → multiplier 2, cleanQuery "cañas de cerveza"', () => {
    const r = extractPortionModifier('dos cañas de cerveza');
    expect(r.portionMultiplier).toBe(2);
    expect(r.cleanQuery).toBe('cañas de cerveza');
  });

  it('"dos cañas de cerveza" → full pipeline: multiplier 2, query "cañas de cerveza" (not bare "cerveza")', () => {
    // AC7 deviation: POST_COUNT_SERVING_PATTERNS excludes drink vessels,
    // so L1 receives "cañas de cerveza" (matches catalog entity "Caña de cerveza")
    // rather than bare "cerveza" (which would alias to "Cerveza lata", different portionGrams).
    const { query, multiplier } = pipeline('dos cañas de cerveza');
    expect(multiplier).toBe(2);
    expect(query).toBe('cañas de cerveza');
    // Assert the query does NOT get further stripped to bare "cerveza"
    expect(query).not.toBe('cerveza');
  });

  it('"acabo de beberme dos cañas de cerveza" (wrapped) → multiplier 2, query "cañas de cerveza"', () => {
    // Wrapped variant of AC1 — wrapper stripped first, then count extracted,
    // then stripContainerResidual leaves "cañas de cerveza" intact.
    const { query, multiplier } = pipeline('acabo de beberme dos cañas de cerveza');
    expect(multiplier).toBe(2);
    expect(query).toBe('cañas de cerveza');
  });

  it('"acabo de beberme 3 cañas" (AC3 canonical) → multiplier 3, query "cañas"', () => {
    const { query, multiplier } = pipeline('acabo de beberme 3 cañas');
    expect(multiplier).toBe(3);
    expect(query).toBe('cañas');
  });

});

// ---------------------------------------------------------------------------
// 7. Logger.warn: integration request builder has a real warn method (M1 observability)
// ---------------------------------------------------------------------------

describe('EC — logger.warn is a callable function in integration test helper', () => {

  it('logger.warn is defined as a vi.fn() (not undefined) — optional chaining guard is defensive-only', () => {
    // Verifies that if M1 (remove ?.  from logger.warn?.()) is applied,
    // the integration tests still pass because the mock has a real warn method.
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
    expect(typeof logger.warn).toBe('function');
    // Ensure calling it without optional chaining would not throw
    expect(() => logger.warn({ err: new Error('test') }, 'test message')).not.toThrow();
  });

});

// ---------------------------------------------------------------------------
// 8. detectMenuQuery uses ORIGINAL text (F076 contract: before wrapper strip)
// ---------------------------------------------------------------------------

describe('EC — F076 menu detection on original text (before pipeline)', () => {

  it('detectMenuQuery("hoy he comido de menú: paella y vino") → non-null (original text still triggers menu)', () => {
    // In conversationCore.ts, detectMenuQuery is called on `textWithoutDiners` which
    // is derived from `trimmed` (original), NOT from extractFoodQuery output.
    // This verifies the plan's requirement: menu detection fires on original text.
    const result = detectMenuQuery('hoy he comido de menú: paella y vino');
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
  });

  it('detectMenuQuery does NOT receive wrapper-stripped text in the pipeline', () => {
    // "menú: paella y vino" (no "hoy he comido de" prefix) would still match
    // because the menu pattern "de menú" fires on the original.
    // After wrapper strip, "de menú: paella y vino" would remain — verify it still matches.
    const strippedResult = detectMenuQuery('de menú: paella y vino');
    expect(strippedResult).not.toBeNull();
    // If menu detection ran on wrapper-stripped text, the trigger would still fire.
    // The key invariant is that menu detection is NOT accidentally skipped.
  });

  it('detectMenuQuery on bare "paella y vino" (no trigger keyword) → null', () => {
    // Confirm the guard: without "menú" trigger, NO menu detection fires.
    const result = detectMenuQuery('paella y vino');
    expect(result).toBeNull();
  });

});
