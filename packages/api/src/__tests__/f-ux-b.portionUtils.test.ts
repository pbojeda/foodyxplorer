// F-UX-B — Unit tests for computeDisplayPieces in portionUtils.ts
//
// Covers the 6 boundary cases from the spec + threshold boundary test.
// The low-multiplier fall-through (< 0.75) lives here, NOT in applyPortionMultiplier.

import { describe, it, expect } from 'vitest';
import { computeDisplayPieces } from '../estimation/portionUtils';

describe('computeDisplayPieces', () => {
  // null input (non-countable dish like gazpacho) always returns null
  it('returns null when scaledPieces is null', () => {
    expect(computeDisplayPieces(null)).toBeNull();
  });

  // Low-multiplier fall-through: scaledPieces < 0.75 → null (no pieces displayed)
  it('returns null when scaledPieces = 0.6 (< 0.75 threshold)', () => {
    // multiplier=0.3, basePieces=2 → 0.6
    expect(computeDisplayPieces(0.6)).toBeNull();
  });

  it('returns null when scaledPieces = 0.25 (< 0.75 threshold)', () => {
    // multiplier=0.25, basePieces=1 → 0.25
    expect(computeDisplayPieces(0.25)).toBeNull();
  });

  it('returns null when scaledPieces = 0.4 (< 0.75 threshold)', () => {
    // multiplier=0.05, basePieces=8 → 0.4
    expect(computeDisplayPieces(0.4)).toBeNull();
  });

  // Threshold boundary: exactly 0.749999 → fall-through; 0.75 → rounds to 1
  it('returns null for scaledPieces = 0.749999 (just below threshold)', () => {
    expect(computeDisplayPieces(0.749999)).toBeNull();
  });

  it('returns 1 for scaledPieces = 0.75 (at threshold, rounds to 1)', () => {
    expect(computeDisplayPieces(0.75)).toBe(1);
  });

  // Normal rounding above threshold
  it('returns 1 for scaledPieces = 0.8 (>= 0.75, rounds to 1)', () => {
    // multiplier=0.4, basePieces=2 → 0.8
    expect(computeDisplayPieces(0.8)).toBe(1);
  });

  it('returns 1 for scaledPieces = 1.0', () => {
    // multiplier=0.5, basePieces=2 → 1.0
    expect(computeDisplayPieces(1.0)).toBe(1);
  });

  it('returns 12 for scaledPieces = 12.0 (multiplier=1.5, basePieces=8)', () => {
    expect(computeDisplayPieces(12.0)).toBe(12);
  });

  // Math.max(1, ...) guard: protects against basePieces=0 data bug (though schema rejects this)
  it('returns 1 for scaledPieces = 0.75 (Math.max(1, round(0.75)) = Math.max(1, 1) = 1)', () => {
    expect(computeDisplayPieces(0.75)).toBe(1);
  });
});
