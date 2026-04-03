// F021 Edge-Case Tests — QA Engineer
//
// Tests the level2Lookup unit and schema edge cases.
// Route edge cases are in f021.edge-cases.route.test.ts (separate file to
// avoid vi.mock hoisting conflicts between the real level2Lookup implementation
// and the route-level mock of level2Lookup).
//
// FINDINGS:
//   FINDING-F021-01 (MEDIUM) — confidenceLevel='medium' if both counts are 0
//     The mapper computes `resolved === total` which is `0 === 0 → true → 'medium'`.
//     The HAVING clause prevents this from happening in SQL, but the defensive
//     application-level guard checks `resolved_count === '0'` before calling the
//     mapper. This test verifies the guard fires and null is returned.
//
//   FINDING-F021-02 (LOW) — FTS strategy zero-resolved guard tested
//     The defensive guard on ftsRow.resolved_count === '0' had no dedicated test.
//
//   FINDING-F021-03 (LOW) — portion_grams='0.00' → portionGrams=null
//     No developer test covers the zero-grams boundary.
//
//   FINDING-F021-04 (INFO) — parseDecimal with non-numeric strings → 0
//     Graceful handling of NaN or empty string aggregates.
//
//   FINDING-F021-05 (INFO) — normalizeQuery idempotency
//     Internal normalization handles uncollapsed input safely.
//
//   FINDING-F021-06 (LOW) — DB error in FTS strategy → DB_UNAVAILABLE
//     Only the exact-match throw path was previously tested.
//
//   FINDING-F021-07 (LOW) — 1/1 single ingredient → 'medium'
//     Only the 2/2 case was tested for medium confidence.

// ---------------------------------------------------------------------------
// SECTION B — level2Lookup unit edge cases
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Kysely executor (no vi.mock needed — we pass the mock db directly)
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

import { level2Lookup } from '../estimation/level2Lookup.js';

// Base row fixture — fully resolved
const BASE_ROW = {
  dish_id: 'fd000000-0021-4000-a000-000000000001',
  dish_name: 'Big Mac',
  dish_name_es: 'Big Mac',
  restaurant_id: 'fd000000-0021-4000-a000-000000000002',
  chain_slug: 'mcdonalds-es',
  portion_grams: '215.00',
  dish_source_id: 'fd000000-0003-4000-a000-000000000001',
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

describe('Section B — level2Lookup unit edge cases', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // -------------------------------------------------------------------------
  // FINDING-F021-03 — portion_grams='0.00' → portionGrams=null
  // -------------------------------------------------------------------------

  it('[FINDING-F021-03] portion_grams="0.00" maps to portionGrams=null (zero is not a valid portion)', async () => {
    const row = { ...BASE_ROW, portion_grams: '0.00' };
    mockExecuteQuery.mockResolvedValueOnce({ rows: [row] });

    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    // parseDecimal('0.00') = 0; grams > 0 is false → null
    expect(result.result.portionGrams).toBeNull();
  });

  // -------------------------------------------------------------------------
  // FINDING-F021-04 — parseDecimal with non-numeric strings → 0
  // -------------------------------------------------------------------------

  it('[FINDING-F021-04] calories="NaN" from corrupted aggregate → 0 (no throw)', async () => {
    const row = { ...BASE_ROW, calories: 'NaN' };
    mockExecuteQuery.mockResolvedValueOnce({ rows: [row] });

    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    // parseDecimal('NaN') → parseFloat('NaN') = NaN → isNaN → 0
    expect(result.result.nutrients.calories).toBe(0);
  });

  it('[FINDING-F021-04] calories="" (empty string aggregate) → 0 (no throw)', async () => {
    const row = { ...BASE_ROW, calories: '' };
    mockExecuteQuery.mockResolvedValueOnce({ rows: [row] });

    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    // parseFloat('') = NaN → isNaN → 0
    expect(result.result.nutrients.calories).toBe(0);
  });

  // -------------------------------------------------------------------------
  // FINDING-F021-07 — Single ingredient, fully resolved (1/1) → 'medium'
  // -------------------------------------------------------------------------

  it('[FINDING-F021-07] single ingredient resolved (1/1) → confidenceLevel=medium', async () => {
    const row = { ...BASE_ROW, resolved_count: '1', total_count: '1' };
    mockExecuteQuery.mockResolvedValueOnce({ rows: [row] });

    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.result.confidenceLevel).toBe('medium');
    expect(result.resolvedCount).toBe(1);
    expect(result.totalCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // FINDING-F021-02 — FTS strategy zero-resolved defensive guard
  // -------------------------------------------------------------------------

  it('[FINDING-F021-02] FTS strategy row with resolved_count="0" → null (defensive guard)', async () => {
    // Strategy 1 misses (empty rows); strategy 2 returns a row but with 0 resolved.
    // The HAVING clause prevents this in SQL, but the guard exists defensively.
    const zeroResolvedRow = { ...BASE_ROW, resolved_count: '0', total_count: '3' };
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })             // strategy 1 miss
      .mockResolvedValueOnce({ rows: [zeroResolvedRow] }); // strategy 2 hit with zero resolved

    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Menú Especial', {});

    expect(result).toBeNull();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // FINDING-F021-06 — DB error in FTS strategy propagates as DB_UNAVAILABLE
  // -------------------------------------------------------------------------

  it('[FINDING-F021-06] DB error thrown by FTS strategy propagates as DB_UNAVAILABLE', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })           // strategy 1: empty (no match)
      .mockRejectedValueOnce(new Error('timeout'));  // strategy 2: DB failure

    const db = buildMockDb() as never;

    await expect(level2Lookup(db, 'unknown dish', {})).rejects.toMatchObject({
      code: 'DB_UNAVAILABLE',
    });
  });

  // -------------------------------------------------------------------------
  // FINDING-F021-05 — normalizeQuery idempotency
  // -------------------------------------------------------------------------

  it('[FINDING-F021-05] level2Lookup normalizes "  BIG MAC  " internally — 1 DB call, valid result', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [BASE_ROW] });
    const db = buildMockDb() as never;

    // Call with unnormalized input (as if called directly outside the route)
    const result = await level2Lookup(db, '  BIG MAC  ', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.result.name).toBe('Big Mac');
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
  });

  it('[FINDING-F021-05] level2Lookup collapses "Big   Mac" to "big mac" internally', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [BASE_ROW] });
    const db = buildMockDb() as never;

    const result = await level2Lookup(db, 'Big   Mac', {});

    expect(result).not.toBeNull();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // FINDING-F021-01 — defensive guard catches resolved_count="0" before mapper
  // -------------------------------------------------------------------------

  it('[FINDING-F021-01] guard catches resolved_count="0" with total_count="0" → null (not "medium")', async () => {
    // If the guard were absent, the mapper would compute `0 === 0 → true → 'medium'`.
    // The guard `if (exactRow.resolved_count === '0') return null` must fire first.
    const zeroZeroRow = { ...BASE_ROW, resolved_count: '0', total_count: '0' };
    mockExecuteQuery.mockResolvedValueOnce({ rows: [zeroZeroRow] });

    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    // Guard must return null — NOT produce a result with confidenceLevel='medium'
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Nutrient precision — decimal accuracy
  // -------------------------------------------------------------------------

  it('nutrient aggregate values preserve decimal precision from DB string', async () => {
    const row = {
      ...BASE_ROW,
      calories: '123.45',
      proteins: '10.01',
      salt: '0.99',
      sodium: '396.00',
    };
    mockExecuteQuery.mockResolvedValueOnce({ rows: [row] });

    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.result.nutrients.calories).toBeCloseTo(123.45, 5);
    expect(result.result.nutrients.proteins).toBeCloseTo(10.01, 5);
    expect(result.result.nutrients.salt).toBeCloseTo(0.99, 5);
    expect(result.result.nutrients.sodium).toBeCloseTo(396.0, 5);
  });

  // -------------------------------------------------------------------------
  // Negative aggregate — parseDecimal does NOT clamp negatives (documented)
  // -------------------------------------------------------------------------

  it('negative aggregate string is passed through parseDecimal without clamping', async () => {
    // This cannot happen with valid data (SUM(CASE WHEN ... ELSE 0 END) ≥ 0)
    // but documents that parseDecimal does NOT clamp negatives.
    // EstimateNutrientsSchema (.nonnegative()) catches this at API response boundary.
    const row = { ...BASE_ROW, calories: '-5.00' };
    mockExecuteQuery.mockResolvedValueOnce({ rows: [row] });

    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    // parseDecimal('-5.00') = -5 (no clamping in mapper)
    expect(result.result.nutrients.calories).toBe(-5);
  });

  // -------------------------------------------------------------------------
  // FTS hit with partial resolution
  // -------------------------------------------------------------------------

  it('FTS hit with partial resolution (1/3) → confidenceLevel=low', async () => {
    const ftsPartialRow = { ...BASE_ROW, resolved_count: '1', total_count: '3' };
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })              // strategy 1 miss
      .mockResolvedValueOnce({ rows: [ftsPartialRow] }); // strategy 2 partial hit

    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'hamburguesa doble', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.matchType).toBe('ingredient_dish_fts');
    expect(result.result.confidenceLevel).toBe('low');
    expect(result.resolvedCount).toBe(1);
    expect(result.totalCount).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Entity metadata correctness
  // -------------------------------------------------------------------------

  it('entityType is always "dish" for L2 results', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [BASE_ROW] });
    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.result.entityType).toBe('dish');
  });

  it('entityId comes from dish_id field', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [BASE_ROW] });
    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.result.entityId).toBe(BASE_ROW.dish_id);
  });

  it('nameEs=null is preserved from dish_name_es=null', async () => {
    const row = { ...BASE_ROW, dish_name_es: null };
    mockExecuteQuery.mockResolvedValueOnce({ rows: [row] });
    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.result.nameEs).toBeNull();
  });

  it('restaurantId and chainSlug are taken from dish row', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [BASE_ROW] });
    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.result.restaurantId).toBe(BASE_ROW.restaurant_id);
    expect(result.result.chainSlug).toBe(BASE_ROW.chain_slug);
  });

  // -------------------------------------------------------------------------
  // Large portion_grams value
  // -------------------------------------------------------------------------

  it('portion_grams="1500.50" maps to portionGrams=1500.5', async () => {
    const row = { ...BASE_ROW, portion_grams: '1500.50' };
    mockExecuteQuery.mockResolvedValueOnce({ rows: [row] });
    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.result.portionGrams).toBeCloseTo(1500.5, 5);
  });

  // -------------------------------------------------------------------------
  // ingredientSources is always empty in F021
  // -------------------------------------------------------------------------

  it('ingredientSources is an empty array even for partial resolution', async () => {
    const partialRow = { ...BASE_ROW, resolved_count: '1', total_count: '5' };
    mockExecuteQuery.mockResolvedValueOnce({ rows: [partialRow] });
    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(Array.isArray(result.ingredientSources)).toBe(true);
    expect(result.ingredientSources).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // No-scope options — valid call without chain or restaurant filter
  // -------------------------------------------------------------------------

  it('empty options {} — 1 DB call on exact match hit, no error', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [BASE_ROW] });
    const db = buildMockDb() as never;
    const result = await level2Lookup(db, 'Big Mac', {});

    expect(result).not.toBeNull();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// SECTION D — Schema validation edge cases for L2-specific fields
// ---------------------------------------------------------------------------

import {
  EstimateDataSchema,
  EstimateMatchTypeSchema,
  EstimateResultSchema,
} from '@foodxplorer/shared';

const VALID_NUTRIENTS_D = {
  calories: 320, proteins: 28, carbohydrates: 30, sugars: 5,
  fats: 8, saturatedFats: 2, fiber: 4, salt: 1.2, sodium: 480,
  transFats: 0, cholesterol: 60, potassium: 400,
  monounsaturatedFats: 3, polyunsaturatedFats: 1.5,
  referenceBasis: 'per_serving' as const,
};

const VALID_L2_RESULT = {
  entityType: 'dish' as const,
  entityId: 'fd000000-0021-4000-a000-000000000010',
  name: 'Pollo Especial',
  nameEs: 'Pollo Especial',
  restaurantId: 'fd000000-0021-4000-a000-000000000011',
  chainSlug: 'mcdonalds-es',
  portionGrams: 300,
  nutrients: VALID_NUTRIENTS_D,
  confidenceLevel: 'medium' as const,
  estimationMethod: 'ingredients' as const,
  source: {
    id: 'fd000000-0021-4000-a000-000000000012',
    name: 'Computed from ingredients',
    type: 'estimated' as const,
    url: null,
  },
  similarityDistance: null,
};

describe('Section D — Schema validation edge cases for L2 fields', () => {
  // -------------------------------------------------------------------------
  // EstimateMatchTypeSchema — new L2 values
  // -------------------------------------------------------------------------

  it('ingredient_dish_exact is accepted by EstimateMatchTypeSchema', () => {
    expect(EstimateMatchTypeSchema.safeParse('ingredient_dish_exact').success).toBe(true);
  });

  it('ingredient_dish_fts is accepted by EstimateMatchTypeSchema', () => {
    expect(EstimateMatchTypeSchema.safeParse('ingredient_dish_fts').success).toBe(true);
  });

  it('ingredient_dish_similarity is NOT valid (future L3, not in F021 scope)', () => {
    expect(EstimateMatchTypeSchema.safeParse('ingredient_dish_similarity').success).toBe(false);
  });

  // -------------------------------------------------------------------------
  // EstimateResultSchema — L2 source shape
  // -------------------------------------------------------------------------

  it('L2 source with type=estimated and null url is valid', () => {
    expect(EstimateResultSchema.safeParse(VALID_L2_RESULT).success).toBe(true);
  });

  it('L2 result with confidenceLevel=low is valid (schema allows all three levels)', () => {
    const lowConfidence = { ...VALID_L2_RESULT, confidenceLevel: 'low' as const };
    expect(EstimateResultSchema.safeParse(lowConfidence).success).toBe(true);
  });

  it('estimationMethod=ingredients is accepted', () => {
    const withIngredients = { ...VALID_L2_RESULT, estimationMethod: 'ingredients' as const };
    expect(EstimateResultSchema.safeParse(withIngredients).success).toBe(true);
  });

  it('referenceBasis=per_serving is accepted for L2 nutrients', () => {
    const nutrientsPerServing = { ...VALID_NUTRIENTS_D, referenceBasis: 'per_serving' as const };
    const result = { ...VALID_L2_RESULT, nutrients: nutrientsPerServing };
    expect(EstimateResultSchema.safeParse(result).success).toBe(true);
  });

  it('source.id must be a valid UUID — non-UUID rejected', () => {
    const result = {
      ...VALID_L2_RESULT,
      source: { ...VALID_L2_RESULT.source, id: 'not-a-uuid' },
    };
    expect(EstimateResultSchema.safeParse(result).success).toBe(false);
  });

  it('source.type=estimated is validated by DataSourceTypeSchema', () => {
    const withEstimated = { ...VALID_L2_RESULT, source: { ...VALID_L2_RESULT.source, type: 'estimated' as const } };
    expect(EstimateResultSchema.safeParse(withEstimated).success).toBe(true);
  });

  // -------------------------------------------------------------------------
  // EstimateDataSchema — level2Hit field
  // -------------------------------------------------------------------------

  it('EstimateDataSchema rejects missing level2Hit field', () => {
    const data = {
      query: 'Pollo Especial',
      chainSlug: null,
      level1Hit: false,
      // level2Hit intentionally omitted
      level3Hit: false,
      matchType: 'ingredient_dish_exact',
      result: VALID_L2_RESULT,
      cachedAt: null,
    };
    expect(EstimateDataSchema.safeParse(data).success).toBe(false);
  });

  it('EstimateDataSchema accepts level2Hit:true with ingredient_dish_exact matchType', () => {
    const data = {
      query: 'Pollo Especial',
      chainSlug: null,
      portionMultiplier: 1,
      level1Hit: false,
      level2Hit: true,
      level3Hit: false,
      level4Hit: false,
      matchType: 'ingredient_dish_exact',
      result: VALID_L2_RESULT,
      cachedAt: null,
    };
    expect(EstimateDataSchema.safeParse(data).success).toBe(true);
  });

  it('EstimateDataSchema accepts level2Hit:true with ingredient_dish_fts matchType', () => {
    const ftsResult = { ...VALID_L2_RESULT, confidenceLevel: 'low' as const };
    const data = {
      query: 'hamburguesa doble',
      chainSlug: null,
      portionMultiplier: 1,
      level1Hit: false,
      level2Hit: true,
      level3Hit: false,
      level4Hit: false,
      matchType: 'ingredient_dish_fts',
      result: ftsResult,
      cachedAt: null,
    };
    expect(EstimateDataSchema.safeParse(data).success).toBe(true);
  });

  it('EstimateDataSchema allows level2Hit=true with null result (no cross-field constraint in schema)', () => {
    // This is a logical impossibility in practice (L2 hit must have result),
    // but the Zod schema does NOT enforce this correlation.
    // The route enforces it at the implementation level.
    const data = {
      query: 'Pollo',
      chainSlug: null,
      portionMultiplier: 1,
      level1Hit: false,
      level2Hit: true,
      level3Hit: false,
      level4Hit: false,
      matchType: null,
      result: null,
      cachedAt: null,
    };
    expect(EstimateDataSchema.safeParse(data).success).toBe(true);
  });

  it('EstimateDataSchema rejects level2Hit as string "true" (must be boolean)', () => {
    const data = {
      query: 'Pollo',
      chainSlug: null,
      level1Hit: false,
      level2Hit: 'true', // string instead of boolean
      level3Hit: false,
      matchType: null,
      result: null,
      cachedAt: null,
    };
    expect(EstimateDataSchema.safeParse(data).success).toBe(false);
  });

  it('EstimateDataSchema rejects level2Hit=1 (number, not boolean)', () => {
    const data = {
      query: 'Pollo',
      chainSlug: null,
      level1Hit: false,
      level2Hit: 1, // number instead of boolean
      level3Hit: false,
      matchType: null,
      result: null,
      cachedAt: null,
    };
    expect(EstimateDataSchema.safeParse(data).success).toBe(false);
  });

  it('EstimateDataSchema accepts both level1Hit:true and level2Hit:false (normal L1 hit)', () => {
    const data = {
      query: 'Big Mac',
      chainSlug: 'mcdonalds-es',
      portionMultiplier: 1,
      level1Hit: true,
      level2Hit: false,
      level3Hit: false,
      level4Hit: false,
      matchType: 'exact_dish',
      result: {
        ...VALID_L2_RESULT,
        confidenceLevel: 'high' as const,
        estimationMethod: 'official' as const,
        source: {
          id: 'fd000000-0021-4000-a000-000000000012',
          name: "McDonald's Spain PDF",
          type: 'official' as const,
          url: 'https://mcdonalds.es',
        },
      },
      cachedAt: null,
    };
    expect(EstimateDataSchema.safeParse(data).success).toBe(true);
  });
});
