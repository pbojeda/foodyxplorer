// Unit tests for level4Lookup — Level 4 LLM Integration Layer.
//
// Mocks:
//   - openai: controls chat.completions.create
//   - ../config.js: controls OPENAI_CHAT_MODEL, OPENAI_CHAT_MAX_TOKENS
//   - Kysely executor: controls DB query results (trigram search, nutrient fetches, food-by-name)
//
// Tests: guard conditions, Strategy A (food match), Strategy B (ingredient decomposition),
//        fallthrough, retry logic, error handling, source override, token logging.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock OpenAI SDK
// ---------------------------------------------------------------------------

const { mockChatCreate, MockOpenAI } = vi.hoisted(() => {
  const mockChatCreate = vi.fn();
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockChatCreate } },
  }));
  return { mockChatCreate, MockOpenAI };
});

vi.mock('openai', () => ({
  default: MockOpenAI,
}));

// ---------------------------------------------------------------------------
// Mock config
// ---------------------------------------------------------------------------

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    OPENAI_CHAT_MODEL: 'gpt-4o-mini' as string | undefined,
    OPENAI_CHAT_MAX_TOKENS: 512,
    OPENAI_API_KEY: 'sk-test',
  },
}));

vi.mock('../config.js', () => ({ config: mockConfig }));

// ---------------------------------------------------------------------------
// Mock Kysely executor
// ---------------------------------------------------------------------------

const { mockExecuteQuery } = vi.hoisted(() => ({
  mockExecuteQuery: vi.fn(),
}));

function buildMockDb() {
  const executor = {
    executeQuery: mockExecuteQuery,
    compileQuery: (node: unknown) => ({ sql: '', parameters: [], query: node }),
    transformQuery: (node: unknown) => node,
    withPlugins: function () { return this; },
    withPlugin: function () { return this; },
    withoutPlugins: function () { return this; },
  };
  return { getExecutor: () => executor };
}

import { level4Lookup } from '../estimation/level4Lookup.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LLM_SOURCE_ID = '00000000-0000-0000-0000-000000000017';

/** Top-10 trigram candidate rows returned by fetchCandidatesByTrigram */
const MOCK_TRIGRAM_CANDIDATES = [
  { id: 'fd000000-0024-4000-a000-000000000001', name: 'Chicken breast', name_es: 'Pechuga de pollo' },
  { id: 'fd000000-0024-4000-a000-000000000002', name: 'Chicken thigh', name_es: 'Muslo de pollo' },
  { id: 'fd000000-0024-4000-a000-000000000003', name: 'Whole chicken', name_es: 'Pollo entero' },
];

/** Food nutrient row for Strategy A — same shape as FoodQueryRow */
const MOCK_FOOD_NUTRIENT_ROW = {
  food_id: 'fd000000-0024-4000-a000-000000000001',
  food_name: 'Chicken breast',
  food_name_es: 'Pechuga de pollo',
  calories: '165.00',
  proteins: '31.00',
  carbohydrates: '0.00',
  sugars: '0.00',
  fats: '3.60',
  saturated_fats: '1.00',
  fiber: '0.00',
  salt: '0.15',
  sodium: '74.00',
  trans_fats: '0.00',
  cholesterol: '85.00',
  potassium: '256.00',
  monounsaturated_fats: '1.20',
  polyunsaturated_fats: '0.80',
  reference_basis: 'per_100g',
  source_id: 'fd000000-0024-4000-a000-000000000099',
  source_name: 'USDA FoodData Central',
  source_type: 'official',
  source_url: 'https://fdc.nal.usda.gov/',
};

/** Mock chat completion response helper */
function makeChatResponse(content: string, promptTokens = 50, completionTokens = 5) {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
    model: 'gpt-4o-mini',
  };
}

/** Food nutrient row for arroz (rice) — used in Strategy B tests */
const MOCK_FOOD_ROW_ARROZ = {
  food_id: 'fd000000-0024-4000-a000-000000000010',
  food_name: 'White rice, cooked',
  food_name_es: 'Arroz blanco cocido',
  calories: '130.00',
  proteins: '2.70',
  carbohydrates: '28.20',
  sugars: '0.00',
  fats: '0.30',
  saturated_fats: '0.10',
  fiber: '0.40',
  salt: '0.00',
  sodium: '1.00',
  trans_fats: '0.00',
  cholesterol: '0.00',
  potassium: '35.00',
  monounsaturated_fats: '0.10',
  polyunsaturated_fats: '0.10',
  reference_basis: 'per_100g',
  source_id: 'fd000000-0024-4000-a000-000000000099',
  source_name: 'USDA FoodData Central',
  source_type: 'official',
  source_url: 'https://fdc.nal.usda.gov/',
};

/** Food nutrient row for pollo (chicken) — used in Strategy B tests */
const MOCK_FOOD_ROW_POLLO = {
  food_id: 'fd000000-0024-4000-a000-000000000011',
  food_name: 'Chicken breast',
  food_name_es: 'Pechuga de pollo',
  calories: '165.00',
  proteins: '31.00',
  carbohydrates: '0.00',
  sugars: '0.00',
  fats: '3.60',
  saturated_fats: '1.00',
  fiber: '0.00',
  salt: '0.15',
  sodium: '74.00',
  trans_fats: '0.00',
  cholesterol: '85.00',
  potassium: '256.00',
  monounsaturated_fats: '1.20',
  polyunsaturated_fats: '0.80',
  reference_basis: 'per_100g',
  source_id: 'fd000000-0024-4000-a000-000000000099',
  source_name: 'USDA FoodData Central',
  source_type: 'official',
  source_url: 'https://fdc.nal.usda.gov/',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('level4Lookup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Restore default config state
    mockConfig.OPENAI_CHAT_MODEL = 'gpt-4o-mini';
    mockConfig.OPENAI_CHAT_MAX_TOKENS = 512;
    // Restore OpenAI constructor mock after vi.resetAllMocks() clears implementations
    MockOpenAI.mockImplementation(() => ({
      chat: { completions: { create: mockChatCreate } },
    }));
  });

  // -------------------------------------------------------------------------
  // Guard conditions
  // -------------------------------------------------------------------------

  it('test 1: returns null immediately when openAiApiKey is undefined (no DB calls, no OpenAI calls)', async () => {
    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pollo asado', {
      openAiApiKey: undefined,
    });

    expect(result).toBeNull();
    expect(mockExecuteQuery).not.toHaveBeenCalled();
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it('test 2: returns null immediately when OPENAI_CHAT_MODEL is not set (no DB calls, no OpenAI calls)', async () => {
    mockConfig.OPENAI_CHAT_MODEL = undefined;

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pollo asado', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).toBeNull();
    expect(mockExecuteQuery).not.toHaveBeenCalled();
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Strategy A — success
  // -------------------------------------------------------------------------

  it('test 3: Strategy A success — LLM returns valid index → matchType=llm_food_match, confidenceLevel=medium, entityType=food', async () => {
    // DB call 1: trigram candidates
    // DB call 2: nutrient fetch for matched food
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: MOCK_TRIGRAM_CANDIDATES })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_NUTRIENT_ROW] });

    // LLM call 1: Strategy A — returns index '0' (first candidate)
    mockChatCreate.mockResolvedValueOnce(makeChatResponse('0'));

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pechuga de pollo', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.matchType).toBe('llm_food_match');
    expect(result.result.confidenceLevel).toBe('medium');
    expect(result.result.estimationMethod).toBe('llm');
    expect(result.result.entityType).toBe('food');
    expect(result.result.portionGrams).toBeNull();
    expect(result.result.similarityDistance).toBeNull();
  });

  it('test 4: Strategy A "none" response → falls through to Strategy B (OpenAI called again for B)', async () => {
    // DB call 1: trigram candidates (Strategy A)
    // DB call 2: food-by-name lookup for Strategy B ingredient
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: MOCK_TRIGRAM_CANDIDATES })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });

    // LLM call 1: Strategy A → 'none'
    // LLM call 2: Strategy B → valid JSON decomposition
    mockChatCreate
      .mockResolvedValueOnce(makeChatResponse('none'))
      .mockResolvedValueOnce(makeChatResponse('[{"name": "pollo", "grams": 200}]'));

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pollo al horno con especias raras', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).not.toBeNull();
    // Strategy B hit
    expect(result?.matchType).toBe('llm_ingredient_decomposition');
    // Verified that mockChatCreate was called twice (once for A, once for B)
    expect(mockChatCreate).toHaveBeenCalledTimes(2);
  });

  it('test 5: Strategy A trigram returns 0 candidates → Strategy A skipped (no OpenAI call for A) → Strategy B attempted', async () => {
    // DB call 1: trigram returns empty (Strategy A skipped)
    // DB call 2: food-by-name lookup for Strategy B ingredient
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });

    // Only 1 LLM call expected (Strategy B only — Strategy A is skipped)
    mockChatCreate.mockResolvedValueOnce(makeChatResponse('[{"name": "pollo", "grams": 150}]'));

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pollo extraño', {
      openAiApiKey: 'sk-test-key',
    });

    // Strategy B hit (Strategy A was skipped entirely)
    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('llm_ingredient_decomposition');
    // Only 1 OpenAI call (Strategy B) — Strategy A made no call
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
  });

  it('test 6: Strategy A LLM returns index out of range → treated as none → falls through to Strategy B', async () => {
    // DB call 1: trigram candidates (only 3 rows)
    // DB call 2: food-by-name lookup for Strategy B
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: MOCK_TRIGRAM_CANDIDATES })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });

    // LLM call 1: Strategy A returns '11' (out of range for 3 candidates)
    // LLM call 2: Strategy B
    mockChatCreate
      .mockResolvedValueOnce(makeChatResponse('11'))
      .mockResolvedValueOnce(makeChatResponse('[{"name": "pollo", "grams": 150}]'));

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pollo raro', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result?.matchType).toBe('llm_ingredient_decomposition');
    expect(mockChatCreate).toHaveBeenCalledTimes(2);
  });

  it('test 7: Strategy A nutrients not found for matched UUID → Strategy A returns null → Strategy B attempted', async () => {
    // DB call 1: trigram candidates
    // DB call 2: nutrient fetch returns empty
    // DB call 3: food-by-name for Strategy B ingredient
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: MOCK_TRIGRAM_CANDIDATES })
      .mockResolvedValueOnce({ rows: [] })           // nutrient fetch: no rows
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });

    // LLM call 1: Strategy A → index 0
    // LLM call 2: Strategy B
    mockChatCreate
      .mockResolvedValueOnce(makeChatResponse('0'))
      .mockResolvedValueOnce(makeChatResponse('[{"name": "pollo", "grams": 150}]'));

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pollo sin nutrientes', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result?.matchType).toBe('llm_ingredient_decomposition');
    expect(mockChatCreate).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Strategy B — success
  // -------------------------------------------------------------------------

  it('test 8: Strategy B success (all resolved) — matchType=llm_ingredient_decomposition, confidenceLevel=medium, portionGrams=250, entityId=uuid of heaviest (arroz=150g)', async () => {
    // No trigram candidates → Strategy A skipped
    // DB call 1: trigram → empty
    // DB call 2: food-by-name for 'arroz' (150g)
    // DB call 3: food-by-name for 'pollo' (100g)
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('[{"name": "arroz", "grams": 150}, {"name": "pollo", "grams": 100}]'),
    );

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'arroz con pollo', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.matchType).toBe('llm_ingredient_decomposition');
    expect(result.result.confidenceLevel).toBe('medium');
    expect(result.result.portionGrams).toBe(250);
    // Heaviest is arroz (150g)
    expect(result.result.entityId).toBe(MOCK_FOOD_ROW_ARROZ.food_id);
  });

  it('test 9: Strategy B partial resolution (some unresolved) → confidenceLevel=low', async () => {
    // No trigram candidates → Strategy A skipped
    // DB call 1: trigram → empty
    // DB call 2: arroz exact → found (fetchFoodByName returns on exact match, no FTS)
    // DB call 3: ingrediente_raro exact → empty
    // DB call 4: ingrediente_raro FTS → empty (fetchFoodByName falls through to FTS on exact miss)
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })                     // trigram → empty
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] }) // arroz exact → found
      .mockResolvedValueOnce({ rows: [] })                     // ingrediente_raro exact → miss
      .mockResolvedValueOnce({ rows: [] });                    // ingrediente_raro FTS → miss

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('[{"name": "arroz", "grams": 150}, {"name": "ingrediente_raro", "grams": 50}]'),
    );

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'plato con ingrediente raro', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');
    expect(result.result.confidenceLevel).toBe('low');
    expect(result.matchType).toBe('llm_ingredient_decomposition');
  });

  it('test 10: Strategy B all ingredients unresolved → returns null', async () => {
    // No trigram candidates → Strategy A skipped
    // Both ingredient lookups return empty
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })  // trigram → empty
      .mockResolvedValueOnce({ rows: [] })  // arroz exact → empty
      .mockResolvedValueOnce({ rows: [] }); // arroz FTS → empty

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('[{"name": "ingrediente_raro_1", "grams": 100}]'),
    );

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'plato totalmente raro', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).toBeNull();
  });

  it('test 11: Strategy B malformed JSON → returns null (warn logged)', async () => {
    // No trigram candidates → Strategy A skipped
    mockExecuteQuery.mockResolvedValueOnce({ rows: [] });

    mockChatCreate.mockResolvedValueOnce(makeChatResponse('not json at all'));

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'plato desconocido', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).toBeNull();
  });

  it('test 12: Strategy B empty JSON array → returns null', async () => {
    // No trigram candidates → Strategy A skipped
    mockExecuteQuery.mockResolvedValueOnce({ rows: [] });

    mockChatCreate.mockResolvedValueOnce(makeChatResponse('[]'));

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'plato vacío', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).toBeNull();
  });

  it('test 13: OpenAI throws on Strategy A LLM call → returns null (graceful skip, no 500)', async () => {
    // Trigram candidates present, but OpenAI throws
    mockExecuteQuery.mockResolvedValueOnce({ rows: MOCK_TRIGRAM_CANDIDATES });
    mockChatCreate.mockRejectedValueOnce(new Error('network timeout'));

    const db = buildMockDb() as never;

    // Must not throw — OpenAI failures are graceful
    await expect(
      level4Lookup(db, 'pollo asado', { openAiApiKey: 'sk-test-key' }),
    ).resolves.toBeNull();
  });

  it('test 14: token usage logged via options.logger.info after successful OpenAI call', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: MOCK_TRIGRAM_CANDIDATES })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_NUTRIENT_ROW] });

    mockChatCreate.mockResolvedValueOnce(makeChatResponse('0', 80, 3));

    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const db = buildMockDb() as never;
    await level4Lookup(db, 'pechuga de pollo', {
      openAiApiKey: 'sk-test-key',
      logger: mockLogger,
    });

    // Logger.info must have been called with token usage
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        promptTokens: 80,
        completionTokens: 3,
      }),
      'L4 OpenAI call',
    );
  });

  it('test 15: Strategy B result has name=originalQuery and nameEs=null', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('[{"name": "pollo", "grams": 200}]'),
    );

    const db = buildMockDb() as never;
    const originalQuery = 'pollo al ajillo con guarnición';
    const result = await level4Lookup(db, originalQuery, {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).not.toBeNull();
    expect(result?.result.name).toBe(originalQuery);
    expect(result?.result.nameEs).toBeNull();
  });

  it('test 16: Strategy B source is LLM source (id, name, type, url)', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('[{"name": "pollo", "grams": 200}]'),
    );

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pollo guisado', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).not.toBeNull();
    expect(result?.result.source).toEqual({
      id: LLM_SOURCE_ID,
      name: 'LLM-assisted identification',
      priorityTier: 3,
      type: 'estimated',
      url: null,
    });
  });

  it('test 17: retry on retryable error (429) — mockChatCreate called exactly 2 times, result non-null on second success', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: MOCK_TRIGRAM_CANDIDATES })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_NUTRIENT_ROW] });

    // First call: 429 rate limit; second call: success
    const rateLimitError = Object.assign(new Error('Rate limit exceeded'), { status: 429 });
    mockChatCreate
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce(makeChatResponse('0'));

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pechuga de pollo', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('llm_food_match');
    // Must have been called exactly 2 times (1 retry)
    expect(mockChatCreate).toHaveBeenCalledTimes(2);
  });

  it('test 18: no retry on non-retryable error (400) — mockChatCreate called exactly 1 time, returns null', async () => {
    // Strategy A: no trigram candidates (Strategy A skipped — no LLM call for A)
    // Strategy B: calls LLM once, gets 400 (non-retryable → no retry = 1 call total)
    mockExecuteQuery.mockResolvedValueOnce({ rows: [] }); // trigram → empty

    const badRequestError = Object.assign(new Error('Bad request'), { status: 400 });
    mockChatCreate.mockRejectedValueOnce(badRequestError);

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'consulta malformada', {
      openAiApiKey: 'sk-test-key',
    });

    // Graceful null — no 500 even for non-retryable errors
    expect(result).toBeNull();
    // No retry for 400: exactly 1 LLM call (only Strategy B, and no retry loop)
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
  });

  it('test 19: Strategy A source override — result source is LLM source (NOT DB row source)', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: MOCK_TRIGRAM_CANDIDATES })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_NUTRIENT_ROW] });

    mockChatCreate.mockResolvedValueOnce(makeChatResponse('0'));

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pechuga de pollo', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).not.toBeNull();
    // Source MUST be LLM source, NOT the original DB row source ('USDA FoodData Central')
    expect(result?.result.source.id).toBe(LLM_SOURCE_ID);
    expect(result?.result.source.name).toBe('LLM-assisted identification');
    expect(result?.result.source.type).toBe('estimated');
    expect(result?.result.source.url).toBeNull();
    // Negative check: must NOT be the DB row's original source
    expect(result?.result.source.name).not.toBe('USDA FoodData Central');
  });

  // -------------------------------------------------------------------------
  // DB error → DB_UNAVAILABLE
  // -------------------------------------------------------------------------

  it('throws DB_UNAVAILABLE when trigram query fails (DB error)', async () => {
    mockExecuteQuery.mockRejectedValueOnce(new Error('connection refused'));

    const db = buildMockDb() as never;

    await expect(
      level4Lookup(db, 'pollo asado', { openAiApiKey: 'sk-test-key' }),
    ).rejects.toMatchObject({ code: 'DB_UNAVAILABLE' });
  });
});
