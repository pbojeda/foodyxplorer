'use client';

// HistoryLoadMoreSentinel — invisible sentinel at top of TranscriptFeed.
// Uses IntersectionObserver to fire onLoadMore when the sentinel enters the viewport
// OF THE SCROLL CONTAINER (`feedRef`), NOT the browser viewport. Setting `root` is
// REQUIRED here because the sentinel lives inside an inner scrollable element; with
// the default null root the observer measures against the browser window and reports
// `isIntersecting: true` whenever the page itself is small enough to contain the
// scroll container — which then triggers an auto-loadMore loop on hydration.
// (BUG-WEB-HISTORY-LOADMORE-IO-ROOT-001, cross-model gemini+codex CONFIRMED 2026-06-04.)
// Keyboard fallback: "Cargar más historial" button (sr-only, focus-not-sr-only).
// Design spec: W18, W23. AC39, AC40.

import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';
import { dlog } from '@/lib/debugScroll';

interface HistoryLoadMoreSentinelProps {
  /**
   * Ref to the scroll container that owns the IntersectionObserver root.
   * Required: without an explicit root the IO measures against the browser viewport,
   * which yields false-positive intersections when the sentinel is scrolled out of
   * the inner overflow container. See BUG-WEB-HISTORY-LOADMORE-IO-ROOT-001.
   */
  feedRef: RefObject<HTMLDivElement>;
  hasMoreHistory: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}

export function HistoryLoadMoreSentinel({
  feedRef,
  hasMoreHistory,
  isLoadingMore,
  onLoadMore,
}: HistoryLoadMoreSentinelProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const rootEl = feedRef.current;
    dlog('Sentinel useEffect run', {
      sentinelExists: !!sentinel,
      rootElExists: !!rootEl,
      hasMoreHistory,
      isLoadingMore,
    });
    // Guard: skip when root not mounted yet — the next render's effect picks it up.
    // Empty feedRef during the initial render commit is normal because the parent's
    // ref assignment runs in the same commit phase; the observer needs a valid root.
    if (!sentinel || !rootEl || !hasMoreHistory || isLoadingMore) {
      dlog('Sentinel useEffect EARLY RETURN');
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        dlog('Sentinel IO callback', {
          isIntersecting: entry?.isIntersecting,
          intersectionRatio: entry?.intersectionRatio,
          targetTop: entry?.boundingClientRect?.top,
          targetBottom: entry?.boundingClientRect?.bottom,
          rootBoundsTop: entry?.rootBounds?.top,
          rootBoundsBottom: entry?.rootBounds?.bottom,
          rootElScrollTop: rootEl.scrollTop,
          rootElScrollHeight: rootEl.scrollHeight,
        });
        if (entry?.isIntersecting) {
          dlog('Sentinel IO → calling onLoadMore');
          onLoadMoreRef.current();
        }
      },
      {
        root: rootEl, // ← scroll container, NOT browser viewport (auditor C1-style fix).
        threshold: 0,
      },
    );

    observer.observe(sentinel);
    dlog('Sentinel IO observe() called', {
      rootElScrollTop: rootEl.scrollTop,
      rootElScrollHeight: rootEl.scrollHeight,
    });

    return () => {
      dlog('Sentinel IO disconnect (cleanup)');
      observer.disconnect();
    };
  }, [feedRef, hasMoreHistory, isLoadingMore]);

  if (!hasMoreHistory && !isLoadingMore) {
    return null;
  }

  return (
    <div>
      {/* Invisible sentinel — triggers IntersectionObserver */}
      <div ref={sentinelRef} className="h-px w-full" aria-hidden="true" />

      {/* Loading skeletons while fetching older entries */}
      {isLoadingMore && (
        <div className="mb-4 space-y-3" aria-label="Cargando entradas anteriores" aria-busy="true">
          <div className="h-4 w-48 rounded-full shimmer-element mb-3" aria-hidden="true" />
          <div className="h-[120px] rounded-2xl shimmer-element" aria-hidden="true" />
          <div className="h-4 w-48 rounded-full shimmer-element mb-3" aria-hidden="true" />
          <div className="h-[120px] rounded-2xl shimmer-element" aria-hidden="true" />
        </div>
      )}

      {/* Keyboard fallback — sr-only by default, visible on focus */}
      {hasMoreHistory && !isLoadingMore && (
        <button
          type="button"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 text-sm text-brand-green underline underline-offset-2 z-10"
          onClick={onLoadMore}
        >
          Cargar más historial
        </button>
      )}
    </div>
  );
}
