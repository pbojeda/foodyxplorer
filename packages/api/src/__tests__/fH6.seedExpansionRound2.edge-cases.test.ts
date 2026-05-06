/**
 * F-H6 — Seed expansion round-2 edge-case tests.
 *
 * QA verification for the 28 new dish atoms (CE-280..CE-307) and 6 alias
 * additions on existing dishes.  All tests are data-only (no DB, no HTTP).
 *
 * Checks:
 *   H6-EC-1  No duplicate name/nameEs/alias across all 319 entries
 *   H6-EC-2  All 28 new dishes have correct source/confidence/method triple
 *   H6-EC-3  All 28 new dishes are within their spec kcal/100g ranges
 *   H6-EC-4  CSV pieces/pieceName invariant holds for all new rows
 *   H6-EC-5  No new CSV rows have empty reviewed_by
 *   H6-EC-6  Every new dishId has at least 2 standard_portion rows
 *   H6-EC-7  ADR-019: bare family terms not used as aliases
 *   H6-EC-8  REMOVED — CE-281 collapsed into CE-095 by BUG-DATA-DUPLICATE-ATOM-001 (2026-04-28); disambiguation no longer applies
 *   H6-EC-9  6 alias additions on existing dishes are present
 *   H6-EC-10 Spec-required aliases on new dishes are present
 *   H6-EC-11 CE-280..CE-307 minus CE-281 (collapsed) appear in monotonic order at file end
 *   H6-EC-12 Level1Lookup simulation for 5 random new atoms
 */

import { readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { validateSpanishDishes } from '../scripts/validateSpanishDishes.js';
import { parseCsvString } from '../scripts/seedStandardPortionCsv.js';
import type { SpanishDishEntry } from '../scripts/spanishDishesTypes.js';

// ---------------------------------------------------------------------------
// File paths
// ---------------------------------------------------------------------------

const DATA_DIR = process.cwd().includes('packages/api') ? '.' : 'packages/api';
const JSON_PATH = path.resolve(DATA_DIR, 'prisma/seed-data/spanish-dishes.json');
const CSV_PATH = path.resolve(DATA_DIR, 'prisma/seed-data/standard-portions.csv');

// ---------------------------------------------------------------------------
// Load data once
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

const NEW_CE_RANGE = { min: 280, max: 307 } as const;

function ceNum(d: SpanishDishEntry): number {
  return parseInt(d.externalId.replace('CE-', ''), 10);
}

function isNew(d: SpanishDishEntry): boolean {
  const n = ceNum(d);
  return n >= NEW_CE_RANGE.min && n <= NEW_CE_RANGE.max;
}

/** hex suffix of the dishId UUID (last 3 chars) for CE-N where N is 280..307 */
function hexSuffix(ceNumber: number): string {
  const base = 0x118; // CE-280
  const offset = ceNumber - 280;
  return (base + offset).toString(16).padStart(3, '0');
}

function newCsvRows(): CsvRow[] {
  const suffixes = new Set(
    Array.from({ length: 28 }, (_, i) => hexSuffix(280 + i)),
  );
  return csvRows.filter((r) =>
    [...suffixes].some((s) => r.dishId.endsWith(s)),
  );
}

// level-1 exact-match lookup simulation
function level1Lookup(query: string): SpanishDishEntry[] {
  const q = query.toLowerCase().trim();
  return dishes.filter(
    (d) =>
      d.name.toLowerCase() === q ||
      d.nameEs.toLowerCase() === q ||
      (d.aliases ?? []).some((a) => a.toLowerCase() === q),
  );
}

// ---------------------------------------------------------------------------
// H6-EC-1  No duplicate tokens across all 319 entries
// History: 317 (post-F-H9) → 316 (CE-281 collapsed by BUG-DATA-DUPLICATE-ATOM-001 2026-04-28)
//          → 319 (+3 charcuterie atoms CE-318/319/320 by F-CHARCUTERIE-001 2026-04-29)
// ---------------------------------------------------------------------------

describe('H6-EC-1: no duplicate name/nameEs/alias across 319 entries', () => {
  it('validateSpanishDishes returns valid: true with 0 errors on the full 319-entry dataset', () => {
    const result = validateSpanishDishes(dishes);
    expect(result.valid, result.errors.join('\n')).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('total dish count is 319', () => {
    expect(dishes).toHaveLength(319);
  });
});

// ---------------------------------------------------------------------------
// H6-EC-2  Source/confidence/estimationMethod triple on all 28 new dishes
// ---------------------------------------------------------------------------

describe('H6-EC-2: source/confidence/estimationMethod triple', () => {
  const newDishes = dishes.filter(isNew);

  it('exactly 27 new dishes are present (CE-280..CE-307 minus CE-281 collapsed by BUG-DATA-DUPLICATE-ATOM-001)', () => {
    expect(newDishes).toHaveLength(27);
  });

  it.each(newDishes.map((d) => [d.externalId, d] as [string, SpanishDishEntry]))(
    '%s has source=recipe, confidenceLevel=medium, estimationMethod=ingredients',
    (_eid, d) => {
      expect(d.source).toBe('recipe');
      expect(d.confidenceLevel).toBe('medium');
      expect(d.estimationMethod).toBe('ingredients');
    },
  );
});

// ---------------------------------------------------------------------------
// H6-EC-3  kcal/100g within spec ranges
// ---------------------------------------------------------------------------

const KCAL_RANGES: Record<string, [number, number]> = {
  'CE-280': [250, 320], // Pescaíto frito
  // CE-281 collapsed into CE-095 by BUG-DATA-DUPLICATE-ATOM-001 (2026-04-28) — kcal range removed
  'CE-282': [370, 430], // Sobrassada con miel
  'CE-283': [80, 130],  // Gazpachuelo malagueño
  'CE-284': [110, 170], // Berza jerezana
  'CE-285': [280, 350], // Talo con chistorra
  'CE-286': [370, 430], // Casadielles
  'CE-287': [340, 390], // Fartons
  'CE-288': [80, 160],  // Poke bowl
  'CE-289': [180, 260], // Burrito de cochinita pibil
  'CE-290': [60, 110],  // Ramen de miso
  'CE-291': [150, 220], // Pad thai
  'CE-292': [200, 280], // Shawarma de pollo
  'CE-293': [280, 330], // Falafel
  'CE-294': [320, 380], // Pastel de nata
  'CE-295': [150, 200], // Nigiri de pez mantequilla
  'CE-296': [160, 220], // Uramaki roll
  'CE-297': [220, 290], // Tacos al pastor
  'CE-298': [230, 290], // Bao de panceta
  'CE-299': [200, 260], // Arepa de reina pepiada
  'CE-300': [190, 240], // Gyozas
  'CE-301': [70, 120],  // Ceviche
  'CE-302': [140, 200], // Musaka
  'CE-303': [160, 200], // Hummus
  'CE-304': [120, 180], // Tataki de atún
  'CE-305': [180, 240], // Steak tartar
  'CE-306': [120, 180], // Carpaccio
};

describe('H6-EC-3: kcal/100g within spec sanity ranges', () => {
  const newDishes = dishes.filter(isNew);

  it.each(
    newDishes
      .filter((d) => d.externalId in KCAL_RANGES)
      .map((d) => [d.externalId, d] as [string, SpanishDishEntry]),
  )('%s kcal/100g is within spec range', (_eid, d) => {
    const [lo, hi] = KCAL_RANGES[d.externalId];
    const per100 = (d.nutrients.calories / d.portionGrams) * 100;
    expect(per100).toBeGreaterThanOrEqual(lo);
    expect(per100).toBeLessThanOrEqual(hi);
  });
});

// ---------------------------------------------------------------------------
// H6-EC-4  pieces/pieceName invariant in CSV
// ---------------------------------------------------------------------------

describe('H6-EC-4: CSV pieces/pieceName invariant', () => {
  it('no new CSV row has pieces without pieceName or pieceName without pieces', () => {
    const violations = newCsvRows().filter((r) => {
      const hasPieces = r.pieces.trim() !== '';
      const hasPieceName = r.pieceName.trim() !== '';
      return hasPieces !== hasPieceName;
    });
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// H6-EC-5  No new CSV rows with empty reviewed_by
// ---------------------------------------------------------------------------

describe('H6-EC-5: reviewed_by non-empty on all new CSV rows', () => {
  it('every new standard-portions row has reviewed_by set', () => {
    const empty = newCsvRows().filter((r) => r.reviewed_by.trim() === '');
    expect(empty).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// H6-EC-6  Every new dishId has at least 2 portion rows
// ---------------------------------------------------------------------------

describe('H6-EC-6: minimum 2 portion rows per new dish', () => {
  it('no new dish has fewer than 2 standard-portion rows', () => {
    const rowsForNew = newCsvRows();
    const underCovered: string[] = [];

    for (let n = 280; n <= 307; n++) {
      // BUG-DATA-DUPLICATE-ATOM-001 (2026-04-28): CE-281 collapsed into CE-095.
      // Skip its hex suffix here so the "≥ 2 rows" assertion does not enforce
      // orphan portion rows that would FK-violate at deploy time.
      if (n === 281) continue;
      const suf = hexSuffix(n);
      const rows = rowsForNew.filter((r) => r.dishId.endsWith(suf));
      if (rows.length < 2) {
        underCovered.push(`CE-${n}: ${rows.length} rows`);
      }
    }

    expect(underCovered).toHaveLength(0);
  });

  it('CE-281 hex suffix has ZERO portion rows (orphan-row regression guard)', () => {
    const rowsForNew = newCsvRows();
    const ce281Suffix = hexSuffix(281);
    const orphans = rowsForNew.filter((r) => r.dishId.endsWith(ce281Suffix));
    expect(orphans).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// H6-EC-7  ADR-019: bare family terms not used as aliases
// ---------------------------------------------------------------------------

const FORBIDDEN_BARE_ALIASES = [
  'hamburguesa',
  'nigiri',
  'tacos',
  'bao',
  'arepa',
  'ramen',
  'burrito',
  'sushi',
  'carpaccio',
  'tataki',
  'uramaki',
  'shawarma',
];

describe('H6-EC-7: ADR-019 — bare family terms absent from aliases', () => {
  it.each(FORBIDDEN_BARE_ALIASES.map((t) => [t]))(
    '"%s" is not used as an alias on any dish',
    (term) => {
      const matches = dishes.filter((d) =>
        (d.aliases ?? []).some((a) => a.toLowerCase() === term.toLowerCase()),
      );
      expect(matches.map((d) => d.externalId)).toHaveLength(0);
    },
  );
});

// ---------------------------------------------------------------------------
// H6-EC-8  CE-281 collapsed into CE-095 (BUG-DATA-DUPLICATE-ATOM-001 2026-04-28)
//          The two atoms represented the same Catalan codfish salad — duplicate
//          retired in favor of alias migration onto CE-095.
// ---------------------------------------------------------------------------

describe('H6-EC-8: CE-281 collapsed into CE-095', () => {
  it('CE-281 no longer exists in the dataset', () => {
    const ce281 = dishes.find((d) => d.externalId === 'CE-281');
    expect(ce281).toBeUndefined();
  });

  it('CE-095 absorbs the Catalan-spelling aliases that were on CE-281', () => {
    const ce095 = dishes.find((d) => d.externalId === 'CE-095');
    expect(ce095).toBeDefined();
    const aliases = (ce095!.aliases ?? []).map((a) => a.toLowerCase());
    expect(aliases).toContain('esqueixada de bacallà');
    expect(aliases).toContain('esqueixada de bacalà');
    expect(aliases).toContain('esqueixada catalana');
  });

  it('bare "esqueixada" resolves to CE-095', () => {
    const matches = level1Lookup('esqueixada');
    expect(matches.map((d) => d.externalId)).toEqual(['CE-095']);
  });

  it('Catalan-spelling "esqueixada de bacallà" also resolves to CE-095 post-collapse', () => {
    const matches = level1Lookup('esqueixada de bacallà');
    expect(matches.map((d) => d.externalId)).toEqual(['CE-095']);
  });
});

// ---------------------------------------------------------------------------
// H6-EC-9  6 alias additions on existing dishes are present
// ---------------------------------------------------------------------------

const ALIAS_ADDITIONS: Array<{ eid: string; alias: string }> = [
  { eid: 'CE-092', alias: 'escalivada con anchoas' },
  { eid: 'CE-128', alias: 'cachopo para compartir' },
  { eid: 'CE-140', alias: 'spaghetti carbonara' },
  { eid: 'CE-140', alias: 'spaguetis carbonara' },
  { eid: 'CE-217', alias: 'hamburguesa gourmet' },
  { eid: 'CE-267', alias: 'empanada gallega de zamburiñas' },
  { eid: 'CE-277', alias: 'ensaimada de crema' },
];

describe('H6-EC-9: alias additions on existing dishes', () => {
  it.each(ALIAS_ADDITIONS.map((e) => [e.eid, e.alias]))(
    '%s has alias "%s"',
    (eid, alias) => {
      const d = dishes.find((x) => x.externalId === eid);
      expect(d).toBeDefined();
      const aliases = (d!.aliases ?? []).map((a) => a.toLowerCase());
      expect(aliases).toContain(alias.toLowerCase());
    },
  );

  it('CE-217 does NOT have bare "hamburguesa" as alias (ADR-019)', () => {
    const ce217 = dishes.find((d) => d.externalId === 'CE-217');
    const aliases = (ce217!.aliases ?? []).map((a) => a.toLowerCase());
    expect(aliases).not.toContain('hamburguesa');
  });
});

// ---------------------------------------------------------------------------
// H6-EC-10  Spec-required aliases on new dishes
// ---------------------------------------------------------------------------

const REQUIRED_ALIASES: Array<{ eid: string; alias: string }> = [
  { eid: 'CE-288', alias: 'poke bowl de salmón' },
  { eid: 'CE-291', alias: 'pad thai de langostinos' },
  { eid: 'CE-291', alias: 'pad thai de gambas' },
  { eid: 'CE-292', alias: 'shawarma de pollo solo carne' },
  { eid: 'CE-293', alias: 'falafel con tahini' },
  { eid: 'CE-293', alias: 'falafel vegano' },
  { eid: 'CE-293', alias: 'falafel con salsa de yogur' },
  { eid: 'CE-294', alias: 'pastéis de nata' },
  { eid: 'CE-294', alias: 'pastel de belém' },
  { eid: 'CE-295', alias: 'nigiri de pez mantequilla con trufa' },
  { eid: 'CE-295', alias: 'nigiris de pez mantequilla' },
  { eid: 'CE-295', alias: 'sushi de pez mantequilla' },
  { eid: 'CE-296', alias: 'uramaki roll de atún' },
  { eid: 'CE-296', alias: 'uramaki roll de atún picante' },
  { eid: 'CE-297', alias: 'taco al pastor' },
  { eid: 'CE-298', alias: 'bao chino' },
  { eid: 'CE-299', alias: 'reina pepiada' },
  { eid: 'CE-300', alias: 'gyoza' },
  { eid: 'CE-300', alias: 'dumplings japoneses' },
  { eid: 'CE-300', alias: 'empanadillas japonesas' },
  { eid: 'CE-301', alias: 'ceviche de corvina' },
  { eid: 'CE-301', alias: 'ceviche peruano' },
  { eid: 'CE-302', alias: 'moussaka' },
  { eid: 'CE-302', alias: 'musaca' },
  { eid: 'CE-302', alias: 'musaka griega' },
  { eid: 'CE-303', alias: 'humus' },
  { eid: 'CE-303', alias: 'hummus con pan de pita' },
  { eid: 'CE-304', alias: 'tataki de atún rojo' },
  { eid: 'CE-305', alias: 'tartar de ternera' },
  { eid: 'CE-305', alias: 'tartar de buey' },
  { eid: 'CE-305', alias: 'steak tartare' },
  { eid: 'CE-306', alias: 'carpaccio de ternera' },
  { eid: 'CE-306', alias: 'carpaccio de buey' },
];

describe('H6-EC-10: spec-required aliases on new dishes', () => {
  it.each(REQUIRED_ALIASES.map((e) => [e.eid, e.alias]))(
    '%s has spec-required alias "%s"',
    (eid, alias) => {
      const d = dishes.find((x) => x.externalId === eid);
      expect(d).toBeDefined();
      const aliases = (d!.aliases ?? []).map((a) => a.toLowerCase());
      expect(aliases).toContain(alias.toLowerCase());
    },
  );

  it('CE-295 does NOT have bare "nigiri" as alias (ADR-019)', () => {
    const ce295 = dishes.find((d) => d.externalId === 'CE-295');
    const aliases = (ce295!.aliases ?? []).map((a) => a.toLowerCase());
    expect(aliases).not.toContain('nigiri');
  });

  it('CE-296 does NOT have bare "uramaki" as alias (ADR-019)', () => {
    const ce296 = dishes.find((d) => d.externalId === 'CE-296');
    const aliases = (ce296!.aliases ?? []).map((a) => a.toLowerCase());
    expect(aliases).not.toContain('uramaki');
  });

  it('CE-304 does NOT have bare "tataki" as alias (ADR-019)', () => {
    const ce304 = dishes.find((d) => d.externalId === 'CE-304');
    const aliases = (ce304!.aliases ?? []).map((a) => a.toLowerCase());
    expect(aliases).not.toContain('tataki');
  });

  it('CE-297 does NOT have bare "tacos" as alias (ADR-019)', () => {
    const ce297 = dishes.find((d) => d.externalId === 'CE-297');
    const aliases = (ce297!.aliases ?? []).map((a) => a.toLowerCase());
    expect(aliases).not.toContain('tacos');
  });
});

// ---------------------------------------------------------------------------
// H6-EC-11  CE-280..CE-307 in monotonic order at file end
// ---------------------------------------------------------------------------

describe('H6-EC-11: monotonic CE-280..CE-307 sequence at file end (minus CE-281)', () => {
  it('the F-H6 batch (CE-280..CE-307 except CE-281) remains in monotonic order at its appended position', () => {
    // Future-proof: locate CE-280 by externalId rather than negative-index slicing.
    // Negative slices break silently when subsequent batches (F-H9, F-H10, ...) append more atoms.
    // BUG-DATA-DUPLICATE-ATOM-001 (2026-04-28): CE-281 collapsed into CE-095. The expected sequence
    // skips CE-281 — the remaining 27 atoms still appear in monotonic order.
    const start = dishes.findIndex((d) => d.externalId === 'CE-280');
    expect(start, 'CE-280 not found in dataset').toBeGreaterThanOrEqual(0);
    const fH6Batch = dishes.slice(start, start + 27);
    const eids = fH6Batch.map((d) => d.externalId);
    const expected = Array.from({ length: 28 }, (_, i) => `CE-${280 + i}`).filter((eid) => eid !== 'CE-281');
    expect(eids).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// H6-EC-12  Level1Lookup simulation for key new atoms
// ---------------------------------------------------------------------------

describe('H6-EC-12: level1Lookup simulation', () => {
  const cases: Array<[string, string]> = [
    ['talo con chistorra', 'CE-285'],
    ['falafel', 'CE-293'],
    ['gyozas', 'CE-300'],
    ['musaka', 'CE-302'],
    ['chorizo a la sidra', 'CE-307'],
    ['falafel con salsa de yogur', 'CE-293'],
    ['moussaka', 'CE-302'],
    ['taco al pastor', 'CE-297'],
    ['gyoza', 'CE-300'],
    ['poke bowl de salmón', 'CE-288'],
    ['esqueixada de bacallà', 'CE-095'], // BUG-DATA-DUPLICATE-ATOM-001: was CE-281 pre-2026-04-28 collapse
    ['esqueixada de bacalao', 'CE-095'],
  ];

  it.each(cases)(
    'query "%s" resolves exactly to %s',
    (query, expectedEid) => {
      const matches = level1Lookup(query);
      expect(matches.map((d) => d.externalId)).toEqual([expectedEid]);
    },
  );
});
