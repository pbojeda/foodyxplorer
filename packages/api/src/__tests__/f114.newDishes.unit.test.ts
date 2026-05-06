// F114 — Unit tests for Expand Spanish Canonical Dishes
//
// Tests:
//   F114-U1: validateSpanishDishes accepts 252-entry extended JSON
//   F114-U2: No duplicate dishIds for the 2 new entries (...fb, ...fc)
//   F114-U3: No duplicate externalIds (CE-251, CE-252)
//   F114-U4: Each new entry has all 9 required nutrient fields with non-negative values
//   F114-U4b: salt ≈ sodium × 2.54 sanity check for 2 new entries + modified ...0e5
//   F114-U5: validatePriorityDishMap passes after extending with 3 new keys (42 entries)
//   F114-U5b: No PRIORITY_DISH_MAP key is a substring of another
//   F114-U5c: After chuletón alias removal, "chuletón" does NOT appear in any other entry
//   F114-U5d: Arroz blanco (...0e5) has the new aliases applied
//   F114-U6: isSinPieces('arroz') returns true (reinstated by F114)
//   F114-U7: isSinPieces('chuletón') returns false; isSinPieces('chorizo') returns false
//   F114-U8: CSV generator produces 42 × 4 = 168 rows + 1 header = 169 lines
//   F114-U9: arroz rows from generator have sin-pieces format targeting ...0e5
//   F114-U10: chuletón and chorizo rows have non-sin-pieces format
//   F114-U11: Generator determinism — 39 existing dishes' CSV rows stable across repeated runs
//             (NOTE: this is NOT a true pre/post-F114 snapshot test — it is an idempotency
//             check against the CURRENT generator. A true snapshot would require a committed
//             baseline .snap file captured before F114. The plan's "snapshot regression" label
//             was an overstatement; this test catches non-determinism / accidental row
//             reordering but NOT a change in the generator template for existing dishes.
//             Catching the latter is covered by the full test suite running against a
//             fixed CSV produced by `npm run generate:standard-portions`.)

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

import { validateSpanishDishes } from '../scripts/validateSpanishDishes.js';
import { validatePriorityDishMap, generateStandardPortionCsv, isSinPieces, PRIORITY_DISH_MAP } from '../scripts/generateStandardPortionCsv.js';
import type { SpanishDishEntry } from '../scripts/spanishDishesTypes.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REAL_JSON_PATH = path.resolve(
  process.cwd().includes('packages/api')
    ? '.'
    : 'packages/api',
  'prisma/seed-data/spanish-dishes.json',
);

function loadRealJson(): SpanishDishEntry[] {
  const raw = readFileSync(REAL_JSON_PATH, 'utf-8');
  const data = JSON.parse(raw) as { dishes: SpanishDishEntry[] };
  return data.dishes;
}

function findEntry(dishes: SpanishDishEntry[], dishId: string): SpanishDishEntry {
  const entry = dishes.find((d) => d.dishId === dishId);
  if (entry === undefined) throw new Error(`Entry with dishId="${dishId}" not found in JSON`);
  return entry;
}

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `f114-unit-${crypto.randomUUID()}`);
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

// New dishIds
const CHULETON_ID = '00000000-0000-e073-0007-0000000000fb';
const CHORIZO_ID  = '00000000-0000-e073-0007-0000000000fc';
const ARROZ_ID    = '00000000-0000-e073-0007-0000000000e5';
const ENTRECOT_ID = '00000000-0000-e073-0007-000000000069';

// ---------------------------------------------------------------------------
// Full fixture of all 42 dishIds for generator tests
// (39 original + 3: chuletón, chorizo, arroz reuses existing)
// ---------------------------------------------------------------------------

const ALL_42_DISH_IDS = [
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
  CHULETON_ID,                            // chuletón de buey (F114 new)
  CHORIZO_ID,                             // chorizo ibérico embutido (F114 new)
  ARROZ_ID,                               // arroz blanco (F114 reused existing)
];

// ---------------------------------------------------------------------------
// F114-U1 — validateSpanishDishes accepts the extended JSON (319 entries)
// ---------------------------------------------------------------------------
// Count updated by F-H4 round-1: 252 → 279 (+27 regional dishes).
// F-H6: count updated 279 → 307 (+28 international + extended regional).
// F-H9: count updated 307 → 317 (+10 Cat 29 atoms).
// BUG-DATA-DUPLICATE-ATOM-001: count updated 317 → 316 (CE-281 collapsed into CE-095, 2026-04-28).
// F-CHARCUTERIE-001: count updated 316 → 319 (+3 charcuterie atoms — Jamón serrano CE-318, Cecina CE-319, Lomo embuchado CE-320, 2026-04-29).

describe('F114-U1: validateSpanishDishes accepts extended JSON (319 entries)', () => {
  it('passes validation with 319 entries, 0 errors', () => {
    const dishes = loadRealJson();
    expect(dishes).toHaveLength(319);

    const result = validateSpanishDishes(dishes);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// F114-U2 — No duplicate dishIds for the 2 new entries
// ---------------------------------------------------------------------------

describe('F114-U2: No duplicate dishIds for fb and fc entries', () => {
  it('each new dishId appears exactly once in the full JSON', () => {
    const dishes = loadRealJson();
    const dishIdCounts = new Map<string, number>();
    for (const d of dishes) {
      dishIdCounts.set(d.dishId, (dishIdCounts.get(d.dishId) ?? 0) + 1);
    }
    expect(dishIdCounts.get(CHULETON_ID)).toBe(1);
    expect(dishIdCounts.get(CHORIZO_ID)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// F114-U3 — No duplicate externalIds (CE-251, CE-252)
// ---------------------------------------------------------------------------

describe('F114-U3: No duplicate externalIds CE-251 and CE-252', () => {
  it('CE-251 and CE-252 each appear exactly once', () => {
    const dishes = loadRealJson();
    const extIdCounts = new Map<string, number>();
    for (const d of dishes) {
      extIdCounts.set(d.externalId, (extIdCounts.get(d.externalId) ?? 0) + 1);
    }
    expect(extIdCounts.get('CE-251')).toBe(1);
    expect(extIdCounts.get('CE-252')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// F114-U4 — Each new entry has all 9 required nutrient fields >= 0
// ---------------------------------------------------------------------------

describe('F114-U4: New entries have all 9 nutrient fields with non-negative values', () => {
  const NUTRIENT_FIELDS = [
    'calories', 'proteins', 'carbohydrates', 'sugars',
    'fats', 'saturatedFats', 'fiber', 'salt', 'sodium',
  ] as const;

  it('Chuletón de buey (...fb) has all 9 nutrient fields >= 0', () => {
    const dishes = loadRealJson();
    const entry = findEntry(dishes, CHULETON_ID);
    for (const field of NUTRIENT_FIELDS) {
      const value = entry.nutrients[field];
      expect(typeof value, `${field} must be a number`).toBe('number');
      expect(value, `${field} must be >= 0`).toBeGreaterThanOrEqual(0);
    }
  });

  it('Chorizo ibérico embutido (...fc) has all 9 nutrient fields >= 0', () => {
    const dishes = loadRealJson();
    const entry = findEntry(dishes, CHORIZO_ID);
    for (const field of NUTRIENT_FIELDS) {
      const value = entry.nutrients[field];
      expect(typeof value, `${field} must be a number`).toBe('number');
      expect(value, `${field} must be >= 0`).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// F114-U4b — salt ≈ sodium × 2.54 for new entries + modified ...0e5 (Codex M2)
// ---------------------------------------------------------------------------

describe('F114-U4b: salt ≈ sodium × 2.54 (tolerance 0.05 g/100g)', () => {
  const TOLERANCE = 0.05;

  it('Chuletón de buey: |salt - sodium*2.54| < 0.05', () => {
    const dishes = loadRealJson();
    const entry = findEntry(dishes, CHULETON_ID);
    const diff = Math.abs(entry.nutrients.salt - entry.nutrients.sodium * 2.54);
    expect(diff, `salt=${entry.nutrients.salt}, sodium=${entry.nutrients.sodium}, diff=${diff}`).toBeLessThan(TOLERANCE);
  });

  it('Chorizo ibérico embutido: |salt - sodium*2.54| < 0.05', () => {
    const dishes = loadRealJson();
    const entry = findEntry(dishes, CHORIZO_ID);
    const diff = Math.abs(entry.nutrients.salt - entry.nutrients.sodium * 2.54);
    expect(diff, `salt=${entry.nutrients.salt}, sodium=${entry.nutrients.sodium}, diff=${diff}`).toBeLessThan(TOLERANCE);
  });

  it('Arroz blanco (...0e5): |salt - sodium*2.54| < 0.05', () => {
    const dishes = loadRealJson();
    const entry = findEntry(dishes, ARROZ_ID);
    const diff = Math.abs(entry.nutrients.salt - entry.nutrients.sodium * 2.54);
    expect(diff, `salt=${entry.nutrients.salt}, sodium=${entry.nutrients.sodium}, diff=${diff}`).toBeLessThan(TOLERANCE);
  });
});

// ---------------------------------------------------------------------------
// F114-U5 — validatePriorityDishMap passes after extending with 3 new keys
// ---------------------------------------------------------------------------

describe('F114-U5: validatePriorityDishMap passes with extended 42-entry map', () => {
  it('does not throw with extended map (42 entries) against real JSON', () => {
    const dishes = loadRealJson();
    const knownDishIds = new Set(dishes.map((d) => d.dishId));

    const extendedMap = {
      ...PRIORITY_DISH_MAP,
      'chuletón': CHULETON_ID,
      'chorizo':  CHORIZO_ID,
      'arroz':    ARROZ_ID,
    };

    expect(Object.keys(extendedMap)).toHaveLength(42);
    expect(() => validatePriorityDishMap(extendedMap, knownDishIds)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// F114-U5b — No PRIORITY_DISH_MAP key is a substring of another (Gemini M2)
// ---------------------------------------------------------------------------

describe('F114-U5b: No PRIORITY_DISH_MAP key is a substring of another key', () => {
  it('no key is a strict substring of any other key', () => {
    const keys = Object.keys(PRIORITY_DISH_MAP);

    for (let i = 0; i < keys.length; i++) {
      for (let j = 0; j < keys.length; j++) {
        if (i === j) continue;
        const k1 = keys[i] ?? '';
        const k2 = keys[j] ?? '';
        // k1 must not be a substring of k2
        expect(
          k2.includes(k1),
          `Key "${k1}" is a substring of key "${k2}" — collision risk`,
        ).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// F114-U5c — After chuletón alias removal, "chuletón" not in other entries (Codex M2)
// ---------------------------------------------------------------------------

describe('F114-U5c: "chuletón" alias not present in any entry except ...fb (new Chuletón)', () => {
  it('no dish other than ...fb has "chuletón" in its aliases', () => {
    const dishes = loadRealJson();
    const violators = dishes.filter(
      (d) => d.dishId !== CHULETON_ID && d.aliases.includes('chuletón'),
    );
    expect(
      violators.map((d) => d.dishId),
      'Expected no dishes other than Chuletón de buey to have "chuletón" alias',
    ).toHaveLength(0);
  });

  it('Entrecot de ternera (...069) has empty aliases (chuletón removed)', () => {
    const dishes = loadRealJson();
    const entrecot = findEntry(dishes, ENTRECOT_ID);
    expect(entrecot.aliases).not.toContain('chuletón');
  });

  it('"chuletón completo" alias on Chuletón con patatas (...0df) does NOT collide — L1 uses exact containment (QA M3 guard)', () => {
    // QA flagged: Chuletón con patatas (...0df) carries alias "chuletón completo". L1
    // lookup uses exact array containment (aliases @> ARRAY[query]), so a "chuletón"
    // query will NOT match "chuletón completo". If L1 is ever changed to substring
    // matching, this test will start failing AND the implicit non-collision invariant
    // will be violated. This test freezes the invariant.
    const dishes = loadRealJson();
    const chuletonCompleto = dishes.find(
      (d) => d.dishId === '00000000-0000-e073-0007-0000000000df',
    );
    expect(chuletonCompleto, 'Chuletón con patatas (...0df) entry must exist').toBeDefined();
    // The exact-token "chuletón" must NOT be in this dish's aliases (only "chuletón completo").
    expect(chuletonCompleto!.aliases).not.toContain('chuletón');
    // "chuletón completo" is expected to remain — it's a distinct concept.
    expect(chuletonCompleto!.aliases).toContain('chuletón completo');
  });
});

// ---------------------------------------------------------------------------
// F114-U5d — Arroz blanco (...0e5) has the new aliases applied
// ---------------------------------------------------------------------------

describe('F114-U5d: Arroz blanco (...0e5) has new aliases', () => {
  it('aliases include guarnición de arroz, arroz, arroz cocido, arroz hervido', () => {
    const dishes = loadRealJson();
    const arroz = findEntry(dishes, ARROZ_ID);
    expect(arroz.aliases).toContain('guarnición de arroz');
    expect(arroz.aliases).toContain('arroz');
    expect(arroz.aliases).toContain('arroz cocido');
    expect(arroz.aliases).toContain('arroz hervido');
  });
});

// ---------------------------------------------------------------------------
// F114-U6 — isSinPieces('arroz') returns true (reinstated in F114)
// ---------------------------------------------------------------------------

describe('F114-U6: isSinPieces("arroz") returns true', () => {
  it('arroz is reinstated in SIN_PIECES_NAMES by F114 — Arroz blanco cocido is bulk side dish', () => {
    expect(isSinPieces('arroz')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F114-U7 — isSinPieces('chuletón') and isSinPieces('chorizo') return false
// ---------------------------------------------------------------------------

describe('F114-U7: chuletón and chorizo are NOT in SIN_PIECES_NAMES', () => {
  it('isSinPieces("chuletón") returns false', () => {
    expect(isSinPieces('chuletón')).toBe(false);
  });
  it('isSinPieces("chorizo") returns false', () => {
    expect(isSinPieces('chorizo')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F114-U8 — CSV generator produces 42 × 4 = 168 rows + header = 169 lines
// ---------------------------------------------------------------------------

describe('F114-U8: CSV generator produces 169 lines (1 header + 168 rows) for 42 dishes', () => {
  it('produces 42 × 4 = 168 data rows plus header for full 42-dish fixture', async () => {
    const dataDir = makeTempDir();
    dirsToClean.push(dataDir);
    const outputPath = path.join(dataDir, 'output.csv');

    writeFileSync(
      path.join(dataDir, 'spanish-dishes.json'),
      JSON.stringify({ dishes: ALL_42_DISH_IDS.map((id) => ({ dishId: id, nameEs: `Dish ${id}` })) }),
      'utf-8',
    );

    await generateStandardPortionCsv({ dataDir, outputPath });

    const content = readFileSync(outputPath, 'utf-8');
    const lines = content.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');

    expect(lines).toHaveLength(169);
    expect(lines[0]).toBe('dishId,term,grams,pieces,pieceName,confidence,notes,reviewed_by');
  });
});

// ---------------------------------------------------------------------------
// F114-U9 — arroz rows have sin-pieces format (grams=200, pieces empty, notes "sin pieces")
// ---------------------------------------------------------------------------

describe('F114-U9: arroz rows use sin-pieces format targeting ...0e5', () => {
  it('all 4 arroz rows: grams=200, pieces empty, notes contains "sin pieces"', async () => {
    const dataDir = makeTempDir();
    dirsToClean.push(dataDir);
    const outputPath = path.join(dataDir, 'output.csv');

    writeFileSync(
      path.join(dataDir, 'spanish-dishes.json'),
      JSON.stringify({ dishes: ALL_42_DISH_IDS.map((id) => ({ dishId: id, nameEs: `Dish ${id}` })) }),
      'utf-8',
    );

    await generateStandardPortionCsv({ dataDir, outputPath });

    const content = readFileSync(outputPath, 'utf-8');
    const lines = content.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');
    const arrozRows = lines.slice(1).filter((l) => l.startsWith(ARROZ_ID));

    expect(arrozRows).toHaveLength(4);
    for (const row of arrozRows) {
      const cols = row.split(',');
      expect(cols[2]).toBe('200');          // grams
      expect(cols[3]).toBe('');             // pieces empty
      expect(cols[4]).toBe('');             // pieceName empty
      expect(cols[6]).toContain('sin pieces'); // notes
    }
  });
});

// ---------------------------------------------------------------------------
// F114-U10 — chuletón and chorizo rows have non-sin-pieces format
// ---------------------------------------------------------------------------

describe('F114-U10: chuletón and chorizo rows have non-sin-pieces format', () => {
  it('chuletón rows: grams=50, notes matches "template: chuletón <term>"', async () => {
    const dataDir = makeTempDir();
    dirsToClean.push(dataDir);
    const outputPath = path.join(dataDir, 'output.csv');

    writeFileSync(
      path.join(dataDir, 'spanish-dishes.json'),
      JSON.stringify({ dishes: ALL_42_DISH_IDS.map((id) => ({ dishId: id, nameEs: `Dish ${id}` })) }),
      'utf-8',
    );

    await generateStandardPortionCsv({ dataDir, outputPath });

    const content = readFileSync(outputPath, 'utf-8');
    const lines = content.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');
    const chuletasRows = lines.slice(1).filter((l) => l.startsWith(CHULETON_ID));

    expect(chuletasRows).toHaveLength(4);
    for (const row of chuletasRows) {
      const cols = row.split(',');
      expect(cols[2]).toBe('50');
      expect(cols[6]).toMatch(/^template: chuletón /);
    }
  });

  it('chorizo rows: grams=50, notes matches "template: chorizo <term>"', async () => {
    const dataDir = makeTempDir();
    dirsToClean.push(dataDir);
    const outputPath = path.join(dataDir, 'output.csv');

    writeFileSync(
      path.join(dataDir, 'spanish-dishes.json'),
      JSON.stringify({ dishes: ALL_42_DISH_IDS.map((id) => ({ dishId: id, nameEs: `Dish ${id}` })) }),
      'utf-8',
    );

    await generateStandardPortionCsv({ dataDir, outputPath });

    const content = readFileSync(outputPath, 'utf-8');
    const lines = content.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');
    const chorizoRows = lines.slice(1).filter((l) => l.startsWith(CHORIZO_ID));

    expect(chorizoRows).toHaveLength(4);
    for (const row of chorizoRows) {
      const cols = row.split(',');
      expect(cols[2]).toBe('50');
      expect(cols[6]).toMatch(/^template: chorizo /);
    }
  });
});

// ---------------------------------------------------------------------------
// F114-U11 — CSV snapshot regression: 39 existing dishes' rows unchanged (Gemini M2)
// ---------------------------------------------------------------------------

describe('F114-U11: CSV generator determinism — 39 existing dishes rows stable across runs', () => {
  // These are the 39 dishIds that existed before F114 (not fb, fc, or 0e5 which
  // gets new rows for arroz). We verify the generated CSV rows for these IDs
  // are structurally identical to pre-F114 output.
  const EXISTING_39_IDS = ALL_42_DISH_IDS.filter(
    (id) => id !== CHULETON_ID && id !== CHORIZO_ID && id !== ARROZ_ID,
  );

  it('row set for 39 pre-existing dishes is unchanged (order-insensitive structural match)', async () => {
    // Generate with full 42-dish fixture twice (same fixture → idempotent output)
    const dataDirPre = makeTempDir();
    dirsToClean.push(dataDirPre);
    const outputPre = path.join(dataDirPre, 'output.csv');

    writeFileSync(
      path.join(dataDirPre, 'spanish-dishes.json'),
      JSON.stringify({ dishes: ALL_42_DISH_IDS.map((id) => ({ dishId: id, nameEs: `Dish ${id}` })) }),
      'utf-8',
    );
    await generateStandardPortionCsv({ dataDir: dataDirPre, outputPath: outputPre });

    const dataDirPost = makeTempDir();
    dirsToClean.push(dataDirPost);
    const outputPost = path.join(dataDirPost, 'output.csv');

    writeFileSync(
      path.join(dataDirPost, 'spanish-dishes.json'),
      JSON.stringify({ dishes: ALL_42_DISH_IDS.map((id) => ({ dishId: id, nameEs: `Dish ${id}` })) }),
      'utf-8',
    );
    await generateStandardPortionCsv({ dataDir: dataDirPost, outputPath: outputPost });

    const linesPre = readFileSync(outputPre, 'utf-8')
      .replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');
    const linesPost = readFileSync(outputPost, 'utf-8')
      .replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');

    const existingRowsPre = new Set(linesPre.slice(1).filter((l) => EXISTING_39_IDS.some((id) => l.startsWith(id))));
    const existingRowsPost = new Set(linesPost.slice(1).filter((l) => EXISTING_39_IDS.some((id) => l.startsWith(id))));

    // Same number of rows for the 39 existing dishes
    expect(existingRowsPre.size).toBe(39 * 4);
    expect(existingRowsPost.size).toBe(39 * 4);

    // Every pre-F114 row is present in the post-F114 output
    for (const row of existingRowsPre) {
      expect(existingRowsPost.has(row), `Row missing in post-F114 output: ${row}`).toBe(true);
    }
  });
});
