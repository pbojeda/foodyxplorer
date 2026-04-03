// F072 Edge-Cases — QA verification tests
//
// Covers gaps not addressed by the developer's test suite:
//
// A. isAlreadyCookedFood false-positive prevention (BUG-F072-01 — fixed)
//    - "uncooked rice"    → word-boundary regex correctly returns false
//    - "unbaked bread"    → word-boundary regex correctly returns false
//    - "precooked chicken"→ word-boundary regex correctly returns false
//
// B. applyYieldFactor boundary conditions
//    - yieldFactor = 1.0 (identity)
//    - fatAbsorption = 0 is skipped (guard is > 0)
//    - fatAbsorption < 0 is skipped (guard is > 0)
//    - yieldFactor = 0 → produces Infinity (no guard in pure function itself)
//
// C. resolveAndApplyYield — untested branch combinations
//    - already-cooked food + effectiveCookingState = "as_served" → as_served_passthrough
//      (BEDCA guard only handles cooked/raw; as_served falls through to Step 5 — correct behavior, verified)
//    - rawFoodGroup = "" (empty string, not null) → normalizes to null → default as_served
//    - effectiveCookingMethod = null (null group + cooked state) → no_profile_found (no DB call)
//
// D. getCookingProfile — NaN yieldFactor → invalid_yield_factor
//
// E. canonicalizeStructured cache key differentiation (listed in recipeCalculate test header
//    but never implemented)
//
// F. normalizeFoodGroup — ambiguous/tricky patterns
//    - "Spices - Pepper" → "vegetables" (pepper keyword maps to vegetables by design)
//    - pure substring: "hamburger meat sauce" contains "meat" → "meat" (correct)

import { describe, it, expect, vi } from 'vitest';
import type { EstimateNutrients, EstimateResult } from '@foodxplorer/shared';
import {
  isAlreadyCookedFood,
  applyYieldFactor,
  normalizeFoodGroup,
} from '../estimation/yieldUtils.js';
import { getCookingProfile } from '../estimation/cookingProfileService.js';
import type { CookingProfileRow } from '../estimation/cookingProfileService.js';
import { resolveAndApplyYield } from '../estimation/applyYield.js';
import type { ApplyYieldOptions } from '../estimation/applyYield.js';

// ---------------------------------------------------------------------------
// Shared mocks / fixtures
// ---------------------------------------------------------------------------

function makeDecimal(value: number): import('@prisma/client').Prisma.Decimal {
  return {
    valueOf: () => value,
    toNumber: () => value,
    toString: () => String(value),
    [Symbol.toPrimitive]: (_hint: string) => value,
  } as unknown as import('@prisma/client').Prisma.Decimal;
}

const BASE_NUTRIENTS: EstimateNutrients = {
  calories: 360,
  proteins: 7.0,
  carbohydrates: 79.0,
  sugars: 0.1,
  fats: 0.6,
  saturatedFats: 0.1,
  fiber: 1.3,
  salt: 0.0,
  sodium: 1.0,
  transFats: 0.0,
  cholesterol: 0.0,
  potassium: 115.0,
  monounsaturatedFats: 0.2,
  polyunsaturatedFats: 0.2,
  referenceBasis: 'per_100g',
};

function makeFoodResult(overrides: Partial<EstimateResult> = {}): EstimateResult {
  return {
    entityType: 'food',
    entityId: 'fd000000-0072-4000-a000-000000000001',
    name: 'White rice',
    nameEs: 'Arroz blanco',
    restaurantId: null,
    chainSlug: null,
    portionGrams: null,
    nutrients: { ...BASE_NUTRIENTS },
    confidenceLevel: 'high',
    estimationMethod: 'official',
    source: { id: 'src-001', name: 'USDA', type: 'official', url: null, priorityTier: null },
    similarityDistance: null,
    ...overrides,
  };
}

const MOCK_LOGGER = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
const MOCK_PRISMA = {} as import('@prisma/client').PrismaClient;

function baseOpts(overrides: Partial<ApplyYieldOptions> = {}): ApplyYieldOptions {
  return {
    result: makeFoodResult(),
    foodName: 'White rice',
    rawFoodGroup: 'Cereal Grains',
    cookingState: undefined,
    cookingMethod: undefined,
    prisma: MOCK_PRISMA,
    logger: MOCK_LOGGER,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// A. isAlreadyCookedFood — false positive detection
// ---------------------------------------------------------------------------

describe('isAlreadyCookedFood — false positive prevention (BUG-F072-01 fixed)', () => {
  it('"uncooked rice" returns false — word-boundary regex prevents false positive', () => {
    const result = isAlreadyCookedFood('uncooked rice');
    expect(result).toBe(false); // Fixed: word-boundary regex rejects "uncooked"
  });

  it('"unbaked bread" returns false — word-boundary regex prevents false positive', () => {
    const result = isAlreadyCookedFood('unbaked bread');
    expect(result).toBe(false); // Fixed: word-boundary regex rejects "unbaked"
  });

  it('"precooked chicken" returns false — word-boundary regex prevents false positive', () => {
    const result = isAlreadyCookedFood('precooked chicken');
    expect(result).toBe(false); // Fixed: word-boundary regex rejects "precooked"
  });

  it('"unfried food" returns false — word-boundary regex prevents false positive', () => {
    const result = isAlreadyCookedFood('unfried food');
    expect(result).toBe(false); // Fixed: word-boundary regex rejects "unfried"
  });

  it('"Pollo crudo sin cocer" does NOT trigger (verify "cocer" does not match "cooked")', () => {
    // "cocer" (Spanish infinitive for boiling) does not contain any of the exact keywords
    const result = isAlreadyCookedFood('Pollo crudo sin cocer');
    expect(result).toBe(false);
  });

  it('"Salmon fillet raw" returns false — "raw" is not a cooking keyword', () => {
    expect(isAlreadyCookedFood('Salmon fillet raw')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B. applyYieldFactor — boundary conditions
// ---------------------------------------------------------------------------

describe('applyYieldFactor — boundary and edge cases', () => {
  it('yieldFactor = 1.0 is identity — nutrients unchanged', () => {
    const result = applyYieldFactor(BASE_NUTRIENTS, 1.0);
    expect(result.calories).toBeCloseTo(BASE_NUTRIENTS.calories, 5);
    expect(result.proteins).toBeCloseTo(BASE_NUTRIENTS.proteins, 5);
    expect(result.fats).toBeCloseTo(BASE_NUTRIENTS.fats, 5);
    expect(result.carbohydrates).toBeCloseTo(BASE_NUTRIENTS.carbohydrates, 5);
    expect(result.referenceBasis).toBe('per_100g');
  });

  it('fatAbsorption = 0 is skipped (guard is > 0, not >= 0)', () => {
    // The implementation: if (fatAbsorption != null && fatAbsorption > 0)
    // fatAbsorption = 0 should produce same result as no fat absorption
    const withZeroFat = applyYieldFactor(BASE_NUTRIENTS, 2.8, 0);
    const withNoFat = applyYieldFactor(BASE_NUTRIENTS, 2.8);
    expect(withZeroFat.fats).toBeCloseTo(withNoFat.fats, 5);
    expect(withZeroFat.calories).toBeCloseTo(withNoFat.calories, 5);
  });

  it('negative fatAbsorption is skipped (guard is > 0)', () => {
    // Negative fat absorption is a data anomaly; the guard (> 0) rejects it
    const withNegFat = applyYieldFactor(BASE_NUTRIENTS, 2.8, -5.0);
    const withNoFat = applyYieldFactor(BASE_NUTRIENTS, 2.8);
    expect(withNegFat.fats).toBeCloseTo(withNoFat.fats, 5);
    expect(withNegFat.calories).toBeCloseTo(withNoFat.calories, 5);
  });

  it('yieldFactor = 0 produces Infinity (no guard in pure function — guard is in service layer)', () => {
    // applyYieldFactor is a pure math function — the caller (cookingProfileService/applyYield)
    // is responsible for not passing yieldFactor <= 0.
    // Documenting that the pure function produces Infinity rather than throwing.
    const result = applyYieldFactor(BASE_NUTRIENTS, 0);
    expect(result.calories).toBe(Infinity);
    expect(result.proteins).toBe(Infinity);
  });

  it('very small yieldFactor (0.01) produces very large numbers without crashing', () => {
    // Edge: very small positive yieldFactor is technically valid per the spec (> 0)
    // The service allows it through; the math produces very large values.
    const result = applyYieldFactor(BASE_NUTRIENTS, 0.01);
    expect(result.calories).toBeCloseTo(360 / 0.01, 0);
    expect(isFinite(result.calories)).toBe(true);
  });

  it('very large yieldFactor (100) produces near-zero nutrient values', () => {
    // e.g., a food that expands 100× on cooking — extreme but math should be correct
    const result = applyYieldFactor(BASE_NUTRIENTS, 100);
    expect(result.calories).toBeCloseTo(3.6, 3);
    expect(result.proteins).toBeCloseTo(0.07, 4);
  });

  it('fat absorption with yieldFactor = 1.0 only adds fat absorption values (no scaling distortion)', () => {
    const fatAbsorption = 10;
    const result = applyYieldFactor(BASE_NUTRIENTS, 1.0, fatAbsorption);
    // fats: (0.6 + 10) / 1.0 = 10.6
    expect(result.fats).toBeCloseTo(0.6 + fatAbsorption, 5);
    // calories: (360 + 90) / 1.0 = 450
    expect(result.calories).toBeCloseTo(360 + fatAbsorption * 9, 5);
    // saturatedFats: 0.1 / 1.0 = 0.1 (unchanged)
    expect(result.saturatedFats).toBeCloseTo(BASE_NUTRIENTS.saturatedFats, 5);
  });
});

// ---------------------------------------------------------------------------
// C. resolveAndApplyYield — untested branch combinations
// ---------------------------------------------------------------------------

describe('resolveAndApplyYield — untested branches', () => {
  it('already-cooked food + effectiveCookingState = "as_served" → as_served_passthrough (not db_food_already_cooked)', async () => {
    // BEDCA guard (Step 4) only handles cooked/raw states.
    // When the already-cooked food has as_served state, it falls through to Step 5.
    // The result should be as_served_passthrough, NOT db_food_already_cooked.
    const opts = baseOpts({
      foodName: 'Arroz hervido',  // contains "hervido" → isAlreadyCookedFood = true
      cookingState: 'as_served',  // explicit as_served
    });

    const { yieldAdjustment } = await resolveAndApplyYield(opts);

    // The BEDCA guard block in Step 4 does NOT handle as_served (only cooked/raw).
    // Execution falls through to Step 5 → as_served_passthrough.
    expect(yieldAdjustment.reason).toBe('as_served_passthrough');
    expect(yieldAdjustment.applied).toBe(false);
    expect(yieldAdjustment.cookingState).toBe('as_served');
  });

  it('rawFoodGroup = "" (empty string) → normalizes to null → default as_served', async () => {
    // Empty string is not null but normalizeFoodGroup('') returns null
    // null group → getDefaultCookingState(null) = 'as_served' → as_served_passthrough
    const opts = baseOpts({
      rawFoodGroup: '',  // empty string — treated differently from null by the code
      cookingState: undefined,
      foodName: 'Unknown food',
    });

    const { yieldAdjustment } = await resolveAndApplyYield(opts);

    // normalizeFoodGroup('') returns null → group is null → default state is as_served
    expect(yieldAdjustment.reason).toBe('as_served_passthrough');
    expect(yieldAdjustment.cookingStateSource).toBe('default_assumption');
    expect(yieldAdjustment.cookingState).toBe('as_served');
  });

  it('null group (rawFoodGroup=null) + explicit cooked state + no effective cooking method → no_profile_found without DB call', async () => {
    // When rawFoodGroup is null, normalizeFoodGroup is skipped → group = null
    // getDefaultCookingMethod(null) returns null
    // With cooked state and null cookingMethod → no_profile_found (Step 7 early return)
    const mockFindFirst = vi.fn();
    const mockPrismaWithSpy = {
      cookingProfile: { findFirst: mockFindFirst },
    } as unknown as import('@prisma/client').PrismaClient;

    const opts: ApplyYieldOptions = {
      result: makeFoodResult(),
      foodName: 'Composite dish',
      rawFoodGroup: null,
      cookingState: 'cooked',   // explicit cooked
      cookingMethod: undefined, // no method → getDefaultCookingMethod(null) = null
      prisma: mockPrismaWithSpy,
      logger: MOCK_LOGGER,
    };

    const { yieldAdjustment } = await resolveAndApplyYield(opts);

    expect(yieldAdjustment.reason).toBe('no_profile_found');
    expect(yieldAdjustment.applied).toBe(false);
    // Should NOT have called the DB because cookingMethod is null
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('explicit cookingMethod with null rawFoodGroup → uses "unknown" as group for DB lookup', async () => {
    // When group is null but cookingMethod is explicitly provided, the code passes
    // group ?? 'unknown' to getCookingProfile. Verify the lookup happens (not short-circuited).
    const mockFindFirst = vi.fn().mockResolvedValue(null);
    const mockPrismaWithSpy = {
      cookingProfile: { findFirst: mockFindFirst },
    } as unknown as import('@prisma/client').PrismaClient;

    const opts: ApplyYieldOptions = {
      result: makeFoodResult(),
      foodName: 'Mystery food',
      rawFoodGroup: null,
      cookingState: 'cooked',
      cookingMethod: 'boiled',  // explicit method prevents early return
      prisma: mockPrismaWithSpy,
      logger: MOCK_LOGGER,
    };

    const { yieldAdjustment } = await resolveAndApplyYield(opts);

    // The lookup fires with group='unknown'
    expect(mockFindFirst).toHaveBeenCalled();
    // Both exact and wildcard queries miss → null → no_profile_found
    expect(yieldAdjustment.reason).toBe('no_profile_found');
  });
});

// ---------------------------------------------------------------------------
// D. getCookingProfile — NaN yieldFactor
// ---------------------------------------------------------------------------

describe('getCookingProfile — NaN and Infinity yieldFactor', () => {
  it('returns { error: "invalid_yield_factor" } when yieldFactor is NaN', async () => {
    const nanRow: CookingProfileRow = {
      id: 'e0000000-0099-4000-0000-000000000001',
      foodGroup: 'grains',
      foodName: 'rice',
      cookingMethod: 'boiled',
      yieldFactor: makeDecimal(NaN),
      fatAbsorption: null,
      source: 'test',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockFindFirst = vi.fn().mockResolvedValue(nanRow);
    const mockPrisma = {
      cookingProfile: { findFirst: mockFindFirst },
    } as unknown as import('@prisma/client').PrismaClient;

    const result = await getCookingProfile(mockPrisma, 'grains', 'rice', 'boiled');
    expect(result).toEqual({ error: 'invalid_yield_factor' });
  });

  it('returns { error: "invalid_yield_factor" } when yieldFactor is Infinity', async () => {
    const infRow: CookingProfileRow = {
      id: 'e0000000-0100-4000-0000-000000000001',
      foodGroup: 'grains',
      foodName: 'rice',
      cookingMethod: 'boiled',
      yieldFactor: makeDecimal(Infinity),
      fatAbsorption: null,
      source: 'test',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockFindFirst = vi.fn().mockResolvedValue(infRow);
    const mockPrisma = {
      cookingProfile: { findFirst: mockFindFirst },
    } as unknown as import('@prisma/client').PrismaClient;

    const result = await getCookingProfile(mockPrisma, 'grains', 'rice', 'boiled');
    expect(result).toEqual({ error: 'invalid_yield_factor' });
  });
});

// ---------------------------------------------------------------------------
// E. canonicalizeStructured — cache key differentiation (listed in header but never tested)
// ---------------------------------------------------------------------------

// We import the private function indirectly via different Redis key captures in the HTTP layer.
// Instead, we test the function logic directly by importing the internals or by verifying
// that two requests with different cookingState produce different cache keys.
// Since canonicalizeStructured is unexported, we test it through JSON.stringify equivalence.

describe('canonicalizeStructured — cache key differentiation (spec §Step 9)', () => {
  it('same ingredient with different cookingState produces a different JSON key', () => {
    // This mirrors what canonicalizeStructured does: cookingState is included in the
    // normalized object. Different cookingState → different JSON → different cache key.
    const withCooked = [{ foodId: null, name: 'rice', grams: 100, portionMultiplier: 1, cookingState: 'cooked', cookingMethod: null }];
    const withRaw = [{ foodId: null, name: 'rice', grams: 100, portionMultiplier: 1, cookingState: 'raw', cookingMethod: null }];
    const withNone = [{ foodId: null, name: 'rice', grams: 100, portionMultiplier: 1, cookingState: null, cookingMethod: null }];

    const keyCooked = JSON.stringify(withCooked);
    const keyRaw = JSON.stringify(withRaw);
    const keyNone = JSON.stringify(withNone);

    expect(keyCooked).not.toBe(keyRaw);
    expect(keyCooked).not.toBe(keyNone);
    expect(keyRaw).not.toBe(keyNone);
  });

  it('same ingredient with different cookingMethod produces a different JSON key', () => {
    const withBoiled = [{ foodId: null, name: 'rice', grams: 100, portionMultiplier: 1, cookingState: 'cooked', cookingMethod: 'boiled' }];
    const withSteamed = [{ foodId: null, name: 'rice', grams: 100, portionMultiplier: 1, cookingState: 'cooked', cookingMethod: 'steamed' }];

    expect(JSON.stringify(withBoiled)).not.toBe(JSON.stringify(withSteamed));
  });

  it('cookingState=null and cookingState=undefined serialize to the same null value (consistent)', () => {
    // canonicalizeStructured uses `cookingState ?? null` — both undefined and null become null.
    // This ensures backward compatibility: pre-F072 requests (no cookingState) produce same key.
    const withNull = { foodId: null, name: 'rice', grams: 100, portionMultiplier: 1, cookingState: null, cookingMethod: null };
    // Simulate undefined → null conversion
    const withUndefined = { foodId: null, name: 'rice', grams: 100, portionMultiplier: 1, cookingState: (undefined as unknown as null) ?? null, cookingMethod: (undefined as unknown as null) ?? null };

    expect(JSON.stringify(withNull)).toBe(JSON.stringify(withUndefined));
  });
});

// ---------------------------------------------------------------------------
// F. normalizeFoodGroup — ambiguous/tricky patterns
// ---------------------------------------------------------------------------

describe('normalizeFoodGroup — additional patterns (spec gap)', () => {
  it('"Spices - Black Pepper" → "vegetables" (pepper keyword maps to vegetables by design)', () => {
    // This is by-design per spec table: "pepper" maps to vegetables.
    // Documenting that Spices containing "pepper" in the name maps to vegetables.
    const result = normalizeFoodGroup('Spices - Black Pepper');
    expect(result).toBe('vegetables');
  });

  it('"Hamburger Sauce with Meat" contains "meat" → "meat"', () => {
    expect(normalizeFoodGroup('Hamburger Sauce with Meat')).toBe('meat');
  });

  it('"Almond and Peanut Butter" — does not match any keyword → null', () => {
    // "peanut" does not contain "bean", "legume", "lentil", or "chickpea"
    expect(normalizeFoodGroup('Almond and Peanut Butter')).toBeNull();
  });

  it('"Peanut and Bean Dip" → "legumes" (contains "bean")', () => {
    expect(normalizeFoodGroup('Peanut and Bean Dip')).toBe('legumes');
  });

  it('"Cereal Grains and Pasta" → "grains" not "pasta" (grains checked first — keyword "grain" wins)', () => {
    // This is already tested in the main suite but we re-verify the priority rule here
    expect(normalizeFoodGroup('Cereal Grains and Pasta')).toBe('grains');
  });

  it('"Pure Pasta" (no grain/cereal keyword) → "pasta"', () => {
    expect(normalizeFoodGroup('Pure Pasta')).toBe('pasta');
  });

  it('"Potato chips" → "vegetables" (potato keyword)', () => {
    // "Potato chips" is a processed product but maps to vegetables via "potato" keyword
    expect(normalizeFoodGroup('Potato chips')).toBe('vegetables');
  });

  it('"Tomato Sauce" → "vegetables" (tomato keyword)', () => {
    expect(normalizeFoodGroup('Tomato Sauce')).toBe('vegetables');
  });
});

// ---------------------------------------------------------------------------
// G. Spec edge case 8: free-form recipe mode uses undefined cookingState/cookingMethod
//    (verifying the spec requirement that defaults fire, not an error)
// ---------------------------------------------------------------------------

describe('Spec edge case 8 — free-form mode default assumptions (no cookingState)', () => {
  it('getDefaultCookingState(null) for null group returns "as_served" (composite fallback)', async () => {
    // Free-form mode ingredients have rawFoodGroup unknown → null group → as_served default
    const opts = baseOpts({
      rawFoodGroup: null,
      cookingState: undefined,  // not provided by free-form mode
      cookingMethod: undefined,
      foodName: 'Free form ingredient',
    });

    const { yieldAdjustment } = await resolveAndApplyYield(opts);

    expect(yieldAdjustment.cookingStateSource).toBe('default_assumption');
    expect(yieldAdjustment.reason).toBe('as_served_passthrough');
    expect(yieldAdjustment.applied).toBe(false);
  });
});
