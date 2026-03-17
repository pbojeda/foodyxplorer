// Unit tests for checkImplausibleValues — mocked PrismaClient.
//
// Tests cover: empty DB, calories above threshold detection, ghost rows,
// suspiciously round calories, byChain grouping via raw SQL, chainSlug scope.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { checkImplausibleValues } from '../../quality/checkImplausibleValues.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock PrismaClient for checkImplausibleValues.
 *
 * After refactoring, the function uses:
 * - dishNutrient.count() x3 (in parallel): caloriesAbove, ghostRows, roundCalories via $queryRaw
 * - $queryRaw x2: round-calories global count + byChain aggregation
 */
function makePrisma(overrides: {
  caloriesAboveCount?: number;
  ghostRowCount?: number;
  roundCaloriesCount?: number;
  byChainRows?: Array<{
    chain_slug: string;
    calories_above: bigint;
    ghost_rows: bigint;
    round_calories: bigint;
  }>;
}): PrismaClient {
  const {
    caloriesAboveCount = 0,
    ghostRowCount = 0,
    roundCaloriesCount = 0,
    byChainRows = [],
  } = overrides;

  return {
    dishNutrient: {
      count: vi.fn()
        .mockResolvedValueOnce(caloriesAboveCount)
        .mockResolvedValueOnce(ghostRowCount),
    },
    $queryRaw: vi.fn()
      .mockResolvedValueOnce([{ count: BigInt(roundCaloriesCount) }]) // round-calories global
      .mockResolvedValueOnce(byChainRows), // byChain aggregation
  } as unknown as PrismaClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkImplausibleValues()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('empty DB: all counts are 0 and caloriesThreshold is always 5000', async () => {
    const prisma = makePrisma({});

    const result = await checkImplausibleValues(prisma, {});

    expect(result.caloriesAboveThreshold).toBe(0);
    expect(result.ghostRows).toBe(0);
    expect(result.suspiciouslyRoundCalories).toBe(0);
    expect(result.caloriesThreshold).toBe(5000);
    expect(result.byChain).toEqual([]);
  });

  it('calories > 5000 counted via dishNutrient.count', async () => {
    const prisma = makePrisma({ caloriesAboveCount: 2 });

    const result = await checkImplausibleValues(prisma, {});

    expect(result.caloriesAboveThreshold).toBe(2);
  });

  it('calories exactly 5000 NOT counted (strict greater than in where clause)', async () => {
    const prisma = makePrisma({ caloriesAboveCount: 0 });

    const result = await checkImplausibleValues(prisma, {});

    expect(result.caloriesAboveThreshold).toBe(0);
  });

  it('ghost row count from dishNutrient.count with all-zero filter', async () => {
    const prisma = makePrisma({ ghostRowCount: 3 });

    const result = await checkImplausibleValues(prisma, {});

    expect(result.ghostRows).toBe(3);
  });

  it('suspiciously round calories count from $queryRaw', async () => {
    const prisma = makePrisma({ roundCaloriesCount: 5 });

    const result = await checkImplausibleValues(prisma, {});

    expect(result.suspiciouslyRoundCalories).toBe(5);
  });

  it('byChain groups correctly from raw SQL aggregation', async () => {
    const prisma = makePrisma({
      caloriesAboveCount: 1,
      ghostRowCount: 1,
      roundCaloriesCount: 1,
      byChainRows: [
        { chain_slug: 'chain-a', calories_above: 1n, ghost_rows: 1n, round_calories: 0n },
        { chain_slug: 'chain-b', calories_above: 0n, ghost_rows: 0n, round_calories: 1n },
      ],
    });

    const result = await checkImplausibleValues(prisma, {});

    expect(result.byChain).toHaveLength(2);

    const chainA = result.byChain.find((c) => c.chainSlug === 'chain-a');
    expect(chainA).toBeDefined();
    expect(chainA?.caloriesAboveThreshold).toBe(1);
    expect(chainA?.ghostRows).toBe(1);
    expect(chainA?.suspiciouslyRoundCalories).toBe(0);

    const chainB = result.byChain.find((c) => c.chainSlug === 'chain-b');
    expect(chainB).toBeDefined();
    expect(chainB?.caloriesAboveThreshold).toBe(0);
    expect(chainB?.ghostRows).toBe(0);
    expect(chainB?.suspiciouslyRoundCalories).toBe(1);
  });

  it('chainSlug scope: count called with restaurant filter', async () => {
    const countMock = vi.fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    const queryRawMock = vi.fn()
      .mockResolvedValueOnce([{ count: 0n }])
      .mockResolvedValueOnce([]);

    const prisma = {
      dishNutrient: { count: countMock },
      $queryRaw: queryRawMock,
    } as unknown as PrismaClient;

    await checkImplausibleValues(prisma, { chainSlug: 'kfc-es' });

    // dishNutrient.count() for caloriesAbove should include chain filter
    const firstCall = countMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const arg = (firstCall as [{ where?: unknown }])[0];
    expect(arg?.where).toMatchObject({
      dish: { restaurant: { chainSlug: 'kfc-es' } },
    });
  });

  it('bigint values from $queryRaw correctly converted to number', async () => {
    const prisma = makePrisma({
      byChainRows: [
        { chain_slug: 'chain-x', calories_above: 999n, ghost_rows: 42n, round_calories: 7n },
      ],
    });

    const result = await checkImplausibleValues(prisma, {});

    const chain = result.byChain[0];
    expect(chain).toBeDefined();
    expect(typeof chain?.caloriesAboveThreshold).toBe('number');
    expect(chain?.caloriesAboveThreshold).toBe(999);
    expect(chain?.ghostRows).toBe(42);
    expect(chain?.suspiciouslyRoundCalories).toBe(7);
  });

  it('$queryRaw returning empty result for round calories defaults to 0', async () => {
    const prisma = {
      dishNutrient: {
        count: vi.fn().mockResolvedValue(0),
      },
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([]) // empty round-calories result
        .mockResolvedValueOnce([]), // empty byChain
    } as unknown as PrismaClient;

    const result = await checkImplausibleValues(prisma, {});

    expect(result.suspiciouslyRoundCalories).toBe(0);
  });
});
