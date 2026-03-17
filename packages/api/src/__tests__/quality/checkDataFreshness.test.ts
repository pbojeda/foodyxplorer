// Unit tests for checkDataFreshness — mocked PrismaClient.
//
// Tests cover: null lastUpdated is stale, daysSinceUpdate null when lastUpdated null,
// date within threshold is fresh, date outside threshold is stale,
// chainSlug scope resolves sourceIds via $queryRaw, empty scope uses all sources.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { checkDataFreshness } from '../../quality/checkDataFreshness.js';

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86400 * 1000);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkDataFreshness()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('empty DB: totalSources: 0, staleSources: 0, staleSourcesDetail: []', async () => {
    const prisma = {
      dataSource: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;

    const result = await checkDataFreshness(prisma, {}, 90);

    expect(result.totalSources).toBe(0);
    expect(result.staleSources).toBe(0);
    expect(result.staleSourcesDetail).toEqual([]);
  });

  it('lastUpdated IS NULL → treated as stale, daysSinceUpdate is null', async () => {
    const prisma = {
      dataSource: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'src-001', name: 'Stale Source', lastUpdated: null },
        ]),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;

    const result = await checkDataFreshness(prisma, {}, 90);

    expect(result.totalSources).toBe(1);
    expect(result.staleSources).toBe(1);
    expect(result.staleSourcesDetail).toHaveLength(1);
    expect(result.staleSourcesDetail[0]?.daysSinceUpdate).toBeNull();
    expect(result.staleSourcesDetail[0]?.lastUpdated).toBeNull();
  });

  it('lastUpdated within threshold → fresh (NOT stale)', async () => {
    const recentDate = daysAgo(10); // 10 days ago, threshold is 90

    const prisma = {
      dataSource: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'src-002', name: 'Fresh Source', lastUpdated: recentDate },
        ]),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;

    const result = await checkDataFreshness(prisma, {}, 90);

    expect(result.totalSources).toBe(1);
    expect(result.staleSources).toBe(0);
    expect(result.staleSourcesDetail).toHaveLength(0);
  });

  it('lastUpdated outside threshold → stale, daysSinceUpdate > 0', async () => {
    const staleDate = daysAgo(120); // 120 days ago, threshold is 90

    const prisma = {
      dataSource: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'src-003', name: 'Old Source', lastUpdated: staleDate },
        ]),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;

    const result = await checkDataFreshness(prisma, {}, 90);

    expect(result.staleSources).toBe(1);
    expect(result.staleSourcesDetail[0]?.daysSinceUpdate).toBeGreaterThan(90);
    expect(result.staleSourcesDetail[0]?.lastUpdated).toBe(staleDate.toISOString());
  });

  it('lastUpdated one millisecond past threshold → stale', async () => {
    // 90 days + 1 second ago → clearly past the cutoff
    const staleDate = daysAgo(90 + 1 / 86400); // 90 days + 1 second ago

    const prisma = {
      dataSource: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'src-004', name: 'Boundary Source', lastUpdated: staleDate },
        ]),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;

    const result = await checkDataFreshness(prisma, {}, 90);

    expect(result.staleSources).toBe(1);
  });

  it('chainSlug scope: $queryRaw called to resolve sourceIds, then dataSource.findMany with id IN', async () => {
    const queryRawMock = vi.fn().mockResolvedValue([
      { source_id: 'src-chain-001' },
      { source_id: 'src-chain-002' },
    ]);
    const findManyMock = vi.fn().mockResolvedValue([
      { id: 'src-chain-001', name: 'Chain Source 1', lastUpdated: null },
    ]);

    const prisma = {
      dataSource: { findMany: findManyMock },
      $queryRaw: queryRawMock,
    } as unknown as PrismaClient;

    const result = await checkDataFreshness(prisma, { chainSlug: 'burger-king-es' }, 90);

    // $queryRaw called to resolve sourceIds
    expect(queryRawMock).toHaveBeenCalledOnce();

    // dataSource.findMany called with id: { in: ['src-chain-001', 'src-chain-002'] }
    const findManyCall = findManyMock.mock.calls[0];
    expect(findManyCall).toBeDefined();
    const findManyArg = (findManyCall as [{ where?: { id?: unknown } }])[0];
    expect(findManyArg?.where?.id).toMatchObject({
      in: ['src-chain-001', 'src-chain-002'],
    });

    expect(result.staleSources).toBe(1);
  });

  it('global scope: $queryRaw NOT called, dataSource.findMany without id filter', async () => {
    const queryRawMock = vi.fn().mockResolvedValue([]);
    const findManyMock = vi.fn().mockResolvedValue([]);

    const prisma = {
      dataSource: { findMany: findManyMock },
      $queryRaw: queryRawMock,
    } as unknown as PrismaClient;

    await checkDataFreshness(prisma, {}, 90);

    expect(queryRawMock).not.toHaveBeenCalled();

    // dataSource.findMany called without id IN filter
    const findManyCall = findManyMock.mock.calls[0];
    expect(findManyCall).toBeDefined();
    const findManyArg = (findManyCall as [{ where?: unknown }])[0];
    // No where clause or empty where clause
    expect(findManyArg?.where).toBeUndefined();
  });

  it('mixed sources: 1 fresh, 1 stale, 1 null → 2 stale', async () => {
    const prisma = {
      dataSource: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'src-1', name: 'Fresh', lastUpdated: daysAgo(10) },
          { id: 'src-2', name: 'Old', lastUpdated: daysAgo(100) },
          { id: 'src-3', name: 'Never Updated', lastUpdated: null },
        ]),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;

    const result = await checkDataFreshness(prisma, {}, 90);

    expect(result.totalSources).toBe(3);
    expect(result.staleSources).toBe(2);
    expect(result.staleSourcesDetail).toHaveLength(2);
  });
});
