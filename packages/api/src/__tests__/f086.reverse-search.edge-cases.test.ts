// F086 — Edge-case tests for reverseSearchDishes query module (QA Engineer pass).
//
// Covers gaps not tested in f086.reverse-search.unit.test.ts:
//   - chainName fallback to slug when no results
//   - portionGrams=0 from DB is treated as null (guarded by > 0 check)
//   - minProtein=0 (falsy but valid) preserved correctly
//   - proteinDensity 2dp rounding for irrational values
//   - totalMatches from window function (LIMIT-independent)
//   - nameEs=null preserved, not replaced by name

import { describe, it, expect, vi } from 'vitest';

// Mock Kysely's sql tagged template literal to return rows from mock db object
vi.mock('kysely', async () => {
  const actual = await vi.importActual('kysely');
  return {
    ...actual,
    sql: new Proxy(
      function sqlTag() { /* no-op */ },
      {
        apply(_target: unknown, _thisArg: unknown, args: unknown[]) {
          return {
            execute: async (db: { _rows: Record<string, unknown>[] }) => ({
              rows: db._rows ?? [],
            }),
          };
        },
      },
    ),
  };
});

import { reverseSearchDishes } from '../estimation/reverseSearch.js';
import { ReverseSearchResultSchema } from '@foodxplorer/shared';

function mockDb(rows: Record<string, unknown>[] = []) {
  return { _rows: rows } as unknown as Parameters<typeof reverseSearchDishes>[0];
}

describe('reverseSearchDishes — chainName fallback', () => {
  it('[BUG] chainName falls back to chainSlug string when no dishes match', async () => {
    // When rows = [], chainName = chainSlug (the slug, not a display name).
    // The API route confirmed the chain exists via Prisma before calling this,
    // but reverseSearchDishes has no way to get the display name for empty results.
    // The formatter renders 'burger-king' instead of 'Burger King'.
    const result = await reverseSearchDishes(mockDb([]), {
      chainSlug: 'burger-king',
      maxCalories: 600,
      limit: 5,
    });

    // Falls back to the slug string — not a human-readable display name
    expect(result.chainName).toBe('burger-king');
    // Note: the formatter shows "Platos en burger-king con ≤ 600 kcal" in this case.
  });
});

describe('reverseSearchDishes — portionGrams=0 from DB', () => {
  it('portionGrams "0" from DB is returned as null (guarded by > 0 check)', async () => {
    // The code: portionGrams: row.portion_grams !== null && toNum(row.portion_grams) > 0
    //              ? toNum(row.portion_grams) : null
    // This guards against 0 being returned, treating it as null.
    // This is correct behavior: portionGrams=0 makes no sense for a serving.
    const db = mockDb([{
      dish_name: 'Zero Portion Dish',
      dish_name_es: null,
      calories: '300',
      proteins: '20',
      fats: '10',
      carbohydrates: '30',
      portion_grams: '0',   // DB returns '0' — guarded to null by > 0 check
      chain_name: 'Test Chain',
      total_matches: '1',
    }]);

    const result = await reverseSearchDishes(db, {
      chainSlug: 'test-chain',
      maxCalories: 600,
      limit: 5,
    });

    // 0 is treated as null — correct and schema-compliant
    expect(result.results[0]!.portionGrams).toBeNull();

    // Confirming schema accepts null (positive() rejects 0, but 0 never reaches schema)
    expect(() =>
      ReverseSearchResultSchema.parse(result.results[0]),
    ).not.toThrow();
  });

  it('portionGrams > 0 from DB is returned as a positive number', async () => {
    const db = mockDb([{
      dish_name: 'Normal Portion Dish',
      dish_name_es: null,
      calories: '300',
      proteins: '20',
      fats: '10',
      carbohydrates: '30',
      portion_grams: '250',
      chain_name: 'Test Chain',
      total_matches: '1',
    }]);

    const result = await reverseSearchDishes(db, {
      chainSlug: 'test-chain',
      maxCalories: 600,
      limit: 5,
    });

    expect(result.results[0]!.portionGrams).toBe(250);
    // Schema validation should pass
    expect(() => ReverseSearchResultSchema.parse(result.results[0])).not.toThrow();
  });
});

describe('reverseSearchDishes — minProtein=0 (falsy but valid)', () => {
  it('minProtein=0 is preserved in response (0 ?? null = 0, not null)', async () => {
    const result = await reverseSearchDishes(mockDb([]), {
      chainSlug: 'burger-king',
      maxCalories: 600,
      minProtein: 0,
      limit: 5,
    });

    // 0 ?? null = 0 (nullish coalescing skips 0), so minProtein=0 is preserved
    expect(result.minProtein).toBe(0);
  });
});

describe('reverseSearchDishes — proteinDensity precision', () => {
  it('rounds proteinDensity to 2 decimal places for repeating decimals', async () => {
    // 10 proteins / 300 calories * 100 = 3.3333... → rounds to 3.33
    const db = mockDb([{
      dish_name: 'Irrational Protein',
      dish_name_es: null,
      calories: '300',
      proteins: '10',
      fats: '5',
      carbohydrates: '40',
      portion_grams: null,
      chain_name: 'Test',
      total_matches: '1',
    }]);

    const result = await reverseSearchDishes(db, {
      chainSlug: 'test',
      maxCalories: 600,
      limit: 5,
    });

    expect(result.results[0]!.proteinDensity).toBe(3.33);
  });

  it('rounds proteinDensity up at midpoint: 2/3*100 = 66.6666... → 66.67', async () => {
    const db = mockDb([{
      dish_name: '2/3 Protein',
      dish_name_es: null,
      calories: '300',
      proteins: '20',
      fats: '5',
      carbohydrates: '40',
      portion_grams: null,
      chain_name: 'Test',
      total_matches: '1',
    }]);

    const result = await reverseSearchDishes(db, {
      chainSlug: 'test',
      maxCalories: 600,
      limit: 5,
    });

    expect(result.results[0]!.proteinDensity).toBe(6.67);
  });
});

describe('reverseSearchDishes — multiple rows and totalMatches', () => {
  it('totalMatches from window function is independent of returned row count', async () => {
    // All rows share the same total_matches value (window function)
    // This simulates LIMIT=2 but 10 total matches in DB
    const db = mockDb([
      {
        dish_name: 'Dish A',
        dish_name_es: null,
        calories: '200',
        proteins: '20',
        fats: '5',
        carbohydrates: '30',
        portion_grams: null,
        chain_name: 'Test Chain',
        total_matches: '10',
      },
      {
        dish_name: 'Dish B',
        dish_name_es: null,
        calories: '300',
        proteins: '15',
        fats: '10',
        carbohydrates: '40',
        portion_grams: '150',
        chain_name: 'Test Chain',
        total_matches: '10',
      },
    ]);

    const result = await reverseSearchDishes(db, {
      chainSlug: 'test-chain',
      maxCalories: 600,
      limit: 2,
    });

    expect(result.results).toHaveLength(2);
    expect(result.totalMatches).toBe(10); // window function total, not result count
    expect(result.chainName).toBe('Test Chain');
  });

  it('nameEs=null is preserved — not replaced with name', async () => {
    // The FORMATTER uses (dish.nameEs ?? dish.name) for display.
    // But reverseSearchDishes itself should preserve null nameEs as null.
    const db = mockDb([{
      dish_name: 'Big Mac',
      dish_name_es: null,
      calories: '500',
      proteins: '25',
      fats: '25',
      carbohydrates: '45',
      portion_grams: '200',
      chain_name: 'McDonalds',
      total_matches: '1',
    }]);

    const result = await reverseSearchDishes(db, {
      chainSlug: 'mcdonalds',
      maxCalories: 600,
      limit: 5,
    });

    expect(result.results[0]!.nameEs).toBeNull();
    expect(result.results[0]!.name).toBe('Big Mac');
  });
});
