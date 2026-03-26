import React from 'react';
import { render, act } from '@testing-library/react';
import { ScrollTracker } from '@/components/analytics/ScrollTracker';
import * as analytics from '@/lib/analytics';

jest.mock('@/lib/analytics', () => ({
  trackEvent: jest.fn(),
  getUtmParams: jest.fn(() => ({})),
}));

const mockTrackEvent = analytics.trackEvent as jest.MockedFunction<
  typeof analytics.trackEvent
>;

// Helper to simulate scroll to a given percentage
function simulateScrollTo(percent: number) {
  const totalHeight = 1000;
  const viewportHeight = 100;
  Object.defineProperty(document.body, 'scrollHeight', {
    writable: true,
    configurable: true,
    value: totalHeight,
  });
  Object.defineProperty(window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: viewportHeight,
  });
  // scrollY needed to reach percent: (scrollY + viewportHeight) / totalHeight * 100 === percent
  // scrollY = (percent / 100 * totalHeight) - viewportHeight
  const scrollY = Math.max(0, (percent / 100) * totalHeight - viewportHeight);
  Object.defineProperty(window, 'scrollY', {
    writable: true,
    configurable: true,
    value: scrollY,
  });
  window.dispatchEvent(new Event('scroll'));
}

describe('ScrollTracker', () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('fires scroll_depth event at 25% threshold', async () => {
    render(<ScrollTracker variant="a" />);

    act(() => {
      simulateScrollTo(25);
    });

    // Allow requestAnimationFrame to fire
    act(() => {
      jest.runAllTimers();
    });

    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'scroll_depth',
        depth: 25,
        variant: 'a',
        lang: 'es',
      })
    );
  });

  it('does not fire the same threshold twice', async () => {
    render(<ScrollTracker variant="a" />);

    act(() => {
      simulateScrollTo(25);
    });
    act(() => {
      jest.runAllTimers();
    });
    act(() => {
      simulateScrollTo(25);
    });
    act(() => {
      jest.runAllTimers();
    });

    const scrollDepthCalls = mockTrackEvent.mock.calls.filter(
      ([payload]) => payload.event === 'scroll_depth' && payload['depth'] === 25
    );
    expect(scrollDepthCalls).toHaveLength(1);
  });

  it('removes event listener on unmount', () => {
    const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');
    const { unmount } = render(<ScrollTracker variant="a" />);
    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'scroll',
      expect.any(Function)
    );
  });
});
