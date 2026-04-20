/**
 * BUG-PROD-011 — Unit tests for applyPortionAssumptionScaling.
 *
 * Validates the pure function that scales nutrients by the ratio
 * portionAssumption.grams / result.portionGrams.
 */

import { describe, it, expect } from 'vitest';
import { applyPortionAssumptionScaling, NUMERIC_NUTRIENT_KEYS } from '../estimation/portionUtils.js';
import type { EstimateResult, PortionAssumption } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CROQUETAS_RESULT: EstimateResult = {
  entityType: 'dish',
  entityId: 'b0110000-0001-4000-a000-000000000001',
  name: 'Croquetas de jamón',
  nameEs: 'Croquetas de jamón',
  restaurantId: null,
  chainSlug: null,
  portionGrams: 120,
  nutrients: {
    calories: 290,
    proteins: 12,
    carbohydrates: 25,
    sugars: 2,
    fats: 16,
    saturatedFats: 6,
    fiber: 1,
    salt: 1.2,
    sodium: 0.48,
    transFats: 0.1,
    cholesterol: 45,
    potassium: 200,
    monounsaturatedFats: 7,
    polyunsaturatedFats: 2,
    alcohol: 0,
    referenceBasis: 'per_serving',
  },
  confidence: 0.9,
  estimationMethod: 'direct_match',
};

const RACION_ASSUMPTION: PortionAssumption = {
  term: 'racion',
  termDisplay: 'ración',
  source: 'per_dish',
  grams: 360,
  pieces: 12,
  pieceName: 'croquetas',
  gramsRange: null,
  confidence: 'high',
  fallbackReason: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BUG-PROD-011: applyPortionAssumptionScaling', () => {
  it('AC1: scales nutrients by ratio when portionAssumption.grams > result.portionGrams (ración 360g / 120g = 3×)', () => {
    const scaled = applyPortionAssumptionScaling(CROQUETAS_RESULT, RACION_ASSUMPTION);
    expect(scaled).not.toBeNull();
    expect(scaled!.portionGrams).toBe(360);
    expect(scaled!.nutrients.calories).toBe(870); // 290 × 3
    expect(scaled!.nutrients.proteins).toBe(36); // 12 × 3
    expect(scaled!.nutrients.fats).toBe(48); // 16 × 3
  });

  it('AC2: returns null when portionAssumption grams equal result.portionGrams (tapa=120g)', () => {
    const tapaAssumption: PortionAssumption = {
      ...RACION_ASSUMPTION,
      term: 'tapa',
      termDisplay: 'tapa',
      grams: 120, // same as dish portionGrams
    };
    const scaled = applyPortionAssumptionScaling(CROQUETAS_RESULT, tapaAssumption);
    expect(scaled).toBeNull();
  });

  it('AC4: returns null when grams are equal (chuletón-like dish where standard_portion matches portionGrams)', () => {
    const equalResult: EstimateResult = {
      ...CROQUETAS_RESULT,
      portionGrams: 700,
    };
    const equalAssumption: PortionAssumption = {
      ...RACION_ASSUMPTION,
      grams: 700,
    };
    const scaled = applyPortionAssumptionScaling(equalResult, equalAssumption);
    expect(scaled).toBeNull();
  });

  it('AC5: returns null when source is generic (Tier 3 — label-only, no scaling)', () => {
    const genericAssumption: PortionAssumption = {
      ...RACION_ASSUMPTION,
      source: 'generic',
      gramsRange: [200, 400],
      confidence: null,
      pieces: null,
      pieceName: null,
    };
    const scaled = applyPortionAssumptionScaling(CROQUETAS_RESULT, genericAssumption);
    expect(scaled).toBeNull();
  });

  it('returns null when result.portionGrams is null', () => {
    const nullPortionResult: EstimateResult = {
      ...CROQUETAS_RESULT,
      portionGrams: null,
    };
    const scaled = applyPortionAssumptionScaling(nullPortionResult, RACION_ASSUMPTION);
    expect(scaled).toBeNull();
  });

  it('AC3a: works with multiplier-scaled result (ración grande ×1.5: scaledResult.portionGrams=180, assumption.grams=540)', () => {
    // After applyPortionMultiplier(1.5): portionGrams=180, calories=435
    const scaledByMultiplier: EstimateResult = {
      ...CROQUETAS_RESULT,
      portionGrams: 180,
      nutrients: { ...CROQUETAS_RESULT.nutrients, calories: 435 },
    };
    const grandeAssumption: PortionAssumption = {
      ...RACION_ASSUMPTION,
      grams: 540, // ración(360) × 1.5
    };
    const scaled = applyPortionAssumptionScaling(scaledByMultiplier, grandeAssumption);
    expect(scaled).not.toBeNull();
    expect(scaled!.portionGrams).toBe(540);
    expect(scaled!.nutrients.calories).toBe(1305); // 435 × 3
  });

  it('AC8: media ración (multiplier=0.5 applied upstream: portionGrams=60, assumption.grams=180)', () => {
    // After applyPortionMultiplier(0.5): portionGrams=60, calories=145
    const mediaScaled: EstimateResult = {
      ...CROQUETAS_RESULT,
      portionGrams: 60,
      nutrients: { ...CROQUETAS_RESULT.nutrients, calories: 145 },
    };
    const mediaAssumption: PortionAssumption = {
      ...RACION_ASSUMPTION,
      term: 'media_racion',
      termDisplay: 'media ración',
      grams: 180,
    };
    const scaled = applyPortionAssumptionScaling(mediaScaled, mediaAssumption);
    expect(scaled).not.toBeNull();
    expect(scaled!.portionGrams).toBe(180);
    expect(scaled!.nutrients.calories).toBe(435); // 145 × 3
  });

  it('AC6: does not mutate input result (pure function)', () => {
    const originalCalories = CROQUETAS_RESULT.nutrients.calories;
    const originalPortionGrams = CROQUETAS_RESULT.portionGrams;
    applyPortionAssumptionScaling(CROQUETAS_RESULT, RACION_ASSUMPTION);
    expect(CROQUETAS_RESULT.nutrients.calories).toBe(originalCalories);
    expect(CROQUETAS_RESULT.portionGrams).toBe(originalPortionGrams);
  });

  it('scales all 15 numeric nutrient keys', () => {
    const scaled = applyPortionAssumptionScaling(CROQUETAS_RESULT, RACION_ASSUMPTION);
    expect(scaled).not.toBeNull();
    for (const key of NUMERIC_NUTRIENT_KEYS) {
      const expected = Math.round(CROQUETAS_RESULT.nutrients[key] * 3 * 100) / 100;
      expect(scaled!.nutrients[key]).toBe(expected);
    }
  });

  it('preserves referenceBasis as per_serving', () => {
    const scaled = applyPortionAssumptionScaling(CROQUETAS_RESULT, RACION_ASSUMPTION);
    expect(scaled!.nutrients.referenceBasis).toBe('per_serving');
  });
});
