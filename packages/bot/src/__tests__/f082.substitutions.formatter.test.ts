import { describe, it, expect } from 'vitest';
import { formatEstimate } from '../formatters/estimateFormatter.js';
import type { EstimateData } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEstimateData(overrides: Partial<EstimateData> = {}): EstimateData {
  return {
    query: 'patatas fritas',
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
      name: 'French Fries',
      nameEs: 'Patatas fritas',
      restaurantId: null,
      chainSlug: null,
      portionGrams: 150,
      nutrients: {
        calories: 400,
        proteins: 4,
        carbohydrates: 48,
        sugars: 0,
        fats: 20,
        saturatedFats: 3,
        fiber: 3,
        salt: 0.8,
        sodium: 320,
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

describe('formatEstimate — F082 substitutions', () => {
  it('renders substitutions section when present', () => {
    const data = makeEstimateData({
      substitutions: [
        {
          original: 'Patatas fritas',
          substitute: 'Ensalada verde',
          nutrientDiff: { calories: -275, proteins: 1, fats: -15, carbohydrates: -38, fiber: 2 },
        },
      ],
    });
    const output = formatEstimate(data);
    expect(output).toContain('Sustituciones');
    expect(output).toContain('Patatas fritas');
    expect(output).toContain('Ensalada verde');
    expect(output).toContain('\\-275 kcal');
  });

  it('renders multiple substitutions', () => {
    const data = makeEstimateData({
      substitutions: [
        {
          original: 'Patatas fritas',
          substitute: 'Ensalada verde',
          nutrientDiff: { calories: -275, proteins: 1, fats: -15, carbohydrates: -38, fiber: 2 },
        },
        {
          original: 'Patatas fritas',
          substitute: 'Verduras al vapor',
          nutrientDiff: { calories: -240, proteins: 2, fats: -14, carbohydrates: -33, fiber: 3 },
        },
      ],
    });
    const output = formatEstimate(data);
    expect(output).toContain('Ensalada verde');
    expect(output).toContain('Verduras al vapor');
  });

  it('does not render substitutions section when absent', () => {
    const data = makeEstimateData();
    const output = formatEstimate(data);
    expect(output).not.toContain('Sustituciones');
  });

  it('does not render substitutions section when empty array', () => {
    const data = makeEstimateData({ substitutions: [] });
    const output = formatEstimate(data);
    expect(output).not.toContain('Sustituciones');
  });

  it('shows positive diffs with + sign', () => {
    const data = makeEstimateData({
      substitutions: [
        {
          original: 'Arroz blanco',
          substitute: 'Quinoa',
          nutrientDiff: { calories: -30, proteins: 5, fats: 2, carbohydrates: -15, fiber: 3 },
        },
      ],
    });
    const output = formatEstimate(data);
    expect(output).toContain('\\+5 prot');
    expect(output).toContain('\\+3 fibra');
  });

  it('omits fiber when diff is 0', () => {
    const data = makeEstimateData({
      substitutions: [
        {
          original: 'Leche entera',
          substitute: 'Leche desnatada',
          nutrientDiff: { calories: -30, proteins: 0, fats: -3, carbohydrates: 0, fiber: 0 },
        },
      ],
    });
    const output = formatEstimate(data);
    expect(output).not.toContain('fibra');
  });

  it('renders substitutions after health-hacker tips when both present', () => {
    const data = makeEstimateData({
      healthHackerTips: [
        { tip: 'Pide sin queso', caloriesSaved: 60 },
      ],
      substitutions: [
        {
          original: 'Patatas fritas',
          substitute: 'Ensalada verde',
          nutrientDiff: { calories: -275, proteins: 1, fats: -15, carbohydrates: -38, fiber: 2 },
        },
      ],
    });
    const output = formatEstimate(data);
    const tipsIndex = output.indexOf('Health\\-Hacker');
    const subsIndex = output.indexOf('Sustituciones');
    expect(tipsIndex).toBeGreaterThan(-1);
    expect(subsIndex).toBeGreaterThan(-1);
    expect(subsIndex).toBeGreaterThan(tipsIndex);
  });

  it('does not render substitutions when result is null', () => {
    const data = makeEstimateData({ result: null, substitutions: undefined });
    const output = formatEstimate(data);
    expect(output).not.toContain('Sustituciones');
  });
});
