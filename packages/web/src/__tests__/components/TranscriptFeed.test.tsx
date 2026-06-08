// TranscriptFeed tests — AC3, AC8, AC10, AC11, AC15
// (FU6 Virtuoso rewrite — replaces FU4 scroll machinery tests)
//
// AC3 (rewrite architecture): Virtuoso prop wiring — data, computeItemKey, followOutput,
//   startReached, initialTopMostItemIndex.
// AC8 (a11y): role="feed" + aria-label post-mount; aria-busy NOT on Virtuoso root;
//   sr-only "Cargar más historial" button present when hasMoreHistory && !isLoadingMore.
// AC10 (existing UX preserved): Header slot composition — ClearHistoryButton when
//   authenticated+hasPersisted; loading skeleton when isLoadingMore;
//   HistoryEmptyState when authenticated+empty+!hasMoreHistory.
// AC11 (unit tests): startReached deduplication guard.
// AC15 (computeItemKey): returns entryId.
//
// Test strategy (per plan §Notes "Test strategy for Virtuoso in jsdom"):
// Option 2 — mock react-virtuoso at the module boundary. The mock renders all items
// via itemContent + components.Header/Footer, exposing props for assertion.
// This avoids jsdom layout constraints. Operator ACs (AC5/AC6/AC7) are deferred
// per feedback_jsdom_layout_ac_gap.

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TranscriptEntryData } from '../../types/history';

// ---------------------------------------------------------------------------
// Virtuoso mock — captures props for assertion; renders items synchronously
// ---------------------------------------------------------------------------

let capturedVirtuosoProps: Record<string, unknown> | null = null;

jest.mock('react-virtuoso', () => ({
  // eslint-disable-next-line react/display-name
  Virtuoso: React.forwardRef((props: Record<string, unknown>, _ref: unknown) => {
    capturedVirtuosoProps = props;
    const data = props['data'] as TranscriptEntryData[] | undefined;
    const itemContent = props['itemContent'] as
      | ((idx: number, item: TranscriptEntryData) => React.ReactNode)
      | undefined;
    const components = props['components'] as
      | {
          Header?: React.ComponentType<{ context?: unknown }>;
          Footer?: React.ComponentType<{ context?: unknown }>;
        }
      | undefined;
    const context = props['context'];
    const HeaderComp = components?.Header;
    const FooterComp = components?.Footer;
    return (
      <div
        role={props['role'] as string}
        aria-label={props['aria-label'] as string}
        aria-busy={props['aria-busy'] as string | undefined}
        data-testid="virtuoso-root"
        className={props['className'] as string | undefined}
      >
        {HeaderComp && <HeaderComp context={context} />}
        {data?.map((item, idx) =>
          itemContent ? (
            <React.Fragment key={item.entryId}>{itemContent(idx, item)}</React.Fragment>
          ) : null
        )}
        {FooterComp && <FooterComp context={context} />}
      </div>
    );
  }),
}));

beforeEach(() => {
  capturedVirtuosoProps = null;
});

// ---------------------------------------------------------------------------
// Other component mocks
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
  // FU6-FU1: firstItemIndex is now owned by useSearchHistory (batched WITH
  // setPersistedEntries to eliminate iOS Safari prepend-jump). Tests pass a
  // large positive default mirroring the hook's INITIAL_FIRST_ITEM_INDEX.
  firstItemIndex: 1_000_000,
  showPersistenceNudge: false,
  onDismissPersistenceNudge: jest.fn(),
  onLoadMore: jest.fn(),
  onDeleteEntry: jest.fn(),
  onClearAll: jest.fn(),
  onRetry: jest.fn(),
  onDishSelect: jest.fn(),
};

// ---------------------------------------------------------------------------
// AC8: a11y — Virtuoso root attributes
// ---------------------------------------------------------------------------

describe('TranscriptFeed — AC8 a11y', () => {
  it('AC8: Virtuoso root has role="feed"', () => {
    render(<TranscriptFeed {...defaultProps} />);
    expect(screen.getByRole('feed')).toBeInTheDocument();
  });

  it('AC8: Virtuoso root has aria-label="Historial de consultas"', () => {
    render(<TranscriptFeed {...defaultProps} />);
    expect(screen.getByRole('feed')).toHaveAttribute('aria-label', 'Historial de consultas');
  });

  it('AC8: Virtuoso root does NOT have aria-busy (gate is open when Virtuoso mounts)', () => {
    // By the time Virtuoso mounts (isLoadingHistory=false), aria-busy should be absent.
    // aria-busy during loading lives on the HablarShell placeholder, not Virtuoso root.
    render(<TranscriptFeed {...defaultProps} isLoadingHistory={false} />);
    const feed = screen.getByRole('feed');
    expect(feed).not.toHaveAttribute('aria-busy', 'true');
  });

  it('AC8: sr-only "Cargar más historial" button present when hasMoreHistory && !isLoadingMore', () => {
    render(
      <TranscriptFeed
        {...defaultProps}
        isAuthenticated={true}
        hasMoreHistory={true}
        isLoadingMore={false}
      />
    );
    expect(
      screen.getByRole('button', { name: /cargar más historial/i })
    ).toBeInTheDocument();
  });

  it('AC8: "Cargar más historial" button absent when !hasMoreHistory', () => {
    render(
      <TranscriptFeed
        {...defaultProps}
        isAuthenticated={true}
        hasMoreHistory={false}
        isLoadingMore={false}
      />
    );
    expect(
      screen.queryByRole('button', { name: /cargar más historial/i })
    ).not.toBeInTheDocument();
  });

  it('AC8: "Cargar más historial" button absent when isLoadingMore', () => {
    render(
      <TranscriptFeed
        {...defaultProps}
        isAuthenticated={true}
        hasMoreHistory={true}
        isLoadingMore={true}
      />
    );
    expect(
      screen.queryByRole('button', { name: /cargar más historial/i })
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC3: Virtuoso prop wiring
// ---------------------------------------------------------------------------

describe('TranscriptFeed — AC3 Virtuoso prop wiring', () => {
  it('AC3: passes entries as data prop to Virtuoso', () => {
    const entries = [makeEntry({ queryText: 'first' }), makeEntry({ queryText: 'second' })];
    render(<TranscriptFeed {...defaultProps} entries={entries} />);
    expect(capturedVirtuosoProps?.['data']).toBe(entries);
  });

  it('AC3: passes followOutput="smooth" to Virtuoso', () => {
    render(<TranscriptFeed {...defaultProps} />);
    expect(capturedVirtuosoProps?.['followOutput']).toBe('smooth');
  });

  it('AC3: passes startReached that calls onLoadMore when not in-flight', () => {
    const onLoadMore = jest.fn();
    render(
      <TranscriptFeed
        {...defaultProps}
        hasMoreHistory={true}
        isLoadingMore={false}
        onLoadMore={onLoadMore}
      />
    );
    const startReached = capturedVirtuosoProps?.['startReached'] as (() => void) | undefined;
    expect(typeof startReached).toBe('function');
    startReached?.();
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('AC3: startReached does NOT call onLoadMore when isLoadingMore=true (secondary guard)', () => {
    const onLoadMore = jest.fn();
    render(
      <TranscriptFeed
        {...defaultProps}
        hasMoreHistory={true}
        isLoadingMore={true}
        onLoadMore={onLoadMore}
      />
    );
    const startReached = capturedVirtuosoProps?.['startReached'] as (() => void) | undefined;
    startReached?.();
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('AC3: startReached does NOT call onLoadMore when !hasMoreHistory', () => {
    const onLoadMore = jest.fn();
    render(
      <TranscriptFeed
        {...defaultProps}
        hasMoreHistory={false}
        isLoadingMore={false}
        onLoadMore={onLoadMore}
      />
    );
    const startReached = capturedVirtuosoProps?.['startReached'] as (() => void) | undefined;
    startReached?.();
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('AC3: startReached dedup guard — rapid double-call fires onLoadMore only once', () => {
    // This tests the local loadMoreInFlightRef sync guard inside TranscriptFeed.
    // First call sets in-flight ref; second call short-circuits.
    const onLoadMore = jest.fn();
    render(
      <TranscriptFeed
        {...defaultProps}
        hasMoreHistory={true}
        isLoadingMore={false}
        onLoadMore={onLoadMore}
      />
    );
    const startReached = capturedVirtuosoProps?.['startReached'] as (() => void) | undefined;
    startReached?.();
    startReached?.(); // rapid second call
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('AC3: initialTopMostItemIndex is entries.length - 1 (scroll to newest on mount)', () => {
    const entries = [makeEntry(), makeEntry(), makeEntry()]; // 3 entries
    render(<TranscriptFeed {...defaultProps} entries={entries} />);
    expect(capturedVirtuosoProps?.['initialTopMostItemIndex']).toBe(2); // length - 1
  });

  it('AC3: initialTopMostItemIndex is 0 (not negative) when entries is empty', () => {
    render(<TranscriptFeed {...defaultProps} entries={[]} />);
    expect(capturedVirtuosoProps?.['initialTopMostItemIndex']).toBe(0); // Math.max(0, -1)
  });

  it('AC3: firstItemIndex prop is passed through to Virtuoso unchanged', () => {
    // FU6-FU1: firstItemIndex is owned by useSearchHistory (batched WITH
    // setPersistedEntries to eliminate iOS Safari prepend-jump). TranscriptFeed
    // simply forwards the prop value to Virtuoso. The default + underflow
    // contract (must stay positive) lives in useSearchHistory.test.ts.
    render(<TranscriptFeed {...defaultProps} firstItemIndex={1_000_000} />);
    expect(capturedVirtuosoProps?.['firstItemIndex']).toBe(1_000_000);
  });

  it('AC3: firstItemIndex prop pass-through reflects external decrement', () => {
    // Simulating the post-prepend state where useSearchHistory has decremented.
    render(<TranscriptFeed {...defaultProps} firstItemIndex={999_990} />);
    expect(capturedVirtuosoProps?.['firstItemIndex']).toBe(999_990);
  });

  it('AC3: Footer slot renders a spacer for input-bar clearance (FU6-FU1 finding 1+2)', () => {
    // VirtuosoFooter provides 9rem+safe-area-inset of breathing room INSIDE
    // the scroll content so the last entry clears the fixed ConversationInput.
    // The padding-bottom was removed from the Virtuoso outer className because
    // it has no effect on the inner Scroller where items live.
    const entries = [makeEntry()];
    const { container } = render(<TranscriptFeed {...defaultProps} entries={entries} />);
    // Find the spacer div by its height class (rendered via Virtuoso mock's components.Footer)
    const spacer = container.querySelector('[aria-hidden="true"].h-\\[calc\\(9rem\\+env\\(safe-area-inset-bottom\\)\\)\\]');
    expect(spacer).toBeInTheDocument();
  });

  it('AC3: Virtuoso className includes overflow-x-hidden (iOS Safari horizontal jiggle fix)', () => {
    render(<TranscriptFeed {...defaultProps} />);
    const className = capturedVirtuosoProps?.['className'] as string | undefined;
    expect(className).toBeDefined();
    expect(className).toContain('overflow-x-hidden');
  });

  it('AC3: Virtuoso className does NOT include pb-[calc(9rem+...)] (now provided by Footer)', () => {
    // FU6-FU1: padding-bottom moved from outer className to Footer slot.
    render(<TranscriptFeed {...defaultProps} />);
    const className = capturedVirtuosoProps?.['className'] as string | undefined;
    expect(className).toBeDefined();
    expect(className).not.toContain('pb-[calc(9rem');
  });
});

// ---------------------------------------------------------------------------
// AC15: computeItemKey returns entryId
// ---------------------------------------------------------------------------

describe('TranscriptFeed — AC15 computeItemKey', () => {
  it('AC15: computeItemKey returns entry.entryId for stable identity', () => {
    const entry = makeEntry({ entryId: 'test-stable-id' });
    render(<TranscriptFeed {...defaultProps} entries={[entry]} />);
    const computeItemKey = capturedVirtuosoProps?.['computeItemKey'] as
      | ((idx: number, item: TranscriptEntryData) => string)
      | undefined;
    expect(typeof computeItemKey).toBe('function');
    expect(computeItemKey?.(0, entry)).toBe('test-stable-id');
  });

  it('AC15: computeItemKey is distinct per entry (no collisions)', () => {
    const e1 = makeEntry({ entryId: 'id-1' });
    const e2 = makeEntry({ entryId: 'id-2' });
    render(<TranscriptFeed {...defaultProps} entries={[e1, e2]} />);
    const computeItemKey = capturedVirtuosoProps?.['computeItemKey'] as
      | ((idx: number, item: TranscriptEntryData) => string)
      | undefined;
    expect(computeItemKey?.(0, e1)).not.toBe(computeItemKey?.(1, e2));
  });
});

// ---------------------------------------------------------------------------
// AC10: Header slot composition
// ---------------------------------------------------------------------------

describe('TranscriptFeed — AC10 Header slot', () => {
  it('AC10: shows ClearHistoryButton when authenticated and has persisted entries', () => {
    const entries = [makeEntry({ isPersisted: true })];
    render(
      <TranscriptFeed
        {...defaultProps}
        isAuthenticated={true}
        entries={entries}
      />
    );
    expect(screen.getByTestId('clear-history-button')).toBeInTheDocument();
  });

  it('AC10: does NOT show ClearHistoryButton when authenticated but no persisted entries', () => {
    const entries = [makeEntry({ isPersisted: false })];
    render(
      <TranscriptFeed
        {...defaultProps}
        isAuthenticated={true}
        entries={entries}
      />
    );
    expect(screen.queryByTestId('clear-history-button')).not.toBeInTheDocument();
  });

  it('AC10: does NOT show ClearHistoryButton when anonymous', () => {
    const entries = [makeEntry({ isPersisted: true })];
    render(
      <TranscriptFeed
        {...defaultProps}
        isAuthenticated={false}
        entries={entries}
      />
    );
    expect(screen.queryByTestId('clear-history-button')).not.toBeInTheDocument();
  });

  it('AC10: shows loading skeleton when isLoadingMore=true', () => {
    render(
      <TranscriptFeed
        {...defaultProps}
        isAuthenticated={true}
        hasMoreHistory={true}
        isLoadingMore={true}
      />
    );
    // The loading skeleton has aria-label="Cargando entradas anteriores"
    expect(screen.getByLabelText(/cargando entradas anteriores/i)).toBeInTheDocument();
  });

  it('AC10: shows HistoryEmptyState when authenticated + empty + !hasMoreHistory', () => {
    render(
      <TranscriptFeed
        {...defaultProps}
        isAuthenticated={true}
        entries={[]}
        hasMoreHistory={false}
      />
    );
    expect(screen.getByTestId('history-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
  });

  it('AC10: shows EmptyState when anonymous + empty', () => {
    render(
      <TranscriptFeed
        {...defaultProps}
        isAuthenticated={false}
        entries={[]}
      />
    );
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('history-empty-state')).not.toBeInTheDocument();
  });

  it('AC10: shows HistoryPersistenceNudge when showPersistenceNudge=true', () => {
    render(<TranscriptFeed {...defaultProps} showPersistenceNudge={true} />);
    expect(screen.getByTestId('persistence-nudge')).toBeInTheDocument();
  });

  it('AC10: does NOT show HistoryPersistenceNudge when showPersistenceNudge=false', () => {
    render(<TranscriptFeed {...defaultProps} showPersistenceNudge={false} />);
    expect(screen.queryByTestId('persistence-nudge')).not.toBeInTheDocument();
  });

  it('AC10: calls onClearAll when ClearHistoryButton confirm', async () => {
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
});

// ---------------------------------------------------------------------------
// AC34: entries rendered in DOM order (oldest-first, newest-last)
// ---------------------------------------------------------------------------

describe('TranscriptFeed — AC34 entry order', () => {
  it('AC34: renders entries in order (oldest first, newest last)', () => {
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

  it('AC34: renders dividers between entries (suppresses trailing)', () => {
    const entries = [makeEntry(), makeEntry(), makeEntry()];
    render(<TranscriptFeed {...defaultProps} entries={entries} />);
    const dividers = document.querySelectorAll('hr');
    // MINOR-1: trailing divider suppressed (idx < entries.length - 1).
    // 3 entries → 2 dividers (between 1↔2 and 2↔3, none after 3).
    expect(dividers).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Persistence nudge dismiss
// ---------------------------------------------------------------------------

describe('TranscriptFeed — persistence nudge dismiss', () => {
  it('calls onDismissPersistenceNudge when nudge is dismissed', async () => {
    const onDismiss = jest.fn();
    render(
      <TranscriptFeed
        {...defaultProps}
        showPersistenceNudge={true}
        onDismissPersistenceNudge={onDismiss}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /cerrar sugerencia/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
