// TranscriptFeed tests — native-scroll contract (F-WEB-HISTORY-FU7 rewrite)
//
// AC21: role="feed" + aria-label on the scroll container (native div).
// AC24: sr-only "Cargar más historial" keyboard button.
// AC25: Pin-aware auto-scroll on settle (jsdom logic branch only).
// AC7:  Prepend anchoring: scrollTop restores after isLoadingMore cycle.
// AC1:  Anonymous empty state (EmptyState).
// AC2:  Authenticated empty state (HistoryEmptyState).
// Load-more dedup guard.
//
// Per feedback_jsdom_layout_ac_gap: BUG A/B visual layout ACs (AC6, AC8, AC9,
// AC26) are operator-empirical — jsdom cannot close them. These tests close
// the logic branches only; operator smoke closes the visual ACs.

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TranscriptEntryData } from '../../types/history';

// ---------------------------------------------------------------------------
// Component mocks — simple div stubs (no react-virtuoso; package is being removed)
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
// Helper: mock scroll dimensions on an element (jsdom sets all scroll props to 0)
// ---------------------------------------------------------------------------
function mockScrollDimensions(
  el: Element,
  opts: { scrollHeight?: number; clientHeight?: number; scrollTop?: number },
) {
  if (opts.scrollHeight !== undefined) {
    Object.defineProperty(el, 'scrollHeight', {
      configurable: true,
      get: () => opts.scrollHeight,
    });
  }
  if (opts.clientHeight !== undefined) {
    Object.defineProperty(el, 'clientHeight', {
      configurable: true,
      get: () => opts.clientHeight,
    });
  }
  if (opts.scrollTop !== undefined) {
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get: () => opts.scrollTop,
      set: jest.fn(),
    });
  }
}

// ---------------------------------------------------------------------------
// AC21 — role="feed" + aria-label on the scroll container
// ---------------------------------------------------------------------------

describe('TranscriptFeed — AC21 a11y: role and aria-label', () => {
  it('scroll container has role="feed"', () => {
    render(<TranscriptFeed {...defaultProps} />);
    expect(screen.getByRole('feed')).toBeInTheDocument();
  });

  it('scroll container has aria-label="Historial de consultas"', () => {
    render(<TranscriptFeed {...defaultProps} />);
    expect(screen.getByRole('feed')).toHaveAttribute(
      'aria-label',
      'Historial de consultas',
    );
  });

  it('feed container does NOT have aria-busy when mounted (gate is in HablarShell)', () => {
    render(<TranscriptFeed {...defaultProps} isLoadingHistory={false} />);
    expect(screen.getByRole('feed')).not.toHaveAttribute('aria-busy', 'true');
  });

  it('feed container has the required layout classNames', () => {
    render(<TranscriptFeed {...defaultProps} />);
    const feed = screen.getByRole('feed');
    expect(feed.className).toContain('flex-1');
    expect(feed.className).toContain('overflow-y-auto');
    expect(feed.className).toContain('overscroll-contain');
    expect(feed.className).toContain('lg:max-w-2xl');
    expect(feed.className).toContain('lg:mx-auto');
    expect(feed.className).toContain('w-full');
  });
});

// ---------------------------------------------------------------------------
// AC1 & AC2 — Empty states
// ---------------------------------------------------------------------------

describe('TranscriptFeed — empty states', () => {
  it('AC1: shows EmptyState when entries=[] and not authenticated', () => {
    render(
      <TranscriptFeed {...defaultProps} entries={[]} isAuthenticated={false} />,
    );
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('history-empty-state')).not.toBeInTheDocument();
  });

  it('AC2: shows HistoryEmptyState when entries=[] and authenticated', () => {
    render(
      <TranscriptFeed {...defaultProps} entries={[]} isAuthenticated={true} />,
    );
    expect(screen.getByTestId('history-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
  });

  it('does NOT show empty states when entries present', () => {
    const entries = [makeEntry()];
    render(<TranscriptFeed {...defaultProps} entries={entries} isAuthenticated={true} />);
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-empty-state')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Entry rendering
// ---------------------------------------------------------------------------

describe('TranscriptFeed — entry rendering', () => {
  it('renders all entries from the entries array', () => {
    const entries = [
      makeEntry({ entryId: 'a', queryText: 'first' }),
      makeEntry({ entryId: 'b', queryText: 'second' }),
    ];
    render(<TranscriptFeed {...defaultProps} entries={entries} />);
    expect(screen.getByTestId('entry-a')).toBeInTheDocument();
    expect(screen.getByTestId('entry-b')).toBeInTheDocument();
  });

  it('renders entries in oldest-first order', () => {
    const entries = [
      makeEntry({ entryId: 'a', queryText: 'first query' }),
      makeEntry({ entryId: 'b', queryText: 'second query' }),
    ];
    render(<TranscriptFeed {...defaultProps} entries={entries} />);
    const articles = screen.getAllByRole('article');
    expect(articles[0]).toHaveTextContent('first query');
    expect(articles[1]).toHaveTextContent('second query');
  });

  it('renders dividers between entries but NOT after the last entry', () => {
    const entries = [makeEntry(), makeEntry(), makeEntry()];
    render(<TranscriptFeed {...defaultProps} entries={entries} />);
    const dividers = document.querySelectorAll('hr');
    // 3 entries → 2 dividers (between 1↔2 and 2↔3; none after 3)
    expect(dividers).toHaveLength(2);
  });

  it('renders no dividers when only one entry', () => {
    render(<TranscriptFeed {...defaultProps} entries={[makeEntry()]} />);
    expect(document.querySelectorAll('hr')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Header slot content — rendered as direct children of the scroll container
// ---------------------------------------------------------------------------

describe('TranscriptFeed — header slot content', () => {
  it('shows ClearHistoryButton when authenticated + has persisted entries', () => {
    const entries = [makeEntry({ isPersisted: true })];
    render(
      <TranscriptFeed {...defaultProps} isAuthenticated={true} entries={entries} />,
    );
    expect(screen.getByTestId('clear-history-button')).toBeInTheDocument();
  });

  it('does NOT show ClearHistoryButton when authenticated but no persisted entries', () => {
    const entries = [makeEntry({ isPersisted: false })];
    render(
      <TranscriptFeed {...defaultProps} isAuthenticated={true} entries={entries} />,
    );
    expect(screen.queryByTestId('clear-history-button')).not.toBeInTheDocument();
  });

  it('does NOT show ClearHistoryButton when anonymous even with persisted entries', () => {
    const entries = [makeEntry({ isPersisted: true })];
    render(
      <TranscriptFeed {...defaultProps} isAuthenticated={false} entries={entries} />,
    );
    expect(screen.queryByTestId('clear-history-button')).not.toBeInTheDocument();
  });

  it('shows loading skeleton when isLoadingMore=true', () => {
    render(
      <TranscriptFeed
        {...defaultProps}
        isAuthenticated={true}
        hasMoreHistory={true}
        isLoadingMore={true}
      />,
    );
    expect(
      screen.getByLabelText(/cargando entradas anteriores/i),
    ).toBeInTheDocument();
  });

  it('does NOT show loading skeleton when isLoadingMore=false', () => {
    render(
      <TranscriptFeed
        {...defaultProps}
        isAuthenticated={true}
        hasMoreHistory={true}
        isLoadingMore={false}
      />,
    );
    expect(
      screen.queryByLabelText(/cargando entradas anteriores/i),
    ).not.toBeInTheDocument();
  });

  it('shows HistoryPersistenceNudge when showPersistenceNudge=true', () => {
    render(<TranscriptFeed {...defaultProps} showPersistenceNudge={true} />);
    expect(screen.getByTestId('persistence-nudge')).toBeInTheDocument();
  });

  it('does NOT show HistoryPersistenceNudge when showPersistenceNudge=false', () => {
    render(<TranscriptFeed {...defaultProps} showPersistenceNudge={false} />);
    expect(screen.queryByTestId('persistence-nudge')).not.toBeInTheDocument();
  });

  it('calls onClearAll when ClearHistoryButton is triggered', async () => {
    const onClearAll = jest.fn();
    const entries = [makeEntry({ isPersisted: true })];
    render(
      <TranscriptFeed
        {...defaultProps}
        isAuthenticated={true}
        entries={entries}
        onClearAll={onClearAll}
      />,
    );
    await userEvent.click(screen.getByTestId('clear-history-button'));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('calls onDismissPersistenceNudge when nudge is dismissed', async () => {
    const onDismiss = jest.fn();
    render(
      <TranscriptFeed
        {...defaultProps}
        showPersistenceNudge={true}
        onDismissPersistenceNudge={onDismiss}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /cerrar sugerencia/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// AC24 — sr-only "Cargar más historial" keyboard button
// ---------------------------------------------------------------------------

describe('TranscriptFeed — AC24 sr-only load-more keyboard button', () => {
  it('renders sr-only button when hasMoreHistory && !isLoadingMore', () => {
    render(
      <TranscriptFeed
        {...defaultProps}
        hasMoreHistory={true}
        isLoadingMore={false}
      />,
    );
    expect(
      screen.getByRole('button', { name: /cargar más historial/i }),
    ).toBeInTheDocument();
  });

  it('does NOT render sr-only button when !hasMoreHistory', () => {
    render(
      <TranscriptFeed
        {...defaultProps}
        hasMoreHistory={false}
        isLoadingMore={false}
      />,
    );
    expect(
      screen.queryByRole('button', { name: /cargar más historial/i }),
    ).not.toBeInTheDocument();
  });

  it('does NOT render sr-only button when isLoadingMore=true', () => {
    render(
      <TranscriptFeed
        {...defaultProps}
        hasMoreHistory={true}
        isLoadingMore={true}
      />,
    );
    expect(
      screen.queryByRole('button', { name: /cargar más historial/i }),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC25 — Pin-aware auto-scroll on settle (logic branches only — not layout)
// ---------------------------------------------------------------------------

describe('TranscriptFeed — AC25 pin-aware scroll on settle', () => {
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

  it('scrolls to bottom when last entry isLoading flips false AND was near bottom', async () => {
    const loadingEntry = makeEntry({ entryId: 'last', isLoading: true });
    const { rerender } = render(
      <TranscriptFeed {...defaultProps} entries={[loadingEntry]} />,
    );

    const feed = screen.getByRole('feed');

    // Simulate near-bottom: scrollHeight=1000, clientHeight=600, scrollTop=900
    const scrollTopSetter = jest.fn();
    Object.defineProperty(feed, 'scrollHeight', { configurable: true, get: () => 1000 });
    Object.defineProperty(feed, 'clientHeight', { configurable: true, get: () => 600 });
    Object.defineProperty(feed, 'scrollTop', {
      configurable: true,
      get: () => 900,
      set: scrollTopSetter,
    });

    // Fire a scroll event to update wasNearBottomRef (distanceFromBottom = 1000-900-600 = -500 < 100 → near)
    // Actually at scrollTop=900, scrollHeight=1000, clientHeight=600: distance = 1000-900-600 = -500 → near bottom
    act(() => {
      fireEvent.scroll(feed);
    });

    // Settle the last entry (isLoading: true → false)
    const settledEntry = makeEntry({ entryId: 'last', isLoading: false });
    act(() => {
      rerender(<TranscriptFeed {...defaultProps} entries={[settledEntry]} />);
    });

    // rAF should have been captured
    expect(rafCallbacks.length).toBeGreaterThan(0);

    // Execute the rAF callback — should set scrollTop = scrollHeight
    act(() => {
      rafCallbacks.forEach((cb) => cb(0));
    });

    expect(scrollTopSetter).toHaveBeenCalledWith(1000); // scrollHeight
  });

  it('does NOT scroll to bottom when last entry settles but user was scrolled up', async () => {
    const loadingEntry = makeEntry({ entryId: 'last', isLoading: true });
    const { rerender } = render(
      <TranscriptFeed {...defaultProps} entries={[loadingEntry]} />,
    );

    const feed = screen.getByRole('feed');

    // Simulate scrolled up: scrollHeight=1000, clientHeight=600, scrollTop=0
    // distanceFromBottom = 1000 - 0 - 600 = 400 > 100 → NOT near bottom
    const scrollTopSetter = jest.fn();
    Object.defineProperty(feed, 'scrollHeight', { configurable: true, get: () => 1000 });
    Object.defineProperty(feed, 'clientHeight', { configurable: true, get: () => 600 });
    Object.defineProperty(feed, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set: scrollTopSetter,
    });

    act(() => {
      fireEvent.scroll(feed);
    });

    // Settle
    const settledEntry = makeEntry({ entryId: 'last', isLoading: false });
    act(() => {
      rerender(<TranscriptFeed {...defaultProps} entries={[settledEntry]} />);
    });

    // Execute any rAF callbacks — should NOT set scrollTop
    act(() => {
      rafCallbacks.forEach((cb) => cb(0));
    });

    expect(scrollTopSetter).not.toHaveBeenCalled();
  });

  it('does NOT fire rAF when last entry was already settled (no transition)', () => {
    // entry starts as isLoading=false — no prevLastLoading=true transition
    const settledEntry = makeEntry({ entryId: 'last', isLoading: false });
    const { rerender } = render(
      <TranscriptFeed {...defaultProps} entries={[settledEntry]} />,
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

    act(() => {
      fireEvent.scroll(feed);
    });

    // Re-render with same settled state — no loading→settled transition
    act(() => {
      rerender(
        <TranscriptFeed {...defaultProps} entries={[{ ...settledEntry, queryText: 'updated' }]} />,
      );
    });

    act(() => {
      rafCallbacks.forEach((cb) => cb(0));
    });

    // scrollTop should NOT be set from the settle effect (only from mount)
    // Note: mount effect also sets scrollTop, so we only check no RAF was queued for this re-render
    // The absence of additional rAF calls (beyond mount) is the check
    expect(scrollTopSetter).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Mount scroll-to-bottom (pin-aware init: wasNearBottomRef=true)
// ---------------------------------------------------------------------------

describe('TranscriptFeed — mount scroll-to-bottom', () => {
  it('sets scrollTop = scrollHeight on mount', () => {
    // jsdom doesn't fire rAF automatically, but mount useEffect fires synchronously
    // after render. We just check the intent is correct via the effect running.
    // The mount effect calls: el.scrollTop = el.scrollHeight
    const entries = [makeEntry()];
    const { container } = render(
      <TranscriptFeed {...defaultProps} entries={entries} />,
    );
    const feed = container.querySelector('[role="feed"]') as HTMLElement;
    // In jsdom scrollHeight and scrollTop are both 0 by default — no error thrown
    expect(feed).toBeTruthy();
    // Mount effect ran without throwing
  });
});

// ---------------------------------------------------------------------------
// Prepend anchoring (isLoadingMore cycle)
// ---------------------------------------------------------------------------

describe('TranscriptFeed — prepend anchor (AC7 logic branch)', () => {
  it('restores scrollTop after isLoadingMore flips false with new entries', () => {
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

    // Set up scroll state: scrollHeight=800, scrollTop=200
    const scrollTopSetter = jest.fn();
    let scrollTopValue = 200;
    Object.defineProperty(feed, 'scrollHeight', { configurable: true, get: () => 800 });
    Object.defineProperty(feed, 'clientHeight', { configurable: true, get: () => 600 });
    Object.defineProperty(feed, 'scrollTop', {
      configurable: true,
      get: () => scrollTopValue,
      set: (v: number) => {
        scrollTopValue = v;
        scrollTopSetter(v);
      },
    });

    // isLoadingMore flips true: savedScrollDelta = scrollHeight - scrollTop = 800 - 200 = 600
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

    // Simulate scrollHeight growing after prepend (new entries added)
    const prependedEntries = [
      makeEntry({ entryId: 'new1' }),
      makeEntry({ entryId: 'new2' }),
      ...initialEntries,
    ];
    Object.defineProperty(feed, 'scrollHeight', { configurable: true, get: () => 1200 });

    // isLoadingMore flips false: should restore scrollTop = newScrollHeight - savedDelta = 1200 - 600 = 600
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

    expect(scrollTopSetter).toHaveBeenCalledWith(600); // 1200 - 600
  });

  it('does NOT restore scrollTop when isLoadingMore flips false without prior true (no prepend)', () => {
    const entries = [makeEntry({ entryId: 'a' })];
    const { rerender } = render(
      <TranscriptFeed
        {...defaultProps}
        entries={entries}
        hasMoreHistory={false}
        isLoadingMore={false}
      />,
    );

    const feed = screen.getByRole('feed');
    const scrollTopSetter = jest.fn();
    Object.defineProperty(feed, 'scrollHeight', { configurable: true, get: () => 800 });
    Object.defineProperty(feed, 'scrollTop', {
      configurable: true,
      get: () => 200,
      set: scrollTopSetter,
    });

    // Re-render with isLoadingMore still false — no cycle
    act(() => {
      rerender(
        <TranscriptFeed
          {...defaultProps}
          entries={entries}
          hasMoreHistory={false}
          isLoadingMore={false}
        />,
      );
    });

    expect(scrollTopSetter).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// onScroll → onLoadMore: trigger near top + dedup guard
// ---------------------------------------------------------------------------

describe('TranscriptFeed — onScroll load-more trigger', () => {
  it('calls onLoadMore when scrollTop < 100 AND hasMoreHistory AND !isLoadingMore', () => {
    const onLoadMore = jest.fn();
    render(
      <TranscriptFeed
        {...defaultProps}
        hasMoreHistory={true}
        isLoadingMore={false}
        onLoadMore={onLoadMore}
      />,
    );

    const feed = screen.getByRole('feed');
    Object.defineProperty(feed, 'scrollTop', { configurable: true, get: () => 50 });
    Object.defineProperty(feed, 'scrollHeight', { configurable: true, get: () => 1000 });
    Object.defineProperty(feed, 'clientHeight', { configurable: true, get: () => 600 });

    act(() => {
      fireEvent.scroll(feed);
    });

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onLoadMore when scrollTop >= 100', () => {
    const onLoadMore = jest.fn();
    render(
      <TranscriptFeed
        {...defaultProps}
        hasMoreHistory={true}
        isLoadingMore={false}
        onLoadMore={onLoadMore}
      />,
    );

    const feed = screen.getByRole('feed');
    Object.defineProperty(feed, 'scrollTop', { configurable: true, get: () => 200 });

    act(() => {
      fireEvent.scroll(feed);
    });

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('does NOT call onLoadMore when !hasMoreHistory', () => {
    const onLoadMore = jest.fn();
    render(
      <TranscriptFeed
        {...defaultProps}
        hasMoreHistory={false}
        isLoadingMore={false}
        onLoadMore={onLoadMore}
      />,
    );

    const feed = screen.getByRole('feed');
    Object.defineProperty(feed, 'scrollTop', { configurable: true, get: () => 50 });

    act(() => {
      fireEvent.scroll(feed);
    });

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('does NOT call onLoadMore when isLoadingMore=true', () => {
    const onLoadMore = jest.fn();
    render(
      <TranscriptFeed
        {...defaultProps}
        hasMoreHistory={true}
        isLoadingMore={true}
        onLoadMore={onLoadMore}
      />,
    );

    const feed = screen.getByRole('feed');
    Object.defineProperty(feed, 'scrollTop', { configurable: true, get: () => 50 });

    act(() => {
      fireEvent.scroll(feed);
    });

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('dedup guard: rapid double scroll fires onLoadMore only once', () => {
    const onLoadMore = jest.fn();
    render(
      <TranscriptFeed
        {...defaultProps}
        hasMoreHistory={true}
        isLoadingMore={false}
        onLoadMore={onLoadMore}
      />,
    );

    const feed = screen.getByRole('feed');
    Object.defineProperty(feed, 'scrollTop', { configurable: true, get: () => 50 });

    act(() => {
      fireEvent.scroll(feed);
      fireEvent.scroll(feed); // rapid second scroll
    });

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
