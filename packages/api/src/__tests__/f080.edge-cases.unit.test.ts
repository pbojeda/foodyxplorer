/**
 * F080 — Edge Case Tests (QA-authored)
 *
 * Covers gaps and bugs not addressed in developer-written tests:
 *
 * BUG-1: offValidator — null code/id crashes with TypeError (null.trim())
 * BUG-2: offValidator — null product_name passes name check (null !== undefined)
 * BUG-3: offMapper — whitespace barcode creates invalid externalId instead of using _id
 * GAP-4: offValidator — empty nutriments object {} treated same as absent (spec EC7)
 * GAP-5: offValidator — calorie boundary at exactly 900 and just above (901, 900.001)
 * GAP-6: offMapper — kJ conversion precision and boundary (kJ at 900 kcal threshold)
 * GAP-7: offMapper — brands field with leading/trailing whitespace around commas
 * GAP-8: offMapper — attribution note with special characters in product name
 * GAP-9: offValidator — nutriments has only non-core fields (e.g., only salt present)
 * GAP-10: seedPhaseOff — dry-run productsImported counts valid products (not 0)
 */

import { describe, it, expect } from 'vitest';
import { validateOffProduct } from '../ingest/off/offValidator.js';
import { mapOffProductToFood } from '../ingest/off/offMapper.js';
import { mapFoodRowToResult, OFF_SOURCE_UUID } from '../estimation/types.js';
import type { OffProduct } from '../ingest/off/types.js';
import type { FoodQueryRow } from '../estimation/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base(overrides: Partial<OffProduct> = {}): OffProduct {
  return {
    code: '8480000123456',
    _id: 'abc123',
    product_name: 'Tortilla de Patatas',
    product_name_es: 'Tortilla de Patatas',
    brands: 'Hacendado',
    nutriments: {
      'energy-kcal_100g': 160,
      proteins_100g: 6,
      carbohydrates_100g: 12,
      fat_100g: 9,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// BUG-1: null code field crashes validator with TypeError
// The OFF API can return JSON null for optional string fields at runtime.
// The validator uses `product.code !== undefined && product.code.trim()` which
// evaluates as: null !== undefined → true, then null.trim() → TypeError.
// ---------------------------------------------------------------------------

describe('BUG-1: null code/id crashes validator', () => {
  it('does NOT throw when product.code is null (JSON null from OFF API)', () => {
    // Simulates OFF API returning { code: null, _id: 'abc' } in JSON
    const product = base({ code: null as unknown as undefined });

    expect(() => validateOffProduct(product)).not.toThrow();
  });

  it('does NOT throw when product._id is null (JSON null from OFF API)', () => {
    const product = base({ _id: null as unknown as undefined });

    expect(() => validateOffProduct(product)).not.toThrow();
  });

  it('treats null code as absent and falls back to _id for identifier check', () => {
    const product = base({ code: null as unknown as undefined, _id: 'abc123' });
    const result = validateOffProduct(product);

    // _id is present → product should be valid (identifier found via _id)
    expect(result.valid).toBe(true);
  });

  it('returns invalid when BOTH code and _id are null', () => {
    const product = base({
      code: null as unknown as undefined,
      _id: null as unknown as undefined,
    });
    const result = validateOffProduct(product);

    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.toLowerCase().includes('identifier'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BUG-2: null product_name incorrectly passes name validation
// When product.product_name = null (JSON null), the validator checks:
//   product.product_name?.trim() !== ''  → null?.trim() = undefined → undefined !== '' → TRUE
//   product.product_name !== undefined   → null !== undefined → TRUE
// Both conditions pass, so hasName=true even though the name IS null.
// ---------------------------------------------------------------------------

describe('BUG-2: null product_name passes name validation incorrectly', () => {
  it('treats null product_name as absent (not as a valid name)', () => {
    // Both names are null — should fail name check
    const product = base({
      product_name: null as unknown as undefined,
      product_name_es: null as unknown as undefined,
    });
    const result = validateOffProduct(product);

    // Validator SHOULD reject this — null is not a valid name
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.toLowerCase().includes('name'))).toBe(true);
  });

  it('treats null product_name_es as absent when product_name is also null', () => {
    const product = base({
      product_name: null as unknown as undefined,
      product_name_es: null as unknown as undefined,
    });
    // Must not accept null as a valid name
    const result = validateOffProduct(product);
    expect(result.valid).toBe(false);
  });

  it('accepts product when product_name is null but product_name_es is a non-empty string', () => {
    const product = base({
      product_name: null as unknown as undefined,
      product_name_es: 'Tortilla Hacendado',
    });
    const result = validateOffProduct(product);
    // product_name_es is valid → should pass
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BUG-3: whitespace barcode creates invalid externalId
// computeExternalId uses `if (product.code)` (truthy check).
// A whitespace-only code like '   ' is truthy → creates 'OFF-   ' as externalId.
// The validator correctly rejects '   ' as a code identifier (trim() check),
// but if _id is present, the product passes validation.
// The mapper then creates the wrong externalId.
// ---------------------------------------------------------------------------

describe('BUG-3: whitespace barcode creates invalid externalId in mapper', () => {
  it('uses _id for externalId when code is whitespace-only', () => {
    // Whitespace code: validator accepts via _id, mapper should also use _id
    const product = base({ code: '   ', _id: 'abc123' });

    // First verify validator accepts it (via _id)
    const validation = validateOffProduct(product);
    expect(validation.valid).toBe(true);

    // Then verify mapper uses _id (not the whitespace code)
    const mapped = mapOffProductToFood(product);
    expect(mapped.food.externalId).toBe('OFF-id-abc123');
    // Must NOT contain the whitespace barcode
    expect(mapped.food.externalId).not.toContain('   ');
  });

  it('sets barcode to null when code is whitespace-only', () => {
    const product = base({ code: '   ', _id: 'abc123' });
    const mapped = mapOffProductToFood(product);

    // A whitespace barcode is not a valid EAN barcode
    expect(mapped.food.barcode).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GAP-4: empty nutriments object — spec Edge Case 7
// Spec: 'A nutriments block that exists but contains no core nutrient keys is treated the same as absent.'
// The validator handles this (empty {} fails the macro check) but no test covered it.
// ---------------------------------------------------------------------------

describe('GAP-4: empty nutriments object {} treated as absent', () => {
  it('rejects product with nutriments={} (empty, no core keys)', () => {
    const product = base({ nutriments: {} });
    const result = validateOffProduct(product);

    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.toLowerCase().includes('core') || r.toLowerCase().includes('macro'))).toBe(true);
  });

  it('rejects product with nutriments containing only non-core fields (e.g., only salt)', () => {
    const product = base({
      nutriments: {
        salt_100g: 1.0,
        // No energy, proteins, carbohydrates, fat
      },
    });
    const result = validateOffProduct(product);

    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.toLowerCase().includes('core') || r.toLowerCase().includes('macro'))).toBe(true);
  });

  it('accepts product with nutriments containing all 4 core keys even if others absent', () => {
    const product = base({
      nutriments: {
        'energy-kcal_100g': 200,
        proteins_100g: 10,
        carbohydrates_100g: 20,
        fat_100g: 8,
        // No sugars, fiber, salt, etc.
      },
    });
    const result = validateOffProduct(product);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GAP-5: calorie boundary edge cases
// Spec: calories > 900 is rejected; calories = 900 is accepted.
// Additional boundaries: 900.001, 901, 0.
// ---------------------------------------------------------------------------

describe('GAP-5: calorie boundary edge cases', () => {
  it('accepts calories = 900.0 (exact boundary — pure fat)', () => {
    const product = base({
      nutriments: { 'energy-kcal_100g': 900, proteins_100g: 0, carbohydrates_100g: 0, fat_100g: 100 },
    });
    const result = validateOffProduct(product);
    expect(result.valid).toBe(true);
  });

  it('rejects calories = 900.001 (fractional excess)', () => {
    const product = base({
      nutriments: { 'energy-kcal_100g': 900.001, proteins_100g: 0, carbohydrates_100g: 0, fat_100g: 100 },
    });
    const result = validateOffProduct(product);
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.toLowerCase().includes('corrupt'))).toBe(true);
  });

  it('rejects calories = 901 (clearly over limit)', () => {
    const product = base({
      nutriments: { 'energy-kcal_100g': 901, proteins_100g: 0, carbohydrates_100g: 0, fat_100g: 100 },
    });
    const result = validateOffProduct(product);
    expect(result.valid).toBe(false);
  });

  it('accepts calories = 0 (valid for water, tea, etc.)', () => {
    const product = base({
      nutriments: { 'energy-kcal_100g': 0, proteins_100g: 0, carbohydrates_100g: 0, fat_100g: 0 },
    });
    const result = validateOffProduct(product);
    expect(result.valid).toBe(true);
  });

  it('accepts calories = 1 (minimum non-zero)', () => {
    const product = base({
      nutriments: { 'energy-kcal_100g': 1, proteins_100g: 0.1, carbohydrates_100g: 0.1, fat_100g: 0.1 },
    });
    const result = validateOffProduct(product);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GAP-6: kJ conversion boundary at 900 kcal threshold
// 900 kcal × 4.184 = 3765.6 kJ → borderline acceptance.
// ---------------------------------------------------------------------------

describe('GAP-6: kJ-to-kcal conversion boundary', () => {
  it('accepts energy_100g = 3765 kJ (~899.8 kcal — just under limit)', () => {
    const product = base({
      nutriments: {
        energy_100g: 3765,    // 3765 / 4.184 = 899.8 kcal — valid
        proteins_100g: 0,
        carbohydrates_100g: 0,
        fat_100g: 100,
      },
    });
    const result = validateOffProduct(product);
    expect(result.valid).toBe(true);
  });

  it('rejects energy_100g = 3768 kJ (~900.7 kcal — just over limit)', () => {
    const product = base({
      nutriments: {
        energy_100g: 3768,    // 3768 / 4.184 ≈ 900.57 kcal — should be rejected
        proteins_100g: 0,
        carbohydrates_100g: 0,
        fat_100g: 100,
      },
    });
    const result = validateOffProduct(product);
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.toLowerCase().includes('corrupt'))).toBe(true);
  });

  it('converts kJ correctly: 837 kJ → 200 kcal', () => {
    // 837 kJ / 4.184 ≈ 200 kcal
    const product = base({
      nutriments: {
        energy_100g: 837,
        proteins_100g: 5,
        carbohydrates_100g: 10,
        fat_100g: 8,
      },
    });
    const { nutrients } = mapOffProductToFood(product);
    expect(nutrients.calories).toBeCloseTo(200, 0);
  });
});

// ---------------------------------------------------------------------------
// GAP-7: brands field edge cases in mapper
// Spec Edge Case 12: use only first entry after splitting on comma; trim and lowercase.
// ---------------------------------------------------------------------------

describe('GAP-7: brands field edge cases', () => {
  it('normalizes brands with extra whitespace around comma separator', () => {
    const product = base({ brands: '  Hacendado  ,  Mercadona  ' });
    const { food } = mapOffProductToFood(product);
    // First brand after split on ',' and trim+lowercase
    expect(food.brandName).toBe('hacendado');
  });

  it('normalizes brands with mixed case', () => {
    const product = base({ brands: 'HACENDADO' });
    const { food } = mapOffProductToFood(product);
    expect(food.brandName).toBe('hacendado');
  });

  it('handles single brand (no comma) correctly', () => {
    const product = base({ brands: 'Hacendado' });
    const { food } = mapOffProductToFood(product);
    expect(food.brandName).toBe('hacendado');
  });

  it('handles brands field that is only whitespace — sets brandName to null', () => {
    // A brands field of just spaces should not produce a non-null brandName
    const product = base({ brands: '   ' });
    const { food } = mapOffProductToFood(product);
    // '   '.split(',')[0].trim().toLowerCase() = '' → brandName should be null
    expect(food.brandName).toBeNull();
  });

  it('handles empty brands string — sets brandName to null', () => {
    const product = base({ brands: '' });
    const { food } = mapOffProductToFood(product);
    expect(food.brandName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GAP-8: attribution note with special characters in product name
// The attributionNote interpolates nameEs directly.
// Test that special characters don't break the string format.
// ---------------------------------------------------------------------------

describe('GAP-8: attribution note with special characters in product name', () => {
  it('includes special characters from nameEs in attributionNote', () => {
    const row: FoodQueryRow = {
      food_id: 'fd000000-0001-4000-a000-000000000001',
      food_name: 'Croquetas de Jamon',
      food_name_es: 'Croquetas de Jamón (con queso & bechamel)',
      food_group: null,
      barcode: '8480000111111',
      brand_name: 'hacendado',
      calories: '200',
      proteins: '8',
      carbohydrates: '15',
      sugars: '1',
      fats: '10',
      saturated_fats: '3',
      fiber: '1',
      salt: '0.8',
      sodium: '0.32',
      trans_fats: '0',
      cholesterol: '0.05',
      potassium: '0.2',
      monounsaturated_fats: '5',
      polyunsaturated_fats: '1',
      alcohol: '0',
      reference_basis: 'per_100g',
      source_id: OFF_SOURCE_UUID,
      source_name: 'Open Food Facts',
      source_type: 'official',
      source_url: 'https://world.openfoodfacts.org/',
      source_priority_tier: '0',
    };

    const result = mapFoodRowToResult(row);

    expect(result.source.attributionNote).toBe(
      'Valores de referencia: Croquetas de Jamón (con queso & bechamel) (plato preparado industrial)',
    );
    expect(result.source.attributionNote).not.toBeNull();
  });

  it('attributionNote includes nameEs with accented characters correctly', () => {
    const row: FoodQueryRow = {
      food_id: 'fd000000-0001-4000-a000-000000000002',
      food_name: 'Tortilla de Patatas',
      food_name_es: 'Tortilla de Patatas con Cebolla',
      food_group: null,
      barcode: '8480000222222',
      brand_name: 'hacendado',
      calories: '160',
      proteins: '6',
      carbohydrates: '12',
      sugars: '1',
      fats: '9',
      saturated_fats: '2',
      fiber: '0.5',
      salt: '0.5',
      sodium: '0.2',
      trans_fats: '0',
      cholesterol: '0.2',
      potassium: '0.2',
      monounsaturated_fats: '4',
      polyunsaturated_fats: '1',
      alcohol: '0',
      reference_basis: 'per_100g',
      source_id: OFF_SOURCE_UUID,
      source_name: 'Open Food Facts',
      source_type: 'official',
      source_url: 'https://world.openfoodfacts.org/',
      source_priority_tier: '0',
    };

    const result = mapFoodRowToResult(row);

    expect(result.source.attributionNote).toContain('Tortilla de Patatas con Cebolla');
    expect(result.source.attributionNote).toContain('plato preparado industrial');
  });
});

// ---------------------------------------------------------------------------
// GAP-9: seedPhaseOff dry-run productsImported counts valid products
// Spec AC3: "dry run... prints the same summary counts"
// Per implementation: dry-run increments productsImported for valid products
// (no DB writes happen, but the count reflects what would have been imported).
// ---------------------------------------------------------------------------

describe('GAP-9: seedPhaseOff dry-run productsImported counts valid products', () => {
  it('productsImported reflects valid product count (not 0) in dry-run', async () => {
    process.env['NODE_ENV'] = 'test';
    const { seedPhaseOff } = await import('../scripts/seedPhaseOff.js');

    const mockPrisma = {
      dataSource: { upsert: () => Promise.resolve({ id: '00000000-0000-0000-0000-000000000004' }) },
      food: { upsert: () => Promise.resolve({ id: 'mock-id' }) },
      foodNutrient: { upsert: () => Promise.resolve({ id: 'mock-id' }) },
      $executeRaw: () => Promise.resolve(0),
    } as unknown as import('@prisma/client').PrismaClient;

    const result = await seedPhaseOff(mockPrisma, {
      dryRun: true,
      products: [
        {
          code: '001',
          _id: 'id-001',
          product_name: 'Product A',
          product_name_es: 'Producto A',
          brands: 'Hacendado',
          nutriments: {
            'energy-kcal_100g': 160,
            proteins_100g: 6,
            carbohydrates_100g: 12,
            fat_100g: 9,
          },
        },
        {
          code: '002',
          _id: 'id-002',
          product_name: 'Product B',
          product_name_es: 'Producto B',
          brands: 'Hacendado',
          nutriments: {
            'energy-kcal_100g': 200,
            proteins_100g: 8,
            carbohydrates_100g: 15,
            fat_100g: 7,
          },
        },
        // One invalid product (missing names and nutriments)
        { code: 'bad1', _id: 'id-bad1' },
      ],
    });

    // Dry-run counts valid products as "imported" (no DB writes)
    expect(result.productsFound).toBe(3);
    expect(result.productsImported).toBe(2); // valid products — what would be imported
    expect(result.productsSkipped).toBe(1);  // invalid product
  });
});

// ---------------------------------------------------------------------------
// GAP-10: offMapper — missing both code and _id (validator catches it)
// Per spec Edge Case 14, products with neither code nor _id must be skipped.
// This test verifies the validator is the safety net before mapper is called.
// ---------------------------------------------------------------------------

describe('GAP-10: products missing both code and _id', () => {
  it('validator catches missing both code and _id — mapper is never called', () => {
    const product = base({ code: undefined, _id: undefined });

    const validation = validateOffProduct(product);
    expect(validation.valid).toBe(false);
    expect(validation.reasons.some((r) => r.toLowerCase().includes('identifier'))).toBe(true);
  });

  it('validator also catches empty string code AND empty string _id', () => {
    const product = base({ code: '', _id: '' });

    const validation = validateOffProduct(product);
    expect(validation.valid).toBe(false);
    expect(validation.reasons.some((r) => r.toLowerCase().includes('identifier'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GAP-11: offClient — empty products array from OFF API on first page
// When OFF returns an empty products array immediately, loop should terminate.
// ---------------------------------------------------------------------------

describe('GAP-11: offClient — empty response on first page terminates immediately', () => {
  it('returns empty array when OFF returns empty products on page 1', async () => {
    const { fetchProductsByBrand } = await import('../ingest/off/offClient.js');

    const mockFetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ products: [], count: 0, page_size: 100 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const result = await fetchProductsByBrand('hacendado', {
      fetchImpl: mockFetch as typeof fetch,
      retryDelayMs: 0,
    });

    expect(result).toHaveLength(0);
  });

  it('returns empty array when OFF returns null/undefined products field', async () => {
    const { fetchProductsByBrand } = await import('../ingest/off/offClient.js');

    const mockFetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ count: 0 }), { // no products field
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const result = await fetchProductsByBrand('hacendado', {
      fetchImpl: mockFetch as typeof fetch,
      retryDelayMs: 0,
    });

    expect(result).toHaveLength(0);
  });
});
