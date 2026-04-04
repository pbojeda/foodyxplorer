// F077 — Alcohol display in bot formatters
//
// Verifies that alcohol is shown in estimate output when > 0,
// and hidden when 0 (like other optional nutrients).

import { describe, it, expect } from 'vitest';
import { formatEstimate } from '../formatters/estimateFormatter.js';
import type { EstimateData, EstimateNutrients, EstimateResult } from '@foodxplorer/shared';

function makeNutrients(overrides: Partial<EstimateNutrients> = {}): EstimateNutrients {
  return {
    calories: 43, proteins: 0.5, carbohydrates: 3.6, sugars: 0,
    fats: 0, saturatedFats: 0, fiber: 0, salt: 0, sodium: 0,
    transFats: 0, cholesterol: 0, potassium: 0,
    monounsaturatedFats: 0, polyunsaturatedFats: 0,
    alcohol: 0, referenceBasis: 'per_100g',
    ...overrides,
  };
}

function makeEstimateData(nutrientOverrides: Partial<EstimateNutrients> = {}): EstimateData {
  const result: EstimateResult = {
    entityType: 'food',
    entityId: '00000000-0000-4000-a000-000000000001',
    name: 'Beer',
    nameEs: 'Cerveza',
    restaurantId: null,
    chainSlug: null,
    portionGrams: 330,
    nutrients: makeNutrients(nutrientOverrides),
    confidenceLevel: 'high',
    estimationMethod: 'official',
    source: {
      id: '00000000-0000-4000-a000-000000000002',
      name: 'BEDCA',
      type: 'official',
      url: null,
      priorityTier: 1,
    },
    similarityDistance: null,
  };

  return {
    query: 'cerveza',
    chainSlug: null,
    portionMultiplier: 1,
    level1Hit: true,
    level2Hit: false,
    level3Hit: false,
    level4Hit: false,
    matchType: 'exact_food',
    result,
    cachedAt: null,
  };
}

describe('F077 — Alcohol in estimateFormatter', () => {
  it('shows alcohol line when alcohol > 0', () => {
    const data = makeEstimateData({ alcohol: 4.5 });
    const output = formatEstimate(data);

    expect(output).toContain('Alcohol');
    expect(output).toContain('4');
  });

  it('hides alcohol line when alcohol is 0', () => {
    const data = makeEstimateData({ alcohol: 0 });
    const output = formatEstimate(data);

    expect(output).not.toContain('Alcohol');
  });

  it('uses beer emoji for alcohol', () => {
    const data = makeEstimateData({ alcohol: 12.0 });
    const output = formatEstimate(data);

    expect(output).toContain('🍺');
  });
});
