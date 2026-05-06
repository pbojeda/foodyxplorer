// F-H10-FU: L1 Lexical Guard — adversarial edge-case tests (QA verification layer)
//
// Covers gaps not tested by the developer's 15-test suite:
//   1. Stop-word-only query (e.g. 'con', 'de') — empty token set → Jaccard = 0 → guard rejects
//   2. Diacritic mismatch — 'atun' vs 'Atún rojo' — NFD normalization must bridge the gap
//   3. Very long query / candidate (20+ words) — no crash
//   4. Empty string candidate (name_es = '') — treated as falsy → skips Spanish side
//   5. AC8(c): both Spanish AND English sides pass → guard accepts
//   6. Tier=0 branded path (hasExplicitBrand=true) — guard applies inside Tier-0 runCascade pass
//   7. Guard rejects S2, S3 exact food hits — verifies fall-through wires correctly
//   8. Two-pass both-reject: guard rejects in both branded passes (Tier-0 + unfiltered)
//
// All tests use REAL level1Lookup with mocked Kysely DB (same pattern as
// fH10FU.l1LexicalGuard.unit.test.ts and f020.level1Lookup.unit.test.ts).
// chainSlug is set for single-pass tests to isolate guard logic.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeTokenJaccard, applyLexicalGuard } from '../estimation/level3Lookup.js';
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
// Shared fixture helpers
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
  reference_basis: 'per_serving' as const,
};

const BASE_SOURCE = {
  source_id: 'fd000000-fu10-ec00-a000-000000000010',
  source_name: 'Edge Case Source',
  source_type: 'official' as const,
  source_url: null,
  source_priority_tier: '1',
};

function makeDishRow(overrides: Partial<DishQueryRow>): DishQueryRow {
  return {
    dish_id: 'fd000000-fu10-ec00-a000-000000000001',
    dish_name: 'Default English Name',
    dish_name_es: 'Nombre español',
    restaurant_id: 'fd000000-fu10-ec00-a000-000000000002',
    chain_slug: 'test-chain',
    portion_grams: '200.00',
    ...BASE_NUTRIENTS,
    ...BASE_SOURCE,
    ...overrides,
  };
}

function makeFoodRow(overrides: Partial<FoodQueryRow>): FoodQueryRow {
  return {
    food_id: 'fd000000-fu10-ec00-a000-000000000003',
    food_name: 'Default Food',
    food_name_es: null,
    food_group: 'Test Group',
    barcode: null,
    brand_name: null,
    ...BASE_NUTRIENTS,
    reference_basis: 'per_100g',
    ...BASE_SOURCE,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pure-function edge cases (computeTokenJaccard / applyLexicalGuard)
// These test the logic that passesGuardEither relies on, without cascade overhead.
// ---------------------------------------------------------------------------

describe('computeTokenJaccard — adversarial pure-function edge cases', () => {
  // Edge case 1: stop-word-only query — empty token set → Jaccard = 0
  it('stop-word-only query "con" → empty token set → Jaccard = 0', () => {
    expect(computeTokenJaccard('con', 'pollo con arroz')).toBe(0);
  });

  it('stop-word-only query "de" → empty token set → Jaccard = 0', () => {
    expect(computeTokenJaccard('de', 'tortilla de patatas')).toBe(0);
  });

  it('stop-word-only candidate → empty token set → Jaccard = 0', () => {
    // candidate has only stop words after normalization
    expect(computeTokenJaccard('paella', 'de la con')).toBe(0);
  });

  // Edge case 2: diacritic mismatch — NFD normalization should bridge
  it('atun vs Atún rojo — diacritics stripped, Jaccard = 0.5 ≥ 0.25', () => {
    const j = computeTokenJaccard('atun', 'Atún rojo');
    // 'atun' tokens: {atun}; 'atun rojo' tokens: {atun, rojo}
    // intersection=1, union=2 → 0.5
    expect(j).toBeCloseTo(0.5, 5);
    expect(j).toBeGreaterThanOrEqual(0.25);
  });

  it('salmon vs Salmón a la plancha — diacritics stripped, Jaccard = 0.5', () => {
    const j = computeTokenJaccard('salmon', 'Salmón a la plancha');
    // 'salmon' → {salmon}; 'salmon plancha' (a, la = stop words) → {salmon, plancha}
    // intersection=1, union=2 → 0.5
    expect(j).toBeCloseTo(0.5, 5);
  });

  // Edge case 3: very long query / candidate — no crash
  it('very long query (20+ words) vs long candidate — does not crash', () => {
    const longQuery = Array.from({ length: 22 }, (_, i) => `palabra${i}`).join(' ');
    const longCandidate = Array.from({ length: 25 }, (_, i) => `termino${i}`).join(' ');
    expect(() => computeTokenJaccard(longQuery, longCandidate)).not.toThrow();
    const j = computeTokenJaccard(longQuery, longCandidate);
    expect(j).toBeGreaterThanOrEqual(0);
    expect(j).toBeLessThanOrEqual(1);
  });

  it('very long query with overlap — Jaccard computed correctly without crash', () => {
    // NOTE: computeTokenJaccard strips non-[a-z\s] chars (digits removed) and uses Set.
    // All tokens must be purely alphabetic and distinct to avoid set deduplication.
    // Using a fixed list of 30 distinct alphabetic tokens split into shared/exclusive groups.
    const shared = 'paella tortilla gazpacho jamon croqueta fabada cocido pisto salmorejo migas';
    const extra1 = 'churros pulpo';
    const extra2 = 'bocadillo empanada';
    const q = `${shared} ${extra1}`;  // 12 tokens
    const c = `${shared} ${extra2}`;  // 12 tokens
    const j = computeTokenJaccard(q, c);
    // intersection=10 (shared, minus any stop words — none of these are stop words),
    // union = 10+2+2 = 14 → Jaccard = 10/14 ≈ 0.714
    // Just verify it does not crash and result is in [0,1]
    expect(j).toBeGreaterThan(0);
    expect(j).toBeLessThanOrEqual(1);
    // Shared tokens should dominate → Jaccard well above 0.25
    expect(j).toBeGreaterThan(0.25);
  });

  // Edge case 4: empty string candidate
  it('empty string candidate → Jaccard = 0 (empty token set)', () => {
    expect(computeTokenJaccard('paella', '')).toBe(0);
  });

  it('empty string query → Jaccard = 0 (empty token set)', () => {
    expect(computeTokenJaccard('', 'paella valenciana')).toBe(0);
  });

  it('both empty → Jaccard = 0', () => {
    expect(computeTokenJaccard('', '')).toBe(0);
  });

  // Edge case 5: applyLexicalGuard correctly wraps computeTokenJaccard at 0.25 threshold
  it('applyLexicalGuard: J = exactly 0.25 boundary — accepts (≥ not >)', () => {
    // Need intersection=1, union=4 → J=0.25
    // Use non-stop-word tokens: 'paella rojo' vs 'paella verde naranja'
    // query tokens: {paella, rojo} (2 tokens), candidate: {paella, verde, naranja} (3 tokens)
    // intersection=1, union=4 → J=0.25
    const j = computeTokenJaccard('paella rojo', 'paella verde naranja');
    expect(j).toBeCloseTo(0.25, 5);
    expect(applyLexicalGuard('paella rojo', 'paella verde naranja')).toBe(true); // at boundary → PASS
  });

  it('applyLexicalGuard: J just below 0.25 — rejects', () => {
    // Need intersection=1, union=5 → J=0.20
    // 'queso fresco membrillo' vs 'croissant queso fresc' (stop: con stripped already)
    // query: {queso, fresco, membrillo} (3 tokens), candidate: {croissant, queso, fresc} (3 tokens)
    // intersection={queso}=1, union=5 → J=0.20
    const j = computeTokenJaccard('queso fresco membrillo', 'croissant queso fresc');
    expect(j).toBeCloseTo(1 / 5, 5);
    expect(applyLexicalGuard('queso fresco membrillo', 'croissant queso fresc')).toBe(false); // below boundary → REJECT
  });
});

// ---------------------------------------------------------------------------
// Cascade edge cases via level1Lookup (mocked DB)
// ---------------------------------------------------------------------------

describe('passesGuardEither — cascade edge cases (adversarial)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // Edge case 1: stop-word-only query reaches L1 — guard rejects FTS hit
  it('stop-word-only query "con" — guard rejects FTS dish hit (empty token set, J=0)', async () => {
    const dishRow = makeDishRow({
      dish_name: 'Pollo con arroz',
      dish_name_es: 'Pollo con arroz',
      chain_slug: 'test-chain',
    });

    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })             // S1 miss
      .mockResolvedValueOnce({ rows: [dishRow] })      // S2 FTS dish — guard rejects (J=0 for 'con')
      .mockResolvedValueOnce({ rows: [] })             // S3 exact food miss
      .mockResolvedValueOnce({ rows: [] });            // S4 FTS food miss

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'con', { chainSlug: 'test-chain' });

    expect(result).toBeNull();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(4);
  });

  // Edge case 2: diacritic mismatch — guard correctly normalizes and accepts
  it('diacritic mismatch "atun" vs "Atún rojo" — guard accepts (NFD normalization)', async () => {
    const dishRow = makeDishRow({
      dish_name: 'Red Tuna',
      dish_name_es: 'Atún rojo',
      chain_slug: 'test-chain',
    });

    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })             // S1 miss
      .mockResolvedValueOnce({ rows: [dishRow] });     // S2 FTS dish — guard accepts (J=0.5)

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'atun', { chainSlug: 'test-chain' });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('fts_dish');
    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
  });

  // Edge case 4: empty string name_es ('') — treated as falsy, skips Spanish side
  it('dish_name_es is empty string ("") — treated as falsy, falls back to English name', async () => {
    // nameEs = '' → falsy in JS → passesGuardEither skips Spanish side
    // Only English side evaluated: jaccard('paella', 'paella valenciana') = 0.5 ≥ 0.25 → PASS
    const dishRow = makeDishRow({
      dish_name: 'Paella valenciana',
      dish_name_es: '',  // empty string — falsy in JS
      chain_slug: 'test-chain',
    });

    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })             // S1 miss
      .mockResolvedValueOnce({ rows: [dishRow] });     // S2 FTS dish

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'paella', { chainSlug: 'test-chain' });

    // English name 'Paella valenciana' passes → result returned
    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('fts_dish');
  });

  it('dish_name_es is empty string and English name also fails — guard rejects', async () => {
    // nameEs = '' → falsy → Spanish side skipped
    // English name: jaccard('queso membrillo', 'croissant english') ≈ 0 → REJECT
    const dishRow = makeDishRow({
      dish_name: 'Croissant English',
      dish_name_es: '',
      chain_slug: 'test-chain',
    });

    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })             // S1 miss
      .mockResolvedValueOnce({ rows: [dishRow] })      // S2 FTS dish — guard rejects
      .mockResolvedValueOnce({ rows: [] })             // S3 exact food miss
      .mockResolvedValueOnce({ rows: [] });            // S4 FTS food miss

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'queso con membrillo', { chainSlug: 'test-chain' });

    expect(result).toBeNull();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(4);
  });

  // Edge case 5 (AC8c): both Spanish AND English sides pass → guard accepts on Spanish side first
  it('AC8(c): both name_es and name pass threshold — guard accepts on Spanish side (short-circuits)', async () => {
    // query: 'paella valenciana'
    // name_es: 'Paella valenciana' → J=1.0 → PASS (Spanish side)
    // name: 'Valencian Paella' → would also pass but guard short-circuits on first true
    const dishRow = makeDishRow({
      dish_name: 'Valencian Paella',
      dish_name_es: 'Paella valenciana',
      chain_slug: 'test-chain',
    });

    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })             // S1 miss
      .mockResolvedValueOnce({ rows: [dishRow] });     // S2 FTS dish — guard accepts

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'paella valenciana', { chainSlug: 'test-chain' });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('fts_dish');
    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
  });

  // Edge case 6: Tier=0 branded path (hasExplicitBrand=true) — guard applies inside runCascade
  it('Tier-0 branded path (hasExplicitBrand=true) — guard applies, rejects false positive', async () => {
    // hasExplicitBrand=true triggers Tier=0 first pass
    // Pass 1 (Tier=0): S1 miss, S2 returns CROISSANT-equivalent → guard rejects, S3 miss, S4 miss → null
    // Pass 2 (unfiltered): S1 miss, S2 returns same CROISSANT → guard rejects, S3 miss, S4 miss → null
    // dish_name_es: 'CROISSANT CON QUESO FRESC' gives Jaccard = 1/5 = 0.20 < 0.25 (guard rejects)
    // NOT 'CROISSANT CON QUESO' which gives Jaccard = 1/4 = 0.25 (guard accepts — boundary!)
    const falsePosRow = makeDishRow({
      dish_name: 'CROISSANT WITH FRESH CHEESE SPREAD',
      dish_name_es: 'CROISSANT CON QUESO FRESC',
      chain_slug: 'starbucks-es',
      source_priority_tier: '0',
    });

    mockExecuteQuery
      // Tier=0 pass (4 calls)
      .mockResolvedValueOnce({ rows: [] })             // S1 exact dish, Tier=0 → miss
      .mockResolvedValueOnce({ rows: [falsePosRow] })  // S2 FTS dish, Tier=0 → guard rejects
      .mockResolvedValueOnce({ rows: [] })             // S3 exact food, Tier=0 → miss
      .mockResolvedValueOnce({ rows: [] })             // S4 FTS food, Tier=0 → miss
      // Unfiltered pass (4 calls)
      .mockResolvedValueOnce({ rows: [] })             // S1 exact dish, unfiltered → miss
      .mockResolvedValueOnce({ rows: [falsePosRow] })  // S2 FTS dish, unfiltered → guard rejects
      .mockResolvedValueOnce({ rows: [] })             // S3 exact food, unfiltered → miss
      .mockResolvedValueOnce({ rows: [] });            // S4 FTS food, unfiltered → miss

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'queso fresco con membrillo', {
      hasExplicitBrand: true,
      chainSlug: 'starbucks-es',
    });

    expect(result).toBeNull();
    // 8 DB calls: 4 for Tier=0 pass + 4 for unfiltered pass
    expect(mockExecuteQuery).toHaveBeenCalledTimes(8);
  });

  // Edge case 7: guard rejects S2, S3 exact food hits — fall-through to S3 works
  it('guard rejects S2 FTS dish, then S3 exact food returns legitimate result', async () => {
    const falsePosRow = makeDishRow({
      dish_name: 'CROISSANT WITH FRESH CHEESE',
      dish_name_es: 'CROISSANT CON QUESO FRESC',
      chain_slug: 'test-chain',
    });

    const exactFoodRow = makeFoodRow({
      food_name: 'Queso fresco',
      food_name_es: 'Queso fresco',
      food_group: 'Dairy',
    });

    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })              // S1 miss
      .mockResolvedValueOnce({ rows: [falsePosRow] })   // S2 FTS dish → guard rejects
      .mockResolvedValueOnce({ rows: [exactFoodRow] }); // S3 exact food → guard exempt, returns

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'queso fresco con membrillo', { chainSlug: 'test-chain' });

    // S3 exact food is exempt from guard → result returned
    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('exact_food');
    // Only 3 DB calls: S1 + S2 + S3 (S4 never reached)
    expect(mockExecuteQuery).toHaveBeenCalledTimes(3);
  });

  // Edge case 8: FTS food with food_name_es = '' (empty string) — English name evaluated
  it('food_name_es empty string — English food_name evaluated; passes threshold', async () => {
    const foodRow = makeFoodRow({
      food_name: 'Gazpacho soup',
      food_name_es: '',
      food_group: 'Soups',
    });

    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })             // S1 miss
      .mockResolvedValueOnce({ rows: [] })             // S2 FTS dish miss
      .mockResolvedValueOnce({ rows: [] })             // S3 exact food miss
      .mockResolvedValueOnce({ rows: [foodRow] });     // S4 FTS food

    const db = buildMockDb() as never;
    // jaccard('gazpacho', 'gazpacho soup') = 1/2 = 0.5 ≥ 0.25 → PASS via English name
    const result = await level1Lookup(db, 'gazpacho', { chainSlug: 'test-chain' });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('fts_food');
  });
});
