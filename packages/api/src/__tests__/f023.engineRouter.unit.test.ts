// Unit tests for runEstimationCascade (F023)
//
// Tests the L1→L2→L3→L4 cascade logic in isolation.
// Mocks level1Lookup, level2Lookup, level3Lookup via vi.hoisted + vi.mock.
// No Fastify, no Redis, no real DB.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import type { DB } from '../generated/kysely-types.js';

// ---------------------------------------------------------------------------
// Mock level1Lookup
// ---------------------------------------------------------------------------

const { mockLevel1Lookup } = vi.hoisted(() => ({
  mockLevel1Lookup: vi.fn(),
}));

vi.mock('../estimation/level1Lookup.js', () => ({
  level1Lookup: mockLevel1Lookup,
  offFallbackFoodMatch: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock level2Lookup
// ---------------------------------------------------------------------------

const { mockLevel2Lookup } = vi.hoisted(() => ({
  mockLevel2Lookup: vi.fn(),
}));

vi.mock('../estimation/level2Lookup.js', () => ({
  level2Lookup: mockLevel2Lookup,
}));

// ---------------------------------------------------------------------------
// Mock level3Lookup
// ---------------------------------------------------------------------------

const { mockLevel3Lookup } = vi.hoisted(() => ({
  mockLevel3Lookup: vi.fn(),
}));

vi.mock('../estimation/level3Lookup.js', () => ({
  level3Lookup: mockLevel3Lookup,
}));

// ---------------------------------------------------------------------------
// Import module under test (after all vi.mock calls)
// ---------------------------------------------------------------------------

import { runEstimationCascade } from '../estimation/engineRouter.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_DB = {} as Kysely<DB>;

const BASE_NUTRIENTS = {
  calories: 520,
  proteins: 28,
  carbohydrates: 42,
  sugars: 8,
  fats: 24,
  saturatedFats: 9,
  fiber: 3,
  salt: 2.1,
  sodium: 840,
  transFats: 0.3,
  cholesterol: 75,
  potassium: 300,
  monounsaturatedFats: 10,
  polyunsaturatedFats: 3,
  alcohol: 0,
  referenceBasis: 'per_serving' as const,
};

const MOCK_RESULT = {
  entityType: 'dish' as const,
  entityId: 'fd000000-0023-4000-a000-000000000001',
  name: 'Big Mac',
  nameEs: 'Big Mac',
  restaurantId: 'fd000000-0023-4000-a000-000000000002',
  chainSlug: 'mcdonalds-es',
  portionGrams: 215,
  nutrients: BASE_NUTRIENTS,
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

const MOCK_L1_RESULT = {
  matchType: 'exact_dish' as const,
  result: MOCK_RESULT,
};

const MOCK_L2_RESULT = {
  matchType: 'ingredient_dish_exact' as const,
  resolvedCount: 2,
  totalCount: 2,
  ingredientSources: [],
  result: {
    ...MOCK_RESULT,
    entityId: 'fd000000-0023-4000-a000-000000000010',
    confidenceLevel: 'medium' as const,
    estimationMethod: 'ingredients' as const,
  },
};

const MOCK_L3_RESULT = {
  matchType: 'similarity_dish' as const,
  similarityDistance: 0.18,
  result: {
    ...MOCK_RESULT,
    entityId: 'fd000000-0023-4000-a000-000000000020',
    confidenceLevel: 'low' as const,
    estimationMethod: 'extrapolation' as const,
    similarityDistance: 0.18,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runEstimationCascade', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: all levels miss
    mockLevel1Lookup.mockResolvedValue(null);
    mockLevel2Lookup.mockResolvedValue(null);
    mockLevel3Lookup.mockResolvedValue(null);
  });

  // -------------------------------------------------------------------------
  // L1 hit
  // -------------------------------------------------------------------------

  it('L1 hit → returns level1Hit:true, levelHit:1, level2/3Lookup not called', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_L1_RESULT);

    const result = await runEstimationCascade({
      db: MOCK_DB,
      query: 'Big Mac',
      chainSlug: 'mcdonalds-es',
    });

    expect(result.levelHit).toBe(1);
    expect(result.data.level1Hit).toBe(true);
    expect(result.data.level2Hit).toBe(false);
    expect(result.data.level3Hit).toBe(false);
    expect(result.data.matchType).toBe('exact_dish');
    expect(result.data.result).toEqual(MOCK_RESULT);
    expect(mockLevel2Lookup).not.toHaveBeenCalled();
    expect(mockLevel3Lookup).not.toHaveBeenCalled();
  });

  it('L1 hit → data.query echoes raw query (not normalized)', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_L1_RESULT);

    const result = await runEstimationCascade({
      db: MOCK_DB,
      query: '  Big  Mac  ',
    });

    expect(result.data.query).toBe('  Big  Mac  ');
  });

  it('L1 hit → level1Lookup receives normalized query', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_L1_RESULT);

    await runEstimationCascade({
      db: MOCK_DB,
      query: '  Big  Mac  ',
      chainSlug: 'mcdonalds-es',
    });

    expect(mockLevel1Lookup).toHaveBeenCalledWith(
      MOCK_DB,
      'big mac',
      expect.objectContaining({ chainSlug: 'mcdonalds-es' }),
    );
  });

  // -------------------------------------------------------------------------
  // L2 hit
  // -------------------------------------------------------------------------

  it('L2 hit → returns level2Hit:true, levelHit:2, level3Lookup not called', async () => {
    mockLevel2Lookup.mockResolvedValueOnce(MOCK_L2_RESULT);

    const result = await runEstimationCascade({
      db: MOCK_DB,
      query: 'Pollo con Verduras',
    });

    expect(result.levelHit).toBe(2);
    expect(result.data.level1Hit).toBe(false);
    expect(result.data.level2Hit).toBe(true);
    expect(result.data.level3Hit).toBe(false);
    expect(result.data.matchType).toBe('ingredient_dish_exact');
    expect(mockLevel3Lookup).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // L3 hit
  // -------------------------------------------------------------------------

  it('L3 hit → returns level3Hit:true, levelHit:3', async () => {
    mockLevel3Lookup.mockResolvedValueOnce(MOCK_L3_RESULT);

    const result = await runEstimationCascade({
      db: MOCK_DB,
      query: 'hamburguesa',
      openAiApiKey: 'test-key',
    });

    expect(result.levelHit).toBe(3);
    expect(result.data.level1Hit).toBe(false);
    expect(result.data.level2Hit).toBe(false);
    expect(result.data.level3Hit).toBe(true);
    expect(result.data.matchType).toBe('similarity_dish');
  });

  it('L3 hit → level3Lookup receives openAiApiKey', async () => {
    mockLevel3Lookup.mockResolvedValueOnce(MOCK_L3_RESULT);

    await runEstimationCascade({
      db: MOCK_DB,
      query: 'hamburguesa',
      openAiApiKey: 'test-api-key',
    });

    expect(mockLevel3Lookup).toHaveBeenCalledWith(
      MOCK_DB,
      'hamburguesa',
      expect.objectContaining({ openAiApiKey: 'test-api-key' }),
    );
  });

  // -------------------------------------------------------------------------
  // Total miss
  // -------------------------------------------------------------------------

  it('total miss → all hit flags false, result:null, matchType:null, levelHit:null', async () => {
    const result = await runEstimationCascade({
      db: MOCK_DB,
      query: 'completely unknown dish',
    });

    expect(result.levelHit).toBeNull();
    expect(result.data.level1Hit).toBe(false);
    expect(result.data.level2Hit).toBe(false);
    expect(result.data.level3Hit).toBe(false);
    expect(result.data.result).toBeNull();
    expect(result.data.matchType).toBeNull();
  });

  // -------------------------------------------------------------------------
  // DB errors
  // -------------------------------------------------------------------------

  it('DB error from L1 → re-throws with statusCode:500 and code:DB_UNAVAILABLE', async () => {
    const originalErr = Object.assign(new Error('DB down'), { code: 'DB_UNAVAILABLE' });
    mockLevel1Lookup.mockRejectedValueOnce(originalErr);

    await expect(
      runEstimationCascade({ db: MOCK_DB, query: 'test' }),
    ).rejects.toMatchObject({ statusCode: 500, code: 'DB_UNAVAILABLE' });
  });

  it('DB error from L2 → re-throws with statusCode:500 and code:DB_UNAVAILABLE', async () => {
    const originalErr = Object.assign(new Error('DB down'), { code: 'DB_UNAVAILABLE' });
    mockLevel2Lookup.mockRejectedValueOnce(originalErr);

    await expect(
      runEstimationCascade({ db: MOCK_DB, query: 'test' }),
    ).rejects.toMatchObject({ statusCode: 500, code: 'DB_UNAVAILABLE' });
  });

  it('DB error from L3 → re-throws with statusCode:500 and code:DB_UNAVAILABLE', async () => {
    const originalErr = Object.assign(new Error('DB down'), { code: 'DB_UNAVAILABLE' });
    mockLevel3Lookup.mockRejectedValueOnce(originalErr);

    await expect(
      runEstimationCascade({ db: MOCK_DB, query: 'test' }),
    ).rejects.toMatchObject({ statusCode: 500, code: 'DB_UNAVAILABLE' });
  });

  // -------------------------------------------------------------------------
  // L4 extension seam
  // -------------------------------------------------------------------------

  it('L4 hit → returns levelHit:4, all L1/L2/L3 hit flags false, result non-null', async () => {
    const mockL4Result = {
      matchType: 'exact_dish' as const,
      result: { ...MOCK_RESULT, entityId: 'fd000000-0023-4000-a000-000000000040' },
    };
    const mockLevel4Lookup = vi.fn().mockResolvedValueOnce(mockL4Result);

    const result = await runEstimationCascade({
      db: MOCK_DB,
      query: 'something',
      level4Lookup: mockLevel4Lookup,
    });

    expect(result.levelHit).toBe(4);
    expect(result.data.level1Hit).toBe(false);
    expect(result.data.level2Hit).toBe(false);
    expect(result.data.level3Hit).toBe(false);
    expect(result.data.result).not.toBeNull();
    expect(result.data.matchType).toBe('exact_dish');
    expect(mockLevel4Lookup).toHaveBeenCalledOnce();
  });

  it('level4Lookup undefined → cascade stops after L3, levelHit:null on total miss', async () => {
    const result = await runEstimationCascade({
      db: MOCK_DB,
      query: 'something',
      // level4Lookup not provided
    });

    expect(result.levelHit).toBeNull();
    expect(result.data.result).toBeNull();
  });

  it('level4Lookup throws → re-throws with statusCode:500 and code:DB_UNAVAILABLE', async () => {
    const err = new Error('L4 failure');
    const mockLevel4Lookup = vi.fn().mockRejectedValueOnce(err);

    await expect(
      runEstimationCascade({
        db: MOCK_DB,
        query: 'something',
        level4Lookup: mockLevel4Lookup,
      }),
    ).rejects.toMatchObject({ statusCode: 500, code: 'DB_UNAVAILABLE' });
  });

  // -------------------------------------------------------------------------
  // openAiApiKey undefined
  // -------------------------------------------------------------------------

  it('openAiApiKey undefined → passed through to level3Lookup as undefined', async () => {
    await runEstimationCascade({
      db: MOCK_DB,
      query: 'test',
      openAiApiKey: undefined,
    });

    expect(mockLevel3Lookup).toHaveBeenCalledWith(
      MOCK_DB,
      'test',
      expect.objectContaining({ openAiApiKey: undefined }),
    );
  });
});
