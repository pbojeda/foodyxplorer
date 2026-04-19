// F-UX-B — Unit tests for generateStandardPortionCsv refactor (BUG-PROD-009)
//
// Covers:
//   U1: validatePriorityDishMap — throws on duplicate dishId (both keys named)
//   U2: validatePriorityDishMap — throws on unknown dishId (orphan key named)
//   U3: validatePriorityDishMap — passes with valid map
//   U4: generateStandardPortionCsv — happy path: small fixture produces expected rows
//   U5: generateStandardPortionCsv — skip-existing: reviewed rows not overwritten
//   U6: isSinPieces — true for all sin-pieces members
//   U7: isSinPieces — false for non-sin-pieces members
//   U8: generateStandardPortionCsv — sin-pieces row format (grams=200, pieces empty, notes contains "sin pieces")
//   U9: generateStandardPortionCsv — non-sin-pieces row format (grams=50, notes has template prefix)

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { validatePriorityDishMap, generateStandardPortionCsv, isSinPieces } from '../scripts/generateStandardPortionCsv.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `f-ux-b-unit-${crypto.randomUUID()}`);
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

function writeFixtureDishes(
  dataDir: string,
  dishes: Array<{ dishId: string; nameEs: string; aliases?: string[] }>,
): void {
  writeFileSync(
    path.join(dataDir, 'spanish-dishes.json'),
    JSON.stringify({ dishes }),
    'utf-8',
  );
}

// ---------------------------------------------------------------------------
// Fixture dish IDs for unit tests (valid UUIDs, not in prod DB)
// ---------------------------------------------------------------------------

const DISH_A = 'fd000000-0001-4000-a000-000000000001'; // croquetas (countable)
const DISH_B = 'fd000000-0001-4000-a000-000000000002'; // gazpacho (sin pieces)
const DISH_C = 'fd000000-0001-4000-a000-000000000003'; // tortilla (countable)
const DISH_GHOST = 'fd000000-0001-4000-a000-000000000099'; // not in json

// ---------------------------------------------------------------------------
// U1 — validatePriorityDishMap throws on duplicate dishId
// ---------------------------------------------------------------------------

describe('validatePriorityDishMap', () => {
  it('U1: throws on duplicate dishId listing both keys', () => {
    const map: Record<string, string> = {
      croquetas: DISH_A,
      'croquetas-dup': DISH_A,
    };
    const known = new Set([DISH_A]);
    expect(() => validatePriorityDishMap(map, known)).toThrow(
      /PRIORITY_DISH_MAP has duplicate dishId/,
    );
    // Both key names must appear in the error message
    expect(() => validatePriorityDishMap(map, known)).toThrow(/croquetas/);
    expect(() => validatePriorityDishMap(map, known)).toThrow(/croquetas-dup/);
  });

  // ---------------------------------------------------------------------------
  // U2 — validatePriorityDishMap throws on unknown dishId
  // ---------------------------------------------------------------------------

  it('U2: throws on unknown dishId naming the orphan key', () => {
    const map: Record<string, string> = {
      orphanKey: DISH_GHOST,
    };
    const known = new Set([DISH_A]);
    expect(() => validatePriorityDishMap(map, known)).toThrow(
      /"orphanKey".*"fd000000-0001-4000-a000-000000000099"/,
    );
  });

  // ---------------------------------------------------------------------------
  // U3 — validatePriorityDishMap passes with valid map
  // ---------------------------------------------------------------------------

  it('U3: passes with valid map (no throw)', () => {
    const map: Record<string, string> = {
      croquetas: DISH_A,
      gazpacho: DISH_B,
      tortilla: DISH_C,
    };
    const known = new Set([DISH_A, DISH_B, DISH_C]);
    expect(() => validatePriorityDishMap(map, known)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// U4 — generateStandardPortionCsv: happy path
// ---------------------------------------------------------------------------

describe('generateStandardPortionCsv (file I/O)', () => {
  it('U4: happy path — 3 dishes × 4 terms = 12 rows plus header', async () => {
    const dataDir = makeTempDir();
    dirsToClean.push(dataDir);
    const outputPath = path.join(dataDir, 'output.csv');

    writeFixtureDishes(dataDir, [
      { dishId: DISH_A, nameEs: 'Croquetas de jamón' },
      { dishId: DISH_B, nameEs: 'Gazpacho andaluz' },
      { dishId: DISH_C, nameEs: 'Tortilla de patatas' },
    ]);

    // Use a small override map via opts (dataDir only contains these 3 dishes)
    // The generator will use the real PRIORITY_DISH_MAP but all its UUIDs won't
    // be in this small spanish-dishes.json — it will throw on unknown dishId.
    // Instead we test by providing a custom dishes fixture that matches a small
    // subset we pass as opts.priorityDishMap (we extend opts).
    // Since the plan says we can't easily override PRIORITY_DISH_MAP per test,
    // we write fixture dishes with UUIDs that ARE in the real PRIORITY_DISH_MAP
    // for croquetas (001a) and gazpacho (0042).
    const CROQUETAS_ID = '00000000-0000-e073-0007-00000000001a';
    const GAZPACHO_ID  = '00000000-0000-e073-0007-000000000042';
    const TORTILLA_ID  = '00000000-0000-e073-0007-00000000001c';

    writeFixtureDishes(dataDir, [
      { dishId: CROQUETAS_ID, nameEs: 'Croquetas de jamón' },
      { dishId: GAZPACHO_ID,  nameEs: 'Gazpacho andaluz' },
      { dishId: TORTILLA_ID,  nameEs: 'Tortilla de patatas' },
    ]);

    // Because the real PRIORITY_DISH_MAP has 39 entries but our fixture only has
    // 3, the generator will throw "unknown dishId" for all the other 36 entries.
    // We need to provide a fixture that has ALL dishIds in the real map, OR we need
    // the generator to accept an override map for testing.
    // Per the plan: "override map via opts.dataDir" — the generator reads from
    // spanish-dishes.json; we just need a fixture with all 39 real dishIds.
    // For this test, we provide only 3 and also patch the map via a test-friendly
    // re-export. The simplest approach: provide a minimal spanish-dishes.json
    // that contains ALL 42 dishIds from PRIORITY_DISH_MAP (39 original + 3 added by F114).
    // We'll populate the fixture with dummy dishes for the other 39 not under test.
    // This avoids needing to modify the generator's testability interface.

    const ALL_DISH_IDS = [
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
      '00000000-0000-e073-0007-0000000000fb', // chuletón de buey (F114)
      '00000000-0000-e073-0007-0000000000fc', // chorizo ibérico embutido (F114)
      '00000000-0000-e073-0007-0000000000e5', // arroz blanco (F114 reused)
    ];

    writeFileSync(
      path.join(dataDir, 'spanish-dishes.json'),
      JSON.stringify({
        dishes: ALL_DISH_IDS.map((id) => ({ dishId: id, nameEs: `Dish ${id}` })),
      }),
      'utf-8',
    );

    await generateStandardPortionCsv({ dataDir, outputPath });

    const content = readFileSync(outputPath, 'utf-8');
    const lines = content.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');

    // 1 header + 42 dishes × 4 terms = 169 lines (F114: was 157 with 39 dishes)
    expect(lines).toHaveLength(169);
    expect(lines[0]).toBe('dishId,term,grams,pieces,pieceName,confidence,notes,reviewed_by');

    // All rows for CROQUETAS_ID must appear
    const croquetasRows = lines.slice(1).filter((l) => l.startsWith(CROQUETAS_ID));
    expect(croquetasRows).toHaveLength(4);
  });

  // ---------------------------------------------------------------------------
  // U5 — skip-existing: reviewed rows not overwritten
  // ---------------------------------------------------------------------------

  it('U5: skip-existing — reviewed rows are not overwritten', async () => {
    const CROQUETAS_ID = '00000000-0000-e073-0007-00000000001a';

    const dataDir = makeTempDir();
    dirsToClean.push(dataDir);
    const outputPath = path.join(dataDir, 'output.csv');

    // Pre-populate CSV with 2 reviewed rows for CROQUETAS_ID:pintxo and :tapa
    const existingCsv = [
      'dishId,term,grams,pieces,pieceName,confidence,notes,reviewed_by',
      `${CROQUETAS_ID},pintxo,30,1,croqueta,high,"researched 2026-04-17",pbojeda`,
      `${CROQUETAS_ID},tapa,120,4,croqueta,high,"researched 2026-04-17",pbojeda`,
    ].join('\n') + '\n';
    writeFileSync(outputPath, existingCsv, 'utf-8');

    // Fixture with croquetas + all other 42 map entries (F114: was 39 dishes)
    const ALL_DISH_IDS = [
      '00000000-0000-e073-0007-00000000001a', // croquetas
      '00000000-0000-e073-0007-00000000001b', '00000000-0000-e073-0007-00000000001e',
      '00000000-0000-e073-0007-000000000021', '00000000-0000-e073-0007-000000000022',
      '00000000-0000-e073-0007-000000000023', '00000000-0000-e073-0007-000000000020',
      '00000000-0000-e073-0007-00000000001d', '00000000-0000-e073-0007-000000000028',
      '00000000-0000-e073-0007-000000000024', '00000000-0000-e073-0007-00000000001c',
      '00000000-0000-e073-0007-00000000003d', '00000000-0000-e073-0007-00000000002a',
      '00000000-0000-e073-0007-000000000025', '00000000-0000-e073-0007-000000000042',
      '00000000-0000-e073-0007-000000000043', '00000000-0000-e073-0007-000000000062',
      '00000000-0000-e073-0007-0000000000f1', '00000000-0000-e073-0007-000000000029',
      '00000000-0000-e073-0007-000000000034', '00000000-0000-e073-0007-000000000035',
      '00000000-0000-e073-0007-00000000003b', '00000000-0000-e073-0007-000000000026',
      '00000000-0000-e073-0007-00000000001f', '00000000-0000-e073-0007-000000000083',
      '00000000-0000-e073-0007-000000000044', '00000000-0000-e073-0007-000000000049',
      '00000000-0000-e073-0007-000000000046', '00000000-0000-e073-0007-000000000045',
      '00000000-0000-e073-0007-00000000007e', '00000000-0000-e073-0007-000000000061',
      '00000000-0000-e073-0007-000000000089', '00000000-0000-e073-0007-00000000004b',
      '00000000-0000-e073-0007-0000000000f2', '00000000-0000-e073-0007-000000000047',
      '00000000-0000-e073-0007-000000000003', '00000000-0000-e073-0007-0000000000ae',
      '00000000-0000-e073-0007-0000000000ad', '00000000-0000-e073-0007-00000000004e',
      '00000000-0000-e073-0007-0000000000fb', // chuletón de buey (F114)
      '00000000-0000-e073-0007-0000000000fc', // chorizo ibérico embutido (F114)
      '00000000-0000-e073-0007-0000000000e5', // arroz blanco (F114 reused)
    ];

    writeFileSync(
      path.join(dataDir, 'spanish-dishes.json'),
      JSON.stringify({ dishes: ALL_DISH_IDS.map((id) => ({ dishId: id, nameEs: `Dish ${id}` })) }),
      'utf-8',
    );

    await generateStandardPortionCsv({ dataDir, outputPath });

    const content = readFileSync(outputPath, 'utf-8');
    const lines = content.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');

    // Header (1) + 2 pre-existing reviewed + 2 new template rows for croquetas (media_racion, racion)
    // + 4 rows × 41 other dishes = 2 + 2 + 164 = 168 data rows + 1 header = 169 lines total.
    // (F114: was 157 lines with 39 dishes; now 169 with 42 dishes)
    // Generator skips the 2 reviewed croquetas rows (pintxo, tapa),
    // generates (media_racion, racion) for croquetas + 4×41 for the other 41 dishes.
    expect(lines).toHaveLength(169);

    // The 2 pre-existing reviewed rows are untouched
    const pintxoLine = lines.find(
      (l) => l.startsWith(CROQUETAS_ID) && l.includes(',pintxo,'),
    );
    expect(pintxoLine).toContain('pbojeda');
    expect(pintxoLine).toContain('researched 2026-04-17');

    // New unreviewed rows for croquetas have empty reviewed_by
    const mediaRacionLine = lines.find(
      (l) => l.startsWith(CROQUETAS_ID) && l.includes(',media_racion,'),
    );
    expect(mediaRacionLine).toBeDefined();
    expect(mediaRacionLine).toMatch(/,$/); // ends with comma (empty reviewed_by)
  });

  // ---------------------------------------------------------------------------
  // U8 — sin-pieces row format
  // ---------------------------------------------------------------------------

  it('U8: sin-pieces row has grams=200, pieces empty, notes contains "sin pieces"', async () => {
    const GAZPACHO_ID = '00000000-0000-e073-0007-000000000042';

    const dataDir = makeTempDir();
    dirsToClean.push(dataDir);
    const outputPath = path.join(dataDir, 'output.csv');

    const ALL_DISH_IDS = [
      '00000000-0000-e073-0007-00000000001a', '00000000-0000-e073-0007-00000000001b',
      '00000000-0000-e073-0007-00000000001e', '00000000-0000-e073-0007-000000000021',
      '00000000-0000-e073-0007-000000000022', '00000000-0000-e073-0007-000000000023',
      '00000000-0000-e073-0007-000000000020', '00000000-0000-e073-0007-00000000001d',
      '00000000-0000-e073-0007-000000000028', '00000000-0000-e073-0007-000000000024',
      '00000000-0000-e073-0007-00000000001c', '00000000-0000-e073-0007-00000000003d',
      '00000000-0000-e073-0007-00000000002a', '00000000-0000-e073-0007-000000000025',
      '00000000-0000-e073-0007-000000000042', // gazpacho
      '00000000-0000-e073-0007-000000000043', '00000000-0000-e073-0007-000000000062',
      '00000000-0000-e073-0007-0000000000f1', '00000000-0000-e073-0007-000000000029',
      '00000000-0000-e073-0007-000000000034', '00000000-0000-e073-0007-000000000035',
      '00000000-0000-e073-0007-00000000003b', '00000000-0000-e073-0007-000000000026',
      '00000000-0000-e073-0007-00000000001f', '00000000-0000-e073-0007-000000000083',
      '00000000-0000-e073-0007-000000000044', '00000000-0000-e073-0007-000000000049',
      '00000000-0000-e073-0007-000000000046', '00000000-0000-e073-0007-000000000045',
      '00000000-0000-e073-0007-00000000007e', '00000000-0000-e073-0007-000000000061',
      '00000000-0000-e073-0007-000000000089', '00000000-0000-e073-0007-00000000004b',
      '00000000-0000-e073-0007-0000000000f2', '00000000-0000-e073-0007-000000000047',
      '00000000-0000-e073-0007-000000000003', '00000000-0000-e073-0007-0000000000ae',
      '00000000-0000-e073-0007-0000000000ad', '00000000-0000-e073-0007-00000000004e',
      '00000000-0000-e073-0007-0000000000fb', // chuletón de buey (F114)
      '00000000-0000-e073-0007-0000000000fc', // chorizo ibérico embutido (F114)
      '00000000-0000-e073-0007-0000000000e5', // arroz blanco (F114 reused)
    ];

    writeFileSync(
      path.join(dataDir, 'spanish-dishes.json'),
      JSON.stringify({ dishes: ALL_DISH_IDS.map((id) => ({ dishId: id, nameEs: `Dish ${id}` })) }),
      'utf-8',
    );

    await generateStandardPortionCsv({ dataDir, outputPath });

    const content = readFileSync(outputPath, 'utf-8');
    const lines = content.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');
    const gazpachoRows = lines.slice(1).filter((l) => l.startsWith(GAZPACHO_ID));

    expect(gazpachoRows).toHaveLength(4);
    for (const row of gazpachoRows) {
      // Parse: dishId,term,grams,pieces,pieceName,confidence,notes,reviewed_by
      const cols = row.split(',');
      expect(cols[2]).toBe('200'); // grams
      expect(cols[3]).toBe('');   // pieces empty
      expect(cols[4]).toBe('');   // pieceName empty
      expect(cols[6]).toContain('sin pieces'); // notes
    }
  });

  // ---------------------------------------------------------------------------
  // U9 — non-sin-pieces row format
  // ---------------------------------------------------------------------------

  it('U9: non-sin-pieces row has grams=50 and notes matches template prefix', async () => {
    const CROQUETAS_ID = '00000000-0000-e073-0007-00000000001a';

    const dataDir = makeTempDir();
    dirsToClean.push(dataDir);
    const outputPath = path.join(dataDir, 'output.csv');

    const ALL_DISH_IDS = [
      '00000000-0000-e073-0007-00000000001a', '00000000-0000-e073-0007-00000000001b',
      '00000000-0000-e073-0007-00000000001e', '00000000-0000-e073-0007-000000000021',
      '00000000-0000-e073-0007-000000000022', '00000000-0000-e073-0007-000000000023',
      '00000000-0000-e073-0007-000000000020', '00000000-0000-e073-0007-00000000001d',
      '00000000-0000-e073-0007-000000000028', '00000000-0000-e073-0007-000000000024',
      '00000000-0000-e073-0007-00000000001c', '00000000-0000-e073-0007-00000000003d',
      '00000000-0000-e073-0007-00000000002a', '00000000-0000-e073-0007-000000000025',
      '00000000-0000-e073-0007-000000000042', '00000000-0000-e073-0007-000000000043',
      '00000000-0000-e073-0007-000000000062', '00000000-0000-e073-0007-0000000000f1',
      '00000000-0000-e073-0007-000000000029', '00000000-0000-e073-0007-000000000034',
      '00000000-0000-e073-0007-000000000035', '00000000-0000-e073-0007-00000000003b',
      '00000000-0000-e073-0007-000000000026', '00000000-0000-e073-0007-00000000001f',
      '00000000-0000-e073-0007-000000000083', '00000000-0000-e073-0007-000000000044',
      '00000000-0000-e073-0007-000000000049', '00000000-0000-e073-0007-000000000046',
      '00000000-0000-e073-0007-000000000045', '00000000-0000-e073-0007-00000000007e',
      '00000000-0000-e073-0007-000000000061', '00000000-0000-e073-0007-000000000089',
      '00000000-0000-e073-0007-00000000004b', '00000000-0000-e073-0007-0000000000f2',
      '00000000-0000-e073-0007-000000000047', '00000000-0000-e073-0007-000000000003',
      '00000000-0000-e073-0007-0000000000ae', '00000000-0000-e073-0007-0000000000ad',
      '00000000-0000-e073-0007-00000000004e',
      '00000000-0000-e073-0007-0000000000fb', // chuletón de buey (F114)
      '00000000-0000-e073-0007-0000000000fc', // chorizo ibérico embutido (F114)
      '00000000-0000-e073-0007-0000000000e5', // arroz blanco (F114 reused)
    ];

    writeFileSync(
      path.join(dataDir, 'spanish-dishes.json'),
      JSON.stringify({ dishes: ALL_DISH_IDS.map((id) => ({ dishId: id, nameEs: `Dish ${id}` })) }),
      'utf-8',
    );

    await generateStandardPortionCsv({ dataDir, outputPath });

    const content = readFileSync(outputPath, 'utf-8');
    const lines = content.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');
    const croquetasRows = lines.slice(1).filter((l) => l.startsWith(CROQUETAS_ID));

    expect(croquetasRows).toHaveLength(4);
    for (const row of croquetasRows) {
      const cols = row.split(',');
      expect(cols[2]).toBe('50'); // grams
      expect(cols[6]).toMatch(/^template: croquetas /); // notes
    }
  });
});

// ---------------------------------------------------------------------------
// U6 — isSinPieces returns true for all sin-pieces members
// ---------------------------------------------------------------------------

describe('isSinPieces', () => {
  it('U6: returns true for all sin-pieces classification members', () => {
    const sinPiecesMembers = [
      'gazpacho', 'salmorejo', 'lentejas', 'cocido', 'fabada',
      'sopa de ajo', 'potaje', 'pisto', 'crema catalana', 'ensalada',
    ];
    for (const name of sinPiecesMembers) {
      expect(isSinPieces(name), `expected isSinPieces('${name}') to be true`).toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // U7 — isSinPieces returns false for non-sin-pieces members
  // ---------------------------------------------------------------------------

  it('U7: returns false for non-sin-pieces members (spot-check)', () => {
    const nonSinPieces = ['croquetas', 'jamón', 'tortilla', 'patatas bravas'];
    for (const name of nonSinPieces) {
      expect(isSinPieces(name), `expected isSinPieces('${name}') to be false`).toBe(false);
    }
  });

  it('U7b: arroz IS in SIN_PIECES_NAMES (reinstated by F114 — Arroz blanco cocido dishId created); bocadillo is NOT', () => {
    // arroz reinstated in SIN_PIECES_NAMES by F114 after Arroz blanco cocido dishId was created.
    expect(isSinPieces('arroz')).toBe(true);
    expect(isSinPieces('bocadillo')).toBe(false);
  });
});
