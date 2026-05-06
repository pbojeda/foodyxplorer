/**
 * F073 — seedPhaseSpanishDishes edge cases (QA test file).
 *
 * Covers gaps in the seed function not tested by the developer:
 *
 *   BUG-1: DishNutrient update block is missing estimationMethod, confidenceLevel, sourceId.
 *          On re-seed, if a dish's provenance changes, DishNutrient provenance stays stale.
 *
 *   BUG-2: Dish update block is missing sourceId.
 *          On re-seed, if a dish's provenance changes, Dish.sourceId stays stale.
 *
 * These tests use dependency injection mocking to isolate the seed function
 * from the database, following the project's unit-test-first pattern.
 *
 * The mock Prisma client captures all upsert calls so we can inspect the
 * exact payload the seed sends for both the create and update branches.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal Prisma mock — captures upsert calls for assertion
// ---------------------------------------------------------------------------

type UpsertCall = {
  model: string;
  args: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  };
};

function buildMockPrisma() {
  const calls: UpsertCall[] = [];

  const makeModelProxy = (model: string) => ({
    upsert: vi.fn(async (args: UpsertCall['args']) => {
      calls.push({ model, args });
      return {};
    }),
  });

  const prisma = {
    dataSource: makeModelProxy('dataSource'),
    restaurant: makeModelProxy('restaurant'),
    dish: makeModelProxy('dish'),
    dishNutrient: makeModelProxy('dishNutrient'),
    $executeRaw: vi.fn(async () => 0),
    _calls: calls,
  };

  return prisma;
}

// ---------------------------------------------------------------------------
// Import the seed function
// ---------------------------------------------------------------------------

import { seedPhaseSpanishDishes } from '../scripts/seedPhaseSpanishDishes.js';

// ---------------------------------------------------------------------------
// Tests — DishNutrient update block completeness (BUG-1)
// ---------------------------------------------------------------------------

describe('F073 seed edge cases — DishNutrient update block (BUG-1)', () => {
  let prisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(() => {
    prisma = buildMockPrisma();
  });

  it('includes estimationMethod in DishNutrient update block', async () => {
    await seedPhaseSpanishDishes(prisma as never);

    const nutrientUpserts = prisma._calls.filter((c) => c.model === 'dishNutrient');
    expect(nutrientUpserts.length).toBeGreaterThan(0);

    // Every DishNutrient update block must include estimationMethod
    const missing = nutrientUpserts.filter(
      (c) => !('estimationMethod' in c.args.update),
    );
    expect(missing.length).toBe(0);
  });

  it('includes confidenceLevel in DishNutrient update block', async () => {
    await seedPhaseSpanishDishes(prisma as never);

    const nutrientUpserts = prisma._calls.filter((c) => c.model === 'dishNutrient');
    const missing = nutrientUpserts.filter(
      (c) => !('confidenceLevel' in c.args.update),
    );
    expect(missing.length).toBe(0);
  });

  it('includes sourceId in DishNutrient update block', async () => {
    await seedPhaseSpanishDishes(prisma as never);

    const nutrientUpserts = prisma._calls.filter((c) => c.model === 'dishNutrient');
    const missing = nutrientUpserts.filter(
      (c) => !('sourceId' in c.args.update),
    );
    expect(missing.length).toBe(0);
  });

  it('DishNutrient update block sourceId matches source field for BEDCA dishes', async () => {
    await seedPhaseSpanishDishes(prisma as never);

    // Find a BEDCA dish nutrient upsert — its sourceId in update must be BEDCA UUID
    const BEDCA_UUID = '00000000-0000-0000-0000-000000000003';
    const nutrientUpserts = prisma._calls.filter((c) => c.model === 'dishNutrient');
    const bedcaNutrients = nutrientUpserts.filter(
      (c) => c.args.create['sourceId'] === BEDCA_UUID,
    );

    expect(bedcaNutrients.length).toBeGreaterThan(0);

    const wrongSourceId = bedcaNutrients.filter(
      (c) => c.args.update['sourceId'] !== BEDCA_UUID,
    );
    expect(wrongSourceId.length).toBe(0);
  });

  it('DishNutrient update block sourceId matches source field for recipe dishes', async () => {
    await seedPhaseSpanishDishes(prisma as never);

    const RECIPE_UUID = '00000000-0000-e073-0000-000000000001';
    const nutrientUpserts = prisma._calls.filter((c) => c.model === 'dishNutrient');
    const recipeNutrients = nutrientUpserts.filter(
      (c) => c.args.create['sourceId'] === RECIPE_UUID,
    );

    expect(recipeNutrients.length).toBeGreaterThan(0);

    const wrongSourceId = recipeNutrients.filter(
      (c) => c.args.update['sourceId'] !== RECIPE_UUID,
    );
    expect(wrongSourceId.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — Dish update block completeness (BUG-2)
// ---------------------------------------------------------------------------

describe('F073 seed edge cases — Dish update block (BUG-2)', () => {
  let prisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(() => {
    prisma = buildMockPrisma();
  });

  it('includes sourceId in Dish update block', async () => {
    await seedPhaseSpanishDishes(prisma as never);

    const dishUpserts = prisma._calls.filter((c) => c.model === 'dish');
    expect(dishUpserts.length).toBeGreaterThan(0);

    const missing = dishUpserts.filter(
      (c) => !('sourceId' in c.args.update),
    );
    expect(missing.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — DishNutrient create block completeness
// ---------------------------------------------------------------------------

describe('F073 seed edge cases — DishNutrient create block required fields', () => {
  let prisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(() => {
    prisma = buildMockPrisma();
  });

  it('includes referenceBasis=per_serving in DishNutrient create block', async () => {
    await seedPhaseSpanishDishes(prisma as never);

    const nutrientUpserts = prisma._calls.filter((c) => c.model === 'dishNutrient');
    const wrong = nutrientUpserts.filter(
      (c) => c.args.create['referenceBasis'] !== 'per_serving',
    );
    expect(wrong.length).toBe(0);
  });

  it('all 9 macro fields are present in DishNutrient create block', async () => {
    await seedPhaseSpanishDishes(prisma as never);

    const macros = [
      'calories', 'proteins', 'carbohydrates', 'sugars',
      'fats', 'saturatedFats', 'fiber', 'salt', 'sodium',
    ];
    const nutrientUpserts = prisma._calls.filter((c) => c.model === 'dishNutrient');

    for (const macro of macros) {
      const missing = nutrientUpserts.filter(
        (c) => !(macro in c.args.create),
      );
      expect(missing.length, `macro '${macro}' missing from DishNutrient create`).toBe(0);
    }
  });

  it('all 9 macro fields are present in DishNutrient update block', async () => {
    await seedPhaseSpanishDishes(prisma as never);

    const macros = [
      'calories', 'proteins', 'carbohydrates', 'sugars',
      'fats', 'saturatedFats', 'fiber', 'salt', 'sodium',
    ];
    const nutrientUpserts = prisma._calls.filter((c) => c.model === 'dishNutrient');

    for (const macro of macros) {
      const missing = nutrientUpserts.filter(
        (c) => !(macro in c.args.update),
      );
      expect(missing.length, `macro '${macro}' missing from DishNutrient update`).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — Restaurant upsert correctness
// ---------------------------------------------------------------------------

describe('F073 seed edge cases — Restaurant upsert', () => {
  let prisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(() => {
    prisma = buildMockPrisma();
  });

  it('upserts restaurant with correct chainSlug and countryCode', async () => {
    await seedPhaseSpanishDishes(prisma as never);

    const restaurantUpserts = prisma._calls.filter((c) => c.model === 'restaurant');
    expect(restaurantUpserts.length).toBeGreaterThanOrEqual(1);

    const r = restaurantUpserts[0]!;
    expect(r.args.create['chainSlug']).toBe('cocina-espanola');
    expect(r.args.create['countryCode']).toBe('ES');
  });

  it('upserts restaurant with the correct deterministic UUID', async () => {
    await seedPhaseSpanishDishes(prisma as never);

    const restaurantUpserts = prisma._calls.filter((c) => c.model === 'restaurant');
    const r = restaurantUpserts[0]!;
    expect(r.args.create['id']).toBe('00000000-0000-e073-0006-000000000001');
  });
});

// ---------------------------------------------------------------------------
// Tests — DataSource upsert correctness
// ---------------------------------------------------------------------------

describe('F073 seed edge cases — DataSource upserts', () => {
  let prisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(() => {
    prisma = buildMockPrisma();
  });

  it('upserts cocina-espanola-recipes DataSource with type=estimated and priorityTier=3', async () => {
    await seedPhaseSpanishDishes(prisma as never);

    const dsUpserts = prisma._calls.filter((c) => c.model === 'dataSource');
    const recipes = dsUpserts.find(
      (c) => c.args.create['id'] === '00000000-0000-e073-0000-000000000001',
    );

    expect(recipes).toBeDefined();
    expect(recipes!.args.create['type']).toBe('estimated');
    expect(recipes!.args.create['priorityTier']).toBe(3);
  });

  it('upserts BEDCA DataSource with type=official and priorityTier=1', async () => {
    await seedPhaseSpanishDishes(prisma as never);

    const dsUpserts = prisma._calls.filter((c) => c.model === 'dataSource');
    const bedca = dsUpserts.find(
      (c) => c.args.create['id'] === '00000000-0000-0000-0000-000000000003',
    );

    expect(bedca).toBeDefined();
    expect(bedca!.args.create['type']).toBe('official');
    expect(bedca!.args.create['priorityTier']).toBe(1);
  });

  it('BEDCA DataSource upsert update block is empty (no-op — must not overwrite existing data)', async () => {
    await seedPhaseSpanishDishes(prisma as never);

    const dsUpserts = prisma._calls.filter((c) => c.model === 'dataSource');
    const bedca = dsUpserts.find(
      (c) => c.args.create['id'] === '00000000-0000-0000-0000-000000000003',
    );

    expect(bedca).toBeDefined();
    expect(Object.keys(bedca!.args.update)).toHaveLength(0);
  });

  it('upserts exactly 2 DataSources (BEDCA + recipes)', async () => {
    await seedPhaseSpanishDishes(prisma as never);

    const dsUpserts = prisma._calls.filter((c) => c.model === 'dataSource');
    expect(dsUpserts).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Tests — Dish upsert count and required create fields
// ---------------------------------------------------------------------------

describe('F073 seed edge cases — Dish upsert count and fields', () => {
  let prisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(() => {
    prisma = buildMockPrisma();
  });

  it('upserts exactly 319 dishes', async () => {
    // F114: count updated 250 → 252 (Chuletón de buey + Chorizo ibérico embutido added)
    // F-H4: count updated 252 → 279 (+27 regional dishes — Canarias + other regions)
    // F-H6: count updated 279 → 307 (+28 new atoms — Cat21/Cat22 international + extended regional)
    // F-H9: count updated 307 → 317 (+10 Cat 29 atoms)
    // BUG-DATA-DUPLICATE-ATOM-001: count updated 317 → 316 (CE-281 collapsed into CE-095, 2026-04-28)
    // F-CHARCUTERIE-001: count updated 316 → 319 (+3 charcuterie atoms — Jamón serrano CE-318, Cecina CE-319, Lomo embuchado CE-320, 2026-04-29)
    await seedPhaseSpanishDishes(prisma as never);

    const dishUpserts = prisma._calls.filter((c) => c.model === 'dish');
    expect(dishUpserts).toHaveLength(319);
  });

  it('upserts exactly 319 DishNutrients', async () => {
    // F114: count updated 250 → 252 (Chuletón de buey + Chorizo ibérico embutido added)
    // F-H4: count updated 252 → 279 (+27 regional dishes — Canarias + other regions)
    // F-H6: count updated 279 → 307 (+28 new atoms — Cat21/Cat22 international + extended regional)
    // F-H9: count updated 307 → 317 (+10 Cat 29 atoms)
    // BUG-DATA-DUPLICATE-ATOM-001: count updated 317 → 316 (CE-281 collapsed into CE-095, 2026-04-28)
    // F-CHARCUTERIE-001: count updated 316 → 319 (+3 charcuterie atoms, 2026-04-29)
    await seedPhaseSpanishDishes(prisma as never);

    const nutrientUpserts = prisma._calls.filter((c) => c.model === 'dishNutrient');
    expect(nutrientUpserts).toHaveLength(319);
  });

  it('all Dish create blocks include nameSourceLocale=es', async () => {
    await seedPhaseSpanishDishes(prisma as never);

    const dishUpserts = prisma._calls.filter((c) => c.model === 'dish');
    const wrong = dishUpserts.filter(
      (c) => c.args.create['nameSourceLocale'] !== 'es',
    );
    expect(wrong.length).toBe(0);
  });

  it('all Dish create blocks include availability=available', async () => {
    await seedPhaseSpanishDishes(prisma as never);

    const dishUpserts = prisma._calls.filter((c) => c.model === 'dish');
    const wrong = dishUpserts.filter(
      (c) => c.args.create['availability'] !== 'available',
    );
    expect(wrong.length).toBe(0);
  });

  it('all Dish create blocks link to the cocina-espanola restaurant', async () => {
    await seedPhaseSpanishDishes(prisma as never);

    const dishUpserts = prisma._calls.filter((c) => c.model === 'dish');
    const wrongRestaurant = dishUpserts.filter(
      (c) => c.args.create['restaurantId'] !== '00000000-0000-e073-0006-000000000001',
    );
    expect(wrongRestaurant.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — Zero-vector backfill called
// ---------------------------------------------------------------------------

describe('F073 seed edge cases — zero-vector backfill', () => {
  let prisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(() => {
    prisma = buildMockPrisma();
  });

  it('calls $executeRaw once for the zero-vector backfill', async () => {
    await seedPhaseSpanishDishes(prisma as never);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
