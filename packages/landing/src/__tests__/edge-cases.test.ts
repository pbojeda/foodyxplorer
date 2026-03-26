/**
 * F039 / F044 — Landing Page: Edge-Case & Spec-Deviation Tests (jsdom environment)
 *
 * QA-authored tests targeting gaps not covered by the developer's test suite.
 * Run with: npm test -- edge-cases
 *
 * API-route edge cases are in edge-cases.api.test.ts (node environment).
 */

// ---------------------------------------------------------------------------
// 1. ab-testing — boundary, invalid inputs, stateless guarantee
// F044 update: variant set is now a|c|d|f; fallback is always 'a' (no random)
// ---------------------------------------------------------------------------
import { resolveVariant } from '@/lib/ab-testing';

describe('resolveVariant — boundary & edge cases', () => {
  it('returns "a" as default fallback when no searchParam or cookie', () => {
    expect(resolveVariant(undefined, undefined)).toBe('a');
  });

  it('returns "c" when searchParam is "c"', () => {
    expect(resolveVariant('c', undefined)).toBe('c');
  });

  it('returns "d" when searchParam is "d"', () => {
    expect(resolveVariant('d', undefined)).toBe('d');
  });

  it('returns "f" when searchParam is "f"', () => {
    expect(resolveVariant('f', undefined)).toBe('f');
  });

  it('falls back to cookie when searchParam is "A" (wrong case — case-sensitive)', () => {
    // 'A' is not a valid variant; cookie 'c' should win
    expect(resolveVariant('A', 'c')).toBe('c');
  });

  it('falls back to "a" when both searchParam and cookie are empty strings', () => {
    expect(resolveVariant('', '')).toBe('a');
  });

  it('falls back to "a" when cookie is an invalid value "b" (b is no longer valid)', () => {
    // 'b' was removed from valid variants; fall back to default 'a'
    expect(resolveVariant(undefined, 'b')).toBe('a');
  });

  it('URL param wins even when cookie is also set', () => {
    // Explicit param always wins
    expect(resolveVariant('a', 'c')).toBe('a');
    expect(resolveVariant('c', 'a')).toBe('c');
  });
});

describe('resolveVariant — stateless across multiple calls', () => {
  it('returns consistent results across multiple calls (no state leakage)', () => {
    const result1 = resolveVariant(undefined, undefined);
    const result2 = resolveVariant(undefined, undefined);
    const result3 = resolveVariant(undefined, undefined);
    // All should return the same default 'a'
    expect(result1).toBe('a');
    expect(result2).toBe('a');
    expect(result3).toBe('a');
  });

  it('URL param consistently takes priority regardless of call order', () => {
    expect(resolveVariant('c', 'a')).toBe('c');
    expect(resolveVariant('a', 'c')).toBe('a');
    expect(resolveVariant('d', 'f')).toBe('d');
  });
});

// ---------------------------------------------------------------------------
// 2. analytics.ts — spec deviation: Step 1.2 says "falls back to console.debug
//    in development" but the implementation silently drops the event.
// ---------------------------------------------------------------------------
import { trackEvent } from '@/lib/analytics';
import type { AnalyticsEventPayload } from '@/types';

const basePayload: AnalyticsEventPayload = {
  event: 'landing_view',
  variant: 'a',
  lang: 'es',
};

describe('trackEvent — spec deviation: missing console.debug fallback', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'dataLayer', {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * SPEC DEVIATION (severity: LOW)
   * Step 1.2 specifies: "falls back to console.debug in development".
   * The current implementation silently drops the event when dataLayer is absent
   * — no console.debug is emitted.
   *
   * Expected fix: add `if (process.env.NODE_ENV === 'development') console.debug(...)`
   * in analytics.ts when dataLayer is undefined.
   */
  it.todo(
    '[SPEC DEVIATION] should call console.debug when dataLayer is absent in development'
  );

  it('does not throw when dataLayer is undefined', () => {
    expect(() => trackEvent(basePayload)).not.toThrow();
  });
});
