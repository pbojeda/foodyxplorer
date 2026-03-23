// F033 — Level 4 Strategy B Prompt Enhancement tests.
//
// Tests:
//   1. Explicit gram amounts: LLM returns exact grams from user query → used as-is
//   2. portion_multiplier: LLM returns multiplier → engine applies to nutrients + portionGrams
//   3. Missing portion_multiplier → defaults to 1.0 (backward compatible)
//   4. Invalid portion_multiplier (<=0) → defaults to 1.0
//   5. Non-numeric portion_multiplier → defaults to 1.0
//   6. Prompt text includes instructions for explicit amounts and portion_multiplier

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

function makeChatResponse(content: string, promptTokens = 50, completionTokens = 5) {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
    model: 'gpt-4o-mini',
  };
}

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

const MOCK_FOOD_ROW_LENTEJAS = {
  food_id: 'fd000000-0024-4000-a000-000000000012',
  food_name: 'Lentils, cooked',
  food_name_es: 'Lentejas cocidas',
  calories: '116.00',
  proteins: '9.00',
  carbohydrates: '20.10',
  sugars: '1.80',
  fats: '0.40',
  saturated_fats: '0.10',
  fiber: '7.90',
  salt: '0.00',
  sodium: '2.00',
  trans_fats: '0.00',
  cholesterol: '0.00',
  potassium: '369.00',
  monounsaturated_fats: '0.10',
  polyunsaturated_fats: '0.20',
  reference_basis: 'per_100g',
  source_id: 'fd000000-0024-4000-a000-000000000099',
  source_name: 'USDA FoodData Central',
  source_type: 'official',
  source_url: 'https://fdc.nal.usda.gov/',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F033 — Strategy B prompt enhancement', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockConfig.OPENAI_CHAT_MODEL = 'gpt-4o-mini';
    mockConfig.OPENAI_CHAT_MAX_TOKENS = 512;
    MockOpenAI.mockImplementation(() => ({
      chat: { completions: { create: mockChatCreate } },
    }));
  });

  // -------------------------------------------------------------------------
  // Explicit gram amounts
  // -------------------------------------------------------------------------

  it('uses explicit gram amounts from LLM response (200g arroz, 200g pollo)', async () => {
    // Skip Strategy A (no trigram candidates)
    // DB call 1: trigram → empty
    // DB call 2: food-by-name 'arroz' → found
    // DB call 3: food-by-name 'pollo' → found
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_POLLO] });

    // LLM returns exact gram amounts (user said "200g arroz, 200g pollo")
    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('[{"name": "arroz", "grams": 200}, {"name": "pollo", "grams": 200}]'),
    );

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, '200g arroz, 200g pollo', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('llm_ingredient_decomposition');
    expect(result?.result.portionGrams).toBe(400);

    // Verify nutrients: arroz 200g + pollo 200g
    // Calories: (130 * 200/100) + (165 * 200/100) = 260 + 330 = 590
    expect(result?.result.nutrients.calories).toBeCloseTo(590, 1);
    // Proteins: (2.7 * 2) + (31 * 2) = 5.4 + 62 = 67.4
    expect(result?.result.nutrients.proteins).toBeCloseTo(67.4, 1);
  });

  // -------------------------------------------------------------------------
  // Portion multiplier
  // -------------------------------------------------------------------------

  it('applies portion_multiplier to nutrients and portionGrams when LLM returns it', async () => {
    // Skip Strategy A
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_LENTEJAS] });

    // LLM decomposes "plato pequeño de lentejas" with portion_multiplier 0.7
    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "lentejas", "grams": 300}], "portion_multiplier": 0.7}'),
    );

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'plato pequeño de lentejas', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('llm_ingredient_decomposition');

    // portionGrams = 300 * 0.7 = 210
    expect(result?.result.portionGrams).toBeCloseTo(210, 1);
    // Calories: 116 * (300/100) * 0.7 = 116 * 3 * 0.7 = 243.6
    expect(result?.result.nutrients.calories).toBeCloseTo(243.6, 1);
  });

  it('applies portion_multiplier 1.3 for large portion', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_LENTEJAS] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "lentejas", "grams": 300}], "portion_multiplier": 1.3}'),
    );

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'plato grande de lentejas', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).not.toBeNull();
    // portionGrams = 300 * 1.3 = 390
    expect(result?.result.portionGrams).toBeCloseTo(390, 1);
    // Calories: 116 * 3 * 1.3 = 452.4
    expect(result?.result.nutrients.calories).toBeCloseTo(452.4, 1);
  });

  // -------------------------------------------------------------------------
  // Missing / invalid portion_multiplier → defaults to 1.0
  // -------------------------------------------------------------------------

  it('defaults to portion_multiplier 1.0 when LLM omits it (backward compatible)', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] });

    // Old-style response: just an array, no portion_multiplier
    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('[{"name": "arroz", "grams": 150}]'),
    );

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'arroz blanco', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).not.toBeNull();
    // portionGrams = 150 * 1.0 = 150
    expect(result?.result.portionGrams).toBe(150);
    // Calories = 130 * 1.5 = 195
    expect(result?.result.nutrients.calories).toBeCloseTo(195, 1);
  });

  it('defaults to 1.0 when portion_multiplier is zero', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "arroz", "grams": 150}], "portion_multiplier": 0}'),
    );

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'arroz blanco', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).not.toBeNull();
    // Zero multiplier → default 1.0 → portionGrams = 150
    expect(result?.result.portionGrams).toBe(150);
    expect(result?.result.nutrients.calories).toBeCloseTo(195, 1);
  });

  it('defaults to 1.0 when portion_multiplier is negative', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "arroz", "grams": 150}], "portion_multiplier": -0.5}'),
    );

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'arroz blanco', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).not.toBeNull();
    expect(result?.result.portionGrams).toBe(150);
  });

  it('defaults to 1.0 when portion_multiplier is a string', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('{"ingredients": [{"name": "arroz", "grams": 150}], "portion_multiplier": "small"}'),
    );

    const db = buildMockDb() as never;
    const result = await level4Lookup(db, 'arroz blanco', {
      openAiApiKey: 'sk-test-key',
    });

    expect(result).not.toBeNull();
    expect(result?.result.portionGrams).toBe(150);
  });

  // -------------------------------------------------------------------------
  // Prompt content verification
  // -------------------------------------------------------------------------

  it('prompt includes instructions for explicit amounts and portion_multiplier', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [MOCK_FOOD_ROW_ARROZ] });

    mockChatCreate.mockResolvedValueOnce(
      makeChatResponse('[{"name": "arroz", "grams": 200}]'),
    );

    const db = buildMockDb() as never;
    await level4Lookup(db, '200g arroz', {
      openAiApiKey: 'sk-test-key',
    });

    // Verify the prompt sent to OpenAI includes key instructions
    const call = mockChatCreate.mock.calls[0];
    const messages = call?.[0]?.messages as Array<{ role: string; content: string }>;
    const userMsg = messages?.find(m => m.role === 'user')?.content ?? '';

    expect(userMsg).toContain('exact');
    expect(userMsg).toContain('portion_multiplier');
  });
});
