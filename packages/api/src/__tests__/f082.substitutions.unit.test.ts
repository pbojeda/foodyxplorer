import { describe, it, expect } from 'vitest';
import {
  getSubstitutions,
  enrichWithSubstitutions,
} from '../estimation/substitutions.js';

// ---------------------------------------------------------------------------
// getSubstitutions — core engine
// ---------------------------------------------------------------------------

describe('getSubstitutions', () => {
  // --- Sides ---
  it('suggests substitutions for "patatas fritas"', () => {
    const subs = getSubstitutions('patatas fritas', 400);
    expect(subs.length).toBeGreaterThanOrEqual(1);
    expect(subs.length).toBeLessThanOrEqual(2);
    expect(subs[0]).toMatchObject({ original: 'Patatas fritas' });
    expect(subs[0]?.nutrientDiff.calories).toBeLessThan(0);
  });

  it('suggests substitutions for dish containing "patatas fritas" keyword', () => {
    const subs = getSubstitutions('hamburguesa con patatas fritas', 600);
    expect(subs.length).toBeGreaterThanOrEqual(1);
    expect(subs[0]).toMatchObject({ original: 'Patatas fritas' });
  });

  // --- Drinks ---
  it('suggests substitutions for "refresco"', () => {
    const subs = getSubstitutions('refresco de cola', 350);
    expect(subs.length).toBeGreaterThanOrEqual(1);
    expect(subs[0]).toMatchObject({ original: 'Refresco azucarado' });
    expect(subs[0]?.nutrientDiff.calories).toBeLessThan(0);
  });

  it('suggests substitutions for "coca-cola"', () => {
    const subs = getSubstitutions('coca-cola', 280);
    expect(subs.length).toBeGreaterThanOrEqual(1);
    expect(subs[0]).toMatchObject({ original: 'Refresco azucarado' });
  });

  // --- Proteins ---
  it('suggests substitutions for "pollo frito"', () => {
    const subs = getSubstitutions('pollo frito crujiente', 500);
    expect(subs.length).toBeGreaterThanOrEqual(1);
    expect(subs[0]).toMatchObject({ original: 'Pollo frito' });
    expect(subs[0]?.nutrientDiff.calories).toBeLessThan(0);
    expect(subs[0]?.nutrientDiff.fats).toBeLessThan(0);
  });

  // --- Sauces ---
  it('suggests substitutions for "mayonesa"', () => {
    const subs = getSubstitutions('sandwich con mayonesa', 450);
    expect(subs.length).toBeGreaterThanOrEqual(1);
    expect(subs[0]).toMatchObject({ original: 'Mayonesa' });
  });

  // --- Bread ---
  it('suggests substitutions for "pan blanco"', () => {
    const subs = getSubstitutions('tostada de pan blanco', 300);
    expect(subs.length).toBeGreaterThanOrEqual(1);
    expect(subs[0]).toMatchObject({ original: 'Pan blanco' });
  });

  // --- Dairy ---
  it('suggests substitutions for "leche entera"', () => {
    const subs = getSubstitutions('café con leche entera', 250);
    expect(subs.length).toBeGreaterThanOrEqual(1);
    expect(subs[0]).toMatchObject({ original: 'Leche entera' });
  });

  // --- Rice ---
  it('suggests substitutions for "arroz blanco"', () => {
    const subs = getSubstitutions('arroz blanco con pollo', 500);
    expect(subs.length).toBeGreaterThanOrEqual(1);
    expect(subs[0]).toMatchObject({ original: 'Arroz blanco' });
  });

  // --- Edge cases ---
  it('returns empty array for unknown food', () => {
    const subs = getSubstitutions('sushi de salmón', 400);
    expect(subs).toEqual([]);
  });

  it('returns empty array for low-calorie items (< 200 kcal)', () => {
    const subs = getSubstitutions('patatas fritas', 150);
    expect(subs).toEqual([]);
  });

  it('returns substitutions for exactly 200 kcal (threshold is >=)', () => {
    const subs = getSubstitutions('patatas fritas', 200);
    expect(subs.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array for empty dish name', () => {
    const subs = getSubstitutions('', 400);
    expect(subs).toEqual([]);
  });

  it('returns max 2 substitutions', () => {
    const subs = getSubstitutions('patatas fritas', 600);
    expect(subs.length).toBeLessThanOrEqual(2);
  });

  it('is case-insensitive', () => {
    const subs = getSubstitutions('PATATAS FRITAS', 400);
    expect(subs.length).toBeGreaterThanOrEqual(1);
  });

  // --- Nutrient diff structure ---
  it('returns complete nutrient diff for each substitution', () => {
    const subs = getSubstitutions('patatas fritas', 400);
    expect(subs.length).toBeGreaterThanOrEqual(1);
    const sub = subs[0];
    expect(sub).toBeDefined();
    expect(sub).toHaveProperty('original');
    expect(sub).toHaveProperty('substitute');
    expect(sub).toHaveProperty('nutrientDiff');
    expect(sub?.nutrientDiff).toHaveProperty('calories');
    expect(sub?.nutrientDiff).toHaveProperty('proteins');
    expect(sub?.nutrientDiff).toHaveProperty('fats');
    expect(sub?.nutrientDiff).toHaveProperty('carbohydrates');
    expect(sub?.nutrientDiff).toHaveProperty('fiber');
    expect(typeof sub?.nutrientDiff.calories).toBe('number');
    expect(typeof sub?.nutrientDiff.proteins).toBe('number');
    expect(typeof sub?.nutrientDiff.fats).toBe('number');
    expect(typeof sub?.nutrientDiff.carbohydrates).toBe('number');
    expect(typeof sub?.nutrientDiff.fiber).toBe('number');
  });

  // --- Sort order ---
  it('sorts substitutions by calorie savings (most savings first)', () => {
    const subs = getSubstitutions('patatas fritas', 400);
    if (subs.length >= 2) {
      expect(subs[0]?.nutrientDiff.calories).toBeLessThanOrEqual(
        subs[1]?.nutrientDiff.calories ?? 0,
      );
    }
  });

  // --- First match wins (no duplicate categories) ---
  it('only returns substitutions from the first matching rule', () => {
    const subs = getSubstitutions('pollo frito con patatas fritas', 600);
    expect(subs.length).toBeLessThanOrEqual(2);
    if (subs.length >= 2) {
      expect(subs[0]?.original).toBe(subs[1]?.original);
    }
  });
});

// ---------------------------------------------------------------------------
// enrichWithSubstitutions — DRY helper
// ---------------------------------------------------------------------------

describe('enrichWithSubstitutions', () => {
  it('returns substitutions for a result with matching name', () => {
    const result = {
      chainSlug: 'mcdonalds-es',
      nameEs: 'Patatas fritas grandes',
      name: 'Large Fries',
      nutrients: { calories: 400 },
    };
    const enriched = enrichWithSubstitutions(result);
    expect(enriched.substitutions).toBeDefined();
    expect(enriched.substitutions?.length).toBeGreaterThanOrEqual(1);
  });

  it('uses nameEs preferentially over name', () => {
    const result = {
      chainSlug: null,
      nameEs: 'Patatas fritas',
      name: 'French Fries',
      nutrients: { calories: 400 },
    };
    const enriched = enrichWithSubstitutions(result);
    expect(enriched.substitutions).toBeDefined();
  });

  it('falls back to name when nameEs is null', () => {
    const result = {
      chainSlug: null,
      nameEs: null,
      name: 'patatas fritas',
      nutrients: { calories: 400 },
    };
    const enriched = enrichWithSubstitutions(result);
    expect(enriched.substitutions).toBeDefined();
  });

  it('returns empty object for null result', () => {
    const enriched = enrichWithSubstitutions(null);
    expect(enriched).toEqual({});
  });

  it('returns empty object when no match found', () => {
    const result = {
      chainSlug: null,
      nameEs: 'Sushi variado',
      name: 'Assorted Sushi',
      nutrients: { calories: 400 },
    };
    const enriched = enrichWithSubstitutions(result);
    expect(enriched).toEqual({});
  });

  it('returns empty object for low-calorie results', () => {
    const result = {
      chainSlug: null,
      nameEs: 'Patatas fritas',
      name: 'French Fries',
      nutrients: { calories: 100 },
    };
    const enriched = enrichWithSubstitutions(result);
    expect(enriched).toEqual({});
  });
});
