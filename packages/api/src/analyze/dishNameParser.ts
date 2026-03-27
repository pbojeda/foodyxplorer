// dishNameParser — extracts dish name candidates from raw text lines (F034).
//
// parseDishNames(lines: string[]): string[]
//
// Filters out lines that are:
//   - Empty or whitespace-only
//   - Shorter than 3 characters
//   - Purely numeric (integers or decimals)
//   - Price-like (digits + optional separator + optional euro sign)
//   - Allergen short-codes (all-caps, ≤ 3 chars)
//   - Consist only of punctuation or symbols (no letter or digit)
//
// Returns remaining lines as dish name candidates. No deduplication.

// ---------------------------------------------------------------------------
// Regexes (compiled once at module load)
// ---------------------------------------------------------------------------

/** Matches lines with only whitespace. */
const WHITESPACE_ONLY = /^\s*$/;

/** Matches lines that are purely numeric (int or decimal with comma or dot). */
const PURELY_NUMERIC = /^\d+([,.\s]\d+)*$/;

/** Matches price-like patterns: digits with optional thousands separator, optional decimal, optional €. */
const PRICE_LIKE = /^\d[\d\s,.]*€?\s*$|^\d[\d\s,.]*\s*€$/;

/** Matches lines with only punctuation and symbols — no letters or digits. */
const PUNCTUATION_ONLY = /^[^\p{L}\d]+$/u;

// ---------------------------------------------------------------------------
// parseDishNames
// ---------------------------------------------------------------------------

/**
 * Filters a list of text lines to extract dish name candidates.
 *
 * @param lines - Raw text lines from OCR or Vision API output.
 * @returns Filtered array of dish name candidate strings. No deduplication.
 */
export function parseDishNames(lines: string[]): string[] {
  return lines.filter((line) => {
    // Rule 1: skip whitespace-only
    if (WHITESPACE_ONLY.test(line)) return false;

    // Rule 2: skip lines shorter than 3 characters
    if (line.length < 3) return false;

    // Rule 3: skip all-caps strings of 3 chars or fewer (allergen codes: GLU, LAC, SOY, etc.)
    // A single word that is all uppercase and at most 3 chars is likely an allergen code.
    const trimmed = line.trim();
    if (trimmed.length <= 3 && trimmed === trimmed.toUpperCase() && /^[A-Z]+$/.test(trimmed)) {
      return false;
    }

    // Rule 4: skip punctuation/symbol-only lines (no letters or digits)
    if (PUNCTUATION_ONLY.test(line)) return false;

    // Rule 5: skip purely numeric lines (integers and decimals)
    if (PURELY_NUMERIC.test(line.trim())) return false;

    // Rule 6: skip price-like lines (€ or number patterns like "12.50", "5,90€", "10 €")
    if (PRICE_LIKE.test(line.trim())) return false;

    return true;
  });
}
