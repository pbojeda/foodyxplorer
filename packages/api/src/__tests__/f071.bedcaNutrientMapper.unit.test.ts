/**
 * F071 — BEDCA Nutrient Mapper Unit Tests
 *
 * Tests for mapping BEDCA nutrient IDs → nutriXplorer schema columns.
 *
 * Key behaviors:
 * - Standard fields mapped from correct INFOODS tagnames
 * - Sodium, potassium, cholesterol: mg→g conversion
 * - Salt derived: sodium_g * 2.5 (EU Regulation 1169/2011)
 * - Missing standard nutrients default to 0 (not null — DB requires number)
 * - Unmeasured standard fields tracked in extra.unmeasured[]
 * - Non-standard nutrients → extra.nutrients[]
 * - Alcohol (ALC tagname) → standard alcohol field (promoted in F077)
 * - Empty/all-null nutrients → all-zeros MappedNutrients
 */
import { describe, it, expect } from 'vitest';
import { mapBedcaNutrientsToSchema } from '../ingest/bedca/bedcaNutrientMapper.js';
import type { BedcaNutrientInfo, BedcaNutrientValue } from '../ingest/bedca/types.js';

// ---------------------------------------------------------------------------
// Fixture: a realistic BEDCA nutrient index subset
// ---------------------------------------------------------------------------
const NUTRIENT_INDEX: BedcaNutrientInfo[] = [
  { nutrientId: 208, name: 'Energy', tagname: 'ENERC_KCAL', unit: 'kcal' },
  { nutrientId: 203, name: 'Protein', tagname: 'PROCNT', unit: 'g' },
  { nutrientId: 205, name: 'Carbohydrate, by difference', tagname: 'CHOCDF', unit: 'g' },
  { nutrientId: 269, name: 'Sugars, total including NLEA', tagname: 'SUGAR', unit: 'g' },
  { nutrientId: 204, name: 'Total lipid (fat)', tagname: 'FAT', unit: 'g' },
  { nutrientId: 606, name: 'Fatty acids, total saturated', tagname: 'FASAT', unit: 'g' },
  { nutrientId: 291, name: 'Fiber, total dietary', tagname: 'FIBTG', unit: 'g' },
  { nutrientId: 307, name: 'Sodium, Na', tagname: 'NA', unit: 'mg' },
  { nutrientId: 645, name: 'Fatty acids, total monounsaturated', tagname: 'FAMS', unit: 'g' },
  { nutrientId: 646, name: 'Fatty acids, total polyunsaturated', tagname: 'FAPU', unit: 'g' },
  { nutrientId: 605, name: 'Fatty acids, total trans', tagname: 'FATRN', unit: 'g' },
  { nutrientId: 601, name: 'Cholesterol', tagname: 'CHOLE', unit: 'mg' },
  { nutrientId: 306, name: 'Potassium, K', tagname: 'K', unit: 'mg' },
  { nutrientId: 221, name: 'Alcohol, ethyl', tagname: 'ALC', unit: 'g' },
  { nutrientId: 401, name: 'Vitamin C', tagname: 'VITC', unit: 'mg' },
  { nutrientId: 303, name: 'Iron, Fe', tagname: 'FE', unit: 'mg' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeNutrients(values: Record<number, number | null>): BedcaNutrientValue[] {
  return Object.entries(values).map(([id, val]) => ({
    nutrientId: Number(id),
    value: val,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('mapBedcaNutrientsToSchema', () => {
  it('maps standard fields from correct INFOODS tagnames', () => {
    const nutrients = makeNutrients({
      208: 884.0,  // calories (kcal)
      203: 0.0,    // proteins
      205: 0.0,    // carbs
      269: 0.0,    // sugars
      204: 99.9,   // fats
      606: 13.8,   // saturatedFats
      291: 0.0,    // fiber
      307: 0.0,    // sodium (mg)
      645: 73.0,   // monounsaturatedFats
      646: 10.5,   // polyunsaturatedFats
      605: 0.0,    // transFats
      601: 0.0,    // cholesterol (mg)
      306: 0.0,    // potassium (mg)
    });

    const result = mapBedcaNutrientsToSchema(nutrients, NUTRIENT_INDEX);

    expect(result.calories).toBe(884.0);
    expect(result.proteins).toBe(0.0);
    expect(result.fats).toBe(99.9);
    expect(result.saturatedFats).toBe(13.8);
    expect(result.monounsaturatedFats).toBe(73.0);
    expect(result.polyunsaturatedFats).toBe(10.5);
  });

  it('converts sodium from mg to g', () => {
    const nutrients = makeNutrients({ 307: 450 }); // 450mg
    const result = mapBedcaNutrientsToSchema(nutrients, NUTRIENT_INDEX);

    expect(result.sodium).toBeCloseTo(0.45, 5); // 450mg → 0.45g
  });

  it('converts potassium from mg to g', () => {
    const nutrients = makeNutrients({ 306: 200 }); // 200mg
    const result = mapBedcaNutrientsToSchema(nutrients, NUTRIENT_INDEX);

    expect(result.potassium).toBeCloseTo(0.2, 5); // 200mg → 0.2g
  });

  it('converts cholesterol from mg to g', () => {
    const nutrients = makeNutrients({ 601: 85 }); // 85mg
    const result = mapBedcaNutrientsToSchema(nutrients, NUTRIENT_INDEX);

    expect(result.cholesterol).toBeCloseTo(0.085, 5); // 85mg → 0.085g
  });

  it('derives salt from sodium using EU Regulation 1169/2011 multiplier (2.5)', () => {
    const nutrients = makeNutrients({ 307: 100 }); // 100mg sodium
    const result = mapBedcaNutrientsToSchema(nutrients, NUTRIENT_INDEX);

    // 100mg sodium → 0.1g sodium → 0.25g salt (0.1 * 2.5)
    expect(result.sodium).toBeCloseTo(0.1, 5);
    expect(result.salt).toBeCloseTo(0.25, 5);
  });

  it('does NOT use 2.54 for salt (chemical ratio, not EU standard)', () => {
    const nutrients = makeNutrients({ 307: 1000 }); // 1000mg = 1g sodium
    const result = mapBedcaNutrientsToSchema(nutrients, NUTRIENT_INDEX);

    // Must be 2.5, not 2.54
    expect(result.salt).toBeCloseTo(2.5, 3);
    expect(result.salt).not.toBeCloseTo(2.54, 2);
  });

  it('defaults missing standard nutrients to 0', () => {
    const nutrients = makeNutrients({ 208: 200 }); // only calories
    const result = mapBedcaNutrientsToSchema(nutrients, NUTRIENT_INDEX);

    expect(result.proteins).toBe(0);
    expect(result.carbohydrates).toBe(0);
    expect(result.sugars).toBe(0);
    expect(result.fats).toBe(0);
    expect(result.saturatedFats).toBe(0);
    expect(result.fiber).toBe(0);
    expect(result.sodium).toBe(0);
    expect(result.salt).toBe(0);
    expect(result.transFats).toBe(0);
    expect(result.cholesterol).toBe(0);
    expect(result.potassium).toBe(0);
    expect(result.monounsaturatedFats).toBe(0);
    expect(result.polyunsaturatedFats).toBe(0);
  });

  it('tracks unmeasured (null) standard fields in extra.unmeasured', () => {
    const nutrients = makeNutrients({
      208: 200,   // calories — present
      203: null,  // proteins — null (not measured)
      204: null,  // fats — null (not measured)
    });
    const result = mapBedcaNutrientsToSchema(nutrients, NUTRIENT_INDEX);

    expect(result.proteins).toBe(0); // stored as 0
    expect(result.fats).toBe(0);     // stored as 0
    const unmeasured = result.extra['unmeasured'] as string[];
    expect(unmeasured).toContain('proteins');
    expect(unmeasured).toContain('fats');
    expect(unmeasured).not.toContain('calories'); // calories was not null
  });

  it('puts non-standard nutrients in extra.nutrients array', () => {
    const nutrients = makeNutrients({
      208: 50.0,  // calories (standard)
      401: 30.0,  // Vitamin C (non-standard)
      303: 2.5,   // Iron (non-standard)
    });
    const result = mapBedcaNutrientsToSchema(nutrients, NUTRIENT_INDEX);

    const extNutrients = result.extra['nutrients'] as Array<{
      nutrientId: number;
      tagname: string;
      name: string;
      unit: string;
      value: number;
    }>;
    expect(Array.isArray(extNutrients)).toBe(true);
    expect(extNutrients).toHaveLength(2);
    expect(extNutrients).toContainEqual(
      expect.objectContaining({ tagname: 'VITC', value: 30.0 }),
    );
    expect(extNutrients).toContainEqual(
      expect.objectContaining({ tagname: 'FE', value: 2.5 }),
    );
  });

  it('maps alcohol (ALC) to standard alcohol field (F077)', () => {
    const nutrients = makeNutrients({ 221: 14.0 }); // 14g alcohol per 100g
    const result = mapBedcaNutrientsToSchema(nutrients, NUTRIENT_INDEX);

    expect(result.alcohol).toBe(14.0);
    // Alcohol no longer stored in extra (promoted to standard field in F077)
    expect(result.extra['alcohol_g']).toBeUndefined();
  });

  it('returns all-zeros for empty nutrient array', () => {
    const result = mapBedcaNutrientsToSchema([], NUTRIENT_INDEX);

    expect(result.calories).toBe(0);
    expect(result.proteins).toBe(0);
    expect(result.fats).toBe(0);
    expect(result.salt).toBe(0);
  });

  it('handles null values for non-standard nutrients gracefully (skips them)', () => {
    const nutrients = makeNutrients({
      208: 100,
      401: null, // null Vitamin C — should not appear in extra.nutrients
    });
    const result = mapBedcaNutrientsToSchema(nutrients, NUTRIENT_INDEX);

    const extNutrients = result.extra['nutrients'] as unknown[];
    // Null non-standard nutrients are excluded from extra.nutrients
    expect(extNutrients).toHaveLength(0);
  });

  it('handles unknown nutrient IDs (not in nutrient index) without crashing', () => {
    const nutrients = makeNutrients({
      208: 100,
      9999: 5.0, // unknown nutrient ID not in index
    });
    const result = mapBedcaNutrientsToSchema(nutrients, NUTRIENT_INDEX);

    expect(result.calories).toBe(100);
    // Unknown ID should not crash — just ignored or stored generically
    // (it won't be in extra.nutrients since we don't have its tagname)
  });
});
