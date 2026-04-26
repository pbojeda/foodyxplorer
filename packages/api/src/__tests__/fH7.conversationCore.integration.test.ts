// F-H7 — AC-9 processMessage() integration test (ADR-021 compliance).
//
// Tests that F-H7 wrapper patterns are correctly applied end-to-end through
// the processMessage() pipeline — verifying that:
//   1. Cat 29 queries (H7-P1: temporal prefix) return non-null estimation
//   2. Cat 22/21 queries (H7-P4: leading fillers) return non-null estimation
//   3. Conservative fallback: unrecognized queries → null estimation (no crash)
//
// Mock strategy (mirrors f-multi-item-implicit.integration.test.ts):
//   - contextManager.js  → getContext() returns null, setContext no-op
//   - lib/cache.js        → cacheGet() returns null, cacheSet no-op
//   - estimation/engineRouter.js → runEstimationCascade: mockCascade (controlled)
// Real prisma from DATABASE_URL_TEST.
//
// The mockCascade returns a fixed estimation fixture for target query fragments,
// confirming that extractFoodQuery() correctly stripped the wrappers and passed
// the clean dish name to runEstimationCascade.
//
// Vitest globals NOT enabled — import everything explicitly.

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
// Mock estimation fixture
// ---------------------------------------------------------------------------

const MOCK_NUTRIENTS = {
  calories: 250, proteins: 10, carbohydrates: 20, sugars: 3,
  fats: 12, saturatedFats: 4, fiber: 2, salt: 0.6, sodium: 240,
  transFats: 0, cholesterol: 0, potassium: 300,
  monounsaturatedFats: 5, polyunsaturatedFats: 2, alcohol: 0,
  referenceBasis: 'per_serving' as const,
};

const MOCK_RESULT: EstimateResult = {
  entityType: 'dish',
  entityId: 'fh7c0000-0000-4000-a000-000000000001',
  name: 'Test Dish',
  nameEs: 'Plato de prueba',
  restaurantId: null,
  chainSlug: null,
  portionGrams: 200,
  nutrients: MOCK_NUTRIENTS,
  confidenceLevel: 'high',
  estimationMethod: 'official',
  source: { id: 'fh7c0000-0000-4000-a000-000000000002', name: 'Test', type: 'official', url: null },
  similarityDistance: null,
};

function makeMockCascadeResult(query: string) {
  return {
    levelHit: 1 as const,
    data: {
      query,
      chainSlug: null,
      level1Hit: true,
      level2Hit: false,
      level3Hit: false,
      level4Hit: false,
      matchType: 'exact_dish' as const,
      result: MOCK_RESULT,
      cachedAt: null,
      yieldAdjustment: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Request builder
// ---------------------------------------------------------------------------

function buildRequest(text: string, customLogger?: ConversationRequest['logger']): ConversationRequest {
  return {
    text,
    actorId: 'fh7c0000-test-4000-a000-000000000099',
    db,
    prisma,
    redis: null as unknown as import('ioredis').Redis,
    openAiApiKey: undefined,
    chainSlugs: [],
    chains: [],
    legacyChainSlug: null,
    legacyChainName: null,
    logger: customLogger ?? {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Configure mockCascade to return estimation fixture for target dish names
  mockCascade.mockImplementation(async (opts: { query: string }) => {
    const { query } = opts;
    if (
      query === 'salmón con verduras al horno' ||  // Q631 via H7-P1
      query === 'ropa vieja canaria'               // Q463 via H7-P4
    ) {
      return makeMockCascadeResult(query);
    }
    // For fallback test: return total miss (cascade never returns null — always an EngineRouterResult)
    return {
      levelHit: null,
      data: {
        query,
        chainSlug: null,
        level1Hit: false,
        level2Hit: false,
        level3Hit: false,
        level4Hit: false,
        matchType: null,
        result: null,
        cachedAt: null,
        yieldAdjustment: null,
      },
    };
  });
});

afterAll(async () => {
  await pool.end();
  await prisma.$disconnect();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F-H7 — processMessage() end-to-end (AC-9, ADR-021)', () => {
  it('Test 1 (H7-P1): "ayer por la noche cené salmón con verduras al horno" → estimation !== null', async () => {
    // H7-P1 strips temporal+verb → extractFoodQuery returns query: "salmón con verduras al horno"
    // mockCascade is called with the stripped text
    mockCascade.mockClear();

    const result = await processMessage(buildRequest('ayer por la noche cené salmón con verduras al horno'));

    expect(result.intent).toBe('estimation');
    expect(result.estimation).not.toBeNull();
    // Verify mockCascade was called with the H7-P1 stripped query (article also stripped)
    expect(mockCascade).toHaveBeenCalled();
    const cascadeCallQuery = mockCascade.mock.calls[0]?.[0]?.query as string;
    expect(cascadeCallQuery).toBe('salmón con verduras al horno');
  });

  it('Test 2 (H7-P4): "quiero probar la ropa vieja canaria" → estimation !== null', async () => {
    // H7-P4 strips "quiero probar la" → extractFoodQuery returns query: "ropa vieja canaria"
    mockCascade.mockClear();

    const result = await processMessage(buildRequest('quiero probar la ropa vieja canaria'));

    expect(result.intent).toBe('estimation');
    expect(result.estimation).not.toBeNull();
    // Verify the stripped text was passed to cascade
    const cascadeCallQuery = mockCascade.mock.calls[0]?.[0]?.query as string;
    expect(cascadeCallQuery).toBe('ropa vieja canaria');
  });

  it('Test 3 (conservative fallback): unrecognized query → estimation.result === null (no crash)', async () => {
    // mockCascade returns total miss (levelHit: null, result: null) for unrecognized queries.
    // processMessage should handle this gracefully — returns intent: estimation but result: null.
    mockCascade.mockClear();

    // Use a text that won't match any pattern and won't confuse intent detection
    const result = await processMessage(buildRequest('texto sin ningún patrón conocido xyzzy'));

    // Should not crash; intent is still estimation
    expect(result.intent).toBe('estimation');
    // Cascade returns total miss → estimation.result is null (not estimation itself)
    expect(result.estimation).not.toBeNull(); // EstimateData object (always present)
    expect(result.estimation?.result).toBeNull(); // but result inside is null
  });

  // QA F1 follow-up: AC-10 end-to-end logger.debug emission verification
  it('Test 4 (AC-10 logger spy — H7-P1): logger.debug fires with wrapperPattern: H7-P1', async () => {
    mockCascade.mockClear();
    const debugSpy = vi.fn();
    const customLogger = {
      debug: debugSpy,
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    await processMessage(buildRequest('ayer por la noche cené salmón con verduras al horno', customLogger));

    // Verify the debug spy received a call with the H7-P1 wrapperPattern object
    const fH7Calls = debugSpy.mock.calls.filter((args: unknown[]) => {
      const [first] = args;
      return typeof first === 'object' && first !== null && 'wrapperPattern' in first && (first as { wrapperPattern: string }).wrapperPattern === 'H7-P1';
    });
    expect(fH7Calls.length).toBeGreaterThan(0);
  });

  it('Test 5 (AC-10 logger spy — H7-P4): logger.debug fires with wrapperPattern: H7-P4', async () => {
    mockCascade.mockClear();
    const debugSpy = vi.fn();
    const customLogger = {
      debug: debugSpy,
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    await processMessage(buildRequest('quiero probar la ropa vieja canaria', customLogger));

    const fH7Calls = debugSpy.mock.calls.filter((args: unknown[]) => {
      const [first] = args;
      return typeof first === 'object' && first !== null && 'wrapperPattern' in first && (first as { wrapperPattern: string }).wrapperPattern === 'H7-P4';
    });
    expect(fH7Calls.length).toBeGreaterThan(0);
  });

  it('Test 6 (AC-10 logger spy — no H7 match): logger.debug NOT called with wrapperPattern when no H7 pattern fires', async () => {
    mockCascade.mockClear();
    const debugSpy = vi.fn();
    const customLogger = {
      debug: debugSpy,
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    // "salmón con verduras" — no H7-P1..P4 pattern matches (no temporal, no leading filler)
    await processMessage(buildRequest('salmón con verduras', customLogger));

    const fH7Calls = debugSpy.mock.calls.filter((args: unknown[]) => {
      const [first] = args;
      return typeof first === 'object' && first !== null && 'wrapperPattern' in first;
    });
    expect(fH7Calls.length).toBe(0);
  });
});
