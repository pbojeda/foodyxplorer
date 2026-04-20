/**
 * F071 — BEDCA Parser Unit Tests
 * Tests for parsing BEDCA XML API responses into typed data structures.
 *
 * Key behaviors tested:
 * - Nominal food + nutrient XML (multiple foods with values)
 * - Single food (parser must return array, not object)
 * - Food with no nutrient data (empty nutrients array)
 * - Missing English name falls back gracefully
 * - Null nutrient values parsed correctly
 * - Malformed XML throws parse error
 * - fast-xml-parser array enforcement for single-node edge case
 */
import { describe, it, expect } from 'vitest';
import {
  parseBedcaFoods,
  parseBedcaNutrientIndex,
} from '../ingest/bedca/bedcaParser.js';

// ---------------------------------------------------------------------------
// XML fixtures
// ---------------------------------------------------------------------------

const _NOMINAL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<food_database>
  <food>
    <food_id>1</food_id>
    <food_name>Aceite de oliva virgen extra</food_name>
    <food_name_e>Extra virgin olive oil</food_name_e>
    <food_group>Aceites y grasas</food_group>
    <food_group_e>Fats and oils</food_group_e>
    <nutrient_id>208</nutrient_id>
    <value>884.0</value>
  </food>
  <food>
    <food_id>2</food_id>
    <food_name>Arroz blanco cocido</food_name>
    <food_name_e>White rice cooked</food_name_e>
    <food_group>Cereales y derivados</food_group>
    <food_group_e>Cereals and grain products</food_group_e>
    <nutrient_id>208</nutrient_id>
    <value>130.0</value>
  </food>
</food_database>`;

// A response from a JOIN query grouping nutrient rows per food
const JOIN_ROWS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<food_database>
  <row>
    <food_id>1</food_id>
    <food_name>Aceite de oliva virgen extra</food_name>
    <food_name_e>Extra virgin olive oil</food_name_e>
    <food_group>Aceites y grasas</food_group>
    <food_group_e>Fats and oils</food_group_e>
    <nutrient_id>208</nutrient_id>
    <value>884.0</value>
  </row>
  <row>
    <food_id>1</food_id>
    <food_name>Aceite de oliva virgen extra</food_name>
    <food_name_e>Extra virgin olive oil</food_name_e>
    <food_group>Aceites y grasas</food_group>
    <food_group_e>Fats and oils</food_group_e>
    <nutrient_id>203</nutrient_id>
    <value>0.0</value>
  </row>
  <row>
    <food_id>2</food_id>
    <food_name>Arroz blanco cocido</food_name>
    <food_name_e>White rice cooked</food_name_e>
    <food_group>Cereales y derivados</food_group>
    <food_group_e>Cereals and grain products</food_group_e>
    <nutrient_id>208</nutrient_id>
    <value>130.0</value>
  </row>
  <row>
    <food_id>2</food_id>
    <food_name>Arroz blanco cocido</food_name>
    <food_name_e>White rice cooked</food_name_e>
    <food_group>Cereales y derivados</food_group>
    <food_group_e>Cereals and grain products</food_group_e>
    <nutrient_id>205</nutrient_id>
    <value>28.2</value>
  </row>
</food_database>`;

const SINGLE_ROW_XML = `<?xml version="1.0" encoding="UTF-8"?>
<food_database>
  <row>
    <food_id>5</food_id>
    <food_name>Leche entera</food_name>
    <food_name_e>Whole milk</food_name_e>
    <food_group>Leche y derivados</food_group>
    <food_group_e>Milk and dairy products</food_group_e>
    <nutrient_id>208</nutrient_id>
    <value>65.0</value>
  </row>
</food_database>`;

const MISSING_ENGLISH_NAME_XML = `<?xml version="1.0" encoding="UTF-8"?>
<food_database>
  <row>
    <food_id>10</food_id>
    <food_name>Gazpacho</food_name>
    <food_name_e></food_name_e>
    <food_group>Platos cocinados</food_group>
    <food_group_e></food_group_e>
    <nutrient_id>208</nutrient_id>
    <value>30.0</value>
  </row>
</food_database>`;

const NULL_NUTRIENT_VALUE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<food_database>
  <row>
    <food_id>20</food_id>
    <food_name>Arroz crudo</food_name>
    <food_name_e>Raw rice</food_name_e>
    <food_group>Cereales y derivados</food_group>
    <food_group_e>Cereals and grain products</food_group_e>
    <nutrient_id>208</nutrient_id>
    <value>350.0</value>
  </row>
  <row>
    <food_id>20</food_id>
    <food_name>Arroz crudo</food_name>
    <food_name_e>Raw rice</food_name_e>
    <food_group>Cereales y derivados</food_group>
    <food_group_e>Cereals and grain products</food_group_e>
    <nutrient_id>262</nutrient_id>
    <value></value>
  </row>
</food_database>`;

const NO_NUTRIENTS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<food_database>
  <food>
    <food_id>999</food_id>
    <food_name>Alimento sin datos</food_name>
    <food_name_e>Food without data</food_name_e>
    <food_group>Varios</food_group>
    <food_group_e>Miscellaneous</food_group_e>
  </food>
</food_database>`;

const NUTRIENT_INDEX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<food_database>
  <nutrient>
    <nutrient_id>208</nutrient_id>
    <nutrient_name>Energy</nutrient_name>
    <tagname>ENERC_KCAL</tagname>
    <unit>kcal</unit>
  </nutrient>
  <nutrient>
    <nutrient_id>203</nutrient_id>
    <nutrient_name>Protein</nutrient_name>
    <tagname>PROCNT</tagname>
    <unit>g</unit>
  </nutrient>
  <nutrient>
    <nutrient_id>204</nutrient_id>
    <nutrient_name>Total lipid (fat)</nutrient_name>
    <tagname>FAT</tagname>
    <unit>g</unit>
  </nutrient>
  <nutrient>
    <nutrient_id>307</nutrient_id>
    <nutrient_name>Sodium</nutrient_name>
    <tagname>NA</tagname>
    <unit>mg</unit>
  </nutrient>
</food_database>`;

const SINGLE_NUTRIENT_INDEX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<food_database>
  <nutrient>
    <nutrient_id>208</nutrient_id>
    <nutrient_name>Energy</nutrient_name>
    <tagname>ENERC_KCAL</tagname>
    <unit>kcal</unit>
  </nutrient>
</food_database>`;

// ---------------------------------------------------------------------------
// Tests: parseBedcaFoods
// ---------------------------------------------------------------------------

describe('parseBedcaFoods', () => {
  it('parses multiple foods from JOIN row XML — groups rows by food_id', () => {
    const foods = parseBedcaFoods(JOIN_ROWS_XML);

    expect(foods).toHaveLength(2);

    const olive = foods.find((f) => f.foodId === 1);
    expect(olive).toBeDefined();
    expect(olive!.nameEs).toBe('Aceite de oliva virgen extra');
    expect(olive!.nameEn).toBe('Extra virgin olive oil');
    expect(olive!.foodGroupEs).toBe('Aceites y grasas');
    expect(olive!.foodGroupEn).toBe('Fats and oils');
    expect(olive!.nutrients).toHaveLength(2);
    expect(olive!.nutrients).toContainEqual({ nutrientId: 208, value: 884.0 });
    expect(olive!.nutrients).toContainEqual({ nutrientId: 203, value: 0.0 });

    const rice = foods.find((f) => f.foodId === 2);
    expect(rice).toBeDefined();
    expect(rice!.nutrients).toHaveLength(2);
    expect(rice!.nutrients).toContainEqual({ nutrientId: 208, value: 130.0 });
    expect(rice!.nutrients).toContainEqual({ nutrientId: 205, value: 28.2 });
  });

  it('handles a single food row without wrapping in extra array nesting', () => {
    const foods = parseBedcaFoods(SINGLE_ROW_XML);

    expect(Array.isArray(foods)).toBe(true);
    expect(foods).toHaveLength(1);
    expect(foods[0]!.foodId).toBe(5);
    expect(foods[0]!.nameEs).toBe('Leche entera');
    expect(foods[0]!.nutrients).toHaveLength(1);
  });

  it('falls back to nameEs when nameEn is empty', () => {
    const foods = parseBedcaFoods(MISSING_ENGLISH_NAME_XML);

    expect(foods).toHaveLength(1);
    expect(foods[0]!.nameEs).toBe('Gazpacho');
    expect(foods[0]!.nameEn).toBe('Gazpacho'); // fallback to nameEs
  });

  it('falls back to empty string for foodGroupEn when missing', () => {
    const foods = parseBedcaFoods(MISSING_ENGLISH_NAME_XML);

    // foodGroupEn was empty in XML — should be empty string, not crash
    expect(foods[0]!.foodGroupEn).toBe('');
  });

  it('parses null nutrient value (empty <value> tag) as null', () => {
    const foods = parseBedcaFoods(NULL_NUTRIENT_VALUE_XML);

    expect(foods).toHaveLength(1);
    const nullNutrient = foods[0]!.nutrients.find((n) => n.nutrientId === 262);
    expect(nullNutrient).toBeDefined();
    expect(nullNutrient!.value).toBeNull();
  });

  it('returns food with empty nutrients array when no nutrient rows present', () => {
    const foods = parseBedcaFoods(NO_NUTRIENTS_XML);

    expect(foods).toHaveLength(1);
    expect(foods[0]!.foodId).toBe(999);
    expect(foods[0]!.nutrients).toHaveLength(0);
  });

  it('throws on malformed XML', () => {
    expect(() => parseBedcaFoods('not valid xml <<>>')).toThrow();
  });

  it('returns empty array for empty food_database', () => {
    const foods = parseBedcaFoods('<?xml version="1.0"?><food_database></food_database>');

    expect(foods).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests: parseBedcaNutrientIndex
// ---------------------------------------------------------------------------

describe('parseBedcaNutrientIndex', () => {
  it('parses multiple nutrient entries from XML', () => {
    const index = parseBedcaNutrientIndex(NUTRIENT_INDEX_XML);

    expect(index).toHaveLength(4);

    const energy = index.find((n) => n.tagname === 'ENERC_KCAL');
    expect(energy).toBeDefined();
    expect(energy!.nutrientId).toBe(208);
    expect(energy!.name).toBe('Energy');
    expect(energy!.unit).toBe('kcal');

    const sodium = index.find((n) => n.tagname === 'NA');
    expect(sodium).toBeDefined();
    expect(sodium!.nutrientId).toBe(307);
    expect(sodium!.unit).toBe('mg');
  });

  it('handles single nutrient without array nesting issue', () => {
    const index = parseBedcaNutrientIndex(SINGLE_NUTRIENT_INDEX_XML);

    expect(Array.isArray(index)).toBe(true);
    expect(index).toHaveLength(1);
    expect(index[0]!.tagname).toBe('ENERC_KCAL');
  });

  it('returns empty array for empty food_database', () => {
    const index = parseBedcaNutrientIndex(
      '<?xml version="1.0"?><food_database></food_database>',
    );

    expect(index).toEqual([]);
  });
});
