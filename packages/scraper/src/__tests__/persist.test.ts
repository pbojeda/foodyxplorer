// Unit tests for persistDishUtil.
//
// Prisma is fully mocked — no real DB connection is used.
// Tests verify the upsert algorithm: findFirst → create/update → dishNutrient.upsert.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NormalizedDishData } from '../base/types.js';

// ---------------------------------------------------------------------------
// Mock @prisma/client before importing the module under test
// ---------------------------------------------------------------------------

// Mock tx methods — created before mock factory so we can reference them
const mockFindFirst = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockNutrientUpsert = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@prisma/client', () => {
  class MockPrismaClient {
    $transaction = mockTransaction;
    dish = {
      findFirst: mockFindFirst,
      create: mockCreate,
      update: mockUpdate,
    };
    dishNutrient = {
      upsert: mockNutrientUpsert,
    };
  }

  // Decimal mock — wraps value, converts to string for inspection
  class MockDecimal {
    private val: number;
    constructor(value: number | string) {
      this.val = Number(value);
    }
    toString() {
      return String(this.val);
    }
    toNumber() {
      return this.val;
    }
  }

  return {
    PrismaClient: MockPrismaClient,
    Prisma: {
      Decimal: MockDecimal,
    },
  };
});

// Import after vi.mock hoisting
import { persistDishUtil } from '../utils/persist.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeNormalizedDish(overrides: Partial<NormalizedDishData> = {}): NormalizedDishData {
  return {
    name: 'McRoyal Deluxe',
    nameEs: 'McRoyal Deluxe',
    description: 'Una hamburguesa clásica',
    externalId: 'mcroyal-deluxe',
    availability: 'available',
    portionGrams: 210,
    priceEur: 5.49,
    aliases: [],
    confidenceLevel: 'medium',
    estimationMethod: 'scraped',
    sourceId: 'a1b2c3d4-0000-4000-a000-000000000002',
    restaurantId: 'a1b2c3d4-0000-4000-a000-000000000001',
    nutrients: {
      calories: 490,
      proteins: 27,
      carbohydrates: 58,
      sugars: 12,
      fats: 19,
      saturatedFats: 7,
      fiber: 3,
      salt: 2.175,
      sodium: 870,
      transFats: 0.5,
      cholesterol: 0,
      potassium: 0,
      monounsaturatedFats: 0,
      polyunsaturatedFats: 0,
      referenceBasis: 'per_serving',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup: wire $transaction to call the callback with a tx proxy
// ---------------------------------------------------------------------------

/**
 * Sets up the mock $transaction to call the callback immediately with a
 * proxy that delegates to our top-level mock fns (dish.* / dishNutrient.*).
 */
function setupTransaction(): void {
  mockTransaction.mockImplementation(
    async (callback: (tx: unknown) => Promise<void>) => {
      const tx = {
        dish: {
          findFirst: mockFindFirst,
          create: mockCreate,
          update: mockUpdate,
        },
        dishNutrient: {
          upsert: mockNutrientUpsert,
        },
      };
      return callback(tx);
    },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('persistDishUtil', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupTransaction();
  });

  // -------------------------------------------------------------------------
  // New dish path (no externalId match — externalId used as predicate)
  // -------------------------------------------------------------------------

  it('calls findFirst with externalId predicate when externalId is present', async () => {
    const dish = makeNormalizedDish();
    mockFindFirst.mockResolvedValueOnce(null);
    mockCreate.mockResolvedValueOnce({ id: 'new-dish-id' });

    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    await persistDishUtil(prisma, dish);

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        restaurantId: dish.restaurantId,
        externalId: dish.externalId,
      },
      select: { id: true },
    });
  });

  it('calls findFirst with name predicate when externalId is absent', async () => {
    const dish = makeNormalizedDish({ externalId: undefined });
    mockFindFirst.mockResolvedValueOnce(null);
    mockCreate.mockResolvedValueOnce({ id: 'new-dish-id' });

    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    await persistDishUtil(prisma, dish);

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        restaurantId: dish.restaurantId,
        name: dish.name,
      },
      select: { id: true },
    });
  });

  it('calls dish.create when findFirst returns null (new dish)', async () => {
    const dish = makeNormalizedDish();
    mockFindFirst.mockResolvedValueOnce(null);
    mockCreate.mockResolvedValueOnce({ id: 'new-dish-id' });

    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    await persistDishUtil(prisma, dish);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();

    const createCall = mockCreate.mock.calls[0]?.[0] as { data: { name: string; restaurantId: string } };
    expect(createCall.data.name).toBe(dish.name);
    expect(createCall.data.restaurantId).toBe(dish.restaurantId);
  });

  it('calls dish.update when findFirst returns an existing dish', async () => {
    const dish = makeNormalizedDish();
    const existingId = 'existing-dish-uuid';
    mockFindFirst.mockResolvedValueOnce({ id: existingId });
    mockUpdate.mockResolvedValueOnce({ id: existingId });

    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    await persistDishUtil(prisma, dish);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();

    const updateCall = mockUpdate.mock.calls[0]?.[0] as { where: { id: string } };
    expect(updateCall.where.id).toBe(existingId);
  });

  // -------------------------------------------------------------------------
  // dishNutrient.upsert
  // -------------------------------------------------------------------------

  it('calls dishNutrient.upsert with dishId_sourceId compound key after create', async () => {
    const dish = makeNormalizedDish();
    const newDishId = 'created-dish-id';
    mockFindFirst.mockResolvedValueOnce(null);
    mockCreate.mockResolvedValueOnce({ id: newDishId });

    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    await persistDishUtil(prisma, dish);

    expect(mockNutrientUpsert).toHaveBeenCalledTimes(1);
    const upsertCall = mockNutrientUpsert.mock.calls[0]?.[0] as {
      where: { dishId_sourceId: { dishId: string; sourceId: string } };
      create: { dishId: string; sourceId: string };
      update: Record<string, unknown>;
    };
    expect(upsertCall.where.dishId_sourceId.dishId).toBe(newDishId);
    expect(upsertCall.where.dishId_sourceId.sourceId).toBe(dish.sourceId);
    expect(upsertCall.create.dishId).toBe(newDishId);
    expect(upsertCall.create.sourceId).toBe(dish.sourceId);
  });

  it('calls dishNutrient.upsert with dishId_sourceId compound key after update', async () => {
    const dish = makeNormalizedDish();
    const existingId = 'existing-dish-uuid';
    mockFindFirst.mockResolvedValueOnce({ id: existingId });
    mockUpdate.mockResolvedValueOnce({ id: existingId });

    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    await persistDishUtil(prisma, dish);

    expect(mockNutrientUpsert).toHaveBeenCalledTimes(1);
    const upsertCall = mockNutrientUpsert.mock.calls[0]?.[0] as {
      where: { dishId_sourceId: { dishId: string; sourceId: string } };
    };
    expect(upsertCall.where.dishId_sourceId.dishId).toBe(existingId);
    expect(upsertCall.where.dishId_sourceId.sourceId).toBe(dish.sourceId);
  });

  // -------------------------------------------------------------------------
  // Transaction wrapping
  // -------------------------------------------------------------------------

  it('executes all writes inside a single $transaction call', async () => {
    const dish = makeNormalizedDish();
    mockFindFirst.mockResolvedValueOnce(null);
    mockCreate.mockResolvedValueOnce({ id: 'new-dish-id' });

    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    await persistDishUtil(prisma, dish);

    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Error propagation
  // -------------------------------------------------------------------------

  it('re-throws when the transaction callback rejects', async () => {
    const dish = makeNormalizedDish();
    const dbError = new Error('DB connection lost');
    mockTransaction.mockRejectedValueOnce(dbError);

    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    await expect(persistDishUtil(prisma, dish)).rejects.toThrow('DB connection lost');
  });

  it('re-throws when dish.create rejects inside the transaction', async () => {
    const dish = makeNormalizedDish();
    const createError = new Error('unique constraint violated');
    mockFindFirst.mockResolvedValueOnce(null);
    mockCreate.mockRejectedValueOnce(createError);

    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    await expect(persistDishUtil(prisma, dish)).rejects.toThrow('unique constraint violated');
  });

  // -------------------------------------------------------------------------
  // Nutrient field mapping
  // -------------------------------------------------------------------------

  it('nutrient fields in upsert.create use Prisma.Decimal instances', async () => {
    const dish = makeNormalizedDish();
    mockFindFirst.mockResolvedValueOnce(null);
    mockCreate.mockResolvedValueOnce({ id: 'new-dish-id' });

    const { PrismaClient, Prisma } = await import('@prisma/client');
    const prisma = new PrismaClient();
    await persistDishUtil(prisma, dish);

    const upsertCall = mockNutrientUpsert.mock.calls[0]?.[0] as {
      create: { calories: InstanceType<typeof Prisma.Decimal> };
    };
    // Should be an instance of the Decimal mock
    expect(upsertCall.create.calories).toBeDefined();
    expect(upsertCall.create.calories.toString()).toBe(String(dish.nutrients.calories));
  });
});
