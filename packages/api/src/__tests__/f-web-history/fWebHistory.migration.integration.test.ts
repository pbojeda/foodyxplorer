// F-WEB-HISTORY — Migration integration tests (AC1–AC4)
//
// Verifies that the search_history table, enum, index, FK, and CASCADE delete
// are correctly applied after migration 20260527140000_add_search_history.
//
// Uses real test DB (DATABASE_URL_TEST, port 5433). Purely structural tests.

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
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

// ---------------------------------------------------------------------------
// Fixture IDs — f8000000- prefix (unique to F-WEB-HISTORY migration tests)
// ---------------------------------------------------------------------------

const ACCOUNT_ID_CASCADE = 'f8000000-0001-4000-a000-000000000001';
const AUTH_USER_ID_CASCADE = 'f8000000-0010-4000-a000-000000000010';

afterAll(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// AC1: Table structure — all columns exist with correct types
// ---------------------------------------------------------------------------

describe('AC1: search_history table columns', () => {
  it('has all expected columns with correct types', async () => {
    const rows = await prisma.$queryRaw<
      { column_name: string; data_type: string; is_nullable: string }[]
    >`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'search_history'
        AND table_schema = 'public'
      ORDER BY ordinal_position
    `;

    const byName = Object.fromEntries(rows.map((r) => [r['column_name'], r]));

    // id: uuid, NOT NULL
    expect(byName['id']).toBeDefined();
    expect(byName['id']?.['data_type']).toBe('uuid');
    expect(byName['id']?.['is_nullable']).toBe('NO');

    // account_id: uuid, NOT NULL
    expect(byName['account_id']).toBeDefined();
    expect(byName['account_id']?.['data_type']).toBe('uuid');
    expect(byName['account_id']?.['is_nullable']).toBe('NO');

    // kind: USER-DEFINED (enum), NOT NULL
    expect(byName['kind']).toBeDefined();
    expect(byName['kind']?.['data_type']).toBe('USER-DEFINED');
    expect(byName['kind']?.['is_nullable']).toBe('NO');

    // query_text: text, NOT NULL
    expect(byName['query_text']).toBeDefined();
    expect(byName['query_text']?.['data_type']).toBe('text');
    expect(byName['query_text']?.['is_nullable']).toBe('NO');

    // result_jsonb: jsonb, NOT NULL
    expect(byName['result_jsonb']).toBeDefined();
    expect(byName['result_jsonb']?.['data_type']).toBe('jsonb');
    expect(byName['result_jsonb']?.['is_nullable']).toBe('NO');

    // created_at: timestamp with time zone, NOT NULL
    expect(byName['created_at']).toBeDefined();
    expect(byName['created_at']?.['data_type']).toBe('timestamp with time zone');
    expect(byName['created_at']?.['is_nullable']).toBe('NO');
  });
});

// ---------------------------------------------------------------------------
// AC2: Index — search_history_account_cursor_idx exists
// ---------------------------------------------------------------------------

describe('AC2: search_history_account_cursor_idx index', () => {
  it('index exists on the search_history table', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'search_history'
        AND indexname = 'search_history_account_cursor_idx'
    `;
    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC3: FK violation — inserting with non-existent account_id must throw
// ---------------------------------------------------------------------------

describe('AC3: FK violation', () => {
  it('rejects insert with non-existent account_id', async () => {
    const fakeAccountId = 'f8h00000-9999-4000-a000-000000000999';
    await expect(
      prisma.$executeRaw`
        INSERT INTO search_history (account_id, kind, query_text, result_jsonb)
        VALUES (
          ${fakeAccountId}::uuid,
          'text'::search_history_kind,
          'test query',
          '{}'::jsonb
        )
      `,
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC4: CASCADE delete — deleting account removes search_history rows
// ---------------------------------------------------------------------------

describe('AC4: CASCADE delete', () => {
  beforeAll(async () => {
    // Create a fixture account
    await prisma.$executeRaw`
      INSERT INTO accounts (id, auth_user_id, email)
      VALUES (
        ${ACCOUNT_ID_CASCADE}::uuid,
        ${AUTH_USER_ID_CASCADE}::uuid,
        'cascade-test@example.com'
      )
      ON CONFLICT (id) DO NOTHING
    `;
    // Insert a search_history row
    await prisma.$executeRaw`
      INSERT INTO search_history (account_id, kind, query_text, result_jsonb)
      VALUES (
        ${ACCOUNT_ID_CASCADE}::uuid,
        'text'::search_history_kind,
        'test query for cascade',
        '{"intent":"estimation","actorId":"00000000-0000-0000-0000-000000000000"}'::jsonb
      )
    `;
  });

  afterAll(async () => {
    // Clean up in case test failed
    await prisma.$executeRaw`
      DELETE FROM accounts WHERE id = ${ACCOUNT_ID_CASCADE}::uuid
    `.catch(() => {});
  });

  it('deleting the account cascades to search_history rows', async () => {
    // Verify the row exists
    const before = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM search_history WHERE account_id = ${ACCOUNT_ID_CASCADE}::uuid
    `;
    expect(Number(before[0]?.['count'])).toBe(1);

    // Delete the account (should cascade)
    await prisma.$executeRaw`
      DELETE FROM accounts WHERE id = ${ACCOUNT_ID_CASCADE}::uuid
    `;

    // Verify history is gone
    const after = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM search_history WHERE account_id = ${ACCOUNT_ID_CASCADE}::uuid
    `;
    expect(Number(after[0]?.['count'])).toBe(0);
  });
});
