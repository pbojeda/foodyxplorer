// Unit tests for analytics Zod schemas (F029)
//
// Tests: topN range validation, timeRange enum, chainSlug regex, defaults

import { describe, it, expect } from 'vitest';
import {
  AnalyticsQueryParamsSchema,
  AnalyticsTimeRangeSchema,
} from '../schemas/analytics.js';

describe('AnalyticsTimeRangeSchema', () => {
  it('accepts valid values: 24h, 7d, 30d, all', () => {
    expect(AnalyticsTimeRangeSchema.safeParse('24h').success).toBe(true);
    expect(AnalyticsTimeRangeSchema.safeParse('7d').success).toBe(true);
    expect(AnalyticsTimeRangeSchema.safeParse('30d').success).toBe(true);
    expect(AnalyticsTimeRangeSchema.safeParse('all').success).toBe(true);
  });

  it('rejects invalid values', () => {
    expect(AnalyticsTimeRangeSchema.safeParse('bad').success).toBe(false);
    expect(AnalyticsTimeRangeSchema.safeParse('1d').success).toBe(false);
    expect(AnalyticsTimeRangeSchema.safeParse('').success).toBe(false);
    expect(AnalyticsTimeRangeSchema.safeParse('ALL').success).toBe(false);
  });
});

describe('AnalyticsQueryParamsSchema', () => {
  it('applies defaults: timeRange=7d, topN=10 when omitted', () => {
    const result = AnalyticsQueryParamsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeRange).toBe('7d');
      expect(result.data.topN).toBe(10);
      expect(result.data.chainSlug).toBeUndefined();
    }
  });

  it('topN=1 is accepted (minimum)', () => {
    const result = AnalyticsQueryParamsSchema.safeParse({ topN: 1 });
    expect(result.success).toBe(true);
  });

  it('topN=100 is accepted (maximum)', () => {
    const result = AnalyticsQueryParamsSchema.safeParse({ topN: 100 });
    expect(result.success).toBe(true);
  });

  it('topN=0 is rejected', () => {
    const result = AnalyticsQueryParamsSchema.safeParse({ topN: 0 });
    expect(result.success).toBe(false);
  });

  it('topN=101 is rejected', () => {
    const result = AnalyticsQueryParamsSchema.safeParse({ topN: 101 });
    expect(result.success).toBe(false);
  });

  it('topN=150 is rejected', () => {
    const result = AnalyticsQueryParamsSchema.safeParse({ topN: 150 });
    expect(result.success).toBe(false);
  });

  it('timeRange=24h is accepted', () => {
    const result = AnalyticsQueryParamsSchema.safeParse({ timeRange: '24h' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeRange).toBe('24h');
    }
  });

  it('timeRange=bad is rejected', () => {
    const result = AnalyticsQueryParamsSchema.safeParse({ timeRange: 'bad' });
    expect(result.success).toBe(false);
  });

  it('chainSlug with valid lowercase-and-dash value is accepted', () => {
    const result = AnalyticsQueryParamsSchema.safeParse({ chainSlug: 'mcdonalds-es' });
    expect(result.success).toBe(true);
  });

  it('chainSlug with uppercase is rejected', () => {
    const result = AnalyticsQueryParamsSchema.safeParse({ chainSlug: 'McDonalds' });
    expect(result.success).toBe(false);
  });

  it('chainSlug with spaces is rejected', () => {
    const result = AnalyticsQueryParamsSchema.safeParse({ chainSlug: 'mc donalds' });
    expect(result.success).toBe(false);
  });

  it('topN is coerced from string (Fastify querystring)', () => {
    const result = AnalyticsQueryParamsSchema.safeParse({ topN: '25' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.topN).toBe(25);
    }
  });
});
