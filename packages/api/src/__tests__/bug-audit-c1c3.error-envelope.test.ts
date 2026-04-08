// BUG-AUDIT-C1C3 — Tests for /reverse-search error envelope consistency.
//
// Verifies that:
//   C1: 404 CHAIN_NOT_FOUND returns {success, error: {code, message}} (not flat)
//   C3: 400 validation errors return {success, error: {code: "VALIDATION_ERROR", message}} (not raw Zod)

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../errors/errorHandler.js';

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
  registerErrorHandler(app);
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
// C1: 404 CHAIN_NOT_FOUND — must use nested error envelope
// ---------------------------------------------------------------------------

describe('C1: 404 CHAIN_NOT_FOUND error envelope', () => {
  it('returns {success: false, error: {code: "CHAIN_NOT_FOUND", message}} — not flat', async () => {
    (mockPrisma as { restaurant: { findFirst: ReturnType<typeof vi.fn> } })
      .restaurant.findFirst.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=no-such-chain&maxCalories=600',
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({
      success: false,
      error: {
        code: 'CHAIN_NOT_FOUND',
        message: expect.stringContaining('no-such-chain'),
      },
    });
    // Must NOT have flat code/message at root
    expect(body.code).toBeUndefined();
    expect(body.message).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// C3: 400 validation errors — must use standard VALIDATION_ERROR envelope
// ---------------------------------------------------------------------------

describe('C3: 400 validation error envelope', () => {
  it('missing chainSlug returns {success: false, error: {code: "VALIDATION_ERROR", message}}', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?maxCalories=600',
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(typeof body.error.message).toBe('string');
    // Must NOT have raw Zod formErrors/fieldErrors
    expect(body.error.formErrors).toBeUndefined();
    expect(body.error.fieldErrors).toBeUndefined();
  });

  it('missing maxCalories returns VALIDATION_ERROR', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=bk',
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('invalid maxCalories type returns VALIDATION_ERROR', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=bk&maxCalories=abc',
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('maxCalories below minimum returns VALIDATION_ERROR with descriptive message', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reverse-search?chainSlug=bk&maxCalories=50',
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Valid responses still work
// ---------------------------------------------------------------------------

describe('Valid responses unchanged', () => {
  it('200 response has {success: true, data}', async () => {
    (mockPrisma as { restaurant: { findFirst: ReturnType<typeof vi.fn> } })
      .restaurant.findFirst.mockResolvedValueOnce({ id: '1', name: 'BK' });
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
