// Integration tests for F015 — Seed Phase 6 (Pans & Company Spain)
//
// Requires foodxplorer_test DB with all migrations applied.
// Uses DATABASE_URL_TEST env var.
// Imports seedPhase6 directly (no subprocess).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedPhase6 } from '../../prisma/seed.js';
import { CHAIN_SEED_IDS } from '../config/chains/chain-seed-ids.js';

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

// All Phase 6 IDs for cleanup
const PHASE6_SOURCE_IDS = [
  CHAIN_SEED_IDS.PANS_AND_COMPANY_ES.SOURCE_ID,
];

const PHASE6_RESTAURANT_IDS = [
  CHAIN_SEED_IDS.PANS_AND_COMPANY_ES.RESTAURANT_ID,
];

async function cleanPhase6(): Promise<void> {
  // Clean in reverse FK order: dishes first, then restaurants, then data sources.
  await prisma.dish.deleteMany({
    where: { restaurantId: { in: PHASE6_RESTAURANT_IDS } },
  });
  await prisma.restaurant.deleteMany({
    where: { id: { in: PHASE6_RESTAURANT_IDS } },
  });
  await prisma.dataSource.deleteMany({
    where: { id: { in: PHASE6_SOURCE_IDS } },
  });
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await cleanPhase6();
  await seedPhase6(prisma);
});

afterAll(async () => {
  await cleanPhase6();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F015 — Seed Phase 6 integration (Pans & Company Spain)', () => {
  it('creates Pans & Company dataSource row with correct id, name, type', async () => {
    const ds = await prisma.dataSource.findUnique({
      where: { id: CHAIN_SEED_IDS.PANS_AND_COMPANY_ES.SOURCE_ID },
    });
    expect(ds).not.toBeNull();
    expect(ds?.name).toBe('Pans & Company Spain — Nutritional PDF');
    expect(ds?.type).toBe('scraped');
  });

  it('creates Pans & Company dataSource with correct URL', async () => {
    const ds = await prisma.dataSource.findUnique({
      where: { id: CHAIN_SEED_IDS.PANS_AND_COMPANY_ES.SOURCE_ID },
    });
    expect(ds?.url).toBe('https://www.vivabem.pt/tabelas/tabela_pans_company.pdf');
  });

  it('creates Pans & Company restaurant row with correct id, chainSlug, countryCode', async () => {
    const r = await prisma.restaurant.findUnique({
      where: { id: CHAIN_SEED_IDS.PANS_AND_COMPANY_ES.RESTAURANT_ID },
    });
    expect(r).not.toBeNull();
    expect(r?.chainSlug).toBe('pans-and-company-es');
    expect(r?.countryCode).toBe('ES');
    expect(r?.name).toBe('Pans & Company Spain');
  });

  it('creates Pans & Company restaurant with correct nameEs and website', async () => {
    const r = await prisma.restaurant.findUnique({
      where: { id: CHAIN_SEED_IDS.PANS_AND_COMPANY_ES.RESTAURANT_ID },
    });
    expect(r?.nameEs).toBe('Pans & Company España');
    expect(r?.website).toBe('https://www.pansandcompany.com');
    expect(r?.isActive).toBe(true);
  });

  // Idempotency
  it('second seedPhase6 call completes without error (idempotency)', async () => {
    await expect(seedPhase6(prisma)).resolves.toBeUndefined();
  });

  it('row count is exactly 1 dataSource and 1 restaurant after two calls', async () => {
    const dsCount = await prisma.dataSource.count({
      where: { id: { in: PHASE6_SOURCE_IDS } },
    });
    const rCount = await prisma.restaurant.count({
      where: { id: { in: PHASE6_RESTAURANT_IDS } },
    });
    expect(dsCount).toBe(1);
    expect(rCount).toBe(1);
  });
});
