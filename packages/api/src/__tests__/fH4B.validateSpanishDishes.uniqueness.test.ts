/**
 * F-H4-B — validateSpanishDishes uniqueness check tests.
 *
 * Tests for:
 *   AC-3a / AC-2-B4: alias collision not in allow-list → valid: false
 *   AC-3b: nameEs ↔ alias cross-space collision → valid: false
 *   AC-3c: case-insensitive collision → valid: false
 *   AC-3d: accent-distinct forms on same dish → no false collision
 *   AC-2-B5: collision in allow-list (exact match) → valid: true
 *   AC-2-B6: allow-list wrong dishId → still blocked
 *   AC-1g: 6 apócope aliases present in real spanish-dishes.json
 *   AC-3e: real spanish-dishes.json passes uniqueness check with valid: true
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { describe, it, expect } from 'vitest';
import {
  validateSpanishDishes,
  validateSpanishDishesWithAllowList,
} from '../scripts/validateSpanishDishes.js';
import type { SpanishDishEntry } from '../scripts/spanishDishesTypes.js';

// ---------------------------------------------------------------------------
// Local helpers (filler dishes use unique aliases to avoid false collisions)
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<SpanishDishEntry> = {}): SpanishDishEntry {
  return {
    externalId: 'CE-T00',
    dishId: '00000000-0000-f4b0-0007-000000000000',
    nutrientId: '00000000-0000-f4b0-0008-000000000000',
    name: 'Plato base',
    nameEs: 'Plato base',
    aliases: [],
    category: 'tapas',
    portionGrams: 150,
    confidenceLevel: 'high',
    estimationMethod: 'official',
    source: 'bedca',
    nutrients: {
      calories: 200,
      proteins: 6.5,
      carbohydrates: 16.8,
      sugars: 1.2,
      fats: 11.8,
      saturatedFats: 2.1,
      fiber: 1.3,
      salt: 0.8,
      sodium: 0.32,
    },
    ...overrides,
  };
}

/**
 * Builds a 250-entry dataset: 248 unique filler dishes + 2 explicitly configured
 * dishes (dishA at index 0, dishB at index 1). Filler aliases are unique per dish
 * via template string to avoid triggering the uniqueness check.
 */
function make2DishDataset(dishA: SpanishDishEntry, dishB: SpanishDishEntry): SpanishDishEntry[] {
  const fillers: SpanishDishEntry[] = Array.from({ length: 248 }, (_, i) =>
    makeEntry({
      externalId: `CE-F${String(i + 1).padStart(3, '0')}`,
      dishId: `00000000-0000-f4b0-0007-${String(i + 1).padStart(12, '0')}`,
      nutrientId: `00000000-0000-f4b0-0008-${String(i + 1).padStart(12, '0')}`,
      name: `Filler ${i + 1}`,
      nameEs: `Filler ${i + 1}`,
      aliases: [`filler-alias-${i + 1}`],
    }),
  );
  return [dishA, dishB, ...fillers];
}

// ---------------------------------------------------------------------------
// AC-3a / AC-2-B4: alias collision NOT in allow-list
// ---------------------------------------------------------------------------

describe('F-H4-B — validateSpanishDishes uniqueness check', () => {
  it('AC-3a / AC-2-B4: rejects collision when term is not in allow-list', () => {
    const dishA = makeEntry({
      externalId: 'CE-T01',
      dishId: '11111111-0000-f4b0-0007-000000000001',
      nutrientId: '11111111-0000-f4b0-0008-000000000001',
      name: 'Croquetas de jamón',
      nameEs: 'Croquetas de jamón',
      aliases: ['croquetas'],
    });
    const dishB = makeEntry({
      externalId: 'CE-T02',
      dishId: '22222222-0000-f4b0-0007-000000000002',
      nutrientId: '22222222-0000-f4b0-0008-000000000002',
      name: 'Croquetas de bacalao',
      nameEs: 'Croquetas de bacalao',
      aliases: ['croquetas'],
    });

    const result = validateSpanishDishesWithAllowList(make2DishDataset(dishA, dishB), []);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) =>
          e.includes('Collision in lookup key space') &&
          e.includes('"croquetas"') &&
          e.includes('CE-T01') &&
          e.includes('CE-T02'),
      ),
    ).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // AC-3b: nameEs ↔ alias cross-space collision
  // ---------------------------------------------------------------------------

  it('AC-3b: rejects cross-space collision (nameEs of dish X equals alias of dish Y)', () => {
    const dishA = makeEntry({
      externalId: 'CE-T03',
      dishId: '33333333-0000-f4b0-0007-000000000003',
      nutrientId: '33333333-0000-f4b0-0008-000000000003',
      name: 'croquetas caseras',
      nameEs: 'croquetas caseras',
      aliases: [],
    });
    const dishB = makeEntry({
      externalId: 'CE-T04',
      dishId: '44444444-0000-f4b0-0007-000000000004',
      nutrientId: '44444444-0000-f4b0-0008-000000000004',
      name: 'Plato B',
      nameEs: 'Plato B',
      aliases: ['croquetas caseras'],
    });

    const result = validateSpanishDishesWithAllowList(make2DishDataset(dishA, dishB), []);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) =>
          e.includes('Collision in lookup key space') &&
          e.includes('"croquetas caseras"'),
      ),
    ).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // AC-3c: case-insensitive collision
  // ---------------------------------------------------------------------------

  it('AC-3c: treats "Pisto" and "pisto" as colliding (case-insensitive)', () => {
    // QA observation: use disjoint nameEs strings so the only collision is on
    // the alias "pisto" (no unintended nameEs collision to pollute the test).
    const dishA = makeEntry({
      externalId: 'CE-T05',
      dishId: '55555555-0000-f4b0-0007-000000000005',
      nutrientId: '55555555-0000-f4b0-0008-000000000005',
      name: 'Receta A única',
      nameEs: 'Receta A única',
      aliases: ['Pisto'],
    });
    const dishB = makeEntry({
      externalId: 'CE-T06',
      dishId: '66666666-0000-f4b0-0007-000000000006',
      nutrientId: '66666666-0000-f4b0-0008-000000000006',
      name: 'Receta B distinta',
      nameEs: 'Receta B distinta',
      aliases: ['pisto'],
    });

    const result = validateSpanishDishesWithAllowList(make2DishDataset(dishA, dishB), []);

    expect(result.valid).toBe(false);
    // Only one collision error expected — on "pisto" exclusively.
    const collisionErrors = result.errors.filter((e) =>
      e.includes('Collision in lookup key space'),
    );
    expect(collisionErrors).toHaveLength(1);
    expect(collisionErrors[0]).toContain('"pisto"');
  });

  // ---------------------------------------------------------------------------
  // AC-3d: accent-distinct forms on the same dish — no false collision
  // ---------------------------------------------------------------------------

  it('AC-3d: does not flag accent-distinct forms as a collision when both are on the same dish', () => {
    const dishA = makeEntry({
      externalId: 'CE-T07',
      dishId: '77777777-0000-f4b0-0007-000000000007',
      nutrientId: '77777777-0000-f4b0-0008-000000000007',
      name: 'Calçots amb romesco',
      nameEs: 'Calçots amb romesco',
      aliases: ['calçots', 'calcots'],
    });
    const dishB = makeEntry({
      externalId: 'CE-T08',
      dishId: '88888888-0000-f4b0-0007-000000000008',
      nutrientId: '88888888-0000-f4b0-0008-000000000008',
      name: 'Plato D',
      nameEs: 'Plato D',
      aliases: [],
    });

    const result = validateSpanishDishesWithAllowList(make2DishDataset(dishA, dishB), []);

    expect(result.valid).toBe(true);
    expect(
      result.errors.some((e) => e.includes('Collision in lookup key space')),
    ).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // AC-2-B5: collision IS in allow-list (exact alias + dishIds match)
  // ---------------------------------------------------------------------------

  it('AC-2-B5: accepts a collision that IS in the allow-list (exact alias + dishIds match)', () => {
    const dishA = makeEntry({
      externalId: 'CE-T09',
      dishId: 'aaaaaaaa-0000-0000-0000-000000000001',
      nutrientId: 'aaaaaaaa-0000-f4b0-0008-000000000001',
      name: 'Empanada gallega',
      nameEs: 'Empanada gallega',
      aliases: ['empanada'],
    });
    const dishB = makeEntry({
      externalId: 'CE-T10',
      dishId: 'bbbbbbbb-0000-0000-0000-000000000002',
      nutrientId: 'bbbbbbbb-0000-f4b0-0008-000000000002',
      name: 'Empanada de atún',
      nameEs: 'Empanada de atún',
      aliases: ['empanada'],
    });

    const customAllowList = [
      {
        alias: 'empanada',
        dishIds: ['aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002'],
        reason: 'Test allow-list entry',
      },
    ];

    const result = validateSpanishDishesWithAllowList(make2DishDataset(dishA, dishB), customAllowList);

    expect(result.valid).toBe(true);
    expect(
      result.errors.some((e) => e.includes('Collision in lookup key space')),
    ).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // AC-2-B6: allow-list has correct alias but wrong dishId set
  // ---------------------------------------------------------------------------

  it('AC-2-B6: rejects collision when allow-list has correct alias but wrong dishId set', () => {
    const dishA = makeEntry({
      externalId: 'CE-T11',
      dishId: 'cccccccc-0000-0000-0000-000000000003',
      nutrientId: 'cccccccc-0000-f4b0-0008-000000000003',
      name: 'Empanada de carne',
      nameEs: 'Empanada de carne',
      aliases: ['empanada'],
    });
    const dishB = makeEntry({
      externalId: 'CE-T12',
      dishId: 'dddddddd-0000-0000-0000-000000000004',
      nutrientId: 'dddddddd-0000-f4b0-0008-000000000004',
      name: 'Empanada de verduras',
      nameEs: 'Empanada de verduras',
      aliases: ['empanada'],
    });

    // Allow-list has correct alias but second dishId is wrong (zzzzzzzz… instead of dddddddd…)
    const customAllowList = [
      {
        alias: 'empanada',
        dishIds: ['cccccccc-0000-0000-0000-000000000003', 'zzzzzzzz-0000-0000-0000-000000000099'],
        reason: 'Wrong dishId — should not match',
      },
    ];

    const result = validateSpanishDishesWithAllowList(make2DishDataset(dishA, dishB), customAllowList);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) =>
          e.includes('Collision in lookup key space') &&
          e.includes('"empanada"'),
      ),
    ).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // AC-1g: all 6 apócope aliases present in real spanish-dishes.json
  // (written BEFORE editing the JSON — red phase until Step 12)
  // ---------------------------------------------------------------------------

  it('AC-1g: all 6 apócope aliases are present in spanish-dishes.json as distinct lowercase strings from nameEs', () => {
    const jsonPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../prisma/seed-data/spanish-dishes.json',
    );
    const { dishes } = JSON.parse(readFileSync(jsonPath, 'utf8')) as { dishes: SpanishDishEntry[] };

    const expected = [
      { externalId: 'CE-253', alias: 'papas arrugás' },
      { externalId: 'CE-254', alias: 'papas arrugás con mojo picón' },
      { externalId: 'CE-255', alias: 'papas arrugás con mojo verde' },
      { externalId: 'CE-257', alias: 'gofio escaldao' },
      { externalId: 'CE-262', alias: 'queso asao con mojo' },
      { externalId: 'CE-275', alias: 'ternasco asao' },
    ];

    for (const { externalId, alias } of expected) {
      const dish = dishes.find((d) => d.externalId === externalId);
      expect(dish, `dish ${externalId} not found in JSON`).toBeDefined();
      expect(
        dish!.aliases,
        `${externalId} aliases must contain "${alias}"`,
      ).toContain(alias);
      expect(alias.toLowerCase()).not.toBe(dish!.nameEs.toLowerCase());
    }
  });

  // ---------------------------------------------------------------------------
  // AC-3e: real spanish-dishes.json passes uniqueness check with valid: true
  // ---------------------------------------------------------------------------

  it('AC-3e: real spanish-dishes.json passes the uniqueness check with valid: true', () => {
    const jsonPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../prisma/seed-data/spanish-dishes.json',
    );
    // NOTE: The path above goes 2 levels up from packages/api/src/__tests__ —
    // `..` → `packages/api/src`, `..` → `packages/api`, then `prisma/...`.
    // An earlier draft had `../../../prisma/...` (3 levels) which incorrectly
    // resolved to `packages/prisma/...` (Codex CRITICAL review finding).
    const { dishes } = JSON.parse(readFileSync(jsonPath, 'utf8')) as { dishes: SpanishDishEntry[] };
    const result = validateSpanishDishes(dishes);
    // Filter out [WARN] entries (non-blocking); only blocking errors matter here
    const blockingErrors = result.errors.filter((e) => !e.startsWith('[WARN]'));
    expect(blockingErrors).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Code-review MEDIUM — 3-way collision with 2-entry allow-list
  // Adversarial case: a term shared by 3 dishes where the allow-list covers
  // only 2 of them. Strict set equality must reject (size mismatch).
  // ---------------------------------------------------------------------------

  it('3-way collision: allow-list with only 2 of 3 colliders → still blocked (set-equality strict)', () => {
    const dishA = makeEntry({
      externalId: 'CE-T90',
      dishId: '90000000-0000-0000-0000-000000000001',
      nutrientId: '90000000-0000-f4b0-0008-000000000001',
      name: 'Tortilla A',
      nameEs: 'Tortilla A',
      aliases: ['tortilla'],
    });
    const dishB = makeEntry({
      externalId: 'CE-T91',
      dishId: '91000000-0000-0000-0000-000000000002',
      nutrientId: '91000000-0000-f4b0-0008-000000000002',
      name: 'Tortilla B',
      nameEs: 'Tortilla B',
      aliases: ['tortilla'],
    });
    const dishC = makeEntry({
      externalId: 'CE-T92',
      dishId: '92000000-0000-0000-0000-000000000003',
      nutrientId: '92000000-0000-f4b0-0008-000000000003',
      name: 'Tortilla C',
      nameEs: 'Tortilla C',
      aliases: ['tortilla'],
    });

    // Allow-list only covers dishes A + B, leaving C as an un-allowed colliding party.
    const incompleteAllowList = [
      {
        alias: 'tortilla',
        dishIds: [
          '90000000-0000-0000-0000-000000000001',
          '91000000-0000-0000-0000-000000000002',
        ],
        reason: 'Partial allow-list (for test)',
      },
    ];

    // Build dataset of 250 entries with A, B, C at the end (reuse helper pattern inline).
    const filler = Array.from({ length: 247 }, (_unused, i) =>
      makeEntry({
        externalId: `CE-FILLER-${i.toString().padStart(3, '0')}`,
        dishId: `10000000-0000-f4b0-0007-${i.toString().padStart(12, '0')}`,
        nutrientId: `10000000-0000-f4b0-0008-${i.toString().padStart(12, '0')}`,
        name: `Filler-${i}`,
        nameEs: `Filler-${i}`,
        aliases: [`filler-${i}`],
      }),
    );
    const dataset = [...filler, dishA, dishB, dishC];

    const result = validateSpanishDishesWithAllowList(dataset, incompleteAllowList);

    expect(result.valid).toBe(false);
    const collisionErrors = result.errors.filter((e) =>
      e.includes('Collision in lookup key space'),
    );
    expect(collisionErrors).toHaveLength(1);
    expect(collisionErrors[0]).toContain('"tortilla"');
    expect(collisionErrors[0]).toContain('CE-T90');
    expect(collisionErrors[0]).toContain('CE-T91');
    expect(collisionErrors[0]).toContain('CE-T92');
  });

  // ---------------------------------------------------------------------------
  // Code-review MEDIUM — allow-list entry with non-lowercase alias is rejected
  // ---------------------------------------------------------------------------

  it('allow-list integrity: rejects an entry whose alias is not lowercase', () => {
    const dishA = makeEntry({
      externalId: 'CE-T93',
      dishId: '93000000-0000-0000-0000-000000000004',
      nutrientId: '93000000-0000-f4b0-0008-000000000004',
      name: 'Placeholder A',
      nameEs: 'Placeholder A',
      aliases: ['manzanilla'],
    });
    const dishB = makeEntry({
      externalId: 'CE-T94',
      dishId: '94000000-0000-0000-0000-000000000005',
      nutrientId: '94000000-0000-f4b0-0008-000000000005',
      name: 'Placeholder B',
      nameEs: 'Placeholder B',
      aliases: ['manzanilla'],
    });

    const badAllowList = [
      {
        alias: 'Manzanilla', // BAD: not lowercase
        dishIds: [
          '93000000-0000-0000-0000-000000000004',
          '94000000-0000-0000-0000-000000000005',
        ],
        reason: 'Test non-lowercase alias',
      },
    ];

    const result = validateSpanishDishesWithAllowList(make2DishDataset(dishA, dishB), badAllowList);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes('HOMOGRAPH_ALLOW_LIST entry alias must be lowercase')),
    ).toBe(true);
  });
});
