// F076 — Unit tests for formatMenuEstimate

import { describe, it, expect } from 'vitest';
import type { MenuEstimationData, EstimateData } from '@foodxplorer/shared';
import { formatMenuEstimate } from '../formatters/menuFormatter.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeNutrients = (cal: number) => ({
  calories: cal, proteins: 10, carbohydrates: 20, sugars: 5,
  fats: 8, saturatedFats: 3, fiber: 2, salt: 0.5, sodium: 200,
  transFats: 0, cholesterol: 30, potassium: 100,
  monounsaturatedFats: 3, polyunsaturatedFats: 1, alcohol: 0,
  referenceBasis: 'per_serving' as const,
});

const makeEstimation = (query: string, cal: number, confidence: 'high' | 'medium' | 'low' = 'high'): EstimateData => ({
  query,
  chainSlug: null,
  level1Hit: true, level2Hit: false, level3Hit: false, level4Hit: false,
  matchType: 'exact_dish',
  result: {
    entityType: 'dish',
    entityId: 'fd000000-0076-4000-a000-000000000001',
    name: query,
    nameEs: query,
    restaurantId: null,
    chainSlug: null,
    portionGrams: 200,
    nutrients: makeNutrients(cal),
    confidenceLevel: confidence,
    estimationMethod: 'official',
    source: { id: 'src-1', name: 'BEDCA', type: 'official', url: null },
    similarityDistance: null,
  },
  cachedAt: null,
  portionMultiplier: 1,
});

const NULL_ESTIMATION: EstimateData = {
  query: 'plato desconocido',
  chainSlug: null,
  level1Hit: false, level2Hit: false, level3Hit: false, level4Hit: false,
  matchType: null,
  result: null,
  cachedAt: null,
  portionMultiplier: 1,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('formatMenuEstimate (F076)', () => {
  it('all items matched — shows per-item lines + totals + confidence', () => {
    const data: MenuEstimationData = {
      items: [
        { query: 'gazpacho', estimation: makeEstimation('Gazpacho', 120) },
        { query: 'pollo', estimation: makeEstimation('Pollo con patatas', 350) },
        { query: 'flan', estimation: makeEstimation('Flan', 200) },
      ],
      totals: {
        calories: 670, proteins: 30, carbohydrates: 60, sugars: 15,
        fats: 24, saturatedFats: 9, fiber: 6, salt: 1.5, sodium: 600,
        transFats: 0, cholesterol: 90, potassium: 300,
        monounsaturatedFats: 9, polyunsaturatedFats: 3, alcohol: 0,
      },
      itemCount: 3,
      matchedCount: 3,
    };

    const result = formatMenuEstimate(data);

    expect(result).toContain('*Menú del día*');
    expect(result).toContain('Gazpacho');
    expect(result).toContain('Pollo con patatas');
    expect(result).toContain('Flan');
    expect(result).toContain('*Total*');
    expect(result).toContain('670 kcal');
    expect(result).toContain('3/3 platos encontrados');
    expect(result).toContain('Confianza: alta');
  });

  it('partial match — null item shows "no encontrado"', () => {
    const data: MenuEstimationData = {
      items: [
        { query: 'gazpacho', estimation: makeEstimation('Gazpacho', 120) },
        { query: 'plato desconocido', estimation: NULL_ESTIMATION },
      ],
      totals: {
        calories: 120, proteins: 10, carbohydrates: 20, sugars: 5,
        fats: 8, saturatedFats: 3, fiber: 2, salt: 0.5, sodium: 200,
        transFats: 0, cholesterol: 30, potassium: 100,
        monounsaturatedFats: 3, polyunsaturatedFats: 1, alcohol: 0,
      },
      itemCount: 2,
      matchedCount: 1,
    };

    const result = formatMenuEstimate(data);

    expect(result).toContain('no encontrado');
    expect(result).toContain('plato desconocido');
    expect(result).toContain('1/2 platos encontrados');
  });

  it('all items null → shows zero totals and 0/N count', () => {
    const data: MenuEstimationData = {
      items: [
        { query: 'x', estimation: NULL_ESTIMATION },
        { query: 'y', estimation: NULL_ESTIMATION },
      ],
      totals: {
        calories: 0, proteins: 0, carbohydrates: 0, sugars: 0,
        fats: 0, saturatedFats: 0, fiber: 0, salt: 0, sodium: 0,
        transFats: 0, cholesterol: 0, potassium: 0,
        monounsaturatedFats: 0, polyunsaturatedFats: 0, alcohol: 0,
      },
      itemCount: 2,
      matchedCount: 0,
    };

    const result = formatMenuEstimate(data);

    expect(result).toContain('0/2 platos encontrados');
    expect(result).toContain('0 kcal');
    expect(result).not.toContain('Confianza'); // No confidence when nothing matched
  });

  it('escapes MarkdownV2 special characters in dish names', () => {
    const data: MenuEstimationData = {
      items: [
        { query: 'pollo (asado)', estimation: makeEstimation('Pollo (asado)', 350) },
      ],
      totals: {
        calories: 350, proteins: 10, carbohydrates: 20, sugars: 5,
        fats: 8, saturatedFats: 3, fiber: 2, salt: 0.5, sodium: 200,
        transFats: 0, cholesterol: 30, potassium: 100,
        monounsaturatedFats: 3, polyunsaturatedFats: 1, alcohol: 0,
      },
      itemCount: 1,
      matchedCount: 1,
    };

    const result = formatMenuEstimate(data);

    // Parentheses should be escaped
    expect(result).toContain('\\(asado\\)');
  });

  it('shows lowest confidence when mixed levels', () => {
    const data: MenuEstimationData = {
      items: [
        { query: 'a', estimation: makeEstimation('A', 100, 'high') },
        { query: 'b', estimation: makeEstimation('B', 200, 'medium') },
      ],
      totals: {
        calories: 300, proteins: 20, carbohydrates: 40, sugars: 10,
        fats: 16, saturatedFats: 6, fiber: 4, salt: 1, sodium: 400,
        transFats: 0, cholesterol: 60, potassium: 200,
        monounsaturatedFats: 6, polyunsaturatedFats: 2, alcohol: 0,
      },
      itemCount: 2,
      matchedCount: 2,
    };

    const result = formatMenuEstimate(data);

    expect(result).toContain('Confianza: media');
  });

  it('returns a non-empty string', () => {
    const data: MenuEstimationData = {
      items: [{ query: 'a', estimation: makeEstimation('A', 100) }],
      totals: {
        calories: 100, proteins: 10, carbohydrates: 20, sugars: 5,
        fats: 8, saturatedFats: 3, fiber: 2, salt: 0.5, sodium: 200,
        transFats: 0, cholesterol: 30, potassium: 100,
        monounsaturatedFats: 3, polyunsaturatedFats: 1, alcohol: 0,
      },
      itemCount: 1,
      matchedCount: 1,
    };

    const result = formatMenuEstimate(data);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
