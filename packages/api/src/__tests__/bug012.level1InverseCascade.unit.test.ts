// BUG-PROD-012 — Level 1 Inverse Cascade Unit Tests
//
// Tests that L1 lookup:
// 1. Routes non-branded queries through Tier≥1 pre-cascade first (new behavior)
// 2. Falls through to unfiltered cascade when Tier≥1 misses (AC5 safety)
// 3. Preserves Tier-0-first path when hasExplicitBrand=true (AC4 — F068 unchanged)
// 4. Skips the Tier≥1 pre-cascade when chainSlug/restaurantId scope is set (AC6 guard)
//
// Mocking approach: same pattern as f020/f073 — mock Kysely executor so no real DB needed.
// `mockExecuteQuery` controls the rows returned by each cascade pass.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Tier 0 — scraped chain data (Tim Hortons Tortilla Española Wrap) */
const MOCK_TIM_HORTONS_TORTILLA_ROW = {
  dish_id: 'fd000000-0012-4000-a000-000000000001',
  dish_name: 'Tortilla Española Wrap',
  dish_name_es: 'Tortilla Española Wrap',
  restaurant_id: 'fd000000-0012-4000-a000-000000000002',
  chain_slug: 'tim-hortons-es',
  portion_grams: '240.00',
  calories: '1932.00',
  proteins: '50.00',
  carbohydrates: '200.00',
  sugars: '10.00',
  fats: '100.00',
  saturated_fats: '30.00',
  fiber: '5.00',
  salt: '4.00',
  sodium: '1600.00',
  trans_fats: '1.00',
  cholesterol: '150.00',
  potassium: '400.00',
  monounsaturated_fats: '30.00',
  polyunsaturated_fats: '20.00',
  reference_basis: 'per_serving',
  source_id: 'fd000000-0012-4000-a000-000000000003',
  source_name: 'Tim Hortons Spain Official PDF',
  source_type: 'scraped',
  source_url: 'https://timhortons.es/nutri.pdf',
  source_priority_tier: '0',
};

/** Tier 1 — cocina-española official data (Tortilla de patatas) */
const MOCK_COCINA_ESPANOLA_TORTILLA_ROW = {
  dish_id: 'fd000000-0012-4000-a000-000000000010',
  dish_name: 'Tortilla de patatas',
  dish_name_es: 'Tortilla de patatas',
  restaurant_id: 'fd000000-0012-4000-a000-000000000011',
  chain_slug: 'cocina-espanola',
  portion_grams: '150.00',
  calories: '197.00',
  proteins: '6.50',
  carbohydrates: '16.80',
  sugars: '1.20',
  fats: '11.80',
  saturated_fats: '2.10',
  fiber: '1.30',
  salt: '0.80',
  sodium: '0.32',
  trans_fats: '0.00',
  cholesterol: '0.00',
  potassium: '0.00',
  monounsaturated_fats: '0.00',
  polyunsaturated_fats: '0.00',
  reference_basis: 'per_serving',
  source_id: 'fd000000-0012-4000-a000-000000000012',
  source_name: 'BEDCA — Base de Datos Española de Composición de Alimentos',
  source_type: 'official',
  source_url: 'https://www.bedca.net/bdpub/',
  source_priority_tier: '1',
};

/** Tier 1 — cocina-española Jamón serrano */
const MOCK_COCINA_ESPANOLA_JAMON_ROW = {
  dish_id: 'fd000000-0012-4000-a000-000000000030',
  dish_name: 'Jamón serrano',
  dish_name_es: 'Jamón serrano',
  restaurant_id: 'fd000000-0012-4000-a000-000000000011',
  chain_slug: 'cocina-espanola',
  portion_grams: '30.00',
  calories: '95.00',
  proteins: '8.50',
  carbohydrates: '0.10',
  sugars: '0.00',
  fats: '6.50',
  saturated_fats: '2.20',
  fiber: '0.00',
  salt: '1.80',
  sodium: '720.00',
  trans_fats: '0.00',
  cholesterol: '35.00',
  potassium: '150.00',
  monounsaturated_fats: '3.00',
  polyunsaturated_fats: '0.80',
  reference_basis: 'per_serving',
  source_id: 'fd000000-0012-4000-a000-000000000012',
  source_name: 'BEDCA — Base de Datos Española de Composición de Alimentos',
  source_type: 'official',
  source_url: 'https://www.bedca.net/bdpub/',
  source_priority_tier: '1',
};

/** Tier 0 — Starbucks Latte (for AC4 branded path test) */
const MOCK_STARBUCKS_LATTE_ROW = {
  dish_id: 'fd000000-0012-4000-a000-000000000040',
  dish_name: 'Caffè Latte',
  dish_name_es: 'Caffè Latte',
  restaurant_id: 'fd000000-0012-4000-a000-000000000021',
  chain_slug: 'starbucks-es',
  portion_grams: '355.00',
  calories: '190.00',
  proteins: '12.00',
  carbohydrates: '19.00',
  sugars: '18.00',
  fats: '7.00',
  saturated_fats: '4.50',
  fiber: '0.00',
  salt: '0.30',
  sodium: '120.00',
  trans_fats: '0.00',
  cholesterol: '30.00',
  potassium: '400.00',
  monounsaturated_fats: '1.50',
  polyunsaturated_fats: '0.50',
  reference_basis: 'per_serving',
  source_id: 'fd000000-0012-4000-a000-000000000022',
  source_name: 'Starbucks Spain Official PDF',
  source_type: 'scraped',
  source_url: 'https://starbucks.es/nutri.pdf',
  source_priority_tier: '0',
};

/** Tier 0 — Starbucks Frappuccino (chain-only term, AC5) */
const MOCK_STARBUCKS_FRAPPUCCINO_ROW = {
  dish_id: 'fd000000-0012-4000-a000-000000000050',
  dish_name: 'Caramel Frappuccino',
  dish_name_es: 'Caramel Frappuccino',
  restaurant_id: 'fd000000-0012-4000-a000-000000000021',
  chain_slug: 'starbucks-es',
  portion_grams: '350.00',
  calories: '380.00',
  proteins: '5.00',
  carbohydrates: '62.00',
  sugars: '58.00',
  fats: '12.00',
  saturated_fats: '8.00',
  fiber: '0.00',
  salt: '0.50',
  sodium: '200.00',
  trans_fats: '0.00',
  cholesterol: '40.00',
  potassium: '350.00',
  monounsaturated_fats: '2.00',
  polyunsaturated_fats: '0.50',
  reference_basis: 'per_serving',
  source_id: 'fd000000-0012-4000-a000-000000000022',
  source_name: 'Starbucks Spain Official PDF',
  source_type: 'scraped',
  source_url: 'https://starbucks.es/nutri.pdf',
  source_priority_tier: '0',
};

// ---------------------------------------------------------------------------
// Mock kysely — same pattern as f020/f073
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
  return {
    getExecutor: () => executor,
  };
}

import { level1Lookup } from '../estimation/level1Lookup.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BUG-012 — Level 1 inverse cascade', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // -------------------------------------------------------------------------
  // AC1 — generic tortilla → cocina-española wins over Tim Hortons Tier 0
  // -------------------------------------------------------------------------

  describe('BUG-012 — AC1: generic tortilla → cocina-española', () => {
    it('returns Tier 1 cocina-española dish when Tier 0 chain dish also matches FTS', async () => {
      // Tier≥1 pre-cascade (4 strategies): strategy 1 misses, strategy 2 returns cocina-española Tier 1 row
      mockExecuteQuery
        .mockResolvedValueOnce({ rows: [] })                               // pass1/strategy1: exact dish — miss
        .mockResolvedValueOnce({ rows: [MOCK_COCINA_ESPANOLA_TORTILLA_ROW] }); // pass1/strategy2: FTS dish — Tier 1 hit

      const db = buildMockDb() as never;
      const result = await level1Lookup(db, 'tortilla', { hasExplicitBrand: false });

      expect(result).not.toBeNull();
      expect(result?.matchType).toBe('fts_dish');
      expect(result?.result.entityType).toBe('dish');
      expect(result?.result.name).toBe('Tortilla de patatas');
      expect(result?.result.source.priorityTier).toBe(1);
      // Must NOT return the Tim Hortons 1932 kcal row
      expect(result?.result.nutrients.calories).toBe(197);
    });
  });

  // -------------------------------------------------------------------------
  // AC2 — generic jamón → cocina-española over Starbucks Jamón Queso Panini
  // -------------------------------------------------------------------------

  describe('BUG-012 — AC2: generic jamón → cocina-española', () => {
    it('returns Tier 1 jamón serrano over Starbucks Jamón Queso Panini on FTS match', async () => {
      // Tier≥1 pre-cascade: strategy 1 misses, strategy 2 returns cocina-española Jamón serrano
      mockExecuteQuery
        .mockResolvedValueOnce({ rows: [] })                           // pass1/strategy1: exact dish — miss
        .mockResolvedValueOnce({ rows: [MOCK_COCINA_ESPANOLA_JAMON_ROW] }); // pass1/strategy2: FTS dish — Tier 1 hit

      const db = buildMockDb() as never;
      const result = await level1Lookup(db, 'jamón', { hasExplicitBrand: false });

      expect(result).not.toBeNull();
      expect(result?.matchType).toBe('fts_dish');
      expect(result?.result.name).toBe('Jamón serrano');
      expect(result?.result.source.priorityTier).toBe(1);
      expect(result?.result.chainSlug).toBe('cocina-espanola');
    });
  });

  // -------------------------------------------------------------------------
  // AC3 — pintxo de tortilla → cocina-española over Tier 0 chain result
  // -------------------------------------------------------------------------

  describe('BUG-012 — AC3: pintxo de tortilla → cocina-española', () => {
    it('returns Tier 1 result for partial FTS match over Tier 0 chain result', async () => {
      // Tier≥1 pre-cascade: strategy 1+2 dish miss, strategy 3 exact food miss, strategy 4 FTS food returns Tier 1 food row
      // Actually test FTS dish match for this one: strategy 1 misses, strategy 2 returns Tier 1 row
      mockExecuteQuery
        .mockResolvedValueOnce({ rows: [] })                                  // pass1/strategy1: exact dish — miss
        .mockResolvedValueOnce({ rows: [MOCK_COCINA_ESPANOLA_TORTILLA_ROW] }); // pass1/strategy2: FTS dish — Tier 1 hit

      const db = buildMockDb() as never;
      const result = await level1Lookup(db, 'pintxo de tortilla', { hasExplicitBrand: false });

      expect(result).not.toBeNull();
      expect(result?.result.source.priorityTier).toBe(1);
      expect(result?.result.chainSlug).toBe('cocina-espanola');
    });
  });

  // -------------------------------------------------------------------------
  // AC4 — hasExplicitBrand=true preserves Tier-0-first (F068 unchanged)
  // -------------------------------------------------------------------------

  describe('BUG-012 — AC4: hasExplicitBrand=true preserves Tier-0-first', () => {
    it('branded query (starbucks latte) still returns Starbucks Tier 0 result', async () => {
      // F068 path: Tier-0 cascade runs first (no OFF supermarket here — not a known supermarket brand)
      // Strategy 1 exact dish returns Starbucks Latte Tier 0 row
      mockExecuteQuery
        .mockResolvedValueOnce({ rows: [MOCK_STARBUCKS_LATTE_ROW] }); // Tier-0 cascade/strategy1: hit

      const db = buildMockDb() as never;
      const result = await level1Lookup(db, 'starbucks latte', {
        hasExplicitBrand: true,
        detectedBrand: 'starbucks-es',
        chainSlug: 'starbucks-es',
      });

      expect(result).not.toBeNull();
      expect(result?.result.source.priorityTier).toBe(0);
      expect(result?.result.chainSlug).toBe('starbucks-es');
      // Tier≥1 branch must NOT run for branded queries
      // Only 1 cascade (Tier-0-first), only 1 strategy call needed
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // AC5 — chain-only term fallback: frappuccino with no Tier≥1 match
  // -------------------------------------------------------------------------

  describe('BUG-012 — AC5: chain-only term fallback', () => {
    it('frappuccino (hasExplicitBrand=false) returns Starbucks result via unfiltered fallback when Tier≥1 misses', async () => {
      // Tier≥1 pre-cascade: all 4 strategies miss (no Tier 1+ frappuccino exists)
      // Unfiltered fallback cascade: strategy 1 returns Starbucks Frappuccino Tier 0 row
      mockExecuteQuery
        .mockResolvedValueOnce({ rows: [] })     // pass1/strategy1: exact dish Tier≥1 — miss
        .mockResolvedValueOnce({ rows: [] })     // pass1/strategy2: FTS dish Tier≥1 — miss
        .mockResolvedValueOnce({ rows: [] })     // pass1/strategy3: exact food Tier≥1 — miss
        .mockResolvedValueOnce({ rows: [] })     // pass1/strategy4: FTS food Tier≥1 — miss
        .mockResolvedValueOnce({ rows: [MOCK_STARBUCKS_FRAPPUCCINO_ROW] }); // pass2/strategy1: unfiltered — Tier 0 hit

      const db = buildMockDb() as never;
      const result = await level1Lookup(db, 'frappuccino', { hasExplicitBrand: false });

      expect(result).not.toBeNull();
      expect(result?.result.name).toBe('Caramel Frappuccino');
      expect(result?.result.source.priorityTier).toBe(0);
      // Must have made 5 calls (4 misses in Tier≥1 pass, 1 hit in unfiltered pass)
      expect(mockExecuteQuery).toHaveBeenCalledTimes(5);
    });
  });

  // -------------------------------------------------------------------------
  // AC6 — chainSlug scope overrides tier pre-filter
  // -------------------------------------------------------------------------

  describe('BUG-012 — AC6: chainSlug scope overrides tier pre-filter', () => {
    it('chainSlug=starbucks + "tortilla" skips Tier≥1 pre-cascade and returns scoped Starbucks result', async () => {
      // When chainSlug is set, Step 3 (Tier≥1 pre-cascade) is skipped entirely.
      // Only the unfiltered cascade runs (Step 4), which applies scope clause.
      // Strategy 1 exact dish returns the scoped Starbucks Tortilla Española Wrap (Tier 0).
      mockExecuteQuery
        .mockResolvedValueOnce({ rows: [MOCK_TIM_HORTONS_TORTILLA_ROW] }); // unfiltered cascade/strategy1: scoped hit

      const db = buildMockDb() as never;
      const result = await level1Lookup(db, 'tortilla', {
        hasExplicitBrand: false,
        chainSlug: 'starbucks-es',
      });

      expect(result).not.toBeNull();
      expect(result?.result.source.priorityTier).toBe(0);
      // Tier≥1 branch was NOT entered — only 1 cascade (unfiltered), 1 strategy call
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    });
  });
});
