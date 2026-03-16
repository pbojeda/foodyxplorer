// Five Guys Spain — allergen PDF investigation outcome test.
// Fixture: packages/api/src/__tests__/fixtures/pdf/chains/five-guys-es.txt
// Real PDF source: https://fiveguys.es/app/uploads/sites/6/2026/02/FGES_ES_allergen-ingredients_print-SP_A4_20260303.pdf
// Fixture created: 2026-03-16
//
// Investigation result (2026-03-16): PDF contains allergen/ingredient list only.
// No calorie, protein, carbohydrate, or fat data found in the extracted text.
// Registry entry updated: enabled=false.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseNutritionTable } from '../../../ingest/nutritionTableParser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(
  join(__dirname, '../../fixtures/pdf/chains/five-guys-es.txt'),
  'utf-8',
);
const lines = fixture.split('\n');
const SOURCE_URL = 'https://fiveguys.es/app/uploads/sites/6/2026/02/FGES_ES_allergen-ingredients_print-SP_A4_20260303.pdf';
const SCRAPED_AT = '2026-03-16T12:00:00.000Z';

describe('Five Guys Spain — allergen PDF investigation', () => {
  it('returns 0 dishes — PDF is allergen/ingredient list, not nutritional table', () => {
    const result = parseNutritionTable(lines, SOURCE_URL, SCRAPED_AT);
    expect(result).toHaveLength(0);
  });

  it('fixture confirms no nutritional header is present in extracted text', () => {
    const hasNutritionalHeader = lines.some((line) => {
      const lower = line.toLowerCase();
      const nutritionalKeywords = ['calorías', 'proteínas', 'grasas', 'hidratos', 'calories', 'protein', 'fat'];
      return nutritionalKeywords.filter((kw) => lower.includes(kw)).length >= 3;
    });
    expect(hasNutritionalHeader).toBe(false);
  });

  it('fixture contains allergen-related content (confirming it is an allergen PDF)', () => {
    const text = lines.join('\n').toLowerCase();
    expect(text).toContain('cacahuetes');
    expect(text).toContain('gluten');
  });
});
