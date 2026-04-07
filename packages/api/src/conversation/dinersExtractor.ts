// F089 — Extract "para N personas" diners count from text.
//
// Detects Spanish patterns like "para 3 personas", "entre 4",
// "para 2 comensales", etc. Returns the diners count and the cleaned text
// (with the diners phrase stripped).

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const DINERS_PATTERNS: RegExp[] = [
  // "para N personas/comensales/gente"
  /para\s+(\d+)\s+(?:personas?|comensales?|gente)/i,
  // "entre N personas/comensales"
  /entre\s+(\d+)\s+(?:personas?|comensales?)/i,
  // "compartir entre N" / "para compartir entre N"
  /(?:para\s+)?compartir\s+entre\s+(\d+)/i,
  // "N personas" at end
  /(\d+)\s+(?:personas?|comensales?)\s*$/i,
];

const MAX_DINERS = 20;

// ---------------------------------------------------------------------------
// Exported
// ---------------------------------------------------------------------------

export interface ExtractDinersResult {
  diners?: number;
  cleanedText: string;
}

export function extractDiners(text: string): ExtractDinersResult {
  for (const pattern of DINERS_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const n = parseInt(match[1] ?? '', 10);
      if (n < 1 || isNaN(n)) {
        return { cleanedText: text };
      }
      const diners = Math.min(n, MAX_DINERS);
      const cleanedText = text.replace(match[0], '').replace(/\s{2,}/g, ' ').trim();
      return { diners, cleanedText };
    }
  }
  return { cleanedText: text };
}
