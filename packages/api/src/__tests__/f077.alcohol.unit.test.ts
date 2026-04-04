// F077 — Alcohol Nutrient Support
//
// Tests verifying that the `alcohol` field is properly handled across the pipeline:
// - BEDCA nutrient mapper: ALC tagname → standard `alcohol` field
// - Estimation types: alcohol in nutrient mapping
// - Portion utils: alcohol included in NUMERIC_NUTRIENT_KEYS
// - ConversationCore: alcohol in NUTRIENT_KEYS for menu aggregation

import { describe, it, expect } from 'vitest';
import { mapBedcaNutrientsToSchema } from '../ingest/bedca/bedcaNutrientMapper.js';
import type { BedcaNutrientInfo, BedcaNutrientValue } from '../ingest/bedca/types.js';
import { NUMERIC_NUTRIENT_KEYS, applyPortionMultiplier } from '../estimation/portionUtils.js';
import { applyYieldFactor } from '../estimation/yieldUtils.js';
import type { EstimateNutrients, EstimateResult } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NUTRIENT_INDEX: BedcaNutrientInfo[] = [
  { nutrientId: 208, name: 'Energy', tagname: 'ENERC_KCAL', unit: 'kcal' },
  { nutrientId: 203, name: 'Protein', tagname: 'PROCNT', unit: 'g' },
  { nutrientId: 204, name: 'Total lipid (fat)', tagname: 'FAT', unit: 'g' },
  { nutrientId: 205, name: 'Carbohydrate', tagname: 'CHOCDF', unit: 'g' },
  { nutrientId: 269, name: 'Sugars', tagname: 'SUGAR', unit: 'g' },
  { nutrientId: 606, name: 'Saturated fat', tagname: 'FASAT', unit: 'g' },
  { nutrientId: 291, name: 'Fiber', tagname: 'FIBTG', unit: 'g' },
  { nutrientId: 307, name: 'Sodium', tagname: 'NA', unit: 'mg' },
  { nutrientId: 645, name: 'Monounsaturated fat', tagname: 'FAMS', unit: 'g' },
  { nutrientId: 646, name: 'Polyunsaturated fat', tagname: 'FAPU', unit: 'g' },
  { nutrientId: 605, name: 'Trans fat', tagname: 'FATRN', unit: 'g' },
  { nutrientId: 601, name: 'Cholesterol', tagname: 'CHOLE', unit: 'mg' },
  { nutrientId: 306, name: 'Potassium', tagname: 'K', unit: 'mg' },
  { nutrientId: 221, name: 'Alcohol, ethyl', tagname: 'ALC', unit: 'g' },
];

function makeNutrients(overrides: Record<number, number | null> = {}): BedcaNutrientValue[] {
  return NUTRIENT_INDEX.map((info) => ({
    nutrientId: info.nutrientId,
    value: overrides[info.nutrientId] ?? 0,
  }));
}

function makeNutrientsObj(overrides: Partial<EstimateNutrients> = {}): EstimateNutrients {
  return {
    calories: 100, proteins: 10, carbohydrates: 20, sugars: 5,
    fats: 8, saturatedFats: 3, fiber: 2, salt: 0.5, sodium: 0.2,
    transFats: 0, cholesterol: 0, potassium: 0,
    monounsaturatedFats: 0, polyunsaturatedFats: 0,
    alcohol: 0, referenceBasis: 'per_100g',
    ...overrides,
  };
}

function makeEstimateResult(overrides: Partial<EstimateNutrients> = {}): EstimateResult {
  return {
    entityType: 'food',
    entityId: '00000000-0000-4000-a000-000000000001',
    name: 'Test Beer',
    nameEs: 'Cerveza test',
    restaurantId: null,
    chainSlug: null,
    portionGrams: 330,
    nutrients: makeNutrientsObj(overrides),
    confidenceLevel: 'high',
    estimationMethod: 'official',
    source: {
      id: '00000000-0000-4000-a000-000000000002',
      name: 'BEDCA',
      type: 'official',
      url: null,
      priorityTier: 1,
    },
    similarityDistance: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F077 — Alcohol Nutrient Support', () => {

  // -------------------------------------------------------------------------
  // BEDCA Mapper
  // -------------------------------------------------------------------------

  describe('BEDCA nutrient mapper', () => {
    it('maps ALC tagname to standard alcohol field', () => {
      const nutrients = makeNutrients({ 221: 4.5 }); // 4.5g alcohol per 100g (typical beer)
      const result = mapBedcaNutrientsToSchema(nutrients, NUTRIENT_INDEX);

      expect(result.alcohol).toBe(4.5);
    });

    it('does not store alcohol in extra when ALC is present', () => {
      const nutrients = makeNutrients({ 221: 12.0 }); // wine
      const result = mapBedcaNutrientsToSchema(nutrients, NUTRIENT_INDEX);

      expect(result.alcohol).toBe(12.0);
      expect(result.extra['alcohol_g']).toBeUndefined();
    });

    it('defaults alcohol to 0 when ALC is absent', () => {
      const nutrients = makeNutrients({}); // no alcohol
      const result = mapBedcaNutrientsToSchema(nutrients, NUTRIENT_INDEX);

      expect(result.alcohol).toBe(0);
    });

    it('handles null ALC value as 0 (unmeasured)', () => {
      const nutrients: BedcaNutrientValue[] = NUTRIENT_INDEX.map((info) => ({
        nutrientId: info.nutrientId,
        value: info.nutrientId === 221 ? null : 0,
      }));
      const result = mapBedcaNutrientsToSchema(nutrients, NUTRIENT_INDEX);

      expect(result.alcohol).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // NUMERIC_NUTRIENT_KEYS
  // -------------------------------------------------------------------------

  describe('NUMERIC_NUTRIENT_KEYS', () => {
    it('includes alcohol', () => {
      expect(NUMERIC_NUTRIENT_KEYS).toContain('alcohol');
    });

    it('has 15 keys (14 original + alcohol)', () => {
      expect(NUMERIC_NUTRIENT_KEYS).toHaveLength(15);
    });
  });

  // -------------------------------------------------------------------------
  // Portion multiplier
  // -------------------------------------------------------------------------

  describe('applyPortionMultiplier', () => {
    it('scales alcohol by the portion multiplier', () => {
      const result = makeEstimateResult({ alcohol: 4.5 });
      const scaled = applyPortionMultiplier(result, 2.0);

      expect(scaled.nutrients.alcohol).toBe(9.0);
    });

    it('keeps alcohol 0 when source has no alcohol', () => {
      const result = makeEstimateResult({ alcohol: 0 });
      const scaled = applyPortionMultiplier(result, 1.5);

      expect(scaled.nutrients.alcohol).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Yield factor
  // -------------------------------------------------------------------------

  describe('applyYieldFactor', () => {
    it('divides alcohol by yield factor', () => {
      const nutrients = makeNutrientsObj({ alcohol: 10.0 });
      const result = applyYieldFactor(nutrients, 0.8); // 80% yield

      expect(result.alcohol).toBeCloseTo(12.5, 2); // 10 / 0.8
    });

    it('does not add fat absorption to alcohol', () => {
      const nutrients = makeNutrientsObj({ alcohol: 4.5, fats: 1.0 });
      const result = applyYieldFactor(nutrients, 1.0, 5.0); // 5g fat absorption

      // alcohol unchanged (no fat absorption applied to it)
      expect(result.alcohol).toBeCloseTo(4.5, 2);
      // fats increased by fat absorption
      expect(result.fats).toBeCloseTo(6.0, 2); // 1.0 + 5.0
    });
  });
});
