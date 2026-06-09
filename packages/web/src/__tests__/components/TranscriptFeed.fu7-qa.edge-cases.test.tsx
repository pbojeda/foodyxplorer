// TranscriptFeed FU7 QA edge-case tests
//
// Authored by QA pass (2026-06-09) — hunts for races and gaps not covered by the
// developer's test files.  All tests are purely behavioural; they expose logic
// bugs that are reproducible in jsdom.
//
// Tests in this file:
//   RACE-1  Prepend anchor: intermediate render where entries grow while
//           isLoadingMore is still true overwrites savedScrollDeltaRef
//           (two-commit scenario: .then() and .finally() in different
//           microtask turns, i.e. React 18 does NOT batch cross-continuation).
//
//   RACE-2  Rapid settle flicker: last entry flips isLoading true→false→true→false.
//           prevLastLoadingRef should only trigger scroll on EACH true→false edge;
//           verify second flip also triggers scroll (double settle).
//
//   RACE-3  Settle fires rAF but ref element has been unmounted (null) before
//           rAF runs — must not throw.
//
//   EDGE-1  entries=[] on mount — scroll machinery is a no-op, no errors.
//
//   EDGE-2  entries=[single loading entry] transitions to settled while user is
//           scrolled to bottom — scroll fires exactly once.
//
//   EDGE-3  onLoadMore is NOT called when scrollTop < 100 but loadMoreInFlightRef
//           is already true even after isLoadingMore resets — guard must reset.
//
//   EDGE-4  Prepend with no new entries (loadMore resolves with [] older entries):
//           savedScrollDelta was set; restore fires with newScrollHeight = original;
//           scrollTop is restored to original - 0 == original.
//
//   A11Y-1  Tab-accessible sr-only button fires onLoadMore on Enter keypress.
//
//   A11Y-2  aria-busy skeleton present while isLoadingMore=true.

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TranscriptEntryData } from '../../types/history';

// ---------------------------------------------------------------------------
// Module mocks (same pattern as TranscriptFeed.test.tsx)
// ---------------------------------------------------------------------------

jest.mock('../../components/TranscriptEntry', () => ({
  TranscriptEntry: ({ entry }: { entry: TranscriptEntryData }) => (
    <div data-testid={`entry-${entry.entryId}`} role="article">
      {entry.queryText}
    </div>
  ),
}));

jest.mock('../../components/EmptyState', () => ({
  EmptyState: () => <div data-testid="empty-state">¿Qué quieres saber?</div>,
}));

jest.mock('../../components/HistoryEmptyState', () => ({
  HistoryEmptyState: () => (
    <div data-testid="history-empty-state">Aún no tienes historial</div>
  ),
}));

jest.mock('../../components/HistoryPersistenceNudge', () => ({
  HistoryPersistenceNudge: ({ onDismiss }: { onDismiss: () => void }) => (
    <div data-testid="persistence-nudge">
      <button onClick={onDismiss}>Cerrar sugerencia</button>
    </div>
  ),
}));

jest.mock('../../components/ClearHistoryButton', () => ({
  ClearHistoryButton: ({ onConfirm }: { onConfirm: () => void }) => (
    <button data-testid="clear-history-button" onClick={onConfirm}>
      Borrar todo el historial
    </button>
  ),
}));

jest.mock('../../lib/metrics', () => ({
  trackEvent: jest.fn(),
  flushMetrics: jest.fn(),
}));

import { TranscriptFeed } from '../../components/TranscriptFeed';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<TranscriptEntryData> = {}): TranscriptEntryData {
  return {
    entryId: `entry-${Math.random().toString(36).slice(2, 8)}`,
    queryText: 'test query',
    inputMode: 'text',
    timestamp: new Date(),
    isLoading: false,
    result: null,
    photoData: null,
    error: null,
    isPersisted: false,
    ...overrides,
  };
}

const defaultProps = {
  entries: [] as TranscriptEntryData[],
  isAuthenticated: false,
  isLoadingHistory: false,
  hasMoreHistory: false,
  isLoadingMore: false,
  showPersistenceNudge: false,
  onDismissPersistenceNudge: jest.fn(),
  onLoadMore: jest.fn(),
  onDeleteEntry: jest.fn(),
  onClearAll: jest.fn(),
  onRetry: jest.fn(),
  onDishSelect: jest.fn(),
};

// ---------------------------------------------------------------------------
// RACE-1 — Prepend anchor overwrite in intermediate render
//
// Scenario: useSearchHistory.loadMore() calls setPersistedEntries in .then()
// and setIsLoadingMore(false) in .finally().  In React 18 these are separate
// microtask continuations and may produce two separate commits:
//
//   Commit A: entries grows, isLoadingMore=true  → prepend effect fires with
//             isLoadingMore=true → savedScrollDeltaRef is overwritten with a
//             delta calculated on the now-larger scrollHeight (wrong value).
//   Commit B: isLoadingMore=false, entries unchanged → restore uses wrong delta.
//
// Expected behaviour: restoreScrollTop should be 1200 - 600 = 600 (the user's
// pre-loadMore relative position).
// Actual (buggy): the intermediate render overwrites savedScrollDelta to
// 1200 - 200 = 1000, then restore sets scrollTop = 1200 - 1000 = 200 (too low).
// ---------------------------------------------------------------------------

describe('RACE-1: prepend anchor — intermediate-render delta overwrite', () => {
  it('correctly restores scrollTop even when entries grow before isLoadingMore resets', () => {
    const initialEntries = [makeEntry({ entryId: 'a' })];
    const { rerender } = render(
      <TranscriptFeed
        {...defaultProps}
        entries={initialEntries}
        hasMoreHistory={true}
        isLoadingMore={false}
      />,
    );

    const feed = screen.getByRole('feed');

    // Initial state: scrollHeight=800, scrollTop=200 (user scrolled up a bit)
    const scrollTopSetter = jest.fn();
    let scrollHeightValue = 800;
    let scrollTopValue = 200;

    Object.defineProperty(feed, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeightValue,
    });
    Object.defineProperty(feed, 'clientHeight', {
      configurable: true,
      get: () => 600,
    });
    Object.defineProperty(feed, 'scrollTop', {
      configurable: true,
      get: () => scrollTopValue,
      set: (v: number) => {
        scrollTopValue = v;
        scrollTopSetter(v);
      },
    });

    // Step 1: isLoadingMore flips true (before entries change).
    // savedScrollDelta = 800 - 200 = 600.  This is the CORRECT delta to preserve.
    act(() => {
      rerender(
        <TranscriptFeed
          {...defaultProps}
          entries={initialEntries}
          hasMoreHistory={true}
          isLoadingMore={true}
        />,
      );
    });

    // Step 2: Intermediate commit — entries grow (from .then()), isLoadingMore still true.
    // This simulates what React 18 does when setPersistedEntries and setIsLoadingMore(false)
    // fire in separate microtask callbacks (.then() vs .finally()).
    scrollHeightValue = 1200; // scrollHeight grew because new entries were prepended
    // scrollTop is still 200 (browser has not repositioned yet in jsdom)
    const prependedEntries = [
      makeEntry({ entryId: 'new1' }),
      makeEntry({ entryId: 'new2' }),
      ...initialEntries,
    ];
    act(() => {
      rerender(
        <TranscriptFeed
          {...defaultProps}
          entries={prependedEntries}
          hasMoreHistory={true}
          isLoadingMore={true}
        />,
        // Note: isLoadingMore is still true here — this is the intermediate commit
        // where entries grew (from .then()) but isLoadingMore has not yet reset
      );
    });

    // Reset the setter spy so we only see the restore call
    scrollTopSetter.mockClear();

    // Step 3: isLoadingMore flips false (from .finally()), entries unchanged.
    act(() => {
      rerender(
        <TranscriptFeed
          {...defaultProps}
          entries={prependedEntries}
          hasMoreHistory={true}
          isLoadingMore={false}
        />,
      );
    });

    // EXPECTED: restore = 1200 - 600 = 600 (delta saved at step 1)
    // ACTUAL (if bug): restore = 1200 - 1000 = 200 (delta overwritten in step 2)
    //   because in step 2 the effect fires again with isLoadingMore=true and
    //   overwrites savedScrollDeltaRef to 1200 - 200 = 1000.
    expect(scrollTopSetter).toHaveBeenCalledTimes(1);
    expect(scrollTopSetter).toHaveBeenCalledWith(600); // 1200 - 600 (original delta)
  });
});

// ---------------------------------------------------------------------------
// RACE-2 — Rapid settle flicker: last entry loading true→false→true→false
//
// The user submits two queries rapidly. The last entry flips:
//   [A loading] → [A settled] → [A settled, B loading] → [A settled, B settled]
//
// prevLastLoadingRef tracks the LAST entry's previous state.
// The scroll should fire on each true→false transition of the LAST entry.
// Verify it fires twice (once per settle).
// ---------------------------------------------------------------------------

describe('RACE-2: rapid back-to-back settle — scroll fires on each true→false edge', () => {
  let rafSpy: jest.SpyInstance;
  let rafCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    rafCallbacks = [];
    rafSpy = jest.spyOn(global, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
  });

  afterEach(() => {
    rafSpy.mockRestore();
  });

  it('fires rAF once per true→false transition when two entries settle sequentially', () => {
    const entryA_loading = makeEntry({ entryId: 'A', isLoading: true });
    const { rerender } = render(
      <TranscriptFeed {...defaultProps} entries={[entryA_loading]} />,
    );

    const feed = screen.getByRole('feed');
    const scrollTopSetter = jest.fn();
    Object.defineProperty(feed, 'scrollHeight', { configurable: true, get: () => 1000 });
    Object.defineProperty(feed, 'clientHeight', { configurable: true, get: () => 600 });
    Object.defineProperty(feed, 'scrollTop', {
      configurable: true,
      get: () => 900,
      set: scrollTopSetter,
    });

    // Fire scroll to set wasNearBottomRef=true (distanceFromBottom = 1000-900-600 = -500 < 100)
    act(() => {
      fireEvent.scroll(feed);
    });

    // Settle entry A — first true→false transition on LAST entry
    const entryA_settled = makeEntry({ entryId: 'A', isLoading: false });
    act(() => {
      rerender(<TranscriptFeed {...defaultProps} entries={[entryA_settled]} />);
    });

    const rafCountAfterFirstSettle = rafCallbacks.length;
    expect(rafCountAfterFirstSettle).toBeGreaterThanOrEqual(1);

    // Now second entry B appears loading (last entry changes to B loading)
    const entryB_loading = makeEntry({ entryId: 'B', isLoading: true });
    act(() => {
      rerender(<TranscriptFeed {...defaultProps} entries={[entryA_settled, entryB_loading]} />);
    });

    // Second entry settles — second true→false transition on LAST entry
    const entryB_settled = makeEntry({ entryId: 'B', isLoading: false });
    act(() => {
      rerender(<TranscriptFeed {...defaultProps} entries={[entryA_settled, entryB_settled]} />);
    });

    // Two rAF callbacks should have been queued (one per settle)
    expect(rafCallbacks.length).toBe(rafCountAfterFirstSettle + 1);

    // Execute all rAF callbacks
    act(() => {
      rafCallbacks.forEach((cb) => cb(0));
    });

    // Both settles should have attempted scroll
    expect(scrollTopSetter).toHaveBeenCalledTimes(rafCountAfterFirstSettle + 1);
  });
});

// ---------------------------------------------------------------------------
// RACE-3 — rAF callback fires after component unmounts (feedRef.current = null)
//
// The user navigates away immediately after a settle. The rAF was already
// scheduled.  When it fires, feedRef.current is null.  Should NOT throw.
// ---------------------------------------------------------------------------

describe('RACE-3: rAF fires after unmount — no crash', () => {
  let rafSpy: jest.SpyInstance;
  let rafCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    rafCallbacks = [];
    rafSpy = jest.spyOn(global, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
  });

  afterEach(() => {
    rafSpy.mockRestore();
  });

  it('does not throw when rAF fires after feedRef is nulled by unmount', () => {
    const loadingEntry = makeEntry({ entryId: 'last', isLoading: true });
    const { rerender, unmount } = render(
      <TranscriptFeed {...defaultProps} entries={[loadingEntry]} />,
    );

    const feed = screen.getByRole('feed');
    const scrollTopSetter = jest.fn();
    Object.defineProperty(feed, 'scrollHeight', { configurable: true, get: () => 1000 });
    Object.defineProperty(feed, 'clientHeight', { configurable: true, get: () => 600 });
    Object.defineProperty(feed, 'scrollTop', {
      configurable: true,
      get: () => 900,
      set: scrollTopSetter,
    });

    act(() => { fireEvent.scroll(feed); }); // set wasNearBottomRef=true

    // Settle: schedules rAF
    act(() => {
      rerender(<TranscriptFeed {...defaultProps} entries={[{ ...loadingEntry, isLoading: false }]} />);
    });

    expect(rafCallbacks.length).toBeGreaterThan(0);

    // Unmount BEFORE rAF fires
    act(() => { unmount(); });

    // Now fire the rAF — the real component captures `el` at schedule time
    // (NOT re-reads feedRef.current inside rAF).  This is the ACTUAL code path:
    //   requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; })
    // Since `el` was captured from feedRef.current at effect-time (before unmount),
    // it is a valid detached DOM node, not null.  This should NOT throw.
    expect(() => {
      act(() => { rafCallbacks.forEach((cb) => cb(0)); });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// EDGE-1 — entries=[] on mount: scroll machinery is a no-op, no errors
// ---------------------------------------------------------------------------

describe('EDGE-1: empty entries on mount — no errors', () => {
  it('renders without errors when entries=[] on mount', () => {
    expect(() => {
      render(<TranscriptFeed {...defaultProps} entries={[]} />);
    }).not.toThrow();
  });

  it('mount useEffect with entries=[] assigns scrollTop=0 without throwing (jsdom: scrollHeight=0)', () => {
    // jsdom has scrollHeight=0 and clientHeight=0 by default.
    // el.scrollTop = el.scrollHeight → el.scrollTop = 0. No NaN, no throw.
    const { container } = render(<TranscriptFeed {...defaultProps} entries={[]} />);
    const feed = container.querySelector('[role="feed"]') as HTMLElement;
    expect(feed).toBeTruthy();
    // If mount effect threw, the component would not have rendered
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// EDGE-2 — Single loading entry settles while user at bottom: scroll fires once
// ---------------------------------------------------------------------------

describe('EDGE-2: single entry settle at bottom — exactly one scroll', () => {
  let rafSpy: jest.SpyInstance;
  let rafCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    rafCallbacks = [];
    rafSpy = jest.spyOn(global, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
  });

  afterEach(() => {
    rafSpy.mockRestore();
  });

  it('queues exactly one rAF callback on settle with single entry', () => {
    const loadingEntry = makeEntry({ entryId: 'only', isLoading: true });
    const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[loadingEntry]} />);

    const feed = screen.getByRole('feed');
    Object.defineProperty(feed, 'scrollHeight', { configurable: true, get: () => 500 });
    Object.defineProperty(feed, 'clientHeight', { configurable: true, get: () => 600 });
    Object.defineProperty(feed, 'scrollTop', {
      configurable: true, get: () => 0, set: jest.fn(),
    });

    // Discard the mount-effect rAF (BUG-WEB-FU7-HEADER-AND-MOBILE-SCROLL Bug 3
    // wraps mount scroll in rAF). This edge-case asserts the SETTLE effect
    // queues exactly one rAF — not the mount.
    rafCallbacks.length = 0;

    // wasNearBottomRef=true from mount (initialized true)
    // Settle
    act(() => {
      rerender(<TranscriptFeed {...defaultProps} entries={[{ ...loadingEntry, isLoading: false }]} />);
    });

    // Exactly one rAF (from settle effect); no duplicates
    expect(rafCallbacks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// EDGE-3 — loadMoreInFlightRef reset: after isLoadingMore resets, next scroll
//          near top triggers onLoadMore again
// ---------------------------------------------------------------------------

describe('EDGE-3: loadMoreInFlightRef resets after isLoadingMore cycle', () => {
  it('can trigger onLoadMore again after a completed isLoadingMore cycle', () => {
    const onLoadMore = jest.fn();
    const entries = [makeEntry({ entryId: 'a' })];
    const { rerender } = render(
      <TranscriptFeed
        {...defaultProps}
        entries={entries}
        hasMoreHistory={true}
        isLoadingMore={false}
        onLoadMore={onLoadMore}
      />,
    );

    const feed = screen.getByRole('feed');
    Object.defineProperty(feed, 'scrollTop', { configurable: true, get: () => 50, set: jest.fn() });
    Object.defineProperty(feed, 'scrollHeight', { configurable: true, get: () => 1000 });
    Object.defineProperty(feed, 'clientHeight', { configurable: true, get: () => 600 });

    // First scroll near top → triggers onLoadMore, sets loadMoreInFlightRef=true
    act(() => { fireEvent.scroll(feed); });
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // isLoadingMore flips true (simulating the in-flight period)
    act(() => {
      rerender(
        <TranscriptFeed
          {...defaultProps}
          entries={entries}
          hasMoreHistory={true}
          isLoadingMore={true}
          onLoadMore={onLoadMore}
        />,
      );
    });

    // Scroll again during in-flight — should NOT fire (isLoadingMore guard)
    act(() => { fireEvent.scroll(feed); });
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // isLoadingMore flips false (loadMore completed)
    act(() => {
      rerender(
        <TranscriptFeed
          {...defaultProps}
          entries={[...entries, makeEntry({ entryId: 'new' })]}
          hasMoreHistory={true}
          isLoadingMore={false}
          onLoadMore={onLoadMore}
        />,
      );
    });

    // Scroll near top again — loadMoreInFlightRef should be reset, should fire
    act(() => { fireEvent.scroll(feed); });
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// EDGE-4 — Prepend with zero new entries: delta preserves exact scrollTop
// ---------------------------------------------------------------------------

describe('EDGE-4: prepend with 0 new entries — delta preserves scrollTop exactly', () => {
  it('restores scrollTop to pre-loadMore value when loadMore returns no new entries', () => {
    const initialEntries = [makeEntry({ entryId: 'a' })];
    const { rerender } = render(
      <TranscriptFeed
        {...defaultProps}
        entries={initialEntries}
        hasMoreHistory={true}
        isLoadingMore={false}
      />,
    );

    const feed = screen.getByRole('feed');
    const scrollTopSetter = jest.fn();
    let scrollTopValue = 300;

    Object.defineProperty(feed, 'scrollHeight', { configurable: true, get: () => 800 });
    Object.defineProperty(feed, 'clientHeight', { configurable: true, get: () => 600 });
    Object.defineProperty(feed, 'scrollTop', {
      configurable: true,
      get: () => scrollTopValue,
      set: (v: number) => { scrollTopValue = v; scrollTopSetter(v); },
    });

    // isLoadingMore=true: saves delta = 800 - 300 = 500
    act(() => {
      rerender(
        <TranscriptFeed {...defaultProps} entries={initialEntries} hasMoreHistory={false} isLoadingMore={true} />,
      );
    });

    scrollTopSetter.mockClear();

    // isLoadingMore=false, same entries (0 new entries loaded, hasMoreHistory=false)
    // scrollHeight unchanged at 800
    act(() => {
      rerender(
        <TranscriptFeed {...defaultProps} entries={initialEntries} hasMoreHistory={false} isLoadingMore={false} />,
      );
    });

    // restore = 800 - 500 = 300 (exact original scrollTop)
    expect(scrollTopSetter).toHaveBeenCalledWith(300);
  });
});

// ---------------------------------------------------------------------------
// A11Y-1 — sr-only "Cargar más historial" button activates on keyboard Enter
// ---------------------------------------------------------------------------

describe('A11Y-1: sr-only load-more button responds to keyboard activation', () => {
  it('calls onLoadMore when the sr-only button is activated via keyboard Enter', async () => {
    const user = userEvent.setup();
    const onLoadMore = jest.fn();
    render(
      <TranscriptFeed
        {...defaultProps}
        hasMoreHistory={true}
        isLoadingMore={false}
        onLoadMore={onLoadMore}
      />,
    );

    const btn = screen.getByRole('button', { name: /cargar más historial/i });

    // Tab to focus, then press Enter
    await user.tab();
    // The button may or may not be the first focusable element; find it and focus directly
    btn.focus();
    await user.keyboard('{Enter}');

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// A11Y-2 — aria-busy skeleton present while isLoadingMore=true
// ---------------------------------------------------------------------------

describe('A11Y-2: aria-busy skeleton during isLoadingMore', () => {
  it('skeleton container has aria-busy="true" while isLoadingMore=true', () => {
    render(
      <TranscriptFeed
        {...defaultProps}
        hasMoreHistory={true}
        isLoadingMore={true}
      />,
    );
    const skeleton = screen.getByLabelText(/cargando entradas anteriores/i);
    expect(skeleton).toHaveAttribute('aria-busy', 'true');
  });

  it('skeleton container is absent once isLoadingMore=false', () => {
    const { rerender } = render(
      <TranscriptFeed
        {...defaultProps}
        hasMoreHistory={true}
        isLoadingMore={true}
      />,
    );
    rerender(
      <TranscriptFeed
        {...defaultProps}
        hasMoreHistory={false}
        isLoadingMore={false}
      />,
    );
    expect(screen.queryByLabelText(/cargando entradas anteriores/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SPEC-DEVIATION-1 — sr-only button CSS class check
//
// AC24 says the button must be sr-only (hidden from sighted users).
// The class must include "sr-only" to prevent the button from rendering
// visually inline above the feed content in a way that shifts layout.
// ---------------------------------------------------------------------------

describe('SPEC-DEVIATION-1: sr-only class on load-more button', () => {
  it('load-more button has "sr-only" in its className', () => {
    render(
      <TranscriptFeed
        {...defaultProps}
        hasMoreHistory={true}
        isLoadingMore={false}
      />,
    );
    const btn = screen.getByRole('button', { name: /cargar más historial/i });
    expect(btn.className).toContain('sr-only');
  });
});
