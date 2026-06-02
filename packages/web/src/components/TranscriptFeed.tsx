'use client';

// TranscriptFeed — append-only feed container for session transcript + persisted history.
// Design spec: W16 (layout), W17 (entry spacing), W18 (persisted history), W23 (a11y).
// AC32: role="feed", aria-label, aria-busy.
// AC34: renders entries in order with dividers.
// AC37: HistoryPersistenceNudge shown when showPersistenceNudge.
// AC45: HistoryEmptyState for authenticated+empty, EmptyState for anonymous+empty.
// AC46: ClearHistoryButton visible when isAuthenticated and has persisted entries.
// AC47: auto-scroll to bottom on new entries.
// FU2: ResizeObserver hydration scroll-settle + wasNearBottomRef append fix.

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { TranscriptEntryData } from '@/types/history';
import { TranscriptEntry } from './TranscriptEntry';
import { EmptyState } from './EmptyState';
import { HistoryEmptyState } from './HistoryEmptyState';
import { HistoryPersistenceNudge } from './HistoryPersistenceNudge';
import { HistoryLoadMoreSentinel } from './HistoryLoadMoreSentinel';
import { ClearHistoryButton } from './ClearHistoryButton';

// Post-hydration window during which the ResizeObserver re-scrolls as child cards
// grow. Escalate to FU3 if operator AC19 surfaces a repeatable >500ms settle case.
// Named constant per ai-specs/specs/frontend-standards.mdc:35 (UPPER_SNAKE_CASE).
const HYDRATION_RESCROLL_WINDOW_MS = 500;

// FU2 (Bug 1): handle for the hydration ResizeObserver + its self-disconnect timer.
// Held in a ref OUTSIDE React's effect-cleanup cycle (P-C1 — prevents premature
// disconnect on intermediate entries.length changes during the window).
type HydrationHandle = {
  observer: ResizeObserver | null;
  timer: ReturnType<typeof setTimeout> | null;
};

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

  // FU2 (Bug 2): wasNearBottomRef captures user scroll position BEFORE each append
  // commit. Initialized to true (user conventionally starts at bottom). Updated by a
  // scroll event listener so the append effect consults pre-commit state (AC7).
  const wasNearBottomRef = useRef<boolean>(true);

  // FU2 (Bug 2): scroll listener — updates wasNearBottomRef on every user scroll.
  // Mounted once on mount; torn down on unmount (AC7 + AC13a).
  useEffect(() => {
    const container = feedRef.current;
    if (!container) return;
    const handleScroll = () => {
      wasNearBottomRef.current =
        container.scrollTop + container.clientHeight >= container.scrollHeight - 100;
    };
    container.addEventListener('scroll', handleScroll);
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // FU2 (Bug 1): hydration scroll-settle via ResizeObserver.
  //
  // The observer + timer are held in a useRef OUTSIDE React's effect-cleanup cycle.
  // Reason (P-C1): if any subsequent entries.length change (loadMore prepend, session
  // append) arrives within the HYDRATION_RESCROLL_WINDOW_MS window, React would
  // run the prior effect's cleanup → disconnect the observer → re-run the effect
  // → guard-early-return → observer is gone. Holding the handle in a ref prevents
  // this: the effect returns an EMPTY cleanup; teardown is owned exclusively by
  // (a) the 500ms setTimeout callback, or (b) the unmount effect below.
  const hydrationObserverRef = useRef<HydrationHandle>({ observer: null, timer: null });

  // Effect 1 — setup. Keyed to entries.length so it fires on first non-empty.
  // Returns EMPTY cleanup intentionally — see above.
  // FU3: useLayoutEffect (not useEffect) so the synchronous initial scrollTo runs
  // BEFORE the browser paints the first non-empty frame. Without this swap, the
  // user briefly sees the feed at scrollTop=0 between commit and useEffect → jarring
  // "top first, then jump to bottom" perception on reload. The ResizeObserver
  // re-fires still happen post-paint (intentional — they correct for child layout
  // growth that can only be measured after render).
  useLayoutEffect(() => {
    if (entries.length === 0) return;
    if (hasScrolledToBottomOnHydrationRef.current) return;
    const container = feedRef.current;
    if (!container) return;
    hasScrolledToBottomOnHydrationRef.current = true;

    // Synchronous initial scroll — covers the AC5 fallback path AND seeds position
    // before the observer's first re-fire (W18: "no animation on initial mount").
    try {
      container.scrollTo({ top: container.scrollHeight, behavior: 'instant' });
    } catch {
      // jsdom does not implement element.scrollTo — safe to ignore in tests
    }

    if (typeof ResizeObserver === 'undefined') return; // AC5: fallback already scrolled above.

    const observer = new ResizeObserver(() => {
      try {
        container.scrollTo({ top: container.scrollHeight, behavior: 'instant' });
      } catch {
        // jsdom — safe to ignore
      }
    });
    observer.observe(container);

    const timer = setTimeout(() => {
      observer.disconnect();
      hydrationObserverRef.current.observer = null;
      hydrationObserverRef.current.timer = null;
    }, HYDRATION_RESCROLL_WINDOW_MS);

    hydrationObserverRef.current.observer = observer;
    hydrationObserverRef.current.timer = timer;

    // Intentional: NO cleanup returned. Teardown owned by timer + unmount effect.
  }, [entries.length]);

  // Effect 2 — unmount-only teardown. Guarantees no leak if unmounted mid-window
  // AND resets hasScrolledToBottomOnHydrationRef so React 18 Strict Mode's synthetic
  // mount→cleanup→mount cycle in dev correctly re-installs the observer on the
  // re-mount (per /review-spec follow-up: without the reset, the synthetic remount
  // hits the guard true and observer is never re-attached → dev local browser
  // verification of the fix is broken even though prod next-start is correct).
  useEffect(() => {
    const handleRef = hydrationObserverRef;
    const guardRef = hasScrolledToBottomOnHydrationRef;
    return () => {
      const handle = handleRef.current;
      if (handle.timer !== null) clearTimeout(handle.timer);
      if (handle.observer !== null) handle.observer.disconnect();
      handle.observer = null;
      handle.timer = null;
      guardRef.current = false;
    };
  }, []);

  // FU2 (Bug 2): auto-scroll when new session entries are appended.
  // Reads wasNearBottomRef (pre-commit position captured by scroll listener) at the
  // TOP of the effect — no post-commit scrollHeight math (that is the source of the
  // race: after React commits a new entry, scrollHeight has already jumped). AC8/AC9.
  const prevEntriesLengthRef = useRef(entries.length);
  useEffect(() => {
    const container = feedRef.current;
    if (!container) return;

    const entryCountGrew = entries.length > prevEntriesLengthRef.current;
    prevEntriesLengthRef.current = entries.length;

    if (!entryCountGrew) return;
    if (!wasNearBottomRef.current) return; // pre-commit position captured by scroll listener

    // FU3 follow-up (code-review MAJOR-2): on a [] → [N] async hydration commit,
    // both Effect 1 (instant scroll) AND this Effect (smooth scroll) fire. Currently
    // benign — both target scrollHeight; the smooth call is optimized to no-op by
    // browsers because the position already matches. A surgically precise fix
    // (render-scoped flag set by Effect 1, read+reset here) was deferred to FU3 to
    // avoid extensive test surgery on a low-impact concern. The ResizeObserver
    // re-fires within the window guarantee correctness either way. See ticket
    // Completion Log for the cross-model discussion.

    try {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    } catch {
      // jsdom does not implement element.scrollTo — safe to ignore in tests
    }
  }, [entries.length]);

  // Capture scroll position before load-more prepends older entries.
  // After DOM update, restore position so the viewport doesn't jump.
  // Capture stays in useEffect: it only READS layout into refs, no write.
  useEffect(() => {
    if (isLoadingMore) {
      const container = feedRef.current;
      if (!container) return;
      prevScrollHeightRef.current = container.scrollHeight;
      prevScrollTopRef.current = container.scrollTop;
    }
  }, [isLoadingMore]);

  // FU3: restore uses useLayoutEffect so the corrective scrollTop write happens
  // BEFORE the browser paints the post-prepend frame. Without this swap, the user
  // briefly sees the prepended (older) entries at the top before the JS restores
  // their original viewport anchor → flicker. The pre-existing F-WEB-HISTORY
  // capture/restore math is untouched.
  useLayoutEffect(() => {
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
