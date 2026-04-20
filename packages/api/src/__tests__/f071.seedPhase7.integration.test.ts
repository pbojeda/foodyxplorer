/**
 * F071 - seedPhaseBedca Integration Tests
 *
 * Verifies the BEDCA seed against a real test database.
 * Skipped when DATABASE_URL_TEST is not set or DB is unreachable.
 *
 * Tests:
 * - DataSource row created with priority_tier=1
 * - Foods created with BEDCA-{id} externalId and confidenceLevel='high'
 * - FoodNutrients with confidenceLevel='high', referenceBasis='per_100g'
 * - Idempotency: running twice produces same food count
 * - USDA foods not affected (different sourceId)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedPhaseBedca, BEDCA_SOURCE_UUID } from '../scripts/seedPhaseBedca.js';

const DATABASE_URL_TEST = process.env['DATABASE_URL_TEST'];

// db is set only when the connection succeeds; tests self-skip when undefined
let db: PrismaClient | undefined;

beforeAll(async () => {
  if (!DATABASE_URL_TEST) return;

  try {
    const client = new PrismaClient({
      datasources: { db: { url: DATABASE_URL_TEST } },
    });
    // Verify actual DB connection is reachable before proceeding
    await client.$queryRaw`SELECT 1`;
    db = client;
    process.env['NODE_ENV'] = 'test';
  } catch {
    // DB not reachable or Prisma client not generated - tests will be no-ops
  }
});

afterAll(async () => {
  if (!db) return;

  await db.foodNutrient.deleteMany({ where: { sourceId: BEDCA_SOURCE_UUID } });
  await db.food.deleteMany({ where: { sourceId: BEDCA_SOURCE_UUID } });
  await db.dataSource.deleteMany({ where: { id: BEDCA_SOURCE_UUID } });
  await db.$disconnect();
});

describe('seedPhaseBedca integration', () => {
  it('creates BEDCA DataSource with priority_tier=1', async () => {
    if (!db) return; // no-op when DB unavailable
    await seedPhaseBedca(db);

    const ds = await db.dataSource.findUnique({ where: { id: BEDCA_SOURCE_UUID } });
    expect(ds).not.toBeNull();
    expect(ds!.type).toBe('official');
    expect(ds!.priorityTier).toBe(1);
    expect(ds!.name).toContain('BEDCA');
  });

  it('creates foods with BEDCA-{id} externalId and confidenceLevel=high', async () => {
    if (!db) return;
    await seedPhaseBedca(db);

    const foods = await db.food.findMany({ where: { sourceId: BEDCA_SOURCE_UUID } });
    expect(foods.length).toBeGreaterThan(0);

    for (const food of foods) {
      expect(food.externalId).toMatch(/^BEDCA-\d+$/);
      expect(food.confidenceLevel).toBe('high');
    }

    const oliveOil = foods.find((f) => f.externalId === 'BEDCA-1');
    expect(oliveOil).toBeDefined();
    expect(oliveOil!.nameEs).toBe('Aceite de oliva virgen extra');
    expect(oliveOil!.name).toBe('Extra virgin olive oil');
  });

  it('creates food nutrients with correct fields', async () => {
    if (!db) return;
    await seedPhaseBedca(db);

    const nutrients = await db.foodNutrient.findMany({ where: { sourceId: BEDCA_SOURCE_UUID } });
    expect(nutrients.length).toBeGreaterThan(0);

    for (const n of nutrients) {
      expect(n.confidenceLevel).toBe('high');
      expect(n.referenceBasis).toBe('per_100g');
    }

    const oliveOilFood = await db.food.findFirst({
      where: { externalId: 'BEDCA-1', sourceId: BEDCA_SOURCE_UUID },
    });
    expect(oliveOilFood).not.toBeNull();

    const oliveOilNutrients = await db.foodNutrient.findFirst({
      where: { foodId: oliveOilFood!.id, sourceId: BEDCA_SOURCE_UUID },
    });
    expect(oliveOilNutrients).not.toBeNull();
    expect(Number(oliveOilNutrients!.calories)).toBeCloseTo(884, 0);
    expect(Number(oliveOilNutrients!.fats)).toBeCloseTo(99.9, 0);
    expect(Number(oliveOilNutrients!.salt)).toBe(0);
  });

  it('is idempotent (running twice produces same food count)', async () => {
    if (!db) return;
    await seedPhaseBedca(db);
    const countFirst = await db.food.count({ where: { sourceId: BEDCA_SOURCE_UUID } });

    await seedPhaseBedca(db);
    const countSecond = await db.food.count({ where: { sourceId: BEDCA_SOURCE_UUID } });

    expect(countSecond).toBe(countFirst);
  });

  it('does not affect existing USDA foods', async () => {
    if (!db) return;
    const USDA_SOURCE_UUID = '00000000-0000-0000-0000-000000000002';
    const countBefore = await db.food.count({ where: { sourceId: USDA_SOURCE_UUID } });
    await seedPhaseBedca(db);
    const countAfter = await db.food.count({ where: { sourceId: USDA_SOURCE_UUID } });
    expect(countAfter).toBe(countBefore);
  });
});
