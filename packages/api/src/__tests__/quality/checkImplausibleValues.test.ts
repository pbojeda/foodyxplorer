// Unit tests for checkImplausibleValues — mocked PrismaClient.
//
// Tests cover: empty DB, calories above threshold detection, ghost rows,
// suspiciously round calories, Decimal.toNumber() conversion, byChain grouping.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { checkImplausibleValues } from '../../quality/checkImplausibleValues.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Simulate Prisma Decimal object */
function decimal(value: number) {
  return { toNumber: () => value };
}

function makeDishNutrientRow(overrides: {
  calories?: unknown;
  proteins?: unknown;
  carbohydrates?: unknown;
  fats?: unknown;
  chainSlug?: string;
}) {
  return {
    calories: decimal(overrides.calories as number ?? 0),
    proteins: decimal(overrides.proteins as number ?? 0),
    carbohydrates: decimal(overrides.carbohydrates as number ?? 0),
    fats: decimal(overrides.fats as number ?? 0),
    dish: {
      restaurant: {
        chainSlug: overrides.chainSlug ?? 'test-chain',
      },
    },
  };
}

function makePrisma(rows: ReturnType<typeof makeDishNutrientRow>[]): PrismaClient {
  return {
    dishNutrient: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
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
    const prisma = makePrisma([]);

    const result = await checkImplausibleValues(prisma, {});

    expect(result.caloriesAboveThreshold).toBe(0);
    expect(result.ghostRows).toBe(0);
    expect(result.suspiciouslyRoundCalories).toBe(0);
    expect(result.caloriesThreshold).toBe(5000);
    expect(result.byChain).toEqual([]);
  });

  it('calories > 5000 counted in caloriesAboveThreshold', async () => {
    const prisma = makePrisma([
      makeDishNutrientRow({ calories: 5001, proteins: 10, carbohydrates: 100, fats: 20 }),
      makeDishNutrientRow({ calories: 6000, proteins: 20, carbohydrates: 200, fats: 30 }),
    ]);

    const result = await checkImplausibleValues(prisma, {});

    expect(result.caloriesAboveThreshold).toBe(2);
  });

  it('calories exactly 5000 NOT counted in caloriesAboveThreshold (strict greater than)', async () => {
    const prisma = makePrisma([
      makeDishNutrientRow({ calories: 5000, proteins: 50, carbohydrates: 400, fats: 150 }),
    ]);

    const result = await checkImplausibleValues(prisma, {});

    expect(result.caloriesAboveThreshold).toBe(0);
  });

  it('ghost row: all four macros === 0 → counted in ghostRows', async () => {
    const prisma = makePrisma([
      makeDishNutrientRow({ calories: 0, proteins: 0, carbohydrates: 0, fats: 0 }),
    ]);

    const result = await checkImplausibleValues(prisma, {});

    expect(result.ghostRows).toBe(1);
  });

  it('single zero macro is NOT a ghost row (e.g. pure water: 0 carbs, 0 fat, 0 proteins)', async () => {
    const prisma = makePrisma([
      makeDishNutrientRow({ calories: 100, proteins: 0, carbohydrates: 0, fats: 0 }),
    ]);

    const result = await checkImplausibleValues(prisma, {});

    expect(result.ghostRows).toBe(0);
  });

  it('suspiciously round calories: >= 100 AND % 100 === 0 → flagged', async () => {
    const prisma = makePrisma([
      makeDishNutrientRow({ calories: 200, proteins: 10, carbohydrates: 30, fats: 5 }),
      makeDishNutrientRow({ calories: 500, proteins: 20, carbohydrates: 60, fats: 10 }),
    ]);

    const result = await checkImplausibleValues(prisma, {});

    expect(result.suspiciouslyRoundCalories).toBe(2);
  });

  it('round calories < 100 (e.g. 50 kcal) NOT flagged as suspiciously round', async () => {
    const prisma = makePrisma([
      makeDishNutrientRow({ calories: 50, proteins: 2, carbohydrates: 8, fats: 1 }),
    ]);

    const result = await checkImplausibleValues(prisma, {});

    expect(result.suspiciouslyRoundCalories).toBe(0);
  });

  it('Decimal.toNumber() applied before comparisons', async () => {
    // 5001.00 as a Decimal-like object (has toNumber())
    const prisma = makePrisma([
      makeDishNutrientRow({ calories: 5001, proteins: 10, carbohydrates: 100, fats: 20 }),
    ]);

    const result = await checkImplausibleValues(prisma, {});

    expect(result.caloriesAboveThreshold).toBe(1);
  });

  it('byChain groups correctly: 2 rows from chain-a, 1 from chain-b', async () => {
    const prisma = makePrisma([
      makeDishNutrientRow({ calories: 5001, proteins: 10, carbohydrates: 100, fats: 20, chainSlug: 'chain-a' }),
      makeDishNutrientRow({ calories: 0, proteins: 0, carbohydrates: 0, fats: 0, chainSlug: 'chain-a' }),
      makeDishNutrientRow({ calories: 200, proteins: 5, carbohydrates: 30, fats: 8, chainSlug: 'chain-b' }),
    ]);

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

  it('chainSlug scope: findMany called with correct where clause', async () => {
    const findManyMock = vi.fn().mockResolvedValue([]);
    const prisma = {
      dishNutrient: { findMany: findManyMock },
    } as unknown as PrismaClient;

    await checkImplausibleValues(prisma, { chainSlug: 'kfc-es' });

    const call = findManyMock.mock.calls[0];
    expect(call).toBeDefined();
    const arg = (call as [{ where?: unknown }])[0];
    expect(arg?.where).toMatchObject({
      dish: { restaurant: { chainSlug: 'kfc-es' } },
    });
  });
});
