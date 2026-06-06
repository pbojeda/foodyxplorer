// TranscriptFeed edge-case tests (FU6 adaptation)
// FU4-era scroll/ResizeObserver tests deleted (AC4 deletion sweep).
// Surviving tests cover entry deletion, clear-all, empty-state, and persistence nudge
// — behavioral assertions only, no scroll or ResizeObserver machinery.

import React from 'react';
import { render, screen } from '@testing-library/react';
import type { TranscriptEntryData } from '../../types/history';

// ---------------------------------------------------------------------------
// Module mocks (auto-mock picks up __mocks__/react-virtuoso.tsx for Virtuoso)
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

// ---------------------------------------------------------------------------
// Entry deletion path: entry removed from DOM after delete
// ---------------------------------------------------------------------------

describe('TranscriptFeed edge cases — deletion path', () => {
  beforeEach(() => jest.clearAllMocks());

  it('EC-DELETE-1: deleted entry is absent from the DOM after rerender with smaller entries array', () => {
    const entryA = makeEntry({ entryId: 'del-a', queryText: 'first' });
    const entryB = makeEntry({ entryId: 'del-b', queryText: 'second' });

    const { rerender } = render(
      <TranscriptFeed {...defaultProps} entries={[entryA, entryB]} />
    );

    // Both entries visible
    expect(screen.getByTestId('entry-del-a')).toBeInTheDocument();
    expect(screen.getByTestId('entry-del-b')).toBeInTheDocument();

    // Simulate delete of entryB
    rerender(<TranscriptFeed {...defaultProps} entries={[entryA]} />);

    // entryB gone; entryA still present
    expect(screen.queryByTestId('entry-del-b')).not.toBeInTheDocument();
    expect(screen.getByTestId('entry-del-a')).toBeInTheDocument();
  });

  it('EC-DELETE-2: after deletion, new append renders correctly', () => {
    const entryA = makeEntry({ entryId: 'del2-a', queryText: 'first' });
    const entryB = makeEntry({ entryId: 'del2-b', queryText: 'second' });
    const entryC = makeEntry({ entryId: 'del2-c', queryText: 'third' });

    const { rerender } = render(
      <TranscriptFeed {...defaultProps} entries={[entryA, entryB]} />
    );

    // Delete entryB
    rerender(<TranscriptFeed {...defaultProps} entries={[entryA]} />);
    expect(screen.queryByTestId('entry-del2-b')).not.toBeInTheDocument();

    // New entry appends
    rerender(<TranscriptFeed {...defaultProps} entries={[entryA, entryC]} />);
    expect(screen.getByTestId('entry-del2-c')).toBeInTheDocument();
    expect(screen.getByTestId('entry-del2-a')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Clear-all then new entry cycle
// ---------------------------------------------------------------------------

describe('TranscriptFeed edge cases — N → 0 → N same component', () => {
  beforeEach(() => jest.clearAllMocks());

  it('EC-CLEAR-1: after clear-all (entries → []), empty state renders; new entry replaces it', () => {
    const entryA = makeEntry({ entryId: 'clr-a', queryText: 'old entry' });
    const entryNew = makeEntry({ entryId: 'clr-new', queryText: 'new entry' });

    const { rerender } = render(
      <TranscriptFeed {...defaultProps} isAuthenticated={true} entries={[entryA]} />
    );
    expect(screen.getByTestId('entry-clr-a')).toBeInTheDocument();

    // Clear all entries
    rerender(<TranscriptFeed {...defaultProps} isAuthenticated={true} entries={[]} />);
    expect(screen.queryByTestId('entry-clr-a')).not.toBeInTheDocument();
    // Authenticated + empty → HistoryEmptyState
    expect(screen.getByTestId('history-empty-state')).toBeInTheDocument();

    // New entry arrives
    rerender(<TranscriptFeed {...defaultProps} isAuthenticated={true} entries={[entryNew]} />);
    expect(screen.getByTestId('entry-clr-new')).toBeInTheDocument();
    // Empty state gone
    expect(screen.queryByTestId('history-empty-state')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

describe('TranscriptFeed edge cases — empty states', () => {
  it('authenticated + empty → HistoryEmptyState (not EmptyState)', () => {
    render(
      <TranscriptFeed {...defaultProps} isAuthenticated={true} entries={[]} />
    );
    expect(screen.getByTestId('history-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
  });

  it('anonymous + empty → EmptyState (not HistoryEmptyState)', () => {
    render(
      <TranscriptFeed {...defaultProps} isAuthenticated={false} entries={[]} />
    );
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('history-empty-state')).not.toBeInTheDocument();
  });

  it('authenticated + has entries → no empty state', () => {
    const entry = makeEntry({ entryId: 'es-e1' });
    render(
      <TranscriptFeed {...defaultProps} isAuthenticated={true} entries={[entry]} />
    );
    expect(screen.queryByTestId('history-empty-state')).not.toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Persistence nudge
// ---------------------------------------------------------------------------

describe('TranscriptFeed edge cases — persistence nudge', () => {
  it('shows nudge when showPersistenceNudge=true', () => {
    render(<TranscriptFeed {...defaultProps} showPersistenceNudge={true} />);
    expect(screen.getByTestId('persistence-nudge')).toBeInTheDocument();
  });

  it('hides nudge when showPersistenceNudge=false', () => {
    render(<TranscriptFeed {...defaultProps} showPersistenceNudge={false} />);
    expect(screen.queryByTestId('persistence-nudge')).not.toBeInTheDocument();
  });
});
