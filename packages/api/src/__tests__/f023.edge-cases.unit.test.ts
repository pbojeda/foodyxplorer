// F023 Edge-Case Unit Tests — runEstimationCascade (QA Engineer)
//
// Covers gaps identified in f023.engineRouter.unit.test.ts.
// Mocks level1/2/3Lookup; imports the REAL runEstimationCascade.
//
// FINDINGS COVERED:
//   EDGE_CASE-F023-01 — L4 lookup receives normalized query (not raw)
//   EDGE_CASE-F023-02 — L4 lookup receives chainSlug, restaurantId and openAiApiKey
//   EDGE_CASE-F023-03 — L4 returns null → total miss (levelHit null, result null)
//   EDGE_CASE-F023-04 — data.query echoes raw query on L2 hit
//   EDGE_CASE-F023-05 — data.query echoes raw query on L3 hit
//   EDGE_CASE-F023-06 — data.query echoes raw query on L4 hit
//   EDGE_CASE-F023-07 — data.chainSlug is null when chainSlug not provided (L1 hit)
//   EDGE_CASE-F023-08 — data.chainSlug is null on total miss (no chainSlug)
//   EDGE_CASE-F023-09 — data.chainSlug is null on L4 hit (no chainSlug)
//   EDGE_CASE-F023-10 — DB error cause is preserved (all levels + L4)
//   EDGE_CASE-F023-11 — L2 lookup receives normalized query
//   EDGE_CASE-F023-12 — L3 lookup receives normalized query
//   EDGE_CASE-F023-13 — Unexpected non-DB error from L1 still re-throws wrapped

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import type { DB } from '../generated/kysely-types.js';

// ---------------------------------------------------------------------------
// Mock level1Lookup
// ---------------------------------------------------------------------------

const { mockLevel1Lookup } = vi.hoisted(() => ({ mockLevel1Lookup: vi.fn() }));
vi.mock('../estimation/level1Lookup.js', () => ({ level1Lookup: mockLevel1Lookup }));

// ---------------------------------------------------------------------------
// Mock level2Lookup
// ---------------------------------------------------------------------------

const { mockLevel2Lookup } = vi.hoisted(() => ({ mockLevel2Lookup: vi.fn() }));
vi.mock('../estimation/level2Lookup.js', () => ({ level2Lookup: mockLevel2Lookup }));

// ---------------------------------------------------------------------------
// Mock level3Lookup
// ---------------------------------------------------------------------------

const { mockLevel3Lookup } = vi.hoisted(() => ({ mockLevel3Lookup: vi.fn() }));
vi.mock('../estimation/level3Lookup.js', () => ({ level3Lookup: mockLevel3Lookup }));

// Import the REAL runEstimationCascade after all vi.mock calls.
import { runEstimationCascade } from '../estimation/engineRouter.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_DB = {} as Kysely<DB>;

const BASE_ENTITY = {
  entityType: 'dish' as const,
  entityId: 'fd000000-0023-4000-a000-000000000001',
  name: 'Big Mac',
  nameEs: 'Big Mac',
  restaurantId: 'fd000000-0023-4000-a000-000000000002',
  chainSlug: 'mcdonalds-es',
  portionGrams: 215,
  nutrients: {
    calories: 520, proteins: 28, carbohydrates: 42, sugars: 8,
    fats: 24, saturatedFats: 9, fiber: 3, salt: 2.1, sodium: 840,
    transFats: 0.3, cholesterol: 75, potassium: 300,
    monounsaturatedFats: 10, polyunsaturatedFats: 3,
    referenceBasis: 'per_serving' as const,
  },
  confidenceLevel: 'high' as const,
  estimationMethod: 'official' as const,
  source: {
    id: 'fd000000-0023-4000-a000-000000000003',
    name: "McDonald's Spain Official PDF",
    type: 'official' as const,
    url: 'https://www.mcdonalds.es/nutritional.pdf',
  },
  similarityDistance: null,
};

const MOCK_L1_RESULT = { matchType: 'exact_dish' as const, result: BASE_ENTITY };
const MOCK_L2_RESULT = {
  matchType: 'ingredient_dish_exact' as const,
  resolvedCount: 2, totalCount: 2, ingredientSources: [],
  result: { ...BASE_ENTITY, entityId: 'fd000000-0023-4000-a000-000000000010', confidenceLevel: 'medium' as const, estimationMethod: 'ingredients' as const },
};
const MOCK_L3_RESULT = {
  matchType: 'similarity_dish' as const, similarityDistance: 0.18,
  result: { ...BASE_ENTITY, entityId: 'fd000000-0023-4000-a000-000000000020', confidenceLevel: 'low' as const, estimationMethod: 'extrapolation' as const, similarityDistance: 0.18 },
};
const MOCK_L4_RESULT = {
  matchType: 'exact_dish' as const,
  result: { ...BASE_ENTITY, entityId: 'fd000000-0023-4000-a000-000000000040' },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runEstimationCascade — edge cases (F023)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: all levels miss
    mockLevel1Lookup.mockResolvedValue(null);
    mockLevel2Lookup.mockResolvedValue(null);
    mockLevel3Lookup.mockResolvedValue(null);
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-01: L4 receives normalized query (not raw)
  // -------------------------------------------------------------------------

  it('EDGE_CASE-01: L4 lookup receives normalized query (lowercase, collapsed whitespace)', async () => {
    const mockLevel4Lookup = vi.fn().mockResolvedValueOnce(MOCK_L4_RESULT);

    await runEstimationCascade({
      db: MOCK_DB,
      query: '  Big  Mac  ',
      chainSlug: 'mcdonalds-es',
      level4Lookup: mockLevel4Lookup,
    });

    // L4 must receive the same normalized form as L1/L2/L3 (lowercase, collapsed spaces, trimmed)
    expect(mockLevel4Lookup).toHaveBeenCalledWith(
      MOCK_DB,
      'big mac',
      expect.any(Object),
    );
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-02: L4 receives chainSlug, restaurantId, openAiApiKey
  // -------------------------------------------------------------------------

  it('EDGE_CASE-02: L4 lookup receives chainSlug, restaurantId and openAiApiKey in options', async () => {
    const mockLevel4Lookup = vi.fn().mockResolvedValueOnce(null);

    await runEstimationCascade({
      db: MOCK_DB,
      query: 'test dish',
      chainSlug: 'mcdonalds-es',
      restaurantId: 'fd000000-0023-4000-a000-000000000002',
      openAiApiKey: 'sk-test-key',
      level4Lookup: mockLevel4Lookup,
    });

    expect(mockLevel4Lookup).toHaveBeenCalledWith(
      MOCK_DB,
      'test dish',
      expect.objectContaining({
        chainSlug: 'mcdonalds-es',
        restaurantId: 'fd000000-0023-4000-a000-000000000002',
        openAiApiKey: 'sk-test-key',
      }),
    );
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-03: L4 returns null → total miss (levelHit null, result null)
  // -------------------------------------------------------------------------

  it('EDGE_CASE-03: L4 lookup returns null → total miss (levelHit:null, result:null)', async () => {
    const mockLevel4Lookup = vi.fn().mockResolvedValueOnce(null);

    const result = await runEstimationCascade({
      db: MOCK_DB,
      query: 'something',
      level4Lookup: mockLevel4Lookup,
    });

    expect(mockLevel4Lookup).toHaveBeenCalledOnce();
    expect(result.levelHit).toBeNull();
    expect(result.data.result).toBeNull();
    expect(result.data.level1Hit).toBe(false);
    expect(result.data.level2Hit).toBe(false);
    expect(result.data.level3Hit).toBe(false);
    expect(result.data.matchType).toBeNull();
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-04: data.query echoes raw query on L2 hit
  // -------------------------------------------------------------------------

  it('EDGE_CASE-04: L2 hit → data.query echoes raw query (not normalized)', async () => {
    mockLevel2Lookup.mockResolvedValueOnce(MOCK_L2_RESULT);

    const result = await runEstimationCascade({
      db: MOCK_DB,
      query: '  Pollo  con  Verduras  ',
    });

    expect(result.levelHit).toBe(2);
    expect(result.data.query).toBe('  Pollo  con  Verduras  ');
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-05: data.query echoes raw query on L3 hit
  // -------------------------------------------------------------------------

  it('EDGE_CASE-05: L3 hit → data.query echoes raw query (not normalized)', async () => {
    mockLevel3Lookup.mockResolvedValueOnce(MOCK_L3_RESULT);

    const result = await runEstimationCascade({
      db: MOCK_DB,
      query: '  Hamburguesa  ',
      openAiApiKey: 'test-key',
    });

    expect(result.levelHit).toBe(3);
    expect(result.data.query).toBe('  Hamburguesa  ');
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-06: data.query echoes raw query on L4 hit
  // -------------------------------------------------------------------------

  it('EDGE_CASE-06: L4 hit → data.query echoes raw query (not normalized)', async () => {
    const mockLevel4Lookup = vi.fn().mockResolvedValueOnce(MOCK_L4_RESULT);

    const result = await runEstimationCascade({
      db: MOCK_DB,
      query: '  Big  Mac  ',
      level4Lookup: mockLevel4Lookup,
    });

    expect(result.levelHit).toBe(4);
    expect(result.data.query).toBe('  Big  Mac  ');
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-07: data.chainSlug is null when chainSlug not provided (L1 hit)
  // -------------------------------------------------------------------------

  it('EDGE_CASE-07: L1 hit without chainSlug → data.chainSlug is null', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_L1_RESULT);

    const result = await runEstimationCascade({
      db: MOCK_DB,
      query: 'Big Mac',
      // chainSlug intentionally omitted
    });

    expect(result.levelHit).toBe(1);
    expect(result.data.chainSlug).toBeNull();
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-08: data.chainSlug is null on total miss (no chainSlug)
  // -------------------------------------------------------------------------

  it('EDGE_CASE-08: total miss without chainSlug → data.chainSlug is null', async () => {
    const result = await runEstimationCascade({
      db: MOCK_DB,
      query: 'unknown',
      // chainSlug intentionally omitted
    });

    expect(result.levelHit).toBeNull();
    expect(result.data.chainSlug).toBeNull();
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-09: data.chainSlug is null on L4 hit (no chainSlug)
  // -------------------------------------------------------------------------

  it('EDGE_CASE-09: L4 hit without chainSlug → data.chainSlug is null', async () => {
    const mockLevel4Lookup = vi.fn().mockResolvedValueOnce(MOCK_L4_RESULT);

    const result = await runEstimationCascade({
      db: MOCK_DB,
      query: 'test',
      // chainSlug intentionally omitted
      level4Lookup: mockLevel4Lookup,
    });

    expect(result.levelHit).toBe(4);
    expect(result.data.chainSlug).toBeNull();
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-10: DB error cause is preserved (all levels + L4)
  // -------------------------------------------------------------------------

  it('EDGE_CASE-10a: DB error from L1 → thrown error has .cause with original error', async () => {
    const originalErr = new Error('Connection timeout');
    mockLevel1Lookup.mockRejectedValueOnce(originalErr);

    try {
      await runEstimationCascade({ db: MOCK_DB, query: 'test' });
      expect.fail('Expected error to be thrown');
    } catch (err) {
      expect(err).toBeDefined();
      expect((err as { cause?: unknown }).cause).toBe(originalErr);
    }
  });

  it('EDGE_CASE-10b: DB error from L2 → thrown error has .cause with original error', async () => {
    const originalErr = new Error('Pool exhausted');
    mockLevel2Lookup.mockRejectedValueOnce(originalErr);

    try {
      await runEstimationCascade({ db: MOCK_DB, query: 'test' });
      expect.fail('Expected error to be thrown');
    } catch (err) {
      expect(err).toBeDefined();
      expect((err as { cause?: unknown }).cause).toBe(originalErr);
    }
  });

  it('EDGE_CASE-10c: DB error from L3 → thrown error has .cause with original error', async () => {
    const originalErr = new Error('Query timeout');
    mockLevel3Lookup.mockRejectedValueOnce(originalErr);

    try {
      await runEstimationCascade({ db: MOCK_DB, query: 'test' });
      expect.fail('Expected error to be thrown');
    } catch (err) {
      expect(err).toBeDefined();
      expect((err as { cause?: unknown }).cause).toBe(originalErr);
    }
  });

  it('EDGE_CASE-10d: DB error from L4 → thrown error has .cause with original error', async () => {
    const originalErr = new Error('LLM service down');
    const mockLevel4Lookup = vi.fn().mockRejectedValueOnce(originalErr);

    try {
      await runEstimationCascade({ db: MOCK_DB, query: 'test', level4Lookup: mockLevel4Lookup });
      expect.fail('Expected error to be thrown');
    } catch (err) {
      expect(err).toBeDefined();
      expect((err as { cause?: unknown }).cause).toBe(originalErr);
    }
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-11: L2 lookup receives normalized query
  // -------------------------------------------------------------------------

  it('EDGE_CASE-11: L2 lookup receives normalized query (lowercase, collapsed whitespace)', async () => {
    mockLevel2Lookup.mockResolvedValueOnce(MOCK_L2_RESULT);

    await runEstimationCascade({
      db: MOCK_DB,
      query: '  Pollo  CON  Verduras  ',
      chainSlug: 'mcdonalds-es',
    });

    expect(mockLevel2Lookup).toHaveBeenCalledWith(
      MOCK_DB,
      'pollo con verduras',
      expect.objectContaining({ chainSlug: 'mcdonalds-es' }),
    );
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-12: L3 lookup receives normalized query
  // -------------------------------------------------------------------------

  it('EDGE_CASE-12: L3 lookup receives normalized query (lowercase, collapsed whitespace)', async () => {
    mockLevel3Lookup.mockResolvedValueOnce(MOCK_L3_RESULT);

    await runEstimationCascade({
      db: MOCK_DB,
      query: '  HAMBURGUESA  ',
      chainSlug: 'burger-king-es',
      openAiApiKey: 'sk-test',
    });

    expect(mockLevel3Lookup).toHaveBeenCalledWith(
      MOCK_DB,
      'hamburguesa',
      expect.objectContaining({ chainSlug: 'burger-king-es', openAiApiKey: 'sk-test' }),
    );
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE-F023-13: Unexpected non-DB error from L1 still re-throws wrapped
  // -------------------------------------------------------------------------

  it('EDGE_CASE-13: unexpected TypeError from L1 → re-thrown with statusCode:500 and code:DB_UNAVAILABLE', async () => {
    // A programming error inside lookup (e.g. null dereference) should still be caught and wrapped
    mockLevel1Lookup.mockRejectedValueOnce(new TypeError('Cannot read properties of null'));

    try {
      await runEstimationCascade({ db: MOCK_DB, query: 'test' });
      expect.fail('Expected error to be thrown');
    } catch (err) {
      expect(err).toBeDefined();
      expect((err as { statusCode?: number }).statusCode).toBe(500);
      expect((err as { code?: string }).code).toBe('DB_UNAVAILABLE');
    }
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE: L2 hit without chainSlug → data.chainSlug is null
  // -------------------------------------------------------------------------

  it('L2 hit without chainSlug → data.chainSlug is null', async () => {
    mockLevel2Lookup.mockResolvedValueOnce(MOCK_L2_RESULT);

    const result = await runEstimationCascade({
      db: MOCK_DB,
      query: 'pollo con verduras',
      // chainSlug intentionally omitted
    });

    expect(result.levelHit).toBe(2);
    expect(result.data.chainSlug).toBeNull();
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE: L3 hit without chainSlug → data.chainSlug is null
  // -------------------------------------------------------------------------

  it('L3 hit without chainSlug → data.chainSlug is null', async () => {
    mockLevel3Lookup.mockResolvedValueOnce(MOCK_L3_RESULT);

    const result = await runEstimationCascade({
      db: MOCK_DB,
      query: 'hamburguesa',
      openAiApiKey: 'sk-test',
      // chainSlug intentionally omitted
    });

    expect(result.levelHit).toBe(3);
    expect(result.data.chainSlug).toBeNull();
  });

  // -------------------------------------------------------------------------
  // EDGE_CASE: L1 lookup receives restaurantId in options
  // -------------------------------------------------------------------------

  it('L1 lookup receives restaurantId when provided', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_L1_RESULT);

    await runEstimationCascade({
      db: MOCK_DB,
      query: 'big mac',
      restaurantId: 'fd000000-0023-4000-a000-000000000002',
    });

    expect(mockLevel1Lookup).toHaveBeenCalledWith(
      MOCK_DB,
      'big mac',
      expect.objectContaining({ restaurantId: 'fd000000-0023-4000-a000-000000000002' }),
    );
  });
});
