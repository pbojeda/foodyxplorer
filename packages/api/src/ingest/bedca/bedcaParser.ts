/**
 * F071 — BEDCA XML Parser
 *
 * Parses XML responses from the BEDCA API at procquery.php.
 * The API returns flat rows from SQL queries. When fetching food + nutrient
 * data via a JOIN, each row has food metadata + one nutrient value. This
 * parser groups rows by food_id to produce BedcaFoodWithNutrients objects.
 *
 * Note on fast-xml-parser configuration:
 * - isArray: enforced for 'row', 'food', 'nutrient' to avoid object vs array
 *   variance when only one item is present.
 * - Number parsing: enabled so <value>884.0</value> → 884.0 (number)
 * - Empty string values are converted to null in post-processing.
 */

import { XMLParser } from 'fast-xml-parser';
import type {
  BedcaFoodWithNutrients,
  BedcaNutrientInfo,
  BedcaNutrientValue,
} from './types.js';

// Tags that must always be arrays (handles single-item XML edge case)
const ARRAY_TAGS = new Set(['row', 'food', 'nutrient', 'v']);

const parser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: true,
  parseTagValue: true,
  trimValues: true,
  isArray: (name: string) => ARRAY_TAGS.has(name),
});

/**
 * Parses BEDCA XML that contains JOIN rows of food + one nutrient value each.
 * Groups rows by food_id and returns one BedcaFoodWithNutrients per food.
 *
 * Supports two XML shapes:
 * 1. `<row>` elements (JOIN query result — flat rows, each with food meta + one nutrient)
 * 2. `<food>` elements (food-only query — with or without nutrient data)
 *
 * @throws Error if XML is malformed (fast-xml-parser validation)
 */
export function parseBedcaFoods(xml: string): BedcaFoodWithNutrients[] {
  const parsed: Record<string, unknown> = parser.parse(xml) as Record<string, unknown>;
  const db = parsed['food_database'];

  // Empty <food_database/> or <food_database></food_database> parsed as '' or {}
  if (db === undefined || db === null) {
    throw new Error('BEDCA XML missing <food_database> root element');
  }

  // Empty element — return empty array
  if (typeof db !== 'object' || db === null) {
    return [];
  }

  const dbObj = db as Record<string, unknown>;

  // Determine which tag the API used for rows
  const rows = (dbObj['row'] ?? dbObj['food']) as Record<string, unknown>[] | undefined;
  if (!rows || rows.length === 0) {
    return [];
  }

  // Group flat rows by food_id
  const foodMap = new Map<number, BedcaFoodWithNutrients>();

  for (const row of rows) {
    const foodId = Number(row['food_id']);
    if (isNaN(foodId)) continue;

    if (!foodMap.has(foodId)) {
      const nameEs = String(row['food_name'] ?? '').trim();
      const rawNameEn = String(row['food_name_e'] ?? '').trim();
      const nameEn = rawNameEn || nameEs; // fallback to Spanish if English is empty

      foodMap.set(foodId, {
        foodId,
        nameEs,
        nameEn,
        foodGroupEs: String(row['food_group'] ?? '').trim(),
        foodGroupEn: String(row['food_group_e'] ?? '').trim(),
        nutrients: [],
      });
    }

    // Add nutrient value if this row contains nutrient data
    const nutrientIdRaw = row['nutrient_id'];
    const valueRaw = row['value'];

    if (nutrientIdRaw !== undefined && nutrientIdRaw !== '') {
      const nutrientId = Number(nutrientIdRaw);
      const value = parseNutrientValue(valueRaw);

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- foodId was added to foodMap in the first pass
      const food = foodMap.get(foodId)!;
      food.nutrients.push({ nutrientId, value } satisfies BedcaNutrientValue);
    }
  }

  return Array.from(foodMap.values());
}

/**
 * Parses BEDCA nutrient reference table XML.
 * Returns metadata about each BEDCA nutrient (id, name, INFOODS tagname, unit).
 *
 * @throws Error if XML is malformed
 */
export function parseBedcaNutrientIndex(xml: string): BedcaNutrientInfo[] {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const db = parsed['food_database'];

  if (db === undefined || db === null) {
    throw new Error('BEDCA XML missing <food_database> root element');
  }

  // Empty element — return empty array
  if (typeof db !== 'object' || db === null) {
    return [];
  }

  const dbObj = db as Record<string, unknown>;
  const nutrients = dbObj['nutrient'] as Record<string, unknown>[] | undefined;
  if (!nutrients || nutrients.length === 0) {
    return [];
  }

  return nutrients.map((n) => ({
    nutrientId: Number(n['nutrient_id']),
    name: String(n['nutrient_name'] ?? '').trim(),
    tagname: String(n['tagname'] ?? '').trim(),
    unit: String(n['unit'] ?? '').trim(),
  }));
}

/** Converts an XML value node to number | null. Empty string → null. */
function parseNutrientValue(raw: unknown): number | null {
  if (raw === '' || raw === null || raw === undefined) return null;
  const num = Number(raw);
  return isNaN(num) ? null : num;
}
