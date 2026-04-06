/**
 * F071 — seedPhaseBedca Unit Tests (mocked PrismaClient)
 *
 * Tests for the seedPhaseBedca function which imports BEDCA data into the DB.
 * Uses mocked Prisma client to avoid real DB dependency.
 *
 * Key behaviors:
 * - DataSource upserted with UUID 00000000-0000-0000-0000-000000000003, priority_tier=1
 * - Food upserted for each snapshot entry with externalId='BEDCA-{id}'
 * - FoodNutrient upserted for each food with referenceBasis='per_100g'
 * - nameEs populated for all BEDCA foods
 * - Feature flag: skips in non-test env when BEDCA_IMPORT_ENABLED !== 'true'
 * - Feature flag: proceeds in test env regardless (NODE_ENV=test)
 * - Feature flag: proceeds when BEDCA_IMPORT_ENABLED=true
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Track calls separately by model
// ---------------------------------------------------------------------------
const dataSourceCalls: unknown[] = [];
const foodCalls: unknown[] = [];
const foodNutrientCalls: unknown[] = [];
const executeRawCalls: unknown[] = [];

const mockPrisma = {
  dataSource: {
    upsert: vi.fn((args: unknown) => {
      dataSourceCalls.push(args);
      return Promise.resolve({ id: '00000000-0000-0000-0000-000000000003' });
    }),
  },
  food: {
    upsert: vi.fn((args: unknown) => {
      foodCalls.push(args);
      return Promise.resolve({ id: 'mock-food-uuid-' + foodCalls.length });
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
// Tests
// ---------------------------------------------------------------------------

describe('seedPhaseBedca', () => {
  let originalNodeEnv: string | undefined;
  let originalBedcaFlag: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    dataSourceCalls.length = 0;
    foodCalls.length = 0;
    foodNutrientCalls.length = 0;
    executeRawCalls.length = 0;
    originalNodeEnv = process.env['NODE_ENV'];
    originalBedcaFlag = process.env['BEDCA_IMPORT_ENABLED'];
  });

  afterEach(() => {
    if (originalNodeEnv !== undefined) {
      process.env['NODE_ENV'] = originalNodeEnv;
    } else {
      delete process.env['NODE_ENV'];
    }
    if (originalBedcaFlag !== undefined) {
      process.env['BEDCA_IMPORT_ENABLED'] = originalBedcaFlag;
    } else {
      delete process.env['BEDCA_IMPORT_ENABLED'];
    }
    vi.resetModules();
  });

  it('upserts BEDCA DataSource with correct UUID and priority_tier=1', async () => {
    process.env['NODE_ENV'] = 'test';
    const { seedPhaseBedca } = await import('../scripts/seedPhaseBedca.js');
    await seedPhaseBedca(mockPrisma);

    expect(dataSourceCalls).toHaveLength(1);
    const dsArgs = dataSourceCalls[0] as {
      where: { id: string };
      create: { priority_tier?: number; priorityTier?: number; type: string };
    };
    expect(dsArgs.where.id).toBe('00000000-0000-0000-0000-000000000003');
    const priorityTier = dsArgs.create.priorityTier ?? dsArgs.create.priority_tier;
    expect(priorityTier).toBe(1);
    expect(dsArgs.create.type).toBe('official');
  });

  it('upserts food for each snapshot entry with externalId BEDCA-{id}', async () => {
    process.env['NODE_ENV'] = 'test';
    const { seedPhaseBedca } = await import('../scripts/seedPhaseBedca.js');
    await seedPhaseBedca(mockPrisma);

    expect(foodCalls.length).toBeGreaterThan(0);

    const oliveOilCall = foodCalls.find((call) => {
      const c = call as { where: { externalId_sourceId: { externalId: string } } };
      return c.where.externalId_sourceId.externalId === 'BEDCA-1';
    });
    expect(oliveOilCall).toBeDefined();

    const create = (oliveOilCall as { create: { nameEs: string; name: string } }).create;
    expect(create.nameEs).toBe('Aceite de oliva virgen extra');
    expect(create.name).toBe('Extra virgin olive oil');
  });

  it('upserts foodNutrient for each food with referenceBasis=per_100g and confidenceLevel=high', async () => {
    process.env['NODE_ENV'] = 'test';
    const { seedPhaseBedca } = await import('../scripts/seedPhaseBedca.js');
    await seedPhaseBedca(mockPrisma);

    expect(foodNutrientCalls.length).toBeGreaterThan(0);

    // Check first nutrient call has correct basis
    const firstNutrient = (foodNutrientCalls[0] as { create: { referenceBasis: string; confidenceLevel: string } }).create;
    expect(firstNutrient.referenceBasis).toBe('per_100g');
    expect(firstNutrient.confidenceLevel).toBe('high');
  });

  it('calls $executeRaw to set zero-vector embeddings', async () => {
    process.env['NODE_ENV'] = 'test';
    const { seedPhaseBedca } = await import('../scripts/seedPhaseBedca.js');
    await seedPhaseBedca(mockPrisma);

    expect(executeRawCalls.length).toBeGreaterThan(0);
  });

  it('skips import in development environment when BEDCA_IMPORT_ENABLED is not set', async () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['BEDCA_IMPORT_ENABLED'];

    vi.resetModules();
    const { seedPhaseBedca } = await import('../scripts/seedPhaseBedca.js');
    await seedPhaseBedca(mockPrisma);

    // No food upserts should happen
    expect(foodCalls.length).toBe(0);
  });

  it('proceeds in test environment regardless of feature flag', async () => {
    process.env['NODE_ENV'] = 'test';
    delete process.env['BEDCA_IMPORT_ENABLED'];

    vi.resetModules();
    const { seedPhaseBedca } = await import('../scripts/seedPhaseBedca.js');
    await seedPhaseBedca(mockPrisma);

    expect(foodCalls.length).toBeGreaterThan(0);
  });

  it('proceeds in development when BEDCA_IMPORT_ENABLED=true', async () => {
    process.env['NODE_ENV'] = 'development';
    process.env['BEDCA_IMPORT_ENABLED'] = 'true';

    vi.resetModules();
    const { seedPhaseBedca } = await import('../scripts/seedPhaseBedca.js');
    await seedPhaseBedca(mockPrisma);

    expect(foodCalls.length).toBeGreaterThan(0);
  });
});
