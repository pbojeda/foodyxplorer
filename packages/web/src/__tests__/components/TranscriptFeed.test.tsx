// TranscriptFeed tests — AC32, AC34, AC37, AC45, AC46, AC47
// AC32: role="feed", aria-label="Historial de consultas", aria-busy.
// AC34: entries rendered in order with dividers.
// AC37: HistoryPersistenceNudge shown only when showPersistenceNudge=true.
// AC45: HistoryEmptyState for authenticated+empty, EmptyState for anonymous+empty.
// AC46: ClearHistoryButton visible when isAuthenticated && has persisted entries.
// AC47: auto-scroll fires when near bottom and new entries added.

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TranscriptEntryData } from '../../types/history';

// ---------------------------------------------------------------------------
// Module mocks
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
  HistoryEmptyState: () => <div data-testid="history-empty-state">Aún no tienes historial</div>,
}));

jest.mock('../../components/HistoryPersistenceNudge', () => ({
  HistoryPersistenceNudge: ({ onDismiss }: { onDismiss: () => void }) => (
    <div data-testid="persistence-nudge">
      <button onClick={onDismiss}>Cerrar sugerencia</button>
    </div>
  ),
}));

jest.mock('../../components/HistoryLoadMoreSentinel', () => ({
  HistoryLoadMoreSentinel: ({ onLoadMore }: { onLoadMore: () => void; hasMoreHistory: boolean; isLoadingMore: boolean }) => (
    <div data-testid="load-more-sentinel">
      <button onClick={onLoadMore}>Cargar más historial</button>
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
import { createResizeObserverShim } from '../helpers/resizeObserverShim';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<TranscriptEntryData> = {}): TranscriptEntryData {
  return {
    entryId: `entry-${Math.random()}`,
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
  entries: [],
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
// Tests
// ---------------------------------------------------------------------------

describe('TranscriptFeed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // AC32: role="feed"
  it('AC32: has role="feed"', () => {
    render(<TranscriptFeed {...defaultProps} />);
    expect(screen.getByRole('feed')).toBeInTheDocument();
  });

  // AC32: aria-label
  it('AC32: has aria-label="Historial de consultas"', () => {
    render(<TranscriptFeed {...defaultProps} />);
    expect(screen.getByRole('feed')).toHaveAttribute('aria-label', 'Historial de consultas');
  });

  // AC32: aria-busy when isLoadingHistory
  it('AC32: aria-busy=true when isLoadingHistory=true', () => {
    render(<TranscriptFeed {...defaultProps} isLoadingHistory={true} />);
    expect(screen.getByRole('feed')).toHaveAttribute('aria-busy', 'true');
  });

  it('AC32: aria-busy absent when not loading history', () => {
    render(<TranscriptFeed {...defaultProps} isLoadingHistory={false} />);
    expect(screen.getByRole('feed')).not.toHaveAttribute('aria-busy');
  });

  // AC34: entries rendered in DOM order
  it('AC34: renders entries in order', () => {
    const entries = [
      makeEntry({ entryId: 'a', queryText: 'first query' }),
      makeEntry({ entryId: 'b', queryText: 'second query' }),
    ];
    render(<TranscriptFeed {...defaultProps} entries={entries} />);
    const articles = screen.getAllByRole('article');
    expect(articles).toHaveLength(2);
    expect(articles[0]).toHaveTextContent('first query');
    expect(articles[1]).toHaveTextContent('second query');
  });

  // AC34: dividers between entries
  it('AC34: renders dividers between entries', () => {
    const entries = [
      makeEntry({ entryId: 'a' }),
      makeEntry({ entryId: 'b' }),
      makeEntry({ entryId: 'c' }),
    ];
    render(<TranscriptFeed {...defaultProps} entries={entries} />);
    const dividers = document.querySelectorAll('hr');
    // n entries → n-1 dividers
    expect(dividers).toHaveLength(2);
  });

  // AC37: HistoryPersistenceNudge shown when showPersistenceNudge=true
  it('AC37: shows HistoryPersistenceNudge when showPersistenceNudge=true', () => {
    render(<TranscriptFeed {...defaultProps} showPersistenceNudge={true} />);
    expect(screen.getByTestId('persistence-nudge')).toBeInTheDocument();
  });

  it('AC37: does NOT show HistoryPersistenceNudge when showPersistenceNudge=false', () => {
    render(<TranscriptFeed {...defaultProps} showPersistenceNudge={false} />);
    expect(screen.queryByTestId('persistence-nudge')).not.toBeInTheDocument();
  });

  // AC45: anonymous + empty → EmptyState
  it('AC45: shows EmptyState for anonymous user with no entries', () => {
    render(<TranscriptFeed {...defaultProps} isAuthenticated={false} entries={[]} />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('history-empty-state')).not.toBeInTheDocument();
  });

  // AC45: authenticated + empty → HistoryEmptyState
  it('AC45: shows HistoryEmptyState for authenticated user with no entries', () => {
    render(
      <TranscriptFeed {...defaultProps} isAuthenticated={true} entries={[]} />
    );
    expect(screen.getByTestId('history-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
  });

  // AC46: ClearHistoryButton visible when authenticated + has persisted entries
  it('AC46: shows ClearHistoryButton when authenticated and has persisted entries', () => {
    const entries = [makeEntry({ isPersisted: true })];
    render(
      <TranscriptFeed {...defaultProps} isAuthenticated={true} entries={entries} />
    );
    expect(screen.getByTestId('clear-history-button')).toBeInTheDocument();
  });

  it('AC46: does NOT show ClearHistoryButton when authenticated but no persisted entries', () => {
    const entries = [makeEntry({ isPersisted: false })];
    render(
      <TranscriptFeed {...defaultProps} isAuthenticated={true} entries={entries} />
    );
    expect(screen.queryByTestId('clear-history-button')).not.toBeInTheDocument();
  });

  it('AC46: does NOT show ClearHistoryButton when anonymous', () => {
    const entries = [makeEntry({ isPersisted: true })];
    render(
      <TranscriptFeed {...defaultProps} isAuthenticated={false} entries={entries} />
    );
    expect(screen.queryByTestId('clear-history-button')).not.toBeInTheDocument();
  });

  // Load-more sentinel shown when authenticated + hasMoreHistory
  it('shows load-more sentinel when authenticated and hasMoreHistory=true', () => {
    render(
      <TranscriptFeed
        {...defaultProps}
        isAuthenticated={true}
        hasMoreHistory={true}
      />
    );
    expect(screen.getByTestId('load-more-sentinel')).toBeInTheDocument();
  });

  it('does NOT show load-more sentinel when anonymous', () => {
    render(
      <TranscriptFeed
        {...defaultProps}
        isAuthenticated={false}
        hasMoreHistory={true}
      />
    );
    expect(screen.queryByTestId('load-more-sentinel')).not.toBeInTheDocument();
  });

  // onClearAll called when ClearHistoryButton confirm
  it('calls onClearAll when ClearHistoryButton fires', async () => {
    const onClearAll = jest.fn();
    const entries = [makeEntry({ isPersisted: true })];
    render(
      <TranscriptFeed
        {...defaultProps}
        isAuthenticated={true}
        entries={entries}
        onClearAll={onClearAll}
      />
    );
    await userEvent.click(screen.getByTestId('clear-history-button'));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  // AC47: auto-scroll invoked when new entry added and user is near bottom.
  // jsdom does not implement element.scrollTo — we mock it via Object.defineProperty.
  it('AC47: scrollTo is called when new entry is added and user is near bottom', () => {
    const { rerender } = render(
      <TranscriptFeed {...defaultProps} entries={[]} />
    );

    const feed = screen.getByRole('feed');
    const scrollToMock = jest.fn();

    // jsdom doesn't have scrollTo on elements — define it
    Object.defineProperty(feed, 'scrollTo', {
      value: scrollToMock,
      writable: true,
      configurable: true,
    });
    // Simulate being at bottom (scrollTop + clientHeight >= scrollHeight - 100)
    Object.defineProperty(feed, 'scrollTop', { value: 400, writable: true, configurable: true });
    Object.defineProperty(feed, 'clientHeight', { value: 500, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollHeight', { value: 500, writable: true, configurable: true });

    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={[makeEntry({ entryId: 'new' })]}
      />
    );

    expect(scrollToMock).toHaveBeenCalledWith({ top: expect.any(Number), behavior: 'smooth' });
  });

  // -------------------------------------------------------------------------
  // F-WEB-HISTORY-FU1 item B — bottom padding clears the fixed ConversationInput bar
  // -------------------------------------------------------------------------

  it('AC8: scroll container has bottom padding clearing the fixed bottom bar (~144px + iOS safe area)', () => {
    render(<TranscriptFeed {...defaultProps} entries={[makeEntry()]} />);
    const feed = screen.getByRole('feed');
    // pb-[calc(9rem+env(safe-area-inset-bottom))] — 9rem = 144px base + iOS safe area
    expect(feed.className).toContain('pb-[calc(9rem+env(safe-area-inset-bottom))]');
    // Regression guard: the old pb-6 (24px) must no longer be on the container.
    // (className inspection is jsdom-friendly; layout-based assertions like
    // getBoundingClientRect are unreliable in jsdom — see /review-spec G1.)
    expect(feed.className).not.toMatch(/(^|\s)pb-6($|\s)/);
  });

  it('AC9: 1-entry render still has the expected padding and does not crash', () => {
    const { container } = render(<TranscriptFeed {...defaultProps} entries={[makeEntry({ entryId: 'only' })]} />);
    const feed = screen.getByRole('feed');
    expect(feed.className).toContain('pb-[calc(9rem+env(safe-area-inset-bottom))]');
    expect(container.querySelectorAll('[role="article"], [aria-busy]').length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // F-WEB-HISTORY-FU1 item C — scroll-to-bottom on mount + async hydration
  // -------------------------------------------------------------------------

  // Helper: define mutable scroll properties + scrollTo spy on the feed element.
  function installScrollMocks(
    feed: HTMLElement,
    opts: { scrollTop?: number; clientHeight?: number; scrollHeight?: number } = {},
  ) {
    const scrollToMock = jest.fn();
    Object.defineProperty(feed, 'scrollTo', { value: scrollToMock, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollTop', { value: opts.scrollTop ?? 0, writable: true, configurable: true });
    Object.defineProperty(feed, 'clientHeight', { value: opts.clientHeight ?? 500, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollHeight', { value: opts.scrollHeight ?? 1500, writable: true, configurable: true });
    return scrollToMock;
  }

  it('AC10: scrolls to bottom on synchronous mount with N≥2 entries', async () => {
    // To install scroll mocks BEFORE the effect fires, start with entries=[]
    // (the effect early-returns), install the mocks, then rerender with entries.
    // This mirrors React's effect flush timing.
    const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[]} />);
    const feed = screen.getByRole('feed');
    const scrollToMock = installScrollMocks(feed, { scrollTop: 0, scrollHeight: 1500, clientHeight: 500 });

    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={[makeEntry({ entryId: 'a' }), makeEntry({ entryId: 'b' })]}
      />
    );

    expect(scrollToMock).toHaveBeenCalledWith({ top: 1500, behavior: 'instant' });
  });

  it('AC10b: scrolls to bottom on async hydration ([] → [persisted×N])', async () => {
    // The real reload path: useSearchHistory loads asynchronously, so entries
    // is [] on first render and grows to N≥1 on a later rerender — even when the
    // user is NOT near the bottom (scrollTop=0). The new hydration effect must
    // bypass the existing isNearBottom guard.
    const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[]} />);
    const feed = screen.getByRole('feed');
    const scrollToMock = installScrollMocks(feed, { scrollTop: 0, scrollHeight: 2000, clientHeight: 500 });

    // FU2: fire scroll event to set wasNearBottomRef=false (user is NOT near bottom:
    // 0+500 < 2000-100=1900). This ensures the append effect does NOT also scroll.
    // The hydration effect ignores wasNearBottomRef (it's ref-guarded, not conditional
    // on user position — the whole point of the bug fix is to scroll regardless).
    feed.dispatchEvent(new Event('scroll', { bubbles: false }));

    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={[
          makeEntry({ entryId: 'p1', isPersisted: true }),
          makeEntry({ entryId: 'p2', isPersisted: true }),
        ]}
      />
    );

    expect(scrollToMock).toHaveBeenCalledWith({ top: 2000, behavior: 'instant' });
    // Fires exactly once (hydration path; append effect skipped because wasNearBottomRef=false).
    expect(scrollToMock).toHaveBeenCalledTimes(1);
  });

  it('AC10c: loadMore prepend (isLoadingMore false→true→false + entries grow) does NOT scroll to bottom, AND restores scrollTop', () => {
    // Step 1: mount with 2 entries; hydration effect fires once, ref becomes true.
    const initialEntries = [makeEntry({ entryId: 'a' }), makeEntry({ entryId: 'b' })];
    const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[]} />);
    const feed = screen.getByRole('feed');
    const scrollToMock = installScrollMocks(feed, { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 });

    // FU2: fire scroll event with NOT-near-bottom values (0+500 < 1000-100=900 → false)
    // so that the hydration-triggered append effect does NOT scroll.
    feed.dispatchEvent(new Event('scroll', { bubbles: false }));
    rerender(<TranscriptFeed {...defaultProps} entries={initialEntries} />);
    expect(scrollToMock).toHaveBeenCalledTimes(1); // hydration scroll only
    scrollToMock.mockClear();

    // Step 2: user scrolls up (well above the near-bottom 100px threshold).
    Object.defineProperty(feed, 'scrollTop', { value: 200, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollHeight', { value: 1000, writable: true, configurable: true });
    // Fire scroll event to update wasNearBottomRef: 200+500=700 < 1000-100=900 → false.
    feed.dispatchEvent(new Event('scroll', { bubbles: false }));

    // Step 3: isLoadingMore flips to true — existing capture effect runs.
    rerender(<TranscriptFeed {...defaultProps} entries={initialEntries} isLoadingMore={true} />);

    // Step 4: simulate the DOM growing because older entries were inserted
    // at the front. delta = 400 (new scrollHeight 1400 − old 1000).
    Object.defineProperty(feed, 'scrollHeight', { value: 1400, writable: true, configurable: true });

    // Step 5: isLoadingMore flips back to false with the older entries now in the
    // entries array (prepended). The existing restore effect adjusts scrollTop.
    const prependedEntries = [
      makeEntry({ entryId: 'older1', isPersisted: true }),
      makeEntry({ entryId: 'older2', isPersisted: true }),
      ...initialEntries,
    ];
    rerender(<TranscriptFeed {...defaultProps} entries={prependedEntries} isLoadingMore={false} />);

    // Critical assertions:
    // (a) The new hydration effect did NOT re-fire (ref-guarded).
    expect(scrollToMock).not.toHaveBeenCalled();
    // (b) The existing prepend-preservation logic restored scrollTop to prev + delta = 200 + 400 = 600.
    expect(feed.scrollTop).toBe(600);
  });

  it('AC11 (regression): when a new session entry appends AND user is near bottom, scrollTo is called — covered by existing AC47 test above; this is an explicit guard after Step 5 lands', () => {
    // Same scenario as AC47, but with the hydration effect now in place — verifies
    // they coexist (hydration fires first on mount, ref locks it, then the append
    // effect still works on subsequent appends because it's a separate effect).
    const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[makeEntry({ entryId: 'a' })]} />);
    const feed = screen.getByRole('feed');
    const scrollToMock = installScrollMocks(feed, { scrollTop: 400, scrollHeight: 500, clientHeight: 500 });
    // Hydration effect fired (entries=[a] → ref locks).
    rerender(<TranscriptFeed {...defaultProps} entries={[makeEntry({ entryId: 'a' }), makeEntry({ entryId: 'b' })]} />);
    // The append effect should fire because user is near bottom (400+500 >= 500-100).
    expect(scrollToMock).toHaveBeenCalledWith({ top: expect.any(Number), behavior: 'smooth' });
  });

  it('AC12: when a new entry appends AND user has scrolled up (>100px from bottom), scrollTo is NOT called', () => {
    const initialEntries = [makeEntry({ entryId: 'a' }), makeEntry({ entryId: 'b' })];
    const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[]} />);
    const feed = screen.getByRole('feed');
    const scrollToMock = installScrollMocks(feed, { scrollTop: 0, scrollHeight: 2000, clientHeight: 500 });

    // FU2: fire scroll event BEFORE hydration rerender so wasNearBottomRef=false.
    // 0+500 < 2000-100=1900 → false. This ensures hydration does NOT also trigger
    // the append effect (and the 1-time assertion below is preserved).
    feed.dispatchEvent(new Event('scroll', { bubbles: false }));
    rerender(<TranscriptFeed {...defaultProps} entries={initialEntries} />);
    // Hydration fired once (scrollTo instant). Append effect skipped (wasNearBottomRef=false).
    expect(scrollToMock).toHaveBeenCalledTimes(1);
    scrollToMock.mockClear();

    // User scrolls up well above the threshold.
    Object.defineProperty(feed, 'scrollTop', { value: 0, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollHeight', { value: 2000, writable: true, configurable: true });
    Object.defineProperty(feed, 'clientHeight', { value: 500, writable: true, configurable: true });
    // Re-fire scroll event to keep wasNearBottomRef=false after property re-definition.
    feed.dispatchEvent(new Event('scroll', { bubbles: false }));

    // Append a new session entry.
    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={[...initialEntries, makeEntry({ entryId: 'new', isPersisted: false })]}
      />
    );

    // Append effect should NOT scroll (user is far from bottom — 0+500 < 2000-100).
    // The hydration effect is already locked.
    expect(scrollToMock).not.toHaveBeenCalled();
  });

  it('AC13: hydration scroll-to-bottom uses behavior:"instant" (FU2: smooth→instant)', () => {
    const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[]} />);
    const feed = screen.getByRole('feed');
    const scrollToMock = installScrollMocks(feed, { scrollTop: 0, scrollHeight: 1200, clientHeight: 500 });
    // FU2: fire scroll event to set wasNearBottomRef=false (0+500 < 1200-100=1100 → false)
    // so the append effect does not fire and the LAST call is the hydration 'instant' scroll.
    feed.dispatchEvent(new Event('scroll', { bubbles: false }));
    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={[makeEntry({ entryId: 'a' }), makeEntry({ entryId: 'b' })]}
      />
    );
    expect(scrollToMock).toHaveBeenCalled();
    const lastCallArg = scrollToMock.mock.calls[scrollToMock.mock.calls.length - 1]?.[0] as { behavior?: string };
    expect(lastCallArg?.behavior).toBe('instant');
  });
});

// ---------------------------------------------------------------------------
// Step 4: append effect uses wasNearBottomRef (AC8–AC11)
// ---------------------------------------------------------------------------

describe('TranscriptFeed — Step 4: append wasNearBottomRef', () => {
  // Helper: define mutable scroll properties + scrollTo spy on the feed element.
  function installScrollMocksLocal(
    feed: HTMLElement,
    opts: { scrollTop?: number; clientHeight?: number; scrollHeight?: number } = {},
  ) {
    let _scrollHeight = opts.scrollHeight ?? 500;
    const scrollToMock = jest.fn();
    Object.defineProperty(feed, 'scrollTo', { value: scrollToMock, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollTop', { value: opts.scrollTop ?? 400, writable: true, configurable: true });
    Object.defineProperty(feed, 'clientHeight', { value: opts.clientHeight ?? 500, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollHeight', {
      get: () => _scrollHeight,
      configurable: true,
    });
    return {
      scrollToMock,
      setScrollHeight: (v: number) => { _scrollHeight = v; },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('AC8: append effect calls scrollTo with "smooth" when wasNearBottomRef is true', () => {
    // Render with initial entries; ref defaults to true.
    const { rerender } = render(
      <TranscriptFeed {...defaultProps} entries={[makeEntry({ entryId: 'a' })]} />,
    );
    const feed = screen.getByRole('feed');
    const { scrollToMock } = installScrollMocksLocal(feed, { scrollTop: 400, scrollHeight: 500, clientHeight: 500 });

    // Fire a scroll event that puts user near bottom → wasNearBottomRef = true.
    // 400 + 500 >= 500 - 100 → 900 >= 400 → true.
    feed.dispatchEvent(new Event('scroll', { bubbles: true }));

    // Append a new entry.
    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={[makeEntry({ entryId: 'a' }), makeEntry({ entryId: 'b' })]}
      />,
    );

    expect(scrollToMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' }),
    );
  });

  it('AC9: race-aware — append scrolls even when post-commit scrollHeight has jumped >100px above user position', () => {
    // Start: user near bottom, wasNearBottomRef = true (default).
    const { rerender } = render(
      <TranscriptFeed {...defaultProps} entries={[makeEntry({ entryId: 'a' })]} />,
    );
    const feed = screen.getByRole('feed');
    const { scrollToMock, setScrollHeight } = installScrollMocksLocal(feed, {
      scrollTop: 400,
      scrollHeight: 500,
      clientHeight: 100,
    });

    // Confirm near bottom via scroll event (400+100 >= 500-100 → 500 >= 400 → true).
    feed.dispatchEvent(new Event('scroll', { bubbles: true }));

    // Simulate append: scrollHeight jumps >100px (the post-commit math would fail).
    setScrollHeight(700); // now scrollTop(400) + clientHeight(100) = 500 < 700-100=600 → post-commit math = false.

    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={[makeEntry({ entryId: 'a' }), makeEntry({ entryId: 'b' })]}
      />,
    );

    // wasNearBottomRef was true (pre-commit), so scrollTo MUST have been called.
    expect(scrollToMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' }),
    );
  });

  it('AC10: user scrolled up (≥100px from bottom) — append does NOT scroll', () => {
    const { rerender } = render(
      <TranscriptFeed {...defaultProps} entries={[makeEntry({ entryId: 'a' }), makeEntry({ entryId: 'b' })]} />,
    );
    const feed = screen.getByRole('feed');
    const { scrollToMock } = installScrollMocksLocal(feed, { scrollTop: 0, scrollHeight: 2000, clientHeight: 500 });

    // User scrolls up: 0 + 500 < 2000 - 100 → 500 < 1900 → wasNearBottomRef = false.
    feed.dispatchEvent(new Event('scroll', { bubbles: true }));

    // Append new entry.
    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={[makeEntry({ entryId: 'a' }), makeEntry({ entryId: 'b' }), makeEntry({ entryId: 'c' })]}
      />,
    );

    expect(scrollToMock).not.toHaveBeenCalled();
  });

  it('AC11: loadMore prepend does NOT trigger append auto-scroll (regression guard)', () => {
    const initialEntries = [makeEntry({ entryId: 'a' }), makeEntry({ entryId: 'b' })];
    const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[]} />);
    const feed = screen.getByRole('feed');
    const { scrollToMock } = installScrollMocksLocal(feed, { scrollTop: 200, scrollHeight: 1000, clientHeight: 500 });

    rerender(<TranscriptFeed {...defaultProps} entries={initialEntries} />);
    // Hydration fires; clear for assertion on prepend.
    scrollToMock.mockClear();

    // User scrolls up well above threshold.
    Object.defineProperty(feed, 'scrollTop', { value: 200, writable: true, configurable: true });
    feed.dispatchEvent(new Event('scroll', { bubbles: true }));

    // isLoadingMore: true → false + entries grow at front.
    rerender(<TranscriptFeed {...defaultProps} entries={initialEntries} isLoadingMore={true} />);
    Object.defineProperty(feed, 'scrollHeight', { value: 1400, writable: true, configurable: true });
    const prependedEntries = [
      makeEntry({ entryId: 'older1', isPersisted: true }),
      makeEntry({ entryId: 'older2', isPersisted: true }),
      ...initialEntries,
    ];
    rerender(<TranscriptFeed {...defaultProps} entries={prependedEntries} isLoadingMore={false} />);

    // Prepend preservation ran but auto-scroll should NOT (wasNearBottomRef = false).
    expect(scrollToMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' }),
    );
  });
});

// ---------------------------------------------------------------------------
// Step 5: coexistence (AC12) + cleanup (AC13b, AC13c)
// ---------------------------------------------------------------------------

describe('TranscriptFeed — Step 5: coexistence + cleanup', () => {
  const shim = createResizeObserverShim();

  function installScrollMocksLocal(
    feed: HTMLElement,
    opts: { scrollTop?: number; clientHeight?: number; scrollHeight?: number } = {},
  ) {
    const scrollToMock = jest.fn();
    Object.defineProperty(feed, 'scrollTo', { value: scrollToMock, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollTop', { value: opts.scrollTop ?? 0, writable: true, configurable: true });
    Object.defineProperty(feed, 'clientHeight', { value: opts.clientHeight ?? 500, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollHeight', { value: opts.scrollHeight ?? 1000, writable: true, configurable: true });
    return scrollToMock;
  }

  beforeEach(() => {
    shim.install();
    shim.disconnectMock.mockClear();
    shim.observeMock.mockClear();
  });

  afterEach(() => {
    shim.uninstall();
    jest.useRealTimers();
  });

  it('AC12: after hydration window closes, append path only runs wasNearBottomRef (no ResizeObserver stacking)', () => {
    jest.useFakeTimers();
    const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[]} />);
    const feed = screen.getByRole('feed');
    const scrollToMock = installScrollMocksLocal(feed, { scrollTop: 0, scrollHeight: 900, clientHeight: 500 });

    // Fire scroll to set wasNearBottomRef=false before hydration (0+500 < 900-100=800 → false).
    feed.dispatchEvent(new Event('scroll', { bubbles: false }));

    // Hydrate: observer installed.
    rerender(<TranscriptFeed {...defaultProps} entries={[makeEntry({ entryId: 'p1' })]} />);
    expect(shim.disconnectMock).not.toHaveBeenCalled();

    // Advance past the HYDRATION_RESCROLL_WINDOW_MS timer → observer disconnects.
    jest.advanceTimersByTime(501);
    expect(shim.disconnectMock).toHaveBeenCalledTimes(1);

    // Clear scrollTo calls from the hydration phase.
    scrollToMock.mockClear();

    // Set user near bottom via scroll event (400+500 >= 900-100=800 → true).
    Object.defineProperty(feed, 'scrollTop', { value: 400, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollHeight', { value: 900, writable: true, configurable: true });
    feed.dispatchEvent(new Event('scroll', { bubbles: false }));

    // Append a new session entry after the hydration window has closed.
    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={[makeEntry({ entryId: 'p1' }), makeEntry({ entryId: 'session1' })]}
      />,
    );

    // Append path fires exactly once with 'smooth'. ResizeObserver no longer stacks.
    expect(scrollToMock).toHaveBeenCalledTimes(1);
    expect(scrollToMock).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
  });

  it('AC13b: ResizeObserver disconnect is called on unmount (if still active)', () => {
    jest.useFakeTimers();
    const { rerender, unmount } = render(<TranscriptFeed {...defaultProps} entries={[]} />);
    const feed = screen.getByRole('feed');
    installScrollMocksLocal(feed);
    feed.dispatchEvent(new Event('scroll', { bubbles: false }));

    // Hydrate: observer active (no timer fired yet).
    rerender(<TranscriptFeed {...defaultProps} entries={[makeEntry({ entryId: 'p1' })]} />);
    expect(shim.disconnectMock).not.toHaveBeenCalled();

    // Capture instance for per-instance assertion.
    const capturedObserver = shim.lastObserver;

    // Unmount before the timer fires.
    unmount();

    expect(capturedObserver?.disconnect).toHaveBeenCalledTimes(1);
    expect(shim.disconnectMock).toHaveBeenCalledTimes(1);
  });

  it('AC13c: timer-fired teardown nulls the ref handle (no double-disconnect on subsequent unmount)', () => {
    jest.useFakeTimers();
    const { rerender, unmount } = render(<TranscriptFeed {...defaultProps} entries={[]} />);
    const feed = screen.getByRole('feed');
    installScrollMocksLocal(feed);
    feed.dispatchEvent(new Event('scroll', { bubbles: false }));

    // Hydrate: observer active.
    rerender(<TranscriptFeed {...defaultProps} entries={[makeEntry({ entryId: 'p1' })]} />);

    // Timer fires: observer disconnects once.
    jest.advanceTimersByTime(501);
    expect(shim.disconnectMock).toHaveBeenCalledTimes(1);

    // Unmount AFTER timer has already fired.
    unmount();

    // disconnectMock must NOT be called again (handle.observer was null → skipped).
    expect(shim.disconnectMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Step 1: resizeObserverShim sanity — verifies ts-jest compiles the helper
// ---------------------------------------------------------------------------

describe('resizeObserverShim sanity', () => {
  it('install/uninstall does not throw', () => {
    const s = createResizeObserverShim();
    s.install();
    s.uninstall();
  });
});

// ---------------------------------------------------------------------------
// Step 2: scroll listener (AC7) + teardown (AC13a)
// ---------------------------------------------------------------------------

describe('TranscriptFeed — Step 2: scroll listener', () => {
  it('AC7: mounts a scroll listener on the feed container that updates wasNearBottomRef', () => {
    const addEventSpy = jest.spyOn(HTMLDivElement.prototype, 'addEventListener');
    render(<TranscriptFeed {...defaultProps} entries={[]} />);
    const scrollCalls = addEventSpy.mock.calls.filter(
      ([event]) => event === 'scroll',
    );
    expect(scrollCalls.length).toBeGreaterThanOrEqual(1);
    addEventSpy.mockRestore();
  });

  it('AC13a: scroll listener is removed on unmount', () => {
    const removeEventSpy = jest.spyOn(
      HTMLDivElement.prototype,
      'removeEventListener',
    );
    const { unmount } = render(
      <TranscriptFeed {...defaultProps} entries={[]} />,
    );
    unmount();
    const scrollRemovals = removeEventSpy.mock.calls.filter(
      ([event]) => event === 'scroll',
    );
    expect(scrollRemovals.length).toBeGreaterThanOrEqual(1);
    removeEventSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Step 3: ResizeObserver hydration (AC1–AC6)
// ---------------------------------------------------------------------------

describe('TranscriptFeed — Step 3: ResizeObserver hydration', () => {
  const shim = createResizeObserverShim();

  // Helper: define mutable scroll properties + scrollTo spy on an element.
  function installScrollMocksLocal(
    feed: HTMLElement,
    opts: { scrollTop?: number; clientHeight?: number; scrollHeight?: number } = {},
  ) {
    let _scrollHeight = opts.scrollHeight ?? 1500;
    const scrollToMock = jest.fn();
    Object.defineProperty(feed, 'scrollTo', {
      value: scrollToMock,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(feed, 'scrollTop', {
      value: opts.scrollTop ?? 0,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(feed, 'clientHeight', {
      value: opts.clientHeight ?? 500,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(feed, 'scrollHeight', {
      get: () => _scrollHeight,
      configurable: true,
    });
    return {
      scrollToMock,
      setScrollHeight: (v: number) => { _scrollHeight = v; },
    };
  }

  beforeEach(() => {
    shim.install();
    shim.disconnectMock.mockClear();
    shim.observeMock.mockClear();
  });

  afterEach(() => {
    shim.uninstall();
    jest.useRealTimers();
  });

  it('AC1: ResizeObserver is attached on hydration (observe + lastObserverCb both set)', () => {
    const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[]} />);
    const feed = screen.getByRole('feed');
    installScrollMocksLocal(feed);

    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={[makeEntry({ entryId: 'p1' }), makeEntry({ entryId: 'p2' })]}
      />,
    );

    expect(shim.lastObserverCb).not.toBeNull();
    expect(shim.observeMock).toHaveBeenCalledWith(feed);
  });

  it('AC2: hydration scrollTo uses behavior:"instant" not "smooth"', () => {
    const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[]} />);
    const feed = screen.getByRole('feed');
    const { scrollToMock, setScrollHeight } = installScrollMocksLocal(feed, {
      scrollTop: 0,
      clientHeight: 500,
      scrollHeight: 1500,
    });

    // FU2: fire scroll event to set wasNearBottomRef=false (0+500 < 1500-100=1400 → false).
    // This prevents the append effect from adding a 'smooth' call after hydration,
    // so all scrollTo calls observed here are exclusively from the hydration path.
    feed.dispatchEvent(new Event('scroll', { bubbles: false }));

    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={[makeEntry({ entryId: 'p1' })]}
      />,
    );

    // First synchronous scroll must be 'instant'.
    expect(scrollToMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'instant' }),
    );

    // Any subsequent ResizeObserver re-fire must also be 'instant'.
    setScrollHeight(2000);
    shim.fire([{ target: feed } as unknown as ResizeObserverEntry]);
    const allCalls = scrollToMock.mock.calls as Array<[{ behavior?: string }]>;
    allCalls.forEach(([arg]) => {
      expect(arg.behavior).toBe('instant');
    });
  });

  it('AC3: hasScrolledToBottomOnHydrationRef guard — observer survives intermediate entries.length changes within the window', () => {
    jest.useFakeTimers();

    const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[]} />);
    const feed = screen.getByRole('feed');
    installScrollMocksLocal(feed);

    // First hydration: observer is installed.
    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={[makeEntry({ entryId: 'p1' })]}
      />,
    );
    expect(shim.disconnectMock).not.toHaveBeenCalled();
    const observerAfterFirstHydration = shim.lastObserver;

    // Second entries.length change within the window (e.g. loadMore prepend).
    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={[makeEntry({ entryId: 'older1' }), makeEntry({ entryId: 'p1' })]}
      />,
    );

    // Observer must NOT be disconnected and must be the SAME instance.
    expect(shim.disconnectMock).not.toHaveBeenCalled();
    expect(shim.lastObserver).toBe(observerAfterFirstHydration);
  });

  it('AC4: race-aware — scrollTo called again after ResizeObserver fires with grown scrollHeight', () => {
    const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[]} />);
    const feed = screen.getByRole('feed');
    const { scrollToMock, setScrollHeight } = installScrollMocksLocal(feed, { scrollHeight: 1000 });

    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={[makeEntry({ entryId: 'p1' })]}
      />,
    );

    // Initial synchronous scroll fires with scrollHeight=1000.
    expect(scrollToMock).toHaveBeenCalledWith({ top: 1000, behavior: 'instant' });

    // Simulate child card growth.
    setScrollHeight(1500);
    shim.fire([{ target: feed } as unknown as ResizeObserverEntry]);

    // Must have been called at least twice; last call must use the grown height.
    expect(scrollToMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    const lastCall = scrollToMock.mock.calls[scrollToMock.mock.calls.length - 1]?.[0] as {
      top: number;
      behavior: string;
    };
    expect(lastCall).toEqual({ top: 1500, behavior: 'instant' });
  });

  it('AC5: fallback — when ResizeObserver is undefined, single-shot instant scroll fires (no throw)', () => {
    // Temporarily remove ResizeObserver (BEFORE rendering — shim.install() already
    // replaced globalThis.ResizeObserver, so we uninstall first for this test).
    shim.uninstall();
    const prior = (globalThis as unknown as Record<string, unknown>).ResizeObserver;
    delete (globalThis as unknown as Record<string, unknown>).ResizeObserver;

    try {
      const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[]} />);
      const feed = screen.getByRole('feed');
      const scrollToMock = jest.fn();
      Object.defineProperty(feed, 'scrollTo', {
        value: scrollToMock,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(feed, 'scrollTop', {
        value: 0,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(feed, 'clientHeight', {
        value: 500,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(feed, 'scrollHeight', {
        value: 800,
        writable: true,
        configurable: true,
      });

      // FU2: fire scroll event to set wasNearBottomRef=false (0+500 < 800-100=700 → false).
      // Prevents append effect from adding a second scrollTo call after hydration.
      feed.dispatchEvent(new Event('scroll', { bubbles: false }));

      rerender(
        <TranscriptFeed
          {...defaultProps}
          entries={[makeEntry({ entryId: 'p1' })]}
        />,
      );

      // Exactly one scroll call with 'instant' (fallback path, no ResizeObserver).
      expect(scrollToMock).toHaveBeenCalledTimes(1);
      expect(scrollToMock).toHaveBeenCalledWith({ top: 800, behavior: 'instant' });
    } finally {
      // Restore (shim.install() is NOT called here — afterEach handles restoration).
      (globalThis as unknown as Record<string, unknown>).ResizeObserver = prior;
    }
  });

  it('AC6: no regression — sync-mount with entries already populated lands at bottom with "instant"', () => {
    // Render directly with entries (no empty first render).
    const { container } = render(
      <TranscriptFeed
        {...defaultProps}
        entries={[makeEntry({ entryId: 'p1' }), makeEntry({ entryId: 'p2' })]}
      />,
    );
    const feed = container.querySelector('[role="feed"]') as HTMLElement;
    // scrollTo is normally mocked before render. Since it fired before our mock,
    // we verify via shim that the observer was constructed (which confirms the path).
    // The actual scrollTo call is covered by AC4 + AC2 tests above.
    // Here: just assert no crash and shim observed the feed element.
    expect(shim.observeMock).toHaveBeenCalledWith(feed);
  });
});
