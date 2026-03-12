// Unit tests for ingest/nutritionTableParser.ts
//
// Pure function tests — no mocks needed.
// Fixtures are loaded from __tests__/fixtures/pdf/*.txt

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseNutritionTable } from '../../ingest/nutritionTableParser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '../fixtures/pdf');

function loadFixture(filename: string): string[] {
  const content = readFileSync(join(fixturesDir, filename), 'utf-8');
  return content.split('\n');
}

const TEST_SOURCE_URL = 'pdf://test-fixture.pdf';
const TEST_SCRAPED_AT = '2026-03-12T10:00:00.000Z';

describe('parseNutritionTable', () => {
  describe('Spanish keyword detection', () => {
    it('parses 10 dishes from sample-nutrition-table.txt', () => {
      const lines = loadFixture('sample-nutrition-table.txt');
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      expect(result).toHaveLength(10);
    });

    it('each dish has name, calories, proteins, carbohydrates, fats', () => {
      const lines = loadFixture('sample-nutrition-table.txt');
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      for (const dish of result) {
        expect(dish.name).toBeTruthy();
        expect(dish.name.length).toBeGreaterThanOrEqual(2);
        expect(dish.nutrients.calories).toBeDefined();
        expect(dish.nutrients.proteins).toBeDefined();
        expect(dish.nutrients.carbohydrates).toBeDefined();
        expect(dish.nutrients.fats).toBeDefined();
      }
    });

    it('first dish is "Pollo a la plancha" with correct calories', () => {
      const lines = loadFixture('sample-nutrition-table.txt');
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      const pollo = result.find((d) => d.name.startsWith('Pollo'));
      expect(pollo).toBeDefined();
      expect(pollo?.nutrients.calories).toBe(285);
    });
  });

  describe('English keyword detection', () => {
    it('parses 5 dishes from english-keywords-table.txt', () => {
      const lines = loadFixture('english-keywords-table.txt');
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      expect(result).toHaveLength(5);
    });

    it('classic burger has correct fat value', () => {
      const lines = loadFixture('english-keywords-table.txt');
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      const burger = result.find((d) => d.name.toLowerCase().includes('classic burger'));
      expect(burger).toBeDefined();
      expect(burger?.nutrients.fats).toBe(28.5);
    });
  });

  describe('Multi-section document', () => {
    it('returns dishes from both sections (entrantes + platos principales)', () => {
      const lines = loadFixture('multi-section-table.txt');
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      // 4 entrantes + 5 principales = 9
      expect(result.length).toBeGreaterThanOrEqual(8);
      expect(result.length).toBeLessThanOrEqual(9);
    });

    it('includes dishes from section 2 (e.g. Merluza)', () => {
      const lines = loadFixture('multi-section-table.txt');
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      const merluza = result.find((d) => d.name.toLowerCase().includes('merluza'));
      expect(merluza).toBeDefined();
    });

    it('includes dishes from section 1 (e.g. Croquetas)', () => {
      const lines = loadFixture('multi-section-table.txt');
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      const croquetas = result.find((d) => d.name.toLowerCase().includes('croquetas'));
      expect(croquetas).toBeDefined();
    });
  });

  describe('Empty input', () => {
    it('returns [] for empty file', () => {
      const lines = loadFixture('empty.txt');
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      expect(result).toEqual([]);
    });

    it('returns [] for empty array input', () => {
      const result = parseNutritionTable([], TEST_SOURCE_URL, TEST_SCRAPED_AT);
      expect(result).toEqual([]);
    });
  });

  describe('No-nutrient text', () => {
    it('returns [] for narrative text with no nutritional table', () => {
      const lines = loadFixture('no-nutrients.txt');
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      expect(result).toEqual([]);
    });
  });

  describe('Comma decimal separator', () => {
    it('parses "1,5" as 1.5', () => {
      const lines = [
        'Calorías Proteínas Hidratos Grasas Sal',
        'Plato especial 200 10 20 1,5 0,8',
      ];
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      expect(result).toHaveLength(1);
      expect(result[0]?.nutrients.fats).toBe(1.5);
    });

    it('parses comma decimals in first dish of sample fixture', () => {
      const lines = loadFixture('sample-nutrition-table.txt');
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      // Pollo a la plancha: proteins = 32.5 (from "32,5")
      const pollo = result.find((d) => d.name.startsWith('Pollo'));
      expect(pollo?.nutrients.proteins).toBe(32.5);
    });
  });

  describe('Dish name with diacritics', () => {
    it('preserves diacritics in dish name', () => {
      const lines = [
        'Calorías Proteínas Hidratos Grasas Sal',
        'Pollo a la española 300 25 10 15 1,2',
      ];
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('Pollo a la española');
    });
  });

  describe('Too-short dish name', () => {
    it('skips rows where dish name is 1 character', () => {
      const lines = [
        'Calorías Proteínas Hidratos Grasas Sal',
        'A 200 10 20 8 1',
      ];
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      expect(result).toHaveLength(0);
    });

    it('skips rows where dish name is empty', () => {
      const lines = [
        'Calorías Proteínas Hidratos Grasas Sal',
        '200 10 20 8 1',
      ];
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      expect(result).toHaveLength(0);
    });
  });

  describe('Fewer than 4 numeric tokens', () => {
    it('skips rows with only 3 numeric tokens', () => {
      const lines = [
        'Calorías Proteínas Hidratos Grasas Sal',
        'Ensalada simple 200 10 20',
      ];
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      expect(result).toHaveLength(0);
    });
  });

  describe('sourceUrl and scrapedAt passthrough', () => {
    it('sets sourceUrl on each result item', () => {
      const lines = [
        'Calorías Proteínas Hidratos Grasas Sal',
        'Pollo asado 300 28 5 15 1',
      ];
      const result = parseNutritionTable(lines, 'pdf://my-menu.pdf', TEST_SCRAPED_AT);

      expect(result[0]?.sourceUrl).toBe('pdf://my-menu.pdf');
    });

    it('sets scrapedAt on each result item', () => {
      const lines = [
        'Calorías Proteínas Hidratos Grasas Sal',
        'Pollo asado 300 28 5 15 1',
      ];
      const scrapedAt = '2026-01-15T08:30:00.000Z';
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, scrapedAt);

      expect(result[0]?.scrapedAt).toBe(scrapedAt);
    });
  });

  describe('RawDishData structure', () => {
    it('sets aliases to [] on every result item', () => {
      const lines = [
        'Calorías Proteínas Hidratos Grasas Sal',
        'Pollo asado 300 28 5 15 1',
      ];
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      expect(result[0]?.aliases).toEqual([]);
    });

    it('sets externalId to undefined on every result item', () => {
      const lines = [
        'Calorías Proteínas Hidratos Grasas Sal',
        'Pollo asado 300 28 5 15 1',
      ];
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      expect(result[0]?.externalId).toBeUndefined();
    });

    it('sets category to undefined on every result item', () => {
      const lines = [
        'Calorías Proteínas Hidratos Grasas Sal',
        'Pollo asado 300 28 5 15 1',
      ];
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      expect(result[0]?.category).toBeUndefined();
    });
  });

  describe('Column mapping — specific nutrients', () => {
    it('maps sal column to salt nutrient', () => {
      const lines = [
        'Calorías Proteínas Hidratos Grasas Sal',
        'Sopa de verduras 180 6 28 5 2,1',
      ];
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      expect(result[0]?.nutrients.salt).toBe(2.1);
    });

    it('maps azúcares column to sugars nutrient', () => {
      const lines = [
        'Calorías Proteínas Hidratos Azúcares Grasas Sal',
        'Tarta de queso 380 8 48 35 18 0,5',
      ];
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      expect(result[0]?.nutrients.sugars).toBe(35);
    });

    it('maps fibra column to fiber nutrient', () => {
      const lines = [
        'Calorías Proteínas Hidratos Grasas Fibra Sal',
        'Ensalada verde 95 4 12 3 4,5 0,8',
      ];
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      expect(result[0]?.nutrients.fiber).toBe(4.5);
    });

    it('maps sodio column to sodium nutrient', () => {
      const lines = [
        'Calorías Proteínas Hidratos Grasas Sodio',
        'Caldo de pollo 45 4 3 1,5 820',
      ];
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      expect(result[0]?.nutrients.sodium).toBe(820);
    });
  });

  describe('Header detection — fewer than 3 keywords', () => {
    it('does not treat lines with fewer than 3 nutrient keywords as headers', () => {
      const lines = [
        // Only 2 nutrient keywords — not a header
        'Plato con calorías y proteínas',
        'Producto 200 10 20 8 1',
      ];
      const result = parseNutritionTable(lines, TEST_SOURCE_URL, TEST_SCRAPED_AT);

      // No header detected → no dishes parsed
      expect(result).toHaveLength(0);
    });
  });
});
