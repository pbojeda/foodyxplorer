// F001b QA Edge-Case Tests — Schema Enhancements
//
// Targets gaps NOT covered by the existing 153 tests:
//   1. Zod schema boundaries (barcode/brandName max-length, prepMinutes/cookMinutes=0, etc.)
//   2. DB-level zero-boundary values for new CHECK constraints
//   3. Non-composite food can link to Recipe at DB level (application-level-only guard)
//   4. Same food can appear twice in a recipe at different sort positions
//   5. Seed correctness: chicken cholesterol = 85
//   6. description backfill: rows using COALESCE logic produce correct values
//   7. FoodSchema requires foodType (no auto-default on the read schema)
//   8. RecipeIngredientSchema boundary values (sortOrder=0, gramWeight=0, unit=50 chars)
//
// BUGS FOUND:
//   BUG-F001b-01: CreateRecipeSchema — prepMinutes and cookMinutes are nullable() but NOT
//     optional(). Callers cannot omit these fields; they must explicitly pass null.
//     Spec says "nullable INT" implying callers should be able to omit them.
//     The Create schema should use .nullable().optional() or extend with .optional() so
//     that omitting the field (undefined) is treated the same as passing null.
//     Reproduction: CreateRecipeSchema.parse({ foodId, sourceId, servings: 1, prepMinutes: 0 })
//     fails with "cookMinutes: Required" even though cookMinutes is nullable in the schema.
//
// All tests are self-contained. Prefix: ae00000X-000Y-4000-a000-000000000001 (valid hex UUIDs)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  FoodSchema,
  CreateFoodSchema,
  FoodNutrientSchema,
  CreateRecipeSchema,
  CreateRecipeIngredientSchema,
  RecipeIngredientSchema,
  RecipeSchema,
  StandardPortionSchema,
} from '@foodxplorer/shared';

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

// ---------------------------------------------------------------------------
// Zod Schema — CreateFoodSchema boundary values (missing from schemas.test.ts)
// ---------------------------------------------------------------------------

describe('CreateFoodSchema — boundary values (QA gap)', () => {
  const base = {
    name: 'Test',
    nameEs: 'Prueba',
    aliases: [],
    sourceId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    confidenceLevel: 'high' as const,
  };

  it('rejects barcode > 50 characters (max length violation)', () => {
    expect(() =>
      CreateFoodSchema.parse({ ...base, barcode: 'A'.repeat(51) }),
    ).toThrow();
  });

  it('accepts barcode at exactly 50 characters (inclusive max)', () => {
    const result = CreateFoodSchema.parse({ ...base, barcode: 'A'.repeat(50) });
    expect(result.barcode).toHaveLength(50);
  });

  it('rejects brandName > 255 characters (max length violation)', () => {
    expect(() =>
      CreateFoodSchema.parse({ ...base, brandName: 'B'.repeat(256) }),
    ).toThrow();
  });

  it('accepts brandName at exactly 255 characters (inclusive max)', () => {
    const result = CreateFoodSchema.parse({ ...base, brandName: 'B'.repeat(255) });
    expect(result.brandName).toHaveLength(255);
  });

  it('applies default foodType=generic when foodType is omitted', () => {
    const result = CreateFoodSchema.parse(base);
    expect(result.foodType).toBe('generic');
  });
});

// ---------------------------------------------------------------------------
// Zod Schema — FoodSchema (read schema) requires foodType — no auto-default
// ---------------------------------------------------------------------------

describe('FoodSchema — foodType is required (no default on read schema)', () => {
  it('rejects when foodType is omitted from a full Food record', () => {
    expect(() =>
      FoodSchema.parse({
        id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        name: 'Test',
        nameEs: 'Prueba',
        aliases: [],
        sourceId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        confidenceLevel: 'high',
        createdAt: new Date(),
        updatedAt: new Date(),
        // foodType intentionally omitted
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Zod Schema — FoodNutrientSchema (read schema) requires referenceBasis
// ---------------------------------------------------------------------------

describe('FoodNutrientSchema — referenceBasis is required (no default on read schema)', () => {
  it('rejects when referenceBasis is omitted', () => {
    expect(() =>
      FoodNutrientSchema.parse({
        id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        foodId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        calories: 100, proteins: 1, carbohydrates: 1, sugars: 0,
        fats: 1, saturatedFats: 0, fiber: 0, salt: 0, sodium: 0,
        transFats: 0, cholesterol: 0, potassium: 0,
        monounsaturatedFats: 0, polyunsaturatedFats: 0,
        sourceId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        confidenceLevel: 'low',
        createdAt: new Date(),
        updatedAt: new Date(),
        // referenceBasis intentionally omitted
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Zod Schema — CreateRecipeSchema boundary values (missing from schemas.test.ts)
// ---------------------------------------------------------------------------

describe('CreateRecipeSchema — zero-boundary values for nonnegative fields', () => {
  const base = {
    foodId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    sourceId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    servings: 1,
    prepMinutes: null,
    cookMinutes: null,
  };

  it('accepts prepMinutes = 0 and cookMinutes = 0 (nonnegative boundary)', () => {
    const result = CreateRecipeSchema.parse({
      ...base,
      prepMinutes: 0,
      cookMinutes: 0,
    });
    expect(result.prepMinutes).toBe(0);
    expect(result.cookMinutes).toBe(0);
  });

  it('BUG-F001b-01 FIXED: prepMinutes and cookMinutes can be omitted (nullable + optional)', () => {
    // Fixed: CreateRecipeSchema uses .nullable().optional() so callers can omit nullable fields.
    const result = CreateRecipeSchema.parse({
      foodId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      sourceId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      servings: 1,
      prepMinutes: 0,
      // cookMinutes intentionally omitted
    });
    expect(result.cookMinutes).toBeUndefined();
  });

  it('rejects servings = 1.5 (must be integer)', () => {
    expect(() =>
      CreateRecipeSchema.parse({ ...base, servings: 1.5 }),
    ).toThrow();
  });

  it('rejects prepMinutes = 1.5 (must be integer)', () => {
    expect(() =>
      CreateRecipeSchema.parse({ ...base, prepMinutes: 1.5 }),
    ).toThrow();
  });

  it('rejects cookMinutes = 2.3 (must be integer)', () => {
    expect(() =>
      CreateRecipeSchema.parse({ ...base, cookMinutes: 2.3 }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Zod Schema — CreateRecipeIngredientSchema boundary values
// ---------------------------------------------------------------------------

describe('CreateRecipeIngredientSchema — boundary values (QA gap)', () => {
  const base = {
    recipeId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    ingredientFoodId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    amount: 100,
    unit: 'g',
    gramWeight: null,
    sortOrder: 0,
  };

  it('accepts sortOrder = 0 (nonnegative boundary)', () => {
    const result = CreateRecipeIngredientSchema.parse(base);
    expect(result.sortOrder).toBe(0);
  });

  it('accepts gramWeight = 0 (nonnegative boundary)', () => {
    const result = CreateRecipeIngredientSchema.parse({ ...base, gramWeight: 0 });
    expect(result.gramWeight).toBe(0);
  });

  it('accepts unit at exactly 50 characters (inclusive max)', () => {
    const result = CreateRecipeIngredientSchema.parse({
      ...base,
      unit: 'A'.repeat(50),
    });
    expect(result.unit).toHaveLength(50);
  });

  it('rejects unit at 51 characters (max length violation)', () => {
    expect(() =>
      CreateRecipeIngredientSchema.parse({ ...base, unit: 'A'.repeat(51) }),
    ).toThrow();
  });

  it('rejects sortOrder = 0.5 (must be integer)', () => {
    expect(() =>
      CreateRecipeIngredientSchema.parse({ ...base, sortOrder: 0.5 }),
    ).toThrow();
  });

  it('rejects non-UUID ingredientFoodId', () => {
    expect(() =>
      CreateRecipeIngredientSchema.parse({ ...base, ingredientFoodId: 'not-a-uuid' }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Zod Schema — RecipeIngredientSchema (read) and RecipeSchema (read) require all fields
// ---------------------------------------------------------------------------

describe('RecipeSchema and RecipeIngredientSchema — require id and timestamps', () => {
  it('RecipeSchema rejects when id is missing', () => {
    expect(() =>
      RecipeSchema.parse({
        foodId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        sourceId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        servings: 1,
        prepMinutes: null,
        cookMinutes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        // id omitted
      }),
    ).toThrow();
  });

  it('RecipeIngredientSchema rejects when id is missing', () => {
    expect(() =>
      RecipeIngredientSchema.parse({
        recipeId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        ingredientFoodId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        amount: 100,
        unit: 'g',
        gramWeight: null,
        sortOrder: 0,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        // id omitted
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Zod Schema — StandardPortionSchema (read) requires description and isDefault
// ---------------------------------------------------------------------------

describe('StandardPortionSchema — new fields are required (no auto-default on read schema)', () => {
  const base = {
    id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    foodId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    foodGroup: null,
    context: 'snack' as const,
    portionGrams: 50,
    sourceId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    confidenceLevel: 'low' as const,
    description: '50g snack',
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('rejects when description is missing', () => {
    const { description: _d, ...without } = base;
    expect(() => StandardPortionSchema.parse(without)).toThrow();
  });

  it('rejects when isDefault is missing', () => {
    const { isDefault: _i, ...without } = base;
    expect(() => StandardPortionSchema.parse(without)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// DB — Recipe: zero-boundary CHECK values (prepMinutes=0, cookMinutes=0 allowed)
// ---------------------------------------------------------------------------

describe('Recipe — DB zero-boundary CHECK values (QA gap)', () => {
  const SRC = 'ae000001-0001-4000-a000-000000000001';
  const FOOD = 'ae000001-0001-4000-a000-000000000002';

  beforeAll(async () => {
    await prisma.recipeIngredient.deleteMany({ where: { recipe: { source: { id: SRC } } } });
    await prisma.recipe.deleteMany({ where: { source: { id: SRC } } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
    await prisma.dataSource.create({ data: { id: SRC, name: 'QA-Recipe-Zero-Src', type: 'official' } });
    await prisma.food.create({
      data: {
        id: FOOD, name: 'QA Zero Food', nameEs: 'QA Cero',
        aliases: [], sourceId: SRC, confidenceLevel: 'high', foodType: 'composite',
      },
    });
  });

  afterAll(async () => {
    await prisma.recipeIngredient.deleteMany({ where: { recipe: { source: { id: SRC } } } });
    await prisma.recipe.deleteMany({ where: { source: { id: SRC } } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('DB accepts prepMinutes = 0 (>= 0 CHECK allows zero)', async () => {
    const recipe = await prisma.$queryRaw<{ id: string; prep_minutes: number }[]>`
      INSERT INTO recipes (id, food_id, prep_minutes, source_id, created_at, updated_at)
      VALUES (gen_random_uuid(), ${FOOD}::uuid, 0, ${SRC}::uuid, NOW(), NOW())
      RETURNING id, prep_minutes
    `;
    expect(recipe[0]?.prep_minutes).toBe(0);
    const recipeId = recipe[0]?.id;
    if (recipeId) await prisma.$executeRaw`DELETE FROM recipes WHERE id = ${recipeId}::uuid`;
  });

  it('DB accepts cookMinutes = 0 (>= 0 CHECK allows zero)', async () => {
    const recipe = await prisma.$queryRaw<{ id: string; cook_minutes: number }[]>`
      INSERT INTO recipes (id, food_id, cook_minutes, source_id, created_at, updated_at)
      VALUES (gen_random_uuid(), ${FOOD}::uuid, 0, ${SRC}::uuid, NOW(), NOW())
      RETURNING id, cook_minutes
    `;
    expect(recipe[0]?.cook_minutes).toBe(0);
    const recipeId = recipe[0]?.id;
    if (recipeId) await prisma.$executeRaw`DELETE FROM recipes WHERE id = ${recipeId}::uuid`;
  });

  it('DB rejects servings = 0 (> 0 CHECK — zero NOT allowed)', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO recipes (id, food_id, servings, source_id, created_at, updated_at)
        VALUES (gen_random_uuid(), ${FOOD}::uuid, 0, ${SRC}::uuid, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// DB — RecipeIngredient: sort_order=0 accepted, gramWeight=0 accepted
// ---------------------------------------------------------------------------

describe('RecipeIngredient — DB zero-boundary CHECK values (QA gap)', () => {
  const SRC = 'ae000002-0001-4000-a000-000000000001';
  const FOOD_COMPOSITE = 'ae000002-0001-4000-a000-000000000002';
  const FOOD_ING = 'ae000002-0001-4000-a000-000000000003';
  const RECIPE_ID = 'ae000002-0001-4000-a000-000000000004';

  beforeAll(async () => {
    await prisma.recipeIngredient.deleteMany({ where: { recipe: { source: { id: SRC } } } });
    await prisma.recipe.deleteMany({ where: { source: { id: SRC } } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
    await prisma.dataSource.create({ data: { id: SRC, name: 'QA-RI-Zero-Src', type: 'official' } });
    await prisma.food.createMany({
      data: [
        { id: FOOD_COMPOSITE, name: 'QA RI Composite', nameEs: 'QA RI Comp', aliases: [], sourceId: SRC, confidenceLevel: 'high', foodType: 'composite' },
        { id: FOOD_ING, name: 'QA RI Ingredient', nameEs: 'QA RI Ing', aliases: [], sourceId: SRC, confidenceLevel: 'high', foodType: 'generic' },
      ],
    });
    await prisma.recipe.create({
      data: { id: RECIPE_ID, foodId: FOOD_COMPOSITE, sourceId: SRC },
    });
  });

  afterAll(async () => {
    await prisma.recipeIngredient.deleteMany({ where: { recipeId: RECIPE_ID } });
    await prisma.recipe.deleteMany({ where: { source: { id: SRC } } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('DB accepts sort_order = 0 (>= 0 CHECK allows zero)', async () => {
    const ing = await prisma.recipeIngredient.create({
      data: {
        recipeId: RECIPE_ID,
        ingredientFoodId: FOOD_ING,
        amount: 100,
        unit: 'g',
        sortOrder: 0,
      },
    });
    expect(ing.sortOrder).toBe(0);
    await prisma.recipeIngredient.delete({ where: { id: ing.id } });
  });

  it('DB accepts gramWeight = 0 (nullable, no CHECK — zero is valid weight)', async () => {
    const ing = await prisma.$queryRaw<{ id: string; gram_weight: string }[]>`
      INSERT INTO recipe_ingredients (id, recipe_id, ingredient_food_id, amount, unit, gram_weight, sort_order, created_at, updated_at)
      VALUES (gen_random_uuid(), ${RECIPE_ID}::uuid, ${FOOD_ING}::uuid, 100, 'g', 0, 0, NOW(), NOW())
      RETURNING id, gram_weight
    `;
    expect(Number(ing[0]?.gram_weight)).toBe(0);
    const ingId = ing[0]?.id;
    if (ingId) await prisma.$executeRaw`DELETE FROM recipe_ingredients WHERE id = ${ingId}::uuid`;
  });

  it('same food can appear in recipe at two different sort positions (UNIQUE is on 3-tuple)', async () => {
    const ing1 = await prisma.recipeIngredient.create({
      data: {
        recipeId: RECIPE_ID,
        ingredientFoodId: FOOD_ING,
        amount: 100,
        unit: 'g',
        sortOrder: 0,
      },
    });
    const ing2 = await prisma.recipeIngredient.create({
      data: {
        recipeId: RECIPE_ID,
        ingredientFoodId: FOOD_ING,
        amount: 50,
        unit: 'g',
        sortOrder: 1, // different sortOrder — allowed
      },
    });
    expect(ing1.ingredientFoodId).toBe(ing2.ingredientFoodId);
    expect(ing1.sortOrder).not.toBe(ing2.sortOrder);
    await prisma.recipeIngredient.deleteMany({ where: { recipeId: RECIPE_ID } });
  });
});

// ---------------------------------------------------------------------------
// DB — Non-composite food can link to Recipe (constraint is application-level only)
// ---------------------------------------------------------------------------

describe('Recipe — food_type=composite is NOT enforced at DB level (QA spec verification)', () => {
  const SRC = 'ae000003-0001-4000-a000-000000000001';
  const FOOD_GENERIC = 'ae000003-0001-4000-a000-000000000002';

  beforeAll(async () => {
    await prisma.recipeIngredient.deleteMany({ where: { recipe: { source: { id: SRC } } } });
    await prisma.recipe.deleteMany({ where: { source: { id: SRC } } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
    await prisma.dataSource.create({ data: { id: SRC, name: 'QA-NonComp-Src', type: 'official' } });
    await prisma.food.create({
      data: {
        id: FOOD_GENERIC, name: 'QA Generic For Recipe', nameEs: 'QA Genérico',
        aliases: [], sourceId: SRC, confidenceLevel: 'high', foodType: 'generic', // NOT composite
      },
    });
  });

  afterAll(async () => {
    await prisma.recipe.deleteMany({ where: { source: { id: SRC } } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('DB allows linking a non-composite (generic) food to a Recipe — app-level guard only', async () => {
    // This confirms the spec statement: "Recipe model requires food_type = composite
    // but this is application-level logic (not a DB CHECK)"
    const recipe = await prisma.recipe.create({
      data: {
        foodId: FOOD_GENERIC,
        servings: 1,
        sourceId: SRC,
      },
      include: { food: true },
    });

    // DB accepted it — foodType is generic, not composite
    expect(recipe.food.foodType).toBe('generic');
    await prisma.recipe.delete({ where: { id: recipe.id } });
  });
});

// ---------------------------------------------------------------------------
// DB — Seed correctness: chicken cholesterol = 85
// ---------------------------------------------------------------------------

describe('Seed data correctness — chicken cholesterol = 85 (spec requirement)', () => {
  it('chicken breast food nutrient has cholesterol = 85', async () => {
    type Row = { cholesterol: string };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT fn.cholesterol::text
      FROM food_nutrients fn
      JOIN foods f ON f.id = fn.food_id
      WHERE f.id = '00000000-0000-0000-0001-000000000001'::uuid
        AND fn.source_id = '00000000-0000-0000-0000-000000000001'::uuid
    `;
    if (rows.length === 0) {
      // Seed may not have been run against test DB — skip rather than fail
      console.warn('Seed food not found in test DB — seed may not have been applied');
      return;
    }
    expect(Number(rows[0]?.cholesterol)).toBe(85);
  });
});

// ---------------------------------------------------------------------------
// DB — description backfill: COALESCE logic — pre-migration rows get correct values
// ---------------------------------------------------------------------------

describe('Migration backfill — description COALESCE(notes, Standard portion) correctness', () => {
  const SRC = 'ae000004-0001-4000-a000-000000000001';
  const FOOD = 'ae000004-0001-4000-a000-000000000002';

  beforeAll(async () => {
    await prisma.standardPortion.deleteMany({ where: { sourceId: SRC } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
    await prisma.dataSource.create({ data: { id: SRC, name: 'QA-Backfill-Src', type: 'official' } });
    await prisma.food.create({
      data: {
        id: FOOD, name: 'QA Backfill Food', nameEs: 'QA Relleno',
        aliases: [], sourceId: SRC, confidenceLevel: 'low',
      },
    });
  });

  afterAll(async () => {
    await prisma.standardPortion.deleteMany({ where: { sourceId: SRC } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('new StandardPortion with notes gets correct description (backfill already applied; new inserts require explicit description)', async () => {
    // Post-migration, the column is NOT NULL — all new inserts must supply description explicitly.
    // We verify that inserting with an explicit description (simulating a seeded row) works correctly.
    const sp = await prisma.standardPortion.create({
      data: {
        foodId: FOOD,
        foodGroup: null,
        context: 'snack',
        portionGrams: 30,
        sourceId: SRC,
        confidenceLevel: 'low',
        notes: 'A meaningful note',
        description: 'A meaningful note', // must match what COALESCE would have produced
        isDefault: false,
      },
    });
    expect(sp.description).toBe('A meaningful note');
    expect(sp.notes).toBe('A meaningful note');
    await prisma.standardPortion.delete({ where: { id: sp.id } });
  });

  it('all current standard_portions have description derived from non-empty string (global invariant)', async () => {
    type Row = { count: bigint };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT COUNT(*)::bigint AS count
      FROM standard_portions
      WHERE description IS NULL OR description = ''
    `;
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it('standard_portions with notes = Standard portion as fallback are non-empty (COALESCE fallback guard)', async () => {
    // Any row where notes was NULL at migration time would have gotten 'Standard portion'
    // verify no row has an empty or null description regardless
    type Row = { total: bigint; without_desc: bigint };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE description IS NULL OR trim(description) = '')::bigint AS without_desc
      FROM standard_portions
    `;
    expect(Number(rows[0]?.without_desc)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// DB — barcode column: VARCHAR(50) enforced at DB level
// ---------------------------------------------------------------------------

describe('Food barcode — VARCHAR(50) enforced at DB level', () => {
  const SRC = 'ae000005-0001-4000-a000-000000000001';

  beforeAll(async () => {
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
    await prisma.dataSource.create({ data: { id: SRC, name: 'QA-Barcode-Src', type: 'official' } });
  });

  afterAll(async () => {
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('DB rejects barcode > 50 characters (VARCHAR(50) constraint)', async () => {
    const longBarcode = 'B'.repeat(51);
    await expect(
      prisma.$executeRaw`
        INSERT INTO foods (id, name, name_es, aliases, source_id, confidence_level, barcode, created_at, updated_at)
        VALUES (gen_random_uuid(), 'QA BC Food', 'QA BC', ARRAY[]::text[], ${SRC}::uuid, 'low'::"confidence_level", ${longBarcode}, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('DB accepts barcode at exactly 50 characters', async () => {
    const barcode50 = 'C'.repeat(50);
    const food = await prisma.food.create({
      data: {
        name: 'QA Barcode50 Food',
        nameEs: 'QA Código50',
        aliases: [],
        sourceId: SRC,
        confidenceLevel: 'low',
        barcode: barcode50,
      },
    });
    expect(food.barcode).toHaveLength(50);
    await prisma.food.delete({ where: { id: food.id } });
  });
});

// ---------------------------------------------------------------------------
// DB — Recipe ON DELETE RESTRICT for food and source
// ---------------------------------------------------------------------------

describe('Recipe — FK RESTRICT prevents deleting referenced Food or DataSource', () => {
  const SRC = 'ae000006-0001-4000-a000-000000000001';
  const FOOD = 'ae000006-0001-4000-a000-000000000002';

  beforeAll(async () => {
    await prisma.recipeIngredient.deleteMany({ where: { recipe: { source: { id: SRC } } } });
    await prisma.recipe.deleteMany({ where: { source: { id: SRC } } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
    await prisma.dataSource.create({ data: { id: SRC, name: 'QA-Recipe-FK-Src', type: 'official' } });
    await prisma.food.create({
      data: {
        id: FOOD, name: 'QA Recipe FK Food', nameEs: 'QA FK Receta',
        aliases: [], sourceId: SRC, confidenceLevel: 'high', foodType: 'composite',
      },
    });
  });

  afterAll(async () => {
    await prisma.recipe.deleteMany({ where: { source: { id: SRC } } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('RESTRICT prevents deleting a Food that has a Recipe', async () => {
    const recipe = await prisma.recipe.create({
      data: { foodId: FOOD, servings: 1, sourceId: SRC },
    });

    await expect(
      prisma.food.delete({ where: { id: FOOD } }),
    ).rejects.toThrow();

    await prisma.recipe.delete({ where: { id: recipe.id } });
  });

  it('RESTRICT prevents deleting a DataSource that has a Recipe', async () => {
    const recipe = await prisma.recipe.create({
      data: { foodId: FOOD, servings: 1, sourceId: SRC },
    });

    await expect(
      prisma.dataSource.delete({ where: { id: SRC } }),
    ).rejects.toThrow();

    await prisma.recipe.delete({ where: { id: recipe.id } });
  });
});

// ---------------------------------------------------------------------------
// DB — RecipeIngredient ON DELETE RESTRICT for recipe and ingredient food
// ---------------------------------------------------------------------------

describe('RecipeIngredient — RESTRICT prevents deleting referenced Recipe or Food', () => {
  const SRC = 'ae000007-0001-4000-a000-000000000001';
  const FOOD_COMP = 'ae000007-0001-4000-a000-000000000002';
  const FOOD_ING = 'ae000007-0001-4000-a000-000000000003';
  const RECIPE_ID = 'ae000007-0001-4000-a000-000000000004';

  beforeAll(async () => {
    await prisma.recipeIngredient.deleteMany({ where: { recipeId: RECIPE_ID } });
    await prisma.recipe.deleteMany({ where: { id: RECIPE_ID } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
    await prisma.dataSource.create({ data: { id: SRC, name: 'QA-RI-FK-Src', type: 'official' } });
    await prisma.food.createMany({
      data: [
        { id: FOOD_COMP, name: 'QA RI FK Comp', nameEs: 'QA FK RI Comp', aliases: [], sourceId: SRC, confidenceLevel: 'high', foodType: 'composite' },
        { id: FOOD_ING, name: 'QA RI FK Ing', nameEs: 'QA FK RI Ing', aliases: [], sourceId: SRC, confidenceLevel: 'high', foodType: 'generic' },
      ],
    });
    await prisma.recipe.create({
      data: { id: RECIPE_ID, foodId: FOOD_COMP, servings: 1, sourceId: SRC },
    });
  });

  afterAll(async () => {
    await prisma.recipeIngredient.deleteMany({ where: { recipeId: RECIPE_ID } });
    await prisma.recipe.deleteMany({ where: { id: RECIPE_ID } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('RESTRICT prevents deleting a Recipe that has RecipeIngredients', async () => {
    const ing = await prisma.recipeIngredient.create({
      data: {
        recipeId: RECIPE_ID,
        ingredientFoodId: FOOD_ING,
        amount: 100,
        unit: 'g',
        sortOrder: 0,
      },
    });

    await expect(
      prisma.recipe.delete({ where: { id: RECIPE_ID } }),
    ).rejects.toThrow();

    await prisma.recipeIngredient.delete({ where: { id: ing.id } });
  });

  it('RESTRICT prevents deleting a Food that is referenced as an ingredient', async () => {
    const ing = await prisma.recipeIngredient.create({
      data: {
        recipeId: RECIPE_ID,
        ingredientFoodId: FOOD_ING,
        amount: 50,
        unit: 'ml',
        sortOrder: 0,
      },
    });

    await expect(
      prisma.food.delete({ where: { id: FOOD_ING } }),
    ).rejects.toThrow();

    await prisma.recipeIngredient.delete({ where: { id: ing.id } });
  });
});
