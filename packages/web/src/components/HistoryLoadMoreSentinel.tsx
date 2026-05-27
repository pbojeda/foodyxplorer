'use client';

// HistoryLoadMoreSentinel — invisible sentinel at top of TranscriptFeed.
// Uses IntersectionObserver to fire onLoadMore when the sentinel enters the viewport.
// Keyboard fallback: "Cargar más historial" button (sr-only, focus-not-sr-only).
// Design spec: W18, W23. AC39, AC40.

import { useEffect, useRef } from 'react';

interface HistoryLoadMoreSentinelProps {
  hasMoreHistory: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}

export function HistoryLoadMoreSentinel({
  hasMoreHistory,
  isLoadingMore,
  onLoadMore,
}: HistoryLoadMoreSentinelProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMoreHistory || isLoadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          onLoadMoreRef.current();
        }
      },
      { threshold: 0 }
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [hasMoreHistory, isLoadingMore]);

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
