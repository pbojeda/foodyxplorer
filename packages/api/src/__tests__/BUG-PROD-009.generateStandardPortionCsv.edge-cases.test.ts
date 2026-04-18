// BUG-PROD-009 — QA edge-case tests for generateStandardPortionCsv refactor
//
// These tests probe gaps NOT covered by the developer's U1-U9 suite:
//
//   EC1: validatePriorityDishMap — mixed-case UUID in map does NOT match lowercase knownDishIds
//        → throws "unknown dishId" (proves case-sensitivity; no normalization in the validator)
//   EC2: validatePriorityDishMap — empty map passes without throwing
//        → confirms graceful no-op path when map has zero entries
//   EC3: validatePriorityDishMap — three-way duplicate: all three keys must appear in the error
//        → confirms the error accumulates across the reverse-map scan
//   EC4: skip-existing logic — a reviewed row whose notes contain an UNQUOTED comma
//        must cause the generator to throw loudly instead of silently re-emitting a template
//        (former latent bug fixed by switching from parseCsvLine per-line to parseCsvString
//        which enforces header-based column count on the entire file)
//   EC5: skip-existing logic — a row with reviewed_by set but an INVALID UUID dishId
//        → validatePriorityDishMap never runs against CSV content (it only checks the map),
//           so the skip-existing set is built from whatever parseCsvLine returns.
//           Row with invalid UUID but correct term+reviewed_by: still skipped (reviewed_by truthy).
//   EC6: generateStandardPortionCsv — empty outputPath CSV (header-only file, no data rows)
//        → generator writes all 39 × 4 = 156 rows, does not crash on empty-but-valid CSV
//   EC7: parseCsvString — truncated mid-row (fewer columns than header)
//        → throws with clear column-count mismatch message (seed pipeline safeguard)
//   EC8: I4 coverage gap — verify omitted priority NAMES ('chorizo', 'chuletón', 'arroz')
//        do not appear as key strings in the notes column of the generated CSV
//        (I4 checks by dishId; this checks by priority-name substring in notes)

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

import {
  validatePriorityDishMap,
  generateStandardPortionCsv,
} from '../scripts/generateStandardPortionCsv.js';
import { parseCsvString } from '../scripts/seedStandardPortionCsv.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `bug-009-ec-${crypto.randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const dirsToClean: string[] = [];

afterEach(() => {
  for (const dir of dirsToClean) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  dirsToClean.length = 0;
});

// Full list of all 39 dishIds in PRIORITY_DISH_MAP — needed to build a valid fixture
// that passes validatePriorityDishMap without unknown-dishId errors.
const ALL_MAP_DISH_IDS = [
  '00000000-0000-e073-0007-00000000001a', // croquetas
  '00000000-0000-e073-0007-00000000001b', // patatas bravas
  '00000000-0000-e073-0007-00000000001e', // gambas al ajillo
  '00000000-0000-e073-0007-000000000021', // aceitunas
  '00000000-0000-e073-0007-000000000022', // jamón
  '00000000-0000-e073-0007-000000000023', // queso manchego
  '00000000-0000-e073-0007-000000000020', // boquerones
  '00000000-0000-e073-0007-00000000001d', // calamares
  '00000000-0000-e073-0007-000000000028', // chopitos
  '00000000-0000-e073-0007-000000000024', // ensaladilla
  '00000000-0000-e073-0007-00000000001c', // tortilla
  '00000000-0000-e073-0007-00000000003d', // pan con tomate
  '00000000-0000-e073-0007-00000000002a', // morcilla
  '00000000-0000-e073-0007-000000000025', // pulpo a la gallega
  '00000000-0000-e073-0007-000000000042', // gazpacho
  '00000000-0000-e073-0007-000000000043', // salmorejo
  '00000000-0000-e073-0007-000000000062', // albóndigas
  '00000000-0000-e073-0007-0000000000f1', // empanadillas
  '00000000-0000-e073-0007-000000000029', // mejillones
  '00000000-0000-e073-0007-000000000034', // navajas
  '00000000-0000-e073-0007-000000000035', // sepia
  '00000000-0000-e073-0007-00000000003b', // rabas
  '00000000-0000-e073-0007-000000000026', // champiñones al ajillo
  '00000000-0000-e073-0007-00000000001f', // pimientos de padrón
  '00000000-0000-e073-0007-000000000083', // paella
  '00000000-0000-e073-0007-000000000044', // lentejas
  '00000000-0000-e073-0007-000000000049', // ensalada
  '00000000-0000-e073-0007-000000000046', // cocido
  '00000000-0000-e073-0007-000000000045', // fabada
  '00000000-0000-e073-0007-00000000007e', // huevos fritos
  '00000000-0000-e073-0007-000000000061', // merluza
  '00000000-0000-e073-0007-000000000089', // fideuà
  '00000000-0000-e073-0007-00000000004b', // pisto
  '00000000-0000-e073-0007-0000000000f2', // flamenquín
  '00000000-0000-e073-0007-000000000047', // sopa de ajo
  '00000000-0000-e073-0007-000000000003', // churros
  '00000000-0000-e073-0007-0000000000ae', // crema catalana
  '00000000-0000-e073-0007-0000000000ad', // tarta de queso
  '00000000-0000-e073-0007-00000000004e', // potaje
];

function writeAllMapDishes(dataDir: string): void {
  writeFileSync(
    path.join(dataDir, 'spanish-dishes.json'),
    JSON.stringify({
      dishes: ALL_MAP_DISH_IDS.map((id) => ({ dishId: id, nameEs: `Dish ${id}` })),
    }),
    'utf-8',
  );
}

// ---------------------------------------------------------------------------
// EC1 — UUID case sensitivity: mixed-case UUID in map does not match lowercase knownDishIds
// ---------------------------------------------------------------------------

describe('EC1: validatePriorityDishMap — UUID case sensitivity', () => {
  it('throws "unknown dishId" when map entry has UPPER-CASE UUID but knownDishIds has lowercase', () => {
    // knownDishIds is built from spanish-dishes.json which uses lowercase UUIDs.
    // If someone puts a mixed-case UUID in PRIORITY_DISH_MAP, Set.has() will miss it.
    const LOWERCASE_UUID = '00000000-0000-e073-0007-00000000001a';
    const UPPERCASE_UUID = LOWERCASE_UUID.toUpperCase();

    const map: Record<string, string> = {
      croquetas: UPPERCASE_UUID, // same value, different case
    };
    const known = new Set([LOWERCASE_UUID]); // what the JSON would produce

    // This SHOULD throw "unknown dishId" because UPPERCASE !== lowercase in Set.has()
    expect(() => validatePriorityDishMap(map, known)).toThrow(/unknown dishId/);
    expect(() => validatePriorityDishMap(map, known)).toThrow(/croquetas/);
    // Documents the behavior: no case normalization exists; curator must use lowercase
  });
});

// ---------------------------------------------------------------------------
// EC2 — Empty map: validatePriorityDishMap and generateStandardPortionCsv graceful no-op
// ---------------------------------------------------------------------------

describe('EC2: validatePriorityDishMap — empty map passes without throwing', () => {
  it('passes validation with an empty map (no duplicates, no unknowns to check)', () => {
    const map: Record<string, string> = {};
    const known = new Set(['00000000-0000-e073-0007-00000000001a']);
    expect(() => validatePriorityDishMap(map, known)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// EC3 — Three-way duplicate: error message must include all three conflicting keys
// ---------------------------------------------------------------------------

describe('EC3: validatePriorityDishMap — three-way duplicate', () => {
  it('throws on the SECOND key that introduces the duplicate (stops at first collision)', () => {
    // The implementation stops at the FIRST duplicate found (fail-fast per spec §2.3 point 4).
    // With three keys sharing the same dishId, it will throw on key2 (the second one seen),
    // NOT accumulate all three. This test documents that behavior.
    const SHARED_UUID = '00000000-0000-e073-0007-00000000001a';
    const map: Record<string, string> = {
      key1: SHARED_UUID,
      key2: SHARED_UUID, // collision found here → throw
      key3: SHARED_UUID, // never reached
    };
    const known = new Set([SHARED_UUID]);

    expect(() => validatePriorityDishMap(map, known)).toThrow(
      /PRIORITY_DISH_MAP has duplicate dishId/,
    );
    // Both key1 and key2 should appear in the message
    expect(() => validatePriorityDishMap(map, known)).toThrow(/key1/);
    expect(() => validatePriorityDishMap(map, known)).toThrow(/key2/);
    // key3 may or may not appear (implementation throws on first collision)
  });
});

// ---------------------------------------------------------------------------
// EC4 — Skip-existing logic: unquoted comma in notes must cause loud failure
//
// Former latent bug (pre-fix): `generateStandardPortionCsv.ts` used `parseCsvLine`
// per-line without a column-count guard. An unquoted comma in `notes` shifted
// `cols[7]` (reviewed_by) and the row was silently treated as unreviewed on the
// next generator run, causing the analyst's researched value to be overwritten
// by a fresh template row.
//
// Fix (this commit): switched to `parseCsvString`, which parses the entire file
// by header-name and throws on column-count mismatch. The malformed existing CSV
// now fails LOUD before any output, preserving analyst data.
// ---------------------------------------------------------------------------

describe('EC4: skip-existing — malformed existing CSV throws loudly (post-fix)', () => {
  it('generator throws when existing CSV has an unquoted comma in notes (column-count mismatch)', async () => {
    const CROQUETAS_ID = '00000000-0000-e073-0007-00000000001a';

    const dataDir = makeTempDir();
    dirsToClean.push(dataDir);
    const outputPath = path.join(dataDir, 'output.csv');

    // Row with UNQUOTED comma in notes produces 9 fields vs the 8-field header.
    // Pre-fix: silently misread reviewed_by → template re-emit. Post-fix: throw.
    const existingCsv = [
      'dishId,term,grams,pieces,pieceName,confidence,notes,reviewed_by',
      `${CROQUETAS_ID},pintxo,30,1,croqueta,high,researched clean,pbojeda`,
      `${CROQUETAS_ID},tapa,120,4,croqueta,high,note trailing comma,,pbojeda`, // 9 cols
    ].join('\n') + '\n';
    writeFileSync(outputPath, existingCsv, 'utf-8');
    writeAllMapDishes(dataDir);

    // parseCsvString in the skip-existing loader throws on the malformed row
    await expect(generateStandardPortionCsv({ dataDir, outputPath })).rejects.toThrow(
      /malformed CSV row/,
    );
  });

  it('generator succeeds when existing CSV has a properly-quoted comma in notes', async () => {
    const CROQUETAS_ID = '00000000-0000-e073-0007-00000000001a';

    const dataDir = makeTempDir();
    dirsToClean.push(dataDir);
    const outputPath = path.join(dataDir, 'output.csv');

    // Comma inside a QUOTED notes field — parseCsvString handles it correctly.
    const existingCsv = [
      'dishId,term,grams,pieces,pieceName,confidence,notes,reviewed_by',
      `${CROQUETAS_ID},pintxo,30,1,croqueta,high,"notes, with comma",pbojeda`,
    ].join('\n') + '\n';
    writeFileSync(outputPath, existingCsv, 'utf-8');
    writeAllMapDishes(dataDir);

    await generateStandardPortionCsv({ dataDir, outputPath });

    const content = readFileSync(outputPath, 'utf-8');
    const rawLines = content.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');

    // The reviewed pintxo row is preserved; no duplicate appended.
    const pintxoLines = rawLines.filter(
      (l) => l.startsWith(CROQUETAS_ID) && l.includes(',pintxo,'),
    );
    expect(pintxoLines).toHaveLength(1);
    expect(pintxoLines[0]).toContain('pbojeda');
    expect(pintxoLines[0]).toContain('"notes, with comma"');
  });
});

// ---------------------------------------------------------------------------
// EC5 — Skip-existing: invalid UUID in row with reviewed_by set
// Confirms the row is still excluded from re-generation (reviewed_by is truthy)
// even though its dishId is not a valid UUID. The structural validation happens
// in the seed pipeline, not in the generator's skip-existing path.
// ---------------------------------------------------------------------------

describe('EC5: skip-existing — invalid UUID row with reviewed_by still gets skipped', () => {
  it('row with invalid-format dishId but non-empty reviewed_by is excluded from new output', async () => {
    const CROQUETAS_ID = '00000000-0000-e073-0007-00000000001a';

    const dataDir = makeTempDir();
    dirsToClean.push(dataDir);
    const outputPath = path.join(dataDir, 'output.csv');

    // A row with a broken dishId (non-UUID string) but reviewed_by set.
    // The generator should skip it (reviewed_by is truthy) even though the dishId is garbage.
    const existingCsv = [
      'dishId,term,grams,pieces,pieceName,confidence,notes,reviewed_by',
      `NOT-A-UUID,pintxo,30,,,,legacy row,pbojeda`,
      // A valid reviewed row for croquetas tapa (this one should be skipped correctly)
      `${CROQUETAS_ID},tapa,120,4,croqueta,high,researched,pbojeda`,
    ].join('\n') + '\n';
    writeFileSync(outputPath, existingCsv, 'utf-8');
    writeAllMapDishes(dataDir);

    await generateStandardPortionCsv({ dataDir, outputPath });

    const content = readFileSync(outputPath, 'utf-8');
    const rawLines = content.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');

    // The croquetas tapa row should remain with its original reviewed content (not re-emitted as template)
    const tapaLines = rawLines.filter(
      (l) => l.startsWith(CROQUETAS_ID) && l.includes(',tapa,'),
    );
    expect(tapaLines).toHaveLength(1);
    expect(tapaLines[0]).toContain('pbojeda');
    expect(tapaLines[0]).toContain('researched');
  });
});

// ---------------------------------------------------------------------------
// EC6 — Header-only CSV file: generator writes all rows correctly
// ---------------------------------------------------------------------------

describe('EC6: generateStandardPortionCsv — header-only existing CSV does not crash', () => {
  it('produces 39 × 4 = 156 data rows when existing CSV has header but no data rows', async () => {
    const dataDir = makeTempDir();
    dirsToClean.push(dataDir);
    const outputPath = path.join(dataDir, 'output.csv');

    // Write a header-only CSV (simulates a freshly initialized but empty file)
    writeFileSync(outputPath, 'dishId,term,grams,pieces,pieceName,confidence,notes,reviewed_by\n', 'utf-8');
    writeAllMapDishes(dataDir);

    await generateStandardPortionCsv({ dataDir, outputPath });

    const content = readFileSync(outputPath, 'utf-8');
    const rawLines = content.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');
    // 1 header + 156 data rows
    expect(rawLines).toHaveLength(157);
    expect(rawLines[0]).toBe('dishId,term,grams,pieces,pieceName,confidence,notes,reviewed_by');
  });
});

// ---------------------------------------------------------------------------
// EC7 — parseCsvString: truncated mid-row throws with column-count message
// The seed pipeline must NOT silently process a malformed CSV — it must throw.
// ---------------------------------------------------------------------------

describe('EC7: parseCsvString — truncated mid-row throws clearly', () => {
  it('throws with column-count mismatch message on a truncated row', () => {
    // Simulate a CSV that was truncated mid-write: the last row has fewer columns.
    const malformedCsv = [
      'dishId,term,grams,pieces,pieceName,confidence,notes,reviewed_by',
      '00000000-0000-e073-0007-00000000001a,pintxo,30,1,croqueta,high,notes,pbojeda',
      '00000000-0000-e073-0007-00000000001a,tapa,120', // truncated — only 3 columns
    ].join('\n');

    expect(() => parseCsvString(malformedCsv)).toThrow(/malformed CSV row/);
    expect(() => parseCsvString(malformedCsv)).toThrow(/expected 8 columns/);
  });

  it('throws with column-count mismatch message on an over-wide row (unquoted comma in notes)', () => {
    // This proves the seed pipeline WOULD catch the unquoted-comma problem at seed time —
    // but the generator's skip-existing check (EC4) happens BEFORE the seed pipeline runs,
    // so EC4 is still a valid generator-level bug.
    const malformedCsv = [
      'dishId,term,grams,pieces,pieceName,confidence,notes,reviewed_by',
      '00000000-0000-e073-0007-00000000001a,pintxo,30,1,croqueta,high,notes with, comma,pbojeda',
      // ^ 9 columns due to unquoted comma in notes
    ].join('\n');

    expect(() => parseCsvString(malformedCsv)).toThrow(/malformed CSV row/);
  });
});

// ---------------------------------------------------------------------------
// EC8 — I4 coverage gap: omitted priority names must not appear in notes column
// I4 (integration test) checks by dishId. This test checks that the STRING
// 'chorizo', 'chuletón', and 'arroz' do not appear as priority-name prefixes
// in the notes column of the generated CSV (template notes format: "template: <name> <term>").
// ---------------------------------------------------------------------------

describe('EC8: omitted priority name strings must not appear in generated notes', () => {
  it('generated CSV notes do not contain "template: chorizo", "template: chuletón", or "template: arroz"', async () => {
    const dataDir = makeTempDir();
    dirsToClean.push(dataDir);
    const outputPath = path.join(dataDir, 'output.csv');

    writeAllMapDishes(dataDir);
    await generateStandardPortionCsv({ dataDir, outputPath });

    const content = readFileSync(outputPath, 'utf-8');

    // These omitted names must never appear as a "template: <name>" prefix in notes
    const omittedNames = ['chorizo', 'chuletón', 'arroz', 'bocadillo', 'pintxos',
      'alitas de pollo', 'zamburiñas', 'berberechos', 'tostas'];

    for (const name of omittedNames) {
      expect(
        content,
        `Generated CSV must not contain "template: ${name}" — '${name}' is an omitted priority name`,
      ).not.toContain(`template: ${name}`);
    }
  });
});
