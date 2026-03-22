// F029 Shared Schema Edge-Case Tests — QA Engineer
//
// Tests gap coverage not in schemas.analytics.test.ts:
//   1. topN=101 boundary (listed in spec testing strategy but missing from dev tests)
//   2. topN as negative number
//   3. chainSlug with underscore (not in spec regex)
//   4. chainSlug empty string
//   5. AnalyticsDataSchema validation: cacheHitRate > 1.0 should fail
//   6. AnalyticsDataSchema validation: avgResponseTimeMs negative should fail
//   7. AnalyticsDataSchema validation: byLevel with negative counts should fail
//   8. AnalyticsDataSchema: scopedToChain optional — absent is valid
//   9. AnalyticsDataSchema: all fields present and valid → parse succeeds

import { describe, it, expect } from 'vitest';
import {
  AnalyticsQueryParamsSchema,
  AnalyticsDataSchema,
  LevelDistributionSchema,
  SourceDistributionSchema,
} from '../schemas/analytics.js';

// ---------------------------------------------------------------------------
// AnalyticsQueryParamsSchema — boundary gaps
// ---------------------------------------------------------------------------

describe('AnalyticsQueryParamsSchema — missing boundary tests', () => {
  // Listed in ticket testing strategy ("topN=101 → 400") but not in dev test file
  it('[GAP] topN=101 is rejected (one above max=100)', () => {
    const result = AnalyticsQueryParamsSchema.safeParse({ topN: 101 });
    expect(result.success).toBe(false);
  });

  it('[GAP] topN=-1 is rejected (negative)', () => {
    const result = AnalyticsQueryParamsSchema.safeParse({ topN: -1 });
    expect(result.success).toBe(false);
  });

  // Float that coerces to integer — z.coerce.number() then .int() check
  it('[GAP] topN=10.9 (float string) is rejected (not integer after coercion)', () => {
    // z.coerce.number() converts '10.9' → 10.9, then .int() rejects
    const result = AnalyticsQueryParamsSchema.safeParse({ topN: '10.9' });
    expect(result.success).toBe(false);
  });

  // Float that coerces cleanly to integer
  it('[GAP] topN=10.0 (exact float) is accepted (coerces to integer 10)', () => {
    const result = AnalyticsQueryParamsSchema.safeParse({ topN: '10.0' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.topN).toBe(10);
    }
  });

  // chainSlug with underscore — not in ^[a-z0-9-]+$ regex
  it('[SPEC] chainSlug with underscore is rejected (not in allowed charset)', () => {
    const result = AnalyticsQueryParamsSchema.safeParse({ chainSlug: 'mc_donalds' });
    expect(result.success).toBe(false);
  });

  // chainSlug empty string — regex requires at least one char (implicit from non-empty)
  it('[SPEC] chainSlug as empty string is rejected (no chars match ^[a-z0-9-]+$)', () => {
    const result = AnalyticsQueryParamsSchema.safeParse({ chainSlug: '' });
    expect(result.success).toBe(false);
  });

  // chainSlug with dot (e.g. domain-style slug attempt)
  it('[SPEC] chainSlug with dot is rejected', () => {
    const result = AnalyticsQueryParamsSchema.safeParse({ chainSlug: 'mc.donalds' });
    expect(result.success).toBe(false);
  });

  // timeRange as numeric string — not a valid enum value
  it('[SPEC] timeRange=7 (numeric) is rejected', () => {
    const result = AnalyticsQueryParamsSchema.safeParse({ timeRange: '7' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AnalyticsDataSchema — response shape validation
// ---------------------------------------------------------------------------

const VALID_ANALYTICS_DATA = {
  totalQueries: 100,
  cacheHitRate: 0.75,
  avgResponseTimeMs: 42.5,
  byLevel: { l1: 60, l2: 10, l3: 20, l4: 0, miss: 10 },
  byChain: [{ chainSlug: 'mcdonalds-es', count: 80 }],
  bySource: { api: 70, bot: 30 },
  topQueries: [{ queryText: 'big mac', count: 25 }],
  timeRange: '7d' as const,
};

describe('AnalyticsDataSchema — response shape validation', () => {
  it('valid analytics data parses successfully', () => {
    const result = AnalyticsDataSchema.safeParse(VALID_ANALYTICS_DATA);
    expect(result.success).toBe(true);
  });

  // BUG: route does not validate outgoing data through schema — this test shows
  // what the schema WOULD catch if it were applied to the response.
  it('[SPEC] cacheHitRate > 1.0 fails AnalyticsDataSchema validation', () => {
    const result = AnalyticsDataSchema.safeParse({ ...VALID_ANALYTICS_DATA, cacheHitRate: 1.5 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues.map(i => i.path.join('.'));
      expect(issues).toContain('cacheHitRate');
    }
  });

  it('[SPEC] cacheHitRate < 0 fails AnalyticsDataSchema validation', () => {
    const result = AnalyticsDataSchema.safeParse({ ...VALID_ANALYTICS_DATA, cacheHitRate: -0.1 });
    expect(result.success).toBe(false);
  });

  it('[SPEC] avgResponseTimeMs < 0 fails AnalyticsDataSchema validation', () => {
    const result = AnalyticsDataSchema.safeParse({ ...VALID_ANALYTICS_DATA, avgResponseTimeMs: -1 });
    expect(result.success).toBe(false);
  });

  it('[SPEC] avgResponseTimeMs=null is valid (totalQueries=0 case)', () => {
    const result = AnalyticsDataSchema.safeParse({ ...VALID_ANALYTICS_DATA, totalQueries: 0, avgResponseTimeMs: null });
    expect(result.success).toBe(true);
  });

  it('[SPEC] totalQueries < 0 fails AnalyticsDataSchema validation', () => {
    const result = AnalyticsDataSchema.safeParse({ ...VALID_ANALYTICS_DATA, totalQueries: -1 });
    expect(result.success).toBe(false);
  });

  it('[SPEC] scopedToChain absent → valid (optional field)', () => {
    const data = { ...VALID_ANALYTICS_DATA };
    const result = AnalyticsDataSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scopedToChain).toBeUndefined();
    }
  });

  it('[SPEC] scopedToChain present → valid', () => {
    const result = AnalyticsDataSchema.safeParse({ ...VALID_ANALYTICS_DATA, scopedToChain: 'mcdonalds-es' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scopedToChain).toBe('mcdonalds-es');
    }
  });

  it('[SPEC] byLevel with non-integer count fails (float not allowed per .int())', () => {
    const result = AnalyticsDataSchema.safeParse({
      ...VALID_ANALYTICS_DATA,
      byLevel: { l1: 10.5, l2: 0, l3: 0, l4: 0, miss: 0 },
    });
    expect(result.success).toBe(false);
  });

  it('[SPEC] byLevel with negative count fails (nonnegative constraint)', () => {
    const result = AnalyticsDataSchema.safeParse({
      ...VALID_ANALYTICS_DATA,
      byLevel: { l1: -1, l2: 0, l3: 0, l4: 0, miss: 0 },
    });
    expect(result.success).toBe(false);
  });

  it('[SPEC] bySource with negative api count fails', () => {
    const result = AnalyticsDataSchema.safeParse({
      ...VALID_ANALYTICS_DATA,
      bySource: { api: -5, bot: 0 },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LevelDistributionSchema — zero-fill correctness
// ---------------------------------------------------------------------------

describe('LevelDistributionSchema — zero counts allowed', () => {
  it('all zeros is valid (empty table case)', () => {
    const result = LevelDistributionSchema.safeParse({ l1: 0, l2: 0, l3: 0, l4: 0, miss: 0 });
    expect(result.success).toBe(true);
  });

  it('missing key fails (all 5 keys are required)', () => {
    // 'miss' key absent
    const result = LevelDistributionSchema.safeParse({ l1: 0, l2: 0, l3: 0, l4: 0 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SourceDistributionSchema — exhaustive coverage
// ---------------------------------------------------------------------------

describe('SourceDistributionSchema', () => {
  it('{ api: 0, bot: 0 } is valid (empty table)', () => {
    const result = SourceDistributionSchema.safeParse({ api: 0, bot: 0 });
    expect(result.success).toBe(true);
  });

  it('missing api key fails', () => {
    const result = SourceDistributionSchema.safeParse({ bot: 10 });
    expect(result.success).toBe(false);
  });

  it('missing bot key fails', () => {
    const result = SourceDistributionSchema.safeParse({ api: 10 });
    expect(result.success).toBe(false);
  });

  it('extra source key (e.g. "internal") is stripped (zod strip mode)', () => {
    // Zod in strip mode ignores extra keys — no failure but key not preserved
    const result = SourceDistributionSchema.safeParse({ api: 5, bot: 3, internal: 2 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)['internal']).toBeUndefined();
    }
  });
});
