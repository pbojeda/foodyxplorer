import { describe, it, expect } from 'vitest';
import {
  splitByComparator,
  parseCompararArgs,
  parseDishExpression,
  extractComparisonQuery,
} from '../lib/comparisonParser.js';

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

  it('splits on "con"', () => {
    expect(splitByComparator('big mac con whopper')).toEqual(['big mac', 'whopper']);
  });

  it('splits on " o " (space-flanked)', () => {
    expect(splitByComparator('big mac o whopper')).toEqual(['big mac', 'whopper']);
  });

  it('splits on " y " (space-flanked)', () => {
    expect(splitByComparator('big mac y whopper')).toEqual(['big mac', 'whopper']);
  });

  it('splits on "vs." (trailing dot)', () => {
    expect(splitByComparator('big mac vs. whopper')).toEqual(['big mac', 'whopper']);
  });

  it('longer separator wins over shorter: "pollo o cerdo vs ternera" → vs wins', () => {
    expect(splitByComparator('pollo o cerdo vs ternera')).toEqual([
      'pollo o cerdo',
      'ternera',
    ]);
  });

  it('uses LAST occurrence of "o": multiple space-flanked "o"', () => {
    expect(
      splitByComparator('hamburguesa de queso o hamburguesa de bacon'),
    ).toEqual(['hamburguesa de queso', 'hamburguesa de bacon']);
  });

  it('returns null when no separator present', () => {
    expect(splitByComparator('big mac')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(splitByComparator('')).toBeNull();
  });

  it('returns null when left side is empty', () => {
    expect(splitByComparator('vs whopper')).toBeNull();
  });

  it('returns null when right side is empty', () => {
    expect(splitByComparator('big mac vs')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(splitByComparator('Big Mac VS Whopper')).toEqual(['Big Mac', 'Whopper']);
  });

  it('does not match "o" when embedded in a word (not space-flanked)', () => {
    expect(splitByComparator('pollo')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseCompararArgs
// ---------------------------------------------------------------------------
describe('parseCompararArgs', () => {
  it('returns dishA and dishB for a simple vs split', () => {
    expect(parseCompararArgs('big mac vs whopper')).toEqual({
      dishA: 'big mac',
      dishB: 'whopper',
    });
  });

  it('preserves chain-slug suffixes in each side', () => {
    expect(
      parseCompararArgs('big mac en mcdonalds-es vs whopper en burger-king-es'),
    ).toEqual({
      dishA: 'big mac en mcdonalds-es',
      dishB: 'whopper en burger-king-es',
    });
  });

  it('returns null when no separator found', () => {
    expect(parseCompararArgs('big mac')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseCompararArgs('')).toBeNull();
  });

  it('uses last "o" occurrence', () => {
    expect(parseCompararArgs('hamburguesa de queso o hamburguesa de bacon')).toEqual({
      dishA: 'hamburguesa de queso',
      dishB: 'hamburguesa de bacon',
    });
  });
});

// ---------------------------------------------------------------------------
// parseDishExpression
// ---------------------------------------------------------------------------
describe('parseDishExpression', () => {
  it('returns query and default portionMultiplier when no extras', () => {
    const result = parseDishExpression('big mac');
    expect(result).toEqual({ query: 'big mac', portionMultiplier: 1.0 });
    expect(result.chainSlug).toBeUndefined();
  });

  it('extracts chainSlug from "en <slug>"', () => {
    expect(parseDishExpression('big mac en mcdonalds-es')).toEqual({
      query: 'big mac',
      chainSlug: 'mcdonalds-es',
      portionMultiplier: 1.0,
    });
  });

  it('applies portion modifier "grande"', () => {
    expect(parseDishExpression('big mac grande')).toEqual({
      query: 'big mac',
      portionMultiplier: 1.5,
    });
  });

  it('handles chainSlug and portion modifier together', () => {
    expect(parseDishExpression('big mac grande en mcdonalds-es')).toEqual({
      query: 'big mac',
      chainSlug: 'mcdonalds-es',
      portionMultiplier: 1.5,
    });
  });

  it('does not extract chain when candidate does not match CHAIN_SLUG_REGEX', () => {
    const result = parseDishExpression('pollo en salsa');
    expect(result).toEqual({ query: 'pollo en salsa', portionMultiplier: 1.0 });
    expect(result.chainSlug).toBeUndefined();
  });

  it('extracts chain from LAST "en" when earlier "en" is not a valid slug', () => {
    expect(parseDishExpression('pollo en salsa en mcdonalds-es')).toEqual({
      query: 'pollo en salsa',
      chainSlug: 'mcdonalds-es',
      portionMultiplier: 1.0,
    });
  });

  it('applies "doble" prefix modifier', () => {
    expect(parseDishExpression('doble whopper')).toEqual({
      query: 'whopper',
      portionMultiplier: 2.0,
    });
  });

  it('trims surrounding whitespace', () => {
    const result = parseDishExpression('  big mac  ');
    expect(result).toEqual({ query: 'big mac', portionMultiplier: 1.0 });
    expect(result.chainSlug).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// extractComparisonQuery
// ---------------------------------------------------------------------------
describe('extractComparisonQuery', () => {
  it('parses "qué tiene más calorías" prefix with "o" separator', () => {
    expect(
      extractComparisonQuery('qué tiene más calorías, big mac o whopper'),
    ).toEqual({ dishA: 'big mac', dishB: 'whopper', nutrientFocus: 'calorías' });
  });

  it('parses "qué tiene más proteínas" prefix with "vs" separator', () => {
    expect(
      extractComparisonQuery('qué tiene más proteínas, big mac vs whopper'),
    ).toEqual({ dishA: 'big mac', dishB: 'whopper', nutrientFocus: 'proteínas' });
  });

  it('handles missing accents and uppercase (case-insensitive, accent-insensitive)', () => {
    expect(
      extractComparisonQuery('que tiene mas calorias, big mac o whopper'),
    ).toEqual({ dishA: 'big mac', dishB: 'whopper', nutrientFocus: 'calorías' });
  });

  it('parses "qué tiene menos grasas" prefix', () => {
    expect(
      extractComparisonQuery('qué tiene menos grasas, pizza o hamburguesa'),
    ).toEqual({ dishA: 'pizza', dishB: 'hamburguesa', nutrientFocus: 'grasas' });
  });

  it('parses "qué tiene menos sodio" with "contra" separator', () => {
    expect(
      extractComparisonQuery('qué tiene menos sodio, big mac contra whopper'),
    ).toEqual({ dishA: 'big mac', dishB: 'whopper', nutrientFocus: 'sodio' });
  });

  it('maps "qué engorda más" → nutrientFocus "calorías"', () => {
    expect(
      extractComparisonQuery('qué engorda más, pizza o hamburguesa'),
    ).toEqual({ dishA: 'pizza', dishB: 'hamburguesa', nutrientFocus: 'calorías' });
  });

  it('parses "qué es más sano" → nutrientFocus undefined', () => {
    expect(
      extractComparisonQuery('qué es más sano, ensalada o bollo'),
    ).toEqual({ dishA: 'ensalada', dishB: 'bollo', nutrientFocus: undefined });
  });

  it('parses "compara" prefix', () => {
    expect(
      extractComparisonQuery('compara big mac con whopper'),
    ).toEqual({ dishA: 'big mac', dishB: 'whopper', nutrientFocus: undefined });
  });

  it('parses "comparar" prefix', () => {
    expect(
      extractComparisonQuery('comparar big mac vs whopper'),
    ).toEqual({ dishA: 'big mac', dishB: 'whopper', nutrientFocus: undefined });
  });

  it('maps "hidratos" token → nutrientFocus "carbohidratos"', () => {
    expect(
      extractComparisonQuery('qué tiene más hidratos, arroz vs pasta'),
    ).toEqual({ dishA: 'arroz', dishB: 'pasta', nutrientFocus: 'carbohidratos' });
  });

  it('maps "fibra" token → nutrientFocus "fibra"', () => {
    expect(
      extractComparisonQuery('qué tiene más fibra, avena o pan'),
    ).toEqual({ dishA: 'avena', dishB: 'pan', nutrientFocus: 'fibra' });
  });

  it('maps "sal" token → nutrientFocus "sal"', () => {
    expect(
      extractComparisonQuery('qué tiene más sal, pizza vs hamburguesa'),
    ).toEqual({ dishA: 'pizza', dishB: 'hamburguesa', nutrientFocus: 'sal' });
  });

  it('returns null when no prefix intent is detected', () => {
    expect(extractComparisonQuery('big mac o whopper')).toBeNull();
  });

  it('returns null when prefix matches but remainder has no valid separator', () => {
    expect(
      extractComparisonQuery('qué tiene más calorías, big mac'),
    ).toBeNull();
  });

  it('returns null when prefix is present but remainder is empty', () => {
    expect(extractComparisonQuery('compara')).toBeNull();
  });
});
