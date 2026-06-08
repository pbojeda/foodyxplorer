'use client';

// useSearchHistory — encapsulates GET /history fetch, cursor pagination,
// loadMore, deleteEntry, clearAll. No-op when authToken is null (anonymous users).
// AC38: mount fetch + map to TranscriptEntryData.
// AC39: loadMore via cursor, prepends older entries.
// AC40: hasMoreHistory / isLoadingMore state.
// AC48: history_loaded telemetry.
// AC49: history_load_more telemetry (page counter).
// Deploy-skew: any fetch error is swallowed, persistedEntries stays [].

import { useState, useEffect, useCallback, useRef } from 'react';
import type { TranscriptEntryData } from '@/types/history';
import { getHistory, deleteHistoryEntry, clearHistory } from '@/lib/apiClient';
import { trackEvent } from '@/lib/metrics';

interface UseSearchHistoryOptions {
  /** Bearer token from Supabase session. Null → no-op (anonymous). */
  authToken: string | null;
}

interface UseSearchHistoryResult {
  /** Pre-loaded persisted entries from GET /history, oldest-first. */
  persistedEntries: TranscriptEntryData[];
  /** True when there are more (older) pages available via cursor. */
  hasMoreHistory: boolean;
  /** True while a loadMore request is in-flight. */
  isLoadingMore: boolean;
  /** True while the initial mount fetch is in-flight. */
  isLoadingHistory: boolean;
  /**
   * Virtuoso `firstItemIndex` for inverse infinite scroll prepend anchoring.
   * Starts at `INITIAL_FIRST_ITEM_INDEX = 1_000_000` (positive per Virtuoso v4
   * docs) and decrements by the prepend size in the SAME commit as
   * `persistedEntries` so Virtuoso receives both updates atomically (iOS
   * Safari prepend-jump fix, BUG-WEB-HISTORY-FU6-FU1 finding 3).
   */
  firstItemIndex: number;
  /** Load the next (older) cursor page. */
  loadMore: () => void;
  /** Remove a single entry optimistically (also calls DELETE /history/{id}). */
  deleteEntry: (entryId: string) => void;
  /** Clear all persisted entries (also calls DELETE /history). */
  clearAll: () => void;
}

// INITIAL_FIRST_ITEM_INDEX must stay positive per Virtuoso v4 docs. Starting at
// 1_000_000 leaves ~100,000 prepends of headroom (vs the ~500-entry soft cap),
// so any plausible decrement keeps firstItemIndex well above 0.
// See BUG-WEB-HISTORY-FU6-FU1: firstItemIndex must be batched WITH the
// setPersistedEntries call (same React 18 commit) so Virtuoso never sees
// `data nuevo + firstItemIndex viejo` on iOS Safari (visible scroll jump).
export const INITIAL_FIRST_ITEM_INDEX = 1_000_000;

export function useSearchHistory({ authToken }: UseSearchHistoryOptions): UseSearchHistoryResult {
  const [persistedEntries, setPersistedEntries] = useState<TranscriptEntryData[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  // firstItemIndex tracks Virtuoso's absolute first index for inverse infinite
  // scroll prepend anchoring. Co-located with persistedEntries so they update
  // in the same React 18 commit (automatic batching) — eliminates the iOS
  // Safari jump where Virtuoso would otherwise render `new data + stale index`
  // for one frame before the post-paint useEffect catches up.
  const [firstItemIndex, setFirstItemIndex] = useState<number>(INITIAL_FIRST_ITEM_INDEX);

  // Track current loadMore page for telemetry
  const pageRef = useRef(0);

  // Synchronous in-flight guard for loadMore.
  // React's `isLoadingMore` state is only consistent after commit; if the sentinel's
  // IntersectionObserver fires twice in quick succession (e.g. due to a rapid
  // intersection burst on layout settle), the second call would read the stale
  // false value and trigger a duplicate fetch. The ref is mutated synchronously
  // so the second call short-circuits before scheduling another setState.
  // See BUG-WEB-HISTORY-LOADMORE-IO-ROOT-001.
  const loadMoreInFlightRef = useRef(false);

  // Mount fetch — runs when authToken is provided
  useEffect(() => {
    if (!authToken) return;

    let cancelled = false;
    setIsLoadingHistory(true);

    getHistory(null, 10)
      .then(({ entries, nextCursor: cursor }) => {
        if (cancelled) return;
        setPersistedEntries(entries);
        setNextCursor(cursor);
        setHasMoreHistory(cursor !== null);
        trackEvent('history_loaded', { count: entries.length });
      })
      .catch(() => {
        // Deploy-skew or API error: fall back to session-only mode (swallow)
        if (!cancelled) {
          setPersistedEntries([]);
          setHasMoreHistory(false);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authToken]);

  const loadMore = useCallback(() => {
    // Sync ref guard runs BEFORE the React-state check so double-fires within the
    // same commit cycle short-circuit deterministically (the React state is stale
    // until next commit).
    if (loadMoreInFlightRef.current) {
      return;
    }
    if (!authToken || !nextCursor || isLoadingMore) {
      return;
    }

    loadMoreInFlightRef.current = true;
    setIsLoadingMore(true);
    pageRef.current += 1;
    const page = pageRef.current;

    getHistory(nextCursor, 10)
      .then(({ entries: olderEntries, nextCursor: newCursor }) => {
        // Prepend older entries above existing ones. firstItemIndex MUST be
        // decremented in the SAME callback as setPersistedEntries so React 18
        // automatic batching commits both updates in one render — Virtuoso
        // never sees `data nuevo + firstItemIndex viejo` (iOS Safari prepend
        // jump fix, BUG-WEB-HISTORY-FU6-FU1 finding 3).
        setPersistedEntries((prev) => [...olderEntries, ...prev]);
        setFirstItemIndex((prev) => prev - olderEntries.length);
        setNextCursor(newCursor);
        setHasMoreHistory(newCursor !== null);
        trackEvent('history_load_more', { page });
      })
      .catch(() => {
        // Swallow — sentinel stops, user still sees current history
        setHasMoreHistory(false);
      })
      .finally(() => {
        setIsLoadingMore(false);
        loadMoreInFlightRef.current = false;
      });
  }, [authToken, nextCursor, isLoadingMore]);

  const deleteEntry = useCallback((entryId: string) => {
    if (!authToken) return;
    // Optimistic removal
    setPersistedEntries((prev) => prev.filter((e) => e.entryId !== entryId));
    // Fire-and-forget — 404 means already gone, any error is swallowed
    void deleteHistoryEntry(entryId).catch(() => {});
  }, [authToken]);

  const clearAll = useCallback(() => {
    if (!authToken) return;
    // Optimistic clear
    setPersistedEntries([]);
    setHasMoreHistory(false);
    setNextCursor(null);
    // Fire-and-forget
    void clearHistory().catch(() => {});
  }, [authToken]);

  if (!authToken) {
    return {
      persistedEntries: [],
      hasMoreHistory: false,
      isLoadingMore: false,
      isLoadingHistory: false,
      firstItemIndex: INITIAL_FIRST_ITEM_INDEX,
      loadMore: () => {},
      deleteEntry: () => {},
      clearAll: () => {},
    };
  }

  return {
    persistedEntries,
    hasMoreHistory,
    isLoadingMore,
    isLoadingHistory,
    firstItemIndex,
    loadMore,
    deleteEntry,
    clearAll,
  };
}
