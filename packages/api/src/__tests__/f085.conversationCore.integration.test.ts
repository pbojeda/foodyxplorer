// F085 portionSizing conversation wiring integration test — BUG-PROD-006
//
// Exercises the full processMessage() → extractFoodQuery → estimate →
// enrichWithPortionSizing chain to verify that the pre-F078 originalQuery is
// used for F085 portion term detection (Bug 2 fix).
//
// Bug 2: enrichWithPortionSizing was called with the F078-stripped query
// ('croquetas' for 'tapa de croquetas'), causing portionSizing to always be
// null for terms that F078 strips (tapa, pincho, pintxo, ración, media ración).
//
// ADR-021: Integration tests MUST call processMessage(), not the orchestrator
// or portionSizing functions directly.
//
// Mock strategy (identical to f-ux-b.conversationCore.integration.test.ts):
//   - contextManager  → getContext() returns null
//   - lib/cache       → cacheGet() returns null / cacheSet() no-ops
//   - engineRouter    → runEstimationCascade() returns controlled dish fixture
//
// RED state (Commit 2): Bug 2 not yet fixed — portionSizing null for F078-stripped terms.
// GREEN state (Commit 3): originalQuery threaded → portionSizing correctly populated.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock references
// ---------------------------------------------------------------------------

const { mockCascade } = vi.hoisted(() => ({
  mockCascade: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
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
// Imports
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
// prisma is needed for DB cleanup only; no standardPortions seeded in F085 tests.
const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL_TEST } } });

// ---------------------------------------------------------------------------
// Fixture IDs — fc000000-00fc- prefix (independent from f-ux-b test fixtures)
// ---------------------------------------------------------------------------

const SRC_ID        = 'fc000000-00fc-4000-a000-000000000001';
const REST_ID       = 'fc000000-00fc-4000-a000-000000000002';
const DISH_CROQUETAS = 'fc000000-00fc-4000-a000-000000000003';
const DN_CROQUETAS   = 'fc000000-00fc-4000-a000-000000000004';

const ACTOR_ID = 'fc000000-00fc-4000-a000-000000000099';

// ---------------------------------------------------------------------------
// BUG-PROD-007 extension — ff000000-00ff- prefix (independent fixture space)
// ---------------------------------------------------------------------------

const FF_SRC_ID         = 'ff000000-00ff-4000-a000-000000000001';
const FF_REST_ID        = 'ff000000-00ff-4000-a000-000000000002';
const FF_DISH_CROQUETAS = 'ff000000-00ff-4000-a000-000000000003';
const FF_DN_CROQUETAS   = 'ff000000-00ff-4000-a000-000000000004';
const FF_DISH_TORTILLA  = 'ff000000-00ff-4000-a000-000000000005';
const FF_DN_TORTILLA    = 'ff000000-00ff-4000-a000-000000000006';
const FF_DISH_PAELLA    = 'ff000000-00ff-4000-a000-000000000007';
const FF_DN_PAELLA      = 'ff000000-00ff-4000-a000-000000000008';
const FF_ACTOR_ID       = 'ff000000-00ff-4000-a000-000000000099';

// ---------------------------------------------------------------------------
// Cascade mock helpers
// ---------------------------------------------------------------------------

const MOCK_NUTRIENTS = {
  calories: 400, proteins: 14, carbohydrates: 30, sugars: 1,
  fats: 24, saturatedFats: 8, fiber: 1, salt: 1.2, sodium: 480,
  transFats: 0, cholesterol: 0, potassium: 0,
  monounsaturatedFats: 0, polyunsaturatedFats: 0, alcohol: 0,
  referenceBasis: 'per_serving' as const,
};

function makeDishResult(entityId: string): EstimateResult {
  return {
    entityType: 'dish',
    entityId,
    name: 'Croquetas de jamón',
    nameEs: 'Croquetas de jamón',
    restaurantId: REST_ID,
    chainSlug: 'fc-conv-core-test',
    portionGrams: 200,
    nutrients: MOCK_NUTRIENTS,
    confidenceLevel: 'high',
    estimationMethod: 'official',
    source: { id: SRC_ID, name: 'FC-ConvCore-Test-Src', type: 'official', url: 'https://example.com' },
    similarityDistance: null,
  };
}

// BUG-PROD-007: FF-prefix dish result factory
function makeDishResultFF(
  entityId: string,
  name: string,
  chainSlug: string,
  restaurantId: string,
  sourceId: string,
): EstimateResult {
  return {
    entityType: 'dish',
    entityId,
    name,
    nameEs: name,
    restaurantId,
    chainSlug,
    portionGrams: 200,
    nutrients: MOCK_NUTRIENTS,
    confidenceLevel: 'high',
    estimationMethod: 'official',
    source: { id: sourceId, name: 'FF-ConvCore-Test-Src', type: 'official', url: 'https://example.com' },
    similarityDistance: null,
  };
}

const UNKNOWN_SENTINEL = 'plato-desconocido-xyz';

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

async function cleanFixtures(): Promise<void> {
  await prisma.dishNutrient.deleteMany({ where: { dishId: DISH_CROQUETAS } });
  await prisma.dish.deleteMany({ where: { id: DISH_CROQUETAS } });
  await prisma.restaurant.deleteMany({ where: { id: REST_ID } });
  await prisma.dataSource.deleteMany({ where: { id: SRC_ID } });
}

async function cleanFixturesFF(): Promise<void> {
  // FK-safe reverse order: dishNutrient → dish → restaurant → dataSource
  await prisma.dishNutrient.deleteMany({
    where: { dishId: { in: [FF_DISH_CROQUETAS, FF_DISH_TORTILLA, FF_DISH_PAELLA] } },
  });
  await prisma.dish.deleteMany({
    where: { id: { in: [FF_DISH_CROQUETAS, FF_DISH_TORTILLA, FF_DISH_PAELLA] } },
  });
  await prisma.restaurant.deleteMany({ where: { id: FF_REST_ID } });
  await prisma.dataSource.deleteMany({ where: { id: FF_SRC_ID } });
}

beforeAll(async () => {
  // Cascade mock: return fc-fixture for single-dish queries (croquetas/bocadillo/jamón).
  // This is the BUG-PROD-006 / F085 fixture set for solo-dish tests.
  mockCascade.mockImplementation(async (opts: { query: string }) => {
    const q = opts.query.toLowerCase();
    if (q.includes('croqueta') || q.includes('bocadillo') || q.includes('jamón') || q.includes('jamon')) {
      return {
        levelHit: 1,
        data: {
          query: opts.query,
          chainSlug: null,
          level1Hit: true,
          level2Hit: false,
          level3Hit: false,
          level4Hit: false,
          matchType: 'exact_dish',
          result: makeDishResult(DISH_CROQUETAS),
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
    data: { id: SRC_ID, name: 'FC-ConvCore-Test-Src', type: 'official' },
  });

  await prisma.restaurant.create({
    data: {
      id: REST_ID,
      name: 'FC ConvCore Test Restaurant',
      chainSlug: 'fc-conv-core-test',
    },
  });

  await prisma.dish.create({
    data: {
      id: DISH_CROQUETAS,
      name: 'Croquetas de jamón',
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
      id: DN_CROQUETAS,
      dishId: DISH_CROQUETAS,
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
  // Note: no standardPortion rows — F085 tests don't need Prisma-backed portion lookups.
});

// BUG-PROD-007: second lifecycle pair for FF_* fixtures (comparison + menu path tests).
// Overrides mockCascade with a multi-dish router for FF fixtures, including the
// AC8 sentinel path that forces a rejected promise.
beforeAll(async () => {
  mockCascade.mockImplementation(async (opts: { query: string }) => {
    const q = opts.query.toLowerCase();

    // AC8: force rejection for the sentinel — Promise.allSettled captures 'rejected'
    // and the comparison code builds nullEstimateData for this side.
    if (q.includes(UNKNOWN_SENTINEL)) {
      throw new Error(`mockCascade: no match for sentinel ${UNKNOWN_SENTINEL}`);
    }

    if (q.includes('croqueta') || q.includes('bocadillo') || q.includes('jamón') || q.includes('jamon')) {
      return {
        levelHit: 1,
        data: {
          query: opts.query, chainSlug: null,
          level1Hit: true, level2Hit: false, level3Hit: false, level4Hit: false,
          matchType: 'exact_dish',
          result: makeDishResultFF(FF_DISH_CROQUETAS, 'Croquetas de jamón', 'ff-conv-core-test', FF_REST_ID, FF_SRC_ID),
          cachedAt: null, yieldAdjustment: null,
        },
      };
    }
    if (q.includes('tortilla')) {
      return {
        levelHit: 1,
        data: {
          query: opts.query, chainSlug: null,
          level1Hit: true, level2Hit: false, level3Hit: false, level4Hit: false,
          matchType: 'exact_dish',
          result: makeDishResultFF(FF_DISH_TORTILLA, 'Tortilla española', 'ff-conv-core-test', FF_REST_ID, FF_SRC_ID),
          cachedAt: null, yieldAdjustment: null,
        },
      };
    }
    if (q.includes('paella')) {
      return {
        levelHit: 1,
        data: {
          query: opts.query, chainSlug: null,
          level1Hit: true, level2Hit: false, level3Hit: false, level4Hit: false,
          matchType: 'exact_dish',
          result: makeDishResultFF(FF_DISH_PAELLA, 'Paella valenciana', 'ff-conv-core-test', FF_REST_ID, FF_SRC_ID),
          cachedAt: null, yieldAdjustment: null,
        },
      };
    }

    // Fulfilled miss (no dish found) — NOT the AC8 throw path
    return {
      levelHit: null,
      data: {
        query: opts.query, chainSlug: null,
        level1Hit: false, level2Hit: false, level3Hit: false, level4Hit: false,
        matchType: null, result: null, cachedAt: null,
      },
    };
  });

  await cleanFixturesFF();

  await prisma.dataSource.create({
    data: { id: FF_SRC_ID, name: 'FF-ConvCore-Test-Src', type: 'official' },
  });

  await prisma.restaurant.create({
    data: { id: FF_REST_ID, name: 'FF ConvCore Test Restaurant', chainSlug: 'ff-conv-core-test' },
  });

  const dishData = [
    { id: FF_DISH_CROQUETAS, dnId: FF_DN_CROQUETAS, name: 'Croquetas de jamón' },
    { id: FF_DISH_TORTILLA, dnId: FF_DN_TORTILLA, name: 'Tortilla española' },
    { id: FF_DISH_PAELLA, dnId: FF_DN_PAELLA, name: 'Paella valenciana' },
  ];

  for (const d of dishData) {
    await prisma.dish.create({
      data: {
        id: d.id, name: d.name, nameEs: d.name, nameSourceLocale: 'es',
        restaurantId: FF_REST_ID, sourceId: FF_SRC_ID,
        confidenceLevel: 'high', estimationMethod: 'scraped', availability: 'available',
      },
    });
    await prisma.dishNutrient.create({
      data: {
        id: d.dnId, dishId: d.id, sourceId: FF_SRC_ID,
        confidenceLevel: 'high', estimationMethod: 'scraped',
        calories: 300, proteins: 10, carbohydrates: 20, sugars: 1,
        fats: 15, saturatedFats: 4, fiber: 1, salt: 0.8, sodium: 320,
        referenceBasis: 'per_serving',
      },
    });
  }
  // Note: no standardPortion rows for FF fixtures — F085 portionSizing uses a static lookup table.
});

// First afterAll — cleans FC_* fixtures only (data teardown, no disconnect)
afterAll(async () => {
  await cleanFixtures();
});

// Second afterAll — cleans FF_* fixtures only (data teardown, no disconnect)
afterAll(async () => {
  await cleanFixturesFF();
});

// Module-level afterAll — single disconnect point, runs AFTER both data cleanups
afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function buildRequest(text: string): ConversationRequest {
  return {
    text,
    actorId: ACTOR_ID,
    db,
    redis: {} as ConversationRequest['redis'],
    prisma,
    chainSlugs: ['fc-conv-core-test'],
    chains: [{ chainSlug: 'fc-conv-core-test', name: 'FC ConvCore Test Restaurant', nameEs: null }],
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  };
}

function buildRequestFF(text: string): ConversationRequest {
  return {
    text,
    actorId: FF_ACTOR_ID,
    db,
    redis: {} as ConversationRequest['redis'],
    prisma,
    chainSlugs: ['ff-conv-core-test'],
    chains: [{ chainSlug: 'ff-conv-core-test', name: 'FF ConvCore Test Restaurant', nameEs: null }],
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F085 BUG-PROD-006 — portionSizing via processMessage() (ADR-021)', () => {

  describe('RED cases — F078 strips the term before Bug 2 fix', () => {
    // These tests FAIL in Commit 2 (enrichWithPortionSizing receives stripped query 'croquetas')
    // and PASS after Commit 3 (originalQuery 'tapa de croquetas' is used).

    it('tapa de croquetas → portionSizing.term = tapa', async () => {
      const result = await processMessage(buildRequest('tapa de croquetas'));

      expect(result.intent).toBe('estimation');
      const ps = result.estimation?.portionSizing;
      expect(ps).toBeDefined();                        // ← RED: portionSizing absent
      expect(ps?.term).toBe('tapa');
      expect(ps?.gramsMin).toBe(50);
      expect(ps?.gramsMax).toBe(80);
    });

    it('TAPA DE CROQUETAS (uppercase) → portionSizing.term = tapa', async () => {
      // F078 strips 'TAPA DE' (case-insensitive), cascade receives 'CROQUETAS'.
      // After fix: enrichWithPortionSizing('TAPA DE CROQUETAS') → detects 'tapa'.
      const result = await processMessage(buildRequest('TAPA DE CROQUETAS'));

      expect(result.intent).toBe('estimation');
      const ps = result.estimation?.portionSizing;
      expect(ps).toBeDefined();
      expect(ps?.term).toBe('tapa');
      expect(ps?.gramsMin).toBe(50);
      expect(ps?.gramsMax).toBe(80);
    });
  });

  describe('Control cases — F078 does NOT strip the term (should pass in both RED and GREEN)', () => {
    // bocadillo de jamón is NOT in F078 SERVING_FORMAT_PATTERNS,
    // so it arrives at enrichWithPortionSizing intact in both RED and GREEN.

    it('bocadillo de jamón → portionSizing.term = bocadillo (F085 works, F078 does not strip)', async () => {
      const result = await processMessage(buildRequest('bocadillo de jamón'));

      expect(result.intent).toBe('estimation');
      const ps = result.estimation?.portionSizing;
      expect(ps).toBeDefined();
      expect(ps?.term).toBe('bocadillo');
    });

    it('ración para compartir de croquetas → portionSizing.term = ración para compartir', async () => {
      // F078 pattern /^raci[oó]n\s+de\s+/ does NOT match 'ración para compartir de',
      // so the full query reaches enrichWithPortionSizing intact.
      const result = await processMessage(buildRequest('ración para compartir de croquetas'));

      expect(result.intent).toBe('estimation');
      const ps = result.estimation?.portionSizing;
      expect(ps).toBeDefined();
      expect(ps?.term).toBe('ración para compartir');
    });
  });

  describe('No portion term', () => {
    it('croquetas (no portion term) → portionSizing absent', async () => {
      const result = await processMessage(buildRequest('croquetas'));

      expect(result.intent).toBe('estimation');
      expect(result.estimation?.portionSizing).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// BUG-PROD-007 — comparison path (RED until Commit 3 patches conversationCore.ts)
// ---------------------------------------------------------------------------

describe('BUG-PROD-007 — comparison path', () => {
  it('AC1 — dishA portionSizing tapa (compara tapa de croquetas vs tapa de tortilla)', async () => {
    const result = await processMessage(buildRequestFF('compara tapa de croquetas vs tapa de tortilla'));

    expect(result.intent).toBe('comparison');
    const dishA = result.comparison?.dishA;
    expect(dishA).toBeDefined();
    expect(dishA?.portionSizing).toBeDefined();           // ← RED: portionSizing absent until fix
    expect(dishA?.portionSizing?.term).toBe('tapa');
    expect(dishA?.portionSizing?.gramsMin).toBeDefined();
    expect(dishA?.portionSizing?.gramsMax).toBeDefined();
  });

  it('AC2 — dishB portionSizing tapa (compara tapa de croquetas vs tapa de tortilla)', async () => {
    const result = await processMessage(buildRequestFF('compara tapa de croquetas vs tapa de tortilla'));

    expect(result.intent).toBe('comparison');
    const dishB = result.comparison?.dishB;
    expect(dishB).toBeDefined();
    expect(dishB?.portionSizing).toBeDefined();           // ← RED: portionSizing absent until fix
    expect(dishB?.portionSizing?.term).toBe('tapa');
  });

  it('AC8 — rejected side hits nullEstimateData fallback (sentinel throws)', async () => {
    // Mock throws for 'plato-desconocido-xyz' → Promise.allSettled captures 'rejected'
    // → conversationCore builds nullEstimateData for dishB → portionSizing absent.
    const result = await processMessage(
      buildRequestFF('compara tapa de croquetas vs plato-desconocido-xyz'),
    );

    expect(result.intent).toBe('comparison');
    const dishA = result.comparison?.dishA;
    const dishB = result.comparison?.dishB;

    // dishA (fulfilled, valid): portionSizing defined after fix
    expect(dishA?.portionSizing).toBeDefined();           // ← RED until fix
    expect(dishA?.portionSizing?.term).toBe('tapa');

    // dishB (rejected → nullEstimateData): portionSizing and portionAssumption absent
    expect(dishB?.portionSizing).toBeUndefined();
    expect(dishB?.portionAssumption).toBeUndefined();
  });

  it('Control — bocadillo not stripped by F078 (already GREEN)', async () => {
    // bocadillo is NOT in F078 SERVING_FORMAT_PATTERNS — originalQuery wiring not needed
    // for this assertion to pass. Should be GREEN even in RED state.
    const result = await processMessage(
      buildRequestFF('compara bocadillo de jamón vs tapa de croquetas'),
    );

    expect(result.intent).toBe('comparison');
    const dishA = result.comparison?.dishA;
    expect(dishA?.portionSizing).toBeDefined();
    expect(dishA?.portionSizing?.term).toBe('bocadillo');
  });
});

// ---------------------------------------------------------------------------
// BUG-PROD-007 — menu path (RED until Commit 4 patches conversationCore.ts)
// ---------------------------------------------------------------------------

describe('BUG-PROD-007 — menu path', () => {
  it('AC6 — both menu items have portionSizing defined', async () => {
    // menú del día: X, Y form → clean splitMenuItems slices (colon + comma)
    const result = await processMessage(
      buildRequestFF('menú del día: tapa de croquetas, media ración de paella'),
    );

    expect(result.intent).toBe('menu_estimation');
    const items = result.menuEstimation?.items;
    expect(items).toBeDefined();
    expect(items?.length).toBeGreaterThanOrEqual(2);

    // item[0]: tapa de croquetas → portionSizing.term = 'tapa'
    expect(items?.[0]?.estimation.portionSizing).toBeDefined(); // ← RED until fix
    expect(items?.[0]?.estimation.portionSizing?.term).toBe('tapa');

    // item[1]: media ración de paella → portionSizing.term = 'media ración'
    // (F085 compound match: 'media ración' matches before the plain 'ración' rule)
    // Spec AC6 says 'ración' but actual F085 static lookup returns 'media ración'.
    expect(items?.[1]?.estimation.portionSizing).toBeDefined(); // ← RED until fix
    expect(items?.[1]?.estimation.portionSizing?.term).toBe('media ración');
  });

  it('Control — bocadillo menu item (already GREEN)', async () => {
    // bocadillo not in F078 — portionSizing present regardless of originalQuery wiring
    const result = await processMessage(
      buildRequestFF('menú del día: bocadillo de jamón, croquetas'),
    );

    expect(result.intent).toBe('menu_estimation');
    const items = result.menuEstimation?.items;
    expect(items).toBeDefined();
    expect(items?.[0]?.estimation.portionSizing).toBeDefined();
    expect(items?.[0]?.estimation.portionSizing?.term).toBe('bocadillo');
  });
});
