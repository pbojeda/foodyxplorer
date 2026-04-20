// F006 Edge-Case Tests — QA Review
//
// Covers gaps in the developer's original test suite:
//   1.  validateSeedData — empty-string Spanish name (not just missing key)
//   2.  validateSeedData — negative nutrient values are NOT blocked (validator gap)
//   3.  validateSeedData — exactly 500 foods is valid (boundary)
//   4.  validateSeedData — exactly 499 foods is invalid (off-by-one boundary)
//   5.  validateSeedData — empty array (0 foods) collects a count error
//   6.  validateSeedData — calories exactly 900 does NOT emit a [WARN]
//   7.  validateSeedData — calories exactly 901 DOES emit a [WARN] (and remains valid)
//   8.  validateSeedData — [WARN] entries not counted as blocking errors (valid:true)
//   9.  validateSeedData — multiple missing nutrient fields on same entry reported individually
//  10.  validateSeedData — nameEsMap key present but value is whitespace-only (not treated as missing by current impl)
//  11.  buildExternalId — negative fdcId
//  12.  buildExternalId — large fdcId (integer boundary)
//  13.  buildExternalId — float fdcId (non-integer behavior)
//  14.  computeSalt — negative sodium input (no guard in implementation)
//  15.  computeSalt — large sodium value
//  16.  Actual data files — at least 500 foods in usda-sr-legacy-foods.json
//  17.  Actual data files — no duplicate fdcIds in usda-sr-legacy-foods.json
//  18.  Actual data files — every fdcId in foods JSON has a corresponding entry in name-es-map.json
//  19.  Actual data files — no food in foods JSON has calories > 900 (DB CHECK constraint)
//  20.  Actual data files — no food group exceeds 25% of total (distribution constraint)
//  21.  Actual data files — every food group has at least 10 entries
//  22.  Actual data files — no negative nutrient values

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
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
// Test helpers (mirrors f006.unit.test.ts helpers)
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
// 1. validateSeedData — empty-string Spanish name
// ---------------------------------------------------------------------------

describe('validateSeedData — empty-string Spanish name is a blocking error', () => {
  it('treats an empty-string value in nameEsMap as missing', () => {
    const foods = makeValidFoods(500);
    const map = makeValidNameEsMap(foods);
    const firstFood = foods[0]!;
    // Override the first entry with an empty string (not an absent key)
    map[String(firstFood.fdcId)] = '';
    const result = validateSeedData(foods, map);
    expect(result.valid).toBe(false);
    const missingError = result.errors.find((e) => e.includes('Missing Spanish names'));
    expect(missingError).toBeDefined();
    expect(missingError).toContain(String(firstFood.fdcId));
  });
});

// ---------------------------------------------------------------------------
// 2. validateSeedData — negative nutrient values ARE blocked (fixed validator)
// ---------------------------------------------------------------------------

describe('validateSeedData — negative nutrient values', () => {
  it('returns valid:false for a negative protein value', () => {
    const foods = makeValidFoods(500);
    const badFood = foods[0]!;
    foods[0] = makeFood(badFood.fdcId, {
      nutrients: { ...badFood.nutrients, proteins: -1 },
    });
    const map = makeValidNameEsMap(foods);
    const result = validateSeedData(foods, map);
    expect(result.valid).toBe(false);
    const negError = result.errors.find(
      (e) => e.includes('proteins') && e.includes('-1') && e.includes(String(badFood.fdcId)),
    );
    expect(negError).toBeDefined();
  });

  it('returns valid:false for a negative sodium value', () => {
    const foods = makeValidFoods(500);
    const badFood = foods[0]!;
    foods[0] = makeFood(badFood.fdcId, {
      nutrients: { ...badFood.nutrients, sodium: -0.001 },
    });
    const map = makeValidNameEsMap(foods);
    const result = validateSeedData(foods, map);
    expect(result.valid).toBe(false);
    const negError = result.errors.find(
      (e) => e.includes('sodium') && e.includes(String(badFood.fdcId)),
    );
    expect(negError).toBeDefined();
  });

  it('returns valid:false for a negative calories value', () => {
    const foods = makeValidFoods(500);
    const badFood = foods[0]!;
    foods[0] = makeFood(badFood.fdcId, {
      nutrients: { ...badFood.nutrients, calories: -10 },
    });
    const map = makeValidNameEsMap(foods);
    const result = validateSeedData(foods, map);
    expect(result.valid).toBe(false);
    const negError = result.errors.find(
      (e) => e.includes('calories') && e.includes(String(badFood.fdcId)),
    );
    expect(negError).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 3-4. validateSeedData — minimum count boundary values
// ---------------------------------------------------------------------------

describe('validateSeedData — minimum count boundaries', () => {
  it('returns valid:true for exactly 500 foods (boundary)', () => {
    const foods = makeValidFoods(500);
    const map = makeValidNameEsMap(foods);
    const result = validateSeedData(foods, map);
    expect(result.valid).toBe(true);
    expect(result.errors.filter((e) => !e.startsWith('[WARN]'))).toHaveLength(0);
  });

  it('returns valid:false for exactly 499 foods (off-by-one)', () => {
    const foods = makeValidFoods(499);
    const map = makeValidNameEsMap(foods);
    const result = validateSeedData(foods, map);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('499'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. validateSeedData — empty array (0 foods)
// ---------------------------------------------------------------------------

describe('validateSeedData — empty array', () => {
  it('returns valid:false with a minimum count error for an empty array', () => {
    const result = validateSeedData([], {});
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Minimum 500'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6-8. validateSeedData — calorie boundary values
// ---------------------------------------------------------------------------

describe('validateSeedData — calorie boundary values', () => {
  it('does NOT emit [WARN] for calories exactly 900 (boundary)', () => {
    const foods = makeValidFoods(500);
    const firstFood = foods[0]!;
    foods[0] = makeFood(firstFood.fdcId, {
      nutrients: { ...firstFood.nutrients, calories: 900 },
    });
    const map = makeValidNameEsMap(foods);
    const result = validateSeedData(foods, map);
    expect(result.valid).toBe(true);
    const warnEntries = result.errors.filter((e) => e.startsWith('[WARN]'));
    expect(warnEntries).toHaveLength(0);
  });

  it('emits [WARN] for calories exactly 901 (one above max)', () => {
    const foods = makeValidFoods(500);
    const firstFood = foods[0]!;
    foods[0] = makeFood(firstFood.fdcId, {
      nutrients: { ...firstFood.nutrients, calories: 901 },
    });
    const map = makeValidNameEsMap(foods);
    const result = validateSeedData(foods, map);
    const warnEntries = result.errors.filter((e) => e.startsWith('[WARN]'));
    expect(warnEntries).toHaveLength(1);
    expect(warnEntries[0]).toContain('901');
  });

  it('[WARN]-only result is still valid:true', () => {
    // Calories > 900 is a warning, NOT a blocking error.
    // However, such entries WILL fail the DB CHECK constraint (calories <= 900)
    // at write time. This test confirms the current validator design.
    const foods = makeValidFoods(500);
    const firstFood = foods[0]!;
    foods[0] = makeFood(firstFood.fdcId, {
      nutrients: { ...firstFood.nutrients, calories: 950 },
    });
    const map = makeValidNameEsMap(foods);
    const result = validateSeedData(foods, map);
    // valid is true — no blocking errors
    expect(result.valid).toBe(true);
    // But the warnings exist
    expect(result.errors.some((e) => e.startsWith('[WARN]'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. validateSeedData — multiple missing nutrient fields reported individually
// ---------------------------------------------------------------------------

describe('validateSeedData — multiple missing nutrient fields', () => {
  it('reports each missing core nutrient field as a separate error', () => {
    const food = makeFood(99998);
    // Remove both calories and proteins
    const nutrients = { ...food.nutrients } as Partial<typeof food.nutrients>;
    delete nutrients.calories;
    delete nutrients.proteins;
    const badFood = { ...food, nutrients: nutrients as typeof food.nutrients };
    const map: NameEsMap = { '99998': 'Alimento' };
    const result = validateSeedData([badFood], map);
    expect(result.valid).toBe(false);
    const calError = result.errors.find((e) => e.includes('calories') && e.includes('99998'));
    const protError = result.errors.find((e) => e.includes('proteins') && e.includes('99998'));
    expect(calError).toBeDefined();
    expect(protError).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 10. validateSeedData — whitespace-only nameEs IS caught (fixed validator)
// ---------------------------------------------------------------------------

describe('validateSeedData — whitespace-only Spanish name', () => {
  it('returns valid:false for a whitespace-only nameEs value', () => {
    const foods = makeValidFoods(500);
    const firstFood = foods[0]!;
    const map = makeValidNameEsMap(foods);
    map[String(firstFood.fdcId)] = '   '; // whitespace-only
    const result = validateSeedData(foods, map);
    expect(result.valid).toBe(false);
    const missingError = result.errors.find((e) => e.includes('Missing Spanish names'));
    expect(missingError).toBeDefined();
    expect(missingError).toContain(String(firstFood.fdcId));
  });
});

// ---------------------------------------------------------------------------
// 11-13. buildExternalId — boundary/edge inputs
// ---------------------------------------------------------------------------

describe('buildExternalId — edge inputs', () => {
  it('handles negative fdcId (produces USDA-SR--N format)', () => {
    // Negative IDs should never appear in real data, but the function has no
    // guard. Documents current behavior.
    expect(buildExternalId(-1)).toBe('USDA-SR--1');
  });

  it('handles very large fdcId without truncation', () => {
    expect(buildExternalId(999999999)).toBe('USDA-SR-999999999');
  });

  it('handles float fdcId (JavaScript number coercion, not integer-only)', () => {
    // fdcId type is number, not integer. A float like 1.5 would produce 'USDA-SR-1.5'.
    // Real USDA fdcIds are always integers, so this documents the implicit assumption.
    expect(buildExternalId(1.5)).toBe('USDA-SR-1.5');
  });
});

// ---------------------------------------------------------------------------
// 14-15. computeSalt — edge inputs
// ---------------------------------------------------------------------------

describe('computeSalt — edge inputs', () => {
  it('returns a negative result for negative sodium input (no guard)', () => {
    // The function has no guard against negative input.
    // Negative sodium should never appear, but if it did the result would be
    // a negative salt value. Documents current behavior.
    expect(computeSalt(-1)).toBe(-2.54);
  });

  it('handles large sodium values without overflow', () => {
    // Pure multiplication — no overflow concern for realistic g-per-100g values
    expect(computeSalt(10)).toBeCloseTo(25.4, 5);
  });
});

// ---------------------------------------------------------------------------
// 16-22. Actual data files — consistency and quality checks
// ---------------------------------------------------------------------------

// Load the actual data files once for all file-level tests
const seedDataDir =
  dirname(fileURLToPath(import.meta.url)) + '/../../prisma/seed-data';

const actualFoods: UsdaSrLegacyFoodEntry[] = JSON.parse(
  readFileSync(`${seedDataDir}/usda-sr-legacy-foods.json`, 'utf8'),
) as UsdaSrLegacyFoodEntry[];

const actualNameEsMap: NameEsMap = JSON.parse(
  readFileSync(`${seedDataDir}/name-es-map.json`, 'utf8'),
) as NameEsMap;

const NUTRIENT_KEYS = [
  'calories',
  'proteins',
  'carbohydrates',
  'sugars',
  'fats',
  'saturatedFats',
  'fiber',
  'sodium',
  'salt',
  'transFats',
  'cholesterol',
  'potassium',
  'monounsaturatedFats',
  'polyunsaturatedFats',
] as const;

describe('Actual data files — structural correctness', () => {
  it('usda-sr-legacy-foods.json contains at least 500 foods', () => {
    expect(actualFoods.length).toBeGreaterThanOrEqual(500);
  });

  it('usda-sr-legacy-foods.json has no duplicate fdcIds', () => {
    const ids = actualFoods.map((f) => f.fdcId);
    const uniqueIds = new Set(ids);
    const duplicates = ids.filter((id, idx) => ids.indexOf(id) !== idx);
    expect(uniqueIds.size).toBe(ids.length);
    if (duplicates.length > 0) {
      console.error('Duplicate fdcIds found:', [...new Set(duplicates)]);
    }
  });

  it('every fdcId in foods JSON has a corresponding entry in name-es-map.json', () => {
    const missing = actualFoods.filter(
      (f) =>
        actualNameEsMap[String(f.fdcId)] === undefined ||
        actualNameEsMap[String(f.fdcId)] === '',
    );
    if (missing.length > 0) {
      console.error(
        'Missing Spanish names for fdcIds:',
        missing.map((f) => f.fdcId),
      );
    }
    expect(missing).toHaveLength(0);
  });

  it('every food entry has all 14 core nutrient fields defined', () => {
    const issues: string[] = [];
    for (const food of actualFoods) {
      for (const key of NUTRIENT_KEYS) {
        if (food.nutrients[key] === undefined) {
          issues.push(`fdcId ${food.fdcId}: missing nutrient field "${key}"`);
        }
      }
    }
    if (issues.length > 0) {
      console.error('Missing nutrient fields:', issues);
    }
    expect(issues).toHaveLength(0);
  });
});

describe('Actual data files — DB constraint compliance', () => {
  it('no food has calories > 900 (would violate DB CHECK constraint)', () => {
    // The DB has CHECK (calories <= 900). Any food with calories > 900 in the
    // JSON will cause a batch failure during seeding. The validator only warns
    // about this but does not exclude such entries.
    const violators = actualFoods.filter((f) => f.nutrients.calories > 900);
    if (violators.length > 0) {
      console.error(
        'Foods with calories > 900 (will cause DB batch failure):',
        violators.map((f) => ({
          fdcId: f.fdcId,
          description: f.description,
          calories: f.nutrients.calories,
        })),
      );
    }
    expect(violators).toHaveLength(0);
  });

  it('no food has any negative nutrient value (would violate DB CHECK constraints)', () => {
    const issues: Array<{ fdcId: number; field: string; value: number }> = [];
    for (const food of actualFoods) {
      for (const key of NUTRIENT_KEYS) {
        const value = food.nutrients[key];
        if (typeof value === 'number' && value < 0) {
          issues.push({ fdcId: food.fdcId, field: key, value });
        }
      }
    }
    if (issues.length > 0) {
      console.error('Negative nutrient values found:', issues);
    }
    expect(issues).toHaveLength(0);
  });
});

describe('Actual data files — food group distribution (spec requirement)', () => {
  it('no single food group exceeds 25% of total foods', () => {
    const groupCounts: Record<string, number> = {};
    for (const food of actualFoods) {
      groupCounts[food.foodGroup] = (groupCounts[food.foodGroup] ?? 0) + 1;
    }
    const total = actualFoods.length;
    const violators = Object.entries(groupCounts).filter(
      ([, count]) => count / total > 0.25,
    );
    if (violators.length > 0) {
      console.error(
        'Food groups exceeding 25%:',
        violators.map(([g, c]) => ({
          group: g,
          count: c,
          pct: `${((c / total) * 100).toFixed(1)}%`,
        })),
      );
    }
    expect(violators).toHaveLength(0);
  });

  it('every food group represented in the data has at least 10 entries', () => {
    const groupCounts: Record<string, number> = {};
    for (const food of actualFoods) {
      groupCounts[food.foodGroup] = (groupCounts[food.foodGroup] ?? 0) + 1;
    }
    const underrepresented = Object.entries(groupCounts).filter(
      ([, count]) => count < 10,
    );
    if (underrepresented.length > 0) {
      console.error(
        'Food groups with < 10 entries:',
        underrepresented.map(([g, c]) => ({ group: g, count: c })),
      );
    }
    expect(underrepresented).toHaveLength(0);
  });
});

describe('Actual data files — salt consistency', () => {
  it('salt values are consistent with sodium * 2.54 (tolerance ±0.005g)', () => {
    // The spec states salt = sodium * 2.54 (computed at extraction time).
    // A mismatch indicates a data preparation error.
    const mismatches: Array<{
      fdcId: number;
      sodium: number;
      saltActual: number;
      saltExpected: number;
      diff: number;
    }> = [];

    for (const food of actualFoods) {
      const expected = food.nutrients.sodium * 2.54;
      const actual = food.nutrients.salt;
      const diff = Math.abs(expected - actual);
      // Allow ±0.005g tolerance for rounding during extraction
      if (diff > 0.005) {
        mismatches.push({
          fdcId: food.fdcId,
          sodium: food.nutrients.sodium,
          saltActual: actual,
          saltExpected: expected,
          diff,
        });
      }
    }

    if (mismatches.length > 0) {
      console.warn(
        `${mismatches.length} salt/sodium mismatches (tolerance 0.005g):`,
        mismatches.slice(0, 5),
      );
    }

    // Soft assertion: report count but do not hard-fail on minor rounding
    // differences since the spec says "computed at extraction time" with
    // rounding. Fail only if there are significant mismatches (> 10% of foods).
    const threshold = Math.floor(actualFoods.length * 0.1);
    expect(mismatches.length).toBeLessThanOrEqual(threshold);
  });
});

describe('Actual data files — validateSeedData passes on real files', () => {
  it('validateSeedData returns valid:true for the actual data files', () => {
    const result = validateSeedData(actualFoods, actualNameEsMap);
    // Log any errors for debugging
    const blockingErrors = result.errors.filter((e) => !e.startsWith('[WARN]'));
    if (blockingErrors.length > 0) {
      console.error('Validation errors on real data files:', blockingErrors);
    }
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Spec deviation check: externalId format
// ---------------------------------------------------------------------------

describe('buildExternalId — spec compliance', () => {
  it('externalId format is USDA-SR-{fdcId} not USDA-{fdcId} (distinct from Phase 1)', () => {
    // The spec explicitly requires 'USDA-SR-' prefix to avoid collision with
    // existing Phase 1 foods that use 'USDA-' prefix.
    expect(buildExternalId(171077)).toBe('USDA-SR-171077');
    expect(buildExternalId(171077)).not.toBe('USDA-171077');
  });
});
