/**
 * F080 — OFF Validator Unit Tests
 *
 * Tests for validateOffProduct() — all skip conditions.
 */
import { describe, it, expect } from 'vitest';
import { validateOffProduct } from '../ingest/off/offValidator.js';
import type { OffProduct } from '../ingest/off/types.js';

// ---------------------------------------------------------------------------
// Helper: build a minimal valid OFF product
// ---------------------------------------------------------------------------

function validProduct(overrides: Partial<OffProduct> = {}): OffProduct {
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
// Tests
// ---------------------------------------------------------------------------

describe('validateOffProduct', () => {
  it('returns valid=true for a fully valid product', () => {
    const result = validateOffProduct(validProduct());
    expect(result.valid).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('returns valid=false when both product_name and product_name_es are absent', () => {
    const result = validateOffProduct(
      validProduct({ product_name: undefined, product_name_es: undefined }),
    );
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.toLowerCase().includes('name'))).toBe(true);
  });

  it('returns valid=true when product_name_es is present but product_name is absent', () => {
    const result = validateOffProduct(
      validProduct({ product_name: undefined, product_name_es: 'Tortilla Hacendado' }),
    );
    expect(result.valid).toBe(true);
  });

  it('returns valid=true when product_name is present but product_name_es is absent', () => {
    const result = validateOffProduct(
      validProduct({ product_name: 'Tortilla de Patatas', product_name_es: undefined }),
    );
    expect(result.valid).toBe(true);
  });

  it('returns valid=false when nutriments block is missing', () => {
    const result = validateOffProduct(validProduct({ nutriments: undefined }));
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.toLowerCase().includes('nutriments'))).toBe(true);
  });

  it('returns valid=false when all 4 core nutriments are absent', () => {
    const result = validateOffProduct(
      validProduct({
        nutriments: {
          salt_100g: 1.0,
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.toLowerCase().includes('core'))).toBe(true);
  });

  it('returns valid=false when calories > 900 kcal/100g (corrupt data)', () => {
    const result = validateOffProduct(
      validProduct({
        nutriments: {
          'energy-kcal_100g': 950,
          proteins_100g: 6,
          carbohydrates_100g: 12,
          fat_100g: 9,
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes('950') && r.toLowerCase().includes('corrupt'))).toBe(true);
  });

  it('returns valid=true when calories = 900 kcal/100g (boundary)', () => {
    const result = validateOffProduct(
      validProduct({
        nutriments: {
          'energy-kcal_100g': 900,
          proteins_100g: 0,
          carbohydrates_100g: 0,
          fat_100g: 100,
        },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('returns valid=false when proteins_100g is missing (one of 4 required)', () => {
    const result = validateOffProduct(
      validProduct({
        nutriments: {
          'energy-kcal_100g': 160,
          carbohydrates_100g: 12,
          fat_100g: 9,
          // proteins_100g missing
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.toLowerCase().includes('core'))).toBe(true);
  });

  it('returns valid=false when both code and _id are absent', () => {
    const result = validateOffProduct(
      validProduct({ code: undefined, _id: undefined }),
    );
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.toLowerCase().includes('identifier'))).toBe(true);
  });

  it('returns valid=true when code is present and _id is absent', () => {
    const result = validateOffProduct(validProduct({ _id: undefined }));
    expect(result.valid).toBe(true);
  });

  it('returns valid=true when code is absent and _id is present', () => {
    const result = validateOffProduct(validProduct({ code: undefined }));
    expect(result.valid).toBe(true);
  });

  it('accumulates multiple failure reasons in reasons[]', () => {
    const result = validateOffProduct({
      // No code, no _id, no name, no nutriments
    });
    expect(result.valid).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('detects kcal from kJ conversion when energy-kcal_100g absent but energy_100g present', () => {
    // energy_100g in kJ: 3350 kJ / 4.184 ≈ 800.6 kcal — valid (below 900)
    const result = validateOffProduct(
      validProduct({
        nutriments: {
          energy_100g: 3350, // ~800 kcal — valid
          proteins_100g: 0,
          carbohydrates_100g: 0,
          fat_100g: 90,
          // no energy-kcal_100g
        },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects when kJ-converted calories > 900', () => {
    // 3850 kJ / 4.184 ≈ 920 kcal — over limit
    const result = validateOffProduct(
      validProduct({
        nutriments: {
          energy_100g: 3850,
          proteins_100g: 0,
          carbohydrates_100g: 0,
          fat_100g: 100,
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.toLowerCase().includes('corrupt'))).toBe(true);
  });

  it('returns valid=false when calories are negative', () => {
    const result = validateOffProduct(
      validProduct({
        nutriments: {
          'energy-kcal_100g': -50,
          proteins_100g: 6,
          carbohydrates_100g: 20,
          fat_100g: 3,
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes('Negative calories'))).toBe(true);
  });

  it('returns valid=false when proteins are negative', () => {
    const result = validateOffProduct(
      validProduct({
        nutriments: {
          'energy-kcal_100g': 200,
          proteins_100g: -5,
          carbohydrates_100g: 20,
          fat_100g: 3,
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes('Negative proteins'))).toBe(true);
  });

  it('returns valid=false when fats are negative', () => {
    const result = validateOffProduct(
      validProduct({
        nutriments: {
          'energy-kcal_100g': 200,
          proteins_100g: 6,
          carbohydrates_100g: 20,
          fat_100g: -3,
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes('Negative fats'))).toBe(true);
  });
});
