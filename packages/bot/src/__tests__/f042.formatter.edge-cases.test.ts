// F042 QA Edge Cases — formatEstimate portionMultiplier rendering
//
// Focuses on gaps NOT covered by formatters.test.ts:
//  - null result with portionMultiplier != 1.0 (should still show 'no data', no crash)
//  - Boundary portionMultiplier values (0.1, 5.0) → fall through to '×N' label
//  - Non-standard multiplier with many decimal places
//  - Portion label combined with portionGrams — no duplicate 'Porción:' lines
//  - MarkdownV2 escaping of the '.' in decimal multiplier values

import { describe, it, expect } from 'vitest';
import { formatEstimate } from '../formatters/estimateFormatter.js';
import type { EstimateData } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_RESULT: NonNullable<EstimateData['result']> = {
  entityType: 'dish',
  entityId: 'fd000000-0001-4000-a000-000000000001',
  name: 'Big Mac',
  nameEs: 'Big Mac',
  restaurantId: 'fd000000-0002-4000-a000-000000000001',
  chainSlug: 'mcdonalds-es',
  portionGrams: 200,
  confidenceLevel: 'high',
  estimationMethod: 'official',
  similarityDistance: null,
  source: {
    id: 'fd000000-0004-4000-a000-000000000001',
    name: 'src',
    type: 'official',
    url: null,
  },
  nutrients: {
    calories: 550,
    proteins: 25,
    carbohydrates: 46,
    sugars: 9,
    fats: 28,
    saturatedFats: 10,
    fiber: 3,
    salt: 2.2,
    sodium: 880,
    transFats: 0.5,
    cholesterol: 80,
    potassium: 0,
    monounsaturatedFats: 0,
    polyunsaturatedFats: 0,
    alcohol: 0,
    referenceBasis: 'per_serving',
  },
};

function makeData(portionMultiplier: number, resultOverride?: Partial<NonNullable<EstimateData['result']>>): EstimateData {
  return {
    query: 'big mac',
    chainSlug: null,
    portionMultiplier,
    level1Hit: true,
    level2Hit: false,
    level3Hit: false,
    level4Hit: false,
    matchType: 'exact_dish',
    cachedAt: null,
    result: resultOverride ? { ...BASE_RESULT, ...resultOverride } : BASE_RESULT,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('formatEstimate — F042 portionMultiplier edge cases', () => {
  // -------------------------------------------------------------------------
  // null result + portionMultiplier != 1.0 → should NOT crash, shows no-data
  // -------------------------------------------------------------------------

  it('null result with portionMultiplier=1.5 → shows no-data message, does not crash', () => {
    const data: EstimateData = {
      query: 'xyz',
      chainSlug: null,
      portionMultiplier: 1.5,
      level1Hit: false,
      level2Hit: false,
      level3Hit: false,
      level4Hit: false,
      matchType: null,
      result: null,
      cachedAt: null,
    };
    const result = formatEstimate(data);
    expect(result).toContain('No se encontraron datos nutricionales');
    // Must not contain a Porción label — result is null so there is nothing to label
    expect(result).not.toContain('Porción: grande');
  });

  it('null result with portionMultiplier=3.0 → shows no-data message, does not crash', () => {
    const data: EstimateData = {
      query: 'xyz',
      chainSlug: null,
      portionMultiplier: 3.0,
      level1Hit: false,
      level2Hit: false,
      level3Hit: false,
      level4Hit: false,
      matchType: null,
      result: null,
      cachedAt: null,
    };
    const result = formatEstimate(data);
    expect(result).toContain('No se encontraron datos nutricionales');
    expect(result).not.toContain('triple');
  });

  // -------------------------------------------------------------------------
  // Boundary values — not in PORTION_LABEL_MAP → fall through to ×N label
  // -------------------------------------------------------------------------

  it('portionMultiplier=0.1 (minimum) → falls back to "×0.1" label', () => {
    const result = formatEstimate(makeData(0.1));
    // 0.1 is not in PORTION_LABEL_MAP
    expect(result).toContain('×');
    expect(result).toContain('0');
    // Must NOT show the standard bottom 'Porción: 200 g' line
    expect(result).not.toMatch(/^Porción: 200 g$/m);
  });

  it('portionMultiplier=5.0 (maximum) → falls back to "×5" label', () => {
    const result = formatEstimate(makeData(5.0));
    expect(result).toContain('×');
    expect(result).toContain('5');
    expect(result).not.toMatch(/^Porción: 200 g$/m);
  });

  it('portionMultiplier=2.5 (unlisted) → falls back to "×2.5" label', () => {
    const result = formatEstimate(makeData(2.5));
    expect(result).toContain('×');
    // Must not show one of the named labels
    expect(result).not.toContain('doble');
    expect(result).not.toContain('triple');
  });

  // -------------------------------------------------------------------------
  // MarkdownV2 escaping — decimal point in multiplier value
  // -------------------------------------------------------------------------

  it('portionMultiplier=1.5 → "1.5" is escaped as "1\\.5" in MarkdownV2', () => {
    const result = formatEstimate(makeData(1.5));
    expect(result).toContain('1\\.5');
    // Raw unescaped '1.5' alone must NOT appear (would break MarkdownV2)
    // Verify the escaped form is present (already tested in formatters.test.ts as regression)
    expect(result).toContain('grande');
  });

  it('portionMultiplier=0.7 → "0.7" decimal is escaped as "0\\.7" in MarkdownV2 output', () => {
    // The numeric multiplier value must always be escaped regardless of which label is used.
    const result = formatEstimate(makeData(0.7));
    expect(result).toContain('0\\.7');
  });

  // -------------------------------------------------------------------------
  // No duplicate 'Porción:' lines — when portionMultiplier != 1.0 the bottom
  // portionGrams-only line must NOT appear (combined line used instead)
  // -------------------------------------------------------------------------

  it('portionMultiplier=1.5 with non-null portionGrams → only ONE Porción line, not two', () => {
    const result = formatEstimate(makeData(1.5));
    const portionMatches = result.match(/Porción:/g);
    // Should have exactly one 'Porción:' line (the combined label+grams line)
    expect(portionMatches).not.toBeNull();
    expect(portionMatches!.length).toBe(1);
  });

  it('portionMultiplier=1.0 with non-null portionGrams → only the bottom portionGrams line', () => {
    const result = formatEstimate(makeData(1.0));
    const portionMatches = result.match(/Porción:/g);
    expect(portionMatches).not.toBeNull();
    expect(portionMatches!.length).toBe(1);
    // Should be the plain grams line
    expect(result).toContain('Porción: 200 g');
  });

  it('portionMultiplier=1.5 with portionGrams=null → Porción line with label, no "null" text', () => {
    const result = formatEstimate(makeData(1.5, { portionGrams: null }));
    expect(result).toContain('grande');
    expect(result).not.toContain('null');
    // No grams value shown
    expect(result).not.toMatch(/Porción:.*\d+ g/);
  });

  // -------------------------------------------------------------------------
  // All known PORTION_LABEL_MAP entries are present and rendered correctly
  // -------------------------------------------------------------------------

  it('portionMultiplier=0.5 → renders "media" label (half portion)', () => {
    // Spec corrected per code review: 0.5 → "media" (semantically "media ración" = half)
    const result = formatEstimate(makeData(0.5));
    expect(result).toContain('0\\.5');
    expect(result).toContain('media');
  });

  it('portionMultiplier=0.7 → renders "pequeña" label (small portion)', () => {
    // Spec corrected per code review: 0.7 → "pequeña" (small)
    const result = formatEstimate(makeData(0.7));
    expect(result).toContain('0\\.7');
    expect(result).toContain('peque');
  });

  it('portionMultiplier=2.0 → "doble" label is rendered', () => {
    const result = formatEstimate(makeData(2.0));
    expect(result).toContain('doble');
    // String(2.0) === '2' in JS — the multiplier value shows as 'x2', not 'x2.0'.
    // No decimal point → no MarkdownV2 escaping needed for the numeric part.
    expect(result).toContain('x2');
    expect(result).not.toContain('x2.0');
  });

  it('portionMultiplier=3.0 → "triple" label is rendered', () => {
    const result = formatEstimate(makeData(3.0));
    expect(result).toContain('triple');
    // String(3.0) === '3' in JS — same as above.
    expect(result).toContain('x3');
    expect(result).not.toContain('x3.0');
  });

  // -------------------------------------------------------------------------
  // Portion line placement — label appears BEFORE nutrient block (spec requirement)
  // -------------------------------------------------------------------------

  it('portionMultiplier=1.5 → "Porción:" line appears before "Calorías:" line', () => {
    const result = formatEstimate(makeData(1.5));
    const portionIdx = result.indexOf('Porción:');
    const caloriesIdx = result.indexOf('Calorías:');
    expect(portionIdx).toBeGreaterThanOrEqual(0);
    expect(caloriesIdx).toBeGreaterThanOrEqual(0);
    // Spec §5: portion label is "immediately after the dish name (before the nutrient block)"
    expect(portionIdx).toBeLessThan(caloriesIdx);
  });
});
