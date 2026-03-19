// Edge-case tests for level4Lookup — F024 LLM Integration Layer.
//
// These tests cover scenarios intentionally NOT present in f024.level4Lookup.unit.test.ts:
//
//   Strategy A: negative index, float index, multi-token response, whitespace-padded index
//   Strategy B: grams=0 filtered, negative grams filtered, duplicate ingredient names,
//               markdown-wrapped JSON, empty string from LLM, only-invalid-items array,
//               non-array JSON object, nutrient aggregation arithmetic
//   callChatCompletion: null content, empty choices array, 5xx retry, both retries exhausted
//   Combined: both strategies fail → total null
//   Config: OPENAI_CHAT_MAX_TOKENS boundary (max=4096 passed to OpenAI call)

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock OpenAI SDK (mirrors f024.level4Lookup.unit.test.ts exactly)
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
// Mock Kysely executor (mirrors f024.level4Lookup.unit.test.ts exactly)
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
// Fixtures (mirrors f024.level4Lookup.unit.test.ts exactly)
// ---------------------------------------------------------------------------

const MOCK_TRIGRAM_CANDIDATES = [
  { id: 'fd000000-0024-4000-a000-000000000001', name: 'Chicken breast', name_es: 'Pechuga de pollo' },
  { id: 'fd000000-0024-4000-a000-000000000002', name: 'Chicken thigh', name_es: 'Muslo de pollo' },
  { id: 'fd000000-0024-4000-a000-000000000003', name: 'Whole chicken', name_es: 'Pollo entero' },
];

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

function makeChatResponse(content: string, promptTokens = 50, completionTokens = 5) {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
    model: 'gpt-4o-mini',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('level4Lookup — edge cases', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockConfig.OPENAI_CHAT_MODEL = 'gpt-4o-mini';
    mockConfig.OPENAI_CHAT_MAX_TOKENS = 512;
    MockOpenAI.mockImplementation(() => ({
      chat: { completions: { create: mockChatCreate } },
    }));
  });

  // -------------------------------------------------------------------------
  // Strategy A — malformed LLM index responses
  // -------------------------------------------------------------------------

  it('Strategy A: LLM returns negative index (-1) → treated as invalid → falls through to Strategy B', async () => {
    // Trigram returns 3 candidates; LLM says '-1' (negative — invalid index)
    // Strategy A must reject this and fall through to Strategy B
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: MOCK_TRIGRAM_CANDIDATES })       // trigram
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });        // Strategy B food lookup

    mockChatCreate
      .mockResolvedValueOnce(makeChatResponse('-1'))                   // Strategy A: negative index
      .mockResolvedValueOnce(makeChatResponse('[{"name": "pollo", "grams": 150}]')); // Strategy B

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pollo raro', { openAiApiKey: 'sk-test-key' });

    // Must fall through to Strategy B (not return a food at negative index)
    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('llm_ingredient_decomposition');
    expect(mockChatCreate).toHaveBeenCalledTimes(2);
  });

  it('Strategy A: LLM returns float index (1.5) → parseInt parses as 1 → valid candidate selected (no crash)', async () => {
    // '1.5' → parseInt('1.5', 10) = 1, which is a valid index (candidates[1])
    // The implementation accepts this — test documents the actual behavior
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: MOCK_TRIGRAM_CANDIDATES })        // trigram
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_NUTRIENT_ROW] });     // nutrient fetch for candidate[1]

    mockChatCreate.mockResolvedValueOnce(makeChatResponse('1.5'));     // float index

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pechuga pollo', { openAiApiKey: 'sk-test-key' });

    // parseInt('1.5', 10) = 1: valid index within bounds → Strategy A succeeds
    // This test documents that the implementation resolves '1.5' to index 1
    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('llm_food_match');
    // Only 1 LLM call (Strategy A succeeded)
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
  });

  it('Strategy A: LLM returns multiple numbers ("1 2") → parseInt picks first token (1) → valid candidate selected', async () => {
    // '1 2' → parseInt('1 2', 10) = 1 (parseInt stops at the space)
    // Documents that the implementation currently accepts this malformed response
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: MOCK_TRIGRAM_CANDIDATES })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_NUTRIENT_ROW] });

    mockChatCreate.mockResolvedValueOnce(makeChatResponse('1 2'));     // multi-token response

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'muslo pollo', { openAiApiKey: 'sk-test-key' });

    // parseInt('1 2', 10) = 1: valid index → Strategy A succeeds
    // This test documents current behavior; spec says "only the number"
    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('llm_food_match');
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
  });

  it('Strategy A: LLM returns index with surrounding whitespace ("  0  ") → trim() handles it → valid match', async () => {
    // The implementation calls response.trim() before parseInt — whitespace is safe
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: MOCK_TRIGRAM_CANDIDATES })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_NUTRIENT_ROW] });

    mockChatCreate.mockResolvedValueOnce(makeChatResponse('  0  '));   // padded with spaces

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pechuga pollo', { openAiApiKey: 'sk-test-key' });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('llm_food_match');
    // entityId must be candidates[0]
    expect(result?.result.entityId).toBe(MOCK_FOOD_NUTRIENT_ROW.food_id);
  });

  // -------------------------------------------------------------------------
  // Strategy B — filtering of invalid gram values
  // -------------------------------------------------------------------------

  it('Strategy B: LLM returns ingredient with grams=0 → filtered out → if only item, returns null', async () => {
    // grams=0 fails the `grams > 0` guard → validItems is empty → returns null
    mockExecuteQuery.mockResolvedValueOnce({ rows: [] }); // trigram → Strategy A skipped

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('[{"name": "arroz", "grams": 0}]'),
    );

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'arroz', { openAiApiKey: 'sk-test-key' });

    expect(result).toBeNull();
    // No DB food lookup should happen since validItems is empty
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1); // only the trigram call
  });

  it('Strategy B: LLM returns ingredient with negative grams → filtered out → returns null', async () => {
    // Negative grams fails the `grams > 0` guard
    mockExecuteQuery.mockResolvedValueOnce({ rows: [] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('[{"name": "pollo", "grams": -50}]'),
    );

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pollo', { openAiApiKey: 'sk-test-key' });

    expect(result).toBeNull();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
  });

  it('Strategy B: array has only invalid items (grams=0 and negative) → validItems empty → returns null', async () => {
    // Mix of zero and negative — all filtered
    mockExecuteQuery.mockResolvedValueOnce({ rows: [] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('[{"name": "arroz", "grams": 0}, {"name": "pollo", "grams": -10}, {"name": "sal", "grams": 0}]'),
    );

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'arroz con pollo', { openAiApiKey: 'sk-test-key' });

    expect(result).toBeNull();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
  });

  it('Strategy B: valid and invalid grams mixed → only valid items proceed; invalid silently filtered', async () => {
    // arroz=150g (valid), pollo=0g (filtered), agua=-5g (filtered)
    // Only arroz resolves
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })                      // trigram → skipped
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] }); // arroz exact → found

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('[{"name": "arroz", "grams": 150}, {"name": "pollo", "grams": 0}, {"name": "agua", "grams": -5}]'),
    );

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'arroz con pollo', { openAiApiKey: 'sk-test-key' });

    // Only arroz is valid and resolved — result non-null
    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('llm_ingredient_decomposition');
    // totalItems=1 (only valid item), resolved=1 → confidenceLevel=medium
    expect(result?.result.confidenceLevel).toBe('medium');
    // portionGrams = only arroz 150g (invalid items don't contribute grams either)
    expect(result?.result.portionGrams).toBe(150);
  });

  // -------------------------------------------------------------------------
  // Strategy B — duplicate ingredient names
  // -------------------------------------------------------------------------

  it('Strategy B: duplicate ingredient names → each resolved independently and aggregated (nutrients summed twice)', async () => {
    // LLM returns the same ingredient name twice with different gram weights
    // Implementation resolves each via fetchFoodByName (2 DB calls) and aggregates both
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })                       // trigram → skipped
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] })   // first 'arroz' exact → found
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] });  // second 'arroz' exact → found

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('[{"name": "arroz", "grams": 100}, {"name": "arroz", "grams": 50}]'),
    );

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'arroz doble', { openAiApiKey: 'sk-test-key' });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('llm_ingredient_decomposition');
    // portionGrams = 100 + 50 = 150
    expect(result?.result.portionGrams).toBe(150);
    // Both resolved → medium confidence
    expect(result?.result.confidenceLevel).toBe('medium');
    // calories: arroz=130/100g → (130 * 100/100) + (130 * 50/100) = 130 + 65 = 195
    expect(result?.result.nutrients.calories).toBeCloseTo(195, 5);
    // fetchFoodByName called twice (once per duplicate)
    // trigram=1 + arroz_exact_1=1 + arroz_exact_2=1 = 3 DB calls
    expect(mockExecuteQuery).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // Strategy B — markdown-wrapped JSON
  // -------------------------------------------------------------------------

  it('Strategy B: LLM returns markdown-fenced JSON (```json ... ```) → stripped and parsed successfully', async () => {
    const markdownJson = '```json\n[{"name": "pollo", "grams": 200}]\n```';

    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });

    mockChatCreate.mockResolvedValueOnce(makeChatResponse(markdownJson));

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pollo asado', { openAiApiKey: 'sk-test-key' });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('llm_ingredient_decomposition');
    expect(result?.result.portionGrams).toBe(200);
  });

  it('Strategy B: LLM returns markdown-fenced JSON without language tag (``` ... ```) → stripped and parsed', async () => {
    const markdownJson = '```\n[{"name": "arroz", "grams": 100}]\n```';

    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] });

    mockChatCreate.mockResolvedValueOnce(makeChatResponse(markdownJson));

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'arroz blanco', { openAiApiKey: 'sk-test-key' });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('llm_ingredient_decomposition');
  });

  // -------------------------------------------------------------------------
  // Strategy B — empty string from LLM
  // -------------------------------------------------------------------------

  it('Strategy B: LLM returns empty string → JSON.parse("") throws → returns null (graceful)', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [] }); // trigram → skipped

    mockChatCreate.mockResolvedValueOnce(makeChatResponse(''));

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'comida desconocida', { openAiApiKey: 'sk-test-key' });

    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Strategy B — non-array JSON
  // -------------------------------------------------------------------------

  it('Strategy B: LLM returns a JSON object (not array) → isArray check fails → returns null', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"name": "pollo", "grams": 200}'),
    );

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pollo raro', { openAiApiKey: 'sk-test-key' });

    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Strategy B — nutrient aggregation arithmetic
  // -------------------------------------------------------------------------

  it('Strategy B: nutrient aggregation arithmetic — SUM(nutrient * grams / 100) is correct for two ingredients', async () => {
    // arroz (130 cal, 2.70 prot / 100g) at 150g  → calories=195, proteins=4.05
    // pollo (165 cal, 31.00 prot / 100g) at 100g → calories=165, proteins=31.00
    // total: calories=360, proteins=35.05
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })                        // trigram → skipped
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] })    // arroz exact
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });   // pollo exact

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('[{"name": "arroz", "grams": 150}, {"name": "pollo", "grams": 100}]'),
    );

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'arroz con pollo', { openAiApiKey: 'sk-test-key' });

    expect(result).not.toBeNull();
    if (result === null) throw new Error('Expected non-null result');

    const n = result.result.nutrients;

    // calories: (130 * 150/100) + (165 * 100/100) = 195 + 165 = 360
    expect(n.calories).toBeCloseTo(360, 5);

    // proteins: (2.70 * 150/100) + (31.00 * 100/100) = 4.05 + 31.00 = 35.05
    expect(n.proteins).toBeCloseTo(35.05, 5);

    // carbs: (28.20 * 150/100) + (0.00 * 100/100) = 42.30 + 0 = 42.30
    expect(n.carbohydrates).toBeCloseTo(42.30, 5);

    // fats: (0.30 * 150/100) + (3.60 * 100/100) = 0.45 + 3.60 = 4.05
    expect(n.fats).toBeCloseTo(4.05, 5);

    // portionGrams = 150 + 100 = 250
    expect(result.result.portionGrams).toBe(250);

    // referenceBasis must be 'per_serving' for Strategy B
    expect(n.referenceBasis).toBe('per_serving');
  });

  it('Strategy B: nutrient aggregation with single ingredient — portionGrams = single ingredient grams', async () => {
    // Single ingredient: pollo 200g
    // calories: 165 * 200/100 = 330
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('[{"name": "pollo", "grams": 200}]'),
    );

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pollo asado', { openAiApiKey: 'sk-test-key' });

    expect(result).not.toBeNull();
    expect(result?.result.nutrients.calories).toBeCloseTo(330, 5);
    expect(result?.result.portionGrams).toBe(200);
  });

  it('Strategy B: portionGrams includes grams of unresolved ingredients too', async () => {
    // arroz 150g (resolved) + ingrediente_desconocido 50g (unresolved)
    // portionGrams must be 150 + 50 = 200 (per spec: totalGrams = resolved + unresolved)
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })                        // trigram
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] })    // arroz exact → found
      .mockResolvedValueOnce({ rows: [] })                        // ingrediente_desconocido exact → miss
      .mockResolvedValueOnce({ rows: [] });                       // ingrediente_desconocido FTS → miss

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('[{"name": "arroz", "grams": 150}, {"name": "ingrediente_desconocido", "grams": 50}]'),
    );

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'plato especial', { openAiApiKey: 'sk-test-key' });

    expect(result).not.toBeNull();
    // portionGrams = resolved(150) + unresolved(50) = 200
    expect(result?.result.portionGrams).toBe(200);
    // partial resolution → low confidence
    expect(result?.result.confidenceLevel).toBe('low');
  });

  // -------------------------------------------------------------------------
  // callChatCompletion — null content and empty choices
  // -------------------------------------------------------------------------

  it('callChatCompletion: choices[0].message.content is null → returns null → Strategy A falls through to B', async () => {
    // Response with null content (valid OpenAI shape but null message content)
    const nullContentResponse = {
      choices: [{ message: { content: null } }],
      usage: { prompt_tokens: 10, completion_tokens: 0 },
      model: 'gpt-4o-mini',
    };

    mockExecuteQuery
      .mockResolvedValueOnce({ rows: MOCK_TRIGRAM_CANDIDATES })   // trigram for A
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });   // food lookup for B

    mockChatCreate
      .mockResolvedValueOnce(nullContentResponse)                  // Strategy A: null content → null
      .mockResolvedValueOnce(makeChatResponse('[{"name": "pollo", "grams": 150}]')); // Strategy B

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pollo misterioso', { openAiApiKey: 'sk-test-key' });

    // Strategy A returns null (null content), falls through to Strategy B
    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('llm_ingredient_decomposition');
    expect(mockChatCreate).toHaveBeenCalledTimes(2);
  });

  it('callChatCompletion: empty choices array → choices[0] is undefined → content is null → graceful null', async () => {
    // Response with empty choices array: choices[0]?.message?.content → undefined → ?? null
    const emptyChoicesResponse = {
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 0 },
      model: 'gpt-4o-mini',
    };

    // Use trigram with 0 candidates so Strategy A is skipped (no chat call for A)
    // Strategy B gets the empty-choices response
    mockExecuteQuery.mockResolvedValueOnce({ rows: [] }); // trigram → skipped

    mockChatCreate.mockResolvedValueOnce(emptyChoicesResponse); // Strategy B: empty choices

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'plato sin respuesta', { openAiApiKey: 'sk-test-key' });

    expect(result).toBeNull();
    // Only 1 LLM call (Strategy B only — A was skipped by empty trigram)
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Retry logic — 5xx and exhausted retries
  // -------------------------------------------------------------------------

  it('callChatCompletion: retryable 5xx error (500) → retried once → success on second attempt', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: MOCK_TRIGRAM_CANDIDATES })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_NUTRIENT_ROW] });

    const serverError = Object.assign(new Error('Internal Server Error'), { status: 500 });
    mockChatCreate
      .mockRejectedValueOnce(serverError)
      .mockResolvedValueOnce(makeChatResponse('0'));

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pechuga de pollo', { openAiApiKey: 'sk-test-key' });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('llm_food_match');
    expect(mockChatCreate).toHaveBeenCalledTimes(2);
  });

  it('callChatCompletion: both retry attempts exhausted (retryable error twice) → returns null gracefully', async () => {
    // Both Strategy A calls fail with 429 (MAX_RETRIES=2, so loop runs 2 times for A)
    // Then Strategy B also exhausts its 2 retries → total null
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: MOCK_TRIGRAM_CANDIDATES })  // trigram for A
      .mockResolvedValueOnce({ rows: [] });                       // trigram for ... (not reached)

    const rateLimitError = Object.assign(new Error('Rate limit exceeded'), { status: 429 });
    // Strategy A: 2 retries exhausted
    mockChatCreate
      .mockRejectedValueOnce(rateLimitError)  // attempt 1 for A
      .mockRejectedValueOnce(rateLimitError)  // attempt 2 for A (retry exhausted → null)
      // Strategy B: 2 retries exhausted
      .mockRejectedValueOnce(rateLimitError)  // attempt 1 for B
      .mockRejectedValueOnce(rateLimitError); // attempt 2 for B (retry exhausted → null)

    const db = buildMockDb() as never;

    await expect(
      level4Lookup(db, 'pollo raro', { openAiApiKey: 'sk-test-key' }),
    ).resolves.toBeNull();

    // 4 total OpenAI calls: 2 for A (both exhausted) + 2 for B (both exhausted)
    expect(mockChatCreate).toHaveBeenCalledTimes(4);
  });

  it('callChatCompletion: non-retryable error (400) on Strategy A → no retry → Strategy B attempted', async () => {
    // Strategy A gets a 400 (non-retryable) → 1 call, immediate null
    // Strategy B then resolves successfully
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: MOCK_TRIGRAM_CANDIDATES })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });

    const badRequestError = Object.assign(new Error('Bad request'), { status: 400 });
    mockChatCreate
      .mockRejectedValueOnce(badRequestError)                      // Strategy A: 400, no retry
      .mockResolvedValueOnce(makeChatResponse('[{"name": "pollo", "grams": 150}]')); // Strategy B

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pollo rarisimo', { openAiApiKey: 'sk-test-key' });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('llm_ingredient_decomposition');
    // 2 total calls: 1 for A (no retry on 400) + 1 for B
    expect(mockChatCreate).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Both strategies fail → total null
  // -------------------------------------------------------------------------

  it('both Strategy A and Strategy B fail → level4Lookup returns null (total miss)', async () => {
    // Strategy A: LLM returns 'none'
    // Strategy B: LLM returns valid JSON but all ingredients unresolvable
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: MOCK_TRIGRAM_CANDIDATES })   // trigram for A
      .mockResolvedValueOnce({ rows: [] })                        // ingrediente1 exact → miss
      .mockResolvedValueOnce({ rows: [] })                        // ingrediente1 FTS → miss
      .mockResolvedValueOnce({ rows: [] })                        // ingrediente2 exact → miss
      .mockResolvedValueOnce({ rows: [] });                       // ingrediente2 FTS → miss

    mockChatCreate
      .mockResolvedValueOnce(makeChatResponse('none'))             // Strategy A → none
      .mockResolvedValueOnce(
        makeChatResponse('[{"name": "ingrediente1", "grams": 100}, {"name": "ingrediente2", "grams": 50}]'),
      ); // Strategy B → all unresolvable

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'plato completamente desconocido', { openAiApiKey: 'sk-test-key' });

    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Config: OPENAI_CHAT_MAX_TOKENS boundary
  // -------------------------------------------------------------------------

  it('Config: OPENAI_CHAT_MAX_TOKENS=1 → passed to OpenAI call as max_tokens (boundary minimum)', async () => {
    mockConfig.OPENAI_CHAT_MAX_TOKENS = 1;

    mockExecuteQuery
      .mockResolvedValueOnce({ rows: MOCK_TRIGRAM_CANDIDATES })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_NUTRIENT_ROW] });

    mockChatCreate.mockResolvedValueOnce(makeChatResponse('0'));

    const db = buildMockDb() as never;
    await level4Lookup(db, 'pechuga pollo', { openAiApiKey: 'sk-test-key' });

    expect(mockChatCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 1 }),
    );
  });

  it('Config: OPENAI_CHAT_MAX_TOKENS=4096 → passed to OpenAI call as max_tokens (boundary maximum)', async () => {
    mockConfig.OPENAI_CHAT_MAX_TOKENS = 4096;

    mockExecuteQuery
      .mockResolvedValueOnce({ rows: MOCK_TRIGRAM_CANDIDATES })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_NUTRIENT_ROW] });

    mockChatCreate.mockResolvedValueOnce(makeChatResponse('0'));

    const db = buildMockDb() as never;
    await level4Lookup(db, 'pechuga pollo', { openAiApiKey: 'sk-test-key' });

    expect(mockChatCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 4096 }),
    );
  });

  // -------------------------------------------------------------------------
  // Guard: empty string openAiApiKey is falsy → guard fires
  // -------------------------------------------------------------------------

  it('Guard: openAiApiKey is empty string ("") → falsy → returns null without any calls', async () => {
    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pollo asado', { openAiApiKey: '' });

    expect(result).toBeNull();
    expect(mockExecuteQuery).not.toHaveBeenCalled();
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Strategy A — logger.warn called for invalid LLM index
  // -------------------------------------------------------------------------

  it('Strategy A: invalid LLM index logs warn with response and candidateCount', async () => {
    // LLM returns '99' (out of range for 3 candidates) → warn logged
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: MOCK_TRIGRAM_CANDIDATES })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });    // Strategy B fallthrough

    mockChatCreate
      .mockResolvedValueOnce(makeChatResponse('99'))               // out-of-range → warn
      .mockResolvedValueOnce(makeChatResponse('[{"name": "pollo", "grams": 150}]'));

    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const db = buildMockDb() as never;
    await level4Lookup(db, 'pollo extraño', { openAiApiKey: 'sk-test-key', logger: mockLogger });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ response: '99', candidateCount: MOCK_TRIGRAM_CANDIDATES.length }),
      'L4 Strategy A: unexpected LLM response',
    );
  });

  // -------------------------------------------------------------------------
  // Strategy B — entityId is UUID of heaviest resolved ingredient
  // -------------------------------------------------------------------------

  it('Strategy B: entityId in result is UUID of heaviest resolved ingredient (not first)', async () => {
    // arroz=100g, pollo=200g → heaviest is pollo (200g) → entityId = pollo food_id
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })                        // trigram → skipped
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] })    // arroz exact
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });   // pollo exact

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('[{"name": "arroz", "grams": 100}, {"name": "pollo", "grams": 200}]'),
    );

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'pollo con arroz', { openAiApiKey: 'sk-test-key' });

    expect(result).not.toBeNull();
    // Heaviest resolved item is pollo (200g > 100g)
    expect(result?.result.entityId).toBe(MOCK_FOOD_ROW_POLLO.food_id);
    // Not arroz
    expect(result?.result.entityId).not.toBe(MOCK_FOOD_ROW_ARROZ.food_id);
  });

  // -------------------------------------------------------------------------
  // Strategy B — debug/warn logger calls on malformed JSON
  // -------------------------------------------------------------------------

  it('Strategy B: malformed JSON → logger.warn called with "L4 Strategy B: malformed JSON from LLM"', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ rows: [] });

    mockChatCreate.mockResolvedValueOnce(makeChatResponse('this is not json {broken'));

    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'plato raro', {
      openAiApiKey: 'sk-test-key',
      logger: mockLogger,
    });

    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ response: expect.any(String) }),
      'L4 Strategy B: malformed JSON from LLM',
    );
  });

  // -------------------------------------------------------------------------
  // Guard: logger.debug called when L4 is skipped due to missing config
  // -------------------------------------------------------------------------

  it('Guard: logger.debug called when OPENAI_CHAT_MODEL is undefined (L4 skipped)', async () => {
    mockConfig.OPENAI_CHAT_MODEL = undefined;

    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const db = buildMockDb() as never;
    await level4Lookup(db, 'pollo asado', {
      openAiApiKey: 'sk-test-key',
      logger: mockLogger,
    });

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ hasApiKey: true, hasChatModel: false }),
      'L4 skipped: missing config',
    );
  });
});
