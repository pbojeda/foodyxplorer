// Unit tests for checkConfidenceDistribution — mocked PrismaClient.
//
// Tests cover: empty DB, global counts by confidence level and estimation method,
// byChain breakdown (aggregating multiple restaurants per chain), chainSlug scope.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { checkConfidenceDistribution } from '../../quality/checkConfidenceDistribution.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkConfidenceDistribution()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('empty DB: all global counts are 0, byChain is empty', async () => {
    const prisma = {
      dish: {
        groupBy: vi.fn()
          .mockResolvedValueOnce([])  // confidence level groupBy
          .mockResolvedValueOnce([])  // estimation method groupBy
          .mockResolvedValueOnce([])  // byChain confidence
          .mockResolvedValueOnce([]), // byChain estimation
      },
      restaurant: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    const result = await checkConfidenceDistribution(prisma, {});

    expect(result.global.high).toBe(0);
    expect(result.global.medium).toBe(0);
    expect(result.global.low).toBe(0);
    expect(result.byEstimationMethod.official).toBe(0);
    expect(result.byEstimationMethod.scraped).toBe(0);
    expect(result.byEstimationMethod.ingredients).toBe(0);
    expect(result.byEstimationMethod.extrapolation).toBe(0);
    expect(result.byChain).toEqual([]);
  });

  it('global confidence level counts aggregated correctly', async () => {
    const prisma = {
      dish: {
        groupBy: vi.fn()
          .mockResolvedValueOnce([
            { confidenceLevel: 'high', _count: { _all: 10 } },
            { confidenceLevel: 'medium', _count: { _all: 5 } },
            { confidenceLevel: 'low', _count: { _all: 2 } },
          ])
          .mockResolvedValueOnce([
            { estimationMethod: 'official', _count: { _all: 8 } },
            { estimationMethod: 'scraped', _count: { _all: 6 } },
            { estimationMethod: 'ingredients', _count: { _all: 2 } },
            { estimationMethod: 'extrapolation', _count: { _all: 1 } },
          ])
          .mockResolvedValueOnce([]) // byChain confidence
          .mockResolvedValueOnce([]), // byChain estimation
      },
      restaurant: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    const result = await checkConfidenceDistribution(prisma, {});

    expect(result.global.high).toBe(10);
    expect(result.global.medium).toBe(5);
    expect(result.global.low).toBe(2);
    expect(result.byEstimationMethod.official).toBe(8);
    expect(result.byEstimationMethod.scraped).toBe(6);
    expect(result.byEstimationMethod.ingredients).toBe(2);
    expect(result.byEstimationMethod.extrapolation).toBe(1);
  });

  it('byChain breakdown: two restaurants with same chainSlug aggregated into one entry', async () => {
    const prisma = {
      dish: {
        groupBy: vi.fn()
          .mockResolvedValueOnce([]) // global confidence
          .mockResolvedValueOnce([]) // global estimation
          .mockResolvedValueOnce([
            { confidenceLevel: 'high', restaurantId: 'rest-001', _count: { _all: 5 } },
            { confidenceLevel: 'high', restaurantId: 'rest-002', _count: { _all: 3 } }, // same chain
            { confidenceLevel: 'medium', restaurantId: 'rest-001', _count: { _all: 2 } },
          ])
          .mockResolvedValueOnce([
            { estimationMethod: 'scraped', restaurantId: 'rest-001', _count: { _all: 7 } },
            { estimationMethod: 'official', restaurantId: 'rest-002', _count: { _all: 3 } },
          ]),
      },
      restaurant: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'rest-001', chainSlug: 'burger-king-es' },
          { id: 'rest-002', chainSlug: 'burger-king-es' }, // same chain, 2 restaurants
        ]),
      },
    } as unknown as PrismaClient;

    const result = await checkConfidenceDistribution(prisma, {});

    expect(result.byChain).toHaveLength(1);
    const chainEntry = result.byChain[0];
    expect(chainEntry?.chainSlug).toBe('burger-king-es');
    expect(chainEntry?.high).toBe(8);    // 5 + 3
    expect(chainEntry?.medium).toBe(2);
    expect(chainEntry?.low).toBe(0);
    expect(chainEntry?.byEstimationMethod.scraped).toBe(7);
    expect(chainEntry?.byEstimationMethod.official).toBe(3);
  });

  it('chainSlug scope: dish.groupBy called with restaurant filter', async () => {
    const groupByMock = vi.fn()
      .mockResolvedValue([]);
    const prisma = {
      dish: { groupBy: groupByMock },
      restaurant: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    await checkConfidenceDistribution(prisma, { chainSlug: 'subway-es' });

    // All four groupBy calls should include chainSlug scope
    for (const call of groupByMock.mock.calls) {
      const arg = (call as [{ where?: unknown }])[0];
      expect(arg?.where).toMatchObject({
        restaurant: { chainSlug: 'subway-es' },
      });
    }
  });
});
