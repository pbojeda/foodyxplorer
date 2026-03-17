// Unit tests for checkDataGaps — mocked PrismaClient.
//
// Tests cover: empty DB, portionGrams/priceEur counts, restaurantsWithoutDishes
// only in global scope, chainSlug scope excludes restaurantsWithoutDishes.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { checkDataGaps } from '../../quality/checkDataGaps.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makePrisma(overrides: {
  dishWithoutPortionCount?: number;
  dishWithoutPriceCount?: number;
  restaurantsWithoutDishesCount?: number;
}): PrismaClient {
  const {
    dishWithoutPortionCount = 0,
    dishWithoutPriceCount = 0,
    restaurantsWithoutDishesCount = 0,
  } = overrides;

  return {
    dish: {
      count: vi.fn()
        .mockResolvedValueOnce(dishWithoutPortionCount)
        .mockResolvedValueOnce(dishWithoutPriceCount),
    },
    restaurant: {
      count: vi.fn().mockResolvedValue(restaurantsWithoutDishesCount),
    },
  } as unknown as PrismaClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkDataGaps()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('empty DB: all counts are 0', async () => {
    const prisma = makePrisma({
      dishWithoutPortionCount: 0,
      dishWithoutPriceCount: 0,
      restaurantsWithoutDishesCount: 0,
    });

    const result = await checkDataGaps(prisma, {});

    expect(result.dishesWithoutPortionGrams).toBe(0);
    expect(result.dishesWithoutPriceEur).toBe(0);
    expect(result.restaurantsWithoutDishes).toBe(0);
  });

  it('dishesWithoutPortionGrams counted correctly', async () => {
    const prisma = makePrisma({
      dishWithoutPortionCount: 7,
      dishWithoutPriceCount: 3,
      restaurantsWithoutDishesCount: 1,
    });

    const result = await checkDataGaps(prisma, {});

    expect(result.dishesWithoutPortionGrams).toBe(7);
  });

  it('dishesWithoutPriceEur counted correctly', async () => {
    const prisma = makePrisma({
      dishWithoutPortionCount: 2,
      dishWithoutPriceCount: 5,
      restaurantsWithoutDishesCount: 0,
    });

    const result = await checkDataGaps(prisma, {});

    expect(result.dishesWithoutPriceEur).toBe(5);
  });

  it('restaurantsWithoutDishes: global scope queries restaurant count', async () => {
    const restaurantCountMock = vi.fn().mockResolvedValue(2);
    const prisma = {
      dish: {
        count: vi.fn()
          .mockResolvedValueOnce(3)
          .mockResolvedValueOnce(4),
      },
      restaurant: { count: restaurantCountMock },
    } as unknown as PrismaClient;

    const result = await checkDataGaps(prisma, {});

    expect(result.restaurantsWithoutDishes).toBe(2);
    expect(restaurantCountMock).toHaveBeenCalledOnce();
  });

  it('chainSlug scope: restaurantsWithoutDishes returns 0 (not queried)', async () => {
    const restaurantCountMock = vi.fn().mockResolvedValue(999);
    const prisma = {
      dish: {
        count: vi.fn()
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0),
      },
      restaurant: { count: restaurantCountMock },
    } as unknown as PrismaClient;

    const result = await checkDataGaps(prisma, { chainSlug: 'burger-king-es' });

    expect(result.restaurantsWithoutDishes).toBe(0);
    // restaurant.count should NOT be called when chainSlug is scoped
    expect(restaurantCountMock).not.toHaveBeenCalled();
  });

  it('chainSlug scope: dish.count called with restaurant filter', async () => {
    const dishCountMock = vi.fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    const prisma = {
      dish: { count: dishCountMock },
      restaurant: { count: vi.fn().mockResolvedValue(0) },
    } as unknown as PrismaClient;

    await checkDataGaps(prisma, { chainSlug: 'mcdonalds-es' });

    const firstCall = dishCountMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const whereArg = (firstCall as [{ where?: unknown }])[0]?.where;
    expect(whereArg).toMatchObject({
      restaurant: { chainSlug: 'mcdonalds-es' },
    });
  });
});
