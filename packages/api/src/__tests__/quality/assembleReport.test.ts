// Unit tests for assembleReport — mocks all six check functions + prisma counts.
//
// Tests verify: all checks called in parallel, correct field assembly,
// full groups returned (no cap), chainSummary aggregated from byChain results,
// error propagation (one rejected check rejects the whole assembly).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

// We mock the check function modules before importing assembleReport
vi.mock('../../quality/checkNutrientCompleteness.js', () => ({
  checkNutrientCompleteness: vi.fn(),
}));
vi.mock('../../quality/checkImplausibleValues.js', () => ({
  checkImplausibleValues: vi.fn(),
}));
vi.mock('../../quality/checkDataGaps.js', () => ({
  checkDataGaps: vi.fn(),
}));
vi.mock('../../quality/checkDuplicates.js', () => ({
  checkDuplicates: vi.fn(),
}));
vi.mock('../../quality/checkConfidenceDistribution.js', () => ({
  checkConfidenceDistribution: vi.fn(),
}));
vi.mock('../../quality/checkDataFreshness.js', () => ({
  checkDataFreshness: vi.fn(),
}));

import { assembleReport } from '../../quality/assembleReport.js';
import { checkNutrientCompleteness } from '../../quality/checkNutrientCompleteness.js';
import { checkImplausibleValues } from '../../quality/checkImplausibleValues.js';
import { checkDataGaps } from '../../quality/checkDataGaps.js';
import { checkDuplicates } from '../../quality/checkDuplicates.js';
import { checkConfidenceDistribution } from '../../quality/checkConfidenceDistribution.js';
import { checkDataFreshness } from '../../quality/checkDataFreshness.js';

// ---------------------------------------------------------------------------
// Default mock results
// ---------------------------------------------------------------------------

const defaultNutrientResult = {
  dishesWithNutrients: 8,
  dishesWithoutNutrients: 2,
  dishesWithoutNutrientsPercent: 20,
  ghostRowCount: 1,
  zeroCaloriesCount: 1,
  byChain: [
    { chainSlug: 'chain-a', dishesWithoutNutrients: 2, ghostRowCount: 1, zeroCaloriesCount: 1 },
  ],
};

const defaultImplausibleResult = {
  caloriesAboveThreshold: 0,
  ghostRows: 1,
  suspiciouslyRoundCalories: 2,
  caloriesThreshold: 5000 as const,
  byChain: [
    { chainSlug: 'chain-a', caloriesAboveThreshold: 0, ghostRows: 1, suspiciouslyRoundCalories: 2 },
  ],
};

const defaultDataGapsResult = {
  dishesWithoutPortionGrams: 3,
  dishesWithoutPriceEur: 5,
  restaurantsWithoutDishes: 1,
};

const defaultDuplicatesResult = {
  duplicateGroupCount: 1,
  totalDuplicateDishes: 2,
  groups: [
    { name: 'Big Mac', chainSlug: 'chain-a', count: 2, dishIds: ['d1', 'd2'] },
  ],
};

const defaultConfidenceResult = {
  global: { high: 5, medium: 3, low: 2 },
  byEstimationMethod: { official: 4, scraped: 4, ingredients: 1, extrapolation: 1 },
  byChain: [
    {
      chainSlug: 'chain-a',
      high: 5, medium: 3, low: 2,
      byEstimationMethod: { official: 4, scraped: 4, ingredients: 1, extrapolation: 1 },
    },
  ],
};

const defaultFreshnessResult = {
  totalSources: 2,
  staleSources: 1,
  staleSourcesDetail: [
    { sourceId: 'src-001', name: 'Old Source', lastUpdated: null, daysSinceUpdate: null },
  ],
};

function setupDefaultMocks(prisma: PrismaClient) {
  vi.mocked(checkNutrientCompleteness).mockResolvedValue(defaultNutrientResult);
  vi.mocked(checkImplausibleValues).mockResolvedValue(defaultImplausibleResult);
  vi.mocked(checkDataGaps).mockResolvedValue(defaultDataGapsResult);
  vi.mocked(checkDuplicates).mockResolvedValue(defaultDuplicatesResult);
  vi.mocked(checkConfidenceDistribution).mockResolvedValue(defaultConfidenceResult);
  vi.mocked(checkDataFreshness).mockResolvedValue(defaultFreshnessResult);

  (prisma.dish.count as ReturnType<typeof vi.fn>).mockResolvedValue(10);
  (prisma.restaurant.count as ReturnType<typeof vi.fn>).mockResolvedValue(2);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('assembleReport()', () => {
  let prisma: PrismaClient;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = {
      dish: { count: vi.fn() },
      restaurant: { count: vi.fn() },
    } as unknown as PrismaClient;
  });

  it('assembles all check results into correct QualityReportData shape', async () => {
    setupDefaultMocks(prisma);

    const result = await assembleReport(prisma, {}, 90);

    expect(result.totalDishes).toBe(10);
    expect(result.totalRestaurants).toBe(2);
    expect(result.stalenessThresholdDays).toBe(90);
    expect(result.scopedToChain).toBeNull();
    expect(result.nutrientCompleteness).toEqual(defaultNutrientResult);
    expect(result.implausibleValues).toEqual(defaultImplausibleResult);
    expect(result.dataGaps).toEqual(defaultDataGapsResult);
    expect(result.duplicates).toEqual(defaultDuplicatesResult);
    expect(result.confidenceDistribution).toEqual(defaultConfidenceResult);
    expect(result.dataFreshness).toEqual(defaultFreshnessResult);
  });

  it('generatedAt is a valid ISO 8601 string', async () => {
    setupDefaultMocks(prisma);

    const result = await assembleReport(prisma, {}, 90);

    expect(typeof result.generatedAt).toBe('string');
    expect(() => new Date(result.generatedAt)).not.toThrow();
    expect(new Date(result.generatedAt).toISOString()).toBe(result.generatedAt);
  });

  it('scopedToChain: null when no chainSlug, chainSlug value when provided', async () => {
    setupDefaultMocks(prisma);

    const globalResult = await assembleReport(prisma, {}, 90);
    expect(globalResult.scopedToChain).toBeNull();

    vi.clearAllMocks();
    setupDefaultMocks(prisma);
    const scopedResult = await assembleReport(prisma, { chainSlug: 'mcdonalds-es' }, 90);
    expect(scopedResult.scopedToChain).toBe('mcdonalds-es');
  });

  it('all six checks called via Promise.all (all called on each invocation)', async () => {
    setupDefaultMocks(prisma);

    await assembleReport(prisma, {}, 90);

    expect(checkNutrientCompleteness).toHaveBeenCalledOnce();
    expect(checkImplausibleValues).toHaveBeenCalledOnce();
    expect(checkDataGaps).toHaveBeenCalledOnce();
    expect(checkDuplicates).toHaveBeenCalledOnce();
    expect(checkConfidenceDistribution).toHaveBeenCalledOnce();
    expect(checkDataFreshness).toHaveBeenCalledOnce();
  });

  it('checkDataFreshness called with stalenessThresholdDays as third argument', async () => {
    setupDefaultMocks(prisma);

    await assembleReport(prisma, {}, 30);

    expect(checkDataFreshness).toHaveBeenCalledWith(prisma, {}, 30);
  });

  it('full groups array returned without cap', async () => {
    setupDefaultMocks(prisma);

    const manyGroups = Array.from({ length: 75 }, (_, i) => ({
      name: `Dish ${i}`,
      chainSlug: 'chain-a',
      count: 2,
      dishIds: [`d${i}a`, `d${i}b`],
    }));

    vi.mocked(checkDuplicates).mockResolvedValue({
      duplicateGroupCount: 75,
      totalDuplicateDishes: 150,
      groups: manyGroups,
    });

    const result = await assembleReport(prisma, {}, 90);

    expect(result.duplicates.groups).toHaveLength(75); // no cap in assembleReport
  });

  it('chainSummary computed from byChain results, sorted by issueCount DESC', async () => {
    setupDefaultMocks(prisma);

    // chain-a: dishesWithoutNutrients:2 + ghostRows:1 + caloriesAbove:0 + totalDuplicates:2 = 5
    // chain-b: only in nutrients but with 0 issues
    vi.mocked(checkNutrientCompleteness).mockResolvedValue({
      ...defaultNutrientResult,
      byChain: [
        { chainSlug: 'chain-a', dishesWithoutNutrients: 2, ghostRowCount: 1, zeroCaloriesCount: 1 },
        { chainSlug: 'chain-b', dishesWithoutNutrients: 0, ghostRowCount: 0, zeroCaloriesCount: 0 },
      ],
    });

    vi.mocked(checkImplausibleValues).mockResolvedValue({
      ...defaultImplausibleResult,
      byChain: [
        { chainSlug: 'chain-a', caloriesAboveThreshold: 3, ghostRows: 1, suspiciouslyRoundCalories: 0 },
        { chainSlug: 'chain-b', caloriesAboveThreshold: 0, ghostRows: 0, suspiciouslyRoundCalories: 0 },
      ],
    });

    vi.mocked(checkDuplicates).mockResolvedValue({
      duplicateGroupCount: 2,
      totalDuplicateDishes: 6,
      groups: [
        { name: 'A', chainSlug: 'chain-a', count: 3, dishIds: ['d1', 'd2', 'd3'] },
        { name: 'B', chainSlug: 'chain-b', count: 3, dishIds: ['d4', 'd5', 'd6'] },
      ],
    });

    const result = await assembleReport(prisma, {}, 90);

    // chain-a: 2 (dishesWithoutNutrients) + 1 (ghostRowCount) + 3 (caloriesAbove) + 3 (duplicates for chain-a) = 9
    // chain-b: 0 + 0 + 0 + 3 (duplicates for chain-b) = 3
    expect(result.chainSummary[0]?.chainSlug).toBe('chain-a');
    expect(result.chainSummary[1]?.chainSlug).toBe('chain-b');
  });

  it('any single check rejection → entire assembleReport rejects', async () => {
    setupDefaultMocks(prisma);

    vi.mocked(checkImplausibleValues).mockRejectedValue(new Error('DB connection lost'));

    await expect(assembleReport(prisma, {}, 90)).rejects.toThrow('DB connection lost');
  });
});
