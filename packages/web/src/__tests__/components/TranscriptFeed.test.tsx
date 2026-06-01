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

    expect(scrollToMock).toHaveBeenCalledWith({ top: 1500, behavior: 'smooth' });
  });

  it('AC10b: scrolls to bottom on async hydration ([] → [persisted×N])', async () => {
    // The real reload path: useSearchHistory loads asynchronously, so entries
    // is [] on first render and grows to N≥1 on a later rerender — even when the
    // user is NOT near the bottom (scrollTop=0). The new hydration effect must
    // bypass the existing isNearBottom guard.
    const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[]} />);
    const feed = screen.getByRole('feed');
    const scrollToMock = installScrollMocks(feed, { scrollTop: 0, scrollHeight: 2000, clientHeight: 500 });

    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={[
          makeEntry({ entryId: 'p1', isPersisted: true }),
          makeEntry({ entryId: 'p2', isPersisted: true }),
        ]}
      />
    );

    expect(scrollToMock).toHaveBeenCalledWith({ top: 2000, behavior: 'smooth' });
    // Fires exactly once (the next assertion in AC10c verifies it doesn't re-fire).
    expect(scrollToMock).toHaveBeenCalledTimes(1);
  });

  it('AC10c: loadMore prepend (isLoadingMore false→true→false + entries grow) does NOT scroll to bottom, AND restores scrollTop', () => {
    // Step 1: mount with 2 entries; hydration effect fires once, ref becomes true.
    const initialEntries = [makeEntry({ entryId: 'a' }), makeEntry({ entryId: 'b' })];
    const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[]} />);
    const feed = screen.getByRole('feed');
    const scrollToMock = installScrollMocks(feed, { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 });
    rerender(<TranscriptFeed {...defaultProps} entries={initialEntries} />);
    expect(scrollToMock).toHaveBeenCalledTimes(1); // hydration scroll
    scrollToMock.mockClear();

    // Step 2: user scrolls up (well above the near-bottom 100px threshold).
    Object.defineProperty(feed, 'scrollTop', { value: 200, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollHeight', { value: 1000, writable: true, configurable: true });

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
    rerender(<TranscriptFeed {...defaultProps} entries={initialEntries} />);
    // Hydration fired once.
    expect(scrollToMock).toHaveBeenCalledTimes(1);
    scrollToMock.mockClear();

    // User scrolls up well above the threshold.
    Object.defineProperty(feed, 'scrollTop', { value: 0, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollHeight', { value: 2000, writable: true, configurable: true });
    Object.defineProperty(feed, 'clientHeight', { value: 500, writable: true, configurable: true });

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

  it('AC13: programmatic scroll-to-bottom calls use behavior:"smooth"', () => {
    const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[]} />);
    const feed = screen.getByRole('feed');
    const scrollToMock = installScrollMocks(feed, { scrollTop: 0, scrollHeight: 1200, clientHeight: 500 });
    rerender(
      <TranscriptFeed
        {...defaultProps}
        entries={[makeEntry({ entryId: 'a' }), makeEntry({ entryId: 'b' })]}
      />
    );
    expect(scrollToMock).toHaveBeenCalled();
    const lastCallArg = scrollToMock.mock.calls[scrollToMock.mock.calls.length - 1]?.[0] as { behavior?: string };
    expect(lastCallArg?.behavior).toBe('smooth');
  });
});
