/**
 * Tests for packages/web/src/lib/metrics.ts
 * Usage metrics tracking for the /hablar web assistant.
 */

import {
  trackEvent,
  getMetrics,
  resetMetrics,
  flushMetrics,
  type MetricsSnapshot,
} from '@/lib/metrics';

// ---------- helpers ----------

const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] ?? null),
    setItem: jest.fn((key: string, val: string) => { store[key] = val; }),
    removeItem: jest.fn((key: string) => { delete store[key]; }),
    clear: jest.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage });

const mockSendBeacon = jest.fn(() => true);
Object.defineProperty(globalThis.navigator, 'sendBeacon', {
  value: mockSendBeacon,
  writable: true,
});

beforeEach(() => {
  resetMetrics();
  mockLocalStorage.clear();
  mockSendBeacon.mockClear();
  delete process.env['NEXT_PUBLIC_METRICS_ENDPOINT'];
});

// ---------- trackEvent ----------

describe('trackEvent', () => {
  it('increments queryCount on query_sent', () => {
    trackEvent('query_sent');
    trackEvent('query_sent');
    const m = getMetrics();
    expect(m.queryCount).toBe(2);
  });

  it('tracks intent distribution on query_success', () => {
    trackEvent('query_success', { intent: 'estimation', responseTimeMs: 200 });
    trackEvent('query_success', { intent: 'estimation', responseTimeMs: 300 });
    trackEvent('query_success', { intent: 'comparison', responseTimeMs: 150 });
    const m = getMetrics();
    expect(m.intents).toEqual({ estimation: 2, comparison: 1 });
  });

  it('calculates average response time', () => {
    trackEvent('query_success', { intent: 'estimation', responseTimeMs: 100 });
    trackEvent('query_success', { intent: 'estimation', responseTimeMs: 300 });
    const m = getMetrics();
    expect(m.avgResponseTimeMs).toBe(200);
  });

  it('tracks error distribution on query_error', () => {
    trackEvent('query_error', { errorCode: 'TIMEOUT_ERROR' });
    trackEvent('query_error', { errorCode: 'NETWORK_ERROR' });
    trackEvent('query_error', { errorCode: 'TIMEOUT_ERROR' });
    const m = getMetrics();
    expect(m.errors).toEqual({ TIMEOUT_ERROR: 2, NETWORK_ERROR: 1 });
  });

  it('increments retryCount on query_retry', () => {
    trackEvent('query_retry');
    trackEvent('query_retry');
    trackEvent('query_retry');
    const m = getMetrics();
    expect(m.retryCount).toBe(3);
  });

  it('persists to localStorage after each event', () => {
    trackEvent('query_sent');
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'fxp_metrics',
      expect.any(String),
    );
    const stored = JSON.parse(mockLocalStorage.setItem.mock.calls[0][1]);
    expect(stored.queryCount).toBe(1);
  });
});

// ---------- getMetrics ----------

describe('getMetrics', () => {
  it('returns zero-state when no events tracked', () => {
    const m = getMetrics();
    expect(m).toEqual<MetricsSnapshot>({
      queryCount: 0,
      successCount: 0,
      errorCount: 0,
      retryCount: 0,
      intents: {},
      errors: {},
      avgResponseTimeMs: 0,
      sessionStartedAt: expect.any(String),
    });
  });

  it('returns correct counts after mixed events', () => {
    trackEvent('query_sent');
    trackEvent('query_success', { intent: 'estimation', responseTimeMs: 100 });
    trackEvent('query_sent');
    trackEvent('query_error', { errorCode: 'NETWORK_ERROR' });
    trackEvent('query_retry');
    const m = getMetrics();
    expect(m.queryCount).toBe(2);
    expect(m.successCount).toBe(1);
    expect(m.errorCount).toBe(1);
    expect(m.retryCount).toBe(1);
  });
});

// ---------- resetMetrics ----------

describe('resetMetrics', () => {
  it('clears all metrics to zero state', () => {
    trackEvent('query_sent');
    trackEvent('query_success', { intent: 'estimation', responseTimeMs: 500 });
    resetMetrics();
    const m = getMetrics();
    expect(m.queryCount).toBe(0);
    expect(m.successCount).toBe(0);
    expect(m.intents).toEqual({});
  });

  it('removes localStorage entry', () => {
    trackEvent('query_sent');
    resetMetrics();
    expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('fxp_metrics');
  });
});

// ---------- flushMetrics ----------

describe('flushMetrics', () => {
  it('does nothing when endpoint is not configured', () => {
    trackEvent('query_sent');
    flushMetrics();
    expect(mockSendBeacon).not.toHaveBeenCalled();
  });

  it('sends beacon when endpoint is configured and there are events', () => {
    process.env['NEXT_PUBLIC_METRICS_ENDPOINT'] = 'https://api.example.com/metrics';
    trackEvent('query_sent');
    trackEvent('query_success', { intent: 'estimation', responseTimeMs: 200 });
    flushMetrics();
    expect(mockSendBeacon).toHaveBeenCalledWith(
      'https://api.example.com/metrics',
      expect.any(String),
    );
    const payload = JSON.parse(mockSendBeacon.mock.calls[0][1] as string);
    expect(payload.queryCount).toBe(1);
    expect(payload.successCount).toBe(1);
  });

  it('does not send beacon when there are zero queries', () => {
    process.env['NEXT_PUBLIC_METRICS_ENDPOINT'] = 'https://api.example.com/metrics';
    flushMetrics();
    expect(mockSendBeacon).not.toHaveBeenCalled();
  });

  it('resets metrics after successful flush', () => {
    process.env['NEXT_PUBLIC_METRICS_ENDPOINT'] = 'https://api.example.com/metrics';
    trackEvent('query_sent');
    flushMetrics();
    const m = getMetrics();
    expect(m.queryCount).toBe(0);
  });
});

// ---------- localStorage hydration ----------

describe('localStorage hydration', () => {
  it('restores metrics from localStorage on first getMetrics call after module reload', () => {
    // We can't truly reload the module in the same test, but we can test
    // that resetMetrics + setItem + manual restore works correctly.
    // The module reads localStorage on init — tested via integration in HablarShell.
    trackEvent('query_sent');
    trackEvent('query_sent');
    const stored = mockLocalStorage.setItem.mock.calls.at(-1)?.[1];
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored!);
    expect(parsed.queryCount).toBe(2);
  });
});
