// Unit tests for level2Lookup — Level 2 ingredient-based estimation
//
// Mocks the Kysely executor so no real DB is needed.
// Tests: exact dish strategy, FTS dish strategy, partial resolution, zero resolution,
//        nutrient mapping, source block, scoping, portionGrams, DB error handling.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DISH_SOURCE_ID = 'fd000000-0003-4000-a000-000000000001';

/** Fully-resolved row: all 2 ingredients resolved */
const MOCK_AGGREGATE_ROW = {
  dish_id: 'fd000000-0021-4000-a000-000000000001',
  dish_name: 'Big Mac',
  dish_name_es: 'Big Mac',
  restaurant_id: 'fd000000-0021-4000-a000-000000000002',
  chain_slug: 'mcdonalds-es',
  portion_grams: '215.00',
  dish_source_id: DISH_SOURCE_ID,
  resolved_count: '2',
  total_count: '2',
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
};

/** Partially-resolved row: 1 of 2 ingredients resolved */
const MOCK_AGGREGATE_ROW_PARTIAL = {
  ...MOCK_AGGREGATE_ROW,
  resolved_count: '1',
  total_count: '2',
  // Nutrients are partial sums (roughly half)
  calories: '275.00',
  proteins: '12.50',
};

// ---------------------------------------------------------------------------
// Mock kysely — provide a minimal executor that Kysely's sql.execute() accepts
// ---------------------------------------------------------------------------

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

import { level2Lookup } from '../estimation/level2Lookup.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('level2Lookup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // -------------------------------------------------------------------------
  // Strategy 1 — exact dish match
  // -------------------------------------------------------------------------

  it('strategy 1 (exact dish) returns matchType=ingredient_dish_exact and short-circuits', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [MOCK_AGGREGATE_ROW] });

    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', { chainSlug: 'mcdonalds-es' });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.matchType).toBe('ingredient_dish_exact');
    expect(result.result.entityType).toBe('dish');
    expect(result.result.name).toBe('Big Mac');
    // Short-circuit: only 1 DB call
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
  });

  it('strategy 1 maps all 15 aggregated nutrients via parseDecimal', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [MOCK_AGGREGATE_ROW] });

    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    const n = result.result.nutrients;
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
  });

  it('strategy 1 hardcodes referenceBasis=per_serving', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [MOCK_AGGREGATE_ROW] });

    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.result.nutrients.referenceBasis).toBe('per_serving');
  });

  it('strategy 1 sets confidenceLevel=medium when resolvedCount === totalCount', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [MOCK_AGGREGATE_ROW] });

    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.result.confidenceLevel).toBe('medium');
    expect(result.resolvedCount).toBe(2);
    expect(result.totalCount).toBe(2);
  });

  it('strategy 1 sets confidenceLevel=low when resolvedCount < totalCount', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [MOCK_AGGREGATE_ROW_PARTIAL] });

    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.result.confidenceLevel).toBe('low');
    expect(result.resolvedCount).toBe(1);
    expect(result.totalCount).toBe(2);
  });

  it('strategy 1 hardcodes estimationMethod=ingredients', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [MOCK_AGGREGATE_ROW] });

    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.result.estimationMethod).toBe('ingredients');
  });

  it('strategy 1 builds synthetic source block', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [MOCK_AGGREGATE_ROW] });

    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.result.source).toEqual({
      id: DISH_SOURCE_ID,
      name: 'Computed from ingredients',
      priorityTier: 3,
      type: 'estimated',
      url: null,
    });
  });

  // -------------------------------------------------------------------------
  // Strategy 2 — FTS dish match
  // -------------------------------------------------------------------------

  it('strategy 2 (FTS dish) runs when strategy 1 misses', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })              // strategy 1 miss
      .mockResolvedValueOnce({ rows: [MOCK_AGGREGATE_ROW] }); // strategy 2 hit

    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'hamburguesa grande', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.matchType).toBe('ingredient_dish_fts');
    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Zero resolution — return null
  // -------------------------------------------------------------------------

  it('returns null when resolved_count is "0" (no ingredients resolved)', async () => {
    const zeroResolvedRow = { ...MOCK_AGGREGATE_ROW, resolved_count: '0', total_count: '2' };
    mockExecuteQuery.mockResolvedValueOnce({ rows: [zeroResolvedRow] });

    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Both strategies miss
  // -------------------------------------------------------------------------

  it('returns null when both strategies return empty rows', async () => {
    mockExecuteQuery.mockResolvedValue({ rows: [] });

    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'something completely unknown', {});

    expect(result).toBeNull();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // per_serving food_nutrients filtered — verified via resolved_count: '0'
  // -------------------------------------------------------------------------

  it('per_serving food_nutrients are skipped — returns null when no ingredient resolves', async () => {
    // The SQL filters out per_serving rows in the CTE WHERE clause.
    // The HAVING clause prevents a row from being returned unless resolved_count > 0.
    // If all ingredients had per_serving food_nutrients, no row would be returned.
    // We simulate this: strategy 1 returns no rows (HAVING filters it out).
    mockExecuteQuery.mockResolvedValue({ rows: [] });

    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'some dish', {});

    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Scoping
  // -------------------------------------------------------------------------

  it('passes restaurantId to strategy 1 when provided', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [MOCK_AGGREGATE_ROW] });

    const db = buildMockDb() as never;
    await level2Lookup(db, 'Big Mac', {
      restaurantId: 'fd000000-0021-4000-a000-000000000002',
    });

    // Only 1 call means strategy 1 was used
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
  });

  it('passes chainSlug scope to strategy 1 when provided', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [MOCK_AGGREGATE_ROW] });

    const db = buildMockDb() as never;
    await level2Lookup(db, 'Big Mac', { chainSlug: 'mcdonalds-es' });

    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // portionGrams passthrough
  // -------------------------------------------------------------------------

  it('maps portion_grams to portionGrams (numeric)', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [MOCK_AGGREGATE_ROW] });

    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.result.portionGrams).toBe(215);
  });

  it('maps portion_grams=null to portionGrams=null', async () => {
    const rowNullPortion = { ...MOCK_AGGREGATE_ROW, portion_grams: null };
    mockExecuteQuery.mockResolvedValueOnce({ rows: [rowNullPortion] });

    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.result.portionGrams).toBeNull();
  });

  // -------------------------------------------------------------------------
  // ingredientSources — empty for F021
  // -------------------------------------------------------------------------

  it('returns ingredientSources as empty array', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [MOCK_AGGREGATE_ROW] });

    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.ingredientSources).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // DB error
  // -------------------------------------------------------------------------

  it('throws with code=DB_UNAVAILABLE when Kysely throws', async () => {
    mockExecuteQuery.mockRejectedValueOnce(new Error('connection refused'));

    const db = buildMockDb() as never;

    await expect(level2Lookup(db, 'Big Mac', {})).rejects.toMatchObject({
      code: 'DB_UNAVAILABLE',
    });
  });
});
