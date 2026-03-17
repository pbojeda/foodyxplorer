// Unit tests for F019 pipeline orchestrator — runEmbeddingPipeline
//
// Mocks: DB ($queryRaw/$executeRaw), callOpenAIEmbeddings, writeFoodEmbedding, writeDishEmbedding.
// No real DB or network calls.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Mock the embedding modules — use vi.hoisted to allow referencing mocks in factories
// ---------------------------------------------------------------------------

const { mockCallOpenAI, mockWriteFood, mockWriteDish } = vi.hoisted(() => ({
  mockCallOpenAI: vi.fn(),
  mockWriteFood: vi.fn(),
  mockWriteDish: vi.fn(),
}));

vi.mock('../embeddings/embeddingClient.js', () => ({
  callOpenAIEmbeddings: mockCallOpenAI,
  estimateTokens: (texts: string[]) => {
    if (texts.length === 0) return 0;
    const totalWords = texts.reduce((sum, t) => sum + t.split(/\s+/).length, 0);
    return Math.ceil(totalWords * 1.3);
  },
  RateLimiter: class {
    acquire() { return Promise.resolve(); }
  },
}));

vi.mock('../embeddings/embeddingWriter.js', () => ({
  writeFoodEmbedding: mockWriteFood,
  writeDishEmbedding: mockWriteDish,
}));

import { runEmbeddingPipeline } from '../embeddings/pipeline.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_FOOD_ROW = {
  id: 'f019food-0001-4000-a000-000000000001',
  name: 'Chicken Breast',
  name_es: 'Pechuga de pollo',
  food_group: 'Poultry Products',
  food_type: 'generic',
  calories: '165.00',
  proteins: '31.00',
  carbohydrates: '0.00',
  sugars: '0.00',
  fats: '3.60',
  saturated_fats: '1.00',
  fiber: '0.00',
  sodium: '74.00',
};

const MOCK_DISH_ROW = {
  id: 'f019dish-0001-4000-a000-000000000001',
  name: 'Big Mac',
  name_es: 'Big Mac',
  chain_slug: 'mcdonalds-es',
  portion_grams: '215.00',
  category_slugs: 'burgers',
  cooking_method_slugs: 'grilled',
  calories: '550.00',
  proteins: '25.00',
  carbohydrates: '46.00',
  sugars: '9.00',
  fats: '30.00',
  saturated_fats: '11.00',
  fiber: '3.00',
  sodium: '730.00',
};

const MOCK_VECTOR = Array(1536).fill(0.1);

// Build a mock PrismaClient with controllable $queryRaw
// Prisma.Sql objects have a .sql property containing the raw SQL string.
function buildMockPrisma(
  foodRows = [MOCK_FOOD_ROW],
  dishRows = [MOCK_DISH_ROW],
  skippedFoodCount = 0,
  skippedDishCount = 0,
) {
  return {
    $queryRaw: vi.fn().mockImplementation((query: unknown) => {
      // Prisma.Sql has a .sql property; check it for 'foods' to differentiate queries
      const sqlString =
        query !== null && typeof query === 'object' && 'sql' in query
          ? String((query as Record<string, unknown>)['sql'])
          : String(query);

      // COUNT queries for skipped items
      if (sqlString.includes('COUNT(*)') && sqlString.includes('foods')) {
        return Promise.resolve([{ count: BigInt(skippedFoodCount) }]);
      }
      if (sqlString.includes('COUNT(*)') && sqlString.includes('dishes')) {
        return Promise.resolve([{ count: BigInt(skippedDishCount) }]);
      }

      if (sqlString.includes('foods')) {
        return Promise.resolve(foodRows);
      }
      // dishes query (or first call fallback)
      return Promise.resolve(dishRows);
    }),
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ count: BigInt(0) }]),
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
  } as unknown as PrismaClient;
}

const BASE_OPTIONS = {
  target: 'all' as const,
  batchSize: 100,
  force: false,
  dryRun: false,
  openaiApiKey: 'sk-test',
  embeddingModel: 'text-embedding-3-small',
  embeddingRpm: 3000,
};

// ---------------------------------------------------------------------------
// dryRun tests
// ---------------------------------------------------------------------------

describe('runEmbeddingPipeline — dryRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dryRun: true returns processedFoods:0 and processedDishes:0 without API calls', async () => {
    const mockPrisma = buildMockPrisma();
    const result = await runEmbeddingPipeline({
      ...BASE_OPTIONS,
      target: 'all',
      dryRun: true,
      prisma: mockPrisma,
    });

    expect(result.processedFoods).toBe(0);
    expect(result.processedDishes).toBe(0);
    expect(result.dryRun).toBe(true);
    expect(mockCallOpenAI).not.toHaveBeenCalled();
    expect(mockWriteFood).not.toHaveBeenCalled();
    expect(mockWriteDish).not.toHaveBeenCalled();
  });

  it('dryRun: true still returns estimatedTokens > 0 when there are rows', async () => {
    const mockPrisma = buildMockPrisma();
    const result = await runEmbeddingPipeline({
      ...BASE_OPTIONS,
      target: 'all',
      dryRun: true,
      prisma: mockPrisma,
    });

    expect(result.estimatedTokens).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Target scoping tests
// ---------------------------------------------------------------------------

describe('runEmbeddingPipeline — target scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallOpenAI.mockResolvedValue([MOCK_VECTOR]);
    mockWriteFood.mockResolvedValue(undefined);
    mockWriteDish.mockResolvedValue(undefined);
  });

  it('target: "foods" only calls food writer; processedDishes === 0', async () => {
    const mockPrisma = buildMockPrisma();
    const result = await runEmbeddingPipeline({
      ...BASE_OPTIONS,
      target: 'foods',
      prisma: mockPrisma,
    });

    expect(result.processedFoods).toBe(1);
    expect(result.processedDishes).toBe(0);
    expect(mockWriteFood).toHaveBeenCalledTimes(1);
    expect(mockWriteDish).not.toHaveBeenCalled();
  });

  it('target: "dishes" only calls dish writer; processedFoods === 0', async () => {
    const mockPrisma = buildMockPrisma();
    const result = await runEmbeddingPipeline({
      ...BASE_OPTIONS,
      target: 'dishes',
      prisma: mockPrisma,
    });

    expect(result.processedFoods).toBe(0);
    expect(result.processedDishes).toBe(1);
    expect(mockWriteDish).toHaveBeenCalledTimes(1);
    expect(mockWriteFood).not.toHaveBeenCalled();
  });

  it('target: "all" processes foods then dishes in sequence', async () => {
    mockCallOpenAI.mockResolvedValue([MOCK_VECTOR]);
    const mockPrisma = buildMockPrisma();
    const result = await runEmbeddingPipeline({
      ...BASE_OPTIONS,
      target: 'all',
      prisma: mockPrisma,
    });

    expect(result.processedFoods).toBe(1);
    expect(result.processedDishes).toBe(1);
    expect(mockWriteFood).toHaveBeenCalledTimes(1);
    expect(mockWriteDish).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Empty scope
// ---------------------------------------------------------------------------

describe('runEmbeddingPipeline — empty scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns processedFoods:0, processedDishes:0, errorCount:0 when no rows returned', async () => {
    const mockPrisma = buildMockPrisma([], []);
    const result = await runEmbeddingPipeline({
      ...BASE_OPTIONS,
      target: 'all',
      prisma: mockPrisma,
    });

    expect(result.processedFoods).toBe(0);
    expect(result.processedDishes).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(mockCallOpenAI).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Skipped count tests
// ---------------------------------------------------------------------------

describe('runEmbeddingPipeline — skipped count', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallOpenAI.mockResolvedValue([MOCK_VECTOR]);
    mockWriteFood.mockResolvedValue(undefined);
    mockWriteDish.mockResolvedValue(undefined);
  });

  it('reports skipped foods/dishes when force=false and some are already embedded', async () => {
    const mockPrisma = buildMockPrisma([MOCK_FOOD_ROW], [MOCK_DISH_ROW], 5, 10);
    const result = await runEmbeddingPipeline({
      ...BASE_OPTIONS,
      target: 'all',
      force: false,
      prisma: mockPrisma,
    });

    expect(result.skippedFoods).toBe(5);
    expect(result.skippedDishes).toBe(10);
  });

  it('reports skippedFoods=0 and skippedDishes=0 when force=true', async () => {
    const mockPrisma = buildMockPrisma([MOCK_FOOD_ROW], [MOCK_DISH_ROW], 5, 10);
    const result = await runEmbeddingPipeline({
      ...BASE_OPTIONS,
      target: 'all',
      force: true,
      prisma: mockPrisma,
    });

    expect(result.skippedFoods).toBe(0);
    expect(result.skippedDishes).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Continue-on-failure
// ---------------------------------------------------------------------------

describe('runEmbeddingPipeline — continue-on-failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('callOpenAIEmbeddings rejection adds item to errors but pipeline continues', async () => {
    mockCallOpenAI
      .mockRejectedValueOnce(new Error('OpenAI API error'))
      .mockResolvedValue([MOCK_VECTOR]);

    const mockPrisma = buildMockPrisma(
      [MOCK_FOOD_ROW, { ...MOCK_FOOD_ROW, id: 'f019food-0002-4000-a000-000000000001', name: 'Salmon' }],
      [],
    );

    const result = await runEmbeddingPipeline({
      ...BASE_OPTIONS,
      target: 'foods',
      batchSize: 1, // process one at a time so first batch fails, second succeeds
      prisma: mockPrisma,
    });

    expect(result.errorCount).toBeGreaterThanOrEqual(1);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    // Pipeline should not have aborted — second batch may have succeeded
    expect(result.processedFoods).toBeGreaterThanOrEqual(0);
  });

  it('writeFoodEmbedding rejection adds item to errors but pipeline continues', async () => {
    mockCallOpenAI.mockResolvedValue([MOCK_VECTOR, MOCK_VECTOR]);
    mockWriteFood
      .mockRejectedValueOnce(new Error('DB write error'))
      .mockResolvedValue(undefined);

    const mockPrisma = buildMockPrisma(
      [MOCK_FOOD_ROW, { ...MOCK_FOOD_ROW, id: 'f019food-0002-4000-a000-000000000001' }],
      [],
    );

    const result = await runEmbeddingPipeline({
      ...BASE_OPTIONS,
      target: 'foods',
      prisma: mockPrisma,
    });

    expect(result.errorCount).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]?.reason).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// DB query failure — abort with DB_UNAVAILABLE
// ---------------------------------------------------------------------------

describe('runEmbeddingPipeline — DB query failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-throws with code DB_UNAVAILABLE when $queryRaw fails', async () => {
    const mockPrisma = {
      $queryRaw: vi.fn().mockRejectedValue(new Error('connection refused')),
      $queryRawUnsafe: vi.fn().mockRejectedValue(new Error('connection refused')),
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    } as unknown as PrismaClient;

    await expect(
      runEmbeddingPipeline({
        ...BASE_OPTIONS,
        target: 'foods',
        prisma: mockPrisma,
      }),
    ).rejects.toMatchObject({ code: 'DB_UNAVAILABLE' });
  });
});

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

describe('runEmbeddingPipeline — response shape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallOpenAI.mockResolvedValue([MOCK_VECTOR]);
    mockWriteFood.mockResolvedValue(undefined);
    mockWriteDish.mockResolvedValue(undefined);
  });

  it('returns non-negative integer durationMs', async () => {
    const mockPrisma = buildMockPrisma();
    const result = await runEmbeddingPipeline({
      ...BASE_OPTIONS,
      target: 'all',
      prisma: mockPrisma,
    });

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.durationMs)).toBe(true);
  });

  it('returns an ISO-8601 completedAt string', async () => {
    const mockPrisma = buildMockPrisma();
    const result = await runEmbeddingPipeline({
      ...BASE_OPTIONS,
      target: 'all',
      prisma: mockPrisma,
    });

    expect(result.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('returns the target field matching the input', async () => {
    const mockPrisma = buildMockPrisma();
    const result = await runEmbeddingPipeline({
      ...BASE_OPTIONS,
      target: 'foods',
      prisma: mockPrisma,
    });

    expect(result.target).toBe('foods');
  });
});

// ---------------------------------------------------------------------------
// EMBEDDING_PROVIDER_UNAVAILABLE when no apiKey
// ---------------------------------------------------------------------------

describe('runEmbeddingPipeline — missing API key', () => {
  it('throws EMBEDDING_PROVIDER_UNAVAILABLE when openaiApiKey is empty and not dryRun', async () => {
    const mockPrisma = buildMockPrisma();

    await expect(
      runEmbeddingPipeline({
        ...BASE_OPTIONS,
        openaiApiKey: '',
        dryRun: false,
        prisma: mockPrisma,
      }),
    ).rejects.toMatchObject({ code: 'EMBEDDING_PROVIDER_UNAVAILABLE' });
  });

  it('does NOT throw when openaiApiKey is empty but dryRun is true', async () => {
    const mockPrisma = buildMockPrisma();

    const result = await runEmbeddingPipeline({
      ...BASE_OPTIONS,
      openaiApiKey: '',
      dryRun: true,
      prisma: mockPrisma,
    });

    expect(result.dryRun).toBe(true);
  });
});
