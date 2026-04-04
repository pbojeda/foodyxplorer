/**
 * F071 — BEDCA Food Database Import
 * Type definitions for BEDCA XML API data structures and mapped schema types.
 *
 * BEDCA (Base de Datos Española de Composición de Alimentos) is Spain's official
 * national food composition database managed by AESAN.
 *
 * API: POST https://www.bedca.net/bdpub/procquery.php (XML responses)
 */

/** A food entry parsed from the BEDCA food table. */
export interface BedcaFoodEntry {
  /** BEDCA's internal numeric food identifier */
  foodId: number;
  /** Spanish food name (primary source language) */
  nameEs: string;
  /** English food name (translation; may be empty — fall back to nameEs) */
  nameEn: string;
  /** Food group name in Spanish */
  foodGroupEs: string;
  /** Food group name in English */
  foodGroupEn: string;
}

/**
 * A single nutrient value row from BEDCA's food_value table.
 * Null indicates the nutrient was not measured for this food.
 */
export interface BedcaNutrientValue {
  /** BEDCA's internal nutrient identifier */
  nutrientId: number;
  /** Value per 100g in the nutrient's native unit (kcal, g, mg, etc.) */
  value: number | null;
}

/** Food entry with its associated nutrient values (joined result). */
export interface BedcaFoodWithNutrients extends BedcaFoodEntry {
  /** All nutrient values for this food (may be empty for BEDCA2 entries). */
  nutrients: BedcaNutrientValue[];
}

/**
 * Metadata about a BEDCA nutrient from the nutrient reference table.
 * Used to build the nutrient mapper at import time.
 */
export interface BedcaNutrientInfo {
  /** BEDCA's internal nutrient identifier */
  nutrientId: number;
  /** Human-readable nutrient name in English */
  name: string;
  /** INFOODS tagname (e.g. 'ENERC_KCAL', 'PROCNT', 'FAT') */
  tagname: string;
  /** Measurement unit (e.g. 'kcal', 'g', 'mg', 'µg') */
  unit: string;
}

/**
 * Nutrient values mapped to the nutriXplorer schema columns,
 * ready for insertion into food_nutrients table.
 *
 * Unit notes:
 * - All values are per 100g of the food
 * - Sodium, potassium, cholesterol: converted from mg → g at mapping time
 * - Salt: derived from sodium using EU Regulation 1169/2011: salt = sodium * 2.5
 * - Extended nutrients (vitamins, minerals) are in extra
 */
export interface MappedNutrients {
  calories: number;
  proteins: number;
  carbohydrates: number;
  sugars: number;
  fats: number;
  saturatedFats: number;
  fiber: number;
  /** Sodium in grams per 100g (converted from mg) */
  sodium: number;
  /** Salt in grams per 100g (derived: sodium_g * 2.5, EU Regulation 1169/2011) */
  salt: number;
  transFats: number;
  /** Cholesterol in grams per 100g (converted from mg) */
  cholesterol: number;
  /** Potassium in grams per 100g (converted from mg) */
  potassium: number;
  monounsaturatedFats: number;
  polyunsaturatedFats: number;
  /** Alcohol in grams per 100g (F077). BEDCA tagname ALC, nutrient ID 221. */
  alcohol: number;
  /**
   * Extended nutrients and metadata.
   * Structure:
   * - nutrients: Array<{ nutrientId, tagname, name, unit, value }> — non-standard nutrients
   * - unmeasured: string[] — standard field names that were null in source (stored as 0)
   */
  extra: Record<string, unknown>;
}

/** Result of BEDCA seed data validation. Same shape as USDA validateSeedData. */
export interface BedcaValidationResult {
  valid: boolean;
  errors: string[];
}

