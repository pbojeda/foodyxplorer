// Burger King Spain — chain-specific parser integration test.
// Fixture: packages/api/src/__tests__/fixtures/pdf/chains/burger-king-es.txt
// Real PDF source: BK Spain AWS S3 nutrition PDF (monthly rotation)
// Fixture created: 2026-03-16

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseNutritionTable } from '../../../ingest/nutritionTableParser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(
  join(__dirname, '../../fixtures/pdf/chains/burger-king-es.txt'),
  'utf-8',
);
const lines = fixture.split('\n');
const SOURCE_URL = 'https://eu-west-3-146514239214-prod-bk-fz.s3.eu-west-3.amazonaws.com/en-ES/2026/Nutritional+Information/MANTEL+NUTRICIONAL+ESP+ING+FEB2026.pdf';
const SCRAPED_AT = '2026-03-16T12:00:00.000Z';

describe('Burger King Spain — parser integration (preprocessed fixture)', () => {
  const result = parseNutritionTable(lines, SOURCE_URL, SCRAPED_AT);

  it('parseNutritionTable returns at least 10 dishes from the BK fixture', () => {
    expect(result.length).toBeGreaterThanOrEqual(10);
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

  it('Whopper has realistic calorie value (600-700 kcal)', () => {
    const whopper = result.find((d) => d.name.includes('Whopper'));
    expect(whopper).toBeDefined();
    expect(whopper?.nutrients.calories).toBeGreaterThanOrEqual(600);
    expect(whopper?.nutrients.calories).toBeLessThanOrEqual(700);
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

  it('at least one dish has sugars defined (BK publishes sugars)', () => {
    const withSugars = result.filter((d) => d.nutrients.sugars !== undefined);
    expect(withSugars.length).toBeGreaterThan(0);
  });

  it('at least one dish has salt defined (BK publishes salt)', () => {
    const withSalt = result.filter((d) => d.nutrients.salt !== undefined);
    expect(withSalt.length).toBeGreaterThan(0);
  });

  it('at least one dish has fiber defined (BK publishes fiber)', () => {
    const withFiber = result.filter((d) => d.nutrients.fiber !== undefined);
    expect(withFiber.length).toBeGreaterThan(0);
  });

  it('at least one dish has saturatedFats defined (BK publishes saturated fats)', () => {
    const withSaturated = result.filter((d) => d.nutrients.saturatedFats !== undefined);
    expect(withSaturated.length).toBeGreaterThan(0);
  });

  it('at least one dish has sodium defined (BK publishes sodium)', () => {
    const withSodium = result.filter((d) => d.nutrients.sodium !== undefined);
    expect(withSodium.length).toBeGreaterThan(0);
  });
});
