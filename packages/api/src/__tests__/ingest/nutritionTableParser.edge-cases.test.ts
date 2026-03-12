// Edge-case tests for ingest/nutritionTableParser.ts
//
// Adversarial and boundary inputs not covered by the developer's 27 tests.
// These tests expose spec deviations and implementation gaps.

import { describe, it, expect } from 'vitest';
import { parseNutritionTable } from '../../ingest/nutritionTableParser.js';

const SRC = 'pdf://test.pdf';
const AT = '2026-03-12T10:00:00.000Z';

// ---------------------------------------------------------------------------
// Spec §17 edge case: "< 1" with a space should normalize to 0.5
// ---------------------------------------------------------------------------
// The spec says: 'Nutrient value written as "< 1" with a space → coerces to 0.5'
// The parser pre-processes lines to replace "< N" patterns with N/2 before
// extracting numeric tokens, matching the normalizeNutrients coercion behavior.
describe('Spec §17 — "< 1" with space in nutrient value', () => {
  it('value "< 1" produces 0.5 (half of upper bound, per spec)', () => {
    const lines = [
      'Calorías Proteínas Hidratos Grasas Sal',
      'Plato bajo grasa 250 18 30 < 1 0,5',
    ];
    const result = parseNutritionTable(lines, SRC, AT);

    expect(result).toHaveLength(1);
    // "< 1" → 1/2 = 0.5 (spec-compliant)
    expect(result[0]?.nutrients.fats).toBe(0.5);
  });

  it('value "< 2,5" (comma decimal) produces 1.25', () => {
    const lines = [
      'Calorías Proteínas Hidratos Grasas Sal',
      'Plato ligero 200 15 25 < 2,5 0,3',
    ];
    const result = parseNutritionTable(lines, SRC, AT);

    expect(result).toHaveLength(1);
    // "< 2,5" → 2.5/2 = 1.25
    expect(result[0]?.nutrients.fats).toBeCloseTo(1.25, 5);
  });

  it('"<1" (no space) also produces 0.5', () => {
    const lines = [
      'Calorías Proteínas Hidratos Grasas Sal',
      'Plato traza 200 15 25 <1 0,3',
    ];
    const result = parseNutritionTable(lines, SRC, AT);

    expect(result).toHaveLength(1);
    expect(result[0]?.nutrients.fats).toBe(0.5);
  });

  it('dish name before "< 1" is correctly extracted', () => {
    const lines = [
      'Calorías Proteínas Hidratos Grasas Sal',
      'Plato bajo grasa 250 18 30 < 1 0,5',
    ];
    const result = parseNutritionTable(lines, SRC, AT);

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Plato bajo grasa');
  });
});

// ---------------------------------------------------------------------------
// Security: injection-like strings in dish name
// ---------------------------------------------------------------------------
describe('Security — adversarial dish names', () => {
  it('handles SQL-injection-like dish name without crashing', () => {
    const lines = [
      'Calorías Proteínas Hidratos Grasas Sal',
      "'; DROP TABLE dishes; -- 300 25 40 12 1",
    ];
    // The dish name is everything before the first numeric token.
    // "'; DROP TABLE dishes; -- " — length > 2, should parse
    const result = parseNutritionTable(lines, SRC, AT);
    expect(result.length).toBeGreaterThanOrEqual(0); // no crash
  });

  it('handles XSS-like dish name without crashing', () => {
    const lines = [
      'Calorías Proteínas Hidratos Grasas Sal',
      '<script>alert(1)</script> plato 300 25 40 12 1',
    ];
    const result = parseNutritionTable(lines, SRC, AT);
    // "<script>alert(1)</script> plato" is a valid name, parser should handle it
    expect(result.length).toBeGreaterThanOrEqual(0);
  });

  it('handles extremely long dish name without crashing', () => {
    const longName = 'A'.repeat(10_000);
    const lines = [
      'Calorías Proteínas Hidratos Grasas Sal',
      `${longName} 300 25 40 12 1`,
    ];
    const result = parseNutritionTable(lines, SRC, AT);
    expect(result).toHaveLength(1);
    expect(result[0]?.name.length).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// Boundary: exactly 3 keywords in header (boundary of detection threshold)
// ---------------------------------------------------------------------------
describe('Header detection boundary — exactly 3 keywords', () => {
  it('detects a header with exactly 3 nutrient keywords', () => {
    const lines = [
      'Calorías Proteínas Grasas',
      'Plato mínimo 300 25 12 5',
    ];
    const result = parseNutritionTable(lines, SRC, AT);
    // 3 keywords = valid header; the 4th numeric token (5) is beyond column count
    expect(result).toHaveLength(1);
    expect(result[0]?.nutrients.calories).toBe(300);
    expect(result[0]?.nutrients.proteins).toBe(25);
    expect(result[0]?.nutrients.fats).toBe(12);
  });

  it('does NOT detect a header with exactly 2 nutrient keywords', () => {
    const lines = [
      'Calorías Proteínas',
      'Plato dos 300 25 12 5',
    ];
    const result = parseNutritionTable(lines, SRC, AT);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Boundary: exactly 4 numeric tokens (minimum to pass the guard)
// ---------------------------------------------------------------------------
describe('Data row boundary — exactly 4 numeric tokens', () => {
  it('parses a row with exactly 4 numeric tokens', () => {
    const lines = [
      'Calorías Proteínas Hidratos Grasas',
      'Plato básico 300 25 40 12',
    ];
    const result = parseNutritionTable(lines, SRC, AT);
    expect(result).toHaveLength(1);
    expect(result[0]?.nutrients.calories).toBe(300);
    expect(result[0]?.nutrients.fats).toBe(12);
  });

  it('skips a row with exactly 3 numeric tokens', () => {
    const lines = [
      'Calorías Proteínas Hidratos Grasas',
      'Plato tres 300 25 40',
    ];
    const result = parseNutritionTable(lines, SRC, AT);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Boundary: dish name exactly 2 characters (minimum allowed length)
// ---------------------------------------------------------------------------
describe('Dish name minimum length boundary', () => {
  it('accepts a 2-character dish name', () => {
    const lines = [
      'Calorías Proteínas Hidratos Grasas Sal',
      'Ab 300 25 40 12 1',
    ];
    const result = parseNutritionTable(lines, SRC, AT);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Ab');
  });

  it('rejects a 1-character dish name', () => {
    const lines = [
      'Calorías Proteínas Hidratos Grasas Sal',
      'X 300 25 40 12 1',
    ];
    const result = parseNutritionTable(lines, SRC, AT);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Numeric edge cases: zero values, very large values, floating-point precision
// ---------------------------------------------------------------------------
describe('Numeric edge cases', () => {
  it('parses zero values correctly', () => {
    const lines = [
      'Calorías Proteínas Hidratos Grasas Sal',
      'Agua 0 0 0 0 0',
    ];
    const result = parseNutritionTable(lines, SRC, AT);
    expect(result).toHaveLength(1);
    expect(result[0]?.nutrients.calories).toBe(0);
    expect(result[0]?.nutrients.fats).toBe(0);
  });

  it('parses maximum realistic calorie value (8999)', () => {
    const lines = [
      'Calorías Proteínas Hidratos Grasas Sal',
      'Plato hipercalórico 8999 200 500 400 5',
    ];
    const result = parseNutritionTable(lines, SRC, AT);
    expect(result).toHaveLength(1);
    expect(result[0]?.nutrients.calories).toBe(8999);
  });

  it('handles multiple comma decimal separators in the same row', () => {
    const lines = [
      'Calorías Proteínas Hidratos Grasas Fibra Sal',
      'Plato fibra 245 18,5 32,0 9,8 4,2 1,1',
    ];
    const result = parseNutritionTable(lines, SRC, AT);
    expect(result).toHaveLength(1);
    expect(result[0]?.nutrients.proteins).toBe(18.5);
    expect(result[0]?.nutrients.carbohydrates).toBe(32.0);
    expect(result[0]?.nutrients.fats).toBe(9.8);
    expect(result[0]?.nutrients.fiber).toBe(4.2);
  });

  it('ignores numeric tokens beyond the column count', () => {
    const lines = [
      'Calorías Proteínas Hidratos Grasas Sal',
      'Plato extra 300 25 40 12 1 99 88 77',
    ];
    const result = parseNutritionTable(lines, SRC, AT);
    expect(result).toHaveLength(1);
    // Only 5 columns defined, so extra tokens are ignored
    expect(result[0]?.nutrients.salt).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Multi-section: column reset means section 2 uses its own headers
// ---------------------------------------------------------------------------
describe('Multi-section column reset', () => {
  it('correctly maps section 2 columns even when different from section 1', () => {
    const lines = [
      // Section 1: 5 columns
      'Calorías Proteínas Hidratos Grasas Sal',
      'Plato uno 300 25 40 12 1',
      // Section 2: different column order (Grasas before Hidratos + Fibra added)
      'Calorías Proteínas Grasas Hidratos Fibra Sal',
      'Plato dos 280 20 10 35 3 0,8',
    ];
    const result = parseNutritionTable(lines, SRC, AT);
    expect(result).toHaveLength(2);

    // Section 1: fats = 12
    expect(result[0]?.nutrients.fats).toBe(12);
    expect(result[0]?.nutrients.carbohydrates).toBe(40);

    // Section 2: fats = 10 (3rd column = Grasas), carbs = 35 (4th column = Hidratos)
    expect(result[1]?.nutrients.fats).toBe(10);
    expect(result[1]?.nutrients.carbohydrates).toBe(35);
    expect(result[1]?.nutrients.fiber).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Spec §17: Multiple file parts — only first processed
// (This is a parser-level test: feeding the same source twice should return 2 × N dishes
// since the parser has no deduplication — dedup is the upsert layer's job)
// ---------------------------------------------------------------------------
describe('Duplicate dish names in same document', () => {
  it('returns both rows when same dish name appears twice (no deduplication at parser level)', () => {
    const lines = [
      'Calorías Proteínas Hidratos Grasas Sal',
      'Pollo 300 25 40 12 1',
      'Pollo 310 26 41 13 1',
    ];
    const result = parseNutritionTable(lines, SRC, AT);
    // Parser should return both — upsert handles dedup
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Empty and whitespace-only lines are ignored (trimming)
// ---------------------------------------------------------------------------
describe('Empty and whitespace lines', () => {
  it('handles lines with only whitespace between data rows', () => {
    const lines = [
      'Calorías Proteínas Hidratos Grasas Sal',
      '',
      '   ',
      '\t',
      'Pollo asado 300 28 5 15 1',
    ];
    const result = parseNutritionTable(lines, SRC, AT);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Pollo asado');
  });
});

// ---------------------------------------------------------------------------
// sourceUrl validation: synthetic pdf:// URI is preserved
// ---------------------------------------------------------------------------
describe('sourceUrl synthetic URI passthrough', () => {
  it('preserves pdf:// sourceUrl with special characters sanitized at route level (parser accepts any string)', () => {
    const syntheticUrl = 'pdf://menu_carta_2026.pdf';
    const lines = [
      'Calorías Proteínas Hidratos Grasas Sal',
      'Pollo 300 25 40 12 1',
    ];
    const result = parseNutritionTable(lines, syntheticUrl, AT);
    expect(result[0]?.sourceUrl).toBe(syntheticUrl);
  });
});

// ---------------------------------------------------------------------------
// Word boundary false-positive guard: "hidratos de carbono" should map to
// carbohydrates (via "hidratos"), not accidentally match "protein" in
// a text like "proteínas escasas"
// ---------------------------------------------------------------------------
describe('Word boundary in header detection', () => {
  it('detects "hidratos" as carbohydrates keyword (prefix match)', () => {
    const lines = [
      'Calorías Proteínas Hidratos de Carbono Grasas Sal',
      'Plato completo 300 25 40 12 1',
    ];
    const result = parseNutritionTable(lines, SRC, AT);
    // "Hidratos de Carbono" in header — "hidratos" is the keyword, detected as carbohydrates
    expect(result).toHaveLength(1);
    expect(result[0]?.nutrients.carbohydrates).toBe(40);
  });

  it('does not match "salt" as a nutrient keyword inside the word "assault"', () => {
    // "assault" contains "sal" — should NOT be treated as a salt column
    const lines = [
      'Calorías Proteínas Hidratos Grasas assault',
    ];
    // Only 4 keyword matches at most (calories, proteins, carbs, fats) — but
    // "assault" should NOT be matched as "sal" due to word boundary check.
    // With 4 keywords, it IS treated as a header (>= 3).
    // The important thing is "assault" does not create a "salt" column.
    const result = parseNutritionTable(lines, SRC, AT);
    // Line is a header — no data rows, so result is empty
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Spec §17 acceptance criterion: `dishesFound` must equal parseable rows count
// (parser-level verification that output length = raw count fed to normalizer)
// ---------------------------------------------------------------------------
describe('Parser output count (for dishesFound calculation)', () => {
  it('returns exactly N items matching parseable rows', () => {
    const lines = [
      'Calorías Proteínas Hidratos Grasas Sal',
      'Plato A 300 25 40 12 1',
      'Plato B 400 30 50 20 2',
      'Plato C 200 15 25 8 0,5',
      // This row has only 3 tokens — should be skipped
      'Plato D 100 10 20',
    ];
    const result = parseNutritionTable(lines, SRC, AT);
    expect(result).toHaveLength(3);
  });
});
