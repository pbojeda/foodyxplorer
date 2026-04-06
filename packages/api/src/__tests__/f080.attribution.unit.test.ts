/**
 * F080 — Attribution Unit Tests
 *
 * Tests for:
 * 1. EstimateSourceSchema: accepts new nullable ODbL attribution fields
 * 2. mapFoodRowToResult(): populates attribution fields for OFF source, null for non-OFF
 */
import { describe, it, expect } from 'vitest';
import { EstimateSourceSchema } from '@foodxplorer/shared';
import { mapFoodRowToResult } from '../estimation/types.js';
import { OFF_SOURCE_UUID } from '../ingest/off/types.js';
import type { FoodQueryRow } from '../estimation/types.js';

// ---------------------------------------------------------------------------
// Helper: build a FoodQueryRow with defaults
// ---------------------------------------------------------------------------

function foodRow(overrides: Partial<FoodQueryRow> = {}): FoodQueryRow {
  return {
    food_id: 'fd000000-0001-4000-a000-000000000001',
    food_name: 'Potato Omelette',
    food_name_es: 'Tortilla de Patatas',
    food_group: null,
    barcode: null,
    brand_name: null,
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
    source_id: '00000000-0000-0000-0000-000000000003', // BEDCA (non-OFF)
    source_name: 'BEDCA',
    source_type: 'official',
    source_url: 'https://www.bedca.net/',
    source_priority_tier: '1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// EstimateSourceSchema tests
// ---------------------------------------------------------------------------

describe('EstimateSourceSchema', () => {
  it('accepts attributionNote as a non-null string', () => {
    const result = EstimateSourceSchema.safeParse({
      id: 'fd000000-0001-4000-a000-000000000001',
      name: 'Open Food Facts',
      type: 'official',
      url: 'https://world.openfoodfacts.org/',
      priorityTier: 0,
      attributionNote: 'Valores de referencia: Tortilla de Patatas Hacendado (plato preparado industrial)',
    });
    expect(result.success).toBe(true);
  });

  it('accepts license as a non-null string', () => {
    const result = EstimateSourceSchema.safeParse({
      id: 'fd000000-0001-4000-a000-000000000001',
      name: 'Open Food Facts',
      type: 'official',
      url: 'https://world.openfoodfacts.org/',
      license: 'ODbL 1.0',
    });
    expect(result.success).toBe(true);
  });

  it('accepts sourceUrl as a valid URL string', () => {
    const result = EstimateSourceSchema.safeParse({
      id: 'fd000000-0001-4000-a000-000000000001',
      name: 'Open Food Facts',
      type: 'official',
      url: 'https://world.openfoodfacts.org/',
      sourceUrl: 'https://world.openfoodfacts.org/product/8480000123456',
    });
    expect(result.success).toBe(true);
  });

  it('accepts null for all three attribution fields', () => {
    const result = EstimateSourceSchema.safeParse({
      id: 'fd000000-0001-4000-a000-000000000001',
      name: 'BEDCA',
      type: 'official',
      url: null,
      attributionNote: null,
      license: null,
      sourceUrl: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts missing attribution fields (backward compatible)', () => {
    const result = EstimateSourceSchema.safeParse({
      id: 'fd000000-0001-4000-a000-000000000001',
      name: 'BEDCA',
      type: 'official',
      url: null,
    });
    expect(result.success).toBe(true);
    // Fields should be absent or undefined — not required
    if (result.success) {
      expect(result.data.attributionNote).toBeUndefined();
      expect(result.data.license).toBeUndefined();
      expect(result.data.sourceUrl).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// mapFoodRowToResult attribution tests
// ---------------------------------------------------------------------------

describe('mapFoodRowToResult — ODbL attribution', () => {
  it('produces attribution fields for OFF source with barcode and nameEs', () => {
    const row = foodRow({
      source_id: OFF_SOURCE_UUID,
      source_name: 'Open Food Facts',
      barcode: '8480000123456',
      food_name_es: 'Tortilla Hacendado',
    });
    const result = mapFoodRowToResult(row);

    expect(result.source.attributionNote).toBe(
      'Valores de referencia: Tortilla Hacendado (plato preparado industrial)',
    );
    expect(result.source.license).toBe('ODbL 1.0');
    expect(result.source.sourceUrl).toBe(
      'https://world.openfoodfacts.org/product/8480000123456',
    );
  });

  it('produces sourceUrl=null for OFF source with no barcode', () => {
    const row = foodRow({
      source_id: OFF_SOURCE_UUID,
      source_name: 'Open Food Facts',
      barcode: null,
      food_name_es: 'Tortilla Hacendado',
    });
    const result = mapFoodRowToResult(row);

    expect(result.source.sourceUrl).toBeNull();
    expect(result.source.attributionNote).not.toBeNull();
    expect(result.source.license).toBe('ODbL 1.0');
  });

  it('falls back to food_name in attributionNote when food_name_es is null', () => {
    const row = foodRow({
      source_id: OFF_SOURCE_UUID,
      source_name: 'Open Food Facts',
      barcode: '8480000123456',
      food_name: 'Potato Omelette Hacendado',
      food_name_es: null,
    });
    const result = mapFoodRowToResult(row);

    expect(result.source.attributionNote).toBe(
      'Valores de referencia: Potato Omelette Hacendado (plato preparado industrial)',
    );
    // attributionNote must never contain "null" or be null
    expect(result.source.attributionNote).not.toContain('null');
    expect(result.source.attributionNote).not.toBeNull();
  });

  it('uses fallback "Producto OFF" when both nameEs and name are absent', () => {
    const row = foodRow({
      source_id: OFF_SOURCE_UUID,
      source_name: 'Open Food Facts',
      food_name: '',
      food_name_es: null,
    });
    const result = mapFoodRowToResult(row);

    expect(result.source.attributionNote).toContain('Producto OFF');
  });

  it('produces null attribution fields for non-OFF source', () => {
    const row = foodRow({
      source_id: '00000000-0000-0000-0000-000000000003', // BEDCA
      source_name: 'BEDCA',
    });
    const result = mapFoodRowToResult(row);

    expect(result.source.attributionNote == null).toBe(true);
    expect(result.source.license == null).toBe(true);
    expect(result.source.sourceUrl == null).toBe(true);
  });
});
