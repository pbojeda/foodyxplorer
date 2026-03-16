// Integration tests for F014 — Seed Phase 5 (Subway Spain PDF chain)
//
// Requires foodxplorer_test DB with all migrations applied.
// Uses DATABASE_URL_TEST env var.
// Imports seedPhase5 directly (no subprocess).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedPhase5 } from '../../prisma/seed.js';
import { CHAIN_SEED_IDS } from '../config/chains/chain-seed-ids.js';

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

// All Phase 5 IDs for cleanup
const PHASE5_SOURCE_IDS = [
  CHAIN_SEED_IDS.SUBWAY_ES.SOURCE_ID,
];

const PHASE5_RESTAURANT_IDS = [
  CHAIN_SEED_IDS.SUBWAY_ES.RESTAURANT_ID,
];

async function cleanPhase5(): Promise<void> {
  // Clean in reverse FK order: dishes (referencing these restaurants) first,
  // then restaurants, then data sources.
  await prisma.dish.deleteMany({
    where: { restaurantId: { in: PHASE5_RESTAURANT_IDS } },
  });
  await prisma.restaurant.deleteMany({
    where: { id: { in: PHASE5_RESTAURANT_IDS } },
  });
  await prisma.dataSource.deleteMany({
    where: { id: { in: PHASE5_SOURCE_IDS } },
  });
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await cleanPhase5();
  await seedPhase5(prisma);
});

afterAll(async () => {
  await cleanPhase5();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F014 — Seed Phase 5 integration (Subway Spain)', () => {
  it('creates Subway dataSource row with correct id, name, type', async () => {
    const ds = await prisma.dataSource.findUnique({
      where: { id: CHAIN_SEED_IDS.SUBWAY_ES.SOURCE_ID },
    });
    expect(ds).not.toBeNull();
    expect(ds?.name).toBe('Subway Spain — Nutritional PDF');
    expect(ds?.type).toBe('scraped');
  });

  it('creates Subway dataSource with correct URL', async () => {
    const ds = await prisma.dataSource.findUnique({
      where: { id: CHAIN_SEED_IDS.SUBWAY_ES.SOURCE_ID },
    });
    expect(ds?.url).toBe('https://subwayspain.com/images/pdfs/nutricional/MED_Nutritional_Information_C4_2025_FINAL_English.pdf');
  });

  it('creates Subway restaurant row with correct id, chainSlug, countryCode', async () => {
    const r = await prisma.restaurant.findUnique({
      where: { id: CHAIN_SEED_IDS.SUBWAY_ES.RESTAURANT_ID },
    });
    expect(r).not.toBeNull();
    expect(r?.chainSlug).toBe('subway-es');
    expect(r?.countryCode).toBe('ES');
    expect(r?.name).toBe('Subway Spain');
  });

  it('creates Subway restaurant with correct nameEs and website', async () => {
    const r = await prisma.restaurant.findUnique({
      where: { id: CHAIN_SEED_IDS.SUBWAY_ES.RESTAURANT_ID },
    });
    expect(r?.nameEs).toBe('Subway España');
    expect(r?.website).toBe('https://subwayspain.com');
    expect(r?.isActive).toBe(true);
  });

  // Idempotency
  it('second seedPhase5 call completes without error (idempotency)', async () => {
    await expect(seedPhase5(prisma)).resolves.toBeUndefined();
  });

  it('row count is exactly 1 dataSource and 1 restaurant after two calls', async () => {
    const dsCount = await prisma.dataSource.count({
      where: { id: { in: PHASE5_SOURCE_IDS } },
    });
    const rCount = await prisma.restaurant.count({
      where: { id: { in: PHASE5_RESTAURANT_IDS } },
    });
    expect(dsCount).toBe(1);
    expect(rCount).toBe(1);
  });
});
