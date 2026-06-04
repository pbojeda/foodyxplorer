/**
 * HistoryLoadMoreSentinel — direct regression tests for BUG-WEB-HISTORY-LOADMORE-IO-ROOT-001.
 *
 * Pre-bugfix, every existing test mocked this component (see
 * TranscriptFeed.test.tsx:42, TranscriptFeed.edge-cases.test.tsx:29,
 * TranscriptFeed.fu4-qa.edge-cases.test.tsx:54, fWebHistory.edge-cases.test.tsx:37),
 * so the IntersectionObserver wiring was never exercised — the missing `root`
 * shipped to production undetected. These tests pin the IO configuration so
 * the regression class cannot return silently.
 *
 * Methodology lesson: feedback_mock_boundary_integration_gap applied here.
 * When every consumer mocks a component, the component itself must have its
 * own direct tests OR a real-browser e2e gate.
 */

import { createRef } from 'react';
import { render } from '@testing-library/react';
import { HistoryLoadMoreSentinel } from '../../components/HistoryLoadMoreSentinel';

describe('HistoryLoadMoreSentinel — IntersectionObserver root regression', () => {
  let observeMock: jest.Mock;
  let disconnectMock: jest.Mock;
  let lastOptions: IntersectionObserverInit | undefined;
  let originalIO: typeof IntersectionObserver;

  beforeEach(() => {
    originalIO = globalThis.IntersectionObserver;
    observeMock = jest.fn();
    disconnectMock = jest.fn();
    lastOptions = undefined;

    class ShimIntersectionObserver {
      // The constructor stores the options so we can assert against `root`.
      constructor(
        _cb: IntersectionObserverCallback,
        opts?: IntersectionObserverInit,
      ) {
        lastOptions = opts;
      }
      observe = observeMock;
      unobserve = jest.fn();
      disconnect = disconnectMock;
      takeRecords = jest.fn().mockReturnValue([]);
      root = lastOptions?.root ?? null;
      rootMargin = '';
      thresholds = [];
    }

    // @ts-expect-error — assigning shim class
    globalThis.IntersectionObserver = ShimIntersectionObserver;
  });

  afterEach(() => {
    globalThis.IntersectionObserver = originalIO;
  });

  it('passes feedRef.current as the IntersectionObserver root (NOT browser viewport)', () => {
    // Render a parent that owns the feedRef the sentinel receives.
    const feedRef = createRef<HTMLDivElement>();

    function Parent() {
      return (
        <div ref={feedRef} data-testid="feed-container">
          <HistoryLoadMoreSentinel
            feedRef={feedRef}
            hasMoreHistory={true}
            isLoadingMore={false}
            onLoadMore={() => {}}
          />
        </div>
      );
    }

    render(<Parent />);

    // The IO must have been instantiated with `root: feedRef.current` —
    // the scroll container, not viewport (null) and not undefined.
    expect(lastOptions).toBeDefined();
    expect(lastOptions?.root).not.toBeNull();
    expect(lastOptions?.root).not.toBeUndefined();
    expect(lastOptions?.root).toBe(feedRef.current);

    // Threshold preserved.
    expect(lastOptions?.threshold).toBe(0);

    // observe() was called with the sentinel element (some DOM node).
    expect(observeMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT construct an IntersectionObserver while isLoadingMore=true', () => {
    const feedRef = createRef<HTMLDivElement>();

    function Parent() {
      return (
        <div ref={feedRef}>
          <HistoryLoadMoreSentinel
            feedRef={feedRef}
            hasMoreHistory={true}
            isLoadingMore={true}
            onLoadMore={() => {}}
          />
        </div>
      );
    }

    render(<Parent />);

    // Early-return path: condition skips the IO construction entirely.
    expect(lastOptions).toBeUndefined();
    expect(observeMock).not.toHaveBeenCalled();
  });

  it('does NOT construct an IntersectionObserver while hasMoreHistory=false (component returns null)', () => {
    const feedRef = createRef<HTMLDivElement>();

    function Parent() {
      return (
        <div ref={feedRef}>
          <HistoryLoadMoreSentinel
            feedRef={feedRef}
            hasMoreHistory={false}
            isLoadingMore={false}
            onLoadMore={() => {}}
          />
        </div>
      );
    }

    render(<Parent />);

    expect(lastOptions).toBeUndefined();
    expect(observeMock).not.toHaveBeenCalled();
  });

  it('disconnects the observer on unmount', () => {
    const feedRef = createRef<HTMLDivElement>();

    function Parent() {
      return (
        <div ref={feedRef}>
          <HistoryLoadMoreSentinel
            feedRef={feedRef}
            hasMoreHistory={true}
            isLoadingMore={false}
            onLoadMore={() => {}}
          />
        </div>
      );
    }

    const { unmount } = render(<Parent />);
    expect(observeMock).toHaveBeenCalledTimes(1);

    unmount();
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });
});
