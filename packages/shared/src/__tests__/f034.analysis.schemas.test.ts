// F034 — Unit tests for analysis.ts Zod schemas
//
// Tests all schemas in packages/shared/src/schemas/analysis.ts.
// Pure Zod validation — no external dependencies.

import { describe, it, expect } from 'vitest';
import {
  AnalyzeMenuModeSchema,
  AnalyzeMenuBodySchema,
  MenuAnalysisDishSchema,
  MenuAnalysisDataSchema,
  MenuAnalysisResponseSchema,
  type AnalyzeMenuMode,
  type MenuAnalysisData,
} from '../schemas/analysis.js';
import type { EstimateData } from '../schemas/estimate.js';

// ---------------------------------------------------------------------------
// AnalyzeMenuModeSchema
// ---------------------------------------------------------------------------

describe('AnalyzeMenuModeSchema', () => {
  it('accepts all valid modes', () => {
    const modes: AnalyzeMenuMode[] = ['auto', 'ocr', 'vision', 'identify'];
    for (const mode of modes) {
      expect(AnalyzeMenuModeSchema.parse(mode)).toBe(mode);
    }
  });

  it('rejects invalid mode', () => {
    expect(() => AnalyzeMenuModeSchema.parse('invalid')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// AnalyzeMenuBodySchema
// ---------------------------------------------------------------------------

describe('AnalyzeMenuBodySchema', () => {
  it('defaults mode to auto when not provided', () => {
    const result = AnalyzeMenuBodySchema.parse({});
    expect(result.mode).toBe('auto');
  });

  it('accepts explicit mode values', () => {
    expect(AnalyzeMenuBodySchema.parse({ mode: 'ocr' }).mode).toBe('ocr');
    expect(AnalyzeMenuBodySchema.parse({ mode: 'vision' }).mode).toBe('vision');
    expect(AnalyzeMenuBodySchema.parse({ mode: 'identify' }).mode).toBe('identify');
  });

  it('rejects invalid mode', () => {
    expect(() => AnalyzeMenuBodySchema.parse({ mode: 'invalid' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// MenuAnalysisDishSchema
// ---------------------------------------------------------------------------

const mockEstimate: EstimateData = {
  query: 'Big Mac',
  chainSlug: null,
  portionMultiplier: 1.0,
  level1Hit: true,
  level2Hit: false,
  level3Hit: false,
  level4Hit: false,
  matchType: 'exact_dish',
  result: {
    entityType: 'dish',
    entityId: '11111111-1111-4000-a000-000000000001',
    name: 'Big Mac',
    nameEs: 'Big Mac',
    restaurantId: '22222222-2222-4000-a000-000000000001',
    chainSlug: 'mcdonalds',
    portionGrams: 214,
    nutrients: {
      calories: 550,
      proteins: 26,
      carbohydrates: 46,
      sugars: 10,
      fats: 29,
      saturatedFats: 11,
      fiber: 3,
      salt: 2.1,
      sodium: 800,
      transFats: 1.5,
      cholesterol: 85,
      potassium: 400,
      monounsaturatedFats: 11,
      polyunsaturatedFats: 3,
      alcohol: 0,
      referenceBasis: 'per_serving',
    },
    confidenceLevel: 'high',
    estimationMethod: 'official',
    source: {
      id: '33333333-3333-4000-a000-000000000001',
      name: 'McDonalds Nutrition',
      type: 'official',
      url: null,
    },
    similarityDistance: null,
  },
  cachedAt: null,
};

describe('MenuAnalysisDishSchema', () => {
  it('accepts a dish with non-null estimate', () => {
    const result = MenuAnalysisDishSchema.parse({
      dishName: 'Big Mac',
      estimate: mockEstimate,
    });
    expect(result.dishName).toBe('Big Mac');
    expect(result.estimate).not.toBeNull();
  });

  it('accepts a dish with null estimate', () => {
    const result = MenuAnalysisDishSchema.parse({
      dishName: 'Mystery Dish',
      estimate: null,
    });
    expect(result.dishName).toBe('Mystery Dish');
    expect(result.estimate).toBeNull();
  });

  it('rejects dishName shorter than 1 character', () => {
    expect(() =>
      MenuAnalysisDishSchema.parse({ dishName: '', estimate: null })
    ).toThrow();
  });

  it('rejects dishName longer than 255 characters', () => {
    expect(() =>
      MenuAnalysisDishSchema.parse({ dishName: 'a'.repeat(256), estimate: null })
    ).toThrow();
  });

  it('requires estimate field (cannot be undefined)', () => {
    expect(() =>
      MenuAnalysisDishSchema.parse({ dishName: 'Test' })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// MenuAnalysisDataSchema
// ---------------------------------------------------------------------------

function buildValidMenuAnalysisData(overrides: Partial<MenuAnalysisData> = {}): MenuAnalysisData {
  return {
    mode: 'auto',
    dishCount: 1,
    dishes: [{ dishName: 'Pizza Margherita', estimate: null }],
    partial: false,
    ...overrides,
  };
}

describe('MenuAnalysisDataSchema', () => {
  it('accepts valid data with partial: false by default', () => {
    const result = MenuAnalysisDataSchema.parse(buildValidMenuAnalysisData());
    expect(result.partial).toBe(false);
  });

  it('defaults partial to false when not provided', () => {
    const data = buildValidMenuAnalysisData();
    const { partial: _partial, ...withoutPartial } = data;
    const result = MenuAnalysisDataSchema.parse(withoutPartial);
    expect(result.partial).toBe(false);
  });

  it('accepts partial: true', () => {
    const result = MenuAnalysisDataSchema.parse(buildValidMenuAnalysisData({ partial: true }));
    expect(result.partial).toBe(true);
  });

  it('rejects dishCount < 1', () => {
    expect(() =>
      MenuAnalysisDataSchema.parse(buildValidMenuAnalysisData({ dishCount: 0 }))
    ).toThrow();
  });

  it('rejects dishes array with 0 elements', () => {
    expect(() =>
      MenuAnalysisDataSchema.parse(buildValidMenuAnalysisData({ dishes: [] }))
    ).toThrow();
  });

  it('rejects non-integer dishCount', () => {
    expect(() =>
      MenuAnalysisDataSchema.parse(buildValidMenuAnalysisData({ dishCount: 1.5 }))
    ).toThrow();
  });

  it('rejects invalid mode', () => {
    expect(() =>
      MenuAnalysisDataSchema.parse(buildValidMenuAnalysisData({ mode: 'invalid' as AnalyzeMenuMode }))
    ).toThrow();
  });

  it('accepts multiple dishes with mixed null/non-null estimates', () => {
    const result = MenuAnalysisDataSchema.parse(
      buildValidMenuAnalysisData({
        dishCount: 2,
        dishes: [
          { dishName: 'Burger', estimate: mockEstimate },
          { dishName: 'Fries', estimate: null },
        ],
      })
    );
    expect(result.dishes).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// MenuAnalysisResponseSchema
// ---------------------------------------------------------------------------

describe('MenuAnalysisResponseSchema', () => {
  it('accepts valid response envelope', () => {
    const result = MenuAnalysisResponseSchema.parse({
      success: true,
      data: buildValidMenuAnalysisData(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects success: false', () => {
    expect(() =>
      MenuAnalysisResponseSchema.parse({
        success: false,
        data: buildValidMenuAnalysisData(),
      })
    ).toThrow();
  });
});
