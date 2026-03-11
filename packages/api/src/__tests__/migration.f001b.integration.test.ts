// Integration tests for F001b — Schema Enhancements Migration
//
// Self-contained test file using 'fd000000-...' prefix for fixture IDs.
// Each describe block creates its own DataSource + Food records and cleans them up.
// Teardown order: recipeIngredient → recipe → standardPortion → foodNutrient → food → dataSource

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

// ---------------------------------------------------------------------------
// Food — new columns (foodType, brandName, barcode)
// ---------------------------------------------------------------------------

describe('Food — new columns', () => {
  const SRC = 'fd000000-0001-4000-a000-000000000001';
  const FOOD = 'fd000000-0001-4000-a000-000000000002';

  beforeAll(async () => {
    await prisma.recipeIngredient.deleteMany({ where: { recipe: { source: { id: SRC } } } });
    await prisma.recipe.deleteMany({ where: { source: { id: SRC } } });
    await prisma.standardPortion.deleteMany({ where: { sourceId: SRC } });
    await prisma.foodNutrient.deleteMany({ where: { sourceId: SRC } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
    await prisma.dataSource.create({ data: { id: SRC, name: 'F001b-Food-Src', type: 'official' } });
  });

  afterAll(async () => {
    await prisma.recipeIngredient.deleteMany({ where: { recipe: { source: { id: SRC } } } });
    await prisma.recipe.deleteMany({ where: { source: { id: SRC } } });
    await prisma.standardPortion.deleteMany({ where: { sourceId: SRC } });
    await prisma.foodNutrient.deleteMany({ where: { sourceId: SRC } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('inserts a Food with foodType: branded, brandName, and barcode, and reads them back', async () => {
    const food = await prisma.food.create({
      data: {
        id: FOOD,
        name: 'Heinz Ketchup',
        nameEs: 'Ketchup Heinz',
        aliases: ['ketchup'],
        sourceId: SRC,
        confidenceLevel: 'high',
        foodType: 'branded',
        brandName: 'Heinz',
        barcode: '12345',
      },
    });

    expect(food.foodType).toBe('branded');
    expect(food.brandName).toBe('Heinz');
    expect(food.barcode).toBe('12345');

    await prisma.food.delete({ where: { id: food.id } });
  });

  it('foodType defaults to generic when not specified', async () => {
    const food = await prisma.food.create({
      data: {
        name: 'Generic Food',
        nameEs: 'Alimento Genérico',
        aliases: [],
        sourceId: SRC,
        confidenceLevel: 'low',
      },
    });

    expect(food.foodType).toBe('generic');

    await prisma.food.delete({ where: { id: food.id } });
  });

  it('index foods_barcode_idx exists', async () => {
    type IndexRow = { indexname: string };
    const rows = await prisma.$queryRaw<IndexRow[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'foods' AND indexname = 'foods_barcode_idx'
    `;
    expect(rows).toHaveLength(1);
  });

  it('index foods_food_type_idx exists', async () => {
    type IndexRow = { indexname: string };
    const rows = await prisma.$queryRaw<IndexRow[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'foods' AND indexname = 'foods_food_type_idx'
    `;
    expect(rows).toHaveLength(1);
  });

  it('partial index foods_brand_name_partial_idx exists', async () => {
    type IndexRow = { indexname: string };
    const rows = await prisma.$queryRaw<IndexRow[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'foods' AND indexname = 'foods_brand_name_partial_idx'
    `;
    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// FoodNutrient — new columns
// ---------------------------------------------------------------------------

describe('FoodNutrient — new columns', () => {
  const SRC = 'fd000000-0002-4000-a000-000000000001';
  const FOOD = 'fd000000-0002-4000-a000-000000000002';

  beforeAll(async () => {
    await prisma.foodNutrient.deleteMany({ where: { sourceId: SRC } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
    await prisma.dataSource.create({ data: { id: SRC, name: 'F001b-Nutrient-Src', type: 'official' } });
    await prisma.food.create({
      data: {
        id: FOOD, name: 'F001b Nutrient Food', nameEs: 'Alimento Nutriente F001b',
        aliases: [], sourceId: SRC, confidenceLevel: 'low',
      },
    });
  });

  afterAll(async () => {
    await prisma.foodNutrient.deleteMany({ where: { sourceId: SRC } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('inserts with all new nutrient fields and reads them back', async () => {
    const fn = await prisma.foodNutrient.create({
      data: {
        foodId: FOOD,
        calories: 100,
        proteins: 5,
        carbohydrates: 10,
        sugars: 2,
        fats: 3,
        saturatedFats: 1,
        fiber: 1,
        salt: 0.1,
        sodium: 0.04,
        sourceId: SRC,
        confidenceLevel: 'high',
        referenceBasis: 'per_100g',
        transFats: 0.5,
        cholesterol: 85,
        potassium: 200,
        monounsaturatedFats: 1.2,
        polyunsaturatedFats: 0.8,
      },
    });

    expect(fn.referenceBasis).toBe('per_100g');
    expect(Number(fn.transFats)).toBe(0.5);
    expect(Number(fn.cholesterol)).toBe(85);
    expect(Number(fn.potassium)).toBe(200);
    expect(Number(fn.monounsaturatedFats)).toBe(1.2);
    expect(Number(fn.polyunsaturatedFats)).toBe(0.8);

    await prisma.foodNutrient.delete({ where: { id: fn.id } });
  });

  it('new columns default to 0 when omitted', async () => {
    const auxSrc = await prisma.dataSource.create({
      data: { name: 'F001b-Nutrient-Aux', type: 'estimated' },
    });
    const fn = await prisma.foodNutrient.create({
      data: {
        foodId: FOOD,
        calories: 50,
        proteins: 2,
        carbohydrates: 5,
        sugars: 1,
        fats: 1,
        saturatedFats: 0.5,
        fiber: 0.5,
        salt: 0.05,
        sodium: 0.02,
        sourceId: auxSrc.id,
        confidenceLevel: 'low',
        // new fields omitted — should default to 0
      },
    });

    expect(Number(fn.transFats)).toBe(0);
    expect(Number(fn.cholesterol)).toBe(0);
    expect(Number(fn.potassium)).toBe(0);
    expect(Number(fn.monounsaturatedFats)).toBe(0);
    expect(Number(fn.polyunsaturatedFats)).toBe(0);

    await prisma.foodNutrient.delete({ where: { id: fn.id } });
    await prisma.dataSource.delete({ where: { id: auxSrc.id } });
  });

  it('referenceBasis defaults to per_100g when not specified', async () => {
    const auxSrc2 = await prisma.dataSource.create({
      data: { name: 'F001b-Nutrient-Aux2', type: 'estimated' },
    });
    const fn = await prisma.foodNutrient.create({
      data: {
        foodId: FOOD,
        calories: 30,
        proteins: 1,
        carbohydrates: 3,
        sugars: 1,
        fats: 0.5,
        saturatedFats: 0.2,
        fiber: 0.5,
        salt: 0.02,
        sodium: 0.008,
        sourceId: auxSrc2.id,
        confidenceLevel: 'low',
      },
    });

    expect(fn.referenceBasis).toBe('per_100g');

    await prisma.foodNutrient.delete({ where: { id: fn.id } });
    await prisma.dataSource.delete({ where: { id: auxSrc2.id } });
  });

  it('CHECK fails when transFats is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO food_nutrients
          (id, food_id, calories, proteins, carbohydrates, sugars, fats,
           saturated_fats, fiber, salt, sodium, trans_fats, source_id, confidence_level, created_at, updated_at)
        VALUES
          (gen_random_uuid(), ${FOOD}::uuid,
           100, 1, 1, 0, 0, 0, 0, 0, 0,
           -0.1,
           ${SRC}::uuid, 'low'::"confidence_level", NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when cholesterol is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO food_nutrients
          (id, food_id, calories, proteins, carbohydrates, sugars, fats,
           saturated_fats, fiber, salt, sodium, cholesterol, source_id, confidence_level, created_at, updated_at)
        VALUES
          (gen_random_uuid(), ${FOOD}::uuid,
           100, 1, 1, 0, 0, 0, 0, 0, 0,
           -1,
           ${SRC}::uuid, 'low'::"confidence_level", NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when potassium is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO food_nutrients
          (id, food_id, calories, proteins, carbohydrates, sugars, fats,
           saturated_fats, fiber, salt, sodium, potassium, source_id, confidence_level, created_at, updated_at)
        VALUES
          (gen_random_uuid(), ${FOOD}::uuid,
           100, 1, 1, 0, 0, 0, 0, 0, 0,
           -1,
           ${SRC}::uuid, 'low'::"confidence_level", NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when monounsaturated_fats is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO food_nutrients
          (id, food_id, calories, proteins, carbohydrates, sugars, fats,
           saturated_fats, fiber, salt, sodium, monounsaturated_fats, source_id, confidence_level, created_at, updated_at)
        VALUES
          (gen_random_uuid(), ${FOOD}::uuid,
           100, 1, 1, 0, 0, 0, 0, 0, 0,
           -1,
           ${SRC}::uuid, 'low'::"confidence_level", NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when polyunsaturated_fats is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO food_nutrients
          (id, food_id, calories, proteins, carbohydrates, sugars, fats,
           saturated_fats, fiber, salt, sodium, polyunsaturated_fats, source_id, confidence_level, created_at, updated_at)
        VALUES
          (gen_random_uuid(), ${FOOD}::uuid,
           100, 1, 1, 0, 0, 0, 0, 0, 0,
           -1,
           ${SRC}::uuid, 'low'::"confidence_level", NOW(), NOW())
      `,
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// StandardPortion — new columns (description, isDefault)
// ---------------------------------------------------------------------------

describe('StandardPortion — new columns', () => {
  const SRC = 'fd000000-0003-4000-a000-000000000001';
  const FOOD = 'fd000000-0003-4000-a000-000000000002';

  beforeAll(async () => {
    await prisma.standardPortion.deleteMany({ where: { sourceId: SRC } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
    await prisma.dataSource.create({ data: { id: SRC, name: 'F001b-Portion-Src', type: 'official' } });
    await prisma.food.create({
      data: {
        id: FOOD, name: 'F001b Portion Food', nameEs: 'Alimento Porción F001b',
        aliases: [], sourceId: SRC, confidenceLevel: 'low',
      },
    });
  });

  afterAll(async () => {
    await prisma.standardPortion.deleteMany({ where: { sourceId: SRC } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('inserts with description and isDefault: true, reads them back', async () => {
    const sp = await prisma.standardPortion.create({
      data: {
        foodId: FOOD,
        foodGroup: null,
        context: 'main_course',
        portionGrams: 150,
        sourceId: SRC,
        confidenceLevel: 'high',
        description: '1 chicken breast (150g)',
        isDefault: true,
      },
    });

    expect(sp.description).toBe('1 chicken breast (150g)');
    expect(sp.isDefault).toBe(true);

    await prisma.standardPortion.delete({ where: { id: sp.id } });
  });

  it('description is required — fails with raw SQL insert omitting it', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO standard_portions
          (id, food_id, food_group, context, portion_grams, source_id, confidence_level, created_at, updated_at)
        VALUES
          (gen_random_uuid(), ${FOOD}::uuid, NULL,
           'main_course'::"portion_context", 100,
           ${SRC}::uuid, 'low'::"confidence_level",
           NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('isDefault defaults to false when not specified', async () => {
    const sp = await prisma.standardPortion.create({
      data: {
        foodId: FOOD,
        foodGroup: null,
        context: 'snack',
        portionGrams: 30,
        sourceId: SRC,
        confidenceLevel: 'low',
        description: 'A small snack',
        // isDefault omitted
      },
    });

    expect(sp.isDefault).toBe(false);

    await prisma.standardPortion.delete({ where: { id: sp.id } });
  });
});

// ---------------------------------------------------------------------------
// Recipe — CRUD and constraints
// ---------------------------------------------------------------------------

describe('Recipe — CRUD and constraints', () => {
  const SRC = 'fd000000-0004-4000-a000-000000000001';
  const FOOD_COMPOSITE = 'fd000000-0004-4000-a000-000000000002';
  const FOOD_INGREDIENT = 'fd000000-0004-4000-a000-000000000003';
  const RECIPE_ID = 'fd000000-0004-4000-a000-000000000004';

  beforeAll(async () => {
    await prisma.recipeIngredient.deleteMany({ where: { recipe: { source: { id: SRC } } } });
    await prisma.recipe.deleteMany({ where: { source: { id: SRC } } });
    await prisma.standardPortion.deleteMany({ where: { sourceId: SRC } });
    await prisma.foodNutrient.deleteMany({ where: { sourceId: SRC } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
    await prisma.dataSource.create({ data: { id: SRC, name: 'F001b-Recipe-Src', type: 'official' } });
    await prisma.food.createMany({
      data: [
        {
          id: FOOD_COMPOSITE,
          name: 'Chicken Bowl',
          nameEs: 'Bol de Pollo',
          aliases: [],
          sourceId: SRC,
          confidenceLevel: 'high',
          foodType: 'composite',
        },
        {
          id: FOOD_INGREDIENT,
          name: 'Raw Chicken',
          nameEs: 'Pollo Crudo',
          aliases: [],
          sourceId: SRC,
          confidenceLevel: 'high',
          foodType: 'generic',
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.recipeIngredient.deleteMany({ where: { recipe: { source: { id: SRC } } } });
    await prisma.recipe.deleteMany({ where: { source: { id: SRC } } });
    await prisma.standardPortion.deleteMany({ where: { sourceId: SRC } });
    await prisma.foodNutrient.deleteMany({ where: { sourceId: SRC } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('inserts a Recipe linked to a composite food and reads it back with food relation', async () => {
    const recipe = await prisma.recipe.create({
      data: {
        id: RECIPE_ID,
        foodId: FOOD_COMPOSITE,
        servings: 2,
        prepMinutes: 10,
        cookMinutes: 30,
        sourceId: SRC,
      },
      include: { food: true },
    });

    expect(recipe.id).toBe(RECIPE_ID);
    expect(recipe.foodId).toBe(FOOD_COMPOSITE);
    expect(recipe.servings).toBe(2);
    expect(recipe.prepMinutes).toBe(10);
    expect(recipe.cookMinutes).toBe(30);
    expect(recipe.food.name).toBe('Chicken Bowl');

    await prisma.recipe.delete({ where: { id: recipe.id } });
  });

  it('servings, prepMinutes, cookMinutes can all be null', async () => {
    const recipe = await prisma.recipe.create({
      data: {
        foodId: FOOD_COMPOSITE,
        servings: null,
        prepMinutes: null,
        cookMinutes: null,
        sourceId: SRC,
      },
    });

    expect(recipe.servings).toBeNull();
    expect(recipe.prepMinutes).toBeNull();
    expect(recipe.cookMinutes).toBeNull();

    await prisma.recipe.delete({ where: { id: recipe.id } });
  });

  it('UNIQUE fails when inserting a second Recipe with the same foodId', async () => {
    const recipe1 = await prisma.recipe.create({
      data: {
        foodId: FOOD_COMPOSITE,
        servings: 1,
        sourceId: SRC,
      },
    });

    await expect(
      prisma.recipe.create({
        data: {
          foodId: FOOD_COMPOSITE,
          servings: 1,
          sourceId: SRC,
        },
      }),
    ).rejects.toThrow();

    await prisma.recipe.delete({ where: { id: recipe1.id } });
  });

  it('CHECK fails when servings = 0', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO recipes (id, food_id, servings, source_id, created_at, updated_at)
        VALUES (gen_random_uuid(), ${FOOD_COMPOSITE}::uuid, 0, ${SRC}::uuid, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when servings is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO recipes (id, food_id, servings, source_id, created_at, updated_at)
        VALUES (gen_random_uuid(), ${FOOD_COMPOSITE}::uuid, -1, ${SRC}::uuid, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when prepMinutes is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO recipes (id, food_id, prep_minutes, source_id, created_at, updated_at)
        VALUES (gen_random_uuid(), ${FOOD_COMPOSITE}::uuid, -1, ${SRC}::uuid, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when cookMinutes is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO recipes (id, food_id, cook_minutes, source_id, created_at, updated_at)
        VALUES (gen_random_uuid(), ${FOOD_COMPOSITE}::uuid, -1, ${SRC}::uuid, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('FK fails when food_id references non-existent food', async () => {
    const nonExistentFoodId = 'fd000000-ffff-4000-a000-000000000001';
    await expect(
      prisma.$executeRaw`
        INSERT INTO recipes (id, food_id, source_id, created_at, updated_at)
        VALUES (gen_random_uuid(), ${nonExistentFoodId}::uuid, ${SRC}::uuid, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('FK fails when source_id references non-existent data source', async () => {
    const nonExistentSourceId = 'fd000000-ffff-4000-a000-000000000002';
    await expect(
      prisma.recipe.create({
        data: {
          foodId: FOOD_COMPOSITE,
          servings: 1,
          sourceId: nonExistentSourceId,
        },
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// RecipeIngredient — CRUD and constraints
// ---------------------------------------------------------------------------

describe('RecipeIngredient — CRUD and constraints', () => {
  const SRC = 'fd000000-0005-4000-a000-000000000001';
  const FOOD_COMPOSITE = 'fd000000-0005-4000-a000-000000000002';
  const FOOD_ING_1 = 'fd000000-0005-4000-a000-000000000003';
  const FOOD_ING_2 = 'fd000000-0005-4000-a000-000000000004';
  const RECIPE_ID = 'fd000000-0005-4000-a000-000000000005';

  beforeAll(async () => {
    await prisma.recipeIngredient.deleteMany({ where: { recipe: { source: { id: SRC } } } });
    await prisma.recipe.deleteMany({ where: { source: { id: SRC } } });
    await prisma.standardPortion.deleteMany({ where: { sourceId: SRC } });
    await prisma.foodNutrient.deleteMany({ where: { sourceId: SRC } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
    await prisma.dataSource.create({ data: { id: SRC, name: 'F001b-RI-Src', type: 'official' } });
    await prisma.food.createMany({
      data: [
        {
          id: FOOD_COMPOSITE, name: 'RI Composite', nameEs: 'Compuesto RI',
          aliases: [], sourceId: SRC, confidenceLevel: 'high', foodType: 'composite',
        },
        {
          id: FOOD_ING_1, name: 'RI Ingredient 1', nameEs: 'Ingrediente RI 1',
          aliases: [], sourceId: SRC, confidenceLevel: 'high', foodType: 'generic',
        },
        {
          id: FOOD_ING_2, name: 'RI Ingredient 2', nameEs: 'Ingrediente RI 2',
          aliases: [], sourceId: SRC, confidenceLevel: 'high', foodType: 'generic',
        },
      ],
    });
    await prisma.recipe.create({
      data: {
        id: RECIPE_ID,
        foodId: FOOD_COMPOSITE,
        servings: 2,
        sourceId: SRC,
      },
    });
  });

  afterAll(async () => {
    await prisma.recipeIngredient.deleteMany({ where: { recipe: { source: { id: SRC } } } });
    await prisma.recipe.deleteMany({ where: { source: { id: SRC } } });
    await prisma.standardPortion.deleteMany({ where: { sourceId: SRC } });
    await prisma.foodNutrient.deleteMany({ where: { sourceId: SRC } });
    await prisma.food.deleteMany({ where: { sourceId: SRC } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('inserts 2 RecipeIngredients and reads them back ordered by sortOrder', async () => {
    await prisma.recipeIngredient.create({
      data: {
        recipeId: RECIPE_ID,
        ingredientFoodId: FOOD_ING_1,
        amount: 150,
        unit: 'g',
        gramWeight: 150,
        sortOrder: 0,
        notes: 'First ingredient',
      },
    });
    await prisma.recipeIngredient.create({
      data: {
        recipeId: RECIPE_ID,
        ingredientFoodId: FOOD_ING_2,
        amount: 80,
        unit: 'g',
        gramWeight: 80,
        sortOrder: 1,
        notes: null,
      },
    });

    const ingredients = await prisma.recipeIngredient.findMany({
      where: { recipeId: RECIPE_ID },
      orderBy: { sortOrder: 'asc' },
    });

    expect(ingredients).toHaveLength(2);
    expect(ingredients[0]?.ingredientFoodId).toBe(FOOD_ING_1);
    expect(ingredients[0]?.sortOrder).toBe(0);
    expect(ingredients[1]?.ingredientFoodId).toBe(FOOD_ING_2);
    expect(ingredients[1]?.sortOrder).toBe(1);

    await prisma.recipeIngredient.deleteMany({ where: { recipeId: RECIPE_ID } });
  });

  it('gramWeight and notes can be null', async () => {
    const ing = await prisma.recipeIngredient.create({
      data: {
        recipeId: RECIPE_ID,
        ingredientFoodId: FOOD_ING_1,
        amount: 100,
        unit: 'ml',
        gramWeight: null,
        sortOrder: 0,
        notes: null,
      },
    });

    expect(ing.gramWeight).toBeNull();
    expect(ing.notes).toBeNull();

    await prisma.recipeIngredient.delete({ where: { id: ing.id } });
  });

  it('UNIQUE fails when inserting duplicate (recipe_id, ingredient_food_id, sort_order)', async () => {
    await prisma.$executeRaw`
      INSERT INTO recipe_ingredients (id, recipe_id, ingredient_food_id, amount, unit, sort_order, created_at, updated_at)
      VALUES (gen_random_uuid(), ${RECIPE_ID}::uuid, ${FOOD_ING_1}::uuid, 100, 'g', 0, NOW(), NOW())
    `;

    await expect(
      prisma.$executeRaw`
        INSERT INTO recipe_ingredients (id, recipe_id, ingredient_food_id, amount, unit, sort_order, created_at, updated_at)
        VALUES (gen_random_uuid(), ${RECIPE_ID}::uuid, ${FOOD_ING_1}::uuid, 100, 'g', 0, NOW(), NOW())
      `,
    ).rejects.toThrow();

    await prisma.recipeIngredient.deleteMany({ where: { recipeId: RECIPE_ID } });
  });

  it('CHECK fails when amount = 0', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO recipe_ingredients (id, recipe_id, ingredient_food_id, amount, unit, sort_order, created_at, updated_at)
        VALUES (gen_random_uuid(), ${RECIPE_ID}::uuid, ${FOOD_ING_1}::uuid, 0, 'g', 0, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when amount is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO recipe_ingredients (id, recipe_id, ingredient_food_id, amount, unit, sort_order, created_at, updated_at)
        VALUES (gen_random_uuid(), ${RECIPE_ID}::uuid, ${FOOD_ING_1}::uuid, -1, 'g', 0, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when gram_weight is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO recipe_ingredients (id, recipe_id, ingredient_food_id, amount, unit, gram_weight, sort_order, created_at, updated_at)
        VALUES (gen_random_uuid(), ${RECIPE_ID}::uuid, ${FOOD_ING_1}::uuid, 100, 'g', -1, 0, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when sortOrder is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO recipe_ingredients (id, recipe_id, ingredient_food_id, amount, unit, sort_order, created_at, updated_at)
        VALUES (gen_random_uuid(), ${RECIPE_ID}::uuid, ${FOOD_ING_1}::uuid, 100, 'g', -1, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('FK fails when recipe_id references non-existent recipe', async () => {
    const nonExistentRecipeId = 'fd000000-ffff-4000-a000-000000000003';
    await expect(
      prisma.recipeIngredient.create({
        data: {
          recipeId: nonExistentRecipeId,
          ingredientFoodId: FOOD_ING_1,
          amount: 100,
          unit: 'g',
          sortOrder: 0,
        },
      }),
    ).rejects.toThrow();
  });

  it('FK fails when ingredient_food_id references non-existent food', async () => {
    const nonExistentFoodId = 'fd000000-ffff-4000-a000-000000000004';
    await expect(
      prisma.recipeIngredient.create({
        data: {
          recipeId: RECIPE_ID,
          ingredientFoodId: nonExistentFoodId,
          amount: 100,
          unit: 'g',
          sortOrder: 0,
        },
      }),
    ).rejects.toThrow();
  });

  it('index recipe_ingredients_recipe_id_idx exists', async () => {
    type IndexRow = { indexname: string };
    const rows = await prisma.$queryRaw<IndexRow[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'recipe_ingredients' AND indexname = 'recipe_ingredients_recipe_id_idx'
    `;
    expect(rows).toHaveLength(1);
  });

  it('index recipe_ingredients_ingredient_food_id_idx exists', async () => {
    type IndexRow = { indexname: string };
    const rows = await prisma.$queryRaw<IndexRow[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'recipe_ingredients' AND indexname = 'recipe_ingredients_ingredient_food_id_idx'
    `;
    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Data migration correctness — verify existing data was migrated
// ---------------------------------------------------------------------------

describe('Data migration correctness', () => {
  it('all pre-existing foods have food_type = generic (not null)', async () => {
    type Row = { count: bigint };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT COUNT(*)::bigint AS count FROM foods WHERE food_type IS NULL
    `;
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it('all pre-existing food_nutrients have reference_basis = per_100g (not null)', async () => {
    type Row = { count: bigint };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT COUNT(*)::bigint AS count FROM food_nutrients WHERE reference_basis IS NULL
    `;
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it('all pre-existing standard_portions have a non-null, non-empty description', async () => {
    type Row = { count: bigint };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT COUNT(*)::bigint AS count FROM standard_portions WHERE description IS NULL OR description = ''
    `;
    expect(Number(rows[0]?.count)).toBe(0);
  });
});
