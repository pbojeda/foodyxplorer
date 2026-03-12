import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizeNutrients,
  normalizeDish,
} from '../utils/normalize.js';
import type { RawDishData } from '../base/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RawNutrients = RawDishData['nutrients'];

function makeRawNutrients(overrides: Partial<RawNutrients> = {}): RawNutrients {
  return {
    calories: 500,
    proteins: 25,
    carbohydrates: 60,
    fats: 15,
    sugars: 10,
    saturatedFats: 5,
    fiber: 3,
    salt: 1,
    sodium: 400,
    ...overrides,
  };
}

function makeRawDish(overrides: Partial<RawDishData> = {}): RawDishData {
  return {
    name: 'Big Mac',
    aliases: [],
    nutrients: makeRawNutrients(),
    sourceUrl: 'https://example.com/product/big-mac',
    scrapedAt: new Date().toISOString(),
    ...overrides,
  };
}

const meta = {
  sourceId: 'a1b2c3d4-0000-4000-a000-000000000001',
  restaurantId: 'a1b2c3d4-0000-4000-a000-000000000002',
};

// ---------------------------------------------------------------------------
// normalizeNutrients
// ---------------------------------------------------------------------------

describe('normalizeNutrients', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('returns valid nutrients when all four required fields are present', () => {
    const result = normalizeNutrients(makeRawNutrients());
    expect(result).not.toBeNull();
    expect(result?.calories).toBe(500);
    expect(result?.proteins).toBe(25);
    expect(result?.carbohydrates).toBe(60);
    expect(result?.fats).toBe(15);
  });

  it('returns null when calories is absent', () => {
    const result = normalizeNutrients(makeRawNutrients({ calories: undefined }));
    expect(result).toBeNull();
  });

  it('returns null when proteins is absent', () => {
    const result = normalizeNutrients(makeRawNutrients({ proteins: undefined }));
    expect(result).toBeNull();
  });

  it('returns null when carbohydrates is absent', () => {
    const result = normalizeNutrients(
      makeRawNutrients({ carbohydrates: undefined }),
    );
    expect(result).toBeNull();
  });

  it('returns null when fats is absent', () => {
    const result = normalizeNutrients(makeRawNutrients({ fats: undefined }));
    expect(result).toBeNull();
  });

  it('returns null when fats is absent even if saturatedFats is present', () => {
    const result = normalizeNutrients(
      makeRawNutrients({ fats: undefined, saturatedFats: 8 }),
    );
    expect(result).toBeNull();
  });

  it('derives salt from sodium when only sodium is present', () => {
    // salt_g = sodium_mg / 1000 * 2.5
    const result = normalizeNutrients(
      makeRawNutrients({ salt: undefined, sodium: 400 }),
    );
    expect(result).not.toBeNull();
    // 400 / 1000 * 2.5 = 1.0
    expect(result?.salt).toBeCloseTo(1.0);
    expect(result?.sodium).toBe(400);
  });

  it('derives sodium from salt when only salt is present', () => {
    // sodium_mg = salt_g / 2.5 * 1000
    const result = normalizeNutrients(
      makeRawNutrients({ sodium: undefined, salt: 2 }),
    );
    expect(result).not.toBeNull();
    // 2 / 2.5 * 1000 = 800
    expect(result?.sodium).toBeCloseTo(800);
    expect(result?.salt).toBe(2);
  });

  it('uses both salt and sodium as-is when both are present', () => {
    const result = normalizeNutrients(
      makeRawNutrients({ salt: 1.5, sodium: 600 }),
    );
    expect(result).not.toBeNull();
    expect(result?.salt).toBe(1.5);
    expect(result?.sodium).toBe(600);
  });

  it('defaults both salt and sodium to 0 when both are absent', () => {
    const result = normalizeNutrients(
      makeRawNutrients({ salt: undefined, sodium: undefined }),
    );
    expect(result).not.toBeNull();
    expect(result?.salt).toBe(0);
    expect(result?.sodium).toBe(0);
  });

  it('clamps a negative calories value to 0 and logs a warning', () => {
    const result = normalizeNutrients(makeRawNutrients({ calories: -10 }));
    expect(result).not.toBeNull();
    expect(result?.calories).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('clamps a negative proteins value to 0 and logs a warning', () => {
    const result = normalizeNutrients(makeRawNutrients({ proteins: -5 }));
    expect(result).not.toBeNull();
    expect(result?.proteins).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns null when calories exceeds 9000 and logs an error', () => {
    const result = normalizeNutrients(makeRawNutrients({ calories: 9001 }));
    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('returns valid result when calories is exactly 9000', () => {
    const result = normalizeNutrients(makeRawNutrients({ calories: 9000 }));
    expect(result).not.toBeNull();
    expect(result?.calories).toBe(9000);
  });

  it('defaults sugars to 0 with a warn log when absent', () => {
    const result = normalizeNutrients(makeRawNutrients({ sugars: undefined }));
    expect(result).not.toBeNull();
    expect(result?.sugars).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('sets referenceBasis to per_serving unconditionally', () => {
    const result = normalizeNutrients(makeRawNutrients());
    expect(result?.referenceBasis).toBe('per_serving');
  });

  it('sets missing optional nutrients (fiber, transFats, etc.) to 0', () => {
    const result = normalizeNutrients(
      makeRawNutrients({
        fiber: undefined,
        transFats: undefined,
        cholesterol: undefined,
        potassium: undefined,
        monounsaturatedFats: undefined,
        polyunsaturatedFats: undefined,
      }),
    );
    expect(result).not.toBeNull();
    expect(result?.fiber).toBe(0);
    expect(result?.transFats).toBe(0);
    expect(result?.cholesterol).toBe(0);
    expect(result?.potassium).toBe(0);
    expect(result?.monounsaturatedFats).toBe(0);
    expect(result?.polyunsaturatedFats).toBe(0);
  });

  it('passes extra through unchanged', () => {
    const extra = { caffeine: 80, someOtherNutrient: 1.5 };
    const result = normalizeNutrients(makeRawNutrients({ extra }));
    expect(result?.extra).toEqual(extra);
  });

  it('coerces string "<1" to 0.5 for any nutrient field', () => {
    // The raw nutrients type uses number | undefined, but normalizeNutrients
    // accepts unknown values from chain extractors. We cast to test coercion.
    const raw = makeRawNutrients({
      sugars: '<1' as unknown as number,
    });
    const result = normalizeNutrients(raw);
    expect(result).not.toBeNull();
    expect(result?.sugars).toBe(0.5);
  });

  it('coerces string "tr" (trace) to 0', () => {
    const raw = makeRawNutrients({
      fiber: 'tr' as unknown as number,
    });
    const result = normalizeNutrients(raw);
    expect(result).not.toBeNull();
    expect(result?.fiber).toBe(0);
  });

  it('coerces an invalid string to 0 and logs a warning', () => {
    const raw = makeRawNutrients({
      fiber: 'abc' as unknown as number,
    });
    const result = normalizeNutrients(raw);
    expect(result).not.toBeNull();
    expect(result?.fiber).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// normalizeDish
// ---------------------------------------------------------------------------

describe('normalizeDish', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('trims leading and trailing whitespace from name', () => {
    const result = normalizeDish(makeRawDish({ name: '  Big Mac  ' }), meta);
    expect(result.name).toBe('Big Mac');
  });

  it('collapses multiple internal spaces in name to single spaces', () => {
    const result = normalizeDish(makeRawDish({ name: 'Big   Mac' }), meta);
    expect(result.name).toBe('Big Mac');
  });

  it('truncates externalId to 100 characters', () => {
    const longId = 'x'.repeat(150);
    const result = normalizeDish(makeRawDish({ externalId: longId }), meta);
    expect(result.externalId).toHaveLength(100);
  });

  it('trims externalId', () => {
    const result = normalizeDish(
      makeRawDish({ externalId: '  abc123  ' }),
      meta,
    );
    expect(result.externalId).toBe('abc123');
  });

  it('deduplicates aliases', () => {
    const result = normalizeDish(
      makeRawDish({ aliases: ['BigMac', 'Big Mac', 'BigMac'] }),
      meta,
    );
    expect(result.aliases).toEqual(['BigMac', 'Big Mac']);
  });

  it('trims each entry in aliases', () => {
    const result = normalizeDish(
      makeRawDish({ aliases: ['  BigMac  ', ' Big Mac '] }),
      meta,
    );
    expect(result.aliases).toEqual(['BigMac', 'Big Mac']);
  });

  it('sets confidenceLevel to medium', () => {
    const result = normalizeDish(makeRawDish(), meta);
    expect(result.confidenceLevel).toBe('medium');
  });

  it('sets estimationMethod to scraped', () => {
    const result = normalizeDish(makeRawDish(), meta);
    expect(result.estimationMethod).toBe('scraped');
  });

  it('sets availability to available', () => {
    const result = normalizeDish(makeRawDish(), meta);
    expect(result.availability).toBe('available');
  });

  it('attaches sourceId from meta', () => {
    const result = normalizeDish(makeRawDish(), meta);
    expect(result.sourceId).toBe(meta.sourceId);
  });

  it('attaches restaurantId from meta', () => {
    const result = normalizeDish(makeRawDish(), meta);
    expect(result.restaurantId).toBe(meta.restaurantId);
  });
});
