// TranscriptFeed tests — AC32, AC34, AC37, AC45, AC46, AC47
// AC32: role="feed", aria-label="Historial de consultas", aria-busy.
// AC34: entries rendered in order with dividers.
// AC37: HistoryPersistenceNudge shown only when showPersistenceNudge=true.
// AC45: HistoryEmptyState for authenticated+empty, EmptyState for anonymous+empty.
// AC46: ClearHistoryButton visible when isAuthenticated && has persisted entries.
// AC47: auto-scroll fires when near bottom and new entries added.

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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

  // AC47: auto-scroll invoked when new entry is APPENDED and user is near bottom.
  // FU4: the first non-empty render fires the hydration path (behavior:'instant').
  // The APPEND path (behavior:'smooth') fires on subsequent length growths.
  // jsdom does not implement element.scrollTo — we mock it via Object.defineProperty.
  it('AC47: scrollTo is called when new entry is appended and user is near bottom', () => {
    // Render with 1 entry (fires hydration); install mocks; then append a 2nd entry.
    const entryA = makeEntry({ entryId: 'a' });
    const { rerender } = render(
      <TranscriptFeed {...defaultProps} entries={[entryA]} />
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

    // Fire scroll event to set wasNearBottomRef=true (400+500 >= 500-100=400 → true).
    feed.dispatchEvent(new Event('scroll', { bubbles: false }));
    scrollToMock.mockClear(); // clear hydration scroll

    // Append a second entry — triggers append path.
    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={[entryA, makeEntry({ entryId: 'new' })]}
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

  // FU4 AC11: overflow-anchor:none on scroll container (prevents JS vs native anchor race).
  // Verifying via inline style attribute string because jsdom does not compute
  // overflow-anchor as a recognized CSS property (non-standard in jsdom).
  it('AC11 (FU4): scroll container has overflow-anchor:none inline style', () => {
    render(<TranscriptFeed {...defaultProps} entries={[makeEntry()]} />);
    const feed = screen.getByRole('feed');
    expect(feed.style.overflowAnchor).toBe('none');
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

  it('AC10c: loadMore prepend — handleLoadMore captures pre-skeleton baseline; restores scrollTop correctly', async () => {
    // FU4 architecture: capture happens in handleLoadMore() callback (pre-skeleton),
    // NOT in useEffect[isLoadingMore]. The sentinel receives handleLoadMore transparently.
    //
    // Step 1: mount with 2 entries + sentinel visible; hydration fires; install mocks.
    const initialEntries = [makeEntry({ entryId: 'a' }), makeEntry({ entryId: 'b' })];
    const onLoadMore = jest.fn();
    const { rerender } = render(
      <TranscriptFeed
        {...defaultProps}
        entries={[]}
        isAuthenticated={true}
        hasMoreHistory={true}
        onLoadMore={onLoadMore}
      />
    );
    const feed = screen.getByRole('feed');
    const scrollToMock = installScrollMocks(feed, { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 });

    // FU2: fire scroll event with NOT-near-bottom values so hydration does NOT trigger append.
    feed.dispatchEvent(new Event('scroll', { bubbles: false }));
    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={initialEntries}
        isAuthenticated={true}
        hasMoreHistory={true}
        onLoadMore={onLoadMore}
      />
    );
    expect(scrollToMock).toHaveBeenCalledTimes(1); // hydration scroll only
    scrollToMock.mockClear();

    // Step 2: user scrolls up (well above the near-bottom 100px threshold).
    Object.defineProperty(feed, 'scrollTop', { value: 200, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollHeight', { value: 1000, writable: true, configurable: true });
    // Fire scroll event to update wasNearBottomRef: 200+500=700 < 1000-100=900 → false.
    feed.dispatchEvent(new Event('scroll', { bubbles: false }));

    // Step 3: FU4 — click the sentinel button BEFORE isLoadingMore=true.
    // This calls handleLoadMore() which captures scrollHeight=1000, scrollTop=200 synchronously.
    await userEvent.click(screen.getByText('Cargar más historial'));
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // Step 4: isLoadingMore flips to true (skeleton mounts; scrollHeight grows).
    Object.defineProperty(feed, 'scrollHeight', { value: 1248, writable: true, configurable: true });
    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={initialEntries}
        isAuthenticated={true}
        hasMoreHistory={true}
        isLoadingMore={true}
        onLoadMore={onLoadMore}
      />
    );

    // Step 5: entries arrive at front, isLoadingMore flips back to false.
    // delta = 1400 - 1000 = 400 (using ORIGINAL pre-skeleton scrollHeight as baseline).
    Object.defineProperty(feed, 'scrollHeight', { value: 1400, writable: true, configurable: true });
    const prependedEntries = [
      makeEntry({ entryId: 'older1', isPersisted: true }),
      makeEntry({ entryId: 'older2', isPersisted: true }),
      ...initialEntries,
    ];
    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={prependedEntries}
        isAuthenticated={true}
        hasMoreHistory={false}
        isLoadingMore={false}
        onLoadMore={onLoadMore}
      />
    );

    // Critical assertions:
    // (a) No smooth scroll (hydration ref-guarded; prepend path; wasNearBottom=false).
    expect(scrollToMock).not.toHaveBeenCalled();
    // (b) Effect C restored scrollTop: prevScrollTop(200) + delta(1400-1000=400) = 600.
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

  it('AC13b: bottom-lock observer (hydration path) disconnect is called on unmount (if still active)', () => {
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

  it('AC13c: bottom-lock observer (hydration path) timer-fired teardown — no double-disconnect on subsequent unmount', () => {
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

describe('TranscriptFeed — Step 3: bottom-lock observer (hydration and append)', () => {
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

  it('hydration guard: observer survives intermediate entries.length changes within the 500ms window', () => {
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

// ---------------------------------------------------------------------------
// FU4 — AC7/AC8: handleLoadMore pre-skeleton capture
// ---------------------------------------------------------------------------

describe('TranscriptFeed — FU4 AC7/AC8: handleLoadMore pre-skeleton capture', () => {
  function installScrollMocksLocal(
    feed: HTMLElement,
    opts: { scrollTop?: number; clientHeight?: number; scrollHeight?: number } = {},
  ) {
    let _scrollHeight = opts.scrollHeight ?? 1000;
    const scrollToMock = jest.fn();
    Object.defineProperty(feed, 'scrollTo', { value: scrollToMock, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollTop', { value: opts.scrollTop ?? 0, writable: true, configurable: true });
    Object.defineProperty(feed, 'clientHeight', { value: opts.clientHeight ?? 500, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollHeight', { get: () => _scrollHeight, configurable: true });
    return {
      scrollToMock,
      setScrollHeight: (v: number) => { _scrollHeight = v; },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('AC7: sentinel receives handleLoadMore wrapper; clicking it calls onLoadMore prop', async () => {
    const onLoadMore = jest.fn();
    const { rerender } = render(
      <TranscriptFeed
        {...defaultProps}
        entries={[makeEntry({ entryId: 'a' })]}
        isAuthenticated={true}
        hasMoreHistory={true}
        onLoadMore={onLoadMore}
      />
    );
    const feed = screen.getByRole('feed');
    installScrollMocksLocal(feed, { scrollTop: 200, scrollHeight: 1000, clientHeight: 500 });
    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={[makeEntry({ entryId: 'a' }), makeEntry({ entryId: 'b' })]}
        isAuthenticated={true}
        hasMoreHistory={true}
        onLoadMore={onLoadMore}
      />
    );

    // Click the sentinel button (which calls handleLoadMore → onLoadMore).
    await userEvent.click(screen.getByText('Cargar más historial'));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('AC8: capture fires synchronously before isLoadingMore commit — prevScrollHeight captured BEFORE skeleton scrollHeight', async () => {
    // This test verifies Effect C uses the pre-skeleton baseline (1000), not the
    // polluted skeleton height (1248). The proof: final scrollTop = 200 + (1400 - 1000) = 1400.
    // If the OLD behavior (capture after skeleton) were active, it would use 1248,
    // giving: 200 + (1400 - 1248) = 352. Only pre-skeleton capture gives 600.
    const onLoadMore = jest.fn();
    const initialEntries = [makeEntry({ entryId: 'a' }), makeEntry({ entryId: 'b' })];
    const { rerender } = render(
      <TranscriptFeed
        {...defaultProps}
        entries={[]}
        isAuthenticated={true}
        hasMoreHistory={true}
        onLoadMore={onLoadMore}
      />
    );
    const feed = screen.getByRole('feed');
    const { scrollToMock, setScrollHeight } = installScrollMocksLocal(feed, { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 });

    // Hydrate (wasNearBottom=false to avoid append scroll).
    feed.dispatchEvent(new Event('scroll', { bubbles: false }));
    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={initialEntries}
        isAuthenticated={true}
        hasMoreHistory={true}
        onLoadMore={onLoadMore}
      />
    );
    scrollToMock.mockClear();

    // Set scrollTop=200 for prepend math.
    Object.defineProperty(feed, 'scrollTop', { value: 200, writable: true, configurable: true });
    feed.dispatchEvent(new Event('scroll', { bubbles: false })); // wasNearBottom=false (200+500=700 < 1000-100)

    // Click sentinel — handleLoadMore captures scrollHeight=1000, scrollTop=200 SYNCHRONOUSLY.
    await userEvent.click(screen.getByText('Cargar más historial'));

    // Skeleton mounts (skeleton ~248px added).
    setScrollHeight(1248);
    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={initialEntries}
        isAuthenticated={true}
        hasMoreHistory={true}
        isLoadingMore={true}
        onLoadMore={onLoadMore}
      />
    );

    // Entries arrive at front; skeletons removed; scrollHeight = 1400.
    setScrollHeight(1400);
    const prependedEntries = [
      makeEntry({ entryId: 'older1', isPersisted: true }),
      makeEntry({ entryId: 'older2', isPersisted: true }),
      ...initialEntries,
    ];
    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={prependedEntries}
        isAuthenticated={true}
        hasMoreHistory={false}
        isLoadingMore={false}
        onLoadMore={onLoadMore}
      />
    );

    // Effect C: delta = 1400 - 1000 = 400 (pre-skeleton baseline).
    // scrollTop = 200 + 400 = 600.
    expect(feed.scrollTop).toBe(600);
    // No smooth scroll (wasNearBottom=false throughout).
    expect(scrollToMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// FU4 — AC3/AC4/AC5/AC6: append bottom-lock ResizeObserver
// ---------------------------------------------------------------------------

describe('TranscriptFeed — FU4 AC3/AC4/AC5/AC6: append bottom-lock observer', () => {
  const shim = createResizeObserverShim();

  function installScrollMocksLocal(
    feed: HTMLElement,
    opts: { scrollTop?: number; clientHeight?: number; scrollHeight?: number } = {},
  ) {
    let _scrollHeight = opts.scrollHeight ?? 500;
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

  beforeEach(() => {
    shim.install();
    shim.disconnectMock.mockClear();
    shim.observeMock.mockClear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    shim.uninstall();
    jest.useRealTimers();
  });

  it('AC3 (FU4): shimmer→card race — ResizeObserver fires AFTER initial smooth scroll, last scrollTo targets post-growth scrollHeight', () => {
    jest.useFakeTimers();
    const entryA = makeEntry({ entryId: 'a' });
    const entryB = makeEntry({ entryId: 'b' });

    // Render with 1 entry to trigger hydration; set up mocks.
    const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[entryA]} />);
    const feed = screen.getByRole('feed');
    const { scrollToMock, setScrollHeight } = installScrollMocksLocal(feed, { scrollTop: 400, scrollHeight: 500, clientHeight: 500 });

    // Set wasNearBottomRef=true via scroll event (400+500 >= 500-100=400 → true).
    feed.dispatchEvent(new Event('scroll', { bubbles: true }));
    shim.disconnectMock.mockClear();
    shim.observeMock.mockClear();
    scrollToMock.mockClear(); // clear hydration scroll

    // Append entry B — Effect B fires smooth scroll (shimmer height = 500).
    rerender(<TranscriptFeed {...defaultProps} entries={[entryA, entryB]} />);
    expect(scrollToMock).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));

    // Simulate card growth (shimmer→card: scrollHeight grows from 500 to 700).
    setScrollHeight(700);

    // ResizeObserver fires (simulates layout settle after card renders).
    shim.fire([{ target: feed } as unknown as ResizeObserverEntry]);

    // Assert: scrollToMock called ≥2 times AND last call targets grown height with 'instant'.
    expect(scrollToMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    const lastCall = scrollToMock.mock.calls[scrollToMock.mock.calls.length - 1]?.[0] as {
      top: number;
      behavior: string;
    };
    expect(lastCall).toEqual({ top: 700, behavior: 'instant' });
  });

  it('AC4 (FU4): wasNearBottomRef=false at append time — no smooth scroll, no bottom-lock observer', () => {
    const entryA = makeEntry({ entryId: 'a' });
    const entryB = makeEntry({ entryId: 'b' });

    const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[entryA]} />);
    const feed = screen.getByRole('feed');
    installScrollMocksLocal(feed, { scrollTop: 0, scrollHeight: 2000, clientHeight: 500 });

    // wasNearBottomRef=false: 0+500 < 2000-100=1900 → false.
    feed.dispatchEvent(new Event('scroll', { bubbles: false }));
    shim.observeMock.mockClear(); // clear hydration observe call

    // Append entry B — wasNearBottom=false → no smooth scroll, no observer.
    rerender(<TranscriptFeed {...defaultProps} entries={[entryA, entryB]} />);

    // observeMock should NOT have been called again (no new append observer).
    expect(shim.observeMock).not.toHaveBeenCalled();
  });

  it('AC5 (FU4): user scrolls UP during bottom-lock window — observer disconnects early', () => {
    jest.useFakeTimers();
    const entryA = makeEntry({ entryId: 'a' });
    const entryB = makeEntry({ entryId: 'b' });

    // Use scrollHeight=2000 so scrollTop=0 is genuinely "not near bottom"
    // (0+500 < 2000-100=1900 → false).
    const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[entryA]} />);
    const feed = screen.getByRole('feed');
    installScrollMocksLocal(feed, { scrollTop: 1400, scrollHeight: 2000, clientHeight: 500 });

    // wasNearBottomRef=true: 1400+500=1900 >= 2000-100=1900 → true.
    feed.dispatchEvent(new Event('scroll', { bubbles: true }));

    // Advance past the HYDRATION window (500ms) so the hydration bottom-lock expires
    // and mode resets to 'idle'. This ensures the subsequent append creates a NEW observer.
    jest.advanceTimersByTime(501);
    shim.disconnectMock.mockClear();
    shim.observeMock.mockClear();

    // Append → wasNearBottom=true → NEW bottom-lock observer installed.
    rerender(<TranscriptFeed {...defaultProps} entries={[entryA, entryB]} />);
    expect(shim.observeMock).toHaveBeenCalled();

    // User scrolls up → wasNearBottomRef=false: 0+500=500 < 2000-100=1900 → false.
    Object.defineProperty(feed, 'scrollTop', { value: 0, writable: true, configurable: true });
    feed.dispatchEvent(new Event('scroll', { bubbles: false }));

    // ResizeObserver fires — observer callback detects wasNearBottom=false → disconnects early.
    shim.fire([{ target: feed } as unknown as ResizeObserverEntry]);

    expect(shim.disconnectMock).toHaveBeenCalledTimes(1);
  });

  it('AC6 (FU4): timer deadline reached (1501ms) — observer disconnects, no further scrollTo', () => {
    jest.useFakeTimers();
    const entryA = makeEntry({ entryId: 'a' });
    const entryB = makeEntry({ entryId: 'b' });

    const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[entryA]} />);
    const feed = screen.getByRole('feed');
    const { scrollToMock } = installScrollMocksLocal(feed, { scrollTop: 400, scrollHeight: 500, clientHeight: 500 });

    // wasNearBottomRef=true.
    feed.dispatchEvent(new Event('scroll', { bubbles: true }));
    shim.disconnectMock.mockClear();

    // Append → bottom-lock observer active.
    rerender(<TranscriptFeed {...defaultProps} entries={[entryA, entryB]} />);
    scrollToMock.mockClear();

    // Advance past the 1500ms append window.
    jest.advanceTimersByTime(1501);
    expect(shim.disconnectMock).toHaveBeenCalledTimes(1);

    // After disconnect, no further scrollTo from subsequent resize events.
    shim.fire([{ target: feed } as unknown as ResizeObserverEntry]);
    expect(scrollToMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// FU4 — AC12/AC13/AC14b/AC14c: append vs prepend detection
// ---------------------------------------------------------------------------

describe('TranscriptFeed — FU4 AC12/AC13/AC14b/AC14c: append vs prepend detection', () => {
  const shim = createResizeObserverShim();

  function installScrollMocksLocal(
    feed: HTMLElement,
    opts: { scrollTop?: number; clientHeight?: number; scrollHeight?: number } = {},
  ) {
    const scrollToMock = jest.fn();
    Object.defineProperty(feed, 'scrollTo', { value: scrollToMock, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollTop', { value: opts.scrollTop ?? 400, writable: true, configurable: true });
    Object.defineProperty(feed, 'clientHeight', { value: opts.clientHeight ?? 500, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollHeight', { value: opts.scrollHeight ?? 1000, writable: true, configurable: true });
    return scrollToMock;
  }

  beforeEach(() => {
    shim.install();
    shim.disconnectMock.mockClear();
    shim.observeMock.mockClear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    shim.uninstall();
    jest.useRealTimers();
  });

  it('AC12 (FU4): prepend (first entryId changes, last stable) does NOT trigger bottom-lock append path', () => {
    // Note: no fake timers here — userEvent.click conflicts with jest.useFakeTimers.
    // We test the prepend detection by directly simulating the prepend commit without
    // going through the handleLoadMore click, since the key assertion is about Effect B routing.
    const entryB = makeEntry({ entryId: 'b' });
    const entryC = makeEntry({ entryId: 'c' });
    const entryA = makeEntry({ entryId: 'a' }); // will prepend as older

    const { rerender } = render(
      <TranscriptFeed
        {...defaultProps}
        entries={[]}
        isAuthenticated={true}
        hasMoreHistory={true}
      />
    );
    const feed = screen.getByRole('feed');
    const scrollToMock = installScrollMocksLocal(feed, { scrollTop: 200, scrollHeight: 1000, clientHeight: 500 });

    // Hydrate with [b, c].
    rerender(<TranscriptFeed {...defaultProps} entries={[entryB, entryC]} isAuthenticated={true} hasMoreHistory={true} />);
    scrollToMock.mockClear();
    shim.observeMock.mockClear();
    shim.disconnectMock.mockClear();

    // Simulate the prepend commit directly: first entryId changes (a prepends), last stays c.
    // We don't need to click sentinel — we're testing Effect B's routing logic.
    // Use fireEvent.click so we don't need fake timers.
    fireEvent.click(screen.getByText('Cargar más historial'));

    Object.defineProperty(feed, 'scrollHeight', { value: 1600, writable: true, configurable: true });
    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={[entryA, entryB, entryC]}
        isAuthenticated={true}
        hasMoreHistory={false}
        isLoadingMore={false}
      />
    );

    // Effect B: pure prepend (first changed, last stable) → no smooth scroll, no append observer.
    // The hydration bottom-lock is still active (we didn't advance timers), but the prepend
    // routing check fires BEFORE the append check, so it returns early regardless.
    expect(scrollToMock).not.toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    // No NEW append-path observe call (the prepend branch returned early before startBottomLock).
    // Any observe calls visible are from the still-active hydration window (same instance, not new).
    expect(shim.observeMock).not.toHaveBeenCalled();
  });

  it('AC13 (FU4): both first AND last entryId changed (clear-all then new search) routes through append path, NOT re-hydration', () => {
    // Real timers — fake timers + act() can cause microtask flushing issues.
    // We test the routing by asserting scrollTo('smooth') fires (append path evidence)
    // and no second hydration observer is installed (observeMock count).
    const entryA = makeEntry({ entryId: 'a' });
    const entryB = makeEntry({ entryId: 'b' });
    const entryX = makeEntry({ entryId: 'x' }); // new after clear

    const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[]} />);
    const feed = screen.getByRole('feed');
    const scrollToMock = installScrollMocksLocal(feed, { scrollTop: 400, scrollHeight: 1000, clientHeight: 500 });

    // First hydration: [a, b]. Hydration path fires (behavior:'instant').
    rerender(<TranscriptFeed {...defaultProps} entries={[entryA, entryB]} />);
    const observeCountAfterHydration = shim.observeMock.mock.calls.length;
    expect(observeCountAfterHydration).toBeGreaterThanOrEqual(1); // hydration observer installed
    scrollToMock.mockClear();
    shim.observeMock.mockClear(); // reset to 0 after hydration

    // Clear-all: entries=[].
    rerender(<TranscriptFeed {...defaultProps} entries={[]} />);

    // User near bottom (wasNearBottom=true default; re-confirm).
    feed.dispatchEvent(new Event('scroll', { bubbles: true })); // 400+500 >= 1000-100 → true

    // New search: entries=[x]. Both first AND last entryId changed vs [a,b].
    rerender(<TranscriptFeed {...defaultProps} entries={[entryX]} />);

    // ASSERT: the append path fired (smooth scroll) — this is definitive proof.
    // The hydration path uses 'instant'; the append path uses 'smooth'.
    // hasScrolledToBottomOnHydrationRef.current stayed true → hydration branch skipped.
    expect(scrollToMock).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    // Note: observeMock may or may not be called here depending on whether the hydration
    // bottom-lock timer has expired (real timers, sub-500ms test execution).
    // The definitive assertion is the 'smooth' scroll above. The observer call is a bonus.
  });

  it('AC14b (FU4): append during active prepending mode — scrollLockRef stays prepending, append scroll skipped', async () => {
    const entryA = makeEntry({ entryId: 'a' });
    const entryB = makeEntry({ entryId: 'b' });
    const entryC = makeEntry({ entryId: 'c' }); // new append during loadMore

    const { rerender } = render(
      <TranscriptFeed
        {...defaultProps}
        entries={[entryA]}
        isAuthenticated={true}
        hasMoreHistory={true}
      />
    );
    const feed = screen.getByRole('feed');
    const scrollToMock = installScrollMocksLocal(feed, { scrollTop: 200, scrollHeight: 1000, clientHeight: 500 });

    // Hydrate with [a]. User near bottom.
    feed.dispatchEvent(new Event('scroll', { bubbles: true })); // 400+500 >= 1000-100 → true (using default scrollTop=400)
    scrollToMock.mockClear();
    shim.observeMock.mockClear();
    shim.disconnectMock.mockClear();

    // Click sentinel → handleLoadMore sets mode='prepending'.
    await userEvent.click(screen.getByText('Cargar más historial'));

    // While prepending is in flight, a session append arrives (last entryId changed).
    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={[entryA, entryB, entryC]}
        isAuthenticated={true}
        hasMoreHistory={true}
        isLoadingMore={true}
      />
    );

    // AC14b: Effect B sees mode='prepending' → early-return; no append bottom-lock.
    // No smooth scroll fired; no new observer for append.
    expect(scrollToMock).not.toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    expect(shim.observeMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// FU4 — AC9/AC10: Effect C prepend restore (race-aware 2-commit flow)
// ---------------------------------------------------------------------------

describe('TranscriptFeed — FU4 AC9/AC10: Effect C prepend restore', () => {
  function installScrollMocksLocal(
    feed: HTMLElement,
    opts: { scrollTop?: number; clientHeight?: number; scrollHeight?: number } = {},
  ) {
    let _scrollHeight = opts.scrollHeight ?? 1000;
    const scrollToMock = jest.fn();
    Object.defineProperty(feed, 'scrollTo', { value: scrollToMock, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollTop', { value: opts.scrollTop ?? 0, writable: true, configurable: true });
    Object.defineProperty(feed, 'clientHeight', { value: opts.clientHeight ?? 500, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollHeight', { get: () => _scrollHeight, configurable: true });
    return {
      scrollToMock,
      setScrollHeight: (v: number) => { _scrollHeight = v; },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('AC9 (FU4): 2-commit loadMore flow — Effect C reads pre-skeleton baseline, restores scrollTop correctly', async () => {
    const onLoadMore = jest.fn();
    const entryA = makeEntry({ entryId: 'a' });
    const entryB = makeEntry({ entryId: 'b' });
    const initialEntries = [entryA, entryB];

    const { rerender } = render(
      <TranscriptFeed
        {...defaultProps}
        entries={[]}
        isAuthenticated={true}
        hasMoreHistory={true}
        onLoadMore={onLoadMore}
      />
    );
    const feed = screen.getByRole('feed');
    const { scrollToMock, setScrollHeight } = installScrollMocksLocal(feed, {
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 500,
    });

    // Hydrate (wasNearBottom=false to prevent append smooth).
    feed.dispatchEvent(new Event('scroll', { bubbles: false }));
    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={initialEntries}
        isAuthenticated={true}
        hasMoreHistory={true}
        onLoadMore={onLoadMore}
      />
    );
    scrollToMock.mockClear();

    // Set scrollTop=200 for prepend math (NOT near bottom: 200+500=700 < 1000-100=900).
    Object.defineProperty(feed, 'scrollTop', { value: 200, writable: true, configurable: true });
    feed.dispatchEvent(new Event('scroll', { bubbles: false }));

    // Commit 0: handleLoadMore captures scrollHeight=1000, scrollTop=200 SYNCHRONOUSLY.
    await userEvent.click(screen.getByText('Cargar más historial'));

    // Commit 1 (2-commit pattern): skeleton mounts, scrollHeight grows to 1248.
    setScrollHeight(1248);
    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={initialEntries}
        isAuthenticated={true}
        hasMoreHistory={true}
        isLoadingMore={true}
        onLoadMore={onLoadMore}
      />
    );
    // Effect C: isLoadingMore=true → early return. No scrollTop change yet.
    expect(feed.scrollTop).toBe(200); // unchanged

    // Commit 2: entries prepended, skeleton removed, isLoadingMore=false.
    setScrollHeight(2200); // = 1000 + 2 * ~600 (2 older entries)
    const prependedEntries = [
      makeEntry({ entryId: 'older1', isPersisted: true }),
      makeEntry({ entryId: 'older2', isPersisted: true }),
      ...initialEntries,
    ];
    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={prependedEntries}
        isAuthenticated={true}
        hasMoreHistory={false}
        isLoadingMore={false}
        onLoadMore={onLoadMore}
      />
    );

    // Effect C fired: delta = 2200 - 1000 = 1200 (pre-skeleton baseline).
    // scrollTop = 200 + 1200 = 1400.
    expect(feed.scrollTop).toBe(1400);
    // No scrollTo() call (Effect C writes scrollTop directly).
    expect(scrollToMock).not.toHaveBeenCalled();
  });

  it('AC10 (FU4): Effect C early-returns when mode=idle (no isLoadingMore transition without prior handleLoadMore)', () => {
    // Render → isLoadingMore=false (already idle mode since no handleLoadMore call).
    // Effect C sees mode=idle → early return → scrollTop unchanged.
    const { rerender } = render(
      <TranscriptFeed {...defaultProps} entries={[makeEntry({ entryId: 'a' })]} />
    );
    const feed = screen.getByRole('feed');
    Object.defineProperty(feed, 'scrollTop', { value: 500, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollHeight', { value: 1000, writable: true, configurable: true });
    Object.defineProperty(feed, 'clientHeight', { value: 500, writable: true, configurable: true });

    // Toggle isLoadingMore true→false without calling handleLoadMore.
    rerender(<TranscriptFeed {...defaultProps} entries={[makeEntry({ entryId: 'a' })]} isLoadingMore={true} />);
    rerender(<TranscriptFeed {...defaultProps} entries={[makeEntry({ entryId: 'a' })]} isLoadingMore={false} />);

    // scrollTop must be unchanged (Effect C saw mode=idle → skipped).
    expect(feed.scrollTop).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// FU4 — AC15: unmount cleanup handles all three modes
// ---------------------------------------------------------------------------

describe('TranscriptFeed — FU4 AC15: unmount cleanup (all three modes)', () => {
  const shim = createResizeObserverShim();

  function installScrollMocksLocal(
    feed: HTMLElement,
    opts: { scrollTop?: number; clientHeight?: number; scrollHeight?: number } = {},
  ) {
    const scrollToMock = jest.fn();
    Object.defineProperty(feed, 'scrollTo', { value: scrollToMock, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollTop', { value: opts.scrollTop ?? 400, writable: true, configurable: true });
    Object.defineProperty(feed, 'clientHeight', { value: opts.clientHeight ?? 500, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollHeight', { value: opts.scrollHeight ?? 1000, writable: true, configurable: true });
    return scrollToMock;
  }

  beforeEach(() => {
    shim.install();
    shim.disconnectMock.mockClear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    shim.uninstall();
    jest.useRealTimers();
  });

  it('AC15a (FU4): unmount when mode=bottom-lock — observer disconnects, no throw', () => {
    jest.useFakeTimers();
    const entryA = makeEntry({ entryId: 'a' });
    const entryB = makeEntry({ entryId: 'b' });

    const { rerender, unmount } = render(<TranscriptFeed {...defaultProps} entries={[entryA]} />);
    const feed = screen.getByRole('feed');
    installScrollMocksLocal(feed, { scrollTop: 400, scrollHeight: 500, clientHeight: 500 });

    // wasNearBottomRef=true; append → bottom-lock observer active.
    feed.dispatchEvent(new Event('scroll', { bubbles: true }));
    rerender(<TranscriptFeed {...defaultProps} entries={[entryA, entryB]} />);
    shim.disconnectMock.mockClear();

    // Unmount before timer fires.
    expect(() => unmount()).not.toThrow();
    expect(shim.disconnectMock).toHaveBeenCalledTimes(1);
  });

  it('AC15b (FU4): unmount when mode=prepending — no throw, no spurious DOM write', async () => {
    const onLoadMore = jest.fn();
    const entryA = makeEntry({ entryId: 'a' });

    const { unmount } = render(
      <TranscriptFeed
        {...defaultProps}
        entries={[entryA]}
        isAuthenticated={true}
        hasMoreHistory={true}
        onLoadMore={onLoadMore}
      />
    );
    const feed = screen.getByRole('feed');
    installScrollMocksLocal(feed, { scrollTop: 200, scrollHeight: 1000, clientHeight: 500 });
    feed.dispatchEvent(new Event('scroll', { bubbles: false }));

    // Trigger handleLoadMore → mode=prepending.
    await userEvent.click(screen.getByText('Cargar más historial'));

    // Unmount while prepending — should not throw.
    expect(() => unmount()).not.toThrow();
  });

  it('AC15c (FU4): unmount when mode=idle — no throw (baseline regression)', () => {
    const { unmount } = render(<TranscriptFeed {...defaultProps} entries={[]} />);
    expect(() => unmount()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// FU4 — AC17b: Strict Mode — bottom-lock re-installed after synthetic cleanup
// ---------------------------------------------------------------------------

describe('TranscriptFeed — FU4 AC17b: Strict Mode synthetic mount→cleanup→mount', () => {
  const shim = createResizeObserverShim();

  function installScrollMocksLocal(feed: HTMLElement) {
    const scrollToMock = jest.fn();
    Object.defineProperty(feed, 'scrollTo', { value: scrollToMock, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollTop', { value: 0, writable: true, configurable: true });
    Object.defineProperty(feed, 'clientHeight', { value: 500, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollHeight', { value: 1000, writable: true, configurable: true });
    return scrollToMock;
  }

  beforeEach(() => {
    shim.install();
    shim.disconnectMock.mockClear();
    shim.observeMock.mockClear();
  });

  afterEach(() => {
    shim.uninstall();
  });

  it('AC17b (FU4): React.StrictMode synthetic remount correctly re-installs bottom-lock observer — DISCRIMINATING ≥2 observe calls', () => {
    // React 18 StrictMode calls mount→cleanup→mount in development.
    // Effect D cleanup resets hasScrolledToBottomOnHydrationRef=false so the
    // synthetic remount re-fires the hydration branch (not the append branch).
    //
    // DISCRIMINATING ASSERTION (per /review-spec code-review MAJOR fix-loop 2026-06-03):
    // If a future regressor removes the `hasScrolledToBottomOnHydrationRef.current=false`
    // reset in Effect D cleanup, Mount 2's hydration branch would early-return on the
    // still-true guard → only ONE observer would be installed across the whole cycle.
    // We assert observeMock >= 2 (mount #1 observer + remount #2 observer) to catch
    // this exact regression. Without this discrimination, `observeMock toHaveBeenCalled()`
    // (≥1) passes even on the buggy implementation since mount #1 always fires.

    const entryA = makeEntry({ entryId: 'a' });
    const { unmount } = render(
      <React.StrictMode>
        <TranscriptFeed {...defaultProps} entries={[entryA]} />
      </React.StrictMode>
    );
    const feed = document.querySelector('[role="feed"]') as HTMLElement;
    installScrollMocksLocal(feed);

    // Discriminating assertion: BOTH mount and remount installed an observer (≥2 calls).
    expect(shim.observeMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    // First observer was disconnected when synthetic cleanup ran.
    // (The remount's observer remains active until either timer fires or real unmount.)
    expect(shim.disconnectMock.mock.calls.length).toBeGreaterThanOrEqual(1);

    unmount();
  });
});
