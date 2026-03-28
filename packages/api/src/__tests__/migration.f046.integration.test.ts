// Integration tests for F046 — waitlist_submissions migration
//
// Verifies table structure, constraints, and indexes against the real test DB.
// Run after applying the migration with: prisma migrate deploy

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

// Test data cleanup
beforeAll(async () => {
  await prisma.waitlistSubmission.deleteMany();
});

afterAll(async () => {
  await prisma.waitlistSubmission.deleteMany();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Table existence
// ---------------------------------------------------------------------------

describe('F046 migration — waitlist_submissions table', () => {
  it('table waitlist_submissions exists in pg_tables', async () => {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = 'waitlist_submissions'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['tablename']).toBe('waitlist_submissions');
  });

  // ---------------------------------------------------------------------------
  // Index existence
  // ---------------------------------------------------------------------------

  it('created_at DESC index exists (idx_waitlist_submissions_created_at)', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'waitlist_submissions'
        AND indexname = 'idx_waitlist_submissions_created_at'
    `;
    expect(rows).toHaveLength(1);
  });

  it('unique constraint index on email exists', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'waitlist_submissions'
        AND indexname = 'waitlist_submissions_email_unique'
    `;
    expect(rows).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Constraint violations
  // ---------------------------------------------------------------------------

  it('variant check constraint — rejects variant outside a|c|f', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO waitlist_submissions (email, variant, source)
        VALUES ('checktest@example.com', 'z', 'hero')
      `,
    ).rejects.toThrow();
  });

  it('email format check constraint — rejects invalid email', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO waitlist_submissions (email, variant, source)
        VALUES ('notanemail', 'a', 'hero')
      `,
    ).rejects.toThrow();
  });

  it('unique constraint — inserting duplicate email raises P2002', async () => {
    const email = 'duplicate@example.com';
    await prisma.waitlistSubmission.create({
      data: { email, variant: 'a', source: 'hero' },
    });

    await expect(
      prisma.waitlistSubmission.create({
        data: { email, variant: 'a', source: 'hero' },
      }),
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);

    // Cleanup
    await prisma.waitlistSubmission.deleteMany({ where: { email } });
  });

  // ---------------------------------------------------------------------------
  // Successful insert
  // ---------------------------------------------------------------------------

  it('creates a valid row via prisma.waitlistSubmission.create', async () => {
    const record = await prisma.waitlistSubmission.create({
      data: {
        email: 'valid@example.com',
        phone: '+34612345678',
        variant: 'a',
        source: 'hero',
        utmSource: 'google',
        utmMedium: 'cpc',
        utmCampaign: 'launch-2026',
        ipAddress: '1.2.3.4',
      },
    });

    expect(record.id).toBeTruthy();
    expect(record.email).toBe('valid@example.com');
    expect(record.phone).toBe('+34612345678');
    expect(record.variant).toBe('a');
    expect(record.source).toBe('hero');
    expect(record.utmSource).toBe('google');
    expect(record.createdAt).toBeInstanceOf(Date);

    // Cleanup
    await prisma.waitlistSubmission.delete({ where: { id: record.id } });
  });

  it('ip_address is nullable — accepts null', async () => {
    const record = await prisma.waitlistSubmission.create({
      data: {
        email: 'nullable-ip@example.com',
        variant: 'a',
        source: 'hero',
        ipAddress: null,
      },
    });

    expect(record.ipAddress).toBeNull();

    // Cleanup
    await prisma.waitlistSubmission.delete({ where: { id: record.id } });
  });
});
