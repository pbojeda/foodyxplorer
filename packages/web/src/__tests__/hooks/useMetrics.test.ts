/**
 * Tests for useMetrics hook.
 */

import { renderHook, act } from '@testing-library/react';
import { useMetrics } from '@/hooks/useMetrics';
import { trackEvent, resetMetrics } from '@/lib/metrics';

// Mock localStorage
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

beforeEach(() => {
  resetMetrics();
  mockLocalStorage.clear();
});

describe('useMetrics', () => {
  it('returns initial zero-state metrics', () => {
    const { result } = renderHook(() => useMetrics());
    expect(result.current.queryCount).toBe(0);
    expect(result.current.successCount).toBe(0);
    expect(result.current.intents).toEqual({});
  });

  it('updates when trackEvent is called and refreshMetrics is invoked', () => {
    const { result } = renderHook(() => useMetrics());

    act(() => {
      trackEvent('query_sent');
      trackEvent('query_success', { intent: 'estimation', responseTimeMs: 200 });
    });

    // Hook needs to re-read — call getMetrics again
    // useMetrics uses useSyncExternalStore, so it should update automatically
    expect(result.current.queryCount).toBe(1);
    expect(result.current.successCount).toBe(1);
    expect(result.current.intents).toEqual({ estimation: 1 });
  });
});
