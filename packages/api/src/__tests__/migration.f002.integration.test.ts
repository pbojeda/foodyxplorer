// Integration tests for F002 — Dishes & Restaurants Migration
//
// Self-contained test file using 'fd000000-...' prefix for fixture IDs.
// Each describe block creates its own fixtures and cleans them up.
// Full teardown order: dishDishCategory → dishCookingMethod → dishIngredient →
//   dishNutrient → dish → restaurant → food → dataSource

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

// ---------------------------------------------------------------------------
// Restaurant — CRUD and constraints
// ---------------------------------------------------------------------------

describe('Restaurant — CRUD and constraints', () => {
  const SRC        = 'fd000000-0006-4000-a000-000000000001';
  const RESTAURANT = 'fd000000-0006-4000-a000-000000000002';

  beforeAll(async () => {
    // Pre-cleanup in reverse dependency order
    await prisma.dishDishCategory.deleteMany({ where: { dish: { restaurantId: RESTAURANT } } });
    await prisma.dishCookingMethod.deleteMany({ where: { dish: { restaurantId: RESTAURANT } } });
    await prisma.dishIngredient.deleteMany({ where: { dish: { restaurantId: RESTAURANT } } });
    await prisma.dishNutrient.deleteMany({ where: { dish: { restaurantId: RESTAURANT } } });
    await prisma.dish.deleteMany({ where: { restaurantId: RESTAURANT } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
    await prisma.dataSource.create({ data: { id: SRC, name: 'F002-Restaurant-Src', type: 'official' } });
  });

  afterAll(async () => {
    await prisma.dishDishCategory.deleteMany({ where: { dish: { restaurantId: RESTAURANT } } });
    await prisma.dishCookingMethod.deleteMany({ where: { dish: { restaurantId: RESTAURANT } } });
    await prisma.dishIngredient.deleteMany({ where: { dish: { restaurantId: RESTAURANT } } });
    await prisma.dishNutrient.deleteMany({ where: { dish: { restaurantId: RESTAURANT } } });
    await prisma.dish.deleteMany({ where: { restaurantId: RESTAURANT } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('inserts a restaurant and reads it back', async () => {
    const restaurant = await prisma.restaurant.create({
      data: {
        id: RESTAURANT,
        name: "McDonald's Spain",
        chainSlug: 'test-mcdonalds',
        countryCode: 'ES',
        isActive: true,
      },
    });

    expect(restaurant.id).toBe(RESTAURANT);
    expect(restaurant.name).toBe("McDonald's Spain");
    expect(restaurant.countryCode).toBe('ES');
    expect(restaurant.isActive).toBe(true);

    await prisma.restaurant.delete({ where: { id: RESTAURANT } });
  });

  it('(chainSlug, countryCode) UNIQUE — second insert with same pair fails', async () => {
    await prisma.restaurant.create({
      data: {
        id: RESTAURANT,
        name: 'Chain A',
        chainSlug: 'chain-unique-test',
        countryCode: 'ES',
      },
    });

    await expect(
      prisma.restaurant.create({
        data: {
          name: 'Chain A Duplicate',
          chainSlug: 'chain-unique-test',
          countryCode: 'ES',
        },
      }),
    ).rejects.toThrow();

    await prisma.restaurant.delete({ where: { id: RESTAURANT } });
  });

  it('different countryCode same chainSlug succeeds', async () => {
    const r1 = await prisma.restaurant.create({
      data: { name: 'Chain ES', chainSlug: 'chain-multi-country', countryCode: 'ES' },
    });
    const r2 = await prisma.restaurant.create({
      data: { name: 'Chain PT', chainSlug: 'chain-multi-country', countryCode: 'PT' },
    });

    expect(r1.countryCode).toBe('ES');
    expect(r2.countryCode).toBe('PT');

    await prisma.restaurant.deleteMany({ where: { chainSlug: 'chain-multi-country' } });
  });

  it('CHECK fails when country_code is lowercase (es)', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO restaurants (id, name, chain_slug, country_code, is_active, created_at, updated_at)
        VALUES (gen_random_uuid(), 'Test ES', 'test-lowercase-cc', 'es', true, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when country_code is 3 chars (ESP)', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO restaurants (id, name, chain_slug, country_code, is_active, created_at, updated_at)
        VALUES (gen_random_uuid(), 'Test ESP', 'test-3-chars-cc', 'ESP', true, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when country_code is digits (12)', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO restaurants (id, name, chain_slug, country_code, is_active, created_at, updated_at)
        VALUES (gen_random_uuid(), 'Test Digits', 'test-digits-cc', '12', true, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('countryCode defaults to ES via SQL insert without specifying it', async () => {
    await prisma.$executeRaw`
      INSERT INTO restaurants (id, name, chain_slug, is_active, created_at, updated_at)
      VALUES (${RESTAURANT}::uuid, 'Default CC Test', 'test-default-cc', true, NOW(), NOW())
    `;

    type Row = { country_code: string };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT country_code FROM restaurants WHERE id = ${RESTAURANT}::uuid
    `;
    expect(rows[0]?.['country_code']).toBe('ES');

    await prisma.restaurant.delete({ where: { id: RESTAURANT } });
  });
});

// ---------------------------------------------------------------------------
// Dish — CRUD and constraints
// ---------------------------------------------------------------------------

describe('Dish — CRUD and constraints', () => {
  const SRC        = 'fd000000-0007-4000-a000-000000000001';
  const RESTAURANT = 'fd000000-0007-4000-a000-000000000002';
  const DISH       = 'fd000000-0007-4000-a000-000000000003';
  const FOOD       = 'fd000000-0007-4000-a000-000000000004';

  const ZERO_VECTOR = `[${Array(1536).fill(0).join(',')}]`;

  beforeAll(async () => {
    await prisma.dishDishCategory.deleteMany({ where: { dish: { restaurantId: RESTAURANT } } });
    await prisma.dishCookingMethod.deleteMany({ where: { dish: { restaurantId: RESTAURANT } } });
    await prisma.dishIngredient.deleteMany({ where: { dish: { restaurantId: RESTAURANT } } });
    await prisma.dishNutrient.deleteMany({ where: { dish: { restaurantId: RESTAURANT } } });
    await prisma.dish.deleteMany({ where: { restaurantId: RESTAURANT } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.food.deleteMany({ where: { id: FOOD } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });

    await prisma.dataSource.create({ data: { id: SRC, name: 'F002-Dish-Src', type: 'official' } });
    await prisma.food.create({
      data: {
        id: FOOD,
        name: 'F002 Dish Food',
        nameEs: 'Alimento Plato F002',
        aliases: [],
        sourceId: SRC,
        confidenceLevel: 'low',
      },
    });
    await prisma.restaurant.create({
      data: { id: RESTAURANT, name: 'F002 Restaurant', chainSlug: 'f002-dish-test', countryCode: 'ES' },
    });
  });

  afterAll(async () => {
    await prisma.dishDishCategory.deleteMany({ where: { dish: { restaurantId: RESTAURANT } } });
    await prisma.dishCookingMethod.deleteMany({ where: { dish: { restaurantId: RESTAURANT } } });
    await prisma.dishIngredient.deleteMany({ where: { dish: { restaurantId: RESTAURANT } } });
    await prisma.dishNutrient.deleteMany({ where: { dish: { restaurantId: RESTAURANT } } });
    await prisma.dish.deleteMany({ where: { restaurantId: RESTAURANT } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.food.deleteMany({ where: { id: FOOD } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('inserts a dish with nullable foodId and reads it back; embedding can be set via raw SQL', async () => {
    const dish = await prisma.dish.create({
      data: {
        id: DISH,
        restaurantId: RESTAURANT,
        foodId: null,
        sourceId: SRC,
        name: 'Test Dish',
        availability: 'available',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
      },
    });

    expect(dish.id).toBe(DISH);
    expect(dish.foodId).toBeNull();

    await prisma.$executeRaw`
      UPDATE dishes SET embedding = ${ZERO_VECTOR}::vector WHERE id = ${DISH}::uuid
    `;

    type Row = { has_embedding: boolean };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT (embedding IS NOT NULL) AS has_embedding FROM dishes WHERE id = ${DISH}::uuid
    `;
    expect(rows[0]?.['has_embedding']).toBe(true);

    await prisma.dish.delete({ where: { id: DISH } });
  });

  it('availability defaults to available', async () => {
    const dish = await prisma.dish.create({
      data: {
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'Default Avail Dish',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
        // availability omitted
      },
    });

    expect(dish.availability).toBe('available');

    await prisma.dish.delete({ where: { id: dish.id } });
  });

  it('CHECK fails when portionGrams = 0', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO dishes (id, restaurant_id, source_id, name, availability, confidence_level, estimation_method, created_at, updated_at)
        VALUES (gen_random_uuid(), ${RESTAURANT}::uuid, ${SRC}::uuid, 'Portion 0',
                'available'::"dish_availability", 'low'::"confidence_level", 'scraped'::"estimation_method",
                NOW(), NOW())
      `,
    ).resolves.toBeDefined(); // insert itself ok, check portion separately

    await expect(
      prisma.$executeRaw`
        INSERT INTO dishes (id, restaurant_id, source_id, name, availability, confidence_level, estimation_method, portion_grams, created_at, updated_at)
        VALUES (gen_random_uuid(), ${RESTAURANT}::uuid, ${SRC}::uuid, 'Portion Zero',
                'available'::"dish_availability", 'low'::"confidence_level", 'scraped'::"estimation_method",
                0, NOW(), NOW())
      `,
    ).rejects.toThrow();

    await prisma.dish.deleteMany({ where: { name: 'Portion 0', restaurantId: RESTAURANT } });
  });

  it('CHECK fails when portionGrams is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO dishes (id, restaurant_id, source_id, name, availability, confidence_level, estimation_method, portion_grams, created_at, updated_at)
        VALUES (gen_random_uuid(), ${RESTAURANT}::uuid, ${SRC}::uuid, 'Portion Neg',
                'available'::"dish_availability", 'low'::"confidence_level", 'scraped'::"estimation_method",
                -1, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when priceEur is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO dishes (id, restaurant_id, source_id, name, availability, confidence_level, estimation_method, price_eur, created_at, updated_at)
        VALUES (gen_random_uuid(), ${RESTAURANT}::uuid, ${SRC}::uuid, 'Price Neg',
                'available'::"dish_availability", 'low'::"confidence_level", 'scraped'::"estimation_method",
                -0.01, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('UNIQUE fails on (restaurant_id, external_id) when both not null', async () => {
    await prisma.$executeRaw`
      INSERT INTO dishes (id, restaurant_id, source_id, name, availability, confidence_level, estimation_method, external_id, created_at, updated_at)
      VALUES (gen_random_uuid(), ${RESTAURANT}::uuid, ${SRC}::uuid, 'Ext ID 1',
              'available'::"dish_availability", 'low'::"confidence_level", 'scraped'::"estimation_method",
              'EXT-001', NOW(), NOW())
    `;

    await expect(
      prisma.$executeRaw`
        INSERT INTO dishes (id, restaurant_id, source_id, name, availability, confidence_level, estimation_method, external_id, created_at, updated_at)
        VALUES (gen_random_uuid(), ${RESTAURANT}::uuid, ${SRC}::uuid, 'Ext ID 2',
                'available'::"dish_availability", 'low'::"confidence_level", 'scraped'::"estimation_method",
                'EXT-001', NOW(), NOW())
      `,
    ).rejects.toThrow();

    await prisma.dish.deleteMany({ where: { externalId: 'EXT-001', restaurantId: RESTAURANT } });
  });

  it('partial unique: two dishes with same restaurant but both null external_id are allowed', async () => {
    const d1 = await prisma.dish.create({
      data: {
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'No Ext 1',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
        externalId: null,
      },
    });
    const d2 = await prisma.dish.create({
      data: {
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'No Ext 2',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
        externalId: null,
      },
    });

    expect(d1.externalId).toBeNull();
    expect(d2.externalId).toBeNull();

    await prisma.dish.deleteMany({ where: { id: { in: [d1.id, d2.id] } } });
  });

  it('aliases stores and retrieves array correctly', async () => {
    const dish = await prisma.dish.create({
      data: {
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'Alias Dish',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
        aliases: ['alias-one', 'alias-two'],
      },
    });

    expect(dish.aliases).toEqual(['alias-one', 'alias-two']);

    await prisma.dish.delete({ where: { id: dish.id } });
  });
});

// ---------------------------------------------------------------------------
// DishNutrient — CRUD and constraints
// ---------------------------------------------------------------------------

describe('DishNutrient — CRUD and constraints', () => {
  const SRC        = 'fd000000-0008-4000-a000-000000000001';
  const RESTAURANT = 'fd000000-0008-4000-a000-000000000002';
  const DISH       = 'fd000000-0008-4000-a000-000000000003';

  beforeAll(async () => {
    await prisma.dishNutrient.deleteMany({ where: { sourceId: SRC } });
    await prisma.dish.deleteMany({ where: { id: DISH } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });

    await prisma.dataSource.create({ data: { id: SRC, name: 'F002-Nutrient-Src', type: 'official' } });
    await prisma.restaurant.create({
      data: { id: RESTAURANT, name: 'F002 Nutrient Rest', chainSlug: 'f002-nutrient-test', countryCode: 'ES' },
    });
    await prisma.dish.create({
      data: {
        id: DISH,
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'Nutrient Test Dish',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
      },
    });
  });

  afterAll(async () => {
    await prisma.dishNutrient.deleteMany({ where: { sourceId: SRC } });
    await prisma.dish.deleteMany({ where: { id: DISH } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('inserts with all fields and reads back; referenceBasis defaults to per_serving', async () => {
    const dn = await prisma.dishNutrient.create({
      data: {
        dishId: DISH,
        calories: 563,
        proteins: 26,
        carbohydrates: 44,
        sugars: 9,
        fats: 30,
        saturatedFats: 11,
        fiber: 3,
        salt: 1.7,
        sodium: 0.68,
        estimationMethod: 'scraped',
        sourceId: SRC,
        confidenceLevel: 'medium',
        // referenceBasis omitted — should default to per_serving
      },
    });

    expect(dn.referenceBasis).toBe('per_serving');
    expect(Number(dn.calories)).toBe(563);

    await prisma.dishNutrient.delete({ where: { id: dn.id } });
  });

  it('UNIQUE fails on (dish_id, source_id) duplicate', async () => {
    const dn = await prisma.dishNutrient.create({
      data: {
        dishId: DISH,
        calories: 100,
        proteins: 5,
        carbohydrates: 10,
        sugars: 2,
        fats: 3,
        saturatedFats: 1,
        fiber: 1,
        salt: 0.1,
        sodium: 0.04,
        estimationMethod: 'scraped',
        sourceId: SRC,
        confidenceLevel: 'low',
      },
    });

    await expect(
      prisma.dishNutrient.create({
        data: {
          dishId: DISH,
          calories: 200,
          proteins: 10,
          carbohydrates: 20,
          sugars: 4,
          fats: 6,
          saturatedFats: 2,
          fiber: 2,
          salt: 0.2,
          sodium: 0.08,
          estimationMethod: 'scraped',
          sourceId: SRC,
          confidenceLevel: 'low',
        },
      }),
    ).rejects.toThrow();

    await prisma.dishNutrient.delete({ where: { id: dn.id } });
  });

  it('CHECK fails when calories > 9000', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO dish_nutrients (id, dish_id, calories, proteins, carbohydrates, sugars, fats,
          saturated_fats, fiber, salt, sodium, estimation_method, source_id, confidence_level, created_at, updated_at)
        VALUES (gen_random_uuid(), ${DISH}::uuid, 9001, 1, 1, 0, 0, 0, 0, 0, 0,
                'scraped'::"estimation_method", ${SRC}::uuid, 'low'::"confidence_level", NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when calories is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO dish_nutrients (id, dish_id, calories, proteins, carbohydrates, sugars, fats,
          saturated_fats, fiber, salt, sodium, estimation_method, source_id, confidence_level, created_at, updated_at)
        VALUES (gen_random_uuid(), ${DISH}::uuid, -1, 1, 1, 0, 0, 0, 0, 0, 0,
                'scraped'::"estimation_method", ${SRC}::uuid, 'low'::"confidence_level", NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when proteins is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO dish_nutrients (id, dish_id, calories, proteins, carbohydrates, sugars, fats,
          saturated_fats, fiber, salt, sodium, estimation_method, source_id, confidence_level, created_at, updated_at)
        VALUES (gen_random_uuid(), ${DISH}::uuid, 100, -1, 1, 0, 0, 0, 0, 0, 0,
                'scraped'::"estimation_method", ${SRC}::uuid, 'low'::"confidence_level", NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when fats is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO dish_nutrients (id, dish_id, calories, proteins, carbohydrates, sugars, fats,
          saturated_fats, fiber, salt, sodium, estimation_method, source_id, confidence_level, created_at, updated_at)
        VALUES (gen_random_uuid(), ${DISH}::uuid, 100, 1, 1, 0, -0.1, 0, 0, 0, 0,
                'scraped'::"estimation_method", ${SRC}::uuid, 'low'::"confidence_level", NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when trans_fats is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO dish_nutrients (id, dish_id, calories, proteins, carbohydrates, sugars, fats,
          saturated_fats, fiber, salt, sodium, trans_fats, estimation_method, source_id, confidence_level, created_at, updated_at)
        VALUES (gen_random_uuid(), ${DISH}::uuid, 100, 1, 1, 0, 0, 0, 0, 0, 0,
                -0.1, 'scraped'::"estimation_method", ${SRC}::uuid, 'low'::"confidence_level", NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when cholesterol is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO dish_nutrients (id, dish_id, calories, proteins, carbohydrates, sugars, fats,
          saturated_fats, fiber, salt, sodium, cholesterol, estimation_method, source_id, confidence_level, created_at, updated_at)
        VALUES (gen_random_uuid(), ${DISH}::uuid, 100, 1, 1, 0, 0, 0, 0, 0, 0,
                -1, 'scraped'::"estimation_method", ${SRC}::uuid, 'low'::"confidence_level", NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when potassium is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO dish_nutrients (id, dish_id, calories, proteins, carbohydrates, sugars, fats,
          saturated_fats, fiber, salt, sodium, potassium, estimation_method, source_id, confidence_level, created_at, updated_at)
        VALUES (gen_random_uuid(), ${DISH}::uuid, 100, 1, 1, 0, 0, 0, 0, 0, 0,
                -1, 'scraped'::"estimation_method", ${SRC}::uuid, 'low'::"confidence_level", NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when monounsaturated_fats is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO dish_nutrients (id, dish_id, calories, proteins, carbohydrates, sugars, fats,
          saturated_fats, fiber, salt, sodium, monounsaturated_fats, estimation_method, source_id, confidence_level, created_at, updated_at)
        VALUES (gen_random_uuid(), ${DISH}::uuid, 100, 1, 1, 0, 0, 0, 0, 0, 0,
                -1, 'scraped'::"estimation_method", ${SRC}::uuid, 'low'::"confidence_level", NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when polyunsaturated_fats is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO dish_nutrients (id, dish_id, calories, proteins, carbohydrates, sugars, fats,
          saturated_fats, fiber, salt, sodium, polyunsaturated_fats, estimation_method, source_id, confidence_level, created_at, updated_at)
        VALUES (gen_random_uuid(), ${DISH}::uuid, 100, 1, 1, 0, 0, 0, 0, 0, 0,
                -1, 'scraped'::"estimation_method", ${SRC}::uuid, 'low'::"confidence_level", NOW(), NOW())
      `,
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// DishIngredient — CRUD and constraints
// ---------------------------------------------------------------------------

describe('DishIngredient — CRUD and constraints', () => {
  const SRC        = 'fd000000-0009-4000-a000-000000000001';
  const RESTAURANT = 'fd000000-0009-4000-a000-000000000002';
  const DISH       = 'fd000000-0009-4000-a000-000000000003';
  const FOOD_ING   = 'fd000000-0009-4000-a000-000000000004';

  beforeAll(async () => {
    await prisma.dishIngredient.deleteMany({ where: { dishId: DISH } });
    await prisma.dish.deleteMany({ where: { id: DISH } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.food.deleteMany({ where: { id: FOOD_ING } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });

    await prisma.dataSource.create({ data: { id: SRC, name: 'F002-Ingredient-Src', type: 'official' } });
    await prisma.food.create({
      data: {
        id: FOOD_ING,
        name: 'F002 Ingredient Food',
        nameEs: 'Alimento Ingrediente F002',
        aliases: [],
        sourceId: SRC,
        confidenceLevel: 'low',
      },
    });
    await prisma.restaurant.create({
      data: { id: RESTAURANT, name: 'F002 Ingredient Rest', chainSlug: 'f002-ingredient-test', countryCode: 'ES' },
    });
    await prisma.dish.create({
      data: {
        id: DISH,
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'F002 Ingredient Dish',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
      },
    });
  });

  afterAll(async () => {
    await prisma.dishIngredient.deleteMany({ where: { dishId: DISH } });
    await prisma.dish.deleteMany({ where: { id: DISH } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.food.deleteMany({ where: { id: FOOD_ING } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('inserts 2 ingredients and reads them back ordered by sortOrder', async () => {
    await prisma.dishIngredient.create({
      data: {
        dishId: DISH,
        ingredientFoodId: FOOD_ING,
        amount: 150,
        unit: 'g',
        gramWeight: 150,
        sortOrder: 0,
        notes: 'First ingredient',
      },
    });
    // For second, use a different food or different sortOrder with same food
    await prisma.dishIngredient.create({
      data: {
        dishId: DISH,
        ingredientFoodId: FOOD_ING,
        amount: 80,
        unit: 'ml',
        gramWeight: null,
        sortOrder: 1,
        notes: null,
      },
    });

    const ingredients = await prisma.dishIngredient.findMany({
      where: { dishId: DISH },
      orderBy: { sortOrder: 'asc' },
    });

    expect(ingredients).toHaveLength(2);
    expect(ingredients[0]?.sortOrder).toBe(0);
    expect(ingredients[1]?.sortOrder).toBe(1);

    await prisma.dishIngredient.deleteMany({ where: { dishId: DISH } });
  });

  it('gramWeight and notes can be null', async () => {
    const ing = await prisma.dishIngredient.create({
      data: {
        dishId: DISH,
        ingredientFoodId: FOOD_ING,
        amount: 100,
        unit: 'ml',
        gramWeight: null,
        sortOrder: 0,
        notes: null,
      },
    });

    expect(ing.gramWeight).toBeNull();
    expect(ing.notes).toBeNull();

    await prisma.dishIngredient.delete({ where: { id: ing.id } });
  });

  it('UNIQUE fails on (dish_id, ingredient_food_id, sort_order) duplicate', async () => {
    await prisma.$executeRaw`
      INSERT INTO dish_ingredients (id, dish_id, ingredient_food_id, amount, unit, sort_order, created_at, updated_at)
      VALUES (gen_random_uuid(), ${DISH}::uuid, ${FOOD_ING}::uuid, 100, 'g', 0, NOW(), NOW())
    `;

    await expect(
      prisma.$executeRaw`
        INSERT INTO dish_ingredients (id, dish_id, ingredient_food_id, amount, unit, sort_order, created_at, updated_at)
        VALUES (gen_random_uuid(), ${DISH}::uuid, ${FOOD_ING}::uuid, 100, 'g', 0, NOW(), NOW())
      `,
    ).rejects.toThrow();

    await prisma.dishIngredient.deleteMany({ where: { dishId: DISH } });
  });

  it('CHECK fails when amount = 0', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO dish_ingredients (id, dish_id, ingredient_food_id, amount, unit, sort_order, created_at, updated_at)
        VALUES (gen_random_uuid(), ${DISH}::uuid, ${FOOD_ING}::uuid, 0, 'g', 0, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when amount is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO dish_ingredients (id, dish_id, ingredient_food_id, amount, unit, sort_order, created_at, updated_at)
        VALUES (gen_random_uuid(), ${DISH}::uuid, ${FOOD_ING}::uuid, -1, 'g', 0, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when sortOrder is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO dish_ingredients (id, dish_id, ingredient_food_id, amount, unit, sort_order, created_at, updated_at)
        VALUES (gen_random_uuid(), ${DISH}::uuid, ${FOOD_ING}::uuid, 100, 'g', -1, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('CHECK fails when gramWeight is negative', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO dish_ingredients (id, dish_id, ingredient_food_id, amount, unit, gram_weight, sort_order, created_at, updated_at)
        VALUES (gen_random_uuid(), ${DISH}::uuid, ${FOOD_ING}::uuid, 100, 'g', -1, 0, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Junction tables — dish_cooking_methods and dish_dish_categories
// ---------------------------------------------------------------------------

describe('Junction tables — dish_cooking_methods and dish_dish_categories', () => {
  const SRC           = 'fd000000-0010-4000-a000-000000000001';
  const RESTAURANT    = 'fd000000-0010-4000-a000-000000000002';
  const DISH          = 'fd000000-0010-4000-a000-000000000003';
  // Use the seeded cooking method (grilled) and dish category (main-courses)
  const COOKING_METHOD_ID = '00000000-0000-4000-c000-000000000001'; // grilled
  const DISH_CATEGORY_ID  = '00000000-0000-4000-d000-000000000002'; // main-courses

  beforeAll(async () => {
    await prisma.dishDishCategory.deleteMany({ where: { dishId: DISH } });
    await prisma.dishCookingMethod.deleteMany({ where: { dishId: DISH } });
    await prisma.dish.deleteMany({ where: { id: DISH } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });

    await prisma.dataSource.create({ data: { id: SRC, name: 'F002-Junction-Src', type: 'official' } });
    await prisma.restaurant.create({
      data: { id: RESTAURANT, name: 'F002 Junction Rest', chainSlug: 'f002-junction-test', countryCode: 'ES' },
    });
    await prisma.dish.create({
      data: {
        id: DISH,
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'F002 Junction Dish',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
      },
    });
  });

  afterAll(async () => {
    await prisma.dishDishCategory.deleteMany({ where: { dishId: DISH } });
    await prisma.dishCookingMethod.deleteMany({ where: { dishId: DISH } });
    await prisma.dish.deleteMany({ where: { id: DISH } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('links dish to cooking method; verifies row exists', async () => {
    await prisma.dishCookingMethod.create({
      data: { dishId: DISH, cookingMethodId: COOKING_METHOD_ID },
    });

    const row = await prisma.dishCookingMethod.findUnique({
      where: { dishId_cookingMethodId: { dishId: DISH, cookingMethodId: COOKING_METHOD_ID } },
    });
    expect(row).not.toBeNull();
    expect(row?.dishId).toBe(DISH);
  });

  it('links dish to category; verifies row exists', async () => {
    await prisma.dishDishCategory.create({
      data: { dishId: DISH, dishCategoryId: DISH_CATEGORY_ID },
    });

    const row = await prisma.dishDishCategory.findUnique({
      where: { dishId_dishCategoryId: { dishId: DISH, dishCategoryId: DISH_CATEGORY_ID } },
    });
    expect(row).not.toBeNull();
    expect(row?.dishId).toBe(DISH);
  });

  it('DELETE on dish cascades to junction rows', async () => {
    const cascadeDishId = 'fd000000-0010-4000-a000-000000000099';
    await prisma.dish.create({
      data: {
        id: cascadeDishId,
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'Cascade Dish',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
      },
    });
    await prisma.dishCookingMethod.create({
      data: { dishId: cascadeDishId, cookingMethodId: COOKING_METHOD_ID },
    });
    await prisma.dishDishCategory.create({
      data: { dishId: cascadeDishId, dishCategoryId: DISH_CATEGORY_ID },
    });

    // Delete the dish — junction rows should cascade
    await prisma.dish.delete({ where: { id: cascadeDishId } });

    const cmRow = await prisma.dishCookingMethod.findFirst({
      where: { dishId: cascadeDishId },
    });
    const dcRow = await prisma.dishDishCategory.findFirst({
      where: { dishId: cascadeDishId },
    });

    expect(cmRow).toBeNull();
    expect(dcRow).toBeNull();
  });

  it('DELETE on cooking_method with dish linked RESTRICTS', async () => {
    // Try to delete a cooking method that is in use — should fail
    await expect(
      prisma.$executeRaw`
        DELETE FROM cooking_methods WHERE id = ${COOKING_METHOD_ID}::uuid
      `,
    ).rejects.toThrow();
  });

  it('DELETE on dish_category with dish linked RESTRICTS', async () => {
    // Try to delete a dish category that is in use — should fail
    await expect(
      prisma.$executeRaw`
        DELETE FROM dish_categories WHERE id = ${DISH_CATEGORY_ID}::uuid
      `,
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Index existence
// ---------------------------------------------------------------------------

describe('Index existence', () => {
  type IndexRow = { indexname: string };

  const checkIndex = async (tablename: string, indexname: string): Promise<void> => {
    const rows = await prisma.$queryRaw<IndexRow[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = ${tablename} AND indexname = ${indexname}
    `;
    expect(rows).toHaveLength(1);
  };

  it('dishes_restaurant_id_idx exists', async () => {
    await checkIndex('dishes', 'dishes_restaurant_id_idx');
  });

  it('dishes_availability_idx exists', async () => {
    await checkIndex('dishes', 'dishes_availability_idx');
  });

  it('dishes_food_id_partial_idx exists', async () => {
    await checkIndex('dishes', 'dishes_food_id_partial_idx');
  });

  it('dishes_restaurant_id_external_id_partial_key exists', async () => {
    await checkIndex('dishes', 'dishes_restaurant_id_external_id_partial_key');
  });

  it('dishes_name_fts_en_idx exists', async () => {
    await checkIndex('dishes', 'dishes_name_fts_en_idx');
  });

  it('dishes_name_fts_es_idx exists', async () => {
    await checkIndex('dishes', 'dishes_name_fts_es_idx');
  });

  it('dishes_aliases_gin_idx exists', async () => {
    await checkIndex('dishes', 'dishes_aliases_gin_idx');
  });

  it('restaurants_chain_slug_idx exists', async () => {
    await checkIndex('restaurants', 'restaurants_chain_slug_idx');
  });

  it('restaurants_is_active_idx exists', async () => {
    await checkIndex('restaurants', 'restaurants_is_active_idx');
  });

  it('restaurants_chain_slug_country_code_key exists', async () => {
    await checkIndex('restaurants', 'restaurants_chain_slug_country_code_key');
  });

  it('dish_nutrients_dish_id_source_id_key exists', async () => {
    await checkIndex('dish_nutrients', 'dish_nutrients_dish_id_source_id_key');
  });

  it('dish_nutrients_source_id_idx exists', async () => {
    await checkIndex('dish_nutrients', 'dish_nutrients_source_id_idx');
  });

  it('dish_ingredients_dish_id_ingredient_food_id_sort_order_key exists', async () => {
    await checkIndex('dish_ingredients', 'dish_ingredients_dish_id_ingredient_food_id_sort_order_key');
  });

  it('dish_cooking_methods_cooking_method_id_idx exists', async () => {
    await checkIndex('dish_cooking_methods', 'dish_cooking_methods_cooking_method_id_idx');
  });

  it('dish_dish_categories_dish_category_id_idx exists', async () => {
    await checkIndex('dish_dish_categories', 'dish_dish_categories_dish_category_id_idx');
  });

  it('dish_ingredients_dish_id_idx exists', async () => {
    await checkIndex('dish_ingredients', 'dish_ingredients_dish_id_idx');
  });

  it('dish_ingredients_ingredient_food_id_idx exists', async () => {
    await checkIndex('dish_ingredients', 'dish_ingredients_ingredient_food_id_idx');
  });
});

// ---------------------------------------------------------------------------
// FK ON DELETE behavior
// ---------------------------------------------------------------------------

describe('FK ON DELETE behavior', () => {
  const SRC        = 'fd000000-0012-4000-a000-000000000001';
  const RESTAURANT = 'fd000000-0012-4000-a000-000000000002';
  const DISH       = 'fd000000-0012-4000-a000-000000000003';
  const FOOD       = 'fd000000-0012-4000-a000-000000000004';
  const COOKING_METHOD_ID = '00000000-0000-4000-c000-000000000001'; // grilled (seeded)

  beforeAll(async () => {
    await prisma.dishDishCategory.deleteMany({ where: { dishId: DISH } });
    await prisma.dishCookingMethod.deleteMany({ where: { dishId: DISH } });
    await prisma.dishNutrient.deleteMany({ where: { dish: { id: DISH } } });
    await prisma.dish.deleteMany({ where: { id: DISH } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.food.deleteMany({ where: { id: FOOD } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });

    await prisma.dataSource.create({ data: { id: SRC, name: 'F002-FK-Src', type: 'official' } });
    await prisma.food.create({
      data: {
        id: FOOD,
        name: 'F002 FK Food',
        nameEs: 'Alimento FK F002',
        aliases: [],
        sourceId: SRC,
        confidenceLevel: 'low',
      },
    });
    await prisma.restaurant.create({
      data: { id: RESTAURANT, name: 'F002 FK Rest', chainSlug: 'f002-fk-test', countryCode: 'ES' },
    });
    await prisma.dish.create({
      data: {
        id: DISH,
        restaurantId: RESTAURANT,
        foodId: FOOD,
        sourceId: SRC,
        name: 'F002 FK Dish',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
      },
    });
  });

  afterAll(async () => {
    await prisma.dishDishCategory.deleteMany({ where: { dishId: DISH } });
    await prisma.dishCookingMethod.deleteMany({ where: { dishId: DISH } });
    await prisma.dishNutrient.deleteMany({ where: { dish: { id: DISH } } });
    await prisma.dish.deleteMany({ where: { id: DISH } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.food.deleteMany({ where: { id: FOOD } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('deleting a food linked to a dish: dish survives with food_id = NULL (SET NULL)', async () => {
    // Verify dish currently has food_id set
    const before = await prisma.dish.findUnique({ where: { id: DISH } });
    expect(before?.foodId).toBe(FOOD);

    // Delete the food
    await prisma.food.delete({ where: { id: FOOD } });

    // Dish should still exist with food_id = null
    const after = await prisma.dish.findUnique({ where: { id: DISH } });
    expect(after).not.toBeNull();
    expect(after?.foodId).toBeNull();
  });

  it('deleting a dish: dish_cooking_method junction row cascades', async () => {
    // Create a cascade-test dish with a junction row
    const cascadeDishId = 'fd000000-0012-4000-a000-000000000099';
    await prisma.dish.create({
      data: {
        id: cascadeDishId,
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'FK Cascade Dish',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
      },
    });
    await prisma.dishCookingMethod.create({
      data: { dishId: cascadeDishId, cookingMethodId: COOKING_METHOD_ID },
    });

    const before = await prisma.dishCookingMethod.findFirst({ where: { dishId: cascadeDishId } });
    expect(before).not.toBeNull();

    // Delete the dish
    await prisma.dish.delete({ where: { id: cascadeDishId } });

    const after = await prisma.dishCookingMethod.findFirst({ where: { dishId: cascadeDishId } });
    expect(after).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

afterAll(async () => {
  await prisma.$disconnect();
});
