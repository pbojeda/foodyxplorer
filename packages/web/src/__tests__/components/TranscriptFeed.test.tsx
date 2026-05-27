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
});
