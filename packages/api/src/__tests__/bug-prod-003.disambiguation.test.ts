// BUG-PROD-003 — Disambiguation of ambiguous plain Spanish food queries.
//
// Data-integrity tests for the alias additions in spanish-dishes.json.
//
// Context: searching "vino" or "cerveza" without a qualifier used to hit the
// FTS fallback in level1Lookup.ftsDishMatch and return whichever matching dish
// had the shortest name — "Manzanilla (vino)" and "Cerveza lata" respectively.
// Both are specialty items, not the canonical Spanish default. Fix: add the
// bare plain terms as aliases on the preferred default dishes so that Strategy
// 1 (exactDishMatch via GIN-indexed `aliases @> ARRAY[...]`) hits first.
//
// This test runs against the seed JSON directly — the level1Lookup SQL logic
// is already covered by f078.regional-aliases.unit.test.ts. What we lock in
// here is the **data** so the fix cannot silently regress.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

interface SeedDish {
  externalId: string;
  name: string;
  nameEs: string;
  aliases?: string[];
}

interface SeedData {
  dishes: SeedDish[];
}

const SEED_PATH = resolve(
  __dirname,
  '..',
  '..',
  'prisma',
  'seed-data',
  'spanish-dishes.json',
);

const seed: SeedData = JSON.parse(readFileSync(SEED_PATH, 'utf-8')) as SeedData;

function dishesWithAlias(alias: string): SeedDish[] {
  return seed.dishes.filter((d) => (d.aliases ?? []).includes(alias));
}

function dishByExactName(name: string): SeedDish | undefined {
  return seed.dishes.find((d) => d.nameEs === name || d.name === name);
}

// ---------------------------------------------------------------------------
// Primary fix
// ---------------------------------------------------------------------------

describe('BUG-PROD-003 — alias additions', () => {
  it('Copa de vino tinto claims the bare alias "vino"', () => {
    const dish = dishByExactName('Copa de vino tinto');
    expect(dish).toBeDefined();
    expect(dish?.aliases).toContain('vino');
  });

  it('Cerveza lata claims the bare alias "cerveza"', () => {
    const dish = dishByExactName('Cerveza lata');
    expect(dish).toBeDefined();
    expect(dish?.aliases).toContain('cerveza');
  });
});

// ---------------------------------------------------------------------------
// Invariant: each disambiguation alias is owned by exactly one dish
// ---------------------------------------------------------------------------

describe('BUG-PROD-003 — disambiguation aliases must be unique', () => {
  it('only one dish claims the alias "vino"', () => {
    const owners = dishesWithAlias('vino');
    expect(owners).toHaveLength(1);
    expect(owners[0]?.nameEs).toBe('Copa de vino tinto');
  });

  it('only one dish claims the alias "cerveza"', () => {
    const owners = dishesWithAlias('cerveza');
    expect(owners).toHaveLength(1);
    expect(owners[0]?.nameEs).toBe('Cerveza lata');
  });
});

// ---------------------------------------------------------------------------
// Regression: existing aliases must still resolve to the same dishes
// ---------------------------------------------------------------------------

describe('BUG-PROD-003 — existing aliases still route correctly', () => {
  it('"vino tinto" routes to Copa de vino tinto', () => {
    const owners = dishesWithAlias('vino tinto');
    expect(owners.map((d) => d.nameEs)).toContain('Copa de vino tinto');
  });

  it('"vino blanco" routes to Copa de vino blanco', () => {
    const owners = dishesWithAlias('vino blanco');
    expect(owners.map((d) => d.nameEs)).toContain('Copa de vino blanco');
  });

  it('"vino de manzanilla" still routes to Manzanilla (vino)', () => {
    const owners = dishesWithAlias('vino de manzanilla');
    expect(owners.map((d) => d.nameEs)).toContain('Manzanilla (vino)');
  });

  it('"caña" still routes to Caña de cerveza', () => {
    const owners = dishesWithAlias('caña');
    expect(owners.map((d) => d.nameEs)).toContain('Caña de cerveza');
  });

  it('"tercio" still routes to Cerveza lata', () => {
    const owners = dishesWithAlias('tercio');
    expect(owners.map((d) => d.nameEs)).toContain('Cerveza lata');
  });

  it('"agua" still routes to Agua mineral (documented, already correct)', () => {
    const owners = dishesWithAlias('agua');
    expect(owners.map((d) => d.nameEs)).toContain('Agua mineral');
  });
});
