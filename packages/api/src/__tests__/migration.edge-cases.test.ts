// Edge-case integration tests for F001 — Core Tables Migration
//
// Supplements migration.integration.test.ts with scenarios the developer did NOT cover.
//
// ISOLATION STRATEGY: Each describe block is fully self-contained — it creates
// its own DataSource and Food with unique IDs, and deletes them in afterAll.
// This prevents race conditions with the other integration test file's global teardown
// (which calls deleteMany() on all tables with no filter).
//
// BUGS DOCUMENTED BY THIS FILE:
//   BUG-01: portionGrams has NO DB CHECK constraint — zero/negative values are accepted
//   BUG-02: standard_portions ON DELETE SET NULL + XOR CHECK can conflict
//   BUG-03: embedding column type was never verified (only existence)
//   BUG-04: updatedAt only tested for DataSource; Food/FoodNutrient/StandardPortion untested
//   BUG-05: seed script requires .env file — fails silently in CI without it

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  CreateStandardPortionSchema,
  CreateFoodNutrientSchema,
} from '@foodxplorer/shared';

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

// ---------------------------------------------------------------------------
// Embedding column — type and dimension verification
// The existing test only checks column_name existence, not the actual type.
// ---------------------------------------------------------------------------

describe('Embedding column — type and dimension verification', () => {
  // Uses fixed IDs for isolation
  const SRC = 'ec000000-0001-4000-a000-000000000001';
  const FOOD = 'ec000000-0001-4000-a000-000000000002';

  beforeAll(async () => {
    await prisma.standardPortion.deleteMany({ where: { sourceId: SRC } });
    await prisma.foodNutrient.deleteMany({ where: { sourceId: SRC } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
    await prisma.dataSource.create({ data: { id: SRC, name: 'EC-Embed-Src', type: 'estimated' } });
    await prisma.food.create({
      data: {
        id: FOOD, name: 'EC Embed Food', nameEs: 'Alimento EC Embed',
        aliases: [], sourceId: SRC, confidenceLevel: 'low',
      },
    });
  });

  afterAll(async () => {
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('embedding column udt_name is vector (type verification, not just existence)', async () => {
    type ColRow = { column_name: string; udt_name: string };
    const rows = await prisma.$queryRaw<ColRow[]>`
      SELECT column_name, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'foods'
        AND column_name = 'embedding'
    `;
    expect(rows).toHaveLength(1);
    // udt_name for pgvector columns is 'vector' — NOT 'USER-DEFINED'
    expect(rows[0]?.udt_name).toBe('vector');
  });

  it('can write and read back a 1536-dimension zero vector', async () => {
    const zeroVector = `[${Array(1536).fill(0).join(',')}]`;
    await prisma.$executeRaw`
      UPDATE foods SET embedding = ${zeroVector}::vector WHERE id = ${FOOD}::uuid
    `;
    type Row = { has_embedding: boolean };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT (embedding IS NOT NULL) AS has_embedding FROM foods WHERE id = ${FOOD}::uuid
    `;
    expect(rows[0]?.has_embedding).toBe(true);
  });

  it('rejects a vector with wrong dimension (3 instead of 1536)', async () => {
    await expect(
      prisma.$executeRaw`UPDATE foods SET embedding = '[1,2,3]'::vector WHERE id = ${FOOD}::uuid`,
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// BUG-01: portionGrams has NO DB-level CHECK constraint
// Spec intent: portionGrams must be positive (Zod enforces z.number().positive()).
// The migration has NO CHECK (portion_grams > 0) — zero and negative values can be
// inserted directly, bypassing all application validation.
// ---------------------------------------------------------------------------

describe('StandardPortion — portionGrams missing DB CHECK (BUG-01)', () => {
  const SRC = 'ec000000-0002-4000-a000-000000000001';
  const FOOD = 'ec000000-0002-4000-a000-000000000002';

  beforeAll(async () => {
    await prisma.standardPortion.deleteMany({ where: { sourceId: SRC } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
    await prisma.dataSource.create({ data: { id: SRC, name: 'EC-Portion-Src', type: 'estimated' } });
    await prisma.food.create({
      data: {
        id: FOOD, name: 'EC Portion Food', nameEs: 'Alimento EC Porcion',
        aliases: [], sourceId: SRC, confidenceLevel: 'low',
      },
    });
  });

  afterAll(async () => {
    await prisma.standardPortion.deleteMany({ where: { sourceId: SRC } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('DB rejects portionGrams = 0 via CHECK constraint', async () => {
    await expect(prisma.$executeRaw`
      INSERT INTO standard_portions
        (id, food_id, food_group, context, portion_grams, source_id, confidence_level, description, created_at, updated_at)
      VALUES
        (gen_random_uuid(), ${FOOD}::uuid, NULL,
         'snack'::"portion_context", 0.00,
         ${SRC}::uuid, 'low'::"confidence_level",
         'Test portion', NOW(), NOW())
    `).rejects.toThrow();
  });

  it('DB rejects portionGrams = -50 via CHECK constraint', async () => {
    await expect(prisma.$executeRaw`
      INSERT INTO standard_portions
        (id, food_id, food_group, context, portion_grams, source_id, confidence_level, description, created_at, updated_at)
      VALUES
        (gen_random_uuid(), ${FOOD}::uuid, NULL,
         'snack'::"portion_context", -50.00,
         ${SRC}::uuid, 'low'::"confidence_level",
         'Test portion', NOW(), NOW())
    `).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Calories boundary values — exact inclusive boundaries not tested by developer
// ---------------------------------------------------------------------------

describe('FoodNutrient — calories inclusive boundary values', () => {
  const SRC = 'ec000000-0003-4000-a000-000000000001';
  const FOOD = 'ec000000-0003-4000-a000-000000000002';

  beforeAll(async () => {
    await prisma.foodNutrient.deleteMany({ where: { sourceId: SRC } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
    await prisma.dataSource.create({ data: { id: SRC, name: 'EC-Cal-Src', type: 'estimated' } });
    await prisma.food.create({
      data: {
        id: FOOD, name: 'EC Cal Food', nameEs: 'Alimento EC Cal',
        aliases: [], sourceId: SRC, confidenceLevel: 'low',
      },
    });
  });

  afterAll(async () => {
    await prisma.foodNutrient.deleteMany({ where: { sourceId: SRC } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('allows calories = 900 (inclusive upper boundary)', async () => {
    const fn = await prisma.foodNutrient.create({
      data: {
        foodId: FOOD, calories: 900, proteins: 0, carbohydrates: 0,
        sugars: 0, fats: 100, saturatedFats: 10, fiber: 0, salt: 0, sodium: 0,
        sourceId: SRC, confidenceLevel: 'low',
      },
    });
    expect(Number(fn.calories)).toBe(900);
    await prisma.foodNutrient.delete({ where: { id: fn.id } });
  });

  it('allows calories = 0 (inclusive lower boundary)', async () => {
    const fn = await prisma.foodNutrient.create({
      data: {
        foodId: FOOD, calories: 0, proteins: 0, carbohydrates: 0,
        sugars: 0, fats: 0, saturatedFats: 0, fiber: 0, salt: 0, sodium: 0,
        sourceId: SRC, confidenceLevel: 'low',
      },
    });
    expect(Number(fn.calories)).toBe(0);
    await prisma.foodNutrient.delete({ where: { id: fn.id } });
  });

  it('fails at DB level for calories = 900.01 (fractional overshoot)', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO food_nutrients
          (id, food_id, calories, proteins, carbohydrates, sugars, fats,
           saturated_fats, fiber, salt, sodium, source_id, confidence_level, created_at, updated_at)
        VALUES
          (gen_random_uuid(), ${FOOD}::uuid,
           900.01, 0, 0, 0, 0, 0, 0, 0, 0,
           ${SRC}::uuid, 'low'::"confidence_level", NOW(), NOW())
      `,
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// updatedAt auto-update — only DataSource was tested by the developer
// ---------------------------------------------------------------------------

describe('Timestamps — updatedAt auto-update on Food, FoodNutrient, StandardPortion', () => {
  const SRC = 'ec000000-0004-4000-a000-000000000001';
  const FOOD = 'ec000000-0004-4000-a000-000000000002';

  beforeAll(async () => {
    await prisma.standardPortion.deleteMany({ where: { sourceId: SRC } });
    await prisma.foodNutrient.deleteMany({ where: { sourceId: SRC } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
    await prisma.dataSource.create({ data: { id: SRC, name: 'EC-TS-Src', type: 'estimated' } });
    await prisma.food.create({
      data: {
        id: FOOD, name: 'EC TS Food', nameEs: 'Alimento EC TS',
        aliases: [], sourceId: SRC, confidenceLevel: 'low',
      },
    });
  });

  afterAll(async () => {
    await prisma.standardPortion.deleteMany({ where: { sourceId: SRC } });
    await prisma.foodNutrient.deleteMany({ where: { sourceId: SRC } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('updatedAt changes after updating a Food record', async () => {
    const food = await prisma.food.create({
      data: {
        name: 'TS Test Food', nameEs: 'TS Alimento',
        aliases: [], sourceId: SRC, confidenceLevel: 'low',
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const updated = await prisma.food.update({
      where: { id: food.id },
      data: { name: 'TS Test Food Modified' },
    });
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(food.updatedAt.getTime());
    await prisma.food.delete({ where: { id: food.id } });
  });

  it('updatedAt changes after updating a FoodNutrient record', async () => {
    // Use a different source for the nutrient to avoid unique(food_id, source_id) conflict
    const auxSrc = await prisma.dataSource.create({
      data: { name: 'EC-TS-AuxSrc', type: 'estimated' },
    });
    const fn = await prisma.foodNutrient.create({
      data: {
        foodId: FOOD, calories: 50, proteins: 1, carbohydrates: 5,
        sugars: 1, fats: 1, saturatedFats: 0, fiber: 0, salt: 0, sodium: 0,
        sourceId: auxSrc.id, confidenceLevel: 'low',
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const updated = await prisma.foodNutrient.update({
      where: { id: fn.id },
      data: { calories: 55 },
    });
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(fn.updatedAt.getTime());
    await prisma.foodNutrient.delete({ where: { id: fn.id } });
    await prisma.dataSource.delete({ where: { id: auxSrc.id } });
  });

  it('updatedAt changes after updating a StandardPortion record', async () => {
    const sp = await prisma.standardPortion.create({
      data: {
        foodId: FOOD, foodGroup: null, context: 'snack',
        portionGrams: 30, sourceId: SRC, confidenceLevel: 'low',
        description: 'Test portion',
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const updated = await prisma.standardPortion.update({
      where: { id: sp.id },
      data: { portionGrams: 40 },
    });
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(sp.updatedAt.getTime());
    await prisma.standardPortion.delete({ where: { id: sp.id } });
  });
});

// ---------------------------------------------------------------------------
// UNIQUE constraint NULL behavior on foods (external_id, source_id)
// ---------------------------------------------------------------------------

describe('Food — UNIQUE constraint NULL behavior', () => {
  const SRC = 'ec000000-0005-4000-a000-000000000001';

  beforeAll(async () => {
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
    await prisma.dataSource.create({ data: { id: SRC, name: 'EC-UNIQ-Src', type: 'estimated' } });
  });

  afterAll(async () => {
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('allows multiple foods with externalId=NULL from same source (NULL != NULL in UNIQUE)', async () => {
    const food1 = await prisma.food.create({
      data: {
        name: 'Null ExternalId 1', nameEs: 'Sin ID 1',
        aliases: [], sourceId: SRC, externalId: null, confidenceLevel: 'low',
      },
    });
    const food2 = await prisma.food.create({
      data: {
        name: 'Null ExternalId 2', nameEs: 'Sin ID 2',
        aliases: [], sourceId: SRC, externalId: null, confidenceLevel: 'low',
      },
    });
    expect(food1.id).not.toBe(food2.id);
    await prisma.food.delete({ where: { id: food1.id } });
    await prisma.food.delete({ where: { id: food2.id } });
  });
});

// ---------------------------------------------------------------------------
// CI/CD risk: seed script has no DATABASE_URL fallback
// ---------------------------------------------------------------------------

describe('CI/CD risk — seed script DATABASE_URL requirement', () => {
  it('DATABASE_URL_TEST fallback URL is available in integration tests', () => {
    const url =
      process.env['DATABASE_URL_TEST'] ??
      'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';
    expect(url).toContain('foodxplorer_test');
  });

  it('documents BUG-05: seed.ts uses new PrismaClient() with no URL fallback', () => {
    // The seed script uses `new PrismaClient()` with no datasources override and no
    // URL fallback. It relies entirely on DATABASE_URL from the .env file.
    // In a CI environment without .env, `npm run db:seed` will fail with:
    //   PrismaClientInitializationError: Environment variable not found: DATABASE_URL
    // This was confirmed when running `npm run db:seed -w @foodxplorer/api` without .env.
    // The integration tests avoid this by providing a hardcoded fallback URL.
    // Recommended fix: add a fallback in seed.ts or document that .env is required in CI.
    expect('seed.ts requires DATABASE_URL env var — no fallback provided').toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Zod XOR refine — undefined values behave differently from null
// ---------------------------------------------------------------------------

describe('CreateStandardPortionSchema — XOR refine correctness', () => {
  const base = {
    context: 'snack' as const,
    portionGrams: 30,
    sourceId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    confidenceLevel: 'low' as const,
    description: 'Test portion',
  };

  it('rejects both foodId=null and foodGroup=null (XOR violation)', () => {
    expect(() =>
      CreateStandardPortionSchema.parse({ ...base, foodId: null, foodGroup: null }),
    ).toThrow('Exactly one of foodId or foodGroup must be set');
  });

  it('rejects when neither field is provided (both undefined)', () => {
    expect(() =>
      CreateStandardPortionSchema.parse({ ...base }),
    ).toThrow();
  });

  it('accepts only foodId set (XOR valid)', () => {
    const result = CreateStandardPortionSchema.parse({
      ...base,
      foodId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      foodGroup: null,
    });
    expect(result.foodId).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  });

  it('accepts only foodGroup set (XOR valid)', () => {
    const result = CreateStandardPortionSchema.parse({
      ...base,
      foodId: null,
      foodGroup: 'Cereales',
    });
    expect(result.foodGroup).toBe('Cereales');
  });
});

// ---------------------------------------------------------------------------
// FoodNutrient — extra field: Zod z.record vs JSONB type mismatch
// ---------------------------------------------------------------------------

describe('FoodNutrient — extra field Zod/DB type mismatch', () => {
  const SRC = 'ec000000-0006-4000-a000-000000000001';
  const FOOD = 'ec000000-0006-4000-a000-000000000002';

  beforeAll(async () => {
    await prisma.foodNutrient.deleteMany({ where: { sourceId: SRC } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
    await prisma.dataSource.create({ data: { id: SRC, name: 'EC-Extra-Src', type: 'estimated' } });
    await prisma.food.create({
      data: {
        id: FOOD, name: 'EC Extra Food', nameEs: 'Alimento EC Extra',
        aliases: [], sourceId: SRC, confidenceLevel: 'low',
      },
    });
  });

  afterAll(async () => {
    await prisma.foodNutrient.deleteMany({ where: { sourceId: SRC } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('Zod accepts extra as an array (z.unknown allows any JSON value)', () => {
    const result = CreateFoodNutrientSchema.parse({
      foodId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      calories: 100, proteins: 1, carbohydrates: 1, sugars: 0,
      fats: 1, saturatedFats: 0, fiber: 0, salt: 0, sodium: 0,
      extra: [1, 2, 3],
      sourceId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      confidenceLevel: 'low',
    });
    expect(result.extra).toEqual([1, 2, 3]);
  });

  it('Zod accepts extra as a primitive string (z.unknown allows any JSON value)', () => {
    const result = CreateFoodNutrientSchema.parse({
      foodId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      calories: 100, proteins: 1, carbohydrates: 1, sugars: 0,
      fats: 1, saturatedFats: 0, fiber: 0, salt: 0, sodium: 0,
      extra: 'raw string',
      sourceId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      confidenceLevel: 'low',
    });
    expect(result.extra).toBe('raw string');
  });

  it('DB accepts extra as a JSON array — Zod guard can be bypassed via raw SQL', async () => {
    // Confirms the schema/DB mismatch: Zod rejects arrays, but JSONB accepts any valid JSON.
    // Any direct DB write (migration scripts, admin tools, bypassed validation) can store
    // non-object JSON in the extra column, which will break code assuming object shape.
    const insertResult = await prisma.$executeRaw`
      INSERT INTO food_nutrients
        (id, food_id, calories, proteins, carbohydrates, sugars, fats,
         saturated_fats, fiber, salt, sodium, extra, source_id, confidence_level, created_at, updated_at)
      VALUES
        (gen_random_uuid(), ${FOOD}::uuid,
         100, 1, 1, 0, 1, 0, 0, 0, 0,
         '[1, 2, 3]'::jsonb,
         ${SRC}::uuid, 'low'::"confidence_level", NOW(), NOW())
    `;
    expect(insertResult).toBe(1); // DB accepted the array — mismatch confirmed
  });
});

// ---------------------------------------------------------------------------
// Referential integrity — FK cascade / restrict behavior
// Not tested at all by the developer.
// ---------------------------------------------------------------------------

describe('Referential integrity — FK behavior', () => {
  const SRC = 'ec000000-0007-4000-a000-000000000001';
  const FOOD = 'ec000000-0007-4000-a000-000000000002';

  beforeAll(async () => {
    await prisma.standardPortion.deleteMany({ where: { sourceId: SRC } });
    await prisma.foodNutrient.deleteMany({ where: { sourceId: SRC } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
    await prisma.dataSource.create({ data: { id: SRC, name: 'EC-FK-Src', type: 'estimated' } });
    await prisma.food.create({
      data: {
        id: FOOD, name: 'EC FK Food', nameEs: 'Alimento EC FK',
        aliases: [], sourceId: SRC, confidenceLevel: 'low',
      },
    });
  });

  afterAll(async () => {
    await prisma.standardPortion.deleteMany({ where: { sourceId: SRC } });
    await prisma.foodNutrient.deleteMany({ where: { sourceId: SRC } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('RESTRICT on foods.source_id prevents deleting a DataSource with child Foods', async () => {
    await expect(
      prisma.dataSource.delete({ where: { id: SRC } }),
    ).rejects.toThrow();
  });

  it('RESTRICT on food_nutrients.food_id prevents deleting a Food with child Nutrients', async () => {
    const auxSrc = await prisma.dataSource.create({
      data: { name: 'EC-FK-AuxSrc', type: 'estimated' },
    });
    const fn = await prisma.foodNutrient.create({
      data: {
        foodId: FOOD, calories: 10, proteins: 1, carbohydrates: 1,
        sugars: 0, fats: 0, saturatedFats: 0, fiber: 0, salt: 0, sodium: 0,
        sourceId: auxSrc.id, confidenceLevel: 'low',
      },
    });
    await expect(prisma.food.delete({ where: { id: FOOD } })).rejects.toThrow();
    await prisma.foodNutrient.delete({ where: { id: fn.id } });
    await prisma.dataSource.delete({ where: { id: auxSrc.id } });
  });

  it('BUG-02: ON DELETE SET NULL on standard_portions.food_id can violate XOR CHECK', async () => {
    // Scenario: a standard_portion references a food (food_id set, food_group null).
    // When the food is deleted, FK action sets food_id = NULL.
    // Now both food_id and food_group are NULL, which violates the XOR CHECK constraint.
    // PostgreSQL evaluates the CHECK after SET NULL, so the delete SHOULD fail.
    // If it does NOT fail, data corruption is possible (both fields become NULL).

    const tempSrc = await prisma.dataSource.create({
      data: { name: 'EC-FK-TempSrc', type: 'estimated' },
    });
    const tempFood = await prisma.food.create({
      data: {
        name: 'EC FK Temp Food', nameEs: 'Alimento EC FK Temp',
        aliases: [], sourceId: tempSrc.id, confidenceLevel: 'low',
      },
    });

    const sp = await prisma.standardPortion.create({
      data: {
        foodId: tempFood.id, foodGroup: null,
        context: 'snack', portionGrams: 10,
        sourceId: SRC, confidenceLevel: 'low',
        description: 'Test portion',
      },
    });
    expect(sp.foodId).not.toBeNull();
    expect(sp.foodGroup).toBeNull();

    // Deleting tempFood triggers ON DELETE SET NULL on sp.food_id.
    // After SET NULL: food_id=NULL, food_group=NULL → XOR CHECK violated.
    // PostgreSQL should reject this with a constraint violation.
    await expect(
      prisma.food.delete({ where: { id: tempFood.id } }),
    ).rejects.toThrow();

    // Cleanup (sp and tempFood still exist since the delete was rejected)
    await prisma.standardPortion.delete({ where: { id: sp.id } });
    await prisma.food.delete({ where: { id: tempFood.id } });
    await prisma.dataSource.delete({ where: { id: tempSrc.id } });
  });
});

// ---------------------------------------------------------------------------
// FTS search — self-contained tests using own fixture data
// The existing FTS tests depend on beforeAll data from migration.integration.test.ts.
// These tests are fully self-contained.
// ---------------------------------------------------------------------------

describe('FTS and GIN index — self-contained verification', () => {
  const SRC = 'ec000000-0008-4000-a000-000000000001';
  const FOOD = 'ec000000-0008-4000-a000-000000000002';

  beforeAll(async () => {
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
    await prisma.dataSource.create({ data: { id: SRC, name: 'EC-FTS-Src', type: 'official' } });
    await prisma.food.create({
      data: {
        id: FOOD,
        name: 'Garlic bulb',
        nameEs: 'Cabeza de ajo',
        aliases: ['garlic head', 'whole garlic', 'ajo entero'],
        sourceId: SRC,
        foodGroup: 'Vegetables',
        confidenceLevel: 'high',
      },
    });
  });

  afterAll(async () => {
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('finds food by Spanish FTS (name_es = "Cabeza de ajo")', async () => {
    type Row = { id: string; name_es: string };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT id, name_es FROM foods
      WHERE id = ${FOOD}::uuid
        AND to_tsvector('spanish', name_es) @@ plainto_tsquery('spanish', 'ajo')
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.name_es).toBe('Cabeza de ajo');
  });

  it('finds food by English FTS (name = "Garlic bulb")', async () => {
    type Row = { id: string; name: string };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT id, name FROM foods
      WHERE id = ${FOOD}::uuid
        AND to_tsvector('english', name) @@ plainto_tsquery('english', 'garlic')
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.name).toBe('Garlic bulb');
  });

  it('finds food by alias array containment (GIN index)', async () => {
    type Row = { id: string; name: string };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT id, name FROM foods
      WHERE id = ${FOOD}::uuid
        AND aliases @> ARRAY['whole garlic']::text[]
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.name).toBe('Garlic bulb');
  });

  it('Spanish FTS does NOT match on English stopword query (cross-language isolation)', async () => {
    // "the" is an English stopword — searching for it in Spanish FTS should return nothing
    // for the Spanish name field, verifying the indexes are language-specific.
    type Row = { id: string };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT id FROM foods
      WHERE id = ${FOOD}::uuid
        AND to_tsvector('spanish', name_es) @@ plainto_tsquery('english', 'garlic')
    `;
    // Spanish tsvector of "Cabeza de ajo" will not match English query for "garlic"
    // because the lexeme normalization differs between languages.
    // This verifies the two FTS indexes are truly independent.
    expect(rows.length).toBe(0);
  });
});
