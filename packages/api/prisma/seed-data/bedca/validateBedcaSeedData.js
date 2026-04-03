"use strict";
/**
 * F071 — BEDCA Seed Data Validation
 *
 * Pure validation functions for the BEDCA snapshot data.
 * No DB dependency — fully unit-testable in isolation.
 * Same pattern as validateSeedData.ts for USDA.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateBedcaSeedData = validateBedcaSeedData;
/**
 * BEDCA nutrient IDs for the 4 core macronutrients.
 * An entry that has all 4 null has no usable data and must be skipped.
 * These IDs match the nutrient index in bedca-nutrient-index.json:
 * 208=calories, 203=proteins, 205=carbohydrates, 204=fats
 */
const CORE_NUTRIENT_IDS = new Set([208, 203, 205, 204]);
/**
 * Validates a BEDCA snapshot array before importing.
 * Collects all errors in a single pass (does not short-circuit).
 * Returns valid:true only when there are zero blocking errors.
 * [WARN] entries in the errors array are non-blocking.
 */
function validateBedcaSeedData(entries) {
    const errors = [];
    // 1. Minimum count
    if (entries.length === 0) {
        errors.push('Entries array is empty — at least 1 food required');
    }
    // 2. Duplicate foodIds
    const seenIds = new Set();
    const duplicates = new Set();
    for (const entry of entries) {
        if (seenIds.has(entry.foodId)) {
            duplicates.add(entry.foodId);
        }
        seenIds.add(entry.foodId);
    }
    if (duplicates.size > 0) {
        errors.push(`Duplicate foodIds found: ${[...duplicates].join(', ')}`);
    }
    // 3. Per-entry validation
    for (const entry of entries) {
        const prefix = `foodId ${entry.foodId}`;
        // Name validation: at least one of nameEs or nameEn must be non-empty
        const hasName = (entry.nameEs?.trim() !== '') || (entry.nameEn?.trim() !== '');
        if (!hasName) {
            errors.push(`${prefix}: both nameEs and nameEn are empty — cannot import`);
        }
        // Negative nutrient values (blocking)
        for (const n of entry.nutrients) {
            if (typeof n.value === 'number' && n.value < 0) {
                errors.push(`${prefix}: negative nutrient value ${n.value} for nutrientId ${n.nutrientId}`);
            }
        }
        // Calorie warning (non-blocking) — calories > 900 kcal/100g is unusual
        const caloriesEntry = entry.nutrients.find((n) => n.nutrientId === 208);
        if (caloriesEntry && typeof caloriesEntry.value === 'number' && caloriesEntry.value > 900) {
            errors.push(`[WARN] ${prefix}: calories ${caloriesEntry.value} > 900 kcal/100g (high — verify source)`);
        }
        // Core nutrients validation: at least one core nutrient must be non-null
        // Entries where all 4 core nutrients are null have no usable data
        const coreNutrients = entry.nutrients.filter((n) => CORE_NUTRIENT_IDS.has(n.nutrientId));
        const allCoreNull = coreNutrients.length === 0 ||
            coreNutrients.every((n) => n.value === null);
        if (allCoreNull) {
            errors.push(`${prefix}: all core nutrients (calories, proteins, carbs, fats) are null — entry has no usable data`);
        }
    }
    const blockingErrors = errors.filter((e) => !e.startsWith('[WARN]'));
    return {
        valid: blockingErrors.length === 0,
        errors,
    };
}
//# sourceMappingURL=validateBedcaSeedData.js.map