// Chain-specific text preprocessor for PDF- and OCR-extracted text.
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
    case 'dominos-es':
      // Passthrough initially — return lines unchanged.
      // The OCR output from Domino's Spain images needs to be inspected
      // via a dryRun: true call before adding specific preprocessing.
      // If OCR produces parseable output (correct table headers + numeric rows),
      // no preprocessing is needed. If the output requires normalization
      // (e.g., OCR artifacts, multi-column layout), implement preprocessDominosEs
      // here following the existing preprocessor pattern.
      // See F012 Phase 7 (Step 18) for the manual dry-run inspection workflow.
      return lines;
    case 'subway-es':
      // Passthrough — the Subway Spain PDF uses English with a standard EU table
      // format (kcal, fat, saturates, carbs, sugars, fibre, protein, salt per
      // serving and per 100g). The generic parseNutritionTable handles this
      // format without preprocessing. If a dry-run reveals layout issues,
      // implement preprocessSubwayEs following the existing preprocessor pattern.
      return lines;
    case 'pans-and-company-es':
      return preprocessPansAndCompanyEs(lines);
    case 'five-guys-es':
      return preprocessFiveGuysEs(lines);
    case 'popeyes-es':
      return preprocessPopeyesEs(lines);
    case 'papa-johns-es':
      return preprocessPapaJohnsEs(lines);
    case 'pizza-hut-es':
      return preprocessPizzaHutEs(lines);
    case 'starbucks-es':
      return preprocessStarbucksEs(lines);
    case 'tim-hortons-es':
      return preprocessTimHortonsEs(lines);
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
// Pans & Company Spain
// ---------------------------------------------------------------------------
//
// PDF layout (Ibersol/Vivabem nutritional PDF, Portuguese text):
//   Pages 1,2,4,5: Column-based layout. pdf-parse extracts:
//     - Meta/header lines (date, page number, nutrient column labels)
//     - Alternating "Por Unidade Consumo \t values" (skip) and
//       "Por 100 gramas \t values" (collect) rows
//     - Product names (and ALL-CAPS category headers to skip) at end
//   Page 3: Mixed layout with inline items:
//     "ProductName \t Por 100 gramas \t kJ \t kcal \t ..." (single row)
//     Plus some separated name/data pairs (salads, soups)
//
// Data format for "Por 100 gramas" rows (tab-separated, 8 columns after label):
//   kJ \t kcal \t fat \t satfat \t carbs \t sugars \t protein \t salt
// After removing kJ → 7 values: kcal, fat, satfat, carbs, sugars, protein, salt
//
// Preprocessing:
//   1. Classify each line: inline item, per-100g data row, product name, or skip
//   2. Collect per-100g rows and product names, pair them 1:1
//   3. For inline items, extract name + data directly
//   4. Inject synthetic header; emit merged lines

function preprocessPansAndCompanyEs(lines: string[]): string[] {
  const syntheticHeader = 'Calorías\tGrasas\tSaturadas\tHidratos\tAzúcares\tProteínas\tSal';

  const per100gRows: string[] = [];   // raw data portions (after "Por 100 gramas\t")
  const productNames: string[] = [];  // product names in order
  const inlineItems: string[] = [];   // already-merged "Name\tkcal\t..." lines

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip meta and header lines
    if (isPansMetaLine(trimmed)) continue;

    // Skip ALL-CAPS category headers
    if (isAllCaps(trimmed)) continue;

    // Inline item: "ProductName \t Por 100 gramas \t kJ \t kcal \t ..."
    // NOTE: PDF extraction may insert spaces around tabs.
    const inlineMatch = trimmed.match(/^(.+?)\s*\tPor 100 gramas\s*\t(.+)$/);
    if (inlineMatch !== null) {
      const name = (inlineMatch[1] ?? '').trim();
      const dataPart = (inlineMatch[2] ?? '').trim();
      const merged = mergePansData(name, dataPart);
      if (merged !== null) {
        inlineItems.push(merged);
      }
      continue;
    }

    // Per-100g data row: "Por 100 gramas \t values"
    // Allow optional spaces around the tab separator.
    const per100gMatch = trimmed.match(/^Por 100 gramas\s*\t(.+)$/);
    if (per100gMatch !== null) {
      const dataPart = (per100gMatch[1] ?? '').trim();
      if (dataPart.length > 0) {
        per100gRows.push(dataPart);
      }
      continue;
    }
    if (trimmed === 'Por 100 gramas') continue;

    // Per-unit or serving label rows (skip — no data needed)
    if (isPansDataSkipLine(trimmed)) continue;

    // Remaining non-empty lines are product names (length >= 2)
    if (trimmed.length >= 2) {
      productNames.push(trimmed);
    }
  }

  // Pair product names with per-100g rows (1:1 in order)
  const pairedLines: string[] = [];
  const pairCount = Math.min(per100gRows.length, productNames.length);
  if (per100gRows.length !== productNames.length) {
    console.warn(
      `[pans-and-company-es] Pairing mismatch: ${per100gRows.length} data rows vs ${productNames.length} names. ` +
      `Using ${pairCount}. Check PDF layout for changes.`,
    );
  }
  for (let i = 0; i < pairCount; i++) {
    const name = productNames[i] ?? '';
    const dataPart = per100gRows[i] ?? '';
    const merged = mergePansData(name, dataPart);
    if (merged !== null) {
      pairedLines.push(merged);
    }
  }

  const allDishLines = [...inlineItems, ...pairedLines];
  if (allDishLines.length === 0) return [];

  return [syntheticHeader, ...allDishLines];
}

/**
 * Merges a Pans & Company product name with its per-100g data portion.
 * Data portion format: "kJ \t kcal \t fat \t satfat \t carbs \t sugars \t protein \t salt"
 * Strips kJ (first column) and returns: "Name \t kcal \t fat \t satfat \t carbs \t sugars \t protein \t salt"
 * Returns null if data has fewer than 7 values (insufficient to map).
 */
function mergePansData(name: string, dataPart: string): string | null {
  const values = dataPart.split('\t').map((v) => v.trim()).filter((v) => v.length > 0);
  // Need kJ + 7 nutrient values = 8 total
  if (values.length < 8) return null;
  // Strip kJ (index 0), keep kcal..salt (indices 1-7)
  const nutrientValues = values.slice(1, 8);
  return `${name}\t${nutrientValues.join('\t')}`;
}

/**
 * Returns true if ALL alphabetic characters in the string are uppercase.
 * Handles accented Portuguese/Spanish characters: Ã Â Á À É Ê Í Ó Ô Õ Ú Ü Ç Ñ.
 * A line with no alphabetic characters (e.g. a page number) returns false.
 */
function isAllCaps(line: string): boolean {
  // Extract all alphabetic characters (ASCII + accented Latin)
  const letters = line.match(/[a-zA-ZÀ-ÿ]/g);
  if (letters === null || letters.length === 0) return false;
  // Every letter must be uppercase
  return letters.every((ch) => ch === ch.toUpperCase());
}

/** Returns true if this line is a Pans & Company meta/header line to skip. */
function isPansMetaLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    lower.startsWith('data de impressão') ||
    lower.startsWith('página') ||            // "Página 1 de 5 \t PSA IC 001pac.49"
    lower.startsWith('psa ') ||              // standalone PSA reference lines
    // Nutrient column labels (with or without unit suffixes)
    lower.startsWith('energia') ||           // "Energia (Kj)", "Energia (kcal)"
    lower.startsWith('lípidos') ||           // "Lípidos (g)"
    lower.startsWith('…dos quais') ||        // sub-label for saturates/sugars
    lower.startsWith('saturados') ||         // "saturados (g)"
    lower.startsWith('hidratos de') ||       // "Hidratos de"
    lower.startsWith('carbono') ||           // "Carbono (g)"
    lower.startsWith('açucares') ||          // "açucares (g)"
    lower.startsWith('proteínas (g)') ||     // "Proteínas (g)" — exact to avoid food names
    lower === 'sal (g)' ||                   // "Sal (g)" — exact to avoid food names
    // Repeating page headers
    line === 'TABELA NUTRICIONAL' ||
    line === 'SANDES QUENTES' ||
    line === 'PÃO PROVENÇAL' ||
    line === 'Francesa' ||  // Bread type label repeated on every page in the PDF header area
    // Disclaimer lines
    lower.startsWith('notas:') ||
    lower.startsWith('esta informação') ||
    lower.startsWith('alguns restaurantes') ||
    lower.startsWith('locais de fornecimento') ||
    // Page break markers
    lower.includes('---page break---')
  );
}

/** Returns true for data rows that should be skipped (not product names, not per-100g). */
function isPansDataSkipLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    lower.startsWith('por unidade consumo') ||
    lower.startsWith('por unidade') ||
    lower.startsWith('por unid') ||       // abbreviated variant
    lower.startsWith('dose pequena') ||
    lower.startsWith('dose média') ||
    lower.startsWith('dose grande') ||
    lower.startsWith('dose ') ||          // any other dose variant
    // Numeric portion rows: "4 Unidades\t...", "12 unidades\t...", "9 unidades\t..."
    /^\d+\s+unidades?\b/i.test(line)
  );
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
    (lower.includes('proteínas (g)') && lower.includes('sal (g)')) ||
    lower.startsWith('energía') ||
    lower.startsWith('(kj') ||
    lower.startsWith('grasas (g) -') ||
    lower.startsWith('saturadas') ||
    lower.startsWith('hidratos de') ||
    lower.startsWith('carbono') ||
    lower.startsWith('- de los cuales') ||
    lower.startsWith('- de las cuales') ||
    lower.startsWith('azúcares') ||
    (lower.includes('kj/kcal') && lower.includes('grasa')) ||
    lower.includes('---page break---') ||
    /^\d+$/.test(line.trim()) // page numbers
  );
}

// ---------------------------------------------------------------------------
// Five Guys Spain
// ---------------------------------------------------------------------------
//
// PDF layout:
//   Multi-line header (one keyword per line):
//     "Energía, kJ", "Energía, kcal", "Grasas totales, g", "de las cuales",
//     "saturadas, g", "Carbohidratos, g", etc.
//   Category headers: "CARNE", "PANES", "PATATAS", etc.
//   Data rows (tab-separated):
//     Name \t kJ \t kcal \t fat \t satfat \t carbs \t sugars \t fiber \t protein \t salt
//
// Some names span multiple lines (e.g. "Pequeñas - Cocinadas en aceite\nde cacahuete")
//
// Preprocessing:
//   1. Skip multi-line header
//   2. Inject synthetic header
//   3. For each data row, strip kJ (first numeric value), keep kcal onwards

function preprocessFiveGuysEs(lines: string[]): string[] {
  const result: string[] = [];
  const syntheticHeader = 'Calorías\tGrasas\tSaturadas\tHidratos\tAzúcares\tFibra\tProteínas\tSal';

  let headerInjected = false;
  let pendingName: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip meta/header lines
    if (isFiveGuysMetaLine(trimmed)) continue;

    // Detect data rows: contain tab + digit pattern
    const isDataRow = /\t\d/.test(trimmed);

    if (isDataRow) {
      if (!headerInjected) {
        result.push(syntheticHeader);
        headerInjected = true;
      }

      // If there's a pending multi-line name, prepend it
      let fullLine = trimmed;
      if (pendingName !== null) {
        // Check if line starts with a name or just numbers
        const parts = fullLine.split('\t');
        const firstPart = (parts[0] ?? '').trim();
        if (firstPart.length > 0 && !/^\d/.test(firstPart)) {
          fullLine = `${pendingName} ${fullLine}`;
        } else {
          fullLine = `${pendingName}\t${parts.slice(0).join('\t')}`;
        }
        pendingName = null;
      }

      // Strip kJ (first numeric column after name)
      const stripped = stripFirstNValues(fullLine, 1);
      if (stripped !== null) {
        result.push(stripped);
      }
    } else {
      // Non-data line — could be a category header or a continuation name
      // Category headers are ALL CAPS
      if (isAllCaps(trimmed) && trimmed.length > 1) {
        // Category label — pass through
        result.push(trimmed);
        pendingName = null;
      } else if (trimmed.length >= 2 && !/^\d/.test(trimmed)) {
        // Could be first part of a multi-line dish name
        // (e.g. "Pequeñas - Cocinadas en aceite")
        pendingName = trimmed;
      }
    }
  }

  return result;
}

/** Returns true if this line is a Five Guys meta/header line to skip. */
function isFiveGuysMetaLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    lower.startsWith('información') ||
    lower.startsWith('nutricional') ||
    lower.startsWith('fgjv') ||
    lower.startsWith('energía') ||
    lower.startsWith('grasas totales') ||
    lower.startsWith('de las cuales') ||
    lower.startsWith('de los cuales') ||
    lower === 'saturadas, g' ||
    lower.startsWith('carbohidratos') ||
    lower === 'azúcares, g' ||
    lower === 'fibra, g' ||
    lower.startsWith('proteínas, g') ||
    lower === 'sal, g' ||
    lower.includes('---page break---')
  );
}

// ---------------------------------------------------------------------------
// Popeyes Spain
// ---------------------------------------------------------------------------
//
// PDF layout:
//   Multi-line header (one keyword per line, fragmented):
//     "Peso(g/m)", "Valor", "Energ", "ético", "(Kcal)", etc.
//   Category headers: "PIEZAS DE POLLO", "SANDWICHES", etc.
//   Data rows (tab-separated):
//     Name \t weight \t kcal \t kJ \t protein \t carbs \t sugar \t fiber \t fat \t satfat \t sodium(mg) \t salt
//
// Column order: weight, kcal, kJ, proteins, carbs, sugars, fiber, fats, satfat, sodium(mg), salt(g)
// We want: kcal, proteins, carbs, sugars, fiber, fats, satfat, salt (skip weight, kJ, sodium)

function preprocessPopeyesEs(lines: string[]): string[] {
  const result: string[] = [];
  const syntheticHeader = 'Calorías\tProteínas\tHidratos\tAzúcares\tFibra\tGrasas\tSaturadas\tSal';

  let headerInjected = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip meta/header lines
    if (isPopeyesMetaLine(trimmed)) continue;

    // Detect data rows: tab-separated with multiple numbers
    const parts = trimmed.split('\t').map(p => p.trim());
    const numericParts = parts.filter(p => /^\d/.test(p));

    if (numericParts.length >= 10) {
      if (!headerInjected) {
        result.push(syntheticHeader);
        headerInjected = true;
      }

      // Find name (non-numeric part before first tab-separated number)
      const name = parts.filter(p => p.length > 0 && !/^\d/.test(p)).join(' ').trim();
      if (name.length < 2) continue;

      // Extract values: weight[0], kcal[1], kJ[2], protein[3], carbs[4], sugar[5], fiber[6], fat[7], satfat[8], sodium_mg[9], salt[10]
      // We want: kcal, protein, carbs, sugar, fiber, fat, satfat, salt
      const vals = numericParts;
      if (vals.length >= 11) {
        const kcal    = vals[1];
        const protein = vals[3];
        const carbs   = vals[4];
        const sugar   = vals[5];
        const fiber   = vals[6];
        const fat     = vals[7];
        const satfat  = vals[8];
        const salt    = vals[10];
        result.push(`${name}\t${kcal}\t${protein}\t${carbs}\t${sugar}\t${fiber}\t${fat}\t${satfat}\t${salt}`);
      }
    } else if (numericParts.length === 0 && trimmed.length > 1) {
      // Category label
      result.push(trimmed);
    }
  }

  return result;
}

/** Returns true if this line is a Popeyes meta/header line to skip. */
function isPopeyesMetaLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    lower.startsWith('información nutricional') ||
    lower.startsWith('peso') ||
    lower.startsWith('valor') ||
    lower.startsWith('energ') ||
    lower.startsWith('ético') ||
    lower.startsWith('prote') ||
    lower.startsWith('ínas') ||
    lower.startsWith('hidratos') ||
    lower.startsWith('carbono') ||
    lower.startsWith('azúcar') ||
    lower.startsWith('fibra') ||
    lower.startsWith('grasas') ||
    lower.startsWith('grasa sat') ||
    lower.startsWith('sodio') ||
    lower === 'sal' ||
    lower === '(g)' ||
    lower === '(mg)' ||
    lower === '(kcal)' ||
    lower === '(kj)' ||
    lower.includes('---page break---')
  );
}

// ---------------------------------------------------------------------------
// Papa John's Spain
// ---------------------------------------------------------------------------
//
// PDF layout: Complex dual-column (two pizza sizes side-by-side).
//   Multi-line header: "GRASAS", "_DE LAS", "CUALES", "SATURADAS", etc.
//   Then "kJ kcal g g g g g g g kJ kcal g g g g g g g" unit line
//   Data rows: "Name v1 v2 v3 v4 v5 v6 v7 v8 v9 Name2 v1 v2 ..." (dual)
//
// However the Pizza Hut-style pages (later) have a cleaner single format.
// The main issue: product names are missing from data rows in dual-column format.
// Each pair of 9 values (kJ kcal fat satfat carbs sugars protein salt sodium)
// maps to a pizza variant.
//
// Actually looking more closely: "Original 1142.35 273.29 ..." — the name IS there.
// Each line has: MassType kJ kcal fat satfat carbs sugars protein salt sodium [MassType2 ...]
//
// But wait — the product names (pizza types) appear to be ABOVE the sections
// of mass type rows. This is extremely complex. Let me look at the full text more carefully.

function preprocessPapaJohnsEs(lines: string[]): string[] {
  const result: string[] = [];
  // 7 columns: kcal, fat, satfat, carbs, sugars, protein, salt
  const syntheticHeader = 'Calorías\tGrasas\tSaturadas\tHidratos\tAzúcares\tProteínas\tSal';

  let headerInjected = false;
  let lastPizzaName: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip meta/header lines
    if (isPapaJohnsMetaLine(trimmed)) continue;

    // Unit lines: "kJ kcal g g g g g g g kJ kcal g g g g g g g"
    if (/^kJ\s+kcal/.test(trimmed)) continue;

    // Detect data rows with dough type prefix.
    // Format: "DoughType kJ kcal fat satfat carbs sugars protein salt sodium [DoughType2 ...]"
    // The dough types are: Original, Masa fina, Borde mozzarella, Borde cheddar
    const doughMatch = trimmed.match(
      /^(Original|Masa fina|Borde mozzarella|Borde cheddar)\s+([\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+)/
    );

    if (doughMatch) {
      if (!headerInjected) {
        result.push(syntheticHeader);
        headerInjected = true;
      }

      const doughType = doughMatch[1] ?? '';
      const dataPart = doughMatch[2] ?? '';
      const vals = dataPart.trim().split(/\s+/).map(v => v.replace(',', '.'));

      // vals: kJ[0], kcal[1], fat[2], satfat[3], carbs[4], sugars[5], protein[6], salt[7], sodium[8]
      if (vals.length >= 8 && lastPizzaName) {
        const name = `${lastPizzaName} (${doughType})`;
        const kcal    = vals[1];
        const fat     = vals[2];
        const satfat  = vals[3];
        const carbs   = vals[4];
        const sugars  = vals[5];
        const protein = vals[6];
        const salt    = vals[7];
        result.push(`${name}\t${kcal}\t${fat}\t${satfat}\t${carbs}\t${sugars}\t${protein}\t${salt}`);
      }

      // Check for second pizza in same line (dual-column)
      const remaining = trimmed.slice((doughMatch.index ?? 0) + doughMatch[0].length).trim();
      const doughMatch2 = remaining.match(
        /^(Original|Masa fina|Borde mozzarella|Borde cheddar)\s+([\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+)/
      );
      // Skip dual column for now — second pizza name context is lost
      if (doughMatch2) {
        // We'd need a second pizza name from context; skip for simplicity
      }
    } else if (/^\d/.test(trimmed) || trimmed.length < 2) {
      // Page number or short noise
      continue;
    } else {
      // Non-data, non-header line — could be a section header or pizza name
      const lower = trimmed.toLowerCase();
      // Section headers contain size keywords
      if (/^(INDIVIDUAL|MEDIANA|FAMILIAR|MEGA|ENTRANTES|POSTRES|RACIONES|SALSAS|BEBIDAS|COMPLEMENTOS)/i.test(trimmed)) {
        // Section header — reset pizza name
        lastPizzaName = null;
        result.push(trimmed);
      } else if (lower.startsWith('valores nutricionales') || lower.startsWith('©')) {
        continue;
      } else {
        // Pizza name (e.g. "Americana", "Bacon lovers", etc.)
        lastPizzaName = trimmed;
      }
    }
  }

  return result;
}

/** Returns true if this line is a Papa John's meta/header line to skip. */
function isPapaJohnsMetaLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    lower === 'grasas' ||
    lower.startsWith('_de las') ||
    lower.startsWith('_de los') ||
    lower === 'cuales' ||
    lower === 'saturadas' ||
    lower === 'hidratos' ||
    lower === 'de carbono' ||
    lower === 'azúcares' ||
    lower === 'proteínas' ||
    lower === 'sal' ||
    lower === 'sodio' ||
    lower.includes('---page break---')
  );
}

// ---------------------------------------------------------------------------
// Pizza Hut Spain
// ---------------------------------------------------------------------------
//
// PDF layout:
//   Multi-line header:
//     "Energía Energía Grasas", "- de las", "cuales", "saturadas",
//     "Hidratos de", "carbono", "- de los", "cuales", "azucares",
//     "Proteínas \t Sal"
//     "(kj) \t (kcal) \t (g) \t (g) \t (g) \t (g) \t (g) \t (g)"
//   Section headers: "INDIVIDUAL MASA TRADICIONAL", etc.
//   Data rows (tab-separated):
//     Name \t kJ \t kcal \t fat \t satfat \t carbs \t sugars \t protein \t salt
//   Footer: "Valores nutricionales por 100 g" + page number

function preprocessPizzaHutEs(lines: string[]): string[] {
  const result: string[] = [];
  // 7 columns: kcal, fat, satfat, carbs, sugars, protein, salt
  const syntheticHeader = 'Calorías\tGrasas\tSaturadas\tHidratos\tAzúcares\tProteínas\tSal';

  let headerInjected = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip meta/header lines
    if (isPizzaHutMetaLine(trimmed)) continue;

    // Detect data rows: Name followed by tab-separated numbers
    const isDataRow = /\t\d/.test(trimmed);

    if (isDataRow) {
      if (!headerInjected) {
        result.push(syntheticHeader);
        headerInjected = true;
      }

      // Strip kJ (first numeric column after name)
      const stripped = stripFirstNValues(trimmed, 1);
      if (stripped !== null) {
        result.push(stripped);
      }
    } else if (trimmed.length > 1 && !/^\d/.test(trimmed) && !/^\(/.test(trimmed)) {
      // Category label
      result.push(trimmed);
    }
  }

  return result;
}

/** Returns true if this line is a Pizza Hut meta/header line to skip. */
function isPizzaHutMetaLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    lower.startsWith('energía') ||
    lower.startsWith('- de las') ||
    lower.startsWith('- de los') ||
    lower === 'cuales' ||
    lower === 'saturadas' ||
    lower.startsWith('hidratos de') ||
    lower === 'carbono' ||
    lower === 'azucares' ||
    lower === 'proteínas' ||
    lower === 'sal' ||
    lower.startsWith('(kj)') ||
    lower.startsWith('valores nutricionales') ||
    /^\d+$/.test(line.trim()) || // page numbers
    lower.includes('---page break---')
  );
}

// ---------------------------------------------------------------------------
// Starbucks Spain
// ---------------------------------------------------------------------------
//
// PDF layout:
//   Page 1: Cover page (skip)
//   Pages 2+: Repeat header block:
//     "PPK Report 100g Información nutricional PPK Report 100g."
//     "© 2025. Starbucks Coffee España S.L. ..."
//     "Los valores nutricionales aquí recogidos..."
//     Multi-line header: "Valor energético", "(Kj)", "Valor energético", "(Kcal)",
//       "Grasas (g)", "de las cuales:", "Saturadas (g)", etc.
//   Data rows (tab-separated):
//     Name \t kJ \t kcal \t fat \t satfat \t carbs \t sugars \t protein \t salt
//
//   Uses dot decimals (1.058,57 → actually 1058.57 read as "1.058,57" Spanish format)
//   Wait — looking at the extracted text: "1.058,57" which is Spanish for 1058.57
//   The numbers use dot as thousands separator and comma as decimal.

function preprocessStarbucksEs(lines: string[]): string[] {
  const result: string[] = [];
  // 7 columns: kcal, fat, satfat, carbs, sugars, protein, salt
  const syntheticHeader = 'Calorías\tGrasas\tSaturadas\tHidratos\tAzúcares\tProteínas\tSal';

  let headerInjected = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip meta/header lines
    if (isStarbucksMetaLine(trimmed)) continue;

    // Detect data rows: Name followed by tab-separated numbers
    const isDataRow = /\t[\d]/.test(trimmed);

    if (isDataRow) {
      if (!headerInjected) {
        result.push(syntheticHeader);
        headerInjected = true;
      }

      // Normalize Spanish number format: remove dots as thousands separators, replace comma with dot
      // "1.058,57" → "1058.57", "0,00" → "0.00"
      const parts = trimmed.split('\t');
      const name = (parts[0] ?? '').trim();
      if (name.length < 2) continue;

      const numericParts = parts.slice(1).map(p => {
        const v = p.trim();
        // Remove dots used as thousands separator, replace comma with dot
        return v.replace(/\./g, '').replace(',', '.');
      });

      // Strip kJ (first value), keep kcal onwards
      if (numericParts.length >= 8) {
        const kcal    = numericParts[1];
        const fat     = numericParts[2];
        const satfat  = numericParts[3];
        const carbs   = numericParts[4];
        const sugars  = numericParts[5];
        const protein = numericParts[6];
        const salt    = numericParts[7];
        result.push(`${name}\t${kcal}\t${fat}\t${satfat}\t${carbs}\t${sugars}\t${protein}\t${salt}`);
      }
    }
  }

  return result;
}

/** Returns true if this line is a Starbucks meta/header line to skip. */
function isStarbucksMetaLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    lower.startsWith('ppk report') ||
    lower.startsWith('información nutricional') ||
    lower.startsWith('© 20') ||
    lower.startsWith('todos los derechos') ||
    lower.startsWith('los valores nutricionales') ||
    lower.startsWith('la información se ha') ||
    lower.startsWith('variaciones') ||
    lower.startsWith('puede suceder') ||
    lower.startsWith('starbucks coffee') ||
    lower.startsWith('valor energético') ||
    lower.startsWith('grasas (g)') ||
    lower.startsWith('de las cuales') ||
    lower.startsWith('saturadas') ||
    lower.startsWith('hidratos de') ||
    lower.startsWith('carbono') ||
    lower.startsWith('de los cuales') ||
    lower.startsWith('azúcares') ||
    lower.startsWith('proteínas') ||
    lower === 'sal (g)' ||
    lower.includes('---page break---') ||
    lower.startsWith('spring 20')
  );
}

// ---------------------------------------------------------------------------
// Tim Hortons Spain
// ---------------------------------------------------------------------------
//
// PDF layout:
//   Multi-line header (keywords on separate lines):
//     "Peso", "(g/ml)", "Valor Energético", "(KJ)", "Valor Energético", "(Kcal)",
//     "Grasas(g)", "Grasas", "saturadas", "(g)", "Hidratos", "de carbono", "(g)",
//     "Azúcares", "(g)", "Fibra", "alimentaria", "(g)", "Proteínas", "(g)", "Sal", "(g)", "Sodio", "(mg)"
//   Category headers: "BERLITIMS", "BAKE GOODS TIMBITS", etc.
//   Data rows (space/tab-separated):
//     Name \t weight kJ kcal fat satfat carbs sugars fiber protein salt sodium(mg)
//
// Column order: weight, kJ, kcal, fat, satfat, carbs, sugars, fiber, protein, salt, sodium(mg)
// We want: kcal, fat, satfat, carbs, sugars, fiber, protein, salt (skip weight, kJ, sodium)

function preprocessTimHortonsEs(lines: string[]): string[] {
  const result: string[] = [];
  const syntheticHeader = 'Calorías\tGrasas\tSaturadas\tHidratos\tAzúcares\tFibra\tProteínas\tSal';

  let headerInjected = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip meta/header lines
    if (isTimHortonsMetaLine(trimmed)) continue;

    // Tim Hortons data rows: "Name \t weight kJ kcal fat satfat carbs sugars fiber protein salt sodium"
    // The name is tab-separated from the numeric values, but values are space-separated
    const tabParts = trimmed.split('\t');
    if (tabParts.length < 2) {
      // Category header or noise
      if (trimmed.length > 1 && !/^\d/.test(trimmed)) {
        result.push(trimmed);
      }
      continue;
    }

    const name = (tabParts[0] ?? '').trim();
    if (name.length < 2) continue;

    // Rest of the line (after name) contains space-separated numbers
    const dataPart = tabParts.slice(1).join(' ').trim();
    // Handle comma decimals: "38.8" is valid but "38,8" should become "38.8"
    const normalizedData = dataPart.replace(/(\d),(\d)/g, '$1.$2');
    const vals = normalizedData.split(/\s+/).filter(v => /^[\d.]+$/.test(v));

    // Need at least 11 values: weight, kJ, kcal, fat, satfat, carbs, sugars, fiber, protein, salt, sodium
    if (vals.length >= 11) {
      if (!headerInjected) {
        result.push(syntheticHeader);
        headerInjected = true;
      }

      // weight[0], kJ[1], kcal[2], fat[3], satfat[4], carbs[5], sugars[6], fiber[7], protein[8], salt[9], sodium[10]
      const kcal    = vals[2];
      const fat     = vals[3];
      const satfat  = vals[4];
      const carbs   = vals[5];
      const sugars  = vals[6];
      const fiber   = vals[7];
      const protein = vals[8];
      const salt    = vals[9];
      result.push(`${name}\t${kcal}\t${fat}\t${satfat}\t${carbs}\t${sugars}\t${fiber}\t${protein}\t${salt}`);
    } else if (vals.length >= 10) {
      // Some rows may have fewer values (e.g. sodium = 0 omitted or merged)
      if (!headerInjected) {
        result.push(syntheticHeader);
        headerInjected = true;
      }

      const kcal    = vals[2];
      const fat     = vals[3];
      const satfat  = vals[4];
      const carbs   = vals[5];
      const sugars  = vals[6];
      const fiber   = vals[7];
      const protein = vals[8];
      const salt    = vals[9];
      result.push(`${name}\t${kcal}\t${fat}\t${satfat}\t${carbs}\t${sugars}\t${fiber}\t${protein}\t${salt}`);
    }
  }

  return result;
}

/** Returns true if this line is a Tim Hortons meta/header line to skip. */
function isTimHortonsMetaLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    lower.startsWith('*la información') ||
    lower.startsWith('información adicional') ||
    lower.startsWith('ed.') ||
    lower.startsWith('información nutricional') ||
    lower === 'peso' ||
    lower === '(g/ml)' ||
    lower.startsWith('valor energético') ||
    lower === '(kj)' ||
    lower === '(kcal)' ||
    lower.startsWith('grasas(g)') ||
    lower === 'grasas' ||
    lower === 'saturadas' ||
    lower === '(g)' ||
    lower === 'hidratos' ||
    lower === 'de carbono' ||
    lower === 'azúcares' ||
    lower === 'fibra' ||
    lower === 'alimentaria' ||
    lower === 'proteínas' ||
    lower === 'sal' ||
    lower === 'sodio' ||
    lower === '(mg)' ||
    lower.includes('---page break---')
  );
}
