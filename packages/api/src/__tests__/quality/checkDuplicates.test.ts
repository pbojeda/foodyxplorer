// Unit tests for checkDuplicates — mocked PrismaClient.
//
// Tests cover: empty DB (no duplicates), duplicate group detection,
// dishIds population via batch query, sorting (count DESC then name ASC),
// chainSlug scope.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { checkDuplicates } from '../../quality/checkDuplicates.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Build a groupBy result row */
function makeGroupByRow(name: string, restaurantId: string, sourceId: string, count: number) {
  return {
    name,
    restaurantId,
    sourceId,
    _count: { _all: count },
  };
}

/** Build a dish row for the batch findMany result (includes composite key fields) */
function makeDishRow(id: string, name: string, restaurantId: string, sourceId: string) {
  return { id, name, restaurantId, sourceId };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkDuplicates()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('empty DB: duplicateGroupCount: 0, totalDuplicateDishes: 0, groups: []', async () => {
    const prisma = {
      dish: {
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([]),
      },
      restaurant: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    const result = await checkDuplicates(prisma, {});

    expect(result.duplicateGroupCount).toBe(0);
    expect(result.totalDuplicateDishes).toBe(0);
    expect(result.groups).toEqual([]);
  });

  it('one duplicate group of 3 dishes: duplicateGroupCount: 1, totalDuplicateDishes: 3', async () => {
    const groupRow = makeGroupByRow('Big Mac', 'rest-001', 'src-001', 3);

    const prisma = {
      dish: {
        groupBy: vi.fn().mockResolvedValue([groupRow]),
        findMany: vi.fn().mockResolvedValue([
          makeDishRow('dish-001', 'Big Mac', 'rest-001', 'src-001'),
          makeDishRow('dish-002', 'Big Mac', 'rest-001', 'src-001'),
          makeDishRow('dish-003', 'Big Mac', 'rest-001', 'src-001'),
        ]),
      },
      restaurant: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'rest-001', chainSlug: 'mcdonalds-es' },
        ]),
      },
    } as unknown as PrismaClient;

    const result = await checkDuplicates(prisma, {});

    expect(result.duplicateGroupCount).toBe(1);
    expect(result.totalDuplicateDishes).toBe(3);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.count).toBe(3);
    expect(result.groups[0]?.dishIds).toEqual(['dish-001', 'dish-002', 'dish-003']);
  });

  it('groups sorted by count DESC, then name ASC', async () => {
    const groupRows = [
      makeGroupByRow('Alpha Dish', 'rest-001', 'src-001', 2),
      makeGroupByRow('Zeta Dish', 'rest-001', 'src-001', 4),
      makeGroupByRow('Beta Dish', 'rest-001', 'src-001', 2),
    ];

    // Batch findMany returns all dishes at once
    const prisma = {
      dish: {
        groupBy: vi.fn().mockResolvedValue(groupRows),
        findMany: vi.fn().mockResolvedValue([
          makeDishRow('d1', 'Alpha Dish', 'rest-001', 'src-001'),
          makeDishRow('d2', 'Alpha Dish', 'rest-001', 'src-001'),
          makeDishRow('d3', 'Zeta Dish', 'rest-001', 'src-001'),
          makeDishRow('d4', 'Zeta Dish', 'rest-001', 'src-001'),
          makeDishRow('d5', 'Zeta Dish', 'rest-001', 'src-001'),
          makeDishRow('d6', 'Zeta Dish', 'rest-001', 'src-001'),
          makeDishRow('d7', 'Beta Dish', 'rest-001', 'src-001'),
          makeDishRow('d8', 'Beta Dish', 'rest-001', 'src-001'),
        ]),
      },
      restaurant: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'rest-001', chainSlug: 'test-chain' },
        ]),
      },
    } as unknown as PrismaClient;

    const result = await checkDuplicates(prisma, {});

    expect(result.groups[0]?.name).toBe('Zeta Dish'); // count: 4 → first
    expect(result.groups[1]?.name).toBe('Alpha Dish'); // count: 2, A before B → second
    expect(result.groups[2]?.name).toBe('Beta Dish');  // count: 2, B → third
  });

  it('dishIds correctly indexed from batch query by composite key', async () => {
    const groupRow = makeGroupByRow('Whopper', 'rest-002', 'src-002', 2);

    const prisma = {
      dish: {
        groupBy: vi.fn().mockResolvedValue([groupRow]),
        findMany: vi.fn().mockResolvedValue([
          makeDishRow('dish-aaa', 'Whopper', 'rest-002', 'src-002'),
          makeDishRow('dish-bbb', 'Whopper', 'rest-002', 'src-002'),
        ]),
      },
      restaurant: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'rest-002', chainSlug: 'burger-king-es' },
        ]),
      },
    } as unknown as PrismaClient;

    const result = await checkDuplicates(prisma, {});

    expect(result.groups[0]?.dishIds).toEqual(['dish-aaa', 'dish-bbb']);
    expect(result.groups[0]?.chainSlug).toBe('burger-king-es');
  });

  it('chainSlug scope: groupBy called with restaurant filter', async () => {
    const groupByMock = vi.fn().mockResolvedValue([]);
    const prisma = {
      dish: {
        groupBy: groupByMock,
        findMany: vi.fn().mockResolvedValue([]),
      },
      restaurant: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    await checkDuplicates(prisma, { chainSlug: 'kfc-es' });

    const call = groupByMock.mock.calls[0];
    expect(call).toBeDefined();
    const arg = (call as [{ where?: unknown }])[0];
    expect(arg?.where).toMatchObject({
      restaurant: { chainSlug: 'kfc-es' },
    });
  });

  it('full groups returned without cap (cap is applied at route level)', async () => {
    // 55 duplicate groups
    const groupRows = Array.from({ length: 55 }, (_, i) =>
      makeGroupByRow(`Dish ${String(i).padStart(3, '0')}`, 'rest-001', 'src-001', 2),
    );

    // Batch findMany returns 110 dishes (55 groups x 2 each)
    const allDishes = groupRows.flatMap((row) => [
      makeDishRow(`d${row.name}-1`, row.name, 'rest-001', 'src-001'),
      makeDishRow(`d${row.name}-2`, row.name, 'rest-001', 'src-001'),
    ]);

    const prisma = {
      dish: {
        groupBy: vi.fn().mockResolvedValue(groupRows),
        findMany: vi.fn().mockResolvedValue(allDishes),
      },
      restaurant: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'rest-001', chainSlug: 'test-chain' },
        ]),
      },
    } as unknown as PrismaClient;

    const result = await checkDuplicates(prisma, {});

    expect(result.groups).toHaveLength(55); // no cap here
    expect(result.duplicateGroupCount).toBe(55);
    expect(result.totalDuplicateDishes).toBe(110); // 55 * 2
  });
});
