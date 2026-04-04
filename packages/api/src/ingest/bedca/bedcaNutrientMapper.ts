/**
 * F071 — BEDCA Nutrient Mapper
 *
 * Maps BEDCA nutrient values (keyed by nutrient_id) to the nutriXplorer schema
 * columns in food_nutrients, using the INFOODS tagnames from the nutrient index.
 *
 * Unit conversions applied:
 * - Sodium (tagname NA): mg → g (÷1000)
 * - Potassium (tagname K): mg → g (÷1000)
 * - Cholesterol (tagname CHOLE): mg → g (÷1000)
 * - Salt: derived from sodium_g × 2.5 (EU Regulation 1169/2011)
 *
 * Non-standard nutrients (vitamins, minerals beyond potassium) are stored
 * in the `extra` JSONB field of food_nutrients.
 * Alcohol (F077) is now a standard column — tagname ALC maps to `alcohol`.
 */

import type {
  BedcaNutrientInfo,
  BedcaNutrientValue,
  MappedNutrients,
} from './types.js';

/** INFOODS tagnames for the 14 standard nutriXplorer columns (excluding salt, which is derived). */
const STANDARD_FIELD_MAP: Record<string, keyof Omit<MappedNutrients, 'extra' | 'salt'>> = {
  ENERC_KCAL: 'calories',
  PROCNT: 'proteins',
  CHOCDF: 'carbohydrates',
  SUGAR: 'sugars',
  FAT: 'fats',
  FASAT: 'saturatedFats',
  FIBTG: 'fiber',
  NA: 'sodium',         // mg → g conversion applied
  FAMS: 'monounsaturatedFats',
  FAPU: 'polyunsaturatedFats',
  FATRN: 'transFats',
  CHOLE: 'cholesterol', // mg → g conversion applied
  K: 'potassium',       // mg → g conversion applied
  ALC: 'alcohol',       // F077: alcohol in grams
};

/** Tagnames that require mg → g conversion. */
const MG_TO_G_FIELDS = new Set(['NA', 'CHOLE', 'K']);

/**
 * Maps BEDCA nutrient values to the nutriXplorer food_nutrients schema.
 *
 * @param nutrients  Array of { nutrientId, value } from BEDCA API
 * @param nutrientIndex  Reference table mapping nutrientId → tagname/name/unit
 * @returns MappedNutrients ready for DB insertion
 */
export function mapBedcaNutrientsToSchema(
  nutrients: BedcaNutrientValue[],
  nutrientIndex: BedcaNutrientInfo[],
): MappedNutrients {
  // Build lookup: nutrientId → BedcaNutrientInfo
  const indexById = new Map<number, BedcaNutrientInfo>(
    nutrientIndex.map((n) => [n.nutrientId, n]),
  );

  // Build lookup: nutrientId → value (for this food)
  const valueById = new Map<number, number | null>(
    nutrients.map((n) => [n.nutrientId, n.value]),
  );

  // Build reverse lookup: tagname → nutrientId (for standard fields)
  const idByTagname = new Map<string, number>(
    nutrientIndex.map((n) => [n.tagname, n.nutrientId]),
  );

  // Initialize result with zeros for all standard fields
  const result: MappedNutrients = {
    calories: 0,
    proteins: 0,
    carbohydrates: 0,
    sugars: 0,
    fats: 0,
    saturatedFats: 0,
    fiber: 0,
    sodium: 0,
    salt: 0,
    transFats: 0,
    cholesterol: 0,
    potassium: 0,
    monounsaturatedFats: 0,
    polyunsaturatedFats: 0,
    alcohol: 0,
    extra: {
      nutrients: [] as Array<{
        nutrientId: number;
        tagname: string;
        name: string;
        unit: string;
        value: number;
      }>,
      unmeasured: [] as string[],
    },
  };

  // Populate standard fields and track unmeasured ones
  for (const [tagname, fieldName] of Object.entries(STANDARD_FIELD_MAP)) {
    const nutrientId = idByTagname.get(tagname);
    if (nutrientId === undefined) continue; // tagname not in this nutrient index

    const rawValue = valueById.get(nutrientId) ?? null;

    if (rawValue === null) {
      // Field was present in source but unmeasured — track it
      if (valueById.has(nutrientId)) {
        (result.extra['unmeasured'] as string[]).push(fieldName);
      }
      // Leave as 0 (DB requires number, schema is non-nullable for these)
      continue;
    }

    let value = rawValue;
    if (MG_TO_G_FIELDS.has(tagname)) {
      value = rawValue / 1000; // mg → g
    }

    result[fieldName] = value;
  }

  // Derive salt from sodium using EU Regulation 1169/2011: salt = sodium × 2.5
  result.salt = result.sodium * 2.5;

  // Process non-standard nutrients (vitamins, minerals, alcohol)
  for (const nutrient of nutrients) {
    const info = indexById.get(nutrient.nutrientId);
    if (!info) continue; // unknown nutrient ID — skip

    // Skip standard fields (already processed above)
    if (info.tagname in STANDARD_FIELD_MAP) continue;

    // Null values for non-standard nutrients are excluded from extra
    if (nutrient.value === null) continue;

    (result.extra['nutrients'] as Array<{
      nutrientId: number;
      tagname: string;
      name: string;
      unit: string;
      value: number;
    }>).push({
      nutrientId: nutrient.nutrientId,
      tagname: info.tagname,
      name: info.name,
      unit: info.unit,
      value: nutrient.value,
    });
  }

  return result;
}
