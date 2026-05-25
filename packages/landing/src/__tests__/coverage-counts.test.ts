// F105 — Landing Coverage Showcase
// Drift-detection test: the helper exposes hard-coded counts; this test reads
// the actual seed JSON from packages/api/prisma/seed-data/ and asserts the
// hard-coded values still match reality. If seed data grows, this test fails
// and forces an intentional update to the landing copy.

import * as path from 'path';
import * as fs from 'fs';
import {
  DISHES_COUNT,
  FOODS_COUNT,
  CATEGORIES_COUNT,
  CONFIDENCE_LEVELS_COUNT,
  COVERAGE_COUNTS,
} from '@/lib/coverage-counts';

const SEED_DIR = path.resolve(__dirname, '../../../api/prisma/seed-data');

function readJson<T>(rel: string): T {
  const file = path.join(SEED_DIR, rel);
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
}

interface SpanishDishesSeed {
  dishes: Array<{ category: string; source: string }>;
}

describe('coverage-counts.ts — empirical drift detection', () => {
  it('DISHES_COUNT matches spanish-dishes.json dishes.length', () => {
    const data = readJson<SpanishDishesSeed>('spanish-dishes.json');
    expect(DISHES_COUNT).toBe(data.dishes.length);
  });

  it('FOODS_COUNT equals USDA length + BEDCA-linked dish count', () => {
    const usda = readJson<unknown[]>('usda-sr-legacy-foods.json');
    const dishes = readJson<SpanishDishesSeed>('spanish-dishes.json');
    const bedcaLinked = dishes.dishes.filter((d) => d.source === 'bedca').length;
    expect(FOODS_COUNT).toBe(usda.length + bedcaLinked);
  });

  it('CATEGORIES_COUNT matches unique categories in dishes', () => {
    const data = readJson<SpanishDishesSeed>('spanish-dishes.json');
    const categories = new Set(data.dishes.map((d) => d.category));
    expect(CATEGORIES_COUNT).toBe(categories.size);
  });

  it('CONFIDENCE_LEVELS_COUNT is 4 (high/medium/low + estimated)', () => {
    expect(CONFIDENCE_LEVELS_COUNT).toBe(4);
  });

  it('COVERAGE_COUNTS aggregate mirrors individual constants', () => {
    expect(COVERAGE_COUNTS).toEqual({
      dishes: DISHES_COUNT,
      foods: FOODS_COUNT,
      categories: CATEGORIES_COUNT,
      confidenceLevels: CONFIDENCE_LEVELS_COUNT,
    });
  });

  it('all constants are positive integers (no NaN, no 0)', () => {
    for (const v of Object.values(COVERAGE_COUNTS)) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });
});
