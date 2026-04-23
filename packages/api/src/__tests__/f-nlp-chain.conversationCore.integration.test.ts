// F-NLP-CHAIN-ORDERING — Integration tests via processMessage() (AC12)
//
// Exercises the full processMessage() → extractFoodQuery → extractPortionModifier chain
// to verify that H5-A ordering bug is fixed: extractFoodQuery must run BEFORE
// extractPortionModifier so the count is extracted from wrapper-stripped text.
//
// ADR-021: Integration tests MUST call processMessage(), not the helpers directly.
//
// Mock strategy (identical to f085.conversationCore.integration.test.ts):
//   - contextManager  → getContext() returns null
//   - lib/cache       → cacheGet() returns null / cacheSet() no-ops
//   - engineRouter    → runEstimationCascade() returns controlled dish fixture
//
// RED state (before production changes):
//   - AC1: portionMultiplier = 1 (wrapper not stripped before count extraction)
//   - AC3: portionMultiplier = 1 (same)
//   - AC4: portionMultiplier = 1 AND cascade called with "platos de paella"
//   AC8, AC9, AC11: regression guards — GREEN immediately

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
const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL_TEST } } });

// ---------------------------------------------------------------------------
// Fixture IDs — fa000000-00fa- prefix (independent from fc/ff prefixes)
// ---------------------------------------------------------------------------

const FA_SRC_ID       = 'fa000000-00fa-4000-a000-000000000001';
const FA_REST_ID      = 'fa000000-00fa-4000-a000-000000000002';
const FA_DISH_CANA    = 'fa000000-00fa-4000-a000-000000000003';
const FA_DN_CANA      = 'fa000000-00fa-4000-a000-000000000004';
const FA_DISH_PAELLA  = 'fa000000-00fa-4000-a000-000000000005';
const FA_DN_PAELLA    = 'fa000000-00fa-4000-a000-000000000006';
const FA_DISH_CAFE    = 'fa000000-00fa-4000-a000-000000000007';
const FA_DN_CAFE      = 'fa000000-00fa-4000-a000-000000000008';
const FA_DISH_CROQUETA = 'fa000000-00fa-4000-a000-000000000009';
const FA_DN_CROQUETA   = 'fa000000-00fa-4000-a000-000000000010';

const FA_ACTOR_ID = 'fa000000-00fa-4000-a000-000000000099';

// ---------------------------------------------------------------------------
// Cascade mock helpers
// ---------------------------------------------------------------------------

const FA_MOCK_NUTRIENTS = {
  calories: 180, proteins: 1, carbohydrates: 15, sugars: 1,
  fats: 0, saturatedFats: 0, fiber: 0, salt: 0.1, sodium: 40,
  transFats: 0, cholesterol: 0, potassium: 0,
  monounsaturatedFats: 0, polyunsaturatedFats: 0, alcohol: 14,
  referenceBasis: 'per_serving' as const,
};

function makeDishResult(entityId: string, name: string): EstimateResult {
  return {
    entityType: 'dish',
    entityId,
    name,
    nameEs: name,
    restaurantId: FA_REST_ID,
    chainSlug: 'fa-nlp-chain-test',
    portionGrams: 250,
    nutrients: FA_MOCK_NUTRIENTS,
    confidenceLevel: 'high',
    estimationMethod: 'official',
    source: {
      id: FA_SRC_ID,
      name: 'FA-NLPChain-Test-Src',
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
  await prisma.dishNutrient.deleteMany({
    where: { dishId: { in: [FA_DISH_CANA, FA_DISH_PAELLA, FA_DISH_CAFE, FA_DISH_CROQUETA] } },
  });
  await prisma.dish.deleteMany({
    where: { id: { in: [FA_DISH_CANA, FA_DISH_PAELLA, FA_DISH_CAFE, FA_DISH_CROQUETA] } },
  });
  await prisma.restaurant.deleteMany({ where: { id: FA_REST_ID } });
  await prisma.dataSource.deleteMany({ where: { id: FA_SRC_ID } });
}

beforeAll(async () => {
  // mockCascade: route by food term in the query
  mockCascade.mockImplementation(async (opts: { query: string }) => {
    const q = opts.query.toLowerCase();

    const matched =
      q.includes('caña') || q.includes('cana') || q.includes('cerveza')
        ? makeDishResult(FA_DISH_CANA, 'caña de cerveza')
        : q.includes('paella')
          ? makeDishResult(FA_DISH_PAELLA, 'paella')
          : q.includes('café') || q.includes('cafe') || q.includes('con leche')
            ? makeDishResult(FA_DISH_CAFE, 'café con leche')
            : q.includes('croqueta')
              ? makeDishResult(FA_DISH_CROQUETA, 'croquetas')
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
          matchType: 'exact_dish',
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
    data: { id: FA_SRC_ID, name: 'FA-NLPChain-Test-Src', type: 'official' },
  });

  await prisma.restaurant.create({
    data: {
      id: FA_REST_ID,
      name: 'FA NLPChain Test Restaurant',
      chainSlug: 'fa-nlp-chain-test',
    },
  });

  const dishes = [
    { id: FA_DISH_CANA, dnId: FA_DN_CANA, name: 'caña de cerveza', calories: 180 },
    { id: FA_DISH_PAELLA, dnId: FA_DN_PAELLA, name: 'paella', calories: 350 },
    { id: FA_DISH_CAFE, dnId: FA_DN_CAFE, name: 'café con leche', calories: 80 },
    { id: FA_DISH_CROQUETA, dnId: FA_DN_CROQUETA, name: 'croquetas', calories: 400 },
  ];

  for (const d of dishes) {
    await prisma.dish.create({
      data: {
        id: d.id,
        name: d.name,
        nameEs: d.name,
        nameSourceLocale: 'es',
        restaurantId: FA_REST_ID,
        sourceId: FA_SRC_ID,
        confidenceLevel: 'high',
        estimationMethod: 'scraped',
        availability: 'available',
      },
    });
    await prisma.dishNutrient.create({
      data: {
        id: d.dnId,
        dishId: d.id,
        sourceId: FA_SRC_ID,
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

function buildRequest(text: string): ConversationRequest {
  return {
    text,
    actorId: FA_ACTOR_ID,
    db,
    redis: {} as ConversationRequest['redis'],
    prisma,
    chainSlugs: ['fa-nlp-chain-test'],
    chains: [{ chainSlug: 'fa-nlp-chain-test', name: 'FA NLPChain Test Restaurant', nameEs: null }],
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F-NLP-CHAIN-ORDERING — processMessage() integration (AC12, ADR-021)', () => {

  it('AC1/AC12 — wrapper + lexical count: "me he bebido dos cañas de cerveza" → intent estimation, portionMultiplier 2', async () => {
    // RED behavior before fix: portionMultiplier = 1 (extractPortionModifier ran on raw
    // "me he bebido dos cañas de cerveza" — no leading numeric pattern fired)
    const result = await processMessage(buildRequest('me he bebido dos cañas de cerveza'));

    expect(result.intent).toBe('estimation');
    expect(result.estimation?.portionMultiplier).toBe(2);
    expect(result.estimation?.result?.nameEs).toMatch(/caña/i);
  });

  it('AC3/AC12 — wrapper + digit count: "acabo de beberme 3 cañas" → intent estimation, portionMultiplier 3', async () => {
    // RED behavior before fix: portionMultiplier = 1 (wrapper not matched by pattern 5
    // because "beberme" uses clitic form not yet supported; reorder has no effect)
    const result = await processMessage(buildRequest('acabo de beberme 3 cañas'));

    expect(result.intent).toBe('estimation');
    expect(result.estimation?.portionMultiplier).toBe(3);
    expect(result.estimation?.result?.nameEs).toMatch(/caña/i);
  });

  it('AC4/AC12 — wrapper + count + container: "he comido dos platos de paella" → portionMultiplier 2, nameEs paella', async () => {
    // RED behavior before fix: portionMultiplier = 1 AND cascade called with
    // "platos de paella" instead of "paella"
    const result = await processMessage(buildRequest('he comido dos platos de paella'));

    expect(result.intent).toBe('estimation');
    expect(result.estimation?.portionMultiplier).toBe(2);
    expect(result.estimation?.result?.nameEs).toBe('paella');
  });

  it('AC8/AC12 — wrapper + article count 1 + compound name: "me he tomado un café con leche" → portionMultiplier 1, nameEs café con leche', async () => {
    // Regression guard — should be GREEN before and after fix.
    // The "con leche" tail is part of the food name, NOT a container token.
    const result = await processMessage(buildRequest('me he tomado un café con leche'));

    expect(result.intent).toBe('estimation');
    expect(result.estimation?.portionMultiplier).toBe(1);
    expect(result.estimation?.result?.nameEs).toBe('café con leche');
  });

  it('AC9/AC12 — explicit menú trigger: "hoy he comido de menú: paella y vino" → intent menu_estimation', async () => {
    // Regression guard — menu path fires BEFORE Step 4 (the reorder), so this
    // must remain GREEN regardless of the pipeline reorder.
    const result = await processMessage(buildRequest('hoy he comido de menú: paella y vino'));

    expect(result.intent).toBe('menu_estimation');
    expect(result.menuEstimation?.items).toHaveLength(2);
  });

  it('AC11/AC12 — unrecognised wrapped input: "me he comido algo muy rico" → no throw, graceful null result', async () => {
    // The pipeline must not surface a 500 for unparseable wrapped input.
    const result = await processMessage(buildRequest('me he comido algo muy rico'));

    expect(result.intent).toBe('estimation');
    expect(result.estimation?.result).toBeNull();
  });

});
