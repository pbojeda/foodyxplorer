/**
 * F073 — L1 lookup unit tests with cocina-espanola fixture rows.
 * Verifies that the L1 cascade correctly handles cocina-espanola dishes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Fixtures — cocina-espanola dishes
// ---------------------------------------------------------------------------

const MOCK_COCINA_ESPANOLA_BEDCA_ROW = {
  dish_id: '00000000-0000-e073-0007-000000000028',
  dish_name: 'Tortilla de patatas',
  dish_name_es: 'Tortilla de patatas',
  restaurant_id: '00000000-0000-e073-0006-000000000001',
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
  source_id: '00000000-0000-0000-0000-000000000003',
  source_name: 'BEDCA — Base de Datos Española de Composición de Alimentos',
  source_type: 'official',
  source_url: 'https://www.bedca.net/bdpub/',
  source_priority_tier: '1',
};

const MOCK_COCINA_ESPANOLA_RECIPE_ROW = {
  ...MOCK_COCINA_ESPANOLA_BEDCA_ROW,
  dish_id: '00000000-0000-e073-0007-000000000047',
  dish_name: 'Croquetas de jamón',
  dish_name_es: 'Croquetas de jamón',
  calories: '290.00',
  proteins: '8.00',
  carbohydrates: '22.00',
  source_id: '00000000-0000-e073-0000-000000000001',
  source_name: 'Cocina Española — Recipe Estimates',
  source_type: 'estimated',
  source_priority_tier: '3',
};

// ---------------------------------------------------------------------------
// Mock kysely
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

describe('F073 — L1 lookup with cocina-espanola dishes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('exact match returns BEDCA-sourced cocina-espanola dish with priorityTier=1', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [MOCK_COCINA_ESPANOLA_BEDCA_ROW] });

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'tortilla de patatas', {});

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('exact_dish');
    expect(result?.result.entityType).toBe('dish');
    expect(result?.result.name).toBe('Tortilla de patatas');
    expect(result?.result.chainSlug).toBe('cocina-espanola');
    expect(result?.result.source.priorityTier).toBe(1);
    expect(result?.result.nutrients.calories).toBe(197);
  });

  it('exact match returns recipe-estimated dish with priorityTier=3', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [MOCK_COCINA_ESPANOLA_RECIPE_ROW] });

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'croquetas de jamón', {});

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('exact_dish');
    expect(result?.result.entityType).toBe('dish');
    expect(result?.result.name).toBe('Croquetas de jamón');
    expect(result?.result.source.priorityTier).toBe(3);
    expect(result?.result.source.type).toBe('estimated');
  });

  it('FTS match returns cocina-espanola dish when exact miss', async () => {
    // Strategy 1 (exact): miss
    mockExecuteQuery.mockResolvedValueOnce({ rows: [] });
    // Strategy 2 (FTS dish): hit
    mockExecuteQuery.mockResolvedValueOnce({ rows: [MOCK_COCINA_ESPANOLA_BEDCA_ROW] });

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'tortilla patatas', {});

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('fts_dish');
    expect(result?.result.name).toBe('Tortilla de patatas');
    expect(result?.result.chainSlug).toBe('cocina-espanola');
  });

  it('all strategies miss returns null', async () => {
    // 4 strategies, all miss
    mockExecuteQuery.mockResolvedValue({ rows: [] });

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'plato inexistente xyz', {});

    expect(result).toBeNull();
  });

  it('generic query (no chainSlug) can find cocina-espanola dish', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [MOCK_COCINA_ESPANOLA_BEDCA_ROW] });

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'tortilla de patatas', {});

    expect(result).not.toBeNull();
    expect(result?.result.chainSlug).toBe('cocina-espanola');
  });
});
