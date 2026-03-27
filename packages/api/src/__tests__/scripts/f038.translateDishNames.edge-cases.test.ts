// Edge case tests for F038 — translate-dish-names.ts
//
// Targets bugs and spec deviations NOT covered by the developer's existing
// f038.translateDishNames.unit.test.ts.
//
// Confirmed bugs exposed here:
//
// BUG-2: Dry-run mode exits before classification; bucket counts (brandCopy,
//         esCopy, etc.) are never populated even though no DB writes occur.
//         The spec §4.5 requires printing a table per dish in dry-run mode, and
//         the TranslationSummary should reflect classification counts so callers
//         can audit what WOULD happen.
//
// BUG-3: False-positive Spanish detection — 'pizza' and 'salsa' are also
//         common English words in English-language chain menus. An English dish
//         like "Pepperoni Pizza with Salsa" → 2 indicator hits → es_copy
//         instead of llm_translate (the name would not be translated).
//
// BUG-4: 'de' is in the Spanish indicator list. It is a legitimate English
//         preposition too (e.g., "Chicken de Mayo Salsa Wrap"). Combined with
//         one other indicator it triggers es_copy on names that should go to LLM.
//
// BUG-5: OPENAI_API_KEY is validated at the very start of runTranslateDishNames,
//         before any classification. When ALL dishes are brand/es/short/code/mixed
//         copies (no LLM call needed), the API key guard still throws, preventing
//         non-LLM-only runs from completing without a key configured.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifyDishName,
  runTranslateDishNames,
  BRAND_NAMES,
  type TranslateDishNamesOptions,
} from '../../scripts/translate-dish-names.js';

// ---------------------------------------------------------------------------
// Mock OpenAI
// ---------------------------------------------------------------------------

const mockChatCreate = vi.fn();

vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockChatCreate,
        },
      },
    })),
  };
});

// ---------------------------------------------------------------------------
// Mock Prisma helpers
// ---------------------------------------------------------------------------

function makeMockPrisma(dishes: {
  id: string;
  name: string;
  restaurant: { chainSlug: string } | null;
}[]) {
  const findMany = vi.fn().mockResolvedValue(dishes);
  const update = vi.fn().mockResolvedValue({});
  return {
    dish: { findMany, update },
    $disconnect: vi.fn(),
  };
}

const BASE_OPTS: TranslateDishNamesOptions = {
  dryRun: false,
  batchSize: 50,
  force: false,
};

// ---------------------------------------------------------------------------
// BUG-3 & BUG-4 — False-positive Spanish indicator detection
// ---------------------------------------------------------------------------

describe('classifyDishName() — Spanish indicator false positives (BUG-3, BUG-4)', () => {
  // BUG-3: 'pizza' and 'salsa' are in the indicator list but are also English
  // words. A purely English-language dish like "Pepperoni Pizza with Salsa"
  // would be misclassified as es_copy instead of being translated by the LLM.
  it('BUG-3: "Pepperoni Pizza with Salsa" should NOT be es_copy (pizza+salsa are also English)', () => {
    const result = classifyDishName('Pepperoni Pizza with Salsa', 'burger-king-es', BRAND_NAMES);
    // Currently FAILS: the implementation classifies this as es_copy (2 indicators)
    // Expected: llm_translate (both words are ambiguous, name is clearly English-language)
    expect(result.action).toBe('llm_translate');
  });

  // BUG-3: "BBQ Pizza" is an English dish that happens to contain 'pizza'
  it('BUG-3: "BBQ Pizza" with single ambiguous indicator should be llm_translate', () => {
    // Only 1 indicator word ('pizza') — should reach llm_translate, not es_copy
    const result = classifyDishName('BBQ Pizza', 'burger-king-es', BRAND_NAMES);
    expect(result.action).not.toBe('es_copy');
  });

  // BUG-4: 'de' is a common English preposition in dish names like "Café de Paris"
  // When combined with 'salsa', 'pizza', or another indicator, it falsely triggers es_copy.
  it('BUG-4: "Chicken de Mayo Salsa Wrap" should be llm_translate not es_copy', () => {
    // 'de' + 'salsa' = 2 Spanish indicator hits → currently classified es_copy
    // But the name is clearly English and should be translated
    const result = classifyDishName('Chicken de Mayo Salsa Wrap', undefined, BRAND_NAMES);
    // This test exposes the bug: result.action will be 'es_copy' but should be 'llm_translate'
    expect(result.action).toBe('llm_translate');
  });

  // BUG-4: 'menu' appears in English usage too ("Menu del Día" is Spanish, but
  // "Chicken Menu Combo" is not). Combined with another indicator it causes false es_copy.
  it('BUG-4: "Grilled Chicken Menu with Salsa" → "menu"+"salsa" = 2 indicators → false es_copy', () => {
    const result = classifyDishName('Grilled Chicken Menu with Salsa', undefined, BRAND_NAMES);
    // Currently FAILS: classified as es_copy due to menu+salsa indicators
    // Should be: llm_translate (the name is English)
    expect(result.action).toBe('llm_translate');
  });
});

// ---------------------------------------------------------------------------
// BUG-2 — Dry-run mode exits before classification (bucket counts are 0)
// ---------------------------------------------------------------------------

describe('runTranslateDishNames() — dry-run does not compute bucket counts (BUG-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['OPENAI_API_KEY'] = 'test-key';
  });

  it('BUG-2: dry-run summary should still reflect classification counts (not all 0)', async () => {
    const dishes = [
      { id: 'dish-1', name: 'Whopper', restaurant: { chainSlug: 'burger-king-es' } },
      { id: 'dish-2', name: 'Ensalada de pollo con queso', restaurant: { chainSlug: 'telepizza-es' } },
      { id: 'dish-3', name: 'Grilled Chicken Salad', restaurant: { chainSlug: 'burger-king-es' } },
      { id: 'dish-4', name: 'XL', restaurant: { chainSlug: 'burger-king-es' } },
    ];

    const summary = await runTranslateDishNames(
      { ...BASE_OPTS, dryRun: true },
      makeMockPrisma(dishes) as unknown as Parameters<typeof runTranslateDishNames>[1],
    );

    // Currently FAILS: implementation exits early, bucket counts are all 0.
    // After fix, these should reflect actual classification:
    expect(summary.brandCopy).toBe(1);   // Whopper
    expect(summary.esCopy).toBe(1);      // Ensalada de pollo con queso
    expect(summary.shortCopy).toBe(1);   // XL (2 chars)
    // No DB writes must occur
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it('BUG-2: dry-run should NOT call OPENAI but SHOULD classify dishes', async () => {
    const dishes = [
      { id: 'dish-1', name: 'Whopper', restaurant: { chainSlug: 'burger-king-es' } },
    ];

    const summary = await runTranslateDishNames(
      { ...BASE_OPTS, dryRun: true },
      makeMockPrisma(dishes) as unknown as Parameters<typeof runTranslateDishNames>[1],
    );

    // OpenAI must never be called in dry-run
    expect(mockChatCreate).not.toHaveBeenCalled();
    // But brand classification should still be counted
    expect(summary.brandCopy).toBe(1);
    expect(summary.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// BUG-5 — API key check blocks non-LLM-only runs
// ---------------------------------------------------------------------------

describe('runTranslateDishNames() — OPENAI_API_KEY required even for non-LLM dishes (BUG-5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['OPENAI_API_KEY'];
  });

  it('BUG-5: missing OPENAI_API_KEY should NOT block execution when all dishes are brand_copy', async () => {
    // When all dishes are brand names (no LLM needed), the script should complete
    // successfully without requiring OPENAI_API_KEY.
    // Currently FAILS because the API key guard fires before any classification.
    const dishes = [
      { id: 'dish-1', name: 'Whopper', restaurant: { chainSlug: 'burger-king-es' } },
      { id: 'dish-2', name: 'Big Mac', restaurant: { chainSlug: 'mcdonalds-es' } },
      { id: 'dish-3', name: 'McFlurry', restaurant: { chainSlug: 'mcdonalds-es' } },
    ];

    const mockPrisma = makeMockPrisma(dishes);

    // This should succeed (no LLM needed) but currently throws due to BUG-5
    const result = await runTranslateDishNames(
      BASE_OPTS,
      mockPrisma as unknown as Parameters<typeof runTranslateDishNames>[1],
    );

    expect(result.brandCopy).toBe(3);
    expect(result.failed).toBe(0);
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it('BUG-5: missing OPENAI_API_KEY for dry-run with brand dishes should not throw', async () => {
    const dishes = [
      { id: 'dish-1', name: 'Whopper', restaurant: { chainSlug: 'burger-king-es' } },
    ];

    const mockPrisma = makeMockPrisma(dishes);

    // Dry-run with only brand dishes — API key is irrelevant but currently throws
    await expect(
      runTranslateDishNames(
        { ...BASE_OPTS, dryRun: true },
        mockPrisma as unknown as Parameters<typeof runTranslateDishNames>[1],
      ),
    ).resolves.toBeDefined(); // Should NOT reject
  });
});

// ---------------------------------------------------------------------------
// Additional edge cases — not covered by developer tests
// ---------------------------------------------------------------------------

describe('classifyDishName() — additional edge cases', () => {
  // Edge case from spec §9: "Big Mac Salad" — brand is a prefix of a larger name
  it('spec §9: "Big Mac Salad" classified as brand_copy (brand detection is substring)', () => {
    const result = classifyDishName('Big Mac Salad', 'mcdonalds-es', BRAND_NAMES);
    // The regex uses whole-word boundary — "Big Mac" IS a whole word within the name
    expect(result.action).toBe('brand_copy');
    expect(result.nameEs).toBe('Big Mac Salad');
  });

  // Edge case: empty string — spec §9 says skip and log error
  // But classifyDishName is pure (no logging) and empty string has length 0 ≤ 3 → short_copy
  it('empty string (after trim) classified as short_copy (zero length ≤ 3)', () => {
    const result = classifyDishName('', undefined, BRAND_NAMES);
    expect(result.action).toBe('short_copy');
    expect(result.nameEs).toBe('');
  });

  it('whitespace-only string classified as short_copy', () => {
    const result = classifyDishName('   ', undefined, BRAND_NAMES);
    expect(result.action).toBe('short_copy');
  });

  // Edge case: very long code-like name (>3 chars, all digits)
  it('"99999" (all digits, 5 chars) → code_copy', () => {
    const result = classifyDishName('99999', undefined, BRAND_NAMES);
    expect(result.action).toBe('code_copy');
    expect(result.nameSourceLocale).toBe('unknown');
  });

  // Edge case: accented English name — spec says treat as English unless 2+ indicators
  it('"Café Latte" (accented but English) → llm_translate, not es_copy', () => {
    const result = classifyDishName('Café Latte', undefined, BRAND_NAMES);
    // No Spanish indicator words → goes to LLM
    expect(result.action).toBe('llm_translate');
    expect(result.nameSourceLocale).toBe('en');
  });

  // Edge case: "/" separator without spaces should NOT trigger mixed_copy
  // Spec says " / " (with spaces) — "Chicken/Pollo" (no spaces) should fall through
  it('"Chicken/Pollo" without spaces does NOT trigger mixed_copy', () => {
    const result = classifyDishName('Chicken/Pollo', undefined, BRAND_NAMES);
    // The regex is / \/ / (requires spaces) — "Chicken/Pollo" has no spaces around /
    // 'pollo' alone (1 indicator) → llm_translate
    expect(result.action).not.toBe('mixed_copy');
    expect(result.action).toBe('llm_translate');
  });

  // Edge case: brand name with different casing
  it('"WHOPPER" (all-caps) classified as brand_copy (case-insensitive match)', () => {
    const result = classifyDishName('WHOPPER', 'burger-king-es', BRAND_NAMES);
    expect(result.action).toBe('brand_copy');
    expect(result.nameEs).toBe('WHOPPER');
  });

  // Edge case: brand name at end of string
  it('"Cheese Whopper" classified as brand_copy (brand at end)', () => {
    const result = classifyDishName('Cheese Whopper', 'burger-king-es', BRAND_NAMES);
    expect(result.action).toBe('brand_copy');
  });
});

describe('runTranslateDishNames() — retry logic (spec §4.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['OPENAI_API_KEY'] = 'test-key';
  });

  it('a 429 rate-limit error SHOULD be retried up to 3 times', async () => {
    const mockPrisma = makeMockPrisma([
      { id: 'dish-1', name: 'Grilled Chicken Salad', restaurant: { chainSlug: 'burger-king-es' } },
    ]);

    const rateLimitError = new Error('Request failed with status 429: rate limit exceeded');
    // First 2 attempts fail with 429, 3rd succeeds
    mockChatCreate
      .mockRejectedValueOnce(rateLimitError)
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(['Ensalada de Pollo']) } }],
        usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
      });

    const summary = await runTranslateDishNames(
      BASE_OPTS,
      mockPrisma as unknown as Parameters<typeof runTranslateDishNames>[1],
    );

    // Should have retried and ultimately succeeded
    expect(summary.translated).toBe(1);
    expect(summary.failed).toBe(0);
    expect(mockChatCreate).toHaveBeenCalledTimes(3);
  }, 30000);

  it('a 500 server error SHOULD be retried (5xx)', async () => {
    const mockPrisma = makeMockPrisma([
      { id: 'dish-1', name: 'Grilled Chicken', restaurant: { chainSlug: 'burger-king-es' } },
    ]);

    const serverError = new Error('Request failed with status 500: Internal Server Error');
    mockChatCreate.mockRejectedValue(serverError);

    const summary = await runTranslateDishNames(
      BASE_OPTS,
      mockPrisma as unknown as Parameters<typeof runTranslateDishNames>[1],
    );

    // Should retry 3 times on a 500 error then fail
    expect(mockChatCreate).toHaveBeenCalledTimes(3);
    expect(summary.failed).toBe(1);
  }, 30000);

  it('a TypeError (non-retryable) should NOT be retried', async () => {
    const mockPrisma = makeMockPrisma([
      { id: 'dish-1', name: 'Grilled Chicken Salad', restaurant: { chainSlug: 'burger-king-es' } },
    ]);

    const typeError = new TypeError("Cannot read properties of null");
    mockChatCreate.mockRejectedValue(typeError);

    const summary = await runTranslateDishNames(
      BASE_OPTS,
      mockPrisma as unknown as Parameters<typeof runTranslateDishNames>[1],
    );

    // Should NOT retry a TypeError — only 1 attempt
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    expect(summary.failed).toBe(1);
  });
});

describe('runTranslateDishNames() — OpenAI returns null content', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['OPENAI_API_KEY'] = 'test-key';
  });

  it('handles OpenAI returning null message content — batch skipped as failed', async () => {
    // OpenAI API can return null content in some edge cases (e.g., content filtering)
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: null } }],
      usage: { prompt_tokens: 20, completion_tokens: 0, total_tokens: 20 },
    });

    const mockPrisma = makeMockPrisma([
      { id: 'dish-1', name: 'Grilled Chicken', restaurant: { chainSlug: 'burger-king-es' } },
    ]);

    const summary = await runTranslateDishNames(
      BASE_OPTS,
      mockPrisma as unknown as Parameters<typeof runTranslateDishNames>[1],
    );

    // null content: response = null, success = true → hits the `response === null` branch
    // → batch skipped as failed
    expect(mockPrisma.dish.update).not.toHaveBeenCalled();
    expect(summary.failed).toBe(1);
  });

  it('handles OpenAI returning empty choices array', async () => {
    mockChatCreate.mockResolvedValue({
      choices: [],
      usage: { prompt_tokens: 20, completion_tokens: 0, total_tokens: 20 },
    });

    const mockPrisma = makeMockPrisma([
      { id: 'dish-1', name: 'Grilled Chicken', restaurant: { chainSlug: 'burger-king-es' } },
    ]);

    const summary = await runTranslateDishNames(
      BASE_OPTS,
      mockPrisma as unknown as Parameters<typeof runTranslateDishNames>[1],
    );

    // choices[0] undefined → content = null → response = null → batch skipped
    expect(summary.failed).toBe(1);
  });

  it('handles OpenAI returning a JSON object (not array) — skips batch', async () => {
    // LLM ignores instructions and returns a JSON object instead of an array
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ translations: ['Pollo'] }) } }],
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
    });

    const mockPrisma = makeMockPrisma([
      { id: 'dish-1', name: 'Grilled Chicken', restaurant: { chainSlug: 'burger-king-es' } },
    ]);

    const summary = await runTranslateDishNames(
      BASE_OPTS,
      mockPrisma as unknown as Parameters<typeof runTranslateDishNames>[1],
    );

    // Object is not an array → validation fails → batch skipped
    expect(mockPrisma.dish.update).not.toHaveBeenCalled();
    expect(summary.failed).toBe(1);
  });
});

describe('runTranslateDishNames() — translation contains non-string elements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['OPENAI_API_KEY'] = 'test-key';
  });

  it('handles non-string element in translation array — that dish fails, others succeed', async () => {
    // OpenAI returns correct length but one element is null/number
    const dishes = [
      { id: 'dish-1', name: 'Grilled Chicken', restaurant: { chainSlug: 'burger-king-es' } },
      { id: 'dish-2', name: 'Classic Burger', restaurant: { chainSlug: 'burger-king-es' } },
    ];

    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify([null, 'Hamburguesa Clásica']) } }],
      usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
    });

    const mockPrisma = makeMockPrisma(dishes);
    const summary = await runTranslateDishNames(
      BASE_OPTS,
      mockPrisma as unknown as Parameters<typeof runTranslateDishNames>[1],
    );

    // dish-1: null is not string → failed; dish-2: succeeded
    expect(summary.translated).toBe(1);
    expect(summary.failed).toBe(1);
    expect(mockPrisma.dish.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.dish.update).toHaveBeenCalledWith({
      where: { id: 'dish-2' },
      data: { nameEs: 'Hamburguesa Clásica', nameSourceLocale: 'en' },
    });
  });
});

describe('runTranslateDishNames() — DB write failure for non-LLM dish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['OPENAI_API_KEY'] = 'test-key';
  });

  it('DB write failure for a brand dish increments failed, continues with next dish', async () => {
    const dishes = [
      { id: 'dish-1', name: 'Whopper', restaurant: { chainSlug: 'burger-king-es' } },
      { id: 'dish-2', name: 'Big Mac', restaurant: { chainSlug: 'mcdonalds-es' } },
    ];

    const mockPrisma = makeMockPrisma(dishes);
    // First update fails, second succeeds
    mockPrisma.dish.update
      .mockRejectedValueOnce(new Error('DB write error'))
      .mockResolvedValueOnce({});

    const summary = await runTranslateDishNames(
      BASE_OPTS,
      mockPrisma as unknown as Parameters<typeof runTranslateDishNames>[1],
    );

    expect(summary.failed).toBe(1);
    expect(summary.brandCopy).toBe(1); // dish-2 succeeded
    expect(mockPrisma.dish.update).toHaveBeenCalledTimes(2);
  });
});

describe('runTranslateDishNames() — batchSize boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['OPENAI_API_KEY'] = 'test-key';
  });

  it('batchSize=1 processes each LLM dish as a single-item batch', async () => {
    const dishes = [
      { id: 'dish-1', name: 'Grilled Chicken Salad', restaurant: { chainSlug: 'burger-king-es' } },
      { id: 'dish-2', name: 'Classic Burger', restaurant: { chainSlug: 'burger-king-es' } },
    ];

    mockChatCreate
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(['Ensalada de Pollo a la Plancha']) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(['Hamburguesa Clásica']) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

    const mockPrisma = makeMockPrisma(dishes);
    const summary = await runTranslateDishNames(
      { ...BASE_OPTS, batchSize: 1 },
      mockPrisma as unknown as Parameters<typeof runTranslateDishNames>[1],
    );

    // 2 dishes → 2 separate LLM calls when batchSize=1
    expect(mockChatCreate).toHaveBeenCalledTimes(2);
    expect(summary.translated).toBe(2);
    expect(summary.failed).toBe(0);
  });
});
