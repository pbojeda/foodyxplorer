// F-UX-B conversation wiring integration test — BUG-PROD-006
//
// Exercises the full processMessage() → extractFoodQuery → estimate →
// detectPortionTerm → resolvePortionAssumption chain to verify that:
//   (1) prisma is threaded through ConversationRequest (Bug 1 fix)
//   (2) the pre-F042/F078 originalQuery is used for portion detection (Bug 2 fix)
//
// ADR-021: Integration tests MUST call processMessage(), not resolvePortionAssumption()
// directly, to catch wiring regressions like BUG-PROD-006.
//
// Mock strategy:
//   - contextManager  → getContext() returns null (no Redis needed)
//   - lib/cache       → cacheGet() returns null / cacheSet() no-ops (no Redis needed)
//   - engineRouter    → runEstimationCascade() returns controlled dish fixture
//   - Everything else → REAL code (portionSizing, portionAssumption, entityExtractor)
//
// RED state (Commit 1): buildRequest() lacks prisma (not yet in ConversationRequest).
//   All portionAssumption assertions FAIL — orchestrator skips resolution entirely.
// GREEN state (Commit 3): prisma + originalQuery wired → portionAssumption resolved.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock references (must be before vi.mock calls)
// ---------------------------------------------------------------------------

const { mockCascade, mockCacheSet } = vi.hoisted(() => ({
  mockCascade: vi.fn(),
  mockCacheSet: vi.fn().mockResolvedValue(undefined),
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
  cacheSet: mockCacheSet,
}));

vi.mock('../estimation/engineRouter.js', () => ({
  runEstimationCascade: mockCascade,
}));

// ---------------------------------------------------------------------------
// Imports (after vi.mock declarations)
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
// DB clients (module-level for shared use across test + beforeAll/afterAll)
// ---------------------------------------------------------------------------

const pool = new Pool({ connectionString: DATABASE_URL_TEST });
const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL_TEST } } });

// ---------------------------------------------------------------------------
// Fixture IDs — fd000000-00fd- prefix to avoid collision with other test files
// ---------------------------------------------------------------------------

const SRC_ID   = 'fd000000-00fd-4000-a000-000000000001';
const REST_ID  = 'fd000000-00fd-4000-a000-000000000002';
// Croquetas dish — seeded with tapa (50g/2pc) and racion (200g/8pc) rows
const DISH_CROQUETAS = 'fd000000-00fd-4000-a000-000000000003';
const DN_CROQUETAS   = 'fd000000-00fd-4000-a000-000000000004';

const ACTOR_ID = 'fd000000-00fd-4000-a000-000000000099';

// ---------------------------------------------------------------------------
// BUG-PROD-007 extension — fe000000-00fe- prefix (independent fixture space)
// ---------------------------------------------------------------------------

const FE_SRC_ID         = 'fe000000-00fe-4000-a000-000000000001';
const FE_REST_ID        = 'fe000000-00fe-4000-a000-000000000002';
const FE_DISH_CROQUETAS = 'fe000000-00fe-4000-a000-000000000003';
const FE_DN_CROQUETAS   = 'fe000000-00fe-4000-a000-000000000004';
const FE_DISH_TORTILLA  = 'fe000000-00fe-4000-a000-000000000005';
const FE_DN_TORTILLA    = 'fe000000-00fe-4000-a000-000000000006';
const FE_DISH_PAELLA    = 'fe000000-00fe-4000-a000-000000000007';
const FE_DN_PAELLA      = 'fe000000-00fe-4000-a000-000000000008';
const FE_ACTOR_ID       = 'fe000000-00fe-4000-a000-000000000099';

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
    chainSlug: 'fd-conv-core-test',
    portionGrams: 200,
    nutrients: MOCK_NUTRIENTS,
    confidenceLevel: 'high',
    estimationMethod: 'official',
    source: { id: SRC_ID, name: 'FD-ConvCore-Test-Src', type: 'official', url: 'https://example.com' },
    similarityDistance: null,
  };
}

// BUG-PROD-007: FE-prefix dish result factory (multi-dish comparison/menu tests)
function makeDishResultFE(
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
    source: { id: sourceId, name: 'FE-ConvCore-Test-Src', type: 'official', url: 'https://example.com' },
    similarityDistance: null,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

async function cleanFixtures(): Promise<void> {
  await prisma.standardPortion.deleteMany({ where: { dishId: DISH_CROQUETAS } });
  await prisma.dishNutrient.deleteMany({ where: { dishId: DISH_CROQUETAS } });
  await prisma.dish.deleteMany({ where: { id: DISH_CROQUETAS } });
  await prisma.restaurant.deleteMany({ where: { id: REST_ID } });
  await prisma.dataSource.deleteMany({ where: { id: SRC_ID } });
}

async function cleanFixturesFE(): Promise<void> {
  // FK-safe reverse order: standardPortion → dishNutrient → dish → restaurant → dataSource
  await prisma.standardPortion.deleteMany({
    where: { dishId: { in: [FE_DISH_CROQUETAS, FE_DISH_TORTILLA, FE_DISH_PAELLA] } },
  });
  await prisma.dishNutrient.deleteMany({
    where: { dishId: { in: [FE_DISH_CROQUETAS, FE_DISH_TORTILLA, FE_DISH_PAELLA] } },
  });
  await prisma.dish.deleteMany({
    where: { id: { in: [FE_DISH_CROQUETAS, FE_DISH_TORTILLA, FE_DISH_PAELLA] } },
  });
  await prisma.restaurant.deleteMany({ where: { id: FE_REST_ID } });
  await prisma.dataSource.deleteMany({ where: { id: FE_SRC_ID } });
}

beforeAll(async () => {
  // Configure cascade mock: return DISH_CROQUETAS when query contains 'croqueta',
  // null result otherwise. The query passed to the cascade is the post-F042/F078
  // stripped form, e.g. 'croquetas' for 'tapa de croquetas'.
  mockCascade.mockImplementation(async (opts: { query: string }) => {
    const q = opts.query.toLowerCase();
    if (q.includes('croqueta')) {
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
    // No match — portionAssumption will be absent (dishId = null)
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
    data: { id: SRC_ID, name: 'FD-ConvCore-Test-Src', type: 'official' },
  });

  await prisma.restaurant.create({
    data: {
      id: REST_ID,
      name: 'FD ConvCore Test Restaurant',
      chainSlug: 'fd-conv-core-test',
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

  // Tier 1 tapa row: 50g, 2 pieces
  await prisma.standardPortion.create({
    data: {
      dishId: DISH_CROQUETAS,
      term: 'tapa',
      grams: 50,
      pieces: 2,
      pieceName: 'croquetas',
      confidence: 'high',
      notes: 'BUG-PROD-006 integration test fixture',
    },
  });

  // Tier 1 / Tier 2 ración row: 200g, 8 pieces
  await prisma.standardPortion.create({
    data: {
      dishId: DISH_CROQUETAS,
      term: 'racion',
      grams: 200,
      pieces: 8,
      pieceName: 'croquetas',
      confidence: 'high',
      notes: 'BUG-PROD-006 integration test fixture',
    },
  });
});

// BUG-PROD-007: second lifecycle pair for FE_* fixtures (comparison + menu path tests).
// Overrides mockCascade with a multi-dish router for FE fixtures (croquetas/tortilla/paella).
beforeAll(async () => {
  mockCascade.mockImplementation(async (opts: { query: string }) => {
    const q = opts.query.toLowerCase();

    if (q.includes('croqueta')) {
      return {
        levelHit: 1,
        data: {
          query: opts.query, chainSlug: null,
          level1Hit: true, level2Hit: false, level3Hit: false, level4Hit: false,
          matchType: 'exact_dish',
          result: makeDishResultFE(FE_DISH_CROQUETAS, 'Croquetas de jamón', 'fe-conv-core-test', FE_REST_ID, FE_SRC_ID),
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
          result: makeDishResultFE(FE_DISH_TORTILLA, 'Tortilla española', 'fe-conv-core-test', FE_REST_ID, FE_SRC_ID),
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
          result: makeDishResultFE(FE_DISH_PAELLA, 'Paella valenciana', 'fe-conv-core-test', FE_REST_ID, FE_SRC_ID),
          cachedAt: null, yieldAdjustment: null,
        },
      };
    }

    // Fulfilled miss (no dish found)
    return {
      levelHit: null,
      data: {
        query: opts.query, chainSlug: null,
        level1Hit: false, level2Hit: false, level3Hit: false, level4Hit: false,
        matchType: null, result: null, cachedAt: null,
      },
    };
  });

  await cleanFixturesFE();

  await prisma.dataSource.create({
    data: { id: FE_SRC_ID, name: 'FE-ConvCore-Test-Src', type: 'official' },
  });

  await prisma.restaurant.create({
    data: { id: FE_REST_ID, name: 'FE ConvCore Test Restaurant', chainSlug: 'fe-conv-core-test' },
  });

  const dishData = [
    { id: FE_DISH_CROQUETAS, dnId: FE_DN_CROQUETAS, name: 'Croquetas de jamón' },
    { id: FE_DISH_TORTILLA, dnId: FE_DN_TORTILLA, name: 'Tortilla española' },
    { id: FE_DISH_PAELLA, dnId: FE_DN_PAELLA, name: 'Paella valenciana' },
  ];

  for (const d of dishData) {
    await prisma.dish.create({
      data: {
        id: d.id, name: d.name, nameEs: d.name, nameSourceLocale: 'es',
        restaurantId: FE_REST_ID, sourceId: FE_SRC_ID,
        confidenceLevel: 'high', estimationMethod: 'scraped', availability: 'available',
      },
    });
    await prisma.dishNutrient.create({
      data: {
        id: d.dnId, dishId: d.id, sourceId: FE_SRC_ID,
        confidenceLevel: 'high', estimationMethod: 'scraped',
        calories: 300, proteins: 10, carbohydrates: 20, sugars: 1,
        fats: 15, saturatedFats: 4, fiber: 1, salt: 0.8, sodium: 320,
        referenceBasis: 'per_serving',
      },
    });
  }

  // standardPortion rows for FE fixtures (F-UX-B requires DB-backed portion lookups)
  // FE_DISH_CROQUETAS: tapa (50g/2pc) + racion (200g/8pc)
  await prisma.standardPortion.create({
    data: {
      dishId: FE_DISH_CROQUETAS, term: 'tapa', grams: 50, pieces: 2,
      pieceName: 'croquetas', confidence: 'high', notes: 'BUG-PROD-007 fixture',
    },
  });
  await prisma.standardPortion.create({
    data: {
      dishId: FE_DISH_CROQUETAS, term: 'racion', grams: 200, pieces: 8,
      pieceName: 'croquetas', confidence: 'high', notes: 'BUG-PROD-007 fixture',
    },
  });
  // FE_DISH_TORTILLA: tapa (60g/1pc) — distinct grams for concrete assertion
  await prisma.standardPortion.create({
    data: {
      dishId: FE_DISH_TORTILLA, term: 'tapa', grams: 60, pieces: 1,
      pieceName: 'porción', confidence: 'high', notes: 'BUG-PROD-007 fixture',
    },
  });
  // FE_DISH_PAELLA: racion (200g/null pieces) — Tier 2 media_racion × 0.5 = 100g
  await prisma.standardPortion.create({
    data: {
      dishId: FE_DISH_PAELLA, term: 'racion', grams: 200, pieces: null,
      pieceName: null, confidence: 'high', notes: 'BUG-PROD-007 fixture',
    },
  });
});

// First afterAll — cleans FD_* fixtures only (data teardown, no disconnect)
afterAll(async () => {
  await cleanFixtures();
});

// Second afterAll — cleans FE_* fixtures only (data teardown, no disconnect)
afterAll(async () => {
  await cleanFixturesFE();
});

// Module-level afterAll — single disconnect point, runs AFTER both data cleanups
afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

// ---------------------------------------------------------------------------
// Helper: build a minimal ConversationRequest
//
// RED state (Commit 1): prisma is NOT included — ConversationRequest does not
// have the field yet. This correctly produces the RED state: the orchestrator's
// `if (prisma !== undefined)` guard is always false, portionAssumption is never
// resolved.
//
// GREEN state (Commit 3): prisma is added here after types.ts is patched.
// ---------------------------------------------------------------------------

function buildRequest(text: string): ConversationRequest {
  return {
    text,
    actorId: ACTOR_ID,
    db,
    redis: {} as ConversationRequest['redis'],
    prisma,
    chainSlugs: ['fd-conv-core-test'],
    chains: [{ chainSlug: 'fd-conv-core-test', name: 'FD ConvCore Test Restaurant', nameEs: null }],
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  };
}

function buildRequestFE(text: string): ConversationRequest {
  return {
    text,
    actorId: FE_ACTOR_ID,
    db,
    redis: {} as ConversationRequest['redis'],
    prisma,
    chainSlugs: ['fe-conv-core-test'],
    chains: [{ chainSlug: 'fe-conv-core-test', name: 'FE ConvCore Test Restaurant', nameEs: null }],
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  };
}

// ---------------------------------------------------------------------------
// Tests — primary regression: portionAssumption via conversation path
// All RED in Commit 1 (prisma absent → portionAssumption never resolved).
// All GREEN in Commit 3 (prisma threaded + originalQuery used).
// ---------------------------------------------------------------------------

describe('F-UX-B BUG-PROD-006 — portionAssumption via processMessage() (ADR-021)', () => {

  describe('Tier 1 — exact DB lookup hit', () => {
    it('tapa de croquetas → per_dish, term=tapa, grams=50, pieces=2', async () => {
      const result = await processMessage(buildRequest('tapa de croquetas'));

      expect(result.intent).toBe('estimation');
      const pa = result.estimation?.portionAssumption;
      expect(pa).toBeDefined();                        // ← RED: portionAssumption absent
      expect(pa?.source).toBe('per_dish');
      expect(pa?.term).toBe('tapa');
      expect(pa?.termDisplay).toBe('tapa');
      expect(pa?.grams).toBe(50);
      expect(pa?.pieces).toBe(2);
      expect(pa?.pieceName).toBe('croquetas');
      expect(pa?.confidence).toBe('high');
      expect(pa?.gramsRange).toBeNull();
      expect(pa?.fallbackReason).toBeNull();
    });

    it('ración de croquetas → per_dish, term=racion, grams=200, pieces=8', async () => {
      const result = await processMessage(buildRequest('ración de croquetas'));

      expect(result.intent).toBe('estimation');
      const pa = result.estimation?.portionAssumption;
      expect(pa).toBeDefined();
      expect(pa?.source).toBe('per_dish');
      expect(pa?.term).toBe('racion');
      expect(pa?.termDisplay).toBe('ración');
      expect(pa?.grams).toBe(200);
      expect(pa?.pieces).toBe(8);
    });
  });

  describe('Tier 2 — media_racion arithmetic from ración row', () => {
    it('media ración de croquetas → per_dish, term=media_racion, grams=100, pieces=4', async () => {
      // Tier 2: racion row (200g/8pc) × 0.5 = 100g/4pc.
      // F042 extracts portionMultiplier=0.5 from 'media ración'; Tier 2 does NOT
      // further apply this multiplier (that would double-count the halving).
      const result = await processMessage(buildRequest('media ración de croquetas'));

      expect(result.intent).toBe('estimation');
      const pa = result.estimation?.portionAssumption;
      expect(pa).toBeDefined();
      expect(pa?.source).toBe('per_dish');
      expect(pa?.term).toBe('media_racion');
      expect(pa?.termDisplay).toBe('media ración');
      expect(pa?.grams).toBe(100);
      expect(pa?.pieces).toBe(4);
      expect(pa?.fallbackReason).toBeNull();
    });
  });

  describe('F042 × Tier 1 — size modifier + DB lookup', () => {
    it('ración grande de croquetas → per_dish, racion×1.5, grams=300, pieces=12', async () => {
      // F042 strips 'grande', portionMultiplier=1.5.
      // Tier 1 finds racion row (200g/8pc), scales by 1.5.
      const result = await processMessage(buildRequest('ración grande de croquetas'));

      expect(result.intent).toBe('estimation');
      const pa = result.estimation?.portionAssumption;
      expect(pa).toBeDefined();
      expect(pa?.source).toBe('per_dish');
      expect(pa?.term).toBe('racion');
      expect(pa?.grams).toBe(300);
      expect(pa?.pieces).toBe(12);
    });
  });

  describe('Case insensitivity — end-to-end', () => {
    it('TAPA DE CROQUETAS (uppercase) → same as lowercase tapa Tier 1', async () => {
      // F078 strips 'TAPA DE' (case-insensitive regex), cascade gets 'CROQUETAS'.
      // detectPortionTerm('TAPA DE CROQUETAS') → lowercases before matching → 'tapa'.
      const result = await processMessage(buildRequest('TAPA DE CROQUETAS'));

      expect(result.intent).toBe('estimation');
      const pa = result.estimation?.portionAssumption;
      expect(pa).toBeDefined();
      expect(pa?.source).toBe('per_dish');
      expect(pa?.term).toBe('tapa');
      expect(pa?.grams).toBe(50);
      expect(pa?.pieces).toBe(2);
    });
  });

  describe('No portionAssumption expected', () => {
    it('bocadillo de jamón → portionAssumption absent (cascade miss → dishId null)', async () => {
      // F078 does NOT strip 'bocadillo de'. Cascade receives 'bocadillo de jamón',
      // mock returns null result → dishId=null → resolvePortionAssumption returns {}.
      const result = await processMessage(buildRequest('bocadillo de jamón'));

      expect(result.intent).toBe('estimation');
      expect(result.estimation?.portionAssumption).toBeUndefined();
    });

    it('croquetas (no portion term) → portionAssumption absent', async () => {
      // Cascade returns DISH_CROQUETAS (dish found), but detectPortionTerm('croquetas')
      // returns null → resolvePortionAssumption returns {} immediately.
      const result = await processMessage(buildRequest('croquetas'));

      expect(result.intent).toBe('estimation');
      expect(result.estimation?.portionAssumption).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// BUG-PROD-007 — comparison path (RED until Commit 3 patches conversationCore.ts)
// ---------------------------------------------------------------------------

describe('BUG-PROD-007 — comparison path', () => {
  it('AC3 — dishA portionAssumption tapa/50g (compara tapa de croquetas vs tapa de tortilla)', async () => {
    const result = await processMessage(buildRequestFE('compara tapa de croquetas vs tapa de tortilla'));

    expect(result.intent).toBe('comparison');
    const pa = result.comparison?.dishA.portionAssumption;
    expect(pa).toBeDefined();                           // ← RED until fix
    expect(pa?.source).toBe('per_dish');
    expect(pa?.term).toBe('tapa');
    expect(pa?.grams).toBe(50);
  });

  it('AC4 — dishB portionAssumption tapa/60g (compara tapa de croquetas vs tapa de tortilla)', async () => {
    const result = await processMessage(buildRequestFE('compara tapa de croquetas vs tapa de tortilla'));

    expect(result.intent).toBe('comparison');
    const pa = result.comparison?.dishB.portionAssumption;
    expect(pa).toBeDefined();                           // ← RED until fix
    expect(pa?.source).toBe('per_dish');
    expect(pa?.term).toBe('tapa');
    expect(pa?.grams).toBe(60);
  });

  it('AC5 — mixed terms per side: pintxo vs racion (compara pincho de tortilla vs ración de croquetas)', async () => {
    const result = await processMessage(buildRequestFE('compara pincho de tortilla vs ración de croquetas'));

    expect(result.intent).toBe('comparison');
    // dishA: 'pincho de tortilla' → canonicalized to 'pintxo'
    expect(result.comparison?.dishA.portionAssumption?.term).toBe('pintxo'); // ← RED until fix
    // dishB: 'ración de croquetas' → 'racion'
    expect(result.comparison?.dishB.portionAssumption?.term).toBe('racion'); // ← RED until fix
  });
});

// ---------------------------------------------------------------------------
// BUG-PROD-007 — menu path (RED until Commit 4 patches conversationCore.ts)
// ---------------------------------------------------------------------------

describe('BUG-PROD-007 — menu path', () => {
  it('AC7 — both items: tapa + media_racion Tier 2 (menú del día: tapa de croquetas, media ración de paella)', async () => {
    // menú del día: X, Y form (colon + comma) → clean splitMenuItems slices
    const result = await processMessage(
      buildRequestFE('menú del día: tapa de croquetas, media ración de paella'),
    );

    expect(result.intent).toBe('menu_estimation');
    const items = result.menuEstimation?.items;
    expect(items).toBeDefined();
    expect(items?.length).toBeGreaterThanOrEqual(2);

    // item[0]: tapa de croquetas → portionAssumption tapa/50g (FE_DISH_CROQUETAS standardPortion)
    const pa0 = items?.[0]?.estimation.portionAssumption;
    expect(pa0).toBeDefined();                          // ← RED until fix
    expect(pa0?.term).toBe('tapa');

    // item[1]: media ración de paella → Tier 2 media_racion × 0.5 = 100g
    const pa1 = items?.[1]?.estimation.portionAssumption;
    expect(pa1).toBeDefined();                          // ← RED until fix
    expect(pa1?.term).toBe('media_racion');
    expect(pa1?.grams).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// BUG-PROD-007 — solo-path regression guards (GREEN from start — AC9/AC10/AC11)
//
// These tests assert behaviors that BUG-PROD-006 already established via the
// solo-dish estimate() call at conversationCore.ts:356-367 (originalQuery: trimmed).
// They MUST be GREEN the moment they are committed — a RED result signals a prior
// regression, NOT work this ticket should fix.
// Uses existing fd- fixtures and buildRequest() (solo-dish path only).
// ---------------------------------------------------------------------------

describe('BUG-PROD-007 — solo-path regression guards', () => {
  it('AC9 — pintxo de croquetas → portionAssumption.term === pintxo (canonical)', async () => {
    // pintxo is the canonical stored term; detectPortionTerm handles 'pintxo' directly
    const result = await processMessage(buildRequest('pintxo de croquetas'));

    expect(result.intent).toBe('estimation');
    expect(result.estimation?.portionAssumption?.term).toBe('pintxo');
  });

  it('AC10 — pincho de croquetas → portionAssumption.term === pintxo (alias canonicalization)', async () => {
    // 'pincho' is an alias — detectPortionTerm maps it to canonical 'pintxo'
    const result = await processMessage(buildRequest('pincho de croquetas'));

    expect(result.intent).toBe('estimation');
    expect(result.estimation?.portionAssumption?.term).toBe('pintxo');
  });

  it('AC11 — media ración grande de croquetas → portionAssumption.grams === 100 (F042 compound wins, grande dropped)', async () => {
    // F042 matches 'media ración' compound first; 'grande' modifier is silently dropped.
    // Tier 2: racion row (200g) × 0.5 = 100g. Accepted behavior per spec.
    const result = await processMessage(buildRequest('media ración grande de croquetas'));

    expect(result.intent).toBe('estimation');
    expect(result.estimation?.portionAssumption?.grams).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// BUG-PROD-007 — cache key regression guard (GREEN from start — AC12)
//
// Spies on the mocked lib/cache.cacheSet to confirm that 'tapa de croquetas'
// and 'croquetas' produce DIFFERENT cache keys thanks to portionKeySuffix
// (estimationOrchestrator.ts:92-98). This test is GREEN immediately; a RED
// result means the portionKeySuffix logic in the orchestrator has regressed.
// Uses buildRequestFE() so the FE_DISH_CROQUETAS cascade route handles both queries.
// ---------------------------------------------------------------------------

describe('BUG-PROD-007 — cache key regression guard', () => {
  it('AC12 — portion-aware cache key disambiguation (tapa de croquetas vs croquetas)', async () => {
    // Load-bearing: mockCacheSet accumulates calls across the whole file (15 prior
    // tests). This clear is mandatory — the toHaveBeenCalledTimes(2) assertion below
    // counts only this test's two processMessage() invocations.
    mockCacheSet.mockClear();

    // First call: 'tapa de croquetas' — portionKeySuffix appended (portionDetectionQuery differs)
    await processMessage(buildRequestFE('tapa de croquetas'));
    // Second call: 'croquetas' — no portionKeySuffix (query === portionDetectionQuery)
    await processMessage(buildRequestFE('croquetas'));

    expect(mockCacheSet).toHaveBeenCalledTimes(2);

    const keyFirst = mockCacheSet.mock.calls[0]?.[0] as string;
    const keySecond = mockCacheSet.mock.calls[1]?.[0] as string;

    // Keys must differ — portionKeySuffix distinguishes them
    expect(keyFirst).not.toBe(keySecond);
    // First key includes the normalized 'tapa de croquetas' suffix
    expect(keyFirst).toContain('tapa de croquetas');
    // Second key does NOT contain the 'tapa de croquetas' suffix
    expect(keySecond).not.toContain('tapa de croquetas');
  });
});
