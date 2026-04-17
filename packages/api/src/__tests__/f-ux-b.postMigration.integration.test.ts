// F-UX-B Integration tests — post-migration correctness (BUG-PROD-009)
//
// Covers:
//   I1: After seed — correct dishIds have 4 rows each
//   I2: After migration DELETE — all 4 ghost dishIds have 0 rows
//   I3: Seed is idempotent — running twice does not duplicate rows
//   I4: Omitted priority names do NOT generate CSV rows
//
// Uses real test DB. Import seedFromParsedRows + parseCsvString directly.
// Does NOT run the prod migration SQL against the test DB.
// The DELETE logic is tested in isolation via prisma.$executeRaw.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

import { seedFromParsedRows, parseCsvString } from '../scripts/seedStandardPortionCsv.js';
import { generateStandardPortionCsv } from '../scripts/generateStandardPortionCsv.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

// ---------------------------------------------------------------------------
// Fixture IDs (f-ux-b-pm prefix to avoid collisions)
// ---------------------------------------------------------------------------

const SRC_ID   = 'fc000000-0009-4000-a000-000000000001';
const REST_ID  = 'fc000000-0009-4000-a000-000000000002';

// Correct dishIds (per new PRIORITY_DISH_MAP)
const JAMON_ID    = '00000000-0000-e073-0007-000000000022'; // Jamón ibérico (**corrected**)
const TORTILLA_ID = '00000000-0000-e073-0007-00000000001c'; // Tortilla de patatas (**corrected**)
const COCIDO_ID   = '00000000-0000-e073-0007-000000000046'; // Cocido madrileño (**corrected**)

// Ghost dishIds (wrong old mappings — must be 0 rows after DELETE)
const GHOST_BOCADILLO_ID  = '00000000-0000-e073-0007-000000000015'; // Bocadillo de jamón york (was "jamón"/"cocido")
const GHOST_PINCHO_ID     = '00000000-0000-e073-0007-000000000007'; // Pincho de tortilla (was "tortilla")
const GHOST_ENTRECOT_ID   = '00000000-0000-e073-0007-000000000069'; // Entrecot de ternera (was "chuletón")
const GHOST_ARROZNIE_ID   = '00000000-0000-e073-0007-000000000084'; // Arroz negro (was "arroz")

const ALL_FIXTURE_DISH_IDS = [
  JAMON_ID, TORTILLA_ID, COCIDO_ID,
  GHOST_BOCADILLO_ID, GHOST_PINCHO_ID, GHOST_ENTRECOT_ID, GHOST_ARROZNIE_ID,
];

// Dishes needed as prerequisites (standardPortion FK → dish)
const FIXTURE_DISH_DEFS = ALL_FIXTURE_DISH_IDS.map((id) => ({
  id,
  name: `BUG-009-fixture-${id}`,
  nameEs: `Fixture dish ${id}`,
  nameSourceLocale: 'es' as const,
  restaurantId: REST_ID,
  sourceId: SRC_ID,
  confidenceLevel: 'high' as const,
  estimationMethod: 'scraped' as const,
  availability: 'available' as const,
}));

// ---------------------------------------------------------------------------
// CSV fixture helpers
// ---------------------------------------------------------------------------

function makeFixtureCsvContent(dishIds: string[]): string {
  const header = 'dishId,term,grams,pieces,pieceName,confidence,notes,reviewed_by';
  const rows: string[] = [];
  for (const dishId of dishIds) {
    for (const term of ['pintxo', 'tapa', 'media_racion', 'racion']) {
      rows.push(`${dishId},${term},100,,,medium,fixture,pbojeda`);
    }
  }
  return [header, ...rows].join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

async function cleanFixtures(): Promise<void> {
  await prisma.standardPortion.deleteMany({ where: { dishId: { in: ALL_FIXTURE_DISH_IDS } } });
  await prisma.dish.deleteMany({ where: { id: { in: ALL_FIXTURE_DISH_IDS } } });
  await prisma.restaurant.deleteMany({ where: { id: REST_ID } });
  await prisma.dataSource.deleteMany({ where: { id: SRC_ID } });
}

beforeAll(async () => {
  await cleanFixtures();

  await prisma.dataSource.create({
    data: { id: SRC_ID, name: 'BUG-009-post-migration-test-src', type: 'official' },
  });

  await prisma.restaurant.create({
    data: { id: REST_ID, name: 'BUG-009 Integration Test Restaurant', chainSlug: 'bug-009-int-test' },
  });

  for (const def of FIXTURE_DISH_DEFS) {
    await prisma.dish.create({ data: def });
  }
});

afterAll(async () => {
  await cleanFixtures();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// I1 — After seed: correct dishIds have 4 rows each
// ---------------------------------------------------------------------------

describe('BUG-PROD-009 post-migration integration', () => {
  it('I1: after seed — correct dishIds have 4 rows each', async () => {
    const csvContent = makeFixtureCsvContent([JAMON_ID, TORTILLA_ID, COCIDO_ID]);
    const { rows } = parseCsvString(csvContent);

    // Filter to reviewed rows only (all are reviewed in this fixture)
    const toSeed = rows.filter((r) => (r['reviewed_by']?.trim() ?? '') !== '');
    await seedFromParsedRows(prisma, toSeed, 0);

    const count = await prisma.standardPortion.count({
      where: { dishId: { in: [JAMON_ID, TORTILLA_ID, COCIDO_ID] } },
    });
    expect(count).toBe(12); // 3 dishes × 4 terms
  });

  // ---------------------------------------------------------------------------
  // I2 — After migration DELETE: ghost dishIds have 0 rows
  // ---------------------------------------------------------------------------

  it('I2: after migration DELETE — all 4 ghost dishIds have 0 rows', async () => {
    // First seed wrong rows at all 4 ghost dishIds
    const ghostCsv = makeFixtureCsvContent([
      GHOST_BOCADILLO_ID, GHOST_PINCHO_ID, GHOST_ENTRECOT_ID, GHOST_ARROZNIE_ID,
    ]);
    const { rows } = parseCsvString(ghostCsv);
    const toSeed = rows.filter((r) => (r['reviewed_by']?.trim() ?? '') !== '');
    await seedFromParsedRows(prisma, toSeed, 0);

    // Verify they were seeded
    const beforeCount = await prisma.standardPortion.count({
      where: { dishId: { in: [GHOST_BOCADILLO_ID, GHOST_PINCHO_ID, GHOST_ENTRECOT_ID, GHOST_ARROZNIE_ID] } },
    });
    expect(beforeCount).toBe(16); // 4 dishIds × 4 terms

    // Run the DELETE (mirrors the migration SQL)
    await prisma.$executeRaw`
      DELETE FROM standard_portions
        WHERE dish_id IN (
          '00000000-0000-e073-0007-000000000015'::uuid,
          '00000000-0000-e073-0007-000000000007'::uuid,
          '00000000-0000-e073-0007-000000000069'::uuid,
          '00000000-0000-e073-0007-000000000084'::uuid
        )
    `;

    const afterCount = await prisma.standardPortion.count({
      where: { dishId: { in: [GHOST_BOCADILLO_ID, GHOST_PINCHO_ID, GHOST_ENTRECOT_ID, GHOST_ARROZNIE_ID] } },
    });
    expect(afterCount).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // I3 — Seed is idempotent: running twice does not duplicate rows
  // ---------------------------------------------------------------------------

  it('I3: seed is idempotent — running twice does not duplicate rows', async () => {
    // Clear first
    await prisma.standardPortion.deleteMany({ where: { dishId: JAMON_ID } });

    const csvContent = makeFixtureCsvContent([JAMON_ID]);
    const { rows } = parseCsvString(csvContent);
    const toSeed = rows.filter((r) => (r['reviewed_by']?.trim() ?? '') !== '');

    // First seed
    await seedFromParsedRows(prisma, toSeed, 0);
    const countAfterFirst = await prisma.standardPortion.count({
      where: { dishId: JAMON_ID },
    });
    expect(countAfterFirst).toBe(4);

    // Second seed (idempotent)
    await seedFromParsedRows(prisma, toSeed, 0);
    const countAfterSecond = await prisma.standardPortion.count({
      where: { dishId: JAMON_ID },
    });
    expect(countAfterSecond).toBe(4); // unchanged
  });

  // ---------------------------------------------------------------------------
  // I4 — Omitted priority names do not generate CSV rows
  // ---------------------------------------------------------------------------

  it('I4: omitted priority names do not appear in generated CSV rows', async () => {
    // Build a fixture spanish-dishes.json with ALL 39 real map dishIds
    const dataDir = path.join(os.tmpdir(), `f-ux-b-pm-i4-${crypto.randomUUID()}`);
    mkdirSync(dataDir, { recursive: true });
    const outputPath = path.join(dataDir, 'output.csv');

    try {
      const ALL_MAP_DISH_IDS = [
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
      ];

      writeFileSync(
        path.join(dataDir, 'spanish-dishes.json'),
        JSON.stringify({ dishes: ALL_MAP_DISH_IDS.map((id) => ({ dishId: id, nameEs: `Dish ${id}` })) }),
        'utf-8',
      );

      await generateStandardPortionCsv({ dataDir, outputPath });

      const { readFileSync: fsReadFileSync } = await import('fs');
      const { rows } = parseCsvString(fsReadFileSync(outputPath, 'utf-8'));

      // dishIds that must NOT appear (the ghost/omitted dishIds)
      const forbiddenDishIds = new Set([
        GHOST_BOCADILLO_ID,  // ...0015 bocadillo de jamón york
        GHOST_PINCHO_ID,     // ...0007 pincho de tortilla
        GHOST_ENTRECOT_ID,   // ...0069 entrecot de ternera (chuletón)
        GHOST_ARROZNIE_ID,   // ...0084 arroz negro (arroz)
      ]);

      for (const row of rows) {
        const dishId = row['dishId'] ?? '';
        expect(
          forbiddenDishIds.has(dishId),
          `Row dishId ${dishId} must not appear in generated CSV (it belongs to an omitted priority name)`,
        ).toBe(false);
      }

      // Also verify exact row count: 39 × 4 = 156
      expect(rows).toHaveLength(156);
    } finally {
      if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
