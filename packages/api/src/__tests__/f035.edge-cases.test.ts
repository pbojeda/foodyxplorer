// F035 — Edge-case tests for the Recipe Calculation Endpoint
//
// Covers scenarios NOT addressed by the developer's existing test suite:
//
//   1. Route: OPENAI_API_KEY absent in free-form mode → 422 FREE_FORM_PARSE_FAILED
//   2. Route: L3/L4 budget cap — 11th+ L1-miss ingredient is immediately unresolved (no AI call)
//   3. Route: duplicate ingredient entries are treated as independent rows
//   4. Route: Redis SET failure is fail-open (response still succeeds)
//   5. Route: per-ingredient nutrients contain all 14 fields + referenceBasis: per_serving
//   6. Route: grams negative → 400 VALIDATION_ERROR
//   7. Route: portionMultiplier < 0.1 → 400 VALIDATION_ERROR
//   8. Route: free-form mode where LLM parses > 50 ingredients → 422 FREE_FORM_PARSE_FAILED
//   9. aggregateNutrients: empty ingredient list → all-zero totals
//  10. resolveIngredient: L4 LLM returns out-of-bounds index → unresolved
//  11. resolveIngredient: L4 LLM returns non-numeric, non-"none" string → unresolved
//  12. resolveIngredient: distance exactly at 0.5 threshold → L3 miss (must be strictly < 0.5)
//  13. resolveIngredient: L3 similarity hit but nutrient row is per_serving → unresolved
//  14. resolveIngredient: DB error in L1 bubbles as DB_UNAVAILABLE
//  15. parseRecipeFreeForm: AbortSignal already aborted → returns null without calling LLM

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// 1–8: Route-level edge cases
// ---------------------------------------------------------------------------

// Mock Redis
const { mockRedisGet, mockRedisSet } = vi.hoisted(() => ({
  mockRedisGet: vi.fn().mockResolvedValue(null),
  mockRedisSet: vi.fn().mockResolvedValue('OK'),
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  },
}));

// Mock Prisma
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    queryLog: { create: vi.fn() },
    apiKey: { findUnique: vi.fn() },
  },
}));

// Mock Kysely sql
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

// Mock config — default includes OPENAI_API_KEY
const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    NODE_ENV: 'test',
    PORT: 3001,
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
    DATABASE_URL_TEST: 'postgresql://user:pass@localhost:5432/test',
    LOG_LEVEL: 'silent',
    REDIS_URL: 'redis://localhost:6380',
    OPENAI_API_KEY: 'test-openai-key' as string | undefined,
    OPENAI_CHAT_MODEL: 'gpt-4o-mini',
    OPENAI_CHAT_MAX_TOKENS: 512,
    OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
    OPENAI_EMBEDDING_BATCH_SIZE: 100,
    OPENAI_EMBEDDING_RPM: 3000,
  },
}));

vi.mock('../config.js', () => ({ config: mockConfig }));

import { buildApp } from '../app.js';
import { aggregateNutrients } from '../calculation/aggregateNutrients.js';
import type { ResolvedIngredientForAggregation } from '../calculation/aggregateNutrients.js';
import { resolveIngredientL3L4 } from '../calculation/resolveIngredient.js';
import { callChatCompletion, callOpenAIEmbeddingsOnce } from '../lib/openaiClient.js';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../generated/kysely-types.js';
import { parseRecipeFreeForm } from '../calculation/parseRecipeFreeForm.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const FOOD_ID_1 = 'fd000000-0001-4000-a000-000000000001';
const API_KEY = 'test-openai-key';

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

function mockSqlSequence(sequence: unknown[][]) {
  let callCount = 0;
  mockSqlFn.mockImplementation(() => {
    const rows = sequence[callCount] ?? [];
    callCount++;
    return { execute: vi.fn().mockResolvedValue({ rows }) };
  });
}

function makeAggIngredient(
  overrides: Partial<ResolvedIngredientForAggregation> = {},
): ResolvedIngredientForAggregation {
  return {
    grams: 100,
    portionMultiplier: 1.0,
    nutrientRow: {
      food_id: FOOD_ID_1,
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
    },
    ...overrides,
  };
}

const db = {} as Kysely<DB>;

// ---------------------------------------------------------------------------
// Route-level edge cases
// ---------------------------------------------------------------------------

describe('POST /calculate/recipe — edge cases', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockCallChatCompletion.mockResolvedValue(null);
    mockCallOpenAIEmbeddingsOnce.mockResolvedValue(null);
    mockSqlFn.mockReturnValue({ execute: vi.fn().mockResolvedValue({ rows: [] }) });
    // Restore default API key for each test
    mockConfig.OPENAI_API_KEY = 'test-openai-key';

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

  // -------------------------------------------------------------------------
  // 1. OPENAI_API_KEY absent — free-form mode fails immediately
  // -------------------------------------------------------------------------

  it('returns 422 FREE_FORM_PARSE_FAILED when OPENAI_API_KEY is not configured (free-form mode)', async () => {
    // Remove the API key from the module-level config mock
    mockConfig.OPENAI_API_KEY = undefined;

    const response = await app.inject({
      method: 'POST',
      url: '/calculate/recipe',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'free-form',
        text: '200g de pechuga de pollo',
      }),
    });

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body) as { error: Record<string, unknown> };
    expect(body.error['code']).toBe('FREE_FORM_PARSE_FAILED');
    // LLM must not have been called
    expect(mockCallChatCompletion).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 2. L3/L4 budget cap: 11th+ L1-miss ingredient is immediately unresolved
  // Spec: "More than 10 ingredients miss L1 → 11th+ L1-miss skips L3/L4, marked unresolved"
  // -------------------------------------------------------------------------

  it('limits L3/L4 to 10 budget slots — 11th+ L1-miss is immediately unresolved without AI call', async () => {
    // Build 12 ingredients, all L1 misses (exact+fts return empty for each)
    // First ingredient resolves via L1 (so we don't get RECIPE_UNRESOLVABLE)
    // 11 ingredients miss L1 → only 10 should attempt L3/L4; the 11th gets immediately unresolved

    // Ingredient 0: resolves via direct_id (L1 hit)
    // Ingredients 1–11 (11 items): L1 miss each
    // Total: 1 L1 hit + 11 L1 misses → budget = 10 → 10 go to L3/L4 (no embedding → fall to L4 → no trigram candidates → unresolved), 1 is immediately unresolved

    // For 11 L1-miss ingredients: each needs exact_food + fts_food = 2 queries each = 22 queries
    // Plus 1 direct_id for the first ingredient = 1 query
    const sqlSequence: unknown[][] = [
      [makeChickenRow()], // ingredient 0: direct_id hit
      ...Array(11 * 2).fill([]), // ingredients 1–11: exact + fts miss each
      // L4 trigram candidates for each of the 10 that enter L3/L4: empty (unresolved)
      ...Array(10).fill([]),
    ];
    mockSqlSequence(sqlSequence);

    // Embedding returns null for all (skips L3, falls to L4 which also has no candidates)
    mockCallOpenAIEmbeddingsOnce.mockResolvedValue(null);

    const ingredients = [
      { foodId: FOOD_ID_1, grams: 50 },
      ...Array.from({ length: 11 }, (_, i) => ({ name: `missing-ingredient-${i}`, grams: 10 })),
    ];

    const response = await app.inject({
      method: 'POST',
      url: '/calculate/recipe',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'structured', ingredients }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: Record<string, unknown> };
    // 11 L1 misses: 10 get L3/L4 (no AI key needed in structured — but embeddings mock returns null), 1 is immediately unresolved
    expect(body.data['resolvedCount']).toBe(1); // only ingredient 0 resolved
    expect(body.data['unresolvedCount']).toBe(11); // all 11 L1-miss ingredients unresolved
    expect(body.data['confidenceLevel']).toBe('low');

    // The key assertion: callOpenAIEmbeddingsOnce should be called at most 10 times (budget cap)
    expect(mockCallOpenAIEmbeddingsOnce).toHaveBeenCalledTimes(10);
  });

  // -------------------------------------------------------------------------
  // 3. Duplicate ingredient entries are treated as independent rows
  // Spec: "Duplicate ingredient entries → treated as independent rows; both resolved and aggregated"
  // -------------------------------------------------------------------------

  it('treats duplicate ingredient entries as independent rows and aggregates both', async () => {
    // Two identical ingredients → each should be resolved independently and contribute to totals
    mockSqlSequence([
      [makeChickenRow()], // first "pollo" exact_food hit
      [makeChickenRow()], // second "pollo" exact_food hit
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/calculate/recipe',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'structured',
        ingredients: [
          { name: 'pechuga de pollo', grams: 100 },
          { name: 'pechuga de pollo', grams: 100 }, // duplicate
        ],
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: Record<string, unknown> };
    expect(body.data['resolvedCount']).toBe(2);
    expect(body.data['unresolvedCount']).toBe(0);
    const totalNutrients = body.data['totalNutrients'] as Record<string, unknown>;
    // 165 * 100/100 * 1.0 = 165 per ingredient × 2 = 330 total
    expect(totalNutrients['calories']).toBe(330);
    const ingredients = body.data['ingredients'] as unknown[];
    expect(ingredients).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // 4. Redis SET failure is fail-open — response still returns 200
  // Spec: "Redis unavailable → fail-open: calculate without caching; cachedAt: null"
  // -------------------------------------------------------------------------

  it('returns 200 and cachedAt: null when Redis SET throws (fail-open)', async () => {
    mockRedisSet.mockRejectedValueOnce(new Error('Redis connection refused'));
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

    // Even though Redis SET failed, the route should succeed
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: Record<string, unknown> };
    expect(body.data['cachedAt']).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 5. Per-ingredient nutrients contain all 14 fields + referenceBasis: per_serving
  // Spec AC: "Per-ingredient nutrients also carry all 14 nutrient fields with referenceBasis: per_serving"
  // -------------------------------------------------------------------------

  it('per-ingredient nutrients contain all 14 nutrient fields and referenceBasis: per_serving', async () => {
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
    const ingredients = body.data['ingredients'] as Array<Record<string, unknown>>;
    expect(ingredients).toHaveLength(1);

    const perIngNutrients = ingredients[0]?.['nutrients'] as Record<string, unknown>;
    expect(perIngNutrients).not.toBeNull();

    const expectedKeys = [
      'calories', 'proteins', 'carbohydrates', 'sugars', 'fats',
      'saturatedFats', 'fiber', 'salt', 'sodium', 'transFats',
      'cholesterol', 'potassium', 'monounsaturatedFats', 'polyunsaturatedFats',
    ];
    for (const key of expectedKeys) {
      expect(perIngNutrients).toHaveProperty(key);
    }
    expect(perIngNutrients['referenceBasis']).toBe('per_serving');
  });

  // -------------------------------------------------------------------------
  // 6. grams negative → 400 VALIDATION_ERROR
  // Spec edge case table: "grams ≤ 0 → 400 VALIDATION_ERROR"
  // -------------------------------------------------------------------------

  it('returns 400 VALIDATION_ERROR when grams is negative', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/calculate/recipe',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'structured',
        ingredients: [{ name: 'pollo', grams: -100 }],
      }),
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: Record<string, unknown> };
    expect(body.error['code']).toBe('VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // 7. portionMultiplier < 0.1 → 400 VALIDATION_ERROR
  // Spec edge case: "portionMultiplier ≤ 0 or out of range → 400 VALIDATION_ERROR"
  // -------------------------------------------------------------------------

  it('returns 400 VALIDATION_ERROR when portionMultiplier is below 0.1 (e.g. 0.05)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/calculate/recipe',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'structured',
        ingredients: [{ name: 'pollo', grams: 100, portionMultiplier: 0.05 }],
      }),
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: Record<string, unknown> };
    expect(body.error['code']).toBe('VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // 8. Free-form LLM returns > 50 ingredients → 422 FREE_FORM_PARSE_FAILED
  // Spec edge case: "LLM parse returns > 50 ingredients → Fails LlmParseOutputSchema → 422 FREE_FORM_PARSE_FAILED"
  // -------------------------------------------------------------------------

  it('returns 422 FREE_FORM_PARSE_FAILED when LLM parses more than 50 ingredients from free-form text', async () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => ({ name: `ingredient${i}`, grams: 10 }));
    mockCallChatCompletion.mockResolvedValueOnce(JSON.stringify(tooMany));

    const response = await app.inject({
      method: 'POST',
      url: '/calculate/recipe',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'free-form',
        text: 'an enormous recipe with more than 50 ingredients',
      }),
    });

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body) as { error: Record<string, unknown> };
    expect(body.error['code']).toBe('FREE_FORM_PARSE_FAILED');
  });
});

// ---------------------------------------------------------------------------
// aggregateNutrients edge cases
// ---------------------------------------------------------------------------

describe('aggregateNutrients — edge cases', () => {
  // -------------------------------------------------------------------------
  // 9. Empty ingredient list returns all-zero totals with per_serving basis
  // The implementation has this path but existing tests don't assert the zero values
  // -------------------------------------------------------------------------

  it('returns all-zero totals and empty perIngredient array for empty input', () => {
    const { perIngredient, totals } = aggregateNutrients([]);

    expect(perIngredient).toHaveLength(0);

    const nutrientKeys = [
      'calories', 'proteins', 'carbohydrates', 'sugars', 'fats',
      'saturatedFats', 'fiber', 'salt', 'sodium', 'transFats',
      'cholesterol', 'potassium', 'monounsaturatedFats', 'polyunsaturatedFats',
    ] as const;

    for (const key of nutrientKeys) {
      expect(totals[key]).toBe(0);
    }
    expect(totals.referenceBasis).toBe('per_serving');
  });

  // -------------------------------------------------------------------------
  // Additional: all nutrients null for a single ingredient with mixed-null peer
  // Spec: "null for ALL → null; null + non-null → treat null as 0 in total"
  // This variant: 3 ingredients, only one has data for a nutrient
  // -------------------------------------------------------------------------

  it('treats null nutrient as 0 in totals when at least one ingredient has data (3-ingredient case)', () => {
    const rowWithData = makeAggIngredient({
      nutrientRow: {
        ...makeAggIngredient().nutrientRow,
        potassium: '300',
        food_id: 'fd000000-0001-4000-a000-000000000001',
      },
    });
    const rowNoData1 = makeAggIngredient({
      nutrientRow: {
        ...makeAggIngredient().nutrientRow,
        potassium: null,
        food_id: 'fd000000-0002-4000-a000-000000000002',
      },
    });
    const rowNoData2 = makeAggIngredient({
      nutrientRow: {
        ...makeAggIngredient().nutrientRow,
        potassium: null,
        food_id: 'fd000000-0003-4000-a000-000000000003',
      },
    });

    const { perIngredient, totals } = aggregateNutrients([rowWithData, rowNoData1, rowNoData2]);

    // 300 * 100/100 * 1.0 = 300
    expect(perIngredient[0]?.potassium).toBe(300);
    // The other two rows have null potassium → per-ingredient shows null
    expect(perIngredient[1]?.potassium).toBeNull();
    expect(perIngredient[2]?.potassium).toBeNull();
    // Total: not all-null → treat nulls as 0, total = 300 + 0 + 0 = 300
    expect(totals.potassium).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// resolveIngredientL3L4 edge cases
// ---------------------------------------------------------------------------

describe('resolveIngredientL3L4 — edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (sql as ReturnType<typeof vi.fn>).mockReturnValue({ execute: vi.fn().mockResolvedValue({ rows: [] }) });
  });

  // -------------------------------------------------------------------------
  // 10. L4 LLM returns out-of-bounds index → unresolved
  // Spec: "If idx out of bounds → unresolved"
  // -------------------------------------------------------------------------

  it('returns unresolved when L4 LLM returns an index exceeding the candidate list size', async () => {
    (callOpenAIEmbeddingsOnce as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    // Only 2 candidates (indices 0, 1)
    const candidates = [
      { id: FOOD_ID_1, name: 'Chicken', name_es: null },
      { id: 'fd000000-0002-4000-a000-000000000002', name: 'Duck', name_es: null },
    ];
    (sql as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ execute: vi.fn().mockResolvedValueOnce({ rows: candidates }) });

    // LLM returns '5' — out of bounds for a 2-item list
    (callChatCompletion as ReturnType<typeof vi.fn>).mockResolvedValueOnce('5');

    const result = await resolveIngredientL3L4(db, { name: 'pollo', grams: 100, portionMultiplier: 1.0 }, API_KEY);

    expect(result.resolved).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 11. L4 LLM returns non-numeric, non-"none" string → unresolved
  // -------------------------------------------------------------------------

  it('returns unresolved when L4 LLM returns a non-numeric non-"none" string', async () => {
    (callOpenAIEmbeddingsOnce as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const candidates = [{ id: FOOD_ID_1, name: 'Chicken', name_es: null }];
    (sql as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ execute: vi.fn().mockResolvedValueOnce({ rows: candidates }) });

    // LLM returns garbage text instead of an index or "none"
    (callChatCompletion as ReturnType<typeof vi.fn>).mockResolvedValueOnce('pollo asado');

    const result = await resolveIngredientL3L4(db, { name: 'pollo', grams: 100, portionMultiplier: 1.0 }, API_KEY);

    expect(result.resolved).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 12. L3 distance exactly at threshold 0.5 → NOT resolved (must be strictly < 0.5)
  // -------------------------------------------------------------------------

  it('does NOT resolve via L3 when similarity distance is exactly 0.5 (threshold is strict < 0.5)', async () => {
    const embedding = new Array(1536).fill(0.1);
    (callOpenAIEmbeddingsOnce as ReturnType<typeof vi.fn>).mockResolvedValueOnce(embedding);

    // distance exactly = 0.5 → should be rejected (threshold is < 0.5, not ≤ 0.5)
    const similarityRow = { food_id: FOOD_ID_1, distance: '0.5' };
    (sql as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ execute: vi.fn().mockResolvedValueOnce({ rows: [similarityRow] }) })
      .mockReturnValue({ execute: vi.fn().mockResolvedValue({ rows: [] }) }); // L4 trigram: empty

    const result = await resolveIngredientL3L4(db, { name: 'pollo', grams: 100, portionMultiplier: 1.0 }, API_KEY);

    // distance 0.5 is NOT < 0.5, so L3 should miss and L4 also miss
    expect(result.resolved).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 13. L3 similarity hit but food's nutrient row is per_serving → unresolved
  // Spec: "Only per_100g rows accepted for scaling"
  // -------------------------------------------------------------------------

  it('returns unresolved when L3 finds a match but the food nutrient row is per_serving', async () => {
    const embedding = new Array(1536).fill(0.1);
    (callOpenAIEmbeddingsOnce as ReturnType<typeof vi.fn>).mockResolvedValueOnce(embedding);

    // L3 distance < 0.5 → hit
    const similarityRow = { food_id: FOOD_ID_1, distance: '0.3' };
    // But nutrient row is per_serving → must be rejected
    const perServingRow = {
      food_id: FOOD_ID_1,
      food_name: 'Chicken breast',
      food_name_es: 'Pechuga de pollo',
      calories: '250',
      proteins: '25',
      carbohydrates: '0',
      sugars: '0',
      fats: '10',
      saturated_fats: '3',
      fiber: '0',
      salt: '0.5',
      sodium: '200',
      trans_fats: '0',
      cholesterol: '70',
      potassium: '300',
      monounsaturated_fats: '4',
      polyunsaturated_fats: '2',
      reference_basis: 'per_serving', // <-- per_serving, not per_100g
      source_id: 'ds-001',
      source_name: 'USDA',
      source_type: 'official',
      source_url: null,
    };

    (sql as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ execute: vi.fn().mockResolvedValueOnce({ rows: [similarityRow] }) })
      .mockReturnValueOnce({ execute: vi.fn().mockResolvedValueOnce({ rows: [perServingRow] }) })
      .mockReturnValue({ execute: vi.fn().mockResolvedValue({ rows: [] }) }); // L4 trigram: empty

    const result = await resolveIngredientL3L4(db, { name: 'pollo', grams: 100, portionMultiplier: 1.0 }, API_KEY);

    expect(result.resolved).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 14. DB error in L3/L4 bubbles as DB_UNAVAILABLE
  // Spec: "DB errors bubble up as { code: 'DB_UNAVAILABLE' }"
  // -------------------------------------------------------------------------

  it('throws DB_UNAVAILABLE error when a DB query fails during L3/L4', async () => {
    const embedding = new Array(1536).fill(0.1);
    (callOpenAIEmbeddingsOnce as ReturnType<typeof vi.fn>).mockResolvedValueOnce(embedding);

    // foodSimilaritySearch throws
    (sql as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        execute: vi.fn().mockRejectedValueOnce(new Error('connection timeout')),
      });

    await expect(
      resolveIngredientL3L4(db, { name: 'pollo', grams: 100, portionMultiplier: 1.0 }, API_KEY),
    ).rejects.toMatchObject({ code: 'DB_UNAVAILABLE' });
  });
});

// ---------------------------------------------------------------------------
// parseRecipeFreeForm edge cases
// ---------------------------------------------------------------------------

describe('parseRecipeFreeForm — edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 15. AbortSignal already aborted → returns null without calling LLM
  // -------------------------------------------------------------------------

  it('returns null without calling LLM when AbortSignal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await parseRecipeFreeForm('200g de pollo', API_KEY, undefined, controller.signal);

    expect(mockCallChatCompletion).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
