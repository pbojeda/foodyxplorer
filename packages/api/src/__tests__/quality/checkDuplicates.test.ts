// Unit tests for checkDuplicates — mocked PrismaClient.
//
// Tests cover: empty DB (no duplicates), duplicate group detection,
// dishIds population, sorting (count DESC then name ASC), chainSlug scope.

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

/** Build a dish.findMany result row (for dishIds) */
function makeDishRow(id: string) {
  return { id };
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
          makeDishRow('dish-001'),
          makeDishRow('dish-002'),
          makeDishRow('dish-003'),
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

    const prisma = {
      dish: {
        groupBy: vi.fn().mockResolvedValue(groupRows),
        findMany: vi.fn()
          .mockResolvedValueOnce([makeDishRow('d1'), makeDishRow('d2')])        // Alpha Dish dishIds
          .mockResolvedValueOnce([makeDishRow('d3'), makeDishRow('d4'), makeDishRow('d5'), makeDishRow('d6')]) // Zeta Dish dishIds
          .mockResolvedValueOnce([makeDishRow('d7'), makeDishRow('d8')]),       // Beta Dish dishIds
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

  it('dishIds array populated from second query', async () => {
    const groupRow = makeGroupByRow('Whopper', 'rest-002', 'src-002', 2);

    const prisma = {
      dish: {
        groupBy: vi.fn().mockResolvedValue([groupRow]),
        findMany: vi.fn().mockResolvedValue([
          makeDishRow('dish-aaa'),
          makeDishRow('dish-bbb'),
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

    const prisma = {
      dish: {
        groupBy: vi.fn().mockResolvedValue(groupRows),
        findMany: vi.fn().mockResolvedValue([makeDishRow('d1'), makeDishRow('d2')]),
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
