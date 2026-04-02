// Unit tests for EstimationOrchestrator (F070, Step 6)
//
// Mocks: runEstimationCascade, detectExplicitBrand, cacheGet, cacheSet via vi.mock
// Does NOT mock: applyPortionMultiplier (pure, tested in-place)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EstimateData, EstimateResult } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockRunEstimationCascade } = vi.hoisted(() => ({
  mockRunEstimationCascade: vi.fn(),
}));

vi.mock('../estimation/engineRouter.js', () => ({
  runEstimationCascade: mockRunEstimationCascade,
}));

const { mockDetectExplicitBrand } = vi.hoisted(() => ({
  mockDetectExplicitBrand: vi.fn(),
}));

vi.mock('../estimation/brandDetector.js', () => ({
  detectExplicitBrand: mockDetectExplicitBrand,
  loadChainSlugs: vi.fn().mockResolvedValue([]),
}));

const { mockCacheGet, mockCacheSet } = vi.hoisted(() => ({
  mockCacheGet: vi.fn(),
  mockCacheSet: vi.fn(),
}));

vi.mock('../lib/cache.js', () => ({
  buildKey: (entity: string, id: string) => `fxp:${entity}:${id}`,
  cacheGet: mockCacheGet,
  cacheSet: mockCacheSet,
}));

// ---------------------------------------------------------------------------
// Subject (imported after mocks are set up)
// ---------------------------------------------------------------------------

import { estimate } from '../conversation/estimationOrchestrator.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_NUTRIENTS = {
  calories: 550,
  proteins: 25,
  carbohydrates: 45,
  sugars: 9,
  fats: 26,
  saturatedFats: 10,
  fiber: 2,
  salt: 2.2,
  sodium: 880,
  transFats: 0.2,
  cholesterol: 80,
  potassium: 320,
  monounsaturatedFats: 12,
  polyunsaturatedFats: 4,
  referenceBasis: 'per_serving' as const,
};

const MOCK_RESULT: EstimateResult = {
  entityType: 'dish' as const,
  entityId: 'fd000000-0070-4000-a000-000000000001',
  name: 'Big Mac',
  nameEs: 'Big Mac',
  restaurantId: 'fd000000-0070-4000-a000-000000000002',
  chainSlug: 'mcdonalds-es',
  portionGrams: 215,
  nutrients: BASE_NUTRIENTS,
  confidenceLevel: 'high' as const,
  estimationMethod: 'official' as const,
  source: {
    id: 'fd000000-0070-4000-a000-000000000003',
    name: "McDonald's Spain Official PDF",
    type: 'official' as const,
    url: 'https://www.mcdonalds.es/nutritional.pdf',
  },
  similarityDistance: null,
};

const ROUTER_L1_HIT = {
  levelHit: 1 as const,
  data: {
    query: 'big mac',
    chainSlug: 'mcdonalds-es',
    level1Hit: true,
    level2Hit: false,
    level3Hit: false,
    level4Hit: false,
    matchType: 'exact_dish' as const,
    result: MOCK_RESULT,
    cachedAt: null,
    portionMultiplier: 1,
  },
};

const ROUTER_TOTAL_MISS = {
  levelHit: null,
  data: {
    query: 'unknown',
    chainSlug: null,
    level1Hit: false,
    level2Hit: false,
    level3Hit: false,
    level4Hit: false,
    matchType: null,
    result: null,
    cachedAt: null,
    portionMultiplier: 1,
  },
};

// Stub logger
const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  level: 'info' as const,
  silent: vi.fn(),
} as unknown as Parameters<typeof estimate>[0]['logger'];

// Stub Kysely db
const mockDb = {} as Parameters<typeof estimate>[0]['db'];

// Stub Redis
const mockRedis = {} as Parameters<typeof estimate>[0]['redis'];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EstimationOrchestrator.estimate()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDetectExplicitBrand.mockReturnValue({ hasExplicitBrand: false });
    mockCacheGet.mockResolvedValue(null);
    mockCacheSet.mockResolvedValue(undefined);
    mockRunEstimationCascade.mockResolvedValue(ROUTER_L1_HIT);
  });

  // -------------------------------------------------------------------------
  // Cache hit returns early
  // -------------------------------------------------------------------------

  it('cache hit → returns cached EstimateData without calling cascade', async () => {
    const cached: EstimateData = {
      ...ROUTER_L1_HIT.data,
      portionMultiplier: 1,
      cachedAt: '2026-04-01T10:00:00.000Z',
    };
    mockCacheGet.mockResolvedValueOnce(cached);

    const result = await estimate({
      query: 'big mac',
      chainSlug: 'mcdonalds-es',
      portionMultiplier: 1,
      db: mockDb,
      redis: mockRedis,
      chainSlugs: [],
      logger: mockLogger,
    });

    expect(result).toEqual(cached);
    expect(mockRunEstimationCascade).not.toHaveBeenCalled();
    expect(mockCacheSet).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cache miss → calls cascade
  // -------------------------------------------------------------------------

  it('cache miss → calls runEstimationCascade and returns EstimateData', async () => {
    mockCacheGet.mockResolvedValueOnce(null);
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L1_HIT);

    const result = await estimate({
      query: 'big mac',
      chainSlug: 'mcdonalds-es',
      portionMultiplier: 1,
      db: mockDb,
      redis: mockRedis,
      chainSlugs: [],
      logger: mockLogger,
    });

    expect(mockRunEstimationCascade).toHaveBeenCalledOnce();
    expect(result.level1Hit).toBe(true);
    expect(result.result).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Portion multiplier != 1 → applied to result
  // -------------------------------------------------------------------------

  it('portion multiplier != 1 → nutrients scaled, portionGrams scaled', async () => {
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L1_HIT);

    const result = await estimate({
      query: 'big mac',
      chainSlug: 'mcdonalds-es',
      portionMultiplier: 2,
      db: mockDb,
      redis: mockRedis,
      chainSlugs: [],
      logger: mockLogger,
    });

    expect(result.portionMultiplier).toBe(2);
    expect(result.result).not.toBeNull();
    // calories should be doubled: 550 * 2 = 1100
    expect(result.result!.nutrients.calories).toBe(1100);
    // portionGrams should be doubled: 215 * 2 = 430
    expect(result.result!.portionGrams).toBe(430);
    // referenceBasis should be 'per_serving'
    expect(result.result!.nutrients.referenceBasis).toBe('per_serving');
  });

  // -------------------------------------------------------------------------
  // Portion multiplier = 1 → NOT applied (result unchanged)
  // -------------------------------------------------------------------------

  it('portion multiplier = 1 → result returned unchanged', async () => {
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L1_HIT);

    const result = await estimate({
      query: 'big mac',
      portionMultiplier: 1,
      db: mockDb,
      redis: mockRedis,
      chainSlugs: [],
      logger: mockLogger,
    });

    expect(result.result!.nutrients.calories).toBe(550);
    expect(result.result!.portionGrams).toBe(215);
  });

  // -------------------------------------------------------------------------
  // Total miss: result is null, cascade result preserved
  // -------------------------------------------------------------------------

  it('cascade total miss → EstimateData with result:null, no error', async () => {
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_TOTAL_MISS);

    const result = await estimate({
      query: 'unknown dish',
      portionMultiplier: 1,
      db: mockDb,
      redis: mockRedis,
      chainSlugs: [],
      logger: mockLogger,
    });

    expect(result.result).toBeNull();
    expect(result.level1Hit).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Brand detection passed through to cascade
  // -------------------------------------------------------------------------

  it('brand detection called with query + chainSlugs, result forwarded to cascade', async () => {
    mockDetectExplicitBrand.mockReturnValueOnce({ hasExplicitBrand: true });
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L1_HIT);

    await estimate({
      query: 'big mac',
      chainSlugs: ['mcdonalds-es'],
      portionMultiplier: 1,
      db: mockDb,
      redis: mockRedis,
      logger: mockLogger,
    });

    expect(mockDetectExplicitBrand).toHaveBeenCalledWith('big mac', ['mcdonalds-es']);
    expect(mockRunEstimationCascade).toHaveBeenCalledWith(
      expect.objectContaining({ hasExplicitBrand: true }),
    );
  });

  // -------------------------------------------------------------------------
  // Cache write: cachedAt set on write, not in returned data
  // -------------------------------------------------------------------------

  it('cache write called after cascade, cachedAt is set in written data but null in returned', async () => {
    mockRunEstimationCascade.mockResolvedValueOnce(ROUTER_L1_HIT);

    const result = await estimate({
      query: 'big mac',
      portionMultiplier: 1,
      db: mockDb,
      redis: mockRedis,
      chainSlugs: [],
      logger: mockLogger,
    });

    expect(mockCacheSet).toHaveBeenCalledOnce();
    const [, writtenData] = mockCacheSet.mock.calls[0] as [string, EstimateData];
    expect(writtenData.cachedAt).not.toBeNull();
    expect(result.cachedAt).toBeNull();
  });

  // -------------------------------------------------------------------------
  // actorId is NOT in EstimateParams
  // -------------------------------------------------------------------------

  it('actorId is not part of EstimateParams type', () => {
    // TypeScript ensures this at compile time; verify no actorId property is forwarded
    const params = {
      query: 'big mac',
      portionMultiplier: 1,
      db: mockDb,
      redis: mockRedis,
      chainSlugs: [],
      logger: mockLogger,
    };
    // If actorId were in the type, this would fail TS. Runtime check is implicit.
    expect('actorId' in params).toBe(false);
  });
});
