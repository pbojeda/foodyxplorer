/**
 * F-CATALOG-COV-001 Round-3 — AC-11: level1Lookup simulation (table-driven).
 *
 * Follows the `fH9.cat29.unit.test.ts` pattern:
 *   - Loads `spanish-dishes.json` in-memory (no DB, no HTTP).
 *   - Defines an inline `level1Lookup(query)` helper that matches on
 *     `name`, `nameEs`, and `aliases` (exact-match, case-insensitive).
 *   - One describe block for each of the 7 alias additions from the Step 2
 *     pre-analysis table.
 *   - Each block asserts: exact in-memory hit on the target externalId.
 *
 * For alias-addition cases (no new atom): asserts both:
 *   (a) `dishes.find(d => d.externalId === 'CE-XXX')?.aliases.includes('<alias>')` is true.
 *   (b) `level1Lookup('<alias>').map(d => d.externalId)` equals `['CE-XXX']`.
 *
 * These tests are RED until Commit 3.5 adds the 7 aliases to spanish-dishes.json.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import type { SpanishDishEntry } from '../scripts/spanishDishesTypes.js';

// ---------------------------------------------------------------------------
// Load seed data once at module scope
// ---------------------------------------------------------------------------

const DATA_DIR = process.cwd().includes('packages/api') ? '.' : 'packages/api';
const JSON_PATH = path.resolve(DATA_DIR, 'prisma/seed-data/spanish-dishes.json');

interface JsonRoot {
  dishes: SpanishDishEntry[];
}

const jsonRoot = JSON.parse(readFileSync(JSON_PATH, 'utf-8')) as JsonRoot;
const dishes = jsonRoot.dishes;

// ---------------------------------------------------------------------------
// level1Lookup helper (inline copy — mirrors implicitMultiItemDetector.ts:122)
// ---------------------------------------------------------------------------

/** Level-1 exact-match lookup simulation (mirrors implicitMultiItemDetector.ts:122).
 *  Inline copy following fH9.cat29.unit.test.ts / H6-EC-12 precedent. */
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
// AC-11: 7 describe blocks — one per alias addition
// ---------------------------------------------------------------------------

describe('F-CATALOG-COV-001 AC-11 (1/7): CE-026 alias "croquetas de jamón ibérico"', () => {
  const alias = 'croquetas de jamón ibérico';
  const eid = 'CE-026';

  it('alias is present in seed JSON aliases array', () => {
    const dish = dishes.find((d) => d.externalId === eid);
    expect(dish, `Dish ${eid} not found`).toBeDefined();
    expect(dish?.aliases ?? []).toContain(alias);
  });

  it('level1Lookup resolves exactly to CE-026', () => {
    const matches = level1Lookup(alias);
    expect(matches.map((d) => d.externalId)).toEqual([eid]);
  });
});

describe('F-CATALOG-COV-001 AC-11 (2/7): CE-072 alias "crema de calabazin"', () => {
  const alias = 'crema de calabazin';
  const eid = 'CE-072';

  it('alias is present in seed JSON aliases array', () => {
    const dish = dishes.find((d) => d.externalId === eid);
    expect(dish, `Dish ${eid} not found`).toBeDefined();
    expect(dish?.aliases ?? []).toContain(alias);
  });

  it('level1Lookup resolves exactly to CE-072', () => {
    const matches = level1Lookup(alias);
    expect(matches.map((d) => d.externalId)).toEqual([eid]);
  });
});

describe('F-CATALOG-COV-001 AC-11 (3/7): CE-139 alias "macarrrones con tomate"', () => {
  const alias = 'macarrrones con tomate';
  const eid = 'CE-139';

  it('alias is present in seed JSON aliases array', () => {
    const dish = dishes.find((d) => d.externalId === eid);
    expect(dish, `Dish ${eid} not found`).toBeDefined();
    expect(dish?.aliases ?? []).toContain(alias);
  });

  it('level1Lookup resolves exactly to CE-139', () => {
    const matches = level1Lookup(alias);
    expect(matches.map((d) => d.externalId)).toEqual([eid]);
  });
});

describe('F-CATALOG-COV-001 AC-11 (4/7): CE-171 alias "flam casero"', () => {
  const alias = 'flam casero';
  const eid = 'CE-171';

  it('alias is present in seed JSON aliases array', () => {
    const dish = dishes.find((d) => d.externalId === eid);
    expect(dish, `Dish ${eid} not found`).toBeDefined();
    expect(dish?.aliases ?? []).toContain(alias);
  });

  it('level1Lookup resolves exactly to CE-171', () => {
    const matches = level1Lookup(alias);
    expect(matches.map((d) => d.externalId)).toEqual([eid]);
  });
});

describe('F-CATALOG-COV-001 AC-11 (5/7): CE-028 alias "tortiya de patatas"', () => {
  const alias = 'tortiya de patatas';
  const eid = 'CE-028';

  it('alias is present in seed JSON aliases array', () => {
    const dish = dishes.find((d) => d.externalId === eid);
    expect(dish, `Dish ${eid} not found`).toBeDefined();
    expect(dish?.aliases ?? []).toContain(alias);
  });

  it('level1Lookup resolves exactly to CE-028', () => {
    const matches = level1Lookup(alias);
    expect(matches.map((d) => d.externalId)).toEqual([eid]);
  });
});

describe('F-CATALOG-COV-001 AC-11 (6/7): CE-140 alias "espaguettis carbonara"', () => {
  const alias = 'espaguettis carbonara';
  const eid = 'CE-140';

  it('alias is present in seed JSON aliases array', () => {
    const dish = dishes.find((d) => d.externalId === eid);
    expect(dish, `Dish ${eid} not found`).toBeDefined();
    expect(dish?.aliases ?? []).toContain(alias);
  });

  it('level1Lookup resolves exactly to CE-140', () => {
    const matches = level1Lookup(alias);
    expect(matches.map((d) => d.externalId)).toEqual([eid]);
  });
});

describe('F-CATALOG-COV-001 AC-11 (7/7): CE-173 alias "tarta de quesso"', () => {
  const alias = 'tarta de quesso';
  const eid = 'CE-173';

  it('alias is present in seed JSON aliases array', () => {
    const dish = dishes.find((d) => d.externalId === eid);
    expect(dish, `Dish ${eid} not found`).toBeDefined();
    expect(dish?.aliases ?? []).toContain(alias);
  });

  it('level1Lookup resolves exactly to CE-173', () => {
    const matches = level1Lookup(alias);
    expect(matches.map((d) => d.externalId)).toEqual([eid]);
  });
});
