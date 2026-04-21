// QA edge-case tests for F-MORPH: Spanish Morphological Normalization
// These tests were NOT written by the developer — they probe boundary/negative cases
// beyond the 20 AC happy-path matrix.
//
// See ticket: docs/tickets/F-MORPH-plurals-and-diminutives.md

import { describe, it, expect } from 'vitest';
import {
  extractFoodQuery,
  CONTAINER_PATTERNS,
  DIMINUTIVE_MAP,
  normalizeDiminutive,
} from '../conversation/entityExtractor.js';

// ---------------------------------------------------------------------------
// EC1 — Plural + diminutive combo: "unas tapitas de aceitunas"
// Chain: ARTICLE(unas) → normalizeDiminutive(tapitas→tapas) → 2nd SERVING(tapas de) → aceitunas
// ---------------------------------------------------------------------------

describe('F-MORPH edge: plural + diminutive combo', () => {
  it('EC1a: "unas tapitas de aceitunas" → aceitunas', () => {
    // tapitas is in DIMINUTIVE_MAP → tapas; then second SERVING strips "tapas de"
    const result = extractFoodQuery('unas tapitas de aceitunas');
    expect(result.query).toBe('aceitunas');
  });

  it('EC1b: "unos boqueronitos fritos" → boquerones fritos', () => {
    // ARTICLE(unos) → normalizeDiminutive(boqueronitos→boquerones) → no SERVING match
    const result = extractFoodQuery('unos boqueronitos fritos');
    expect(result.query).toBe('boquerones fritos');
  });
});

// ---------------------------------------------------------------------------
// EC2 — Title case / mixed case
// "Unas Croquetitas" — ARTICLE_PATTERN is case-insensitive, DIMINUTIVE_MAP lookup must
// lowercase the token before map lookup.
// ---------------------------------------------------------------------------

describe('F-MORPH edge: mixed / Title case', () => {
  it('EC2a: "Unas Croquetitas" (Title case) → croquetas', () => {
    const result = extractFoodQuery('Unas Croquetitas');
    expect(result.query).toBe('croquetas');
  });

  // BUG: extractFoodQuery does NOT lowercase the remainder before returning it.
  // Pattern matching (ARTICLE, SERVING) is case-insensitive (/i flag) so stripping
  // happens correctly, but the leftover token is returned with original casing.
  // "UNAS TAPAS DE CROQUETAS" → strips UNAS (ARTICLE) → strips TAPAS DE (SERVING /i)
  // → leftover is "CROQUETAS" (original case), not "croquetas".
  // Spec (api-spec.yaml) does not explicitly mandate lowercase output, so this is
  // classified MINOR — downstream L1 FTS is case-insensitive in Postgres.
  it('EC2b: "UNAS TAPAS DE CROQUETAS" (ALL CAPS) → returns "CROQUETAS" (case NOT lowercased — known gap)', () => {
    const result = extractFoodQuery('UNAS TAPAS DE CROQUETAS');
    // Documents current behavior; not a CRITICAL bug (Postgres FTS is case-insensitive)
    expect(result.query).toBe('CROQUETAS');
  });

  it('EC2c: normalizeDiminutive preserves case of unknown tokens', () => {
    // known token normalized, unknown preserved as-is
    expect(normalizeDiminutive('Tapita Fresca')).toBe('tapa Fresca');
  });
});

// ---------------------------------------------------------------------------
// EC3 — Accented vs non-accented: "unas cañitas" (with ñ) must resolve;
//        "unas caniitas" (mangled, no ñ) should pass through unchanged.
// ---------------------------------------------------------------------------

describe('F-MORPH edge: accent handling', () => {
  it('EC3a: "unas cañitas" (with ñ) → cañas', () => {
    // ARTICLE(unas) → normalizeDiminutive(cañitas→cañas)
    const result = extractFoodQuery('unas cañitas');
    expect(result.query).toBe('cañas');
  });

  it('EC3b: "caniitas" (no ñ) is NOT in DIMINUTIVE_MAP → unchanged', () => {
    // The map key is "cañitas", not "caniitas" — should pass through
    expect(DIMINUTIVE_MAP['caniitas']).toBeUndefined();
    const result = extractFoodQuery('unas caniitas');
    expect(result.query).toBe('caniitas');
  });
});

// ---------------------------------------------------------------------------
// EC4 — Bare "poquito" without "de" — CONTAINER_PATTERNS requires "de".
//        Expected behavior: NOT stripped. Result is "poquito" unchanged.
// ---------------------------------------------------------------------------

describe('F-MORPH edge: "poquito" without "de"', () => {
  it('EC4: "poquito" alone (no de) is NOT stripped by CONTAINER_PATTERNS', () => {
    expect(CONTAINER_PATTERNS.some((p) => p.test('poquito'))).toBe(false);
    const result = extractFoodQuery('poquito');
    expect(result.query).toBe('poquito');
  });
});

// ---------------------------------------------------------------------------
// EC5 — F042 regression: "tapa grande" — F-MORPH must NOT touch size modifiers.
//        SERVING strips "tapa de" only; no "de" here → pass through.
// ---------------------------------------------------------------------------

describe('F-MORPH edge: size modifiers not stripped (F042 regression)', () => {
  it('EC5a: "tapa grande" → tapa grande (size modifier preserved)', () => {
    const result = extractFoodQuery('tapa grande');
    expect(result.query).toBe('tapa grande');
  });

  it('EC5b: "ración grande de croquetas" → unchanged (SERVING pattern requires de immediately after ración)', () => {
    // "ración grande de" — the pattern is /^raci[oó]n\s+de\s+/i; "grande" interrupts, no strip.
    // Expected: NOT stripped by SERVING → "ración grande de croquetas" passes through.
    const result = extractFoodQuery('ración grande de croquetas');
    expect(result.query).toBe('ración grande de croquetas');
  });
});

// ---------------------------------------------------------------------------
// EC6 — Cross-ticket chain: "me he tomado unos boqueronitos"
//        F-NLP(me he tomado) → ARTICLE(unos) → normalizeDiminutive(boqueronitos→boquerones)
// ---------------------------------------------------------------------------

describe('F-MORPH edge: cross-ticket F-NLP + F-MORPH chain', () => {
  it('EC6: "me he tomado unos boqueronitos" → boquerones', () => {
    const result = extractFoodQuery('me he tomado unos boqueronitos');
    expect(result.query).toBe('boquerones');
  });
});

// ---------------------------------------------------------------------------
// EC7 — Ordering invariant: nested container + serving
//        "un plato de tapa de aceitunas"
//        CONTAINER strips "plato de" → "tapa de aceitunas" → SERVING strips "tapa de" → "aceitunas"
// ---------------------------------------------------------------------------

describe('F-MORPH edge: container + serving nested ordering', () => {
  it('EC7: "un plato de tapa de aceitunas" → aceitunas', () => {
    const result = extractFoodQuery('un plato de tapa de aceitunas');
    expect(result.query).toBe('aceitunas');
  });
});

// ---------------------------------------------------------------------------
// EC8 — Token-level word boundaries: "supertapita" must NOT be normalized.
//        normalizeDiminutive splits on whitespace — "supertapita" is one token,
//        but the map only has key "tapita", not "supertapita".
// ---------------------------------------------------------------------------

describe('F-MORPH edge: substring / word boundary guard', () => {
  it('EC8a: "supertapita" is not in DIMINUTIVE_MAP → unchanged', () => {
    expect(DIMINUTIVE_MAP['supertapita']).toBeUndefined();
    expect(normalizeDiminutive('supertapita')).toBe('supertapita');
  });

  it('EC8b: extractFoodQuery("supertapita") → supertapita (no false strip)', () => {
    const result = extractFoodQuery('supertapita');
    expect(result.query).toBe('supertapita');
  });
});

// ---------------------------------------------------------------------------
// EC9 — Empty string / whitespace — no crashes, graceful fallback.
// ---------------------------------------------------------------------------

describe('F-MORPH edge: empty / whitespace input', () => {
  it('EC9a: empty string returns empty string without throwing', () => {
    expect(() => extractFoodQuery('')).not.toThrow();
    expect(extractFoodQuery('').query).toBe('');
  });

  it('EC9b: whitespace-only returns empty string without throwing', () => {
    expect(() => extractFoodQuery('   ')).not.toThrow();
    const result = extractFoodQuery('   ');
    expect(result.query).toBe('');
  });

  it('EC9c: normalizeDiminutive on empty string returns empty string', () => {
    expect(normalizeDiminutive('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// EC10 — "unos pocos churros" — "pocos" is an adjective, NOT the container "poco de".
//         ARTICLE strips "unos" → "pocos churros"; CONTAINER pattern requires "poco\s+de",
//         not "pocos"; no strip. Result: "pocos churros".
// ---------------------------------------------------------------------------

describe('F-MORPH edge: "pocos" adjective vs "poco de" container', () => {
  it('EC10: "unos pocos churros" → pocos churros (no container strip)', () => {
    // CONTAINER_PATTERNS has /^poco\s+de\s+/i — "pocos churros" does not match
    expect(CONTAINER_PATTERNS.some((p) => p.test('pocos churros'))).toBe(false);
    const result = extractFoodQuery('unos pocos churros');
    expect(result.query).toBe('pocos churros');
  });
});

// ---------------------------------------------------------------------------
// EC11 — AC15 strictness: "un vaso de vino" — CONTAINER must NOT strip, tested
//         with strict toBe equality (not just "not empty").
// ---------------------------------------------------------------------------

describe('F-MORPH edge: AC15 strict equality on vaso de vino', () => {
  it('EC11: "un vaso de vino" → exact string "vaso de vino" (strict toBe)', () => {
    const result = extractFoodQuery('un vaso de vino');
    expect(result.query).toBe('vaso de vino');
  });

  it('EC11b: "un vaso de vino tinto" → exact string "vaso de vino tinto" (strict toBe)', () => {
    const result = extractFoodQuery('un vaso de vino tinto');
    expect(result.query).toBe('vaso de vino tinto');
  });
});

// ---------------------------------------------------------------------------
// EC12 — AC16 strictness: "patatitas" → exact string "patatitas" (not empty, not modified)
// ---------------------------------------------------------------------------

describe('F-MORPH edge: AC16 strict equality on unknown diminutive', () => {
  it('EC12: "patatitas" → exact string "patatitas" (strict toBe)', () => {
    const result = extractFoodQuery('patatitas');
    expect(result.query).toBe('patatitas');
  });
});

// ---------------------------------------------------------------------------
// EC13 — CONTAINER_PATTERNS regex: "trocito de" in CONTAINER vs normalizeDiminutive
//         trocito maps to trozo in DIMINUTIVE_MAP. But CONTAINER_PATTERNS also has
//         /^trocito\s+de\s+/i. So "un trocito de tortilla" could be stripped by CONTAINER
//         (not by SERVING second pass). Both paths lead to "tortilla". Verify the actual path.
// ---------------------------------------------------------------------------

describe('F-MORPH edge: trocito de — CONTAINER wins before DIMINUTIVE', () => {
  it('EC13: "un trocito de tortilla" → tortilla (via CONTAINER, not diminutive path)', () => {
    // The CONTAINER pattern fires BEFORE normalizeDiminutive, so the path is:
    // ARTICLE(un) → CONTAINER(trocito de) strips → "tortilla"
    // normalizeDiminutive then runs on "tortilla" → "tortilla" (no change)
    const result = extractFoodQuery('un trocito de tortilla');
    expect(result.query).toBe('tortilla');
  });
});
