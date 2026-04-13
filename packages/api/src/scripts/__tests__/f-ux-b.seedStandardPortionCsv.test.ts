// F-UX-B — Unit tests for seedStandardPortionCsv.ts
//
// Tests cover:
// - Valid CSV seeds correctly
// - Malformed header halts with column diff
// - dishId UUID validation (M1-3: UUID not integer)
// - Malformed grams halts
// - pieces/pieceName pairing invariant
// - Duplicate (dishId, term) halts
// - reviewed_by=null rows silently skipped with correct summary counts
// - Idempotency: re-run produces same DB state
// - Empty CSV logs "Seeded 0 rows. Skipped 0 unreviewed rows. 0 errors."

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateCsvHeader, validateCsvRows, seedFromParsedRows } from '../seedStandardPortionCsv';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CsvRow = {
  dishId: string;
  term: string;
  grams: string;
  pieces: string;
  pieceName: string;
  confidence: string;
  notes: string;
  reviewed_by: string;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_UUID_1 = '550e8400-e29b-41d4-a716-446655440001';
const VALID_UUID_2 = '550e8400-e29b-41d4-a716-446655440002';

function validRow(overrides: Partial<CsvRow> = {}): CsvRow {
  return {
    dishId: VALID_UUID_1,
    term: 'tapa',
    grams: '50',
    pieces: '2',
    pieceName: 'croquetas',
    confidence: 'high',
    notes: '',
    reviewed_by: 'pbojeda',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Header validation
// ---------------------------------------------------------------------------

describe('validateCsvHeader', () => {
  it('returns null for a valid header row', () => {
    const header = ['dishId', 'term', 'grams', 'pieces', 'pieceName', 'confidence', 'notes', 'reviewed_by'];
    expect(validateCsvHeader(header)).toBeNull();
  });

  it('returns an error when a required column is missing', () => {
    const header = ['dishId', 'term', 'grams', 'pieces', 'pieceName', 'confidence', 'notes'];
    // missing reviewed_by
    const result = validateCsvHeader(header);
    expect(result).not.toBeNull();
    expect(result).toContain('reviewed_by');
  });

  it('returns an error for an unexpected extra column', () => {
    const header = ['dishId', 'term', 'grams', 'pieces', 'pieceName', 'confidence', 'notes', 'reviewed_by', 'extra_col'];
    const result = validateCsvHeader(header);
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Row-level validation
// ---------------------------------------------------------------------------

describe('validateCsvRows', () => {
  it('returns no errors for a valid reviewed row', () => {
    const { errors } = validateCsvRows([validRow()]);
    expect(errors).toHaveLength(0);
  });

  it('returns no errors for a valid unreviewed row (reviewed_by is empty)', () => {
    const { errors } = validateCsvRows([validRow({ reviewed_by: '' })]);
    expect(errors).toHaveLength(0);
  });

  it('errors on invalid UUID dishId (M1-3 fix: must be UUID, not integer)', () => {
    const { errors } = validateCsvRows([validRow({ dishId: '123' })]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/row 1.*dishId.*UUID/i);
  });

  it('errors on invalid term', () => {
    const { errors } = validateCsvRows([validRow({ term: 'bocadillo' })]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/row 1.*term/i);
  });

  it('errors on grams = 0', () => {
    const { errors } = validateCsvRows([validRow({ grams: '0' })]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/row 1.*grams/i);
  });

  it('errors on negative grams', () => {
    const { errors } = validateCsvRows([validRow({ grams: '-1' })]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/row 1.*grams/i);
  });

  it('errors when pieces is set but pieceName is empty', () => {
    const { errors } = validateCsvRows([validRow({ pieces: '2', pieceName: '' })]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/row 1.*(pieces|pieceName)/i);
  });

  it('errors when pieceName is set but pieces is empty', () => {
    const { errors } = validateCsvRows([validRow({ pieces: '', pieceName: 'croqueta' })]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/row 1.*(pieces|pieceName)/i);
  });

  it('errors on invalid confidence value', () => {
    const { errors } = validateCsvRows([validRow({ confidence: 'excellent' })]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/row 1.*confidence/i);
  });

  it('errors on duplicate (dishId, term) pair', () => {
    const { errors } = validateCsvRows([
      validRow({ dishId: VALID_UUID_1, term: 'tapa' }),
      validRow({ dishId: VALID_UUID_1, term: 'tapa' }), // duplicate
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/row (1|2).*duplicate/i);
  });

  it('still errors on malformed unreviewed row (reviewed_by=null does NOT silently skip validation)', () => {
    const { errors } = validateCsvRows([validRow({ dishId: 'abc', reviewed_by: '' })]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/row 1.*dishId.*UUID/i);
  });

  it('returns correct toSeed and toSkip partition', () => {
    const rows = [
      validRow({ dishId: VALID_UUID_1, term: 'tapa', reviewed_by: 'pbojeda' }),
      validRow({ dishId: VALID_UUID_2, term: 'racion', reviewed_by: '' }), // unreviewed
    ];
    const { errors, toSeed, toSkip } = validateCsvRows(rows);
    expect(errors).toHaveLength(0);
    expect(toSeed).toHaveLength(1);
    expect(toSkip).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// seedFromParsedRows — with mocked Prisma
// ---------------------------------------------------------------------------

describe('seedFromParsedRows', () => {
  const mockPrisma = {
    standardPortion: {
      upsert: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts each reviewed row via Prisma', async () => {
    const toSeed = [validRow({ dishId: VALID_UUID_1, term: 'tapa', reviewed_by: 'pbojeda' })];
    const summary = await seedFromParsedRows(mockPrisma as never, toSeed, 0);
    expect(mockPrisma.standardPortion.upsert).toHaveBeenCalledTimes(1);
    expect(summary.seeded).toBe(1);
    expect(summary.skipped).toBe(0);
  });

  it('returns correct summary with skipped rows', async () => {
    const summary = await seedFromParsedRows(mockPrisma as never, [], 3);
    expect(mockPrisma.standardPortion.upsert).not.toHaveBeenCalled();
    expect(summary.seeded).toBe(0);
    expect(summary.skipped).toBe(3);
  });

  it('formats summary string correctly', async () => {
    const summary = await seedFromParsedRows(mockPrisma as never, [
      validRow({ dishId: VALID_UUID_1, term: 'tapa', reviewed_by: 'pbojeda' }),
    ], 2);
    expect(summary.message).toMatch(/Seeded 1 rows\. Skipped 2 unreviewed rows.*0 errors/);
  });

  it('handles empty input (seeded 0 + skipped 0)', async () => {
    const summary = await seedFromParsedRows(mockPrisma as never, [], 0);
    expect(summary.seeded).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(summary.message).toMatch(/Seeded 0 rows\. Skipped 0 unreviewed rows.*0 errors/);
  });
});
