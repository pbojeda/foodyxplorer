// Unit tests for level1Lookup — 4-strategy cascade with Kysely
//
// Mocks the Kysely executor so no real DB is needed.
// Each strategy is tested independently with fixture rows.
//
// Mocking approach:
// - sql.execute(db) calls db.getExecutor() → executor.executeQuery(compiled)
// - We provide a mock db with getExecutor() returning a mock executor
// - mockExecuteQuery is the vi.fn() we control per test

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_DISH_ROW = {
  dish_id: 'fd000000-0001-4000-a000-000000000001',
  dish_name: 'Big Mac',
  dish_name_es: 'Big Mac',
  restaurant_id: 'fd000000-0001-4000-a000-000000000002',
  chain_slug: 'mcdonalds-es',
  portion_grams: '215.00',
  calories: '550.00',
  proteins: '25.00',
  carbohydrates: '46.00',
  sugars: '9.00',
  fats: '28.00',
  saturated_fats: '10.00',
  fiber: '3.00',
  salt: '2.20',
  sodium: '880.00',
  trans_fats: '0.50',
  cholesterol: '80.00',
  potassium: '0.00',
  monounsaturated_fats: '0.00',
  polyunsaturated_fats: '0.00',
  reference_basis: 'per_serving',
  source_id: 'fd000000-0001-4000-a000-000000000003',
  source_name: "McDonald's Spain Official PDF",
  source_type: 'official',
  source_url: 'https://www.mcdonalds.es/nutritional.pdf',
};

const MOCK_FOOD_ROW = {
  food_id: 'fd000000-0002-4000-a000-000000000001',
  food_name: 'Chicken Breast',
  food_name_es: 'Pechuga de pollo',
  calories: '165.00',
  proteins: '31.00',
  carbohydrates: '0.00',
  sugars: '0.00',
  fats: '3.60',
  saturated_fats: '1.00',
  fiber: '0.00',
  salt: '0.19',
  sodium: '74.00',
  trans_fats: '0.00',
  cholesterol: '85.00',
  potassium: '220.00',
  monounsaturated_fats: '1.00',
  polyunsaturated_fats: '0.80',
  reference_basis: 'per_100g',
  source_id: 'fd000000-0002-4000-a000-000000000002',
  source_name: 'USDA FoodData Central',
  source_type: 'official',
  source_url: null,
};

// ---------------------------------------------------------------------------
// Mock kysely — provide a minimal executor that Kysely's sql.execute() accepts
// ---------------------------------------------------------------------------

// sql.execute(db) calls:
//   1. db.getExecutor()  →  returns executor
//   2. executor.executeQuery(compiled, queryId)  →  returns { rows: [...] }
//   3. executor.compileQuery(node, queryId) for compilation step
//   4. executor.transformQuery(node, queryId) for plugin transformation

const { mockExecuteQuery } = vi.hoisted(() => ({
  mockExecuteQuery: vi.fn(),
}));

/**
 * Build a minimal Kysely-compatible mock db.
 * The executor's executeQuery is the mockExecuteQuery fn we control per test.
 */
function buildMockDb() {
  const executor = {
    executeQuery: mockExecuteQuery,
    compileQuery: (node: unknown) => ({ sql: '', parameters: [], query: node }),
    transformQuery: (node: unknown) => node,
    withPlugins: function() { return this; },
    withPlugin: function() { return this; },
    withoutPlugins: function() { return this; },
  };
  return {
    getExecutor: () => executor,
  };
}

import { level1Lookup } from '../estimation/level1Lookup.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('level1Lookup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // -------------------------------------------------------------------------
  // Strategy 1 — exact dish
  // -------------------------------------------------------------------------

  it('strategy 1 (exact dish) returns matchType=exact_dish and short-circuits', async () => {
    // Strategy 1 returns a row; strategies 2-4 should not be called
    mockExecuteQuery.mockResolvedValueOnce({ rows: [MOCK_DISH_ROW] });

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'Big Mac', { chainSlug: 'mcdonalds-es' });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('exact_dish');
    expect(result?.result.entityType).toBe('dish');
    expect(result?.result.name).toBe('Big Mac');
    expect(result?.result.chainSlug).toBe('mcdonalds-es');
    // Only 1 DB call (strategy 1 hit)
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
  });

  it('strategy 1 maps all 15 nutrients and converts Decimal strings to numbers', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [MOCK_DISH_ROW] });

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'Big Mac', {});

    expect(result).not.toBeNull();
    const n = result?.result.nutrients;
    expect(n.calories).toBe(550);
    expect(n.proteins).toBe(25);
    expect(n.carbohydrates).toBe(46);
    expect(n.sugars).toBe(9);
    expect(n.fats).toBe(28);
    expect(n.saturatedFats).toBe(10);
    expect(n.fiber).toBe(3);
    expect(n.salt).toBe(2.2);
    expect(n.sodium).toBe(880);
    expect(n.transFats).toBe(0.5);
    expect(n.cholesterol).toBe(80);
    expect(n.potassium).toBe(0);
    expect(n.monounsaturatedFats).toBe(0);
    expect(n.polyunsaturatedFats).toBe(0);
    expect(n.referenceBasis).toBe('per_serving');
  });

  it('strategy 1 populates source block from data_sources', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [MOCK_DISH_ROW] });

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'Big Mac', {});

    expect(result?.result.source).toEqual({
      id: 'fd000000-0001-4000-a000-000000000003',
      name: "McDonald's Spain Official PDF",
      priorityTier: null,
      type: 'official',
      url: 'https://www.mcdonalds.es/nutritional.pdf',
      attributionNote: null,
      license: null,
      sourceUrl: null,
    });
  });

  it('strategy 1 hardcodes confidenceLevel=high and estimationMethod=official', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [MOCK_DISH_ROW] });

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'Big Mac', {});

    expect(result?.result.confidenceLevel).toBe('high');
    expect(result?.result.estimationMethod).toBe('official');
  });

  // -------------------------------------------------------------------------
  // Strategy 2 — FTS dish
  // -------------------------------------------------------------------------

  it('strategy 2 (FTS dish) runs when strategy 1 misses', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })    // strategy 1 miss
      .mockResolvedValueOnce({ rows: [MOCK_DISH_ROW] }); // strategy 2 hit

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'hamburguesa grande', {});

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('fts_dish');
    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Strategy 3 — exact food
  // -------------------------------------------------------------------------

  it('strategy 3 (exact food) runs when strategies 1+2 miss', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })    // strategy 1 miss
      .mockResolvedValueOnce({ rows: [] })    // strategy 2 miss
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW] }); // strategy 3 hit

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'Chicken Breast', {});

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('exact_food');
    expect(result?.result.entityType).toBe('food');
    expect(result?.result.restaurantId).toBeNull();
    expect(result?.result.chainSlug).toBeNull();
    expect(result?.result.portionGrams).toBeNull();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(3);
  });

  it('strategy 3 maps all 15 nutrients for food rows', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW] });

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'Chicken Breast', {});

    expect(result).not.toBeNull();
    const n = result?.result.nutrients;
    expect(n.calories).toBe(165);
    expect(n.proteins).toBe(31);
    expect(n.cholesterol).toBe(85);
    expect(n.potassium).toBe(220);
    expect(n.monounsaturatedFats).toBe(1);
    expect(n.polyunsaturatedFats).toBe(0.8);
    expect(n.referenceBasis).toBe('per_100g');
  });

  // -------------------------------------------------------------------------
  // Strategy 4 — FTS food
  // -------------------------------------------------------------------------

  it('strategy 4 (FTS food) runs when strategies 1-3 miss', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })    // strategy 1 miss
      .mockResolvedValueOnce({ rows: [] })    // strategy 2 miss
      .mockResolvedValueOnce({ rows: [] })    // strategy 3 miss
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW] }); // strategy 4 hit

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'pollo', {});

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('fts_food');
    expect(result?.result.entityType).toBe('food');
    expect(mockExecuteQuery).toHaveBeenCalledTimes(4);
  });

  // -------------------------------------------------------------------------
  // All miss
  // -------------------------------------------------------------------------

  it('returns null when all 4 strategies miss', async () => {
    mockExecuteQuery.mockResolvedValue({ rows: [] });

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'something completely unknown', {});

    expect(result).toBeNull();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(4);
  });

  // -------------------------------------------------------------------------
  // Scoping: restaurantId takes precedence over chainSlug
  // -------------------------------------------------------------------------

  it('uses restaurantId scope when both restaurantId and chainSlug are provided', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [MOCK_DISH_ROW] });

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'Big Mac', {
      restaurantId: 'fd000000-0001-4000-a000-000000000002',
      chainSlug: 'mcdonalds-es',
    });

    expect(result).not.toBeNull();
    // Strategy 1 hit — only 1 call
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Food strategies: no chain scope
  // -------------------------------------------------------------------------

  it('food strategy 3 is called even when chainSlug is provided (food is chain-agnostic)', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })    // strategy 1 miss (scoped to chain)
      .mockResolvedValueOnce({ rows: [] })    // strategy 2 miss (scoped to chain)
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW] }); // strategy 3 hit (no chain scope)

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'pollo', { chainSlug: 'mcdonalds-es' });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('exact_food');
    expect(mockExecuteQuery).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // portionGrams
  // -------------------------------------------------------------------------

  it('maps portion_grams=null to portionGrams=null', async () => {
    const rowWithNullPortion = { ...MOCK_DISH_ROW, portion_grams: null };
    mockExecuteQuery.mockResolvedValueOnce({ rows: [rowWithNullPortion] });

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'Big Mac', {});

    expect(result?.result.portionGrams).toBeNull();
  });

  it('maps portion_grams=215.00 to portionGrams=215', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [MOCK_DISH_ROW] });

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'Big Mac', {});

    expect(result?.result.portionGrams).toBe(215);
  });

  // -------------------------------------------------------------------------
  // DB error
  // -------------------------------------------------------------------------

  it('throws with code=DB_UNAVAILABLE when Kysely throws', async () => {
    mockExecuteQuery.mockRejectedValueOnce(new Error('connection refused'));

    const db = buildMockDb() as never;

    await expect(level1Lookup(db, 'Big Mac', {})).rejects.toMatchObject({
      code: 'DB_UNAVAILABLE',
    });
  });
});
