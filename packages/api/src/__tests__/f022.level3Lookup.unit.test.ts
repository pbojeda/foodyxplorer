// Unit tests for level3Lookup — Level 3 pgvector similarity extrapolation.
//
// Mocks:
//   - callOpenAIEmbeddings: controls embedding generation
//   - Kysely executor: controls DB query results
//
// Tests: OpenAI skip, OpenAI failure, dish similarity strategy, food similarity
//        strategy, threshold enforcement, scoping, nutrient mapping, error handling.

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

/** A fake 1536-dimension embedding vector (all zeros for simplicity). */
const MOCK_EMBEDDING = new Array(1536).fill(0.01);

/** Dish similarity search result row — within threshold. */
const MOCK_DISH_SIMILARITY_ROW = {
  dish_id: 'fd000000-0022-4000-a000-000000000001',
  distance: '0.18',
};

/** Food similarity search result row — within threshold. */
const MOCK_FOOD_SIMILARITY_ROW = {
  food_id: 'fd000000-0022-4000-a000-000000000010',
  distance: '0.25',
};

/** Full dish nutrient row — same shape as Level 1 DishQueryRow. */
const MOCK_DISH_NUTRIENT_ROW = {
  dish_id: 'fd000000-0022-4000-a000-000000000001',
  dish_name: 'Hamburguesa Clásica',
  dish_name_es: 'Hamburguesa Clásica',
  restaurant_id: 'fd000000-0022-4000-a000-000000000002',
  chain_slug: 'burger-king-es',
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
  source_id: 'fd000000-0022-4000-a000-000000000003',
  source_name: 'Burger King Spain Official',
  source_type: 'official',
  source_url: null,
};

/** Full food nutrient row — same shape as Level 1 FoodQueryRow. */
const MOCK_FOOD_NUTRIENT_ROW = {
  food_id: 'fd000000-0022-4000-a000-000000000010',
  food_name: 'Carne de Ternera Picada',
  food_name_es: 'Carne de Ternera Picada',
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
  source_id: 'fd000000-0022-4000-a000-000000000011',
  source_name: 'BEDCA',
  source_type: 'official',
  source_url: 'https://bedca.net',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('level3Lookup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: OpenAI returns a valid embedding
    mockCallOpenAIEmbeddings.mockResolvedValue([MOCK_EMBEDDING]);
  });

  // -------------------------------------------------------------------------
  // OpenAI key absent — graceful skip
  // -------------------------------------------------------------------------

  it('returns null immediately when openAiApiKey is undefined (no DB calls)', async () => {
    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'hamburguesa', {
      openAiApiKey: undefined,
    });

    expect(result).toBeNull();
    expect(mockCallOpenAIEmbeddings).not.toHaveBeenCalled();
    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // OpenAI call failure — graceful skip
  // -------------------------------------------------------------------------

  it('returns null when OpenAI throws (graceful skip — no 500)', async () => {
    mockCallOpenAIEmbeddings.mockRejectedValueOnce(new Error('OpenAI network error'));

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'hamburguesa', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).toBeNull();
    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });

  it('returns null when OpenAI returns 401 unauthorized (graceful skip)', async () => {
    const authError = Object.assign(new Error('Unauthorized'), { status: 401 });
    mockCallOpenAIEmbeddings.mockRejectedValueOnce(authError);

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'hamburguesa', {
      openAiApiKey: 'sk-invalid-key',
    });

    expect(result).toBeNull();
  });

  it('returns null when OpenAI returns an empty embeddings array (defensive guard)', async () => {
    // Guard: embeddings[0] inside the try-catch avoids uncaught TypeError
    mockCallOpenAIEmbeddings.mockResolvedValueOnce([]);

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'hamburguesa', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).toBeNull();
    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Strategy 1 — dish similarity hit
  // -------------------------------------------------------------------------

  it('strategy 1 (dish similarity) returns matchType=similarity_dish on hit', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [MOCK_DISH_SIMILARITY_ROW] }) // similarity search
      .mockResolvedValueOnce({ rows: [MOCK_DISH_NUTRIENT_ROW] });  // nutrient fetch

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'hamburguesa clásica', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.matchType).toBe('similarity_dish');
  });

  it('strategy 1 sets confidenceLevel=low and estimationMethod=extrapolation', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [MOCK_DISH_SIMILARITY_ROW] })
      .mockResolvedValueOnce({ rows: [MOCK_DISH_NUTRIENT_ROW] });

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'hamburguesa', { openAiApiKey: 'sk-test-key' });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.result.confidenceLevel).toBe('low');
    expect(result.result.estimationMethod).toBe('extrapolation');
  });

  it('strategy 1 returns the similarityDistance from the search row', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [MOCK_DISH_SIMILARITY_ROW] })
      .mockResolvedValueOnce({ rows: [MOCK_DISH_NUTRIENT_ROW] });

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'hamburguesa', { openAiApiKey: 'sk-test-key' });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.similarityDistance).toBeCloseTo(0.18, 5);
  });

  it('strategy 1 maps nutrients from the matched dish nutrient row', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [MOCK_DISH_SIMILARITY_ROW] })
      .mockResolvedValueOnce({ rows: [MOCK_DISH_NUTRIENT_ROW] });

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'hamburguesa', { openAiApiKey: 'sk-test-key' });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.result.nutrients.calories).toBe(520);
    expect(result.result.nutrients.proteins).toBe(28);
    expect(result.result.nutrients.referenceBasis).toBe('per_serving');
  });

  it('strategy 1 sets entityType=dish from the matched dish row', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [MOCK_DISH_SIMILARITY_ROW] })
      .mockResolvedValueOnce({ rows: [MOCK_DISH_NUTRIENT_ROW] });

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'hamburguesa', { openAiApiKey: 'sk-test-key' });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.result.entityType).toBe('dish');
    expect(result.result.entityId).toBe(MOCK_DISH_NUTRIENT_ROW.dish_id);
  });

  it('strategy 1 short-circuits: does not call food strategy when dish matches', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [MOCK_DISH_SIMILARITY_ROW] })
      .mockResolvedValueOnce({ rows: [MOCK_DISH_NUTRIENT_ROW] });

    const db = buildMockDb() as never;
    await level3Lookup(db, 'hamburguesa', { openAiApiKey: 'sk-test-key' });

    // 2 calls: similarity search + nutrient fetch. No 3rd call for food strategy.
    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Strategy 1 — dish above threshold → fall through to strategy 2
  // -------------------------------------------------------------------------

  it('strategy 1 falls through when dish distance >= threshold (default 0.5)', async () => {
    const aboveThresholdRow = { ...MOCK_DISH_SIMILARITY_ROW, distance: '0.6' };
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [aboveThresholdRow] }) // dish: above threshold
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_SIMILARITY_ROW] }) // food: within threshold
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_NUTRIENT_ROW] }); // food nutrient fetch

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'hamburguesa', { openAiApiKey: 'sk-test-key' });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.matchType).toBe('similarity_food');
  });

  it('strategy 1 falls through when dish search returns no rows', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] }) // dish: no rows
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_SIMILARITY_ROW] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_NUTRIENT_ROW] });

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'hamburguesa', { openAiApiKey: 'sk-test-key' });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.matchType).toBe('similarity_food');
  });

  // -------------------------------------------------------------------------
  // Strategy 2 — food similarity hit
  // -------------------------------------------------------------------------

  it('strategy 2 (food similarity) returns matchType=similarity_food on hit', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })                         // dish: miss
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_SIMILARITY_ROW] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_NUTRIENT_ROW] });

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'ternera picada', { openAiApiKey: 'sk-test-key' });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.matchType).toBe('similarity_food');
    expect(result.result.entityType).toBe('food');
  });

  it('strategy 2 maps food nutrients correctly (referenceBasis from food row)', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_SIMILARITY_ROW] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_NUTRIENT_ROW] });

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'ternera', { openAiApiKey: 'sk-test-key' });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.result.nutrients.calories).toBe(250);
    expect(result.result.nutrients.referenceBasis).toBe('per_100g');
  });

  it('strategy 2 returns food similarityDistance', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_SIMILARITY_ROW] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_NUTRIENT_ROW] });

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'ternera', { openAiApiKey: 'sk-test-key' });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.similarityDistance).toBeCloseTo(0.25, 5);
  });

  // -------------------------------------------------------------------------
  // Total miss — both strategies above threshold / no rows
  // -------------------------------------------------------------------------

  it('returns null when both strategies find no rows within threshold', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] }) // dish: no rows
      .mockResolvedValueOnce({ rows: [] }); // food: no rows

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'completely unknown', { openAiApiKey: 'sk-test-key' });

    expect(result).toBeNull();
  });

  it('returns null when both strategies return rows but all above default threshold 0.5', async () => {
    const dishAbove = { ...MOCK_DISH_SIMILARITY_ROW, distance: '0.7' };
    const foodAbove = { ...MOCK_FOOD_SIMILARITY_ROW, distance: '0.8' };
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [dishAbove] })
      .mockResolvedValueOnce({ rows: [foodAbove] });

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'unknown dish', { openAiApiKey: 'sk-test-key' });

    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Threshold boundary — strictly less than (distance < threshold)
  // -------------------------------------------------------------------------

  it('distance exactly equal to threshold (0.5) is rejected (strict <)', async () => {
    const atThreshold = { ...MOCK_DISH_SIMILARITY_ROW, distance: '0.5' };
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [atThreshold] })
      .mockResolvedValueOnce({ rows: [] }); // food also misses

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'hamburguesa', { openAiApiKey: 'sk-test-key' });

    expect(result).toBeNull();
  });

  it('distance just below threshold (0.499) is accepted', async () => {
    const justBelow = { ...MOCK_DISH_SIMILARITY_ROW, distance: '0.499' };
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [justBelow] })
      .mockResolvedValueOnce({ rows: [MOCK_DISH_NUTRIENT_ROW] });

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'hamburguesa', { openAiApiKey: 'sk-test-key' });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.similarityDistance).toBeCloseTo(0.499, 3);
  });

  // -------------------------------------------------------------------------
  // Custom threshold override
  // -------------------------------------------------------------------------

  it('respects custom threshold passed in options', async () => {
    const distanceRow = { ...MOCK_DISH_SIMILARITY_ROW, distance: '0.3' };
    // With threshold=0.2, 0.3 > 0.2 should be rejected
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [distanceRow] })
      .mockResolvedValueOnce({ rows: [] }); // food also above threshold

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'hamburguesa', {
      openAiApiKey: 'sk-test-key',
      threshold: 0.2,
    });

    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Dish nutrient fetch returns no rows — fall through to food
  // -------------------------------------------------------------------------

  it('dish nutrient fetch returns no rows → falls through to food strategy', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [MOCK_DISH_SIMILARITY_ROW] }) // dish found in similarity
      .mockResolvedValueOnce({ rows: [] })                         // nutrient fetch: no rows
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_SIMILARITY_ROW] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_NUTRIENT_ROW] });

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'hamburguesa', { openAiApiKey: 'sk-test-key' });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.matchType).toBe('similarity_food');
  });

  // -------------------------------------------------------------------------
  // Scoping — chainSlug and restaurantId passed to dish strategy
  // -------------------------------------------------------------------------

  it('dish strategy uses chainSlug scope (verified by successful hit with scope)', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [MOCK_DISH_SIMILARITY_ROW] })
      .mockResolvedValueOnce({ rows: [MOCK_DISH_NUTRIENT_ROW] });

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'hamburguesa', {
      openAiApiKey: 'sk-test-key',
      chainSlug: 'burger-king-es',
    });

    expect(result).not.toBeNull();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
  });

  it('dish strategy uses restaurantId scope (verified by successful hit with scope)', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [MOCK_DISH_SIMILARITY_ROW] })
      .mockResolvedValueOnce({ rows: [MOCK_DISH_NUTRIENT_ROW] });

    const db = buildMockDb() as never;
    const result = await level3Lookup(db, 'hamburguesa', {
      openAiApiKey: 'sk-test-key',
      restaurantId: 'fd000000-0022-4000-a000-000000000002',
    });

    expect(result).not.toBeNull();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // DB error during similarity search — throw DB_UNAVAILABLE
  // -------------------------------------------------------------------------

  it('throws DB_UNAVAILABLE when dish similarity query throws', async () => {
    mockExecuteQuery.mockRejectedValueOnce(new Error('connection refused'));

    const db = buildMockDb() as never;

    await expect(
      level3Lookup(db, 'hamburguesa', { openAiApiKey: 'sk-test-key' }),
    ).rejects.toMatchObject({ code: 'DB_UNAVAILABLE' });
  });

  it('throws DB_UNAVAILABLE when food similarity query throws (dish misses)', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })             // dish: no rows
      .mockRejectedValueOnce(new Error('timeout'));    // food: DB error

    const db = buildMockDb() as never;

    await expect(
      level3Lookup(db, 'hamburguesa', { openAiApiKey: 'sk-test-key' }),
    ).rejects.toMatchObject({ code: 'DB_UNAVAILABLE' });
  });
});
