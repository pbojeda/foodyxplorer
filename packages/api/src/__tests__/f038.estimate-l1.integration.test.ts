// Integration test for F038 — AC-9: L1 FTS Spanish query hits for a dish
// that has name_es populated.
//
// Seeds a dish with name = 'Grilled Chicken Salad' and name_es = 'Ensalada de Pollo a la Plancha'.
// Queries level1Lookup with Spanish query 'ensalada de pollo'.
// Expects matchType = 'fts_dish' (Strategy 2 — FTS with Spanish tsvector).
//
// Requires the test DB with migrations applied.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../generated/kysely-types.js';
import { level1Lookup } from '../estimation/level1Lookup.js';

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

// ---------------------------------------------------------------------------
// Fixture IDs (f038 prefix to avoid collisions)
// ---------------------------------------------------------------------------

const SRC_ID   = 'f0380000-0002-4000-a000-000000000001';
const REST_ID  = 'f0380000-0002-4000-a000-000000000002';
const DISH_ID  = 'f0380000-0002-4000-a000-000000000003';
const DN_ID    = 'f0380000-0002-4000-a000-000000000004';

// ---------------------------------------------------------------------------
// Kysely instance for level1Lookup
// ---------------------------------------------------------------------------

const pool = new Pool({ connectionString: DATABASE_URL_TEST });
const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool }),
});

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

async function cleanFixtures(): Promise<void> {
  await prisma.dishNutrient.deleteMany({ where: { dishId: DISH_ID } });
  await prisma.dish.deleteMany({ where: { id: DISH_ID } });
  await prisma.restaurant.deleteMany({ where: { id: REST_ID } });
  await prisma.dataSource.deleteMany({ where: { id: SRC_ID } });
}

beforeAll(async () => {
  await cleanFixtures();

  await prisma.dataSource.create({
    data: { id: SRC_ID, name: 'F038-L1-Test-Src', type: 'official' },
  });

  await prisma.restaurant.create({
    data: {
      id: REST_ID,
      name: 'F038 L1 Test Restaurant',
      chainSlug: 'f038-l1-test',
    },
  });

  await prisma.dish.create({
    data: {
      id: DISH_ID,
      name: 'Grilled Chicken Salad',
      nameEs: 'Ensalada de Pollo a la Plancha',
      nameSourceLocale: 'en',
      restaurantId: REST_ID,
      sourceId: SRC_ID,
      confidenceLevel: 'high',
      estimationMethod: 'scraped',
      availability: 'available',
    },
  });

  await prisma.dishNutrient.create({
    data: {
      id: DN_ID,
      dishId: DISH_ID,
      sourceId: SRC_ID,
      confidenceLevel: 'high',
      estimationMethod: 'scraped',
      calories: 320,
      proteins: 35,
      carbohydrates: 10,
      sugars: 3,
      fats: 14,
      saturatedFats: 3,
      fiber: 3,
      salt: 0.8,
      sodium: 320,
      referenceBasis: 'per_serving',
    },
  });
});

afterAll(async () => {
  await cleanFixtures();
  await prisma.$disconnect();
  await db.destroy();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F038 AC-9 — L1 FTS Spanish query hits for dish with name_es populated', () => {
  it('Spanish query "ensalada de pollo" matches via FTS (fts_dish) on name_es', async () => {
    const result = await level1Lookup(
      db,
      'ensalada de pollo',
      { chainSlug: 'f038-l1-test' },
    );

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('fts_dish');
    expect(result?.result.entityId).toBe(DISH_ID);
  });

  it('verifies the dish name and nameEs are returned correctly', async () => {
    const result = await level1Lookup(
      db,
      'ensalada de pollo',
      { chainSlug: 'f038-l1-test' },
    );

    expect(result?.result.name).toBe('Grilled Chicken Salad');
    expect(result?.result.nameEs).toBe('Ensalada de Pollo a la Plancha');
  });

  it('Spanish query does NOT match before name_es is set (control: different dish)', async () => {
    // Verify that an unrelated Spanish query returns null for our test chain
    const result = await level1Lookup(
      db,
      'hamburguesa con queso',
      { chainSlug: 'f038-l1-test' },
    );

    expect(result).toBeNull();
  });
});
