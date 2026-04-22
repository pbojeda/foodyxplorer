// F078 — Regional Aliases + "Modo España Real"
//
// Tests for:
// 1. Serving-format prefix stripping in entityExtractor
// 2. Alias SQL clause generation in level1Lookup / level2Lookup

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  extractFoodQuery,
  extractPortionModifier,
  parseDishExpression,
  SERVING_FORMAT_PATTERNS,
} from '../conversation/entityExtractor.js';

// ---------------------------------------------------------------------------
// Serving-format prefix stripping (extractFoodQuery)
// ---------------------------------------------------------------------------

describe('F078 — Serving-format prefix stripping', () => {
  it('strips "tapa de" prefix', () => {
    const result = extractFoodQuery('tapa de calamares');
    expect(result.query).toBe('calamares');
  });

  it('strips "pincho de" prefix', () => {
    const result = extractFoodQuery('pincho de tortilla');
    expect(result.query).toBe('tortilla');
  });

  it('strips "pintxo de" prefix (Basque spelling)', () => {
    const result = extractFoodQuery('pintxo de tortilla');
    expect(result.query).toBe('tortilla');
  });

  it('strips "ración de" prefix', () => {
    const result = extractFoodQuery('ración de patatas bravas');
    expect(result.query).toBe('patatas bravas');
  });

  it('strips "racion de" prefix (no accent)', () => {
    const result = extractFoodQuery('racion de calamares');
    expect(result.query).toBe('calamares');
  });

  it('preserves chain slug with serving-format prefix', () => {
    const result = extractFoodQuery('tapa de patatas bravas en cocina-espanola');
    expect(result.query).toBe('patatas bravas');
    expect(result.chainSlug).toBe('cocina-espanola');
  });

  it('does not strip "tapa" when it IS the entire query', () => {
    // "tapa" alone shouldn't be stripped to empty — fallback to original
    const result = extractFoodQuery('tapa');
    expect(result.query).toBe('tapa');
  });

  it('strips "tapas de" (plural)', () => {
    const result = extractFoodQuery('tapas de jamón');
    expect(result.query).toBe('jamón');
  });

  it('strips "pinchos de" (plural)', () => {
    const result = extractFoodQuery('pinchos de tortilla');
    expect(result.query).toBe('tortilla');
  });

  it('strips "pintxos de" (Basque plural)', () => {
    const result = extractFoodQuery('pintxos de tortilla');
    expect(result.query).toBe('tortilla');
  });

  it('strips "raciones de" (plural)', () => {
    const result = extractFoodQuery('raciones de patatas bravas');
    expect(result.query).toBe('patatas bravas');
  });
});

// ---------------------------------------------------------------------------
// parseDishExpression with serving-format prefixes
// ---------------------------------------------------------------------------

describe('F078 — parseDishExpression with serving-format prefixes', () => {
  it('strips "tapa de" in comparison dish expression', () => {
    const result = parseDishExpression('tapa de calamares');
    expect(result.query).toBe('calamares');
    expect(result.portionMultiplier).toBe(1.0);
  });

  it('strips "pincho de" in comparison dish expression', () => {
    const result = parseDishExpression('pincho de tortilla');
    expect(result.query).toBe('tortilla');
    expect(result.portionMultiplier).toBe(1.0);
  });

  it('handles "media ración de" with portion modifier + serving prefix', () => {
    // "media ración" is already handled by extractPortionModifier → 0.5x
    const result = extractPortionModifier('media ración de patatas bravas');
    expect(result.portionMultiplier).toBe(0.5);
    expect(result.cleanQuery).toContain('patatas bravas');
  });
});

// ---------------------------------------------------------------------------
// Existing prefix patterns still work (regression tests)
// ---------------------------------------------------------------------------

describe('F078 — Regression: existing prefix patterns unaffected', () => {
  it('still strips "cuántas calorías tiene"', () => {
    const result = extractFoodQuery('cuántas calorías tiene un big mac');
    expect(result.query).toBe('big mac');
  });

  it('still strips "qué lleva"', () => {
    const result = extractFoodQuery('qué lleva la paella');
    expect(result.query).toBe('paella');
  });

  it('still extracts chain slug', () => {
    const result = extractFoodQuery('big mac en mcdonalds-es');
    expect(result.query).toBe('big mac');
    expect(result.chainSlug).toBe('mcdonalds-es');
  });
});

// ---------------------------------------------------------------------------
// SERVING_FORMAT_PATTERNS export
// ---------------------------------------------------------------------------

describe('F078 — SERVING_FORMAT_PATTERNS constant', () => {
  // F078 baseline: 5 patterns. F-MORPH added caña de (6). F-DRINK-FU1 added drink containers
  // (tercio/botella/botellín/copa/vaso + de) to strip before L1 lookup so "un tercio de cerveza"
  // resolves to "cerveza". Use a lower-bound assertion to stay robust to future additions.
  it('is an array of RegExp patterns (>= 6)', () => {
    expect(SERVING_FORMAT_PATTERNS.length).toBeGreaterThanOrEqual(6);
    for (const pattern of SERVING_FORMAT_PATTERNS) {
      expect(pattern).toBeInstanceOf(RegExp);
    }
  });

  it('matches singular and plural forms', () => {
    const patterns = SERVING_FORMAT_PATTERNS;
    expect(patterns.some(p => p.test('tapa de calamares'))).toBe(true);
    expect(patterns.some(p => p.test('tapas de calamares'))).toBe(true);
    expect(patterns.some(p => p.test('pincho de tortilla'))).toBe(true);
    expect(patterns.some(p => p.test('pinchos de tortilla'))).toBe(true);
    expect(patterns.some(p => p.test('pintxo de tortilla'))).toBe(true);
    expect(patterns.some(p => p.test('pintxos de tortilla'))).toBe(true);
    expect(patterns.some(p => p.test('ración de jamón'))).toBe(true);
    expect(patterns.some(p => p.test('racion de jamón'))).toBe(true);
    expect(patterns.some(p => p.test('raciones de jamón'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F-DRINK-FU1 — drink container strip (tercio de, botella de, copa de, vaso de)
// ---------------------------------------------------------------------------

describe('F-DRINK-FU1 — drink container strip', () => {
  it('strips "tercio de" → resolves to drink noun', () => {
    expect(extractFoodQuery('un tercio de cerveza').query).toBe('cerveza');
  });

  it('strips "botella de" → resolves to drink noun', () => {
    expect(extractFoodQuery('una botella de vino tinto').query).toBe('vino tinto');
  });

  it('strips "botellín de" → resolves to drink noun', () => {
    expect(extractFoodQuery('un botellín de cerveza').query).toBe('cerveza');
  });

  it('strips "copa de" → resolves to drink noun', () => {
    expect(extractFoodQuery('una copa de vino tinto').query).toBe('vino tinto');
  });

  it('strips "vaso de" → resolves to drink noun', () => {
    expect(extractFoodQuery('un vaso de vino tinto').query).toBe('vino tinto');
  });

  it('strips "vaso de" on agua query', () => {
    expect(extractFoodQuery('un vaso de agua').query).toBe('agua');
  });

  it('handles plural "vasos de" (after F-COUNT numeric strip in upstream pipeline)', () => {
    // extractFoodQuery alone does not strip "dos" (F-COUNT's extractPortionModifier does).
    // In the full conversationCore pipeline, extractPortionModifier runs first, stripping
    // "dos" to leave "vasos de agua", then extractFoodQuery's SERVING strips to "agua".
    // Here we test just the SERVING layer on the post-strip remainder.
    expect(extractFoodQuery('vasos de agua').query).toBe('agua');
  });

  it('does NOT strip bare "copa" / "vaso" without "de" (they stay as portion terms)', () => {
    // Bare "una copa" — ARTICLE strips "una", then "copa" alone is the food query.
    // portionSizing's detectPortionTerm will match "copa" from PORTION_RULES.
    expect(extractFoodQuery('una copa').query).toBe('copa');
  });
});

// ---------------------------------------------------------------------------
// SQL alias clause verification (structural tests)
// ---------------------------------------------------------------------------

describe('F078 — SQL alias matching in lookup files', () => {
  const srcDir = resolve(__dirname, '..');

  it('level1Lookup.ts exact dish match includes aliases @> clause', () => {
    const source = readFileSync(resolve(srcDir, 'estimation/level1Lookup.ts'), 'utf-8');
    // Strategy 1: exact dish match should have aliases @>
    expect(source).toContain('d.aliases @> ARRAY[${normalizedQuery}]');
    // Should also match on name_es
    expect(source).toContain('LOWER(d.name_es) = LOWER(${normalizedQuery})');
  });

  it('level1Lookup.ts exact food match includes aliases @> clause', () => {
    const source = readFileSync(resolve(srcDir, 'estimation/level1Lookup.ts'), 'utf-8');
    expect(source).toContain('f.aliases @> ARRAY[${normalizedQuery}]');
  });

  it('level2Lookup.ts exact dish match includes aliases @> clause', () => {
    const source = readFileSync(resolve(srcDir, 'estimation/level2Lookup.ts'), 'utf-8');
    expect(source).toContain('d.aliases @> ARRAY[${normalizedQuery}]');
    expect(source).toContain('LOWER(d.name_es) = LOWER(${normalizedQuery})');
  });
});
