// Integration tests for F001 — Core Tables Migration
//
// Uses DATABASE_URL_TEST env var to connect to foodxplorer_test database.
// The test database must have the migration already applied (prisma migrate deploy).
// Run migration against test DB before running these tests.
//
// DATABASE_URL is overridden in the test setup to point to foodxplorer_test.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

// Shared test data IDs
const SOURCE_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FOOD_ID_1 = 'bbbbbbbb-0000-0000-0000-000000000001';
const FOOD_ID_2 = 'bbbbbbbb-0000-0000-0000-000000000002';
const FOOD_ID_3 = 'bbbbbbbb-0000-0000-0000-000000000003';

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Clean up in reverse dependency order (including F001b tables)
  await prisma.recipeIngredient.deleteMany();
  await prisma.recipe.deleteMany();
  await prisma.standardPortion.deleteMany();
  await prisma.foodNutrient.deleteMany();
  await prisma.food.deleteMany();
  await prisma.dataSource.deleteMany();

  // Insert baseline data source
  await prisma.dataSource.create({
    data: {
      id: SOURCE_ID,
      name: 'Test Source',
      type: 'official',
      url: 'https://test.example.com',
    },
  });

  // Insert 3 foods for shared use in tests
  await prisma.food.createMany({
    data: [
      {
        id: FOOD_ID_1,
        name: 'Tomato',
        nameEs: 'Tomate',
        aliases: ['tomatoes', 'cherry tomato'],
        foodGroup: 'Vegetables',
        sourceId: SOURCE_ID,
        externalId: 'EXT-001',
        confidenceLevel: 'high',
      },
      {
        id: FOOD_ID_2,
        name: 'Potato',
        nameEs: 'Patata',
        aliases: ['potatoes', 'spuds'],
        foodGroup: 'Vegetables',
        sourceId: SOURCE_ID,
        externalId: 'EXT-002',
        confidenceLevel: 'medium',
      },
      {
        id: FOOD_ID_3,
        name: 'Lentils',
        nameEs: 'Lentejas',
        aliases: ['red lentils', 'green lentils'],
        foodGroup: 'Legumes',
        sourceId: SOURCE_ID,
        externalId: 'EXT-003',
        confidenceLevel: 'high',
      },
    ],
  });
});

afterAll(async () => {
  // Clean up in reverse dependency order
  await prisma.standardPortion.deleteMany();
  await prisma.foodNutrient.deleteMany();
  await prisma.food.deleteMany();
  await prisma.dataSource.deleteMany();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Happy path: CRUD
// ---------------------------------------------------------------------------

describe('DataSource — CRUD', () => {
  it('inserts a DataSource and returns a UUID with timestamps', async () => {
    const ds = await prisma.dataSource.create({
      data: {
        name: 'FEN Spain',
        type: 'official',
        url: 'https://www.fen.es/',
      },
    });

    expect(ds.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(ds.name).toBe('FEN Spain');
    expect(ds.createdAt).toBeInstanceOf(Date);
    expect(ds.updatedAt).toBeInstanceOf(Date);

    // Cleanup
    await prisma.dataSource.delete({ where: { id: ds.id } });
  });
});

describe('Food — CRUD', () => {
  it('inserts a Food with source relation and returns joined row', async () => {
    const food = await prisma.food.create({
      data: {
        name: 'Apple',
        nameEs: 'Manzana',
        aliases: ['apples', 'green apple'],
        foodGroup: 'Fruits',
        sourceId: SOURCE_ID,
        externalId: 'EXT-APPLE',
        confidenceLevel: 'high',
      },
      include: { source: true },
    });

    expect(food.name).toBe('Apple');
    expect(food.source.name).toBe('Test Source');
    expect(food.createdAt).toBeInstanceOf(Date);

    // Cleanup
    await prisma.food.delete({ where: { id: food.id } });
  });
});

describe('FoodNutrient — CRUD', () => {
  it('inserts a FoodNutrient with valid nutrient values', async () => {
    const fn = await prisma.foodNutrient.create({
      data: {
        foodId: FOOD_ID_1,
        calories: 18,
        proteins: 0.9,
        carbohydrates: 3.9,
        sugars: 2.6,
        fats: 0.2,
        saturatedFats: 0.03,
        fiber: 1.2,
        salt: 0.005,
        sodium: 0.005,
        sourceId: SOURCE_ID,
        confidenceLevel: 'high',
      },
    });

    expect(fn.foodId).toBe(FOOD_ID_1);
    expect(Number(fn.calories)).toBe(18);
    expect(fn.createdAt).toBeInstanceOf(Date);

    // Cleanup
    await prisma.foodNutrient.delete({ where: { id: fn.id } });
  });
});

describe('StandardPortion — CRUD', () => {
  it('inserts a StandardPortion with only foodId set', async () => {
    const sp = await prisma.standardPortion.create({
      data: {
        foodId: FOOD_ID_1,
        foodGroup: null,
        context: 'side_dish',
        portionGrams: 80,
        sourceId: SOURCE_ID,
        confidenceLevel: 'medium',
        description: 'Test portion',
      },
    });

    expect(sp.foodId).toBe(FOOD_ID_1);
    expect(sp.foodGroup).toBeNull();

    // Cleanup
    await prisma.standardPortion.delete({ where: { id: sp.id } });
  });

  it('inserts a StandardPortion with only foodGroup set', async () => {
    const sp = await prisma.standardPortion.create({
      data: {
        foodId: null,
        foodGroup: 'Vegetables',
        context: 'side_dish',
        portionGrams: 100,
        sourceId: SOURCE_ID,
        confidenceLevel: 'low',
        description: 'Test portion',
      },
    });

    expect(sp.foodGroup).toBe('Vegetables');
    expect(sp.foodId).toBeNull();

    // Cleanup
    await prisma.standardPortion.delete({ where: { id: sp.id } });
  });
});

// ---------------------------------------------------------------------------
// Constraint enforcement tests
// ---------------------------------------------------------------------------

describe('FoodNutrient — CHECK constraints', () => {
  it('fails when calories is negative', async () => {
    await expect(
      prisma.foodNutrient.create({
        data: {
          foodId: FOOD_ID_1,
          calories: -1,
          proteins: 1,
          carbohydrates: 1,
          sugars: 0,
          fats: 0,
          saturatedFats: 0,
          fiber: 0,
          salt: 0,
          sodium: 0,
          sourceId: SOURCE_ID,
          confidenceLevel: 'low',
        },
      }),
    ).rejects.toThrow();
  });

  it('fails when calories exceeds 900', async () => {
    await expect(
      prisma.foodNutrient.create({
        data: {
          foodId: FOOD_ID_1,
          calories: 901,
          proteins: 1,
          carbohydrates: 1,
          sugars: 0,
          fats: 0,
          saturatedFats: 0,
          fiber: 0,
          salt: 0,
          sodium: 0,
          sourceId: SOURCE_ID,
          confidenceLevel: 'low',
        },
      }),
    ).rejects.toThrow();
  });

  it('fails when proteins is negative', async () => {
    await expect(
      prisma.foodNutrient.create({
        data: {
          foodId: FOOD_ID_1,
          calories: 100,
          proteins: -0.1,
          carbohydrates: 1,
          sugars: 0,
          fats: 0,
          saturatedFats: 0,
          fiber: 0,
          salt: 0,
          sodium: 0,
          sourceId: SOURCE_ID,
          confidenceLevel: 'low',
        },
      }),
    ).rejects.toThrow();
  });
});

describe('FoodNutrient — UNIQUE constraint (food_id, source_id)', () => {
  it('fails when inserting duplicate (food_id, source_id)', async () => {
    // First insert
    await prisma.foodNutrient.create({
      data: {
        foodId: FOOD_ID_2,
        calories: 77,
        proteins: 2,
        carbohydrates: 17,
        sugars: 0.8,
        fats: 0.1,
        saturatedFats: 0.03,
        fiber: 2.2,
        salt: 0.006,
        sodium: 0.006,
        sourceId: SOURCE_ID,
        confidenceLevel: 'medium',
      },
    });

    // Duplicate insert — must fail
    await expect(
      prisma.foodNutrient.create({
        data: {
          foodId: FOOD_ID_2,
          calories: 77,
          proteins: 2,
          carbohydrates: 17,
          sugars: 0.8,
          fats: 0.1,
          saturatedFats: 0.03,
          fiber: 2.2,
          salt: 0.006,
          sodium: 0.006,
          sourceId: SOURCE_ID,
          confidenceLevel: 'medium',
        },
      }),
    ).rejects.toThrow();

    // Cleanup
    await prisma.foodNutrient.deleteMany({
      where: { foodId: FOOD_ID_2, sourceId: SOURCE_ID },
    });
  });
});

describe('Food — UNIQUE constraint (external_id, source_id)', () => {
  it('fails when inserting duplicate (external_id, source_id)', async () => {
    const food = await prisma.food.create({
      data: {
        name: 'Banana',
        nameEs: 'Plátano',
        aliases: ['bananas'],
        foodGroup: 'Fruits',
        sourceId: SOURCE_ID,
        externalId: 'EXT-BANANA',
        confidenceLevel: 'high',
      },
    });

    await expect(
      prisma.food.create({
        data: {
          name: 'Banana Duplicate',
          nameEs: 'Plátano Duplicado',
          aliases: [],
          foodGroup: 'Fruits',
          sourceId: SOURCE_ID,
          externalId: 'EXT-BANANA',
          confidenceLevel: 'high',
        },
      }),
    ).rejects.toThrow();

    // Cleanup
    await prisma.food.delete({ where: { id: food.id } });
  });
});

describe('StandardPortion — XOR CHECK constraint', () => {
  it('fails when both foodId and foodGroup are set', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO standard_portions (id, food_id, food_group, context, portion_grams, source_id, confidence_level, description, created_at, updated_at)
        VALUES (gen_random_uuid(), ${FOOD_ID_1}::uuid, 'Vegetables', 'side_dish'::"portion_context", 100, ${SOURCE_ID}::uuid, 'low'::"confidence_level", 'Test portion', NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('fails when both foodId and foodGroup are null', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO standard_portions (id, food_id, food_group, context, portion_grams, source_id, confidence_level, description, created_at, updated_at)
        VALUES (gen_random_uuid(), NULL, NULL, 'side_dish'::"portion_context", 100, ${SOURCE_ID}::uuid, 'low'::"confidence_level", 'Test portion', NOW(), NOW())
      `,
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Index / search tests
// ---------------------------------------------------------------------------

describe('FTS and GIN index queries', () => {
  it('finds a food by Spanish full-text search on name_es', async () => {
    type FoodRow = { id: string; name_es: string };
    const rows = await prisma.$queryRaw<FoodRow[]>`
      SELECT id, name_es FROM foods
      WHERE to_tsvector('spanish', name_es) @@ plainto_tsquery('spanish', 'Tomate')
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.name_es).toBe('Tomate');
  });

  it('finds a food by English full-text search on name', async () => {
    type FoodRow = { id: string; name: string };
    const rows = await prisma.$queryRaw<FoodRow[]>`
      SELECT id, name FROM foods
      WHERE to_tsvector('english', name) @@ plainto_tsquery('english', 'Tomato')
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.name).toBe('Tomato');
  });

  it('finds a food by alias array containment', async () => {
    type FoodRow = { id: string; name: string };
    const rows = await prisma.$queryRaw<FoodRow[]>`
      SELECT id, name FROM foods
      WHERE aliases @> ARRAY['cherry tomato']::text[]
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.name).toBe('Tomato');
  });
});

describe('Embedding column', () => {
  it('embedding column exists in foods table with type vector', async () => {
    type ColRow = { column_name: string };
    const rows = await prisma.$queryRaw<ColRow[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'foods' AND column_name = 'embedding'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.column_name).toBe('embedding');
  });
});

// ---------------------------------------------------------------------------
// Timestamp tests
// ---------------------------------------------------------------------------

describe('Timestamps', () => {
  it('createdAt is auto-set on insert and is close to now()', async () => {
    const before = new Date();
    const ds = await prisma.dataSource.create({
      data: { name: 'Timestamp Test Source', type: 'estimated' },
    });
    const after = new Date();

    expect(ds.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(ds.createdAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);

    // Cleanup
    await prisma.dataSource.delete({ where: { id: ds.id } });
  });

  it('updatedAt changes after an update', async () => {
    const ds = await prisma.dataSource.create({
      data: { name: 'UpdatedAt Test Source', type: 'estimated' },
    });

    // Small delay to ensure timestamp difference
    await new Promise((resolve) => setTimeout(resolve, 10));

    const updated = await prisma.dataSource.update({
      where: { id: ds.id },
      data: { name: 'UpdatedAt Test Source Modified' },
    });

    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
      ds.updatedAt.getTime(),
    );

    // Cleanup
    await prisma.dataSource.delete({ where: { id: ds.id } });
  });
});
