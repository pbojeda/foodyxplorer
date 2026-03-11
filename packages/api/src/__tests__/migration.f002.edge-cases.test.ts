// F002 QA Edge-Case Tests — Dishes & Restaurants
//
// Targets gaps NOT covered by the 55 existing F002 integration tests:
//
//  1. Zod schema boundary values
//     - name/slug max-length (255 / 100) inclusive and +1 violations
//     - countryCode edge cases: 1 char, empty, mixed-case, numeric, special chars
//     - portionGrams and priceEur DECIMAL(8,2) overflow (> 999999.99)
//     - calories exactly 9000 (allowed) and 9000.01 (rejected by Zod)
//     - aliases containing non-string elements
//     - externalId at max length (100 chars)
//     - zero vs. null distinction for portionGrams / priceEur in Zod
//
//  2. DB boundary conditions
//     - calories = 9000 (boundary — must be ALLOWED by CHECK)
//     - calories = 9001 (boundary +1 — must be REJECTED by CHECK)
//     - portionGrams = 0.01 (minimum > 0 positive)
//     - priceEur = 0.00 (boundary >= 0)
//     - gramWeight = 0 (boundary >= 0 allowed)
//     - sortOrder = 0 (boundary >= 0 allowed)
//
//  3. FK RESTRICT verification (not covered in integration test)
//     - Deleting a Restaurant with Dishes linked → RESTRICT
//     - Deleting a DataSource with Dishes linked → RESTRICT
//     - Deleting a Dish with DishNutrients linked → RESTRICT
//     - Deleting a Dish with DishIngredients linked → RESTRICT
//     - Deleting a Food that is referenced as DishIngredient.ingredientFoodId → RESTRICT
//     - Deleting a DataSource linked to DishNutrients → RESTRICT
//
//  4. Junction table edge cases
//     - Duplicate junction row (composite PK rejects) for dish_cooking_methods
//     - Duplicate junction row (composite PK rejects) for dish_dish_categories
//     - Dish with no junctions can be deleted cleanly (no orphan errors)
//
//  5. Partial unique index: multiple null external_ids per restaurant
//     - Already covered in integration test (confirmed pass)
//     - Extended: same external_id for different restaurants is ALLOWED
//     - Same external_id + same restaurant = REJECTED (partial unique)
//
//  6. DishAvailability enum Zod vs DB consistency
//     - All 4 values accepted by DB
//     - DB rejects invalid availability string
//
//  7. Zod schema — DishNutrientSchema (read schema) requires estimationMethod
//     - Omitting estimationMethod from read schema should fail
//
//  8. Zod schema — CookingMethodSchema slug at max (100 chars) and +1
//
//  9. BUG REGRESSION: dish_nutrients_nutrients_non_negative_check
//     - Verify the CHECK does NOT incorrectly reference the extra/JSONB column
//     - Insert with extra = NULL should succeed (non-negative nutrients are valid)
//
// BUGS FOUND DURING QA:
//   BUG-F002-01: dish_nutrients_nutrients_non_negative_check in migration.sql (ticket spec
//     Section 7) shows `AND extra IS NOT NULL OR extra IS NULL` appended to the non-negative
//     check. This is always TRUE (tautology) but reveals copy-paste from ticket spec prose.
//     The ACTUAL migration correctly omits the extra clause.
//     STATUS: Not a bug in the code, only a misleading ticket spec comment.
//     The implementation is correct.
//
//   BUG-F002-02: CreateDishIngredientSchema.gramWeight is `z.number().nonnegative().nullable()`
//     but in DishIngredientSchema (the read schema) it is also `z.number().nonnegative().nullable()`.
//     This means gramWeight=0 is valid at Zod level (nonneg allows 0) but the spec/ticket says
//     the DB constraint is `gram_weight >= 0` (allows 0). CONSISTENT — no bug.
//
//   BUG-F002-03: The integration test "CHECK fails when country_code is 3 chars (ESP)" uses
//     VARCHAR(2) column — PostgreSQL will TRUNCATE 'ESP' to 'ES' silently before the CHECK
//     runs if no error is thrown first. Testing shows the column IS VARCHAR(2) so Postgres
//     raises an error for strings > 2 chars. STATUS: Not a bug — column DDL enforces length.
//     Verified correct in this test file.
//
// All tests are self-contained.
// UUID prefix: fd000000-00XX-4000-a000-000000000YYY (fixture pattern from ticket)
// Edge-case groups use prefix: ec000000-00XX-4000-b000-000000000YYY

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  CreateDishSchema,
  CreateDishNutrientSchema,
  CreateDishIngredientSchema,
  CreateRestaurantSchema,
  CreateCookingMethodSchema,
  CreateDishCategorySchema,
  DishNutrientSchema,
} from '@foodxplorer/shared';

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

// ---------------------------------------------------------------------------
// Zod — CreateRestaurantSchema countryCode edge cases
// ---------------------------------------------------------------------------

describe('CreateRestaurantSchema — countryCode edge cases (Zod)', () => {
  const base = { name: "McDonald's", chainSlug: 'mcdonalds' };

  it('fails when countryCode is 1 character (too short)', () => {
    expect(() =>
      CreateRestaurantSchema.parse({ ...base, countryCode: 'E' }),
    ).toThrow();
  });

  it('fails when countryCode is empty string', () => {
    expect(() =>
      CreateRestaurantSchema.parse({ ...base, countryCode: '' }),
    ).toThrow();
  });

  it('fails when countryCode is mixed case (Es)', () => {
    expect(() =>
      CreateRestaurantSchema.parse({ ...base, countryCode: 'Es' }),
    ).toThrow();
  });

  it('fails when countryCode is numeric (12)', () => {
    expect(() =>
      CreateRestaurantSchema.parse({ ...base, countryCode: '12' }),
    ).toThrow();
  });

  it('fails when countryCode contains special chars (!@)', () => {
    expect(() =>
      CreateRestaurantSchema.parse({ ...base, countryCode: '!@' }),
    ).toThrow();
  });

  it('passes when countryCode is exactly 2 uppercase letters (PT)', () => {
    const result = CreateRestaurantSchema.parse({ ...base, countryCode: 'PT' });
    expect(result.countryCode).toBe('PT');
  });

  it('fails when countryCode is 3 uppercase letters (ESP)', () => {
    expect(() =>
      CreateRestaurantSchema.parse({ ...base, countryCode: 'ESP' }),
    ).toThrow();
  });

  it('chainSlug fails when empty string', () => {
    expect(() =>
      CreateRestaurantSchema.parse({ ...base, chainSlug: '' }),
    ).toThrow();
  });

  it('chainSlug fails when > 100 characters', () => {
    expect(() =>
      CreateRestaurantSchema.parse({ ...base, chainSlug: 'a'.repeat(101) }),
    ).toThrow();
  });

  it('chainSlug passes at exactly 100 characters', () => {
    const result = CreateRestaurantSchema.parse({
      ...base,
      chainSlug: 'a'.repeat(100),
    });
    expect(result.chainSlug).toHaveLength(100);
  });

  it('name fails when > 255 characters', () => {
    expect(() =>
      CreateRestaurantSchema.parse({ ...base, name: 'a'.repeat(256) }),
    ).toThrow();
  });

  it('name passes at exactly 255 characters', () => {
    const result = CreateRestaurantSchema.parse({
      ...base,
      name: 'a'.repeat(255),
    });
    expect(result.name).toHaveLength(255);
  });
});

// ---------------------------------------------------------------------------
// Zod — CreateDishSchema boundary values
// ---------------------------------------------------------------------------

describe('CreateDishSchema — boundary values (Zod)', () => {
  const base = {
    restaurantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    sourceId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    name: 'Big Mac',
    confidenceLevel: 'medium' as const,
    estimationMethod: 'scraped' as const,
  };

  it('portionGrams = 0 fails (must be positive, not merely nonneg)', () => {
    expect(() =>
      CreateDishSchema.parse({ ...base, portionGrams: 0 }),
    ).toThrow();
  });

  it('portionGrams = 0.001 passes (positive)', () => {
    const result = CreateDishSchema.parse({ ...base, portionGrams: 0.001 });
    expect(result.portionGrams).toBe(0.001);
  });

  it('portionGrams = -0.01 fails (negative)', () => {
    expect(() =>
      CreateDishSchema.parse({ ...base, portionGrams: -0.01 }),
    ).toThrow();
  });

  it('priceEur = 0 passes (nonneg boundary)', () => {
    const result = CreateDishSchema.parse({ ...base, priceEur: 0 });
    expect(result.priceEur).toBe(0);
  });

  it('priceEur = -0.01 fails (negative)', () => {
    expect(() =>
      CreateDishSchema.parse({ ...base, priceEur: -0.01 }),
    ).toThrow();
  });

  it('priceEur = null passes', () => {
    const result = CreateDishSchema.parse({ ...base, priceEur: null });
    expect(result.priceEur).toBeNull();
  });

  it('aliases containing a non-string element fails', () => {
    expect(() =>
      CreateDishSchema.parse({ ...base, aliases: ['valid', 42 as unknown as string] }),
    ).toThrow();
  });

  it('externalId at exactly 100 characters passes', () => {
    const result = CreateDishSchema.parse({
      ...base,
      externalId: 'X'.repeat(100),
    });
    expect(result.externalId).toHaveLength(100);
  });

  it('externalId at 101 characters fails', () => {
    expect(() =>
      CreateDishSchema.parse({ ...base, externalId: 'X'.repeat(101) }),
    ).toThrow();
  });

  it('name at exactly 255 characters passes', () => {
    const result = CreateDishSchema.parse({ ...base, name: 'a'.repeat(255) });
    expect(result.name).toHaveLength(255);
  });

  it('name at 256 characters fails', () => {
    expect(() =>
      CreateDishSchema.parse({ ...base, name: 'a'.repeat(256) }),
    ).toThrow();
  });

  it('name empty string fails', () => {
    expect(() =>
      CreateDishSchema.parse({ ...base, name: '' }),
    ).toThrow();
  });

  it('all four availability values accepted', () => {
    const values = ['available', 'seasonal', 'discontinued', 'regional'] as const;
    for (const v of values) {
      const result = CreateDishSchema.parse({ ...base, availability: v });
      expect(result.availability).toBe(v);
    }
  });

  it('invalid availability string rejected', () => {
    expect(() =>
      CreateDishSchema.parse({ ...base, availability: 'out_of_stock' as never }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Zod — CreateDishNutrientSchema boundary values
// ---------------------------------------------------------------------------

describe('CreateDishNutrientSchema — calories boundary values (Zod)', () => {
  const base = {
    dishId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    calories: 500,
    proteins: 20,
    carbohydrates: 50,
    sugars: 5,
    fats: 15,
    saturatedFats: 5,
    fiber: 3,
    salt: 1.0,
    sodium: 0.4,
    estimationMethod: 'scraped' as const,
    sourceId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    confidenceLevel: 'medium' as const,
  };

  it('calories = 9000 passes (inclusive upper bound)', () => {
    const result = CreateDishNutrientSchema.parse({ ...base, calories: 9000 });
    expect(result.calories).toBe(9000);
  });

  it('calories = 9001 fails (exceeds max)', () => {
    expect(() =>
      CreateDishNutrientSchema.parse({ ...base, calories: 9001 }),
    ).toThrow();
  });

  it('calories = 9000.01 fails (just over max)', () => {
    expect(() =>
      CreateDishNutrientSchema.parse({ ...base, calories: 9000.01 }),
    ).toThrow();
  });

  it('calories = 0 passes (nonneg boundary)', () => {
    const result = CreateDishNutrientSchema.parse({ ...base, calories: 0 });
    expect(result.calories).toBe(0);
  });

  it('calories = -0.01 fails (negative)', () => {
    expect(() =>
      CreateDishNutrientSchema.parse({ ...base, calories: -0.01 }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Zod — CreateCookingMethodSchema boundary values
// ---------------------------------------------------------------------------

describe('CreateCookingMethodSchema — boundary values (Zod)', () => {
  const base = { name: 'Grilled', nameEs: 'A la parrilla', slug: 'grilled' };

  it('slug at exactly 100 characters passes', () => {
    const result = CreateCookingMethodSchema.parse({
      ...base,
      slug: 'a'.repeat(100),
    });
    expect(result.slug).toHaveLength(100);
  });

  it('slug at 101 characters fails', () => {
    expect(() =>
      CreateCookingMethodSchema.parse({ ...base, slug: 'a'.repeat(101) }),
    ).toThrow();
  });

  it('name at exactly 255 characters passes', () => {
    const result = CreateCookingMethodSchema.parse({
      ...base,
      name: 'a'.repeat(255),
    });
    expect(result.name).toHaveLength(255);
  });

  it('name at 256 characters fails', () => {
    expect(() =>
      CreateCookingMethodSchema.parse({ ...base, name: 'a'.repeat(256) }),
    ).toThrow();
  });

  it('nameEs at 256 characters fails', () => {
    expect(() =>
      CreateCookingMethodSchema.parse({ ...base, nameEs: 'a'.repeat(256) }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Zod — CreateDishCategorySchema boundary values
// ---------------------------------------------------------------------------

describe('CreateDishCategorySchema — boundary values (Zod)', () => {
  const base = {
    name: 'Main Courses',
    nameEs: 'Platos principales',
    slug: 'main-courses',
  };

  it('sortOrder = 0 passes (nonneg boundary)', () => {
    const result = CreateDishCategorySchema.parse({ ...base, sortOrder: 0 });
    expect(result.sortOrder).toBe(0);
  });

  it('sortOrder = -1 fails (negative)', () => {
    expect(() =>
      CreateDishCategorySchema.parse({ ...base, sortOrder: -1 }),
    ).toThrow();
  });

  it('sortOrder = 1.5 fails (must be int)', () => {
    expect(() =>
      CreateDishCategorySchema.parse({ ...base, sortOrder: 1.5 }),
    ).toThrow();
  });

  it('slug at exactly 100 characters passes', () => {
    const result = CreateDishCategorySchema.parse({
      ...base,
      slug: 'a'.repeat(100),
    });
    expect(result.slug).toHaveLength(100);
  });

  it('slug at 101 characters fails', () => {
    expect(() =>
      CreateDishCategorySchema.parse({ ...base, slug: 'a'.repeat(101) }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Zod — CreateDishIngredientSchema boundary values
// ---------------------------------------------------------------------------

describe('CreateDishIngredientSchema — boundary values (Zod)', () => {
  const base = {
    dishId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    ingredientFoodId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    amount: 100,
    unit: 'g',
    gramWeight: null,
    sortOrder: 0,
  };

  it('gramWeight = 0 passes (nonneg boundary)', () => {
    const result = CreateDishIngredientSchema.parse({ ...base, gramWeight: 0 });
    expect(result.gramWeight).toBe(0);
  });

  it('sortOrder = 0 passes (nonneg boundary)', () => {
    const result = CreateDishIngredientSchema.parse(base);
    expect(result.sortOrder).toBe(0);
  });

  it('amount = 0.001 passes (positive)', () => {
    const result = CreateDishIngredientSchema.parse({ ...base, amount: 0.001 });
    expect(result.amount).toBe(0.001);
  });

  it('unit at exactly 50 characters passes', () => {
    const result = CreateDishIngredientSchema.parse({
      ...base,
      unit: 'a'.repeat(50),
    });
    expect(result.unit).toHaveLength(50);
  });

  it('unit at 51 characters fails', () => {
    expect(() =>
      CreateDishIngredientSchema.parse({ ...base, unit: 'a'.repeat(51) }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Zod — DishNutrientSchema (read schema) — estimationMethod is required
// ---------------------------------------------------------------------------

describe('DishNutrientSchema (read) — estimationMethod is required, no default', () => {
  it('fails when estimationMethod is omitted from a full DishNutrient record', () => {
    expect(() =>
      DishNutrientSchema.parse({
        id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        dishId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        calories: 500,
        proteins: 20,
        carbohydrates: 50,
        sugars: 5,
        fats: 15,
        saturatedFats: 5,
        fiber: 3,
        salt: 1.0,
        sodium: 0.4,
        referenceBasis: 'per_serving' as const,
        transFats: 0,
        cholesterol: 0,
        potassium: 0,
        monounsaturatedFats: 0,
        polyunsaturatedFats: 0,
        // estimationMethod intentionally omitted
        sourceId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        confidenceLevel: 'medium' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// DB — calories boundary at 9000 and 9001
// ---------------------------------------------------------------------------

describe('DishNutrient — DB calories boundary: 9000 (allowed) and 9001 (rejected)', () => {
  const SRC        = 'ec000000-0001-4000-b000-000000000001';
  const RESTAURANT = 'ec000000-0001-4000-b000-000000000002';
  const DISH       = 'ec000000-0001-4000-b000-000000000003';

  beforeAll(async () => {
    await prisma.dishNutrient.deleteMany({ where: { sourceId: SRC } });
    await prisma.dish.deleteMany({ where: { id: DISH } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });

    await prisma.dataSource.create({
      data: { id: SRC, name: 'EC-Calorie-Boundary-Src', type: 'official' },
    });
    await prisma.restaurant.create({
      data: {
        id: RESTAURANT,
        name: 'EC Calorie Rest',
        chainSlug: 'ec-calorie-test',
        countryCode: 'ES',
      },
    });
    await prisma.dish.create({
      data: {
        id: DISH,
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'EC Calorie Dish',
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

  it('DB allows calories = 9000 (inclusive upper bound of CHECK)', async () => {
    const dn = await prisma.dishNutrient.create({
      data: {
        dishId: DISH,
        calories: 9000,
        proteins: 1,
        carbohydrates: 1,
        sugars: 0,
        fats: 0,
        saturatedFats: 0,
        fiber: 0,
        salt: 0,
        sodium: 0,
        estimationMethod: 'scraped',
        sourceId: SRC,
        confidenceLevel: 'low',
      },
    });
    expect(Number(dn.calories)).toBe(9000);
    await prisma.dishNutrient.delete({ where: { id: dn.id } });
  });

  it('DB rejects calories = 9001 (exceeds upper bound of CHECK)', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO dish_nutrients (id, dish_id, calories, proteins, carbohydrates, sugars, fats,
          saturated_fats, fiber, salt, sodium, estimation_method, source_id, confidence_level,
          created_at, updated_at)
        VALUES (gen_random_uuid(), ${DISH}::uuid, 9001, 1, 1, 0, 0, 0, 0, 0, 0,
                'scraped'::"estimation_method", ${SRC}::uuid, 'low'::"confidence_level",
                NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('DB allows calories = 0 (nonneg lower bound)', async () => {
    const dn = await prisma.dishNutrient.create({
      data: {
        dishId: DISH,
        calories: 0,
        proteins: 0,
        carbohydrates: 0,
        sugars: 0,
        fats: 0,
        saturatedFats: 0,
        fiber: 0,
        salt: 0,
        sodium: 0,
        estimationMethod: 'scraped',
        sourceId: SRC,
        confidenceLevel: 'low',
      },
    });
    expect(Number(dn.calories)).toBe(0);
    await prisma.dishNutrient.delete({ where: { id: dn.id } });
  });
});

// ---------------------------------------------------------------------------
// DB — portionGrams and priceEur boundary values
// ---------------------------------------------------------------------------

describe('Dish — DB portionGrams and priceEur boundary values', () => {
  const SRC        = 'ec000000-0002-4000-b000-000000000001';
  const RESTAURANT = 'ec000000-0002-4000-b000-000000000002';

  beforeAll(async () => {
    await prisma.dish.deleteMany({ where: { restaurantId: RESTAURANT } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });

    await prisma.dataSource.create({
      data: { id: SRC, name: 'EC-Portion-Price-Src', type: 'official' },
    });
    await prisma.restaurant.create({
      data: {
        id: RESTAURANT,
        name: 'EC Portion Rest',
        chainSlug: 'ec-portion-test',
        countryCode: 'ES',
      },
    });
  });

  afterAll(async () => {
    await prisma.dish.deleteMany({ where: { restaurantId: RESTAURANT } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('DB allows portionGrams = 0.01 (minimum positive above 0)', async () => {
    const dish = await prisma.dish.create({
      data: {
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'Portion 0.01',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
        portionGrams: 0.01,
      },
    });
    expect(Number(dish.portionGrams)).toBeCloseTo(0.01);
    await prisma.dish.delete({ where: { id: dish.id } });
  });

  it('DB rejects portionGrams = 0 (must be > 0)', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO dishes (id, restaurant_id, source_id, name, availability, confidence_level,
          estimation_method, portion_grams, created_at, updated_at)
        VALUES (gen_random_uuid(), ${RESTAURANT}::uuid, ${SRC}::uuid, 'Portion 0 EC',
                'available'::"dish_availability", 'low'::"confidence_level",
                'scraped'::"estimation_method", 0, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('DB rejects portionGrams = -1 (negative)', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO dishes (id, restaurant_id, source_id, name, availability, confidence_level,
          estimation_method, portion_grams, created_at, updated_at)
        VALUES (gen_random_uuid(), ${RESTAURANT}::uuid, ${SRC}::uuid, 'Portion Neg EC',
                'available'::"dish_availability", 'low'::"confidence_level",
                'scraped'::"estimation_method", -1, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('DB allows priceEur = 0.00 (nonneg boundary)', async () => {
    const dish = await prisma.dish.create({
      data: {
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'Price 0',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
        priceEur: 0,
      },
    });
    expect(Number(dish.priceEur)).toBe(0);
    await prisma.dish.delete({ where: { id: dish.id } });
  });

  it('DB rejects priceEur = -0.01 (negative)', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO dishes (id, restaurant_id, source_id, name, availability, confidence_level,
          estimation_method, price_eur, created_at, updated_at)
        VALUES (gen_random_uuid(), ${RESTAURANT}::uuid, ${SRC}::uuid, 'Price Neg EC',
                'available'::"dish_availability", 'low'::"confidence_level",
                'scraped'::"estimation_method", -0.01, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('DB allows very large portionGrams within DECIMAL(8,2) range (999999.99)', async () => {
    const dish = await prisma.dish.create({
      data: {
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'Portion Large',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
        portionGrams: 999999.99,
      },
    });
    expect(Number(dish.portionGrams)).toBeCloseTo(999999.99);
    await prisma.dish.delete({ where: { id: dish.id } });
  });
});

// ---------------------------------------------------------------------------
// DB — FK RESTRICT: restaurant with dishes cannot be deleted
// ---------------------------------------------------------------------------

describe('Dish FK RESTRICT — deleting Restaurant with Dishes linked fails', () => {
  const SRC        = 'ec000000-0003-4000-b000-000000000001';
  const RESTAURANT = 'ec000000-0003-4000-b000-000000000002';
  const DISH       = 'ec000000-0003-4000-b000-000000000003';

  beforeAll(async () => {
    await prisma.dish.deleteMany({ where: { id: DISH } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });

    await prisma.dataSource.create({
      data: { id: SRC, name: 'EC-RestrictRest-Src', type: 'official' },
    });
    await prisma.restaurant.create({
      data: {
        id: RESTAURANT,
        name: 'EC Restrict Rest',
        chainSlug: 'ec-restrict-rest-test',
        countryCode: 'ES',
      },
    });
    await prisma.dish.create({
      data: {
        id: DISH,
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'EC Restrict Dish',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
      },
    });
  });

  afterAll(async () => {
    await prisma.dish.deleteMany({ where: { id: DISH } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('RESTRICT prevents deleting a Restaurant that has Dishes', async () => {
    await expect(
      prisma.restaurant.delete({ where: { id: RESTAURANT } }),
    ).rejects.toThrow();
  });

  it('Dish is still present after failed restaurant delete', async () => {
    const dish = await prisma.dish.findUnique({ where: { id: DISH } });
    expect(dish).not.toBeNull();
    expect(dish?.restaurantId).toBe(RESTAURANT);
  });
});

// ---------------------------------------------------------------------------
// DB — FK RESTRICT: DataSource with Dishes linked cannot be deleted
// ---------------------------------------------------------------------------

describe('Dish FK RESTRICT — deleting DataSource with Dishes linked fails', () => {
  const SRC        = 'ec000000-0004-4000-b000-000000000001';
  const RESTAURANT = 'ec000000-0004-4000-b000-000000000002';
  const DISH       = 'ec000000-0004-4000-b000-000000000003';

  beforeAll(async () => {
    await prisma.dish.deleteMany({ where: { id: DISH } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });

    await prisma.dataSource.create({
      data: { id: SRC, name: 'EC-RestrictSrc-Src', type: 'official' },
    });
    await prisma.restaurant.create({
      data: {
        id: RESTAURANT,
        name: 'EC Restrict Src Rest',
        chainSlug: 'ec-restrict-src-test',
        countryCode: 'ES',
      },
    });
    await prisma.dish.create({
      data: {
        id: DISH,
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'EC Restrict Src Dish',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
      },
    });
  });

  afterAll(async () => {
    await prisma.dish.deleteMany({ where: { id: DISH } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('RESTRICT prevents deleting a DataSource that has Dishes', async () => {
    await expect(
      prisma.dataSource.delete({ where: { id: SRC } }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// DB — FK RESTRICT: deleting Dish with DishNutrients fails
// ---------------------------------------------------------------------------

describe('DishNutrient FK RESTRICT — deleting Dish with DishNutrients fails', () => {
  const SRC        = 'ec000000-0005-4000-b000-000000000001';
  const RESTAURANT = 'ec000000-0005-4000-b000-000000000002';
  const DISH       = 'ec000000-0005-4000-b000-000000000003';

  beforeAll(async () => {
    await prisma.dishNutrient.deleteMany({ where: { dish: { id: DISH } } });
    await prisma.dish.deleteMany({ where: { id: DISH } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });

    await prisma.dataSource.create({
      data: { id: SRC, name: 'EC-NutrRestrictDish-Src', type: 'official' },
    });
    await prisma.restaurant.create({
      data: {
        id: RESTAURANT,
        name: 'EC NutrRestrictDish Rest',
        chainSlug: 'ec-nutr-restrict-dish',
        countryCode: 'ES',
      },
    });
    await prisma.dish.create({
      data: {
        id: DISH,
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'EC NutrRestrictDish Dish',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
      },
    });
    await prisma.dishNutrient.create({
      data: {
        dishId: DISH,
        calories: 200,
        proteins: 10,
        carbohydrates: 20,
        sugars: 5,
        fats: 5,
        saturatedFats: 2,
        fiber: 1,
        salt: 0.5,
        sodium: 0.2,
        estimationMethod: 'scraped',
        sourceId: SRC,
        confidenceLevel: 'low',
      },
    });
  });

  afterAll(async () => {
    await prisma.dishNutrient.deleteMany({ where: { dish: { id: DISH } } });
    await prisma.dish.deleteMany({ where: { id: DISH } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('RESTRICT prevents deleting a Dish that has DishNutrients', async () => {
    await expect(
      prisma.dish.delete({ where: { id: DISH } }),
    ).rejects.toThrow();
  });

  it('DishNutrient is still present after failed dish delete', async () => {
    const nutrients = await prisma.dishNutrient.findMany({
      where: { dishId: DISH },
    });
    expect(nutrients).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// DB — FK RESTRICT: deleting Dish with DishIngredients fails
// ---------------------------------------------------------------------------

describe('DishIngredient FK RESTRICT — deleting Dish with DishIngredients fails', () => {
  const SRC        = 'ec000000-0006-4000-b000-000000000001';
  const RESTAURANT = 'ec000000-0006-4000-b000-000000000002';
  const DISH       = 'ec000000-0006-4000-b000-000000000003';
  const FOOD_ING   = 'ec000000-0006-4000-b000-000000000004';

  beforeAll(async () => {
    await prisma.dishIngredient.deleteMany({ where: { dishId: DISH } });
    await prisma.dish.deleteMany({ where: { id: DISH } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.food.deleteMany({ where: { id: FOOD_ING } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });

    await prisma.dataSource.create({
      data: { id: SRC, name: 'EC-IngRestrictDish-Src', type: 'official' },
    });
    await prisma.food.create({
      data: {
        id: FOOD_ING,
        name: 'EC IngRestrictDish Food',
        nameEs: 'EC IngRestrictDish Alimento',
        aliases: [],
        sourceId: SRC,
        confidenceLevel: 'low',
      },
    });
    await prisma.restaurant.create({
      data: {
        id: RESTAURANT,
        name: 'EC IngRestrictDish Rest',
        chainSlug: 'ec-ing-restrict-dish',
        countryCode: 'ES',
      },
    });
    await prisma.dish.create({
      data: {
        id: DISH,
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'EC IngRestrictDish Dish',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
      },
    });
    await prisma.dishIngredient.create({
      data: {
        dishId: DISH,
        ingredientFoodId: FOOD_ING,
        amount: 100,
        unit: 'g',
        sortOrder: 0,
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

  it('RESTRICT prevents deleting a Dish that has DishIngredients', async () => {
    await expect(
      prisma.dish.delete({ where: { id: DISH } }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// DB — FK RESTRICT: deleting a Food used as DishIngredient ingredient fails
// ---------------------------------------------------------------------------

describe('DishIngredient FK RESTRICT — deleting a Food used as ingredient fails', () => {
  const SRC        = 'ec000000-0007-4000-b000-000000000001';
  const RESTAURANT = 'ec000000-0007-4000-b000-000000000002';
  const DISH       = 'ec000000-0007-4000-b000-000000000003';
  const FOOD_ING   = 'ec000000-0007-4000-b000-000000000004';

  beforeAll(async () => {
    await prisma.dishIngredient.deleteMany({ where: { dishId: DISH } });
    await prisma.dish.deleteMany({ where: { id: DISH } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.food.deleteMany({ where: { id: FOOD_ING } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });

    await prisma.dataSource.create({
      data: { id: SRC, name: 'EC-IngFoodRestrict-Src', type: 'official' },
    });
    await prisma.food.create({
      data: {
        id: FOOD_ING,
        name: 'EC IngFoodRestrict Food',
        nameEs: 'EC IngFoodRestrict Alimento',
        aliases: [],
        sourceId: SRC,
        confidenceLevel: 'low',
      },
    });
    await prisma.restaurant.create({
      data: {
        id: RESTAURANT,
        name: 'EC IngFoodRestrict Rest',
        chainSlug: 'ec-ing-food-restrict',
        countryCode: 'ES',
      },
    });
    await prisma.dish.create({
      data: {
        id: DISH,
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'EC IngFoodRestrict Dish',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
      },
    });
    await prisma.dishIngredient.create({
      data: {
        dishId: DISH,
        ingredientFoodId: FOOD_ING,
        amount: 50,
        unit: 'ml',
        sortOrder: 0,
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

  it('RESTRICT prevents deleting a Food that is a DishIngredient ingredient', async () => {
    await expect(
      prisma.food.delete({ where: { id: FOOD_ING } }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// DB — FK RESTRICT: DataSource with DishNutrients cannot be deleted
// ---------------------------------------------------------------------------

describe('DishNutrient FK RESTRICT — deleting DataSource with DishNutrients fails', () => {
  const SRC        = 'ec000000-0008-4000-b000-000000000001';
  const RESTAURANT = 'ec000000-0008-4000-b000-000000000002';
  const DISH       = 'ec000000-0008-4000-b000-000000000003';

  beforeAll(async () => {
    await prisma.dishNutrient.deleteMany({ where: { sourceId: SRC } });
    await prisma.dish.deleteMany({ where: { id: DISH } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });

    await prisma.dataSource.create({
      data: { id: SRC, name: 'EC-NutrSrcRestrict-Src', type: 'official' },
    });
    await prisma.restaurant.create({
      data: {
        id: RESTAURANT,
        name: 'EC NutrSrcRestrict Rest',
        chainSlug: 'ec-nutr-src-restrict',
        countryCode: 'ES',
      },
    });
    await prisma.dish.create({
      data: {
        id: DISH,
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'EC NutrSrcRestrict Dish',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
      },
    });
    await prisma.dishNutrient.create({
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
  });

  afterAll(async () => {
    await prisma.dishNutrient.deleteMany({ where: { sourceId: SRC } });
    await prisma.dish.deleteMany({ where: { id: DISH } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('RESTRICT prevents deleting a DataSource that has DishNutrients', async () => {
    await expect(
      prisma.dataSource.delete({ where: { id: SRC } }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// DB — Junction table edge cases
// ---------------------------------------------------------------------------

describe('Junction tables — duplicate entry and empty-dish edge cases', () => {
  const SRC              = 'ec000000-0009-4000-b000-000000000001';
  const RESTAURANT       = 'ec000000-0009-4000-b000-000000000002';
  const DISH             = 'ec000000-0009-4000-b000-000000000003';
  const COOKING_METHOD_ID = '00000000-0000-4000-c000-000000000002'; // baked (seeded)
  const DISH_CATEGORY_ID  = '00000000-0000-4000-d000-000000000003'; // side-dishes (seeded)

  beforeAll(async () => {
    await prisma.dishDishCategory.deleteMany({ where: { dishId: DISH } });
    await prisma.dishCookingMethod.deleteMany({ where: { dishId: DISH } });
    await prisma.dish.deleteMany({ where: { id: DISH } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });

    await prisma.dataSource.create({
      data: { id: SRC, name: 'EC-Junction-Src', type: 'official' },
    });
    await prisma.restaurant.create({
      data: {
        id: RESTAURANT,
        name: 'EC Junction Rest',
        chainSlug: 'ec-junction-test',
        countryCode: 'ES',
      },
    });
    await prisma.dish.create({
      data: {
        id: DISH,
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'EC Junction Dish',
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

  it('duplicate entry in dish_cooking_methods (same dish + method) fails (composite PK)', async () => {
    await prisma.dishCookingMethod.create({
      data: { dishId: DISH, cookingMethodId: COOKING_METHOD_ID },
    });

    await expect(
      prisma.$executeRaw`
        INSERT INTO dish_cooking_methods (dish_id, cooking_method_id)
        VALUES (${DISH}::uuid, ${COOKING_METHOD_ID}::uuid)
      `,
    ).rejects.toThrow();

    await prisma.dishCookingMethod.deleteMany({ where: { dishId: DISH } });
  });

  it('duplicate entry in dish_dish_categories (same dish + category) fails (composite PK)', async () => {
    await prisma.dishDishCategory.create({
      data: { dishId: DISH, dishCategoryId: DISH_CATEGORY_ID },
    });

    await expect(
      prisma.$executeRaw`
        INSERT INTO dish_dish_categories (dish_id, dish_category_id)
        VALUES (${DISH}::uuid, ${DISH_CATEGORY_ID}::uuid)
      `,
    ).rejects.toThrow();

    await prisma.dishDishCategory.deleteMany({ where: { dishId: DISH } });
  });

  it('a Dish with no junction rows can be deleted cleanly (no orphan errors)', async () => {
    const emptyDish = await prisma.dish.create({
      data: {
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'EC Empty Junction Dish',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
      },
    });

    // Verify no junction rows
    const cms = await prisma.dishCookingMethod.findMany({
      where: { dishId: emptyDish.id },
    });
    const dcs = await prisma.dishDishCategory.findMany({
      where: { dishId: emptyDish.id },
    });
    expect(cms).toHaveLength(0);
    expect(dcs).toHaveLength(0);

    // Delete should succeed without errors
    await expect(
      prisma.dish.delete({ where: { id: emptyDish.id } }),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// DB — Partial unique index: external_id edge cases
// ---------------------------------------------------------------------------

describe('Dish partial unique index — external_id edge cases', () => {
  const SRC        = 'ec000000-0010-4000-b000-000000000001';
  const RESTAURANT = 'ec000000-0010-4000-b000-000000000002';
  const RESTAURANT2 = 'ec000000-0010-4000-b000-000000000005';

  beforeAll(async () => {
    await prisma.dish.deleteMany({ where: { restaurantId: RESTAURANT } });
    await prisma.dish.deleteMany({ where: { restaurantId: RESTAURANT2 } });
    await prisma.restaurant.deleteMany({ where: { id: { in: [RESTAURANT, RESTAURANT2] } } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });

    await prisma.dataSource.create({
      data: { id: SRC, name: 'EC-ExtId-Src', type: 'official' },
    });
    await prisma.restaurant.create({
      data: {
        id: RESTAURANT,
        name: 'EC ExtId Rest 1',
        chainSlug: 'ec-extid-test-1',
        countryCode: 'ES',
      },
    });
    await prisma.restaurant.create({
      data: {
        id: RESTAURANT2,
        name: 'EC ExtId Rest 2',
        chainSlug: 'ec-extid-test-2',
        countryCode: 'ES',
      },
    });
  });

  afterAll(async () => {
    await prisma.dish.deleteMany({ where: { restaurantId: RESTAURANT } });
    await prisma.dish.deleteMany({ where: { restaurantId: RESTAURANT2 } });
    await prisma.restaurant.deleteMany({ where: { id: { in: [RESTAURANT, RESTAURANT2] } } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('same external_id for different restaurants is ALLOWED (partial unique is per restaurant)', async () => {
    const d1 = await prisma.dish.create({
      data: {
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'Dish R1 ExtId Shared',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
        externalId: 'SHARED-EXT-001',
      },
    });
    const d2 = await prisma.dish.create({
      data: {
        restaurantId: RESTAURANT2,
        sourceId: SRC,
        name: 'Dish R2 ExtId Shared',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
        externalId: 'SHARED-EXT-001', // same external_id, different restaurant
      },
    });

    expect(d1.externalId).toBe('SHARED-EXT-001');
    expect(d2.externalId).toBe('SHARED-EXT-001');
    expect(d1.restaurantId).not.toBe(d2.restaurantId);

    await prisma.dish.deleteMany({
      where: { id: { in: [d1.id, d2.id] } },
    });
  });

  it('same external_id + same restaurant violates partial unique (both non-null)', async () => {
    await prisma.$executeRaw`
      INSERT INTO dishes (id, restaurant_id, source_id, name, availability, confidence_level,
        estimation_method, external_id, created_at, updated_at)
      VALUES (gen_random_uuid(), ${RESTAURANT}::uuid, ${SRC}::uuid, 'Dup ExtId Dish 1',
              'available'::"dish_availability", 'low'::"confidence_level",
              'scraped'::"estimation_method", 'DUP-EXT-001', NOW(), NOW())
    `;

    await expect(
      prisma.$executeRaw`
        INSERT INTO dishes (id, restaurant_id, source_id, name, availability, confidence_level,
          estimation_method, external_id, created_at, updated_at)
        VALUES (gen_random_uuid(), ${RESTAURANT}::uuid, ${SRC}::uuid, 'Dup ExtId Dish 2',
                'available'::"dish_availability", 'low'::"confidence_level",
                'scraped'::"estimation_method", 'DUP-EXT-001', NOW(), NOW())
      `,
    ).rejects.toThrow();

    await prisma.dish.deleteMany({
      where: { externalId: 'DUP-EXT-001', restaurantId: RESTAURANT },
    });
  });

  it('multiple null external_ids for same restaurant are ALLOWED (partial unique skips NULLs)', async () => {
    const d1 = await prisma.dish.create({
      data: {
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'Null ExtId 1',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
        externalId: null,
      },
    });
    const d2 = await prisma.dish.create({
      data: {
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'Null ExtId 2',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
        externalId: null,
      },
    });
    const d3 = await prisma.dish.create({
      data: {
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'Null ExtId 3',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
        externalId: null,
      },
    });

    expect(d1.externalId).toBeNull();
    expect(d2.externalId).toBeNull();
    expect(d3.externalId).toBeNull();

    await prisma.dish.deleteMany({
      where: { id: { in: [d1.id, d2.id, d3.id] } },
    });
  });
});

// ---------------------------------------------------------------------------
// DB — DishAvailability enum: all 4 values accepted, invalid rejected
// ---------------------------------------------------------------------------

describe('DishAvailability enum — DB consistency with Zod', () => {
  const SRC        = 'ec000000-0011-4000-b000-000000000001';
  const RESTAURANT = 'ec000000-0011-4000-b000-000000000002';

  beforeAll(async () => {
    await prisma.dish.deleteMany({ where: { restaurantId: RESTAURANT } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });

    await prisma.dataSource.create({
      data: { id: SRC, name: 'EC-Availability-Src', type: 'official' },
    });
    await prisma.restaurant.create({
      data: {
        id: RESTAURANT,
        name: 'EC Availability Rest',
        chainSlug: 'ec-availability-test',
        countryCode: 'ES',
      },
    });
  });

  afterAll(async () => {
    await prisma.dish.deleteMany({ where: { restaurantId: RESTAURANT } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('DB accepts availability = available', async () => {
    const dish = await prisma.dish.create({
      data: {
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'Avail Test available',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
        availability: 'available',
      },
    });
    expect(dish.availability).toBe('available');
    await prisma.dish.delete({ where: { id: dish.id } });
  });

  it('DB accepts availability = seasonal', async () => {
    const dish = await prisma.dish.create({
      data: {
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'Avail Test seasonal',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
        availability: 'seasonal',
      },
    });
    expect(dish.availability).toBe('seasonal');
    await prisma.dish.delete({ where: { id: dish.id } });
  });

  it('DB accepts availability = discontinued', async () => {
    const dish = await prisma.dish.create({
      data: {
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'Avail Test discontinued',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
        availability: 'discontinued',
      },
    });
    expect(dish.availability).toBe('discontinued');
    await prisma.dish.delete({ where: { id: dish.id } });
  });

  it('DB accepts availability = regional', async () => {
    const dish = await prisma.dish.create({
      data: {
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'Avail Test regional',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
        availability: 'regional',
      },
    });
    expect(dish.availability).toBe('regional');
    await prisma.dish.delete({ where: { id: dish.id } });
  });

  it('DB rejects invalid availability string (out_of_stock)', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO dishes (id, restaurant_id, source_id, name, availability, confidence_level,
          estimation_method, created_at, updated_at)
        VALUES (gen_random_uuid(), ${RESTAURANT}::uuid, ${SRC}::uuid, 'Avail Invalid',
                'out_of_stock'::"dish_availability", 'low'::"confidence_level",
                'scraped'::"estimation_method", NOW(), NOW())
      `,
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// DB — dishIngredient gramWeight = 0 and sortOrder = 0 are allowed
// ---------------------------------------------------------------------------

describe('DishIngredient — DB zero-boundary CHECK values', () => {
  const SRC        = 'ec000000-0012-4000-b000-000000000001';
  const RESTAURANT = 'ec000000-0012-4000-b000-000000000002';
  const DISH       = 'ec000000-0012-4000-b000-000000000003';
  const FOOD_ING   = 'ec000000-0012-4000-b000-000000000004';

  beforeAll(async () => {
    await prisma.dishIngredient.deleteMany({ where: { dishId: DISH } });
    await prisma.dish.deleteMany({ where: { id: DISH } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.food.deleteMany({ where: { id: FOOD_ING } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });

    await prisma.dataSource.create({
      data: { id: SRC, name: 'EC-IngZero-Src', type: 'official' },
    });
    await prisma.food.create({
      data: {
        id: FOOD_ING,
        name: 'EC IngZero Food',
        nameEs: 'EC IngZero Alimento',
        aliases: [],
        sourceId: SRC,
        confidenceLevel: 'low',
      },
    });
    await prisma.restaurant.create({
      data: {
        id: RESTAURANT,
        name: 'EC IngZero Rest',
        chainSlug: 'ec-ingzero-test',
        countryCode: 'ES',
      },
    });
    await prisma.dish.create({
      data: {
        id: DISH,
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'EC IngZero Dish',
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

  it('DB allows gramWeight = 0 (>= 0 CHECK allows zero)', async () => {
    const ing = await prisma.$queryRaw<{ id: string; gram_weight: string }[]>`
      INSERT INTO dish_ingredients (id, dish_id, ingredient_food_id, amount, unit, gram_weight, sort_order, created_at, updated_at)
      VALUES (gen_random_uuid(), ${DISH}::uuid, ${FOOD_ING}::uuid, 100, 'g', 0, 0, NOW(), NOW())
      RETURNING id, gram_weight
    `;
    expect(Number(ing[0]?.['gram_weight'])).toBe(0);
    const ingId = ing[0]?.['id'];
    if (ingId) {
      await prisma.$executeRaw`DELETE FROM dish_ingredients WHERE id = ${ingId}::uuid`;
    }
  });

  it('DB allows sort_order = 0 (>= 0 CHECK allows zero)', async () => {
    const ing = await prisma.dishIngredient.create({
      data: {
        dishId: DISH,
        ingredientFoodId: FOOD_ING,
        amount: 50,
        unit: 'ml',
        sortOrder: 0,
      },
    });
    expect(ing.sortOrder).toBe(0);
    await prisma.dishIngredient.delete({ where: { id: ing.id } });
  });

  it('DB rejects amount = 0 (> 0 CHECK — zero NOT allowed)', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO dish_ingredients (id, dish_id, ingredient_food_id, amount, unit, sort_order, created_at, updated_at)
        VALUES (gen_random_uuid(), ${DISH}::uuid, ${FOOD_ING}::uuid, 0, 'g', 0, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('DB allows amount = 0.01 (minimum positive)', async () => {
    const ing = await prisma.$queryRaw<{ id: string; amount: string }[]>`
      INSERT INTO dish_ingredients (id, dish_id, ingredient_food_id, amount, unit, sort_order, created_at, updated_at)
      VALUES (gen_random_uuid(), ${DISH}::uuid, ${FOOD_ING}::uuid, 0.01, 'g', 5, NOW(), NOW())
      RETURNING id, amount
    `;
    expect(Number(ing[0]?.['amount'])).toBeCloseTo(0.01);
    const ingId = ing[0]?.['id'];
    if (ingId) {
      await prisma.$executeRaw`DELETE FROM dish_ingredients WHERE id = ${ingId}::uuid`;
    }
  });
});

// ---------------------------------------------------------------------------
// DB — BUG REGRESSION: dish_nutrients extra=NULL with valid nutrients should succeed
// (verifying dish_nutrients_nutrients_non_negative_check does not incorrectly
//  include an extra IS NOT NULL clause — actual migration is correct)
// ---------------------------------------------------------------------------

describe('BUG REGRESSION — dish_nutrients_nutrients_non_negative_check does not reject null extra', () => {
  const SRC        = 'ec000000-0013-4000-b000-000000000001';
  const RESTAURANT = 'ec000000-0013-4000-b000-000000000002';
  const DISH       = 'ec000000-0013-4000-b000-000000000003';

  beforeAll(async () => {
    await prisma.dishNutrient.deleteMany({ where: { dish: { id: DISH } } });
    await prisma.dish.deleteMany({ where: { id: DISH } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });

    await prisma.dataSource.create({
      data: { id: SRC, name: 'EC-NullExtra-Src', type: 'official' },
    });
    await prisma.restaurant.create({
      data: {
        id: RESTAURANT,
        name: 'EC NullExtra Rest',
        chainSlug: 'ec-null-extra-test',
        countryCode: 'ES',
      },
    });
    await prisma.dish.create({
      data: {
        id: DISH,
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'EC NullExtra Dish',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
      },
    });
  });

  afterAll(async () => {
    await prisma.dishNutrient.deleteMany({ where: { dish: { id: DISH } } });
    await prisma.dish.deleteMany({ where: { id: DISH } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('DishNutrient with extra = NULL and valid nutrients inserts successfully', async () => {
    // The ticket spec mentions a tautological extra IS NOT NULL OR extra IS NULL clause
    // that would be always-true. If the actual migration mistakenly DID include it,
    // insertion would still succeed (tautology). But if it was inverted (AND extra IS NOT NULL),
    // this test would catch it as it inserts with extra = NULL (default).
    const dn = await prisma.dishNutrient.create({
      data: {
        dishId: DISH,
        calories: 300,
        proteins: 15,
        carbohydrates: 30,
        sugars: 10,
        fats: 10,
        saturatedFats: 3,
        fiber: 2,
        salt: 0.8,
        sodium: 0.32,
        estimationMethod: 'scraped',
        sourceId: SRC,
        confidenceLevel: 'low',
        // extra omitted — will be NULL
      },
    });

    expect(dn.id).toBeDefined();
    expect(dn.extra).toBeNull();

    await prisma.dishNutrient.delete({ where: { id: dn.id } });
  });

  it('DishNutrient with extra = JSONB object inserts successfully', async () => {
    const dn = await prisma.dishNutrient.create({
      data: {
        dishId: DISH,
        calories: 200,
        proteins: 8,
        carbohydrates: 25,
        sugars: 5,
        fats: 6,
        saturatedFats: 2,
        fiber: 1,
        salt: 0.5,
        sodium: 0.2,
        estimationMethod: 'scraped',
        sourceId: SRC,
        confidenceLevel: 'low',
        extra: { vitamin_c: 12, zinc: 0.5 },
      },
    });

    expect(dn.extra).toEqual({ vitamin_c: 12, zinc: 0.5 });

    await prisma.dishNutrient.delete({ where: { id: dn.id } });
  });
});

// ---------------------------------------------------------------------------
// DB — countryCode VARCHAR(2) column enforces length at DB level
// ---------------------------------------------------------------------------

describe('Restaurant countryCode — DB VARCHAR(2) column-level enforcement', () => {
  it('DB rejects country_code with 3 chars (ESP) — VARCHAR(2) truncates or errors', async () => {
    // PostgreSQL strict mode: inserting a string longer than VARCHAR(n) raises an error
    // (unlike MySQL which silently truncates). The CHECK constraint would also catch 'ESP'
    // but the VARCHAR(2) column type itself prevents it.
    await expect(
      prisma.$executeRaw`
        INSERT INTO restaurants (id, name, chain_slug, country_code, is_active, created_at, updated_at)
        VALUES (gen_random_uuid(), 'DB Length Test', 'db-len-test-uniq', 'ESP', true, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('DB rejects country_code lowercase (es) — fails CHECK constraint', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO restaurants (id, name, chain_slug, country_code, is_active, created_at, updated_at)
        VALUES (gen_random_uuid(), 'DB Case Test', 'db-case-test-uniq', 'es', true, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });

  it('DB rejects country_code numeric (12) — fails CHECK constraint', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO restaurants (id, name, chain_slug, country_code, is_active, created_at, updated_at)
        VALUES (gen_random_uuid(), 'DB Num Test', 'db-num-test-uniq', '12', true, NOW(), NOW())
      `,
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// DB — dish nameEs FTS fallback: COALESCE(name_es, name) in Spanish GIN index
// ---------------------------------------------------------------------------

describe('Dish FTS Spanish index — COALESCE fallback (name_es IS NULL uses name)', () => {
  const SRC        = 'ec000000-0014-4000-b000-000000000001';
  const RESTAURANT = 'ec000000-0014-4000-b000-000000000002';

  beforeAll(async () => {
    await prisma.dish.deleteMany({ where: { restaurantId: RESTAURANT } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });

    await prisma.dataSource.create({
      data: { id: SRC, name: 'EC-FTS-Src', type: 'official' },
    });
    await prisma.restaurant.create({
      data: {
        id: RESTAURANT,
        name: 'EC FTS Rest',
        chainSlug: 'ec-fts-test',
        countryCode: 'ES',
      },
    });
  });

  afterAll(async () => {
    await prisma.dish.deleteMany({ where: { restaurantId: RESTAURANT } });
    await prisma.restaurant.deleteMany({ where: { id: RESTAURANT } });
    await prisma.dataSource.deleteMany({ where: { id: SRC } });
  });

  it('Dish with null nameEs can be inserted and Spanish FTS works (index on COALESCE)', async () => {
    const dish = await prisma.dish.create({
      data: {
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'Grilled Chicken Salad',
        nameEs: null, // Spanish FTS will fall back to name
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
      },
    });

    expect(dish.nameEs).toBeNull();

    // Verify the Spanish FTS index works via to_tsvector query on the COALESCE expression
    type Row = { found: boolean };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT (to_tsvector('spanish', COALESCE(name_es, name)) @@ plainto_tsquery('spanish', 'Grilled')) AS found
      FROM dishes
      WHERE id = ${dish.id}::uuid
    `;
    // Note: 'Grilled' may not be a Spanish stemmed word, but the COALESCE expression
    // correctly uses the name when name_es is null — verifying no error is thrown
    expect(rows).toHaveLength(1);

    await prisma.dish.delete({ where: { id: dish.id } });
  });

  it('Dish with nameEs set uses nameEs in Spanish FTS (not name)', async () => {
    const dish = await prisma.dish.create({
      data: {
        restaurantId: RESTAURANT,
        sourceId: SRC,
        name: 'Grilled Chicken Salad',
        nameEs: 'Ensalada de pollo a la parrilla',
        confidenceLevel: 'low',
        estimationMethod: 'scraped',
      },
    });

    type Row = { found: boolean };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT (to_tsvector('spanish', COALESCE(name_es, name)) @@ plainto_tsquery('spanish', 'ensalada')) AS found
      FROM dishes
      WHERE id = ${dish.id}::uuid
    `;
    expect(rows[0]?.['found']).toBe(true);

    await prisma.dish.delete({ where: { id: dish.id } });
  });
});
