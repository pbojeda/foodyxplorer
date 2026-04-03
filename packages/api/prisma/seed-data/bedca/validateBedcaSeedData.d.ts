/**
 * F071 — BEDCA Seed Data Validation
 *
 * Pure validation functions for the BEDCA snapshot data.
 * No DB dependency — fully unit-testable in isolation.
 * Same pattern as validateSeedData.ts for USDA.
 */
import type { BedcaFoodWithNutrients, BedcaValidationResult } from '../../../src/ingest/bedca/types.js';
/**
 * Validates a BEDCA snapshot array before importing.
 * Collects all errors in a single pass (does not short-circuit).
 * Returns valid:true only when there are zero blocking errors.
 * [WARN] entries in the errors array are non-blocking.
 */
export declare function validateBedcaSeedData(entries: BedcaFoodWithNutrients[]): BedcaValidationResult;
//# sourceMappingURL=validateBedcaSeedData.d.ts.map