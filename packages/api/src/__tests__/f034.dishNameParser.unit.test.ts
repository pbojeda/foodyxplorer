// F034 — Unit tests for parseDishNames in analyze/dishNameParser.ts
//
// Pure function — no mocks needed.
// Tests all filter rules: numeric, short, price-like, allergen codes, punctuation-only.

import { describe, it, expect } from 'vitest';
import { parseDishNames } from '../analyze/dishNameParser.js';

describe('parseDishNames', () => {
  // ---------------------------------------------------------------------------
  // Basic pass-through
  // ---------------------------------------------------------------------------

  it('returns valid dish names unchanged', () => {
    const input = ['Big Mac', 'Ensalada César', 'Pollo al ajillo'];
    const result = parseDishNames(input);
    expect(result).toEqual(['Big Mac', 'Ensalada César', 'Pollo al ajillo']);
  });

  it('returns empty array for empty input', () => {
    expect(parseDishNames([])).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Numeric lines — excluded
  // ---------------------------------------------------------------------------

  it('excludes purely numeric lines', () => {
    expect(parseDishNames(['123'])).toEqual([]);
    expect(parseDishNames(['42'])).toEqual([]);
    expect(parseDishNames(['0'])).toEqual([]);
  });

  it('excludes decimal numeric lines', () => {
    expect(parseDishNames(['42.5'])).toEqual([]);
    expect(parseDishNames(['1,234'])).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Short lines — excluded (< 3 chars)
  // ---------------------------------------------------------------------------

  it('excludes lines shorter than 3 characters', () => {
    expect(parseDishNames(['B'])).toEqual([]);
    expect(parseDishNames(['AB'])).toEqual([]);
    expect(parseDishNames(['12'])).toEqual([]);
  });

  it('accepts lines of exactly 3 characters', () => {
    const result = parseDishNames(['Ham']);
    expect(result).toEqual(['Ham']);
  });

  // ---------------------------------------------------------------------------
  // Price-like lines — excluded
  // ---------------------------------------------------------------------------

  it('excludes price-like lines with euro sign', () => {
    expect(parseDishNames(['5,90€'])).toEqual([]);
    expect(parseDishNames(['12.50€'])).toEqual([]);
    expect(parseDishNames(['9€'])).toEqual([]);
  });

  it('excludes price-like lines without euro sign (bare numbers)', () => {
    // Bare decimal prices like "12.50" or "5,90" look like prices
    expect(parseDishNames(['12.50'])).toEqual([]);
    expect(parseDishNames(['5,90'])).toEqual([]);
  });

  it('excludes lines with trailing euro sign after number+space', () => {
    expect(parseDishNames(['10 €'])).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Allergen codes — excluded (all-caps, ≤ 3 chars)
  // ---------------------------------------------------------------------------

  it('excludes all-caps 3-char allergen codes', () => {
    expect(parseDishNames(['GLU'])).toEqual([]);
    expect(parseDishNames(['LAC'])).toEqual([]);
    expect(parseDishNames(['SOY'])).toEqual([]);
  });

  it('excludes all-caps 2-char codes', () => {
    expect(parseDishNames(['GL'])).toEqual([]);
  });

  it('excludes all-caps 1-char codes', () => {
    expect(parseDishNames(['G'])).toEqual([]);
  });

  it('does NOT exclude mixed-case words of 3 chars (valid dish names)', () => {
    // "Ham" and "Jam" are valid 3-char dish names (not all-caps)
    const result = parseDishNames(['Ham', 'Jam']);
    expect(result).toEqual(['Ham', 'Jam']);
  });

  it('does NOT exclude all-caps words longer than 3 chars (e.g. acronym in menu name)', () => {
    // "MEGA" is 4 chars all-caps — not an allergen code pattern (≤3)
    const result = parseDishNames(['MEGA BURGER']);
    expect(result).toEqual(['MEGA BURGER']);
  });

  // ---------------------------------------------------------------------------
  // Punctuation/symbol-only lines — excluded
  // ---------------------------------------------------------------------------

  it('excludes lines consisting only of punctuation and symbols', () => {
    expect(parseDishNames(['---'])).toEqual([]);
    expect(parseDishNames(['...'])).toEqual([]);
    expect(parseDishNames(['***'])).toEqual([]);
    expect(parseDishNames(['::-::'])).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Whitespace-only lines — excluded
  // ---------------------------------------------------------------------------

  it('excludes whitespace-only lines', () => {
    expect(parseDishNames(['   '])).toEqual([]);
    expect(parseDishNames(['\t'])).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Mixed input — only valid candidates pass through
  // ---------------------------------------------------------------------------

  it('filters a realistic mixed menu list', () => {
    const input = [
      'ENTRANTES',       // valid — longer all-caps section header (len > 3, but all-caps)
      'Ensalada mixta',  // valid
      '8,50€',           // price — excluded
      'GLU',             // allergen — excluded
      '1',               // numeric — excluded
      'Pollo asado',     // valid
      '---',             // punctuation — excluded
      '',                // empty — excluded (length check)
      'Pan',             // valid (3 chars, mixed case)
      '   ',             // whitespace — excluded
    ];

    const result = parseDishNames(input);
    // ENTRANTES passes (> 3 chars, considered section header — not filtered by our rules)
    expect(result).toContain('Ensalada mixta');
    expect(result).toContain('Pollo asado');
    expect(result).toContain('Pan');
    expect(result).not.toContain('8,50€');
    expect(result).not.toContain('GLU');
    expect(result).not.toContain('1');
    expect(result).not.toContain('---');
    expect(result).not.toContain('');
    expect(result).not.toContain('   ');
  });

  it('does not deduplicate — duplicates are preserved', () => {
    const input = ['Burger', 'Burger', 'Pizza'];
    const result = parseDishNames(input);
    expect(result).toEqual(['Burger', 'Burger', 'Pizza']);
  });
});
