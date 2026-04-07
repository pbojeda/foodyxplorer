import { describe, it, expect } from 'vitest';
import { formatEstimate } from '../formatters/estimateFormatter.js';
import type { EstimateData } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEstimateData(overrides: Partial<EstimateData> = {}): EstimateData {
  return {
    query: 'gambas al ajillo',
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
      name: 'Garlic Shrimp',
      nameEs: 'Gambas al ajillo',
      restaurantId: null,
      chainSlug: null,
      portionGrams: 200,
      nutrients: {
        calories: 350,
        proteins: 25,
        carbohydrates: 5,
        sugars: 1,
        fats: 20,
        saturatedFats: 3,
        fiber: 0,
        salt: 1.2,
        sodium: 480,
        transFats: 0,
        cholesterol: 180,
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

describe('formatEstimate — F083 allergens', () => {
  it('renders allergens section when present', () => {
    const data = makeEstimateData({
      allergens: [
        { allergen: 'Crustáceos', keyword: 'gamba' },
      ],
    });
    const output = formatEstimate(data);
    expect(output).toContain('Alérgenos');
    expect(output).toContain('Crustáceos');
  });

  it('renders multiple allergens', () => {
    const data = makeEstimateData({
      allergens: [
        { allergen: 'Gluten', keyword: 'pizza' },
        { allergen: 'Lácteos', keyword: 'queso' },
        { allergen: 'Crustáceos', keyword: 'gamba' },
      ],
    });
    const output = formatEstimate(data);
    expect(output).toContain('Gluten');
    expect(output).toContain('Lácteos');
    expect(output).toContain('Crustáceos');
  });

  it('does not render allergens section when absent', () => {
    const data = makeEstimateData();
    const output = formatEstimate(data);
    expect(output).not.toContain('Alérgenos');
  });

  it('does not render allergens section when empty array', () => {
    const data = makeEstimateData({ allergens: [] });
    const output = formatEstimate(data);
    expect(output).not.toContain('Alérgenos');
  });

  it('renders allergens after substitutions when both present', () => {
    const data = makeEstimateData({
      substitutions: [
        {
          original: 'Patatas fritas',
          substitute: 'Ensalada verde',
          nutrientDiff: { calories: -275, proteins: 1, fats: -15, carbohydrates: -38, fiber: 2 },
        },
      ],
      allergens: [
        { allergen: 'Crustáceos', keyword: 'gamba' },
      ],
    });
    const output = formatEstimate(data);
    const subsIndex = output.indexOf('Sustituciones');
    const allergensIndex = output.indexOf('Alérgenos');
    expect(subsIndex).toBeGreaterThan(-1);
    expect(allergensIndex).toBeGreaterThan(-1);
    expect(allergensIndex).toBeGreaterThan(subsIndex);
  });

  it('does not render allergens when result is null', () => {
    const data = makeEstimateData({ result: null, allergens: undefined });
    const output = formatEstimate(data);
    expect(output).not.toContain('Alérgenos');
  });

  it('includes disclaimer text', () => {
    const data = makeEstimateData({
      allergens: [
        { allergen: 'Crustáceos', keyword: 'gamba' },
      ],
    });
    const output = formatEstimate(data);
    expect(output).toContain('orientativo');
  });
});
