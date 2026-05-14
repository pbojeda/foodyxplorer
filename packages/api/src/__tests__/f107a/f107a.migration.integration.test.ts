// F107a — Migration integration tests (AC1, AC2, AC3)
//
// Asserts table and column shapes, FK existence, and index existence after
// migrations 20260514100000, 20260514110000, 20260514120000 are applied.
//
// Uses real test DB (DATABASE_URL_TEST). Purely read-only — no fixture creation.
// Migrations must be applied before running these tests.

import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Migration 1: public.accounts (AC1)
// ---------------------------------------------------------------------------

describe('F107a — Migration 1: public.accounts table', () => {
  it('accounts table exists with expected columns', async () => {
    type ColRow = { column_name: string; data_type: string; is_nullable: string };
    const rows = await prisma.$queryRaw<ColRow[]>`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'accounts'
      ORDER BY ordinal_position
    `;

    const colNames = rows.map((r) => r['column_name']);
    expect(colNames).toContain('id');
    expect(colNames).toContain('auth_user_id');
    expect(colNames).toContain('email');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('last_seen_at');
    expect(colNames).toContain('consent_marketing');
    expect(colNames).toContain('consent_marketing_at');
    expect(colNames).toContain('consent_analytics');
    expect(colNames).toContain('consent_analytics_at');
  });

  it('accounts.auth_user_id has a UNIQUE constraint', async () => {
    type ConstraintRow = { constraint_name: string; constraint_type: string };
    const rows = await prisma.$queryRaw<ConstraintRow[]>`
      SELECT tc.constraint_name, tc.constraint_type
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'accounts'
        AND kcu.column_name = 'auth_user_id'
        AND tc.constraint_type = 'UNIQUE'
    `;
    expect(rows.length).toBeGreaterThan(0);
  });

  it('accounts_email_idx non-unique index exists on accounts(email)', async () => {
    type IndexRow = { indexname: string; indexdef: string };
    const rows = await prisma.$queryRaw<IndexRow[]>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'accounts'
        AND indexname = 'accounts_email_idx'
    `;
    expect(rows.length).toBe(1);
    // Non-unique: indexdef does NOT contain UNIQUE
    expect(rows[0]?.['indexdef']).not.toContain('UNIQUE');
  });
});

// ---------------------------------------------------------------------------
// Migration 2: actors.account_id column, FK, index (AC2)
// ---------------------------------------------------------------------------

describe('F107a — Migration 2: actors.account_id column + FK + index', () => {
  it('actors table has account_id column (nullable uuid)', async () => {
    type ColRow = { column_name: string; data_type: string; is_nullable: string };
    const rows = await prisma.$queryRaw<ColRow[]>`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'actors'
        AND column_name = 'account_id'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]?.['is_nullable']).toBe('YES');
  });

  it('actors.account_id has FK to accounts(id) ON DELETE SET NULL', async () => {
    type FkRow = { constraint_name: string; delete_rule: string };
    const rows = await prisma.$queryRaw<FkRow[]>`
      SELECT rc.constraint_name, rc.delete_rule
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = rc.constraint_name
        AND kcu.table_schema = 'public'
      WHERE kcu.table_name = 'actors'
        AND kcu.column_name = 'account_id'
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.['delete_rule']).toBe('SET NULL');
  });

  it('actors_account_id_idx non-unique index exists on actors(account_id)', async () => {
    type IndexRow = { indexname: string; indexdef: string };
    const rows = await prisma.$queryRaw<IndexRow[]>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'actors'
        AND indexname = 'actors_account_id_idx'
    `;
    expect(rows.length).toBe(1);
    // Non-unique: must NOT contain UNIQUE keyword
    expect(rows[0]?.['indexdef']).not.toContain('UNIQUE');
  });
});

// ---------------------------------------------------------------------------
// Migration 3: public.profiles placeholder table (AC3)
// ---------------------------------------------------------------------------

describe('F107a — Migration 3: public.profiles placeholder table', () => {
  it('profiles table exists with exactly 2 columns (id, account_id)', async () => {
    type ColRow = { column_name: string };
    const rows = await prisma.$queryRaw<ColRow[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles'
      ORDER BY ordinal_position
    `;
    const colNames = rows.map((r) => r['column_name']);
    expect(colNames).toHaveLength(2);
    expect(colNames).toContain('id');
    expect(colNames).toContain('account_id');
  });

  it('profiles.account_id has FK to accounts(id) ON DELETE CASCADE', async () => {
    type FkRow = { constraint_name: string; delete_rule: string };
    const rows = await prisma.$queryRaw<FkRow[]>`
      SELECT rc.constraint_name, rc.delete_rule
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = rc.constraint_name
        AND kcu.table_schema = 'public'
      WHERE kcu.table_name = 'profiles'
        AND kcu.column_name = 'account_id'
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.['delete_rule']).toBe('CASCADE');
  });
});
