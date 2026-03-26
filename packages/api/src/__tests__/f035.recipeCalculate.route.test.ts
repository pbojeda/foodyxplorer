// F035 — Route-level integration tests for POST /calculate/recipe
//
// Uses buildApp().inject() with mocked Redis, Kysely (via sql), callChatCompletion,
// callOpenAIEmbeddingsOnce, and config.OPENAI_API_KEY.
//
// Covers acceptance criteria:
//   - Structured mode: all resolved via foodId → 200 + medium confidence
//   - Structured mode: partial resolution → 200 + low confidence
//   - Zero resolution → 422 RECIPE_UNRESOLVABLE
//   - portionMultiplier scaling
//   - Free-form mode: mocked LLM parse → 200 with parsedIngredients
//   - Free-form mode: malformed LLM JSON → 422 FREE_FORM_PARSE_FAILED
//   - Validation errors (400)
//   - Cache: cachedAt null on first request, non-null on repeat
//   - 14 nutrient fields + referenceBasis: per_serving

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

const { mockRedisGet, mockRedisSet } = vi.hoisted(() => ({
  mockRedisGet: vi.fn().mockResolvedValue(null),
  mockRedisSet: vi.fn().mockResolvedValue('OK'),
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
  } as unknown as Redis,
}));

// ---------------------------------------------------------------------------
// Mock Prisma (minimal — not used by recipe route but needed for buildApp)
// ---------------------------------------------------------------------------

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    queryLog: { create: vi.fn() },
    apiKey: { findUnique: vi.fn() },
  } as unknown as PrismaClient,
}));

// ---------------------------------------------------------------------------
// Mock Kysely sql tagged template
// Using vi.hoisted to create a controllable sequence mock
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Mock openaiClient
// ---------------------------------------------------------------------------

const { mockCallChatCompletion, mockCallOpenAIEmbeddingsOnce } = vi.hoisted(() => ({
  mockCallChatCompletion: vi.fn().mockResolvedValue(null),
  mockCallOpenAIEmbeddingsOnce: vi.fn().mockResolvedValue(null),
}));

vi.mock('../lib/openaiClient.js', () => ({
  callChatCompletion: mockCallChatCompletion,
  callOpenAIEmbeddingsOnce: mockCallOpenAIEmbeddingsOnce,
  getOpenAIClient: vi.fn(),
  isRetryableError: vi.fn().mockReturnValue(false),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock config — OPENAI_API_KEY is set by default
// ---------------------------------------------------------------------------

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

import { buildApp } from '../app.js';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const FOOD_ID_1 = 'fd000000-0001-4000-a000-000000000001';

function makeChickenRow(foodId = FOOD_ID_1) {
  return {
    food_id: foodId,
    food_name: 'Chicken breast',
    food_name_es: 'Pechuga de pollo',
    calories: '165',
    proteins: '31',
    carbohydrates: '0',
    sugars: '0',
    fats: '3.6',
    saturated_fats: '1.0',
    fiber: '0',
    salt: '0.1',
    sodium: '74',
    trans_fats: '0',
    cholesterol: '85',
    potassium: '220',
    monounsaturated_fats: '1.2',
    polyunsaturated_fats: '0.8',
    reference_basis: 'per_100g',
    source_id: 'ds-001',
    source_name: 'USDA',
    source_type: 'official',
    source_url: null,
  };
}

// Make sql return rows[i] for call i, then default empty
function mockSqlSequence(sequence: unknown[][]) {
  let callCount = 0;
  mockSqlFn.mockImplementation(() => {
    const rows = sequence[callCount] ?? [];
    callCount++;
    return { execute: vi.fn().mockResolvedValue({ rows }) };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /calculate/recipe', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockCallChatCompletion.mockResolvedValue(null);
    mockCallOpenAIEmbeddingsOnce.mockResolvedValue(null);
    // Reset sql mock to default empty
    mockSqlFn.mockReturnValue({ execute: vi.fn().mockResolvedValue({ rows: [] }) });

    app = await buildApp({
      config: {
        NODE_ENV: 'test',
        PORT: 3001,
        LOG_LEVEL: 'silent',
        DATABASE_URL: 'postgresql://localhost/test',
        REDIS_URL: 'redis://localhost',
        OPENAI_API_KEY: 'test-openai-key',
        OPENAI_CHAT_MODEL: 'gpt-4o-mini',
        OPENAI_CHAT_MAX_TOKENS: 512,
        CORS_ORIGIN: '*',
        RATE_LIMIT_MAX: 1000,
        RATE_LIMIT_TIME_WINDOW_MS: 60000,
      } as Parameters<typeof buildApp>[0]['config'],
    });
  });

  // ---------------------------------------------------------------------------
  // Structured mode — happy paths
  // ---------------------------------------------------------------------------

  describe('structured mode', () => {
    it('returns 200 with resolved nutrients when foodId resolves via direct_id', async () => {
      // direct_id lookup returns chicken row
      mockSqlSequence([[makeChickenRow()]]);

      const response = await app.inject({
        method: 'POST',
        url: '/calculate/recipe',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'structured',
          ingredients: [{ foodId: FOOD_ID_1, grams: 200 }],
        }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: Record<string, unknown> };
      expect(body.success).toBe(true);
      expect(body.data['mode']).toBe('structured');
      expect(body.data['resolvedCount']).toBe(1);
      expect(body.data['unresolvedCount']).toBe(0);
      expect(body.data['confidenceLevel']).toBe('medium');

      const totalNutrients = body.data['totalNutrients'] as Record<string, unknown>;
      expect(totalNutrients['calories']).toBe(330); // 165 * 200 / 100 * 1.0
      expect(totalNutrients['referenceBasis']).toBe('per_serving');
      expect(body.data['cachedAt']).toBeNull();
    });

    it('returns confidenceLevel medium when all resolved via L1 (no L4)', async () => {
      // exact_food hit
      mockSqlSequence([[makeChickenRow()]]);

      const response = await app.inject({
        method: 'POST',
        url: '/calculate/recipe',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'structured',
          ingredients: [{ name: 'pechuga de pollo', grams: 200 }],
        }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: Record<string, unknown> };
      expect(body.data['confidenceLevel']).toBe('medium');
    });

    it('returns partial aggregation (200) with unresolvedCount and low confidence when some miss', async () => {
      // chicken resolves via exact_food; unknown ingredient misses all strategies
      mockSqlSequence([
        [makeChickenRow()],  // chicken exact_food hit
        [],                   // unknown exact miss
        [],                   // unknown fts miss
        [],                   // L4 trigram candidates empty
      ]);

      const response = await app.inject({
        method: 'POST',
        url: '/calculate/recipe',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'structured',
          ingredients: [
            { name: 'pechuga de pollo', grams: 200 },
            { name: 'ingrediente muy raro xyz123', grams: 50 },
          ],
        }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: Record<string, unknown> };
      expect(body.data['resolvedCount']).toBe(1);
      expect(body.data['unresolvedCount']).toBe(1);
      expect(body.data['confidenceLevel']).toBe('low');
      const unresolved = body.data['unresolvedIngredients'] as string[];
      expect(unresolved).toHaveLength(1);
      expect(unresolved[0]).toBe('ingrediente muy raro xyz123');
    });

    it('returns 422 RECIPE_UNRESOLVABLE when zero ingredients resolve', async () => {
      // All queries return empty
      mockSqlSequence([[], [], [], []]);

      const response = await app.inject({
        method: 'POST',
        url: '/calculate/recipe',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'structured',
          ingredients: [{ name: 'ingrediente imposible abc999', grams: 100 }],
        }),
      });

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body) as { error: Record<string, unknown> };
      expect(body.error['code']).toBe('RECIPE_UNRESOLVABLE');
    });

    it('scales nutrients by portionMultiplier correctly', async () => {
      mockSqlSequence([[makeChickenRow()]]);

      const response = await app.inject({
        method: 'POST',
        url: '/calculate/recipe',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'structured',
          ingredients: [{ foodId: FOOD_ID_1, grams: 200, portionMultiplier: 0.7 }],
        }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: Record<string, unknown> };
      const totalNutrients = body.data['totalNutrients'] as Record<string, unknown>;
      // 165 * 200 / 100 * 0.7 = 231.00
      expect(totalNutrients['calories']).toBe(231);
    });

    it('returns all 14 nutrient fields + referenceBasis in totalNutrients', async () => {
      mockSqlSequence([[makeChickenRow()]]);

      const response = await app.inject({
        method: 'POST',
        url: '/calculate/recipe',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'structured',
          ingredients: [{ foodId: FOOD_ID_1, grams: 100 }],
        }),
      });

      const body = JSON.parse(response.body) as { data: Record<string, unknown> };
      const totalNutrients = body.data['totalNutrients'] as Record<string, unknown>;
      const expectedKeys = [
        'calories', 'proteins', 'carbohydrates', 'sugars', 'fats',
        'saturatedFats', 'fiber', 'salt', 'sodium', 'transFats',
        'cholesterol', 'potassium', 'monounsaturatedFats', 'polyunsaturatedFats',
        'referenceBasis',
      ];
      for (const key of expectedKeys) {
        expect(totalNutrients).toHaveProperty(key);
      }
      expect(totalNutrients['referenceBasis']).toBe('per_serving');
    });

    it('returns matchType direct_id in resolvedAs for foodId lookup', async () => {
      mockSqlSequence([[makeChickenRow()]]);

      const response = await app.inject({
        method: 'POST',
        url: '/calculate/recipe',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'structured',
          ingredients: [{ foodId: FOOD_ID_1, grams: 100 }],
        }),
      });

      const body = JSON.parse(response.body) as { data: Record<string, unknown> };
      const ingredients = body.data['ingredients'] as Array<Record<string, unknown>>;
      const resolvedAs = ingredients[0]?.['resolvedAs'] as Record<string, unknown>;
      expect(resolvedAs['matchType']).toBe('direct_id');
    });

    it('marks ingredient resolved via L4 as low confidence', async () => {
      // L1 miss for both exact and fts
      // L3 embedding null (mocked)
      // L4 trigram → LLM returns '0'
      mockSqlSequence([
        [],                        // exact_food miss
        [],                        // fts_food miss
        [{ id: FOOD_ID_1, name: 'Chicken breast', name_es: 'Pechuga de pollo' }], // trigram candidates
        [makeChickenRow()],         // fetchFoodNutrientsByUuid
      ]);

      mockCallOpenAIEmbeddingsOnce.mockResolvedValueOnce(null); // L3 skip
      mockCallChatCompletion.mockResolvedValueOnce('0'); // L4 LLM selects index 0

      const response = await app.inject({
        method: 'POST',
        url: '/calculate/recipe',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'structured',
          ingredients: [{ name: 'pollo', grams: 200 }],
        }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: Record<string, unknown> };
      expect(body.data['confidenceLevel']).toBe('low');
    });
  });

  // ---------------------------------------------------------------------------
  // Free-form mode
  // ---------------------------------------------------------------------------

  describe('free-form mode', () => {
    it('returns 200 with parsedIngredients in response', async () => {
      // First callChatCompletion = parseRecipeFreeForm; then L1 resolves chicken
      const parsedOutput = JSON.stringify([
        { name: 'pechuga de pollo', grams: 200 },
      ]);
      mockCallChatCompletion.mockResolvedValueOnce(parsedOutput); // parseRecipeFreeForm
      mockSqlSequence([[makeChickenRow()]]); // exact_food hit

      const response = await app.inject({
        method: 'POST',
        url: '/calculate/recipe',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'free-form',
          text: '200g de pechuga de pollo a la plancha',
        }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: Record<string, unknown> };
      expect(body.data['mode']).toBe('free-form');
      const parsedIngredients = body.data['parsedIngredients'] as unknown[];
      expect(parsedIngredients).toBeDefined();
      expect(parsedIngredients).toHaveLength(1);
    });

    it('returns 422 FREE_FORM_PARSE_FAILED when LLM call returns null', async () => {
      mockCallChatCompletion.mockResolvedValueOnce(null);

      const response = await app.inject({
        method: 'POST',
        url: '/calculate/recipe',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'free-form',
          text: '200g de pollo',
        }),
      });

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body) as { error: Record<string, unknown> };
      expect(body.error['code']).toBe('FREE_FORM_PARSE_FAILED');
    });

    it('returns 422 FREE_FORM_PARSE_FAILED when LLM returns malformed JSON', async () => {
      mockCallChatCompletion.mockResolvedValueOnce('not json {{{');

      const response = await app.inject({
        method: 'POST',
        url: '/calculate/recipe',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'free-form',
          text: '200g de pollo',
        }),
      });

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body) as { error: Record<string, unknown> };
      expect(body.error['code']).toBe('FREE_FORM_PARSE_FAILED');
    });
  });

  // ---------------------------------------------------------------------------
  // Validation errors
  // ---------------------------------------------------------------------------

  describe('validation errors', () => {
    it('returns 400 when both foodId and name provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/calculate/recipe',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'structured',
          ingredients: [{ foodId: FOOD_ID_1, name: 'pollo', grams: 100 }],
        }),
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: Record<string, unknown> };
      expect(body.error['code']).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when grams = 0', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/calculate/recipe',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'structured',
          ingredients: [{ name: 'pollo', grams: 0 }],
        }),
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when mode is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/calculate/recipe',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredients: [{ name: 'pollo', grams: 100 }],
        }),
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when text missing for free-form mode', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/calculate/recipe',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'free-form' }),
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when neither foodId nor name provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/calculate/recipe',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'structured',
          ingredients: [{ grams: 100 }],
        }),
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Cache behavior
  // ---------------------------------------------------------------------------

  describe('cache', () => {
    it('returns cachedAt: null on first request', async () => {
      mockSqlSequence([[makeChickenRow()]]);

      const response = await app.inject({
        method: 'POST',
        url: '/calculate/recipe',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'structured',
          ingredients: [{ foodId: FOOD_ID_1, grams: 100 }],
        }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: Record<string, unknown> };
      expect(body.data['cachedAt']).toBeNull();
    });

    it('returns cached data with cachedAt set on repeat request', async () => {
      const cachedData = {
        mode: 'structured',
        resolvedCount: 1,
        unresolvedCount: 0,
        confidenceLevel: 'medium',
        totalNutrients: {
          calories: 165, proteins: 31, carbohydrates: 0, sugars: 0, fats: 3.6,
          saturatedFats: 1, fiber: 0, salt: 0.1, sodium: 74, transFats: 0,
          cholesterol: 85, potassium: 220, monounsaturatedFats: 1.2,
          polyunsaturatedFats: 0.8, referenceBasis: 'per_serving',
        },
        ingredients: [],
        unresolvedIngredients: [],
        cachedAt: '2026-03-25T10:00:00.000Z',
      };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(cachedData));

      const response = await app.inject({
        method: 'POST',
        url: '/calculate/recipe',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'structured',
          ingredients: [{ foodId: FOOD_ID_1, grams: 100 }],
        }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: Record<string, unknown> };
      expect(body.data['cachedAt']).toBe('2026-03-25T10:00:00.000Z');
    });
  });

  // ---------------------------------------------------------------------------
  // Ingredient per-serving row → unresolved
  // ---------------------------------------------------------------------------

  it('marks ingredient unresolved when food resolves to per_serving nutrient row', async () => {
    // direct_id lookup returns per_serving row → unresolved → RECIPE_UNRESOLVABLE (only ingredient)
    const perServingRow = { ...makeChickenRow(), reference_basis: 'per_serving' };
    mockSqlSequence([[perServingRow], [], [], []]);

    const response = await app.inject({
      method: 'POST',
      url: '/calculate/recipe',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'structured',
        ingredients: [{ foodId: FOOD_ID_1, grams: 100 }],
      }),
    });

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body) as { error: Record<string, unknown> };
    expect(body.error['code']).toBe('RECIPE_UNRESOLVABLE');
  });
});
