'use client';

// TranscriptFeed — append-only feed container for session transcript + persisted history.
// F-WEB-HISTORY-FU6: architectural rewrite to react-virtuoso.
// Design spec: W16 (layout), W17 (entry spacing), W18 (persisted history), W23 (a11y).
// AC3: single <Virtuoso> — no manual scrollTop writes, no ResizeObserver, no IntersectionObserver.
// AC8: role="feed" + aria-label on Virtuoso root; aria-busy on HablarShell gate placeholder (not here).
// AC10: Header slot — ClearHistoryButton, loading skeleton, HistoryEmptyState, EmptyState.
// AC15: computeItemKey={entry.entryId} for stable identity across prepend/delete.

import { useEffect, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { TranscriptEntryData } from '@/types/history';
import { TranscriptEntry } from './TranscriptEntry';
import { EmptyState } from './EmptyState';
import { HistoryEmptyState } from './HistoryEmptyState';
import { HistoryPersistenceNudge } from './HistoryPersistenceNudge';
import { ClearHistoryButton } from './ClearHistoryButton';

// firstItemIndex starts at 1_000_000 so prepend operations never go negative.
// Per Virtuoso v4 docs: firstItemIndex MUST be a positive number.
// Soft cap: ~500 entries / 50 prepends → floor ~999_500 — well above 0.
const INITIAL_FIRST_ITEM_INDEX = 1_000_000;
const PAGE_SIZE = 10;

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

  // firstItemIndex: starts at INITIAL_FIRST_ITEM_INDEX (positive), decremented on prepend.
  // Virtuoso uses this for viewport anchoring on prepend operations.
  const [firstItemIndex, setFirstItemIndex] = useState(INITIAL_FIRST_ITEM_INDEX);

  // Refs to track inter-render state for prepend detection and in-place resize detection
  const prevFirstEntryIdRef = useRef<string | undefined>(undefined);
  const prevLastLoadingRef = useRef(false);
  const prevEntriesLengthRef = useRef(entries.length);

  // Local synchronous guard at startReached boundary — prevents double-fire before
  // React commits isLoadingMore=true (same purpose as loadMoreInFlightRef in hook).
  // Resets when isLoadingMore flips false (see useEffect below).
  const loadMoreInFlightRef = useRef(false);

  // Prepend detection + in-place resize scroll
  useEffect(() => {
    const currentFirstId = entries[0]?.entryId;
    const currentLastEntry = entries[entries.length - 1];
    const currentLastLoading = currentLastEntry?.isLoading ?? false;

    // Prepend detection: first entry changed AND total count grew
    if (
      prevFirstEntryIdRef.current !== undefined &&
      currentFirstId !== undefined &&
      currentFirstId !== prevFirstEntryIdRef.current &&
      entries.length > prevEntriesLengthRef.current
    ) {
      const prependCount = entries.length - prevEntriesLengthRef.current;
      setFirstItemIndex((prev) => prev - prependCount);
    }

    // In-place resize: last entry's isLoading flipped true→false AND user is at bottom (AC25/AC6).
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

    prevFirstEntryIdRef.current = currentFirstId;
    prevLastLoadingRef.current = currentLastLoading;
    prevEntriesLengthRef.current = entries.length;
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
      className="flex-1 overflow-y-auto px-4 pt-4 pb-[calc(9rem+env(safe-area-inset-bottom))] lg:max-w-2xl lg:mx-auto w-full"
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
      components={{ Header: VirtuosoHeader }}
      context={context}
    />
  );
}
