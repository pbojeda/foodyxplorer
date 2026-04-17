/**
 * F-UX-B Standard Portion seed script.
 *
 * Rollback procedure — to un-seed a specific row:
 *   1. DELETE FROM standard_portions WHERE dish_id = $1 AND term = $2;
 *   2. Clear reviewed_by in the source CSV row (empty the column, keep the row)
 *   3. Re-run `npm run generate:standard-portions -w @foodxplorer/api` to regenerate
 *      (the row is preserved as unreviewed, available for re-review)
 *   4. Verify with `SELECT * FROM standard_portions WHERE dish_id = $1;` — should be empty
 *
 * For full table reset (rare, e.g., schema migration):
 *   TRUNCATE standard_portions CASCADE;
 *   then delete CSV rows entirely (do NOT just clear reviewed_by — the rows would
 *   re-seed on next run if any have reviewed_by set).
 *
 * WARNING: Rollback in production must run in a maintenance window. Test the
 * procedure on staging first. The seed pipeline does NOT delete rows on its own —
 * it only upserts, so removing a row from the CSV is not enough to remove it from
 * the DB.
 *
 * See also: CONTRIBUTING.md → "Data seeding" section.
 */

import { readFileSync } from 'fs';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RawCsvRow = Record<string, string>;

export type ParsedRow = {
  dishId: string;
  term: 'pintxo' | 'tapa' | 'media_racion' | 'racion';
  grams: number;
  pieces: number | null;
  pieceName: string | null;
  confidence: 'high' | 'medium' | 'low';
  notes: string | null;
  reviewed_by: string | null;
};

export type SeedSummary = {
  seeded: number;
  skipped: number;
  message: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REQUIRED_COLUMNS = ['dishId', 'term', 'grams', 'pieces', 'pieceName', 'confidence', 'notes', 'reviewed_by'] as const;

const TermSchema = z.enum(['pintxo', 'tapa', 'media_racion', 'racion']);
const ConfidenceSchema = z.enum(['high', 'medium', 'low']);
const UuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Header validation
// ---------------------------------------------------------------------------

/**
 * Validate that the CSV header contains exactly the required columns.
 * Returns null on success or an error message string on failure.
 */
export function validateCsvHeader(header: string[]): string | null {
  const required = new Set(REQUIRED_COLUMNS as ReadonlyArray<string>);
  const actual = new Set(header);

  const missing = [...required].filter((c) => !actual.has(c));
  const extra = [...actual].filter((c) => !required.has(c));

  if (missing.length === 0 && extra.length === 0) return null;

  const parts: string[] = [];
  if (missing.length > 0) parts.push(`Missing columns: ${missing.join(', ')}`);
  if (extra.length > 0) parts.push(`Unexpected columns: ${extra.join(', ')}`);
  return `CSV header validation failed. ${parts.join('. ')}`;
}

// ---------------------------------------------------------------------------
// Row-level validation
// ---------------------------------------------------------------------------

type RowValidationResult = {
  errors: string[];
  toSeed: RawCsvRow[];
  toSkip: number;
};

/**
 * Validate all rows in the CSV (reviewed or not).
 * - Structural errors (type validation, uniqueness) always fail loudly.
 * - The silent-skip gate (reviewed_by == null) only runs AFTER all structural
 *   validation passes.
 */
export function validateCsvRows(rows: RawCsvRow[]): RowValidationResult {
  const errors: string[] = [];
  const seenKeys = new Map<string, number>(); // key = `${dishId}:${term}` → row number

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNum = i + 1;
    const reviewedBy = row['reviewed_by']?.trim() ?? '';

    // dishId — must be a valid UUID (M1-3 fix)
    const dishIdResult = UuidSchema.safeParse(row['dishId']);
    if (!dishIdResult.success) {
      errors.push(`row ${rowNum}: dishId '${row['dishId']}' is not a valid UUID (reviewed_by: ${reviewedBy || 'null'})`);
    }

    // term
    const termResult = TermSchema.safeParse(row['term']);
    if (!termResult.success) {
      errors.push(`row ${rowNum}: term '${row['term']}' is invalid (must be pintxo|tapa|media_racion|racion) (reviewed_by: ${reviewedBy || 'null'})`);
    }

    // grams — must be a positive integer
    const gramsNum = Number(row['grams']);
    if (!Number.isInteger(gramsNum) || gramsNum <= 0) {
      errors.push(`row ${rowNum}: grams '${row['grams']}' must be a positive integer (reviewed_by: ${reviewedBy || 'null'})`);
    }

    // pieces — null or positive integer
    const piecesRaw = row['pieces']?.trim() ?? '';
    const pieces = piecesRaw === '' ? null : Number(piecesRaw);
    if (pieces !== null && (!Number.isInteger(pieces) || pieces < 1)) {
      errors.push(`row ${rowNum}: pieces '${piecesRaw}' must be empty or a positive integer >= 1 (reviewed_by: ${reviewedBy || 'null'})`);
    }

    // pieceName — null iff pieces is null
    const pieceName = (row['pieceName']?.trim() ?? '') || null;
    const piecesIsNull = pieces === null;
    const pieceNameIsNull = pieceName === null;
    if (piecesIsNull !== pieceNameIsNull) {
      errors.push(`row ${rowNum}: pieces and pieceName must both be null or both non-null (reviewed_by: ${reviewedBy || 'null'})`);
    }

    // confidence
    const confResult = ConfidenceSchema.safeParse(row['confidence']);
    if (!confResult.success) {
      errors.push(`row ${rowNum}: confidence '${row['confidence']}' is invalid (must be high|medium|low) (reviewed_by: ${reviewedBy || 'null'})`);
    }

    // Uniqueness check for (dishId, term)
    if (dishIdResult.success && termResult.success) {
      const key = `${row['dishId']}:${row['term']}`;
      const prevRow = seenKeys.get(key);
      if (prevRow !== undefined) {
        errors.push(`row ${rowNum}: duplicate (dishId, term) pair — same as row ${prevRow} (reviewed_by: ${reviewedBy || 'null'})`);
      } else {
        seenKeys.set(key, rowNum);
      }
    }
  }

  if (errors.length > 0) {
    return { errors, toSeed: [], toSkip: 0 };
  }

  // --- Step 4: Review gate (only after structural validation passes) ---
  const toSeed: RawCsvRow[] = [];
  let toSkip = 0;

  for (const row of rows) {
    const reviewedBy = row['reviewed_by']?.trim() ?? '';
    if (reviewedBy !== '') {
      toSeed.push(row);
    } else {
      toSkip++;
    }
  }

  return { errors: [], toSeed, toSkip };
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * Upsert reviewed rows into the standard_portions table.
 * Returns a summary with counts and a human-readable message.
 */
export async function seedFromParsedRows(
  prisma: PrismaClient,
  toSeed: RawCsvRow[],
  skippedCount: number,
): Promise<SeedSummary> {
  for (const row of toSeed) {
    const piecesRaw = row['pieces']?.trim() ?? '';
    const pieces = piecesRaw === '' ? null : Number(piecesRaw);
    const pieceName = (row['pieceName']?.trim() ?? '') || null;
    const notes = (row['notes']?.trim() ?? '') || null;

    await prisma.standardPortion.upsert({
      where: {
        dishId_term: {
          dishId: row['dishId']!,
          term: row['term']!,
        },
      },
      update: {
        grams: Number(row['grams']),
        pieces,
        pieceName,
        confidence: row['confidence'] as 'high' | 'medium' | 'low',
        notes,
      },
      create: {
        dishId: row['dishId']!,
        term: row['term']!,
        grams: Number(row['grams']),
        pieces,
        pieceName,
        confidence: row['confidence'] as 'high' | 'medium' | 'low',
        notes,
      },
    });
  }

  const message = `Seeded ${toSeed.length} rows. Skipped ${skippedCount} unreviewed rows (reviewed_by == null). 0 errors.`;
  return { seeded: toSeed.length, skipped: skippedCount, message };
}

// ---------------------------------------------------------------------------
// CSV parsing helper (used by the CLI entrypoint)
// ---------------------------------------------------------------------------

/**
 * Parse a single CSV line into an array of fields, honoring RFC 4180 quoting.
 *
 * - Handles commas inside quoted fields: `a,"b,c",d` → `['a', 'b,c', 'd']`
 * - Handles escaped quotes inside quoted fields: `a,"b""c",d` → `['a', 'b"c', 'd']`
 * - Trims unquoted fields; leaves quoted fields untrimmed internally (leading/
 *   trailing whitespace inside quotes is preserved)
 *
 * Exported for unit testing. Code review (M2-A) found that the previous
 * `line.split(',')` implementation broke silently on any future `notes` or
 * `pieceName` cell that contained a comma — the columns would shift and
 * `reviewed_by` would be mis-read, potentially seeding unreviewed rows as
 * reviewed. This parser eliminates that class of bug.
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else if (ch === '"' && current.trim() === '') {
        inQuotes = true;
        current = ''; // drop any leading whitespace
      } else {
        current += ch;
      }
    }
  }
  fields.push(inQuotes ? current : current.trim());
  return fields;
}

/**
 * Parse a raw CSV string into an array of row objects keyed by header columns.
 *
 * Handles:
 * - Empty lines
 * - CRLF (Windows) and LF (Unix) line endings
 * - UTF-8 BOM (stripped via .trim() on the split fields)
 * - Quoted fields with embedded commas and escaped quotes (per RFC 4180)
 *
 * Throws a clear error if ANY row has a different column count from the
 * header — this is the loud failure Codex asked for in M2-A. A row that has
 * too few or too many columns after parsing is a structural error, not a
 * data error, and must halt the seed pipeline.
 */
export function parseCsvString(csvContent: string): { header: string[]; rows: RawCsvRow[] } {
  const lines = csvContent.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return { header: [], rows: [] };

  const header = parseCsvLine(lines[0]!);
  const expectedColumnCount = header.length;
  const rows: RawCsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]!);

    // M2-A fix: loud failure on column-count mismatch. The previous version
    // silently padded or dropped fields, which meant a typo or unescaped
    // comma in any cell would misalign the row without any visible error.
    if (values.length !== expectedColumnCount) {
      throw new Error(
        `row ${i + 1}: malformed CSV row — expected ${expectedColumnCount} columns ` +
          `(${header.join(', ')}) but got ${values.length}. ` +
          `Did you embed an unquoted comma in a cell? Quote the cell as "...,..." to include commas.`,
      );
    }

    const row: RawCsvRow = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]!] = values[j] ?? '';
    }
    rows.push(row);
  }

  return { header, rows };
}

// ---------------------------------------------------------------------------
// CLI entrypoint (invoked via npm run seed:standard-portions)
// ---------------------------------------------------------------------------

export async function runSeedFromCsv(
  csvPath: string,
  prisma: PrismaClient,
  logger?: { info: (msg: string) => void; error: (msg: string) => void },
): Promise<void> {
  const log = logger ?? { info: console.log, error: console.error };

  const csvContent = readFileSync(csvPath, 'utf-8');
  const { header, rows } = parseCsvString(csvContent);

  // Step 1: Header validation
  const headerError = validateCsvHeader(header);
  if (headerError !== null) {
    log.error(headerError);
    process.exit(1);
  }

  if (rows.length === 0) {
    log.info('Seeded 0 rows. Skipped 0 unreviewed rows (reviewed_by == null). 0 errors.');
    return;
  }

  // Steps 2–4: Row validation + review gate
  const { errors, toSeed, toSkip } = validateCsvRows(rows);
  if (errors.length > 0) {
    for (const err of errors) {
      log.error(err);
    }
    process.exit(1);
  }

  // Step 5: Upsert
  const summary = await seedFromParsedRows(prisma, toSeed, toSkip);
  log.info(summary.message);
}

// ---------------------------------------------------------------------------
// CLI entrypoint — only runs when invoked directly (mirrors
// generateStandardPortionCsv.ts pattern). CommonJS-compatible
// direct-invocation check.
// ---------------------------------------------------------------------------

const isDirectInvocation = process.argv[1]?.includes('seedStandardPortionCsv') ?? false;
if (isDirectInvocation) {
  void import('@prisma/client').then(async ({ PrismaClient }) => {
    const { resolve } = await import('path');
    const prisma = new PrismaClient();
    const csvPath = process.argv[2] ?? resolve(process.cwd(), 'prisma/seed-data/standard-portions.csv');
    try {
      await runSeedFromCsv(csvPath, prisma);
    } catch (e: unknown) {
      console.error(e);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });
}
