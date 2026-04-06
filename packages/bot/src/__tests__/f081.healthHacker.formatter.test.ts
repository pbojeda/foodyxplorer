/**
 * F081 — Health-Hacker Tips in Bot Formatter — Unit Tests
 *
 * Verifies formatEstimate() correctly renders health-hacker tips
 * when present in EstimateData.
 */

import { describe, it, expect } from 'vitest';
import { formatEstimate } from '../formatters/estimateFormatter.js';
import type { EstimateData } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_ESTIMATE: EstimateData = {
  query: 'big mac',
  chainSlug: 'mcdonalds-es',
  portionMultiplier: 1,
  level1Hit: true,
  level2Hit: false,
  level3Hit: false,
  level4Hit: false,
  matchType: 'exact_dish',
  cachedAt: null,
  result: {
    entityType: 'dish',
    entityId: 'fd000000-0001-4000-a000-000000000001',
    name: 'Big Mac',
    nameEs: 'Big Mac',
    restaurantId: 'fd000000-0002-4000-a000-000000000001',
    chainSlug: 'mcdonalds-es',
    portionGrams: 200,
    nutrients: {
      calories: 508,
      proteins: 26,
      carbohydrates: 45,
      fats: 30,
      sugars: 9,
      saturatedFats: 11,
      fiber: 3,
      salt: 2.3,
      sodium: 0.92,
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
      id: 'fd000000-0003-4000-a000-000000000001',
      name: 'Chain PDF',
      type: 'official',
      url: null,
    },
    similarityDistance: null,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('formatEstimate with healthHackerTips', () => {
  it('renders tips section when tips are present', () => {
    const data: EstimateData = {
      ...BASE_ESTIMATE,
      healthHackerTips: [
        { tip: 'Ensalada en lugar de patatas fritas', caloriesSaved: 200 },
        { tip: 'Sin salsa especial', caloriesSaved: 80 },
        { tip: 'Pide sin queso', caloriesSaved: 60 },
      ],
    };

    const result = formatEstimate(data);

    expect(result).toContain('Health\\-Hacker Tips');
    expect(result).toContain('Ensalada en lugar de patatas fritas');
    expect(result).toContain('200 kcal');
    expect(result).toContain('Sin salsa especial');
    expect(result).toContain('80 kcal');
    expect(result).toContain('Pide sin queso');
    expect(result).toContain('60 kcal');
  });

  it('does not render tips section when tips are absent', () => {
    const result = formatEstimate(BASE_ESTIMATE);

    expect(result).not.toContain('Health');
    expect(result).not.toContain('Tips');
  });

  it('does not render tips section when tips array is empty', () => {
    const data: EstimateData = {
      ...BASE_ESTIMATE,
      healthHackerTips: [],
    };

    const result = formatEstimate(data);

    expect(result).not.toContain('Health');
  });

  it('tips appear before confidence line', () => {
    const data: EstimateData = {
      ...BASE_ESTIMATE,
      healthHackerTips: [
        { tip: 'Sin queso', caloriesSaved: 60 },
      ],
    };

    const result = formatEstimate(data);

    const tipsIndex = result.indexOf('Health');
    const confidenceIndex = result.indexOf('Confianza');

    expect(tipsIndex).toBeGreaterThan(-1);
    expect(confidenceIndex).toBeGreaterThan(-1);
    expect(tipsIndex).toBeLessThan(confidenceIndex);
  });

  it('tips appear after chain slug', () => {
    const data: EstimateData = {
      ...BASE_ESTIMATE,
      healthHackerTips: [
        { tip: 'Sin queso', caloriesSaved: 60 },
      ],
    };

    const result = formatEstimate(data);

    const chainIndex = result.indexOf('mcdonalds');
    const tipsIndex = result.indexOf('Health');

    expect(chainIndex).toBeGreaterThan(-1);
    expect(tipsIndex).toBeGreaterThan(chainIndex);
  });

  it('single tip renders correctly', () => {
    const data: EstimateData = {
      ...BASE_ESTIMATE,
      healthHackerTips: [
        { tip: 'Agua en lugar de refresco', caloriesSaved: 140 },
      ],
    };

    const result = formatEstimate(data);

    expect(result).toContain('Agua en lugar de refresco');
    expect(result).toContain('140 kcal');
    // Uses bullet point
    expect(result).toContain('•');
  });

  it('escapes special MarkdownV2 characters in tips', () => {
    const data: EstimateData = {
      ...BASE_ESTIMATE,
      healthHackerTips: [
        { tip: 'Sin salsa (especial)', caloriesSaved: 80 },
      ],
    };

    const result = formatEstimate(data);

    // Parentheses should be escaped for MarkdownV2
    expect(result).toContain('\\(especial\\)');
  });

  it('null result still returns no-data message', () => {
    const data: EstimateData = {
      ...BASE_ESTIMATE,
      result: null,
      healthHackerTips: [
        { tip: 'Sin queso', caloriesSaved: 60 },
      ],
    };

    const result = formatEstimate(data);

    expect(result).toContain('No se encontraron datos nutricionales');
    // Tips should NOT appear when result is null
    expect(result).not.toContain('Health');
  });
});
