// Integration tests for F072 — cooking_profiles migration
//
// Verifies table structure, indexes, unique constraint, sentinel '*' foodName,
// and upsert idempotency against the real test DB.
// Run after applying the migration with: prisma migrate deploy

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

// Pre-cleanup to ensure clean state
beforeAll(async () => {
  await prisma.cookingProfile.deleteMany();
});

afterAll(async () => {
  await prisma.cookingProfile.deleteMany();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Table existence
// ---------------------------------------------------------------------------

describe('F072 migration — cooking_profiles table', () => {
  it('table cooking_profiles exists in pg_tables', async () => {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = 'cooking_profiles'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['tablename']).toBe('cooking_profiles');
  });

  // ---------------------------------------------------------------------------
  // Index existence
  // ---------------------------------------------------------------------------

  it('food_group index exists', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'cooking_profiles'
        AND indexname = 'cooking_profiles_food_group_idx'
    `;
    expect(rows).toHaveLength(1);
  });

  it('food_name index exists', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'cooking_profiles'
        AND indexname = 'cooking_profiles_food_name_idx'
    `;
    expect(rows).toHaveLength(1);
  });

  it('unique constraint index on (food_group, food_name, cooking_method) exists', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'cooking_profiles'
        AND indexname = 'cooking_profiles_food_group_food_name_cooking_method_key'
    `;
    expect(rows).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // No DB CHECK constraint on yield_factor (validation is in application code)
  // ---------------------------------------------------------------------------

  it('allows inserting a row with yield_factor <= 0 (no DB CHECK constraint)', async () => {
    // The application validates yieldFactor > 0; the DB does not enforce it
    // so the invalid_yield_factor reason can be surfaced to API clients
    await expect(
      prisma.$executeRaw`
        INSERT INTO cooking_profiles (id, food_group, food_name, cooking_method, yield_factor, source, updated_at)
        VALUES (
          gen_random_uuid(),
          'test_group',
          'test_food',
          'test_method',
          -1.0,
          'test',
          NOW()
        )
      `,
    ).resolves.toBe(1);

    // Cleanup
    await prisma.$executeRaw`
      DELETE FROM cooking_profiles
      WHERE food_group = 'test_group' AND food_name = 'test_food' AND cooking_method = 'test_method'
    `;
  });

  // ---------------------------------------------------------------------------
  // Unique constraint enforcement
  // ---------------------------------------------------------------------------

  it('unique constraint rejects duplicate (food_group, food_name, cooking_method)', async () => {
    await prisma.$executeRaw`
      INSERT INTO cooking_profiles (id, food_group, food_name, cooking_method, yield_factor, source, updated_at)
      VALUES (
        gen_random_uuid(),
        'grains',
        'rice',
        'boiled',
        2.8,
        'USDA retention factors',
        NOW()
      )
    `;

    await expect(
      prisma.$executeRaw`
        INSERT INTO cooking_profiles (id, food_group, food_name, cooking_method, yield_factor, source, updated_at)
        VALUES (
          gen_random_uuid(),
          'grains',
          'rice',
          'boiled',
          2.9,
          'USDA retention factors',
          NOW()
        )
      `,
    ).rejects.toThrow();

    // Cleanup
    await prisma.cookingProfile.deleteMany({
      where: { foodGroup: 'grains', foodName: 'rice', cookingMethod: 'boiled' },
    });
  });

  // ---------------------------------------------------------------------------
  // Sentinel foodName = '*' for group-level defaults
  // ---------------------------------------------------------------------------

  it('sentinel foodName="*" stores and retrieves correctly', async () => {
    const created = await prisma.cookingProfile.create({
      data: {
        foodGroup: 'legumes',
        foodName: '*',
        cookingMethod: 'boiled',
        yieldFactor: 2.5,
        fatAbsorption: null,
        source: 'USDA retention factors',
      },
    });

    expect(created.foodName).toBe('*');
    expect(created.foodGroup).toBe('legumes');
    expect(created.cookingMethod).toBe('boiled');
    expect(Number(created.yieldFactor)).toBeCloseTo(2.5);
    expect(created.fatAbsorption).toBeNull();

    const fetched = await prisma.cookingProfile.findFirst({
      where: { foodGroup: 'legumes', foodName: '*', cookingMethod: 'boiled' },
    });
    expect(fetched).not.toBeNull();
    expect(fetched?.['foodName']).toBe('*');

    // Cleanup
    await prisma.cookingProfile.delete({ where: { id: created.id } });
  });

  // ---------------------------------------------------------------------------
  // Upsert idempotency
  // ---------------------------------------------------------------------------

  it('upserting same row twice results in exactly one row', async () => {
    const upsertData = {
      foodGroup: 'pasta',
      foodName: 'spaghetti',
      cookingMethod: 'boiled',
      yieldFactor: 2.2,
      source: 'USDA retention factors',
    };

    await prisma.cookingProfile.upsert({
      where: {
        foodGroup_foodName_cookingMethod: {
          foodGroup: upsertData.foodGroup,
          foodName: upsertData.foodName,
          cookingMethod: upsertData.cookingMethod,
        },
      },
      create: upsertData,
      update: { yieldFactor: upsertData.yieldFactor },
    });

    await prisma.cookingProfile.upsert({
      where: {
        foodGroup_foodName_cookingMethod: {
          foodGroup: upsertData.foodGroup,
          foodName: upsertData.foodName,
          cookingMethod: upsertData.cookingMethod,
        },
      },
      create: upsertData,
      update: { yieldFactor: upsertData.yieldFactor },
    });

    const count = await prisma.cookingProfile.count({
      where: {
        foodGroup: upsertData.foodGroup,
        foodName: upsertData.foodName,
        cookingMethod: upsertData.cookingMethod,
      },
    });
    expect(count).toBe(1);

    // Cleanup
    await prisma.cookingProfile.deleteMany({
      where: { foodGroup: 'pasta', foodName: 'spaghetti' },
    });
  });

  // ---------------------------------------------------------------------------
  // Fat absorption nullable column
  // ---------------------------------------------------------------------------

  it('fatAbsorption is nullable — accepts null and non-null values', async () => {
    const withFat = await prisma.cookingProfile.create({
      data: {
        foodGroup: 'vegetables',
        foodName: 'potato',
        cookingMethod: 'fried',
        yieldFactor: 0.62,
        fatAbsorption: 14.0,
        source: 'USDA retention factors',
      },
    });

    expect(Number(withFat.fatAbsorption)).toBeCloseTo(14.0);

    const withoutFat = await prisma.cookingProfile.create({
      data: {
        foodGroup: 'vegetables',
        foodName: 'broccoli',
        cookingMethod: 'boiled',
        yieldFactor: 0.91,
        fatAbsorption: null,
        source: 'USDA retention factors',
      },
    });

    expect(withoutFat.fatAbsorption).toBeNull();

    // Cleanup
    await prisma.cookingProfile.deleteMany({ where: { foodGroup: 'vegetables' } });
  });
});
