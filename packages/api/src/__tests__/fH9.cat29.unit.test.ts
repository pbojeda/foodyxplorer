/**
 * F-H9 — Cat 29 Seed Expansion unit tests.
 *
 * Covers the 11 deterministic Cat 29 stripped queries from QA battery dev
 * 2026-04-27 13:06 UTC (/tmp/qa-dev-post-fH8-20260427-1306.txt).
 *
 * All tests are data-only (no DB, no HTTP) — loads real JSON and CSV files via
 * readFileSync. Pattern follows H6-EC-12 in fH6.seedExpansionRound2.edge-cases.test.ts.
 *
 * Q638 (`noodles con pollo y verduras` → CE-310) is deterministic via H5-B Guard 2:
 * once CE-310 exists in the catalog, `level1Lookup(db, text, {})` at
 * `implicitMultiItemDetector.ts:122` returns CE-310 and H5-B returns null —
 * no conditional branch, no multi-item split.
 *
 * Blocks:
 *   F-H9-AC-12       level1Lookup simulation for 11 Cat 29 stripped queries
 *   F-H9-AC-12-CSV   standard-portions.csv F-H9 batch invariants
 */

import { readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { parseCsvString } from '../scripts/seedStandardPortionCsv.js';
import type { SpanishDishEntry } from '../scripts/spanishDishesTypes.js';

// ---------------------------------------------------------------------------
// File paths (DATA_DIR guard for CI compatibility — tests run from repo root or
// packages/api directory)
// ---------------------------------------------------------------------------

const DATA_DIR = process.cwd().includes('packages/api') ? '.' : 'packages/api';
const JSON_PATH = path.resolve(DATA_DIR, 'prisma/seed-data/spanish-dishes.json');
const CSV_PATH = path.resolve(DATA_DIR, 'prisma/seed-data/standard-portions.csv');

// ---------------------------------------------------------------------------
// Load data once at module scope
// ---------------------------------------------------------------------------

interface JsonRoot {
  dishes: SpanishDishEntry[];
}

const jsonRoot = JSON.parse(readFileSync(JSON_PATH, 'utf-8')) as JsonRoot;
const dishes = jsonRoot.dishes;

interface CsvRow {
  dishId: string;
  term: string;
  grams: string;
  pieces: string;
  pieceName: string;
  confidence: string;
  notes: string;
  reviewed_by: string;
}

const { rows: csvRawRows } = parseCsvString(readFileSync(CSV_PATH, 'utf-8'));
const csvRows: CsvRow[] = csvRawRows.map((r) => ({
  dishId: r['dishId'] ?? '',
  term: r['term'] ?? '',
  grams: r['grams'] ?? '',
  pieces: r['pieces'] ?? '',
  pieceName: r['pieceName'] ?? '',
  confidence: r['confidence'] ?? '',
  notes: r['notes'] ?? '',
  reviewed_by: r['reviewed_by'] ?? '',
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Level-1 exact-match lookup simulation (mirrors implicitMultiItemDetector.ts:122).
 *  Inline copy following H6-EC-12 precedent — not imported from production code. */
function level1Lookup(query: string): SpanishDishEntry[] {
  const q = query.toLowerCase().trim();
  return dishes.filter(
    (d) =>
      d.name.toLowerCase() === q ||
      d.nameEs.toLowerCase() === q ||
      (d.aliases ?? []).some((a) => a.toLowerCase() === q),
  );
}

/** F-H9 new dishId hex suffixes: CE-308 (0x134) through CE-317 (0x13d) */
const FH9_SUFFIXES: string[] = [
  '000000000134', // CE-308
  '000000000135', // CE-309
  '000000000136', // CE-310
  '000000000137', // CE-311
  '000000000138', // CE-312
  '000000000139', // CE-313
  '00000000013a', // CE-314
  '00000000013b', // CE-315
  '00000000013c', // CE-316
  '00000000013d', // CE-317
];

function fH9CsvRows(): CsvRow[] {
  return csvRows.filter((r) =>
    FH9_SUFFIXES.some((s) => r.dishId.endsWith(s)),
  );
}

// ---------------------------------------------------------------------------
// F-H9-AC-12  level1Lookup simulation for 11 Cat 29 stripped queries
// ---------------------------------------------------------------------------

describe('F-H9-AC-12: level1Lookup simulation for 11 Cat 29 stripped queries', () => {
  const cases: Array<[string, string]> = [
    ['salmón con verduras al horno', 'CE-308'],  // Q631
    ['migas con huevo', 'CE-094'],               // Q632 — alias addition on existing atom
    ['nachos con queso', 'CE-309'],              // Q637
    ['noodles con pollo y verduras', 'CE-310'],  // Q638 — H5-B Guard 2 deterministic
    ['yogur con granola', 'CE-311'],             // Q639
    ['barrita energética de frutos secos', 'CE-312'], // Q640
    ['bocata de pavo con queso', 'CE-313'],      // Q643 — alias-derived resolution
    ['arroz con atún y maíz', 'CE-314'],         // Q644
    ['empanadilla de carne', 'CE-315'],          // Q646
    ['tortilla francesa con champiñones', 'CE-316'], // Q645 — alias-derived resolution
    ['porción de brownie', 'CE-317'],            // Q650 — H7-P1 ARTICLE_PATTERN residual alias
  ];

  it.each(cases)(
    'query "%s" resolves exactly to %s',
    (query, expectedEid) => {
      const matches = level1Lookup(query);
      expect(matches.map((d) => d.externalId)).toEqual([expectedEid]);
    },
  );
});

// ---------------------------------------------------------------------------
// F-H9-AC-12-CSV  standard-portions.csv F-H9 batch invariants
// ---------------------------------------------------------------------------

describe('F-H9-AC-12-CSV: standard-portions.csv F-H9 batch invariants', () => {
  it('INV-1: every new F-H9 dishId has at least 1 CSV row', () => {
    const rows = fH9CsvRows();
    for (const suffix of FH9_SUFFIXES) {
      const count = rows.filter((r) => r.dishId.endsWith(suffix)).length;
      expect(count, `dishId ending in ${suffix} has no portion rows`).toBeGreaterThanOrEqual(1);
    }
  });

  it('INV-2: every F-H9 CSV row has a non-empty reviewed_by', () => {
    const rows = fH9CsvRows();
    for (const row of rows) {
      expect(
        row.reviewed_by,
        `Row for dishId ${row.dishId} term=${row.term} has empty reviewed_by (seeder will silently skip it)`,
      ).not.toBe('');
    }
  });

  it('INV-3: pieces/pieceName pair invariant holds for all F-H9 rows', () => {
    const rows = fH9CsvRows();
    for (const row of rows) {
      const hasPieces = row.pieces !== '';
      const hasPieceName = row.pieceName !== '';
      expect(
        hasPieces,
        `Row for dishId ${row.dishId} term=${row.term}: pieces="${row.pieces}" pieceName="${row.pieceName}" — pair mismatch`,
      ).toBe(hasPieceName);
    }
  });

  it('INV-4: every F-H9 CSV row has a valid term enum value', () => {
    const validTerms = new Set(['pintxo', 'tapa', 'media_racion', 'racion']);
    const rows = fH9CsvRows();
    for (const row of rows) {
      expect(
        validTerms.has(row.term),
        `Row for dishId ${row.dishId} has invalid term="${row.term}"`,
      ).toBe(true);
    }
  });

  it('INV-5: every F-H9 CSV row has grams > 0', () => {
    const rows = fH9CsvRows();
    for (const row of rows) {
      const g = parseInt(row.grams, 10);
      expect(
        Number.isInteger(g) && g > 0,
        `Row for dishId ${row.dishId} term=${row.term} has invalid grams="${row.grams}"`,
      ).toBe(true);
    }
  });
});
