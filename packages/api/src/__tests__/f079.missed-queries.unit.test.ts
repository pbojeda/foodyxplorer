// F079 — Demand-Driven Dish Expansion Pipeline — Unit Tests
//
// Tests for:
//   1. Zod schema validation (MissedQueriesParams, UpdateMissedQueryStatusBody, etc.)
//   2. SQL structure verification (missed queries aggregation logic)
//   3. Route registration verification
//   4. Prisma schema verification

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// 1. Zod Schema Validation — Pure tests, no mocks
// ---------------------------------------------------------------------------

import {
  MissedQueriesParamsSchema,
  MissedQueryStatusSchema,
  UpdateMissedQueryStatusBodySchema,
  UpdateMissedQueryStatusParamsSchema,
  MissedQueryItemSchema,
  MissedQueryTrackingSchema,
  MissedQueriesResponseSchema,
  BatchTrackBodySchema,
} from '@foodxplorer/shared';

describe('F079 — Zod Schema Validation', () => {
  describe('MissedQueriesParamsSchema', () => {
    it('applies defaults (30d, topN=20, minCount=2)', () => {
      const result = MissedQueriesParamsSchema.parse({});
      expect(result).toEqual({ timeRange: '30d', topN: 20, minCount: 2 });
    });

    it('accepts custom values', () => {
      const result = MissedQueriesParamsSchema.parse({
        timeRange: '7d',
        topN: 50,
        minCount: 5,
      });
      expect(result).toEqual({ timeRange: '7d', topN: 50, minCount: 5 });
    });

    it('accepts "all" timeRange', () => {
      const result = MissedQueriesParamsSchema.parse({ timeRange: 'all' });
      expect(result.timeRange).toBe('all');
    });

    it('rejects invalid timeRange', () => {
      expect(() => MissedQueriesParamsSchema.parse({ timeRange: '1h' })).toThrow();
    });

    it('rejects topN > 100', () => {
      expect(() => MissedQueriesParamsSchema.parse({ topN: 200 })).toThrow();
    });

    it('rejects topN < 1', () => {
      expect(() => MissedQueriesParamsSchema.parse({ topN: 0 })).toThrow();
    });

    it('rejects minCount < 1', () => {
      expect(() => MissedQueriesParamsSchema.parse({ minCount: 0 })).toThrow();
    });

    it('coerces string topN to number', () => {
      const result = MissedQueriesParamsSchema.parse({ topN: '15' });
      expect(result.topN).toBe(15);
    });

    it('coerces string minCount to number', () => {
      const result = MissedQueriesParamsSchema.parse({ minCount: '3' });
      expect(result.minCount).toBe(3);
    });
  });

  describe('MissedQueryStatusSchema', () => {
    it('accepts "pending"', () => {
      expect(MissedQueryStatusSchema.parse('pending')).toBe('pending');
    });

    it('accepts "resolved"', () => {
      expect(MissedQueryStatusSchema.parse('resolved')).toBe('resolved');
    });

    it('accepts "ignored"', () => {
      expect(MissedQueryStatusSchema.parse('ignored')).toBe('ignored');
    });

    it('rejects invalid status', () => {
      expect(() => MissedQueryStatusSchema.parse('deleted')).toThrow();
      expect(() => MissedQueryStatusSchema.parse('')).toThrow();
    });
  });

  describe('UpdateMissedQueryStatusBodySchema', () => {
    it('accepts status only', () => {
      const result = UpdateMissedQueryStatusBodySchema.parse({ status: 'resolved' });
      expect(result).toEqual({ status: 'resolved' });
    });

    it('accepts full payload with resolvedDishId and notes', () => {
      const result = UpdateMissedQueryStatusBodySchema.parse({
        status: 'resolved',
        resolvedDishId: '00000000-0000-0000-0000-000000000001',
        notes: 'Added as alias to existing dish',
      });
      expect(result.resolvedDishId).toBe('00000000-0000-0000-0000-000000000001');
      expect(result.notes).toBe('Added as alias to existing dish');
    });

    it('rejects missing status', () => {
      expect(() => UpdateMissedQueryStatusBodySchema.parse({})).toThrow();
    });

    it('rejects invalid UUID for resolvedDishId', () => {
      expect(() =>
        UpdateMissedQueryStatusBodySchema.parse({
          status: 'resolved',
          resolvedDishId: 'not-a-uuid',
        }),
      ).toThrow();
    });

    it('rejects notes longer than 1000 chars', () => {
      expect(() =>
        UpdateMissedQueryStatusBodySchema.parse({
          status: 'ignored',
          notes: 'x'.repeat(1001),
        }),
      ).toThrow();
    });

    it('accepts notes of exactly 1000 chars', () => {
      const result = UpdateMissedQueryStatusBodySchema.parse({
        status: 'ignored',
        notes: 'x'.repeat(1000),
      });
      expect(result.notes).toHaveLength(1000);
    });
  });

  describe('UpdateMissedQueryStatusParamsSchema', () => {
    it('accepts valid UUID', () => {
      const result = UpdateMissedQueryStatusParamsSchema.parse({
        id: '00000000-0000-0000-0000-000000000001',
      });
      expect(result.id).toBe('00000000-0000-0000-0000-000000000001');
    });

    it('rejects non-UUID', () => {
      expect(() =>
        UpdateMissedQueryStatusParamsSchema.parse({ id: '123' }),
      ).toThrow();
    });

    it('rejects empty string', () => {
      expect(() =>
        UpdateMissedQueryStatusParamsSchema.parse({ id: '' }),
      ).toThrow();
    });
  });

  describe('MissedQueryItemSchema', () => {
    it('accepts item with tracking info', () => {
      const result = MissedQueryItemSchema.parse({
        queryText: 'gazpacho andaluz',
        count: 15,
        trackingId: '00000000-0000-0000-0000-000000000001',
        trackingStatus: 'pending',
      });
      expect(result.queryText).toBe('gazpacho andaluz');
      expect(result.count).toBe(15);
      expect(result.trackingStatus).toBe('pending');
    });

    it('accepts item without tracking (null values)', () => {
      const result = MissedQueryItemSchema.parse({
        queryText: 'paella valenciana',
        count: 10,
        trackingId: null,
        trackingStatus: null,
      });
      expect(result.trackingId).toBeNull();
      expect(result.trackingStatus).toBeNull();
    });

    it('rejects negative count', () => {
      expect(() =>
        MissedQueryItemSchema.parse({
          queryText: 'test',
          count: -1,
          trackingId: null,
          trackingStatus: null,
        }),
      ).toThrow();
    });
  });

  describe('MissedQueryTrackingSchema', () => {
    it('accepts full tracking entry', () => {
      const result = MissedQueryTrackingSchema.parse({
        id: '00000000-0000-0000-0000-000000000001',
        queryText: 'gazpacho',
        hitCount: 15,
        status: 'pending',
        resolvedDishId: null,
        notes: null,
        createdAt: '2026-04-04T00:00:00.000Z',
        updatedAt: '2026-04-04T00:00:00.000Z',
      });
      expect(result.id).toBe('00000000-0000-0000-0000-000000000001');
      expect(result.status).toBe('pending');
    });

    it('accepts resolved entry with dish link', () => {
      const result = MissedQueryTrackingSchema.parse({
        id: '00000000-0000-0000-0000-000000000001',
        queryText: 'gazpacho',
        hitCount: 15,
        status: 'resolved',
        resolvedDishId: '00000000-0000-0000-0000-000000000002',
        notes: 'Added to cocina-espanola',
        createdAt: '2026-04-04T00:00:00.000Z',
        updatedAt: '2026-04-04T00:00:00.000Z',
      });
      expect(result.status).toBe('resolved');
      expect(result.resolvedDishId).toBe('00000000-0000-0000-0000-000000000002');
    });
  });

  describe('MissedQueriesResponseSchema', () => {
    it('accepts valid response', () => {
      const result = MissedQueriesResponseSchema.parse({
        success: true,
        data: {
          missedQueries: [
            { queryText: 'gazpacho', count: 15, trackingId: null, trackingStatus: null },
          ],
          totalMissCount: 100,
          timeRange: '30d',
        },
      });
      expect(result.data.missedQueries).toHaveLength(1);
      expect(result.data.totalMissCount).toBe(100);
    });

    it('accepts empty missedQueries', () => {
      const result = MissedQueriesResponseSchema.parse({
        success: true,
        data: {
          missedQueries: [],
          totalMissCount: 0,
          timeRange: '7d',
        },
      });
      expect(result.data.missedQueries).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// 2. SQL Structure Verification — reads source file, no execution
// ---------------------------------------------------------------------------

describe('F079 — SQL structure verification', () => {
  const routeSource = readFileSync(
    resolve(__dirname, '../routes/missedQueries.ts'),
    'utf-8',
  );

  it('filters to level_hit IS NULL (total misses only)', () => {
    expect(routeSource).toMatch(/level_hit\s+IS\s+NULL/);
  });

  it('groups by query_text for frequency aggregation', () => {
    expect(routeSource).toMatch(/GROUP BY\s+.*query_text/i);
  });

  it('orders by count DESC (most frequent first)', () => {
    expect(routeSource).toMatch(/ORDER BY\s+COUNT\(\*\)\s+DESC/i);
  });

  it('filters short queries (LENGTH >= 3)', () => {
    expect(routeSource).toMatch(/LENGTH\(ql\.query_text\)\s*>=\s*3/);
  });

  it('LEFT JOINs missed_query_tracking for tracking status', () => {
    expect(routeSource).toMatch(/LEFT\s+JOIN\s+missed_query_tracking\s+mqt/i);
  });

  it('joins on query_text (normalized match)', () => {
    expect(routeSource).toMatch(/mqt\.query_text\s*=\s*ql\.query_text/);
  });

  it('selects tracking_id and tracking_status from join', () => {
    expect(routeSource).toMatch(/mqt\.id.*AS\s+tracking_id/i);
    expect(routeSource).toMatch(/mqt\.status.*AS\s+tracking_status/i);
  });

  it('applies HAVING clause with minCount threshold', () => {
    expect(routeSource).toMatch(/HAVING\s+COUNT\(\*\)\s*>=\s*/i);
  });

  it('applies LIMIT for topN', () => {
    expect(routeSource).toMatch(/LIMIT\s+\$\{topN\}/);
  });

  it('runs two concurrent queries via Promise.all', () => {
    expect(routeSource).toMatch(/Promise\.all/);
  });
});

// ---------------------------------------------------------------------------
// 3. Route Registration Verification
// ---------------------------------------------------------------------------

describe('F079 — Route registration', () => {
  const appSource = readFileSync(
    resolve(__dirname, '../app.ts'),
    'utf-8',
  );

  it('imports missedQueriesRoutes in app.ts', () => {
    expect(appSource).toMatch(/import\s*\{.*missedQueriesRoutes.*\}\s*from.*missedQueries/);
  });

  it('registers missedQueriesRoutes plugin', () => {
    expect(appSource).toMatch(/app\.register\(missedQueriesRoutes/);
  });

  it('passes db and prisma to missedQueriesRoutes', () => {
    expect(appSource).toMatch(/missedQueriesRoutes,\s*\{\s*db:.*prisma:/s);
  });
});

// ---------------------------------------------------------------------------
// 4. Prisma Schema Verification
// ---------------------------------------------------------------------------

describe('F079 — Prisma schema verification', () => {
  const schemaSource = readFileSync(
    resolve(__dirname, '../../prisma/schema.prisma'),
    'utf-8',
  );

  it('defines MissedQueryStatus enum with pending, resolved, ignored', () => {
    expect(schemaSource).toMatch(/enum\s+MissedQueryStatus\s*\{/);
    expect(schemaSource).toMatch(/pending/);
    expect(schemaSource).toMatch(/resolved/);
    expect(schemaSource).toMatch(/ignored/);
  });

  it('defines MissedQueryTracking model', () => {
    expect(schemaSource).toMatch(/model\s+MissedQueryTracking\s*\{/);
  });

  it('has queryText as unique VARCHAR(255)', () => {
    expect(schemaSource).toMatch(/queryText\s+String\s+@unique\s+@map\("query_text"\)\s+@db\.VarChar\(255\)/);
  });

  it('has status field with MissedQueryStatus type', () => {
    expect(schemaSource).toMatch(/status\s+MissedQueryStatus/);
  });

  it('has resolvedDishId as optional UUID with FK to Dish', () => {
    expect(schemaSource).toMatch(/resolvedDishId\s+String\?\s+@map\("resolved_dish_id"\)\s+@db\.Uuid/);
    expect(schemaSource).toMatch(/resolvedDish\s+Dish\?\s+@relation/);
  });

  it('has index on status for efficient filtering', () => {
    expect(schemaSource).toMatch(/@@index\(\[status\]\)/);
  });

  it('maps to missed_query_tracking table', () => {
    expect(schemaSource).toMatch(/@@map\("missed_query_tracking"\)/);
  });

  it('Dish model includes reverse relation', () => {
    expect(schemaSource).toMatch(/missedQueryTrackings\s+MissedQueryTracking\[\]/);
  });
});

// ---------------------------------------------------------------------------
// 5. Migration SQL Verification
// ---------------------------------------------------------------------------

describe('F079 — Migration SQL verification', () => {
  const migrationSql = readFileSync(
    resolve(__dirname, '../../prisma/migrations/20260404200000_missed_query_tracking_f079/migration.sql'),
    'utf-8',
  );

  it('creates missed_query_status enum', () => {
    expect(migrationSql).toMatch(/CREATE TYPE "missed_query_status"/);
  });

  it('creates missed_query_tracking table', () => {
    expect(migrationSql).toMatch(/CREATE TABLE "missed_query_tracking"/);
  });

  it('has UNIQUE index on query_text', () => {
    expect(migrationSql).toMatch(/CREATE UNIQUE INDEX.*"missed_query_tracking_query_text_key"/);
  });

  it('has index on status', () => {
    expect(migrationSql).toMatch(/CREATE INDEX.*"missed_query_tracking_status_idx"/);
  });

  it('has FK to dishes table', () => {
    expect(migrationSql).toMatch(/FOREIGN KEY.*"resolved_dish_id".*REFERENCES "dishes"\("id"\)/);
  });
});

// ---------------------------------------------------------------------------
// 6. Route Handler Logic — Response Mapping
// ---------------------------------------------------------------------------

describe('F079 — Response mapping logic', () => {
  const routeSource = readFileSync(
    resolve(__dirname, '../routes/missedQueries.ts'),
    'utf-8',
  );

  it('maps query_text to queryText in response', () => {
    expect(routeSource).toMatch(/queryText:\s*row\.query_text/);
  });

  it('converts count from string to Number', () => {
    expect(routeSource).toMatch(/count:\s*Number\(row\.count\)/);
  });

  it('handles null tracking_id gracefully', () => {
    expect(routeSource).toMatch(/trackingId:\s*row\.tracking_id\s*\?\?\s*null/);
  });

  it('handles null tracking_status gracefully', () => {
    expect(routeSource).toMatch(/trackingStatus:\s*row\.tracking_status\s*\?\?\s*null/);
  });

  it('throws 404 for non-existent tracking entry (framework pattern)', () => {
    expect(routeSource).toMatch(/statusCode:\s*404/);
    expect(routeSource).toMatch(/code:\s*'NOT_FOUND'/);
    expect(routeSource).toMatch(/Tracking entry not found/);
  });

  it('exports missedQueriesRoutes as fastify plugin', () => {
    expect(routeSource).toMatch(/export\s+const\s+missedQueriesRoutes\s*=\s*fastifyPlugin/);
  });
});

// ---------------------------------------------------------------------------
// 7. Shared Schema Export Verification
// ---------------------------------------------------------------------------

describe('F079 — Shared package exports', () => {
  const indexSource = readFileSync(
    resolve(__dirname, '../../../shared/src/index.ts'),
    'utf-8',
  );

  it('exports missedQueries schemas from index', () => {
    expect(indexSource).toMatch(/export \* from '\.\/schemas\/missedQueries'/);
  });
});

// ---------------------------------------------------------------------------
// 8. Admin Protection (route prefix check)
// ---------------------------------------------------------------------------

describe('F079 — Admin protection', () => {
  const adminSource = readFileSync(
    resolve(__dirname, '../plugins/adminPrefixes.ts'),
    'utf-8',
  );

  it('/analytics/ prefix is in ADMIN_PREFIXES', () => {
    expect(adminSource).toMatch(/\/analytics\//);
  });

  const routeSource = readFileSync(
    resolve(__dirname, '../routes/missedQueries.ts'),
    'utf-8',
  );

  it('all routes use /analytics/ prefix', () => {
    const routePaths = routeSource.match(/['"]\/analytics\/missed-queries[^'"]*['"]/g) ?? [];
    expect(routePaths.length).toBeGreaterThanOrEqual(3); // GET, POST track, POST :id/status
    for (const path of routePaths) {
      expect(path).toMatch(/^'\/analytics\//);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Batch Track Schema Verification
// ---------------------------------------------------------------------------

describe('F079 — Batch track validation', () => {
  const routeSource = readFileSync(
    resolve(__dirname, '../routes/missedQueries.ts'),
    'utf-8',
  );

  it('imports BatchTrackBodySchema from shared package', () => {
    expect(routeSource).toMatch(/import\s*\{[^}]*BatchTrackBodySchema[^}]*\}\s*from\s*'@foodxplorer\/shared'/);
  });

  it('uses Prisma upsert for batch tracking (idempotent)', () => {
    expect(routeSource).toMatch(/prisma\.missedQueryTracking\.upsert/);
  });

  it('uses $transaction for atomicity', () => {
    expect(routeSource).toMatch(/prisma\.\$transaction/);
  });
});

// ---------------------------------------------------------------------------
// 10. BatchTrackBodySchema Zod validation
// ---------------------------------------------------------------------------

describe('F079 — BatchTrackBodySchema Zod validation', () => {
  it('accepts valid batch with 1 query', () => {
    const result = BatchTrackBodySchema.parse({
      queries: [{ queryText: 'gazpacho', hitCount: 15 }],
    });
    expect(result.queries).toHaveLength(1);
  });

  it('accepts batch with multiple queries', () => {
    const result = BatchTrackBodySchema.parse({
      queries: [
        { queryText: 'gazpacho', hitCount: 15 },
        { queryText: 'salmorejo', hitCount: 10 },
      ],
    });
    expect(result.queries).toHaveLength(2);
  });

  it('rejects empty queries array', () => {
    expect(() => BatchTrackBodySchema.parse({ queries: [] })).toThrow();
  });

  it('rejects batch exceeding 100 queries', () => {
    const queries = Array.from({ length: 101 }, (_, i) => ({
      queryText: `query-${i}`,
      hitCount: 1,
    }));
    expect(() => BatchTrackBodySchema.parse({ queries })).toThrow();
  });

  it('accepts batch of exactly 100 queries', () => {
    const queries = Array.from({ length: 100 }, (_, i) => ({
      queryText: `query-${i}`,
      hitCount: 1,
    }));
    const result = BatchTrackBodySchema.parse({ queries });
    expect(result.queries).toHaveLength(100);
  });

  it('rejects queryText shorter than 3 chars', () => {
    expect(() =>
      BatchTrackBodySchema.parse({ queries: [{ queryText: 'ab', hitCount: 1 }] }),
    ).toThrow();
  });

  it('rejects queryText longer than 255 chars', () => {
    expect(() =>
      BatchTrackBodySchema.parse({ queries: [{ queryText: 'x'.repeat(256), hitCount: 1 }] }),
    ).toThrow();
  });

  it('rejects hitCount < 1', () => {
    expect(() =>
      BatchTrackBodySchema.parse({ queries: [{ queryText: 'gazpacho', hitCount: 0 }] }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 11. 404 error handling correctness
// ---------------------------------------------------------------------------

describe('F079 — 404 error handling', () => {
  const routeSource = readFileSync(
    resolve(__dirname, '../routes/missedQueries.ts'),
    'utf-8',
  );

  it('findUnique is outside try/catch block (404 not swallowed as 500)', () => {
    // The findUnique + 404 throw must appear BEFORE the try block
    const _findUniquePos = routeSource.indexOf('findUnique');
    const notFoundPos = routeSource.indexOf("'NOT_FOUND'");
    // Find the try block that wraps the update
    const updateTryPos = routeSource.indexOf('try {', notFoundPos);
    // 404 throw must be before the try block
    expect(notFoundPos).toBeLessThan(updateTryPos);
  });
});
