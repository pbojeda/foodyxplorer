// F-UX-A — Tests for the shared portion label helper.

import { describe, it, expect } from 'vitest';
import { PORTION_LABEL_MAP, formatPortionLabel } from '../../portion/portionLabel';

describe('PORTION_LABEL_MAP', () => {
  it('contains the 5 canonical Spanish labels', () => {
    expect(PORTION_LABEL_MAP[0.5]).toBe('media');
    expect(PORTION_LABEL_MAP[0.7]).toBe('pequeña');
    expect(PORTION_LABEL_MAP[1.5]).toBe('grande');
    expect(PORTION_LABEL_MAP[2.0]).toBe('doble');
    expect(PORTION_LABEL_MAP[3.0]).toBe('triple');
  });

  it('is frozen (immutable at runtime)', () => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (PORTION_LABEL_MAP as any)[2.5] = 'extra';
    }).toThrow();
  });
});

describe('formatPortionLabel', () => {
  it('returns "media" for 0.5', () => {
    expect(formatPortionLabel(0.5)).toBe('media');
  });

  it('returns "pequeña" for 0.7', () => {
    expect(formatPortionLabel(0.7)).toBe('pequeña');
  });

  it('returns "grande" for 1.5', () => {
    expect(formatPortionLabel(1.5)).toBe('grande');
  });

  it('returns "doble" for 2.0', () => {
    expect(formatPortionLabel(2.0)).toBe('doble');
  });

  it('returns "triple" for 3.0', () => {
    expect(formatPortionLabel(3.0)).toBe('triple');
  });

  it('returns "×2.5" for unmapped 2.5', () => {
    expect(formatPortionLabel(2.5)).toBe('×2.5');
  });

  it('returns "×1.25" for unmapped 1.25', () => {
    expect(formatPortionLabel(1.25)).toBe('×1.25');
  });

  it('returns "×4" for unmapped integer 4', () => {
    expect(formatPortionLabel(4)).toBe('×4');
  });

  it('returns an empty string for 1.0 (no modifier → nothing to display)', () => {
    expect(formatPortionLabel(1.0)).toBe('');
  });

  it('strips trailing zeros from unmapped decimals', () => {
    expect(formatPortionLabel(1.1)).toBe('×1.1');
    expect(formatPortionLabel(2.75)).toBe('×2.75');
  });
});
