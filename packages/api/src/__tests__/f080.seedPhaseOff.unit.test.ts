/**
 * F080 — seedPhaseOff Unit Tests (mocked PrismaClient)
 *
 * Tests for the seedPhaseOff function which imports OFF data into the DB.
 * Uses mocked Prisma client to avoid real DB dependency.
 *
 * Key behaviors:
 * - DataSource upserted with UUID 00000000-0000-0000-0000-000000000004, priorityTier=0
 * - Feature flag: skips in non-test env when OFF_IMPORT_ENABLED !== 'true'
 * - Feature flag: proceeds in test env regardless (NODE_ENV=test)
 * - Feature flag: proceeds when OFF_IMPORT_ENABLED=true
 * - Products failing validateOffProduct() are skipped (no upsert called)
 * - Dry-run: zero DB writes, returns counts
 * - Limit: only N products processed
 * - $executeRaw called once for zero-vector embeddings
 * - Summary counts returned: productsFound, productsImported, productsSkipped, skipReasons
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OffProduct } from '../ingest/off/types.js';
import { OFF_SOURCE_UUID } from '../ingest/off/types.js';

// ---------------------------------------------------------------------------
// Shared Prisma mock
// ---------------------------------------------------------------------------

const dataSourceCalls: unknown[] = [];
const foodCalls: unknown[] = [];
const foodNutrientCalls: unknown[] = [];
const executeRawCalls: unknown[] = [];

const mockPrisma = {
  dataSource: {
    upsert: vi.fn((args: unknown) => {
      dataSourceCalls.push(args);
      return Promise.resolve({ id: OFF_SOURCE_UUID });
    }),
  },
  food: {
    upsert: vi.fn((args: unknown) => {
      foodCalls.push(args);
      return Promise.resolve({ id: `mock-food-uuid-${foodCalls.length}` });
    }),
  },
  foodNutrient: {
    upsert: vi.fn((args: unknown) => {
      foodNutrientCalls.push(args);
      return Promise.resolve({ id: 'mock-nutrient-id' });
    }),
  },
  $executeRaw: vi.fn((args: unknown) => {
    executeRawCalls.push(args);
    return Promise.resolve(0);
  }),
} as unknown as import('@prisma/client').PrismaClient;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validProduct(code: string, overrides: Partial<OffProduct> = {}): OffProduct {
  return {
    code,
    _id: `id-${code}`,
    product_name: `Product ${code}`,
    product_name_es: `Producto ${code}`,
    brands: 'Hacendado',
    nutriments: {
      'energy-kcal_100g': 160,
      proteins_100g: 6,
      carbohydrates_100g: 12,
      fat_100g: 9,
      salt_100g: 0.5,
      sodium_100g: 0.2,
    },
    ...overrides,
  };
}

function invalidProduct(code: string): OffProduct {
  return {
    code,
    _id: `id-${code}`,
    // No name, no nutriments → invalid
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('seedPhaseOff', () => {
  let originalNodeEnv: string | undefined;
  let originalOffFlag: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    dataSourceCalls.length = 0;
    foodCalls.length = 0;
    foodNutrientCalls.length = 0;
    executeRawCalls.length = 0;
    originalNodeEnv = process.env['NODE_ENV'];
    originalOffFlag = process.env['OFF_IMPORT_ENABLED'];
  });

  afterEach(() => {
    if (originalNodeEnv !== undefined) {
      process.env['NODE_ENV'] = originalNodeEnv;
    } else {
      delete process.env['NODE_ENV'];
    }
    if (originalOffFlag !== undefined) {
      process.env['OFF_IMPORT_ENABLED'] = originalOffFlag;
    } else {
      delete process.env['OFF_IMPORT_ENABLED'];
    }
    vi.resetModules();
  });

  // -------------------------------------------------------------------------
  // Feature flag
  // -------------------------------------------------------------------------

  it('skips all DB calls when non-test env + flag absent', async () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['OFF_IMPORT_ENABLED'];

    const { seedPhaseOff } = await import('../scripts/seedPhaseOff.js');
    const result = await seedPhaseOff(mockPrisma, { products: [validProduct('001')] });

    expect(dataSourceCalls).toHaveLength(0);
    expect(foodCalls).toHaveLength(0);
    expect(result.productsImported).toBe(0);
  });

  it('proceeds when NODE_ENV=test (regardless of flag)', async () => {
    process.env['NODE_ENV'] = 'test';
    delete process.env['OFF_IMPORT_ENABLED'];

    const { seedPhaseOff } = await import('../scripts/seedPhaseOff.js');
    await seedPhaseOff(mockPrisma, { products: [validProduct('001')] });

    expect(dataSourceCalls).toHaveLength(1);
    expect(foodCalls).toHaveLength(1);
  });

  it('proceeds when OFF_IMPORT_ENABLED=true in non-test env', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['OFF_IMPORT_ENABLED'] = 'true';

    const { seedPhaseOff } = await import('../scripts/seedPhaseOff.js');
    await seedPhaseOff(mockPrisma, { products: [validProduct('001')] });

    expect(dataSourceCalls).toHaveLength(1);
    expect(foodCalls).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // DataSource upsert
  // -------------------------------------------------------------------------

  it('upserts DataSource with id=OFF_SOURCE_UUID and priorityTier=0', async () => {
    process.env['NODE_ENV'] = 'test';
    const { seedPhaseOff } = await import('../scripts/seedPhaseOff.js');
    await seedPhaseOff(mockPrisma, { products: [] });

    expect(dataSourceCalls).toHaveLength(1);
    const call = dataSourceCalls[0] as { where: { id: string }; create: { priorityTier: number } };
    expect(call.where.id).toBe(OFF_SOURCE_UUID);
    expect(call.create.priorityTier).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Food + nutrient upserts
  // -------------------------------------------------------------------------

  it('upserts food with externalId="OFF-{code}" when code present', async () => {
    process.env['NODE_ENV'] = 'test';
    const { seedPhaseOff } = await import('../scripts/seedPhaseOff.js');
    await seedPhaseOff(mockPrisma, { products: [validProduct('8480000123456')] });

    const call = foodCalls[0] as { where: { externalId_sourceId: { externalId: string } } };
    expect(call.where.externalId_sourceId.externalId).toBe('OFF-8480000123456');
  });

  it('upserts food with externalId="OFF-id-{_id}" when code absent', async () => {
    process.env['NODE_ENV'] = 'test';
    const { seedPhaseOff } = await import('../scripts/seedPhaseOff.js');
    await seedPhaseOff(mockPrisma, {
      products: [validProduct('', { code: undefined, _id: 'abc123' })],
    });

    const call = foodCalls[0] as { where: { externalId_sourceId: { externalId: string } } };
    expect(call.where.externalId_sourceId.externalId).toBe('OFF-id-abc123');
  });

  it('upserts foodNutrient with referenceBasis="per_100g"', async () => {
    process.env['NODE_ENV'] = 'test';
    const { seedPhaseOff } = await import('../scripts/seedPhaseOff.js');
    await seedPhaseOff(mockPrisma, { products: [validProduct('001')] });

    const call = foodNutrientCalls[0] as { create: { referenceBasis: string } };
    expect(call.create.referenceBasis).toBe('per_100g');
  });

  // -------------------------------------------------------------------------
  // Validation / skip logic
  // -------------------------------------------------------------------------

  it('skips products failing validateOffProduct (no food upsert)', async () => {
    process.env['NODE_ENV'] = 'test';
    const { seedPhaseOff } = await import('../scripts/seedPhaseOff.js');
    const result = await seedPhaseOff(mockPrisma, {
      products: [validProduct('001'), invalidProduct('bad1'), invalidProduct('bad2')],
    });

    expect(foodCalls).toHaveLength(1);
    expect(result.productsSkipped).toBe(2);
    expect(result.skipReasons.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Dry-run
  // -------------------------------------------------------------------------

  it('dry-run: zero DB writes, returns counts', async () => {
    process.env['NODE_ENV'] = 'test';
    const { seedPhaseOff } = await import('../scripts/seedPhaseOff.js');
    const result = await seedPhaseOff(mockPrisma, {
      dryRun: true,
      products: [validProduct('001'), validProduct('002'), invalidProduct('bad1')],
    });

    expect(foodCalls).toHaveLength(0);
    expect(foodNutrientCalls).toHaveLength(0);
    expect(dataSourceCalls).toHaveLength(0);
    expect(result.productsFound).toBe(3);
    expect(result.productsImported).toBe(2); // dry-run: counts validated products that would be imported
    expect(result.productsSkipped).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Limit
  // -------------------------------------------------------------------------

  it('respects --limit: stops processing after N products', async () => {
    process.env['NODE_ENV'] = 'test';
    const { seedPhaseOff } = await import('../scripts/seedPhaseOff.js');
    const products = [validProduct('001'), validProduct('002'), validProduct('003')];
    const result = await seedPhaseOff(mockPrisma, { products, limit: 2 });

    expect(foodCalls).toHaveLength(2);
    expect(result.productsImported).toBe(2);
    expect(result.productsFound).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Summary counts
  // -------------------------------------------------------------------------

  it('returns correct summary counts', async () => {
    process.env['NODE_ENV'] = 'test';
    const { seedPhaseOff } = await import('../scripts/seedPhaseOff.js');
    const result = await seedPhaseOff(mockPrisma, {
      products: [validProduct('001'), validProduct('002'), invalidProduct('bad')],
    });

    expect(result.productsFound).toBe(3);
    expect(result.productsImported).toBe(2);
    expect(result.productsSkipped).toBe(1);
    expect(Array.isArray(result.skipReasons)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Zero-vector embeddings
  // -------------------------------------------------------------------------

  it('calls $executeRaw once for zero-vector embeddings', async () => {
    process.env['NODE_ENV'] = 'test';
    const { seedPhaseOff } = await import('../scripts/seedPhaseOff.js');
    await seedPhaseOff(mockPrisma, { products: [validProduct('001')] });

    expect(executeRawCalls).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Idempotency
  // -------------------------------------------------------------------------

  it('idempotency: running twice with same products calls upsert same number of times each run', async () => {
    process.env['NODE_ENV'] = 'test';
    const { seedPhaseOff } = await import('../scripts/seedPhaseOff.js');
    const products = [validProduct('001'), validProduct('002')];

    await seedPhaseOff(mockPrisma, { products });
    const firstRunFoodCalls = foodCalls.length;

    await seedPhaseOff(mockPrisma, { products });
    const secondRunFoodCalls = foodCalls.length - firstRunFoodCalls;

    expect(firstRunFoodCalls).toBe(secondRunFoodCalls);
  });
});
