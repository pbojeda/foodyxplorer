/**
 * F073 — validateSpanishDishes edge cases (QA test file).
 *
 * Covers gaps not tested by the developer's f073.validateSpanishDishes.unit.test.ts:
 *
 *   BUG-3: No validation of dishId/nutrientId field presence or format.
 *   BUG-4: No cross-check between source field and estimationMethod/confidenceLevel.
 *   BUG-5: No validation that aliases is an array.
 *   Additional boundary conditions and robustness checks.
 */

import { describe, it, expect } from 'vitest';
import { validateSpanishDishes } from '../scripts/validateSpanishDishes.js';
import type { SpanishDishEntry } from '../scripts/spanishDishesTypes.js';

function makeEntry(overrides: Partial<SpanishDishEntry> = {}): SpanishDishEntry {
  return {
    externalId: 'CE-001',
    dishId: '00000000-0000-e073-0007-000000000001',
    nutrientId: '00000000-0000-e073-0008-000000000001',
    name: 'Tortilla de patatas',
    nameEs: 'Tortilla de patatas',
    aliases: ['tortilla española'],
    category: 'tapas',
    portionGrams: 150,
    confidenceLevel: 'high',
    estimationMethod: 'official',
    source: 'bedca',
    nutrients: {
      calories: 197,
      proteins: 6.5,
      carbohydrates: 16.8,
      sugars: 1.2,
      fats: 11.8,
      saturatedFats: 2.1,
      fiber: 1.3,
      salt: 0.8,
      sodium: 0.32,
    },
    ...overrides,
  };
}

function makeMinimalDataset(count: number, overrideAt?: { index: number; entry: SpanishDishEntry }): SpanishDishEntry[] {
  const dishes = Array.from({ length: count }, (_, i) =>
    makeEntry({
      externalId: `CE-${String(i + 1).padStart(3, '0')}`,
      dishId: `00000000-0000-e073-0007-${String(i + 1).padStart(12, '0')}`,
      nutrientId: `00000000-0000-e073-0008-${String(i + 1).padStart(12, '0')}`,
      name: `Plato ${i + 1}`,
      nameEs: `Plato ${i + 1}`,
      // Each filler dish gets a unique alias to avoid triggering the uniqueness
      // check added in F-H4-B (all sharing "tortilla española" would collide).
      aliases: [`filler-${i + 1}`],
    }),
  );
  if (overrideAt !== undefined) {
    dishes[overrideAt.index] = overrideAt.entry;
  }
  return dishes;
}

// ---------------------------------------------------------------------------
// BUG-3: Missing dishId / nutrientId validation
// ---------------------------------------------------------------------------

describe('F073 edge cases — dishId and nutrientId validation (BUG-3)', () => {
  it('rejects entry with missing dishId (null)', () => {
    const dishes = makeMinimalDataset(250);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dishes[0] = makeEntry({ dishId: null as any });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes('dishid'))).toBe(true);
  });

  it('rejects entry with missing nutrientId (null)', () => {
    const dishes = makeMinimalDataset(250);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dishes[0] = makeEntry({ nutrientId: null as any });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes('nutrientid'))).toBe(true);
  });

  it('rejects entry with empty string dishId', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({ dishId: '' });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes('dishid'))).toBe(true);
  });

  it('rejects entry with empty string nutrientId', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({ nutrientId: '' });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes('nutrientid'))).toBe(true);
  });

  it('rejects duplicate nutrientId across different entries', () => {
    const dishes = makeMinimalDataset(250);
    // dishes[0] and dishes[1] share the same nutrientId
    dishes[1] = makeEntry({
      ...dishes[1],
      externalId: 'CE-002',
      dishId: '00000000-0000-e073-0007-000000000002',
      nutrientId: dishes[0]!.nutrientId, // collision!
      name: 'Dish 2',
      nameEs: 'Plato 2',
    });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('nutrientId'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BUG-4: Missing cross-checks between source field and estimationMethod/confidenceLevel
// ---------------------------------------------------------------------------

describe('F073 edge cases — source vs estimationMethod/confidenceLevel cross-checks (BUG-4)', () => {
  it('rejects source=bedca paired with estimationMethod=ingredients', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({
      ...dishes[0],
      source: 'bedca',
      estimationMethod: 'ingredients', // contradicts bedca
      confidenceLevel: 'high',
    });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.toLowerCase().includes('estimationmethod') ||
        e.toLowerCase().includes('source') ||
        e.toLowerCase().includes('mismatch'),
      ),
    ).toBe(true);
  });

  it('rejects source=bedca paired with confidenceLevel=medium', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({
      ...dishes[0],
      source: 'bedca',
      estimationMethod: 'official',
      confidenceLevel: 'medium', // contradicts bedca
    });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.toLowerCase().includes('confidencelevel') ||
        e.toLowerCase().includes('source') ||
        e.toLowerCase().includes('mismatch'),
      ),
    ).toBe(true);
  });

  it('rejects source=recipe paired with estimationMethod=official', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({
      ...dishes[0],
      source: 'recipe',
      estimationMethod: 'official', // contradicts recipe
      confidenceLevel: 'medium',
    });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.toLowerCase().includes('estimationmethod') ||
        e.toLowerCase().includes('source') ||
        e.toLowerCase().includes('mismatch'),
      ),
    ).toBe(true);
  });

  it('rejects source=recipe paired with confidenceLevel=high', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({
      ...dishes[0],
      source: 'recipe',
      estimationMethod: 'ingredients',
      confidenceLevel: 'high', // contradicts recipe
    });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.toLowerCase().includes('confidencelevel') ||
        e.toLowerCase().includes('source') ||
        e.toLowerCase().includes('mismatch'),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BUG-5: No validation that aliases is an array
// ---------------------------------------------------------------------------

describe('F073 edge cases — aliases type validation (BUG-5)', () => {
  it('rejects aliases that is a string instead of an array', () => {
    const dishes = makeMinimalDataset(250);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dishes[0] = makeEntry({ aliases: 'tortilla española' as any });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes('aliases'))).toBe(true);
  });

  it('rejects aliases that is null', () => {
    const dishes = makeMinimalDataset(250);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dishes[0] = makeEntry({ aliases: null as any });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes('aliases'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BUG-6: No guard for invalid JSON structure (missing dishes key)
// ---------------------------------------------------------------------------

describe('F073 edge cases — invalid input guard (BUG-6)', () => {
  it('does not throw TypeError when called with undefined — returns blocking error', () => {
    // Simulates what happens when raw.dishes is undefined (JSON missing the key)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => validateSpanishDishes(undefined as any)).not.toThrow(TypeError);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = validateSpanishDishes(undefined as any);
    expect(result.valid).toBe(false);
  });

  it('does not throw TypeError when called with null — returns blocking error', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => validateSpanishDishes(null as any)).not.toThrow(TypeError);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = validateSpanishDishes(null as any);
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Additional boundary conditions not covered by developer tests
// ---------------------------------------------------------------------------

describe('F073 edge cases — boundary conditions', () => {
  it('accepts portionGrams exactly at lower boundary (10g)', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({ ...dishes[0], portionGrams: 10 });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(true);
  });

  it('accepts portionGrams exactly at upper boundary (800g)', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({ ...dishes[0], portionGrams: 800 });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(true);
  });

  it('accepts calories exactly at warning boundary (2000) — no warning emitted', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({
      ...dishes[0],
      nutrients: { ...dishes[0]!.nutrients, calories: 2000 },
    });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(true);
    expect(result.errors.some((e) => e.startsWith('[WARN]'))).toBe(false);
  });

  it('emits warning at exactly 2001 calories (first value triggering warn threshold)', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({
      ...dishes[0],
      nutrients: { ...dishes[0]!.nutrients, calories: 2001 },
    });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(true);
    expect(result.errors.some((e) => e.startsWith('[WARN]'))).toBe(true);
  });

  it('rejects calories exactly at 3000 blocking boundary', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({
      ...dishes[0],
      nutrients: { ...dishes[0]!.nutrients, calories: 3001 },
    });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
  });

  it('accepts calories exactly at 3000 (max allowed, no blocking error)', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({
      ...dishes[0],
      nutrients: { ...dishes[0]!.nutrients, calories: 3000 },
    });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(true);
    // 3000 is the inclusive upper boundary — should warn but not block
    expect(result.errors.some((e) => e.includes('exceeds 3000'))).toBe(false);
  });

  it('rejects zero portionGrams (boundary below minimum)', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({ ...dishes[0], portionGrams: 0 });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
  });

  it('rejects portionGrams=9 (one below lower boundary)', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({ ...dishes[0], portionGrams: 9 });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
  });

  it('rejects portionGrams=801 (one above upper boundary)', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({ ...dishes[0], portionGrams: 801 });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
  });

  it('returns all errors accumulated — does not stop at first error', () => {
    // Multiple invalid entries — all errors should be in the result
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({ ...dishes[0], portionGrams: 5 });
    dishes[1] = makeEntry({
      ...dishes[1],
      nutrients: { ...dishes[1]!.nutrients, calories: -50 },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dishes[2] = makeEntry({ ...dishes[2], source: 'unknown' as any });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects whitespace-only name as empty', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({ ...dishes[0], name: '   ' });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('name'))).toBe(true);
  });

  it('rejects whitespace-only nameEs as empty', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({ ...dishes[0], nameEs: '   ' });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('nameEs'))).toBe(true);
  });

  it('accepts a dataset with exactly 249 entries as invalid (one below minimum)', () => {
    const result = validateSpanishDishes(makeMinimalDataset(249));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('at least 250'))).toBe(true);
  });

  it('accepts a dataset with 251 entries as valid (one above minimum)', () => {
    const entries = makeMinimalDataset(251);
    const result = validateSpanishDishes(entries);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Spec compliance: name must equal nameEs for Spanish-origin dishes
// ---------------------------------------------------------------------------

describe('F073 edge cases — spec: name must equal nameEs', () => {
  it('rejects entry where name differs from nameEs', () => {
    // Spec: "name: Spanish name (same as nameEs for Spanish-origin dishes)"
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({
      ...dishes[0],
      name: 'Tortilla de patatas',
      nameEs: 'Spanish Omelette', // English name in nameEs field — wrong
    });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.toLowerCase().includes('name') && e.toLowerCase().includes('namees'),
      ),
    ).toBe(true);
  });
});
