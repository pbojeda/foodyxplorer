// Unit tests for F-H10: L3 Lexical Guard.
//
// Covers:
//   Phase 2: pure helper tests — computeTokenJaccard (AC3–AC7), applyLexicalGuard (AC2.5)
//   Phase 3: cascade integration tests — AC1, AC2, AC8, AC9 + edge cases
//
// Mocking strategy (Phase 3): identical pattern to f022.level3Lookup.unit.test.ts.
//   - callOpenAIEmbeddings: vi.mock('../embeddings/embeddingClient.js', ...)
//   - DB: buildMockDb() + mockExecuteQuery via vi.hoisted

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock callOpenAIEmbeddings
// ---------------------------------------------------------------------------

const { mockCallOpenAIEmbeddings } = vi.hoisted(() => ({
  mockCallOpenAIEmbeddings: vi.fn(),
}));

vi.mock('../embeddings/embeddingClient.js', () => ({
  callOpenAIEmbeddings: mockCallOpenAIEmbeddings,
}));

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
    withPlugins: function () { return this; },
    withPlugin: function () { return this; },
    withoutPlugins: function () { return this; },
  };
  return { getExecutor: () => executor };
}

import {
  computeTokenJaccard,
  applyLexicalGuard,
  level3Lookup,
} from '../estimation/level3Lookup.js';

// ---------------------------------------------------------------------------
// Fixtures — Phase 3 cascade integration tests
// ---------------------------------------------------------------------------

/** A fake 1536-dimension embedding vector (all zeros for simplicity). */
const MOCK_EMBEDDING = new Array(1536).fill(0.01);

// Q649 false positive scenario: 'CROISSANT CON QUESO FRESC'
// Jaccard vs 'queso fresco con membrillo' = 1/5 = 0.20 < 0.25 → guard rejects
const MOCK_CROISSANT_DISH_NUTRIENT_ROW = {
  dish_id: 'fd000000-fh10-4000-a000-000000000001',
  dish_name: 'CROISSANT CON QUESO FRESC',
  dish_name_es: 'CROISSANT CON QUESO FRESC',
  restaurant_id: 'fd000000-fh10-4000-a000-000000000002',
  chain_slug: 'starbucks-es',
  portion_grams: '120.00',
  calories: '343.00',
  proteins: '12.00',
  carbohydrates: '38.00',
  sugars: '6.00',
  fats: '16.00',
  saturated_fats: '9.00',
  fiber: '2.00',
  salt: '0.90',
  sodium: '360.00',
  trans_fats: '0.10',
  cholesterol: '45.00',
  potassium: '150.00',
  monounsaturated_fats: '5.00',
  polyunsaturated_fats: '1.00',
  reference_basis: 'per_serving',
  source_id: 'fd000000-fh10-4000-a000-000000000003',
  source_name: 'Starbucks Spain Official',
  source_type: 'official',
  source_url: null,
  source_priority_tier: null,
};

// Legitimate dish scenario: 'tortilla española'
// Jaccard vs 'tortilla de patatas' ≈ 0.33 > 0.25 → guard accepts
const MOCK_TORTILLA_DISH_NUTRIENT_ROW = {
  dish_id: 'fd000000-fh10-4000-a000-000000000010',
  dish_name: 'Spanish Omelette',
  dish_name_es: 'tortilla española',
  restaurant_id: 'fd000000-fh10-4000-a000-000000000011',
  chain_slug: 'generic-es',
  portion_grams: '150.00',
  calories: '220.00',
  proteins: '14.00',
  carbohydrates: '8.00',
  sugars: '1.00',
  fats: '15.00',
  saturated_fats: '4.00',
  fiber: '1.00',
  salt: '0.60',
  sodium: '240.00',
  trans_fats: '0.00',
  cholesterol: '300.00',
  potassium: '250.00',
  monounsaturated_fats: '7.00',
  polyunsaturated_fats: '2.00',
  reference_basis: 'per_serving',
  source_id: 'fd000000-fh10-4000-a000-000000000012',
  source_name: 'BEDCA',
  source_type: 'official',
  source_url: null,
  source_priority_tier: null,
};

// AC8: cascade — dish guard rejects ('CROISSANT CON MANTEQUILLA' vs 'gazpacho andaluz', no overlap)
const MOCK_MANTEQUILLA_DISH_NUTRIENT_ROW = {
  dish_id: 'fd000000-fh10-4000-a000-000000000020',
  dish_name: 'CROISSANT CON MANTEQUILLA',
  dish_name_es: 'CROISSANT CON MANTEQUILLA',
  restaurant_id: 'fd000000-fh10-4000-a000-000000000021',
  chain_slug: 'starbucks-es',
  portion_grams: '100.00',
  calories: '310.00',
  proteins: '7.00',
  carbohydrates: '35.00',
  sugars: '5.00',
  fats: '17.00',
  saturated_fats: '10.00',
  fiber: '2.00',
  salt: '0.70',
  sodium: '280.00',
  trans_fats: '0.10',
  cholesterol: '40.00',
  potassium: '120.00',
  monounsaturated_fats: '4.00',
  polyunsaturated_fats: '1.00',
  reference_basis: 'per_serving',
  source_id: 'fd000000-fh10-4000-a000-000000000022',
  source_name: 'Starbucks Spain Official',
  source_type: 'official',
  source_url: null,
  source_priority_tier: null,
};

// AC8: food guard accepts ('gazpacho' vs 'gazpacho andaluz', Jaccard = 1/2 = 0.5)
const MOCK_GAZPACHO_FOOD_NUTRIENT_ROW = {
  food_id: 'fd000000-fh10-4000-a000-000000000030',
  food_name: 'Gazpacho',
  food_name_es: 'gazpacho',
  food_group: 'Soups, Sauces, and Gravies',
  barcode: null,
  brand_name: null,
  calories: '24.00',
  proteins: '0.80',
  carbohydrates: '4.90',
  sugars: '3.40',
  fats: '0.30',
  saturated_fats: '0.05',
  fiber: '1.10',
  salt: '0.40',
  sodium: '160.00',
  trans_fats: '0.00',
  cholesterol: '0.00',
  potassium: '200.00',
  monounsaturated_fats: '0.05',
  polyunsaturated_fats: '0.10',
  reference_basis: 'per_100g',
  source_id: 'fd000000-fh10-4000-a000-000000000031',
  source_name: 'BEDCA',
  source_type: 'official',
  source_url: 'https://bedca.net',
  source_priority_tier: null,
};

// AC9: food guard rejects ('croissant' vs 'queso fresco con membrillo', no overlap)
const MOCK_CROISSANT_FOOD_NUTRIENT_ROW = {
  food_id: 'fd000000-fh10-4000-a000-000000000040',
  food_name: 'Croissant',
  food_name_es: 'croissant',
  food_group: 'Baked Products',
  barcode: null,
  brand_name: null,
  calories: '406.00',
  proteins: '8.20',
  carbohydrates: '45.80',
  sugars: '10.90',
  fats: '21.00',
  saturated_fats: '11.50',
  fiber: '1.80',
  salt: '1.00',
  sodium: '400.00',
  trans_fats: '0.40',
  cholesterol: '60.00',
  potassium: '150.00',
  monounsaturated_fats: '5.60',
  polyunsaturated_fats: '1.20',
  reference_basis: 'per_100g',
  source_id: 'fd000000-fh10-4000-a000-000000000041',
  source_name: 'BEDCA',
  source_type: 'official',
  source_url: 'https://bedca.net',
  source_priority_tier: null,
};

// ---------------------------------------------------------------------------
// Phase 2 tests: computeTokenJaccard — pure function
// ---------------------------------------------------------------------------

describe('computeTokenJaccard — pure function', () => {
  it('AC3: Q649 case — returns < 0.25 (Jaccard = 0.20)', () => {
    const result = computeTokenJaccard(
      'queso fresco con membrillo',
      'CROISSANT CON QUESO FRESC',
    );
    expect(result).toBeLessThan(0.25);
  });

  it('AC4: legitimate hit — returns > 0.25 (tortilla de patatas vs tortilla española)', () => {
    const result = computeTokenJaccard('tortilla de patatas', 'tortilla española');
    expect(result).toBeGreaterThan(0.25);
  });

  it('AC4.5a: diacritic normalization — atun rojo vs atún rojo returns 1.0', () => {
    const result = computeTokenJaccard('atun rojo', 'atún rojo');
    expect(result).toBe(1.0);
  });

  it('AC4.5b: case + diacritic normalization — exact same content returns 1.0', () => {
    const result = computeTokenJaccard(
      'queso fresco con membrillo',
      'Queso Fresco Con Membrillo',
    );
    expect(result).toBe(1.0);
  });

  it('AC5: empty query string returns 0.0', () => {
    const result = computeTokenJaccard('', 'cualquier cosa');
    expect(result).toBe(0.0);
  });

  it('AC6: all-stop-words query returns 0.0 (empty meaningful token sets)', () => {
    const result = computeTokenJaccard('con la de', 'por el al');
    expect(result).toBe(0.0);
  });

  it('AC7: single-token query in candidate returns >= 0.5', () => {
    const result = computeTokenJaccard('gazpacho', 'gazpacho andaluz');
    expect(result).toBeGreaterThanOrEqual(0.5);
  });

  it('exact match returns 1.0', () => {
    const result = computeTokenJaccard('hamburguesa clasica', 'hamburguesa clasica');
    expect(result).toBe(1.0);
  });

  it('no overlap returns 0.0', () => {
    const result = computeTokenJaccard('gazpacho andaluz', 'croissant mantequilla');
    expect(result).toBe(0.0);
  });

  it('boundary: Jaccard exactly at 0.25 boundary (1 shared / 3 union) = 0.33 > 0.25', () => {
    // 'tortilla' shared; union = {tortilla, patatas, española} = 3 tokens → 1/3 ≈ 0.33
    const result = computeTokenJaccard('tortilla patatas', 'tortilla española');
    expect(result).toBeGreaterThan(0.25);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 tests: applyLexicalGuard — helper
// ---------------------------------------------------------------------------

describe('applyLexicalGuard — helper', () => {
  it('AC2.5a: returns false when Jaccard < 0.25 (Q649 case)', () => {
    const result = applyLexicalGuard(
      'queso fresco con membrillo',
      'CROISSANT CON QUESO FRESC',
    );
    expect(result).toBe(false);
  });

  it('AC2.5b: returns true when Jaccard >= 0.25 (legitimate hit)', () => {
    const result = applyLexicalGuard('tortilla de patatas', 'tortilla española');
    expect(result).toBe(true);
  });

  it('AC2.5c: returns false for empty query', () => {
    const result = applyLexicalGuard('', 'gazpacho');
    expect(result).toBe(false);
  });

  it('returns true for exact match', () => {
    const result = applyLexicalGuard('gazpacho andaluz', 'gazpacho andaluz');
    expect(result).toBe(true);
  });

  it('returns false when no meaningful token overlap', () => {
    const result = applyLexicalGuard('gazpacho andaluz', 'croissant mantequilla');
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 tests: level3Lookup — lexical guard cascade (F-H10)
// ---------------------------------------------------------------------------

describe('level3Lookup — lexical guard cascade (F-H10)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCallOpenAIEmbeddings.mockResolvedValue([MOCK_EMBEDDING]);
  });

  // -------------------------------------------------------------------------
  // AC1 — Q649 exact case: dish guard rejects + food misses → null
  // -------------------------------------------------------------------------

  it('AC1: Q649 — dish guard rejects (Jaccard 0.20) and food misses → returns null', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [{ dish_id: 'fd000000-fh10-4000-a000-000000000001', distance: '0.18' }] }) // dish similarity hit
      .mockResolvedValueOnce({ rows: [MOCK_CROISSANT_DISH_NUTRIENT_ROW] })  // dish nutrients; guard rejects
      .mockResolvedValueOnce({ rows: [] });                                   // food similarity: no rows

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'queso fresco con membrillo', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).toBeNull();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // AC2 — Legitimate dish hit passes guard → result returned
  // -------------------------------------------------------------------------

  it('AC2: legitimate dish hit (Jaccard ≈ 0.33) passes guard → non-null similarity_dish result', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [{ dish_id: 'fd000000-fh10-4000-a000-000000000010', distance: '0.22' }] }) // dish similarity hit
      .mockResolvedValueOnce({ rows: [MOCK_TORTILLA_DISH_NUTRIENT_ROW] }); // dish nutrients; guard accepts

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'tortilla de patatas', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.matchType).toBe('similarity_dish');
    expect(result.result.nameEs).toBe('tortilla española');
  });

  it('AC2: legitimate hit does NOT call food strategy (short-circuits at strategy 1)', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [{ dish_id: 'fd000000-fh10-4000-a000-000000000010', distance: '0.22' }] })
      .mockResolvedValueOnce({ rows: [MOCK_TORTILLA_DISH_NUTRIENT_ROW] });

    const db = buildMockDb() as never;
    await level3Lookup(db, 'tortilla de patatas', { openAiApiKey: 'sk-test-key' });

    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // AC8 — Cascade: dish guard rejects, food guard accepts → food result
  // -------------------------------------------------------------------------

  it('AC8: dish guard rejects → cascade falls through to food strategy → similarity_food result', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [{ dish_id: 'fd000000-fh10-4000-a000-000000000020', distance: '0.20' }] }) // dish similarity hit
      .mockResolvedValueOnce({ rows: [MOCK_MANTEQUILLA_DISH_NUTRIENT_ROW] })   // dish nutrients; guard rejects
      .mockResolvedValueOnce({ rows: [{ food_id: 'fd000000-fh10-4000-a000-000000000030', distance: '0.30' }] }) // food similarity hit
      .mockResolvedValueOnce({ rows: [MOCK_GAZPACHO_FOOD_NUTRIENT_ROW] });     // food nutrients; guard accepts

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'gazpacho andaluz', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.matchType).toBe('similarity_food');
    expect(mockExecuteQuery).toHaveBeenCalledTimes(4);
  });

  // -------------------------------------------------------------------------
  // AC9 — Both strategies rejected → null
  // -------------------------------------------------------------------------

  it('AC9: both strategies rejected by guard → returns null', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [{ dish_id: 'fd000000-fh10-4000-a000-000000000001', distance: '0.18' }] }) // dish similarity hit
      .mockResolvedValueOnce({ rows: [MOCK_CROISSANT_DISH_NUTRIENT_ROW] })   // dish nutrients; guard rejects
      .mockResolvedValueOnce({ rows: [{ food_id: 'fd000000-fh10-4000-a000-000000000040', distance: '0.22' }] }) // food similarity hit
      .mockResolvedValueOnce({ rows: [MOCK_CROISSANT_FOOD_NUTRIENT_ROW] });  // food nutrients; guard rejects

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'queso fresco con membrillo', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).toBeNull();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(4);
  });

  // -------------------------------------------------------------------------
  // Edge case: dish_name_es is null → falls back to dish_name
  // -------------------------------------------------------------------------

  it('dish_name_es null fallback: uses dish_name when dish_name_es is null', async () => {
    // dish_name = 'tortilla española' (has overlap), dish_name_es = null → falls back to dish_name → guard accepts
    const rowWithNullEs = {
      ...MOCK_TORTILLA_DISH_NUTRIENT_ROW,
      dish_name: 'tortilla española',
      dish_name_es: null,
    };

    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [{ dish_id: rowWithNullEs.dish_id, distance: '0.22' }] })
      .mockResolvedValueOnce({ rows: [rowWithNullEs] });

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'tortilla de patatas', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.matchType).toBe('similarity_dish');
  });

  // -------------------------------------------------------------------------
  // Edge case: food_name_es is null → falls back to food_name; guard still rejects on low overlap
  // -------------------------------------------------------------------------

  it('food_name_es null fallback: uses food_name; guard rejects when food_name has low overlap', async () => {
    // food_name_es: null, food_name: 'CROISSANT CON QUESO FRESC' → Jaccard = 0.20 < 0.25 → guard rejects
    const foodRowWithNullEs = {
      ...MOCK_CROISSANT_FOOD_NUTRIENT_ROW,
      food_name: 'CROISSANT CON QUESO FRESC',
      food_name_es: null,
    };

    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })  // dish: no rows
      .mockResolvedValueOnce({ rows: [{ food_id: foodRowWithNullEs.food_id, distance: '0.20' }] })
      .mockResolvedValueOnce({ rows: [foodRowWithNullEs] }); // guard rejects via food_name fallback

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'queso fresco con membrillo', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Boundary: Jaccard exactly at LEXICAL_GUARD_MIN_OVERLAP (0.25) → passes (>=)
  // -------------------------------------------------------------------------

  it('Jaccard exactly at 0.25 boundary passes the guard (>= not >)', () => {
    // 'ternera' vs 'Carne de Ternera Picada':
    // tokens after stop-word: {ternera} ∩ {carne, ternera, picada} = {ternera}, union = {ternera, carne, picada} → 1/3 ≈ 0.33
    // Use a controlled 1-token-shared / 3-token-union pair: Jaccard = 0.33 (above boundary)
    // For boundary = 0.25 exactly: need 1/4 = 0.25 — find a 4-token union with 1 shared
    // 'gazpacho frio' vs 'gazpacho caliente espeso' → tokens: {gazpacho,frio} ∩ {gazpacho,caliente,espeso} = {gazpacho}, union 4 tokens → 1/4 = 0.25
    const result = applyLexicalGuard('gazpacho frio', 'gazpacho caliente espeso');
    // Jaccard = 1/4 = 0.25 >= 0.25 → should be true
    expect(result).toBe(true);
  });
});
