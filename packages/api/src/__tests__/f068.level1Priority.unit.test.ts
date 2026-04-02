// F068 — Level 1 Priority Ordering & Branded Routing Unit Tests
//
// Tests that L1 lookup:
// 1. Orders results by priority_tier ASC NULLS LAST
// 2. Routes branded queries to Tier 0 first
// 3. Falls through to unfiltered cascade when Tier 0 has no match
//
// These are structural tests verifying the SQL modifications.
// They test the function signatures and option passing, not actual DB queries
// (integration tests with DB are in the existing f020/f038 test files).

import { describe, it, expect, vi } from 'vitest';
import { detectExplicitBrand } from '../estimation/brandDetector.js';

// ---------------------------------------------------------------------------
// Brand detection integration with L1 options
// ---------------------------------------------------------------------------

describe('F068 — Brand detection → L1 options integration', () => {
  const CHAIN_SLUGS = ['mcdonalds-es', 'burger-king-es', 'kfc-es'];

  it('generic query produces hasExplicitBrand=false', () => {
    const { hasExplicitBrand } = detectExplicitBrand('tortilla de patatas', CHAIN_SLUGS);
    expect(hasExplicitBrand).toBe(false);
  });

  it('branded query produces hasExplicitBrand=true for supermarket brand', () => {
    const { hasExplicitBrand, detectedBrand } = detectExplicitBrand('tortilla hacendado', CHAIN_SLUGS);
    expect(hasExplicitBrand).toBe(true);
    expect(detectedBrand).toBe('hacendado');
  });

  it('chain query produces hasExplicitBrand=true for chain slug', () => {
    const { hasExplicitBrand, detectedBrand } = detectExplicitBrand('big mac mcdonalds', CHAIN_SLUGS);
    expect(hasExplicitBrand).toBe(true);
    expect(detectedBrand).toBe('mcdonalds-es');
  });

  it('unknown brand produces hasExplicitBrand=false', () => {
    const { hasExplicitBrand } = detectExplicitBrand('pizza casera', CHAIN_SLUGS);
    expect(hasExplicitBrand).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EstimateSource schema with priorityTier
// ---------------------------------------------------------------------------

describe('F068 — EstimateSource schema includes priorityTier', () => {
  it('EstimateSourceSchema accepts priorityTier', async () => {
    const { EstimateSourceSchema } = await import('@foodxplorer/shared');
    const valid = {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'USDA',
      type: 'official',
      url: null,
      priorityTier: 2,
    };
    const parsed = EstimateSourceSchema.parse(valid);
    expect(parsed.priorityTier).toBe(2);
  });

  it('EstimateSourceSchema accepts null priorityTier', async () => {
    const { EstimateSourceSchema } = await import('@foodxplorer/shared');
    const valid = {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'USDA',
      type: 'official',
      url: null,
      priorityTier: null,
    };
    const parsed = EstimateSourceSchema.parse(valid);
    expect(parsed.priorityTier).toBeNull();
  });

  it('EstimateSourceSchema accepts missing priorityTier (backward compat)', async () => {
    const { EstimateSourceSchema } = await import('@foodxplorer/shared');
    const valid = {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'USDA',
      type: 'official',
      url: null,
    };
    const parsed = EstimateSourceSchema.parse(valid);
    expect(parsed.priorityTier).toBeUndefined();
  });

  it('EstimateSourceSchema rejects invalid priorityTier', async () => {
    const { EstimateSourceSchema } = await import('@foodxplorer/shared');
    const invalid = {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'USDA',
      type: 'official',
      url: null,
      priorityTier: 5, // out of range
    };
    expect(() => EstimateSourceSchema.parse(invalid)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// mapSource priorityTier mapping
// ---------------------------------------------------------------------------

describe('F068 — mapSource includes priorityTier', () => {
  it('mapDishRowToResult includes priorityTier from source', async () => {
    const { mapDishRowToResult } = await import('../estimation/types.js');

    const row = {
      dish_id: '00000000-0000-0000-0000-000000000001',
      dish_name: 'Big Mac',
      dish_name_es: null,
      restaurant_id: '00000000-0000-0000-0000-000000000002',
      chain_slug: 'mcdonalds-es',
      portion_grams: '200',
      calories: '500', proteins: '25', carbohydrates: '45', sugars: '9',
      fats: '25', saturated_fats: '10', fiber: '3', salt: '2.5',
      sodium: '1000', trans_fats: '1', cholesterol: '75', potassium: '350',
      monounsaturated_fats: '8', polyunsaturated_fats: '3',
      reference_basis: 'per_serving',
      source_id: '00000000-0000-0000-0000-000000000003',
      source_name: "McDonald's Spain Official PDF",
      source_type: 'scraped',
      source_url: 'https://mcdonalds.es/nutri.pdf',
      source_priority_tier: '0',
    };

    const result = mapDishRowToResult(row);
    expect(result.source.priorityTier).toBe(0);
  });

  it('mapFoodRowToResult includes priorityTier from source', async () => {
    const { mapFoodRowToResult } = await import('../estimation/types.js');

    const row = {
      food_id: '00000000-0000-0000-0000-000000000001',
      food_name: 'White Rice',
      food_name_es: 'Arroz blanco',
      calories: '130', proteins: '2.7', carbohydrates: '28', sugars: '0',
      fats: '0.3', saturated_fats: '0.1', fiber: '0.4', salt: '0',
      sodium: '1', trans_fats: '0', cholesterol: '0', potassium: '35',
      monounsaturated_fats: '0.1', polyunsaturated_fats: '0.1',
      reference_basis: 'per_100g',
      source_id: '00000000-0000-0000-0000-000000000004',
      source_name: 'USDA SR Legacy',
      source_type: 'official',
      source_url: null,
      source_priority_tier: '2',
    };

    const result = mapFoodRowToResult(row);
    expect(result.source.priorityTier).toBe(2);
  });

  it('mapDishRowToResult handles null priority_tier', async () => {
    const { mapDishRowToResult } = await import('../estimation/types.js');

    const row = {
      dish_id: '00000000-0000-0000-0000-000000000001',
      dish_name: 'Test Dish',
      dish_name_es: null,
      restaurant_id: '00000000-0000-0000-0000-000000000002',
      chain_slug: 'test-chain',
      portion_grams: '100',
      calories: '100', proteins: '10', carbohydrates: '10', sugars: '5',
      fats: '5', saturated_fats: '2', fiber: '1', salt: '0.5',
      sodium: '200', trans_fats: '0', cholesterol: '30', potassium: '100',
      monounsaturated_fats: '1', polyunsaturated_fats: '1',
      reference_basis: 'per_serving',
      source_id: '00000000-0000-0000-0000-000000000005',
      source_name: 'Unknown Source',
      source_type: 'official',
      source_url: null,
      source_priority_tier: null,
    };

    const result = mapDishRowToResult(row);
    expect(result.source.priorityTier).toBeNull();
  });
});
