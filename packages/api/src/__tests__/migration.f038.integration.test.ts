// Integration tests for F038 — name_source_locale migration
//
// Verifies that the name_source_locale column exists on the dishes table
// with the correct type and nullability.

import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

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
// F038 — name_source_locale column existence
// ---------------------------------------------------------------------------

describe('F038 migration — name_source_locale column on dishes table', () => {
  type ColInfoRow = {
    column_name: string;
    data_type: string;
    character_maximum_length: number | null;
    is_nullable: string;
  };

  it('name_source_locale column exists on dishes table', async () => {
    const rows = await prisma.$queryRaw<ColInfoRow[]>`
      SELECT column_name, data_type, character_maximum_length, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'dishes'
        AND column_name = 'name_source_locale'
        AND table_schema = 'public'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['column_name']).toBe('name_source_locale');
  });

  it('name_source_locale has data_type character varying', async () => {
    const rows = await prisma.$queryRaw<ColInfoRow[]>`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_name = 'dishes'
        AND column_name = 'name_source_locale'
        AND table_schema = 'public'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['data_type']).toBe('character varying');
  });

  it('name_source_locale is nullable', async () => {
    const rows = await prisma.$queryRaw<ColInfoRow[]>`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_name = 'dishes'
        AND column_name = 'name_source_locale'
        AND table_schema = 'public'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['is_nullable']).toBe('YES');
  });

  it('name_source_locale has character_maximum_length of 5', async () => {
    const rows = await prisma.$queryRaw<ColInfoRow[]>`
      SELECT character_maximum_length
      FROM information_schema.columns
      WHERE table_name = 'dishes'
        AND column_name = 'name_source_locale'
        AND table_schema = 'public'
    `;
    expect(rows).toHaveLength(1);
    // character_maximum_length comes back as bigint from pg driver
    expect(Number(rows[0]?.['character_maximum_length'])).toBe(5);
  });
});
