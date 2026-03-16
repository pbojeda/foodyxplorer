// KFC Spain — chain-specific parser integration test.
// Fixture: packages/api/src/__tests__/fixtures/pdf/chains/kfc-es.txt
// Real PDF source: https://static.kfc.es/pdf/contenido-nutricional.pdf
// Fixture created: 2026-03-16

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseNutritionTable } from '../../../ingest/nutritionTableParser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(
  join(__dirname, '../../fixtures/pdf/chains/kfc-es.txt'),
  'utf-8',
);
const lines = fixture.split('\n');
const SOURCE_URL = 'https://static.kfc.es/pdf/contenido-nutricional.pdf';
const SCRAPED_AT = '2026-03-16T12:00:00.000Z';

describe('KFC Spain — parser integration (preprocessed fixture)', () => {
  const result = parseNutritionTable(lines, SOURCE_URL, SCRAPED_AT);

  it('parseNutritionTable returns at least 20 dishes from the KFC fixture', () => {
    expect(result.length).toBeGreaterThanOrEqual(20);
  });

  it('first dish has name, calories, proteins, carbohydrates, fats defined', () => {
    const dish = result[0];
    expect(dish).toBeDefined();
    expect(dish?.name.length).toBeGreaterThanOrEqual(2);
    expect(dish?.nutrients.calories).toBeDefined();
    expect(dish?.nutrients.proteins).toBeDefined();
    expect(dish?.nutrients.carbohydrates).toBeDefined();
    expect(dish?.nutrients.fats).toBeDefined();
  });

  it('Chick&Share has realistic per-100g calorie value (200-350 kcal)', () => {
    const chickShare = result.find((d) => d.name.includes('Chick&Share'));
    expect(chickShare).toBeDefined();
    expect(chickShare?.nutrients.calories).toBeGreaterThanOrEqual(200);
    expect(chickShare?.nutrients.calories).toBeLessThanOrEqual(350);
  });

  it('no dish has calories > 9000', () => {
    for (const dish of result) {
      if (dish.nutrients.calories !== undefined) {
        expect(dish.nutrients.calories).toBeLessThanOrEqual(9000);
      }
    }
  });

  it('no dish has a name shorter than 2 characters', () => {
    for (const dish of result) {
      expect(dish.name.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('sourceUrl on every dish equals the registry URL', () => {
    for (const dish of result) {
      expect(dish.sourceUrl).toBe(SOURCE_URL);
    }
  });

  it('at least one dish has saturatedFats defined (KFC publishes saturated fats)', () => {
    const withSaturated = result.filter((d) => d.nutrients.saturatedFats !== undefined);
    expect(withSaturated.length).toBeGreaterThan(0);
  });

  it('at least one dish has salt defined (KFC publishes salt)', () => {
    const withSalt = result.filter((d) => d.nutrients.salt !== undefined);
    expect(withSalt.length).toBeGreaterThan(0);
  });

  it('values are per-100g — no calorie value should exceed 600 kcal/100g for fried chicken', () => {
    for (const dish of result) {
      if (dish.nutrients.calories !== undefined) {
        expect(dish.nutrients.calories).toBeLessThanOrEqual(600);
      }
    }
  });
});
