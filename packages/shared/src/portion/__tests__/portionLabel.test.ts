// F-UX-B — Unit tests for `formatPortionTermLabel` helper.
//
// Covers all 5 canonical DB keys + unknown-key passthrough.
// Placed in packages/shared/src/portion/__tests__/ alongside existing portionLabel.ts.

import { describe, it, expect } from 'vitest';
import { formatPortionTermLabel } from '../portionLabel';

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
