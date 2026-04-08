import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// Mock reverseSearchDishes before importing the route
vi.mock('../estimation/reverseSearch.js', () => ({
  reverseSearchDishes: vi.fn(),
}));

import { registerErrorHandler } from '../errors/errorHandler.js';
import { reverseSearchRoutes } from '../routes/reverseSearch.js';
import { reverseSearchDishes } from '../estimation/reverseSearch.js';

const mockReverseSearch = vi.mocked(reverseSearchDishes);

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let app: FastifyInstance;

// Minimal mock db + prisma
const mockDb = {} as never;
const mockPrisma = {
  restaurant: {
    findFirst: vi.fn(),
  },
} as never;

beforeAll(async () => {
  app = Fastify();
  registerErrorHandler(app);
  await app.register(reverseSearchRoutes, { db: mockDb, prisma: mockPrisma });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /reverse-search', () => {
  it('returns 200 with valid params', async () => {
    (mockPrisma as { restaurant: { findFirst: ReturnType<typeof vi.fn> } }).restaurant.findFirst.mockResolvedValueOnce({ id: '1', chainSlug: 'burger-king' });

    mockReverseSearch.mockResolvedValueOnce({
      chainSlug: 'burger-king',
      chainName: 'Burger King',
      maxCalories: 600,
      minProtein: null,
      results: [
        {
          name: 'Whopper Jr',
          nameEs: null,
          calories: 310,
          proteins: 16,
          fats: 18,
          carbohydrates: 27,
          portionGrams: 150,
          proteinDensity: 5.16,
        },
      ],
      totalMatches: 1,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=burger-king&maxCalories=600',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data.chainSlug).toBe('burger-king');
    expect(body.data.results).toHaveLength(1);
  });

  it('returns 400 when chainSlug is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?maxCalories=600',
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when maxCalories is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=burger-king',
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when maxCalories < 100', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=bk&maxCalories=50',
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for unknown chain', async () => {
    (mockPrisma as { restaurant: { findFirst: ReturnType<typeof vi.fn> } }).restaurant.findFirst.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=unknown-chain&maxCalories=600',
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('CHAIN_NOT_FOUND');
  });

  it('returns 200 with empty results when no dishes match', async () => {
    (mockPrisma as { restaurant: { findFirst: ReturnType<typeof vi.fn> } }).restaurant.findFirst.mockResolvedValueOnce({ id: '1', chainSlug: 'burger-king' });

    mockReverseSearch.mockResolvedValueOnce({
      chainSlug: 'burger-king',
      chainName: 'Burger King',
      maxCalories: 100,
      minProtein: null,
      results: [],
      totalMatches: 0,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=burger-king&maxCalories=100',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.results).toHaveLength(0);
    expect(body.data.totalMatches).toBe(0);
  });

  it('passes minProtein and limit when provided', async () => {
    (mockPrisma as { restaurant: { findFirst: ReturnType<typeof vi.fn> } }).restaurant.findFirst.mockResolvedValueOnce({ id: '1', chainSlug: 'burger-king' });

    mockReverseSearch.mockResolvedValueOnce({
      chainSlug: 'burger-king',
      chainName: 'Burger King',
      maxCalories: 600,
      minProtein: 30,
      results: [],
      totalMatches: 0,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=burger-king&maxCalories=600&minProtein=30&limit=10',
    });

    expect(res.statusCode).toBe(200);
    expect(mockReverseSearch).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        chainSlug: 'burger-king',
        maxCalories: 600,
        minProtein: 30,
        limit: 10,
      }),
    );
  });
});
