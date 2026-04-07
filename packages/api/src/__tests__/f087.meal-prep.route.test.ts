// Route tests for POST /calculate/recipe — F087 portions/perPortion
//
// Tests: portions field flows through, perPortion computed correctly,
//        backward compat (no portions), validation errors

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockRedisGet, mockRedisSet } = vi.hoisted(() => ({
  mockRedisGet: vi.fn(),
  mockRedisSet: vi.fn(),
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  } as unknown as Redis,
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    queryLog: { create: vi.fn() },
    apiKey: { findUnique: vi.fn() },
  } as unknown as PrismaClient,
}));

// Mock Kysely sql tagged template
const { mockSqlFn } = vi.hoisted(() => {
  const mockSqlFn = vi.fn().mockReturnValue({ execute: vi.fn().mockResolvedValue({ rows: [] }) });
  return { mockSqlFn };
});

vi.mock('kysely', async (importOriginal) => {
  const actual = await importOriginal<typeof import('kysely')>();
  return {
    ...actual,
    sql: Object.assign(mockSqlFn, { raw: actual.sql.raw }),
  };
});

// Mock openaiClient
vi.mock('../lib/openaiClient.js', () => ({
  callChatCompletion: vi.fn().mockResolvedValue(null),
  callOpenAIEmbeddingsOnce: vi.fn().mockResolvedValue(null),
  getOpenAIClient: vi.fn(),
  isRetryableError: vi.fn().mockReturnValue(false),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

// Mock config
vi.mock('../config.js', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
    DATABASE_URL_TEST: 'postgresql://user:pass@localhost:5432/test',
    LOG_LEVEL: 'silent',
    REDIS_URL: 'redis://localhost:6380',
    OPENAI_API_KEY: 'test-openai-key',
    OPENAI_CHAT_MODEL: 'gpt-4o-mini',
    OPENAI_CHAT_MAX_TOKENS: 512,
    OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
    OPENAI_EMBEDDING_BATCH_SIZE: 100,
    OPENAI_EMBEDDING_RPM: 3000,
  },
}));

// Mock resolve functions
const { mockResolveL1 } = vi.hoisted(() => ({
  mockResolveL1: vi.fn(),
}));

vi.mock('../calculation/resolveIngredient.js', () => ({
  resolveIngredientL1: mockResolveL1,
  resolveIngredientL3L4: vi.fn(),
}));

vi.mock('../calculation/parseRecipeFreeForm.js', () => ({
  parseRecipeFreeForm: vi.fn().mockResolvedValue([
    { name: 'arroz', grams: 1000, portionMultiplier: 1.0 },
  ]),
}));

vi.mock('../estimation/applyYield.js', () => ({
  resolveAndApplyYield: vi.fn().mockImplementation(({ result }) => ({
    result,
    yieldAdjustment: null,
  })),
}));

vi.mock('../estimation/engineRouter.js', () => ({
  runEstimationCascade: vi.fn().mockResolvedValue({ levelHit: null, data: {} }),
}));

vi.mock('../lib/queryLogger.js', () => ({
  writeQueryLog: vi.fn().mockResolvedValue(undefined),
}));

// Mock Kysely getKysely
const { kyselyContainer } = vi.hoisted(() => {
  const container = {
    results: [] as unknown[][],
    callIndex: 0,
  };

  (container as Record<string, unknown>)['makeDb'] = () => ({
    selectFrom: vi.fn().mockImplementation(() => {
      const idx = container.callIndex++;
      const data = container.results[idx] ?? [];
      const self: Record<string, unknown> = {
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        $if: vi.fn().mockImplementation((_cond: unknown, _cb: unknown) => self),
        execute: vi.fn().mockResolvedValue(data),
      };
      return self;
    }),
    fn: { countAll: vi.fn().mockReturnValue({ as: vi.fn().mockReturnThis() }) },
    getExecutor: () => ({
      executeQuery: vi.fn().mockResolvedValue({ rows: [] }),
      compileQuery: (node: unknown) => ({ sql: '', parameters: [], query: node }),
      transformQuery: (node: unknown) => node,
      withPlugins: function () { return this; },
    }),
  });

  return { kyselyContainer: container };
});

vi.mock('../lib/kysely.js', () => ({
  getKysely: () => {
    kyselyContainer.callIndex = 0;
    return (kyselyContainer as unknown as { makeDb: () => unknown }).makeDb();
  },
  destroyKysely: vi.fn(),
}));

import { buildApp } from '../app.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResolvedResult(overrides: { calories?: number; proteins?: number } = {}) {
  return {
    resolved: true,
    entityId: '00000000-0000-0000-0000-000000000001',
    name: 'arroz',
    nameEs: 'arroz',
    matchType: 'exact_food' as const,
    nutrientRow: {
      calories: String(overrides.calories ?? 350),
      proteins: String(overrides.proteins ?? 7),
      carbohydrates: '77', fats: '1',
      sugars: '0', saturated_fats: '0', fiber: '1', salt: '0',
      sodium: '0', trans_fats: '0', cholesterol: '0', potassium: '0',
      monounsaturated_fats: '0', polyunsaturated_fats: '0', alcohol: '0',
      reference_basis: 'per_100g',
      source_id: '00000000-0000-0000-0000-000000000002',
      source_name: 'USDA',
      source_type: 'official',
      source_url: null,
      food_group: 'cereals',
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /calculate/recipe — portions (F087)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockResolveL1.mockResolvedValue(makeResolvedResult());
    kyselyContainer.results = [];
    kyselyContainer.callIndex = 0;
  });

  it('without portions → portions: null, perPortion: null', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/calculate/recipe',
      payload: {
        mode: 'structured',
        ingredients: [{ name: 'arroz', grams: 200, portionMultiplier: 1.0 }],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { portions: unknown; perPortion: unknown } }>();
    expect(body.data.portions).toBeNull();
    expect(body.data.perPortion).toBeNull();
  });

  it('with portions=5 → perPortion nutrients are total ÷ 5', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/calculate/recipe',
      payload: {
        mode: 'structured',
        ingredients: [{ name: 'arroz', grams: 1000, portionMultiplier: 1.0 }],
        portions: 5,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { portions: number; perPortion: { calories: number; proteins: number }; totalNutrients: { calories: number; proteins: number } } }>();
    expect(body.data.portions).toBe(5);

    const total = body.data.totalNutrients;
    const per = body.data.perPortion;
    expect(per.calories).toBeCloseTo(total.calories / 5, 1);
    expect(per.proteins).toBeCloseTo(total.proteins / 5, 1);
  });

  it('with portions=1 → perPortion equals totalNutrients', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/calculate/recipe',
      payload: {
        mode: 'structured',
        ingredients: [{ name: 'arroz', grams: 200, portionMultiplier: 1.0 }],
        portions: 1,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { portions: number; perPortion: { calories: number }; totalNutrients: { calories: number } } }>();
    expect(body.data.portions).toBe(1);
    expect(body.data.perPortion.calories).toBe(body.data.totalNutrients.calories);
  });

  it('free-form mode with portions works', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/calculate/recipe',
      payload: {
        mode: 'free-form',
        text: '1kg arroz',
        portions: 4,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { portions: number; perPortion: { calories: number } } }>();
    expect(body.data.portions).toBe(4);
    expect(body.data.perPortion).not.toBeNull();
  });

  it('portions=0 → 400 validation error', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/calculate/recipe',
      payload: {
        mode: 'structured',
        ingredients: [{ name: 'arroz', grams: 200, portionMultiplier: 1.0 }],
        portions: 0,
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('portions=51 → 400 validation error', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/calculate/recipe',
      payload: {
        mode: 'structured',
        ingredients: [{ name: 'arroz', grams: 200, portionMultiplier: 1.0 }],
        portions: 51,
      },
    });

    expect(res.statusCode).toBe(400);
  });
});
