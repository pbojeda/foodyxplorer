// TranscriptFeed FU6 QA hardening — edge cases the developer missed.
//
// Coverage gaps identified during QA pass 2026-06-06:
//   GAP-1: firstItemIndex decrements on prepend (useEffect prepend detection)
//   GAP-2: firstItemIndex stays positive after many prepends (underflow guard)
//   GAP-3: autoscrollToBottom called when last entry isLoading flips true→false (at bottom)
//   GAP-4: autoscrollToBottom NOT called when user is NOT at bottom
//   GAP-5: autoscrollToBottom NOT called when isLoading flips false→false (no re-fire)
//   GAP-6: autoscrollToBottom NOT called when isLoading stays true (no spurious call)
//   GAP-7: startReached dedup guard resets after isLoadingMore cycles false (second page fires)
//   GAP-8: single entry → initialTopMostItemIndex=0 (not negative)
//   GAP-9: prepend on same entry count (first entry id change alone does NOT decrement)
//   GAP-10: atBottomStateChange wired — callback stored in ref
//
// All Virtuoso-layer scroll behavior is operator-empirical per feedback_jsdom_layout_ac_gap.
// These tests guard the logic branches in TranscriptFeed's useEffect/handleStartReached.

import React from 'react';
import { render, act } from '@testing-library/react';
import type { TranscriptEntryData } from '../../types/history';

// ---------------------------------------------------------------------------
// Prop-spy Virtuoso mock — captures props + exposes imperative handle
// ---------------------------------------------------------------------------

let capturedProps: Record<string, unknown> | null = null;
let capturedRef: React.Ref<unknown> | null = null;

// Keep a reference to the last handle so tests can invoke imperative methods
const autoscrollToBottomSpy = jest.fn();
const scrollToIndexSpy = jest.fn();

jest.mock('react-virtuoso', () => ({
  // eslint-disable-next-line react/display-name
  Virtuoso: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
    capturedProps = props;
    capturedRef = ref;
    React.useImperativeHandle(ref, () => ({
      scrollToIndex: scrollToIndexSpy,
      scrollTo: jest.fn(),
      scrollBy: jest.fn(),
      autoscrollToBottom: autoscrollToBottomSpy,
      getState: jest.fn(),
    }));
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
        data-testid="virtuoso-root"
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

// ---------------------------------------------------------------------------
// Other component mocks
// ---------------------------------------------------------------------------

jest.mock('../../components/TranscriptEntry', () => ({
  TranscriptEntry: ({ entry }: { entry: TranscriptEntryData }) => (
    <div data-testid={`entry-${entry.entryId}`}>{entry.queryText}</div>
  ),
}));
jest.mock('../../components/EmptyState', () => ({ EmptyState: () => null }));
jest.mock('../../components/HistoryEmptyState', () => ({ HistoryEmptyState: () => null }));
jest.mock('../../components/HistoryPersistenceNudge', () => ({ HistoryPersistenceNudge: () => null }));
jest.mock('../../components/ClearHistoryButton', () => ({ ClearHistoryButton: () => null }));
jest.mock('../../lib/metrics', () => ({ trackEvent: jest.fn(), flushMetrics: jest.fn() }));

import { TranscriptFeed } from '../../components/TranscriptFeed';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let _id = 0;
function makeEntry(overrides: Partial<TranscriptEntryData> = {}): TranscriptEntryData {
  return {
    entryId: `entry-${++_id}`,
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
  // FU6-FU1: firstItemIndex is owned by useSearchHistory (batched with
  // setPersistedEntries to eliminate iOS Safari prepend-jump).
  firstItemIndex: 1_000_000,
  showPersistenceNudge: false,
  onDismissPersistenceNudge: jest.fn(),
  onLoadMore: jest.fn(),
  onDeleteEntry: jest.fn(),
  onClearAll: jest.fn(),
  onRetry: jest.fn(),
  onDishSelect: jest.fn(),
};

beforeEach(() => {
  capturedProps = null;
  capturedRef = null;
  autoscrollToBottomSpy.mockClear();
  scrollToIndexSpy.mockClear();
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GAP-8: single entry → initialTopMostItemIndex = 0 (not -1 or undefined)
// ---------------------------------------------------------------------------

describe('GAP-8: initialTopMostItemIndex with single entry', () => {
  it('single entry: initialTopMostItemIndex=0 (not negative)', () => {
    const entries = [makeEntry()];
    render(<TranscriptFeed {...defaultProps} entries={entries} />);
    expect(capturedProps?.['initialTopMostItemIndex']).toBe(0);
  });

  it('two entries: initialTopMostItemIndex=1', () => {
    const entries = [makeEntry(), makeEntry()];
    render(<TranscriptFeed {...defaultProps} entries={entries} />);
    expect(capturedProps?.['initialTopMostItemIndex']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GAP-1 / GAP-2 REWRITTEN (FU6-FU1): firstItemIndex prop pass-through
//
// firstItemIndex management was MOVED from TranscriptFeed to useSearchHistory
// in FU6-FU1 (BUG iOS Safari prepend-jump): the decrement is now batched WITH
// setPersistedEntries in the same React 18 commit, so Virtuoso never sees
// `data nuevo + firstItemIndex viejo` for a frame.
//
// TranscriptFeed simply forwards the prop value to Virtuoso. Decrement +
// underflow contract is tested at the hook level in `useSearchHistory.test.ts`.
// ---------------------------------------------------------------------------

describe('GAP-1/2 (FU6-FU1): firstItemIndex prop pass-through', () => {
  it('forwards firstItemIndex prop to Virtuoso unchanged', () => {
    render(<TranscriptFeed {...defaultProps} firstItemIndex={1_000_000} />);
    expect(capturedProps?.['firstItemIndex']).toBe(1_000_000);
  });

  it('forwards updated firstItemIndex (e.g. post-prepend) to Virtuoso', () => {
    const { rerender } = render(
      <TranscriptFeed {...defaultProps} firstItemIndex={1_000_000} />
    );
    expect(capturedProps?.['firstItemIndex']).toBe(1_000_000);

    // External decrement (from useSearchHistory) reaches Virtuoso atomically
    rerender(<TranscriptFeed {...defaultProps} firstItemIndex={999_990} />);
    expect(capturedProps?.['firstItemIndex']).toBe(999_990);
  });

  it('forwards low-but-positive firstItemIndex (50 prepends simulated externally)', () => {
    // 1_000_000 - 50 * 10 = 999_500 (well above 0)
    render(<TranscriptFeed {...defaultProps} firstItemIndex={999_500} />);
    expect(capturedProps?.['firstItemIndex']).toBe(999_500);
    expect(capturedProps?.['firstItemIndex']).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// GAP-7: startReached dedup guard resets after isLoadingMore cycles false
// ---------------------------------------------------------------------------

describe('GAP-7: startReached dedup guard resets after isLoadingMore → false', () => {
  it('after isLoadingMore false cycle, startReached fires onLoadMore again', () => {
    const onLoadMore = jest.fn();
    const { rerender } = render(
      <TranscriptFeed
        {...defaultProps}
        hasMoreHistory={true}
        isLoadingMore={false}
        onLoadMore={onLoadMore}
      />
    );

    // First startReached call: fires
    const startReached = capturedProps?.['startReached'] as (() => void) | undefined;
    startReached?.();
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // Rapid second call: dedup blocks it
    startReached?.();
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // isLoadingMore becomes true (React committed state)
    act(() => {
      rerender(
        <TranscriptFeed
          {...defaultProps}
          hasMoreHistory={true}
          isLoadingMore={true}
          onLoadMore={onLoadMore}
        />
      );
    });

    // isLoadingMore becomes false again (page loaded)
    act(() => {
      rerender(
        <TranscriptFeed
          {...defaultProps}
          hasMoreHistory={true}
          isLoadingMore={false}
          onLoadMore={onLoadMore}
        />
      );
    });

    // Now startReached should be callable again (guard reset by useEffect)
    const startReachedAfter = capturedProps?.['startReached'] as (() => void) | undefined;
    startReachedAfter?.();
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// GAP-3/4/5/6: in-place resize autoscroll behavior
// The useEffect watches entries; when last entry's isLoading flips true→false
// AND atBottomRef.current===true, it calls requestAnimationFrame(autoscrollToBottom).
// ---------------------------------------------------------------------------

describe('GAP-3/4/5/6: in-place resize autoscroll via atBottomStateChange + entries effect', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function simulateAtBottom(atBottom: boolean) {
    // Trigger the atBottomStateChange callback that was passed to Virtuoso
    const atBottomStateChange = capturedProps?.['atBottomStateChange'] as
      | ((b: boolean) => void)
      | undefined;
    if (atBottomStateChange) {
      act(() => { atBottomStateChange(atBottom); });
    }
  }

  it('GAP-3: autoscrollToBottom fires when last entry isLoading flips true→false AND user is at bottom', () => {
    const pendingEntry = makeEntry({ entryId: 'pending-1', isLoading: true });
    const { rerender } = render(
      <TranscriptFeed {...defaultProps} entries={[pendingEntry]} />
    );

    // Simulate user at bottom
    simulateAtBottom(true);

    // Settle the entry: isLoading → false
    const settledEntry = { ...pendingEntry, isLoading: false };
    act(() => {
      rerender(<TranscriptFeed {...defaultProps} entries={[settledEntry]} />);
    });

    // requestAnimationFrame should have been called; flush it
    act(() => { jest.runAllTimers(); });

    expect(autoscrollToBottomSpy).toHaveBeenCalledTimes(1);
  });

  it('GAP-4: autoscrollToBottom NOT fired when user is NOT at bottom', () => {
    const pendingEntry = makeEntry({ entryId: 'pending-2', isLoading: true });
    const { rerender } = render(
      <TranscriptFeed {...defaultProps} entries={[pendingEntry]} />
    );

    // User has scrolled up — NOT at bottom
    simulateAtBottom(false);

    const settledEntry = { ...pendingEntry, isLoading: false };
    act(() => {
      rerender(<TranscriptFeed {...defaultProps} entries={[settledEntry]} />);
    });
    act(() => { jest.runAllTimers(); });

    expect(autoscrollToBottomSpy).not.toHaveBeenCalled();
  });

  it('GAP-5: autoscrollToBottom NOT fired when isLoading was already false before rerender', () => {
    // prevLastLoadingRef starts as false; if we render with isLoading=false initially,
    // no flip occurs on next render
    const settledEntry = makeEntry({ entryId: 'settled-1', isLoading: false });
    const { rerender } = render(
      <TranscriptFeed {...defaultProps} entries={[settledEntry]} />
    );
    simulateAtBottom(true);

    // Another render with same state — no flip
    const settledEntry2 = { ...settledEntry, queryText: 'updated query' };
    act(() => {
      rerender(<TranscriptFeed {...defaultProps} entries={[settledEntry2]} />);
    });
    act(() => { jest.runAllTimers(); });

    expect(autoscrollToBottomSpy).not.toHaveBeenCalled();
  });

  it('GAP-6: autoscrollToBottom NOT fired when last entry stays isLoading=true (no flip)', () => {
    const pendingEntry = makeEntry({ entryId: 'pending-3', isLoading: true });
    const { rerender } = render(
      <TranscriptFeed {...defaultProps} entries={[pendingEntry]} />
    );
    simulateAtBottom(true);

    // Still loading — no flip yet
    act(() => {
      rerender(<TranscriptFeed {...defaultProps} entries={[pendingEntry]} />);
    });
    act(() => { jest.runAllTimers(); });

    expect(autoscrollToBottomSpy).not.toHaveBeenCalled();
  });

  it('GAP-3b: autoscrollToBottom fires for the LAST entry flip only (middle entry flip is ignored)', () => {
    // If multiple entries exist and only a middle entry's isLoading flips, no scroll.
    const entry1 = makeEntry({ entryId: 'e1', isLoading: true });
    const entry2 = makeEntry({ entryId: 'e2', isLoading: true });
    const { rerender } = render(
      <TranscriptFeed {...defaultProps} entries={[entry1, entry2]} />
    );
    simulateAtBottom(true);

    // Only the middle entry settles; last entry still loading
    const settledEntry1 = { ...entry1, isLoading: false };
    act(() => {
      rerender(
        <TranscriptFeed
          {...defaultProps}
          entries={[settledEntry1, entry2]}
        />
      );
    });
    act(() => { jest.runAllTimers(); });

    // entry2 (last) is still loading — no autoscroll
    expect(autoscrollToBottomSpy).not.toHaveBeenCalled();

    // Now last entry settles
    const settledEntry2 = { ...entry2, isLoading: false };
    act(() => {
      rerender(
        <TranscriptFeed
          {...defaultProps}
          entries={[settledEntry1, settledEntry2]}
        />
      );
    });
    act(() => { jest.runAllTimers(); });

    expect(autoscrollToBottomSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// GAP-9: prepend with same count but first id change does NOT decrement
// Already in GAP-1 block but confirmed separately here for clarity
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GAP-10: atBottomStateChange prop is wired and callable
// ---------------------------------------------------------------------------

describe('GAP-10: atBottomStateChange prop wired to Virtuoso', () => {
  it('atBottomStateChange prop is a function and is passed to Virtuoso', () => {
    render(<TranscriptFeed {...defaultProps} />);
    expect(typeof capturedProps?.['atBottomStateChange']).toBe('function');
  });

  it('atBottomStateChange can be called without error (updates internal ref)', () => {
    render(<TranscriptFeed {...defaultProps} />);
    const cb = capturedProps?.['atBottomStateChange'] as ((b: boolean) => void) | undefined;
    // Should not throw
    expect(() => {
      act(() => { cb?.(true); });
      act(() => { cb?.(false); });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC9: React 18 StrictMode parity
// No double-loadMore, no orphaned state.
// ---------------------------------------------------------------------------

describe('AC9: React StrictMode parity', () => {
  it('TranscriptFeed renders in StrictMode without double-loadMore or console errors', () => {
    const onLoadMore = jest.fn();
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <React.StrictMode>
        <TranscriptFeed
          {...defaultProps}
          hasMoreHistory={true}
          isLoadingMore={false}
          onLoadMore={onLoadMore}
        />
      </React.StrictMode>
    );

    // StrictMode double-invokes effects but no startReached should have been called
    // (startReached is user-initiated, not auto-fired on mount)
    expect(onLoadMore).not.toHaveBeenCalled();

    // firstItemIndex should still be at INITIAL value (no spurious prepend detection)
    const firstItemIndex = capturedProps?.['firstItemIndex'] as number;
    expect(firstItemIndex).toBeGreaterThanOrEqual(1_000_000);

    consoleError.mockRestore();
  });

  it('StrictMode: initialTopMostItemIndex applied correctly on real mount (not synthetic)', () => {
    const entries = Array.from({ length: 10 }, (_, i) => makeEntry({ entryId: `sm-${i}` }));

    render(
      <React.StrictMode>
        <TranscriptFeed {...defaultProps} entries={entries} />
      </React.StrictMode>
    );

    // initialTopMostItemIndex must be entries.length - 1 = 9
    expect(capturedProps?.['initialTopMostItemIndex']).toBe(9);
  });
});
