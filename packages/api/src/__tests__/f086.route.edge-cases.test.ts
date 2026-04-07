// F086 — Edge-case tests for GET /reverse-search route (QA Engineer pass).
//
// Covers spec-compliance gaps not tested in f086.reverse-search.route.test.ts:
//   - Exact boundary values for all numeric params (100, 3000, 0, 200, 1, 20)
//   - chainSlug format validation (uppercase, spaces, underscores, length)
//   - 400 error response shape
//   - 404 error response shape (success:false + code)
//   - Prisma DB error → 500 (no try/catch in route handler)
//   - Default limit=5 applied when omitted

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

vi.mock('../estimation/reverseSearch.js', () => ({
  reverseSearchDishes: vi.fn(),
}));

import { reverseSearchRoutes } from '../routes/reverseSearch.js';
import { reverseSearchDishes } from '../estimation/reverseSearch.js';

const mockSearch = vi.mocked(reverseSearchDishes);

let app: FastifyInstance;
const mockDb = {} as never;
const mockPrisma = {
  restaurant: { findFirst: vi.fn() },
} as never;

const emptyResult = {
  chainSlug: 'bk',
  chainName: 'BK',
  maxCalories: 600,
  minProtein: null,
  results: [],
  totalMatches: 0,
};

beforeAll(async () => {
  app = Fastify();
  await app.register(reverseSearchRoutes, { db: mockDb, prisma: mockPrisma });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Numeric parameter boundary values
// ---------------------------------------------------------------------------

describe('GET /reverse-search — maxCalories boundaries', () => {
  it('accepts maxCalories=100 (exact minimum)', async () => {
    (mockPrisma as { restaurant: { findFirst: ReturnType<typeof vi.fn> } })
      .restaurant.findFirst.mockResolvedValueOnce({ id: '1' });
    mockSearch.mockResolvedValueOnce({ ...emptyResult, maxCalories: 100 });

    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=bk&maxCalories=100',
    });

    expect(res.statusCode).toBe(200);
  });

  it('rejects maxCalories=99 (one below minimum)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=bk&maxCalories=99',
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
  });

  it('accepts maxCalories=3000 (exact maximum)', async () => {
    (mockPrisma as { restaurant: { findFirst: ReturnType<typeof vi.fn> } })
      .restaurant.findFirst.mockResolvedValueOnce({ id: '1' });
    mockSearch.mockResolvedValueOnce({ ...emptyResult, maxCalories: 3000 });

    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=bk&maxCalories=3000',
    });

    expect(res.statusCode).toBe(200);
  });

  it('rejects maxCalories=3001 (one above maximum)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=bk&maxCalories=3001',
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /reverse-search — minProtein boundaries', () => {
  it('accepts minProtein=0 (exact minimum)', async () => {
    (mockPrisma as { restaurant: { findFirst: ReturnType<typeof vi.fn> } })
      .restaurant.findFirst.mockResolvedValueOnce({ id: '1' });
    mockSearch.mockResolvedValueOnce({ ...emptyResult, minProtein: 0 });

    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=bk&maxCalories=600&minProtein=0',
    });

    expect(res.statusCode).toBe(200);
    expect(mockSearch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ minProtein: 0 }),
    );
  });

  it('accepts minProtein=200 (exact maximum)', async () => {
    (mockPrisma as { restaurant: { findFirst: ReturnType<typeof vi.fn> } })
      .restaurant.findFirst.mockResolvedValueOnce({ id: '1' });
    mockSearch.mockResolvedValueOnce({ ...emptyResult, minProtein: 200 });

    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=bk&maxCalories=600&minProtein=200',
    });

    expect(res.statusCode).toBe(200);
  });

  it('rejects minProtein=-1 (below minimum)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=bk&maxCalories=600&minProtein=-1',
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects minProtein=201 (above maximum)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=bk&maxCalories=600&minProtein=201',
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /reverse-search — limit boundaries', () => {
  it('accepts limit=1 (exact minimum)', async () => {
    (mockPrisma as { restaurant: { findFirst: ReturnType<typeof vi.fn> } })
      .restaurant.findFirst.mockResolvedValueOnce({ id: '1' });
    mockSearch.mockResolvedValueOnce(emptyResult);

    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=bk&maxCalories=600&limit=1',
    });

    expect(res.statusCode).toBe(200);
    expect(mockSearch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 1 }),
    );
  });

  it('accepts limit=20 (exact maximum)', async () => {
    (mockPrisma as { restaurant: { findFirst: ReturnType<typeof vi.fn> } })
      .restaurant.findFirst.mockResolvedValueOnce({ id: '1' });
    mockSearch.mockResolvedValueOnce(emptyResult);

    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=bk&maxCalories=600&limit=20',
    });

    expect(res.statusCode).toBe(200);
    expect(mockSearch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 20 }),
    );
  });

  it('rejects limit=0 (below minimum)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=bk&maxCalories=600&limit=0',
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects limit=21 (above maximum)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=bk&maxCalories=600&limit=21',
    });

    expect(res.statusCode).toBe(400);
  });

  it('uses default limit=5 when limit param is omitted', async () => {
    (mockPrisma as { restaurant: { findFirst: ReturnType<typeof vi.fn> } })
      .restaurant.findFirst.mockResolvedValueOnce({ id: '1' });
    mockSearch.mockResolvedValueOnce(emptyResult);

    await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=bk&maxCalories=600',
    });

    expect(mockSearch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 5 }),
    );
  });
});

// ---------------------------------------------------------------------------
// chainSlug format validation
// ---------------------------------------------------------------------------

describe('GET /reverse-search — chainSlug format validation', () => {
  it('rejects chainSlug with uppercase letters', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=Burger-King&maxCalories=600',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects chainSlug with spaces (URL-encoded)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=burger%20king&maxCalories=600',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects chainSlug with underscores', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=burger_king&maxCalories=600',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects chainSlug with exclamation mark', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=burger-king!&maxCalories=600',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects chainSlug longer than 100 characters', async () => {
    const longSlug = 'a'.repeat(101);
    const res = await app.inject({
      method: 'GET',
      url: `/reverse-search?chainSlug=${longSlug}&maxCalories=600`,
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts chainSlug of exactly 100 characters', async () => {
    const exactSlug = 'a'.repeat(97) + '-bk'; // 100 chars, valid format
    (mockPrisma as { restaurant: { findFirst: ReturnType<typeof vi.fn> } })
      .restaurant.findFirst.mockResolvedValueOnce(null); // unknown chain → 404

    const res = await app.inject({
      method: 'GET',
      url: `/reverse-search?chainSlug=${exactSlug}&maxCalories=600`,
    });

    // Schema validation passes (100 chars ok), but chain lookup fails → 404
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Error response shapes (spec compliance)
// ---------------------------------------------------------------------------

describe('GET /reverse-search — error response shapes', () => {
  it('404 response has success:false, code:CHAIN_NOT_FOUND, message with chainSlug', async () => {
    (mockPrisma as { restaurant: { findFirst: ReturnType<typeof vi.fn> } })
      .restaurant.findFirst.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=no-such-chain&maxCalories=600',
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.code).toBe('CHAIN_NOT_FOUND');
    expect(body.message).toContain('no-such-chain');
  });

  it('400 response has success:false and error object', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?maxCalories=600', // missing chainSlug
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
  });

  it('200 success response has success:true and data object', async () => {
    (mockPrisma as { restaurant: { findFirst: ReturnType<typeof vi.fn> } })
      .restaurant.findFirst.mockResolvedValueOnce({ id: '1' });
    mockSearch.mockResolvedValueOnce(emptyResult);

    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=bk&maxCalories=600',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// [BUG] Prisma error propagation
// ---------------------------------------------------------------------------

describe('GET /reverse-search — Prisma error handling', () => {
  it('[BUG] Prisma DB error propagates as 500 — no try/catch around findFirst', async () => {
    // The route handler calls prisma.restaurant.findFirst with no try/catch.
    // If the DB is unavailable, the error bubbles up to Fastify's default error handler.
    (mockPrisma as { restaurant: { findFirst: ReturnType<typeof vi.fn> } })
      .restaurant.findFirst.mockRejectedValueOnce(new Error('Connection refused'));

    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=burger-king&maxCalories=600',
    });

    // Fastify catches unhandled errors and returns 500 by default
    expect(res.statusCode).toBe(500);
  });
});
