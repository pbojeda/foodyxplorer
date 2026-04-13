// F-UX-B Integration test — real test DB, all 3 tiers via resolvePortionAssumption.
//
// Seeds 1 dish with a ración row. Exercises:
//   Tier 1 — exact (dishId, term) match → source: 'per_dish'
//   Tier 2 — media_racion query + ración row only → derived per_dish via ×0.5 arithmetic
//   Tier 2 non-rule — tapa query + ración row → Tier 3 (tier2_rejected_tapa)
//   Tier 3 — unseeded dish → source: 'generic' + F085 range
//
// NOTE: Integration tests are excluded from the default vitest config.
// Run with: npx vitest run src/__tests__/f-ux-b.estimateRoute.portionAssumption.integration.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { resolvePortionAssumption } from '../estimation/portionAssumption.js';
import { detectPortionTerm } from '../estimation/portionSizing.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

// ---------------------------------------------------------------------------
// Fixture IDs — f-ux-b prefix to avoid collisions
// ---------------------------------------------------------------------------

const SRC_ID  = 'fb000000-0001-4000-a000-000000000001';
const REST_ID = 'fb000000-0001-4000-a000-000000000002';
const DISH_ID = 'fb000000-0001-4000-a000-000000000003';   // seeded dish WITH portions
const DISH_NOSEEDED_ID = 'fb000000-0001-4000-a000-000000000004'; // dish WITHOUT any standard_portions
const DN_ID   = 'fb000000-0001-4000-a000-000000000005';
const DN_NOSEEDED_ID = 'fb000000-0001-4000-a000-000000000006';

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

async function cleanFixtures(): Promise<void> {
  await prisma.standardPortion.deleteMany({ where: { dishId: { in: [DISH_ID, DISH_NOSEEDED_ID] } } });
  await prisma.dishNutrient.deleteMany({ where: { dishId: { in: [DISH_ID, DISH_NOSEEDED_ID] } } });
  await prisma.dish.deleteMany({ where: { id: { in: [DISH_ID, DISH_NOSEEDED_ID] } } });
  await prisma.restaurant.deleteMany({ where: { id: REST_ID } });
  await prisma.dataSource.deleteMany({ where: { id: SRC_ID } });
}

beforeAll(async () => {
  await cleanFixtures();

  await prisma.dataSource.create({
    data: { id: SRC_ID, name: 'F-UX-B-Integration-Test-Src', type: 'official' },
  });

  await prisma.restaurant.create({
    data: { id: REST_ID, name: 'F-UX-B Integration Test Restaurant', chainSlug: 'f-ux-b-integration-test' },
  });

  // Seeded dish — has ración row (and a tapa row for Tier 1)
  await prisma.dish.create({
    data: {
      id: DISH_ID,
      name: 'Croquetas F-UX-B Test',
      nameEs: 'Croquetas de jamón',
      nameSourceLocale: 'es',
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
      calories: 400,
      proteins: 14,
      carbohydrates: 30,
      sugars: 1,
      fats: 24,
      saturatedFats: 8,
      fiber: 1,
      salt: 1.2,
      sodium: 480,
      referenceBasis: 'per_serving',
    },
  });

  // Unseeded dish — no standard_portions rows
  await prisma.dish.create({
    data: {
      id: DISH_NOSEEDED_ID,
      name: 'Paella F-UX-B Test',
      nameEs: 'Paella valenciana',
      nameSourceLocale: 'es',
      restaurantId: REST_ID,
      sourceId: SRC_ID,
      confidenceLevel: 'high',
      estimationMethod: 'scraped',
      availability: 'available',
    },
  });

  await prisma.dishNutrient.create({
    data: {
      id: DN_NOSEEDED_ID,
      dishId: DISH_NOSEEDED_ID,
      sourceId: SRC_ID,
      confidenceLevel: 'high',
      estimationMethod: 'scraped',
      calories: 380,
      proteins: 15,
      carbohydrates: 55,
      sugars: 2,
      fats: 10,
      saturatedFats: 2,
      fiber: 2,
      salt: 1.5,
      sodium: 600,
      referenceBasis: 'per_serving',
    },
  });

  // Seed: tapa row for DISH_ID (Tier 1 lookup hit for tapa queries — BUT we
  // also test Tier 2 non-rule which requires tapa miss + racion row, so we
  // seed tapa here for Tier 1 only, and will test without it for Tier 2 non-rule
  // using the pure Tier 3 path).
  //
  // Tier 1 tapa row: 50g, 2 pieces of croquetas, confidence=high
  await prisma.standardPortion.create({
    data: {
      dishId: DISH_ID,
      term: 'tapa',
      grams: 50,
      pieces: 2,
      pieceName: 'croquetas',
      confidence: 'high',
      notes: 'Integration test fixture',
    },
  });

  // Tier 1/2 ración row: 200g, 8 pieces, confidence=high
  // Used for: Tier 1 ración query, Tier 2 media_racion arithmetic, Tier 2 non-rule
  await prisma.standardPortion.create({
    data: {
      dishId: DISH_ID,
      term: 'racion',
      grams: 200,
      pieces: 8,
      pieceName: 'croquetas',
      confidence: 'high',
      notes: 'Integration test fixture',
    },
  });
});

afterAll(async () => {
  await cleanFixtures();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Tier 1 — exact DB lookup hit
// ---------------------------------------------------------------------------

describe('F-UX-B Integration — Tier 1 (exact DB lookup)', () => {
  it('Tier 1: tapa query + tapa row → source=per_dish, grams=50, pieces=2', async () => {
    const detectedTerm = detectPortionTerm('tapa de croquetas');
    expect(detectedTerm).not.toBeNull();

    const result = await resolvePortionAssumption(
      prisma,
      DISH_ID,
      detectedTerm,
      'tapa de croquetas',
      1.0,
    );

    expect(result.portionAssumption).toBeDefined();
    expect(result.portionAssumption?.source).toBe('per_dish');
    expect(result.portionAssumption?.term).toBe('tapa');
    expect(result.portionAssumption?.grams).toBe(50);
    expect(result.portionAssumption?.pieces).toBe(2);
    expect(result.portionAssumption?.pieceName).toBe('croquetas');
    expect(result.portionAssumption?.confidence).toBe('high');
    expect(result.portionAssumption?.gramsRange).toBeNull();
    expect(result.portionAssumption?.fallbackReason).toBeNull();
  });

  it('Tier 1: ración query + ración row → source=per_dish, grams=200, pieces=8', async () => {
    const detectedTerm = detectPortionTerm('ración de croquetas');
    expect(detectedTerm).not.toBeNull();

    const result = await resolvePortionAssumption(
      prisma,
      DISH_ID,
      detectedTerm,
      'ración de croquetas',
      1.0,
    );

    expect(result.portionAssumption?.source).toBe('per_dish');
    expect(result.portionAssumption?.grams).toBe(200);
    expect(result.portionAssumption?.pieces).toBe(8);
    expect(result.portionAssumption?.pieceName).toBe('croquetas');
  });

  it('Tier 1 with multiplier 1.5: tapa → grams=75, pieces=3', async () => {
    const detectedTerm = detectPortionTerm('tapa de croquetas');
    const result = await resolvePortionAssumption(
      prisma,
      DISH_ID,
      detectedTerm,
      'tapa de croquetas',
      1.5,
    );

    expect(result.portionAssumption?.source).toBe('per_dish');
    expect(result.portionAssumption?.grams).toBe(75);  // round(50 * 1.5)
    expect(result.portionAssumption?.pieces).toBe(3);  // round(2 * 1.5)
  });
});

// ---------------------------------------------------------------------------
// Tier 2 — media_racion arithmetic
// ---------------------------------------------------------------------------

describe('F-UX-B Integration — Tier 2 (media_racion arithmetic)', () => {
  it('Tier 2: media ración query + ración row (no media_racion row) → derived per_dish', async () => {
    const detectedTerm = detectPortionTerm('media ración de croquetas');
    expect(detectedTerm).not.toBeNull();

    const result = await resolvePortionAssumption(
      prisma,
      DISH_ID,
      detectedTerm,
      'media ración de croquetas',
      1.0,
    );

    expect(result.portionAssumption?.source).toBe('per_dish');
    expect(result.portionAssumption?.term).toBe('media_racion');
    expect(result.portionAssumption?.grams).toBe(100);  // round(200 * 0.5)
    expect(result.portionAssumption?.pieces).toBe(4);   // round(8 * 0.5)
    expect(result.portionAssumption?.pieceName).toBe('croquetas');
    expect(result.portionAssumption?.gramsRange).toBeNull();
    expect(result.portionAssumption?.fallbackReason).toBeNull();
    expect(result.portionAssumption?.confidence).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// Tier 2 non-rule — tapa/pintxo do NOT derive from ración
// ---------------------------------------------------------------------------

describe('F-UX-B Integration — Tier 2 non-rule (tapa + ración row → Tier 3)', () => {
  it('Tier 2 non-rule: pintxo query + ración row → Tier 3 (tier2_rejected_pintxo)', async () => {
    const detectedTerm = detectPortionTerm('pintxo de croquetas');
    expect(detectedTerm).not.toBeNull();

    const result = await resolvePortionAssumption(
      prisma,
      DISH_ID,
      detectedTerm,
      'pintxo de croquetas',
      1.0,
    );

    // DISH_ID has no pintxo row (Tier 1 miss), and pintxo/tapa don't derive
    // from ración (Tier 2 non-rule), so falls through to Tier 3
    expect(result.portionAssumption?.source).toBe('generic');
    expect(result.portionAssumption?.fallbackReason).toBe('tier2_rejected_pintxo');
    expect(result.portionAssumption?.gramsRange).toEqual([30, 60]);
    expect(result.portionAssumption?.grams).toBe(45);  // round((30+60)/2)
    expect(result.portionAssumption?.pieces).toBeNull();
    expect(result.portionAssumption?.confidence).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tier 3 — unseeded dish
// ---------------------------------------------------------------------------

describe('F-UX-B Integration — Tier 3 (F085 generic fallback)', () => {
  it('Tier 3: unseeded dish + tapa query → source=generic, gramsRange=[50,80], fallbackReason=no_row', async () => {
    const detectedTerm = detectPortionTerm('tapa de paella');
    expect(detectedTerm).not.toBeNull();

    const result = await resolvePortionAssumption(
      prisma,
      DISH_NOSEEDED_ID,
      detectedTerm,
      'tapa de paella',
      1.0,
    );

    expect(result.portionAssumption?.source).toBe('generic');
    expect(result.portionAssumption?.term).toBe('tapa');
    expect(result.portionAssumption?.grams).toBe(65);  // round((50+80)/2)
    expect(result.portionAssumption?.gramsRange).toEqual([50, 80]);
    expect(result.portionAssumption?.pieces).toBeNull();
    expect(result.portionAssumption?.confidence).toBeNull();
    expect(result.portionAssumption?.fallbackReason).toBe('no_row');
  });

  it('Tier 3: unseeded dish + ración query → source=generic, gramsRange=[200,250]', async () => {
    const detectedTerm = detectPortionTerm('ración de paella');
    expect(detectedTerm).not.toBeNull();

    const result = await resolvePortionAssumption(
      prisma,
      DISH_NOSEEDED_ID,
      detectedTerm,
      'ración de paella',
      1.0,
    );

    expect(result.portionAssumption?.source).toBe('generic');
    expect(result.portionAssumption?.grams).toBe(225);  // round((200+250)/2)
    expect(result.portionAssumption?.gramsRange).toEqual([200, 250]);
    expect(result.portionAssumption?.fallbackReason).toBe('no_row');
  });

  it('Tier 3: null dishId (food-level entity) → empty result', async () => {
    const detectedTerm = detectPortionTerm('tapa de paella');
    const result = await resolvePortionAssumption(
      prisma,
      null,
      detectedTerm,
      'tapa de paella',
      1.0,
    );

    expect(result).toEqual({});
  });

  it('Tier 3: no portion term in query → empty result', async () => {
    const detectedTerm = detectPortionTerm('croquetas de jamón');
    expect(detectedTerm).toBeNull();  // no Spanish portion term

    const result = await resolvePortionAssumption(
      prisma,
      DISH_NOSEEDED_ID,
      detectedTerm,
      'croquetas de jamón',
      1.0,
    );

    expect(result).toEqual({});
  });
});
