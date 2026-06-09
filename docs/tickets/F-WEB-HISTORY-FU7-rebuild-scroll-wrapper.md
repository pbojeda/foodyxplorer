# F-WEB-HISTORY-FU7: Canonical Scroll Architecture Rebuild — /hablar

**Feature:** F-WEB-HISTORY-FU7 | **Type:** Frontend-Architecture-Rewrite | **Priority:** High (blocking develop→main release; 2 user-facing bugs unresolved after 14 iterations)
**Status:** Spec | **Branch:** `rebuild/F-WEB-HISTORY-FU7-rebuild-scroll-wrapper`
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-06-08 | **Tier:** Standard | **Dependencies:** F-WEB-HISTORY-FU6 done @ `803378f`
**Revision:** 2.1 (2026-06-09 — addresses cross-model round 2 findings: RateLimitNudge sibling slot, desktop max-w-2xl, prepend not prototype-validated, AC30 collapsed into DoD)

---

## Spec

### Description

#### Failure History — 14 Iterations, Two Surviving Bugs

The `/hablar` page is the primary nutriXplorer interface: an append-only feed of nutrition search entries (`TranscriptFeed`) above a fixed input composer (`ConversationInput`). Since F-WEB-HISTORY introduced the feed architecture, two bugs have survived every attempted fix across 14 iterations (FU1 through FU6 + reverts + point fixes):

**BUG A (AC6 — scroll settle):** After a new search resolves, the resulting `NutritionCard` ends up partially obscured by the `ConversationInput` bar. The card is fully rendered in the DOM but the feed's scroll position does not move far enough to bring the card's bottom edge above the input bar's top edge.

**BUG B (card right-side clipping):** On iOS Safari mobile AND on web desktop, the right side of the `NutritionCard` — including the delete button on persisted entries — is hidden. The card's right edge extends past the visible scrollport, as if an ancestor's `overflow: hidden` clips it, or the layout width contract between feed and card is broken.

#### Iteration Log (Evidence of Methodological Dead End)

The current state of `develop` is `803378f` (FU6 revert+fix). The sequence leading here:

| PR | Change | Bug A | Bug B |
|----|--------|-------|-------|
| FU1–FU4 (manual, #310–#313) | Hand-rolled `scrollTop` + ResizeObserver + useLayoutEffect variants | Still present | Still present |
| FU5 (revert+fix) | Partial revert to baseline; point patches | Still present | Still present |
| FU6 base (`ae515bc`) | Pivot to `react-virtuoso` (`<Virtuoso>`) | Still present | Still present |
| FU6-FU1 (`652ede8`) | `VirtuosoFooter` spacer + batched `firstItemIndex` + `overflow-x-hidden` | Still present | Partially addressed |
| FU6-FU2 (`179891e`) | Dynamic `--input-bar-height` CSS var via `ResizeObserver` + `min-w-0` patches | Still present | Regressed |
| FU6-FU3 (`e83a32d`) | `scrollTo MAX` + `grid grid-cols-3` experiment | Still present | Still present |
| FU6-FU4 (`803378f`) | `scrollToIndex(LAST, end)` + `flex-wrap` macro row | Still present | Still present |

**Total: 14 iterations failed** (10 manual scroll FU1–FU5 + 4 react-virtuoso FU6 sub-iterations + revert+fix). Cross-model `/review-spec` Round 1 (2026-06-08): **REVISE** (Gemini and Codex both). Prototype validation (2026-06-09): **ALL 4 critical scenarios PASS**. Cross-model Round 2: TBD (post-revision).

Each iteration added complexity — `VirtuosoFooter` spacer, `ResizeObserver` publishing `--input-bar-height`, `atBottomRef`, `min-w-0` defensive patches, `overflow-x-hidden` on the Virtuoso outer wrapper — without closing either bug in operator testing on `app-dev.nutrixplorer.com`.

#### Root Cause Hypothesis

The persistence of both bugs across `react-virtuoso`-based and manual-scroll-based approaches points to a **layout contract mismatch** rather than a scroll-timing problem. Specifically:

1. `ConversationInput` uses `position: fixed; bottom: 0; left: 0; right: 0` (see `ConversationInput.tsx` line 84). This removes the composer from the document flow and overlays it on top of the scrollport's bottom edge.
2. `Virtuoso` renders a scroll container that fills `flex-1`. The items inside it have no intrinsic knowledge of the overlay above them. Clearance is achieved via a `VirtuosoFooter` spacer whose height is set to `var(--input-bar-height, 12rem)` — a CSS-variable published by a `ResizeObserver` attached to the input bar in `HablarShell.tsx` lines 184–198.
3. This two-component clearance contract (ResizeObserver publisher → CSS var → Virtuoso Footer consumer) is fragile: the var is unset at first paint (12rem fallback fires), ResizeObserver fires asynchronously after layout, and Virtuoso's internal scroller layout may not reflow in response to footer height changes synchronously with the scroll-to-last imperative.

Cross-model analysis (Gemini 95% confidence, Codex 84% confidence, 2026-06-08) independently converged on the same diagnosis: the `position: fixed` overlay is the deep cause. Both models recommended moving to a "single width-constrained bottom-anchored column where feed scrollport and composer share the same layout contract."

#### Rebuild Rationale — Return to Canonical Spec

The complexity layered in FU6 (Virtuoso, Footer spacer, ResizeObserver, CSS var) drifted in as each iteration tried to patch the overlay-vs-scroll-container tension without architectural clarity. This ticket is a **return to the canonical layout intent**, not a design change.

The F-WEB-HISTORY data model — `sessionEntries` local state, `persistedEntries` from `useSearchHistory`, `allEntries = useMemo([...persistedEntries, ...sessionEntries])`, the mount gate, and all handlers in `HablarShell` — is preserved without modification.

What changes is exclusively the layout shell and the `TranscriptFeed` scroll mechanism. See **Locked Architecture** below.

#### What Is NOT Changing

- All handlers in `HablarShell.tsx`: `executeQuery`, `executePhotoAnalysis`, `handleDishSelect`, `handleDeleteEntry`, `handleClearAll`, `handleRetry`.
- The `sessionEntries` / `persistedEntries` / `allEntries` state split and `useMemo` derivation.
- The mount gate (`isGated = authLoading || (!!user && isLoadingHistory)`).
- The `useSearchHistory` hook contract (persisted entries, `hasMoreHistory`, `isLoadingMore`, `firstItemIndex`, `loadMore`, `deleteEntry`, `clearAll`).
- Auth integration (`useAuth`, `LoginCta`, `UsageMeter`, `UserMenu`, bearer sync).
- Voice integration (`useVoiceSession`, `useTtsPlayback`, `VoiceOverlay`, all voice state).
- Photo integration (`executePhotoAnalysis`, `PhotoModeToggle`, `resizeImageForUpload`).
- `TranscriptEntry`, `NutritionCard`, `EmptyState`, `HistoryEmptyState`, `HistoryPersistenceNudge`, `ClearHistoryButton` — zero changes to these components.
- All API endpoints and data models.

---

## Empirical Validation (Prototype)

A prototype was built at the `/hablar-v2` route (branch `prototype/hablar-v2-in-column-composer` @ `e285711`) and deployed to Vercel preview (`https://foodyassistance-cfjnep012-pbojedas-projects.vercel.app/hablar-v2`). The owner tested on a real iPhone (Safari iOS) and Chrome/Safari desktop on 2026-06-09. All 4 critical scenarios passed:

| Test | Scenario | Result |
|------|----------|--------|
| 1 | BUG A scroll-on-settle: card fully visible above composer after settle | PASS |
| 2 | BUG B right-clipping: long-title cards visible end-to-end + delete button visible | PASS |
| 3 | iOS keyboard: composer stays visible above keyboard when textarea focused | PASS |
| 4 | Pin-aware: scrolled-up viewport preserved when new entry settles | PASS |

**Prototype architecture validated:** native `<div className="flex-1 overflow-y-auto overscroll-contain">` feed + in-column composer (no `position: fixed`) + pin-aware auto-scroll (`requestAnimationFrame` + `scrollTop = scrollHeight` only if `scrollHeight - scrollTop - clientHeight < 100px`). The prototype source is `packages/web/src/components/HablarV2Shell.tsx` (branch `prototype/hablar-v2-in-column-composer`).

**Implication:** The FU7 rebuild adopts the prototype's architecture verbatim. The iOS keyboard risk flagged as a concern in the prior spec draft is resolved — the in-column composer with `pb-[calc(12px+env(safe-area-inset-bottom))]` on the composer div stays visible above the iOS keyboard because Safari raises the `dvh` viewport on keyboard open. This is empirical refutation of the prior assumption that `position: fixed` composer was a known-good requirement for iOS.

**Cleanup:** The `/hablar-v2` route and `HablarV2Shell.tsx` are **temporary**. They are deleted in the FU7 final PR. They must NOT be present in the merge commit.

---

## ADR-030 Architectural Reversal — Rationale

This section exists because the FU7 rebuild reverses an established architectural decision documented in multiple spec files.

**What is being reversed:** `key_facts.md` (line 31), `design-guidelines.md` (lines 1439–1441), and `ui-components.md` (lines 2478–2496) currently document `react-virtuoso` as the **canonical implementation** of chat/feed/timeline scroll in this project, with hand-rolled scroll declared an **anti-pattern**. That rule was written after FU6 to capture the lesson from 10 failed manual-scroll iterations.

**Why the reversal is valid:** The FU6 post-mortem diagnosis was correct in its specific claim — the combination of `manual scroll arithmetic + position-fixed overlay composer` is an anti-pattern. That is still true. But the FU6 conclusion over-generalized: it labelled all non-library scroll as the problem, when the actual failure mode was the **clearance contract** between a fixed overlay and a scroll container that cannot natively measure the overlay. With an in-column composer (no overlay, no clearance needed), native `overflow-y-auto` is trivially correct: no arithmetic, no measurement races, no library needed. The prototype empirically proves this.

**Lesson refinement (for ADR-030 and `key_facts.md`):** The anti-pattern is `hand-rolled scroll arithmetic + position-fixed overlay composer`. Native `overflow-y-auto` + in-column composer is safe. `react-virtuoso` remains appropriate for virtualization of large lists (>200 items). For ≤50 items with in-column layout, it is unnecessary overhead.

**Required documentation updates (part of Definition of Done):**

1. **`docs/project_notes/key_facts.md`** — add a "Note" addendum to the `react-virtuoso` line (line 31): `Note (ADR-030): react-virtuoso requirement lifted when composer is in-column per ADR-030. Do not re-introduce for ≤50-item feeds.` Do NOT delete the historical note — preserve the lesson.

2. **`docs/project_notes/decisions.md`** — add ADR-030 entry following the existing ADR-027/028/029 template format (Context / Decision / Alternatives Considered / Consequences). It must reference this ticket and cross-reference ADR-028 (F-WEB-HISTORY origin), noting the reversal of the react-virtuoso canonical rule.

3. **`docs/specs/design-guidelines.md`** — update the W18 section (lines 1439–1441) to replace the `react-virtuoso` canonical rule with the native-scroll + in-column composer rule per ADR-030. Both the W18 note and the layout diagram at lines 1357–1367 must be consistent with in-column composer (no `[ConversationInput — fixed bar]` label; instead `[ConversationInput — flex-shrink-0 row]`).

4. **`docs/specs/ui-components.md`** — update the `TranscriptFeed` component contract (lines 2478–2509) to reflect native scroll + in-column composer architecture. Remove Virtuoso-specific props table, `VirtuosoHeader` slot description, and the 3-ref FU6 architecture block. Replace with the native `div`-based scroll contract.

5. **`docs/specs/hablar-design-guidelines.md`** — update the layout diagram at lines 416–434. The composer is no longer `position: fixed bottom-0`; it is `flex-shrink-0` at the natural end of the column. Replace `padding-bottom: 84px` clearance in `ResultsArea` with `overscroll-contain` (no clearance needed). Update the ASCII diagram to show the in-column structure. This doc previously conflicted with `design-guidelines.md` lines 1357–1367 (which described the newer F-WEB-HISTORY layout); after this update both docs must be consistent.

---

## Locked Architecture (Empirically Validated)

The architecture is locked. There are no open options. All three axes are determined by the prototype validation:

**Axis 1 — Scroll engine: NATIVE div**

`TranscriptFeed` uses `<div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 lg:max-w-2xl lg:mx-auto w-full" role="feed" aria-label="Historial de consultas">`. The `lg:max-w-2xl lg:mx-auto w-full` is REQUIRED — it preserves the single-column desktop layout per `design-guidelines.md:1364` (matches both the validated prototype `HablarV2Shell.tsx:323` and the existing design contract). No `react-virtuoso`, no `Virtuoso`, no `VirtuosoFooter`, no `VirtuosoHeader`, no `VirtuosoHandle`. ADR-030 documents this as a **REVERSAL** of the prior react-virtuoso canonical rule (see ADR-030 Architectural Reversal section above).

**Axis 2 — Composer position: IN-COLUMN**

`ConversationInput` is a `flex-shrink-0` sibling at the natural end of the `h-[100dvh] flex-col` shell. It is NOT `position: fixed bottom-0`. The shell structure (CONDITIONAL `RateLimitNudge` slot included — per AC15 + current `HablarShell.tsx:690-694`):

```
<div className="flex h-[100dvh] flex-col bg-white">
  <header className="flex-shrink-0 h-[52px] ...">                      ← AppBar
  <div className="flex-1 overflow-y-auto ... lg:max-w-2xl lg:mx-auto"> ← TranscriptFeed (feed scrollport)
  {showRateLimitNudge && !user && (
    <div className="flex-shrink-0 px-4 pb-2">
      <RateLimitNudge .../>                                            ← sibling slot, ONLY when active (AC15)
    </div>
  )}
  <div className="flex-shrink-0 ...">                                  ← ConversationInput (in-column)
</div>
```

The `RateLimitNudge` is a sibling between feed and composer, NOT inside either. It only renders for anonymous 429; it shrinks the feed naturally via flex layout when active.

No `padding-bottom` clearance on the feed. No Footer spacer. No `--input-bar-height` CSS var. No ResizeObserver on the composer. The feed scrollport bottom IS the composer top — guaranteed by CSS flex layout.

Composer bottom padding: `pb-[calc(12px+env(safe-area-inset-bottom))]` handles iOS safe area. Validated on real iPhone Safari: composer remains visible above keyboard on tap (Safari raises the `dvh` viewport on keyboard open, so the in-column layout naturally stays visible).

**Axis 3 — Auto-scroll: PIN-AWARE**

Auto-scroll on entry settle (the last entry's `isLoading` flips `true → false`): scroll to bottom **only if** the feed's `scrollTop` position was within 100px of `scrollHeight` (near-bottom) **before** the settle. If the user had scrolled up (more than 100px from bottom), preserve the viewport position — do NOT hijack.

Implementation (from validated prototype `HablarV2Shell.tsx`):
- `wasNearBottomRef` updated on every `onScroll` event: `distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight; wasNearBottomRef.current = distanceFromBottom < 100`.
- `prevLastLoadingRef` tracks previous loading state of the last entry.
- On settle detect (`prevLastLoadingRef.current === true && currentLastLoading === false`): if `wasNearBottomRef.current`, fire `requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })`.
- On mount: `el.scrollTop = el.scrollHeight` (scroll to bottom once, `wasNearBottomRef.current = true`).

This is the identical scroll-to-bottom behavior that `design-guidelines.md` lines 1366–1367 and 1765 specify (only auto-scroll when within 100px of bottom).

---

### API Changes

None. This ticket is frontend-only. No API endpoints are added, modified, or removed.

### Data Model Changes

None. The `TranscriptEntryData` type, `useSearchHistory` hook contract, and all Zod schemas in `shared/src/schemas/` are unchanged.

### UI Changes

See `docs/specs/ui-components.md` — the following components are updated in the global spec (also required by Definition of Done):

**`HablarShell` (updated):**
- Remove `inputBarRef` and the `ResizeObserver` `useEffect` that publishes `--input-bar-height` (lines 169–198 of current file).
- Remove `outerRef` prop from `<ConversationInput>` call.
- Shell root div: `flex h-[100dvh] flex-col bg-white` (unchanged).
- `ConversationInput` loses `position: fixed`; it becomes a `flex-shrink-0` block (in-column, Axis 2 locked).

**`TranscriptFeed` (rewritten):**
- Replace `<Virtuoso>` with a plain scrollable `<div>` (`role="feed"` `aria-label="Historial de consultas"`).
- Scroll container: `flex-1 overflow-y-auto overscroll-contain px-4 pt-4 lg:max-w-2xl lg:mx-auto w-full` — preserves desktop centering per `design-guidelines.md:1364`; no explicit `pb-` clearance padding (in-column composer eliminates it).
- Items rendered as a direct map of `entries` (no `itemContent` virtuoso callback). Each item is a `TranscriptEntry` with a divider below all-but-last.
- Header slot content (load-more button, loading skeletons, `ClearHistoryButton`, `HistoryPersistenceNudge`, empty states) rendered as leading `div` children of the scroll container, not via Virtuoso `components.Header`.
- Scroll-to-bottom on settle: `useRef<HTMLDivElement>` on the scroll container + pin-aware `useEffect` as described in Axis 3 above.
- Prepend-without-jump: before `loadMore` resolves, record `el.scrollHeight - el.scrollTop`; after new entries arrive, restore `el.scrollTop = el.scrollHeight - savedDelta`. This replaces `firstItemIndex`.
- `firstItemIndex` prop removed from `TranscriptFeedProps` (no longer needed without Virtuoso).
- Remove `VirtuosoHandle` ref, `VirtuosoFooter`, `VirtuosoHeader`, `FeedContext` interface, `loadMoreInFlightRef` (replaced by a simpler ref guard on the scroll handler).

**`ConversationInput` (updated):**
- Remove `outerRef` prop (no longer consumed by a ResizeObserver).
- Replace `fixed bottom-0 left-0 right: 0` with block-level positioning (`w-full`).
- Bottom padding: `pb-[calc(12px+env(safe-area-inset-bottom))]` (iOS safe area).
- All other props and internal logic unchanged.

### Edge Cases and Error Handling

**iOS keyboard (validated):** The virtual keyboard on Safari iOS raises the `dvh` viewport. With in-column composer and `pb-[calc(12px+env(safe-area-inset-bottom))]`, the composer stays visible above the keyboard. Empirically verified on real iPhone in prototype testing (2026-06-09). This concern is closed.

**Prepend anchoring (SPEC-DEFINED, NOT prototype-validated):** The `/hablar-v2` prototype does NOT include the prepend/load-more path. AC7 (prepend without scroll jump) is therefore spec-defined behavior, not empirically validated by the prototype. Implementation MUST verify via integration test + operator smoke on `app-dev` post-deploy. The proposed mechanism (save `scrollHeight - scrollTop` before loadMore, restore after) is the canonical approach but has not been tested in this rebuild's specific stack.

**`firstItemIndex` removal:** The `useSearchHistory` hook still exports `firstItemIndex`. After this rebuild the feed no longer consumes it. The hook export should remain (removing it is a separate hook simplification out of scope) but the prop is dropped from `TranscriptFeedProps`.

**ResizeObserver cleanup:** `HablarShell` currently cleans up the ResizeObserver and removes `--input-bar-height` on unmount (lines 194–198). After removal, ensure the CSS variable is not referenced anywhere else (`grep --input-bar-height`) — it must not be left as a dangling reference.

**Test suite:** Some existing tests mock or reference `react-virtuoso` (`Virtuoso`, `VirtuosoHandle`). These must be rewritten to test the plain scrollable `div` equivalent. Net test count should be similar; complexity should decrease.

**`/hablar-v2` cleanup:** The prototype route and `HablarV2Shell.tsx` must be deleted in the FU7 PR. The planner must include a step for this deletion.

---

## Implementation Plan

_Pending — to be generated by the `frontend-planner` agent in Step 2 (after ui-ux-designer review if requested)._

---

## Acceptance Criteria

### AC1 — Anonymous empty state
- [ ] An unauthenticated user visiting `/hablar` sees `EmptyState` rendered inside the feed area, vertically above the input bar with no overlap.

### AC2 — Authenticated empty state
- [ ] An authenticated user with no history sees `HistoryEmptyState` rendered inside the feed area, vertically above the input bar with no overlap.

### AC3 — Mount gate (auth loading)
- [ ] While `authLoading` is true, the feed renders a placeholder `div` with `role="feed"` and `aria-busy="true"`. `TranscriptFeed` is NOT mounted.

### AC4 — Mount gate (history loading)
- [ ] For an authenticated user, while `isLoadingHistory` is true, `TranscriptFeed` is NOT mounted. Once `isLoadingHistory` becomes false, `TranscriptFeed` mounts once with the full `allEntries` array.

### AC5 — Hydration scroll: last entry visible on load
- [ ] On initial load for an authenticated user with ≥1 persisted entry, the last (newest) persisted entry is visible at the bottom of the feed without manual scrolling. The entry is NOT obscured by the input bar.

### AC6 — BUG A definitively resolved: new search settles fully visible
- [ ] After submitting a text query, the shimmer entry appears, then resolves to a `NutritionCard`. The bottom edge of the resolved card is fully visible above the input bar top edge on Chrome desktop, Safari desktop, and Safari iOS mobile. The card is NOT partially covered. Verified by operator on `app-dev.nutrixplorer.com`.

### AC7 — Prepend without scroll jump
- [ ] When `loadMore` is triggered (scrolling to the top of the feed), older entries prepend to the list. The user's scroll position (visible content) does not jump. The entry the user was viewing remains in the viewport after prepend completes.

### AC8 — BUG B resolved: full-width card, no right-side clipping (iOS mobile)
- [ ] On Safari iOS mobile, a `NutritionCard` in the feed is fully visible end-to-end horizontally. Long dish names wrap; they do not extend outside the visible area. No right-side content is clipped. Verified by operator on a real iOS device.

### AC9 — BUG B resolved: full-width card, delete button visible (web desktop)
- [ ] On Chrome desktop and Safari desktop, a persisted entry's delete button is visible and tappable. The card right edge does not extend past the visible scrollport. Verified by operator on `app-dev.nutrixplorer.com`.

### AC10 — Voice flow: result appended to feed
- [ ] Completing a voice query via `VoiceOverlay` appends a new `TranscriptEntry` at the bottom of the feed. The entry is fully visible above the input bar after settle (same constraint as AC6).

### AC11 — Photo flow: result appended to feed
- [ ] Selecting a photo triggers a shimmer pending entry, which resolves to a photo result card. The resolved card is fully visible above the input bar after settle (same constraint as AC6).

### AC12 — Delete persisted entry
- [ ] Tapping the delete button on a persisted entry removes it from the feed visually and calls the API delete. Session entries' delete button (if rendered) removes only from local state.

### AC13 — Clear all: persisted only, session preserved
- [ ] Tapping "Borrar historial" clears all persisted entries from the feed. Any session entries (added in the current browser session) are NOT cleared. They remain visible in the feed after `clearAll` resolves.

### AC14 — Persistence nudge shown then dismissable
- [ ] An anonymous user who has submitted ≥2 queries sees `HistoryPersistenceNudge` in the feed. Tapping dismiss removes it from view and it does not reappear in the same session.

### AC15 — RateLimitNudge sibling (anonymous 429)
- [ ] When an anonymous user receives a 429 rate-limit error, `RateLimitNudge` renders as a sibling below the feed (above the input bar), not inside the feed. It is visible and not overlapping the input bar.

### AC16 — Inline error in composer
- [ ] When `inlineError` is non-null, it renders above the textarea inside the composer. The composer height increases to accommodate it. The feed bottom-of-last-entry clearance remains sufficient (BUG A does not regress when inline error appears).

### AC17 — PhotoModeToggle visible
- [ ] `PhotoModeToggle` (auto / solo este plato) is visible below the input row inside the composer. It is not clipped.

### AC18 — Error entry with Reintentar
- [ ] A failed query renders an error entry in the feed with a "Reintentar" button. Tapping it calls `handleRetry` which appends a new query entry.

### AC19 — Auth slot: LoginCta when anonymous
- [ ] An unauthenticated user sees `LoginCta` in the app bar header (top right area). `UsageMeter` and `UserMenu` are NOT rendered.

### AC20 — Auth slot: UsageMeter + UserMenu when authenticated
- [ ] An authenticated user sees `UsageMeter` and `UserMenu` in the app bar header. `LoginCta` is NOT rendered.

### AC21 — Accessibility: role="feed" + aria-label on feed container
- [ ] The scroll container rendered by `TranscriptFeed` has `role="feed"` and `aria-label="Historial de consultas"`.

### AC22 — Accessibility: role="article" per entry
- [ ] Each `TranscriptEntry` renders with `role="article"`. (No change to `TranscriptEntry` itself — verify it is unaffected by the rebuild.)

### AC23 — Accessibility: aria-busy on mount gate placeholder
- [ ] The mount gate placeholder `div` has `role="feed"` and `aria-busy="true"`. Once `TranscriptFeed` mounts, `aria-busy` is removed (or the placeholder is unmounted).

### AC24 — Load-more sr-only keyboard button
- [ ] When `hasMoreHistory` is true and `isLoadingMore` is false, a `sr-only` focusable "Cargar más historial" button is rendered at the top of the feed for keyboard users.

### AC25 — Pin-aware auto-scroll on settle
- [ ] Auto-scroll on entry settle (last entry `isLoading` flips `true → false`): if the feed `scrollTop` was within 100px of `scrollHeight` (near-bottom) before the settle, the feed scrolls to bottom via `requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })`. If the user had scrolled up (>100px from bottom), the viewport position is preserved — the new settled card is NOT forced into view.

### AC26 — iOS keyboard: composer visible on focus
- [ ] On Safari iOS mobile, tapping the textarea in the composer does not push the composer off-screen below the keyboard. The composer remains fully visible above the keyboard after the virtual keyboard opens. Verified by operator on a real iOS device.

### AC27 — All tests pass (≥ 796 web tests)
- [ ] `pnpm --filter web test` passes with zero failures. Tests that previously mocked `react-virtuoso` are rewritten to test the plain `div` equivalent. Net test count is similar to pre-rebuild.

### AC28 — Lint, typecheck, build clean
- [ ] `pnpm --filter web lint`, `pnpm --filter web typecheck`, and `pnpm --filter web build` all exit 0 with zero errors.

### AC29 — Prototype files deleted
- [ ] `packages/web/src/components/HablarV2Shell.tsx` is absent from the merge commit. The `/hablar-v2` route (page file) is absent. Verified by `git show --name-only HEAD` in the Completion Log.

<!--
NOTE: A previous AC30 ("hablar-design-guidelines.md updated: in-column layout")
was removed in rev2.1 (cross-model round 2 finding G-IMP). The doc update
remains required — it is enumerated in the Definition of Done section below
as one of FIVE required documentation updates (alongside key_facts.md,
decisions.md ADR-030, design-guidelines.md, ui-components.md). Singling out
one of five updates as a top-level AC was misleading; the DoD is the single
source of truth for documentation requirements.
-->

---

## Implementation Targets (non-AC)

These are implementation commitments that inform planning and the Completion Log but do not function as user-facing acceptance criteria checkboxes.

- **Net code reduction target:** Combined diff of `TranscriptFeed.tsx` + `HablarShell.tsx` + `ConversationInput.tsx` shows a net reduction of at least 150 lines. Verified by `git diff --stat` in Completion Log.
- **Dependency removal:** `packages/web/package.json` does NOT contain `react-virtuoso` after this ticket. No new npm dependencies added. Net dependency count: -1.
- **Bundle size delta target:** Removing `react-virtuoso` (~50 KB gzipped) reduces the web bundle by an estimated 40–60 KB. The Completion Log records before/after bundle size for the `/hablar` route (measured via `next build` output or `@next/bundle-analyzer`).

---

## Definition of Done

- [ ] AC6 (BUG A) and AC8 + AC9 (BUG B) verified by operator on `app-dev.nutrixplorer.com` on Chrome desktop, Safari desktop, and Safari iOS mobile
- [ ] All 29 Acceptance Criteria above met
- [ ] All web tests passing (`pnpm --filter web test` — 796+)
- [ ] `pnpm --filter web lint` clean (zero errors)
- [ ] `pnpm --filter web typecheck` clean (zero errors)
- [ ] `pnpm --filter web build` succeeds
- [ ] `react-virtuoso` removed from `packages/web/package.json`
- [ ] No new dependencies added
- [ ] Net code reduction ≥ 150 lines documented in Completion Log
- [ ] Bundle size delta documented in Completion Log
- [ ] Prototype files deleted: `HablarV2Shell.tsx` + `/hablar-v2` route absent from merge commit
- [ ] ADR-030 written in `docs/project_notes/decisions.md`: full Context / Decision / Alternatives Considered / Consequences format, cross-referencing ADR-028, acknowledging the react-virtuoso reversal and its rationale
- [ ] `docs/project_notes/key_facts.md` line 31 addended: "Note (ADR-030): react-virtuoso requirement lifted when composer is in-column per ADR-030. Do not re-introduce for ≤50-item feeds." Prior entry preserved (not deleted).
- [ ] `docs/specs/ui-components.md` updated: `TranscriptFeed` section (lines 2478–2509) reflects native scroll + in-column composer. Virtuoso props table, `VirtuosoHeader` slot, and 3-ref FU6 architecture block replaced.
- [ ] `docs/specs/design-guidelines.md` updated: W18 section (lines 1439–1441) replaces react-virtuoso canonical rule with native-scroll + in-column rule. Layout diagram at lines 1357–1361 updated: `[ConversationInput — fixed bar]` → `[ConversationInput — flex-shrink-0 row]`.
- [ ] `docs/specs/hablar-design-guidelines.md` updated: lines 416–434 reflect in-column composer. ASCII diagram updated. `padding-bottom: 84px` clearance removed from ResultsArea spec.
- [ ] Cross-model `/review-spec` Round 2 APPROVED (Gemini + Codex)
- [ ] Cross-model `/review-plan` APPROVED (Gemini + Codex, 2–3 rounds if needed)
- [ ] Code reviewed by `code-review-specialist`
- [ ] QA pass by `qa-engineer`

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated, ticket `## Spec` written (Revision 1)
- [x] Step 0: Composer position ADR decision resolved — in-column (Axis 2 locked, empirically validated)
- [x] Step 0: Spec Revision 2 — cross-model REVISE findings applied + prototype validation incorporated
- [ ] Step 0: Cross-model `/review-spec` Round 2 APPROVED
- [ ] Step 1: Branch `rebuild/F-WEB-HISTORY-FU7-rebuild-scroll-wrapper` created, tracker updated
- [ ] Step 2: `ui-ux-designer` reviewed (optional — confirm with owner)
- [ ] Step 2: `frontend-planner` executed, Implementation Plan written and APPROVED
- [ ] Step 2: Cross-model `/review-plan` APPROVED
- [ ] Step 3: `frontend-developer` executed with TDD
- [ ] Step 3: `react-virtuoso` import removed from `packages/web/package.json`
- [ ] Step 3: `--input-bar-height` CSS var usage confirmed absent (grep clean)
- [ ] Step 3: `HablarV2Shell.tsx` + `/hablar-v2` route deleted
- [ ] Step 4: `production-code-validator` executed, all quality gates pass
- [ ] Step 5: `code-review-specialist` executed, findings addressed
- [ ] Step 5: `qa-engineer` executed, operator smoke tests AC6/AC8/AC9/AC26 PASS on real devices
- [ ] Step 6: Completion Log filled, tracker updated, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-06-08 | Step 0 — Spec Revision 1 drafted by spec-creator | Composer position ADR decision pending owner |
| 2026-06-09 | Step 0 — Spec Revision 2 by spec-creator | Cross-model REVISE findings applied; prototype validation ALL 4 PASS incorporated; architecture locked (in-column); ADR-030 reversal documented |
| 2026-06-09 | Step 0 — /review-spec round 2 cross-model | Gemini APPROVED + Codex REVISE (2 IMPORTANT + 1 SUGGESTION). Findings: RateLimitNudge sibling slot omitted from Axis 2; lg:max-w-2xl mx-auto dropped from feed contract; prepend not prototype-validated; AC30 redundant with DoD |
| 2026-06-09 | Step 0 — Spec Revision 2.1 direct edits | All 4 round-2 findings closed: (1) RateLimitNudge sibling slot added to Axis 2 shell; (2) `lg:max-w-2xl lg:mx-auto w-full` added to Axis 1 + UI Changes; (3) Prepend SPEC-DEFINED-NOT-PROTOTYPE-VALIDATED note in Edge Cases; (4) AC30 collapsed into DoD (AC count 30→29). 4/4 closed without need for round 3 |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | Sections verified: (list) |
| 1. Mark all items | [ ] | AC: _/30, DoD: _/19, Workflow: _/_ |
| 2. Verify product tracker | [ ] | Active Session: step _/6, Features table: _/6 |
| 3. Update key_facts.md | [ ] | Updated: (list) / N/A |
| 4. Update decisions.md | [ ] | ADR-030 added / N/A |
| 5. Commit documentation | [ ] | Commit: (hash) |
| 6. Verify clean working tree | [ ] | `git status`: clean |
| 7. Verify branch up to date | [ ] | merge-base: up to date / merged origin/<branch> |
| 9. Run `/audit-merge` | [ ] | See § "Audit Merge Output" below |

## Audit Merge Output

> Paste the FULL verbatim output of `/audit-merge` below. The block must include both tables
> (structural + drift), all rows, the combined verdict, AND the final self-verification line
> in the form `Structural: N/N PASS | Drift: K advisory | Verdict: <APPROVE|REVISE>`. Do NOT
> abbreviate, summarize, or omit failing rows. Required for the D1 structural check to PASS.

```text
<paste /audit-merge output here>
```

---

## References

- Cross-model `/review-spec` verdict files: `/tmp/review-spec-fu7-2026-06-08/` (Round 1 — both models: REVISE)
- Prototype Vercel preview: `https://foodyassistance-cfjnep012-pbojedas-projects.vercel.app/hablar-v2`
- Prototype branch + commit: `prototype/hablar-v2-in-column-composer` @ `e285711`
- Prototype source: `packages/web/src/components/HablarV2Shell.tsx`
- Memory: `project_scroll_arch_decision_2026_06_06.md` — owner directive to stop patching hand-rolled scroll
- Memory: `fu7_scroll_rebuild_patterns.md` — FU7 pre-revision patterns and open ADR decision
- Memory: user `feedback_hand_rolled_scroll_anti_pattern.md` — chat/feed scroll anti-pattern rule (now refined per ADR-030)

---

*Ticket created: 2026-06-08 | Revised: 2026-06-09*
