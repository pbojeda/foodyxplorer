// Adversarial edge-case tests for F-H10: L3 Lexical Guard (QA verification layer).
//
// These tests target gaps NOT covered by the developer's 23-test suite:
//   - Emoji / special characters in dish names
//   - Numbers-only tokens stripped (e.g. '100 Montaditos')
//   - Single-token vs single-token boundary at exactly J=0.25
//   - Query = candidate (J=1.0) always passes
//   - All-whitespace / tab candidate names
//   - LEXICAL_GUARD_MIN_OVERLAP exported and is 0.25
//   - food strategy guard: food distance < threshold but food_name_es null AND food_name null
//     (TypeScript says food_name is string — this tests the JS runtime fallback path)
//   - Query is a pure number string
//   - Spec pre-flight table arithmetic: 'ternera' vs 'Carne de Ternera Picada' is 1/3 not 1/4

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
  LEXICAL_GUARD_MIN_OVERLAP,
  level3Lookup,
} from '../estimation/level3Lookup.js';

const MOCK_EMBEDDING = new Array(1536).fill(0.01);

// ---------------------------------------------------------------------------
// Pure helper adversarial tests
// ---------------------------------------------------------------------------

describe('computeTokenJaccard — adversarial edge cases (F-H10 QA)', () => {

  // -------------------------------------------------------------------------
  // Spec pre-flight table arithmetic check
  // The spec plan table states 'ternera' vs 'Carne de Ternera Picada' = 1/4 = 0.25.
  // The actual Jaccard calculation: tokens(a)={ternera}, tokens(b)={carne,ternera,picada}
  // inter=1, union=|{ternera}|+|{carne,ternera,picada}|-1 = 1+3-1 = 3 → Jaccard = 1/3 ≈ 0.333
  // The spec table has a documentation arithmetic error (1/4 should be 1/3).
  // The CODE is correct. This test locks the actual behavior.
  // -------------------------------------------------------------------------
  it('SPEC_DOC_ERROR: ternera vs Carne de Ternera Picada is 1/3 (not 1/4 as spec table says)', () => {
    const result = computeTokenJaccard('ternera', 'Carne de Ternera Picada');
    // Actual: inter=1 (ternera), union=3 (ternera+carne+picada), Jaccard=1/3
    expect(result).toBeCloseTo(1 / 3, 5);
    // Confirms guard passes (1/3 ≈ 0.333 >= 0.25)
    expect(result).toBeGreaterThanOrEqual(LEXICAL_GUARD_MIN_OVERLAP);
  });

  // -------------------------------------------------------------------------
  // Query = candidate (Jaccard = 1.0) — must always pass
  // -------------------------------------------------------------------------
  it('query identical to candidate → Jaccard 1.0 → guard passes unconditionally', () => {
    const result = computeTokenJaccard(
      'queso fresco con membrillo',
      'queso fresco con membrillo',
    );
    expect(result).toBe(1.0);
    expect(applyLexicalGuard('queso fresco con membrillo', 'queso fresco con membrillo')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Emoji in candidate name — must not crash
  // Emoji is stripped by [^a-z\s] after NFD normalization
  // -------------------------------------------------------------------------
  it('emoji in candidate name does not crash and is stripped from token set', () => {
    // 'gazpacho 🍅' → tokens {gazpacho} (emoji stripped)
    // 'gazpacho' → tokens {gazpacho}
    // Jaccard = 1/1 = 1.0
    const result = computeTokenJaccard('gazpacho', 'gazpacho 🍅');
    expect(result).toBe(1.0);
  });

  // -------------------------------------------------------------------------
  // Numbers in dish names (e.g. '100 Montaditos')
  // The [^a-z\s] regex strips digits after NFD normalization.
  // '100' is stripped → only 'montaditos' token survives.
  // A query of 'montadito' (singular) would NOT match 'montaditos' (no stemming per ADR-024).
  // -------------------------------------------------------------------------
  it('leading number in candidate is stripped — "100 Montaditos" tokenizes to {montaditos}', () => {
    // query 'montaditos' exactly matches
    const exactResult = computeTokenJaccard('montaditos', '100 Montaditos');
    expect(exactResult).toBe(1.0);
  });

  it('singular vs plural (no stemming per ADR-024): montadito != montaditos → Jaccard 0', () => {
    // Documented limitation of the guard: no stemming
    const result = computeTokenJaccard('montadito', '100 Montaditos');
    expect(result).toBe(0.0);
    expect(applyLexicalGuard('montadito', '100 Montaditos')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Whitespace-only candidate name
  // After [^a-z\s] strip and split, all tokens are empty strings → filtered out
  // → empty token set → returns 0.0
  // -------------------------------------------------------------------------
  it('whitespace-only candidate name → empty token set → returns 0.0', () => {
    const result = computeTokenJaccard('gazpacho', '   ');
    expect(result).toBe(0.0);
  });

  it('tab-only candidate name → empty token set → returns 0.0', () => {
    const result = computeTokenJaccard('gazpacho', '\t\t');
    expect(result).toBe(0.0);
  });

  // -------------------------------------------------------------------------
  // Query is a pure number string
  // Digits are stripped → empty token set → returns 0.0
  // -------------------------------------------------------------------------
  it('numeric-only query returns 0.0 (digits stripped → empty token set)', () => {
    const result = computeTokenJaccard('1234', 'gazpacho andaluz');
    expect(result).toBe(0.0);
    expect(applyLexicalGuard('1234', 'gazpacho andaluz')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // ñ → n normalization (NFD strip of combining tilde)
  // This is an expected consequence of the guard's diacritic normalization.
  // 'piña colada' and 'pina colada' tokenize identically after NFD-strip.
  // -------------------------------------------------------------------------
  it('ñ normalized to n: piña colada matches pina colada (Jaccard 1.0)', () => {
    const result = computeTokenJaccard('piña colada', 'pina colada');
    expect(result).toBe(1.0);
  });

  // -------------------------------------------------------------------------
  // Single-token boundary cases
  // -------------------------------------------------------------------------
  it('single meaningful token in both, identical → Jaccard 1.0', () => {
    const result = computeTokenJaccard('gazpacho', 'gazpacho');
    expect(result).toBe(1.0);
  });

  it('single meaningful token in query, not in candidate → Jaccard 0.0', () => {
    const result = computeTokenJaccard('gazpacho', 'paella valenciana');
    expect(result).toBe(0.0);
  });

  // -------------------------------------------------------------------------
  // LEXICAL_GUARD_MIN_OVERLAP constant is exported and equals 0.25
  // -------------------------------------------------------------------------
  it('LEXICAL_GUARD_MIN_OVERLAP constant is exported and equals 0.25', () => {
    expect(LEXICAL_GUARD_MIN_OVERLAP).toBe(0.25);
  });

  // -------------------------------------------------------------------------
  // Confirmed spec Jaccard values (regression-lock the known cases)
  // -------------------------------------------------------------------------
  it('Q649 Jaccard is exactly 0.20 (1/5) — spec derivation confirmed', () => {
    // tokens(a) = {queso, fresco, membrillo} (con stripped)
    // tokens(b) = {croissant, queso, fresc}  (con stripped)
    // inter = {queso} = 1, union = 5 → Jaccard = 1/5 = 0.2
    const result = computeTokenJaccard(
      'queso fresco con membrillo',
      'CROISSANT CON QUESO FRESC',
    );
    expect(result).toBeCloseTo(0.2, 10);
    // Must be < 0.25 (guard rejects)
    expect(result).toBeLessThan(LEXICAL_GUARD_MIN_OVERLAP);
  });

  it('gazpacho frio vs gazpacho caliente espeso is exactly 0.25 (1/4) — boundary test confirmed', () => {
    // tokens(a) = {gazpacho, frio} (2)
    // tokens(b) = {gazpacho, caliente, espeso} (3)
    // inter = {gazpacho} = 1, union = 2+3-1 = 4 → Jaccard = 1/4 = 0.25
    const result = computeTokenJaccard('gazpacho frio', 'gazpacho caliente espeso');
    expect(result).toBeCloseTo(0.25, 10);
    // Must pass: 0.25 >= 0.25
    expect(applyLexicalGuard('gazpacho frio', 'gazpacho caliente espeso')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cascade adversarial integration tests
// ---------------------------------------------------------------------------

describe('level3Lookup — adversarial cascade edge cases (F-H10 QA)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCallOpenAIEmbeddings.mockResolvedValue([MOCK_EMBEDDING]);
  });

  // -------------------------------------------------------------------------
  // dish_name_es null + dish_name null → candidateName is null → normalize(null) throws
  // TypeScript types declare dish_name: string (non-nullable), but this tests the
  // JS runtime behavior if somehow a null escapes the schema.
  // Expected: the outer try-catch catches the TypeError and rethrows as DB_UNAVAILABLE.
  // This documents the failure mode if DB data is inconsistent.
  // -------------------------------------------------------------------------
  it('dish_name null + dish_name_es null → candidateName null → throws DB_UNAVAILABLE (not a silent miss)', async () => {
    const rowWithBothNull = {
      dish_id: 'fd000000-fh10-qa01-a000-000000000001',
      dish_name: null as unknown as string, // schema violation — both null
      dish_name_es: null,
      restaurant_id: 'fd000000-fh10-qa01-a000-000000000002',
      chain_slug: 'test',
      portion_grams: '100.00',
      calories: '300.00',
      proteins: '10.00',
      carbohydrates: '30.00',
      sugars: '5.00',
      fats: '12.00',
      saturated_fats: '4.00',
      fiber: '2.00',
      salt: '0.50',
      sodium: '200.00',
      trans_fats: '0.10',
      cholesterol: '30.00',
      potassium: '100.00',
      monounsaturated_fats: '3.00',
      polyunsaturated_fats: '1.00',
      reference_basis: 'per_serving',
      source_id: 'fd000000-fh10-qa01-a000-000000000003',
      source_name: 'Test',
      source_type: 'official',
      source_url: null,
      source_priority_tier: null,
    };

    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [{ dish_id: rowWithBothNull.dish_id, distance: '0.20' }] })
      .mockResolvedValueOnce({ rows: [rowWithBothNull] });

    const db = buildMockDb() as never;

    // normalize(null) throws TypeError → caught by outer try-catch → DB_UNAVAILABLE
    await expect(
      level3Lookup(db, 'tortilla de patatas', { openAiApiKey: 'sk-test-key' }),
    ).rejects.toMatchObject({ code: 'DB_UNAVAILABLE' });
  });

  // -------------------------------------------------------------------------
  // food_name null (schema violation, both food_name_es and food_name null)
  // Same failure mode as dish scenario above.
  // -------------------------------------------------------------------------
  it('food_name null + food_name_es null → candidateName null → throws DB_UNAVAILABLE', async () => {
    const foodRowWithBothNull = {
      food_id: 'fd000000-fh10-qa02-a000-000000000010',
      food_name: null as unknown as string, // schema violation
      food_name_es: null,
      food_group: 'Test',
      barcode: null,
      brand_name: null,
      calories: '100.00',
      proteins: '5.00',
      carbohydrates: '10.00',
      sugars: '2.00',
      fats: '4.00',
      saturated_fats: '1.00',
      fiber: '1.00',
      salt: '0.20',
      sodium: '80.00',
      trans_fats: '0.00',
      cholesterol: '0.00',
      potassium: '100.00',
      monounsaturated_fats: '1.00',
      polyunsaturated_fats: '0.50',
      reference_basis: 'per_100g',
      source_id: 'fd000000-fh10-qa02-a000-000000000011',
      source_name: 'BEDCA',
      source_type: 'official',
      source_url: 'https://bedca.net',
      source_priority_tier: null,
    };

    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })  // dish: no rows
      .mockResolvedValueOnce({ rows: [{ food_id: foodRowWithBothNull.food_id, distance: '0.20' }] })
      .mockResolvedValueOnce({ rows: [foodRowWithBothNull] });

    const db = buildMockDb() as never;

    await expect(
      level3Lookup(db, 'tortilla', { openAiApiKey: 'sk-test-key' }),
    ).rejects.toMatchObject({ code: 'DB_UNAVAILABLE' });
  });

  // -------------------------------------------------------------------------
  // Guard correctly passes when query = candidate nameEs (Jaccard 1.0)
  // -------------------------------------------------------------------------
  it('query matching candidate nameEs exactly → Jaccard 1.0 → guard always passes', async () => {
    const row = {
      dish_id: 'fd000000-fh10-qa03-a000-000000000001',
      dish_name: 'Queso Fresco con Membrillo',
      dish_name_es: 'queso fresco con membrillo',
      restaurant_id: 'fd000000-fh10-qa03-a000-000000000002',
      chain_slug: 'test-es',
      portion_grams: '150.00',
      calories: '200.00',
      proteins: '8.00',
      carbohydrates: '20.00',
      sugars: '15.00',
      fats: '10.00',
      saturated_fats: '6.00',
      fiber: '0.00',
      salt: '0.30',
      sodium: '120.00',
      trans_fats: '0.00',
      cholesterol: '25.00',
      potassium: '100.00',
      monounsaturated_fats: '3.00',
      polyunsaturated_fats: '0.50',
      reference_basis: 'per_serving',
      source_id: 'fd000000-fh10-qa03-a000-000000000003',
      source_name: 'Test Source',
      source_type: 'official',
      source_url: null,
      source_priority_tier: null,
    };

    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [{ dish_id: row.dish_id, distance: '0.05' }] })
      .mockResolvedValueOnce({ rows: [row] });

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'queso fresco con membrillo', {
      openAiApiKey: 'sk-test-key',
    });

    // The query that was Q649 (rejected when candidate was CROISSANT) now correctly
    // returns a result when the candidate IS the query
    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null');
    expect(result.matchType).toBe('similarity_dish');
    expect(result.result.nameEs).toBe('queso fresco con membrillo');
  });

  // -------------------------------------------------------------------------
  // Guard does NOT run when dish distance is >= threshold
  // (guard is only reached after a distance < threshold hit)
  // -------------------------------------------------------------------------
  it('dish above threshold: guard never evaluated, falls through to food correctly', async () => {
    const gazpachoFoodRow = {
      food_id: 'fd000000-fh10-qa04-a000-000000000010',
      food_name: 'Gazpacho Andaluz',
      food_name_es: 'gazpacho andaluz',
      food_group: 'Soups',
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
      source_id: 'fd000000-fh10-qa04-a000-000000000011',
      source_name: 'BEDCA',
      source_type: 'official',
      source_url: 'https://bedca.net',
      source_priority_tier: null,
    };

    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [{ dish_id: 'fd000000-fh10-qa04-a000-000000000001', distance: '0.6' }] }) // above threshold
      .mockResolvedValueOnce({ rows: [{ food_id: gazpachoFoodRow.food_id, distance: '0.25' }] }) // food hit
      .mockResolvedValueOnce({ rows: [gazpachoFoodRow] }); // food nutrients; guard accepts

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'gazpacho', { openAiApiKey: 'sk-test-key' });

    // Dish above threshold → guard NOT evaluated for dish → fall through to food
    // Food Jaccard: {gazpacho} ∩ {gazpacho, andaluz} = 1/2 = 0.5 >= 0.25 → passes
    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null');
    expect(result.matchType).toBe('similarity_food');
    // Only 3 calls: dish-similarity, food-similarity, food-nutrients (no dish-nutrient fetch)
    expect(mockExecuteQuery).toHaveBeenCalledTimes(3);
  });
});
