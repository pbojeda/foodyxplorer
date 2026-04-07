// F087 — Extract "tupper" / portion count from recipe text.
//
// Detects Spanish patterns like "dividir en 5 tuppers", "para 3 porciones",
// "repartir en 4 raciones", etc. Returns the portion count and the cleaned text
// (with the portion phrase stripped).

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const PORTION_PATTERNS: RegExp[] = [
  // "dividir en N tuppers/porciones/raciones/partes"
  /(?:dividir|repartir)\s+en\s+(\d+)\s+(?:tuppers?|porciones?|raciones?|partes?)/i,
  // "para N tuppers/porciones/raciones"
  /para\s+(\d+)\s+(?:tuppers?|porciones?|raciones?)/i,
  // "N tuppers/porciones" (standalone at end)
  /(\d+)\s+(?:tuppers?|porciones?|raciones?)\s*$/i,
];

const MAX_PORTIONS = 50;

// ---------------------------------------------------------------------------
// Exported
// ---------------------------------------------------------------------------

export interface ExtractPortionsResult {
  portions?: number;
  cleanedText: string;
}

export function extractPortions(text: string): ExtractPortionsResult {
  for (const pattern of PORTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const n = parseInt(match[1] ?? '', 10);
      if (n < 1 || isNaN(n)) {
        // Invalid portion count — ignore the match
        return { cleanedText: text };
      }
      const portions = Math.min(n, MAX_PORTIONS);
      const cleanedText = text.replace(match[0], '').replace(/\s{2,}/g, ' ').trim();
      return { portions, cleanedText };
    }
  }
  return { cleanedText: text };
}
