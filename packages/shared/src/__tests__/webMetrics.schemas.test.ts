// Unit tests for webMetrics Zod schemas (F113)
// Pure unit tests — no DB needed, no external deps

import { describe, it, expect } from 'vitest';
import {
  WebMetricsSnapshotSchema,
  WebMetricsQueryParamsSchema,
  WebMetricsAggregateSchema,
} from '../schemas/webMetrics';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validSnapshot(overrides: Record<string, unknown> = {}): unknown {
  return {
    queryCount: 5,
    successCount: 4,
    errorCount: 1,
    retryCount: 0,
    intents: { nutritional_query: 3, comparison: 1 },
    errors: { NETWORK_ERROR: 1 },
    avgResponseTimeMs: 1200,
    sessionStartedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// WebMetricsSnapshotSchema
// ---------------------------------------------------------------------------

describe('WebMetricsSnapshotSchema', () => {
  describe('happy path', () => {
    it('accepts a valid minimal payload', () => {
      const result = WebMetricsSnapshotSchema.safeParse(
        validSnapshot({
          queryCount: 1,
          successCount: 1,
          errorCount: 0,
          retryCount: 0,
          intents: {},
          errors: {},
          avgResponseTimeMs: 0,
        }),
      );
      expect(result.success).toBe(true);
    });

    it('accepts a valid payload with intent and error keys', () => {
      const result = WebMetricsSnapshotSchema.safeParse(validSnapshot());
      expect(result.success).toBe(true);
    });

    it('rounds avgResponseTimeMs float to integer via transform', () => {
      const result = WebMetricsSnapshotSchema.safeParse(
        validSnapshot({ avgResponseTimeMs: 1234.56 }),
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.avgResponseTimeMs).toBe(1235);
      }
    });
  });

  describe('queryCount validation', () => {
    it('rejects queryCount: 0', () => {
      const result = WebMetricsSnapshotSchema.safeParse(
        validSnapshot({ queryCount: 0 }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects non-integer queryCount', () => {
      const result = WebMetricsSnapshotSchema.safeParse(
        validSnapshot({ queryCount: 1.5 }),
      );
      expect(result.success).toBe(false);
    });
  });

  describe('cross-field validation', () => {
    it('rejects successCount > queryCount', () => {
      const result = WebMetricsSnapshotSchema.safeParse(
        validSnapshot({ queryCount: 3, successCount: 4 }),
      );
      expect(result.success).toBe(false);
    });

    it('accepts successCount === queryCount', () => {
      const result = WebMetricsSnapshotSchema.safeParse(
        validSnapshot({ queryCount: 3, successCount: 3, errorCount: 0 }),
      );
      expect(result.success).toBe(true);
    });

    it('rejects errorCount > queryCount', () => {
      const result = WebMetricsSnapshotSchema.safeParse(
        validSnapshot({ queryCount: 2, errorCount: 3, successCount: 1 }),
      );
      expect(result.success).toBe(false);
    });
  });

  describe('avgResponseTimeMs validation', () => {
    it('rejects avgResponseTimeMs > 120000', () => {
      const result = WebMetricsSnapshotSchema.safeParse(
        validSnapshot({ avgResponseTimeMs: 120001 }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects avgResponseTimeMs < 0', () => {
      const result = WebMetricsSnapshotSchema.safeParse(
        validSnapshot({ avgResponseTimeMs: -1 }),
      );
      expect(result.success).toBe(false);
    });

    it('accepts avgResponseTimeMs: 120000 (boundary)', () => {
      const result = WebMetricsSnapshotSchema.safeParse(
        validSnapshot({ avgResponseTimeMs: 120000 }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe('intents validation', () => {
    it('rejects intents with 51 keys (max 50)', () => {
      const intents: Record<string, number> = {};
      for (let i = 0; i < 51; i++) intents[`intent_${i}`] = 1;
      const result = WebMetricsSnapshotSchema.safeParse(
        validSnapshot({ intents }),
      );
      expect(result.success).toBe(false);
    });

    it('accepts intents with exactly 50 keys', () => {
      const intents: Record<string, number> = {};
      for (let i = 0; i < 50; i++) intents[`intent_${i}`] = 1;
      const result = WebMetricsSnapshotSchema.safeParse(
        validSnapshot({ intents }),
      );
      expect(result.success).toBe(true);
    });

    it('rejects intents with negative value', () => {
      const result = WebMetricsSnapshotSchema.safeParse(
        validSnapshot({ intents: { bad_intent: -1 } }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects intents with key > 100 chars', () => {
      const longKey = 'a'.repeat(101);
      const result = WebMetricsSnapshotSchema.safeParse(
        validSnapshot({ intents: { [longKey]: 1 } }),
      );
      expect(result.success).toBe(false);
    });

    it('accepts empty intents object', () => {
      const result = WebMetricsSnapshotSchema.safeParse(
        validSnapshot({ intents: {} }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe('errors validation', () => {
    it('rejects errors with 51 keys', () => {
      const errors: Record<string, number> = {};
      for (let i = 0; i < 51; i++) errors[`ERROR_${i}`] = 1;
      const result = WebMetricsSnapshotSchema.safeParse(
        validSnapshot({ errors }),
      );
      expect(result.success).toBe(false);
    });

    it('accepts empty errors object', () => {
      const result = WebMetricsSnapshotSchema.safeParse(
        validSnapshot({ errors: {} }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe('sessionStartedAt validation', () => {
    it('accepts a valid ISO string (now)', () => {
      const result = WebMetricsSnapshotSchema.safeParse(
        validSnapshot({ sessionStartedAt: new Date().toISOString() }),
      );
      expect(result.success).toBe(true);
    });

    it('rejects sessionStartedAt older than 24 hours', () => {
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const result = WebMetricsSnapshotSchema.safeParse(
        validSnapshot({ sessionStartedAt: old }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects sessionStartedAt more than 1 minute in the future', () => {
      const future = new Date(Date.now() + 2 * 60 * 1000).toISOString();
      const result = WebMetricsSnapshotSchema.safeParse(
        validSnapshot({ sessionStartedAt: future }),
      );
      expect(result.success).toBe(false);
    });

    it('accepts sessionStartedAt 30 seconds in the future (within 1min skew)', () => {
      const nearFuture = new Date(Date.now() + 30 * 1000).toISOString();
      const result = WebMetricsSnapshotSchema.safeParse(
        validSnapshot({ sessionStartedAt: nearFuture }),
      );
      expect(result.success).toBe(true);
    });

    it('rejects sessionStartedAt that is not a valid date string', () => {
      const result = WebMetricsSnapshotSchema.safeParse(
        validSnapshot({ sessionStartedAt: 'not-a-date' }),
      );
      expect(result.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// WebMetricsQueryParamsSchema
// ---------------------------------------------------------------------------

describe('WebMetricsQueryParamsSchema', () => {
  it('defaults timeRange to 7d when omitted', () => {
    const result = WebMetricsQueryParamsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeRange).toBe('7d');
    }
  });

  it('accepts all four enum values', () => {
    for (const value of ['24h', '7d', '30d', 'all']) {
      const result = WebMetricsQueryParamsSchema.safeParse({ timeRange: value });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an invalid timeRange string', () => {
    const result = WebMetricsQueryParamsSchema.safeParse({ timeRange: '1d' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WebMetricsAggregateSchema
// ---------------------------------------------------------------------------

describe('WebMetricsAggregateSchema', () => {
  it('accepts a valid aggregate response', () => {
    const result = WebMetricsAggregateSchema.safeParse({
      eventCount: 42,
      totalQueries: 310,
      totalSuccesses: 285,
      totalErrors: 25,
      totalRetries: 8,
      avgResponseTimeMs: 980.5,
      topIntents: [{ intent: 'nutritional_query', count: 180 }],
      topErrors: [{ errorCode: 'NETWORK_ERROR', count: 15 }],
      timeRange: '7d',
    });
    expect(result.success).toBe(true);
  });

  it('accepts null avgResponseTimeMs (no successes)', () => {
    const result = WebMetricsAggregateSchema.safeParse({
      eventCount: 0,
      totalQueries: 0,
      totalSuccesses: 0,
      totalErrors: 0,
      totalRetries: 0,
      avgResponseTimeMs: null,
      topIntents: [],
      topErrors: [],
      timeRange: '24h',
    });
    expect(result.success).toBe(true);
  });
});
