// Unit tests for F006 — validation helper module.
// No DB, no file I/O, no mocks needed.

import { describe, it, expect } from 'vitest';
import {
  validateSeedData,
  buildExternalId,
  computeSalt,
} from '../../prisma/seed-data/validateSeedData.js';
import type {
  UsdaSrLegacyFoodEntry,
  NameEsMap,
} from '../../prisma/seed-data/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFood(fdcId: number, overrides?: Partial<UsdaSrLegacyFoodEntry>): UsdaSrLegacyFoodEntry {
  return {
    fdcId,
    description: `Food ${fdcId}`,
    foodGroup: 'Vegetables',
    nutrients: {
      calories: 50,
      proteins: 2,
      carbohydrates: 10,
      sugars: 3,
      fats: 0.5,
      saturatedFats: 0.1,
      fiber: 2,
      sodium: 0.01,
      salt: 0.025,
      transFats: 0,
      cholesterol: 0,
      potassium: 0.2,
      monounsaturatedFats: 0.1,
      polyunsaturatedFats: 0.1,
    },
    ...overrides,
  };
}

/** Generate n valid foods starting at fdcId 100000 */
function makeValidFoods(n: number): UsdaSrLegacyFoodEntry[] {
  return Array.from({ length: n }, (_, i) => makeFood(100000 + i));
}

function makeValidNameEsMap(foods: UsdaSrLegacyFoodEntry[]): NameEsMap {
  const map: NameEsMap = {};
  for (const f of foods) {
    map[String(f.fdcId)] = `Alimento ${f.fdcId}`;
  }
  return map;
}

// ---------------------------------------------------------------------------
// validateSeedData
// ---------------------------------------------------------------------------

describe('validateSeedData', () => {
  it('returns valid:true when all fdcIds have Spanish names and count >= 500', () => {
    const foods = makeValidFoods(500);
    const map = makeValidNameEsMap(foods);
    const result = validateSeedData(foods, map);
    expect(result.valid).toBe(true);
    expect(result.errors.filter((e) => !e.startsWith('[WARN]'))).toHaveLength(0);
  });

  it('returns valid:false and lists duplicate fdcIds', () => {
    const foods = [makeFood(111), makeFood(111), makeFood(222)];
    const map = makeValidNameEsMap(foods);
    const result = validateSeedData(foods, map);
    expect(result.valid).toBe(false);
    const dupError = result.errors.find((e) => e.includes('Duplicate fdcIds'));
    expect(dupError).toBeDefined();
    expect(dupError).toContain('111');
  });

  it('returns valid:false and lists missing Spanish name fdcIds', () => {
    const allFoods = makeValidFoods(500);
    const firstFood = allFoods[0];
    if (!firstFood) throw new Error('Expected at least one food');
    // Provide a map that is missing the first food's translation
    const fullMap = makeValidNameEsMap(allFoods);
    // Build a new map omitting the first fdcId
    const mapWithMissing: NameEsMap = Object.fromEntries(
      Object.entries(fullMap).filter(([k]) => k !== String(firstFood.fdcId)),
    );
    const result = validateSeedData(allFoods, mapWithMissing);
    expect(result.valid).toBe(false);
    const missingError = result.errors.find((e) => e.includes('Missing Spanish names'));
    expect(missingError).toBeDefined();
    expect(missingError).toContain(String(firstFood.fdcId));
  });

  it('returns valid:false when foods array length < 500', () => {
    const foods = makeValidFoods(499);
    const map = makeValidNameEsMap(foods);
    const result = validateSeedData(foods, map);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Minimum 500'))).toBe(true);
  });

  it('includes [WARN] entries for foods with calories > 900 (not a blocking error)', () => {
    const foods = makeValidFoods(500);
    const firstFood = foods[0];
    if (!firstFood) throw new Error('Expected at least one food');
    // Override first food to have calories > 900
    foods[0] = makeFood(firstFood.fdcId, {
      nutrients: { ...firstFood.nutrients, calories: 950 },
    });
    const map = makeValidNameEsMap(foods);
    const result = validateSeedData(foods, map);
    // valid should still be true (only [WARN], no blocking errors)
    expect(result.valid).toBe(true);
    const warnEntry = result.errors.find((e) => e.startsWith('[WARN]'));
    expect(warnEntry).toBeDefined();
    expect(warnEntry).toContain('950');
  });

  it('returns valid:false when a required nutrient field is missing (undefined)', () => {
    const food = makeFood(99999);
    // Simulate missing 'calories' field
    const nutrients = { ...food.nutrients } as Partial<typeof food.nutrients>;
    delete nutrients.calories;
    const badFood = { ...food, nutrients: nutrients as typeof food.nutrients };
    const foods = [badFood];
    const map: NameEsMap = { '99999': 'Alimento 99999' };
    const result = validateSeedData(foods, map);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('calories') && e.includes('99999'))).toBe(true);
  });

  it('collects multiple errors in a single pass (does not short-circuit)', () => {
    // 3 foods: duplicates, missing name, count < 500
    const foods = [makeFood(1), makeFood(1), makeFood(2)];
    const map: NameEsMap = { '1': 'Uno' }; // missing '2'
    const result = validateSeedData(foods, map);
    expect(result.valid).toBe(false);
    // Should have: count < 500, duplicate fdcId, missing name
    expect(result.errors.some((e) => e.includes('Minimum 500'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Duplicate fdcIds'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Missing Spanish names'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildExternalId
// ---------------------------------------------------------------------------

describe('buildExternalId', () => {
  it('formats fdcId as USDA-SR-{fdcId}', () => {
    expect(buildExternalId(171077)).toBe('USDA-SR-171077');
  });

  it('handles fdcId=0 correctly', () => {
    expect(buildExternalId(0)).toBe('USDA-SR-0');
  });
});

// ---------------------------------------------------------------------------
// computeSalt
// ---------------------------------------------------------------------------

describe('computeSalt', () => {
  it('returns sodium * 2.54', () => {
    expect(computeSalt(0.1)).toBeCloseTo(0.254, 5);
  });

  it('returns 0 for sodium=0', () => {
    expect(computeSalt(0)).toBe(0);
  });

  it('rounds correctly for floating-point sodium values', () => {
    // 0.065 * 2.54 = 0.1651
    expect(computeSalt(0.065)).toBeCloseTo(0.1651, 4);
  });
});
