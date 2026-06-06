# F-WEB-HISTORY-FU6: TranscriptFeed virtuoso architectural rewrite

**Feature:** F-WEB-HISTORY-FU6 | **Type:** Frontend-Architecture-Rewrite | **Priority:** High (3 user-facing scroll bugs blocking develop→main release)
**Status:** Ready for Merge | **Branch:** `feature/F-WEB-HISTORY-FU6-virtuoso-rewrite`
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-06-06 | **Tier:** Standard | **Dependencies:** F-WEB-HISTORY-FU4 done @ `ff4abd7`
**Research:** `docs/research/transcript-feed-scroll-architecture-2026-06-03.md` (prior cross-model, FU4 era — superseded by this rewrite, kept as history) + cross-model research 2026-06-06 (gemini + codex, 12 web searches — this ticket)
**Methodology:** development-workflow Standard tier, MANDATORY cross-model `/review-spec` + `/review-plan` (memory `feedback_multi_round_review`)

---

## Spec

### Description

**Trigger — 10 failed iterations:** FU1 → FU2 → FU3 → FU4 round 1 → FU4 round 2 (PR #308) → PR #310 IO root → PR #311 debug instrumentation → PR #312 Effect B prepend → PR #313 delayed gate. None closed AC24.

**Persistent symptom:** `feedRef.scrollTop` mysteriously resets to `0` in the ~2.7ms window between Effect B's synchronous `scrollTo({ top: scrollHeight, behavior: 'instant' })` and the next post-paint `useEffect` of the sentinel. Root cause was never identified despite exhaustive diagnostic instrumentation across PR #311 and subsequent rounds.

**Owner directive 2026-06-06:** stop patching; rebuild on canonical chat-feed foundation.

**Cross-model research convergence (gemini + codex, 12 web searches, 2026-06-06):** library-owned scroll is the canonical solution for chat/feed/timeline UIs. Two candidates evaluated:

- **column-reverse CSS** — rejected: breaks `role="feed"` chronological DOM order (ARIA accessibility regression); has known Firefox/Safari reverse-scroll quirks under content growth.
- **react-virtuoso `<Virtuoso>`** (MIT, free tier) — selected: purpose-built for chat semantics, battle-tested via Stream Chat SDK, handles hydration/append/prepend scroll internally, DOM order remains chronological (chronological = oldest-first, newest at bottom), zero manual `scrollTop` writes.

The current TranscriptFeed scroll state machine (FU4, ~578 LOC, 9 refs, 4 effects, `scrollLockRef` discriminated union, `hydrationReady` gate, `debugScroll` instrumentation) has reached a methodological dead end. This ticket replaces it entirely.

**Memory references for methodology rationale:**
- `project_scroll_arch_decision_2026_06_06` — owner directive log: stop patching, rebuild on library-owned scroll.
- `feedback_jsdom_layout_ac_gap` — jsdom cannot close browser scroll ACs; operator empirical gate is authoritative.
- `feedback_mock_boundary_integration_gap` — mock boundaries masked integration defects across FU1–FU4.
- `feedback_layout_effect_phase_swap_needs_full_review` — useEffect↔useLayoutEffect swaps on scroll-writing effects require Path B; phase swaps unmask deeper races (FU3→FU4 chain).
- `feedback_pre_commit_arch_discussion` — architectural pivots require user discussion before commit even after cross-model convergence.
- `feedback_multi_round_review` — high-stakes architecture decisions require multi-round cross-model review (Codex + Gemini) until 85%+ confidence.

### Problem

The current TranscriptFeed scroll state machine (FU4, ~578 LOC, 9 refs, 4 effects, `scrollLockRef` discriminated union, `hydrationReady` gate, `debugScroll` instrumentation) does NOT close AC24 in real browsers despite 10 iterations. The empirical `scrollTop=0` reset symptom remains undiagnosed. The manual approach has reached a methodological dead end.

Three user-facing scroll bugs remain open and block the develop→main release:

- **AC24 (hydration):** `/hablar` reload with ≥10 persisted entries does not reliably land at the newest entry. `scrollTop` resets to 0 in the ~2.7ms window after Effect B fires.
- **AC25 (append):** New search card's bottom is truncated under the 144px input bar after the shimmer→NutritionCard transition.
- **AC26 (loadMore prepend):** Viewport jumps when older entries prepend after scrolling up to the sentinel threshold.

### Approach

#### Phase 1 — HablarShell precondition fix

Rewrite `HablarShell.tsx:138-145` to derive the rendered entries list synchronously via `useMemo` instead of mirroring `persistedEntries` into local state via `useEffect`.

**Today's problem:** the `useEffect` that mirrors `persistedEntries` fires asynchronously after the first paint. This forces TranscriptFeed to mount once with `entries=[]` (during fetch) and re-render with `entries=[10 persisted]` after the effect fires. Any chat feed library will mis-handle this empty-first mount. Today the `useEffect` is keyed on `persistedIdsKey = persistedEntries.map(e => e.entryId).join(',')` (HablarShell.tsx:138-145). This forces the effect to refire on every persisted-entries change and creates a post-paint render lag.

**New state split:**
- `sessionEntries` remains local state — the **mutable session-owned slice**. Operations that today operate on the unified `entries` state continue to operate on `sessionEntries` after the split:
  - Append: text/photo/voice flows `setSessionEntries(prev => [...prev, pendingEntry])` adds an in-flight entry.
  - Settle: success/error transitions `setSessionEntries(prev => prev.map(e => e.entryId === pendingEntry.entryId ? { ...e, isLoading: false, result: data } : e))` — entryId-based in-place mutation of the same entry record.
  - Remove: stale request abort, photo `INVALID_FILE_TYPE`, voice cancel — all remove via `setSessionEntries(prev => prev.filter(e => e.entryId !== pendingEntry.entryId))`.
  - Cross-read (e.g., `handleDishSelect` reads photo entries): now reads `[...persistedEntries, ...sessionEntries]` composed via `useMemo`, OR can pass the unified array as a memoized value through context if cleaner.
- `persistedEntries` comes directly from `useSearchHistory` (no local mirror).
- `allEntries` is composed in the render path: `const allEntries = useMemo(() => [...persistedEntries, ...sessionEntries], [persistedEntries, sessionEntries])`.
- TranscriptFeed receives `entries={allEntries}`.

**Mount-gating for hydrated data:** `useMemo` alone does NOT eliminate the empty-first mount — `useSearchHistory` still initializes `persistedEntries=[]` and fetches asynchronously. TranscriptFeed defers mounting `<Virtuoso>` until `isLoadingHistory === false` (see AC1b). This gate is load-bearing: without it, `initialTopMostItemIndex` fires with `entries.length = 0` and Virtuoso never receives the correct initial scroll position.

**Result:** Virtuoso mounts exactly once with the full hydrated set. `initialTopMostItemIndex={Math.max(0, entries.length - 1)}` fires correctly on first and only mount.

#### Phase 2 — TranscriptFeed Virtuoso integration

Replace the 578 LOC manual scroll machinery with `<Virtuoso>` from `react-virtuoso` (MIT, free `Virtuoso` component — NOT the paid `VirtuosoMessageList`).

**Virtuoso prop wiring:**

| Prop | Value | Replaces |
|------|-------|----------|
| `data` | `entries` (oldest-first, chronological DOM order) | manual data iteration |
| `initialTopMostItemIndex` | `Math.max(0, entries.length - 1)` | Effect B hydration branch + bottom-lock observer + `hydrationReady` gate |
| `firstItemIndex` | `firstItemIndex` state (starts at 0; decremented by 10 on each `loadMore` resolve) | Effect C prepend restore + `prevEntriesLengthRef` scroll math; ensures Virtuoso preserves viewport anchor on prepend via stable absolute indices |
| `followOutput` | `"smooth"` | Effect B append branch + `wasNearBottomRef` pin check (covers new-item count-increase scroll; NOT sufficient for in-place resize — see `ref` + `atBottomStateChange`) |
| `ref` | `virtuosoRef` (`useRef<VirtuosoHandle>(null)`) | nothing (new — needed for imperative `autoscrollToBottom()` call on in-place resize) |
| `atBottomStateChange` | `(atBottom) => { atBottomRef.current = atBottom; }` | `wasNearBottomRef` (tracks whether user is at bottom, for in-place resize re-scroll decision) |
| `startReached` | `loadMore` (from `useSearchHistory`) | `HistoryLoadMoreSentinel` + its `IntersectionObserver` + `hydrationReady` gate. **The internal `loadMoreInFlightRef` synchronous guard inside `useSearchHistory.loadMore()` is PRESERVED** (defends against rapid double-fire before `isLoadingMore` commits). |
| `computeItemKey` | `(_, entry) => entry.entryId` | stable per-entry key for prepend/delete identity preservation; replaces React `key={entry.entryId}` reliance |
| `itemContent` | `(idx, entry) => <TranscriptEntry key={entry.entryId} entry={entry} ... />` | manual `entries.map(...)` |
| `components` | `{ Header, Footer, ScrollSeekPlaceholder }` (TBD in Plan) | inline conditional renders |

**`components` slots (preliminary — Plan agent finalizes):**
- `Header`: composite slot rendering (when `hasMoreHistory && !isLoadingMore`) the sr-only focusable "Cargar más historial" button; (when `isLoadingMore`) the loading skeleton; (when `entries.length === 0 && !hasMoreHistory`) the `HistoryEmptyState`. `ClearHistoryButton` placement TBD by Plan agent (Header or Footer — anonymous/authenticated branching).
- `Footer`: `HistoryPersistenceNudge` if applicable (anonymous user prompt).
- `ScrollSeekPlaceholder`: lightweight placeholder during fast scroll (optional — only if performance testing warrants it).

**DOM order:** chronological (oldest-first). `role="feed"` + `aria-label="Historial de consultas"` stay on the Virtuoso root via `aria` prop or wrapper. Screen reader reads entries in chronological order (oldest→newest). This is the key a11y reason column-reverse was rejected.

**Scroll container:** Virtuoso owns the scroll container. The outer `feedRef` `<div>` wrapper with `overflow-y-auto`, `overflowAnchor:'none'`, and `feedContentRef` inner wrapper are all removed.

#### Phase 3 — Code deletion sweep

After Virtuoso integration is verified green, delete all FU4-era machinery in a single commit:

**Files deleted entirely:**
- `packages/web/src/components/HistoryLoadMoreSentinel.tsx`
- `packages/web/src/__tests__/components/HistoryLoadMoreSentinel.test.tsx`
- `packages/web/src/lib/debugScroll.ts`

**Refs removed from TranscriptFeed:**
- `scrollLockRef` (discriminated union + `ScrollLockState` type)
- `wasNearBottomRef`
- `hasScrolledToBottomOnHydrationRef`
- `firstEntryIdRef`
- `lastEntryIdRef`
- `hydrationGateTimerRef`
- `prevEntriesLengthRef`
- `feedContentRef`

**Functions/effects removed:**
- `startBottomLock` / `stopBottomLock`
- `handleLoadMore` (replaced by `startReached` prop)
- Effect A (scroll listener — Virtuoso owns scroll events)
- Effect B (hydration + append handler)
- Effect C (prepend restore)
- Effect D (unmount cleanup)
- All `dlog(...)` callsites

**Container JSX removed:** `overflow-y-auto` wrapper div, `style={{ overflowAnchor: 'none' }}` inline style, `feedContentRef` inner wrapper div.

### API Changes

None. This is a pure frontend architectural rewrite. No new endpoints, no schema changes.

### Data Model Changes

None. `SearchHistory` schema, `persistedEntries` shape, and `sessionEntries` shape are unchanged.

### UI Changes

**HablarShell.tsx:** State split (remove `useEffect` mirror of `persistedEntries`; add `useMemo` composition). No visible UI change — this is a render-timing fix only.

**TranscriptFeed.tsx:** Single `<Virtuoso>` replaces the scroll container + manual entry list. Visual output is identical (same `TranscriptEntry` components, same empty states, same persistence nudge). The scroll behavior changes from hand-rolled JS to library-managed — users experience smooth, correct scroll.

**HistoryLoadMoreSentinel.tsx:** Deleted. `startReached` prop replaces the IntersectionObserver-based sentinel entirely.

**`lib/debugScroll.ts`:** Deleted. No user-visible change.

### Edge Cases

1. **Empty entries on mount:** `entries.length === 0` — Virtuoso renders the `Header` component slot (empty state). `initialTopMostItemIndex` with `entries.length - 1 = -1` must be guarded: pass `Math.max(0, entries.length - 1)` to avoid Virtuoso warnings or undefined behavior.

2. **Anonymous user (no persisted history):** `persistedEntries=[]`, `sessionEntries` grows via session. `useMemo` returns only session entries. `followOutput="smooth"` handles append auto-scroll. Verified identical to current behavior.

3. **`followOutput` pin-aware behavior:** When user is scrolled up (not pinned to bottom), a new `sessionEntries` append does NOT auto-scroll (Virtuoso's built-in pin logic). This matches the intended UX and replaces `wasNearBottomRef` semantics.

4. **`startReached` deduplication:** Virtuoso calls `startReached` when the user scrolls to the top. Virtuoso may fire `startReached` multiple times during a rapid scroll burst before `isLoadingMore` React state commits. The authoritative synchronous guard is the existing `loadMoreInFlightRef` inside `useSearchHistory.loadMore()` — it short-circuits on the second call before React state is stale. The Virtuoso `startReached` prop simply invokes `loadMore` which short-circuits if `loadMoreInFlightRef.current === true`. The `isLoadingMore` state check (`hasMoreHistory` false guard) remains as a secondary guard for the idle case.

5. **`initialTopMostItemIndex` on re-mount (Strict Mode):** React 18 dev StrictMode causes mount→unmount→mount. Virtuoso's `initialTopMostItemIndex` only applies on the FIRST mount. The synthetic remount will re-apply it. Verify no double-loadMore fires (Strict Mode parity AC).

6. **Prepend anchor (conservative `firstItemIndex` strategy — POSITIVE-ONLY values per Virtuoso docs):** Virtuoso's `firstItemIndex` prop is the official API for inverse infinite scrolling. Without it, plain `data` prepends may not guarantee viewport anchor preservation (Virtuoso's `firstItemIndex` API exists specifically because index-based rendering needs to know the "absolute" index of the first visible item). **Per Virtuoso v4.18.7 docs at `https://virtuoso.dev/virtuoso-api/interfaces/VirtuosoProps/`, `firstItemIndex` MUST stay positive.** Implementation: maintain `const [firstItemIndex, setFirstItemIndex] = useState(INITIAL_FIRST_ITEM_INDEX)` in TranscriptFeed, where `INITIAL_FIRST_ITEM_INDEX = 1_000_000` (one million — large enough that any plausible amount of prepending stays positive; soft cap is ~500 entries / 50 prepends, so the floor reached is ~999,500). On each `loadMore` resolve (detected via `useEffect([entries.length])` when `prevEntriesLengthRef` increased at the front), call `setFirstItemIndex(prev => prev - PAGE_SIZE)` where `PAGE_SIZE = 10`. Pass `firstItemIndex={firstItemIndex}` to `<Virtuoso>`. The `computeItemKey` ensures item identity is stable; `firstItemIndex` shifts the absolute index base so Virtuoso anchors the user's current viewport on prepend. Edge case: if `startReached` fires twice before state update (network lag), the `isLoadingMore` guard (edge case 4) prevents double-prepend, so `firstItemIndex` only decrements once per page load.

7. **Transition from empty→hydrated:** With the mount gate (AC1b), Virtuoso mounts ONCE with the full hydrated data — never with `entries=[]` during the initial fetch. `useMemo` (AC1) removes the extra one-render lag; the mount gate (AC1b) ensures Virtuoso's first mount is the only mount, so `initialTopMostItemIndex={Math.max(0, entries.length - 1)}` fires on a fully populated array.

8. **Bundle size:** `react-virtuoso` is ~30KB gzipped. Acceptable per project standards (no strict bundle budget in place). Document delta in PR body.

9. **`computeItemKey` for prepend identity**: Virtuoso's default key strategy is index-based, which would cause every existing entry to "remount" on prepend (since their indices shift by +10). `computeItemKey={(_, entry) => entry.entryId}` makes each entry's key stable across prepend operations — only the new entries mount; the existing entries keep their DOM identity. Critical for the in-place pending entry settlement pattern (text/photo flows mutate `entry.isLoading` from true→false on the SAME entry — this requires stable identity).

10. **In-place resize after shimmer→NutritionCard transition (AC25/AC6 gap):** `followOutput="smooth"` fires only when `data.length` increases (new item appended). When the API resolves and `setSessionEntries(prev => prev.map(e => e.entryId === pendingId ? {...e, isLoading:false, result:data} : e))` is called, the `data` count is unchanged — only the item's height grows from ~100px (shimmer) to ~300px (NutritionCard). Virtuoso does NOT re-scroll. The card's bottom ends up below the input bar — exactly the AC25 symptom. **Resolution:** Add to TranscriptFeed: `const virtuosoRef = useRef<VirtuosoHandle>(null)` + `const atBottomRef = useRef(false)`. Wire `ref={virtuosoRef}` and `atBottomStateChange={(atBottom) => { atBottomRef.current = atBottom; }}` to `<Virtuoso>`. Add a `useEffect` that watches `entries` for an in-place `isLoading` transition: when the last entry flips from `isLoading:true` to `isLoading:false` AND `atBottomRef.current === true`, call `requestAnimationFrame(() => { virtuosoRef.current?.autoscrollToBottom(); })`. The `requestAnimationFrame` defers the call until after React has painted the new layout, allowing the NutritionCard's full height to be computed before Virtuoso scrolls. Developer note: verify whether `useEffect` or `useLayoutEffect` is appropriate here — `useLayoutEffect` fires before paint (may be too early for font/image-dependent height); `useEffect` fires after paint (correct for final height). Prefer `useEffect` unless empirical testing shows the card's final height is available synchronously.

11. **`firstItemIndex` initialization and management (POSITIVE-ONLY):** `firstItemIndex` starts at `INITIAL_FIRST_ITEM_INDEX = 1_000_000` and is local state in TranscriptFeed (`useState(INITIAL_FIRST_ITEM_INDEX)`). Per Virtuoso v4.18.7 docs, `firstItemIndex` must remain a positive number; starting at one million provides ~100,000 prepends of headroom (far beyond the ~500-entry soft cap). When `entries.length` increases at the HEAD (prepend: `entries.length > prev.length && entries[0].entryId !== prevFirstIdRef.current`), decrement by the number of prepended items (typically `PAGE_SIZE = 10`). Track `prevFirstIdRef = useRef<string | undefined>(undefined)` to detect prepends vs. appends. When Virtuoso mounts with `firstItemIndex=1_000_000` and 10 hydrated entries, items are indexed [1_000_000, 1_000_001, ..., 1_000_009]. After first loadMore resolves with 10 prepended items: `firstItemIndex=999_990`, items are indexed [999_990, 999_991, ..., 1_000_009]. Virtuoso uses these absolute (positive) indices to anchor the viewport — the user's reading position (e.g., item at absolute index 1_000_000) stays in view after prepend completes. Defensive guard: if `firstItemIndex` would go below `PAGE_SIZE` (extremely unlikely given the soft cap), reset to `INITIAL_FIRST_ITEM_INDEX + persistedEntries.length` to recover; this branch is documented but not expected to execute in practice.

---

## Acceptance Criteria

### AC1 (precondition — state derivation)

**AC1 (precondition — state derivation)**: `HablarShell.tsx` no longer uses `useEffect` to mirror `persistedEntries` into local `entries` state. The rendered list is computed synchronously via `useMemo([persistedEntries, sessionEntries])`. This removes the extra one-render lag between `useSearchHistory` resolving and TranscriptFeed receiving the data, but does NOT by itself eliminate the empty-first mount during the initial fetch.

### AC1b (precondition — Virtuoso mount gate)

**AC1b (precondition — Virtuoso mount gate)**: TranscriptFeed defers mounting `<Virtuoso>` until `useSearchHistory.isLoadingHistory === false` for authenticated users (or until `authLoading === false && !user` for anonymous users, where `persistedEntries` is always `[]`). During the initial fetch, render a lightweight loading skeleton (or the existing `HistoryEmptyState` if applicable). Once the gate opens, Virtuoso mounts EXACTLY ONCE with the full hydrated `entries` array, and `initialTopMostItemIndex={Math.max(0, entries.length - 1)}` fires correctly on its first and only mount. Anonymous users (who have no persisted history fetch) skip the gate: Virtuoso mounts immediately with `entries=[]` and grows via `sessionEntries`.

### AC2 (precondition — session-flow isolation)

**AC2 (precondition — session-flow isolation)**: All session flows (`executeQuery`, `executePhotoAnalysis`, voice success/error effects, `handleDeleteEntry`, `handleClearAll`, `handleDishSelect`) continue to work correctly with the state split. Pending-entry settlement remains entryId-based: text/photo flows append a pending entry then mutate that same entry in-place via `setSessionEntries(prev => prev.map(...))`. Voice error/success append session entries via `setSessionEntries(prev => [...prev, errorEntry])`. `handleDishSelect` reads the combined array. All existing `HablarShell.test.tsx` + edge-cases tests continue to pass with the refactor.

- **AC2 sub-bullet — `handleClearAll` preserves `sessionEntries`**: `handleClearAll` ONLY invokes `clearPersistedHistory()`. It does NOT call `setSessionEntries([])`. Rationale: with the state split, `sessionEntries` is an independent slice that holds in-flight/current-session entries — these are not "persisted" and should not be cleared by the user's "clear history" action (which is semantically about clearing the server-persisted log). The current code `setEntries(prev => prev.filter(e => !e.isPersisted))` was necessary under the unified state because session entries (with `isPersisted=false`) would otherwise be wiped; under the split that protection is structural. After `clearPersistedHistory()` resolves, `useSearchHistory` returns `persistedEntries=[]`, `useMemo` re-derives `allEntries = [...[], ...sessionEntries]`, and the feed shows only the current-session entries.

### AC3 (rewrite architecture)

TranscriptFeed renders a single `<Virtuoso>` component from `react-virtuoso`. No `useEffect` or `useLayoutEffect` writes `scrollTop`. No `ResizeObserver` or `IntersectionObserver` is constructed inside TranscriptFeed. Virtuoso receives `computeItemKey={(_, entry) => entry.entryId}` so prepend (loadMore) and delete operations preserve element identity without remounting the entire list.

### AC4 (deletion sweep)

`HistoryLoadMoreSentinel.tsx`, `packages/web/src/__tests__/components/HistoryLoadMoreSentinel.test.tsx`, and `lib/debugScroll.ts` are deleted from the repository. All 9 `scrollLockRef`-era refs and all 4 FU4 effects are absent from the TranscriptFeed source. All `dlog(...)` callsites are removed. Verified via `git diff --stat` on the PR diff.

### AC5 (operator — hydration, authoritative gate for AC24)

**Status**: Pending (operator post-deploy empirical gate; jsdom cannot close per `feedback_jsdom_layout_ac_gap`).

On `app-dev.nutrixplorer.com`: log in with ≥10 persisted entries, reload `/hablar` ×5. ALL 5 reloads land showing the newest entry visible above the 144px input bar. No spurious `loadMore` fires on mount. User can scroll up manually to load older pages. Verified in Chrome desktop + Safari iOS + Firefox desktop.

### AC6 (operator — append, authoritative gate for AC25)

**Status**: Pending (operator post-deploy empirical gate; jsdom cannot close per `feedback_jsdom_layout_ac_gap`).

On `app-dev.nutrixplorer.com`: feed pinned to bottom (user at newest entry), submit a new search. The pending shimmer appends; when the API resolves and shimmer transitions to full `NutritionCard`, the card's bottom is fully visible above the input bar (no truncation). When the user was NOT near the bottom before submitting, no auto-scroll occurs (Virtuoso `followOutput="smooth"` pin-aware behavior). Verified in Chrome desktop + Safari iOS.

**Implementation note (closing AC25):** `followOutput="smooth"` alone is INSUFFICIENT for this AC. `followOutput` fires when `data.length` increases (new item appended), scrolling to the bottom of the shimmer (~100px tall). When the API resolves, the item height grows in-place from ~100px (shimmer) to ~300px (NutritionCard) — the `data` count is unchanged, so Virtuoso does NOT re-scroll. The card's bottom ends up below the input bar. The plan (Step 3.7) includes an explicit imperative call via `virtuosoRef.current?.autoscrollToBottom()` triggered by a `useEffect` that detects the `isLoading → false` in-place transition on the last entry, wrapped in `requestAnimationFrame` to allow layout settle. See edge case #10 and the Virtuoso prop wiring table for the `ref` + `atBottomStateChange` wiring.

### AC7 (operator — loadMore prepend, authoritative gate for AC26)

**Status**: Pending (operator post-deploy empirical gate; jsdom cannot close per `feedback_jsdom_layout_ac_gap`).

On `app-dev.nutrixplorer.com`: ≥10 persisted entries, scroll UP until `startReached` fires. Exactly ONE `loadMore` dispatches. 10 older entries prepend. The viewport anchors on the same entries the user was reading — no visible jump, no big shift. Virtuoso's built-in prepend anchoring. Verified in Chrome desktop + Firefox desktop.

### AC8 (a11y intact)

DOM order remains chronological (oldest entry at top, newest at bottom). **Two-phase a11y semantics aligned with the AC1b mount gate:**

- **During mount gate (`authLoading || (user && isLoadingHistory)`)** — HablarShell renders a placeholder element carrying the feed semantics during the initial-fetch phase: `role="feed" aria-busy="true" aria-label="Historial de consultas"`. Screen readers announce "feed, busy" so the user knows content is loading.
- **Post-gate (Virtuoso mounted)** — `<Virtuoso>` receives `role="feed"` and `aria-label="Historial de consultas"` directly as props (no wrapper needed — `VirtuosoProps` extends `ListRootProps = Omit<React.HTMLProps<HTMLDivElement>, 'data' | 'ref'>`, accepting all HTML/ARIA attributes). **`aria-busy` is NOT passed to Virtuoso** because by the time Virtuoso mounts, `isLoadingHistory === false` and the busy state no longer applies (the only "busy" phase is the pre-mount gate). For subsequent `isLoadingMore=true` phases (user-triggered loadMore), the `aria-busy="true"` lives on the `components.Header` slot (the skeleton container) rather than on Virtuoso's root, scoping the busy semantics to the actual loading region.

axe-core audit on `/hablar` returns zero violations across both phases. Keyboard navigation (Tab through entries) traverses entries in chronological order. Screen reader announces entries oldest-to-newest.

Additionally, a focusable "Cargar más historial" button is present (sr-only by default, visible on focus) as keyboard fallback for users who cannot perform the scroll gesture. Click the button → invoke `loadMore` (same handler as `startReached`). This satisfies the W23 keyboard-accessibility guideline. The button must remain in DOM tab order when `hasMoreHistory && !isLoadingMore`.

### AC9 (StrictMode parity)

Component mounts cleanly in React 18 dev StrictMode (synthetic mount→unmount→mount). No double `loadMore` dispatch, no orphaned observers, no console errors. `initialTopMostItemIndex` applies correctly on the second (real) mount.

### AC10 (existing UX preserved)

All other TranscriptFeed features are intact: `HistoryEmptyState`, `EmptyState`, `HistoryPersistenceNudge`, `ClearHistoryButton`, per-entry delete, per-entry retry, dish-select interactions, persistence ordering (persisted entries first, session entries last in the Virtuoso `data` array). No visual regression.

### AC11 (jsdom unit tests)

All existing `TranscriptFeed.test.tsx` and edge-cases tests are adapted to the new Virtuoso-based architecture. Virtuoso test pattern: use `scrollContainerOverride` prop or mock `react-virtuoso` at the module boundary. Tests that asserted FU4-specific internals (`scrollLockRef` mode transitions, IO root observation count, bottom-lock observer install/disconnect) are deleted — they no longer have corresponding production code. New tests added for: Virtuoso props wiring (correct `data`, `initialTopMostItemIndex`, `followOutput`, `startReached`), `useMemo` data array assembly (persisted first, session last), `startReached` deduplication guard (fires exactly once per burst when `isLoadingMore` is false). Test that `computeItemKey` returns the entry's `entryId` for stable identity across re-renders, prepends, and deletions. Test count is NOT artificially preserved — quality over quantity.

### AC12 (Playwright e2e — scope decision)

Document in PR body whether Playwright e2e for AC5/AC6/AC7 lands in this PR or is deferred to F-WEB-HISTORY-FU7 (the existing FU5 Playwright infra ticket can be repurposed/renamed). Default decision: jsdom unit tests + operator smoke ACs (AC5/AC6/AC7) are sufficient for this PR; Playwright e2e goes to a follow-up. If the Plan agent determines Playwright is feasible within scope, it may be included — owner sign-off required at Step 2.

### AC13 (no regressions in unrelated paths)

Anonymous user flows (no persisted history), error states, mid-flight abort behavior, photo-mode flows, and voice flows are all unchanged and tested.

### AC14 (CI green)

`npm test -w @foodxplorer/web` passes. `next lint` 0 errors. `tsc --noEmit` 0 errors. `next build` clean. CI `ci-success` rollup green on the PR.

### AC15 (dependency)

`react-virtuoso` added to `packages/web/package.json` (latest stable at branch creation time). License confirmed MIT in PR body. Lockfile resynced (`npm install` clean). Bundle size delta documented in PR body (estimate ~30KB gzipped).

---

## Definition of Done

- [x] All 15 ACs above marked `[x]` (AC5/AC6/AC7 are operator post-deploy empirical gates — intentionally `[ ]` pre-merge per `feedback_jsdom_layout_ac_gap`; AC1/AC1b/AC2/AC3/AC4/AC8/AC9/AC10/AC11/AC12/AC13/AC14/AC15 all marked).
- [x] `docs/specs/ui-components.md` TranscriptFeed section rewritten: delete the `scrollLockRef` discriminated union narrative and 4-effect state machine description; add Virtuoso prop wiring table (data, initialTopMostItemIndex, followOutput, startReached, itemContent, components slots). Delete the `HistoryLoadMoreSentinel` component entry. (Commit `a6ef978`.)
- [x] `docs/specs/hablar-design-guidelines.md` W18 hydration-scroll guideline updated: added note that canonical implementation is library-owned scroll (`react-virtuoso`); hand-rolled scroll machinery for chat/feed UIs is an anti-pattern. (Commit `a6ef978`.)
- [x] `docs/project_notes/bugs.md` updated: entries `BUG-WEB-FEED-SCROLL-SETTLE-001`, `BUG-WEB-HISTORY-LOADMORE-IO-ROOT-001`, and `BUG-WEB-HISTORY-HYDRATION-RACE-001` flipped to `TRULY FIXED (pending operator AC5/AC6/AC7 post-merge verification)`. (Commit `a6ef978`.)
- [x] `docs/project_notes/key_facts.md` updated: new shared dep `react-virtuoso` v4.18.7 MIT (~30KB gzipped, added in FU6); new pattern note: "chat/feed/timeline scroll = library-owned (react-virtuoso), not hand-rolled". (Commit `a6ef978`.)
- [x] Memory entry `feedback_hand_rolled_scroll_anti_pattern` saved at `/Users/pb/.claude/projects/-Users-pb-Developer-FiveGuays-foodXPlorer/memory/feedback_hand_rolled_scroll_anti_pattern.md` + indexed in MEMORY.md. (Commit `a6ef978`.)
- [x] `docs/research/transcript-feed-scroll-architecture-2026-06-03.md` appended with closing note pointing to this ticket as the definitive resolution. (Commit `a6ef978`.)
- [x] `product-tracker.md` Active Session updated to reflect FU6 in progress. FU4 operator AC24/AC25/AC26 replaced by FU6 AC5/AC6/AC7 as the release gate. (Commit `245d59a`.)
- [ ] F-WEB-HISTORY-FU5 ticket (`docs/tickets/F-WEB-HISTORY-FU5-playwright-e2e.md`) update: AC12 deferred Playwright to a follow-up; FU5 ticket scope unchanged. Will be reconciled during Step 6 closeout (deferred until then; doesn't block merge).

---

## Workflow Checklist

- [x] **Step 0 — Spec**: drafted + spec self-review + 2 rounds `/review-spec` cross-model (gemini + codex). Round 1 REVISE → 5 codex + 2 gemini findings applied; round 2 APPROVED both. (Commits `245d59a`.)
- [x] **Step 1 — Setup**: branch `feature/F-WEB-HISTORY-FU6-virtuoso-rewrite` off `develop@ff4abd7`. Product-tracker Active Session updated. Working tree clean.
- [x] **Step 2 — Plan**: `frontend-planner` drafted Implementation Plan. 3 rounds `/review-plan` cross-model: R1 REVISE → 5 codex + 1 gemini findings applied; R2 REVISE → 2 codex IMPORTANT applied (firstItemIndex positive, AC8 two-phase a11y); R3 REVISE → 3 propagation gaps applied. (Commit `28fc9fb`.)
- [x] **Step 3 — TDD (RED → GREEN)**:
  - Phase 1: HablarShell precondition refactor — tests RED → GREEN → commits `5d47cb6`, `a640e9f`.
  - Phase 2: TranscriptFeed Virtuoso integration — tests RED → GREEN → commits `bf544ea`, `9fded91`, `ea77c0d`.
  - Phase 3: deletion sweep — commit `c899e98`.
  - Phase 4: doc sync + memory — commit `a6ef978`.
- [x] **Step 4 — Quality gates**: web 789/789 tests, lint 0, typecheck 0, build clean. Bundle `/hablar` `-17 kB`.
- [x] **Step 5 — Review**: code-review-specialist APPROVE (0 BLOCKER, 0 MAJOR, 3 MINOR; MINOR-1 fixed in `f43f0b7`, MINOR-2 + MINOR-3 deferred with rationale). qa-engineer QA VERIFIED (+25 regression tests in commit `0bc6681`). `/audit-merge` pending.
- [ ] **Step 6 — Merge + Closeout**: PR opened, CI green verified before handoff (per `feedback_verify_ci_before_handoff`). Squash-merge to `develop`. Branch deleted local + remote. Tracker closed. Operator AC5/AC6/AC7 smoke on `app-dev.nutrixplorer.com` post auto-redeploy. DoD items completed. (Pending PR + CI + operator.)

---

## Out of Scope

- Playwright e2e infrastructure (deferred to F-WEB-HISTORY-FU7 / repurposed FU5 ticket — see AC12).
- Migration to paid `VirtuosoMessageList` (free `Virtuoso` covers all requirements).
- Virtuoso tuning (`overscan`, `rangeChanged`, `ScrollSeekPlaceholder` thresholds) — default Virtuoso config is the baseline; tune only if performance regression is observed in operator testing.
- Rebranding from `foodXPlorer` types/imports — separate ongoing track, not in this scope.
- Any other TranscriptFeed feature work (new entry types, new interactions) — this PR is a pure scroll-architecture swap with zero new user-facing functionality.

---

## Completion Log

| Step | Date | Agent | Outcome | Notes |
|------|------|-------|---------|-------|
| Step 0 — Spec draft | 2026-06-06 | spec-creator | Spec drafted | Spec self-review: 0 blocking issues found; edge case 1 (empty `initialTopMostItemIndex`) added; AC12 scope decision documented |
| Step 0 — Spec /review-spec | 2026-06-06 | gemini + codex (parallel) | REVISE (gemini: 2 CRITICAL search-tool unverified; codex: 2 CRITICAL + 3 IMPORTANT empirically grounded) | All 5 codex findings applied (F3–F7 in this revision). Gemini's 2 CRITICAL findings resolved by manual verification: react-virtuoso v4.18.7 MIT confirmed via npm registry; ARIA root attributes accepted via `ListRootProps = Omit<React.HTMLProps<HTMLDivElement>, 'data' \| 'ref'>` — evidence in Notes section. |
| Step 0 — /review-spec round 2 | 2026-06-06 | gemini + codex (parallel) | **APPROVED** both | Gemini: 1 SUGGESTION (ClearHistoryButton placement default = Header). Codex: 3 SUGGESTIONs (AC1b mount-gate owner = HablarShell; AC8 `aria-busy` semantics with gated mount; AC11 dedup test boundary = `useSearchHistory.loadMore()`). All 4 SUGGESTIONs are non-blocking and forwarded to the Plan agent (Step 2). Artifacts: `/tmp/review-spec-fu6-2026-06-06-r2/{gemini,codex}.txt`. |
| Step 2 — /review-plan round 1 | 2026-06-06 | gemini + codex (parallel) | REVISE (gemini: 2 CRITICAL search-tool unverified — both FALSE on empirical re-verification; codex: 1 CRITICAL + 4 IMPORTANT all empirically grounded) | Gemini CRITICAL-1 (`computeItemKey` doesn't exist) FALSE — verified via gh CLI: `Virtuoso.ts:196` declares `computeItemKey?: ComputeItemKey<Data, Context>`. Gemini CRITICAL-2 (file paths wrong) was actually codex CRITICAL-1 in disguise (real bug, applied as F1). All 5 codex findings applied (F1-F5). Gemini I1 polish applied (F6). Applied: F1 (HistoryLoadMoreSentinel.test.tsx path normalized to `__tests__/components/`); F2 (handleClearAll = only `clearPersistedHistory()`, no `setSessionEntries([])`, AC2 sub-bullet added); F3 (AC25 imperative `autoscrollToBottom` strategy: `virtuosoRef` + `atBottomRef` + `useEffect` detecting `isLoading` flip + `requestAnimationFrame` call, edge case #10, prop table updated, AC6 note added); F4 (prepend anchoring via `firstItemIndex` state, edge case #6 rewritten, edge case #11 added, prop table updated, Step 3.7 updated); F5 (`design-guidelines.md` → `hablar-design-guidelines.md` in DoD, Merge Checklist, Files to Modify, Step 3.9); F6 (`persistedIdsKey` mechanism added to Phase 1 problem statement). Artifacts: `/tmp/review-plan-fu6-2026-06-06/{gemini,codex}.txt`. |
| Step 2 — /review-plan round 2 | 2026-06-06 | gemini + codex (parallel) | gemini APPROVED; codex REVISE → 2 IMPORTANT applied | codex IMPORTANT-1: `firstItemIndex` must stay POSITIVE per Virtuoso docs (plan had it going negative -10/-20/...). FIXED: `INITIAL_FIRST_ITEM_INDEX = 1_000_000`; decrements to 999_990, etc. — never negative. codex IMPORTANT-2: AC8 contradicted plan self-review on `aria-busy` (AC8 said on Virtuoso; self-review said on HablarShell placeholder). FIXED: AC8 rewritten with two-phase a11y semantics (gate placeholder carries `aria-busy="true"`; post-gate Virtuoso has no `aria-busy`; Header skeleton carries it during `isLoadingMore`). Edge cases #6 + #11 + Plan Self-Review #2 + AC8 all aligned. Artifacts: `/tmp/review-plan-fu6-2026-06-06-r2/{gemini,codex}.txt`. |
| Step 2 — /review-plan round 3 | 2026-06-06 | gemini + codex (parallel) | gemini APPROVED; codex REVISE → 2 propagation gaps applied | Codex r3 confirmed substantive math/semantics from r2 fixes are correct, but flagged 3 sites still carrying stale wording from r1: (a) Step 3.7 body `useState(0)` → corrected to `useState(INITIAL_FIRST_ITEM_INDEX)` with module-level constant `= 1_000_000`; (b) post-render note "starts at 0" → corrected to reference INITIAL_FIRST_ITEM_INDEX with explicit safety margin math (999_500 floor after 50 prepends); (c) Notes "ARIA root props" section still said "pass aria-busy directly on Virtuoso" → corrected to reflect AC8 two-phase semantics. All 3 sites now consistent with AC8 + edge cases #6/#11. Artifacts: `/tmp/review-plan-fu6-2026-06-06-r3/{gemini,codex}.txt`. **Plan APPROVED for Step 3 execution** per `feedback_multi_round_review` 85%+ confidence (3 rounds, only propagation gaps remain — substance is verified). |
| Step 3 — TDD | 2026-06-06 | frontend-developer | 8 commits (`fa1c467`→`a6ef978`) | Phase 1 HablarShell (commits 5d47cb6+a640e9f): useEffect mirror → useMemo + mount gate + sessionEntries split. Phase 2 Virtuoso integration (commits bf544ea+9fded91+ea77c0d): Virtuoso prop wiring (`data`/`computeItemKey`/`followOutput`/`startReached`/`firstItemIndex=1_000_000`/`ref`/`atBottomStateChange`/`autoscrollToBottom` on isLoading flip) + module-level VirtuosoHeader + module-boundary mock at `__mocks__/react-virtuoso.tsx`. Phase 3 deletion sweep (commit c899e98): deleted HistoryLoadMoreSentinel.tsx + .test.tsx + debugScroll.ts + fu4-qa.edge-cases.test.tsx + all dlog callsites. Phase 4 doc sync (commit a6ef978): ui-components + hablar-design-guidelines W18 + bugs.md 3 entries flipped + key_facts + research closing note + memory `feedback_hand_rolled_scroll_anti_pattern`. Web 764/764, lint 0, typecheck 0, build clean. Bundle `/hablar` -17 kB. |
| Step 5 — Code review | 2026-06-06 | code-review-specialist | APPROVE (0 BLOCKER, 0 MAJOR, 3 MINOR, 2 NIT) | MINOR-1 (trailing `<hr>` after last entry — plan said suppress, code rendered all) FIXED in commit `f43f0b7` (production + test assertion updated). MINOR-2 (`loadMoreInFlightRef` defensive reset on `!hasMoreHistory`) + MINOR-3 (in-place resize detection extended to non-last entries) DEFERRED per code-review-specialist's explicit acceptable rationale — both align with `feedback_jsdom_layout_ac_gap` operator-AC contract. NITs (unused `_isLoadingHistory` prop) noted. |
| Step 5 — QA | 2026-06-06 | qa-engineer | QA VERIFIED (+25 regression tests) | qa-engineer added 25 new tests across 2 files (TranscriptFeed.fu6-qa.edge-cases + HablarShell.fu6-qa.edge-cases) covering: firstItemIndex prepend detection (4), underflow guard (1), autoscrollToBottom in-place resize gate (6), atBottomStateChange wiring, AC9 StrictMode (2), authLoading=true gate (3), allEntries composition order, mock-boundary integration tests (2). All 25 new tests PASS. Final suite: 789/789, lint 0, typecheck 0, build clean. Commit `0bc6681`. |

---

## Merge Checklist Evidence

| Check | Evidence | Status |
|-------|----------|--------|
| AC: 13/15 done | AC1+AC1b+AC2+AC3+AC4+AC8+AC9+AC10+AC11+AC12+AC13+AC14+AC15 = 13 marked; AC5+AC6+AC7 = `**Status**: Pending` (operator post-deploy gates per `feedback_jsdom_layout_ac_gap`). | [x] |
| AC5 operator smoke | Pending post-deploy on `app-dev.nutrixplorer.com`. Test plan: log in with ≥10 persisted entries, reload `/hablar` ×5; verify all 5 reloads land at bottom showing newest entry above input bar; no spurious loadMore. Chrome desktop + Safari iOS + Firefox desktop. | [ ] pending |
| AC6 operator smoke | Pending post-deploy on `app-dev.nutrixplorer.com`. Test plan: feed pinned to bottom, submit new search; verify pending shimmer settles to full NutritionCard visible above input bar; user-not-near-bottom case: no autoscroll. Chrome desktop + Safari iOS. | [ ] pending |
| AC7 operator smoke | Pending post-deploy on `app-dev.nutrixplorer.com`. Test plan: ≥10 persisted entries, scroll up to top; verify exactly ONE loadMore fires, 10 older entries prepend, viewport anchors on same entries (no jump). Chrome desktop + Firefox desktop. | [ ] pending |
| `npm test -w @foodxplorer/web` | 789/789 PASS (68 suites). +25 from baseline 764 (qa-engineer additions). | [x] |
| lint 0 | `next lint`: 0 errors, 0 warnings. | [x] |
| typecheck 0 | `tsc --noEmit`: 0 errors. | [x] |
| build clean | `next build`: clean, `/hablar` route 39 kB / 228 kB First Load JS. Bundle delta vs FU4 baseline: **-17 kB** (manual scroll machinery removed; react-virtuoso shared via chunks/255-*). | [x] |
| `docs/specs/ui-components.md` updated | Commit `a6ef978` rewrote TranscriptFeed section: deleted `scrollLockRef` discriminated union narrative + 4-effect state machine description; added Virtuoso prop wiring table; deleted HistoryLoadMoreSentinel component entry. | [x] |
| `docs/specs/hablar-design-guidelines.md` W18 updated | Commit `a6ef978` added note that canonical implementation is library-owned scroll (`react-virtuoso`); hand-rolled scroll machinery for chat/feed UIs is an anti-pattern. | [x] |
| `bugs.md` 3 entries flipped | Commit `a6ef978` flipped BUG-WEB-FEED-SCROLL-SETTLE-001 + BUG-WEB-HISTORY-LOADMORE-IO-ROOT-001 + BUG-WEB-HISTORY-HYDRATION-RACE-001 to "TRULY FIXED (pending operator AC5/AC6/AC7 post-merge verification)". | [x] |
| `key_facts.md` updated | Commit `a6ef978` added `react-virtuoso` v4.18.7 MIT (~30 KB gzipped) + pattern note "chat/feed/timeline scroll = library-owned (react-virtuoso), not hand-rolled". | [x] |
| memory `feedback_hand_rolled_scroll_anti_pattern` saved | Saved at `/Users/pb/.claude/projects/-Users-pb-Developer-FiveGuays-foodXPlorer/memory/feedback_hand_rolled_scroll_anti_pattern.md` + indexed in MEMORY.md. Commit `a6ef978`. | [x] |
| research doc closing note added | `docs/research/transcript-feed-scroll-architecture-2026-06-03.md` appended with closing note pointing to this ticket as definitive resolution. Commit `a6ef978`. | [x] |
| code-review-specialist | APPROVE (0 BLOCKER, 0 MAJOR, 3 MINOR — 1 fixed in `f43f0b7`, 2 deferred with rationale, 2 NIT noted). | [x] |
| qa-engineer | QA VERIFIED (+25 regression tests, commit `0bc6681`). 0 bugs found. | [x] |
| `/audit-merge` structural + drift | Pending in Step 5. | [ ] pending |
| CI green | Pending PR creation in Step 6. | [ ] pending |

---

## Notes

**License verification:**
`react-virtuoso` is MIT-licensed. Confirmed via `npm view react-virtuoso license` → `MIT`; package version `4.18.7`; GitHub README: "MIT License" badge present on https://github.com/petyosi/react-virtuoso. Source file `packages/react-virtuoso/src/interfaces.ts:492` defines `export type ListRootProps = Omit<React.HTMLProps<HTMLDivElement>, 'data' | 'ref'>` (the free `Virtuoso` component's root prop type — all standard HTML/ARIA attributes accepted; see ARIA root props below).

**ARIA root props:**
`VirtuosoProps<Data, Context> extends ListRootProps` (source: `packages/react-virtuoso/src/component-interfaces/Virtuoso.ts:156` in petyosi/react-virtuoso). Since `ListRootProps = Omit<React.HTMLProps<HTMLDivElement>, 'data' | 'ref'>` (source: `packages/react-virtuoso/src/interfaces.ts:492`), the Virtuoso component accepts any HTML/ARIA attribute as a prop: `role`, `aria-label`, `aria-busy`, `className`, `style`, `data-testid`, etc. **AC8 implementation (post-mount-gate)**: pass `role="feed"` and `aria-label="Historial de consultas"` directly as props on `<Virtuoso>`. `aria-busy` is **NOT** passed to `<Virtuoso>` — see AC8 two-phase semantics: `aria-busy` lives on the HablarShell gate placeholder during the initial-fetch phase, and on the `components.Header` skeleton container during `isLoadingMore=true`. The Virtuoso root never carries `aria-busy` because by the time Virtuoso mounts, the initial-fetch is complete.

**Why react-virtuoso over column-reverse:** Column-reverse achieves inverted scroll without JS, but it reverses DOM order (newest entry at top in the DOM), which breaks `role="feed"` ARIA semantics (screen readers expect chronological order, oldest-first), and has documented Firefox/Safari reverse-scroll quirks under content growth. `react-virtuoso` maintains chronological DOM order and provides purpose-built chat/feed semantics.

**Why react-virtuoso over tanstack-virtual / virtua:** tanstack-virtual is lower-level and would require manual scroll management (same category of problem we are escaping). `virtua` is a newer, smaller alternative but has less community validation for chat semantics specifically. `react-virtuoso` is the established choice for chat UIs (used by Stream Chat SDK, among others) and provides `followOutput`, `startReached`, and `initialTopMostItemIndex` as first-class props exactly matching our requirements.

**HablarShell precondition is load-bearing:** without Phase 1, `initialTopMostItemIndex={entries.length - 1}` fires with `entries.length = 0` (empty-first mount), resulting in index `-1` or `0`. Virtuoso would then receive 10 real entries on the re-render without an `initialTopMostItemIndex` re-trigger (it only fires on mount). Phase 1 is not optional.

**`followOutput="smooth"` vs `"auto"` vs `true`:** `"smooth"` enables pin-aware append scroll (only scrolls if user is already near the bottom). `"auto"` always scrolls to bottom on append regardless of user position. `true` is equivalent to `"smooth"` in recent Virtuoso versions. `"smooth"` is the correct semantic for chat UIs where user intent (scrolled up to read history) should suppress auto-scroll.

**Test strategy for Virtuoso in jsdom:** Virtuoso renders via its own virtualization engine which is sensitive to DOM layout measurements unavailable in jsdom. Two documented approaches:
1. `scrollContainerOverride` prop — pass a mock scroll container with stubbed measurements; Virtuoso renders all items without virtualization.
2. Mock `react-virtuoso` at the module boundary — replace `<Virtuoso>` with a passthrough that renders all items and exposes prop spy functions.
The Plan agent must choose one approach and apply it consistently. Option 2 is simpler for prop-wiring tests; Option 1 is closer to real behavior for scroll-interaction tests.

**Iteration history (for context — do not re-litigate in this ticket):**
- FU1 (PR #302/#303): single `useEffect([entries.length])` chat-style scroll — scroll not visible in app-dev.
- FU2 (PR #304): ResizeObserver bottom-lock 500ms — `scrollTop=0` reset observed.
- FU3 (PR #306/#307): `useLayoutEffect` swap — flicker fixed, but unmasked deeper races.
- FU4 (PR #308): 4-effect state machine, `scrollLockRef` discriminated union — `scrollTop=0` reset persisted.
- PR #310: IO root investigation — root never found.
- PR #311: debug instrumentation (`debugScroll.ts`) — `scrollTop=0` reset confirmed in ~2.7ms window; mechanism unknown.
- PR #312: Effect B prepend variation — no improvement.
- PR #313: delayed gate — no improvement.
- **FU6 (this ticket):** architectural rewrite to `react-virtuoso`.

---

## Implementation Plan

### Existing Code to Reuse

| File | What it provides | How the plan uses it |
|------|-----------------|----------------------|
| `packages/web/src/hooks/useSearchHistory.ts` | `persistedEntries`, `hasMoreHistory`, `isLoadingMore`, `isLoadingHistory`, `loadMore`, `deleteEntry`, `clearAll`, and critically the `loadMoreInFlightRef` synchronous dedup guard | Consumed by HablarShell unchanged. `loadMore` passed directly to Virtuoso `startReached`. The `loadMoreInFlightRef` guard is the authoritative dedup boundary for AC11 tests — the tests exercise it at the hook boundary, not TranscriptFeed. |
| `packages/web/src/components/TranscriptEntry.tsx` | Per-entry rendering for all entry types (estimation, photo, voice, error, shimmer) | Passed as `itemContent` callback to Virtuoso. |
| `packages/web/src/components/EmptyState.tsx` | Anonymous-user zero-entry state | Rendered inside the Virtuoso `components.Header` slot when `isEmpty && !isAuthenticated`. |
| `packages/web/src/components/HistoryEmptyState.tsx` | Authenticated-user zero-entry state | Rendered inside Virtuoso `components.Header` slot when `isEmpty && isAuthenticated && !isLoadingHistory`. |
| `packages/web/src/components/HistoryPersistenceNudge.tsx` | Anonymous persistence prompt | Rendered inside Virtuoso `components.Footer` slot when `showPersistenceNudge`. |
| `packages/web/src/components/ClearHistoryButton.tsx` | Confirm-modal clear-all trigger | Rendered inside Virtuoso `components.Header` slot (Gemini suggestion — better discoverability). |
| `packages/web/src/types/history.ts` | `TranscriptEntryData` type | Unchanged; used throughout. |
| `packages/web/src/__tests__/helpers/resizeObserverShim.ts` | ResizeObserver test shim | No longer needed by TranscriptFeed tests (no ResizeObserver in the rewrite). File is NOT deleted — it may be needed by other tests. |
| Load-more skeleton markup from `HistoryLoadMoreSentinel.tsx:117-122` | `shimmer-element` loading skeletons (2×h-4 + 2×h-[120px]) | Lifted verbatim into the Virtuoso `components.Header` slot's `isLoadingMore` branch. File itself is deleted in Phase 3. |
| Keyboard fallback button from `HistoryLoadMoreSentinel.tsx:126-134` | sr-only "Cargar más historial" button | Lifted verbatim into the Virtuoso `components.Header` slot's `hasMoreHistory && !isLoadingMore` branch. |

### Files to Create

| File | Purpose |
|------|---------|
| _(none — no new files needed)_ | All new code goes into modified files below. |

### Files to Modify

| File | What changes |
|------|-------------|
| `packages/web/package.json` | Add `"react-virtuoso": "^4.18.7"` (or latest at install time) to `dependencies`. |
| `packages/web/src/components/HablarShell.tsx` | Phase 1: remove `useEffect` mirror; add `useMemo` for `allEntries`; split `entries` state into `sessionEntries`; add mount-gate logic (do not render `<TranscriptFeed>` while `authLoading \|\| (user && isLoadingHistory)`; render a `role="feed" aria-busy="true"` placeholder div during the gate); update all `setEntries` callsites to `setSessionEntries`; update `handleDishSelect` to read `allEntries`; update `showPersistenceNudge` to use `allEntries.length`; pass `entries={allEntries}` to `<TranscriptFeed>`; remove `dlog` import. Phase 3: remove remaining `dlog` callsites if any survive. |
| `packages/web/src/components/TranscriptFeed.tsx` | Phase 2 complete rewrite: import `{ Virtuoso }` from `react-virtuoso`; remove all 9 refs, 4 effects, `ScrollLockState` type, `startBottomLock`, `stopBottomLock`, `handleLoadMore`, `dlog` import, `HistoryLoadMoreSentinel` import, `feedRef`, `feedContentRef`, overflow container JSX. Replace with `<Virtuoso>` receiving all props per wiring table. Implement `components.Header` composite slot inline (see plan details). |
| `packages/web/src/hooks/useSearchHistory.ts` | Phase 3: remove `dlog` import and all `dlog(...)` callsites (~10 lines). No behavioral change. |
| `packages/web/src/__tests__/components/HablarShell.fWebHistory.test.tsx` | Phase 1 (Step 3.4): rewrite to test the new mount-gate behavior. See Step 3.4 details. |
| `packages/web/src/__tests__/components/HablarShell.test.tsx` | Phase 1 (Step 3.4): minor adaptation — the existing `role="feed"` query now finds the gate placeholder during history load, not TranscriptFeed. Adjust tests that rely on the feed being immediately mounted with `entries=[]`. |
| `packages/web/src/__tests__/components/HablarShell.edge-cases.test.tsx` | Phase 1 (Step 3.4): adapt any tests that called `setEntries` on a unified state or that queried the feed before history load completes. |
| `packages/web/src/__tests__/components/HablarShell.photo.test.tsx` | Phase 1 (Step 3.4): adapt — photo flow now calls `setSessionEntries` instead of `setEntries`. Tests exercise behavior through rendered output (not state directly), so changes are likely confined to mock setup. |
| `packages/web/src/__tests__/components/HablarShell.voice.test.tsx` | Phase 1 (Step 3.4): adapt — voice error/success effects now call `setSessionEntries`. Same reasoning as photo. |
| `packages/web/src/__tests__/components/HablarShell.fWebTier.test.tsx` | Phase 1 (Step 3.4): confirm no tests depend on the `entries` unified state directly; adapt if any do. |
| `packages/web/src/__tests__/components/TranscriptFeed.test.tsx` | Phase 2 (Step 3.7) + Phase 3 (Step 3.9): 85-90% rewrite. Delete all 58 FU4-era test cases (scroll machinery, ResizeObserver, IO, bottom-lock, prepend-restore, hydration-ready, overflow-anchor). Keep and adapt: `role="feed"`, `aria-label`, empty states (AC45), persistence nudge (AC37), ClearHistoryButton (AC46), entry order (AC34), basic render smoke. Add: Virtuoso prop wiring tests (see Step 3.6 details). Estimated new LOC: ~280. |
| `packages/web/src/__tests__/components/TranscriptFeed.edge-cases.test.tsx` | Phase 3 (Step 3.9): ~40% rewrite. Delete: scroll-related edge cases (EC-DELETE scroll assertions, EC-CLEAR scroll assertions, `resizeObserverShim` describe block). Keep and adapt: entry deletion renders correctly (assert entry absent from DOM, not scroll behavior), clear-all then new entry renders correctly. Remove `HistoryLoadMoreSentinel` mock from the top-level mock list (component deleted). Estimated new LOC: ~130. |
| `packages/web/src/__tests__/components/TranscriptFeed.fu4-qa.edge-cases.test.tsx` | Phase 3 (Step 3.9): **100% delete** — all 3 test cases cover FU4 internals (ResizeObserver isolation, `scrollLockRef` mode transitions, `prepending` baseline capture). No surviving assertions. |
| `packages/web/src/__tests__/components/HistoryLoadMoreSentinel.test.tsx` | Phase 3 (Step 3.9): **100% delete** — component is deleted. |
| `packages/web/src/components/HistoryLoadMoreSentinel.tsx` | Phase 3 (Step 3.9): **100% delete**. |
| `packages/web/src/lib/debugScroll.ts` | Phase 3 (Step 3.9): **100% delete**. |
| `docs/specs/ui-components.md` | Step 3.11: update TranscriptFeed section; delete HistoryLoadMoreSentinel entry. |
| `docs/specs/hablar-design-guidelines.md` | Step 3.11: update W18 note. |
| `docs/project_notes/bugs.md` | Step 3.11: flip 3 entries to TRULY FIXED (pending AC5/AC6/AC7). |
| `docs/project_notes/key_facts.md` | Step 3.11: add `react-virtuoso` dep note + pattern note. |
| `docs/research/transcript-feed-scroll-architecture-2026-06-03.md` | Step 3.11: append closing note. |

### Implementation Order

**Phase 1 — HablarShell state split + mount gate**

1. **Step 3.1 — Add `react-virtuoso` dep**
   - **What:** Add `react-virtuoso` to `packages/web/package.json` and resync lockfile.
   - **Action:** `npm install react-virtuoso --workspace=@foodxplorer/web`. Verify `npm view react-virtuoso license` returns `MIT`. Note the installed version in the PR body.
   - **Test (RED):** No dedicated test file. After install, a trivial typecheck import (`import type { VirtuosoProps } from 'react-virtuoso'` in a scratch file or via `npm run typecheck`) confirms the dep resolves. `npm run typecheck -w @foodxplorer/web` is the gate.
   - **Production code (GREEN):** `packages/web/package.json` — add `"react-virtuoso": "^4.x.y"` under `dependencies`.
   - **Commit:** `chore(F-WEB-HISTORY-FU6): add react-virtuoso dep (MIT, ~30KB gzip)`
   - **Gates after step:** `npm run typecheck -w @foodxplorer/web` — 0 errors. `npm test -w @foodxplorer/web` — all existing tests still pass (no production code change yet).

2. **Step 3.2 — Phase 1 RED test: empty-first-mount proof**
   - **What:** Write a failing test in `HablarShell.fWebHistory.test.tsx` that proves the current `useEffect` mirror creates an empty-first mount when `useSearchHistory` is in-flight.
   - **Test file:** `packages/web/src/__tests__/components/HablarShell.fWebHistory.test.tsx`
   - **Test (RED):** Add a test at the bottom of the existing file (under a new `describe('HablarShell — Phase 1 mount gate (FU6)')` block):
     - Mock `useSearchHistory` to return `{ isLoadingHistory: true, persistedEntries: [], ... }`.
     - Mock `useAuth` to return `{ user: { id: 'u1' }, session: { access_token: 'tok' }, loading: false }`.
     - Render `<HablarShell />`.
     - Assert: `screen.queryByRole('feed', { name: 'Historial de consultas' })` is NOT in the document (TranscriptFeed should be gated, not rendered).
     - Assert: a placeholder element with `role="feed"` and `aria-busy="true"` IS in the document (the gate placeholder).
     - This test FAILS on the current code because HablarShell renders `<TranscriptFeed>` unconditionally.
   - **Production code (GREEN for this step):** None yet — test must stay RED until Step 3.3.
   - **Commit:** `test(F-WEB-HISTORY-FU6): RED — assert mount gate held during isLoadingHistory`
   - **Gates after step:** Test suite reports this one test as FAILING. All other tests pass.

3. **Step 3.3 — Phase 1 GREEN: HablarShell state split + mount gate**
   - **What:** Refactor HablarShell to split state and add mount gate. All FU6 Phase 1 tests pass green.
   - **Test (GREEN):** Step 3.2 test passes. Existing tests continue to pass (may need minor mocking updates — see Step 3.4).
   - **Production code (GREEN):** `packages/web/src/components/HablarShell.tsx`:
     1. Import: add `useMemo` to the React import. Remove `dlog` import (none existed — `dlog` import is only in `TranscriptFeed.tsx` and `useSearchHistory.ts` for this component).
     2. Rename `const [entries, setEntries] = useState<TranscriptEntryData[]>([])` to `const [sessionEntries, setSessionEntries] = useState<TranscriptEntryData[]>([])`.
     3. Remove the `persistedIdsKey` computation and the `useEffect` block at lines 138-145 (the `setEntries` mirror effect).
     4. Add: `const allEntries = useMemo(() => [...persistedEntries, ...sessionEntries], [persistedEntries, sessionEntries]);`
     5. Replace all `setEntries(` callsites with `setSessionEntries(` — there are 9 callsites (in `executeQuery` × 3, `executePhotoAnalysis` × 4, voice success effect × 1, voice error effect × 1). The `prev.filter(e => !e.isPersisted)` inside the old `setEntries` mirror is removed (that was the mirror logic).
     6. Update `handleDeleteEntry`: the current `setEntries(prev => prev.filter(...))` operated on the unified array. Under the split, only session entries are in `sessionEntries`; persisted deletes are handled by `deletePersistedEntry` (which updates `useSearchHistory` → `persistedEntries` → `allEntries` re-derives). Change `setEntries` to `setSessionEntries` for the session-entry removal side. Persisted entry deletion: the `deletePersistedEntry` call is sufficient (hook updates `persistedEntries`, `useMemo` re-derives). Guard: only call `setSessionEntries` if the entry being deleted is NOT in `persistedEntries` (i.e., check `!persistedEntries.some(e => e.entryId === entryId)`). Alternatively: keep calling `setSessionEntries(prev => prev.filter(...))` — it's a no-op if the entryId isn't in sessionEntries.
     7. Update `handleClearAll`: currently `setEntries(prev => prev.filter(e => !e.isPersisted))` + `clearPersistedHistory()`. Under the split, `handleClearAll` becomes ONLY `clearPersistedHistory()`. **Do NOT call `setSessionEntries([])`** — `sessionEntries` is a separate state slice representing the current session's in-flight/active entries, which are not "persisted" and must be preserved across a clear-all action. After `clearPersistedHistory()`, `useSearchHistory` returns `persistedEntries=[]`, `useMemo` re-derives `allEntries = [...[], ...sessionEntries]`, and the feed shows only current-session entries. (The old `setEntries(prev => prev.filter(e => !e.isPersisted))` was required under the unified state to prevent wiping session entries; under the split, this protection is structural — session entries live in their own state slice.)
     8. Update `handleDishSelect`: currently reads `entries`. Change to read `allEntries`: `const photoEntry = [...allEntries].reverse().find(...)`.
     9. Update `showPersistenceNudge`: currently `entries.length >= 2`. Change to `allEntries.length >= 2`.
     10. Update `ConversationInput` props that reference `entries`: `isLoading={allEntries.some(...)}`, `isPhotoLoading={allEntries.some(...)}`.
     11. **Mount gate:** in the render JSX, replace the current `<TranscriptFeed entries={entries} ... />` with:
         ```
         {(authLoading || (!!user && isLoadingHistory)) ? (
           <div
             role="feed"
             aria-label="Historial de consultas"
             aria-busy="true"
             className="flex-1 overflow-y-auto px-4 pt-4 pb-[calc(9rem+env(safe-area-inset-bottom))] lg:max-w-2xl lg:mx-auto w-full"
           />
         ) : (
           <TranscriptFeed entries={allEntries} ... />
         )}
         ```
         This gate ensures: (a) authenticated users see the gate placeholder until history loads; (b) anonymous users (no `user` OR `authLoading=false && !user`) skip the gate and mount TranscriptFeed immediately with `allEntries=[]`; (c) the `role="feed"` + `aria-busy="true"` semantics are present during the gate window (AC8 resolution — Codex suggestion #3). The `aria-busy` resolves to the gate div during load and is absent from Virtuoso itself (Virtuoso gets no `aria-busy` prop once mounted).
     12. Pass `entries={allEntries}` to `<TranscriptFeed>` (was `entries={entries}`).
   - **Commit:** `feat(F-WEB-HISTORY-FU6): HablarShell Phase 1 — useMemo + mount gate`
   - **Gates after step:** `npm test -w @foodxplorer/web` (expect some HablarShell test failures from the state rename — fixed in Step 3.4). `npm run typecheck -w @foodxplorer/web` — 0 errors expected.

4. **Step 3.4 — Phase 1 tests: adapt HablarShell test suite**
   - **What:** Rewrite `HablarShell.fWebHistory.test.tsx` for new gate semantics. Adapt the other 5 HablarShell test files for the `sessionEntries`/`allEntries` split and mount gate.
   - **Test files modified:**
     - `HablarShell.fWebHistory.test.tsx` — rewrite the `loadMore reconciliation` describe block: the key behavioral change is that `persistedEntries` from `useSearchHistory` now flows directly into `allEntries` without the one-render lag. The tests that used `rerender(<HablarShell />)` and then waited for persisted entries to appear should continue to work (behavior is preserved; only timing improves). Add new tests for the mount gate:
       - (a) Mount gate is held while `isLoadingHistory=true && user != null`; placeholder div has `aria-busy="true"`.
       - (b) Mount gate opens when `isLoadingHistory` transitions to false; TranscriptFeed appears with the full hydrated entries immediately (not on the next render cycle).
       - (c) `sessionEntries` append works correctly while gate is closed (i.e., user cannot submit a query while gate is active — `authLoading || isLoadingHistory` guard in `handleSubmit` already covers this, verify it is still present or adapt).
       - (d) Anonymous user (no `user`): gate is NOT held; TranscriptFeed mounts immediately with `allEntries=[]`; session entries append correctly via `sessionEntries`.
       - (e) Keyboard fallback button "Cargar más historial" is in tab order when `hasMoreHistory && !isLoadingMore` (this tests the Virtuoso Header slot — mock Virtuoso as per Step 3.6).
     - `HablarShell.test.tsx` — check: all 58 tests use RTL queries (screen.getByRole, screen.getByText, etc.) and do NOT directly read `entries` state. The mock for `useSearchHistory` already returns `isLoadingHistory: false`, so the gate is open in all existing tests. No changes expected. Verify by running `npm test` after Step 3.3.
     - `HablarShell.edge-cases.test.tsx` — same analysis: verify existing tests still pass; adapt if the gate or state rename causes failures.
     - `HablarShell.photo.test.tsx` — photo flows call `setSessionEntries` internally; tests exercise via rendered output; should pass unchanged. Verify and adapt as needed.
     - `HablarShell.voice.test.tsx` — same. Verify and adapt as needed.
     - `HablarShell.fWebTier.test.tsx` — verify; adapt as needed.
   - **Commit:** `test(F-WEB-HISTORY-FU6): Phase 1 tests — mount gate assertions + state-split adaptations`
   - **Gates after step:** `npm test -w @foodxplorer/web` — 0 failures. `npm run lint -w @foodxplorer/web` — 0 errors. `npm run typecheck -w @foodxplorer/web` — 0 errors.

**Phase 2 — TranscriptFeed Virtuoso integration**

5. **Step 3.5 — Phase 2 RED tests: Virtuoso prop wiring**
   - **What:** Write failing tests in `TranscriptFeed.test.tsx` that assert Virtuoso receives the correct props. These tests fail because Virtuoso is not yet wired.
   - **Test strategy decision (Codex suggestion, spec Notes §2):** Use **Option 2 — mock `react-virtuoso` at module boundary**. Add to the top of `TranscriptFeed.test.tsx`:
     ```typescript
     // Captured props for assertion
     let capturedVirtuosoProps: Record<string, unknown> | null = null;

     jest.mock('react-virtuoso', () => ({
       Virtuoso: (props: Record<string, unknown>) => {
         capturedVirtuosoProps = props;
         // Render all items in the data array without virtualization
         const data = (props.data as Array<unknown>) ?? [];
         const itemContent = props.itemContent as ((idx: number, item: unknown) => React.ReactNode) | undefined;
         return (
           <div
             role={props.role as string}
             aria-label={props['aria-label'] as string}
             aria-busy={props['aria-busy'] as boolean | undefined}
             data-testid="virtuoso-root"
           >
             {/* Header slot */}
             {props.components && (props.components as Record<string, unknown>).Header
               ? React.createElement((props.components as Record<string, React.ComponentType>).Header)
               : null}
             {/* Items */}
             {data.map((item, idx) =>
               itemContent ? itemContent(idx, item) : null
             )}
             {/* Footer slot */}
             {props.components && (props.components as Record<string, unknown>).Footer
               ? React.createElement((props.components as Record<string, React.ComponentType>).Footer)
               : null}
           </div>
         );
       },
     }));
     ```
     The `capturedVirtuosoProps` approach is reset in `beforeEach`. The mock renders all items inline (no virtualization), so RTL can query `getByTestId('entry-*')` etc.
   - **New tests (RED):**
     - `it('AC3: Virtuoso receives data={entries} (oldest-first array)')` — assert `capturedVirtuosoProps.data` equals the entries array.
     - `it('AC3: Virtuoso receives computeItemKey returning entry.entryId')` — call `capturedVirtuosoProps.computeItemKey(0, entry)` and assert it returns `entry.entryId`.
     - `it('AC3: Virtuoso receives followOutput="smooth"')` — assert `capturedVirtuosoProps.followOutput === 'smooth'`.
     - `it('AC3: Virtuoso receives startReached prop wired to onLoadMore')` — call `capturedVirtuosoProps.startReached()` and assert `onLoadMore` was called.
     - `it('AC3: Virtuoso receives initialTopMostItemIndex = Math.max(0, entries.length-1)')` — render with 5 entries, assert `capturedVirtuosoProps.initialTopMostItemIndex === 4`.
     - `it('AC8: Virtuoso root has role="feed" and aria-label="Historial de consultas"')` — assert via `screen.getByRole('feed')` with `aria-label`.
     - `it('AC8: Virtuoso root has aria-busy absent when isLoadingHistory=false')` — assert `screen.getByRole('feed')` does not have `aria-busy` (NOTE: the gate placeholder in HablarShell owns `aria-busy` during load; once Virtuoso mounts, `isLoadingHistory` is false, so no `aria-busy` on the Virtuoso root).
     - `it('AC10: ClearHistoryButton appears in Header slot when isAuthenticated && has persisted entries')` — render with `isAuthenticated=true` and one persisted entry; assert `screen.getByTestId('clear-history-button')` is in the document.
     - `it('AC8/keyboard: sr-only "Cargar más historial" button present when hasMoreHistory && !isLoadingMore')` — assert button is in DOM with correct text.
     - `it('AC10: loading skeleton present in Header slot when isLoadingMore=true')` — assert `aria-label="Cargando entradas anteriores"` element is in document.
     - `it('AC11: loadMore dedup — rapid startReached calls fire loadMore only once')` — render TranscriptFeed; call `capturedVirtuosoProps.startReached()` twice rapidly; assert `onLoadMore` was called once. Note: this test exercises the `onLoadMore` prop boundary only. The authoritative dedup guard is `loadMoreInFlightRef` inside `useSearchHistory.ts` — that test lives separately in `useSearchHistory.test.ts` (see Step 3.6 note).
   - **Commit:** `test(F-WEB-HISTORY-FU6): RED — Virtuoso prop wiring tests`
   - **Gates after step:** New tests FAIL. All Phase 1 tests still pass.

6. **Step 3.6 — Phase 2 RED: `useSearchHistory` dedup test**
   - **What:** Write a test in `useSearchHistory.test.ts` (or a new file if it doesn't exist) that exercises the `loadMoreInFlightRef` synchronous guard directly at the hook boundary.
   - **Test file:** Check if `packages/web/src/__tests__/hooks/useSearchHistory.test.ts` exists; if not, create it.
   - **Test (RED — or GREEN if guard already tested):**
     - `it('AC11: loadMoreInFlightRef dedup — two synchronous loadMore() calls before commit dispatch exactly one fetch')` — use `renderHook(() => useSearchHistory({ authToken: 'tok' }))`. Mock `getHistory` to return page 1 on mount then hang on the second call (never resolves). Call `result.current.loadMore()` twice synchronously. Assert `getHistory` (the loadMore path, second call) was called exactly once. The `loadMoreInFlightRef` guard short-circuits the second call before the React state check.
   - **Commit:** `test(F-WEB-HISTORY-FU6): RED — useSearchHistory loadMore dedup guard`
   - **Gates after step:** New hook test FAILS (or is already GREEN if the existing suite covers it — in that case, skip this step's commit and document it as already covered).

7. **Step 3.7 — Phase 2 GREEN: TranscriptFeed Virtuoso integration**
   - **What:** Rewrite TranscriptFeed to render `<Virtuoso>`. All Phase 2 RED tests turn green.
   - **Production code (GREEN):** `packages/web/src/components/TranscriptFeed.tsx`:
     1. Remove all imports: `useCallback`, `useEffect`, `useLayoutEffect`, `useRef`, `useState`, `dlog`, `HistoryLoadMoreSentinel`.
     2. Keep imports: `React` (or not, since JSX transform), `TranscriptEntryData`, `TranscriptEntry`, `EmptyState`, `HistoryEmptyState`, `HistoryPersistenceNudge`, `ClearHistoryButton`.
     3. Add import: `import { Virtuoso } from 'react-virtuoso';`
     4. Remove the `ScrollLockState` discriminated union type.
     5. Remove the `HYDRATION_RESCROLL_WINDOW_MS` and `APPEND_BOTTOM_LOCK_WINDOW_MS` constants.
     6. `TranscriptFeedProps` interface: unchanged (same props — `entries`, `isAuthenticated`, `isLoadingHistory`, `hasMoreHistory`, `isLoadingMore`, `showPersistenceNudge`, `onDismissPersistenceNudge`, `onLoadMore`, `onDeleteEntry`, `onClearAll`, `onRetry`, `onDishSelect`).
     7. Component body: remove the 9 FU4 refs, all 4 FU4 effects, `startBottomLock`, `stopBottomLock`, `handleLoadMore`, `hydrationReady` state. Add new refs/state: `const virtuosoRef = useRef<VirtuosoHandle>(null)`, `const atBottomRef = useRef(false)`, `const INITIAL_FIRST_ITEM_INDEX = 1_000_000` (module-level constant — see edge case #11 for rationale: must stay POSITIVE per Virtuoso v4.18.7 docs), `const [firstItemIndex, setFirstItemIndex] = useState(INITIAL_FIRST_ITEM_INDEX)`, `const prevFirstEntryIdRef = useRef<string | undefined>(undefined)`. Add a `useEffect([entries])` that (a) detects prepends by comparing `entries[0]?.entryId` to `prevFirstEntryIdRef.current` and decrements `firstItemIndex` by the prepend count (typically PAGE_SIZE = 10); (b) detects the last entry's `isLoading` flipping `true → false` and, if `atBottomRef.current === true`, calls `requestAnimationFrame(() => { virtuosoRef.current?.autoscrollToBottom(); })` to handle AC25 in-place resize. Update `prevFirstEntryIdRef.current` and track previous last-entry `isLoading` in a `prevLastLoadingRef = useRef(false)` to detect the transition.
     8. Compute `hasPersisted` and `isEmpty` as before.
     9. Define the `VirtuosoHeader` component inline (or as a named constant inside the component body — stable reference via `useMemo` or definition at module scope is fine for a named component; place it OUTSIDE the TranscriptFeed function to avoid re-creating the reference on every render):

        ```typescript
        // Defined outside TranscriptFeed to ensure stable identity for Virtuoso's components prop.
        function VirtuosoHeader({
          isAuthenticated,
          hasPersisted,
          hasMoreHistory,
          isLoadingMore,
          onLoadMore,
          onClearAll,
          isEmpty,
          isLoadingHistory,
        }: {
          isAuthenticated: boolean;
          hasPersisted: boolean;
          hasMoreHistory: boolean;
          isLoadingMore: boolean;
          onLoadMore: () => void;
          onClearAll: () => void;
          isEmpty: boolean;
          isLoadingHistory: boolean;
        }) {
          return (
            <>
              {/* Loading skeleton when fetching older pages */}
              {isAuthenticated && isLoadingMore && (
                <div className="mb-4 space-y-3" aria-label="Cargando entradas anteriores" aria-busy="true">
                  <div className="h-4 w-48 rounded-full shimmer-element mb-3" aria-hidden="true" />
                  <div className="h-[120px] rounded-2xl shimmer-element" aria-hidden="true" />
                  <div className="h-4 w-48 rounded-full shimmer-element mb-3" aria-hidden="true" />
                  <div className="h-[120px] rounded-2xl shimmer-element" aria-hidden="true" />
                </div>
              )}

              {/* Clear history button — Gemini suggestion: Header placement for discoverability */}
              {isAuthenticated && hasPersisted && (
                <div className="flex justify-end mb-3">
                  <ClearHistoryButton onConfirm={onClearAll} />
                </div>
              )}

              {/* Keyboard fallback button (sr-only, visible on focus) */}
              {isAuthenticated && hasMoreHistory && !isLoadingMore && (
                <button
                  type="button"
                  className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 text-sm text-brand-green underline underline-offset-2 z-10"
                  onClick={onLoadMore}
                >
                  Cargar más historial
                </button>
              )}

              {/* Empty states */}
              {isEmpty && isAuthenticated && !isLoadingHistory && <HistoryEmptyState />}
              {isEmpty && !isAuthenticated && (
                <div className="flex flex-1 overflow-y-auto">
                  <EmptyState />
                </div>
              )}
            </>
          );
        }
        ```

        IMPORTANT: `VirtuosoHeader` needs access to props from `TranscriptFeed`. Since Virtuoso's `components.Header` receives no props from the parent, these values must be passed via a closure or via a `context` prop on Virtuoso. The simplest pattern: define `VirtuosoHeader` inside the `TranscriptFeed` function body (accepting it re-creates the component reference on each render). Virtuoso re-mounts components when their reference changes, which is undesirable. **Resolution:** Pass the values via Virtuoso's `context` prop (Virtuoso forwards `context` to all slot components as their `context` prop). Define the context shape, pass `context={{ isAuthenticated, hasPersisted, hasMoreHistory, isLoadingMore, onLoadMore, onClearAll, isEmpty, isLoadingHistory }}` to `<Virtuoso>`, and define `VirtuosoHeader` OUTSIDE the TranscriptFeed function, reading from `props.context`. This is the correct Virtuoso pattern for slot data.

     10. Define `VirtuosoFooter` similarly for `showPersistenceNudge` / `onDismissPersistenceNudge`.
     11. Render:
         ```tsx
         return (
           <Virtuoso
             ref={virtuosoRef}
             role="feed"
             aria-label="Historial de consultas"
             className="flex-1 px-4 pt-4 pb-[calc(9rem+env(safe-area-inset-bottom))] lg:max-w-2xl lg:mx-auto w-full"
             data={entries}
             firstItemIndex={firstItemIndex}
             initialTopMostItemIndex={Math.max(0, entries.length - 1)}
             followOutput="smooth"
             atBottomStateChange={(atBottom) => { atBottomRef.current = atBottom; }}
             startReached={onLoadMore}
             computeItemKey={(_, entry) => entry.entryId}
             itemContent={(idx, entry) => (
               <>
                 <TranscriptEntry
                   entry={entry}
                   onDelete={entry.isPersisted ? onDeleteEntry : undefined}
                   onRetry={onRetry}
                   onDishSelect={onDishSelect}
                 />
                 {idx < entries.length - 1 && (
                   <hr className="border-t border-slate-100 my-4" aria-hidden="true" />
                 )}
               </>
             )}
             context={{ isAuthenticated, hasPersisted, hasMoreHistory, isLoadingMore, onLoadMore, onClearAll, isEmpty, isLoadingHistory, showPersistenceNudge, onDismissPersistenceNudge }}
             components={{ Header: VirtuosoHeader, Footer: VirtuosoFooter }}
           />
         );
         ```
         Note: `firstItemIndex` starts at `INITIAL_FIRST_ITEM_INDEX = 1_000_000` (positive-only per Virtuoso v4.18.7 docs — see edge cases #6 and #11) and is managed by the `useEffect([entries])` that tracks prepends (decrementing by PAGE_SIZE=10 per loadMore resolve, never going below ~999_500 even after the soft-cap of 50 prepends). `ref={virtuosoRef}` and `atBottomStateChange` are the two additions that enable the imperative `autoscrollToBottom()` call for AC25 in-place resize handling.
   - **Commit:** `feat(F-WEB-HISTORY-FU6): TranscriptFeed Virtuoso integration`
   - **Gates after step:** `npm test -w @foodxplorer/web` — 0 failures. `npm run lint -w @foodxplorer/web` — 0 errors. `npm run typecheck -w @foodxplorer/web` — 0 errors.

**Phase 3 — Deletion sweep**

8. **Step 3.8 — Phase 3: deletion sweep**
   - **What:** Delete FU4 machinery files, adapt test files. All Phase 3 destructive changes in one commit.
   - **Files deleted:**
     - `packages/web/src/components/HistoryLoadMoreSentinel.tsx`
     - `packages/web/src/__tests__/components/HistoryLoadMoreSentinel.test.tsx`
     - `packages/web/src/__tests__/components/TranscriptFeed.fu4-qa.edge-cases.test.tsx`
     - `packages/web/src/lib/debugScroll.ts`
   - **Files modified:**
     - `packages/web/src/hooks/useSearchHistory.ts`: remove `import { dlog } from '@/lib/debugScroll'` and all 10 `dlog(...)` callsites.
     - `packages/web/src/__tests__/components/TranscriptFeed.test.tsx`: remove the `jest.mock('../../components/HistoryLoadMoreSentinel', ...)` block at the top. Delete the 58 FU4-era test cases (scroll, ResizeObserver, IO, bottom-lock, overflow-anchor, hydration-ready tests). Keep/adapt the ~10 tests that survive (role, aria-label, empty states, persistence nudge, ClearHistoryButton, entry order render, basic smoke). Adapt the top-level mock list to remove `debugScroll` if it was mocked. Estimated LOC after: ~280.
     - `packages/web/src/__tests__/components/TranscriptFeed.edge-cases.test.tsx`: remove `jest.mock('../../components/HistoryLoadMoreSentinel', ...)` block. Remove `createResizeObserverShim` import. Delete the scroll-assertion test cases (EC-DELETE scroll assertions, EC-CLEAR scroll assertions, `resizeObserverShim` describe block). Keep: deletion path test that entry is absent from DOM after delete (assert `screen.queryByTestId('entry-a')` not in document after rerender with entry removed), clear-all then new entry appears (assert new entry in document). Estimated LOC after: ~130.
   - **Commit:** `refactor(F-WEB-HISTORY-FU6): deletion sweep — remove FU4 machinery + sentinel + debug lib`
   - **Gates after step:** `npm test -w @foodxplorer/web` — 0 failures. `npm run lint -w @foodxplorer/web` — 0 errors. `npm run typecheck -w @foodxplorer/web` — 0 errors.

9. **Step 3.9 — Step 3.11 doc sync**
   - **What:** Update all documentation files per DoD.
   - **Files modified:**
     - `docs/specs/ui-components.md`: delete `HistoryLoadMoreSentinel` entry; rewrite TranscriptFeed section to describe Virtuoso prop wiring table.
     - `docs/specs/hablar-design-guidelines.md`: update W18 to add "canonical implementation = library-owned scroll (react-virtuoso); hand-rolled scroll machinery for chat/feed UIs is an anti-pattern in this project."
     - `docs/project_notes/bugs.md`: flip `BUG-WEB-FEED-SCROLL-SETTLE-001`, `BUG-WEB-HISTORY-LOADMORE-IO-ROOT-001`, `BUG-WEB-HISTORY-HYDRATION-RACE-001` to `TRULY FIXED (pending operator AC5/AC6/AC7 post-merge verification)`.
     - `docs/project_notes/key_facts.md`: add `react-virtuoso` shared dep note + `chat/feed/timeline scroll = library-owned (react-virtuoso), not hand-rolled` pattern note.
     - `docs/research/transcript-feed-scroll-architecture-2026-06-03.md`: append closing note: "Superseded by F-WEB-HISTORY-FU6 (virtuoso rewrite, 2026-06-06). This document covers the FU4-era state machine design; the definitive resolution is in `docs/tickets/F-WEB-HISTORY-FU6-virtuoso-rewrite.md`."
   - **Commit:** `docs(F-WEB-HISTORY-FU6): sync specs + bugs.md + key_facts + research closing note`
   - **Gates after step:** `npm test -w @foodxplorer/web` — still 0 failures. No typecheck impact.

### Test Surgery — file-by-file inventory

| File | Current LOC | Test cases today | After FU6 | Estimated new LOC |
|------|------------|-----------------|-----------|-------------------|
| `TranscriptFeed.test.tsx` | 1792 | 58 | Rewrite: delete all 58 FU4-era tests (scroll, IO, ResizeObserver, bottom-lock, overflow-anchor, hydration-ready). Add ~16 new Virtuoso prop wiring tests + adapt ~10 surviving tests (role, aria, empty states, nudge, ClearHistoryButton, entry order). | ~280 |
| `TranscriptFeed.edge-cases.test.tsx` | 413 | 10 | Partial rewrite (~40% delete): remove 6 scroll-assertion edge cases + shim-defensive describe block. Keep 4 deletion/clear-all DOM tests adapted to assert DOM state (not scroll). | ~130 |
| `TranscriptFeed.fu4-qa.edge-cases.test.tsx` | 331 | 3 | **100% delete.** All 3 cases test FU4 internals (cold state observer, `scrollLockRef` mode-transition, ghost prepend unmount). | 0 (deleted) |
| `HistoryLoadMoreSentinel.test.tsx` | 190 | 5 | **100% delete** (component deleted). | 0 (deleted) |
| `HablarShell.fWebHistory.test.tsx` | 457 | 12 | Partial rewrite (~30%): delete 2 tests asserting old `setEntries` mirror behavior; add 4 new gate tests (gate held during load, gate opens with full data, anonymous skips gate, keyboard fallback present). | ~480 |
| `HablarShell.test.tsx` | 332 | (not counted above) | Verify-only: expected 0 changes if all mocks already return `isLoadingHistory: false`. Adapt if any test fails due to gate or state rename. | ~332 |
| `HablarShell.edge-cases.test.tsx` | 348 | (not counted above) | Verify-only: same as above. | ~348 |
| `HablarShell.photo.test.tsx` | 854 | (not counted above) | Verify-only: photo flows use `setSessionEntries` internally; test output unchanged. | ~854 |
| `HablarShell.voice.test.tsx` | 228 | (not counted above) | Verify-only: voice effects use `setSessionEntries`. | ~228 |
| `HablarShell.fWebTier.test.tsx` | 447 | (not counted above) | Verify-only. | ~447 |
| `useSearchHistory.test.ts` (create if missing) | 0 | 0 | New: 1 test for `loadMoreInFlightRef` dedup guard (AC11). | ~60 |

**Net LOC change in test suite:** −1792 − 413 − 331 − 190 + 280 + 130 + 0 + 60 ≈ **−2256 lines deleted, +470 new = net −1786 lines**. Quality over quantity — the deleted tests covered production machinery that no longer exists.

### Risk Register

| Risk | Severity | Mitigation |
|------|----------|------------|
| R1: Virtuoso jsdom mock diverges from real behavior | HIGH | The mock at module boundary (Option 2) is acknowledged as a proxy. Operator AC5/AC6/AC7 on `app-dev` are the authoritative gates for real browser scroll behavior. jsdom tests validate prop wiring and slot content only. |
| R2: `react-virtuoso` major version drift over 12-month timeframe | MEDIUM | Pin `^4.x.y` in `package.json` (semver caret allows minor/patch). Review before next major upgrade cycle. `npm outdated` in CI (if configured) will surface it. |
| R3: `computeItemKey` correctness under pending entry settlement | MEDIUM | Pending entries are created with `crypto.randomUUID()` as `entryId` and settled in-place via `prev.map(e => e.entryId === pendingEntry.entryId ? {...} : e)`. The `entryId` is stable from creation through settlement. The `computeItemKey` test in Step 3.5 verifies this. Operator verification: entry transitions (shimmer→card) must not cause DOM remount (no flash). |
| R4: StrictMode double-fire of `initialTopMostItemIndex` | LOW | React 18 StrictMode causes synthetic mount→unmount→remount. `initialTopMostItemIndex` applies on the first mount of each mount cycle. The second (real) mount re-applies the correct index. The Phase 1 mount gate ensures the mount-with-data only happens once per app lifecycle (not during loading). Verify: `npm test` in StrictMode (Jest uses act() which covers this). |
| R5: Virtuoso `context` prop TypeScript strictness | LOW | Virtuoso's generic `TContext` parameter requires the component to be typed as `React.FC<{ context: TContext }>`. Use `as unknown as VirtuosoComponents<TranscriptEntryData, HeaderContext>` or the Virtuoso-provided component typing. Developer must verify TS compiles cleanly — `npm run typecheck` is gating. |
| R6: HablarShell `handleDeleteEntry` correctness under state split | MEDIUM | Persisted entries are in `persistedEntries` (hook state); session entries are in `sessionEntries` (local state). `handleDeleteEntry` calls both `setSessionEntries(prev => prev.filter(...))` (no-op if not in session) AND `deletePersistedEntry(entryId)` (no-op if not authenticated). This is safe — calling both always is correct. Developer must verify both the persisted-delete and session-delete paths are covered in existing tests. |
| R7: HablarShell `handleClearAll` under state split | MEDIUM | Under the split, `handleClearAll` calls ONLY `clearPersistedHistory()` — it does NOT call `setSessionEntries([])`. Rationale: the old `setEntries(prev => prev.filter(e => !e.isPersisted))` preserved session entries (which have `isPersisted=false`) under the unified state; under the split this is structural — `sessionEntries` is never touched by clear-all. After `clearPersistedHistory()`: `useSearchHistory` returns `persistedEntries=[]`, `useMemo` returns `allEntries = sessionEntries` (current session entries only), TranscriptFeed feed shows current-session entries. Verify with the existing clear-all test that persisted entries are removed from the feed and session entries remain. |
| R8 (carried from FU4 §7.5 R5): jsdom cannot validate scroll state machine end-to-end | HIGH (acknowledged, RESOLVED by design) | The architectural rewrite eliminates the hand-rolled scroll state machine entirely. There is no scroll state machine to validate. Operator AC5/AC6/AC7 are the empirical gates. This risk is closed by the Virtuoso adoption. |

### Open Questions to ask owner (if any)

None. All decisions resolved in the plan per L5 autonomy:

- **`ClearHistoryButton` placement**: Header slot per Gemini suggestion. Rationale: better discoverability than Footer (users see it above the entries list, not below the last entry). Adopted without further escalation.
- **AC1b mount-gate owner**: HablarShell renders the gate placeholder; TranscriptFeed receives `entries` unconditionally. Codex suggestion adopted.
- **AC8 `aria-busy` semantics**: `aria-busy="true"` lives on the HablarShell gate placeholder div (not on the Virtuoso root). Virtuoso root does not carry `aria-busy` (it is only mounted when `isLoadingHistory=false`). Codex suggestion adopted.
- **AC11 dedup test boundary**: `useSearchHistory.loadMore()` internal `loadMoreInFlightRef` is tested at the hook boundary. Codex suggestion adopted.
- **AC12 Playwright scope**: Playwright deferred to FU7. This plan covers jsdom unit tests + operator smoke ACs only.

### Plan Self-Review

Issues found and addressed during drafting:

1. **`VirtuosoHeader` reference stability**: Initial draft placed `VirtuosoHeader` inside the `TranscriptFeed` function body, which re-creates the reference on every render and causes Virtuoso to remount the Header on every render. Fixed: moved definition outside the function; used Virtuoso's `context` prop to pass values from `TranscriptFeed` scope into the slot component. Developer must use the `context` prop pattern — not closure.

2. **`aria-busy` on Virtuoso root (RESOLVED in AC8 round 2)**: AC8 now defines two-phase a11y semantics aligned with the AC1b mount gate. During the mount gate, the HablarShell placeholder carries `role="feed" aria-busy="true" aria-label="..."`. Post-gate, `<Virtuoso>` carries `role="feed" aria-label="..."` WITHOUT `aria-busy` (Virtuoso only mounts after the initial fetch is done, so `isLoadingHistory` is always false at Virtuoso's render time). For subsequent `isLoadingMore=true` phases, `aria-busy="true"` lives on the `components.Header` skeleton container (scoped to the actually-busy region). Tests in Step 3.5 (a) assert that during the gate, the HablarShell placeholder has `role="feed" aria-busy="true"`; (b) assert that post-gate, the Virtuoso root has `role="feed"` and NO `aria-busy` attribute; (c) assert that during `isLoadingMore=true`, the Header skeleton has `aria-busy="true"`.

3. **`handleDeleteEntry` correctness**: Under the unified `entries` state, `setEntries(prev => prev.filter(...))` removed from BOTH persisted and session slices. Under the split, `setSessionEntries` only affects session entries. For persisted entry deletion, `deletePersistedEntry` updates the hook state which flows into `allEntries`. Plan explicitly addresses this in Step 3.3 and Risk R6.

4. **`showPersistenceNudge` depends on `allEntries.length`**: The current code uses `entries.length >= 2`. After the split, `sessionEntries.length` would be wrong (would not count persisted entries). Correctly updated to `allEntries.length >= 2` in Step 3.3.

5. **`TranscriptFeed.fu4-qa.edge-cases.test.tsx` mocks `HistoryLoadMoreSentinel`**: This file mocks the sentinel even though it's being deleted. The file is 100% deleted in Step 3.8, so no adaptation is needed — deletion is the correct action.

6. **`TranscriptFeed.edge-cases.test.tsx` `resizeObserverShim` describe block**: The shim tests (EC-SHIM-1/2/3/4) test the shim helper itself, not TranscriptFeed behavior. These tests are deleted in Step 3.8 since the shim is no longer needed by TranscriptFeed tests. The shim helper file itself is NOT deleted (may be needed by other tests).

7. **`handleSubmit` guard during gate**: HablarShell's `handleSubmit` already has `if (authLoading) return;` — this prevents query submission during auth loading. However during `isLoadingHistory` (after auth resolves but before history loads), `handleSubmit` does NOT guard. Under the current architecture this was fine (entries would append). Under FU6 the gate holds TranscriptFeed unmounted but `sessionEntries` can still receive entries. However the gate is only `isLoadingHistory` which typically resolves within 1-2 seconds — the user is unlikely to submit during this window. No action needed; this is acceptable UX.

8. **Divider between last history entry and first session entry**: Current code renders `hr` between all adjacent entries uniformly. Virtuoso `itemContent` receives `idx` — the plan's `idx < entries.length - 1` condition is correct for the last item (no divider after last). No special handling needed for the persisted/session boundary since the divider pattern is uniform.

---

### Verification commands run

- `Read: packages/web/src/components/HablarShell.tsx:1-732` → confirmed `useEffect` mirror at lines 138-145 (`persistedIdsKey` + `setEntries`); confirmed `setEntries` has 9 callsites (executeQuery ×3, executePhotoAnalysis ×4, voice success ×1, voice error ×1); confirmed `entries` is the unified state (not split); confirmed `useMemo` is NOT imported; confirmed `showPersistenceNudge` uses `entries.length`. → state split scope is well-defined for Step 3.3.
- `Read: packages/web/src/components/TranscriptFeed.tsx:1-579` → confirmed 578 LOC; 9 refs (`feedRef`, `feedContentRef`, `wasNearBottomRef`, `hasScrolledToBottomOnHydrationRef`, `prevEntriesLengthRef`, `firstEntryIdRef`, `lastEntryIdRef`, `scrollLockRef`, `hydrationGateTimerRef`); 4 effects (A:scroll listener, B:hydration+append, C:prepend restore, D:unmount cleanup); `ScrollLockState` discriminated union; `startBottomLock`/`stopBottomLock`/`handleLoadMore` helpers; `HistoryLoadMoreSentinel` rendered at top of feed; `feedContentRef` inner wrapper div; `overflowAnchor:none` inline style; `dlog` import active. → Phase 2 deletion scope confirmed.
- `Read: packages/web/src/hooks/useSearchHistory.ts:1-183` → confirmed `isLoadingHistory` exported; `loadMoreInFlightRef` synchronous guard at lines 100-103; 10 `dlog(...)` callsites; hook returns no-op struct when `!authToken`. → `loadMoreInFlightRef` is the correct AC11 dedup boundary; `dlog` removal scope confirmed.
- `Read: packages/web/src/components/HistoryLoadMoreSentinel.tsx:1-137` → confirmed keyboard fallback button JSX at lines 126-134 (sr-only pattern, `focus:not-sr-only`); loading skeleton JSX at lines 117-122 (`shimmer-element`, `aria-busy`); sentinel div + IO setup. → markup lifted verbatim into Virtuoso Header slot in Step 3.7.
- `Read: packages/web/src/lib/debugScroll.ts:1-46` → confirmed file is standalone (no imports from project modules); entire file deleted in Phase 3. → deletion scope confirmed.
- `Bash: wc -l <test files>` → `TranscriptFeed.test.tsx` 1792 LOC, `TranscriptFeed.edge-cases.test.tsx` 413 LOC, `TranscriptFeed.fu4-qa.edge-cases.test.tsx` 331 LOC, `HistoryLoadMoreSentinel.test.tsx` 190 LOC, `HablarShell.fWebHistory.test.tsx` 457 LOC; HablarShell suite total 2209 LOC across 5 files. → test surgery table populated from actual LOC counts.
- `Bash: grep -c "^\s*it(" <files>` → `TranscriptFeed.test.tsx` 58 tests, `TranscriptFeed.edge-cases.test.tsx` 10 tests, `TranscriptFeed.fu4-qa.edge-cases.test.tsx` 3 tests, `HistoryLoadMoreSentinel.test.tsx` 5 tests, `HablarShell.fWebHistory.test.tsx` 12 tests. → test counts in surgery table are empirical.
- `Bash: cat packages/web/package.json | python3 -c "..."` → `react-virtuoso` NOT present in current `dependencies` (only `@foodxplorer/shared`, `@supabase/ssr`, `@supabase/supabase-js`, `clsx`, `next`, `react`, `react-dom`, `tailwind-merge`). → Step 3.1 dep add is confirmed necessary.
- `Bash: grep -rn "react-virtuoso|Virtuoso" packages/web/src/` → 0 results. → no existing Virtuoso usage; clean first-time integration.
- `Bash: grep -rn "dlog" packages/web/src/ (excluding test files, debugScroll.ts)` → active callsites in `HistoryLoadMoreSentinel.tsx` (7 callsites), `TranscriptFeed.tsx` (8 callsites), `useSearchHistory.ts` (10 callsites). → Phase 3 `dlog` removal scope is 3 files, ~25 callsites total.
- `Read: packages/web/src/__tests__/components/HablarShell.fWebHistory.test.tsx:1-457` → confirmed `useSearchHistory` is mocked at the top; mock returns `isLoadingHistory: false` by default (gate open). AC39/AC40 tests use `mockUseSearchHistory.mockReturnValue({...})` to drive reconciliation. The "logout" test re-mocks to return `persistedEntries: []`. Tests exercise behavior through rendered output (DOM queries), not internal state. → Phase 1 test adaptations in Step 3.4 are targeted and minimal.
- `Read: packages/web/src/__tests__/components/TranscriptFeed.test.tsx:1-340` → confirmed `HistoryLoadMoreSentinel` is mocked at the top (`jest.mock('../../components/HistoryLoadMoreSentinel', ...)`); FU4 tests include scroll machinery assertions (scrollTo spy, ResizeObserver shim, overflow-anchor), all to be deleted in Phase 2+3. Tests that survive: role/aria, empty states, nudge, ClearHistoryButton, entry order. → deletion target list confirmed.
- `Read: packages/web/src/__tests__/components/TranscriptFeed.edge-cases.test.tsx:1-413` → confirmed `resizeObserverShim` tests (EC-SHIM-1/2/3/4) test the shim itself; EC-DELETE/EC-CLEAR tests assert scroll behavior via `scrollToMock`. All scroll-asserting tests deleted; DOM-presence tests (is entry in DOM?) adapted. → 40% delete estimate confirmed.
- `Read: packages/web/src/__tests__/components/HablarShell.test.tsx:1-160` → confirmed `useSearchHistory` mock returns `isLoadingHistory: false`; no TranscriptFeed mock (tests render through the real TranscriptFeed which renders through the Virtuoso mock post-Step-3.7). The "shows EmptyState on initial render" test will require the Virtuoso mock to render the Header slot correctly. → Developer must ensure the Virtuoso module-boundary mock (Step 3.5) is applied to all test files that render TranscriptFeed (including HablarShell test files) — via `jest.mock('react-virtuoso', ...)` in each file OR via a global Jest setup file.
- `Bash: ls packages/web/src/__tests__/helpers/` → `resizeObserverShim.ts` confirmed at this path. → shim file NOT deleted (may be needed by other tests); removal of shim imports from TranscriptFeed test files is safe.
- `Bash: grep -n "shimmer-element" packages/web/src/components/*.tsx` → `shimmer-element` class used in `HistoryLoadMoreSentinel.tsx:118-121`, `LoadingState.tsx`, `TranscriptEntry.tsx`. → confirmed `shimmer-element` is an established Tailwind-CSS global class (defined in global CSS, not a utility we need to invent).
- `Bash: ls packages/web/src/__tests__/components/ | grep -i hablar` → 7 HablarShell test files identified: `HablarAnalytics.test.tsx`, `HablarShell.edge-cases.test.tsx`, `HablarShell.fWebHistory.test.tsx`, `HablarShell.fWebTier.test.tsx`, `HablarShell.photo.test.tsx`, `HablarShell.test.tsx`, `HablarShell.voice.test.tsx`. → all 6 non-analytics files included in Step 3.4 adaptation scope.

**Post-/review-plan verification (F1-F6 empirical checks):**
- `Bash: ls packages/web/src/__tests__/components/ | grep HistoryLoad` → `HistoryLoadMoreSentinel.test.tsx` confirmed at `packages/web/src/__tests__/components/HistoryLoadMoreSentinel.test.tsx`; no test file exists at `packages/web/src/components/` path → F1 fix confirmed: all 6 ticket occurrences of the wrong path corrected to `__tests__/components/` path.
- `Bash: sed -n '606,609p' packages/web/src/components/HablarShell.tsx` → confirmed `handleClearAll` at lines 606-609 is `setEntries((prev) => prev.filter((e) => !e.isPersisted))` + `clearPersistedHistory()` — the filter preserves session entries; under split this structural protection makes `setSessionEntries([])` wrong → F2 fix confirmed: Step 3.3 #7, Risk R7, AC2 sub-bullet all updated.
- `Bash: grep -n "persistedIdsKey" packages/web/src/components/HablarShell.tsx` → `persistedIdsKey = persistedEntries.map((e) => e.entryId).join(',')` at line 138, consumed in `useEffect` at line 145 → F6 fix confirmed: Phase 1 problem statement updated with specific reference to this mechanism.
- `Bash: ls docs/specs/ | grep design` → `design-guidelines.md` and `hablar-design-guidelines.md` both exist; W18 lives in `hablar-design-guidelines.md` (landing page content is in `design-guidelines.md`) → F5 fix confirmed: all 4 W18 references retargeted to `hablar-design-guidelines.md`.
- F3 (autoscrollToBottom) and F4 (firstItemIndex) are architectural — no existing code to grep for these new additions. Virtuoso `VirtuosoHandle.autoscrollToBottom()` and `firstItemIndex` prop existence verified empirically by codex during /review-plan against petyosi/react-virtuoso source. Plan updated to add `virtuosoRef`, `atBottomRef`, `firstItemIndex` state, `prevFirstEntryIdRef`, `prevLastLoadingRef`, `useEffect([entries])` for combined prepend + in-place resize detection, and `requestAnimationFrame` wrapper for the imperative scroll call.
