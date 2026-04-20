/**
 * BUG-PROD-010 — Verify F114 dishes have nutrients per-portionGrams (per-serving),
 * not per-100g. The DishNutrient convention is referenceBasis=per_serving.
 *
 * Sanity check: calories/portionGrams should yield a reasonable per-100g value.
 * Beef ribeye: 200-350 kcal/100g. Cured chorizo: 350-500 kcal/100g.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const dataPath = path.resolve(__dirname, '../../prisma/seed-data/spanish-dishes.json');
const data = JSON.parse(readFileSync(dataPath, 'utf-8')) as {
  dishes: Array<{ dishId: string; nameEs: string; portionGrams: number; nutrients: { calories: number; proteins: number; fats: number; saturatedFats: number; salt: number } }>;
};

describe('BUG-PROD-010: F114 dishes nutrient scaling', () => {
  const chuleton = data.dishes.find((d) => d.dishId === '00000000-0000-e073-0007-0000000000fb');
  const chorizo = data.dishes.find((d) => d.dishId === '00000000-0000-e073-0007-0000000000fc');

  it('Chuletón calories are per-portionGrams (700g), not per-100g', () => {
    expect(chuleton).toBeDefined();
    const kcalPer100g = chuleton!.nutrients.calories / (chuleton!.portionGrams / 100);
    // Beef ribeye is 200-350 kcal/100g. If stored per-100g, this ratio would be
    // 280/(700/100) = 40 kcal/100g — impossibly low.
    expect(kcalPer100g).toBeGreaterThan(150);
    expect(kcalPer100g).toBeLessThan(400);
  });

  it('Chuletón total calories for 700g portion should be 1500-2500 kcal', () => {
    expect(chuleton!.nutrients.calories).toBeGreaterThan(1500);
    expect(chuleton!.nutrients.calories).toBeLessThan(2500);
  });

  it('Chorizo calories are per-portionGrams (180g), not per-100g', () => {
    expect(chorizo).toBeDefined();
    const kcalPer100g = chorizo!.nutrients.calories / (chorizo!.portionGrams / 100);
    // Cured chorizo is 350-500 kcal/100g. If stored per-100g, ratio would be
    // 468/(180/100) = 260 kcal/100g — too low for cured pork sausage.
    expect(kcalPer100g).toBeGreaterThan(300);
    expect(kcalPer100g).toBeLessThan(550);
  });

  it('Chorizo total calories for 180g portion should be 700-1000 kcal', () => {
    expect(chorizo!.nutrients.calories).toBeGreaterThan(700);
    expect(chorizo!.nutrients.calories).toBeLessThan(1000);
  });

  it('no dish has impossibly high kcal density (>950 kcal/100g) — catches per-100g data in large portions', () => {
    // Prevention: if a dish has portionGrams>100 and nutrients look like per-100g
    // (i.e., kcal density would exceed pure fat at 900 kcal/100g), it's a seed error.
    const outliers: string[] = [];
    for (const dish of data.dishes) {
      if (!dish.nutrients || !dish.portionGrams || dish.portionGrams <= 100) continue;
      const ratio = dish.nutrients.calories / (dish.portionGrams / 100);
      if (ratio > 950) {
        outliers.push(`${dish.nameEs}: ${ratio.toFixed(1)} kcal/100g (portionGrams=${dish.portionGrams}, cal=${dish.nutrients.calories})`);
      }
    }
    expect(outliers).toEqual([]);
  });
});
