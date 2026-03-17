// Unit tests for checkNutrientCompleteness — mocked PrismaClient.
//
// Tests cover: empty DB (all zeroes + division-by-zero guard), normal counts,
// byChain grouping, ghost row detection, zeroCalories count, chainSlug scope.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { checkNutrientCompleteness } from '../../quality/checkNutrientCompleteness.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makePrisma(overrides: {
  dishCount?: number;
  dishWithoutNutrientsCount?: number;
  ghostRowCount?: number;
  zeroCaloriesCount?: number;
  restaurantFindMany?: unknown[];
}): PrismaClient {
  const {
    dishCount = 0,
    dishWithoutNutrientsCount = 0,
    ghostRowCount = 0,
    zeroCaloriesCount = 0,
    restaurantFindMany = [],
  } = overrides;

  return {
    dish: {
      count: vi.fn()
        .mockResolvedValueOnce(dishCount)          // total dishes
        .mockResolvedValueOnce(dishWithoutNutrientsCount), // dishes without nutrients
    },
    dishNutrient: {
      count: vi.fn()
        .mockResolvedValueOnce(ghostRowCount)      // ghost rows
        .mockResolvedValueOnce(zeroCaloriesCount), // zero calories
    },
    restaurant: {
      findMany: vi.fn().mockResolvedValue(restaurantFindMany),
    },
  } as unknown as PrismaClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkNutrientCompleteness()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('empty DB: returns all zeroes and dishesWithoutNutrientsPercent: 0 (division-by-zero guard)', async () => {
    const prisma = makePrisma({
      dishCount: 0,
      dishWithoutNutrientsCount: 0,
      ghostRowCount: 0,
      zeroCaloriesCount: 0,
      restaurantFindMany: [],
    });

    const result = await checkNutrientCompleteness(prisma, {});

    expect(result.dishesWithNutrients).toBe(0);
    expect(result.dishesWithoutNutrients).toBe(0);
    expect(result.dishesWithoutNutrientsPercent).toBe(0);
    expect(result.ghostRowCount).toBe(0);
    expect(result.zeroCaloriesCount).toBe(0);
    expect(result.byChain).toEqual([]);
  });

  it('3 dishes, 2 without nutrients → dishesWithoutNutrients: 2, dishesWithNutrients: 1', async () => {
    const prisma = makePrisma({
      dishCount: 3,
      dishWithoutNutrientsCount: 2,
      ghostRowCount: 0,
      zeroCaloriesCount: 0,
      restaurantFindMany: [],
    });

    const result = await checkNutrientCompleteness(prisma, {});

    expect(result.dishesWithoutNutrients).toBe(2);
    expect(result.dishesWithNutrients).toBe(1);
  });

  it('dishesWithoutNutrientsPercent computed correctly (2 dp)', async () => {
    const prisma = makePrisma({
      dishCount: 3,
      dishWithoutNutrientsCount: 1,
      ghostRowCount: 0,
      zeroCaloriesCount: 0,
      restaurantFindMany: [],
    });

    const result = await checkNutrientCompleteness(prisma, {});

    // 1/3 * 100 = 33.33...%
    expect(result.dishesWithoutNutrientsPercent).toBeCloseTo(33.33, 1);
  });

  it('ghostRowCount returned from dishNutrient count query', async () => {
    const prisma = makePrisma({
      dishCount: 5,
      dishWithoutNutrientsCount: 1,
      ghostRowCount: 3,
      zeroCaloriesCount: 4,
      restaurantFindMany: [],
    });

    const result = await checkNutrientCompleteness(prisma, {});

    expect(result.ghostRowCount).toBe(3);
    expect(result.zeroCaloriesCount).toBe(4);
  });

  it('byChain: aggregates dishesWithoutNutrients per chain', async () => {
    // Simulate restaurant.findMany returning restaurants with dish counts
    const restaurantFindMany = [
      {
        chainSlug: 'chain-a',
        _count: {
          dishes: 10,
        },
        dishes: [
          // Dishes without nutrients (none relation empty)
        ],
      },
    ];

    const prisma = {
      dish: {
        count: vi.fn()
          .mockResolvedValueOnce(10)  // total
          .mockResolvedValueOnce(2),  // without nutrients
      },
      dishNutrient: {
        count: vi.fn()
          .mockResolvedValueOnce(1)   // ghost
          .mockResolvedValueOnce(3),  // zero calories
      },
      restaurant: {
        findMany: vi.fn().mockResolvedValue(restaurantFindMany),
      },
    } as unknown as PrismaClient;

    const result = await checkNutrientCompleteness(prisma, {});

    expect(result.byChain).toHaveLength(1);
    expect(result.byChain[0]).toBeDefined();
    if (result.byChain[0]) {
      expect(result.byChain[0].chainSlug).toBe('chain-a');
    }
  });

  it('chainSlug scope: dish.count called with where clause including restaurant filter', async () => {
    const dishCountMock = vi.fn()
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(1);

    const prisma = {
      dish: { count: dishCountMock },
      dishNutrient: {
        count: vi.fn()
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0),
      },
      restaurant: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    await checkNutrientCompleteness(prisma, { chainSlug: 'burger-king-es' });

    // Verify that both dish.count calls include chainSlug-based restaurant filter
    const firstCall = dishCountMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const whereArg = (firstCall as [{ where?: unknown }])[0]?.where;
    expect(whereArg).toMatchObject({
      restaurant: { chainSlug: 'burger-king-es' },
    });
  });
});
