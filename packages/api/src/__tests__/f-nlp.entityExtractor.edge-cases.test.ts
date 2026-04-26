// QA edge-cases for F-NLP — CONVERSATIONAL_WRAPPER_PATTERNS
// Probes pitfalls NOT covered by the developer's 15 ACs.

import { describe, it, expect } from 'vitest';
import {
  extractFoodQuery,
  CONVERSATIONAL_WRAPPER_PATTERNS,
} from '../conversation/entityExtractor.js';

describe('F-NLP edge-cases — accent folding (pattern 2/3)', () => {
  // Pattern 3 uses com[ií] — must match both accented and unaccented
  it('matches "hoy comi" (no accent) same as "hoy comí"', () => {
    const withAccent = extractFoodQuery('hoy comí ensalada mixta');
    const withoutAccent = extractFoodQuery('hoy comi ensalada mixta');
    expect(withAccent.query).toBe('ensalada mixta');
    // "comi" without accent must also strip — pattern uses [ií] alternation
    expect(withoutAccent.query).toBe('ensalada mixta');
  });

  it('matches "anoche bevi" (no accent) via pattern 3 beb[ií]', () => {
    const result = extractFoodQuery('anoche bebí agua con gas');
    expect(result.query).toBe('agua con gas');
    const resultNoAccent = extractFoodQuery('anoche bebi agua con gas');
    expect(resultNoAccent.query).toBe('agua con gas');
  });
});

describe('F-NLP edge-cases — mid-string wrapper NOT anchored', () => {
  // Pattern 1 is anchored ^me\s+he — "de postre me he tomado" must NOT strip
  // because "me he tomado" is not at the start of the string.
  it('does NOT strip "de postre me he tomado un flan" (wrapper not at ^)', () => {
    const result = extractFoodQuery('de postre me he tomado un flan');
    // Should NOT reduce to "un flan" / "flan" — the wrapper is mid-string
    expect(result.query).toBe('de postre me he tomado un flan');
  });

  it('F-H7: "en el restaurante anoche cené paella" NOW strips via H7-P2 (en [lugar] + eat-verb)', () => {
    // F-H7 added H7-P2 at index 14 which covers "en [lugar] + eat-verb" forms.
    // "en el restaurante anoche cené paella" — H7-P2 fires: strips "en el restaurante anoche cené "
    // ARTICLE_PATTERN no-op (no leading article). Result: "paella".
    // Updated from pre-F-H7 expectation of no-strip — H7-P2 intentionally handles this form.
    const result = extractFoodQuery('en el restaurante anoche cené paella');
    expect(result.query).toBe('paella');
  });
});

describe('F-NLP edge-cases — capitalization (case-insensitive flag)', () => {
  it('strips "Me He Tomado paella" (Title Case)', () => {
    const result = extractFoodQuery('Me He Tomado paella');
    expect(result.query).toBe('paella');
  });

  it('strips "ACABO DE COMER paella" (ALL CAPS)', () => {
    const result = extractFoodQuery('ACABO DE COMER paella');
    expect(result.query).toBe('paella');
  });

  it('strips "Hoy He Comido lentejas" (mixed case)', () => {
    const result = extractFoodQuery('Hoy He Comido lentejas');
    expect(result.query).toBe('lentejas');
  });
});

describe('F-NLP edge-cases — compound tense "había comido" (pluperfect)', () => {
  // Pattern 4 is ^(?:hoy\s+)?he\s+ — "había" does NOT start with "he"
  // so no false positive match on pluperfect.
  it('does NOT strip "había comido paella" (pluperfect — different aux verb)', () => {
    const result = extractFoodQuery('había comido paella');
    // Should remain unchanged (no matching pattern)
    expect(result.query).toBe('había comido paella');
  });
});

describe('F-NLP edge-cases — "acabo de pedir" (unlisted infinitive)', () => {
  // Pattern 5 only allows: comer|tomar|beber|cenar|desayunar|almorzar|merendar
  // "pedir" is NOT in the list. This is intentional per spec (pattern 7 covers
  // "me voy a pedir" / "me pido" but not bare "acabo de pedir").
  it('does NOT strip "acabo de pedir paella" — "pedir" not in pattern 5 infinitives', () => {
    const result = extractFoodQuery('acabo de pedir paella');
    // Must remain unchanged — confirm intentional gap (spec note: pedir not listed)
    expect(result.query).toBe('acabo de pedir paella');
  });
});

describe('F-NLP edge-cases — "para mi cena tuve X" (pronoun variant of pattern 6)', () => {
  // Pattern 6 is ^para\s+(cenar|...) — requires the infinitive directly after "para"
  // "para mi cena tuve X" has a possessive+noun structure, not the infinitive.
  it('does NOT strip "para mi cena tuve ensalada" — pronoun breaks pattern 6', () => {
    const result = extractFoodQuery('para mi cena tuve ensalada');
    // Should remain unchanged — "mi cena" is not matched by "para cenar/desayunar/..."
    expect(result.query).toBe('para mi cena tuve ensalada');
  });
});

describe('F-NLP edge-cases — multi-wrapper single-pass (no cascading)', () => {
  // "hoy acabo de comer paella" — pattern 3 ("hoy" temporal) fires first
  // and strips "hoy " only IF the verb follows. But "acabo" is not in the
  // temporal-verb list — so pattern 3 won't match. Then pattern 5
  // ("acabo de comer") has no temporal prefix, so it DOES anchor at ^.
  // But with "hoy " prepended the ^ anchor means pattern 5 won't match either.
  // The second wrapper "acabo de comer" is stranded after the first pass fires
  // on "hoy" temporal patterns (if applicable), or neither fires.
  it('"hoy acabo de comer paella" — temporal pattern does not fire (acabo not a past verb)', () => {
    const result = extractFoodQuery('hoy acabo de comer paella');
    // Pattern 3 requires: temporal + (cen[eé]|desayun[eé]|almorc[eé]|com[ií]|...)
    // "acabo" is not in that list → pattern 3 won't match.
    // Pattern 5 requires ^acabo — but input starts with "hoy" → won't match.
    // Result: NO wrapper stripped. This is an intentional gap (single-pass design).
    expect(result.query).toBe('hoy acabo de comer paella');
  });
});

describe('F-NLP edge-cases — negative test assertion strength (AC10/AC11/AC12)', () => {
  // Confirm these are strict toBe checks, not just truthy.
  // The developer did use toBe(input) — these tests verify that contract holds.
  it('AC10 negative: exact identity preserved for "quiero comer algo ligero"', () => {
    const input = 'quiero comer algo ligero';
    const result = extractFoodQuery(input);
    expect(result.query).toBe(input); // strict, not just non-empty
  });

  it('AC11 negative: exact identity for "recomiéndame algo con pocas calorías"', () => {
    const input = 'recomiéndame algo con pocas calorías';
    const result = extractFoodQuery(input);
    expect(result.query).toBe(input);
  });

  it('AC12 negative: exact identity for "es sano comer pulpo a la gallega"', () => {
    const input = 'es sano comer pulpo a la gallega';
    const result = extractFoodQuery(input);
    expect(result.query).toBe(input);
  });
});

describe('F-NLP edge-cases — AC13/AC14 full chain assertion (regression)', () => {
  it('AC14: verifies final query is exactly "patatas bravas" (strict, not truthy)', () => {
    const result = extractFoodQuery('cuántas calorías tiene una ración de patatas bravas');
    // Must be exactly "patatas bravas" — not "una ración de patatas bravas" or similar
    expect(result.query).toBe('patatas bravas');
    expect(typeof result.query).toBe('string');
    expect(result.query).not.toContain('ración');
    expect(result.query).not.toContain('una');
  });

  it('AC13: verifies final query is exactly "big mac" (strict)', () => {
    const result = extractFoodQuery('cuántas calorías tiene el big mac');
    expect(result.query).toBe('big mac');
    expect(result.query).not.toContain('calorías');
    expect(result.query).not.toContain('el');
  });
});

describe('F-NLP edge-cases — catastrophic backtracking audit', () => {
  // Patterns with nested quantifiers could cause ReDoS. Audit each of the 12 patterns
  // with a crafted adversarial input (long string designed to backtrack maximally).
  // If a pattern is safe, exec() completes immediately.

  it('all 13 patterns complete in <50ms on a 500-char adversarial string', () => {
    const adversarial = 'me ' + 'he '.repeat(100) + 'tomado '.repeat(50) + 'x';
    const start = Date.now();
    for (const pattern of CONVERSATIONAL_WRAPPER_PATTERNS) {
      pattern.exec(adversarial);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it('pattern 10 ("quiero saber") handles long non-matching string without catastrophic backtrack', () => {
    // Pattern 10 has nested optional groups — craft worst-case
    // (was pattern 8 at index 7 before F-MULTI-ITEM-IMPLICIT added patterns 4b + 7b)
    const adversarial = 'quiero saber ' + 'las '.repeat(50) + 'calorías '.repeat(50);
    const start = Date.now();
    CONVERSATIONAL_WRAPPER_PATTERNS[9]!.exec(adversarial);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(20);
  });

  it('pattern 13 ("necesito") handles long non-matching string', () => {
    // (was pattern 11 at index 10 before F-MULTI-ITEM-IMPLICIT added patterns 4b + 7b)
    const adversarial = 'necesito ' + 'los '.repeat(50) + 'nutrientes '.repeat(50);
    const start = Date.now();
    CONVERSATIONAL_WRAPPER_PATTERNS[12]!.exec(adversarial);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(20);
  });
});

describe('F-NLP edge-cases — empty / boundary inputs', () => {
  it('handles empty string without throwing', () => {
    expect(() => extractFoodQuery('')).not.toThrow();
    const result = extractFoodQuery('');
    expect(typeof result.query).toBe('string');
  });

  it('handles string that IS only a wrapper ("he comido") — falls back to original', () => {
    // Stripping "he comido\s+" requires trailing \s+ which won't match "he comido" alone
    // Result: no strip, original returned (also confirmed by fallback rule)
    const result = extractFoodQuery('he comido');
    expect(result.query.length).toBeGreaterThan(0);
  });

  it('handles whitespace-only input', () => {
    expect(() => extractFoodQuery('   ')).not.toThrow();
  });
});

describe('F-NLP edge-cases — Category D scope guard (bare intent-to-eat must NOT strip)', () => {
  // Review M1 (2026-04-21): pattern 12 ("^voy a + infinitive" without "me") was removed
  // because it false-positived on non-food intents (e.g., "voy a pedir una receta"),
  // violating the Category D scope guard. Intent-to-eat is covered by pattern 7
  // ("me voy a pedir X" / "me pido X"), which requires the `me` pronoun.
  it('does NOT strip "voy a pedir una pizza" (bare, no pronoun — stays unchanged)', () => {
    const result = extractFoodQuery('voy a pedir una pizza');
    expect(result.query).toBe('voy a pedir una pizza');
  });

  it('does NOT strip "voy a pedir una receta" (Category D — non-food, must stay unchanged)', () => {
    const result = extractFoodQuery('voy a pedir una receta');
    expect(result.query).toBe('voy a pedir una receta');
  });

  it('DOES strip "me voy a pedir una pizza" via pattern 7 (me pronoun present)', () => {
    const result = extractFoodQuery('me voy a pedir una pizza');
    expect(result.query).toBe('pizza');
  });
});
