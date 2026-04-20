// Integration tests for F003 — pgvector IVFFlat Indexes
//
// Verifies that IVFFlat indexes exist on foods.embedding and dishes.embedding,
// and that cosine similarity queries use them.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

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
// Index existence
// ---------------------------------------------------------------------------

describe('pgvector IVFFlat index existence', () => {
  type IndexRow = { indexname: string };

  const checkIndex = async (tablename: string, indexname: string): Promise<void> => {
    const rows = await prisma.$queryRaw<IndexRow[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = ${tablename} AND indexname = ${indexname}
    `;
    expect(rows).toHaveLength(1);
  };

  it('foods_embedding_idx exists on foods table', async () => {
    await checkIndex('foods', 'foods_embedding_idx');
  });

  it('dishes_embedding_idx exists on dishes table', async () => {
    await checkIndex('dishes', 'dishes_embedding_idx');
  });
});

// ---------------------------------------------------------------------------
// Index properties (IVFFlat + vector_cosine_ops)
// ---------------------------------------------------------------------------

describe('pgvector IVFFlat index properties', () => {
  type IndexDefRow = { indexdef: string };

  const getIndexDef = async (indexname: string): Promise<string> => {
    const rows = await prisma.$queryRaw<IndexDefRow[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = ${indexname}
    `;
    expect(rows).toHaveLength(1);
    return rows[0]!.indexdef;
  };

  it('foods_embedding_idx uses ivfflat with vector_cosine_ops', async () => {
    const def = await getIndexDef('foods_embedding_idx');
    expect(def.toLowerCase()).toContain('ivfflat');
    expect(def.toLowerCase()).toContain('vector_cosine_ops');
  });

  it('dishes_embedding_idx uses ivfflat with vector_cosine_ops', async () => {
    const def = await getIndexDef('dishes_embedding_idx');
    expect(def.toLowerCase()).toContain('ivfflat');
    expect(def.toLowerCase()).toContain('vector_cosine_ops');
  });

  it('foods_embedding_idx has lists = 100', async () => {
    const def = await getIndexDef('foods_embedding_idx');
    expect(def).toContain('lists');
  });

  it('dishes_embedding_idx has lists = 100', async () => {
    const def = await getIndexDef('dishes_embedding_idx');
    expect(def).toContain('lists');
  });
});

// ---------------------------------------------------------------------------
// Cosine similarity query works
// ---------------------------------------------------------------------------

describe('Cosine similarity query', () => {
  const SRC        = 'f0030000-0000-4000-a000-000000000001';
  const FOOD_ID    = 'f0030000-0000-4000-a000-000000000002';
  const REST_ID    = 'f0030000-0000-4000-a000-000000000003';
  const DISH_ID    = 'f0030000-0000-4000-a000-000000000004';

  // A simple 1536-dim vector: first element = 1.0, rest = 0
  const embeddingLiteral = `[${[1.0, ...Array(1535).fill(0)].join(',')}]`;

  beforeAll(async () => {
    // Cleanup
    await prisma.dishNutrient.deleteMany({ where: { dishId: DISH_ID } });
    await prisma.dishIngredient.deleteMany({ where: { dishId: DISH_ID } });
    await prisma.dishCookingMethod.deleteMany({ where: { dishId: DISH_ID } });
    await prisma.dishDishCategory.deleteMany({ where: { dishId: DISH_ID } });
    await prisma.dish.deleteMany({ where: { id: DISH_ID } });
    await prisma.restaurant.deleteMany({ where: { id: REST_ID } });
    await prisma.foodNutrient.deleteMany({ where: { foodId: FOOD_ID } });
    // standardPortion cleanup removed: F-UX-B migration replaced standard_portions
    // shape — links to dishes (not foods), no foodId column to filter on.
    await prisma.food.deleteMany({ where: { id: FOOD_ID } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });

    // Create fixtures
    await prisma.dataSource.create({ data: { id: SRC, name: 'F003-Test-Src', type: 'official' } });

    await prisma.food.create({
      data: {
        id: FOOD_ID,
        name: 'F003 Test Food',
        nameEs: 'F003 Comida Test',
        aliases: [],
        sourceId: SRC,
        confidenceLevel: 'high',
      },
    });

    // Set embedding via raw SQL (Prisma can't handle vector type)
    await prisma.$executeRawUnsafe(
      `UPDATE foods SET embedding = '${embeddingLiteral}'::vector WHERE id = '${FOOD_ID}'`
    );

    await prisma.restaurant.create({
      data: {
        id: REST_ID,
        name: 'F003 Test Restaurant',
        chainSlug: 'f003-test',
      },
    });

    await prisma.dish.create({
      data: {
        id: DISH_ID,
        name: 'F003 Test Dish',
        restaurantId: REST_ID,
        sourceId: SRC,
        confidenceLevel: 'high',
        estimationMethod: 'scraped',
        availability: 'available',
      },
    });

    await prisma.$executeRawUnsafe(
      `UPDATE dishes SET embedding = '${embeddingLiteral}'::vector WHERE id = '${DISH_ID}'`
    );
  });

  afterAll(async () => {
    await prisma.dish.deleteMany({ where: { id: DISH_ID } });
    await prisma.restaurant.deleteMany({ where: { id: REST_ID } });
    await prisma.food.deleteMany({ where: { id: FOOD_ID } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('finds similar foods by cosine distance', async () => {
    type SimilarRow = { id: string; distance: number };
    const results = await prisma.$queryRawUnsafe<SimilarRow[]>(
      `SELECT id, embedding <=> '${embeddingLiteral}'::vector AS distance
       FROM foods
       WHERE embedding IS NOT NULL
       ORDER BY distance
       LIMIT 5`
    );
    expect(results.length).toBeGreaterThanOrEqual(1);
    const match = results.find(r => r.id === FOOD_ID);
    expect(match).toBeDefined();
    expect(match!.distance).toBeCloseTo(0, 5);
  });

  it('finds similar dishes by cosine distance', async () => {
    type SimilarRow = { id: string; distance: number };
    const results = await prisma.$queryRawUnsafe<SimilarRow[]>(
      `SELECT id, embedding <=> '${embeddingLiteral}'::vector AS distance
       FROM dishes
       WHERE embedding IS NOT NULL
       ORDER BY distance
       LIMIT 5`
    );
    expect(results.length).toBeGreaterThanOrEqual(1);
    const match = results.find(r => r.id === DISH_ID);
    expect(match).toBeDefined();
    expect(match!.distance).toBeCloseTo(0, 5);
  });

  it('sets ivfflat.probes for search quality tuning', async () => {
    // Verify we can set probes without error (this is how you tune IVFFlat recall)
    await prisma.$executeRawUnsafe(`SET ivfflat.probes = 10`);
    type SimilarRow = { id: string; distance: number };
    const results = await prisma.$queryRawUnsafe<SimilarRow[]>(
      `SELECT id, embedding <=> '${embeddingLiteral}'::vector AS distance
       FROM foods
       WHERE embedding IS NOT NULL
       ORDER BY distance
       LIMIT 5`
    );
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Reset to default
    await prisma.$executeRawUnsafe(`SET ivfflat.probes = 1`);
  });
});
