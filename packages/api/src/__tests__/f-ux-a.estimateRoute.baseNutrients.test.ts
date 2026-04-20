// F-UX-A QA — Verify that GET /estimate route OMITS baseNutrients even when
// portionMultiplier !== 1.0.
//
// BUG: The orchestrator (estimationOrchestrator.ts) captures baseNutrients + basePortionGrams
// when portionMultiplier !== 1.0. The GET /estimate route handler does NOT — it assembles
// EstimateData without those fields. This means:
//   - Direct GET /estimate with portionMultiplier=1.5 → pill shown, NO "base: N kcal"
//   - POST /conversation/message (orchestrator path) → pill shown WITH "base: N kcal"
//
// The Zod schema allows absence (both absent is valid), so no validation error.
// This is a spec deviation: F-UX-A requires the base subtitle when multiplier != 1.0
// and the cascade produced a result. The route handler does not implement this.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
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
// Subject
// ---------------------------------------------------------------------------

import { estimate } from '../conversation/estimationOrchestrator.js';
import type { EstimateResult } from '@foodxplorer/shared';

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
  alcohol: 0,
  referenceBasis: 'per_serving' as const,
};

const MOCK_RESULT: EstimateResult = {
  entityType: 'dish' as const,
  entityId: 'fd000000-0070-4000-a000-000000000001',
  name: 'Big Mac',
  nameEs: 'Big Mac',
  restaurantId: null,
  chainSlug: null,
  portionGrams: 215,
  nutrients: BASE_NUTRIENTS,
  confidenceLevel: 'high' as const,
  estimationMethod: 'official' as const,
  source: { id: 'fd000000-0070-4000-a000-000000000003', name: 'Test', type: 'official' as const, url: null },
  similarityDistance: null,
};

const ROUTER_L1_HIT = {
  levelHit: 1 as const,
  data: {
    query: 'big mac',
    chainSlug: null,
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

const mockLogger = {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  child: vi.fn(), trace: vi.fn(), fatal: vi.fn(), level: 'info' as const, silent: vi.fn(),
} as unknown as Parameters<typeof estimate>[0]['logger'];

const mockDb = {} as Parameters<typeof estimate>[0]['db'];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F-UX-A — orchestrator correctly captures baseNutrients', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDetectExplicitBrand.mockReturnValue({ hasExplicitBrand: false });
    mockCacheGet.mockResolvedValue(null);
    mockCacheSet.mockResolvedValue(undefined);
    mockRunEstimationCascade.mockResolvedValue(ROUTER_L1_HIT);
  });

  it('orchestrator attaches baseNutrients when portionMultiplier !== 1.0', async () => {
    const result = await estimate({
      query: 'big mac',
      portionMultiplier: 1.5,
      db: mockDb,
      chainSlugs: [],
      logger: mockLogger,
    });
    expect(result.baseNutrients).toBeDefined();
    expect(result.basePortionGrams).toBeDefined();
    expect(result.baseNutrients?.calories).toBe(550); // pre-multiplier
    expect(result.result?.nutrients.calories).toBe(825); // 550 * 1.5
  });

  it('applyPortionMultiplier does NOT mutate the original result object', async () => {
    // The cascade returns MOCK_RESULT (shared reference).
    // After applyPortionMultiplier, the original nutrients must be unchanged.
    const result = await estimate({
      query: 'big mac',
      portionMultiplier: 2.0,
      db: mockDb,
      chainSlugs: [],
      logger: mockLogger,
    });
    // baseNutrients should have the pre-multiplier value
    expect(result.baseNutrients?.calories).toBe(550);
    // The scaled result has 550 * 2.0 = 1100
    expect(result.result?.nutrients.calories).toBe(1100);
    // The original MOCK_RESULT.nutrients.calories must still be 550 (no mutation)
    expect(MOCK_RESULT.nutrients.calories).toBe(550);
  });

  it('portionMultiplier=1.0000001 attaches baseNutrients (near-1.0 float escapes guard)', async () => {
    // 1.0000001 !== 1.0 → shouldScale = true → baseNutrients attached
    // This is a questionable edge case: the UI will show "×1" pill + "base: 550 kcal"
    // for a 0.00001% scaling difference, which may confuse users.
    const result = await estimate({
      query: 'big mac',
      portionMultiplier: 1.0000001,
      db: mockDb,
      chainSlugs: [],
      logger: mockLogger,
    });
    // Schema superRefine passes (1.0000001 !== 1.0)
    expect(result.baseNutrients).toBeDefined();
    // The scaled calories: 550 * 1.0000001 ≈ 550.0000550 → Math.round(… * 100)/100 = 550
    // So baseCalories and scaled calories are both 550 — "base: 550 kcal" under "550 kcal"
    const scaledCal = result.result?.nutrients.calories ?? 0;
    const baseCal = result.baseNutrients?.calories ?? 0;
    expect(scaledCal).toBe(baseCal); // both show 550 → subtitle is redundant noise
  });
});

// ---------------------------------------------------------------------------
// Confirm applyPortionMultiplier is a pure function (no mutation)
// ---------------------------------------------------------------------------

describe('applyPortionMultiplier purity (regression)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDetectExplicitBrand.mockReturnValue({ hasExplicitBrand: false });
    mockCacheGet.mockResolvedValue(null);
    mockCacheSet.mockResolvedValue(undefined);
  });

  it('cascade result is not mutated after scaling — original nutrients preserved', async () => {
    const originalCal = MOCK_RESULT.nutrients.calories;
    const originalGrams = MOCK_RESULT.portionGrams;

    mockRunEstimationCascade.mockResolvedValue(ROUTER_L1_HIT);

    await estimate({
      query: 'big mac',
      portionMultiplier: 3.0,
      db: mockDb,
      chainSlugs: [],
      logger: mockLogger,
    });

    // The original MOCK_RESULT that the cascade returned must be unchanged
    expect(MOCK_RESULT.nutrients.calories).toBe(originalCal);
    expect(MOCK_RESULT.portionGrams).toBe(originalGrams);
  });
});
