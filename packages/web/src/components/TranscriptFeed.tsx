'use client';

// TranscriptFeed — append-only feed container for session transcript + persisted history.
// Design spec: W16 (layout), W17 (entry spacing), W18 (persisted history), W23 (a11y).
// AC32: role="feed", aria-label, aria-busy.
// AC34: renders entries in order with dividers.
// AC37: HistoryPersistenceNudge shown when showPersistenceNudge.
// AC45: HistoryEmptyState for authenticated+empty, EmptyState for anonymous+empty.
// AC46: ClearHistoryButton visible when isAuthenticated and has persisted entries.
// AC47: auto-scroll to bottom on new entries.
// FU4: unified 4-effect scroll state machine (research doc §7.1).

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { TranscriptEntryData } from '@/types/history';
import { dlog } from '@/lib/debugScroll';
import { TranscriptEntry } from './TranscriptEntry';
import { EmptyState } from './EmptyState';
import { HistoryEmptyState } from './HistoryEmptyState';
import { HistoryPersistenceNudge } from './HistoryPersistenceNudge';
import { HistoryLoadMoreSentinel } from './HistoryLoadMoreSentinel';
import { ClearHistoryButton } from './ClearHistoryButton';

// Post-hydration window (500ms) — ResizeObserver re-scrolls as child cards grow.
// FU4: named HYDRATION_RESCROLL_WINDOW_MS (hydration path only).
const HYDRATION_RESCROLL_WINDOW_MS = 500;

// Post-append window (1500ms) — longer than hydration because API response latency
// determines when the shimmer→card transition fires (research doc §7.1 + §3.3).
// FU4 /review-plan design note: 1500ms is the minimum to cover Slow 3G API latency
// (~1200ms) plus layout settle. Operator AC25 (Slow 3G test) validates this choice.
const APPEND_BOTTOM_LOCK_WINDOW_MS = 1500;

// FU4: discriminated union enforcing single-mode-at-a-time for scroll state.
// No two effects can simultaneously mutate scroll geometry — each reads `mode` and
// early-returns when it does not match. The `timerId` field in 'bottom-lock' is
// required by /review-plan CRITICAL-1: the observer alone doesn't disconnect if
// layout settles without triggering a resize event (AC6 test would fail).
// See: docs/research/transcript-feed-scroll-architecture-2026-06-03.md §7.1
type ScrollLockState =
  | { mode: 'idle' }
  | {
      mode: 'bottom-lock';
      deadline: number;
      observer: ResizeObserver;
      timerId: ReturnType<typeof setTimeout> | null;
    }
  | { mode: 'prepending'; prevScrollHeight: number; prevScrollTop: number };

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
  // ---- Refs (8 total — see research doc §7.1 + fix-loop round 2 2026-06-03) ----

  // Container DOM ref (unchanged from FU1) — the scroll viewport (flex-1 child of
  // HablarShell's h-[100dvh] flex-col). Used as the scroll target throughout.
  const feedRef = useRef<HTMLDivElement>(null);

  // FU4 round 2 (2026-06-03): inner-content wrapper ref — the ResizeObserver target.
  //
  // Why a separate ref: feedRef points at the flex-1 scroll container; its own box
  // dimensions are constrained by the parent's fixed h-[100dvh], so per W3C Resize
  // Observer §3.1/§3.4.8 the observer's `isActive()` compares contentBox/borderBox
  // sizes that NEVER change when only scrollHeight (internal content) grows. Result:
  // observe(feedRef) fires once on initial attach, then is silent during the very
  // shimmer→card mutations the bottom-lock is supposed to catch (AC20-A bug).
  //
  // feedContentRef wraps every growth-bearing child inside the scroll viewport. Its
  // box height equals its content height (block flow, no flex constraint) — so the
  // observer fires every time shimmer→card / new entry / skeleton growth happens.
  //
  // Cross-model verification 2026-06-03 (gemini + codex) CONFIRMED.
  // See: /tmp/audit-c1-verification-2026-06-03/, /tmp/c1-repro.html.
  const feedContentRef = useRef<HTMLDivElement>(null);

  // Updated by scroll listener before each append commit (FU2 Bug 2).
  const wasNearBottomRef = useRef<boolean>(true);

  // One-shot guard for hydration path (component lifetime; resets on unmount for
  // Strict Mode parity — Effect D cleanup resets it so synthetic remount re-fires).
  const hasScrolledToBottomOnHydrationRef = useRef(false);

  // Tracks previous entries.length; updated at end of Effect B.
  const prevEntriesLengthRef = useRef(entries.length);

  // FU4 NEW: last-seen entries[0]?.entryId; used by Effect B to detect prepend vs append.
  const firstEntryIdRef = useRef<string>('');

  // FU4 NEW: last-seen entries[N-1]?.entryId; used by Effect B to detect append vs prepend.
  const lastEntryIdRef = useRef<string>('');

  // FU4 NEW: discriminated union enforcing single-mode-at-a-time.
  const scrollLockRef = useRef<ScrollLockState>({ mode: 'idle' });

  // ---- Effect A: scroll listener (unchanged from FU2) ----
  // Mounted once; updates wasNearBottomRef on every user scroll.
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

  // ---- Internal helpers for bottom-lock observer (FU4 AC1, AC2, AC5, AC6) ----
  //
  // startBottomLock: creates a ResizeObserver + paired setTimeout for a duration window
  // during which every container resize re-fires scrollTo({instant}) to keep the
  // viewport anchored at the bottom. Used by both hydration and append paths.
  //
  // CRITICAL-1 (/review-plan): the observer is paired with an EXPLICIT setTimeout.
  // If layout settles without a resize event, the observer callback never fires and
  // AC6 (deadline cleanup) would never trigger. The setTimeout guarantees teardown
  // regardless of whether a resize event arrives.
  //
  // See: docs/research/transcript-feed-scroll-architecture-2026-06-03.md §7.1
  // Container style overflow-anchor:none (see JSX): JS unambiguously owns scroll.

  const stopBottomLock = useCallback(
    (reason: 'timer' | 'user-scroll' | 'deadline-defensive' | 'unmount' | 'mode-transition') => {
      const lock = scrollLockRef.current;
      if (lock.mode !== 'bottom-lock') return;
      if (lock.timerId !== null) clearTimeout(lock.timerId);
      lock.observer.disconnect();
      scrollLockRef.current = { mode: 'idle' };
      // reason is available for future telemetry; suppress unused-var lint.
      void reason;
    },
    [],
  );

  const startBottomLock = useCallback(
    (container: HTMLDivElement, durationMs: number) => {
      if (scrollLockRef.current.mode === 'bottom-lock') {
        // Extend deadline if already locked: clear existing timer + restart.
        const existing = scrollLockRef.current;
        if (existing.timerId !== null) clearTimeout(existing.timerId);
        existing.deadline = Date.now() + durationMs;
        existing.timerId = setTimeout(() => stopBottomLock('timer'), durationMs);
        return;
      }
      if (typeof ResizeObserver === 'undefined') return; // AC5: fallback already scrolled above.

      const observer = new ResizeObserver(() => {
        const lock = scrollLockRef.current;
        if (lock.mode !== 'bottom-lock') return;
        if (!wasNearBottomRef.current) {
          // User scrolled away — cancel early (AC5).
          stopBottomLock('user-scroll');
          return;
        }
        // Defensive: timer should handle this, but check deadline as safety net.
        if (Date.now() > lock.deadline) {
          stopBottomLock('deadline-defensive');
          return;
        }
        try {
          container.scrollTo({ top: container.scrollHeight, behavior: 'instant' });
        } catch {
          // jsdom does not implement element.scrollTo — safe to ignore in tests
        }
      });
      // FU4 round 2 (2026-06-03): observe the inner content wrapper, NOT the flex-1
      // scroll container — the latter's box stays constrained so the callback would
      // never fire on internal scrollHeight growth (auditor C1 BLOCKER, confirmed by
      // gemini + codex cross-model 2026-06-03 against W3C Resize Observer §3.1).
      // Fallback to `container` for safety if the wrapper ref isn't mounted yet —
      // in that case we still get the initial-attach fire (better than nothing).
      const observerTarget = feedContentRef.current ?? container;
      observer.observe(observerTarget);

      const timerId = setTimeout(() => stopBottomLock('timer'), durationMs);

      scrollLockRef.current = {
        mode: 'bottom-lock',
        deadline: Date.now() + durationMs,
        observer,
        timerId,
      };
    },
    [stopBottomLock],
  );

  // ---- Effect B: unified hydration + append mutation handler (FU4) ----
  //
  // useLayoutEffect — must write scroll BEFORE paint to prevent flicker.
  // FU3 lesson: any useEffect↔useLayoutEffect swap on scroll-writing effects
  // requires full Path B review (research doc §5.4).
  //
  // Dep array includes first/last entryId signals (Codex C1) so the effect fires
  // when endpoints flip even if length stays equal (rare clear-then-search batched).
  //
  // Decision table for branch routing:
  //   entries.length=0           → early return (no-op)
  //   !hydrationFired            → hydration path (one-shot, ref-guarded)
  //   firstChanged && !lastChanged → pure prepend; Effect C handles restore; B no-op
  //   prepending mode active      → AC14b: do not clobber capture baseline
  //   else (last changed, or both changed)  → append path
  useLayoutEffect(() => {
    if (entries.length === 0) {
      // Update length ref on empty so deletion guard doesn't misfire after clear-all.
      prevEntriesLengthRef.current = 0;
      return;
    }
    const container = feedRef.current;
    if (!container) return;

    const currentFirstId = entries[0]?.entryId ?? '';
    const currentLastId = entries[entries.length - 1]?.entryId ?? '';

    if (!hasScrolledToBottomOnHydrationRef.current) {
      // ---- Hydration path (one-shot per component lifetime) ----
      dlog('Effect B hydration BEFORE scrollTo', {
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        entriesLength: entries.length,
        firstId: currentFirstId,
        lastId: currentLastId,
      });
      hasScrolledToBottomOnHydrationRef.current = true;
      try {
        container.scrollTo({ top: container.scrollHeight, behavior: 'instant' });
      } catch {
        // jsdom — safe to ignore
      }
      dlog('Effect B hydration AFTER scrollTo', {
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
      });
      startBottomLock(container, HYDRATION_RESCROLL_WINDOW_MS);
      firstEntryIdRef.current = currentFirstId;
      lastEntryIdRef.current = currentLastId;
      prevEntriesLengthRef.current = entries.length;
      return;
    }

    const firstChanged = currentFirstId !== firstEntryIdRef.current;
    const lastChanged = currentLastId !== lastEntryIdRef.current;

    if (firstChanged && !lastChanged) {
      // ---- Pure prepend: first entryId changed, last is stable ----
      // Effect C handles restore from the handleLoadMore-captured baseline.
      // Effect B does NOT touch scroll here.
      firstEntryIdRef.current = currentFirstId;
      prevEntriesLengthRef.current = entries.length;
      return;
    }

    if (!firstChanged && !lastChanged && entries.length === prevEntriesLengthRef.current) {
      // No structural change (e.g. in-place isLoading mutation shimmer→card).
      // entries.length AND both endpoints unchanged → Effect B is a no-op.
      return;
    }

    if (entries.length < prevEntriesLengthRef.current) {
      // ---- Deletion path: entries shrank → no scroll, just update refs ----
      firstEntryIdRef.current = currentFirstId;
      lastEntryIdRef.current = currentLastId;
      prevEntriesLengthRef.current = entries.length;
      return;
    }

    if (scrollLockRef.current.mode === 'prepending') {
      // ---- AC14b: active prepend in flight — do not clobber the baseline ----
      // Update refs but skip bottom-lock to avoid conflicting with Effect C.
      if (lastChanged) lastEntryIdRef.current = currentLastId;
      if (firstChanged) firstEntryIdRef.current = currentFirstId;
      prevEntriesLengthRef.current = entries.length;
      return;
    }

    // ---- Append path (last entryId changed, or both changed = clear-then-search) ----
    // AC13: both-changed routes here (NOT re-hydration). hasScrolledToBottomOnHydrationRef
    // remains true for component lifetime; clear-all does not re-arm it (AC14c).
    if (wasNearBottomRef.current) {
      try {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      } catch {
        // jsdom — safe to ignore
      }
      startBottomLock(container, APPEND_BOTTOM_LOCK_WINDOW_MS);
    }

    firstEntryIdRef.current = currentFirstId;
    lastEntryIdRef.current = currentLastId;
    prevEntriesLengthRef.current = entries.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.length, entries[0]?.entryId ?? '', entries[entries.length - 1]?.entryId ?? '']);

  // ---- Effect C: loadMore restore (FU4 — replaces old Effects 4 + 5) ----
  //
  // useLayoutEffect: pre-paint write preserves FU3's flicker fix.
  // Reads ONLY from scrollLockRef.mode==='prepending' (captured pre-skeleton by
  // handleLoadMore callback). If idle, early-returns. After restore, sets idle.
  //
  // /review-plan IMPORTANT-3: if feedRef.current is null at this point, we still
  // set mode=idle so stale prepending state doesn't block future operations.
  useLayoutEffect(() => {
    if (isLoadingMore) {
      dlog('Effect C skipped (isLoadingMore=true)');
      return; // only run on false transition
    }
    const lock = scrollLockRef.current;
    if (lock.mode !== 'prepending') {
      dlog('Effect C skipped (mode!=prepending)', { mode: lock.mode });
      return;
    }
    const container = feedRef.current;
    if (!container) {
      dlog('Effect C BAILED (feedRef.current is null)', { mode: lock.mode });
      scrollLockRef.current = { mode: 'idle' };
      return;
    }
    const delta = container.scrollHeight - lock.prevScrollHeight;
    dlog('Effect C RESTORE', {
      prevScrollTop: lock.prevScrollTop,
      prevScrollHeight: lock.prevScrollHeight,
      currentScrollHeight: container.scrollHeight,
      delta,
      willSetScrollTop: delta > 0 ? lock.prevScrollTop + delta : container.scrollTop,
      scrollTopBefore: container.scrollTop,
    });
    if (delta > 0) {
      container.scrollTop = lock.prevScrollTop + delta;
    }
    dlog('Effect C RESTORE AFTER', { scrollTop: container.scrollTop });
    scrollLockRef.current = { mode: 'idle' };
  }, [isLoadingMore]);

  // ---- Effect D: unmount cleanup (generalised from FU2 Effect 2) ----
  //
  // Handles all 3 modes: bottom-lock → disconnect; prepending → reset; idle → no-op.
  // Resets all 7 refs for Strict Mode dev parity (synthetic mount→cleanup→mount
  // in React 18 dev re-runs the hydration branch on the remount because ref=false).
  useEffect(() => {
    const lockRef = scrollLockRef;
    const guardRef = hasScrolledToBottomOnHydrationRef;
    const firstIdRef = firstEntryIdRef;
    const lastIdRef = lastEntryIdRef;
    const lengthRef = prevEntriesLengthRef;
    const nearBottomRef = wasNearBottomRef;
    return () => {
      const lock = lockRef.current;
      if (lock.mode === 'bottom-lock') {
        if (lock.timerId !== null) clearTimeout(lock.timerId);
        lock.observer.disconnect();
      }
      lockRef.current = { mode: 'idle' };
      guardRef.current = false;
      // Reset entryId refs so Strict Mode synthetic remount re-installs correctly.
      firstIdRef.current = '';
      lastIdRef.current = '';
      lengthRef.current = 0;
      nearBottomRef.current = true;
    };
  }, []);

  // ---- handleLoadMore: wraps props.onLoadMore with pre-skeleton capture (FU4) ----
  //
  // CRITICAL: captures scrollHeight/scrollTop SYNCHRONOUSLY before calling
  // props.onLoadMore() which triggers setIsLoadingMore(true) → skeleton render.
  // If we captured AFTER the skeleton mount, the baseline is polluted by ~248px.
  //
  // /review-plan IMPORTANT-3: if feedRef.current is null (transient tear-down race),
  // STILL call onLoadMore — losing the baseline is acceptable; losing pagination is not.
  // Effect C detects mode==='idle' and skips restoration gracefully.
  //
  // If bottom-lock is active (append in flight), transition to prepending — use
  // stopBottomLock to cleanly disconnect the observer before setting the new mode.
  const handleLoadMore = useCallback(() => {
    const container = feedRef.current;
    dlog('handleLoadMore CALLED', {
      containerExists: !!container,
      currentMode: scrollLockRef.current.mode,
      scrollTop: container?.scrollTop,
      scrollHeight: container?.scrollHeight,
      clientHeight: container?.clientHeight,
    });
    if (container) {
      if (scrollLockRef.current.mode === 'bottom-lock') {
        stopBottomLock('mode-transition');
      }
      scrollLockRef.current = {
        mode: 'prepending',
        prevScrollHeight: container.scrollHeight,
        prevScrollTop: container.scrollTop,
      };
      dlog('handleLoadMore CAPTURED', {
        prevScrollHeight: container.scrollHeight,
        prevScrollTop: container.scrollTop,
      });
    }
    // ALWAYS call parent's onLoadMore — even without a captured baseline.
    onLoadMore();
  }, [onLoadMore, stopBottomLock]);

  const hasPersisted = entries.some((e) => e.isPersisted);
  const isEmpty = entries.length === 0;

  return (
    // overflow-anchor:none: JS unambiguously owns scroll restoration.
    // Eliminates race between Effect C's pre-paint write and the browser's native
    // anchor-adjustment algorithm. See research doc §7.1 + §6.5.
    // NOT a Tailwind class — Tailwind v3 has no overflow-anchor utility.
    <div
      ref={feedRef}
      role="feed"
      aria-label="Historial de consultas"
      aria-busy={isLoadingHistory ? true : undefined}
      className="flex-1 overflow-y-auto px-4 pt-4 pb-[calc(9rem+env(safe-area-inset-bottom))] lg:max-w-2xl lg:mx-auto w-full"
      style={{ overflowAnchor: 'none' }}
    >
      {/* FU4 round 2 (2026-06-03): inner content wrapper — ResizeObserver target.
          The wrapper's box height grows with its children (block flow), unlike the
          flex-1 parent whose box stays constrained by HablarShell's h-[100dvh].
          See feedContentRef declaration for the auditor C1 background. */}
      <div ref={feedContentRef} data-testid="feed-content">
        {/* Load-more sentinel — at the very top, above all entries.
            feedRef is REQUIRED so the sentinel's IntersectionObserver uses the
            scroll container as its root (not the browser viewport, which would
            spuriously fire on hydration). See BUG-WEB-HISTORY-LOADMORE-IO-ROOT-001. */}
        {isAuthenticated && (hasMoreHistory || isLoadingMore) && (
          <HistoryLoadMoreSentinel
            feedRef={feedRef}
            hasMoreHistory={hasMoreHistory}
            isLoadingMore={isLoadingMore}
            onLoadMore={handleLoadMore}
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
    </div>
  );
}
