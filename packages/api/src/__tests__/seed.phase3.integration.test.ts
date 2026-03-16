// Integration tests for F010 — Seed Phase 3 (PDF chain restaurants + data sources)
//
// Requires foodxplorer_test DB with all migrations applied.
// Uses DATABASE_URL_TEST env var.
// Imports seedPhase3 directly (no subprocess).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedPhase3 } from '../../prisma/seed.js';
import { CHAIN_SEED_IDS } from '../config/chains/chain-seed-ids.js';

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

// All Phase 3 IDs for cleanup
const PHASE3_SOURCE_IDS = [
  CHAIN_SEED_IDS.BURGER_KING_ES.SOURCE_ID,
  CHAIN_SEED_IDS.KFC_ES.SOURCE_ID,
  CHAIN_SEED_IDS.TELEPIZZA_ES.SOURCE_ID,
  CHAIN_SEED_IDS.FIVE_GUYS_ES.SOURCE_ID,
];

const PHASE3_RESTAURANT_IDS = [
  CHAIN_SEED_IDS.BURGER_KING_ES.RESTAURANT_ID,
  CHAIN_SEED_IDS.KFC_ES.RESTAURANT_ID,
  CHAIN_SEED_IDS.TELEPIZZA_ES.RESTAURANT_ID,
  CHAIN_SEED_IDS.FIVE_GUYS_ES.RESTAURANT_ID,
];

async function cleanPhase3(): Promise<void> {
  // Clean in reverse FK order: dishes (referencing these restaurants) first,
  // then restaurants, then data sources.
  await prisma.dish.deleteMany({
    where: { restaurantId: { in: PHASE3_RESTAURANT_IDS } },
  });
  await prisma.restaurant.deleteMany({
    where: { id: { in: PHASE3_RESTAURANT_IDS } },
  });
  await prisma.dataSource.deleteMany({
    where: { id: { in: PHASE3_SOURCE_IDS } },
  });
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await cleanPhase3();
  await seedPhase3(prisma);
});

afterAll(async () => {
  await cleanPhase3();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F010 — Seed Phase 3 integration', () => {
  // Burger King Spain
  it('creates BK dataSource row with correct id, name, type', async () => {
    const ds = await prisma.dataSource.findUnique({
      where: { id: CHAIN_SEED_IDS.BURGER_KING_ES.SOURCE_ID },
    });
    expect(ds).not.toBeNull();
    expect(ds?.name).toBe('Burger King Spain — Nutritional PDF');
    expect(ds?.type).toBe('scraped');
  });

  it('creates BK restaurant row with correct id, chainSlug, countryCode', async () => {
    const r = await prisma.restaurant.findUnique({
      where: { id: CHAIN_SEED_IDS.BURGER_KING_ES.RESTAURANT_ID },
    });
    expect(r).not.toBeNull();
    expect(r?.chainSlug).toBe('burger-king-es');
    expect(r?.countryCode).toBe('ES');
    expect(r?.name).toBe('Burger King Spain');
  });

  // KFC Spain
  it('creates KFC dataSource row with correct id, name, type', async () => {
    const ds = await prisma.dataSource.findUnique({
      where: { id: CHAIN_SEED_IDS.KFC_ES.SOURCE_ID },
    });
    expect(ds).not.toBeNull();
    expect(ds?.name).toBe('KFC Spain — Nutritional PDF');
    expect(ds?.type).toBe('scraped');
  });

  it('creates KFC restaurant row with correct id, chainSlug, countryCode', async () => {
    const r = await prisma.restaurant.findUnique({
      where: { id: CHAIN_SEED_IDS.KFC_ES.RESTAURANT_ID },
    });
    expect(r).not.toBeNull();
    expect(r?.chainSlug).toBe('kfc-es');
    expect(r?.countryCode).toBe('ES');
    expect(r?.name).toBe('KFC Spain');
  });

  // Telepizza Spain
  it('creates Telepizza dataSource row with correct id, name, type', async () => {
    const ds = await prisma.dataSource.findUnique({
      where: { id: CHAIN_SEED_IDS.TELEPIZZA_ES.SOURCE_ID },
    });
    expect(ds).not.toBeNull();
    expect(ds?.name).toBe('Telepizza Spain — Nutritional PDF');
    expect(ds?.type).toBe('scraped');
  });

  it('creates Telepizza restaurant row with correct id, chainSlug, countryCode', async () => {
    const r = await prisma.restaurant.findUnique({
      where: { id: CHAIN_SEED_IDS.TELEPIZZA_ES.RESTAURANT_ID },
    });
    expect(r).not.toBeNull();
    expect(r?.chainSlug).toBe('telepizza-es');
    expect(r?.countryCode).toBe('ES');
    expect(r?.name).toBe('Telepizza Spain');
  });

  // Five Guys Spain
  it('creates Five Guys dataSource row with correct id, name, type', async () => {
    const ds = await prisma.dataSource.findUnique({
      where: { id: CHAIN_SEED_IDS.FIVE_GUYS_ES.SOURCE_ID },
    });
    expect(ds).not.toBeNull();
    expect(ds?.name).toBe('Five Guys Spain — Nutritional PDF');
    expect(ds?.type).toBe('scraped');
  });

  it('creates Five Guys restaurant row with correct id, chainSlug, countryCode', async () => {
    const r = await prisma.restaurant.findUnique({
      where: { id: CHAIN_SEED_IDS.FIVE_GUYS_ES.RESTAURANT_ID },
    });
    expect(r).not.toBeNull();
    expect(r?.chainSlug).toBe('five-guys-es');
    expect(r?.countryCode).toBe('ES');
    expect(r?.name).toBe('Five Guys Spain');
  });

  // Idempotency
  it('second seedPhase3 call completes without error (idempotency)', async () => {
    await expect(seedPhase3(prisma)).resolves.toBeUndefined();
  });

  it('row count is exactly 4 dataSources and 4 restaurants after two calls', async () => {
    const dsCount = await prisma.dataSource.count({
      where: { id: { in: PHASE3_SOURCE_IDS } },
    });
    const rCount = await prisma.restaurant.count({
      where: { id: { in: PHASE3_RESTAURANT_IDS } },
    });
    expect(dsCount).toBe(4);
    expect(rCount).toBe(4);
  });
});
