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

function makeMinimalDataset(count: number): SpanishDishEntry[] {
  return Array.from({ length: count }, (_, i) =>
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
}

describe('F073 — validateSpanishDishes', () => {
  it('rejects empty array', () => {
    const result = validateSpanishDishes([]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('at least 250'))).toBe(true);
  });

  it('rejects array with fewer than 250 entries', () => {
    const result = validateSpanishDishes(makeMinimalDataset(100));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('at least 250'))).toBe(true);
  });

  it('accepts array with exactly 250 entries', () => {
    const result = validateSpanishDishes(makeMinimalDataset(250));
    expect(result.valid).toBe(true);
  });

  it('rejects duplicate externalId', () => {
    const dishes = makeMinimalDataset(250);
    dishes[249] = makeEntry({
      ...dishes[249],
      externalId: dishes[0].externalId,
    });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('duplicate') || e.includes('Duplicate'))).toBe(true);
  });

  it('rejects duplicate dishId', () => {
    const dishes = makeMinimalDataset(250);
    dishes[249] = makeEntry({
      ...dishes[249],
      dishId: dishes[0].dishId,
    });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('dishId'))).toBe(true);
  });

  it('rejects duplicate nutrientId', () => {
    const dishes = makeMinimalDataset(250);
    dishes[249] = makeEntry({
      ...dishes[249],
      nutrientId: dishes[0].nutrientId,
    });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('nutrientId'))).toBe(true);
  });

  it('rejects negative nutrient value', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({
      ...dishes[0],
      nutrients: { ...dishes[0].nutrients, calories: -10 },
    });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('negative'))).toBe(true);
  });

  it('rejects calories > 3000 per serving', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({
      ...dishes[0],
      nutrients: { ...dishes[0].nutrients, calories: 3100 },
    });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('3000'))).toBe(true);
  });

  it('warns but does not reject calories 2001-3000', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({
      ...dishes[0],
      nutrients: { ...dishes[0].nutrients, calories: 2500 },
    });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(true);
    expect(result.errors.some((e) => e.startsWith('[WARN]'))).toBe(true);
  });

  it('rejects portionGrams below 10', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({ ...dishes[0], portionGrams: 5 });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('portionGrams'))).toBe(true);
  });

  it('rejects portionGrams above 800', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({ ...dishes[0], portionGrams: 900 });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('portionGrams'))).toBe(true);
  });

  it('rejects invalid source value', () => {
    const dishes = makeMinimalDataset(250);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dishes[0] = makeEntry({ ...dishes[0], source: 'other' as any });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('source'))).toBe(true);
  });

  it('accepts valid bedca and recipe source values', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({ ...dishes[0], source: 'bedca' });
    dishes[1] = makeEntry({
      ...dishes[1],
      source: 'recipe',
      confidenceLevel: 'medium',
      estimationMethod: 'ingredients',
    });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(true);
  });

  it('rejects missing name', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({ ...dishes[0], name: '' });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('name'))).toBe(true);
  });

  it('rejects missing nameEs', () => {
    const dishes = makeMinimalDataset(250);
    dishes[0] = makeEntry({ ...dishes[0], nameEs: '' });
    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('nameEs'))).toBe(true);
  });
});
