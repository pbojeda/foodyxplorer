// Integration tests for F029 — Query Logs Migration
//
// Tests: insert a query_logs row with all nullable fields as null,
// verify id/queried_at defaults, verify level_hit=null is valid,
// verify api_key_id has no FK (random UUID accepted),
// verify restaurant_id has no FK (random UUID accepted),
// verify 4 indexes exist via pg_indexes.
//
// Fixture UUIDs use fd000000-0029-4000-a000-000000000XXX pattern.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

// ---------------------------------------------------------------------------
// Query Logs — Schema and constraints
// ---------------------------------------------------------------------------

describe('QueryLog — Schema correctness', () => {
  const LOG_ID = 'fd000000-0029-4000-a000-000000000001';
  const RANDOM_KEY_ID = 'fd000000-0029-4000-a000-000000000002';
  const RANDOM_RESTAURANT_ID = 'fd000000-0029-4000-a000-000000000003';

  beforeAll(async () => {
    // Pre-cleanup
    await prisma.queryLog.deleteMany({ where: { id: LOG_ID } });
  });

  afterAll(async () => {
    await prisma.queryLog.deleteMany({ where: { id: LOG_ID } });
  });

  it('inserts a query_logs row with all nullable fields null and reads it back', async () => {
    const log = await prisma.queryLog.create({
      data: {
        id: LOG_ID,
        queryText: 'big mac',
        chainSlug: null,
        restaurantId: null,
        levelHit: null,
        cacheHit: false,
        responseTimeMs: 42,
        apiKeyId: null,
        source: 'api',
      },
    });

    expect(log.id).toBe(LOG_ID);
    expect(log.queryText).toBe('big mac');
    expect(log.chainSlug).toBeNull();
    expect(log.restaurantId).toBeNull();
    expect(log.levelHit).toBeNull();
    expect(log.cacheHit).toBe(false);
    expect(log.responseTimeMs).toBe(42);
    expect(log.apiKeyId).toBeNull();
    expect(log.source).toBe('api');
    expect(log.queriedAt).toBeInstanceOf(Date);
  });

  it('id and queried_at are set automatically when omitted', async () => {
    const log = await prisma.queryLog.create({
      data: {
        queryText: 'test auto defaults',
        cacheHit: true,
        responseTimeMs: 100,
        source: 'bot',
      },
    });

    expect(log.id).toBeTruthy();
    expect(typeof log.id).toBe('string');
    expect(log.queriedAt).toBeInstanceOf(Date);

    await prisma.queryLog.delete({ where: { id: log.id } });
  });

  it('level_hit = null is valid (total miss scenario)', async () => {
    const log = await prisma.queryLog.create({
      data: {
        queryText: 'unknown dish',
        levelHit: null,
        cacheHit: false,
        responseTimeMs: 10,
        source: 'api',
      },
    });

    expect(log.levelHit).toBeNull();

    await prisma.queryLog.delete({ where: { id: log.id } });
  });

  it('level_hit accepts all enum values (l1, l2, l3, l4)', async () => {
    for (const level of ['l1', 'l2', 'l3', 'l4'] as const) {
      const log = await prisma.queryLog.create({
        data: {
          queryText: `test ${level}`,
          levelHit: level,
          cacheHit: true,
          responseTimeMs: 50,
          source: 'api',
        },
      });
      expect(log.levelHit).toBe(level);
      await prisma.queryLog.delete({ where: { id: log.id } });
    }
  });

  it('api_key_id has no FK enforcement — accepts a random UUID not in api_keys', async () => {
    // This UUID does not exist in api_keys table — should succeed (no FK)
    const log = await prisma.queryLog.create({
      data: {
        queryText: 'no fk test api key',
        apiKeyId: RANDOM_KEY_ID,
        cacheHit: false,
        responseTimeMs: 15,
        source: 'api',
      },
    });

    expect(log.apiKeyId).toBe(RANDOM_KEY_ID);

    await prisma.queryLog.delete({ where: { id: log.id } });
  });

  it('restaurant_id has no FK enforcement — accepts a random UUID not in restaurants', async () => {
    // This UUID does not exist in restaurants table — should succeed (no FK)
    const log = await prisma.queryLog.create({
      data: {
        queryText: 'no fk test restaurant',
        restaurantId: RANDOM_RESTAURANT_ID,
        cacheHit: false,
        responseTimeMs: 15,
        source: 'api',
      },
    });

    expect(log.restaurantId).toBe(RANDOM_RESTAURANT_ID);

    await prisma.queryLog.delete({ where: { id: log.id } });
  });

  it('source defaults to api when omitted', async () => {
    const log = await prisma.$queryRaw<{ source: string }[]>`
      INSERT INTO query_logs (query_text, cache_hit, response_time_ms)
      VALUES ('default source test', false, 10)
      RETURNING source
    `;
    expect(log[0]?.['source']).toBe('api');

    await prisma.queryLog.deleteMany({ where: { queryText: 'default source test' } });
  });
});

// ---------------------------------------------------------------------------
// Index existence
// ---------------------------------------------------------------------------

describe('QueryLog — Index existence', () => {
  type IndexRow = { indexname: string };

  const checkIndex = async (tablename: string, indexname: string): Promise<void> => {
    const rows = await prisma.$queryRaw<IndexRow[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = ${tablename} AND indexname = ${indexname}
    `;
    expect(rows).toHaveLength(1);
  };

  it('query_logs_queried_at_idx exists (DESC)', async () => {
    await checkIndex('query_logs', 'query_logs_queried_at_idx');
  });

  it('query_logs_chain_slug_idx exists', async () => {
    await checkIndex('query_logs', 'query_logs_chain_slug_idx');
  });

  it('query_logs_level_hit_idx exists', async () => {
    await checkIndex('query_logs', 'query_logs_level_hit_idx');
  });

  it('query_logs_source_idx exists', async () => {
    await checkIndex('query_logs', 'query_logs_source_idx');
  });
});

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

afterAll(async () => {
  await prisma.$disconnect();
});
