/**
 * F-CATALOG-COV-001 Round-3 — AC-12b: Extracted-term seed integrity test.
 *
 * Pure data-integrity guard — loads `spanish-dishes.json` in-memory and asserts
 * that each of the 7 full-phrase alias strings from the Step 2 pre-analysis table
 * appears in the `aliases` array of its target atom (by externalId).
 *
 * This file is MANDATORY separate from `fCOV-001.r3.unit.test.ts` per AC-12b.
 * It catches cases where an alias was accidentally omitted from the JSON while
 * the raw-query test (fCOV-001.r3.qa.test.ts) would independently also fail.
 *
 * Also validates `normalizeQueryKey()` correctness with inline test cases
 * (verbatim spec function, AC-12a/AC-12b preamble).
 *
 * These tests are RED until Commit 3.5 adds the 7 aliases to spanish-dishes.json.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import type { SpanishDishEntry } from '../scripts/spanishDishesTypes.js';

// ---------------------------------------------------------------------------
// Load seed data
// ---------------------------------------------------------------------------

const DATA_DIR = process.cwd().includes('packages/api') ? '.' : 'packages/api';
const JSON_PATH = path.resolve(DATA_DIR, 'prisma/seed-data/spanish-dishes.json');

interface JsonRoot {
  dishes: SpanishDishEntry[];
}

const jsonRoot = JSON.parse(readFileSync(JSON_PATH, 'utf-8')) as JsonRoot;
const dishes = jsonRoot.dishes;

// ---------------------------------------------------------------------------
// normalizeQueryKey (verbatim from spec — AC-12a/AC-12b preamble)
// ---------------------------------------------------------------------------

function normalizeQueryKey(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[.,;:!?¿¡]+$/, '')
    .replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// AC-12b: 7 extracted-term alias assertions (by externalId)
// ---------------------------------------------------------------------------

describe('F-CATALOG-COV-001 AC-12b: extracted-term seed integrity (7 alias additions)', () => {
  /**
   * Each row: [externalId, alias, humanReadableName]
   * All 7 are NEW_ALIAS verdicts from the Step 2 pre-analysis table.
   */
  const aliasExpectations: Array<[string, string, string]> = [
    ['CE-026', 'croquetas de jamón ibérico', 'Croquetas de jamón'],
    ['CE-072', 'crema de calabazin', 'Crema de calabacín'],
    ['CE-139', 'macarrrones con tomate', 'Macarrones con tomate'],
    ['CE-171', 'flam casero', 'Flan casero'],
    ['CE-028', 'tortiya de patatas', 'Tortilla de patatas'],
    ['CE-140', 'espaguettis carbonara', 'Espaguetis carbonara'],
    ['CE-173', 'tarta de quesso', 'Tarta de queso'],
  ];

  it.each(aliasExpectations)(
    '%s (%s) has alias "%s" in seed JSON',
    (externalId, alias, _name) => {
      const dish = dishes.find((d) => d.externalId === externalId);
      expect(dish, `Dish ${externalId} not found in seed JSON`).toBeDefined();
      expect(
        (dish?.aliases ?? []).includes(alias),
        `Alias "${alias}" not found in ${externalId} (${_name}).aliases = ${JSON.stringify(dish?.aliases ?? [])}`,
      ).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// normalizeQueryKey correctness
// ---------------------------------------------------------------------------

describe('F-CATALOG-COV-001 AC-12b: normalizeQueryKey correctness', () => {
  const cases: Array<[string, string]> = [
    ['Croquetas de jamón', 'croquetas de jamón'],
    ['croquetas de jamón.', 'croquetas de jamón'],
    ['  macarrrones con tomate  ', 'macarrrones con tomate'],
    ['tarta de quesso!', 'tarta de quesso'],
    ['flam  casero', 'flam casero'],
    ['crema de calabazin,', 'crema de calabazin'],
  ];

  it.each(cases)(
    'normalizeQueryKey(%j) === %j',
    (input, expected) => {
      expect(normalizeQueryKey(input)).toBe(expected);
    },
  );
});
