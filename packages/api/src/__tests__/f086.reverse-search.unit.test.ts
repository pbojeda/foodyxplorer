import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reverseSearchDishes } from '../estimation/reverseSearch.js';

// ---------------------------------------------------------------------------
// Minimal mock for Kysely's sql`.execute(db)` pattern
// ---------------------------------------------------------------------------

function createMockDb(rows: Record<string, unknown>[] = []) {
  return {
    _lastSql: null as unknown,
    _rows: rows,
  } as unknown;
}

// We mock the sql tag from kysely to capture queries
vi.mock('kysely', async () => {
  const actual = await vi.importActual('kysely');
  return {
    ...actual,
    sql: new Proxy(
      function sqlTag() {
        /* no-op */
      },
      {
        // Tagged template literal: sql`...`
        apply(_target: unknown, _thisArg: unknown, args: unknown[]) {
          const strings = args[0] as string[];
          const values = args.slice(1);
          return {
            execute: async (db: { _rows: Record<string, unknown>[] }) => ({
              rows: db._rows,
            }),
            _strings: strings,
            _values: values,
          };
        },
      },
    ),
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reverseSearchDishes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty results when no dishes match', async () => {
    const db = createMockDb([]);

    const result = await reverseSearchDishes(db, {
      chainSlug: 'burger-king',
      maxCalories: 600,
      limit: 5,
    });

    expect(result).toEqual({
      chainSlug: 'burger-king',
      chainName: 'burger-king',
      maxCalories: 600,
      minProtein: null,
      results: [],
      totalMatches: 0,
    });
  });

  it('maps row data correctly with Number() conversion', async () => {
    const db = createMockDb([
      {
        dish_name: 'Whopper',
        dish_name_es: 'Whopper',
        calories: '657',
        proteins: '28',
        fats: '40',
        carbohydrates: '49',
        portion_grams: '290',
        chain_name: 'Burger King',
        total_matches: '3',
      },
    ]);

    const result = await reverseSearchDishes(db, {
      chainSlug: 'burger-king',
      maxCalories: 700,
      limit: 5,
    });

    expect(result.chainName).toBe('Burger King');
    expect(result.totalMatches).toBe(3);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toEqual({
      name: 'Whopper',
      nameEs: 'Whopper',
      calories: 657,
      proteins: 28,
      fats: 40,
      carbohydrates: 49,
      portionGrams: 290,
      proteinDensity: expect.closeTo(4.26, 1),
    });
  });

  it('handles null nutrient values as 0', async () => {
    const db = createMockDb([
      {
        dish_name: 'Mystery Dish',
        dish_name_es: null,
        calories: null,
        proteins: null,
        fats: null,
        carbohydrates: null,
        portion_grams: null,
        chain_name: 'Test Chain',
        total_matches: '1',
      },
    ]);

    const result = await reverseSearchDishes(db, {
      chainSlug: 'test-chain',
      maxCalories: 600,
      limit: 5,
    });

    expect(result.results[0]!.calories).toBe(0);
    expect(result.results[0]!.proteins).toBe(0);
    expect(result.results[0]!.portionGrams).toBeNull();
    expect(result.results[0]!.proteinDensity).toBe(0);
  });

  it('calculates proteinDensity as proteins/calories*100', async () => {
    const db = createMockDb([
      {
        dish_name: 'High Protein',
        dish_name_es: null,
        calories: '400',
        proteins: '50',
        fats: '10',
        carbohydrates: '30',
        portion_grams: '200',
        chain_name: 'Test',
        total_matches: '1',
      },
    ]);

    const result = await reverseSearchDishes(db, {
      chainSlug: 'test',
      maxCalories: 500,
      limit: 5,
    });

    expect(result.results[0]!.proteinDensity).toBe(12.5);
  });

  it('handles zero calories (proteinDensity = 0)', async () => {
    const db = createMockDb([
      {
        dish_name: 'Zero Cal',
        dish_name_es: null,
        calories: '0',
        proteins: '0',
        fats: '0',
        carbohydrates: '0',
        portion_grams: null,
        chain_name: 'Test',
        total_matches: '1',
      },
    ]);

    const result = await reverseSearchDishes(db, {
      chainSlug: 'test',
      maxCalories: 600,
      limit: 5,
    });

    expect(result.results[0]!.proteinDensity).toBe(0);
  });

  it('passes minProtein when provided', async () => {
    const db = createMockDb([]);

    const result = await reverseSearchDishes(db, {
      chainSlug: 'burger-king',
      maxCalories: 600,
      minProtein: 30,
      limit: 5,
    });

    expect(result.minProtein).toBe(30);
  });
});
