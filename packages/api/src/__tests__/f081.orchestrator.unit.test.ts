/**
 * F081 — Health-Hacker Tips in Estimation Orchestrator — Unit Tests
 *
 * Verifies that the estimation orchestrator enriches chain dish results
 * with health-hacker tips via getHealthHackerTips().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the modules BEFORE importing the orchestrator
vi.mock('../estimation/engineRouter.js', () => ({
  runEstimationCascade: vi.fn(),
}));

vi.mock('../estimation/brandDetector.js', () => ({
  detectExplicitBrand: vi.fn().mockReturnValue({ hasExplicitBrand: false }),
}));

vi.mock('../lib/cache.js', () => ({
  buildKey: vi.fn().mockReturnValue('test-key'),
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../estimation/portionUtils.js', () => ({
  applyPortionMultiplier: vi.fn().mockImplementation((r) => r),
}));

// healthHacker is NOT mocked — we test it end-to-end with the orchestrator
import { estimate } from '../conversation/estimationOrchestrator.js';
import { runEstimationCascade } from '../estimation/engineRouter.js';
import type { EstimateResult } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHAIN_RESULT: EstimateResult = {
  entityType: 'dish',
  entityId: 'fd000000-0001-4000-a000-000000000001',
  name: 'Big Mac',
  nameEs: 'Big Mac',
  restaurantId: 'fd000000-0002-4000-a000-000000000001',
  chainSlug: 'mcdonalds-es',
  portionGrams: 200,
  nutrients: {
    calories: 508,
    proteins: 26,
    carbohydrates: 45,
    fats: 30,
    sugars: 9,
    saturatedFats: 11,
    fiber: 3,
    salt: 2.3,
    sodium: 0.92,
    transFats: 0,
    cholesterol: 0,
    potassium: 0,
    monounsaturatedFats: 0,
    polyunsaturatedFats: 0,
    alcohol: 0,
    referenceBasis: 'per_serving',
  },
  confidenceLevel: 'high',
  estimationMethod: 'official',
  source: {
    id: 'fd000000-0003-4000-a000-000000000001',
    name: 'Chain PDF',
    type: 'official',
    url: null,
  },
  similarityDistance: null,
};

const NON_CHAIN_RESULT: EstimateResult = {
  ...CHAIN_RESULT,
  chainSlug: null,
  restaurantId: null,
};

const LOW_CAL_CHAIN_RESULT: EstimateResult = {
  ...CHAIN_RESULT,
  nutrients: { ...CHAIN_RESULT.nutrients, calories: 100 },
};

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('estimate() — healthHackerTips enrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes healthHackerTips for chain dish with sufficient calories', async () => {
    vi.mocked(runEstimationCascade).mockResolvedValue({
      levelHit: 1,
      data: {
        query: 'big mac',
        chainSlug: 'mcdonalds-es',
        level1Hit: true,
        level2Hit: false,
        level3Hit: false,
        level4Hit: false,
        matchType: 'exact_dish',
        result: CHAIN_RESULT,
        cachedAt: null,
        yieldAdjustment: null,
      },
    });

    const result = await estimate({
      query: 'big mac',
      chainSlug: 'mcdonalds-es',
      db: {} as never,
      chainSlugs: ['mcdonalds-es'],
      logger: logger as never,
    });

    expect(result.healthHackerTips).toBeDefined();
    expect(result.healthHackerTips!.length).toBeGreaterThan(0);
    expect(result.healthHackerTips!.length).toBeLessThanOrEqual(3);
    expect(result.healthHackerTips![0]).toMatchObject({
      tip: expect.any(String),
      caloriesSaved: expect.any(Number),
    });
  });

  it('omits healthHackerTips for non-chain results', async () => {
    vi.mocked(runEstimationCascade).mockResolvedValue({
      levelHit: 1,
      data: {
        query: 'tortilla',
        chainSlug: null,
        level1Hit: true,
        level2Hit: false,
        level3Hit: false,
        level4Hit: false,
        matchType: 'exact_food',
        result: NON_CHAIN_RESULT,
        cachedAt: null,
        yieldAdjustment: null,
      },
    });

    const result = await estimate({
      query: 'tortilla',
      db: {} as never,
      chainSlugs: [],
      logger: logger as never,
    });

    expect(result.healthHackerTips).toBeUndefined();
  });

  it('omits healthHackerTips for low-calorie chain dishes', async () => {
    vi.mocked(runEstimationCascade).mockResolvedValue({
      levelHit: 1,
      data: {
        query: 'apple slices',
        chainSlug: 'mcdonalds-es',
        level1Hit: true,
        level2Hit: false,
        level3Hit: false,
        level4Hit: false,
        matchType: 'exact_dish',
        result: LOW_CAL_CHAIN_RESULT,
        cachedAt: null,
        yieldAdjustment: null,
      },
    });

    const result = await estimate({
      query: 'apple slices',
      chainSlug: 'mcdonalds-es',
      db: {} as never,
      chainSlugs: ['mcdonalds-es'],
      logger: logger as never,
    });

    expect(result.healthHackerTips).toBeUndefined();
  });

  it('omits healthHackerTips when result is null (total miss)', async () => {
    vi.mocked(runEstimationCascade).mockResolvedValue({
      levelHit: null,
      data: {
        query: 'xyz unknown',
        chainSlug: null,
        level1Hit: false,
        level2Hit: false,
        level3Hit: false,
        level4Hit: false,
        matchType: null,
        result: null,
        cachedAt: null,
        yieldAdjustment: null,
      },
    });

    const result = await estimate({
      query: 'xyz unknown',
      db: {} as never,
      chainSlugs: [],
      logger: logger as never,
    });

    expect(result.healthHackerTips).toBeUndefined();
  });
});
