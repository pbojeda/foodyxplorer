// Normalization utilities for the scraper pipeline.
//
// Pure functions — no I/O, no Prisma, fully unit-testable.
// These functions are intentionally forward-compatible so that F007b (PDF) and
// F007c (URL ingest) can reuse the same pipeline without modification.

import type { RawDishData, NormalizedDishData } from '../base/types.js';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Coerces an unknown nutrient value to a number.
 *
 * Rules:
 * - If the value is already a number, return it as-is (clamping happens later).
 * - `"tr"` (trace) → 0
 * - `"<N"` → N/2 (half of the upper-bound value; e.g. "<1" → 0.5)
 * - Any other string: strip non-numeric characters except `.`, parse as float.
 *   Returns 0 on failure and logs a warning.
 * - null / undefined → treated as absent (caller should handle separately).
 */
function coerceNutrient(
  value: unknown,
  fieldName: string,
): { value: number; wasCoerced: boolean; isInvalid: boolean } {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      console.warn(
        `[normalizeNutrients] Non-finite value for "${fieldName}" (${value}) — defaulting to 0`,
      );
      return { value: 0, wasCoerced: true, isInvalid: true };
    }
    return { value, wasCoerced: false, isInvalid: false };
  }

  if (typeof value !== 'string') {
    return { value: 0, wasCoerced: true, isInvalid: true };
  }

  const str = value.trim().toLowerCase();

  if (str === 'tr' || str === 'trace') {
    return { value: 0, wasCoerced: true, isInvalid: false };
  }

  if (str.startsWith('<')) {
    const numeric = parseFloat(str.slice(1));
    if (!isNaN(numeric)) {
      return { value: numeric / 2, wasCoerced: true, isInvalid: false };
    }
  }

  // Strip everything except digits and decimal point, then parse
  const cleaned = str.replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleaned);

  if (!isNaN(parsed)) {
    return { value: parsed, wasCoerced: true, isInvalid: false };
  }

  console.warn(
    `[normalizeNutrients] Could not parse nutrient "${fieldName}" value: "${value}" — defaulting to 0`,
  );
  return { value: 0, wasCoerced: true, isInvalid: true };
}

/**
 * Resolves a nutrient field that may be a number, string, or undefined.
 * Returns the numeric value (with coercion applied), and flags whether it
 * was present at all.
 */
function resolveField(
  raw: unknown,
  fieldName: string,
): { value: number; present: boolean; isInvalid: boolean } {
  if (raw === undefined || raw === null) {
    return { value: 0, present: false, isInvalid: false };
  }
  const coerced = coerceNutrient(raw, fieldName);
  return { value: coerced.value, present: true, isInvalid: coerced.isInvalid };
}

/**
 * Clamps a value to a minimum of 0, logging a warning if clamping occurred.
 */
function clampToZero(value: number, fieldName: string): number {
  if (value < 0) {
    console.warn(
      `[normalizeNutrients] Negative value for "${fieldName}" (${value}) — clamping to 0`,
    );
    return 0;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Normalizes raw nutrient values from a chain scraper into a validated,
 * DB-ready nutrient object.
 *
 * Returns `null` when the dish should be skipped (missing required fields,
 * or calories > 9000).
 *
 * @param raw - Raw nutrient values from `RawDishData.nutrients`. Nutrient
 *   fields may be numbers, strings (e.g. "<1", "tr"), or undefined.
 */
export function normalizeNutrients(
  raw: RawDishData['nutrients'],
): NormalizedDishData['nutrients'] | null {
  // Cast to allow string values from chain scrapers before they reach Zod
  const r = raw as Record<string, unknown>;

  // Resolve all required fields
  const caloriesRaw = resolveField(r['calories'], 'calories');
  const proteinsRaw = resolveField(r['proteins'], 'proteins');
  const carbohydratesRaw = resolveField(r['carbohydrates'], 'carbohydrates');
  const fatsRaw = resolveField(r['fats'], 'fats');

  // Required fields must be present
  if (!caloriesRaw.present) return null;
  if (!proteinsRaw.present) return null;
  if (!carbohydratesRaw.present) return null;
  if (!fatsRaw.present) return null;

  const calories = clampToZero(caloriesRaw.value, 'calories');
  const proteins = clampToZero(proteinsRaw.value, 'proteins');
  const carbohydrates = clampToZero(carbohydratesRaw.value, 'carbohydrates');
  const fats = clampToZero(fatsRaw.value, 'fats');

  // Calorie sanity check
  if (calories > 9000) {
    console.error(
      `[normalizeNutrients] calories (${calories}) exceeds 9000 — skipping dish`,
    );
    return null;
  }

  // Sugars — optional but defaults to 0 with a warning
  const sugarsRaw = resolveField(r['sugars'], 'sugars');
  let sugars: number;
  if (!sugarsRaw.present) {
    console.warn(
      '[normalizeNutrients] "sugars" not disclosed by chain — defaulting to 0',
    );
    sugars = 0;
  } else {
    sugars = clampToZero(sugarsRaw.value, 'sugars');
  }

  // Salt / sodium mutual derivation
  const saltRaw = resolveField(r['salt'], 'salt');
  const sodiumRaw = resolveField(r['sodium'], 'sodium');

  let salt: number;
  let sodium: number;

  if (saltRaw.present && sodiumRaw.present) {
    // Both present — use as-is
    salt = clampToZero(saltRaw.value, 'salt');
    sodium = clampToZero(sodiumRaw.value, 'sodium');
  } else if (sodiumRaw.present && !saltRaw.present) {
    // Only sodium — derive salt
    sodium = clampToZero(sodiumRaw.value, 'sodium');
    salt = (sodium / 1000) * 2.5;
  } else if (saltRaw.present && !sodiumRaw.present) {
    // Only salt — derive sodium
    salt = clampToZero(saltRaw.value, 'salt');
    sodium = (salt / 2.5) * 1000;
  } else {
    // Neither present — default both to 0
    salt = 0;
    sodium = 0;
  }

  // Optional nutrients — default to 0
  const saturatedFatsRaw = resolveField(r['saturatedFats'], 'saturatedFats');
  const fiberRaw = resolveField(r['fiber'], 'fiber');
  const transFatsRaw = resolveField(r['transFats'], 'transFats');
  const cholesterolRaw = resolveField(r['cholesterol'], 'cholesterol');
  const potassiumRaw = resolveField(r['potassium'], 'potassium');
  const monounsaturatedFatsRaw = resolveField(r['monounsaturatedFats'], 'monounsaturatedFats');
  const polyunsaturatedFatsRaw = resolveField(r['polyunsaturatedFats'], 'polyunsaturatedFats');

  const saturatedFats = clampToZero(saturatedFatsRaw.value, 'saturatedFats');
  const fiber = clampToZero(fiberRaw.value, 'fiber');
  const transFats = clampToZero(transFatsRaw.value, 'transFats');
  const cholesterol = clampToZero(cholesterolRaw.value, 'cholesterol');
  const potassium = clampToZero(potassiumRaw.value, 'potassium');
  const monounsaturatedFats = clampToZero(monounsaturatedFatsRaw.value, 'monounsaturatedFats');
  const polyunsaturatedFats = clampToZero(polyunsaturatedFatsRaw.value, 'polyunsaturatedFats');

  // Extra passthrough — filter out non-number and non-finite values
  const rawExtra = r['extra'];
  let extra: Record<string, number> | undefined;
  if (rawExtra !== undefined && typeof rawExtra === 'object' && rawExtra !== null) {
    const filtered: Record<string, number> = {};
    for (const [key, val] of Object.entries(rawExtra as Record<string, unknown>)) {
      if (typeof val === 'number' && Number.isFinite(val)) {
        filtered[key] = val;
      }
    }
    extra = Object.keys(filtered).length > 0 ? filtered : undefined;
  }

  return {
    calories,
    proteins,
    carbohydrates,
    sugars,
    fats,
    saturatedFats,
    fiber,
    salt,
    sodium,
    transFats,
    cholesterol,
    potassium,
    monounsaturatedFats,
    polyunsaturatedFats,
    referenceBasis: 'per_serving',
    extra,
  };
}

/**
 * Normalizes dish identity and metadata fields from raw scraped data.
 *
 * Returns a `Partial<NormalizedDishData>` without the `nutrients` sub-object.
 * The caller (BaseScraper.normalize()) merges the result with the output of
 * `normalizeNutrients()` before running `NormalizedDishDataSchema.safeParse()`.
 *
 * @param raw - Raw dish data from the chain scraper.
 * @param meta - Persistence metadata: sourceId and restaurantId.
 */
export function normalizeDish(
  raw: RawDishData,
  meta: { sourceId: string; restaurantId: string },
): Partial<NormalizedDishData> {
  // Normalize name: strip leading non-alphanumeric chars (e.g. "/ " from PDF artifacts),
  // then trim and collapse multiple spaces
  const name = raw.name.replace(/^[^a-zA-Z0-9\u00C0-\u024F]+/, '').trim().replace(/\s+/g, ' ');

  // Normalize externalId: trim and truncate to 100 chars
  let externalId: string | undefined;
  if (raw.externalId !== undefined) {
    externalId = raw.externalId.trim().slice(0, 100);
  }

  // Normalize aliases: trim each entry, deduplicate
  const aliases = [...new Set((raw.aliases ?? []).map((a) => a.trim()))];

  return {
    name,
    nameEs: raw.nameEs,
    description: raw.description,
    externalId,
    availability: 'available',
    portionGrams: raw.portionGrams,
    priceEur: raw.priceEur,
    aliases,
    confidenceLevel: 'medium',
    estimationMethod: 'scraped',
    sourceId: meta.sourceId,
    restaurantId: meta.restaurantId,
  };
}
