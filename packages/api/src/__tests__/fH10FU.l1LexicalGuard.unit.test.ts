// F-H10-FU: L1 lexical guard — cascade unit tests (single-pass, mocked DB)
//
// Tests the passesGuardEither helper semantics (AC8) and guard wiring in
// runCascade (AC7, AC10) via the real level1Lookup with a mocked Kysely DB.
//
// All invocations set chainSlug to force single-pass behaviour (bypassing
// BUG-PROD-012 two-pass path). For two-pass coverage see fH10FU.q649.integration.test.ts.
//
// Mocking approach mirrors f020.level1Lookup.unit.test.ts:80-100.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DishQueryRow, FoodQueryRow } from '../estimation/types.js';

// ---------------------------------------------------------------------------
// Mock Kysely executor
// ---------------------------------------------------------------------------

const { mockExecuteQuery } = vi.hoisted(() => ({
  mockExecuteQuery: vi.fn(),
}));

function buildMockDb() {
  const executor = {
    executeQuery: mockExecuteQuery,
    compileQuery: (node: unknown) => ({ sql: '', parameters: [], query: node }),
    transformQuery: (node: unknown) => node,
    withPlugins: function() { return this; },
    withPlugin: function() { return this; },
    withoutPlugins: function() { return this; },
  };
  return { getExecutor: () => executor };
}

import { level1Lookup } from '../estimation/level1Lookup.js';

// ---------------------------------------------------------------------------
// Base nutrient fields shared by all fixtures
// ---------------------------------------------------------------------------

const BASE_NUTRIENTS = {
  calories: '300.00',
  proteins: '10.00',
  carbohydrates: '30.00',
  sugars: '5.00',
  fats: '12.00',
  saturated_fats: '3.00',
  fiber: '2.00',
  salt: '0.50',
  sodium: '200.00',
  trans_fats: '0.00',
  cholesterol: '20.00',
  potassium: '150.00',
  monounsaturated_fats: '5.00',
  polyunsaturated_fats: '2.00',
  alcohol: '0.00',
  reference_basis: 'per_serving',
};

const BASE_SOURCE = {
  source_id: 'fd000000-fu10-4000-a000-000000000010',
  source_name: 'Test Source',
  source_type: 'official',
  source_url: null,
  source_priority_tier: '1',
};

// ---------------------------------------------------------------------------
// Dish fixture rows (DishQueryRow shape)
// ---------------------------------------------------------------------------

const CROISSANT_DISH_ROW: DishQueryRow = {
  dish_id: 'fd000000-fu10-4000-a000-000000000001',
  dish_name: 'CROISSANT WITH FRESH CHEESE',
  dish_name_es: 'CROISSANT CON QUESO FRESC',
  restaurant_id: 'fd000000-fu10-4000-a000-000000000002',
  chain_slug: 'starbucks-es',
  portion_grams: '120.00',
  ...BASE_NUTRIENTS,
  ...BASE_SOURCE,
  source_priority_tier: '0',
};

const TORTILLA_DISH_ROW: DishQueryRow = {
  dish_id: 'fd000000-fu10-4000-a000-000000000003',
  dish_name: 'Spanish Omelette',
  dish_name_es: 'tortilla española',
  restaurant_id: 'fd000000-fu10-4000-a000-000000000004',
  chain_slug: 'generic-es',
  portion_grams: '150.00',
  ...BASE_NUTRIENTS,
  ...BASE_SOURCE,
};

const BILINGUAL_DISH_ROW: DishQueryRow = {
  dish_id: 'fd000000-fu10-4000-a000-000000000005',
  dish_name: 'Bacon and Eggs',
  dish_name_es: 'Beicon con huevos',
  restaurant_id: 'fd000000-fu10-4000-a000-000000000006',
  chain_slug: 'some-chain',
  portion_grams: '200.00',
  ...BASE_NUTRIENTS,
  ...BASE_SOURCE,
};

const NULL_NAME_ES_DISH_ROW: DishQueryRow = {
  dish_id: 'fd000000-fu10-4000-a000-000000000007',
  dish_name: 'Paella valenciana',
  dish_name_es: null,
  restaurant_id: 'fd000000-fu10-4000-a000-000000000008',
  chain_slug: 'generic-es',
  portion_grams: '300.00',
  ...BASE_NUTRIENTS,
  ...BASE_SOURCE,
};

const PAELLA_DISH_ROW: DishQueryRow = {
  dish_id: 'fd000000-fu10-4000-a000-000000000009',
  dish_name: 'Paella',
  dish_name_es: 'Paella valenciana',
  restaurant_id: 'fd000000-fu10-4000-a000-000000000008',
  chain_slug: 'generic-es',
  portion_grams: '300.00',
  ...BASE_NUTRIENTS,
  ...BASE_SOURCE,
};

const TORTILLA_PATATAS_DISH_ROW: DishQueryRow = {
  dish_id: 'fd000000-fu10-4000-a000-000000000011',
  dish_name: 'Potato omelette',
  dish_name_es: 'Tortilla de patatas',
  restaurant_id: 'fd000000-fu10-4000-a000-000000000008',
  chain_slug: 'generic-es',
  portion_grams: '150.00',
  ...BASE_NUTRIENTS,
  ...BASE_SOURCE,
};

const GAZPACHO_DISH_ROW: DishQueryRow = {
  dish_id: 'fd000000-fu10-4000-a000-000000000012',
  dish_name: 'Gazpacho',
  dish_name_es: 'Gazpacho andaluz',
  restaurant_id: 'fd000000-fu10-4000-a000-000000000008',
  chain_slug: 'generic-es',
  portion_grams: '200.00',
  ...BASE_NUTRIENTS,
  ...BASE_SOURCE,
};

const BIG_MAC_DISH_ROW: DishQueryRow = {
  dish_id: 'fd000000-fu10-4000-a000-000000000013',
  dish_name: 'Big Mac',
  dish_name_es: 'Big Mac',
  restaurant_id: 'fd000000-fu10-4000-a000-000000000014',
  chain_slug: 'mcdonalds-es',
  portion_grams: '215.00',
  ...BASE_NUTRIENTS,
  ...BASE_SOURCE,
};

const PAN_FOOD_ROW: FoodQueryRow = {
  food_id: 'fd000000-fu10-4000-a000-000000000020',
  food_name: 'Bread',
  food_name_es: 'Pan',
  food_group: 'Bakery Products',
  barcode: null,
  brand_name: null,
  ...BASE_NUTRIENTS,
  reference_basis: 'per_100g',
  ...BASE_SOURCE,
};

// ---------------------------------------------------------------------------
// Food fixture rows (FoodQueryRow shape)
// ---------------------------------------------------------------------------

const CROISSANT_FOOD_ROW: FoodQueryRow = {
  food_id: 'fd000000-fu10-4000-a000-000000000021',
  food_name: 'Croissant with fresh cheese',
  food_name_es: null,
  food_group: 'Bakery Products',
  barcode: null,
  brand_name: null,
  ...BASE_NUTRIENTS,
  reference_basis: 'per_100g',
  ...BASE_SOURCE,
};

const GAZPACHO_FOOD_ROW: FoodQueryRow = {
  food_id: 'fd000000-fu10-4000-a000-000000000022',
  food_name: 'Gazpacho',
  food_name_es: 'gazpacho',
  food_group: 'Soups',
  barcode: null,
  brand_name: null,
  ...BASE_NUTRIENTS,
  reference_basis: 'per_100g',
  ...BASE_SOURCE,
};

const NULL_NAME_ES_FOOD_ROW: FoodQueryRow = {
  food_id: 'fd000000-fu10-4000-a000-000000000023',
  food_name: 'Croissant with fresh cheese',
  food_name_es: null,
  food_group: 'Bakery Products',
  barcode: null,
  brand_name: null,
  ...BASE_NUTRIENTS,
  reference_basis: 'per_100g',
  ...BASE_SOURCE,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function misses(count: number) {
  return Array.from({ length: count }, () =>
    mockExecuteQuery.mockResolvedValueOnce({ rows: [] }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('passesGuardEither — cascade semantics (single-pass, chainSlug set)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // AC7 — guard rejects FTS dish hit (S2), falls through to S3 + S4, result null
  it('guard rejects FTS dish hit (both sides fail) — falls through to exact food, result null', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })             // S1 exact dish miss
      .mockResolvedValueOnce({ rows: [CROISSANT_DISH_ROW] }) // S2 FTS dish — guard rejects
      .mockResolvedValueOnce({ rows: [] })             // S3 exact food miss
      .mockResolvedValueOnce({ rows: [] });            // S4 FTS food miss

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'queso fresco con membrillo', { chainSlug: 'starbucks-es' });

    expect(result).toBeNull();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(4);
  });

  // AC7 — guard rejects FTS food hit (S4), runCascade returns null
  it('guard rejects FTS food hit (both sides fail) — runCascade returns null', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })             // S1 miss
      .mockResolvedValueOnce({ rows: [] })             // S2 FTS dish miss
      .mockResolvedValueOnce({ rows: [] })             // S3 exact food miss
      .mockResolvedValueOnce({ rows: [CROISSANT_FOOD_ROW] }); // S4 FTS food — guard rejects

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'queso fresco con membrillo', { chainSlug: 'starbucks-es' });

    expect(result).toBeNull();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(4);
  });

  // AC7 — guard accepts FTS dish hit when name_es passes threshold (Spanish side)
  it('guard accepts FTS dish hit when name_es passes threshold', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })             // S1 miss
      .mockResolvedValueOnce({ rows: [TORTILLA_DISH_ROW] }); // S2 FTS dish — guard accepts (jaccard_es ≈ 0.33)

    const db = buildMockDb() as never;
    // query 'tortilla de patatas': jaccard('tortilla de patatas', 'tortilla española') = 1/2 = 0.50 ≥ 0.25
    const result = await level1Lookup(db, 'tortilla de patatas', { chainSlug: 'generic-es' });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('fts_dish');
    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
  });

  // AC7 — guard accepts FTS food hit when food_name_es passes threshold
  it('guard accepts FTS food hit when food_name_es passes threshold', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })             // S1 miss
      .mockResolvedValueOnce({ rows: [] })             // S2 FTS dish miss
      .mockResolvedValueOnce({ rows: [] })             // S3 exact food miss
      .mockResolvedValueOnce({ rows: [GAZPACHO_FOOD_ROW] }); // S4 FTS food — guard accepts

    const db = buildMockDb() as never;
    // jaccard('gazpacho andaluz', 'gazpacho') = 1/2 = 0.50 ≥ 0.25
    const result = await level1Lookup(db, 'gazpacho andaluz', { chainSlug: 'generic-es' });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('fts_food');
    expect(mockExecuteQuery).toHaveBeenCalledTimes(4);
  });

  // AC8(e) — English-branch acceptance: name_es fails, name (English) passes
  it('guard accepts when name_es fails but name (English) passes — bilingual hit', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })             // S1 miss
      .mockResolvedValueOnce({ rows: [BILINGUAL_DISH_ROW] }); // S2 FTS dish — English side passes

    const db = buildMockDb() as never;
    // jaccard('bacon eggs', 'beicon huevos') ≈ 0 → REJECT
    // jaccard('bacon eggs', 'bacon eggs') = 1.0 → ACCEPT
    const result = await level1Lookup(db, 'bacon eggs', { chainSlug: 'some-chain' });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('fts_dish');
    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
  });

  // AC8(a) — dish_name_es is null, name (English) passes threshold
  it('guard accepts when dish_name_es is null and dish_name passes threshold', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })             // S1 miss
      .mockResolvedValueOnce({ rows: [NULL_NAME_ES_DISH_ROW] }); // S2 FTS dish — null nameEs, English passes

    const db = buildMockDb() as never;
    // Spanish side skipped (nameEs null); jaccard('paella', 'paella valenciana') = 0.50 ≥ 0.25
    const result = await level1Lookup(db, 'paella', { chainSlug: 'generic-es' });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('fts_dish');
    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
  });

  // AC8(b) — food_name_es null and food_name also fails → null
  it('guard rejects when food_name_es null and food_name also fails threshold', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })             // S1 miss
      .mockResolvedValueOnce({ rows: [] })             // S2 FTS dish miss
      .mockResolvedValueOnce({ rows: [] })             // S3 exact food miss
      .mockResolvedValueOnce({ rows: [NULL_NAME_ES_FOOD_ROW] }); // S4 FTS food — both sides fail

    const db = buildMockDb() as never;
    // Spanish side skipped; jaccard('queso fresco membrillo', 'croissant fresh cheese') ≈ 0 → REJECT
    const result = await level1Lookup(db, 'queso fresco con membrillo', { chainSlug: 'some-chain' });

    expect(result).toBeNull();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(4);
  });

  // AC7 boundary — exact Strategy 1 bypasses guard unconditionally
  it('exact dish match (Strategy 1) returns result without invoking guard', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [BIG_MAC_DISH_ROW] }); // S1 exact dish hit — short-circuits

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'big mac', { chainSlug: 'mcdonalds-es' });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('exact_dish');
    // Only 1 DB call — S1 short-circuits, guard never runs
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
  });

  // AC7 boundary — exact Strategy 3 bypasses guard unconditionally
  it('exact food match (Strategy 3) returns result without invoking guard', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })             // S1 miss
      .mockResolvedValueOnce({ rows: [] })             // S2 FTS dish miss (guard never runs on miss)
      .mockResolvedValueOnce({ rows: [PAN_FOOD_ROW] }); // S3 exact food hit — short-circuits

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'pan', { chainSlug: 'generic-es' });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('exact_food');
    // 3 DB calls: S1 + S2 + S3; S4 not called
    expect(mockExecuteQuery).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// AC10 — Single-token boundary tests: Jaccard ≥ 0.50 for 2-content-token candidates
// ---------------------------------------------------------------------------

describe('single-token boundary: Jaccard ≥ 0.50 for 2-content-token candidates', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('paella / Paella valenciana: jaccard = 0.50 ≥ 0.25 → guard accepts', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })             // S1 miss
      .mockResolvedValueOnce({ rows: [PAELLA_DISH_ROW] }); // S2 FTS dish — guard accepts

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'paella', { chainSlug: 'generic-es' });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('fts_dish');
  });

  it('tortilla / Tortilla de patatas: jaccard = 0.50 ≥ 0.25 → guard accepts', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })             // S1 miss
      .mockResolvedValueOnce({ rows: [TORTILLA_PATATAS_DISH_ROW] }); // S2 FTS dish — guard accepts

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'tortilla', { chainSlug: 'generic-es' });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('fts_dish');
  });

  it('gazpacho / Gazpacho andaluz: jaccard = 0.50 ≥ 0.25 → guard accepts', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })             // S1 miss
      .mockResolvedValueOnce({ rows: [GAZPACHO_DISH_ROW] }); // S2 FTS dish — guard accepts

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'gazpacho', { chainSlug: 'generic-es' });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('fts_dish');
  });
});
