/**
 * F082 — Nutritional Substitutions in Estimation Orchestrator — Unit Tests
 *
 * Verifies that the estimation orchestrator enriches results
 * with substitution suggestions via enrichWithSubstitutions().
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

// substitutions + healthHacker are NOT mocked — tested end-to-end
import { estimate } from '../conversation/estimationOrchestrator.js';
import { runEstimationCascade } from '../estimation/engineRouter.js';
import type { EstimateResult } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FRIES_RESULT: EstimateResult = {
  entityType: 'food',
  entityId: 'fd000000-0001-4000-a000-000000000082',
  name: 'French Fries',
  nameEs: 'Patatas fritas',
  restaurantId: null,
  chainSlug: null,
  portionGrams: 150,
  nutrients: {
    calories: 400,
    proteins: 4,
    carbohydrates: 48,
    sugars: 0,
    fats: 20,
    saturatedFats: 3,
    fiber: 3,
    salt: 0.8,
    sodium: 320,
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
    id: 'fd000000-0003-4000-a000-000000000082',
    name: 'USDA',
    type: 'official',
    url: null,
  },
  similarityDistance: null,
};

const SUSHI_RESULT: EstimateResult = {
  ...FRIES_RESULT,
  name: 'Sushi',
  nameEs: 'Sushi variado',
};

const LOW_CAL_RESULT: EstimateResult = {
  ...FRIES_RESULT,
  nutrients: { ...FRIES_RESULT.nutrients, calories: 100 },
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

describe('estimate() — substitutions enrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes substitutions for food with matching name', async () => {
    vi.mocked(runEstimationCascade).mockResolvedValue({
      levelHit: 1,
      data: {
        query: 'patatas fritas',
        chainSlug: null,
        level1Hit: true,
        level2Hit: false,
        level3Hit: false,
        level4Hit: false,
        matchType: 'exact_food',
        result: FRIES_RESULT,
        cachedAt: null,
        yieldAdjustment: null,
      },
    });

    const result = await estimate({
      query: 'patatas fritas',
      db: {} as never,
      chainSlugs: [],
      logger: logger as never,
    });

    expect(result.substitutions).toBeDefined();
    expect(result.substitutions?.length).toBeGreaterThan(0);
    expect(result.substitutions?.length).toBeLessThanOrEqual(2);
    expect(result.substitutions?.[0]).toMatchObject({
      original: expect.any(String),
      substitute: expect.any(String),
      nutrientDiff: expect.objectContaining({
        calories: expect.any(Number),
      }),
    });
  });

  it('omits substitutions for non-matching food', async () => {
    vi.mocked(runEstimationCascade).mockResolvedValue({
      levelHit: 1,
      data: {
        query: 'sushi',
        chainSlug: null,
        level1Hit: true,
        level2Hit: false,
        level3Hit: false,
        level4Hit: false,
        matchType: 'exact_food',
        result: SUSHI_RESULT,
        cachedAt: null,
        yieldAdjustment: null,
      },
    });

    const result = await estimate({
      query: 'sushi',
      db: {} as never,
      chainSlugs: [],
      logger: logger as never,
    });

    expect(result.substitutions).toBeUndefined();
  });

  it('omits substitutions for low-calorie results', async () => {
    vi.mocked(runEstimationCascade).mockResolvedValue({
      levelHit: 1,
      data: {
        query: 'patatas fritas pequeñas',
        chainSlug: null,
        level1Hit: true,
        level2Hit: false,
        level3Hit: false,
        level4Hit: false,
        matchType: 'exact_food',
        result: LOW_CAL_RESULT,
        cachedAt: null,
        yieldAdjustment: null,
      },
    });

    const result = await estimate({
      query: 'patatas fritas pequeñas',
      db: {} as never,
      chainSlugs: [],
      logger: logger as never,
    });

    expect(result.substitutions).toBeUndefined();
  });

  it('omits substitutions when result is null', async () => {
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

    expect(result.substitutions).toBeUndefined();
  });
});
