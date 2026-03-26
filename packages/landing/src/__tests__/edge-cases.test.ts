/**
 * F039 — Landing Page: Edge-Case & Spec-Deviation Tests (jsdom environment)
 *
 * QA-authored tests targeting gaps not covered by the developer's test suite.
 * Run with: npm test -- edge-cases
 *
 * API-route edge cases are in edge-cases.api.test.ts (node environment).
 */

// ---------------------------------------------------------------------------
// 1. ab-testing — boundary, invalid inputs, stateless guarantee
// ---------------------------------------------------------------------------
import { resolveVariant } from '@/lib/ab-testing';

describe('resolveVariant — boundary & edge cases', () => {
  it('returns "b" when random is exactly 0.5 (not strictly < 0.5)', () => {
    // boundary: random() < 0.5 ? 'a' : 'b' — at 0.5 the result must be 'b'
    expect(resolveVariant(undefined, undefined, () => 0.5)).toBe('b');
  });

  it('returns "a" when random is 0.4999…', () => {
    expect(resolveVariant(undefined, undefined, () => 0.4999)).toBe('a');
  });

  it('falls back to cookie when searchParam is "A" (wrong case — case-sensitive)', () => {
    // 'A' is not a valid variant; cookie 'b' should win
    expect(resolveVariant('A', 'b')).toBe('b');
  });

  it('falls back to random when both searchParam and cookie are empty strings', () => {
    expect(resolveVariant('', '', () => 0.3)).toBe('a');
    expect(resolveVariant('', '', () => 0.7)).toBe('b');
  });

  it('falls back to random when cookie is an invalid value "c"', () => {
    // invalid cookie must NOT win; random applies
    expect(resolveVariant(undefined, 'c', () => 0.3)).toBe('a');
    expect(resolveVariant(undefined, 'c', () => 0.7)).toBe('b');
  });

  it('URL param wins even when random would produce the opposite variant', () => {
    // Explicit param always wins — injecting random that would return 'b'
    expect(resolveVariant('a', undefined, () => 0.9)).toBe('a');
  });
});

describe('resolveVariant — stateless across multiple calls', () => {
  it('returns different results based only on injected random, not accumulated state', () => {
    const result1 = resolveVariant(undefined, undefined, () => 0.1);
    const result2 = resolveVariant(undefined, undefined, () => 0.9);
    expect(result1).toBe('a');
    expect(result2).toBe('b');
    // Third call with same seed as first — must still return 'a' (no side effects)
    const result3 = resolveVariant(undefined, undefined, () => 0.1);
    expect(result3).toBe('a');
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
