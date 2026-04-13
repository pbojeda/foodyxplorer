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

afterAll(async () => {
  await cleanFixtures();
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
    // prisma intentionally absent in Commit 1 — added in Commit 3 GREEN fix
    chainSlugs: ['fd-conv-core-test'],
    chains: [{ chainSlug: 'fd-conv-core-test', name: 'FD ConvCore Test Restaurant', nameEs: null }],
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
    it('media ración de croquetas → per_dish, term=media_racion', async () => {
      // F042 extracts multiplier=0.5 from 'media ración', which is also passed
      // to resolvePortionAssumption. Tier 2 applies racion×0.5×effectiveMultiplier.
      // Primary assertion: portionAssumption IS resolved (wiring fix verified).
      const result = await processMessage(buildRequest('media ración de croquetas'));

      expect(result.intent).toBe('estimation');
      const pa = result.estimation?.portionAssumption;
      expect(pa).toBeDefined();                        // ← RED: portionAssumption absent
      expect(pa?.source).toBe('per_dish');
      expect(pa?.term).toBe('media_racion');
      expect(pa?.termDisplay).toBe('media ración');
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
