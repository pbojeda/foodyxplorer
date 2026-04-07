// F086 — Edge-case tests for detectReverseSearch (QA Engineer pass).
//
// Covers spec-compliance gaps and regex boundary conditions not tested in the
// developer's original f086.entity-extraction.unit.test.ts.

import { describe, it, expect } from 'vitest';
import { detectReverseSearch } from '../conversation/entityExtractor.js';

describe('detectReverseSearch — calorie boundary bypass in conversation pipeline', () => {
  // The Zod schema for the API endpoint enforces maxCalories: min(100), max(3000).
  // The conversation pipeline (processMessage) calls detectReverseSearch, which
  // extracts ANY positive integer — it has NO equivalent bounds check.
  // These tests document this spec-compliance gap.

  it('extracts maxCalories=0 (below API min of 100) — no regex guard', () => {
    const result = detectReverseSearch('me quedan 0 kcal');
    expect(result).toEqual({ maxCalories: 0 });
  });

  it('extracts maxCalories=50 (below API min of 100) — bypasses Zod min boundary', () => {
    const result = detectReverseSearch('me quedan 50 kcal');
    expect(result).toEqual({ maxCalories: 50 });
  });

  it('extracts maxCalories=99 (one below API min) — bypasses Zod min boundary', () => {
    const result = detectReverseSearch('me quedan 99 kcal');
    expect(result).toEqual({ maxCalories: 99 });
  });

  it('extracts maxCalories=9999 (above API max of 3000) — bypasses Zod max boundary', () => {
    const result = detectReverseSearch('me quedan 9999 kcal');
    expect(result).toEqual({ maxCalories: 9999 });
  });

  it('extracts maxCalories=3001 (one above API max) — bypasses Zod max boundary', () => {
    const result = detectReverseSearch('me quedan 3001 kcal');
    expect(result).toEqual({ maxCalories: 3001 });
  });
});

describe('detectReverseSearch — protein pattern gaps', () => {
  // -----------------------------------------------------------------------
  // "al menos Xg DE proteína" — 'de' between 'g' and 'proteína' breaks the
  // pattern /al\s+menos\s+(\d+)\s*g\s*prote[ií]nas?/
  // This is a natural Spanish phrasing that slips through.
  // -----------------------------------------------------------------------

  it('[GAP] does NOT detect protein in "al menos 30g de proteína" — "de" breaks the pattern', () => {
    const result = detectReverseSearch('me quedan 600 kcal al menos 30g de proteína');
    expect(result).not.toBeNull();
    expect(result!.maxCalories).toBe(600);
    // minProtein is NOT detected because 'de' is between 'g' and 'proteína'
    expect(result!.minProtein).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Only protein phrase, no calorie phrase → should return null (no trigger)
  // -----------------------------------------------------------------------

  it('returns null when only protein phrase present, no calorie phrase', () => {
    expect(detectReverseSearch('necesito 30g proteína')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // "necesito Xg proteína CON Y kcal" — calorie at end without trigger phrase
  // -----------------------------------------------------------------------

  it('[GAP] does NOT detect "necesito 30g proteína con 600 kcal" — missing trigger phrase', () => {
    const result = detectReverseSearch('necesito 30g proteína con 600 kcal');
    // 'con X kcal' at end without 'qué como/pido' prefix is not a trigger
    expect(result).toBeNull();
  });

  // -----------------------------------------------------------------------
  // minProtein=0 is valid (spec min is 0) and should be preserved.
  // -----------------------------------------------------------------------

  it('detects minProtein=0 — falsy but valid per spec', () => {
    const result = detectReverseSearch('me quedan 600 kcal necesito 0g proteína');
    expect(result).toEqual({ maxCalories: 600, minProtein: 0 });
  });
});

describe('detectReverseSearch — missing natural language patterns', () => {
  // -----------------------------------------------------------------------
  // Patterns mentioned in spec but NOT in REVERSE_SEARCH_PATTERNS:
  // -----------------------------------------------------------------------

  it('[GAP] does NOT detect "tengo solo 200 kcal" — extra word blocks the pattern', () => {
    // Pattern: /tengo\s+(\d+)\s*.../ — 'solo' between 'tengo' and '200' breaks it
    const result = detectReverseSearch('tengo solo 200 kcal');
    expect(result).toBeNull();
  });

  it('[GAP] does NOT detect "qué comer con 600 kcal" — infinitive not in patterns', () => {
    // Spec patterns use 'como' (1st person) not 'comer' (infinitive)
    const result = detectReverseSearch('qué comer con 600 kcal');
    expect(result).toBeNull();
  });

  it('[GAP] does NOT detect "me sobran 600 kcal" — sobran not in patterns', () => {
    // Common Spanish phrase: "I have X calories left" — not in REVERSE_SEARCH_PATTERNS
    const result = detectReverseSearch('me sobran 600 kcal');
    expect(result).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Multiline input: detectContextSet guards against \n but detectReverseSearch
  // does NOT. Patterns using \s can span newlines in JS regex.
  // -----------------------------------------------------------------------

  it('rejects multiline input — consistent with detectContextSet', () => {
    // Newline guard added for consistency with detectContextSet behavior.
    const result = detectReverseSearch('qué pido\ncon 600 kcal');
    expect(result).toBeNull();
  });
});

describe('detectReverseSearch — all spec-documented patterns confirmed', () => {
  // Positive verification that all patterns in the spec are covered.

  it.each([
    ['qué como con 600 kcal', 600],
    ['que como con 600 kcal', 600],
    ['qué pido con 500 kcal', 500],
    ['que pido con 500 kcal', 500],
    ['me quedan 400 kcal', 400],
    ['me quedan 350 calorías', 350],
    ['600 kcal qué pido', 600],
    ['500 calorías qué como', 500],
    ['tengo 700 kcal', 700],
    ['con 600 kcal qué puedo comer', 600],
  ])('detects "%s" → maxCalories=%d', (text, expected) => {
    const result = detectReverseSearch(text);
    expect(result?.maxCalories).toBe(expected);
  });
});
