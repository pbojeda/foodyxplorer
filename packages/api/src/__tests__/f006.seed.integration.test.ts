// Integration tests for F006 — Seed Phase 2 (USDA SR Legacy foods)
//
// Requires foodxplorer_test DB with all migrations applied.
// Uses DATABASE_URL_TEST env var.
// Imports seedPhase2 directly (no subprocess).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedPhase2 } from '../../prisma/seed.js';

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const SR_LEGACY_SOURCE_ID = '00000000-0000-0000-0000-000000000002';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Clean SR Legacy data only (Phase 1 data must remain)
  await prisma.standardPortion.deleteMany({
    where: { sourceId: SR_LEGACY_SOURCE_ID },
  });
  await prisma.foodNutrient.deleteMany({
    where: { sourceId: SR_LEGACY_SOURCE_ID },
  });
  await prisma.food.deleteMany({
    where: { sourceId: SR_LEGACY_SOURCE_ID },
  });
  await prisma.dataSource.deleteMany({
    where: { id: SR_LEGACY_SOURCE_ID },
  });

  // Run seed phase 2 against test DB
  await seedPhase2(prisma);
}, 300000); // 5 minute timeout for 500+ foods

afterAll(async () => {
  // Reverse FK order cleanup
  await prisma.standardPortion.deleteMany({
    where: { sourceId: SR_LEGACY_SOURCE_ID },
  });
  await prisma.foodNutrient.deleteMany({
    where: { sourceId: SR_LEGACY_SOURCE_ID },
  });
  await prisma.food.deleteMany({
    where: { sourceId: SR_LEGACY_SOURCE_ID },
  });
  await prisma.dataSource.deleteMany({
    where: { id: SR_LEGACY_SOURCE_ID },
  });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F006 — Seed Phase 2 integration', () => {
  it('creates the SR Legacy DataSource record', async () => {
    const ds = await prisma.dataSource.findUnique({
      where: { id: SR_LEGACY_SOURCE_ID },
    });
    expect(ds).not.toBeNull();
    expect(ds?.name).toBe('USDA SR Legacy');
    expect(ds?.type).toBe('official');
    expect(ds?.url).toBe('https://fdc.nal.usda.gov/download-foods.html');
  });

  it('inserts at least 500 generic foods with foodType=generic and sourceId=SR-Legacy', async () => {
    const count = await prisma.food.count({
      where: { sourceId: SR_LEGACY_SOURCE_ID, foodType: 'generic' },
    });
    expect(count).toBeGreaterThanOrEqual(500);
  });

  it('inserts exactly one FoodNutrient per SR Legacy food', async () => {
    const foodCount = await prisma.food.count({
      where: { sourceId: SR_LEGACY_SOURCE_ID },
    });
    const nutrientCount = await prisma.foodNutrient.count({
      where: { sourceId: SR_LEGACY_SOURCE_ID },
    });
    expect(nutrientCount).toBe(foodCount);
  });

  it('every SR Legacy food has a non-null, non-empty nameEs', async () => {
    const withMissingNameEs = await prisma.food.count({
      where: {
        sourceId: SR_LEGACY_SOURCE_ID,
        OR: [{ nameEs: '' }],
      },
    });
    expect(withMissingNameEs).toBe(0);
  });

  it('every SR Legacy food has externalId prefixed with USDA-SR-', async () => {
    const withWrongPrefix = await prisma.food.count({
      where: {
        sourceId: SR_LEGACY_SOURCE_ID,
        NOT: { externalId: { startsWith: 'USDA-SR-' } },
      },
    });
    expect(withWrongPrefix).toBe(0);
  });

  it('inserts 14 group-level StandardPortions for SR Legacy source', async () => {
    const count = await prisma.standardPortion.count({
      where: { sourceId: SR_LEGACY_SOURCE_ID },
    });
    expect(count).toBe(14);
  });

  it('embedding is set (non-null) for every SR Legacy food via raw SQL check', async () => {
    const result = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(*) AS cnt
      FROM foods
      WHERE source_id = ${SR_LEGACY_SOURCE_ID}::uuid
        AND embedding IS NULL
    `;
    const nullCount = Number(result[0]?.cnt ?? 0);
    expect(nullCount).toBe(0);
  });

  it('is idempotent — running seedPhase2 twice produces no duplicates', async () => {
    const countBefore = await prisma.food.count({
      where: { sourceId: SR_LEGACY_SOURCE_ID },
    });
    const nutrientCountBefore = await prisma.foodNutrient.count({
      where: { sourceId: SR_LEGACY_SOURCE_ID },
    });

    // Run a second time
    await seedPhase2(prisma);

    const countAfter = await prisma.food.count({
      where: { sourceId: SR_LEGACY_SOURCE_ID },
    });
    const nutrientCountAfter = await prisma.foodNutrient.count({
      where: { sourceId: SR_LEGACY_SOURCE_ID },
    });

    expect(countAfter).toBe(countBefore);
    expect(nutrientCountAfter).toBe(nutrientCountBefore);
  }, 300000);

  it('does not modify Phase 1 foods (count remains 5)', async () => {
    const phase1SourceId = '00000000-0000-0000-0000-000000000001';
    const count = await prisma.food.count({
      where: { sourceId: phase1SourceId },
    });
    expect(count).toBe(5);
  });
});
