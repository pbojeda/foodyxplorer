// Unit tests for F-MORPH: Spanish Morphological Normalization (plurals + diminutives)
// TDD — RED → GREEN per step breakdown in ticket F-MORPH-plurals-and-diminutives.md
//
// Convention: developer ACs appended here; any additional QA edge cases go in
// f-morph.entityExtractor.edge-cases.test.ts (same pattern as F-NLP split).

import { describe, it, expect } from 'vitest';
import {
  extractFoodQuery,
  CONTAINER_PATTERNS,
  DIMINUTIVE_MAP,
  normalizeDiminutive,
  ARTICLE_PATTERN,
  SERVING_FORMAT_PATTERNS,
} from '../conversation/entityExtractor.js';

// ---------------------------------------------------------------------------
// AC19 — Structural: exported constants and function
// ---------------------------------------------------------------------------

describe('F-MORPH — exported constants and normalizeDiminutive', () => {
  // AC19a: CONTAINER_PATTERNS is exported readonly RegExp array
  it('CONTAINER_PATTERNS is exported as a readonly RegExp array', () => {
    expect(Array.isArray(CONTAINER_PATTERNS)).toBe(true);
    expect(CONTAINER_PATTERNS.length).toBeGreaterThanOrEqual(6);
    for (const pattern of CONTAINER_PATTERNS) {
      expect(pattern).toBeInstanceOf(RegExp);
    }
  });

  // AC19b: DIMINUTIVE_MAP is exported as a plain object with known entries
  it('DIMINUTIVE_MAP is exported and contains known entries', () => {
    expect(typeof DIMINUTIVE_MAP).toBe('object');
    expect(DIMINUTIVE_MAP['tapita']).toBe('tapa');
    expect(DIMINUTIVE_MAP['tapitas']).toBe('tapas');
    expect(DIMINUTIVE_MAP['cañita']).toBe('caña');
    expect(DIMINUTIVE_MAP['racioncita']).toBe('ración');
    expect(DIMINUTIVE_MAP['croquetitas']).toBe('croquetas');
    expect(DIMINUTIVE_MAP['boqueronitos']).toBe('boquerones');
  });

  // AC19c: normalizeDiminutive is exported and is a function
  it('normalizeDiminutive is exported as a function', () => {
    expect(typeof normalizeDiminutive).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// AC1–AC5 — Plural articles (unas / unos)
// ---------------------------------------------------------------------------

describe('F-MORPH — plural article stripping (AC1–AC5)', () => {
  // AC1: unas tapas de croquetas → croquetas
  it('AC1: strips "unas" then SERVING "tapas de" → croquetas', () => {
    const result = extractFoodQuery('unas tapas de croquetas');
    expect(result.query).toBe('croquetas');
  });

  // AC2: unos pinchos de tortilla → tortilla
  it('AC2: strips "unos" then SERVING "pinchos de" → tortilla', () => {
    const result = extractFoodQuery('unos pinchos de tortilla');
    expect(result.query).toBe('tortilla');
  });

  // AC3: unas raciones de gambas → gambas
  it('AC3: strips "unas" then SERVING "raciones de" → gambas', () => {
    const result = extractFoodQuery('unas raciones de gambas');
    expect(result.query).toBe('gambas');
  });

  // AC4: unas patatas bravas → patatas bravas (no "de" so no SERVING strip)
  it('AC4: strips "unas" → patatas bravas (no SERVING, no de)', () => {
    const result = extractFoodQuery('unas patatas bravas');
    expect(result.query).toBe('patatas bravas');
  });

  // AC5: unas cañas → cañas
  it('AC5: strips "unas" → cañas', () => {
    const result = extractFoodQuery('unas cañas');
    expect(result.query).toBe('cañas');
  });

  // ARTICLE_PATTERN still matches singular forms (regression guard)
  it('ARTICLE_PATTERN still matches singular "un/una/uno/el/la"', () => {
    expect(ARTICLE_PATTERN.test('un plato de lentejas')).toBe(true);
    expect(ARTICLE_PATTERN.test('una ración de croquetas')).toBe(true);
    expect(ARTICLE_PATTERN.test('el big mac')).toBe(true);
    expect(ARTICLE_PATTERN.test('la pizza')).toBe(true);
  });

  // unas and unos match
  it('ARTICLE_PATTERN matches "unas" and "unos"', () => {
    expect(ARTICLE_PATTERN.test('unas tapas')).toBe(true);
    expect(ARTICLE_PATTERN.test('unos pinchos')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC6–AC8 — Diminutive normalization
// ---------------------------------------------------------------------------

describe('F-MORPH — normalizeDiminutive unit', () => {
  it('maps tapita → tapa', () => {
    expect(normalizeDiminutive('tapita')).toBe('tapa');
  });

  it('maps tapitas → tapas', () => {
    expect(normalizeDiminutive('tapitas')).toBe('tapas');
  });

  it('maps cañita → caña', () => {
    expect(normalizeDiminutive('cañita')).toBe('caña');
  });

  it('maps croquetitas → croquetas', () => {
    expect(normalizeDiminutive('croquetitas')).toBe('croquetas');
  });

  it('maps boqueronitos → boquerones', () => {
    expect(normalizeDiminutive('boqueronitos')).toBe('boquerones');
  });

  it('maps racioncita → ración', () => {
    expect(normalizeDiminutive('racioncita')).toBe('ración');
  });

  it('maps trocito → trozo', () => {
    expect(normalizeDiminutive('trocito')).toBe('trozo');
  });

  it('does not alter unknown words', () => {
    expect(normalizeDiminutive('patatitas')).toBe('patatitas');
  });

  it('normalizes multi-token string (maps known tokens, preserves unknown)', () => {
    expect(normalizeDiminutive('unas croquetitas frías')).toBe('unas croquetas frías');
  });

  it('is case-insensitive (maps TAPITA → tapa)', () => {
    expect(normalizeDiminutive('TAPITA')).toBe('tapa');
  });
});

describe('F-MORPH — diminutive normalization in extractFoodQuery (AC6–AC8)', () => {
  // AC6: una tapita de aceitunas → aceitunas
  // Chain: ARTICLE(una) → normalizeDiminutive(tapita→tapa) → 2nd SERVING(tapa de) → aceitunas
  it('AC6: "una tapita de aceitunas" → aceitunas', () => {
    const result = extractFoodQuery('una tapita de aceitunas');
    expect(result.query).toBe('aceitunas');
  });

  // AC7: una cañita de cerveza → cerveza
  // Chain: ARTICLE(una) → normalizeDiminutive(cañita→caña) → 2nd SERVING(caña de) → cerveza
  it('AC7: "una cañita de cerveza" → cerveza', () => {
    const result = extractFoodQuery('una cañita de cerveza');
    expect(result.query).toBe('cerveza');
  });

  // AC8: unas croquetitas → croquetas
  // Chain: ARTICLE(unas) → normalizeDiminutive(croquetitas→croquetas)
  it('AC8: "unas croquetitas" → croquetas', () => {
    const result = extractFoodQuery('unas croquetitas');
    expect(result.query).toBe('croquetas');
  });

  // Additional diminutive tests from QA battery
  it('"un pintxito de tortilla" → tortilla', () => {
    const result = extractFoodQuery('un pintxito de tortilla');
    expect(result.query).toBe('tortilla');
  });

  it('"unas gambitas al ajillo" → gambas al ajillo', () => {
    const result = extractFoodQuery('unas gambitas al ajillo');
    expect(result.query).toBe('gambas al ajillo');
  });

  it('"unos boqueronitos" → boquerones', () => {
    const result = extractFoodQuery('unos boqueronitos');
    expect(result.query).toBe('boquerones');
  });

  it('"un trocito de tortilla" → tortilla', () => {
    const result = extractFoodQuery('un trocito de tortilla');
    expect(result.query).toBe('tortilla');
  });
});

// ---------------------------------------------------------------------------
// AC9–AC14 — Container strip
// ---------------------------------------------------------------------------

describe('F-MORPH — CONTAINER_PATTERNS unit', () => {
  it('CONTAINER_PATTERNS matches "plato de"', () => {
    expect(CONTAINER_PATTERNS.some((p) => p.test('plato de lentejas'))).toBe(true);
  });

  it('CONTAINER_PATTERNS matches "cuenco de"', () => {
    expect(CONTAINER_PATTERNS.some((p) => p.test('cuenco de fabada'))).toBe(true);
  });

  it('CONTAINER_PATTERNS matches "bol de"', () => {
    expect(CONTAINER_PATTERNS.some((p) => p.test('bol de gazpacho'))).toBe(true);
  });

  it('CONTAINER_PATTERNS matches "vasito de"', () => {
    expect(CONTAINER_PATTERNS.some((p) => p.test('vasito de horchata'))).toBe(true);
  });

  it('CONTAINER_PATTERNS matches "jarrita de"', () => {
    expect(CONTAINER_PATTERNS.some((p) => p.test('jarrita de sangría'))).toBe(true);
  });

  it('CONTAINER_PATTERNS matches "poco de"', () => {
    expect(CONTAINER_PATTERNS.some((p) => p.test('poco de gazpacho'))).toBe(true);
  });

  it('CONTAINER_PATTERNS matches "poquito de"', () => {
    expect(CONTAINER_PATTERNS.some((p) => p.test('poquito de paella'))).toBe(true);
  });

  it('CONTAINER_PATTERNS does NOT match "vaso de" (F-DRINK territory)', () => {
    expect(CONTAINER_PATTERNS.some((p) => p.test('vaso de vino tinto'))).toBe(false);
  });
});

describe('F-MORPH — container strip in extractFoodQuery (AC9–AC14)', () => {
  // AC9: un plato de lentejas → lentejas
  it('AC9: "un plato de lentejas" → lentejas', () => {
    const result = extractFoodQuery('un plato de lentejas');
    expect(result.query).toBe('lentejas');
  });

  // AC10: un cuenco de fabada → fabada
  it('AC10: "un cuenco de fabada" → fabada', () => {
    const result = extractFoodQuery('un cuenco de fabada');
    expect(result.query).toBe('fabada');
  });

  // AC11: un bol de gazpacho → gazpacho
  it('AC11: "un bol de gazpacho" → gazpacho', () => {
    const result = extractFoodQuery('un bol de gazpacho');
    expect(result.query).toBe('gazpacho');
  });

  // AC12: un vasito de horchata → horchata
  it('AC12: "un vasito de horchata" → horchata', () => {
    const result = extractFoodQuery('un vasito de horchata');
    expect(result.query).toBe('horchata');
  });

  // AC13: una jarrita de sangría → sangría
  it('AC13: "una jarrita de sangría" → sangría', () => {
    const result = extractFoodQuery('una jarrita de sangría');
    expect(result.query).toBe('sangría');
  });

  // AC14: un poco de gazpacho → gazpacho
  it('AC14: "un poco de gazpacho" → gazpacho', () => {
    const result = extractFoodQuery('un poco de gazpacho');
    expect(result.query).toBe('gazpacho');
  });

  // Additional container test from QA battery
  it('"un poquito de paella" → paella', () => {
    const result = extractFoodQuery('un poquito de paella');
    expect(result.query).toBe('paella');
  });

  it('"un platito de patatas bravas" → patatas bravas', () => {
    const result = extractFoodQuery('un platito de patatas bravas');
    expect(result.query).toBe('patatas bravas');
  });
});

// ---------------------------------------------------------------------------
// AC15 — Negative: vaso de NOT stripped (F-DRINK territory)
// ---------------------------------------------------------------------------

describe('F-MORPH — negative tests (AC15–AC16)', () => {
  // AC15: un vaso de vino tinto → NOT stripped by F-MORPH
  it('AC15: "un vaso de vino tinto" → vaso de vino tinto (not stripped)', () => {
    const result = extractFoodQuery('un vaso de vino tinto');
    expect(result.query).toBe('vaso de vino tinto');
  });

  // AC16: patatitas alone (not in DIMINUTIVE_MAP) → unchanged
  it('AC16: "patatitas" alone is not in map → unchanged', () => {
    const result = extractFoodQuery('patatitas');
    expect(result.query).toBe('patatitas');
  });

  // Confirm plato alone (without "de") is not stripped
  it('CONTAINER_PATTERNS does NOT match "plato" without "de"', () => {
    const result = extractFoodQuery('plato');
    expect(result.query).toBe('plato');
  });
});

// ---------------------------------------------------------------------------
// AC17 — Integration: F-NLP + ARTICLE + DIMINUTIVE
// ---------------------------------------------------------------------------

describe('F-MORPH — integration with F-NLP (AC17)', () => {
  // AC17: me he tomado unas croquetitas → croquetas
  it('AC17: "me he tomado unas croquetitas" → croquetas', () => {
    const result = extractFoodQuery('me he tomado unas croquetitas');
    expect(result.query).toBe('croquetas');
  });

  it('"me he tomado una racioncita de gambas" → gambas', () => {
    const result = extractFoodQuery('me he tomado una racioncita de gambas');
    expect(result.query).toBe('gambas');
  });

  it('"me pido una tapita de aceitunas" → aceitunas', () => {
    const result = extractFoodQuery('me pido una tapita de aceitunas');
    expect(result.query).toBe('aceitunas');
  });
});

// ---------------------------------------------------------------------------
// AC18 — Regression: existing extractFoodQuery tests must still pass
// ---------------------------------------------------------------------------

describe('F-MORPH — regression checks (AC18)', () => {
  it('plain dish name unchanged', () => {
    expect(extractFoodQuery('big mac').query).toBe('big mac');
  });

  it('"cuántas calorías tiene el big mac" → big mac', () => {
    expect(extractFoodQuery('cuántas calorías tiene el big mac').query).toBe('big mac');
  });

  it('"cuántas calorías tiene una ración de patatas bravas" → patatas bravas', () => {
    expect(extractFoodQuery('cuántas calorías tiene una ración de patatas bravas').query).toBe('patatas bravas');
  });

  it('chain slug still extracted: "big mac en mcdonalds-es"', () => {
    const result = extractFoodQuery('big mac en mcdonalds-es');
    expect(result.query).toBe('big mac');
    expect(result.chainSlug).toBe('mcdonalds-es');
  });

  it('"me he tomado una ración de croquetas" → croquetas (F-NLP regression)', () => {
    expect(extractFoodQuery('me he tomado una ración de croquetas').query).toBe('croquetas');
  });

  it('"cuánto engorda una ración de croquetas" → croquetas', () => {
    expect(extractFoodQuery('cuánto engorda una ración de croquetas').query).toBe('croquetas');
  });

  it('SERVING_FORMAT_PATTERNS now contains 6 patterns (added caña de for F-MORPH AC7)', () => {
    expect(SERVING_FORMAT_PATTERNS).toHaveLength(6);
  });
});
