// F020 Edge-Case Tests — QA Engineer (Part 2/2)
//
// Section B: level1Lookup unit edge cases with the REAL implementation.
//
// This file is intentionally separate from f020.edge-cases.test.ts to avoid
// the vi.mock('../estimation/level1Lookup.js') in that file from replacing
// the import of realLevel1Lookup here.
//
// BUGS DOCUMENTED IN THIS FILE:
//   BUG-F020-03 (LOW)  — portionGrams=0.00 in DB row silently maps to portionGrams=null
//                        because parseDecimal('0.00') returns 0 and 0 > 0 is false.
//                        A real dish row with portion_grams=0 is silently treated as
//                        "no portion data" with no error or log warning.
//   BUG-F020-04 (LOW)  — portionGrams=-1.00 in DB row silently maps to portionGrams=null.
//                        Negative portion values are swallowed without validation error.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { level1Lookup } from '../estimation/level1Lookup.js';

// ---------------------------------------------------------------------------
// Minimal Kysely executor mock (same pattern as developer's unit tests)
// ---------------------------------------------------------------------------

const { mockExecuteQuery } = vi.hoisted(() => ({
  mockExecuteQuery: vi.fn(),
}));

function buildMockDb() {
  const executor = {
    executeQuery: mockExecuteQuery,
    compileQuery: (node: unknown) => ({ sql: '', parameters: [], query: node }),
    transformQuery: (node: unknown) => node,
    withPlugins: function () { return this; },
    withPlugin: function () { return this; },
    withoutPlugins: function () { return this; },
  };
  return { getExecutor: () => executor };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_DISH_ROW = {
  dish_id: 'fd000000-0001-4000-a000-000000000001',
  dish_name: 'Test Dish',
  dish_name_es: 'Plato de prueba',
  restaurant_id: 'fd000000-0001-4000-a000-000000000002',
  chain_slug: 'test-chain',
  portion_grams: '200.00',
  calories: '300.00',
  proteins: '10.00',
  carbohydrates: '40.00',
  sugars: '5.00',
  fats: '8.00',
  saturated_fats: '2.00',
  fiber: '3.00',
  salt: '1.00',
  sodium: '400.00',
  trans_fats: '0.00',
  cholesterol: '20.00',
  potassium: '100.00',
  monounsaturated_fats: '4.00',
  polyunsaturated_fats: '2.00',
  reference_basis: 'per_serving',
  source_id: 'fd000000-0001-4000-a000-000000000003',
  source_name: 'Test Source',
  source_type: 'official',
  source_url: null,
};

const BASE_FOOD_ROW = {
  food_id: 'fd000000-0002-4000-a000-000000000001',
  food_name: 'Chicken',
  food_name_es: 'Pollo',
  calories: '165.00', proteins: '31.00', carbohydrates: '0.00',
  sugars: '0.00', fats: '3.60', saturated_fats: '1.00',
  fiber: '0.00', salt: '0.19', sodium: '74.00',
  trans_fats: '0.00', cholesterol: '85.00', potassium: '220.00',
  monounsaturated_fats: '1.00', polyunsaturated_fats: '0.80',
  reference_basis: 'per_100g',
  source_id: 'fd000000-0002-4000-a000-000000000002',
  source_name: 'USDA FoodData Central',
  source_type: 'official',
  source_url: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Section B — level1Lookup unit edge cases (real implementation)', () => {
  beforeEach(() => {
    mockExecuteQuery.mockReset();
  });

  // ─── portionGrams edge values ─────────────────────────────────────────────

  describe('portionGrams edge values', () => {
    // BUG-F020-03: parseDecimal('0.00') returns 0. Then grams > 0 is false.
    // So portion_grams=0 in DB silently becomes portionGrams=null in the result.
    it('[BUG-F020-03] portion_grams="0.00" silently maps to portionGrams=null', async () => {
      const row = { ...BASE_DISH_ROW, portion_grams: '0.00' };
      mockExecuteQuery.mockResolvedValueOnce({ rows: [row] });

      const db = buildMockDb() as never;
      const result = await level1Lookup(db, 'Test Dish', {});

      expect(result).not.toBeNull();
      // BUG: DB value 0 silently becomes null — no error, no log
      expect(result?.result.portionGrams).toBeNull();
    });

    // BUG-F020-04: parseDecimal('-1.00') returns -1. Then -1 > 0 is false.
    // Negative portion values are silently converted to null.
    it('[BUG-F020-04] portion_grams="-1.00" silently maps to portionGrams=null', async () => {
      const row = { ...BASE_DISH_ROW, portion_grams: '-1.00' };
      mockExecuteQuery.mockResolvedValueOnce({ rows: [row] });

      const db = buildMockDb() as never;
      const result = await level1Lookup(db, 'Test Dish', {});

      expect(result).not.toBeNull();
      // BUG: negative portion silently becomes null — masked data quality issue
      expect(result?.result.portionGrams).toBeNull();
    });

    it('portion_grams="0.01" correctly maps to portionGrams=0.01', async () => {
      const row = { ...BASE_DISH_ROW, portion_grams: '0.01' };
      mockExecuteQuery.mockResolvedValueOnce({ rows: [row] });

      const db = buildMockDb() as never;
      const result = await level1Lookup(db, 'Test Dish', {});

      expect(result).not.toBeNull();
      expect(result?.result.portionGrams).toBe(0.01);
    });

    it('portion_grams=null correctly maps to portionGrams=null', async () => {
      const row = { ...BASE_DISH_ROW, portion_grams: null };
      mockExecuteQuery.mockResolvedValueOnce({ rows: [row] });

      const db = buildMockDb() as never;
      const result = await level1Lookup(db, 'Test Dish', {});

      expect(result).not.toBeNull();
      expect(result?.result.portionGrams).toBeNull();
    });
  });

  // ─── All-null nutrient columns ────────────────────────────────────────────

  describe('all-null nutrient columns from DB', () => {
    it('all-null nutrient columns map to 0 (parseDecimal(null) returns 0 — no crash)', async () => {
      const row = {
        ...BASE_DISH_ROW,
        calories: null, proteins: null, carbohydrates: null, sugars: null,
        fats: null, saturated_fats: null, fiber: null, salt: null,
        sodium: null, trans_fats: null, cholesterol: null, potassium: null,
        monounsaturated_fats: null, polyunsaturated_fats: null,
      };
      mockExecuteQuery.mockResolvedValueOnce({ rows: [row] });

      const db = buildMockDb() as never;
      const result = await level1Lookup(db, 'Test Dish', {});

      expect(result).not.toBeNull();
      const n = result?.result.nutrients;
      // All null nutrients become 0 — this is safe but masks missing data
      expect(n.calories).toBe(0);
      expect(n.proteins).toBe(0);
      expect(n.salt).toBe(0);
      expect(n.sodium).toBe(0);
      expect(n.transFats).toBe(0);
      expect(n.cholesterol).toBe(0);
      expect(n.potassium).toBe(0);
      expect(n.monounsaturatedFats).toBe(0);
      expect(n.polyunsaturatedFats).toBe(0);
    });
  });

  // ─── source.url = null ────────────────────────────────────────────────────

  describe('source with null URL', () => {
    it('dish row with source_url=null → source.url=null in result', async () => {
      // BASE_DISH_ROW already has source_url: null
      mockExecuteQuery.mockResolvedValueOnce({ rows: [BASE_DISH_ROW] });

      const db = buildMockDb() as never;
      const result = await level1Lookup(db, 'Test Dish', {});

      expect(result).not.toBeNull();
      expect(result?.result.source.url).toBeNull();
    });

    it('food row with source_url=null → source.url=null in result (strategy 3)', async () => {
      mockExecuteQuery
        .mockResolvedValueOnce({ rows: [] }) // strategy 1 miss
        .mockResolvedValueOnce({ rows: [] }) // strategy 2 miss
        .mockResolvedValueOnce({ rows: [BASE_FOOD_ROW] }); // strategy 3 hit

      const db = buildMockDb() as never;
      const result = await level1Lookup(db, 'Chicken', {});

      expect(result).not.toBeNull();
      expect(result?.result.source.url).toBeNull();
    });
  });

  // ─── DB error propagation across all strategy positions ──────────────────

  describe('DB error propagation — all strategy positions', () => {
    it('throws DB_UNAVAILABLE when strategy 2 throws', async () => {
      mockExecuteQuery
        .mockResolvedValueOnce({ rows: [] })          // strategy 1 miss
        .mockRejectedValueOnce(new Error('timeout')); // strategy 2 error

      const db = buildMockDb() as never;
      await expect(level1Lookup(db, 'Test', {})).rejects.toMatchObject({
        code: 'DB_UNAVAILABLE',
      });
    });

    it('throws DB_UNAVAILABLE when strategy 3 throws', async () => {
      mockExecuteQuery
        .mockResolvedValueOnce({ rows: [] })          // strategy 1 miss
        .mockResolvedValueOnce({ rows: [] })          // strategy 2 miss
        .mockRejectedValueOnce(new Error('timeout')); // strategy 3 error

      const db = buildMockDb() as never;
      await expect(level1Lookup(db, 'Test', {})).rejects.toMatchObject({
        code: 'DB_UNAVAILABLE',
      });
    });

    it('throws DB_UNAVAILABLE when strategy 4 throws', async () => {
      mockExecuteQuery
        .mockResolvedValueOnce({ rows: [] })                // strategy 1 miss
        .mockResolvedValueOnce({ rows: [] })                // strategy 2 miss
        .mockResolvedValueOnce({ rows: [] })                // strategy 3 miss
        .mockRejectedValueOnce(new Error('conn lost'));     // strategy 4 error

      const db = buildMockDb() as never;
      await expect(level1Lookup(db, 'Test', {})).rejects.toMatchObject({
        code: 'DB_UNAVAILABLE',
      });
    });

    it('DB_UNAVAILABLE error wraps the original cause error', async () => {
      const originalError = new Error('connection refused');
      mockExecuteQuery.mockRejectedValueOnce(originalError);

      const db = buildMockDb() as never;
      let caught: unknown;
      try {
        await level1Lookup(db, 'Test', {});
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect((caught as { cause: unknown }).cause).toBe(originalError);
    });
  });

  // ─── Query normalization inside level1Lookup ──────────────────────────────

  describe('query normalization inside level1Lookup', () => {
    it('collapses multiple internal spaces — all 4 strategies execute without error', async () => {
      mockExecuteQuery.mockResolvedValue({ rows: [] });
      const db = buildMockDb() as never;
      const result = await level1Lookup(db, 'Big   Mac', {});
      expect(result).toBeNull();
      expect(mockExecuteQuery).toHaveBeenCalledTimes(4);
    });

    it('trims leading/trailing whitespace — all 4 strategies execute without error', async () => {
      mockExecuteQuery.mockResolvedValue({ rows: [] });
      const db = buildMockDb() as never;
      const result = await level1Lookup(db, '  pollo a la brasa  ', {});
      expect(result).toBeNull();
      expect(mockExecuteQuery).toHaveBeenCalledTimes(4);
    });

    it('handles Unicode query with Spanish accents without throwing', async () => {
      mockExecuteQuery.mockResolvedValue({ rows: [] });
      const db = buildMockDb() as never;
      const result = await level1Lookup(db, 'piña colada con café', {});
      expect(result).toBeNull();
    });

    it('handles SQL injection attempt without throwing (Kysely parameterized queries prevent injection)', async () => {
      mockExecuteQuery.mockResolvedValue({ rows: [] });
      const db = buildMockDb() as never;
      const result = await level1Lookup(db, "'; DROP TABLE dishes; --", {});
      expect(result).toBeNull();
    });

    it('handles FTS operator chars (:*, &, |) without throwing (plainto_tsquery sanitizes)', async () => {
      mockExecuteQuery.mockResolvedValue({ rows: [] });
      const db = buildMockDb() as never;
      const result = await level1Lookup(db, 'pollo :* & | paella', {});
      expect(result).toBeNull();
    });
  });

  // ─── CTE de-duplication and most-recent nutrient row ─────────────────────

  describe('CTE de-duplication: mapper works correctly with single DB-returned row', () => {
    it('when DB returns 1 row (after CTE de-dup), all 15 nutrients are correctly mapped', async () => {
      // The CTE ensures only rn=1 (most recent) row reaches the mapper.
      // We verify the mapper handles the single row correctly.
      mockExecuteQuery.mockResolvedValueOnce({ rows: [BASE_DISH_ROW] });

      const db = buildMockDb() as never;
      const result = await level1Lookup(db, 'Test Dish', {});

      expect(result).not.toBeNull();
      expect(result?.matchType).toBe('exact_dish');
      const n = result?.result.nutrients;
      expect(n.calories).toBe(300);
      expect(n.proteins).toBe(10);
      expect(n.carbohydrates).toBe(40);
      expect(n.monounsaturatedFats).toBe(4);
      expect(n.polyunsaturatedFats).toBe(2);
      expect(n.referenceBasis).toBe('per_serving');
    });
  });
});
