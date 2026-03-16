// Chain-specific text preprocessor for PDF-extracted text.
//
// Real-world PDF nutrition tables have layouts that the generic
// parseNutritionTable parser cannot handle directly:
//   - Multi-line headers (BK, Telepizza): column headers span multiple lines
//   - Paired 100g/portion columns (KFC): 14 values per row, interleaved
//   - kJ/kcal dual energy columns (BK, Telepizza): extra numeric column
//
// This preprocessor normalizes extracted text BEFORE passing it to
// parseNutritionTable. The generic parser remains unchanged.
// See ADR-007 for rationale.

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalizes chain-specific PDF text into a format that parseNutritionTable
 * can handle. For unknown chains, returns lines unchanged.
 *
 * @param chainSlug - Chain identifier from CHAIN_PDF_REGISTRY
 * @param lines     - Raw text lines from extractText(buffer).join('\n').split('\n')
 * @returns Preprocessed lines ready for parseNutritionTable
 */
export function preprocessChainText(chainSlug: string, lines: string[]): string[] {
  switch (chainSlug) {
    case 'burger-king-es':
      return preprocessBurgerKingEs(lines);
    case 'kfc-es':
      return preprocessKfcEs(lines);
    case 'telepizza-es':
      return preprocessTelepizzaEs(lines);
    default:
      return lines;
  }
}

// ---------------------------------------------------------------------------
// Burger King Spain
// ---------------------------------------------------------------------------
//
// PDF layout:
//   Lines 1-25: Multi-line header (one column per line):
//     "Peso (g)", "Valor", "Energético (KJ)", "Valor", "Energético (Kcal.)",
//     "Grasas (g)", "Grasas", "saturadas (g)", "Hidratos de Carbono (g)", ...
//   Lines 26+: Category headers ("Hamburguesas / Hamburgers") + data rows
//
// Data row format (11 values, tab-separated):
//   Name \t Weight \t kJ \t kcal \t Fat \t SatFat \t Carbs \t Sugars \t Fiber \t Protein \t Salt \t Sodium
//
// Preprocessing:
//   1. Skip the multi-line header section (lines before first category/data)
//   2. Inject synthetic single-line header
//   3. For each data row, remove first 2 numeric values (weight + kJ)

function preprocessBurgerKingEs(lines: string[]): string[] {
  const result: string[] = [];
  // Synthetic header with 9 columns: kcal, fat, satfat, carbs, sugars, fiber, protein, salt, sodium
  const syntheticHeader = 'Calorías\tGrasas\tSaturadas\tHidratos\tAzúcares\tFibra\tProteínas\tSal\tSodio';

  let headerInjected = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect data rows: contain tab + digit pattern (name followed by numeric values)
    const isDataRow = /\t\d/.test(trimmed);

    if (isDataRow) {
      if (!headerInjected) {
        result.push(syntheticHeader);
        headerInjected = true;
      }

      // Strip first 2 numeric groups (weight + kJ) from the data row.
      // Data format: "Name\tWeight\tkJ\tkcal\t..."
      // We want:     "Name\tkcal\t..."
      const stripped = stripFirstNValues(trimmed, 2);
      if (stripped !== null) {
        result.push(stripped);
      }
    } else {
      // Category headers and non-data lines pass through unchanged.
      // If we hit a new section label after data, re-inject the synthetic header.
      // This handles multi-section PDFs (Hamburguesas, Pollo, etc.)
      if (headerInjected && !isNumericLine(trimmed)) {
        // Category label — pass through, parser will skip it (no keywords, no numbers)
        result.push(trimmed);
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// KFC Spain
// ---------------------------------------------------------------------------
//
// PDF layout:
//   Line 1: "100g Porción 100g Porción ..." (sub-header, 7 pairs)
//   Lines 2+: Data rows with 14 values (7 nutrients × per-100g + per-portion, interleaved)
//   Line ~106: "ENERGÍA(KCAL) PROTEINAS(G) GRASAS(G) HIDRATOS" (partial header)
//   Line ~107: "CARBONO(G) SAL(G)"
//   Line ~110: Page 2 data
//
// Data row format (14 values, space-separated):
//   Name val1_100g val1_portion val2_100g val2_portion ... val7_100g val7_portion
//
// Column order (per 100g): Energy(kcal), Proteins, Fats, Saturated, Carbs, Sugars, Salt
//
// Preprocessing:
//   1. Skip sub-header lines and info lines
//   2. Inject synthetic single-line header before data
//   3. For each data row, keep only per-100g values (odd-indexed: 0, 2, 4, ...)

function preprocessKfcEs(lines: string[]): string[] {
  const result: string[] = [];
  // 7 columns: energy, proteins, fats, saturated, carbs, sugars, salt
  const syntheticHeader = 'Calorías Proteínas Grasas Saturadas Hidratos Azúcares Sal';

  let headerInjected = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip known non-data lines
    if (isKfcMetaLine(trimmed)) continue;

    // Detect data rows: line with a name followed by decimal numbers (space-separated).
    // KFC uses dot decimals (240.00) and space separators. Some values use <0,1 notation.
    // Dish names may contain integers (e.g. "9 tiras", "12 Alitas"), so we look for
    // the first decimal number (N.N) as the name/data boundary.
    const firstDecimalMatch = trimmed.match(/\d+\.\d+/);
    if (firstDecimalMatch === null || firstDecimalMatch.index === undefined) continue;

    // Name = text before the first decimal number
    const nameEndIdx = firstDecimalMatch.index;
    const name = trimmed.slice(0, nameEndIdx).trim();
    if (name.length < 2) continue;

    // Extract ALL numeric-like tokens from the data portion (after the name).
    // Includes: "240.00", "0.002", and also "<0,1" patterns.
    // We normalize <N,N to its half-value and commas to dots.
    const dataPortion = trimmed.slice(nameEndIdx);
    const allTokens = extractKfcNumericTokens(dataPortion);

    // Need at least 10 paired values (5 nutrients × 2)
    if (allTokens.length < 10) continue;

    if (!headerInjected) {
      result.push(syntheticHeader);
      headerInjected = true;
    }

    // Keep only per-100g values (even indices: 0, 2, 4, ...)
    const per100gValues = allTokens.filter((_, i) => i % 2 === 0);

    // Remove standalone digits from the name to prevent parseDataRow from
    // treating them as the first numeric token. KFC names like "9 tiras"
    // or "12 Alitas" contain quantity integers that would break column mapping.
    // We preserve text descriptors (CR, OR, Mixtas) for uniqueness.
    const cleanName = name
      .replace(/\b\d+\b/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\(\s*\)/g, '')
      .replace(/\(\s+/g, '(')
      .trim();
    if (cleanName.length < 2) continue;

    result.push(`${cleanName} ${per100gValues.join(' ')}`);

  }

  return result;
}

// ---------------------------------------------------------------------------
// Telepizza Spain
// ---------------------------------------------------------------------------
//
// PDF layout:
//   Line 1: "Valores nutricionales por 100 g"
//   Line 2: "PIZZAS - ESPECIALIDADES" (category)
//   Lines 3+: Data rows (tab-separated)
//   Lines ~62-70: Multi-line header (repeated on page 2)
//
// Data row format (8 values, first pair is kJ/kcal):
//   Name \t kJ / kcal \t Fat \t SatFat \t Carbs \t Sugars \t Protein \t Salt
//   Example: "4 quesos \t 942 / 224 \t 7,9 \t 4,9 \t 25,5 \t 1,4 \t 12,0 \t 1,4"
//
// Column order (after removing kJ): kcal, fat, satfat, carbs, sugars, protein, salt
//
// Preprocessing:
//   1. Skip multi-line header and meta lines
//   2. Inject synthetic header
//   3. For each data row, remove the kJ value (first number before "/")

function preprocessTelepizzaEs(lines: string[]): string[] {
  const result: string[] = [];
  // 7 columns: kcal, fat, satfat, carbs, sugars, protein, salt
  const syntheticHeader = 'Calorías\tGrasas\tSaturadas\tHidratos\tAzúcares\tProteínas\tSal';

  let headerInjected = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip meta/header lines
    if (isTelepizzaMetaLine(trimmed)) continue;

    // Detect data rows: contain "kJ / kcal" pattern or tab-separated numbers
    // Telepizza format: "Name \t kJ / kcal \t ..."
    const hasKjKcalPattern = /\d+\s*\/\s*\d+/.test(trimmed);
    const numericCount = (trimmed.match(/\d+(?:[.,]\d+)?/g) ?? []).length;

    if (hasKjKcalPattern && numericCount >= 7) {
      if (!headerInjected) {
        result.push(syntheticHeader);
        headerInjected = true;
      }

      // Remove the kJ value: "Name \t 942 / 224 \t ..." → "Name \t 224 \t ..."
      const processed = trimmed.replace(/(\t)\s*\d+(?:[.,]\d+)?\s*\/\s*/, '$1');
      result.push(processed);
    } else if (numericCount === 0 && trimmed.length > 1) {
      // Category label (e.g. "PIZZAS - ESPECIALIDADES") — pass through
      result.push(trimmed);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Strips the first N numeric values from a tab-separated data row.
 * Returns null if the row doesn't have enough values.
 */
function stripFirstNValues(line: string, n: number): string | null {
  // Split on tabs
  const parts = line.split('\t');
  if (parts.length < n + 2) return null; // need at least name + n values + 1 remaining

  // First part is the dish name (may contain spaces but not tabs)
  const name = parts[0];

  // Remove first n numeric parts after the name
  const remaining = parts.slice(1 + n);
  if (remaining.length < 4) return null; // need at least 4 remaining values

  return `${name}\t${remaining.join('\t')}`;
}

/**
 * Extracts numeric tokens from a KFC data portion string.
 * Handles: "240.00", "0.002", "<0,1" (normalized to half-value with dot decimal).
 */
function extractKfcNumericTokens(dataPortion: string): string[] {
  const tokens: string[] = [];
  // Match: standard decimals (240.00) or <N,N patterns
  const regex = /(?:<\s*(\d+[.,]\d+))|(\d+(?:\.\d+)?)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(dataPortion)) !== null) {
    if (match[1] !== undefined) {
      // <N,N pattern — normalize: replace comma with dot, halve the value
      const val = parseFloat(match[1].replace(',', '.'));
      tokens.push(String(val / 2));
    } else if (match[2] !== undefined) {
      tokens.push(match[2]);
    }
  }

  return tokens;
}

/** Returns true if the line contains only numeric content (no text name). */
function isNumericLine(line: string): boolean {
  return /^\d/.test(line.trim());
}

/** Returns true if this line is a KFC meta/header line that should be skipped. */
function isKfcMetaLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    lower.startsWith('100g') ||
    lower.includes('contenido nutricional') ||
    lower.includes('contenido determinado') ||
    lower.includes('última actualización') ||
    lower.includes('de las cuales') ||
    lower.includes('sólo en restaurantes') ||
    lower.includes('energía(kcal)') ||
    lower.includes('carbono(g)') ||
    lower.includes('---page break---')
  );
}

/** Returns true if this line is a Telepizza meta/header line that should be skipped. */
function isTelepizzaMetaLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    lower.startsWith('valores nutricionales') ||
    lower.startsWith('información') ||
    lower.startsWith('nutricional') ||
    lower.includes('proteínas (g)') && lower.includes('sal (g)') ||
    lower.startsWith('energía') ||
    lower.startsWith('(kj') ||
    lower.startsWith('grasas (g) -') ||
    lower.startsWith('saturadas') ||
    lower.startsWith('hidratos de') ||
    lower.startsWith('carbono') ||
    lower.startsWith('- de los cuales') ||
    lower.startsWith('- de las cuales') ||
    lower.startsWith('azúcares') ||
    lower.includes('kj/kcal') && lower.includes('grasa') ||
    lower.includes('---page break---') ||
    /^\d+$/.test(line.trim()) // page numbers
  );
}
