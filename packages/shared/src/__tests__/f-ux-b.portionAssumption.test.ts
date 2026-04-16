// F-UX-B — Schema-level invariant tests for PortionAssumptionSchema.
//
// Covers all 15 illegal combinations (I1–I15) and the 4 legal combinations.
// Follows the same pattern as f-ux-a.estimate.schema.test.ts.

import { describe, it, expect } from 'vitest';
import { PortionAssumptionSchema } from '../schemas/estimate';

// ---------------------------------------------------------------------------
// Valid base objects
// ---------------------------------------------------------------------------

function validPerDishWithPieces() {
  return {
    term: 'tapa' as const,
    termDisplay: 'tapa',
    source: 'per_dish' as const,
    grams: 50,
    pieces: 2,
    pieceName: 'croquetas',
    gramsRange: null,
    confidence: 'high' as const,
    fallbackReason: null,
  };
}

function validPerDishNoPieces() {
  return {
    term: 'racion' as const,
    termDisplay: 'ración',
    source: 'per_dish' as const,
    grams: 250,
    pieces: null,
    pieceName: null,
    gramsRange: null,
    confidence: 'medium' as const,
    fallbackReason: null,
  };
}

function validGeneric() {
  return {
    term: 'tapa' as const,
    termDisplay: 'tapa',
    source: 'generic' as const,
    grams: 65,
    pieces: null,
    pieceName: null,
    gramsRange: [50, 80] as [number, number],
    confidence: null,
    fallbackReason: 'no_row' as const,
  };
}

// ---------------------------------------------------------------------------
// Legal combinations
// ---------------------------------------------------------------------------

describe('F-UX-B — PortionAssumptionSchema legal combinations', () => {
  it('L1: accepts per_dish with pieces set', () => {
    expect(PortionAssumptionSchema.safeParse(validPerDishWithPieces()).success).toBe(true);
  });

  it('L2: accepts per_dish with pieces null (gazpacho path)', () => {
    expect(PortionAssumptionSchema.safeParse(validPerDishNoPieces()).success).toBe(true);
  });

  it('L3: accepts generic with gramsRange [50, 80] and grams 65', () => {
    expect(PortionAssumptionSchema.safeParse(validGeneric()).success).toBe(true);
  });

  it('L4: accepts per_dish for media_racion term', () => {
    const obj = {
      ...validPerDishWithPieces(),
      term: 'media_racion' as const,
      termDisplay: 'media ración',
    };
    expect(PortionAssumptionSchema.safeParse(obj).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Illegal combinations — per_dish branch
// ---------------------------------------------------------------------------

describe('F-UX-B — PortionAssumptionSchema illegal combinations (per_dish)', () => {
  it('I1: per_dish + gramsRange non-null must fail', () => {
    const obj = { ...validPerDishWithPieces(), gramsRange: [50, 80] as [number, number] };
    expect(PortionAssumptionSchema.safeParse(obj).success).toBe(false);
  });

  it('I2: per_dish + confidence null must fail', () => {
    const obj = { ...validPerDishWithPieces(), confidence: null };
    expect(PortionAssumptionSchema.safeParse(obj).success).toBe(false);
  });

  it('I3: per_dish + fallbackReason non-null must fail', () => {
    const obj = { ...validPerDishWithPieces(), fallbackReason: 'no_row' as const };
    expect(PortionAssumptionSchema.safeParse(obj).success).toBe(false);
  });

  it('I4: per_dish + pieces: 2, pieceName: null must fail', () => {
    const obj = { ...validPerDishWithPieces(), pieceName: null };
    expect(PortionAssumptionSchema.safeParse(obj).success).toBe(false);
  });

  it('I5: per_dish + pieces: null, pieceName non-null must fail', () => {
    const obj = { ...validPerDishNoPieces(), pieceName: 'croqueta' };
    expect(PortionAssumptionSchema.safeParse(obj).success).toBe(false);
  });

  it('I6: per_dish + pieces: 0 must fail (min 1)', () => {
    const obj = { ...validPerDishWithPieces(), pieces: 0 };
    expect(PortionAssumptionSchema.safeParse(obj).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Illegal combinations — generic branch
// ---------------------------------------------------------------------------

describe('F-UX-B — PortionAssumptionSchema illegal combinations (generic)', () => {
  it('I7: generic + pieces: 2 must fail', () => {
    const obj = { ...validGeneric(), pieces: 2 };
    expect(PortionAssumptionSchema.safeParse(obj).success).toBe(false);
  });

  it('I8: generic + pieceName non-null must fail', () => {
    const obj = { ...validGeneric(), pieceName: 'croqueta' };
    expect(PortionAssumptionSchema.safeParse(obj).success).toBe(false);
  });

  it('I9: generic + confidence non-null must fail', () => {
    const obj = { ...validGeneric(), confidence: 'high' as const };
    expect(PortionAssumptionSchema.safeParse(obj).success).toBe(false);
  });

  it('I10: generic + fallbackReason null must fail', () => {
    const obj = { ...validGeneric(), fallbackReason: null };
    expect(PortionAssumptionSchema.safeParse(obj).success).toBe(false);
  });

  it('I11: generic + gramsRange [0, 80] must fail (gramsMin must be > 0)', () => {
    const obj = { ...validGeneric(), gramsRange: [0, 80] as [number, number], grams: 40 };
    expect(PortionAssumptionSchema.safeParse(obj).success).toBe(false);
  });

  it('I12: generic + gramsRange [250, 150] (reversed) must fail', () => {
    const obj = { ...validGeneric(), gramsRange: [250, 150] as [number, number], grams: 200 };
    expect(PortionAssumptionSchema.safeParse(obj).success).toBe(false);
  });

  it('I13: generic + gramsRange [50, 80], grams: 99 must fail (must equal midpoint 65)', () => {
    const obj = { ...validGeneric(), grams: 99 };
    expect(PortionAssumptionSchema.safeParse(obj).success).toBe(false);
  });

  it('I14: generic + gramsRange null must fail', () => {
    const obj = { ...validGeneric(), gramsRange: null };
    expect(PortionAssumptionSchema.safeParse(obj).success).toBe(false);
  });

  it('I15: generic + gramsRange [50, 50] must fail (max must be strictly > min)', () => {
    const obj = { ...validGeneric(), gramsRange: [50, 50] as [number, number], grams: 50 };
    expect(PortionAssumptionSchema.safeParse(obj).success).toBe(false);
  });
});
