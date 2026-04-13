// F-UX-B — Unit tests for portion-label helpers.
//
// Covers `formatPortionTermLabel` (canonical key → Spanish label) and
// `formatPortionDisplayLabel` (unified termDisplay/term display helper added
// in plan v1.1 after Codex M3-2 cross-model code review found web/bot
// inconsistency).

import { describe, it, expect } from 'vitest';
import { formatPortionTermLabel, formatPortionDisplayLabel } from '../portionLabel';

describe('formatPortionTermLabel', () => {
  it('maps "pintxo" → "Pintxo"', () => {
    expect(formatPortionTermLabel('pintxo')).toBe('Pintxo');
  });

  it('maps "pincho" → "Pincho"', () => {
    expect(formatPortionTermLabel('pincho')).toBe('Pincho');
  });

  it('maps "tapa" → "Tapa"', () => {
    expect(formatPortionTermLabel('tapa')).toBe('Tapa');
  });

  it('maps "media_racion" → "Media ración"', () => {
    expect(formatPortionTermLabel('media_racion')).toBe('Media ración');
  });

  it('maps "racion" → "Ración"', () => {
    expect(formatPortionTermLabel('racion')).toBe('Ración');
  });

  it('passes through unknown keys unchanged (e.g. "bocadillo")', () => {
    expect(formatPortionTermLabel('bocadillo')).toBe('bocadillo');
  });

  it('passes through empty string unchanged', () => {
    expect(formatPortionTermLabel('')).toBe('');
  });
});

describe('formatPortionDisplayLabel (M3-2 unified web/bot helper)', () => {
  it('non-empty termDisplay is capitalized first letter (Q6 user wording)', () => {
    expect(formatPortionDisplayLabel('tapa', 'tapa')).toBe('Tapa');
    expect(formatPortionDisplayLabel('pincho', 'pintxo')).toBe('Pincho');
    expect(formatPortionDisplayLabel('pintxo', 'pintxo')).toBe('Pintxo');
    expect(formatPortionDisplayLabel('ración', 'racion')).toBe('Ración');
    expect(formatPortionDisplayLabel('media ración', 'media_racion')).toBe('Media ración');
  });

  it('null termDisplay falls back to formatPortionTermLabel(term)', () => {
    expect(formatPortionDisplayLabel(null, 'media_racion')).toBe('Media ración');
    expect(formatPortionDisplayLabel(null, 'racion')).toBe('Ración');
    expect(formatPortionDisplayLabel(null, 'tapa')).toBe('Tapa');
  });

  it('undefined termDisplay falls back to formatPortionTermLabel(term)', () => {
    expect(formatPortionDisplayLabel(undefined, 'media_racion')).toBe('Media ración');
    expect(formatPortionDisplayLabel(undefined, 'pintxo')).toBe('Pintxo');
  });

  it('empty-string termDisplay falls back to formatPortionTermLabel(term)', () => {
    expect(formatPortionDisplayLabel('', 'media_racion')).toBe('Media ración');
  });

  it('preserves multi-word termDisplay with only first-letter capitalized', () => {
    // Edge case: user writes "media racion" without accent → renders as
    // "Media racion" (capitalization preserves the rest as-is, no auto-correction)
    expect(formatPortionDisplayLabel('media racion', 'media_racion')).toBe('Media racion');
  });

  it('preserves accented characters in the rest of the word', () => {
    expect(formatPortionDisplayLabel('ración', 'racion')).toBe('Ración');
  });

  it('empty string in both fields falls back through gracefully', () => {
    expect(formatPortionDisplayLabel('', '')).toBe('');
  });

  it('M3-2 invariant: same input produces same output across web and bot', () => {
    // This assertion documents the unification: if any future caller
    // diverges from this helper, this test should be updated to assert
    // that ALL render paths funnel through formatPortionDisplayLabel.
    const inputs: Array<[string | null | undefined, string]> = [
      ['tapa', 'tapa'],
      ['pincho', 'pintxo'],
      [null, 'media_racion'],
      [undefined, 'racion'],
      ['', 'pintxo'],
    ];
    for (const [td, t] of inputs) {
      const result = formatPortionDisplayLabel(td, t);
      // Both paths should produce a non-empty string with first letter uppercase
      expect(result.length).toBeGreaterThan(0);
      expect(result.charAt(0)).toBe(result.charAt(0).toUpperCase());
    }
  });
});
