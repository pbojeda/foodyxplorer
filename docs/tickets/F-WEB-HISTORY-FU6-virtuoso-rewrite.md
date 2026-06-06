# F-WEB-HISTORY-FU6: TranscriptFeed virtuoso architectural rewrite

**Feature:** F-WEB-HISTORY-FU6 | **Type:** Frontend-Architecture-Rewrite | **Priority:** High (3 user-facing scroll bugs blocking develop→main release)
**Status:** Planning | **Branch:** `feature/F-WEB-HISTORY-FU6-virtuoso-rewrite`
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

**Today's problem:** the `useEffect` that mirrors `persistedEntries` fires asynchronously after the first paint. This forces TranscriptFeed to mount once with `entries=[]` (during fetch) and re-render with `entries=[10 persisted]` after the effect fires. Any chat feed library will mis-handle this empty-first mount.

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
| `initialTopMostItemIndex` | `entries.length - 1` | Effect B hydration branch + bottom-lock observer + `hydrationReady` gate |
| `followOutput` | `"smooth"` | Effect B append branch + `wasNearBottomRef` pin check |
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
- `packages/web/src/components/HistoryLoadMoreSentinel.test.tsx`
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

6. **Prepend anchor:** Virtuoso handles prepend viewport anchoring natively when `data` grows at the front. No JS math required. Edge case: if `startReached` fires twice before state update (network lag), the `isLoadingMore` guard (edge case 4) prevents double-prepend.

7. **Transition from empty→hydrated:** With the mount gate (AC1b), Virtuoso mounts ONCE with the full hydrated data — never with `entries=[]` during the initial fetch. `useMemo` (AC1) removes the extra one-render lag; the mount gate (AC1b) ensures Virtuoso's first mount is the only mount, so `initialTopMostItemIndex={Math.max(0, entries.length - 1)}` fires on a fully populated array.

8. **Bundle size:** `react-virtuoso` is ~30KB gzipped. Acceptable per project standards (no strict bundle budget in place). Document delta in PR body.

9. **`computeItemKey` for prepend identity**: Virtuoso's default key strategy is index-based, which would cause every existing entry to "remount" on prepend (since their indices shift by +10). `computeItemKey={(_, entry) => entry.entryId}` makes each entry's key stable across prepend operations — only the new entries mount; the existing entries keep their DOM identity. Critical for the in-place pending entry settlement pattern (text/photo flows mutate `entry.isLoading` from true→false on the SAME entry — this requires stable identity).

---

## Acceptance Criteria

### AC1 (precondition — state derivation)

**AC1 (precondition — state derivation)**: `HablarShell.tsx` no longer uses `useEffect` to mirror `persistedEntries` into local `entries` state. The rendered list is computed synchronously via `useMemo([persistedEntries, sessionEntries])`. This removes the extra one-render lag between `useSearchHistory` resolving and TranscriptFeed receiving the data, but does NOT by itself eliminate the empty-first mount during the initial fetch.

### AC1b (precondition — Virtuoso mount gate)

**AC1b (precondition — Virtuoso mount gate)**: TranscriptFeed defers mounting `<Virtuoso>` until `useSearchHistory.isLoadingHistory === false` for authenticated users (or until `authLoading === false && !user` for anonymous users, where `persistedEntries` is always `[]`). During the initial fetch, render a lightweight loading skeleton (or the existing `HistoryEmptyState` if applicable). Once the gate opens, Virtuoso mounts EXACTLY ONCE with the full hydrated `entries` array, and `initialTopMostItemIndex={Math.max(0, entries.length - 1)}` fires correctly on its first and only mount. Anonymous users (who have no persisted history fetch) skip the gate: Virtuoso mounts immediately with `entries=[]` and grows via `sessionEntries`.

### AC2 (precondition — session-flow isolation)

**AC2 (precondition — session-flow isolation)**: All session flows (`executeQuery`, `executePhotoAnalysis`, voice success/error effects, `handleDeleteEntry`, `handleClearAll`, `handleDishSelect`) continue to work correctly with the state split. Pending-entry settlement remains entryId-based: text/photo flows append a pending entry then mutate that same entry in-place via `setSessionEntries(prev => prev.map(...))`. Voice error/success append session entries via `setSessionEntries(prev => [...prev, errorEntry])`. `handleDishSelect` reads the combined array. All existing `HablarShell.test.tsx` + edge-cases tests continue to pass with the refactor.

### AC3 (rewrite architecture)

TranscriptFeed renders a single `<Virtuoso>` component from `react-virtuoso`. No `useEffect` or `useLayoutEffect` writes `scrollTop`. No `ResizeObserver` or `IntersectionObserver` is constructed inside TranscriptFeed. Virtuoso receives `computeItemKey={(_, entry) => entry.entryId}` so prepend (loadMore) and delete operations preserve element identity without remounting the entire list.

### AC4 (deletion sweep)

`HistoryLoadMoreSentinel.tsx`, `HistoryLoadMoreSentinel.test.tsx`, and `lib/debugScroll.ts` are deleted from the repository. All 9 `scrollLockRef`-era refs and all 4 FU4 effects are absent from the TranscriptFeed source. All `dlog(...)` callsites are removed. Verified via `git diff --stat` on the PR diff.

### AC5 (operator — hydration, authoritative gate for AC24)

On `app-dev.nutrixplorer.com`: log in with ≥10 persisted entries, reload `/hablar` ×5. ALL 5 reloads land showing the newest entry visible above the 144px input bar. No spurious `loadMore` fires on mount. User can scroll up manually to load older pages. Verified in Chrome desktop + Safari iOS + Firefox desktop.

### AC6 (operator — append, authoritative gate for AC25)

On `app-dev.nutrixplorer.com`: feed pinned to bottom (user at newest entry), submit a new search. The pending shimmer appends; when the API resolves and shimmer transitions to full `NutritionCard`, the card's bottom is fully visible above the input bar (no truncation). When the user was NOT near the bottom before submitting, no auto-scroll occurs (Virtuoso `followOutput="smooth"` pin-aware behavior). Verified in Chrome desktop + Safari iOS.

### AC7 (operator — loadMore prepend, authoritative gate for AC26)

On `app-dev.nutrixplorer.com`: ≥10 persisted entries, scroll UP until `startReached` fires. Exactly ONE `loadMore` dispatches. 10 older entries prepend. The viewport anchors on the same entries the user was reading — no visible jump, no big shift. Virtuoso's built-in prepend anchoring. Verified in Chrome desktop + Firefox desktop.

### AC8 (a11y intact)

DOM order remains chronological (oldest entry at top, newest at bottom). `role="feed"`, `aria-label="Historial de consultas"`, and `aria-busy={isLoadingHistory}` are passed directly as props on `<Virtuoso>` (no wrapper needed — `VirtuosoProps` extends `ListRootProps = Omit<React.HTMLProps<HTMLDivElement>, 'data' | 'ref'>`, accepting all HTML/ARIA attributes). axe-core audit on `/hablar` returns zero violations. Keyboard navigation (Tab through entries) traverses entries in chronological order. Screen reader announces entries oldest-to-newest.

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

- [ ] All 15 ACs above marked `[x]` (AC5/AC6/AC7 are operator post-deploy empirical gates — intentionally `[ ]` pre-merge per `feedback_jsdom_layout_ac_gap`).
- [ ] `docs/specs/ui-components.md` TranscriptFeed section rewritten: delete the `scrollLockRef` discriminated union narrative and 4-effect state machine description; add Virtuoso prop wiring table (data, initialTopMostItemIndex, followOutput, startReached, itemContent, components slots). Delete the `HistoryLoadMoreSentinel` component entry.
- [ ] `docs/specs/design-guidelines.md` W18 hydration-scroll guideline updated: add a note that the canonical implementation is library-owned scroll (`react-virtuoso`) — hand-rolled scroll machinery for chat/feed UIs is an anti-pattern in this project.
- [ ] `docs/project_notes/bugs.md` updated: entries `BUG-WEB-FEED-SCROLL-SETTLE-001`, `BUG-WEB-HISTORY-LOADMORE-IO-ROOT-001`, and `BUG-WEB-HISTORY-HYDRATION-RACE-001` flipped to `TRULY FIXED (pending operator AC5/AC6/AC7 post-merge verification)`.
- [ ] `docs/project_notes/key_facts.md` updated: new shared dep `react-virtuoso` (MIT, ~30KB gzipped, added in FU6); new pattern note: "chat/feed/timeline scroll = library-owned (react-virtuoso), not hand-rolled".
- [ ] Memory entry `feedback_hand_rolled_scroll_anti_pattern` saved: "When a hand-rolled scroll state machine has failed 3+ iterations with cross-model + operator empirical loops, the issue is architectural not tactical. Switch to a library that owns scroll (react-virtuoso, virtua, tanstack-virtual) — chat/feed/timeline UX is a solved problem."
- [ ] `docs/research/transcript-feed-scroll-architecture-2026-06-03.md` appended with a closing note: "Superseded by F-WEB-HISTORY-FU6 (virtuoso rewrite, 2026-06-06). This document covers the FU4-era state machine design; the definitive resolution is in `docs/tickets/F-WEB-HISTORY-FU6-virtuoso-rewrite.md`."
- [ ] `product-tracker.md` Active Session updated to reflect FU6 in progress. FU4 operator AC24/AC25/AC26 replaced by FU6 AC5/AC6/AC7 as the release gate.
- [ ] F-WEB-HISTORY-FU5 ticket (`docs/tickets/F-WEB-HISTORY-FU5-playwright-e2e.md`) updated: note that its scope may be superseded or repurposed by FU6/FU7 depending on AC12 decision.

---

## Workflow Checklist

- [ ] **Step 0 — Spec**: this file drafted + spec self-review + MANDATORY `/review-spec` cross-model (Gemini + Codex in parallel, ≥2 rounds until 85%+ confidence per `feedback_multi_round_review`). Owner sign-off on Spec before proceeding.
- [ ] **Step 1 — Setup**: branch `feature/F-WEB-HISTORY-FU6-virtuoso-rewrite` off `develop@ff4abd7`. Product-tracker Active Session updated. Working tree verified clean.
- [ ] **Step 2 — Plan**: `ui-ux-designer` agent (optional — no layout change, but check if Virtuoso scroll container changes padding/safe-area behavior). `frontend-planner` derives Implementation Plan. MANDATORY `/review-plan` cross-model (Gemini + Codex) before owner sign-off. Plan must specify exact Virtuoso `components` slot allocation for `ClearHistoryButton`, `HistoryPersistenceNudge`, `HistoryEmptyState`, `LoadMoreSkeletons`.
- [ ] **Step 3 — TDD (RED → GREEN)**:
  - Phase 1: HablarShell precondition refactor — tests RED (empty-first-mount test) → GREEN (`useMemo` state split) → commit.
  - Phase 2: TranscriptFeed Virtuoso integration — tests RED (Virtuoso props wiring, data assembly, `startReached` deduplication) → GREEN (Virtuoso integration) → commit.
  - Phase 3: deletion sweep — remove FU4 machinery, deleted-file tests, `dlog` callsites → commit.
- [ ] **Step 4 — Quality gates**: `npm test -w @foodxplorer/web` green + lint 0 + typecheck 0 + build clean. Gate counts documented in Completion Log.
- [ ] **Step 5 — Review**: `code-review-specialist` + `qa-engineer` + `/audit-merge`. No MAJOR deferrals (per FU2/FU4 lessons). Apply all BLOCKER + MAJOR findings before merge.
- [ ] **Step 6 — Merge + Closeout**: PR opened, CI green verified before handoff (per `feedback_verify_ci_before_handoff`). Squash-merge to `develop`. Branch deleted local + remote. Tracker closed. Operator AC5/AC6/AC7 smoke on `app-dev.nutrixplorer.com` post auto-redeploy. DoD items completed.

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

---

## Merge Checklist Evidence

| Check | Evidence | Status |
|-------|----------|--------|
| AC5 operator smoke | — | pending post-deploy |
| AC6 operator smoke | — | pending post-deploy |
| AC7 operator smoke | — | pending post-deploy |
| `npm test -w @foodxplorer/web` | — | pending Step 4 |
| lint 0 | — | pending Step 4 |
| typecheck 0 | — | pending Step 4 |
| build clean | — | pending Step 4 |
| `docs/specs/ui-components.md` updated | — | pending Step 6 |
| `docs/specs/design-guidelines.md` W18 updated | — | pending Step 6 |
| `bugs.md` 3 entries flipped | — | pending Step 6 |
| `key_facts.md` updated | — | pending Step 6 |
| memory `feedback_hand_rolled_scroll_anti_pattern` saved | — | pending Step 6 |
| research doc closing note added | — | pending Step 6 |

---

## Notes

**License verification:**
`react-virtuoso` is MIT-licensed. Confirmed via `npm view react-virtuoso license` → `MIT`; package version `4.18.7`; GitHub README: "MIT License" badge present on https://github.com/petyosi/react-virtuoso. Source file `packages/react-virtuoso/src/interfaces.ts:492` defines `export type ListRootProps = Omit<React.HTMLProps<HTMLDivElement>, 'data' | 'ref'>` (the free `Virtuoso` component's root prop type — all standard HTML/ARIA attributes accepted; see ARIA root props below).

**ARIA root props:**
`VirtuosoProps<Data, Context> extends ListRootProps` (source: `packages/react-virtuoso/src/component-interfaces/Virtuoso.ts:156` in petyosi/react-virtuoso). Since `ListRootProps = Omit<React.HTMLProps<HTMLDivElement>, 'data' | 'ref'>` (source: `packages/react-virtuoso/src/interfaces.ts:492`), the Virtuoso component accepts any HTML/ARIA attribute as a prop: `role`, `aria-label`, `aria-busy`, `className`, `style`, `data-testid`, etc. **AC8 implementation**: pass `role="feed"`, `aria-label="Historial de consultas"`, `aria-busy={isLoadingHistory}` directly as props on `<Virtuoso>` — no wrapper needed.

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
