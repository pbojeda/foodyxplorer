// Heuristic nutritional table parser.
//
// Detects structured nutritional tables in extracted PDF text by scanning
// for lines containing 3+ nutrient keywords (Spanish + English). Maps
// column positions from header keyword order and parses subsequent data rows.
//
// parseNutritionTable(lines, sourceUrl, scrapedAt): RawDishData[]

import type { RawDishData } from '@foodxplorer/scraper';

// ---------------------------------------------------------------------------
// Keyword map — case-insensitive matching
// ---------------------------------------------------------------------------

type NutrientField = keyof RawDishData['nutrients'];

// Maps lowercase keyword (or prefix) → RawDishData nutrient field name.
// Keywords are checked in order; first match wins for each position in the line.
const KEYWORD_MAP: Array<{ keyword: string; field: NutrientField }> = [
  // calories / energy
  { keyword: 'calorías', field: 'calories' },
  { keyword: 'calorias', field: 'calories' },
  { keyword: 'energía', field: 'calories' },
  { keyword: 'energia', field: 'calories' },
  { keyword: 'calories', field: 'calories' },
  { keyword: 'energy', field: 'calories' },
  { keyword: 'kcal', field: 'calories' },
  // proteins
  { keyword: 'proteínas', field: 'proteins' },
  { keyword: 'proteinas', field: 'proteins' },
  { keyword: 'proteína', field: 'proteins' },
  { keyword: 'proteina', field: 'proteins' },
  { keyword: 'proteins', field: 'proteins' },
  { keyword: 'protein', field: 'proteins' },
  // carbohydrates
  { keyword: 'hidratos', field: 'carbohydrates' },
  { keyword: 'carbohidratos', field: 'carbohydrates' },
  { keyword: 'glúcidos', field: 'carbohydrates' },
  { keyword: 'glucidos', field: 'carbohydrates' },
  { keyword: 'carbohydrates', field: 'carbohydrates' },
  { keyword: 'carbs', field: 'carbohydrates' },
  // sugars — must come BEFORE fats to avoid "azúcares" being confused
  { keyword: 'azúcares', field: 'sugars' },
  { keyword: 'azucares', field: 'sugars' },
  { keyword: 'azúcar', field: 'sugars' },
  { keyword: 'azucar', field: 'sugars' },
  { keyword: 'sugars', field: 'sugars' },
  { keyword: 'sugar', field: 'sugars' },
  // saturated fats — must come BEFORE fats (more specific)
  { keyword: 'saturadas', field: 'saturatedFats' },
  { keyword: 'saturated', field: 'saturatedFats' },
  // monounsaturated — before generic fat keywords
  { keyword: 'monoinsaturadas', field: 'monounsaturatedFats' },
  { keyword: 'monounsaturated', field: 'monounsaturatedFats' },
  // polyunsaturated
  { keyword: 'poliinsaturadas', field: 'polyunsaturatedFats' },
  { keyword: 'polyunsaturated', field: 'polyunsaturatedFats' },
  // fats (generic — after more specific fat keywords)
  { keyword: 'grasas', field: 'fats' },
  { keyword: 'lípidos', field: 'fats' },
  { keyword: 'lipidos', field: 'fats' },
  { keyword: 'fats', field: 'fats' },
  { keyword: 'fat', field: 'fats' },
  // fiber
  { keyword: 'fibra', field: 'fiber' },
  { keyword: 'fiber', field: 'fiber' },
  { keyword: 'fibre', field: 'fiber' },
  // salt
  { keyword: 'sal', field: 'salt' },
  { keyword: 'salt', field: 'salt' },
  // sodium
  { keyword: 'sodio', field: 'sodium' },
  { keyword: 'sodium', field: 'sodium' },
  // trans fats
  { keyword: 'trans', field: 'transFats' },
  // cholesterol
  { keyword: 'colesterol', field: 'cholesterol' },
  { keyword: 'cholesterol', field: 'cholesterol' },
  // potassium
  { keyword: 'potasio', field: 'potassium' },
  { keyword: 'potassium', field: 'potassium' },
];

// ---------------------------------------------------------------------------
// detectHeaderColumns — scan a line for nutrient keyword positions
// ---------------------------------------------------------------------------

/**
 * Returns an ordered array of nutrient field names if the line contains
 * 3 or more distinct nutrient keywords. Returns null otherwise.
 *
 * Column order is determined by keyword position (left to right) in the line.
 */
function detectHeaderColumns(line: string): NutrientField[] | null {
  const lower = line.toLowerCase();

  // Find each keyword's first occurrence index in the line.
  // Use word-boundary-aware search by checking that the match is not
  // immediately preceded or followed by a letter.
  const found: Array<{ index: number; field: NutrientField }> = [];
  const usedFields = new Set<NutrientField>();

  for (const { keyword, field } of KEYWORD_MAP) {
    if (usedFields.has(field)) continue; // only first matching keyword per field

    const idx = lower.indexOf(keyword);
    if (idx === -1) continue;

    // Ensure it's a word boundary (not part of a longer word)
    const before = idx > 0 ? lower[idx - 1] : ' ';
    const after = lower[idx + keyword.length];
    const isBoundaryStart = !before || /[\s\-/|()]/.test(before);
    const isBoundaryEnd = after === undefined || /[\s\-/|()]/.test(after);

    if (isBoundaryStart && isBoundaryEnd) {
      found.push({ index: idx, field });
      usedFields.add(field);
    }
  }

  if (found.length < 3) return null;

  // Sort by position in line (left to right)
  found.sort((a, b) => a.index - b.index);

  return found.map((f) => f.field);
}

// ---------------------------------------------------------------------------
// parseDataRow — extract dish name and nutrient values from a data line
// ---------------------------------------------------------------------------

/**
 * Parses a data row given the detected column order.
 *
 * Returns null if:
 * - fewer than 4 numeric tokens found
 * - dish name (text before first numeric token) is shorter than 2 chars
 */
function parseDataRow(
  line: string,
  columns: NutrientField[],
): { name: string; nutrients: RawDishData['nutrients'] } | null {
  // Spec §17: "< N" (with optional space) → N/2, matching normalizeNutrients coercion.
  // Replace "< N" patterns with their half-value before extracting numeric tokens.
  // e.g. "< 1" → "0.5", "< 2,5" → "1.25"
  const normalizedLine = line.replace(/<\s*(\d+(?:[.,]\d+)?)/g, (_match, num) => {
    const n = parseFloat(num.replace(',', '.'));
    return String(n / 2);
  });

  const numericPattern = /\d+(?:[.,]\d+)?/g;
  const tokens: Array<{ value: number; index: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = numericPattern.exec(normalizedLine)) !== null) {
    const raw = match[0].replace(',', '.');
    tokens.push({ value: parseFloat(raw), index: match.index });
  }

  if (tokens.length < 4) return null;

  // Dish name = text before the first numeric token in the original line.
  // If there's a "< N" pattern, the name ends at the "<" (not the digit).
  const ltPatternInOriginal = /<\s*\d+(?:[.,]\d+)?/.exec(line);
  const firstNumericInOriginal = /\d+(?:[.,]\d+)?/.exec(line);
  if (firstNumericInOriginal === null) return null;

  const nameEndIdx =
    ltPatternInOriginal !== null && ltPatternInOriginal.index < firstNumericInOriginal.index
      ? ltPatternInOriginal.index
      : firstNumericInOriginal.index;

  const namePart = line.slice(0, nameEndIdx).trim().replace(/\s+/g, ' ');
  if (namePart.length < 2) return null;

  // Map token values to nutrient fields by position
  const nutrients: RawDishData['nutrients'] = {};
  for (let i = 0; i < tokens.length && i < columns.length; i++) {
    const field = columns[i];
    const token = tokens[i];
    if (field !== undefined && token !== undefined) {
      // Use type assertion to assign dynamic field
      (nutrients as Record<string, number>)[field] = token.value;
    }
  }

  return { name: namePart, nutrients };
}

// ---------------------------------------------------------------------------
// parseNutritionTable — main exported function
// ---------------------------------------------------------------------------

/**
 * Parses nutritional tables from extracted PDF text lines.
 *
 * Scans for header lines (3+ nutrient keywords), then parses subsequent
 * lines as data rows using column positions inferred from the header.
 * Supports multiple table sections in one document.
 *
 * @param lines - All text lines (pages concatenated and split on '\n')
 * @param sourceUrl - Synthetic URL for the source (e.g. 'pdf://filename.pdf')
 * @param scrapedAt - ISO datetime string set at request time
 */
export function parseNutritionTable(
  lines: string[],
  sourceUrl: string,
  scrapedAt: string,
): RawDishData[] {
  const results: RawDishData[] = [];
  let currentColumns: NutrientField[] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Try to detect a header line
    const headerColumns = detectHeaderColumns(trimmed);
    if (headerColumns !== null) {
      // New header found — reset column state (handles multi-section docs)
      currentColumns = headerColumns;
      continue;
    }

    // No header active — skip line
    if (currentColumns === null) continue;

    // Try to parse as a data row
    const row = parseDataRow(trimmed, currentColumns);
    if (row === null) continue;

    results.push({
      name: row.name,
      nutrients: row.nutrients,
      sourceUrl,
      scrapedAt,
      aliases: [],
      externalId: undefined,
      category: undefined,
    });
  }

  return results;
}
