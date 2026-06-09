'use client';

// TranscriptFeed — native-scroll append-only feed (F-WEB-HISTORY-FU7 rewrite).
// Architecture: ADR-030. Replaces react-virtuoso with a plain overflow-y-auto div.
// Design spec: W16 (layout), W17 (entry spacing), W18 (persisted history), W23 (a11y).
//
// Key mechanisms:
//   1. Pin-aware auto-scroll on settle (AC25): scroll to bottom only when the
//      user was within NEAR_BOTTOM_THRESHOLD_PX of the bottom before the settle.
//      Pattern from validated prototype HablarV2Shell.tsx (commit e285711).
//   2. Prepend anchoring (AC7): saves scrollHeight - scrollTop before loadMore
//      resolves, restores after new entries arrive. Guards against setPersistedEntries
//      / setIsLoadingMore(false) order in useSearchHistory.loadMore().
//   3. onScroll load-more trigger: fires when el.scrollTop < 100 with dedup guard.

import { useEffect, useRef, useCallback } from 'react';
import type { TranscriptEntryData } from '@/types/history';
import { TranscriptEntry } from './TranscriptEntry';
import { EmptyState } from './EmptyState';
import { HistoryEmptyState } from './HistoryEmptyState';
import { HistoryPersistenceNudge } from './HistoryPersistenceNudge';
import { ClearHistoryButton } from './ClearHistoryButton';

const NEAR_BOTTOM_THRESHOLD_PX = 100;
const NEAR_TOP_THRESHOLD_PX = 100;

interface TranscriptFeedProps {
  entries: TranscriptEntryData[];
  isAuthenticated: boolean;
  /** Kept for API compatibility — the mount gate in HablarShell ensures
   * TranscriptFeed never mounts while isLoadingHistory=true. */
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
  isLoadingHistory: _isLoadingHistory, // intentionally unused — mount gate is in HablarShell
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

  // Pin-aware: updated on every scroll event.
  // Initialized true so the mount scroll-to-bottom fires unconditionally.
  const wasNearBottomRef = useRef(true);

  // Settle detection: tracks previous loading state of the LAST entry.
  const prevLastLoadingRef = useRef(false);

  // Prepend anchoring: saves scrollHeight - scrollTop when isLoadingMore flips true.
  // Null when no pending restore.
  const savedScrollDeltaRef = useRef<number | null>(null);

  // Dedup guard: prevents double-fire of onLoadMore before React commits isLoadingMore=true.
  const loadMoreInFlightRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Mount: scroll to bottom + initialize wasNearBottomRef
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    wasNearBottomRef.current = true;
  }, []);

  // ---------------------------------------------------------------------------
  // Pin-aware settle: when last entry flips isLoading true→false, scroll to
  // bottom only if user was near the bottom before the settle.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const el = feedRef.current;
    const currentLastEntry = entries[entries.length - 1];
    const currentLastLoading = currentLastEntry?.isLoading ?? false;

    if (prevLastLoadingRef.current === true && currentLastLoading === false) {
      if (wasNearBottomRef.current && el) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    }

    prevLastLoadingRef.current = currentLastLoading;
  }, [entries]);

  // ---------------------------------------------------------------------------
  // Prepend anchoring: save delta before loadMore; restore after entries arrive.
  // Deps include entries so the restore fires after React commits the prepended
  // items (isLoadingMore false + entries updated in same flush).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;

    if (isLoadingMore) {
      // Save current position delta before list grows
      savedScrollDeltaRef.current = el.scrollHeight - el.scrollTop;
    } else if (savedScrollDeltaRef.current !== null) {
      // Restore: scrollTop = newScrollHeight - savedDelta
      el.scrollTop = el.scrollHeight - savedScrollDeltaRef.current;
      savedScrollDeltaRef.current = null;
    }
  }, [entries, isLoadingMore]);

  // Reset loadMore dedup guard when isLoadingMore becomes false
  useEffect(() => {
    if (!isLoadingMore) {
      loadMoreInFlightRef.current = false;
    }
  }, [isLoadingMore]);

  // ---------------------------------------------------------------------------
  // onScroll handler
  // ---------------------------------------------------------------------------
  const handleScroll = useCallback(() => {
    const el = feedRef.current;
    if (!el) return;

    // Update pin-aware near-bottom state
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasNearBottomRef.current = distanceFromBottom < NEAR_BOTTOM_THRESHOLD_PX;

    // Trigger load-more when near the top
    if (
      el.scrollTop < NEAR_TOP_THRESHOLD_PX &&
      hasMoreHistory &&
      !isLoadingMore &&
      !loadMoreInFlightRef.current
    ) {
      loadMoreInFlightRef.current = true;
      onLoadMore();
    }
  }, [hasMoreHistory, isLoadingMore, onLoadMore]);

  const hasPersisted = entries.some((e) => e.isPersisted);
  const isEmpty = entries.length === 0;

  return (
    <div
      ref={feedRef}
      role="feed"
      aria-label="Historial de consultas"
      className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 lg:max-w-2xl lg:mx-auto w-full"
      onScroll={handleScroll}
    >
      {/* Keyboard fallback: sr-only focusable "Cargar más historial" (AC24, W23) */}
      {hasMoreHistory && !isLoadingMore && (
        <button
          type="button"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 text-sm text-brand-green underline underline-offset-2 z-10"
          onClick={onLoadMore}
        >
          Cargar más historial
        </button>
      )}

      {/* Loading skeletons when isLoadingMore */}
      {isLoadingMore && (
        <div
          className="mb-4 space-y-3"
          aria-label="Cargando entradas anteriores"
          aria-busy="true"
        >
          <div className="h-4 w-48 rounded-full shimmer-element mb-3" aria-hidden="true" />
          <div className="h-[120px] rounded-2xl shimmer-element" aria-hidden="true" />
          <div className="h-4 w-48 rounded-full shimmer-element mb-3" aria-hidden="true" />
          <div className="h-[120px] rounded-2xl shimmer-element" aria-hidden="true" />
        </div>
      )}

      {/* ClearHistoryButton — shown when authenticated + has persisted entries */}
      {isAuthenticated && hasPersisted && (
        <div className="flex justify-end mb-3">
          <ClearHistoryButton onConfirm={onClearAll} />
        </div>
      )}

      {/* Persistence nudge (anonymous users, ≥2 entries) */}
      {showPersistenceNudge && (
        <HistoryPersistenceNudge onDismiss={onDismissPersistenceNudge} />
      )}

      {/* Empty states */}
      {isEmpty && isAuthenticated && <HistoryEmptyState />}
      {isEmpty && !isAuthenticated && <EmptyState />}

      {/* Entries */}
      {entries.map((entry, idx) => (
        <div key={entry.entryId}>
          <TranscriptEntry
            entry={entry}
            onDelete={entry.isPersisted ? onDeleteEntry : undefined}
            onRetry={onRetry}
            onDishSelect={onDishSelect}
          />
          {idx < entries.length - 1 && (
            <hr className="border-t border-slate-100 my-4" aria-hidden="true" />
          )}
        </div>
      ))}
    </div>
  );
}
