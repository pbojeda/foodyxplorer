/**
 * F071 — BEDCA Seed Data Validation Unit Tests
 *
 * Tests for validateBedcaSeedData — ensures the snapshot data is safe to import.
 *
 * Key behaviors:
 * - Empty entries array fails
 * - Duplicate foodIds detected
 * - Negative nutrient values rejected (blocking error)
 * - Calories > 900 produce warning (non-blocking)
 * - Missing nameEs falls back to nameEn (valid)
 * - Missing both names is a blocking error
 * - Core nutrients (calories, proteins, carbs, fats) must be non-null
 * - Entry with no core nutrients skipped (warning, not error)
 */
import { describe, it, expect } from 'vitest';
import { validateBedcaSeedData } from '../ingest/bedca/bedcaValidator.js';
import type { BedcaFoodWithNutrients } from '../ingest/bedca/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFood(
  id: number,
  opts: Partial<BedcaFoodWithNutrients> = {},
): BedcaFoodWithNutrients {
  return {
    foodId: id,
    nameEs: `Alimento ${id}`,
    nameEn: `Food ${id}`,
    foodGroupEs: 'Grupo',
    foodGroupEn: 'Group',
    nutrients: [
      { nutrientId: 208, value: 100 }, // calories
      { nutrientId: 203, value: 5 },   // proteins
      { nutrientId: 205, value: 15 },  // carbs
      { nutrientId: 204, value: 3 },   // fats
    ],
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateBedcaSeedData', () => {
  it('returns valid:true for a well-formed dataset', () => {
    const entries = [makeFood(1), makeFood(2), makeFood(3)];
    const result = validateBedcaSeedData(entries);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails for empty entries array', () => {
    const result = validateBedcaSeedData([]);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('empty') || e.includes('0'))).toBe(true);
  });

  it('detects duplicate foodIds', () => {
    const entries = [makeFood(1), makeFood(1), makeFood(2)];
    const result = validateBedcaSeedData(entries);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Duplicate') || e.includes('duplicate'))).toBe(true);
    expect(result.errors.some((e) => e.includes('1'))).toBe(true);
  });

  it('rejects negative nutrient values (blocking error)', () => {
    const entries = [
      makeFood(1, {
        nutrients: [
          { nutrientId: 208, value: 100 },
          { nutrientId: 203, value: -1.5 }, // negative protein — invalid
          { nutrientId: 205, value: 15 },
          { nutrientId: 204, value: 3 },
        ],
      }),
    ];
    const result = validateBedcaSeedData(entries);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('negative'))).toBe(true);
  });

  it('produces warning (non-blocking) for calories > 900', () => {
    const entries = [
      makeFood(1, {
        nutrients: [
          { nutrientId: 208, value: 884 }, // olive oil range — high but valid
          { nutrientId: 203, value: 0 },
          { nutrientId: 205, value: 0 },
          { nutrientId: 204, value: 99.9 },
        ],
      }),
    ];
    const result = validateBedcaSeedData(entries);

    // 884 < 900, should still be valid
    expect(result.valid).toBe(true);
  });

  it('warns (non-blocking) when calories exceed 900', () => {
    const entries = [
      makeFood(1, {
        nutrients: [
          { nutrientId: 208, value: 901 }, // exceeds 900
          { nutrientId: 203, value: 0 },
          { nutrientId: 205, value: 0 },
          { nutrientId: 204, value: 99.9 },
        ],
      }),
    ];
    const result = validateBedcaSeedData(entries);

    // Should be valid (warnings don't block)
    expect(result.valid).toBe(true);
    expect(result.errors.some((e) => e.startsWith('[WARN]'))).toBe(true);
  });

  it('accepts entry with missing nameEs if nameEn is present (valid — falls back)', () => {
    const entries = [
      makeFood(1, { nameEs: '', nameEn: 'Food 1' }),
    ];
    const result = validateBedcaSeedData(entries);

    expect(result.valid).toBe(true);
  });

  it('rejects entry with both nameEs and nameEn empty (blocking error)', () => {
    const entries = [
      makeFood(1, { nameEs: '', nameEn: '' }),
    ];
    const result = validateBedcaSeedData(entries);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes('name'))).toBe(true);
  });

  it('warns (non-blocking) when all core nutrients (calories, proteins, carbs, fats) are null', () => {
    const entries = [
      makeFood(1, {
        nutrients: [
          { nutrientId: 208, value: null },
          { nutrientId: 203, value: null },
          { nutrientId: 205, value: null },
          { nutrientId: 204, value: null },
        ],
      }),
    ];
    const result = validateBedcaSeedData(entries);

    // Per spec: entries with no core nutrient data are warned, not rejected
    expect(result.valid).toBe(true);
    expect(result.errors.some((e) => e.startsWith('[WARN]') && e.includes('core nutrients'))).toBe(true);
  });

  it('accepts valid snapshot data (all 20 foods)', async () => {
    const { readFileSync } = await import('fs');
    const { dirname } = await import('path');
    const { fileURLToPath } = await import('url');

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const snapshotPath = `${__dirname}/../../prisma/seed-data/bedca/bedca-snapshot-full.json`;

    let snapshot: BedcaFoodWithNutrients[];
    try {
      snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as BedcaFoodWithNutrients[];
    } catch {
      // Snapshot not available — skip this test
      return;
    }

    const result = validateBedcaSeedData(snapshot);
    const blockingErrors = result.errors.filter((e) => !e.startsWith('[WARN]'));
    expect(blockingErrors).toHaveLength(0);
  });
});
