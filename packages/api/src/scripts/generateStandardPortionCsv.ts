/**
 * F-UX-B — Generator script for standard-portions.csv
 *
 * Reads packages/api/prisma/seed-data/spanish-dishes.json, filters to the
 * 30 priority dishes, and expands each × 4 terms to produce CSV rows.
 *
 * Usage:
 *   npm run generate:standard-portions -w @foodxplorer/api
 *
 * Output is appended to packages/api/prisma/seed-data/standard-portions.csv.
 *
 * Row classification per spec Q1:
 * - Strong-countable: default pieces = null (analyst fills in)
 * - Sin pieces: pieces = null, pieceName = null (hardcoded)
 * - Analyst-decides: pieces = null by default (analyst may override)
 *
 * NOTE: This script is OFFLINE only — never invoked at query time.
 *       LLM backfill is intentionally offline (zero runtime LLM cost).
 *       The reviewed_by column is left empty; the analyst fills it after review.
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import path from 'path';
import { parseCsvLine } from './seedStandardPortionCsv.js';

// ---------------------------------------------------------------------------
// Priority dish list (30 dishes, verbatim from spec Q1 — do not reorder)
// ---------------------------------------------------------------------------

const PRIORITY_DISH_NAMES = [
  'croquetas',
  'patatas bravas',
  'gambas al ajillo',
  'aceitunas',
  'pintxos',
  'jamón',
  'queso manchego',
  'boquerones',
  'calamares',
  'chopitos',
  'ensaladilla',
  'tortilla',
  'pan con tomate',
  'chorizo',
  'morcilla',
  'pulpo a la gallega',
  'gazpacho',
  'salmorejo',
  'albóndigas',
  'alitas de pollo',
  'empanadillas',
  'mejillones',
  'navajas',
  'zamburiñas',
  'berberechos',
  'sepia',
  'rabas',
  'champiñones al ajillo',
  'pimientos de padrón',
  'tostas',
  'paella',
  'lentejas',
  'ensalada',
  'cocido',
  'fabada',
  'huevos fritos',
  'chuletón',
  'merluza',
  'fideuà',
  'pisto',
  'flamenquín',
  'sopa de ajo',
  'churros',
  'crema catalana',
  'tarta de queso',
  'potaje',
  'arroz',
  'bocadillo',
] as const;

// Dishes explicitly tagged "sin pieces" by the user
const SIN_PIECES_NAMES = new Set([
  'gazpacho', 'salmorejo', 'lentejas', 'cocido', 'fabada',
  'sopa de ajo', 'potaje', 'pisto', 'crema catalana', 'arroz', 'ensalada',
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

function normalizeName(name: string): string {
  return name.toLowerCase().trim();
}

function matchesPriorityName(dish: SpanishDish, priorityName: string): boolean {
  const nameNorm = normalizeName(dish.nameEs ?? dish.name ?? '');
  const priorityNorm = normalizeName(priorityName);

  // Exact or contains match
  if (nameNorm === priorityNorm || nameNorm.includes(priorityNorm)) return true;

  // Check aliases
  const aliases = (dish.aliases ?? []).map(normalizeName);
  return aliases.some((a) => a === priorityNorm || a.includes(priorityNorm));
}

function isSinPieces(priorityName: string): boolean {
  return SIN_PIECES_NAMES.has(priorityName);
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
  const dataDir = opts?.dataDir ?? resolvedDefault ?? candidateDirs[0]!;
  const outputPath = opts?.outputPath ?? path.join(dataDir, 'standard-portions.csv');

  // Load spanish-dishes.json
  const spanishDishesPath = path.join(dataDir, 'spanish-dishes.json');
  const raw = readFileSync(spanishDishesPath, 'utf-8');
  const data = JSON.parse(raw) as SpanishDishesData;
  const dishes = data.dishes;

  // Load existing CSV to detect already-reviewed rows (skip-existing logic).
  // Uses the shared RFC 4180 parser from seedStandardPortionCsv.ts to correctly
  // handle commas embedded in quoted fields (M2-A fix). The previous naive
  // `line.split(',')` implementation would misalign columns on any cell with a
  // comma and falsely detect a reviewed row as unreviewed (or vice versa).
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
  let matchedCount = 0;

  for (const priorityName of PRIORITY_DISH_NAMES) {
    const matchedDish = dishes.find((d) => matchesPriorityName(d, priorityName));
    if (!matchedDish) {
      console.warn(`  [WARN] No dish found for priority name: "${priorityName}"`);
      continue;
    }

    matchedCount++;
    const sinPieces = isSinPieces(priorityName);

    for (const term of TERMS) {
      const key = `${matchedDish.dishId}:${term}`;
      if (existingReviewed.has(key)) {
        // Skip rows that are already reviewed — safe to re-run
        continue;
      }

      // Generate template row (analyst will fill in grams/pieces/confidence)
      const gramsTemplate = sinPieces ? '200' : '50';
      const pieces = sinPieces ? '' : '';          // analyst fills in
      const pieceName = sinPieces ? '' : '';       // analyst fills in
      const confidence = 'medium';
      const notes = sinPieces
        ? 'sin pieces — gazpacho/salmorejo style'
        : `template: ${priorityName} ${term}`;
      const reviewed_by = ''; // analyst fills in

      newLines.push(
        [matchedDish.dishId, term, gramsTemplate, pieces, pieceName, confidence, notes, reviewed_by].join(','),
      );
    }
  }

  console.log(`Matched ${matchedCount}/${PRIORITY_DISH_NAMES.length} priority dishes.`);
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
// imports matchesPriorityName/isSinPieces from this file).
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
