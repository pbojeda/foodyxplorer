// Integration tests for F012 — Seed Phase 4 (Domino's Spain image chain)
//
// Requires foodxplorer_test DB with all migrations applied.
// Uses DATABASE_URL_TEST env var.
// Imports seedPhase4 directly (no subprocess).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedPhase4 } from '../../prisma/seed.js';
import { CHAIN_SEED_IDS } from '../config/chains/chain-seed-ids.js';

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

// All Phase 4 IDs for cleanup
const PHASE4_SOURCE_IDS = [
  CHAIN_SEED_IDS.DOMINOS_ES.SOURCE_ID,
];

const PHASE4_RESTAURANT_IDS = [
  CHAIN_SEED_IDS.DOMINOS_ES.RESTAURANT_ID,
];

async function cleanPhase4(): Promise<void> {
  // Clean in reverse FK order: dishes (referencing these restaurants) first,
  // then restaurants, then data sources.
  await prisma.dish.deleteMany({
    where: { restaurantId: { in: PHASE4_RESTAURANT_IDS } },
  });
  await prisma.restaurant.deleteMany({
    where: { id: { in: PHASE4_RESTAURANT_IDS } },
  });
  await prisma.dataSource.deleteMany({
    where: { id: { in: PHASE4_SOURCE_IDS } },
  });
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await cleanPhase4();
  await seedPhase4(prisma);
});

afterAll(async () => {
  await cleanPhase4();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("F012 — Seed Phase 4 integration (Domino's Spain)", () => {
  it("creates Domino's dataSource row with correct id, name, type", async () => {
    const ds = await prisma.dataSource.findUnique({
      where: { id: CHAIN_SEED_IDS.DOMINOS_ES.SOURCE_ID },
    });
    expect(ds).not.toBeNull();
    expect(ds?.name).toBe("Domino's Spain — Official Nutritional Images");
    expect(ds?.type).toBe('scraped');
  });

  it("creates Domino's dataSource with correct URL", async () => {
    const ds = await prisma.dataSource.findUnique({
      where: { id: CHAIN_SEED_IDS.DOMINOS_ES.SOURCE_ID },
    });
    expect(ds?.url).toBe('https://alergenos.dominospizza.es/img/');
  });

  it("creates Domino's restaurant row with correct id, chainSlug, countryCode", async () => {
    const r = await prisma.restaurant.findUnique({
      where: { id: CHAIN_SEED_IDS.DOMINOS_ES.RESTAURANT_ID },
    });
    expect(r).not.toBeNull();
    expect(r?.chainSlug).toBe('dominos-es');
    expect(r?.countryCode).toBe('ES');
    expect(r?.name).toBe("Domino's Spain");
  });

  it("creates Domino's restaurant with correct website", async () => {
    const r = await prisma.restaurant.findUnique({
      where: { id: CHAIN_SEED_IDS.DOMINOS_ES.RESTAURANT_ID },
    });
    expect(r?.website).toBe('https://www.dominospizza.es');
    expect(r?.isActive).toBe(true);
  });

  // Idempotency
  it('second seedPhase4 call completes without error (idempotency)', async () => {
    await expect(seedPhase4(prisma)).resolves.toBeUndefined();
  });

  it('row count is exactly 1 dataSource and 1 restaurant after two calls', async () => {
    const dsCount = await prisma.dataSource.count({
      where: { id: { in: PHASE4_SOURCE_IDS } },
    });
    const rCount = await prisma.restaurant.count({
      where: { id: { in: PHASE4_RESTAURANT_IDS } },
    });
    expect(dsCount).toBe(1);
    expect(rCount).toBe(1);
  });
});
