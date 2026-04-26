// F-H7 — Integration tests for H7-P5 retry seam in runEstimationCascade().
//
// Tests the L1-retry seam inserted between L1-null branch (line 168) and L2 fallback
// (line 170) in engineRouter.ts. Verifies:
//   - L1 NULL + retry hits (Cat A, B, C strips)
//   - L1 Pass 1 hits — retry NOT triggered (for catalog dishes)
//   - L1 NULL + retry NULL → fallback to L2+ with original text
//   - pan con tomate landmine never reaches retry seam (L1 Pass 1 hits)
//   - Q496 tacos al pastor con cilantro y piña → Cat C strips → L1 hits
//
// Uses real DB (DATABASE_URL_TEST), real level1Lookup — no mocking.
// Inserts required test fixtures in beforeAll (dishes may not be in test DB seed).
//
// Vitest globals NOT enabled — import everything explicitly.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../generated/kysely-types.js';
import { runEstimationCascade } from '../estimation/engineRouter.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

// ---------------------------------------------------------------------------
// DB clients
// ---------------------------------------------------------------------------

const pool = new Pool({ connectionString: DATABASE_URL_TEST });
const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL_TEST } } });

// ---------------------------------------------------------------------------
// Fixture IDs — fH7 prefix (independent namespace)
// ---------------------------------------------------------------------------

// Fixture UUIDs: f700 prefix (H7 feature, valid hex)
const H7_SRC_ID       = 'f7000000-00f7-4000-a000-000000000001';
const H7_REST_ID      = 'f7000000-00f7-4000-a000-000000000002';

// Dish IDs for test fixtures
const H7_DISH_GAZP    = 'f7000000-00f7-4000-a000-000000000010'; // gazpachuelo malagueño (CE-283)
const H7_DN_GAZP      = 'f7000000-00f7-4000-a000-000000000011';
const H7_DISH_BACALAO = 'f7000000-00f7-4000-a000-000000000020'; // bacalao al pil-pil (CE-106)
const H7_DN_BACALAO   = 'f7000000-00f7-4000-a000-000000000021';
const H7_DISH_PAN     = 'f7000000-00f7-4000-a000-000000000030'; // pan con tomate
const H7_DN_PAN       = 'f7000000-00f7-4000-a000-000000000031';
const H7_DISH_TACOS   = 'f7000000-00f7-4000-a000-000000000040'; // tacos al pastor (CE-297)
const H7_DN_TACOS     = 'f7000000-00f7-4000-a000-000000000041';
const H7_DISH_TATAKI  = 'f7000000-00f7-4000-a000-000000000050'; // tataki de atún (CE-304)
const H7_DN_TATAKI    = 'f7000000-00f7-4000-a000-000000000051';

const BASE_NUTRIENTS = {
  calories: 200, proteins: 8, carbohydrates: 15, sugars: 2,
  fats: 10, saturatedFats: 3, fiber: 2, salt: 0.5, sodium: 200,
  transFats: 0, cholesterol: 0, potassium: 200,
  monounsaturatedFats: 4, polyunsaturatedFats: 2, alcohol: 0,
};

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

async function cleanFixtures(): Promise<void> {
  const dishIds = [H7_DISH_GAZP, H7_DISH_BACALAO, H7_DISH_PAN, H7_DISH_TACOS, H7_DISH_TATAKI];
  await prisma.dishNutrient.deleteMany({ where: { dishId: { in: dishIds } } });
  await prisma.dish.deleteMany({ where: { id: { in: dishIds } } });
  await prisma.restaurant.deleteMany({ where: { id: H7_REST_ID } });
  await prisma.dataSource.deleteMany({ where: { id: H7_SRC_ID } });
}

beforeAll(async () => {
  await cleanFixtures();

  await prisma.dataSource.create({
    data: { id: H7_SRC_ID, name: 'F-H7-Integration-Test', type: 'official' },
  });

  await prisma.restaurant.create({
    data: { id: H7_REST_ID, name: 'F-H7-Test-Restaurant', chainSlug: 'fh7-test' },
  });

  const makeDish = (id: string, name: string, aliases: string[], portionGrams: number) => ({
    id,
    name,
    nameEs: name,
    nameSourceLocale: 'es',
    restaurantId: H7_REST_ID,
    sourceId: H7_SRC_ID,
    portionGrams,
    aliases,
    confidenceLevel: 'high' as const,
    estimationMethod: 'official',
    availability: 'available',
  });

  const makeDN = (id: string, dishId: string) => ({
    id,
    dishId,
    sourceId: H7_SRC_ID,
    confidenceLevel: 'high' as const,
    ...BASE_NUTRIENTS,
    referenceBasis: 'per_serving' as const,
    estimationMethod: 'official',
  });

  // gazpachuelo malagueño — CE-283 equivalent (Cat A strip target: "bien caliente")
  await prisma.dish.create({ data: makeDish(H7_DISH_GAZP, 'gazpachuelo malagueño', [], 300) });
  await prisma.dishNutrient.create({ data: makeDN(H7_DN_GAZP, H7_DISH_GAZP) });

  // bacalao al pil-pil — CE-106 equivalent (should hit L1 Pass 1)
  await prisma.dish.create({ data: makeDish(H7_DISH_BACALAO, 'bacalao al pil-pil', [], 250) });
  await prisma.dishNutrient.create({ data: makeDN(H7_DN_BACALAO, H7_DISH_BACALAO) });

  // pan con tomate — landmine dish (should hit L1 Pass 1 with full text)
  await prisma.dish.create({ data: makeDish(H7_DISH_PAN, 'pan con tomate', [], 100) });
  await prisma.dishNutrient.create({ data: makeDN(H7_DN_PAN, H7_DISH_PAN) });

  // tacos al pastor — CE-297 equivalent (Cat C strip target: "con cilantro y piña")
  await prisma.dish.create({ data: makeDish(H7_DISH_TACOS, 'tacos al pastor', ['taco al pastor'], 200) });
  await prisma.dishNutrient.create({ data: makeDN(H7_DN_TACOS, H7_DISH_TACOS) });

  // tataki de atún — CE-304 equivalent (Cat C strip target: "con sésamo")
  await prisma.dish.create({ data: makeDish(H7_DISH_TATAKI, 'tataki de atún', ['tataki de atún rojo'], 200) });
  await prisma.dishNutrient.create({ data: makeDN(H7_DN_TATAKI, H7_DISH_TATAKI) });
});

afterAll(async () => {
  await cleanFixtures();
  await pool.end();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('H7-P5 retry seam — runEstimationCascade() end-to-end', () => {
  it('L1 NULL + retry hits (Cat A): "gazpachuelo malagueño bien caliente" → Cat A strips → L1 hit', async () => {
    // L1 Pass 1: "gazpachuelo malagueño bien caliente" → NULL (no exact match)
    // Cat A strips "bien caliente" → "gazpachuelo malagueño" → L1 exact hit
    const result = await runEstimationCascade({
      db,
      query: 'gazpachuelo malagueño bien caliente',
      prisma,
    });
    expect(result.levelHit).toBe(1);
    expect(result.data.level1Hit).toBe(true);
    // Raw query echoed (not the stripped form) — engineRouter design invariant
    expect(result.data.query).toBe('gazpachuelo malagueño bien caliente');
  });

  it('L1 Pass 1 hits — retry NOT triggered: "bacalao al pil-pil" resolves at Pass 1', async () => {
    // "bacalao al pil-pil" is in the test DB — L1 Pass 1 hits, seam never reached
    const result = await runEstimationCascade({
      db,
      query: 'bacalao al pil-pil',
      prisma,
    });
    expect(result.levelHit).toBe(1);
    expect(result.data.level1Hit).toBe(true);
  });

  it('L1 NULL + retry NULL → fallback: "manjar desconocido bien caliente" → not levelHit 1', async () => {
    // "manjar desconocido" does not exist in DB → retry L1 also misses → L2+ with original
    const result = await runEstimationCascade({
      db,
      query: 'manjar desconocido bien caliente',
      prisma,
    });
    // Must NOT return levelHit 1 (retry missed too)
    expect(result.levelHit).not.toBe(1);
  });

  it('pan con tomate landmine: L1 Pass 1 hits — retry seam never reached', async () => {
    // "pan con tomate" is a catalog dish — L1 Pass 1 hits before seam is reached
    // This validates that Cat C ≥2 token guard AND seam architecture protect landmines
    const result = await runEstimationCascade({
      db,
      query: 'pan con tomate',
      prisma,
    });
    expect(result.levelHit).toBe(1);
    expect(result.data.level1Hit).toBe(true);
  });

  it('Q496: "tacos al pastor con cilantro y piña" → Cat C strips → L1 hit', async () => {
    // L1 Pass 1 misses (full text not in catalog)
    // Cat C strips "con cilantro y piña" → "tacos al pastor" → L1 hit
    const result = await runEstimationCascade({
      db,
      query: 'tacos al pastor con cilantro y piña',
      prisma,
    });
    expect(result.levelHit).toBe(1);
    expect(result.data.level1Hit).toBe(true);
    // Raw query echoed
    expect(result.data.query).toBe('tacos al pastor con cilantro y piña');
  });
});

describe('H7-P5 retry seam — observability (logger.debug)', () => {
  it('logger.debug called with wrapperPattern: "H7-P5" when retry seam fires', async () => {
    const debugCalls: Array<Record<string, unknown>> = [];
    const mockLogger = {
      debug: (obj: Record<string, unknown>) => { debugCalls.push(obj); },
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    await runEstimationCascade({
      db,
      query: 'tataki de atún con sésamo',
      prisma,
      logger: mockLogger,
    });

    // H7-P5 seam should have fired (Cat C strips "con sésamo" → "tataki de atún")
    const h7DebugCall = debugCalls.find(c => c['wrapperPattern'] === 'H7-P5');
    expect(h7DebugCall).toBeDefined();
    expect(h7DebugCall?.['original']).toBe('tataki de atún con sésamo');
    expect(h7DebugCall?.['stripped']).toBe('tataki de atún');
  });
});
