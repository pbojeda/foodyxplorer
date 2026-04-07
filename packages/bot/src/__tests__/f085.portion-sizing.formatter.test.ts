import { describe, it, expect } from 'vitest';
import { formatEstimate } from '../formatters/estimateFormatter.js';
import type { EstimateData } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEstimateData(overrides: Partial<EstimateData> = {}): EstimateData {
  return {
    query: 'media ración de calamares',
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
      name: 'Fried Squid',
      nameEs: 'Calamares a la romana',
      restaurantId: null,
      chainSlug: null,
      portionGrams: 150,
      nutrients: {
        calories: 300,
        proteins: 18,
        carbohydrates: 20,
        sugars: 1,
        fats: 16,
        saturatedFats: 2,
        fiber: 1,
        salt: 1.0,
        sodium: 400,
        transFats: 0,
        cholesterol: 0,
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

describe('formatEstimate — F085 portion sizing', () => {
  it('renders portion sizing section when present', () => {
    const data = makeEstimateData({
      portionSizing: {
        term: 'media ración',
        gramsMin: 100,
        gramsMax: 125,
        description: 'Media ración estándar española',
      },
    });
    const output = formatEstimate(data);
    expect(output).toContain('media ración');
    expect(output).toContain('100');
    expect(output).toContain('125');
  });

  it('does not render portion sizing when absent', () => {
    const data = makeEstimateData();
    const output = formatEstimate(data);
    expect(output).not.toContain('Porción detectada');
  });

  it('renders portion sizing with equal min/max (caña)', () => {
    const data = makeEstimateData({
      portionSizing: {
        term: 'caña',
        gramsMin: 200,
        gramsMax: 200,
        description: 'Caña de cerveza (200 ml)',
      },
    });
    const output = formatEstimate(data);
    expect(output).toContain('caña');
    expect(output).toContain('200');
  });

  it('does not render portion sizing when result is null', () => {
    const data = makeEstimateData({ result: null, portionSizing: undefined });
    const output = formatEstimate(data);
    expect(output).not.toContain('Porción detectada');
  });
});
