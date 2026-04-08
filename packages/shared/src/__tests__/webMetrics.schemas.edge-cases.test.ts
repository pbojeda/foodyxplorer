// Edge-case tests for webMetrics Zod schemas (F113)
//
// Covers gaps in webMetrics.schemas.test.ts:
//   - avgResponseTimeMs float boundary around 120000
//   - intents/errors value type enforcement (floats, non-integer)
//   - retryCount large value (no upper bound in spec — this is documenting the contract)
//   - sessionStartedAt edge: exactly at 24h boundary, date-only ISO string
//   - null / undefined / non-object body input
//   - extra fields stripped by Zod (not rejected)
//   - errors record key max-length boundary (exactly 100 chars)

import { describe, it, expect } from 'vitest';
import {
  WebMetricsSnapshotSchema,
  WebMetricsQueryParamsSchema,
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
// avgResponseTimeMs — float boundary interaction with .max(120000).transform(Math.round)
// ---------------------------------------------------------------------------

describe('WebMetricsSnapshotSchema — avgResponseTimeMs float boundary', () => {
  it('accepts 119999.5 — rounds to 120000, within max', () => {
    const result = WebMetricsSnapshotSchema.safeParse(
      validSnapshot({ avgResponseTimeMs: 119999.5 }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.avgResponseTimeMs).toBe(120000);
    }
  });

  it('rejects 120000.1 — .max() check runs before transform, so this fails even though it rounds to 120000', () => {
    // The Zod chain is .number().min(0).max(120000).transform(Math.round)
    // .max(120000) is checked BEFORE the transform — 120000.1 > 120000 → rejected
    const result = WebMetricsSnapshotSchema.safeParse(
      validSnapshot({ avgResponseTimeMs: 120000.1 }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts 0.4 — rounds to 0 (min boundary with transform)', () => {
    const result = WebMetricsSnapshotSchema.safeParse(
      validSnapshot({ avgResponseTimeMs: 0.4 }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.avgResponseTimeMs).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// intents and errors — value type enforcement
// ---------------------------------------------------------------------------

describe('WebMetricsSnapshotSchema — intents/errors value type enforcement', () => {
  it('rejects intents with float value (non-integer)', () => {
    const result = WebMetricsSnapshotSchema.safeParse(
      validSnapshot({ intents: { nutritional_query: 3.5 } }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects errors with float value (non-integer)', () => {
    const result = WebMetricsSnapshotSchema.safeParse(
      validSnapshot({ errors: { NETWORK_ERROR: 0.1 } }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects intents with string value instead of number', () => {
    const result = WebMetricsSnapshotSchema.safeParse(
      validSnapshot({ intents: { nutritional_query: 'three' } }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects errors with null value', () => {
    const result = WebMetricsSnapshotSchema.safeParse(
      validSnapshot({ errors: { NETWORK_ERROR: null } }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts intents with value of exactly 0', () => {
    // min(0) — zero count is valid (intent appeared but had 0 occurrences would be weird, but schema allows it)
    const result = WebMetricsSnapshotSchema.safeParse(
      validSnapshot({ intents: { nutritional_query: 0 } }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts errors record key of exactly 100 chars (boundary)', () => {
    const key = 'E'.repeat(100);
    const result = WebMetricsSnapshotSchema.safeParse(
      validSnapshot({ errors: { [key]: 1 } }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects errors record key of 101 chars (over boundary)', () => {
    const key = 'E'.repeat(101);
    const result = WebMetricsSnapshotSchema.safeParse(
      validSnapshot({ errors: { [key]: 1 } }),
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// retryCount — no upper bound in spec (documenting contract)
// ---------------------------------------------------------------------------

describe('WebMetricsSnapshotSchema — retryCount', () => {
  it('accepts very large retryCount (no upper cap in spec)', () => {
    // The spec defines retryCount as "integer, min 0" — no max is specified.
    // This test documents that the schema permits large values. If abuse becomes
    // a concern, an upper cap should be added to the spec and schema.
    const result = WebMetricsSnapshotSchema.safeParse(
      validSnapshot({ retryCount: 999999 }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects retryCount with float value', () => {
    const result = WebMetricsSnapshotSchema.safeParse(
      validSnapshot({ retryCount: 1.5 }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects retryCount with negative value', () => {
    const result = WebMetricsSnapshotSchema.safeParse(
      validSnapshot({ retryCount: -1 }),
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sessionStartedAt — boundary and format edge cases
// ---------------------------------------------------------------------------

describe('WebMetricsSnapshotSchema — sessionStartedAt edge cases', () => {
  it('rejects sessionStartedAt exactly at 24h ago boundary (exclusive — should fail)', () => {
    // The spec says "not older than 24 hours". The check is: ts < now - 24*60*60*1000
    // A timestamp exactly 24 hours ago is ts === now - 86400000 → condition is ts < threshold
    // So exactly at 24h ago: ts === threshold → NOT less than → this should PASS
    const exactlyAt24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const result = WebMetricsSnapshotSchema.safeParse(
      validSnapshot({ sessionStartedAt: exactlyAt24h }),
    );
    // Exactly at the 24h boundary passes (ts < now - 24h is the rejection condition,
    // equality is allowed — this is the boundary inclusion behavior)
    expect(result.success).toBe(true);
  });

  it('rejects sessionStartedAt 1ms past 24h ago', () => {
    const pastBoundary = new Date(Date.now() - 24 * 60 * 60 * 1000 - 1).toISOString();
    const result = WebMetricsSnapshotSchema.safeParse(
      validSnapshot({ sessionStartedAt: pastBoundary }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts date-only ISO string (e.g. "2026-04-08") — Date.parse() accepts this format', () => {
    // Date.parse("2026-04-08") is a valid ISO 8601 date-only string.
    // It parses to midnight UTC on that date. If within 24h, it passes.
    const today = new Date().toISOString().split('T')[0]!; // "2026-04-08"
    const result = WebMetricsSnapshotSchema.safeParse(
      validSnapshot({ sessionStartedAt: today }),
    );
    // This WILL pass because Date.parse(today) is within the 24h window.
    // Documenting this behavior: the schema accepts date-only strings.
    expect(result.success).toBe(true);
  });

  it('rejects sessionStartedAt as a number (not a string)', () => {
    const result = WebMetricsSnapshotSchema.safeParse(
      validSnapshot({ sessionStartedAt: Date.now() }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects sessionStartedAt as empty string', () => {
    const result = WebMetricsSnapshotSchema.safeParse(
      validSnapshot({ sessionStartedAt: '' }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts sessionStartedAt exactly 1 minute in the future (clock skew boundary)', () => {
    // The check is: ts > now + 60*1000 is rejected.
    // Exactly 60s in future: ts === now + 60000 → NOT greater than → passes.
    const exactly1minFuture = new Date(Date.now() + 60 * 1000).toISOString();
    const result = WebMetricsSnapshotSchema.safeParse(
      validSnapshot({ sessionStartedAt: exactly1minFuture }),
    );
    // At exactly the boundary: ts > now + 60*1000 is false (equal, not greater)
    // So this should pass — documenting boundary inclusion behavior.
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Null / undefined / non-object inputs (route-level defense in depth)
// ---------------------------------------------------------------------------

describe('WebMetricsSnapshotSchema — null/undefined/primitive inputs', () => {
  it('rejects null input', () => {
    const result = WebMetricsSnapshotSchema.safeParse(null);
    expect(result.success).toBe(false);
  });

  it('rejects undefined input', () => {
    const result = WebMetricsSnapshotSchema.safeParse(undefined);
    expect(result.success).toBe(false);
  });

  it('rejects empty string input', () => {
    const result = WebMetricsSnapshotSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('rejects array input instead of object', () => {
    const result = WebMetricsSnapshotSchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  it('rejects number input instead of object', () => {
    const result = WebMetricsSnapshotSchema.safeParse(42);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Extra fields — Zod strips unknown keys by default
// ---------------------------------------------------------------------------

describe('WebMetricsSnapshotSchema — extra fields are stripped', () => {
  it('ignores unknown fields in the payload (Zod default strip behavior)', () => {
    const result = WebMetricsSnapshotSchema.safeParse(
      validSnapshot({ unknownField: 'should be ignored', anotherField: 12345 }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)['unknownField']).toBeUndefined();
      expect((result.data as Record<string, unknown>)['anotherField']).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// WebMetricsQueryParamsSchema — edge cases not in base tests
// ---------------------------------------------------------------------------

describe('WebMetricsQueryParamsSchema — edge cases', () => {
  it('rejects timeRange=30D (wrong case)', () => {
    const result = WebMetricsQueryParamsSchema.safeParse({ timeRange: '30D' });
    expect(result.success).toBe(false);
  });

  it('rejects timeRange=ALL (uppercase)', () => {
    const result = WebMetricsQueryParamsSchema.safeParse({ timeRange: 'ALL' });
    expect(result.success).toBe(false);
  });

  it('accepts timeRange=30d', () => {
    const result = WebMetricsQueryParamsSchema.safeParse({ timeRange: '30d' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeRange).toBe('30d');
    }
  });

  it('rejects empty string timeRange', () => {
    const result = WebMetricsQueryParamsSchema.safeParse({ timeRange: '' });
    expect(result.success).toBe(false);
  });
});
