// Integration tests for GET /quality/report.
//
// Uses real test DB (DATABASE_URL_TEST) for happy path.
// Fixture namespace: e1 prefix, e.g. e1000000-00XX-4000-a000-000000000YYY
// Uses injectable mock PrismaClient (via buildApp) for DB_UNAVAILABLE test.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import type { PrismaClient as PrismaClientType } from '@prisma/client';
import { buildApp } from '../../app.js';
import type { QualityReportResponse } from '@foodxplorer/shared';
import { QualityReportResponseSchema } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Test DB setup
// ---------------------------------------------------------------------------

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

// ---------------------------------------------------------------------------
// Fixture IDs — e1 prefix namespace
// ---------------------------------------------------------------------------

const IDS = {
  // Data sources
  DATA_SOURCE: 'e1000000-0001-4000-a000-000000000001',
  // Restaurants
  RESTAURANT_A: 'e1000000-0002-4000-a000-000000000001', // chain-a
  RESTAURANT_B: 'e1000000-0002-4000-a000-000000000002', // chain-b
  // Dishes
  DISH_A1: 'e1000000-0003-4000-a000-000000000001', // chain-a, no nutrients
  DISH_A2: 'e1000000-0003-4000-a000-000000000002', // chain-a, duplicate name
  DISH_A3: 'e1000000-0003-4000-a000-000000000003', // chain-a, duplicate name (same as A2)
  DISH_B1: 'e1000000-0003-4000-a000-000000000004', // chain-b
  DISH_B2: 'e1000000-0003-4000-a000-000000000005', // chain-b
  // Dish nutrients
  NUTRIENT_GHOST: 'e1000000-0004-4000-a000-000000000001', // all-zero macros
  NUTRIENT_PLAUSIBLE: 'e1000000-0004-4000-a000-000000000002', // plausible values
  NUTRIENT_ROUND: 'e1000000-0004-4000-a000-000000000003',     // suspiciously round calories
};

// ---------------------------------------------------------------------------
// Fixture setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Pre-cleanup in reverse FK order
  await prisma.dishNutrient.deleteMany({
    where: { id: { in: [IDS.NUTRIENT_GHOST, IDS.NUTRIENT_PLAUSIBLE, IDS.NUTRIENT_ROUND] } },
  });
  await prisma.dish.deleteMany({
    where: { id: { in: [IDS.DISH_A1, IDS.DISH_A2, IDS.DISH_A3, IDS.DISH_B1, IDS.DISH_B2] } },
  });
  await prisma.restaurant.deleteMany({
    where: { id: { in: [IDS.RESTAURANT_A, IDS.RESTAURANT_B] } },
  });
  await prisma.dataSource.deleteMany({ where: { id: IDS.DATA_SOURCE } });

  // Create fixtures
  await prisma.dataSource.create({
    data: {
      id: IDS.DATA_SOURCE,
      name: 'F018 Quality Test Source',
      type: 'official',
      // lastUpdated more than 90 days ago → stale
      lastUpdated: new Date(Date.now() - 100 * 86400 * 1000),
    },
  });

  await prisma.restaurant.create({
    data: {
      id: IDS.RESTAURANT_A,
      name: 'Test Chain A Restaurant',
      chainSlug: 'test-chain-a',
      countryCode: 'ES',
      isActive: true,
    },
  });

  await prisma.restaurant.create({
    data: {
      id: IDS.RESTAURANT_B,
      name: 'Test Chain B Restaurant',
      chainSlug: 'test-chain-b',
      countryCode: 'ES',
      isActive: true,
    },
  });

  // Dish A1: chain-a, no nutrients
  await prisma.dish.create({
    data: {
      id: IDS.DISH_A1,
      name: 'Dish A1 No Nutrients',
      restaurantId: IDS.RESTAURANT_A,
      sourceId: IDS.DATA_SOURCE,
      confidenceLevel: 'low',
      estimationMethod: 'scraped',
    },
  });

  // Dish A2: chain-a, duplicate name (same as A3)
  await prisma.dish.create({
    data: {
      id: IDS.DISH_A2,
      name: 'Duplicate Dish Name',
      restaurantId: IDS.RESTAURANT_A,
      sourceId: IDS.DATA_SOURCE,
      confidenceLevel: 'medium',
      estimationMethod: 'scraped',
    },
  });

  // Dish A3: chain-a, duplicate name (same as A2)
  await prisma.dish.create({
    data: {
      id: IDS.DISH_A3,
      name: 'Duplicate Dish Name', // same name + same restaurantId + same sourceId → duplicate
      restaurantId: IDS.RESTAURANT_A,
      sourceId: IDS.DATA_SOURCE,
      confidenceLevel: 'medium',
      estimationMethod: 'scraped',
    },
  });

  // Dish B1: chain-b
  await prisma.dish.create({
    data: {
      id: IDS.DISH_B1,
      name: 'Dish B1',
      restaurantId: IDS.RESTAURANT_B,
      sourceId: IDS.DATA_SOURCE,
      confidenceLevel: 'high',
      estimationMethod: 'official',
    },
  });

  // Dish B2: chain-b
  await prisma.dish.create({
    data: {
      id: IDS.DISH_B2,
      name: 'Dish B2',
      restaurantId: IDS.RESTAURANT_B,
      sourceId: IDS.DATA_SOURCE,
      confidenceLevel: 'high',
      estimationMethod: 'official',
    },
  });

  const baseNutrient = {
    sugars: 0,
    saturatedFats: 0,
    fiber: 0,
    salt: 0,
    sodium: 0,
    estimationMethod: 'scraped' as const,
    confidenceLevel: 'low' as const,
  };

  // Ghost row nutrient (A2: all-zero macros)
  await prisma.dishNutrient.create({
    data: {
      ...baseNutrient,
      id: IDS.NUTRIENT_GHOST,
      dishId: IDS.DISH_A2,
      sourceId: IDS.DATA_SOURCE,
      calories: 0,
      proteins: 0,
      carbohydrates: 0,
      fats: 0,
    },
  });

  // Plausible nutrient (A3)
  await prisma.dishNutrient.create({
    data: {
      ...baseNutrient,
      id: IDS.NUTRIENT_PLAUSIBLE,
      dishId: IDS.DISH_A3,
      sourceId: IDS.DATA_SOURCE,
      calories: 350,
      proteins: 12,
      carbohydrates: 45,
      fats: 14,
    },
  });

  // Round calories nutrient (B1: 500 kcal → suspiciously round)
  await prisma.dishNutrient.create({
    data: {
      ...baseNutrient,
      id: IDS.NUTRIENT_ROUND,
      dishId: IDS.DISH_B1,
      sourceId: IDS.DATA_SOURCE,
      calories: 500,
      proteins: 20,
      carbohydrates: 60,
      fats: 15,
    },
  });
});

afterAll(async () => {
  // Reverse FK order teardown
  await prisma.dishNutrient.deleteMany({
    where: { id: { in: [IDS.NUTRIENT_GHOST, IDS.NUTRIENT_PLAUSIBLE, IDS.NUTRIENT_ROUND] } },
  });
  await prisma.dish.deleteMany({
    where: { id: { in: [IDS.DISH_A1, IDS.DISH_A2, IDS.DISH_A3, IDS.DISH_B1, IDS.DISH_B2] } },
  });
  await prisma.restaurant.deleteMany({
    where: { id: { in: [IDS.RESTAURANT_A, IDS.RESTAURANT_B] } },
  });
  await prisma.dataSource.deleteMany({ where: { id: IDS.DATA_SOURCE } });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// GET /quality/report — happy path with real DB
// ---------------------------------------------------------------------------

describe('GET /quality/report — real test DB', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ prisma });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with valid QualityReportResponse shape', async () => {
    const response = await app.inject({ method: 'GET', url: '/quality/report' });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as QualityReportResponse;
    const parsed = QualityReportResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it('totalDishes includes all fixture dishes (at least 5)', async () => {
    const response = await app.inject({ method: 'GET', url: '/quality/report' });
    const body = JSON.parse(response.body) as QualityReportResponse;

    expect(body.data.totalDishes).toBeGreaterThanOrEqual(5);
  });

  it('nutrientCompleteness.dishesWithoutNutrients >= 1 (dish A1 has no nutrients)', async () => {
    const response = await app.inject({ method: 'GET', url: '/quality/report' });
    const body = JSON.parse(response.body) as QualityReportResponse;

    expect(body.data.nutrientCompleteness.dishesWithoutNutrients).toBeGreaterThanOrEqual(1);
  });

  it('nutrientCompleteness.ghostRowCount >= 1 (dish A2 has all-zero nutrient row)', async () => {
    const response = await app.inject({ method: 'GET', url: '/quality/report' });
    const body = JSON.parse(response.body) as QualityReportResponse;

    expect(body.data.nutrientCompleteness.ghostRowCount).toBeGreaterThanOrEqual(1);
  });

  it('duplicates.duplicateGroupCount >= 1 (A2 and A3 share same name+restaurant+source)', async () => {
    const response = await app.inject({ method: 'GET', url: '/quality/report' });
    const body = JSON.parse(response.body) as QualityReportResponse;

    expect(body.data.duplicates.duplicateGroupCount).toBeGreaterThanOrEqual(1);
    expect(body.data.duplicates.totalDuplicateDishes).toBeGreaterThanOrEqual(2);
  });

  it('implausibleValues.suspiciouslyRoundCalories >= 1 (B1 has 500 kcal)', async () => {
    const response = await app.inject({ method: 'GET', url: '/quality/report' });
    const body = JSON.parse(response.body) as QualityReportResponse;

    expect(body.data.implausibleValues.suspiciouslyRoundCalories).toBeGreaterThanOrEqual(1);
  });

  it('dataFreshness.staleSources >= 1 (source lastUpdated 100 days ago)', async () => {
    const response = await app.inject({ method: 'GET', url: '/quality/report' });
    const body = JSON.parse(response.body) as QualityReportResponse;

    expect(body.data.dataFreshness.staleSources).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// GET /quality/report?chainSlug=test-chain-a — scoped report
// ---------------------------------------------------------------------------

describe('GET /quality/report?chainSlug=test-chain-a — scoped', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ prisma });
  });

  afterAll(async () => {
    await app.close();
  });

  it('totalDishes scoped to chain-a dishes (exactly 3)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/quality/report?chainSlug=test-chain-a',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as QualityReportResponse;

    // chain-a has exactly 3 dishes (A1, A2, A3) in fixture
    expect(body.data.totalDishes).toBe(3);
    expect(body.data.scopedToChain).toBe('test-chain-a');
  });

  it('scoped report: duplicates only within chain-a', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/quality/report?chainSlug=test-chain-a',
    });

    const body = JSON.parse(response.body) as QualityReportResponse;

    expect(body.data.duplicates.duplicateGroupCount).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// GET /quality/report?chainSlug=nonexistent-slug — unknown chain
// ---------------------------------------------------------------------------

describe('GET /quality/report — unknown chainSlug', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ prisma });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with totalDishes: 0 (not 404)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/quality/report?chainSlug=nonexistent-slug-xyz',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as QualityReportResponse;
    expect(body.data.totalDishes).toBe(0);
    expect(body.data.scopedToChain).toBe('nonexistent-slug-xyz');
  });
});

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

describe('GET /quality/report — validation errors', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ prisma });
  });

  afterAll(async () => {
    await app.close();
  });

  it('stalenessThresholdDays=0 returns 400 VALIDATION_ERROR', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/quality/report?stalenessThresholdDays=0',
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('stalenessThresholdDays=999999 → large threshold marks stale source as fresh', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/quality/report?stalenessThresholdDays=999999',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as QualityReportResponse;
    // With 999999 day threshold, nothing should be stale
    expect(body.data.dataFreshness.staleSources).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// DB_UNAVAILABLE — mock prisma that rejects
// ---------------------------------------------------------------------------

describe('GET /quality/report — DB unavailable', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const prismaThatRejects = {
      dish: {
        count: vi.fn().mockRejectedValue(new Error('connection refused')),
        groupBy: vi.fn().mockRejectedValue(new Error('connection refused')),
        findMany: vi.fn().mockRejectedValue(new Error('connection refused')),
      },
      restaurant: {
        count: vi.fn().mockRejectedValue(new Error('connection refused')),
        findMany: vi.fn().mockRejectedValue(new Error('connection refused')),
      },
      dishNutrient: {
        count: vi.fn().mockRejectedValue(new Error('connection refused')),
        findMany: vi.fn().mockRejectedValue(new Error('connection refused')),
      },
      dataSource: {
        findMany: vi.fn().mockRejectedValue(new Error('connection refused')),
      },
      $queryRaw: vi.fn().mockRejectedValue(new Error('connection refused')),
    } as unknown as PrismaClientType;

    app = await buildApp({ prisma: prismaThatRejects });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 500 with DB_UNAVAILABLE error code', async () => {
    const response = await app.inject({ method: 'GET', url: '/quality/report' });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('DB_UNAVAILABLE');
  });
});
