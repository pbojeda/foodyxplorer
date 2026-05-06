// F-H7 — Edge-case suite for H7-P1 through H7-P5.
//
// Covers spec Edge Cases 1–9, pattern ordering regressions, ReDoS safety,
// observability assertions, and empty/whitespace inputs.
//
// Unit tests only (no DB). DB-dependent tests (AC-5 landmine corpus, Edge Case 9
// soft target) are in fH7.engineRouter.integration.test.ts.
//
// Vitest globals NOT enabled — import everything explicitly.

import { describe, it, expect } from 'vitest';
import { extractFoodQuery } from '../conversation/entityExtractor.js';
import {
  applyH7CatCStrip,
  applyH7TrailingStrip,
} from '../estimation/h7TrailingStrip.js';

// ---------------------------------------------------------------------------
// Edge Case 1 — H7-P1 vs existing Pattern 3 ordering
// ---------------------------------------------------------------------------

describe('Edge Case 1 — H7-P1 vs existing Pattern 3 ordering', () => {
  it('"ayer cené paella" → Pattern 3 (index 2) wins; output "paella"', () => {
    // Pattern 3: ^(?:ayer|anoche|...)\s+(?:cen[eé]|...)\s+ fires at index 2.
    // H7-P1 is at index 13 and is never reached for this form.
    // Both produce "paella" — test confirms non-regression.
    const result = extractFoodQuery('ayer cené paella');
    expect(result.query).toBe('paella');
  });

  it('"anoche me cené paella" → Pattern 2 (index 1) wins', () => {
    const result = extractFoodQuery('anoche me cené paella');
    expect(result.query).toBe('paella');
  });

  it('"ayer por la noche cené paella" → H7-P1 covers this (Pattern 3 does NOT include "por la noche")', () => {
    // Pattern 3 does not cover "ayer por la noche". H7-P1 at index 13 fires.
    const result = extractFoodQuery('ayer por la noche cené paella');
    expect(result.query).toBe('paella');
  });
});

// ---------------------------------------------------------------------------
// Edge Case 2 — H7-P2 vs existing Pattern 6 ordering
// ---------------------------------------------------------------------------

describe('Edge Case 2 — H7-P2 vs existing Pattern 6 ordering', () => {
  it('"para cenar tuve paella" → Pattern 6 (index 6) wins; output "paella"', () => {
    // Pattern 6: ^para\s+(?:cenar|...)\s+(?:tuve|comí|tomé)\s+ fires at index 6.
    // H7-P2 is at index 14 and is never reached for this exact form.
    const result = extractFoodQuery('para cenar tuve paella');
    expect(result.query).toBe('paella');
  });

  it('"para merendar ayer tomé una manzana" → H7-P2 (index 14) wins (Pattern 6 does not cover time-ref interposition)', () => {
    // Pattern 6 requires eat-verb immediately after meal verb; H7-P2 handles "para merendar ayer tomé"
    const result = extractFoodQuery('para merendar ayer tomé una manzana');
    expect(result.query).toBe('manzana');
  });
});

// ---------------------------------------------------------------------------
// Edge Case 3 — H7-P3 disjointness from Patterns 1–7b
// ---------------------------------------------------------------------------

describe('Edge Case 3 — H7-P3 disjointness from Patterns 1–7b', () => {
  it('"comí pollo" → H7-P3 fires; query === "pollo"', () => {
    const result = extractFoodQuery('comí pollo');
    expect(result.query).toBe('pollo');
  });

  it('"me he comido pollo" → Pattern 1 (index 0) fires, not H7-P3 (index 15)', () => {
    // Pattern 1: ^me\s+he\s+(?:tomado|...|comido|...)\s+
    const result = extractFoodQuery('me he comido pollo');
    expect(result.query).toBe('pollo');
  });
});

// ---------------------------------------------------------------------------
// Edge Case 4 — H7-P4 + ARTICLE_PATTERN interaction
// ---------------------------------------------------------------------------

describe('Edge Case 4 — H7-P4 + ARTICLE_PATTERN interaction', () => {
  it('"quiero un pastel de nata" → H7-P4 strips "quiero un " → "pastel de nata" (ARTICLE_PATTERN does NOT strip "pastel")', () => {
    const result = extractFoodQuery('quiero un pastel de nata');
    expect(result.query).toBe('pastel de nata');
    // Verify "pastel" is NOT stripped by ARTICLE_PATTERN
    expect(result.query).not.toBe('de nata');
    expect(result.query).not.toBe('nata');
  });

  it('"quiero una ensalada" → H7-P4 strips "quiero una " → "ensalada" → ARTICLE_PATTERN no-op', () => {
    const result = extractFoodQuery('quiero una ensalada');
    expect(result.query).toBe('ensalada');
  });
});

// ---------------------------------------------------------------------------
// Edge Case 5 — H7-P5 conservative fallback
// ---------------------------------------------------------------------------

describe('Edge Case 5 — H7-P5 conservative fallback', () => {
  it('applyH7TrailingStrip("paella valenciana") → identity (no strip)', () => {
    expect(applyH7TrailingStrip('paella valenciana')).toBe('paella valenciana');
  });

  it('applyH7TrailingStrip("ensalada mixta") → identity (no recognizable suffix)', () => {
    expect(applyH7TrailingStrip('ensalada mixta')).toBe('ensalada mixta');
  });

  it('applyH7TrailingStrip("arroz con leche") → identity (Cat C ≥2 pre-con guard: "arroz" is 1 token)', () => {
    // "arroz" has 1 pre-con token → guard fails → no strip
    expect(applyH7TrailingStrip('arroz con leche')).toBe('arroz con leche');
  });
});

// ---------------------------------------------------------------------------
// Edge Case 6 — ReDoS safety
// ---------------------------------------------------------------------------

describe('Edge Case 6 — ReDoS safety', () => {
  it('200-char compound temporal input (H7-P1) resolves in < 100 ms', () => {
    // Construct adversarial string with repeated temporal bridges
    const base = 'el lunes después de clase y el martes después de clase ';
    let input = base;
    while (input.length < 200) input += base;
    input = input.slice(0, 200) + 'comí paella';

    const start = Date.now();
    extractFoodQuery(input);
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('200-char con chain: applyH7CatCStrip resolves in < 10 ms', () => {
    // Construct adversarial string with many " con " segments
    const input = 'tataki de atún con sésamo con queso con trufa con anchoas con pimienta con ajo con limón con mantequilla con crema';

    const start = Date.now();
    applyH7CatCStrip(input);
    expect(Date.now() - start).toBeLessThan(10);
  });
});

// ---------------------------------------------------------------------------
// Edge Case 7 — H7-P5 Redis cache non-regression (architectural note)
// ---------------------------------------------------------------------------

describe('Edge Case 7 — H7-P5 Redis cache non-regression (architectural note)', () => {
  it('applyH7TrailingStrip returns different string when seam fires (confirms retry would use stripped key)', () => {
    // When the seam fires, it uses h7StrippedQuery as L1 lookup key.
    // data.query echoes the RAW query (not stripped) — route handler cache key is unaffected.
    // This unit test verifies the strip produces a genuinely different string.
    const raw = 'tataki de atún con sésamo';
    const stripped = applyH7TrailingStrip(raw);
    expect(stripped).not.toBe(raw); // confirms strip fires
    expect(stripped).toBe('tataki de atún');
    // The data.query invariant (echo raw) is tested in engineRouter integration tests.
  });
});

// ---------------------------------------------------------------------------
// Edge Case 8 — normalizedQuery vs extractFoodQuery output (two-pass composition)
// ---------------------------------------------------------------------------

describe('Edge Case 8 — normalizedQuery vs extractFoodQuery output (two-pass composition)', () => {
  it('"quiero un tataki de atún con sésamo": H7-P4 strips → "tataki de atún con sésamo"; H7-P5 further strips Cat C → "tataki de atún"', () => {
    // extractFoodQuery strips H7-P4 "quiero un " → returns query: "tataki de atún con sésamo"
    // runEstimationCascade then receives this as-is. H7-P5 normalizes and strips Cat C.
    // This test verifies Step 1 (extractFoodQuery) of the two-pass composition.
    const extracted = extractFoodQuery('quiero un tataki de atún con sésamo');
    expect(extracted.query).toBe('tataki de atún con sésamo');
    expect(extracted.matchedWrapperLabel).toBe('H7-P4');

    // Step 2: H7-P5 would then strip "con sésamo" → "tataki de atún"
    const h7Stripped = applyH7TrailingStrip(extracted.query);
    expect(h7Stripped).toBe('tataki de atún');
  });
});

// ---------------------------------------------------------------------------
// Edge Case 9 — Q494 soft target (FTS plural handling) — unit portion only
// The DB-dependent soft assertion lives in fH7.engineRouter.integration.test.ts.
// The deterministic Path B test lives in fH7.q494-pathB.unit.test.ts.
// ---------------------------------------------------------------------------

describe('Edge Case 9 — Q494 soft target (extractFoodQuery behavior)', () => {
  it('"dos nigiris de pez mantequilla con trufa" → no crash, query contains dish content', () => {
    // Q494 full FTS plural handling is DB-dependent (see fH7.engineRouter.integration.test.ts).
    // Unit portion: extractFoodQuery does not crash; it passes through the food fragment.
    // Note: "dos" count stripping is outside F-H7 scope — no count-stripping pattern exists yet.
    // The DB-level L1 retry (H7-P5) handles the "con trufa" Cat C strip.
    const result = extractFoodQuery('dos nigiris de pez mantequilla con trufa');
    expect(result.query).toContain('nigiris de pez mantequilla');
  });
});

// ---------------------------------------------------------------------------
// AC-10 — wrapperPattern observability (extractFoodQuery return value)
// ---------------------------------------------------------------------------

describe('AC-10 — wrapperPattern observability', () => {
  it('H7-P1 match returns matchedWrapperLabel: "H7-P1"', () => {
    const result = extractFoodQuery('ayer por la noche cené salmón');
    expect(result.matchedWrapperLabel).toBe('H7-P1');
  });

  it('H7-P2 match returns matchedWrapperLabel: "H7-P2"', () => {
    const result = extractFoodQuery('después del gimnasio me tomé batido');
    expect(result.matchedWrapperLabel).toBe('H7-P2');
  });

  it('H7-P3 match returns matchedWrapperLabel: "H7-P3"', () => {
    const result = extractFoodQuery('comí garbanzos con espinacas');
    expect(result.matchedWrapperLabel).toBe('H7-P3');
  });

  it('H7-P4 match returns matchedWrapperLabel: "H7-P4"', () => {
    const result = extractFoodQuery('quiero un pastel de nata');
    expect(result.matchedWrapperLabel).toBe('H7-P4');
  });

  it('Pre-existing pattern (Pattern 1) returns matchedWrapperLabel: null', () => {
    // Pattern 1 fires (index 0) — not in H7 range → null
    const result = extractFoodQuery('me he tomado una cerveza');
    expect(result.matchedWrapperLabel).toBeNull();
    // But the query is still stripped correctly
    expect(result.query).toBe('cerveza');
  });

  it('No wrapper match returns matchedWrapperLabel absent or null', () => {
    const result = extractFoodQuery('tortilla de patatas');
    expect(result.matchedWrapperLabel ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Empty and whitespace inputs
// ---------------------------------------------------------------------------

describe('Empty and whitespace inputs', () => {
  it('extractFoodQuery("") → { query: "" } (no crash)', () => {
    const result = extractFoodQuery('');
    expect(result.query).toBe('');
  });

  it('extractFoodQuery("   ") → { query: "" } (trimmed empty)', () => {
    const result = extractFoodQuery('   ');
    expect(result.query).toBe('');
  });

  it('applyH7TrailingStrip("") → "" (no crash)', () => {
    expect(applyH7TrailingStrip('')).toBe('');
  });
});
