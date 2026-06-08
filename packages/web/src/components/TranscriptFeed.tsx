'use client';

// TranscriptFeed — append-only feed container for session transcript + persisted history.
// F-WEB-HISTORY-FU6: architectural rewrite to react-virtuoso.
// Design spec: W16 (layout), W17 (entry spacing), W18 (persisted history), W23 (a11y).
// AC3: single <Virtuoso> — no manual scrollTop writes, no ResizeObserver, no IntersectionObserver.
// AC8: role="feed" + aria-label on Virtuoso root; aria-busy on HablarShell gate placeholder (not here).
// AC10: Header slot — ClearHistoryButton, loading skeleton, HistoryEmptyState, EmptyState.
// AC15: computeItemKey={entry.entryId} for stable identity across prepend/delete.

import { useEffect, useRef } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { TranscriptEntryData } from '@/types/history';
import { TranscriptEntry } from './TranscriptEntry';
import { EmptyState } from './EmptyState';
import { HistoryEmptyState } from './HistoryEmptyState';
import { HistoryPersistenceNudge } from './HistoryPersistenceNudge';
import { ClearHistoryButton } from './ClearHistoryButton';

interface TranscriptFeedProps {
  entries: TranscriptEntryData[];
  isAuthenticated: boolean;
  isLoadingHistory: boolean;
  hasMoreHistory: boolean;
  isLoadingMore: boolean;
  /**
   * Virtuoso `firstItemIndex` for inverse infinite scroll prepend anchoring.
   * Owned by `useSearchHistory` and batched WITH `setPersistedEntries` (same
   * commit) so Virtuoso never sees `data nuevo + firstItemIndex viejo` for a
   * frame (iOS Safari prepend-jump fix, BUG-WEB-HISTORY-FU6-FU1).
   */
  firstItemIndex: number;
  showPersistenceNudge: boolean;
  onDismissPersistenceNudge: () => void;
  onLoadMore: () => void;
  onDeleteEntry: (entryId: string) => void;
  onClearAll: () => void;
  onRetry: (queryText: string) => void;
  onDishSelect?: (dishName: string) => void;
}

// Context shape passed to Virtuoso components slot
interface FeedContext {
  isAuthenticated: boolean;
  hasPersisted: boolean;
  hasMoreHistory: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onClearAll: () => void;
  isEmpty: boolean;
  showPersistenceNudge: boolean;
  onDismissPersistenceNudge: () => void;
}

// ---------------------------------------------------------------------------
// VirtuosoFooter — spacer at the bottom of the items list.
// Virtuoso ownership: items live in the inner Scroller, so padding-bottom
// on the outer className doesn't push items up above the fixed input bar.
// The Footer slot renders INSIDE the scroll content and provides 144px +
// safe-area-inset breathing room so the last entry's bottom edge clears
// the `fixed bottom-0` ConversationInput bar (BUG-WEB-HISTORY-FU6-FU1
// finding 1+2; ConversationInput.tsx:75 is `fixed`).
// ---------------------------------------------------------------------------
function VirtuosoFooter() {
  return (
    <div
      className="h-[calc(9rem+env(safe-area-inset-bottom))]"
      aria-hidden="true"
    />
  );
}

// ---------------------------------------------------------------------------
// VirtuosoHeader — defined at module scope for stable React identity.
// Unstable identity (defined inside TranscriptFeed) causes Virtuoso to
// re-mount the header on every parent re-render, which is incorrect.
// ---------------------------------------------------------------------------
function VirtuosoHeader({ context }: { context?: FeedContext }) {
  if (!context) return null;

  const {
    isAuthenticated,
    hasPersisted,
    hasMoreHistory,
    isLoadingMore,
    onLoadMore,
    onClearAll,
    isEmpty,
    showPersistenceNudge,
    onDismissPersistenceNudge,
  } = context;

  return (
    <>
      {/* Keyboard fallback: sr-only focusable "Cargar más historial" (AC8, W23) */}
      {hasMoreHistory && !isLoadingMore && (
        <button
          type="button"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 text-sm text-brand-green underline underline-offset-2 z-10"
          onClick={onLoadMore}
        >
          Cargar más historial
        </button>
      )}

      {/* Loading skeletons when isLoadingMore (aria-busy scoped to this region) */}
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
      {isEmpty && isAuthenticated && (
        <HistoryEmptyState />
      )}
      {isEmpty && !isAuthenticated && (
        <div className="flex flex-1 overflow-y-auto">
          <EmptyState />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// TranscriptFeed
// ---------------------------------------------------------------------------

export function TranscriptFeed({
  entries,
  isAuthenticated,
  isLoadingHistory: _isLoadingHistory, // intentionally unused — Virtuoso mounts only post-gate
  hasMoreHistory,
  isLoadingMore,
  firstItemIndex,
  showPersistenceNudge,
  onDismissPersistenceNudge,
  onLoadMore,
  onDeleteEntry,
  onClearAll,
  onRetry,
  onDishSelect,
}: TranscriptFeedProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const atBottomRef = useRef(false);

  // Refs to track inter-render state for in-place resize detection
  const prevLastLoadingRef = useRef(false);

  // Local synchronous guard at startReached boundary — prevents double-fire before
  // React commits isLoadingMore=true (same purpose as loadMoreInFlightRef in hook).
  // Resets when isLoadingMore flips false (see useEffect below).
  const loadMoreInFlightRef = useRef(false);

  // In-place resize scroll detection (AC25/AC6).
  // firstItemIndex prepend anchoring is now owned by useSearchHistory so it
  // batches with setPersistedEntries in the same commit (BUG-WEB-HISTORY-FU6-FU1
  // iOS Safari prepend-jump fix). This effect therefore only handles the
  // shimmer→NutritionCard in-place resize case.
  useEffect(() => {
    const currentLastEntry = entries[entries.length - 1];
    const currentLastLoading = currentLastEntry?.isLoading ?? false;

    // In-place resize: last entry's isLoading flipped true→false AND user is at bottom.
    // requestAnimationFrame defers until after layout settle (NutritionCard full height visible).
    // useEffect (not useLayoutEffect) is correct: fires after paint, so card height is computed.
    if (
      prevLastLoadingRef.current === true &&
      currentLastLoading === false &&
      atBottomRef.current === true
    ) {
      requestAnimationFrame(() => {
        virtuosoRef.current?.autoscrollToBottom();
      });
    }

    prevLastLoadingRef.current = currentLastLoading;
  }, [entries]);

  // Reset startReached guard when isLoadingMore becomes false
  useEffect(() => {
    if (!isLoadingMore) {
      loadMoreInFlightRef.current = false;
    }
  }, [isLoadingMore]);

  const handleStartReached = () => {
    if (loadMoreInFlightRef.current) return;
    if (isLoadingMore || !hasMoreHistory) return;
    loadMoreInFlightRef.current = true;
    onLoadMore();
  };

  const hasPersisted = entries.some((e) => e.isPersisted);
  const isEmpty = entries.length === 0;

  const context: FeedContext = {
    isAuthenticated,
    hasPersisted,
    hasMoreHistory,
    isLoadingMore,
    onLoadMore,
    onClearAll,
    isEmpty,
    showPersistenceNudge,
    onDismissPersistenceNudge,
  };

  return (
    <Virtuoso
      ref={virtuosoRef}
      role="feed"
      aria-label="Historial de consultas"
      // `pb-...` removed (FU6-FU1): padding-bottom on the Virtuoso outer wrapper
      // doesn't push the items list up — Virtuoso owns the inner Scroller. The
      // 144px input-bar clearance is now provided by VirtuosoFooter (inside the
      // scroll content). `overflow-x-hidden` clips iOS Safari horizontal jiggle
      // from any child with intrinsic width > viewport (FU6-FU1 finding 4).
      className="flex-1 overflow-y-auto overflow-x-hidden px-4 pt-4 lg:max-w-2xl lg:mx-auto w-full"
      data={entries}
      computeItemKey={(_idx, entry) => entry.entryId}
      firstItemIndex={firstItemIndex}
      initialTopMostItemIndex={Math.max(0, entries.length - 1)}
      followOutput="smooth"
      atBottomStateChange={(atBottom) => {
        atBottomRef.current = atBottom;
      }}
      startReached={handleStartReached}
      itemContent={(idx, entry) => (
        <div>
          <TranscriptEntry
            entry={entry}
            onDelete={entry.isPersisted ? onDeleteEntry : undefined}
            onRetry={onRetry}
            onDishSelect={onDishSelect}
          />
          {/* MINOR-1: suppress trailing divider after last entry (code-review-specialist) */}
          {idx < entries.length - 1 && (
            <hr className="border-t border-slate-100 my-4" aria-hidden="true" />
          )}
        </div>
      )}
      components={{ Header: VirtuosoHeader, Footer: VirtuosoFooter }}
      context={context}
    />
  );
}
