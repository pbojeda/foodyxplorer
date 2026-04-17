/**
 * F-UX-B — Generator script for standard-portions.csv
 *
 * Reads packages/api/prisma/seed-data/spanish-dishes.json, uses the explicit
 * PRIORITY_DISH_MAP to resolve dishIds, and expands each × 4 terms to produce
 * CSV rows.
 *
 * Usage:
 *   npm run generate:standard-portions -w @foodxplorer/api
 *
 * Output is appended to packages/api/prisma/seed-data/standard-portions.csv.
 *
 * BUG-PROD-009 (2026-04-17): Replaced heuristic matchesPriorityName (.includes()
 * substring + Array.find) with explicit PRIORITY_DISH_MAP. Added fail-hard
 * validation: throws on duplicate dishIds or dishIds absent from spanish-dishes.json.
 *
 * NOTE: This script is OFFLINE only — never invoked at query time.
 *       LLM backfill is intentionally offline (zero runtime LLM cost).
 *       The reviewed_by column is left empty; the analyst fills it after review.
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import path from 'path';
import { parseCsvLine } from './seedStandardPortionCsv.js';

// ---------------------------------------------------------------------------
// Explicit priority dish map (BUG-PROD-009) — 39 entries
// Keys: human-readable priority name (used for template notes)
// Values: canonical dishId from spanish-dishes.json
//
// Omitted (no canonical dish in spanish-dishes.json; tracked in F114):
//   chorizo, chuletón, arroz, bocadillo, pintxos, alitas de pollo,
//   zamburiñas, berberechos, tostas
// ---------------------------------------------------------------------------

export const PRIORITY_DISH_MAP: Record<string, string> = {
  'croquetas':             '00000000-0000-e073-0007-00000000001a',
  'patatas bravas':        '00000000-0000-e073-0007-00000000001b',
  'gambas al ajillo':      '00000000-0000-e073-0007-00000000001e',
  'aceitunas':             '00000000-0000-e073-0007-000000000021',
  'jamón':                 '00000000-0000-e073-0007-000000000022',
  'queso manchego':        '00000000-0000-e073-0007-000000000023',
  'boquerones':            '00000000-0000-e073-0007-000000000020',
  'calamares':             '00000000-0000-e073-0007-00000000001d',
  'chopitos':              '00000000-0000-e073-0007-000000000028',
  'ensaladilla':           '00000000-0000-e073-0007-000000000024',
  'tortilla':              '00000000-0000-e073-0007-00000000001c',
  'pan con tomate':        '00000000-0000-e073-0007-00000000003d',
  'morcilla':              '00000000-0000-e073-0007-00000000002a',
  'pulpo a la gallega':    '00000000-0000-e073-0007-000000000025',
  'gazpacho':              '00000000-0000-e073-0007-000000000042',
  'salmorejo':             '00000000-0000-e073-0007-000000000043',
  'albóndigas':            '00000000-0000-e073-0007-000000000062',
  'empanadillas':          '00000000-0000-e073-0007-0000000000f1',
  'mejillones':            '00000000-0000-e073-0007-000000000029',
  'navajas':               '00000000-0000-e073-0007-000000000034',
  'sepia':                 '00000000-0000-e073-0007-000000000035',
  'rabas':                 '00000000-0000-e073-0007-00000000003b',
  'champiñones al ajillo': '00000000-0000-e073-0007-000000000026',
  'pimientos de padrón':   '00000000-0000-e073-0007-00000000001f',
  'paella':                '00000000-0000-e073-0007-000000000083',
  'lentejas':              '00000000-0000-e073-0007-000000000044',
  'ensalada':              '00000000-0000-e073-0007-000000000049',
  'cocido':                '00000000-0000-e073-0007-000000000046',
  'fabada':                '00000000-0000-e073-0007-000000000045',
  'huevos fritos':         '00000000-0000-e073-0007-00000000007e',
  'merluza':               '00000000-0000-e073-0007-000000000061',
  'fideuà':                '00000000-0000-e073-0007-000000000089',
  'pisto':                 '00000000-0000-e073-0007-00000000004b',
  'flamenquín':            '00000000-0000-e073-0007-0000000000f2',
  'sopa de ajo':           '00000000-0000-e073-0007-000000000047',
  'churros':               '00000000-0000-e073-0007-000000000003',
  'crema catalana':        '00000000-0000-e073-0007-0000000000ae',
  'tarta de queso':        '00000000-0000-e073-0007-0000000000ad',
  'potaje':                '00000000-0000-e073-0007-00000000004e',
};

// Dishes explicitly tagged "sin pieces" — no countable unit, liquid/bulk style.
// arroz and bocadillo removed (no longer in PRIORITY_DISH_MAP per BUG-PROD-009).
const SIN_PIECES_NAMES = new Set([
  'gazpacho', 'salmorejo', 'lentejas', 'cocido', 'fabada',
  'sopa de ajo', 'potaje', 'pisto', 'crema catalana', 'ensalada',
]);

const TERMS = ['pintxo', 'tapa', 'media_racion', 'racion'] as const;

const CSV_HEADER = 'dishId,term,grams,pieces,pieceName,confidence,notes,reviewed_by';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SpanishDish = {
  dishId: string;
  nameEs: string;
  name?: string;
  aliases?: string[];
  [key: string]: unknown;
};

type SpanishDishesData = {
  dishes: SpanishDish[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the priority name is classified as "sin pieces" —
 * a liquid or bulk dish where piece counting is not applicable.
 */
export function isSinPieces(priorityName: string): boolean {
  return SIN_PIECES_NAMES.has(priorityName);
}

/**
 * Fail-hard validation of the PRIORITY_DISH_MAP before any CSV output.
 *
 * Throws if:
 *   - Two keys point to the same dishId (duplicate)
 *   - Any dishId value is not present in knownDishIds (unknown/orphan)
 *
 * Duplicates are checked first; unknowns second.
 *
 * @param map         The map to validate (typically PRIORITY_DISH_MAP)
 * @param knownDishIds Set of dishIds present in spanish-dishes.json
 */
export function validatePriorityDishMap(
  map: Record<string, string>,
  knownDishIds: Set<string>,
): void {
  // Pass 1 — detect duplicate dishIds (two keys → same dishId)
  const reverse = new Map<string, string>(); // dishId → first key
  for (const [key, dishId] of Object.entries(map)) {
    const existing = reverse.get(dishId);
    if (existing !== undefined) {
      throw new Error(
        `PRIORITY_DISH_MAP has duplicate dishId "${dishId}" for keys: "${existing}", "${key}"`,
      );
    }
    reverse.set(dishId, key);
  }

  // Pass 2 — detect unknown dishIds (not present in spanish-dishes.json)
  for (const [key, dishId] of Object.entries(map)) {
    if (!knownDishIds.has(dishId)) {
      throw new Error(
        `PRIORITY_DISH_MAP key "${key}" references unknown dishId "${dishId}" — not found in spanish-dishes.json`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function generateStandardPortionCsv(opts?: {
  dataDir?: string;
  outputPath?: string;
}): Promise<void> {
  // Resolve data dir relative to cwd (supports running from repo root or packages/api)
  const candidateDirs = [
    path.resolve(process.cwd(), 'prisma/seed-data'),
    path.resolve(process.cwd(), 'packages/api/prisma/seed-data'),
    path.resolve(process.cwd(), '../prisma/seed-data'),
  ];
  const resolvedDefault = candidateDirs.find((d) => existsSync(path.join(d, 'spanish-dishes.json')));
  const dataDir = opts?.dataDir ?? resolvedDefault ?? candidateDirs[0] ?? 'prisma/seed-data';
  const outputPath = opts?.outputPath ?? path.join(dataDir, 'standard-portions.csv');

  // Load spanish-dishes.json
  const spanishDishesPath = path.join(dataDir, 'spanish-dishes.json');
  const raw = readFileSync(spanishDishesPath, 'utf-8');
  const data = JSON.parse(raw) as SpanishDishesData;
  const dishes = data.dishes;

  // Build known dishId set for validation
  const knownDishIds = new Set(dishes.map((d) => d.dishId));

  // Fail-hard: validate map before any output
  validatePriorityDishMap(PRIORITY_DISH_MAP, knownDishIds);

  // Load existing CSV to detect already-reviewed rows (skip-existing logic).
  // Uses the shared RFC 4180 parser from seedStandardPortionCsv.ts to correctly
  // handle commas embedded in quoted fields (M2-A fix).
  const existingReviewed = new Set<string>(); // key = `${dishId}:${term}`
  if (existsSync(outputPath)) {
    const existing = readFileSync(outputPath, 'utf-8');
    const lines = existing.replace(/\r\n/g, '\n').split('\n')
      .filter((l) => l.trim() !== '' && !l.startsWith('dishId'));
    for (const line of lines) {
      const cols = parseCsvLine(line);
      const dishId = cols[0];
      const term = cols[1];
      const reviewedBy = cols[7];
      if (dishId && term && reviewedBy) {
        existingReviewed.add(`${dishId}:${term}`);
      }
    }
  }

  const newLines: string[] = [];

  for (const [priorityName, dishId] of Object.entries(PRIORITY_DISH_MAP)) {
    // dishId guaranteed present in spanish-dishes.json after validatePriorityDishMap
    const sinPieces = isSinPieces(priorityName);

    for (const term of TERMS) {
      const key = `${dishId}:${term}`;
      if (existingReviewed.has(key)) {
        // Skip rows that are already reviewed — safe to re-run
        continue;
      }

      // Generate template row (analyst will fill in grams/pieces/confidence)
      const gramsTemplate = sinPieces ? '200' : '50';
      const pieces = '';          // analyst fills in
      const pieceName = '';       // analyst fills in
      const confidence = 'medium';
      const notes = sinPieces
        ? 'sin pieces — gazpacho/salmorejo style'
        : `template: ${priorityName} ${term}`;
      const reviewed_by = ''; // analyst fills in

      newLines.push(
        [dishId, term, gramsTemplate, pieces, pieceName, confidence, notes, reviewed_by].join(','),
      );
    }
  }

  console.log(`Matched ${Object.keys(PRIORITY_DISH_MAP).length} priority dishes.`);
  console.log(`Generated ${newLines.length} new template rows.`);

  if (newLines.length === 0) {
    console.log('No new rows to add. CSV is up-to-date.');
    return;
  }

  // Write or append to CSV
  const needsHeader = !existsSync(outputPath) || readFileSync(outputPath, 'utf-8').trim() === '';
  const content = needsHeader
    ? [CSV_HEADER, ...newLines].join('\n') + '\n'
    : newLines.join('\n') + '\n';

  if (needsHeader) {
    writeFileSync(outputPath, content, 'utf-8');
  } else {
    appendFileSync(outputPath, content, 'utf-8');
  }

  console.log(`Written to: ${outputPath}`);
}

// CLI entrypoint — only runs when invoked directly (P2-1 guard: prevents the
// generator from firing on module import, which would happen if any test
// imports validatePriorityDishMap/isSinPieces from this file).
//
// CommonJS-compatible direct-invocation check (the api package builds to CJS,
// so import.meta.url is not available). `process.argv[1]` is the script being
// executed; if our filename appears there we know we were invoked directly.
const isDirectInvocation = process.argv[1]?.includes('generateStandardPortionCsv') ?? false;
if (isDirectInvocation) {
  generateStandardPortionCsv().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
