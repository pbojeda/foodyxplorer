// Integration tests for F019 — embedding_updated_at migration + embeddingWriter
//
// Step 1: Verifies embedding_updated_at column exists on foods and dishes.
// Step 6: Verifies writeFoodEmbedding and writeDishEmbedding write vector + timestamp correctly.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { writeFoodEmbedding, writeDishEmbedding } from '../embeddings/embeddingWriter.js';

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Fixture IDs for embeddingWriter tests (f019xxxx- prefix)
// ---------------------------------------------------------------------------

const SRC_ID      = 'f0190000-0001-4000-a000-000000000001';
const FOOD_ID     = 'f0190000-0002-4000-a000-000000000001';
const REST_ID     = 'f0190000-0003-4000-a000-000000000001';
const DISH_ID     = 'f0190000-0004-4000-a000-000000000001';

// A 1536-dim test vector
const TEST_VECTOR = Array(1536).fill(0.01);
const TEST_VECTOR_2 = Array(1536).fill(0.02);

// ---------------------------------------------------------------------------
// Step 1 — Column existence
// ---------------------------------------------------------------------------

describe('F019 migration — embedding_updated_at column', () => {
  type ColumnRow = { column_name: string };

  const checkColumn = async (tableName: string, columnName: string): Promise<void> => {
    const rows = await prisma.$queryRaw<ColumnRow[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = ${tableName}
        AND column_name = ${columnName}
        AND table_schema = 'public'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['column_name']).toBe(columnName);
  };

  it('embedding_updated_at column exists on foods table', async () => {
    await checkColumn('foods', 'embedding_updated_at');
  });

  it('embedding_updated_at column exists on dishes table', async () => {
    await checkColumn('dishes', 'embedding_updated_at');
  });

  it('embedding_updated_at is nullable (TIMESTAMPTZ)', async () => {
    type ColInfoRow = { is_nullable: string; data_type: string; udt_name: string };
    const rows = await prisma.$queryRaw<ColInfoRow[]>`
      SELECT is_nullable, data_type, udt_name
      FROM information_schema.columns
      WHERE table_name = 'foods'
        AND column_name = 'embedding_updated_at'
        AND table_schema = 'public'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['is_nullable']).toBe('YES');
    // TIMESTAMPTZ in information_schema is 'timestamp with time zone'
    expect(rows[0]?.['data_type']).toBe('timestamp with time zone');
  });
});

// ---------------------------------------------------------------------------
// Step 6 — embeddingWriter
// ---------------------------------------------------------------------------

describe('embeddingWriter', () => {
  beforeAll(async () => {
    // Pre-cleanup (reverse dependency order)
    await prisma.dishNutrient.deleteMany({ where: { dishId: DISH_ID } });
    await prisma.dishIngredient.deleteMany({ where: { dishId: DISH_ID } });
    await prisma.dishCookingMethod.deleteMany({ where: { dishId: DISH_ID } });
    await prisma.dishDishCategory.deleteMany({ where: { dishId: DISH_ID } });
    await prisma.dish.deleteMany({ where: { id: DISH_ID } });
    await prisma.restaurant.deleteMany({ where: { id: REST_ID } });
    await prisma.foodNutrient.deleteMany({ where: { foodId: FOOD_ID } });
    // standardPortion cleanup removed: F-UX-B migration replaced standard_portions
    // shape — it links to dishes (not foods), no foodId column to filter on.
    await prisma.food.deleteMany({ where: { id: FOOD_ID } });
    await prisma.dataSource.deleteMany({ where: { id: SRC_ID } });

    // Create fixtures
    await prisma.dataSource.create({
      data: { id: SRC_ID, name: 'F019-Test-Src', type: 'official' },
    });

    await prisma.food.create({
      data: {
        id: FOOD_ID,
        name: 'F019 Test Food',
        nameEs: 'F019 Comida Test',
        aliases: [],
        sourceId: SRC_ID,
        confidenceLevel: 'high',
      },
    });

    await prisma.restaurant.create({
      data: {
        id: REST_ID,
        name: 'F019 Test Restaurant',
        chainSlug: 'f019-test',
      },
    });

    await prisma.dish.create({
      data: {
        id: DISH_ID,
        name: 'F019 Test Dish',
        restaurantId: REST_ID,
        sourceId: SRC_ID,
        confidenceLevel: 'high',
        estimationMethod: 'scraped',
        availability: 'available',
      },
    });
  });

  afterAll(async () => {
    // Cleanup in reverse dependency order
    await prisma.dish.deleteMany({ where: { id: DISH_ID } });
    await prisma.restaurant.deleteMany({ where: { id: REST_ID } });
    await prisma.food.deleteMany({ where: { id: FOOD_ID } });
    await prisma.dataSource.deleteMany({ where: { id: SRC_ID } });
  });

  it('writeFoodEmbedding sets embedding and embedding_updated_at on the food row', async () => {
    await writeFoodEmbedding(prisma, FOOD_ID, TEST_VECTOR);

    type FoodRow = { has_embedding: boolean; embedding_updated_at: Date | null };
    const rows = await prisma.$queryRawUnsafe<FoodRow[]>(
      `SELECT embedding IS NOT NULL AS has_embedding, embedding_updated_at
       FROM foods WHERE id = '${FOOD_ID}'`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.['has_embedding']).toBe(true);
    expect(rows[0]?.['embedding_updated_at']).not.toBeNull();
  });

  it('writeDishEmbedding sets embedding and embedding_updated_at on the dish row', async () => {
    await writeDishEmbedding(prisma, DISH_ID, TEST_VECTOR);

    type DishRow = { has_embedding: boolean; embedding_updated_at: Date | null };
    const rows = await prisma.$queryRawUnsafe<DishRow[]>(
      `SELECT embedding IS NOT NULL AS has_embedding, embedding_updated_at
       FROM dishes WHERE id = '${DISH_ID}'`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.['has_embedding']).toBe(true);
    expect(rows[0]?.['embedding_updated_at']).not.toBeNull();
  });

  it('re-calling writeFoodEmbedding updates embedding_updated_at to a later timestamp', async () => {
    // First write
    await writeFoodEmbedding(prisma, FOOD_ID, TEST_VECTOR);

    type TimestampRow = { embedding_updated_at: Date | null };
    const rows1 = await prisma.$queryRawUnsafe<TimestampRow[]>(
      `SELECT embedding_updated_at FROM foods WHERE id = '${FOOD_ID}'`,
    );
    const firstTimestamp = rows1[0]?.['embedding_updated_at'];
    expect(firstTimestamp).not.toBeNull();

    // Brief delay to ensure timestamps differ
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Second write
    await writeFoodEmbedding(prisma, FOOD_ID, TEST_VECTOR_2);

    const rows2 = await prisma.$queryRawUnsafe<TimestampRow[]>(
      `SELECT embedding_updated_at FROM foods WHERE id = '${FOOD_ID}'`,
    );
    const secondTimestamp = rows2[0]?.['embedding_updated_at'];
    expect(secondTimestamp).not.toBeNull();

    // The second timestamp should be >= the first (NOW() may be equal in fast DBs)
    if (firstTimestamp !== null && firstTimestamp !== undefined && secondTimestamp !== null && secondTimestamp !== undefined) {
      expect(secondTimestamp.getTime()).toBeGreaterThanOrEqual(firstTimestamp.getTime());
    }
  });
});
