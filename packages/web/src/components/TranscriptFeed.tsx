'use client';

// TranscriptFeed — append-only feed container for session transcript + persisted history.
// Design spec: W16 (layout), W17 (entry spacing), W18 (persisted history), W23 (a11y).
// AC32: role="feed", aria-label, aria-busy.
// AC34: renders entries in order with dividers.
// AC37: HistoryPersistenceNudge shown when showPersistenceNudge.
// AC45: HistoryEmptyState for authenticated+empty, EmptyState for anonymous+empty.
// AC46: ClearHistoryButton visible when isAuthenticated and has persisted entries.
// AC47: auto-scroll to bottom on new entries.

import { useEffect, useRef } from 'react';
import type { TranscriptEntryData } from '@/types/history';
import { TranscriptEntry } from './TranscriptEntry';
import { EmptyState } from './EmptyState';
import { HistoryEmptyState } from './HistoryEmptyState';
import { HistoryPersistenceNudge } from './HistoryPersistenceNudge';
import { HistoryLoadMoreSentinel } from './HistoryLoadMoreSentinel';
import { ClearHistoryButton } from './ClearHistoryButton';

interface TranscriptFeedProps {
  entries: TranscriptEntryData[];
  isAuthenticated: boolean;
  isLoadingHistory: boolean;
  hasMoreHistory: boolean;
  isLoadingMore: boolean;
  showPersistenceNudge: boolean;
  onDismissPersistenceNudge: () => void;
  onLoadMore: () => void;
  onDeleteEntry: (entryId: string) => void;
  onClearAll: () => void;
  onRetry: (queryText: string) => void;
  onDishSelect?: (dishName: string) => void;
}

export function TranscriptFeed({
  entries,
  isAuthenticated,
  isLoadingHistory,
  hasMoreHistory,
  isLoadingMore,
  showPersistenceNudge,
  onDismissPersistenceNudge,
  onLoadMore,
  onDeleteEntry,
  onClearAll,
  onRetry,
  onDishSelect,
}: TranscriptFeedProps) {
  const feedRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef<number>(0);
  const prevScrollTopRef = useRef<number>(0);
  // F-WEB-HISTORY-FU1 item C: guard so the initial scroll-to-bottom fires AT MOST
  // ONCE — covers both synchronous mount (entries already in props) and async
  // hydration ([] → [persisted×N] rerender). Subsequent loadMore prepends and
  // session appends short-circuit and fall through to the existing effects below.
  const hasScrolledToBottomOnHydrationRef = useRef(false);

  // F-WEB-HISTORY-FU1 item C: scroll to bottom on the first non-empty entries state.
  // React always runs useEffect once after first render regardless of deps, so
  // `[entries.length]` covers both the sync-mount case (entries already populated
  // on first render — the effect runs immediately with the non-zero length) AND
  // the async-hydration case (entries starts empty → effect early-returns → later
  // rerender with entries.length>0 re-fires the effect and scrolls). The ref guard
  // ensures it fires at most once so loadMore prepends and session appends never
  // re-trigger it; those flows are handled by the existing effects below.
  useEffect(() => {
    if (entries.length === 0) return;
    if (hasScrolledToBottomOnHydrationRef.current) return;
    const container = feedRef.current;
    if (!container) return;
    hasScrolledToBottomOnHydrationRef.current = true;
    try {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    } catch {
      // jsdom does not implement element.scrollTo — safe to ignore in tests
    }
  }, [entries.length]);

  // Auto-scroll to bottom when new session entries are appended.
  // Only if user is already near the bottom (within 100px).
  const prevEntriesLengthRef = useRef(entries.length);
  useEffect(() => {
    const container = feedRef.current;
    if (!container) return;

    const entryCountGrew = entries.length > prevEntriesLengthRef.current;
    prevEntriesLengthRef.current = entries.length;

    if (!entryCountGrew) return;

    // Check if the user is near the bottom
    const isNearBottom =
      container.scrollTop + container.clientHeight >= container.scrollHeight - 100;

    if (isNearBottom) {
      try {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      } catch {
        // jsdom does not implement element.scrollTo — safe to ignore in tests
      }
    }
  }, [entries.length]);

  // Capture scroll position before load-more prepends older entries.
  // After DOM update, restore position so the viewport doesn't jump.
  useEffect(() => {
    if (isLoadingMore) {
      const container = feedRef.current;
      if (!container) return;
      prevScrollHeightRef.current = container.scrollHeight;
      prevScrollTopRef.current = container.scrollTop;
    }
  }, [isLoadingMore]);

  useEffect(() => {
    if (!isLoadingMore) {
      const container = feedRef.current;
      if (!container) return;
      const delta = container.scrollHeight - prevScrollHeightRef.current;
      if (delta > 0) {
        container.scrollTop = prevScrollTopRef.current + delta;
      }
    }
  }, [isLoadingMore]);

  const hasPersisted = entries.some((e) => e.isPersisted);
  const isEmpty = entries.length === 0;

  return (
    <div
      ref={feedRef}
      role="feed"
      aria-label="Historial de consultas"
      aria-busy={isLoadingHistory ? true : undefined}
      className="flex-1 overflow-y-auto px-4 pt-4 pb-[calc(9rem+env(safe-area-inset-bottom))] lg:max-w-2xl lg:mx-auto w-full"
    >
      {/* Load-more sentinel — at the very top, above all entries */}
      {isAuthenticated && (hasMoreHistory || isLoadingMore) && (
        <HistoryLoadMoreSentinel
          hasMoreHistory={hasMoreHistory}
          isLoadingMore={isLoadingMore}
          onLoadMore={onLoadMore}
        />
      )}

      {/* Clear all button — top of feed when authenticated and has persisted entries */}
      {isAuthenticated && hasPersisted && (
        <div className="flex justify-end mb-3">
          <ClearHistoryButton onConfirm={onClearAll} />
        </div>
      )}

      {/* Persistence nudge — above first session entry, anonymous only, ≥2 entries */}
      {showPersistenceNudge && (
        <HistoryPersistenceNudge onDismiss={onDismissPersistenceNudge} />
      )}

      {/* Empty states */}
      {isEmpty && isAuthenticated && !isLoadingHistory && (
        <HistoryEmptyState />
      )}
      {isEmpty && !isAuthenticated && (
        <div className="flex flex-1 overflow-y-auto">
          <EmptyState />
        </div>
      )}

      {/* Entry list */}
      {entries.map((entry, index) => (
        <div key={entry.entryId}>
          <TranscriptEntry
            entry={entry}
            onDelete={entry.isPersisted ? onDeleteEntry : undefined}
            onRetry={onRetry}
            onDishSelect={onDishSelect}
          />
          {/* Divider between entries */}
          {index < entries.length - 1 && (
            <hr className="border-t border-slate-100 my-4" aria-hidden="true" />
          )}
        </div>
      ))}
    </div>
  );
}
