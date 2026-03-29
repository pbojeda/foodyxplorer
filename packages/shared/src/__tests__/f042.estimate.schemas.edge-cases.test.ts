// F042 QA Edge Cases — EstimateQuerySchema and EstimateDataSchema portionMultiplier
//
// Focuses on gaps NOT covered by estimate.schemas.test.ts:
//  - portionMultiplier=0.09 (just below 0.1) rejected
//  - portionMultiplier=5.1 (just above 5.0) rejected
//  - portionMultiplier=0 rejected (duplicate min check with specific 0 value)
//  - portionMultiplier=NaN rejected (coerce path)
//  - portionMultiplier=Infinity rejected
//  - portionMultiplier string '0.09' rejected after coercion
//  - portionMultiplier string '5.1' rejected after coercion
//  - EstimateDataSchema: portionMultiplier exactly at boundaries (0.1, 5.0) accepted
//  - EstimateDataSchema: portionMultiplier negative value rejected
//  - EstimateDataSchema: portionMultiplier=1.0 always present (required field)

import { describe, it, expect } from 'vitest';
import {
  EstimateQuerySchema,
  EstimateDataSchema,
} from '../schemas/estimate.js';

// ---------------------------------------------------------------------------
// EstimateQuerySchema — portionMultiplier boundary and rejection cases
// ---------------------------------------------------------------------------

describe('EstimateQuerySchema — F042 portionMultiplier edge cases', () => {
  // Just below minimum
  it('rejects portionMultiplier=0.09 (just below 0.1)', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'Big Mac', portionMultiplier: 0.09 });
    expect(result.success).toBe(false);
  });

  it('rejects portionMultiplier string "0.09" (coerced to 0.09, below min)', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'Big Mac', portionMultiplier: '0.09' });
    expect(result.success).toBe(false);
  });

  // Just above maximum
  it('rejects portionMultiplier=5.1 (just above 5.0)', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'Big Mac', portionMultiplier: 5.1 });
    expect(result.success).toBe(false);
  });

  it('rejects portionMultiplier string "5.1" (coerced to 5.1, above max)', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'Big Mac', portionMultiplier: '5.1' });
    expect(result.success).toBe(false);
  });

  // Exact boundaries are valid (regression)
  it('accepts portionMultiplier=0.1 (exact minimum)', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'Big Mac', portionMultiplier: 0.1 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.portionMultiplier).toBe(0.1);
  });

  it('accepts portionMultiplier=5.0 (exact maximum)', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'Big Mac', portionMultiplier: 5.0 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.portionMultiplier).toBe(5);
  });

  // Special numeric values
  it('rejects portionMultiplier=Infinity', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'Big Mac', portionMultiplier: Infinity });
    // Infinity > 5.0 → fails max check
    expect(result.success).toBe(false);
  });

  it('rejects portionMultiplier=-1 (negative)', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'Big Mac', portionMultiplier: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects portionMultiplier=0 (below 0.1 minimum)', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'Big Mac', portionMultiplier: 0 });
    expect(result.success).toBe(false);
  });

  // String coercion: non-numeric strings rejected
  it('rejects portionMultiplier string "abc" (non-numeric, coercion produces NaN)', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'Big Mac', portionMultiplier: 'abc' });
    expect(result.success).toBe(false);
  });

  it('rejects portionMultiplier string "" (empty string, coercion produces 0)', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'Big Mac', portionMultiplier: '' });
    // z.coerce.number('') → 0 → fails min(0.1)
    expect(result.success).toBe(false);
  });

  // String coercion: valid numeric strings accepted
  it('accepts portionMultiplier string "0.1" (coerced to 0.1)', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'Big Mac', portionMultiplier: '0.1' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.portionMultiplier).toBe(0.1);
  });

  it('accepts portionMultiplier string "5" (coerced to 5.0)', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'Big Mac', portionMultiplier: '5' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.portionMultiplier).toBe(5);
  });

  it('accepts portionMultiplier string "2.5" (coerced to 2.5)', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'Big Mac', portionMultiplier: '2.5' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.portionMultiplier).toBe(2.5);
  });
});

// ---------------------------------------------------------------------------
// EstimateDataSchema — portionMultiplier required and boundary cases
// ---------------------------------------------------------------------------

const BASE_DATA = {
  query: 'Big Mac',
  chainSlug: null,
  level1Hit: true,
  level2Hit: false,
  level3Hit: false,
  level4Hit: false,
  matchType: 'exact_dish' as const,
  result: null,
  cachedAt: null,
};

describe('EstimateDataSchema — F042 portionMultiplier edge cases', () => {
  // Exact boundaries accepted
  it('accepts portionMultiplier=0.1 (exact minimum in data payload)', () => {
    const data = { ...BASE_DATA, portionMultiplier: 0.1 };
    expect(EstimateDataSchema.safeParse(data).success).toBe(true);
  });

  it('accepts portionMultiplier=5.0 (exact maximum in data payload)', () => {
    const data = { ...BASE_DATA, portionMultiplier: 5.0 };
    expect(EstimateDataSchema.safeParse(data).success).toBe(true);
  });

  it('accepts portionMultiplier=1.0 (standard default in data payload)', () => {
    const data = { ...BASE_DATA, portionMultiplier: 1.0 };
    expect(EstimateDataSchema.safeParse(data).success).toBe(true);
  });

  // Rejections
  it('rejects portionMultiplier=0.09 in data payload (just below min)', () => {
    const data = { ...BASE_DATA, portionMultiplier: 0.09 };
    expect(EstimateDataSchema.safeParse(data).success).toBe(false);
  });

  it('rejects portionMultiplier=5.1 in data payload (just above max)', () => {
    const data = { ...BASE_DATA, portionMultiplier: 5.1 };
    expect(EstimateDataSchema.safeParse(data).success).toBe(false);
  });

  it('rejects negative portionMultiplier=-0.5 in data payload', () => {
    const data = { ...BASE_DATA, portionMultiplier: -0.5 };
    expect(EstimateDataSchema.safeParse(data).success).toBe(false);
  });

  // portionMultiplier is a required field — absence fails
  it('rejects data payload missing portionMultiplier (required field)', () => {
    const data = { ...BASE_DATA }; // no portionMultiplier
    expect(EstimateDataSchema.safeParse(data).success).toBe(false);
  });

  // portionMultiplier=0 is out of range
  it('rejects portionMultiplier=0 in data payload', () => {
    const data = { ...BASE_DATA, portionMultiplier: 0 };
    expect(EstimateDataSchema.safeParse(data).success).toBe(false);
  });
});
