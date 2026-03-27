// Integration tests for F032 — Seed Phase 8 (Telegram Upload DataSource)
//
// Requires foodxplorer_test DB with all migrations applied.
// Uses DATABASE_URL_TEST env var.
// Imports seedPhase8 directly (no subprocess).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedPhase8 } from '../../prisma/seed.js';

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

const TELEGRAM_UPLOAD_ID = '00000000-0000-0000-0000-000000000099';

async function cleanPhase8(): Promise<void> {
  await prisma.dataSource.deleteMany({
    where: { id: TELEGRAM_UPLOAD_ID },
  });
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await cleanPhase8();
  await seedPhase8(prisma);
});

afterAll(async () => {
  await cleanPhase8();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F032 — Seed Phase 8 integration (Telegram Upload DataSource)', () => {
  it('creates Telegram Upload dataSource with correct id', async () => {
    const ds = await prisma.dataSource.findUnique({
      where: { id: TELEGRAM_UPLOAD_ID },
    });
    expect(ds).not.toBeNull();
    expect(ds?.id).toBe(TELEGRAM_UPLOAD_ID);
  });

  it('creates Telegram Upload dataSource with correct name', async () => {
    const ds = await prisma.dataSource.findUnique({
      where: { id: TELEGRAM_UPLOAD_ID },
    });
    expect(ds?.name).toBe('Telegram Upload');
  });

  it('creates Telegram Upload dataSource with type "user"', async () => {
    const ds = await prisma.dataSource.findUnique({
      where: { id: TELEGRAM_UPLOAD_ID },
    });
    expect(ds?.type).toBe('user');
  });

  it('creates Telegram Upload dataSource with url null', async () => {
    const ds = await prisma.dataSource.findUnique({
      where: { id: TELEGRAM_UPLOAD_ID },
    });
    expect(ds?.url).toBeNull();
  });

  it('second seedPhase8 call completes without error (idempotency)', async () => {
    await expect(seedPhase8(prisma)).resolves.toBeUndefined();
  });

  it('row count is exactly 1 dataSource after two calls (upsert, not duplicate insert)', async () => {
    const count = await prisma.dataSource.count({
      where: { id: TELEGRAM_UPLOAD_ID },
    });
    expect(count).toBe(1);
  });
});
