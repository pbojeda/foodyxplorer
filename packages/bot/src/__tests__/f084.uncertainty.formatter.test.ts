import { describe, it, expect } from 'vitest';
import { formatEstimate } from '../formatters/estimateFormatter.js';
import type { EstimateData } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEstimateData(overrides: Partial<EstimateData> = {}): EstimateData {
  return {
    query: 'pollo a la plancha',
    chainSlug: null,
    portionMultiplier: 1,
    level1Hit: true,
    level2Hit: false,
    level3Hit: false,
    level4Hit: false,
    matchType: 'exact_food',
    cachedAt: null,
    result: {
      entityType: 'food',
      entityId: '00000000-0000-0000-0000-000000000001',
      name: 'Grilled Chicken',
      nameEs: 'Pollo a la plancha',
      restaurantId: null,
      chainSlug: null,
      portionGrams: 200,
      nutrients: {
        calories: 350,
        proteins: 40,
        carbohydrates: 0,
        sugars: 0,
        fats: 15,
        saturatedFats: 4,
        fiber: 0,
        salt: 0.8,
        sodium: 320,
        transFats: 0,
        cholesterol: 90,
        potassium: 0,
        monounsaturatedFats: 0,
        polyunsaturatedFats: 0,
        alcohol: 0,
        referenceBasis: 'per_serving',
      },
      confidenceLevel: 'high',
      estimationMethod: 'official',
      source: {
        id: '00000000-0000-0000-0000-000000000002',
        name: 'USDA',
        type: 'official',
        url: null,
      },
      similarityDistance: null,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('formatEstimate — F084 uncertainty ranges', () => {
  it('renders calorie range when uncertainty is present', () => {
    const data = makeEstimateData({
      uncertaintyRange: { caloriesMin: 332, caloriesMax: 368, percentage: 5 },
    });
    const output = formatEstimate(data);
    expect(output).toContain('332');
    expect(output).toContain('368');
  });

  it('does not render range when uncertainty is absent', () => {
    const data = makeEstimateData();
    const output = formatEstimate(data);
    // Should have calories but no range parenthetical
    expect(output).toContain('350');
    expect(output).not.toContain('332');
  });

  it('renders range inline with calories line', () => {
    const data = makeEstimateData({
      uncertaintyRange: { caloriesMin: 300, caloriesMax: 400, percentage: 15 },
    });
    const output = formatEstimate(data);
    // The range should appear on the same line as calories
    const caloriesLine = output.split('\n').find((l) => l.includes('Calorías'));
    expect(caloriesLine).toContain('300');
    expect(caloriesLine).toContain('400');
  });

  it('does not render range when result is null', () => {
    const data = makeEstimateData({ result: null, uncertaintyRange: undefined });
    const output = formatEstimate(data);
    expect(output).not.toContain('300');
  });

  it('renders range with wide percentage for low confidence', () => {
    const data = makeEstimateData({
      uncertaintyRange: { caloriesMin: 245, caloriesMax: 455, percentage: 30 },
    });
    const output = formatEstimate(data);
    expect(output).toContain('245');
    expect(output).toContain('455');
  });
});
