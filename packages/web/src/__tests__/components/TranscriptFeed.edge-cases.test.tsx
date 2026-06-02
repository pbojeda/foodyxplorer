// TranscriptFeed edge-cases tests (F-WEB-HISTORY-FU2 QA)
// QA Engineer: covers race/timing and deletion paths missed by the 16 dev tests.
// File: packages/web/src/__tests__/components/TranscriptFeed.edge-cases.test.tsx

import React from 'react';
import { render, screen } from '@testing-library/react';
import type { TranscriptEntryData } from '../../types/history';

// ---------------------------------------------------------------------------
// Module mocks (same as TranscriptFeed.test.tsx)
// ---------------------------------------------------------------------------

jest.mock('../../components/TranscriptEntry', () => ({
  TranscriptEntry: ({ entry }: { entry: TranscriptEntryData }) => (
    <div data-testid={`entry-${entry.entryId}`} role="article">{entry.queryText}</div>
  ),
}));
jest.mock('../../components/EmptyState', () => ({
  EmptyState: () => <div data-testid="empty-state" />,
}));
jest.mock('../../components/HistoryEmptyState', () => ({
  HistoryEmptyState: () => <div data-testid="history-empty-state" />,
}));
jest.mock('../../components/HistoryPersistenceNudge', () => ({
  HistoryPersistenceNudge: ({ onDismiss }: { onDismiss: () => void }) => (
    <div data-testid="persistence-nudge"><button onClick={onDismiss}>close</button></div>
  ),
}));
jest.mock('../../components/HistoryLoadMoreSentinel', () => ({
  HistoryLoadMoreSentinel: ({ onLoadMore }: { onLoadMore: () => void; hasMoreHistory: boolean; isLoadingMore: boolean }) => (
    <div data-testid="load-more-sentinel"><button onClick={onLoadMore}>load</button></div>
  ),
}));
jest.mock('../../components/ClearHistoryButton', () => ({
  ClearHistoryButton: ({ onConfirm }: { onConfirm: () => void }) => (
    <button data-testid="clear-history-button" onClick={onConfirm} />
  ),
}));
jest.mock('../../lib/metrics', () => ({
  trackEvent: jest.fn(),
  flushMetrics: jest.fn(),
}));

import { TranscriptFeed } from '../../components/TranscriptFeed';
import { createResizeObserverShim } from '../helpers/resizeObserverShim';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let _entryId = 0;
function makeEntry(overrides: Partial<TranscriptEntryData> = {}): TranscriptEntryData {
  return {
    entryId: `entry-${++_entryId}`,
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

function installScrollMocks(
  feed: HTMLElement,
  opts: { scrollTop?: number; clientHeight?: number; scrollHeight?: number } = {},
) {
  let _scrollHeight = opts.scrollHeight ?? 1000;
  const scrollToMock = jest.fn();
  Object.defineProperty(feed, 'scrollTo', { value: scrollToMock, writable: true, configurable: true });
  Object.defineProperty(feed, 'scrollTop', { value: opts.scrollTop ?? 400, writable: true, configurable: true });
  Object.defineProperty(feed, 'clientHeight', { value: opts.clientHeight ?? 500, writable: true, configurable: true });
  Object.defineProperty(feed, 'scrollHeight', { get: () => _scrollHeight, configurable: true });
  return {
    scrollToMock,
    setScrollHeight: (v: number) => { _scrollHeight = v; },
  };
}

// ---------------------------------------------------------------------------
// Edge case 1: Entry deletion path
// entries goes N → N-1 (delete): no spurious scroll, prevEntriesLengthRef updated
// then N-1 → N (new append): scroll fires correctly
// ---------------------------------------------------------------------------

describe('TranscriptFeed edge cases — deletion path', () => {
  beforeEach(() => jest.clearAllMocks());

  it('EC-DELETE-1: deleting an entry (length shrinks) must NOT call scrollTo', () => {
    const entryA = makeEntry({ entryId: 'a' });
    const entryB = makeEntry({ entryId: 'b' });
    const { rerender } = render(
      <TranscriptFeed {...defaultProps} entries={[]} />,
    );
    const feed = screen.getByRole('feed');
    const { scrollToMock } = installScrollMocks(feed, { scrollTop: 400, scrollHeight: 1000, clientHeight: 500 });

    // Hydrate with 2 entries.
    rerender(<TranscriptFeed {...defaultProps} entries={[entryA, entryB]} />);
    scrollToMock.mockClear(); // clear hydration scroll

    // Delete entryB: entries shrinks from 2 → 1.
    rerender(<TranscriptFeed {...defaultProps} entries={[entryA]} />);

    // Append effect: entryCountGrew = 1 > 2 → false → must NOT scroll.
    expect(scrollToMock).not.toHaveBeenCalled();
  });

  it('EC-DELETE-2: after deletion, the NEXT real append correctly scrolls (prevEntriesLengthRef not stale)', () => {
    const entryA = makeEntry({ entryId: 'a' });
    const entryB = makeEntry({ entryId: 'b' });
    const entryC = makeEntry({ entryId: 'c' });
    const { rerender } = render(
      <TranscriptFeed {...defaultProps} entries={[]} />,
    );
    const feed = screen.getByRole('feed');
    const { scrollToMock } = installScrollMocks(feed, { scrollTop: 400, scrollHeight: 1000, clientHeight: 500 });

    // Hydrate with 2 entries.
    rerender(<TranscriptFeed {...defaultProps} entries={[entryA, entryB]} />);
    scrollToMock.mockClear();

    // Delete entryB: length 2 → 1. prevEntriesLengthRef should now be 1.
    rerender(<TranscriptFeed {...defaultProps} entries={[entryA]} />);
    scrollToMock.mockClear();

    // Keep user near bottom (wasNearBottomRef=true by default; re-confirm via scroll event).
    Object.defineProperty(feed, 'scrollTop', { value: 400, writable: true, configurable: true });
    feed.dispatchEvent(new Event('scroll', { bubbles: true })); // 400+500 >= 1000-100 → true

    // New session entry appends: length 1 → 2.
    rerender(<TranscriptFeed {...defaultProps} entries={[entryA, entryC]} />);

    // Append effect: entryCountGrew = 2 > 1 → true; wasNearBottomRef=true → scrollTo fires.
    expect(scrollToMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' }),
    );
  });
});

// ---------------------------------------------------------------------------
// Edge case 2: N → 0 → N entry cycle (same component instance, same lifecycle)
// e.g., user clears all entries then gets a new search result
// ---------------------------------------------------------------------------

describe('TranscriptFeed edge cases — N → 0 → N same component', () => {
  beforeEach(() => jest.clearAllMocks());

  it('EC-CLEAR-1: after clear-all (entries → []), a new append still auto-scrolls via append effect', () => {
    const entryA = makeEntry({ entryId: 'a' });
    const entryNew = makeEntry({ entryId: 'new' });
    const { rerender } = render(
      <TranscriptFeed {...defaultProps} entries={[]} />,
    );
    const feed = screen.getByRole('feed');
    const { scrollToMock } = installScrollMocks(feed, { scrollTop: 400, scrollHeight: 1000, clientHeight: 500 });

    // Hydrate with 1 entry.
    rerender(<TranscriptFeed {...defaultProps} entries={[entryA]} />);
    scrollToMock.mockClear();

    // Clear all entries: entries → [].
    rerender(<TranscriptFeed {...defaultProps} entries={[]} />);
    scrollToMock.mockClear();

    // User near bottom (wasNearBottomRef stays true or is updated via scroll event).
    feed.dispatchEvent(new Event('scroll', { bubbles: true })); // 400+500 >= 1000-100 → true

    // New search entry appends: entries [] → [new].
    // Note: prevEntriesLengthRef should be 0 at this point (set when entries went to []).
    rerender(<TranscriptFeed {...defaultProps} entries={[entryNew]} />);

    // Append effect fires (1 > 0 → grew); wasNearBottomRef=true → scrollTo with 'smooth'.
    // Hydration effect: hasScrolledToBottomOnHydrationRef=true → early returns (by design).
    expect(scrollToMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' }),
    );
  });

  it('EC-CLEAR-2: hydration effect does NOT re-fire after clear-all (ref-guard persists for component lifetime)', () => {
    const shim = createResizeObserverShim();
    shim.install();

    const entryA = makeEntry({ entryId: 'a' });
    const entryNew = makeEntry({ entryId: 'new' });
    const { rerender } = render(
      <TranscriptFeed {...defaultProps} entries={[]} />,
    );
    const feed = screen.getByRole('feed');
    installScrollMocks(feed);

    // First hydration.
    rerender(<TranscriptFeed {...defaultProps} entries={[entryA]} />);
    const firstObserver = shim.lastObserver;
    shim.disconnectMock.mockClear();

    // Clear all entries.
    rerender(<TranscriptFeed {...defaultProps} entries={[]} />);

    // New entry arrives (same component instance).
    rerender(<TranscriptFeed {...defaultProps} entries={[entryNew]} />);

    // A NEW ResizeObserver must NOT have been created (shim.lastObserver should still be firstObserver
    // OR the observer may have disconnected via timer — but NOT a new one for the second hydration).
    // The key assertion: disconnectMock was NOT called from a NEW observer install.
    // (Timer from first hydration may have fired if real timers elapsed — but tests run fast).
    expect(shim.lastObserver).toBe(firstObserver); // same instance, no re-installation

    shim.uninstall();
  });
});

// ---------------------------------------------------------------------------
// Edge case 3: resizeObserverShim defensive behavior
// ---------------------------------------------------------------------------

describe('resizeObserverShim edge cases', () => {
  it('EC-SHIM-1: fire() before any component mounts throws descriptively', () => {
    const shim = createResizeObserverShim();
    shim.install();

    expect(() => shim.fire()).toThrow('lastObserverCb is null');

    shim.uninstall();
  });

  it('EC-SHIM-2: uninstall() without prior install() does not permanently destroy globalThis.ResizeObserver', () => {
    // Capture current value (should be the no-op stub from jest.setup.ts).
    const priorValue = globalThis.ResizeObserver;
    expect(priorValue).toBeDefined(); // jest.setup.ts installs a no-op stub

    const shim = createResizeObserverShim();
    // Do NOT call install() — call uninstall() directly.
    shim.uninstall();

    // After a stray uninstall(), _prior is undefined (never was set by install())
    // → globalThis.ResizeObserver = undefined. This is the bug.
    // The test exposes whether this actually happens:
    const afterUninstall = globalThis.ResizeObserver;

    // Restore to avoid test pollution regardless of outcome:
    if (!afterUninstall && priorValue) {
      (globalThis as unknown as Record<string, unknown>).ResizeObserver = priorValue;
    }

    // Assertion: stray uninstall should NOT have destroyed the global.
    // If this fails, the shim needs a guard: `if (_prior !== undefined) globalThis.ResizeObserver = _prior`
    expect(afterUninstall).toBeDefined();
  });

  it('EC-SHIM-3: reset() clears state without touching globalThis.ResizeObserver', () => {
    const shim = createResizeObserverShim();
    shim.install();

    // Render a component to populate lastObserver.
    render(<TranscriptFeed {...defaultProps} entries={[makeEntry({ entryId: 'x' })]} />);
    expect(shim.lastObserverCb).not.toBeNull();

    shim.reset();
    expect(shim.lastObserverCb).toBeNull();
    expect(shim.lastObserver).toBeNull();
    // Global must still be the shim (not restored).
    expect(globalThis.ResizeObserver).toBeDefined();

    shim.uninstall();
  });

  it('EC-SHIM-4: two sequential install/uninstall cycles restore correctly', () => {
    const priorValue = globalThis.ResizeObserver;

    const shim = createResizeObserverShim();
    shim.install();
    const afterFirstInstall = globalThis.ResizeObserver;
    shim.uninstall();
    const afterFirstUninstall = globalThis.ResizeObserver;

    shim.install();
    shim.uninstall();
    const afterSecondUninstall = globalThis.ResizeObserver;

    // After each uninstall, global should be restored to what it was before install.
    expect(afterFirstUninstall).toBe(priorValue);
    expect(afterSecondUninstall).toBe(priorValue);
    // The shim class must differ from the original.
    expect(afterFirstInstall).not.toBe(priorValue);
  });
});

// ---------------------------------------------------------------------------
// Edge case 4: Scroll event during hydration window (observer active) —
// user scrolls immediately after reload during the 500ms window. The observer
// keeps re-scrolling ('instant') but the scroll listener also updates wasNearBottomRef.
// After the window closes, wasNearBottomRef should reflect the user's last scroll position.
// ---------------------------------------------------------------------------

describe('TranscriptFeed edge cases — scroll during hydration window', () => {
  const shim = createResizeObserverShim();

  beforeEach(() => {
    shim.install();
    jest.useFakeTimers();
  });

  afterEach(() => {
    shim.uninstall();
    jest.useRealTimers();
  });

  it('EC-SCROLL-DURING-WINDOW-1: user scrolls up during hydration window; after window, append respects updated wasNearBottomRef', () => {
    const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[]} />);
    const feed = screen.getByRole('feed');
    const { scrollToMock } = installScrollMocks(feed, {
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 500,
    });

    // Hydrate — observer active, wasNearBottomRef=true.
    rerender(<TranscriptFeed {...defaultProps} entries={[makeEntry({ entryId: 'p1' })]} />);

    // User scrolls up DURING the hydration window (< 500ms after hydration).
    // Observer may fire 'instant' re-scrolls, but user is fighting it.
    Object.defineProperty(feed, 'scrollTop', { value: 0, writable: true, configurable: true });
    feed.dispatchEvent(new Event('scroll', { bubbles: false })); // 0+500 < 2000-100 → false

    // Advance past the window.
    jest.advanceTimersByTime(501);
    scrollToMock.mockClear();

    // Post-window: user is NOT near bottom (wasNearBottomRef=false).
    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={[makeEntry({ entryId: 'p1' }), makeEntry({ entryId: 'session1' })]}
      />,
    );

    // Append effect: wasNearBottomRef=false → must NOT scroll.
    expect(scrollToMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' }),
    );
  });
});

// ---------------------------------------------------------------------------
// Edge case 5: Rapid loadMore + session append within the 500ms window
// Both fire the entries.length effect; hydration guard prevents re-setup;
// append effect fires; wasNearBottomRef determines scroll.
// ---------------------------------------------------------------------------

describe('TranscriptFeed edge cases — rapid loadMore + append within window', () => {
  const shim = createResizeObserverShim();

  beforeEach(() => {
    shim.install();
    jest.useFakeTimers();
  });

  afterEach(() => {
    shim.uninstall();
    jest.useRealTimers();
  });

  it('EC-RAPID-1: loadMore prepend within window → observer survives; subsequent session append scrolls correctly', () => {
    const p1 = makeEntry({ entryId: 'p1', isPersisted: true });
    const older = makeEntry({ entryId: 'older', isPersisted: true });
    const session = makeEntry({ entryId: 'session' });

    const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[]} />);
    const feed = screen.getByRole('feed');
    const { scrollToMock } = installScrollMocks(feed, { scrollTop: 400, scrollHeight: 1000, clientHeight: 500 });

    // Hydrate: observer installed.
    rerender(<TranscriptFeed {...defaultProps} entries={[p1]} />);
    expect(shim.disconnectMock).not.toHaveBeenCalled();
    const observerRef = shim.lastObserver;

    // loadMore prepend WITHIN the window: entries grows at front.
    feed.dispatchEvent(new Event('scroll', { bubbles: true })); // 400+500 >= 1000-100 → near bottom
    rerender(<TranscriptFeed {...defaultProps} entries={[older, p1]} />);

    // Observer must still be the same instance (not disconnected by React cleanup).
    expect(shim.disconnectMock).not.toHaveBeenCalled();
    expect(shim.lastObserver).toBe(observerRef);

    scrollToMock.mockClear();

    // Session append WITHIN the window: user near bottom → append scrolls.
    rerender(<TranscriptFeed {...defaultProps} entries={[older, p1, session]} />);

    expect(scrollToMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' }),
    );
  });
});
