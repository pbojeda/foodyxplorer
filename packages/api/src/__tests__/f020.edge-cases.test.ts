// F020 Edge-Case Tests — QA Engineer (Part 1/2)
//
// This file covers:
//   Section A — Schema edge cases (pure Zod, no mocks)
//   Section C — Route edge cases (uses mocked level1Lookup and Redis)
//
// Section B (level1Lookup unit edge cases with real implementation) is in:
//   f020.edge-cases.unit.test.ts
//
// BUGS FOUND AND FIXED:
//   BUG-F020-01 (MEDIUM) — FIXED: Schema reordered to .trim().min(1).max(255)
//   BUG-F020-02 (LOW) — FIXED: Route echoes original casing, lowercases only for cache/lookup
//   BUG-F020-03 (LOW) — Accepted: portion_grams=0 → null (DB CHECK prevents 0)
//   BUG-F020-04 (LOW) — Accepted: portion_grams<0 → null (DB CHECK prevents negatives)

// ---------------------------------------------------------------------------
// SECTION A — Schema edge cases (no module mocks needed)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EstimateQuerySchema,
  EstimateNutrientsSchema,
  EstimateResultSchema,
  EstimateResponseSchema,
} from '@foodxplorer/shared';

const BASE_NUTRIENTS_A = {
  calories: 100, proteins: 10, carbohydrates: 20, sugars: 5, fats: 5,
  saturatedFats: 2, fiber: 3, salt: 1, sodium: 400, transFats: 0,
  cholesterol: 10, potassium: 50, monounsaturatedFats: 2, polyunsaturatedFats: 1,
  referenceBasis: 'per_serving' as const,
};

const BASE_RESULT_A = {
  entityType: 'dish' as const,
  entityId: 'fd000000-0001-4000-a000-000000000001',
  name: 'Test',
  nameEs: null,
  restaurantId: 'fd000000-0001-4000-a000-000000000002',
  chainSlug: 'test-chain',
  portionGrams: 100,
  nutrients: BASE_NUTRIENTS_A,
  confidenceLevel: 'high' as const,
  estimationMethod: 'official' as const,
  source: {
    id: 'fd000000-0001-4000-a000-000000000003',
    name: 'Test Source',
    type: 'official' as const,
    url: null,
  },
};

// ─── EstimateQuerySchema ─────────────────────────────────────────────────────

describe('Section A — EstimateQuerySchema edge cases', () => {
  it('accepts query of exactly 1 char (min boundary)', () => {
    expect(EstimateQuerySchema.safeParse({ query: 'x' }).success).toBe(true);
  });

  it('accepts query of exactly 254 chars (below max boundary)', () => {
    expect(EstimateQuerySchema.safeParse({ query: 'a'.repeat(254) }).success).toBe(true);
  });

  it('accepts query of exactly 255 chars (max boundary)', () => {
    expect(EstimateQuerySchema.safeParse({ query: 'a'.repeat(255) }).success).toBe(true);
  });

  it('rejects query of exactly 256 chars (one above max)', () => {
    expect(EstimateQuerySchema.safeParse({ query: 'a'.repeat(256) }).success).toBe(false);
  });

  // BUG-F020-01 FIXED: Schema now uses .trim().min(1) — whitespace-only is rejected.
  it('[BUG-F020-01] whitespace-only "   " is rejected after trim (fixed)', () => {
    const result = EstimateQuerySchema.safeParse({ query: '   ' });
    expect(result.success).toBe(false);
  });

  it('accepts Unicode query with Spanish accents (café)', () => {
    expect(EstimateQuerySchema.safeParse({ query: 'café' }).success).toBe(true);
  });

  it('accepts Unicode query with ñ (piña colada)', () => {
    expect(EstimateQuerySchema.safeParse({ query: 'piña colada' }).success).toBe(true);
  });

  it('accepts query with SQL injection attempt (Zod only validates type+length, not content)', () => {
    expect(EstimateQuerySchema.safeParse({ query: "'; DROP TABLE dishes; --" }).success).toBe(true);
  });

  it('accepts query with FTS operator chars (&, |, :*) — sanitized by plainto_tsquery at DB level', () => {
    expect(EstimateQuerySchema.safeParse({ query: 'pollo & arroz | :* paella' }).success).toBe(true);
  });

  it('trims leading/trailing spaces: "  Big Mac  " → "Big Mac"', () => {
    const result = EstimateQuerySchema.safeParse({ query: '  Big Mac  ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.query).toBe('Big Mac');
  });

  it('preserves internal spaces (trim is edge-only): "Big   Mac" stays "Big   Mac"', () => {
    const result = EstimateQuerySchema.safeParse({ query: 'Big   Mac' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.query).toBe('Big   Mac');
  });

  it('accepts chainSlug of single char "a" (minimum valid value)', () => {
    expect(EstimateQuerySchema.safeParse({ query: 'test', chainSlug: 'a' }).success).toBe(true);
  });

  it('accepts chainSlug of exactly 100 chars (max boundary)', () => {
    expect(EstimateQuerySchema.safeParse({ query: 'test', chainSlug: 'a'.repeat(100) }).success).toBe(true);
  });

  it('rejects chainSlug of exactly 101 chars (one above max)', () => {
    expect(EstimateQuerySchema.safeParse({ query: 'test', chainSlug: 'a'.repeat(101) }).success).toBe(false);
  });

  it('rejects empty string chainSlug (regex requires at least one [a-z0-9-] char)', () => {
    expect(EstimateQuerySchema.safeParse({ query: 'test', chainSlug: '' }).success).toBe(false);
  });

  it('rejects chainSlug with spaces', () => {
    expect(EstimateQuerySchema.safeParse({ query: 'test', chainSlug: 'mc donalds' }).success).toBe(false);
  });

  it('rejects chainSlug with dot', () => {
    expect(EstimateQuerySchema.safeParse({ query: 'test', chainSlug: 'mc.donalds' }).success).toBe(false);
  });

  it('accepts chainSlug with leading hyphen (^[a-z0-9-]+$ allows hyphen at any position)', () => {
    // The regex allows hyphens anywhere including start/end — document this behavior
    expect(EstimateQuerySchema.safeParse({ query: 'test', chainSlug: '-mcdonalds' }).success).toBe(true);
  });

  it('accepts both chainSlug and restaurantId simultaneously', () => {
    expect(EstimateQuerySchema.safeParse({
      query: 'Big Mac',
      chainSlug: 'mcdonalds-es',
      restaurantId: 'fd000000-0001-4000-a000-000000000001',
    }).success).toBe(true);
  });

  it('rejects restaurantId that is too short to be a valid UUID', () => {
    expect(EstimateQuerySchema.safeParse({
      query: 'test',
      restaurantId: '12345678-1234-1234-1234-1234',
    }).success).toBe(false);
  });

  it('rejects restaurantId with non-hex characters', () => {
    expect(EstimateQuerySchema.safeParse({
      query: 'test',
      restaurantId: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    }).success).toBe(false);
  });
});

// ─── EstimateNutrientsSchema ─────────────────────────────────────────────────

describe('Section A — EstimateNutrientsSchema boundary values', () => {
  it('accepts all nutrients at exactly 0 (nonnegative lower bound)', () => {
    const allZero = {
      ...BASE_NUTRIENTS_A,
      calories: 0, proteins: 0, carbohydrates: 0, sugars: 0, fats: 0,
      saturatedFats: 0, fiber: 0, salt: 0, sodium: 0, transFats: 0,
      cholesterol: 0, potassium: 0, monounsaturatedFats: 0, polyunsaturatedFats: 0,
    };
    expect(EstimateNutrientsSchema.safeParse(allZero).success).toBe(true);
  });

  it('accepts 0.01 (smallest meaningful positive value)', () => {
    expect(EstimateNutrientsSchema.safeParse({ ...BASE_NUTRIENTS_A, calories: 0.01 }).success).toBe(true);
  });

  it('accepts 9999.99 (large realistic value)', () => {
    expect(EstimateNutrientsSchema.safeParse({ ...BASE_NUTRIENTS_A, calories: 9999.99 }).success).toBe(true);
  });

  it('rejects -0.01 for salt', () => {
    expect(EstimateNutrientsSchema.safeParse({ ...BASE_NUTRIENTS_A, salt: -0.01 }).success).toBe(false);
  });

  it('rejects -0.01 for sodium', () => {
    expect(EstimateNutrientsSchema.safeParse({ ...BASE_NUTRIENTS_A, sodium: -0.01 }).success).toBe(false);
  });

  it('rejects -1 for monounsaturatedFats', () => {
    expect(EstimateNutrientsSchema.safeParse({ ...BASE_NUTRIENTS_A, monounsaturatedFats: -1 }).success).toBe(false);
  });

  it('rejects -1 for polyunsaturatedFats', () => {
    expect(EstimateNutrientsSchema.safeParse({ ...BASE_NUTRIENTS_A, polyunsaturatedFats: -1 }).success).toBe(false);
  });

  it('accepts referenceBasis=per_100g', () => {
    expect(EstimateNutrientsSchema.safeParse({ ...BASE_NUTRIENTS_A, referenceBasis: 'per_100g' }).success).toBe(true);
  });

  it('accepts referenceBasis=per_package', () => {
    expect(EstimateNutrientsSchema.safeParse({ ...BASE_NUTRIENTS_A, referenceBasis: 'per_package' }).success).toBe(true);
  });

  it('rejects referenceBasis=per_meal (non-existent enum value)', () => {
    expect(EstimateNutrientsSchema.safeParse({ ...BASE_NUTRIENTS_A, referenceBasis: 'per_meal' }).success).toBe(false);
  });
});

// ─── EstimateResultSchema — portionGrams ─────────────────────────────────────

describe('Section A — EstimateResultSchema portionGrams edge values', () => {
  it('rejects portionGrams=0 (schema requires positive, not nonnegative)', () => {
    expect(EstimateResultSchema.safeParse({ ...BASE_RESULT_A, portionGrams: 0 }).success).toBe(false);
  });

  it('rejects portionGrams=-1', () => {
    expect(EstimateResultSchema.safeParse({ ...BASE_RESULT_A, portionGrams: -1 }).success).toBe(false);
  });

  it('accepts portionGrams=0.01 (smallest valid positive value)', () => {
    expect(EstimateResultSchema.safeParse({ ...BASE_RESULT_A, portionGrams: 0.01 }).success).toBe(true);
  });

  it('accepts portionGrams=null for food entity', () => {
    const foodResult = {
      ...BASE_RESULT_A,
      entityType: 'food' as const,
      portionGrams: null,
      restaurantId: null,
      chainSlug: null,
    };
    expect(EstimateResultSchema.safeParse(foodResult).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SECTION C — Route edge cases
// All module-level mocks are hoisted; Section B is in f020.edge-cases.unit.test.ts
// ---------------------------------------------------------------------------

const { mockLevel1Lookup } = vi.hoisted(() => ({
  mockLevel1Lookup: vi.fn(),
}));

vi.mock('../estimation/level1Lookup.js', () => ({
  level1Lookup: mockLevel1Lookup,
}));

// Stub for level2Lookup — route imports it; full tests in f021.estimate.route.test.ts
const { mockLevel2LookupEdge } = vi.hoisted(() => ({
  mockLevel2LookupEdge: vi.fn(),
}));

vi.mock('../estimation/level2Lookup.js', () => ({
  level2Lookup: mockLevel2LookupEdge,
}));

const { mockRedisGet, mockRedisSet } = vi.hoisted(() => ({
  mockRedisGet: vi.fn(),
  mockRedisSet: vi.fn(),
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
  },
}));

import type { PrismaClient } from '@prisma/client';

vi.mock('../lib/prisma.js', () => ({
  prisma: {} as PrismaClient,
}));

vi.mock('../lib/kysely.js', () => ({
  getKysely: () => ({
    getExecutor: () => ({
      executeQuery: vi.fn().mockResolvedValue({ rows: [] }),
      compileQuery: (node: unknown) => ({ sql: '', parameters: [], query: node }),
      transformQuery: (node: unknown) => node,
      withPlugins: function () { return this; },
    }),
  }),
  destroyKysely: vi.fn(),
}));

import { buildApp } from '../app.js';

const ROUTE_MOCK_RESULT = {
  matchType: 'exact_dish' as const,
  result: {
    entityType: 'dish' as const,
    entityId: 'fd000000-0001-4000-a000-000000000001',
    name: 'Test Dish',
    nameEs: 'Plato de prueba',
    restaurantId: 'fd000000-0001-4000-a000-000000000002',
    chainSlug: 'test-chain',
    portionGrams: 200,
    nutrients: {
      calories: 300, proteins: 10, carbohydrates: 40, sugars: 5,
      fats: 8, saturatedFats: 2, fiber: 3, salt: 1, sodium: 400,
      transFats: 0, cholesterol: 20, potassium: 100,
      monounsaturatedFats: 4, polyunsaturatedFats: 2,
      referenceBasis: 'per_serving' as const,
    },
    confidenceLevel: 'high' as const,
    estimationMethod: 'official' as const,
    source: {
      id: 'fd000000-0001-4000-a000-000000000003',
      name: 'Test Source',
      type: 'official' as const,
      url: null,
    },
  },
};

describe('Section C — Route edge cases', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    // Default: level2Lookup returns null (L1 edge-case tests don't exercise L2)
    mockLevel2LookupEdge.mockResolvedValue(null);
  });

  // ─── Query length boundaries at route level ───────────────────────────────

  describe('query length at route level', () => {
    it('accepts 1-char query — route returns 200', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(null);
      const app = await buildApp();
      const resp = await app.inject({ method: 'GET', url: '/estimate?query=x' });
      expect(resp.statusCode).toBe(200);
    });

    it('accepts 255-char query (max boundary) — route returns 200', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(null);
      const app = await buildApp();
      const resp = await app.inject({ method: 'GET', url: `/estimate?query=${'a'.repeat(255)}` });
      expect(resp.statusCode).toBe(200);
    });

    it('rejects 256-char query — route returns 400 VALIDATION_ERROR', async () => {
      const app = await buildApp();
      const resp = await app.inject({ method: 'GET', url: `/estimate?query=${'a'.repeat(256)}` });
      expect(resp.statusCode).toBe(400);
      expect(resp.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ─── Unicode and special characters at route level ────────────────────────

  describe('Unicode and special chars at route level', () => {
    it('accepts café (URL-encoded UTF-8) — route returns 200', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(null);
      const app = await buildApp();
      const resp = await app.inject({ method: 'GET', url: '/estimate?query=caf%C3%A9' });
      expect(resp.statusCode).toBe(200);
    });

    it('accepts piña (URL-encoded ñ) — route returns 200', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(null);
      const app = await buildApp();
      const resp = await app.inject({ method: 'GET', url: '/estimate?query=pi%C3%B1a' });
      expect(resp.statusCode).toBe(200);
    });

    it('accepts pollo a la brasa (Spanish, spaces URL-encoded) — route returns 200', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(null);
      const app = await buildApp();
      const resp = await app.inject({ method: 'GET', url: '/estimate?query=pollo+a+la+brasa' });
      expect(resp.statusCode).toBe(200);
    });

    it('accepts SQL injection attempt — route returns 200 miss (no injection possible)', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(null);
      const app = await buildApp();
      const resp = await app.inject({
        method: 'GET',
        url: "/estimate?query=%27%3B%20DROP%20TABLE%20dishes%3B%20--",
      });
      expect(resp.statusCode).toBe(200);
      expect(resp.json<{ data: { level1Hit: boolean } }>().data.level1Hit).toBe(false);
    });

    it('accepts FTS operator chars (& | :*) — route returns 200 (plainto_tsquery sanitizes)', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(null);
      const app = await buildApp();
      const resp = await app.inject({ method: 'GET', url: '/estimate?query=pollo+%26+arroz' });
      expect(resp.statusCode).toBe(200);
    });
  });

  // ─── Whitespace normalization at route level ──────────────────────────────

  describe('whitespace normalization at route level', () => {
    it('query with multiple internal spaces is collapsed to single space', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(null);
      const app = await buildApp();
      await app.inject({ method: 'GET', url: '/estimate?query=Big%20%20%20Mac' });
      // Route: Zod trim (no-op for internal) → collapse spaces → lowercase
      expect(mockLevel1Lookup).toHaveBeenCalledWith(
        expect.anything(),
        'big mac', // collapsed "Big   Mac" → "Big Mac" then lowercased (BUG-F020-02)
        expect.any(Object),
      );
    });

    it('query with leading/trailing spaces is trimmed by Zod before route processing', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(null);
      const app = await buildApp();
      await app.inject({ method: 'GET', url: '/estimate?query=%20%20Big+Mac%20%20' });
      // Zod trims "  Big Mac  " → "Big Mac", route lowercases → "big mac"
      expect(mockLevel1Lookup).toHaveBeenCalledWith(
        expect.anything(),
        'big mac', // BUG-F020-02: lowercased
        expect.any(Object),
      );
    });
  });

  // ─── BUG-F020-02 FIXED: Route lowercases for lookup/cache but echoes original ──

  describe('[BUG-F020-02] Route lowercases query for lookup/cache, echoes original casing (fixed)', () => {
    it('level1Lookup receives lowercased query — "BIG MAC" becomes "big mac"', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(null);
      const app = await buildApp();
      await app.inject({ method: 'GET', url: '/estimate?query=BIG+MAC' });
      expect(mockLevel1Lookup).toHaveBeenCalledWith(
        expect.anything(),
        'big mac', // lowercased for DB lookup (SQL uses LOWER(), plainto_tsquery is case-insensitive)
        expect.any(Object),
      );
    });

    it('response.data.query echoes original casing (fixed)', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(null);
      const app = await buildApp();
      const resp = await app.inject({ method: 'GET', url: '/estimate?query=Big+Mac' });
      const body = resp.json<{ data: { query: string } }>();
      // FIXED: response echoes original casing per spec sample
      expect(body.data.query).toBe('Big Mac');
    });

    it('case-insensitive cache keys: "BIG MAC" and "big mac" produce the same cache key', async () => {
      const capturedKeys: string[] = [];
      mockRedisGet.mockImplementation((key: string) => {
        capturedKeys.push(key);
        return Promise.resolve(null);
      });
      mockLevel1Lookup.mockResolvedValue(null);

      const app = await buildApp();
      await app.inject({ method: 'GET', url: '/estimate?query=BIG+MAC' });
      await app.inject({ method: 'GET', url: '/estimate?query=big+mac' });
      // Both get lowercased to "big mac" → same cache key → second hits cache
      expect(capturedKeys[0]).toBe(capturedKeys[1]);
    });
  });

  // ─── chainSlug edge cases at route level ─────────────────────────────────

  describe('chainSlug edge cases', () => {
    it('single-char chainSlug "a" — route returns 200', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(null);
      const app = await buildApp();
      const resp = await app.inject({ method: 'GET', url: '/estimate?query=test&chainSlug=a' });
      expect(resp.statusCode).toBe(200);
    });

    it('100-char chainSlug (max boundary) — route returns 200', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(null);
      const app = await buildApp();
      const resp = await app.inject({
        method: 'GET',
        url: `/estimate?query=test&chainSlug=${'a'.repeat(100)}`,
      });
      expect(resp.statusCode).toBe(200);
    });

    it('uppercase chainSlug rejected — route returns 400 VALIDATION_ERROR', async () => {
      const app = await buildApp();
      const resp = await app.inject({ method: 'GET', url: '/estimate?query=test&chainSlug=McDonalds' });
      expect(resp.statusCode).toBe(400);
      expect(resp.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
    });

    it('empty chainSlug rejected — route returns 400 VALIDATION_ERROR', async () => {
      const app = await buildApp();
      const resp = await app.inject({ method: 'GET', url: '/estimate?query=test&chainSlug=' });
      expect(resp.statusCode).toBe(400);
      expect(resp.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ─── Both chainSlug AND restaurantId provided ─────────────────────────────

  describe('both chainSlug and restaurantId provided simultaneously', () => {
    it('accepts both params — returns 200', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(ROUTE_MOCK_RESULT);
      const app = await buildApp();
      const resp = await app.inject({
        method: 'GET',
        url: '/estimate?query=Big+Mac&chainSlug=mcdonalds-es&restaurantId=fd000000-0001-4000-a000-000000000002',
      });
      expect(resp.statusCode).toBe(200);
    });

    it('chainSlug is echoed in response.data.chainSlug when both params provided', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(null);
      const app = await buildApp();
      const resp = await app.inject({
        method: 'GET',
        url: '/estimate?query=test&chainSlug=mcdonalds-es&restaurantId=fd000000-0001-4000-a000-000000000002',
      });
      expect(resp.json<{ data: { chainSlug: string } }>().data.chainSlug).toBe('mcdonalds-es');
    });

    it('level1Lookup receives both chainSlug and restaurantId', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(null);
      const app = await buildApp();
      await app.inject({
        method: 'GET',
        url: '/estimate?query=test&chainSlug=test-chain&restaurantId=fd000000-0001-4000-a000-000000000002',
      });
      expect(mockLevel1Lookup).toHaveBeenCalledWith(
        expect.anything(),
        'test',
        { chainSlug: 'test-chain', restaurantId: 'fd000000-0001-4000-a000-000000000002' },
      );
    });
  });

  // ─── Miss is HTTP 200, NOT 404 ────────────────────────────────────────────

  describe('miss path must return HTTP 200 — spec requirement', () => {
    it('all-miss returns 200 (not 404)', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(null);
      const app = await buildApp();
      const resp = await app.inject({ method: 'GET', url: '/estimate?query=completely+unknown+dish' });
      expect(resp.statusCode).toBe(200);
      expect(resp.statusCode).not.toBe(404);
    });

    it('miss response has success:true, level1Hit:false, matchType:null, result:null', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(null);
      const app = await buildApp();
      const resp = await app.inject({ method: 'GET', url: '/estimate?query=unknown' });
      const body = resp.json<{ success: boolean; data: { level1Hit: boolean; matchType: null; result: null } }>();
      expect(body.success).toBe(true);
      expect(body.data.level1Hit).toBe(false);
      expect(body.data.matchType).toBeNull();
      expect(body.data.result).toBeNull();
    });

    it('miss response validates against EstimateResponseSchema', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(null);
      const app = await buildApp();
      const resp = await app.inject({ method: 'GET', url: '/estimate?query=unknown' });
      expect(EstimateResponseSchema.safeParse(resp.json()).success).toBe(true);
    });
  });

  // ─── Response structure when optional params absent ───────────────────────

  describe('response structure when optional params absent', () => {
    it('chainSlug absent → response.data.chainSlug is null', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(null);
      const app = await buildApp();
      const resp = await app.inject({ method: 'GET', url: '/estimate?query=test' });
      expect(resp.json<{ data: { chainSlug: string | null } }>().data.chainSlug).toBeNull();
    });

    it('chainSlug provided → response.data.chainSlug echoes it', async () => {
      mockLevel1Lookup.mockResolvedValueOnce(null);
      const app = await buildApp();
      const resp = await app.inject({ method: 'GET', url: '/estimate?query=test&chainSlug=burger-king-es' });
      expect(resp.json<{ data: { chainSlug: string } }>().data.chainSlug).toBe('burger-king-es');
    });
  });

  // ─── Route not found vs data miss ────────────────────────────────────────

  describe('route not found vs data miss distinction', () => {
    it('GET /estimate/subpath returns 404 (route not found, not a data miss)', async () => {
      const app = await buildApp();
      const resp = await app.inject({ method: 'GET', url: '/estimate/anything' });
      expect(resp.statusCode).toBe(404);
    });

    it('GET /estimatexyz returns 404 (misspelled route)', async () => {
      const app = await buildApp();
      const resp = await app.inject({ method: 'GET', url: '/estimatexyz?query=test' });
      expect(resp.statusCode).toBe(404);
    });
  });

  // ─── Cache key behavior with colon in query ───────────────────────────────

  describe('cache key construction with colon in query', () => {
    it('query with colon character generates distinct key from same string split across params', async () => {
      // Unified cache key = fxp:estimate:{query}:{chainSlug}:{restaurantId}
      // If query="a:b", no chainSlug, no restaurantId → key ends in "a:b::"
      // If query="a", chainSlug="b", no restaurantId → key ends in "a:b:"
      // These are DIFFERENT (different trailing colons) — no collision in this case.
      // But: query="a:b", chainSlug="", restaurantId="" is impossible
      // (chainSlug validated as non-empty). So practical collision scenarios
      // are limited but `:` in query remains an ambiguity concern.

      const capturedKeys: string[] = [];
      mockRedisGet.mockImplementation((key: string) => {
        capturedKeys.push(key);
        return Promise.resolve(null);
      });
      mockLevel1Lookup.mockResolvedValue(null);

      const app = await buildApp();
      await app.inject({ method: 'GET', url: '/estimate?query=a%3Ab' }); // "a:b"
      await app.inject({ method: 'GET', url: '/estimate?query=a&chainSlug=b' });

      expect(capturedKeys).toHaveLength(2);
      // The keys differ by one trailing colon — no collision here
      expect(capturedKeys[0]).not.toBe(capturedKeys[1]);
      // Both contain "a:b" in the key (documenting the potential ambiguity)
      expect(capturedKeys[0]).toContain('a:b');
      expect(capturedKeys[1]).toContain('a:b');
    });
  });
});
