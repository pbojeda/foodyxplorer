/**
 * F080 — OFF Product Validator
 *
 * Validates a single raw OFF product before mapping and import.
 * Returns { valid: boolean; reasons: string[] }.
 * All failure reasons are collected in a single pass (non-short-circuiting).
 *
 * Skip conditions:
 * - Missing product name (both product_name and product_name_es absent)
 * - Missing nutriments block
 * - Missing all 4 core macronutrients (calories, proteins, carbs, fats)
 * - Calories > 900 kcal/100g (corrupt data — pure fat is the 900 kcal/100g max)
 * - Missing both code and _id (no stable identifier)
 */

import type { OffProduct } from './types.js';

/** Result of validating a single OFF product. */
export interface OffValidationResult {
  valid: boolean;
  reasons: string[];
}

/**
 * Validate a raw OFF product object.
 *
 * @param product - Raw product from the OFF API
 * @returns { valid, reasons[] } — valid=true only when all checks pass.
 */
export function validateOffProduct(product: OffProduct): OffValidationResult {
  const reasons: string[] = [];

  // 1. Name check — at least one of product_name or product_name_es required
  // OFF API returns null (not undefined) for empty fields, so check both
  const nameStr = product.product_name?.trim();
  const nameEsStr = product.product_name_es?.trim();
  const hasName = (nameStr !== undefined && nameStr !== '' && nameStr !== null) ||
    (nameEsStr !== undefined && nameEsStr !== '' && nameEsStr !== null);

  if (!hasName) {
    reasons.push('Missing product name: both product_name and product_name_es are absent or empty');
  }

  // 2. Identifier check — at least code or _id must be present
  // OFF API may return null for these fields, so guard against null.trim()
  const codeStr = product.code != null ? product.code.trim() : '';
  const idStr = product._id != null ? product._id.trim() : '';
  const hasIdentifier = codeStr !== '' || idStr !== '';

  if (!hasIdentifier) {
    reasons.push('Missing stable identifier: both code and _id are absent');
  }

  // 3. Nutriments block check
  if (product.nutriments === undefined || product.nutriments === null) {
    reasons.push('Missing nutriments block');
    // Cannot proceed with calorie/core checks — return early
    return { valid: false, reasons };
  }

  const n = product.nutriments;

  // 4. Core macronutrients check — all 4 must be present (non-null, non-undefined)
  // Calories: accept either energy-kcal_100g or energy_100g (kJ)
  const hasCalories =
    typeof n['energy-kcal_100g'] === 'number' ||
    typeof n['energy_100g'] === 'number';
  const hasProteins = typeof n.proteins_100g === 'number';
  const hasCarbs = typeof n.carbohydrates_100g === 'number';
  const hasFats = typeof n.fat_100g === 'number';

  if (!hasCalories || !hasProteins || !hasCarbs || !hasFats) {
    const missing: string[] = [];
    if (!hasCalories) missing.push('calories (energy)');
    if (!hasProteins) missing.push('proteins');
    if (!hasCarbs) missing.push('carbohydrates');
    if (!hasFats) missing.push('fats');
    reasons.push(`Missing core macronutrients: ${missing.join(', ')}`);
  }

  // 5. Calorie range check — > 900 kcal/100g = physically impossible = corrupt data
  if (hasCalories) {
    let kcal: number;
    if (typeof n['energy-kcal_100g'] === 'number') {
      kcal = n['energy-kcal_100g'];
    } else {
      // Convert kJ to kcal
      kcal = (n['energy_100g'] as number) / 4.184;
    }

    if (kcal > 900) {
      reasons.push(
        `Calories ${Math.round(kcal)} kcal/100g exceeds 900 limit — corrupt data (pure fat max is 900 kcal/100g)`,
      );
    }

    if (kcal < 0) {
      reasons.push(`Negative calories value: ${kcal}`);
    }
  }

  // 6. Negative macronutrient check — corrupt data
  if (hasProteins && (n.proteins_100g ?? 0) < 0) {
    reasons.push(`Negative proteins value: ${n.proteins_100g}`);
  }
  if (hasCarbs && (n.carbohydrates_100g ?? 0) < 0) {
    reasons.push(`Negative carbohydrates value: ${n.carbohydrates_100g}`);
  }
  if (hasFats && (n.fat_100g ?? 0) < 0) {
    reasons.push(`Negative fats value: ${n.fat_100g}`);
  }

  return { valid: reasons.length === 0, reasons };
}
