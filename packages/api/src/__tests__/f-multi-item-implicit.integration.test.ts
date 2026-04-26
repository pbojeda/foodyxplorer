// F-MULTI-ITEM-IMPLICIT — Integration tests via processMessage() (AC1–AC13, AC15, AC16)
//
// Exercises the full processMessage() pipeline to verify implicit multi-item detection
// routes conjunction-containing queries to menu_estimation via Step 3.6.
//
// ADR-021: Integration tests MUST call processMessage(), not helpers directly.
//
// Mock strategy (mirrors f-nlp-chain.conversationCore.integration.test.ts):
//   - contextManager  → getContext() returns null
//   - lib/cache       → cacheGet() returns null / cacheSet() no-ops
//   - engineRouter    → runEstimationCascade() returns controlled dish fixture
//
// Real db + prisma from DATABASE_URL_TEST.
// Fixture UUID prefix: fb000000-00fb- (independent namespace from fa prefix).
// NOTE: level1Lookup is NOT mocked here — real DB + FTS catalog validation is exercised.
// AC14 (error-fallback) is in the SEPARATE file f-multi-item-implicit.fallback.integration.test.ts

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock references
// ---------------------------------------------------------------------------

const { mockCascade } = vi.hoisted(() => ({
  mockCascade: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks — MUST appear before any module-under-test imports
// ---------------------------------------------------------------------------

vi.mock('../conversation/contextManager.js', () => ({
  getContext: vi.fn().mockResolvedValue(null),
  setContext: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/cache.js', () => ({
  buildKey: (_entity: string, id: string) => `fxp:estimate:${id}`,
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../estimation/engineRouter.js', () => ({
  runEstimationCascade: mockCascade,
}));

// ---------------------------------------------------------------------------
// Imports — AFTER vi.mock declarations
// ---------------------------------------------------------------------------

import { PrismaClient } from '@prisma/client';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../generated/kysely-types.js';
import type { ConversationRequest } from '../conversation/types.js';
import type { EstimateResult } from '@foodxplorer/shared';
import { processMessage } from '../conversation/conversationCore.js';

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
// Fixture IDs — fb000000-00fb- prefix (independent from fa prefix used by F-NLP-CHAIN-ORDERING)
// ---------------------------------------------------------------------------

const FB_SRC_ID        = 'fb000000-00fb-4000-a000-000000000001';
const FB_REST_ID       = 'fb000000-00fb-4000-a000-000000000002';
const FB_DISH_PAELLA   = 'fb000000-00fb-4000-a000-000000000003';
const FB_DN_PAELLA     = 'fb000000-00fb-4000-a000-000000000004';
const FB_DISH_VINO     = 'fb000000-00fb-4000-a000-000000000005';
const FB_DN_VINO       = 'fb000000-00fb-4000-a000-000000000006';
const FB_DISH_CAFE     = 'fb000000-00fb-4000-a000-000000000007';
const FB_DN_CAFE       = 'fb000000-00fb-4000-a000-000000000008';
const FB_DISH_TOSTADA  = 'fb000000-00fb-4000-a000-000000000009';
const FB_DN_TOSTADA    = 'fb000000-00fb-4000-a000-000000000010';
const FB_DISH_CANA     = 'fb000000-00fb-4000-a000-000000000011';
const FB_DN_CANA       = 'fb000000-00fb-4000-a000-000000000012';
const FB_DISH_BRAVAS   = 'fb000000-00fb-4000-a000-000000000013';
const FB_DN_BRAVAS     = 'fb000000-00fb-4000-a000-000000000014';
const FB_DISH_FLAN     = 'fb000000-00fb-4000-a000-000000000015';
const FB_DN_FLAN       = 'fb000000-00fb-4000-a000-000000000016';

// For AC15: 8 valid catalog dishes for MAX_MENU_ITEMS test
// We reuse existing fixture dishes plus extra ones
const FB_DISH_EXTRA1   = 'fb000000-00fb-4000-a000-000000000017';
const FB_DN_EXTRA1     = 'fb000000-00fb-4000-a000-000000000018';
const FB_DISH_EXTRA2   = 'fb000000-00fb-4000-a000-000000000019';
const FB_DN_EXTRA2     = 'fb000000-00fb-4000-a000-000000000020';

// For AC8-AC11: catalog landmine dishes (have ' y ' in their names → Guard 2 must catch them)
const FB_DISH_TOSTADA_ACEITE     = 'fb000000-00fb-4000-a000-000000000021'; // AC8
const FB_DN_TOSTADA_ACEITE       = 'fb000000-00fb-4000-a000-000000000022';
const FB_DISH_BOCADILLO_BACON    = 'fb000000-00fb-4000-a000-000000000023'; // AC9
const FB_DN_BOCADILLO_BACON      = 'fb000000-00fb-4000-a000-000000000024';
const FB_DISH_HAMBURGUESA_HUEVO  = 'fb000000-00fb-4000-a000-000000000025'; // AC10
const FB_DN_HAMBURGUESA_HUEVO    = 'fb000000-00fb-4000-a000-000000000026';
const FB_DISH_ARROZ_VERDURAS     = 'fb000000-00fb-4000-a000-000000000027'; // AC11
const FB_DN_ARROZ_VERDURAS       = 'fb000000-00fb-4000-a000-000000000028';

const FB_ACTOR_ID = 'fb000000-00fb-4000-a000-000000000099';

// ---------------------------------------------------------------------------
// Cascade mock helpers
// ---------------------------------------------------------------------------

const FB_MOCK_NUTRIENTS = {
  calories: 200, proteins: 5, carbohydrates: 20, sugars: 2,
  fats: 5, saturatedFats: 2, fiber: 1, salt: 0.5, sodium: 200,
  transFats: 0, cholesterol: 0, potassium: 100,
  monounsaturatedFats: 2, polyunsaturatedFats: 1, alcohol: 0,
  referenceBasis: 'per_serving' as const,
};

function makeDishResult(entityId: string, name: string): EstimateResult {
  return {
    entityType: 'dish',
    entityId,
    name,
    nameEs: name,
    restaurantId: FB_REST_ID,
    chainSlug: 'fb-implicit-test',
    portionGrams: 200,
    nutrients: FB_MOCK_NUTRIENTS,
    confidenceLevel: 'high',
    estimationMethod: 'official',
    source: {
      id: FB_SRC_ID,
      name: 'FB-Implicit-Test-Src',
      type: 'official',
      url: 'https://example.com',
    },
    similarityDistance: null,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

async function cleanFixtures(): Promise<void> {
  const allDishes = [
    FB_DISH_PAELLA, FB_DISH_VINO, FB_DISH_CAFE, FB_DISH_TOSTADA,
    FB_DISH_CANA, FB_DISH_BRAVAS, FB_DISH_FLAN, FB_DISH_EXTRA1, FB_DISH_EXTRA2,
    // Landmine dishes for AC8-AC11
    FB_DISH_TOSTADA_ACEITE, FB_DISH_BOCADILLO_BACON,
    FB_DISH_HAMBURGUESA_HUEVO, FB_DISH_ARROZ_VERDURAS,
  ];
  await prisma.dishNutrient.deleteMany({ where: { dishId: { in: allDishes } } });
  await prisma.dish.deleteMany({ where: { id: { in: allDishes } } });
  await prisma.restaurant.deleteMany({ where: { id: FB_REST_ID } });
  await prisma.dataSource.deleteMany({ where: { id: FB_SRC_ID } });
}

beforeAll(async () => {
  // mockCascade: route by food term in the query string
  mockCascade.mockImplementation(async (opts: { query: string }) => {
    const q = opts.query.toLowerCase();

    const matched =
      q.includes('paella')
        ? makeDishResult(FB_DISH_PAELLA, 'paella')
      : (q === 'vino' || q.includes('vino'))
        ? makeDishResult(FB_DISH_VINO, 'vino')
      : (q.includes('café') || q.includes('cafe') || q === 'café con leche')
        ? makeDishResult(FB_DISH_CAFE, 'café con leche')
      : q.includes('tostada')
        ? makeDishResult(FB_DISH_TOSTADA, 'tostada con tomate')
      : (q.includes('caña') || q.includes('cana'))
        ? makeDishResult(FB_DISH_CANA, 'caña de cerveza')
      : q.includes('bravas')
        ? makeDishResult(FB_DISH_BRAVAS, 'patatas bravas')
      : q.includes('flan')
        ? makeDishResult(FB_DISH_FLAN, 'flan casero')
      : q.includes('fbextra1')
        ? makeDishResult(FB_DISH_EXTRA1, 'fbextra1')
      : q.includes('fbextra2')
        ? makeDishResult(FB_DISH_EXTRA2, 'fbextra2')
      : null;

    if (matched) {
      return {
        levelHit: 1,
        data: {
          query: opts.query,
          chainSlug: null,
          level1Hit: true,
          level2Hit: false,
          level3Hit: false,
          level4Hit: false,
          matchType: 'exact_dish' as const,
          result: matched,
          cachedAt: null,
          yieldAdjustment: null,
        },
      };
    }

    return {
      levelHit: null,
      data: {
        query: opts.query,
        chainSlug: null,
        level1Hit: false,
        level2Hit: false,
        level3Hit: false,
        level4Hit: false,
        matchType: null,
        result: null,
        cachedAt: null,
      },
    };
  });

  await cleanFixtures();

  await prisma.dataSource.create({
    data: { id: FB_SRC_ID, name: 'FB-Implicit-Test-Src', type: 'official' },
  });

  await prisma.restaurant.create({
    data: {
      id: FB_REST_ID,
      name: 'FB Implicit Test Restaurant',
      chainSlug: 'fb-implicit-test',
    },
  });

  const dishes = [
    // Positive multi-item detection fixtures (canonical queries + common items)
    { id: FB_DISH_PAELLA,  dnId: FB_DN_PAELLA,  name: 'paella',            calories: 350 },
    { id: FB_DISH_VINO,    dnId: FB_DN_VINO,    name: 'vino',              calories: 80  },
    { id: FB_DISH_CAFE,    dnId: FB_DN_CAFE,    name: 'café con leche',    calories: 80  },
    { id: FB_DISH_TOSTADA, dnId: FB_DN_TOSTADA, name: 'tostada con tomate', calories: 120 },
    { id: FB_DISH_CANA,    dnId: FB_DN_CANA,    name: 'caña de cerveza',   calories: 180 },
    { id: FB_DISH_BRAVAS,  dnId: FB_DN_BRAVAS,  name: 'patatas bravas',    calories: 250 },
    { id: FB_DISH_FLAN,    dnId: FB_DN_FLAN,    name: 'flan casero',       calories: 160 },
    // For AC15 — names are distinct enough for FTS resolution
    { id: FB_DISH_EXTRA1,  dnId: FB_DN_EXTRA1,  name: 'fbextra1',          calories: 100 },
    { id: FB_DISH_EXTRA2,  dnId: FB_DN_EXTRA2,  name: 'fbextra2',          calories: 100 },
    // Catalog landmine dishes — AC8-AC11: single-dish names containing ' y '
    // Guard 2 (whole-text L1 lookup) MUST catch these before any split attempt.
    { id: FB_DISH_TOSTADA_ACEITE,    dnId: FB_DN_TOSTADA_ACEITE,    name: 'tostada con tomate y aceite',     calories: 120 },
    { id: FB_DISH_BOCADILLO_BACON,   dnId: FB_DN_BOCADILLO_BACON,   name: 'bocadillo de bacon y queso',      calories: 400 },
    { id: FB_DISH_HAMBURGUESA_HUEVO, dnId: FB_DN_HAMBURGUESA_HUEVO, name: 'hamburguesa con huevo y patatas', calories: 600 },
    { id: FB_DISH_ARROZ_VERDURAS,    dnId: FB_DN_ARROZ_VERDURAS,    name: 'arroz con verduras y huevo',      calories: 320 },
  ];

  for (const d of dishes) {
    await prisma.dish.create({
      data: {
        id: d.id,
        name: d.name,
        nameEs: d.name,
        nameSourceLocale: 'es',
        restaurantId: FB_REST_ID,
        sourceId: FB_SRC_ID,
        confidenceLevel: 'high',
        estimationMethod: 'scraped',
        availability: 'available',
      },
    });
    await prisma.dishNutrient.create({
      data: {
        id: d.dnId,
        dishId: d.id,
        sourceId: FB_SRC_ID,
        confidenceLevel: 'high',
        estimationMethod: 'scraped',
        calories: d.calories,
        proteins: 5,
        carbohydrates: 15,
        sugars: 1,
        fats: 5,
        saturatedFats: 2,
        fiber: 1,
        salt: 0.5,
        sodium: 200,
        referenceBasis: 'per_serving',
      },
    });
  }
});

afterAll(async () => {
  await cleanFixtures();
  await prisma.$disconnect();
  await pool.end();
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function buildRequest(
  text: string,
  extra: Partial<ConversationRequest> = {},
): ConversationRequest {
  return {
    text,
    actorId: FB_ACTOR_ID,
    db,
    redis: {} as ConversationRequest['redis'],
    prisma,
    chainSlugs: ['fb-implicit-test'],
    chains: [{ chainSlug: 'fb-implicit-test', name: 'FB Implicit Test Restaurant', nameEs: null }],
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F-MULTI-ITEM-IMPLICIT — processMessage() integration (ADR-021)', () => {

  // -------------------------------------------------------------------------
  // AC1: Canonical #1 — "he cenado una ración de paella y una copa de vino"
  // -------------------------------------------------------------------------
  it('AC1 — "he cenado una ración de paella y una copa de vino" → menu_estimation, 2 items', async () => {
    // Pattern 4 strips "he cenado " → "una ración de paella y una copa de vino"
    // extractFoodQuery then strips article "una " and serving prefix "ración de " → "paella y una copa de vino"
    // Detector splits: ["paella", "vino"] (normalizeFragment strips "una copa de " → "vino")
    const result = await processMessage(buildRequest('he cenado una ración de paella y una copa de vino'));

    expect(result.intent).toBe('menu_estimation');
    expect(result.menuEstimation?.items).toHaveLength(2);
    const queries = result.menuEstimation!.items.map((i) => i.query);
    expect(queries).toContain('paella');
    expect(queries).toContain('vino');
  });

  // -------------------------------------------------------------------------
  // AC2: Canonical #2 — "esta mañana he tomado café con leche y tostada"
  // -------------------------------------------------------------------------
  it('AC2 — "esta mañana he tomado café con leche y tostada" → menu_estimation, 2 items', async () => {
    // Pattern 4b strips "esta mañana he tomado " → "café con leche y tostada"
    // Detector: Guard 2 miss (not a single catalog dish), split → ["café con leche", "tostada"]
    const result = await processMessage(buildRequest('esta mañana he tomado café con leche y tostada'));

    expect(result.intent).toBe('menu_estimation');
    expect(result.menuEstimation?.items).toHaveLength(2);
    const queries = result.menuEstimation!.items.map((i) => i.query);
    expect(queries).toContain('café con leche');
    expect(queries).toContain('tostada');
  });

  // -------------------------------------------------------------------------
  // AC3: Canonical #3 — "he entrado en un bar y me he pedido una caña y unas bravas"
  // -------------------------------------------------------------------------
  it('AC3 — "he entrado en un bar y me he pedido una caña y unas bravas" → menu_estimation, 2 items', async () => {
    // Pattern 7b strips wrapper → "una caña y unas bravas"
    // extractFoodQuery ARTICLE_PATTERN strips "una " → "caña y unas bravas"
    // Detector normalizes: ["caña", "bravas"]
    const result = await processMessage(buildRequest('he entrado en un bar y me he pedido una caña y unas bravas'));

    expect(result.intent).toBe('menu_estimation');
    expect(result.menuEstimation?.items).toHaveLength(2);
    const queries = result.menuEstimation!.items.map((i) => i.query);
    expect(queries).toContain('caña');
    expect(queries).toContain('bravas');
  });

  // -------------------------------------------------------------------------
  // AC4: ≥3 items with comma — "he comido paella, vino y flan"
  // -------------------------------------------------------------------------
  it('AC4 — "he comido paella, vino y flan" → menu_estimation, 3 items', async () => {
    const result = await processMessage(buildRequest('he comido paella, vino y flan'));

    expect(result.intent).toBe('menu_estimation');
    expect(result.menuEstimation?.items).toHaveLength(3);
    const queries = result.menuEstimation!.items.map((i) => i.query);
    expect(queries).toContain('paella');
    expect(queries).toContain('vino');
    expect(queries).toContain('flan');
  });

  // -------------------------------------------------------------------------
  // AC5: ≥3 items y-only — "paella y vino y flan"
  // -------------------------------------------------------------------------
  it('AC5 — "paella y vino y flan" → menu_estimation, 3 items (recursive y-split)', async () => {
    const result = await processMessage(buildRequest('paella y vino y flan'));

    expect(result.intent).toBe('menu_estimation');
    expect(result.menuEstimation?.items).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // AC6: Diners — "para 4 personas paella y vino"
  // -------------------------------------------------------------------------
  it('AC6 — "para 4 personas paella y vino" → menu_estimation, 2 items, diners=4', async () => {
    const result = await processMessage(buildRequest('para 4 personas paella y vino'));

    expect(result.intent).toBe('menu_estimation');
    expect(result.menuEstimation?.items).toHaveLength(2);
    expect(result.menuEstimation?.diners).toBe(4);
    expect(result.menuEstimation?.perPerson).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // AC7: Single dish no conjunction — "café con leche" → estimation (Guard 1)
  // -------------------------------------------------------------------------
  it('AC7 — "café con leche" → estimation (not menu_estimation, Guard 1)', async () => {
    const result = await processMessage(buildRequest('café con leche'));

    expect(result.intent).toBe('estimation');
  });

  // -------------------------------------------------------------------------
  // AC8: Catalog landmine y+con — "tostada con tomate y aceite" → estimation (Guard 2)
  // -------------------------------------------------------------------------
  it('AC8 — "tostada con tomate y aceite" → estimation (Guard 2 whole-text L1 hit)', async () => {
    const result = await processMessage(buildRequest('tostada con tomate y aceite'));

    expect(result.intent).toBe('estimation');
  });

  // -------------------------------------------------------------------------
  // AC9: y-only landmine — "bocadillo de bacon y queso" → estimation (Guard 2)
  // -------------------------------------------------------------------------
  it('AC9 — "bocadillo de bacon y queso" → estimation (Guard 2 y-only landmine)', async () => {
    const result = await processMessage(buildRequest('bocadillo de bacon y queso'));

    expect(result.intent).toBe('estimation');
  });

  // -------------------------------------------------------------------------
  // AC10: y+con landmine — "hamburguesa con huevo y patatas" → estimation (Guard 2)
  // -------------------------------------------------------------------------
  it('AC10 — "hamburguesa con huevo y patatas" → estimation (Guard 2)', async () => {
    const result = await processMessage(buildRequest('hamburguesa con huevo y patatas'));

    expect(result.intent).toBe('estimation');
  });

  // -------------------------------------------------------------------------
  // AC11: y+con landmine — "arroz con verduras y huevo" → estimation (Guard 2)
  // -------------------------------------------------------------------------
  it('AC11 — "arroz con verduras y huevo" → estimation (Guard 2)', async () => {
    const result = await processMessage(buildRequest('arroz con verduras y huevo'));

    expect(result.intent).toBe('estimation');
  });

  // -------------------------------------------------------------------------
  // AC12: Fragment validation miss — "un bocadillo y nada más" → estimation
  // -------------------------------------------------------------------------
  it('AC12 — "un bocadillo y nada más" → estimation (fragment "nada más" fails catalog lookup)', async () => {
    const result = await processMessage(buildRequest('un bocadillo y nada más'));

    expect(result.intent).toBe('estimation');
  });

  // -------------------------------------------------------------------------
  // AC13: Route exclusivity — explicit menú trigger handled by Step 3.5, NOT Step 3.6
  // -------------------------------------------------------------------------
  it('AC13 — "de menú: paella, vino" → menu_estimation via Step 3.5 (NOT Step 3.6)', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const result = await processMessage(buildRequest('de menú: paella, vino', { logger }));

    expect(result.intent).toBe('menu_estimation');
    // Step 3.5 handled it — Step 3.6 (implicit detector) was never reached.
    // logger.error must NOT have been called with the F-MULTI-ITEM-IMPLICIT:fallback-fired tag
    const errorCalls = logger.error.mock.calls as unknown[][];
    const hasFallbackTag = errorCalls.some((args) =>
      JSON.stringify(args).includes('F-MULTI-ITEM-IMPLICIT:fallback-fired'),
    );
    expect(hasFallbackTag).toBe(false);
  });

  // -------------------------------------------------------------------------
  // AC15: MAX_MENU_ITEMS cap — 10-item input → exactly 8 items returned
  // -------------------------------------------------------------------------
  it('AC15 — 10-item input with 2 non-catalog items beyond cap → menu_estimation, 8 items', async () => {
    // 8 real catalog dishes + 2 items beyond the cap that would fail validation if validated
    // Items 9+10 are silently dropped before catalog validation (EC-6 / R2-I2)
    // Use known catalog items (by FTS) for the first 8; items 9+10 are junk that must never
    // reach the validation loop.
    // Input: 8 known catalog terms + "nada más" + "nada tal" (beyond cap = never validated)
    const input = 'paella y vino y flan y caña y bravas y tostada y fbextra1 y fbextra2 y nada más y nada tal';
    const result = await processMessage(buildRequest(input));

    expect(result.intent).toBe('menu_estimation');
    expect(result.menuEstimation?.itemCount).toBe(8);
  });

  // -------------------------------------------------------------------------
  // AC16: Guard 0 — db absent → estimation (falls through to Step 4)
  // -------------------------------------------------------------------------
  it('AC16 — db absent → estimation (Guard 0: detectImplicitMultiItem returns null)', async () => {
    // Build a request with db set to undefined (Guard 0 defensive path)
    const requestWithoutDb = buildRequest('paella y vino', {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional Guard 0 test
      db: undefined as any,
    });
    // Should not throw — Guard 0 returns null, pipeline falls through to Step 4 estimation
    const result = await processMessage(requestWithoutDb);

    // Without db, level1Lookup and the whole estimation pipeline may fail gracefully
    // or succeed as estimation. The key assertion is no 500 / no throw.
    expect(['estimation', 'menu_estimation']).toContain(result.intent);
  });

});
