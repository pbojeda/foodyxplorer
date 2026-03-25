// Unit tests for F038 — translate-dish-names.ts
//
// Tests cover: classifyDishName() pure function, runTranslateDishNames()
// with mocked Prisma and OpenAI.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifyDishName,
  runTranslateDishNames,
  type TranslateDishNamesOptions,
  type ClassificationResult,
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

// ---------------------------------------------------------------------------
// BRAND_NAMES used in classifyDishName — must match what the script exports
// ---------------------------------------------------------------------------

const BRAND_NAMES = new Set([
  'Whopper',
  'Big Mac',
  'McFlurry',
  'Croissan\'wich',
  'McRib',
  'Happy Meal',
  'Big King',
]);

// ---------------------------------------------------------------------------
// classifyDishName — pure function tests
// ---------------------------------------------------------------------------

describe('classifyDishName() — brand detection', () => {
  it('classifies "Whopper" as brand_copy', () => {
    const result: ClassificationResult = classifyDishName('Whopper', 'burger-king-es', BRAND_NAMES);
    expect(result.action).toBe('brand_copy');
    expect(result.nameEs).toBe('Whopper');
    expect(result.nameSourceLocale).toBe('en');
  });

  it('classifies "Whopper with Cheese" as brand_copy (substring match)', () => {
    const result = classifyDishName('Whopper with Cheese', 'burger-king-es', BRAND_NAMES);
    expect(result.action).toBe('brand_copy');
    expect(result.nameEs).toBe('Whopper with Cheese');
    expect(result.nameSourceLocale).toBe('en');
  });

  it('classifies "Big Mac" as brand_copy', () => {
    const result = classifyDishName('Big Mac', 'mcdonalds-es', BRAND_NAMES);
    expect(result.action).toBe('brand_copy');
    expect(result.nameEs).toBe('Big Mac');
    expect(result.nameSourceLocale).toBe('en');
  });

  it('classifies "McFlurry Oreo" as brand_copy', () => {
    const result = classifyDishName('McFlurry Oreo', 'mcdonalds-es', BRAND_NAMES);
    expect(result.action).toBe('brand_copy');
  });

  it('does NOT classify "Grilled Chicken" as brand_copy', () => {
    const result = classifyDishName('Grilled Chicken', 'burger-king-es', BRAND_NAMES);
    expect(result.action).not.toBe('brand_copy');
  });
});

describe('classifyDishName() — mixed-language detection', () => {
  it('classifies "Chicken / Pollo" as mixed_copy with nameSourceLocale=mixed', () => {
    const result = classifyDishName('Chicken / Pollo', undefined, BRAND_NAMES);
    expect(result.action).toBe('mixed_copy');
    expect(result.nameSourceLocale).toBe('mixed');
    expect(result.nameEs).toBe('Chicken / Pollo');
  });
});

describe('classifyDishName() — Spanish heuristic', () => {
  it('classifies "Ensalada de pollo con queso" as es_copy (3 indicator words)', () => {
    const result = classifyDishName('Ensalada de pollo con queso', undefined, BRAND_NAMES);
    expect(result.action).toBe('es_copy');
    expect(result.nameSourceLocale).toBe('es');
    expect(result.nameEs).toBe('Ensalada de pollo con queso');
  });

  it('classifies "Pollo sin gluten" as es_copy (2 indicator words: pollo, sin)', () => {
    const result = classifyDishName('Pollo sin gluten', undefined, BRAND_NAMES);
    expect(result.action).toBe('es_copy');
    expect(result.nameSourceLocale).toBe('es');
  });

  it('does NOT classify "Pollo" alone as es_copy (only 1 indicator word)', () => {
    const result = classifyDishName('Pollo', undefined, BRAND_NAMES);
    // Should fall through to short_copy (5 chars > 3) then llm_translate
    expect(result.action).not.toBe('es_copy');
  });
});

describe('classifyDishName() — short/ambiguous names', () => {
  it('classifies "XL" (2 chars) as short_copy', () => {
    const result = classifyDishName('XL', undefined, BRAND_NAMES);
    expect(result.action).toBe('short_copy');
    expect(result.nameSourceLocale).toBe('unknown');
    expect(result.nameEs).toBe('XL');
  });

  it('classifies "BLT" (3 chars) as short_copy', () => {
    const result = classifyDishName('BLT', undefined, BRAND_NAMES);
    expect(result.action).toBe('short_copy');
    expect(result.nameSourceLocale).toBe('unknown');
  });

  it('does NOT classify "Club" (4 chars) as short_copy → falls to llm_translate', () => {
    const result = classifyDishName('Club', undefined, BRAND_NAMES);
    expect(result.action).not.toBe('short_copy');
  });
});

describe('classifyDishName() — code/non-alpha detection', () => {
  it('classifies "1234" as code_copy', () => {
    const result = classifyDishName('1234', undefined, BRAND_NAMES);
    expect(result.action).toBe('code_copy');
    expect(result.nameSourceLocale).toBe('unknown');
    expect(result.nameEs).toBe('1234');
  });

  it('classifies "X-5" (3 chars — hits short_copy before code_copy) as short_copy', () => {
    // "X-5" is 3 chars so short_copy rule (step 4) fires before code_copy (step 5)
    const result = classifyDishName('X-5', undefined, BRAND_NAMES);
    expect(result.action).toBe('short_copy');
    expect(result.nameSourceLocale).toBe('unknown');
  });

  it('classifies "12345" (5 chars, all non-alpha tokens) as code_copy', () => {
    const result = classifyDishName('12345', undefined, BRAND_NAMES);
    expect(result.action).toBe('code_copy');
    expect(result.nameSourceLocale).toBe('unknown');
  });
});

describe('classifyDishName() — LLM path', () => {
  it('classifies "Grilled Chicken Salad" as llm_translate', () => {
    const result = classifyDishName('Grilled Chicken Salad', 'burger-king-es', BRAND_NAMES);
    expect(result.action).toBe('llm_translate');
    expect(result.nameSourceLocale).toBe('en');
    expect(result.nameEs).toBeUndefined();
  });

  it('classifies "Classic Burger" as llm_translate', () => {
    const result = classifyDishName('Classic Burger', 'burger-king-es', BRAND_NAMES);
    expect(result.action).toBe('llm_translate');
    expect(result.nameSourceLocale).toBe('en');
  });
});

// ---------------------------------------------------------------------------
// runTranslateDishNames — integration tests with mocked deps
// ---------------------------------------------------------------------------

const BASE_OPTS: TranslateDishNamesOptions = {
  dryRun: false,
  batchSize: 50,
  force: false,
};

describe('runTranslateDishNames() — dry-run mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['OPENAI_API_KEY'] = 'test-key';
  });

  it('does not call prisma.dish.update in dry-run mode', async () => {
    const mockPrisma = makeMockPrisma([
      { id: 'dish-1', name: 'Whopper', restaurant: { chainSlug: 'burger-king-es' } },
      { id: 'dish-2', name: 'Grilled Chicken Salad', restaurant: { chainSlug: 'burger-king-es' } },
    ]);

    const summary = await runTranslateDishNames(
      { ...BASE_OPTS, dryRun: true },
      mockPrisma as unknown as Parameters<typeof runTranslateDishNames>[1],
    );

    expect(mockPrisma.dish.update).not.toHaveBeenCalled();
    expect(summary.total).toBe(2);
    expect(summary.skipped).toBe(2); // dry-run counts as skipped
  });
});

describe('runTranslateDishNames() — happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['OPENAI_API_KEY'] = 'test-key';
  });

  it('handles 1 brand, 1 Spanish, 1 LLM dish — calls update 3 times with correct data', async () => {
    const mockPrisma = makeMockPrisma([
      { id: 'dish-1', name: 'Whopper', restaurant: { chainSlug: 'burger-king-es' } },
      { id: 'dish-2', name: 'Ensalada de pollo con queso', restaurant: { chainSlug: 'telepizza-es' } },
      { id: 'dish-3', name: 'Grilled Chicken Salad', restaurant: { chainSlug: 'burger-king-es' } },
    ]);

    mockChatCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify(['Ensalada de Pollo a la Plancha']),
          },
        },
      ],
      usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
    });

    const summary = await runTranslateDishNames(
      BASE_OPTS,
      mockPrisma as unknown as Parameters<typeof runTranslateDishNames>[1],
    );

    expect(mockPrisma.dish.update).toHaveBeenCalledTimes(3);

    // Brand: nameEs = name, nameSourceLocale = 'en'
    expect(mockPrisma.dish.update).toHaveBeenCalledWith({
      where: { id: 'dish-1' },
      data: { nameEs: 'Whopper', nameSourceLocale: 'en' },
    });

    // Spanish: nameEs = name, nameSourceLocale = 'es'
    expect(mockPrisma.dish.update).toHaveBeenCalledWith({
      where: { id: 'dish-2' },
      data: { nameEs: 'Ensalada de pollo con queso', nameSourceLocale: 'es' },
    });

    // LLM: nameEs = translated string, nameSourceLocale = 'en'
    expect(mockPrisma.dish.update).toHaveBeenCalledWith({
      where: { id: 'dish-3' },
      data: { nameEs: 'Ensalada de Pollo a la Plancha', nameSourceLocale: 'en' },
    });

    expect(summary.total).toBe(3);
    expect(summary.failed).toBe(0);
    expect(summary.translated).toBe(1);
    expect(summary.brandCopy).toBe(1);
    expect(summary.esCopy).toBe(1);
  });
});

describe('runTranslateDishNames() — OpenAI JSON parse failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['OPENAI_API_KEY'] = 'test-key';
  });

  it('skips entire batch and increments failed count on JSON parse failure', async () => {
    const mockPrisma = makeMockPrisma([
      { id: 'dish-1', name: 'Grilled Chicken Salad', restaurant: { chainSlug: 'burger-king-es' } },
      { id: 'dish-2', name: 'Classic Burger', restaurant: { chainSlug: 'burger-king-es' } },
    ]);

    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: 'not valid json at all' } }],
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
    });

    const summary = await runTranslateDishNames(
      BASE_OPTS,
      mockPrisma as unknown as Parameters<typeof runTranslateDishNames>[1],
    );

    // No updates should be written for LLM batch that failed
    expect(mockPrisma.dish.update).not.toHaveBeenCalled();
    expect(summary.failed).toBe(2); // Both dishes in the batch failed
    expect(summary.translated).toBe(0);
  });
});

describe('runTranslateDishNames() — array length mismatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['OPENAI_API_KEY'] = 'test-key';
  });

  it('skips batch without partial writes when response array length mismatches', async () => {
    const mockPrisma = makeMockPrisma([
      { id: 'dish-1', name: 'Grilled Chicken', restaurant: { chainSlug: 'burger-king-es' } },
      { id: 'dish-2', name: 'Classic Burger', restaurant: { chainSlug: 'burger-king-es' } },
    ]);

    // OpenAI returns 1 item but we sent 2
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(['Pollo a la Plancha']) } }],
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
    });

    const summary = await runTranslateDishNames(
      BASE_OPTS,
      mockPrisma as unknown as Parameters<typeof runTranslateDishNames>[1],
    );

    expect(mockPrisma.dish.update).not.toHaveBeenCalled();
    expect(summary.failed).toBe(2);
  });
});

describe('runTranslateDishNames() — missing OPENAI_API_KEY', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['OPENAI_API_KEY'];
  });

  it('throws a fatal error when OPENAI_API_KEY is missing and LLM dishes exist', async () => {
    const mockPrisma = makeMockPrisma([
      { id: 'dish-1', name: 'Grilled Chicken Salad', restaurant: { chainSlug: 'burger-king-es' } },
    ]);

    await expect(
      runTranslateDishNames(
        BASE_OPTS,
        mockPrisma as unknown as Parameters<typeof runTranslateDishNames>[1],
      ),
    ).rejects.toThrow(/OPENAI_API_KEY/);
  });
});

describe('runTranslateDishNames() — --force flag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['OPENAI_API_KEY'] = 'test-key';
  });

  it('queries all dishes (not just null nameEs) when force=true', async () => {
    const mockPrisma = makeMockPrisma([]);

    await runTranslateDishNames(
      { ...BASE_OPTS, force: true },
      mockPrisma as unknown as Parameters<typeof runTranslateDishNames>[1],
    );

    // With force=true, the findMany call should NOT filter by nameEs: null
    const findManyCall = mockPrisma.dish.findMany.mock.calls[0];
    const whereArg = findManyCall?.[0]?.where as Record<string, unknown> | undefined;
    expect(whereArg?.['nameEs']).toBeUndefined();
  });

  it('filters by nameEs: null when force=false', async () => {
    const mockPrisma = makeMockPrisma([]);

    await runTranslateDishNames(
      { ...BASE_OPTS, force: false },
      mockPrisma as unknown as Parameters<typeof runTranslateDishNames>[1],
    );

    const findManyCall = mockPrisma.dish.findMany.mock.calls[0];
    const whereArg = findManyCall?.[0]?.where as Record<string, unknown> | undefined;
    expect(whereArg?.['nameEs']).toBe(null);
  });
});

describe('runTranslateDishNames() — --chain filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['OPENAI_API_KEY'] = 'test-key';
  });

  it('adds restaurant.chainSlug filter when chainSlug option is provided', async () => {
    const mockPrisma = makeMockPrisma([]);

    await runTranslateDishNames(
      { ...BASE_OPTS, chainSlug: 'burger-king-es' },
      mockPrisma as unknown as Parameters<typeof runTranslateDishNames>[1],
    );

    const findManyCall = mockPrisma.dish.findMany.mock.calls[0];
    const whereArg = findManyCall?.[0]?.where as Record<string, unknown> | undefined;
    const restaurantArg = whereArg?.['restaurant'] as Record<string, unknown> | undefined;
    expect(restaurantArg?.['chainSlug']).toBe('burger-king-es');
  });
});
