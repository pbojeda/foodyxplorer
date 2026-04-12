// F-UX-A QA — Edge-case matrix for `formatPortionLabel` after the
// review-hardening (P2 epsilon guard + canonical tolerance lookup).
//
// Originally authored by qa-engineer to surface the near-1.0 float bug
// and the strict-equality map lookup gap. Rewritten after the fix to
// assert the new epsilon-based contract.

import { describe, it, expect } from 'vitest';
import { formatPortionLabel } from '../portion/portionLabel';
import { EstimateDataSchema } from '../schemas/estimate';

function basePayload(multiplier: number) {
  return {
    query: 'paella',
    chainSlug: null,
    portionMultiplier: multiplier,
    level1Hit: true,
    level2Hit: false,
    level3Hit: false,
    level4Hit: false,
    matchType: null,
    result: null,
    cachedAt: null,
  };
}

const BASE_NUTRIENTS = {
  calories: 500,
  proteins: 20,
  carbohydrates: 40,
  sugars: 5,
  fats: 15,
  saturatedFats: 3,
  fiber: 4,
  salt: 0.8,
  sodium: 320,
  transFats: 0,
  cholesterol: 30,
  potassium: 400,
  monounsaturatedFats: 8,
  polyunsaturatedFats: 3,
  alcohol: 0,
  referenceBasis: 'per_serving' as const,
};

// ---------------------------------------------------------------------------
// API range boundaries
// ---------------------------------------------------------------------------

describe('formatPortionLabel — API range boundaries', () => {
  it('returns "×0.1" for the minimum valid multiplier (0.1)', () => {
    expect(formatPortionLabel(0.1)).toBe('×0.1');
  });

  it('returns "×5" for the maximum valid integer multiplier (5.0)', () => {
    expect(formatPortionLabel(5.0)).toBe('×5');
  });
});

// ---------------------------------------------------------------------------
// Near-1.0 float precision — fixed by PORTION_NOOP_EPSILON
// ---------------------------------------------------------------------------

describe('formatPortionLabel — near-1.0 IEEE 754 tolerance', () => {
  it('returns empty string for 1.0000001 (within PORTION_NOOP_EPSILON of 1.0)', () => {
    expect(formatPortionLabel(1.0000001)).toBe('');
  });

  it('returns empty string for 0.9999999 (within PORTION_NOOP_EPSILON of 1.0)', () => {
    expect(formatPortionLabel(0.9999999)).toBe('');
  });

  it('returns empty string for exactly 1.0', () => {
    expect(formatPortionLabel(1.0)).toBe('');
  });

  it('returns non-empty for 1.002 (outside the 0.001 epsilon band)', () => {
    // 1.002 is just outside the epsilon band so the helper DOES produce a label.
    // It's unmapped → falls back to "×1"
    expect(formatPortionLabel(1.002)).toBe('×1');
  });
});

// ---------------------------------------------------------------------------
// Canonical map tolerance — a noisy float still finds the mapped word
// ---------------------------------------------------------------------------

describe('formatPortionLabel — canonical map tolerance', () => {
  it('returns "grande" for 1.5000000001 (within epsilon of 1.5)', () => {
    expect(formatPortionLabel(1.5000000001)).toBe('grande');
  });

  it('returns "pequeña" for 0.7 (IEEE 754 exact match)', () => {
    expect(formatPortionLabel(0.7)).toBe('pequeña');
  });

  it('returns "pequeña" for 0.5 + 0.2 (arithmetic roundtrip)', () => {
    // 0.5 + 0.2 is exactly 0.7 in IEEE 754 — no precision loss at all here.
    expect(0.5 + 0.2).toBe(0.7);
    expect(formatPortionLabel(0.5 + 0.2)).toBe('pequeña');
  });

  it('returns "media" for 0.5000000001 (epsilon tolerance hits the map)', () => {
    expect(formatPortionLabel(0.5000000001)).toBe('media');
  });

  it('returns "doble" for 1.9999999 (epsilon tolerance rounds up to 2.0)', () => {
    expect(formatPortionLabel(1.9999999)).toBe('doble');
  });
});

// ---------------------------------------------------------------------------
// Unmapped fallback formatting
// ---------------------------------------------------------------------------

describe('formatPortionLabel — unmapped ×N fallback', () => {
  it('returns "×2.5" for 2.5000000001 (outside any mapped epsilon)', () => {
    expect(formatPortionLabel(2.5000000001)).toBe('×2.5');
  });

  it('returns "×4" for the integer 4 (no decimal in pill)', () => {
    expect(formatPortionLabel(4)).toBe('×4');
  });

  it('returns "×1.1" for 1.10 (strips a single trailing zero)', () => {
    expect(formatPortionLabel(1.10)).toBe('×1.1');
  });
});

// ---------------------------------------------------------------------------
// Schema superRefine — near-1.0 still passes as "not === 1.0"
// ---------------------------------------------------------------------------

describe('F-UX-A — EstimateDataSchema superRefine with near-1.0 floats', () => {
  // The superRefine uses a strict `=== 1.0` check rather than the helper's
  // epsilon band. That means a noisy near-1.0 multiplier technically can be
  // attached with baseNutrients without a schema error — but the display
  // helper returns empty string so the card gracefully renders nothing.
  // This is a deliberate asymmetry: the schema is lax at the boundary, the
  // presentation layer is tolerant in the other direction.
  it('portionMultiplier=1.0000001 with baseNutrients PASSES the schema (=== 1.0 is strict)', () => {
    const result = EstimateDataSchema.safeParse({
      ...basePayload(1.0000001),
      baseNutrients: BASE_NUTRIENTS,
      basePortionGrams: 200,
    });
    expect(result.success).toBe(true);
  });

  it('portionMultiplier=0.9999999 with baseNutrients PASSES the schema', () => {
    const result = EstimateDataSchema.safeParse({
      ...basePayload(0.9999999),
      baseNutrients: BASE_NUTRIENTS,
      basePortionGrams: 200,
    });
    expect(result.success).toBe(true);
  });
});
