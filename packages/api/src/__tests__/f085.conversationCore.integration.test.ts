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

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

async function cleanFixtures(): Promise<void> {
  await prisma.dishNutrient.deleteMany({ where: { dishId: DISH_CROQUETAS } });
  await prisma.dish.deleteMany({ where: { id: DISH_CROQUETAS } });
  await prisma.restaurant.deleteMany({ where: { id: REST_ID } });
  await prisma.dataSource.deleteMany({ where: { id: SRC_ID } });
}

beforeAll(async () => {
  // Cascade mock: return DISH_CROQUETAS for any query containing 'croqueta'.
  // Cascade receives the post-F042/F078 stripped query; 'de croquetas' and
  // 'croquetas' both satisfy the includes check.
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

afterAll(async () => {
  await cleanFixtures();
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
