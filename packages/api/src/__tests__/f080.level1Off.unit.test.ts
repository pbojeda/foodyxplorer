/**
 * F080 — Level 1 OFF Branded Lookup + Engine Router OFF Fallback Unit Tests
 *
 * Tests for:
 * - offBrandedFoodMatch(): L1 branded path returns OFF food before normal cascade
 * - offFallbackFoodMatch(): OFF Tier 3 fallback triggered only on total miss
 * - engineRouter: routes correctly through OFF paths
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OFF_SOURCE_UUID } from '../ingest/off/types.js';
import type { FoodQueryRow } from '../estimation/types.js';

// ---------------------------------------------------------------------------
// Mock Kysely DB with injectable sql results
// ---------------------------------------------------------------------------

/**
 * Build a minimal FoodQueryRow for an OFF food.
 */
function offFoodRow(overrides: Partial<FoodQueryRow> = {}): FoodQueryRow {
  return {
    food_id: 'fd000000-0080-4000-a000-000000000001',
    food_name: 'Potato Omelette',
    food_name_es: 'Tortilla de Patatas Hacendado',
    food_group: 'prepared-meals',
    barcode: '8480000123456',
    brand_name: 'hacendado',
    calories: '160',
    proteins: '6.5',
    carbohydrates: '12.3',
    sugars: '1.2',
    fats: '9.1',
    saturated_fats: '2.5',
    fiber: '0.8',
    salt: '0.6',
    sodium: '0.24',
    trans_fats: '0.1',
    cholesterol: '0.25',
    potassium: '0.3',
    monounsaturated_fats: '3.5',
    polyunsaturated_fats: '1.1',
    alcohol: '0',
    reference_basis: 'per_100g',
    source_id: OFF_SOURCE_UUID,
    source_name: 'Open Food Facts',
    source_type: 'official',
    source_url: 'https://world.openfoodfacts.org/',
    source_priority_tier: '0',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests for offBrandedFoodMatch and offFallbackFoodMatch (via level1Lookup)
// ---------------------------------------------------------------------------

/**
 * Build a mock sql template tag that tracks calls and returns the given rows
 * on the LAST call's .execute() (the outer query, not sub-expressions).
 */
function makeSqlMock(rows: FoodQueryRow[]) {
  // Each call to the mock returns an object that tracks if .execute() was called.
  // The last call (the outermost query) returns rows.
  // Sub-expression calls (for brand conditions) return objects that don't execute.
  const calls: Array<{ execute?: () => Promise<{ rows: FoodQueryRow[] }> }> = [];

  const mockSql = vi.fn().mockImplementation(() => {
    const call: { execute?: () => Promise<{ rows: FoodQueryRow[] }> } = {};
    call.execute = vi.fn().mockResolvedValue({ rows });
    calls.push(call);
    return call;
  });

  return { mockSql, calls };
}

describe('offBrandedFoodMatch (via level1Lookup)', () => {
  it('returns OFF food when hasExplicitBrand=true and detectedBrand is a supermarket', async () => {
    const { mockSql } = makeSqlMock([offFoodRow()]);
    const mockDb = {};

    const { offBrandedFoodMatch } = await import('../estimation/level1Lookup.js');
    const row = await offBrandedFoodMatch(mockDb as never, 'tortilla', 'hacendado', mockSql);

    expect(row).not.toBeUndefined();
    expect(row?.source_id).toBe(OFF_SOURCE_UUID);
  });

  it('calls sqlImpl multiple times for brand alias expansion (mercadona → 2 brands)', async () => {
    const { mockSql } = makeSqlMock([offFoodRow({ brand_name: 'hacendado' })]);
    const mockDb = {};

    const { offBrandedFoodMatch } = await import('../estimation/level1Lookup.js');
    await offBrandedFoodMatch(mockDb as never, 'tortilla', 'mercadona', mockSql);

    // mercadona resolves to ['hacendado', 'mercadona'] — sqlImpl is called multiple times:
    // - 1x per brand alias for individual brand clauses (2)
    // - 1x for the reduce accumulator combination
    // - 1x for the outer query
    expect(mockSql.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('returns undefined when no OFF food matches', async () => {
    const { mockSql } = makeSqlMock([]);
    const mockDb = {};

    const { offBrandedFoodMatch } = await import('../estimation/level1Lookup.js');
    const row = await offBrandedFoodMatch(mockDb as never, 'unknownfood', 'hacendado', mockSql);
    expect(row).toBeUndefined();
  });
});

describe('offFallbackFoodMatch', () => {
  it('queries OFF foods only — returns an OFF food row', async () => {
    const { mockSql } = makeSqlMock([offFoodRow()]);
    const mockDb = {};

    const { offFallbackFoodMatch } = await import('../estimation/level1Lookup.js');
    const row = await offFallbackFoodMatch(mockDb as never, 'tortilla', mockSql);

    expect(row?.source_id).toBe(OFF_SOURCE_UUID);
  });

  it('returns undefined when no OFF food matches the query', async () => {
    const { mockSql } = makeSqlMock([]);
    const mockDb = {};

    const { offFallbackFoodMatch } = await import('../estimation/level1Lookup.js');
    const row = await offFallbackFoodMatch(mockDb as never, 'unknownfood', mockSql);
    expect(row).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests for engineRouter OFF fallback slot
// ---------------------------------------------------------------------------

describe('runEstimationCascade — OFF Tier 3 fallback', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('calls OFF fallback when hasExplicitBrand=false and L1+L2+L3 all miss', async () => {
    // We mock all level lookups to return null, then OFF fallback returns a result
    vi.doMock('../estimation/level1Lookup.js', () => ({
      level1Lookup: vi.fn().mockResolvedValue(null),
      offFallbackFoodMatch: vi.fn().mockResolvedValue(offFoodRow()),
    }));
    vi.doMock('../estimation/level2Lookup.js', () => ({
      level2Lookup: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock('../estimation/level3Lookup.js', () => ({
      level3Lookup: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock('../estimation/applyYield.js', () => ({
      resolveAndApplyYield: vi.fn().mockImplementation(async ({ result }: { result: unknown }) => ({
        result,
        yieldAdjustment: null,
      })),
    }));

    const { runEstimationCascade } = await import('../estimation/engineRouter.js');

    const result = await runEstimationCascade({
      db: {} as never,
      query: 'tortilla',
      hasExplicitBrand: false,
      openAiApiKey: undefined,
    });

    // OFF fallback reuses levelHit: 3 and level3Hit: true (per plan — no new flags)
    expect(result.levelHit).toBe(3);
    expect(result.data.level3Hit).toBe(true);
    expect(result.data.result?.source.id).toBe(OFF_SOURCE_UUID);
    // Attribution fields must be present
    expect(result.data.result?.source.attributionNote).toContain('plato preparado industrial');
    expect(result.data.result?.source.license).toBe('ODbL 1.0');
  });

  it('does NOT call OFF fallback when hasExplicitBrand=true', async () => {
    const offFallbackMock = vi.fn().mockResolvedValue(offFoodRow());
    vi.doMock('../estimation/level1Lookup.js', () => ({
      level1Lookup: vi.fn().mockResolvedValue(null),
      offFallbackFoodMatch: offFallbackMock,
    }));
    vi.doMock('../estimation/level2Lookup.js', () => ({
      level2Lookup: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock('../estimation/level3Lookup.js', () => ({
      level3Lookup: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock('../estimation/applyYield.js', () => ({
      resolveAndApplyYield: vi.fn().mockImplementation(async ({ result }: { result: unknown }) => ({
        result,
        yieldAdjustment: null,
      })),
    }));

    const { runEstimationCascade } = await import('../estimation/engineRouter.js');

    const result = await runEstimationCascade({
      db: {} as never,
      query: 'tortilla hacendado',
      hasExplicitBrand: true,
      detectedBrand: 'hacendado',
      openAiApiKey: undefined,
    });

    // OFF fallback must NOT be called when hasExplicitBrand=true
    expect(offFallbackMock).not.toHaveBeenCalled();
    // Total miss (no level4Lookup injected)
    expect(result.levelHit).toBeNull();
  });

  it('does NOT call OFF fallback when L3 finds a result', async () => {
    const l3Result = {
      matchType: 'similarity_food' as const,
      result: {
        entityType: 'food' as const,
        entityId: 'bedca-food-uuid',
        name: 'Tortilla',
        nameEs: 'Tortilla',
        restaurantId: null,
        chainSlug: null,
        portionGrams: null,
        nutrients: {
          calories: 160, proteins: 6, carbohydrates: 12, sugars: 1,
          fats: 9, saturatedFats: 2, fiber: 0.5, salt: 0.5, sodium: 0.2,
          transFats: 0, cholesterol: 0, potassium: 0,
          monounsaturatedFats: 0, polyunsaturatedFats: 0, alcohol: 0,
          referenceBasis: 'per_100g' as const,
        },
        confidenceLevel: 'high' as const,
        estimationMethod: 'official' as const,
        source: {
          id: '00000000-0000-0000-0000-000000000003',
          name: 'BEDCA',
          type: 'official' as const,
          url: null,
        },
        similarityDistance: 0.1,
      },
      rawFoodGroup: null,
      similarityDistance: 0.1,
    };

    const offFallbackMock = vi.fn().mockResolvedValue(offFoodRow());
    vi.doMock('../estimation/level1Lookup.js', () => ({
      level1Lookup: vi.fn().mockResolvedValue(null),
      offFallbackFoodMatch: offFallbackMock,
    }));
    vi.doMock('../estimation/level2Lookup.js', () => ({
      level2Lookup: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock('../estimation/level3Lookup.js', () => ({
      level3Lookup: vi.fn().mockResolvedValue(l3Result),
    }));
    vi.doMock('../estimation/applyYield.js', () => ({
      resolveAndApplyYield: vi.fn().mockImplementation(async ({ result }: { result: unknown }) => ({
        result,
        yieldAdjustment: null,
      })),
    }));

    const { runEstimationCascade } = await import('../estimation/engineRouter.js');

    const result = await runEstimationCascade({
      db: {} as never,
      query: 'tortilla',
      hasExplicitBrand: false,
      openAiApiKey: 'dummy-key',
    });

    expect(offFallbackMock).not.toHaveBeenCalled();
    expect(result.levelHit).toBe(3);
  });
});
