// Formatter tests for F087 — per-portion display in recipe result
//
// Tests: with/without portions, correct display of per-portion macros

import { describe, it, expect, vi } from 'vitest';

// Mock config to avoid process.exit
vi.mock('../config.js', () => ({
  botConfig: {
    BOT_TOKEN: 'test-token',
    API_BASE_URL: 'http://localhost:3001',
    BOT_API_KEY: 'test-key',
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
  },
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { formatRecipeResult } from '../formatters/recipeFormatter.js';
import type { RecipeCalculateData } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const NUTRIENTS = {
  calories: 1000,
  proteins: 50,
  carbohydrates: 120,
  sugars: 5,
  fats: 30,
  saturatedFats: 8,
  fiber: 10,
  salt: 2,
  sodium: 800,
  transFats: 0,
  cholesterol: 50,
  potassium: 500,
  monounsaturatedFats: 10,
  polyunsaturatedFats: 5,
  alcohol: 0,
  referenceBasis: 'per_serving' as const,
};

const PER_PORTION = {
  ...NUTRIENTS,
  calories: 200,
  proteins: 10,
  carbohydrates: 24,
  fats: 6,
};

const BASE_DATA: RecipeCalculateData = {
  mode: 'free-form',
  resolvedCount: 2,
  unresolvedCount: 0,
  confidenceLevel: 'medium',
  totalNutrients: NUTRIENTS,
  ingredients: [],
  unresolvedIngredients: [],
  cachedAt: null,
  portions: null,
  perPortion: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('formatRecipeResult with perPortion (F087)', () => {
  it('without portions → no per-portion section', () => {
    const result = formatRecipeResult(BASE_DATA);
    expect(result).not.toContain('tupper');
    expect(result).not.toContain('porción');
  });

  it('with portions → shows per-portion header and macros', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      portions: 5,
      perPortion: PER_PORTION,
    };
    const result = formatRecipeResult(data);
    expect(result).toContain('5 tuppers');
    expect(result).toContain('200');   // per-portion calories
  });

  it('with portions=1 → still shows per-portion section', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      portions: 1,
      perPortion: NUTRIENTS,
    };
    const result = formatRecipeResult(data);
    expect(result).toContain('1 tupper');
  });

  it('perPortion with null nutrients → skips those lines', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      portions: 3,
      perPortion: {
        ...NUTRIENTS,
        calories: null,
        proteins: 15,
        carbohydrates: null,
        fats: null,
      },
    };
    const result = formatRecipeResult(data);
    expect(result).toContain('3 tuppers');
    // Should show proteins but not calories
    expect(result).toContain('15');
  });
});
