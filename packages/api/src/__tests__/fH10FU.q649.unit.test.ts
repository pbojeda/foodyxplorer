// F-H10-FU: Q649 two-pass cascade integration test (BUG-PROD-012)
//
// Tests the unscoped path (no chainSlug, no restaurantId, no hasExplicitBrand)
// which triggers BUG-PROD-012's two-pass cascade in level1Lookup:
//   Pass 1 (minTier≥1): CROISSANT excluded (Tier 0), all strategies miss → null
//   Pass 2 (unfiltered): CROISSANT hit at S2 → guard rejects (Jaccard 0.20 < 0.25) → null
// Final result: null. mockExecuteQuery called 8 times total (4 per pass).
//
// Mocking approach mirrors f020.level1Lookup.unit.test.ts:80-100.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DishQueryRow } from '../estimation/types.js';

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
// Fixtures
// ---------------------------------------------------------------------------

const CROISSANT_DISH_ROW: DishQueryRow = {
  dish_id: 'fd000000-fu10-4000-a000-000000000050',
  dish_name: 'CROISSANT WITH FRESH CHEESE',
  dish_name_es: 'CROISSANT CON QUESO FRESC',
  restaurant_id: 'fd000000-fu10-4000-a000-000000000051',
  chain_slug: 'starbucks-es',
  portion_grams: '120.00',
  calories: '343.00',
  proteins: '8.00',
  carbohydrates: '40.00',
  sugars: '6.00',
  fats: '16.00',
  saturated_fats: '9.00',
  fiber: '1.00',
  salt: '0.60',
  sodium: '240.00',
  trans_fats: '0.00',
  cholesterol: '30.00',
  potassium: '100.00',
  monounsaturated_fats: '4.00',
  polyunsaturated_fats: '1.50',
  alcohol: '0.00',
  reference_basis: 'per_serving',
  source_id: 'fd000000-fu10-4000-a000-000000000052',
  source_name: 'Starbucks Spain Official PDF',
  source_type: 'official',
  source_url: 'https://www.starbucks.es/nutritional.pdf',
  source_priority_tier: '0',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Q649 two-pass cascade (BUG-PROD-012, unscoped)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('Q649: both passes return null — guard rejects CROISSANT in unfiltered pass; total 8 DB calls', async () => {
    // Pass 1 — minTier≥1 pre-cascade (CROISSANT is Tier 0, excluded from Tier≥1 filter)
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })               // S1 exact dish, Tier≥1 → miss
      .mockResolvedValueOnce({ rows: [] })               // S2 FTS dish, Tier≥1 → CROISSANT excluded
      .mockResolvedValueOnce({ rows: [] })               // S3 exact food, Tier≥1 → miss
      .mockResolvedValueOnce({ rows: [] })               // S4 FTS food, Tier≥1 → miss
    // Pass 2 — unfiltered fallthrough
      .mockResolvedValueOnce({ rows: [] })               // S1 exact dish, unfiltered → miss
      .mockResolvedValueOnce({ rows: [CROISSANT_DISH_ROW] }) // S2 FTS dish → CROISSANT hit; guard rejects
      .mockResolvedValueOnce({ rows: [] })               // S3 exact food, unfiltered → miss
      .mockResolvedValueOnce({ rows: [] });              // S4 FTS food, unfiltered → miss

    const db = buildMockDb() as never;
    // No chainSlug, no restaurantId, no hasExplicitBrand → two-pass BUG-PROD-012 path
    const result = await level1Lookup(db, 'queso fresco con membrillo', {});

    expect(result).toBeNull();
    // 8 total: 4 for Pass 1 (Tier≥1) + 4 for Pass 2 (unfiltered)
    expect(mockExecuteQuery).toHaveBeenCalledTimes(8);
  });

  it('Q649: guard correctly computes Jaccard < 0.25 for CROISSANT vs queso fresco membrillo', async () => {
    // Verify that the guard specifically is the reason for rejection in Pass 2.
    // We set up Pass 1 to miss, and Pass 2 S2 to return CROISSANT.
    // If guard did NOT reject, result would be non-null with matchType fts_dish.
    // The null result + 8 calls proves guard fired and rejected in Pass 2.
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })               // Pass 1 S1
      .mockResolvedValueOnce({ rows: [] })               // Pass 1 S2
      .mockResolvedValueOnce({ rows: [] })               // Pass 1 S3
      .mockResolvedValueOnce({ rows: [] })               // Pass 1 S4
      .mockResolvedValueOnce({ rows: [] })               // Pass 2 S1
      .mockResolvedValueOnce({ rows: [CROISSANT_DISH_ROW] }) // Pass 2 S2 → CROISSANT — guard rejects
      .mockResolvedValueOnce({ rows: [] })               // Pass 2 S3
      .mockResolvedValueOnce({ rows: [] });              // Pass 2 S4

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'queso fresco con membrillo', {});

    // Guard rejected CROISSANT: tokens 'queso fresco membrillo' ∩ 'croissant queso fresc' = {queso}
    // union = {queso, fresco, membrillo, croissant, fresc} → |union|=5, |intersect|=1 → jaccard=0.20 < 0.25
    expect(result).toBeNull();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(8);
  });

  it('Q649: a scoped query (chainSlug set) runs single-pass and guard rejects CROISSANT', async () => {
    // Confirm single-pass when chainSlug is set (BUG-PROD-012 guard: skip Tier≥1 pre-cascade)
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })               // S1 exact dish → miss
      .mockResolvedValueOnce({ rows: [CROISSANT_DISH_ROW] }) // S2 FTS dish → guard rejects
      .mockResolvedValueOnce({ rows: [] })               // S3 exact food → miss
      .mockResolvedValueOnce({ rows: [] });              // S4 FTS food → miss

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'queso fresco con membrillo', { chainSlug: 'starbucks-es' });

    expect(result).toBeNull();
    // 4 calls only (single-pass with chainSlug)
    expect(mockExecuteQuery).toHaveBeenCalledTimes(4);
  });
});
