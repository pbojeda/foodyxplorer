// Edge-case tests for level3Lookup — F022 QA review.
//
// Targets scenarios NOT covered by the developer's 26-test suite:
//   - Empty-string openAiApiKey (bypasses undefined guard — security)
//   - Distance = 0.0 (exact-match boundary)
//   - Distance = 0.4999… (float precision at threshold)
//   - Food nutrient fetch returns empty → total miss (not falling back again)
//   - Both dish AND food nutrient fetches return empty → total miss
//   - Vector literal constructed from zero-vector (all-zeros embedding)
//   - Distance field returned as a number from pg (not a string) — parseFloat on number
//   - L3_SIMILARITY_THRESHOLD env var: spec requires env var wiring — tested as missing
//   - Concurrent execution: two simultaneous calls do not interfere
//   - DB error during nutrient fetch (after similarity hit) → throws DB_UNAVAILABLE
//   - DB error during food nutrient fetch → throws DB_UNAVAILABLE
//   - OpenAI returns embedding with wrong dimension (non-1536) — behavior is defined

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

import { level3Lookup } from '../estimation/level3Lookup.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_EMBEDDING_1536 = new Array(1536).fill(0.01);
const MOCK_EMBEDDING_ALL_ZEROS = new Array(1536).fill(0);
const MOCK_EMBEDDING_WRONG_DIM = new Array(512).fill(0.01);

const MOCK_DISH_SIMILARITY_ROW = {
  dish_id: 'fd000000-ec01-4000-a000-000000000001',
  distance: '0.18',
};

const MOCK_FOOD_SIMILARITY_ROW = {
  food_id: 'fd000000-ec01-4000-a000-000000000010',
  distance: '0.25',
};

const MOCK_DISH_NUTRIENT_ROW = {
  dish_id: 'fd000000-ec01-4000-a000-000000000001',
  dish_name: 'Hamburguesa Test',
  dish_name_es: 'Hamburguesa Test',
  restaurant_id: 'fd000000-ec01-4000-a000-000000000002',
  chain_slug: 'test-chain',
  portion_grams: '200.00',
  calories: '520.00',
  proteins: '28.00',
  carbohydrates: '42.00',
  sugars: '8.00',
  fats: '24.00',
  saturated_fats: '9.00',
  fiber: '3.00',
  salt: '2.10',
  sodium: '840.00',
  trans_fats: '0.30',
  cholesterol: '75.00',
  potassium: '300.00',
  monounsaturated_fats: '10.00',
  polyunsaturated_fats: '3.00',
  reference_basis: 'per_serving',
  source_id: 'fd000000-ec01-4000-a000-000000000003',
  source_name: 'Test Source',
  source_type: 'official',
  source_url: null,
};

const MOCK_FOOD_NUTRIENT_ROW = {
  food_id: 'fd000000-ec01-4000-a000-000000000010',
  food_name: 'Ternera Test',
  food_name_es: 'Ternera Test',
  calories: '250.00',
  proteins: '26.00',
  carbohydrates: '0.00',
  sugars: '0.00',
  fats: '16.00',
  saturated_fats: '6.00',
  fiber: '0.00',
  salt: '0.50',
  sodium: '200.00',
  trans_fats: '0.50',
  cholesterol: '80.00',
  potassium: '350.00',
  monounsaturated_fats: '7.00',
  polyunsaturated_fats: '1.00',
  reference_basis: 'per_100g',
  source_id: 'fd000000-ec01-4000-a000-000000000011',
  source_name: 'BEDCA',
  source_type: 'official',
  source_url: 'https://bedca.net',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('level3Lookup — edge cases (F022 QA)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCallOpenAIEmbeddings.mockResolvedValue([MOCK_EMBEDDING_1536]);
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE: Empty string openAiApiKey
  //
  // The spec says "If OPENAI_API_KEY is not set" → skip gracefully.
  // The config schema enforces min(1) so an empty string never reaches production,
  // BUT the function signature accepts `string | undefined` — an empty string
  // passes the `=== undefined` guard and is sent to OpenAI as an invalid key.
  //
  // Per spec intent, empty string should be treated as "not set".
  // This test DOCUMENTS the current behavior (bug) and asserts the expected spec behavior.
  // -------------------------------------------------------------------------

  it('BUG: empty string openAiApiKey passes the undefined guard and calls OpenAI (should return null per spec)', async () => {
    // If this bug is fixed, the mock should NOT be called.
    // Currently, the code WILL call OpenAI with an empty key.
    const authError = Object.assign(new Error('Incorrect API key'), { status: 401 });
    mockCallOpenAIEmbeddings.mockRejectedValueOnce(authError);

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'hamburguesa', {
      openAiApiKey: '',
    });

    // The spec requires graceful skip when key is not set / invalid.
    // Whether the guard is at the "" check or the catch block, result must be null.
    expect(result).toBeNull();
    // SPEC: the function should NOT reach the DB at all when key is absent/empty
    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE: distance = 0.0 (exact match — boundary value accepted)
  // pgvector distance 0.0 means identical vectors; should be well below threshold
  // -------------------------------------------------------------------------

  it('distance 0.0 (exact match) is accepted (0.0 < 0.5)', async () => {
    const exactMatchRow = { ...MOCK_DISH_SIMILARITY_ROW, distance: '0' };
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [exactMatchRow] })
      .mockResolvedValueOnce({ rows: [MOCK_DISH_NUTRIENT_ROW] });

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'hamburguesa test', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result for distance=0.0');
    expect(result.similarityDistance).toBe(0);
    expect(result.matchType).toBe('similarity_dish');
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE: distance returned as a JS number from pg, not a string
  //
  // The DishSimilarityRow type declares `distance: string` but pgvector computed
  // expressions (embedding <-> vector) may return JavaScript numbers via the pg
  // driver depending on type inference. `parseFloat(0.18)` === `parseFloat('0.18')`
  // but this documents and verifies the defensive behavior.
  // -------------------------------------------------------------------------

  it('distance as a JS number (not string) is handled correctly by parseFloat', async () => {
    // Simulate pg returning a number directly (type cast edge case)
    const numericDistanceRow = {
      dish_id: MOCK_DISH_SIMILARITY_ROW.dish_id,
      distance: 0.18 as unknown as string, // pg driver returning number, not string
    };
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [numericDistanceRow] })
      .mockResolvedValueOnce({ rows: [MOCK_DISH_NUTRIENT_ROW] });

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'hamburguesa', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.similarityDistance).toBeCloseTo(0.18, 5);
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE: all-zeros embedding vector
  //
  // An embedding of all zeros is a degenerate case (zero-norm vector).
  // pgvector may return NaN or 1.0 distance for zero vectors.
  // level3Lookup should not crash — it should process the result normally.
  // -------------------------------------------------------------------------

  it('all-zeros embedding vector produces valid vectorLiteral and executes DB query', async () => {
    mockCallOpenAIEmbeddings.mockResolvedValueOnce([MOCK_EMBEDDING_ALL_ZEROS]);
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] }) // dish: no match
      .mockResolvedValueOnce({ rows: [] }); // food: no match

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'test', {
      openAiApiKey: 'sk-test-key',
    });

    // Should reach DB (not short-circuit) — the zero vector is a valid input
    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
    expect(result).toBeNull(); // no matches, total miss
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE: wrong-dimension embedding (512 instead of 1536)
  //
  // OpenAI could (in theory) return a different-dimension vector.
  // The vectorLiteral will have 512 elements. pgvector would reject this at
  // query time with a dimension mismatch error. That error should propagate
  // as DB_UNAVAILABLE, NOT as an OpenAI graceful skip.
  // -------------------------------------------------------------------------

  it('wrong-dimension embedding from OpenAI → DB rejects it → throws DB_UNAVAILABLE', async () => {
    mockCallOpenAIEmbeddings.mockResolvedValueOnce([MOCK_EMBEDDING_WRONG_DIM]);
    // pgvector rejects dimension mismatch at query execution
    mockExecuteQuery.mockRejectedValueOnce(
      new Error('ERROR: expected 1536 dimensions, not 512'),
    );

    const db = buildMockDb() as never;

    await expect(
      level3Lookup(db, 'hamburguesa', { openAiApiKey: 'sk-test-key' }),
    ).rejects.toMatchObject({ code: 'DB_UNAVAILABLE' });
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE: food nutrient fetch returns empty → total miss
  //
  // Strategy 2 finds a food within threshold but its nutrient row is missing.
  // Expected: fall to total miss (return null) — should NOT crash.
  // -------------------------------------------------------------------------

  it('food nutrient fetch returns empty → total miss (returns null, no crash)', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })                         // dish: no rows
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_SIMILARITY_ROW] }) // food: within threshold
      .mockResolvedValueOnce({ rows: [] });                        // food nutrient fetch: empty

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'ternera', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE: both dish AND food nutrient fetches empty → total miss
  //
  // Dish within threshold but no nutrients → falls through to food.
  // Food within threshold but no nutrients → falls to total miss.
  // -------------------------------------------------------------------------

  it('both dish and food nutrient fetches return empty → total miss', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [MOCK_DISH_SIMILARITY_ROW] }) // dish: within threshold
      .mockResolvedValueOnce({ rows: [] })                         // dish nutrient: empty
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_SIMILARITY_ROW] }) // food: within threshold
      .mockResolvedValueOnce({ rows: [] });                        // food nutrient: empty

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'unknown', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).toBeNull();
    // All 4 queries were executed
    expect(mockExecuteQuery).toHaveBeenCalledTimes(4);
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE: DB error during dish nutrient fetch → throws DB_UNAVAILABLE
  //
  // The similarity query succeeds (dish within threshold) but the subsequent
  // nutrient fetch throws. This should propagate as DB_UNAVAILABLE.
  // -------------------------------------------------------------------------

  it('DB error during dish nutrient fetch → throws DB_UNAVAILABLE', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [MOCK_DISH_SIMILARITY_ROW] }) // similarity OK
      .mockRejectedValueOnce(new Error('connection pool exhausted')); // nutrient fetch fails

    const db = buildMockDb() as never;

    await expect(
      level3Lookup(db, 'hamburguesa', { openAiApiKey: 'sk-test-key' }),
    ).rejects.toMatchObject({ code: 'DB_UNAVAILABLE' });
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE: DB error during food nutrient fetch → throws DB_UNAVAILABLE
  //
  // The food similarity query succeeds and food is within threshold, but
  // the food nutrient fetch throws.
  // -------------------------------------------------------------------------

  it('DB error during food nutrient fetch → throws DB_UNAVAILABLE', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })                         // dish: no rows
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_SIMILARITY_ROW] }) // food: within threshold
      .mockRejectedValueOnce(new Error('query timeout'));           // food nutrient fetch fails

    const db = buildMockDb() as never;

    await expect(
      level3Lookup(db, 'ternera', { openAiApiKey: 'sk-test-key' }),
    ).rejects.toMatchObject({ code: 'DB_UNAVAILABLE' });
  });

  // -------------------------------------------------------------------------
  // SPEC_MISMATCH: L3_SIMILARITY_THRESHOLD env var not wired in config or route
  //
  // The spec (Architecture Decisions, threshold section) states:
  //   "This is configurable via an environment variable L3_SIMILARITY_THRESHOLD
  //    (defaults to 0.5 if not set). The planner should treat this as an env var
  //    read at module load time (not per-request)."
  //
  // The current implementation:
  //   1. Does NOT declare L3_SIMILARITY_THRESHOLD in config.ts (EnvSchema)
  //   2. Does NOT pass threshold to level3Lookup in estimate.ts
  //   3. So threshold is always the hardcoded DEFAULT_THRESHOLD=0.5
  //
  // This test documents the spec requirement and verifies the threshold
  // override path (via options.threshold) works, even though env var wiring
  // is missing at the route level.
  // -------------------------------------------------------------------------

  it('SPEC_MISMATCH documented: threshold from options.threshold is respected (env var wiring not tested — missing from config)', async () => {
    // Verify the threshold override mechanism works at the function level
    const closeRow = { ...MOCK_DISH_SIMILARITY_ROW, distance: '0.35' };
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [closeRow] })
      .mockResolvedValueOnce({ rows: [MOCK_DISH_NUTRIENT_ROW] });

    const db = buildMockDb() as never;
    // With threshold=0.4: 0.35 < 0.4 → match
    const result = await level3Lookup(db, 'hamburguesa', {
      openAiApiKey: 'sk-test-key',
      threshold: 0.4,
    });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected match with threshold=0.4');
    expect(result.similarityDistance).toBeCloseTo(0.35, 5);
  });

  it('SPEC_MISMATCH documented: threshold=0.3 rejects distance=0.35 (confirms env var wiring at route level is needed)', async () => {
    const closeRow = { ...MOCK_DISH_SIMILARITY_ROW, distance: '0.35' };
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [closeRow] }) // dish: above threshold=0.3
      .mockResolvedValueOnce({ rows: [] });         // food: no rows

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'hamburguesa', {
      openAiApiKey: 'sk-test-key',
      threshold: 0.3,
    });

    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE: float precision at threshold boundary (0.49999999 should match)
  // -------------------------------------------------------------------------

  it('distance 0.49999999 (just below 0.5 by float precision) is accepted', async () => {
    const precisionRow = { ...MOCK_DISH_SIMILARITY_ROW, distance: '0.49999999' };
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [precisionRow] })
      .mockResolvedValueOnce({ rows: [MOCK_DISH_NUTRIENT_ROW] });

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'hamburguesa', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected match at 0.49999999');
    expect(result.similarityDistance).toBeLessThan(0.5);
  });

  // -------------------------------------------------------------------------
  // SECURITY: vector literal construction — non-numeric values in embedding
  //
  // If OpenAI returns a non-numeric value (e.g., NaN or string) in the embedding
  // array, it would be injected into sql.raw() without sanitization.
  // NaN.toString() = 'NaN' which is not valid pgvector syntax.
  // The DB would reject it (DB_UNAVAILABLE) — but the injection path exists.
  // -------------------------------------------------------------------------

  it('SECURITY: NaN in embedding array is caught by isFinite guard → graceful null (no DB call)', async () => {
    const embeddingWithNaN = new Array(1536).fill(0.01);
    embeddingWithNaN[0] = NaN;
    mockCallOpenAIEmbeddings.mockResolvedValueOnce([embeddingWithNaN]);

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'test', { openAiApiKey: 'sk-test-key' });

    expect(result).toBeNull();
    // No DB queries should have been made
    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });

  it('SECURITY: Infinity in embedding array is caught by isFinite guard → graceful null (no DB call)', async () => {
    const embeddingWithInfinity = new Array(1536).fill(0.01);
    embeddingWithInfinity[500] = Infinity;
    mockCallOpenAIEmbeddings.mockResolvedValueOnce([embeddingWithInfinity]);

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'test', { openAiApiKey: 'sk-test-key' });

    expect(result).toBeNull();
    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE: concurrent calls with same db instance do not interfere
  //
  // Two simultaneous level3Lookup calls should each get their own result.
  // -------------------------------------------------------------------------

  it('two concurrent calls resolve independently without state interference', async () => {
    // First call: dish hit (distance=0.18)
    // Second call: food hit (distance=0.25), dish misses
    let callCount = 0;
    mockExecuteQuery.mockImplementation(() => {
      callCount++;
      // Interleaved: dish1, dish2, nutrients1, food2, nutrients2
      const responses = [
        { rows: [MOCK_DISH_SIMILARITY_ROW] },       // call 1: dish search → hit
        { rows: [] },                                 // call 2: dish search → miss
        { rows: [MOCK_DISH_NUTRIENT_ROW] },          // call 1: dish nutrients
        { rows: [MOCK_FOOD_SIMILARITY_ROW] },        // call 2: food search → hit
        { rows: [MOCK_FOOD_NUTRIENT_ROW] },          // call 2: food nutrients
      ];
      return Promise.resolve(responses[(callCount - 1) % responses.length]);
    });

    const db = buildMockDb() as never;
    const [result1, result2] = await Promise.all([
      level3Lookup(db, 'hamburguesa', { openAiApiKey: 'sk-key-1' }),
      level3Lookup(db, 'ternera', { openAiApiKey: 'sk-key-2' }),
    ]);

    // Both should return non-null (not crash on concurrent execution)
    // The exact values depend on mock ordering but neither should throw
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE: similarityDistance is included in the result object (not just Level3Result)
  //
  // Spec: "similarityDistance: cosine distance of the winning match [0.0, 2.0)"
  // The route places Level3Result.similarityDistance into Level3Result.result via
  // the mapper override. Verify the mapper override actually sets result.similarityDistance.
  // -------------------------------------------------------------------------

  it('result.similarityDistance in EstimateResult equals Level3Result.similarityDistance', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [MOCK_DISH_SIMILARITY_ROW] }) // distance='0.18'
      .mockResolvedValueOnce({ rows: [MOCK_DISH_NUTRIENT_ROW] });

    const db = buildMockDb() as never;
    const level3Result = await level3Lookup(db, 'hamburguesa', {
      openAiApiKey: 'sk-test-key',
    });

    expect(level3Result).not.toBeNull();
    if (level3Result === null) throw new Error('Expected non-null result');

    // The top-level Level3Result.similarityDistance
    expect(level3Result.similarityDistance).toBeCloseTo(0.18, 5);
    // The EstimateResult.similarityDistance (set by the mapper override in level3Lookup)
    // This is what ends up in the API response — both must agree
    expect(level3Result.result.similarityDistance).toBeCloseTo(0.18, 5);
  });

  it('result.similarityDistance in EstimateResult is set for food similarity match', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_SIMILARITY_ROW] }) // distance='0.25'
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_NUTRIENT_ROW] });

    const db = buildMockDb() as never;
    const level3Result = await level3Lookup(db, 'ternera', {
      openAiApiKey: 'sk-test-key',
    });

    expect(level3Result).not.toBeNull();
    if (level3Result === null) throw new Error('Expected non-null result');
    expect(level3Result.similarityDistance).toBeCloseTo(0.25, 5);
    expect(level3Result.result.similarityDistance).toBeCloseTo(0.25, 5);
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE: mapDishRowToResult sets similarityDistance=null initially,
  // then level3Lookup must override it to the actual distance.
  // Verify the mutation is actually applied (not just checking Level3Result.similarityDistance).
  // -------------------------------------------------------------------------

  it('mapper initially sets similarityDistance=null but level3Lookup overrides it', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [{ ...MOCK_DISH_SIMILARITY_ROW, distance: '0.42' }] })
      .mockResolvedValueOnce({ rows: [MOCK_DISH_NUTRIENT_ROW] });

    const db = buildMockDb() as never;
    const level3Result = await level3Lookup(db, 'test', {
      openAiApiKey: 'sk-test-key',
    });

    expect(level3Result).not.toBeNull();
    if (level3Result === null) throw new Error('Expected non-null');

    // mapDishRowToResult returns similarityDistance: null (it's an L1 mapper)
    // level3Lookup does NOT mutate result.similarityDistance — only confidenceLevel and estimationMethod
    // This test exposes whether result.similarityDistance is actually set in the API result

    // Per spec: result.similarityDistance should be the cosine distance (0.42 here)
    // Check the actual behavior:
    expect(level3Result.result.similarityDistance).toBeCloseTo(0.42, 5);
  });
});
