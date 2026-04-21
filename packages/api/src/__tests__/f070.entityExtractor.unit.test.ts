// Unit tests for entityExtractor.ts (F070 — Step 3)
//
// Tests all pure functions copied from bot sources:
// detectContextSet, extractPortionModifier, extractComparisonQuery,
// splitByComparator, parseDishExpression, extractFoodQuery.

import { describe, it, expect } from 'vitest';
import {
  detectContextSet,
  extractPortionModifier,
  extractComparisonQuery,
  splitByComparator,
  parseDishExpression,
  extractFoodQuery,
  CONVERSATIONAL_WRAPPER_PATTERNS,
} from '../conversation/entityExtractor.js';

// ---------------------------------------------------------------------------
// detectContextSet
// ---------------------------------------------------------------------------

describe('detectContextSet', () => {
  it('detects "estoy en mcdonalds"', () => {
    expect(detectContextSet('estoy en mcdonalds')).toBe('mcdonalds');
  });

  it('detects with article "estoy en el burger king"', () => {
    expect(detectContextSet('estoy en el burger king')).toBe('burger king');
  });

  it('detects with article "estoy en la telepizza"', () => {
    expect(detectContextSet('estoy en la telepizza')).toBe('telepizza');
  });

  it('strips leading ¿ before matching', () => {
    expect(detectContextSet('¿estoy en mcdonalds?')).toBe('mcdonalds');
  });

  it('strips leading ¡ before matching', () => {
    expect(detectContextSet('¡estoy en mcdonalds!')).toBe('mcdonalds');
  });

  it('returns null for non-context-set input', () => {
    expect(detectContextSet('big mac')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(detectContextSet('')).toBeNull();
  });

  it('returns null for multiline text', () => {
    expect(detectContextSet('estoy en\nmcdonalds')).toBeNull();
  });

  it('returns null when capture is too long (>50 chars)', () => {
    const long = 'estoy en ' + 'a'.repeat(51);
    expect(detectContextSet(long)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractPortionModifier
// ---------------------------------------------------------------------------

describe('extractPortionModifier', () => {
  it('detects "grande" and returns 1.5 multiplier', () => {
    const result = extractPortionModifier('pizza grande');
    expect(result.portionMultiplier).toBe(1.5);
    expect(result.cleanQuery).toBe('pizza');
  });

  it('detects "doble" and returns 2.0 multiplier', () => {
    const result = extractPortionModifier('hamburguesa doble');
    expect(result.portionMultiplier).toBe(2.0);
    expect(result.cleanQuery).toBe('hamburguesa');
  });

  it('detects "extra grande" and returns 1.5 multiplier', () => {
    const result = extractPortionModifier('patatas extra grandes');
    expect(result.portionMultiplier).toBe(1.5);
    expect(result.cleanQuery).toBe('patatas');
  });

  it('detects "mini" and returns 0.7 multiplier', () => {
    const result = extractPortionModifier('café mini');
    expect(result.portionMultiplier).toBe(0.7);
    expect(result.cleanQuery).toBe('café');
  });

  it('returns 1.0 and original text when no modifier found', () => {
    const result = extractPortionModifier('big mac');
    expect(result.portionMultiplier).toBe(1.0);
    expect(result.cleanQuery).toBe('big mac');
  });

  it('returns original text when stripping modifier leaves empty string', () => {
    // "grande" alone — stripping leaves nothing, fall back to original
    const result = extractPortionModifier('grande');
    expect(result.portionMultiplier).toBe(1.0);
    expect(result.cleanQuery).toBe('grande');
  });
});

// ---------------------------------------------------------------------------
// splitByComparator
// ---------------------------------------------------------------------------

describe('splitByComparator', () => {
  it('splits on "vs"', () => {
    expect(splitByComparator('big mac vs whopper')).toEqual(['big mac', 'whopper']);
  });

  it('splits on "versus"', () => {
    expect(splitByComparator('big mac versus whopper')).toEqual(['big mac', 'whopper']);
  });

  it('splits on "contra"', () => {
    expect(splitByComparator('big mac contra whopper')).toEqual(['big mac', 'whopper']);
  });

  it('splits on space-flanked "o" (last occurrence)', () => {
    expect(splitByComparator('big mac o whopper')).toEqual(['big mac', 'whopper']);
  });

  it('splits on space-flanked "y" (last occurrence)', () => {
    expect(splitByComparator('big mac y whopper')).toEqual(['big mac', 'whopper']);
  });

  it('returns null for empty string', () => {
    expect(splitByComparator('')).toBeNull();
  });

  it('returns null when no separator found', () => {
    expect(splitByComparator('big mac')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseDishExpression
// ---------------------------------------------------------------------------

describe('parseDishExpression', () => {
  it('parses a plain dish name', () => {
    const result = parseDishExpression('big mac');
    expect(result.query).toBe('big mac');
    expect(result.chainSlug).toBeUndefined();
    expect(result.portionMultiplier).toBe(1.0);
  });

  it('extracts chain slug from " en " suffix', () => {
    const result = parseDishExpression('big mac en mcdonalds-es');
    expect(result.query).toBe('big mac');
    expect(result.chainSlug).toBe('mcdonalds-es');
  });

  it('applies portion modifier', () => {
    const result = parseDishExpression('big mac doble');
    expect(result.query).toBe('big mac');
    expect(result.portionMultiplier).toBe(2.0);
  });

  it('strips leading articles', () => {
    const result = parseDishExpression('el big mac');
    expect(result.query).toBe('big mac');
  });

  it('strips trailing punctuation', () => {
    const result = parseDishExpression('big mac?');
    expect(result.query).toBe('big mac');
  });
});

// ---------------------------------------------------------------------------
// extractComparisonQuery
// ---------------------------------------------------------------------------

describe('extractComparisonQuery', () => {
  it('detects "qué tiene más calorías, big mac o whopper"', () => {
    const result = extractComparisonQuery('qué tiene más calorías, big mac o whopper');
    expect(result).not.toBeNull();
    expect(result?.dishA).toBe('big mac');
    expect(result?.dishB).toBe('whopper');
    expect(result?.nutrientFocus).toBe('calorías');
  });

  it('detects "qué engorda más, big mac o whopper" → calorías focus', () => {
    const result = extractComparisonQuery('qué engorda más, big mac o whopper');
    expect(result).not.toBeNull();
    expect(result?.nutrientFocus).toBe('calorías');
  });

  it('detects "compara big mac vs whopper"', () => {
    const result = extractComparisonQuery('compara big mac vs whopper');
    expect(result).not.toBeNull();
    expect(result?.dishA).toBe('big mac');
    expect(result?.dishB).toBe('whopper');
  });

  it('strips leading ¿ before matching', () => {
    const result = extractComparisonQuery('¿qué engorda más, big mac o whopper?');
    expect(result).not.toBeNull();
  });

  it('returns null for plain dish name', () => {
    expect(extractComparisonQuery('big mac')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractComparisonQuery('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractFoodQuery
// ---------------------------------------------------------------------------

describe('extractFoodQuery', () => {
  it('returns plain dish name as-is', () => {
    const result = extractFoodQuery('big mac');
    expect(result.query).toBe('big mac');
    expect(result.chainSlug).toBeUndefined();
  });

  it('strips "cuántas calorías tiene" prefix', () => {
    const result = extractFoodQuery('cuántas calorías tiene el big mac');
    expect(result.query).toBe('big mac');
  });

  it('strips "cuántas calorías" prefix', () => {
    const result = extractFoodQuery('cuántas calorías big mac');
    expect(result.query).toBe('big mac');
  });

  it('strips "qué lleva" prefix', () => {
    const result = extractFoodQuery('qué lleva el big mac');
    expect(result.query).toBe('big mac');
  });

  it('extracts chain slug from " en " suffix', () => {
    const result = extractFoodQuery('big mac en mcdonalds-es');
    expect(result.query).toBe('big mac');
    expect(result.chainSlug).toBe('mcdonalds-es');
  });

  it('strips leading ¿ before processing', () => {
    const result = extractFoodQuery('¿cuántas calorías tiene el big mac?');
    expect(result.query).toBe('big mac');
  });

  it('returns original text when stripping produces empty result', () => {
    // All content was the prefix — fall back to original trimmed input
    const result = extractFoodQuery('cuántas calorías');
    expect(result.query.length).toBeGreaterThan(0);
  });

  it('does not extract chain slug when suffix is not a valid slug format', () => {
    // "mcdonalds" alone has no hyphen — not a valid chain slug
    const result = extractFoodQuery('big mac en mcdonalds');
    expect(result.chainSlug).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// F-NLP — CONVERSATIONAL_WRAPPER_PATTERNS
// ---------------------------------------------------------------------------

describe('F-NLP — CONVERSATIONAL_WRAPPER_PATTERNS', () => {
  // AC15 — Structural: exported array with exactly 12 entries, all RegExp
  it('is exported as readonly RegExp array with 12 entries', () => {
    expect(Array.isArray(CONVERSATIONAL_WRAPPER_PATTERNS)).toBe(true);
    expect(CONVERSATIONAL_WRAPPER_PATTERNS).toHaveLength(12);
    for (const pattern of CONVERSATIONAL_WRAPPER_PATTERNS) {
      expect(pattern).toBeInstanceOf(RegExp);
    }
  });
});

describe('F-NLP — extractFoodQuery', () => {
  // AC1 — strips "me he tomado" wrapper and resolves to dish
  it('strips "me he tomado" wrapper and resolves to dish', () => {
    const result = extractFoodQuery('me he tomado una ración de croquetas');
    expect(result.query).toBe('croquetas');
  });

  // AC2 — strips "acabo de comer" wrapper
  it('strips "acabo de comer" wrapper', () => {
    const result = extractFoodQuery('acabo de comer paella');
    expect(result.query).toBe('paella');
  });

  // AC3 — strips "he desayunado" wrapper leaving multi-item remainder
  it('strips "he desayunado" wrapper leaving multi-item remainder', () => {
    const result = extractFoodQuery('he desayunado café con leche y tostada');
    expect(result.query).toBe('café con leche y tostada');
  });

  // AC4 — strips temporal "anoche cené" wrapper leaving multi-item remainder
  it('strips temporal "anoche cené" wrapper leaving multi-item remainder', () => {
    const result = extractFoodQuery('anoche cené tortilla de patatas con ensalada');
    expect(result.query).toBe('tortilla de patatas con ensalada');
  });

  // AC5 — strips "me he bebido" wrapper
  it('strips "me he bebido" wrapper', () => {
    const result = extractFoodQuery('me he bebido dos cañas de cerveza');
    expect(result.query).toBe('dos cañas de cerveza');
  });

  // AC6 — strips "quiero saber las calorías de" then article
  it('strips "quiero saber las calorías de" then article', () => {
    const result = extractFoodQuery('quiero saber las calorías de un bocadillo de jamón');
    expect(result.query).toBe('bocadillo de jamón');
  });

  // AC7 — strips "cuánto engorda una ración de" via chain
  it('strips "cuánto engorda una ración de" via chain', () => {
    const result = extractFoodQuery('cuánto engorda una ración de croquetas');
    expect(result.query).toBe('croquetas');
  });

  // AC8 — strips "cuánta proteína tiene el" wrapper
  it('strips "cuánta proteína tiene el" wrapper', () => {
    const result = extractFoodQuery('cuánta proteína tiene el pollo a la plancha');
    expect(result.query).toBe('pollo a la plancha');
  });

  // AC9 — strips "necesito saber los nutrientes del" wrapper
  it('strips "necesito saber los nutrientes del" wrapper', () => {
    const result = extractFoodQuery('necesito saber los nutrientes del gazpacho');
    expect(result.query).toBe('gazpacho');
  });

  // AC10 — Negative: does NOT strip "quiero comer algo ligero" (Category D)
  it('does NOT strip "quiero comer algo ligero" (Category D)', () => {
    const result = extractFoodQuery('quiero comer algo ligero');
    expect(result.query).toBe('quiero comer algo ligero');
  });

  // AC11 — Negative: does NOT strip "recomiéndame algo con pocas calorías" (Category D)
  it('does NOT strip "recomiéndame algo con pocas calorías" (Category D)', () => {
    const result = extractFoodQuery('recomiéndame algo con pocas calorías');
    expect(result.query).toBe('recomiéndame algo con pocas calorías');
  });

  // AC12 — Negative: does NOT strip "es sano comer pulpo a la gallega" (opinion)
  it('does NOT strip "es sano comer pulpo a la gallega" (opinion)', () => {
    const result = extractFoodQuery('es sano comer pulpo a la gallega');
    expect(result.query).toBe('es sano comer pulpo a la gallega');
  });

  // AC13 — Regression: "cuántas calorías tiene el big mac" still strips
  it('existing "cuántas calorías tiene el big mac" still strips (regression)', () => {
    const result = extractFoodQuery('cuántas calorías tiene el big mac');
    expect(result.query).toBe('big mac');
  });

  // AC14 — Regression: "cuántas calorías tiene una ración de patatas bravas" still strips via chain
  it('"cuántas calorías tiene una ración de patatas bravas" still strips via chain (regression)', () => {
    const result = extractFoodQuery('cuántas calorías tiene una ración de patatas bravas');
    expect(result.query).toBe('patatas bravas');
  });
});
