// Unit tests for F072 — cookingProfileService.ts
//
// Tests: getCookingProfile with mocked prisma.cookingProfile.findFirst
// Scenarios:
//   - Exact match found → returns { profile }
//   - Exact miss, group wildcard found → returns { profile }
//   - Both miss → null
//   - yieldFactor <= 0 → returns { error: 'invalid_yield_factor' }
//   - Called with correct where clauses in both queries

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCookingProfile } from '../estimation/cookingProfileService.js';
import type { CookingProfileRow } from '../estimation/cookingProfileService.js';

// ---------------------------------------------------------------------------
// Mock PrismaClient
// ---------------------------------------------------------------------------

const mockFindFirst = vi.fn();
const mockPrisma = {
  cookingProfile: {
    findFirst: mockFindFirst,
  },
} as unknown as import('@prisma/client').PrismaClient;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Helper: create a minimal Prisma.Decimal mock that Number() converts correctly.
// Prisma Decimal implements valueOf() so Number() works; we replicate that here.
function makeDecimal(value: number): import('@prisma/client').Prisma.Decimal {
  return {
    valueOf: () => value,
    toNumber: () => value,
    toString: () => String(value),
    [Symbol.toPrimitive]: (_hint: string) => value,
  } as unknown as import('@prisma/client').Prisma.Decimal;
}

const EXACT_PROFILE_ROW: CookingProfileRow = {
  id: 'e0000000-0001-4000-0000-000000000001',
  foodGroup: 'grains',
  foodName: 'rice',
  cookingMethod: 'boiled',
  yieldFactor: makeDecimal(2.8),
  fatAbsorption: null,
  source: 'USDA retention factors',
  createdAt: new Date('2026-04-03'),
  updatedAt: new Date('2026-04-03'),
};

const WILDCARD_PROFILE_ROW: CookingProfileRow = {
  id: 'e0000000-0002-4000-0000-000000000001',
  foodGroup: 'grains',
  foodName: '*',
  cookingMethod: 'boiled',
  yieldFactor: makeDecimal(2.5),
  fatAbsorption: null,
  source: 'USDA retention factors',
  createdAt: new Date('2026-04-03'),
  updatedAt: new Date('2026-04-03'),
};

const INVALID_YIELD_ROW: CookingProfileRow = {
  id: 'e0000000-0003-4000-0000-000000000001',
  foodGroup: 'grains',
  foodName: 'rice',
  cookingMethod: 'boiled',
  yieldFactor: makeDecimal(0),
  fatAbsorption: null,
  source: 'USDA retention factors',
  createdAt: new Date('2026-04-03'),
  updatedAt: new Date('2026-04-03'),
};

const NEGATIVE_YIELD_ROW: CookingProfileRow = {
  id: 'e0000000-0004-4000-0000-000000000001',
  foodGroup: 'grains',
  foodName: 'rice',
  cookingMethod: 'boiled',
  yieldFactor: makeDecimal(-1.5),
  fatAbsorption: null,
  source: 'USDA retention factors',
  createdAt: new Date('2026-04-03'),
  updatedAt: new Date('2026-04-03'),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getCookingProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { profile } when exact match found on first query', async () => {
    // Arrange
    mockFindFirst.mockResolvedValueOnce(EXACT_PROFILE_ROW);

    // Act
    const result = await getCookingProfile(mockPrisma, 'grains', 'rice', 'boiled');

    // Assert
    expect(result).toEqual({ profile: EXACT_PROFILE_ROW });
    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { foodGroup: 'grains', foodName: 'rice', cookingMethod: 'boiled' },
    });
  });

  it('returns { profile } from group wildcard when exact match misses', async () => {
    // Arrange — first call misses (exact), second hits (wildcard)
    mockFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(WILDCARD_PROFILE_ROW);

    // Act
    const result = await getCookingProfile(mockPrisma, 'grains', 'rice', 'boiled');

    // Assert
    expect(result).toEqual({ profile: WILDCARD_PROFILE_ROW });
    expect(mockFindFirst).toHaveBeenCalledTimes(2);
    expect(mockFindFirst).toHaveBeenNthCalledWith(1, {
      where: { foodGroup: 'grains', foodName: 'rice', cookingMethod: 'boiled' },
    });
    expect(mockFindFirst).toHaveBeenNthCalledWith(2, {
      where: { foodGroup: 'grains', foodName: '*', cookingMethod: 'boiled' },
    });
  });

  it('returns null when both exact and wildcard queries miss', async () => {
    // Arrange
    mockFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    // Act
    const result = await getCookingProfile(mockPrisma, 'grains', 'rice', 'boiled');

    // Assert
    expect(result).toBeNull();
    expect(mockFindFirst).toHaveBeenCalledTimes(2);
  });

  it('does not execute second query when exact match is found', async () => {
    // Arrange
    mockFindFirst.mockResolvedValueOnce(EXACT_PROFILE_ROW);

    // Act
    await getCookingProfile(mockPrisma, 'grains', 'rice', 'boiled');

    // Assert — only one DB call
    expect(mockFindFirst).toHaveBeenCalledTimes(1);
  });

  it('returns { error: "invalid_yield_factor" } when yieldFactor is 0', async () => {
    // Arrange
    mockFindFirst.mockResolvedValueOnce(INVALID_YIELD_ROW);

    // Act
    const result = await getCookingProfile(mockPrisma, 'grains', 'rice', 'boiled');

    // Assert
    expect(result).toEqual({ error: 'invalid_yield_factor' });
  });

  it('returns { error: "invalid_yield_factor" } when yieldFactor is negative', async () => {
    // Arrange
    mockFindFirst.mockResolvedValueOnce(NEGATIVE_YIELD_ROW);

    // Act
    const result = await getCookingProfile(mockPrisma, 'grains', 'rice', 'boiled');

    // Assert
    expect(result).toEqual({ error: 'invalid_yield_factor' });
  });

  it('also validates yieldFactor on wildcard fallback row', async () => {
    // Arrange — exact misses, wildcard has zero yieldFactor
    const invalidWildcard: CookingProfileRow = {
      ...WILDCARD_PROFILE_ROW,
      yieldFactor: makeDecimal(0),
    };
    mockFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(invalidWildcard);

    // Act
    const result = await getCookingProfile(mockPrisma, 'grains', 'unknown-food', 'boiled');

    // Assert
    expect(result).toEqual({ error: 'invalid_yield_factor' });
  });
});
