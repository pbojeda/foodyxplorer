# F-WEB-HISTORY-FU7: Canonical Scroll Architecture Rebuild — /hablar

**Feature:** F-WEB-HISTORY-FU7 | **Type:** Frontend-Architecture-Rewrite | **Priority:** High (blocking develop→main release; 2 user-facing bugs unresolved after 14 iterations)
**Status:** Done | **Branch:** `rebuild/F-WEB-HISTORY-FU7-rebuild-scroll-wrapper` (deleted post-merge) | **Merged:** `b6eecc5` via PR #320 (2026-06-09)
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

_Generated by `frontend-planner` on 2026-06-09. Empirically verified against current codebase before writing._

---

### Answers to Open Questions (Q1–Q4)

**Q1 — `isLoadingHistory` prop on `TranscriptFeed`: keep or drop?**
**KEEP the prop signature intact.** The mount gate in `HablarShell` already prevents `TranscriptFeed` from mounting while `isLoadingHistory` is true — so `TranscriptFeed` never sees `isLoadingHistory=true` at runtime. However, the prop must stay in `TranscriptFeedProps` because:
(a) Removing it is a breaking prop-type change in the same PR as the architecture rewrite — unnecessary coupling.
(b) Dozens of test fixture `defaultProps` objects include `isLoadingHistory: false` and would all need mechanical updates with no behavioral gain.
(c) The `ui-components.md` spec (line 2474) lists it explicitly with the note "consumed by HablarShell mount gate, not TranscriptFeed directly".
Action: Keep the prop, keep the `_isLoadingHistory` unused-but-named destructure pattern. Leave as-is.

**Q2 — `onRetry` and `onDishSelect`: already present in FU6 or new?**
Both are already present in the current `TranscriptFeedProps` (verified: `TranscriptFeed.tsx` lines 38–39; `HablarShell.tsx` lines 684–686). No new props needed. The new `TranscriptFeed` preserves the identical signature.

**Q3 — `firstItemIndex` on `useSearchHistory`: leave or simplify?**
**LEAVE the hook untouched.** `useSearchHistory` is out of scope for this ticket (ticket Edge Cases section is explicit). The only change is that `firstItemIndex` is no longer destructured or passed down in `HablarShell`, and it is removed from `TranscriptFeedProps`. The hook continues to export it (a future cleanup ticket can remove it if desired). No test changes in `useSearchHistory` tests.

**Q4 — `hablar-design-guidelines.md` Section 6.3 breakpoint table 2-column grid drift — fix or defer?**
**DEFER.** The 2-column grid described in Section 6.3 (tablet/desktop `grid-cols-2`) is implemented inside `TranscriptEntry.tsx` (not `TranscriptFeed`), which is not touched in this rebuild. The drift is a documentation inconsistency only — the grid works in the real application because `TranscriptEntry` already applies `md:grid-cols-2`. Fixing the misleading language in Section 6.3 is a doc-only task that belongs in a future housekeeping ticket. The FU7 PR does NOT touch `hablar-design-guidelines.md` Section 6.3.

---

### Existing Code to Reuse

The following are preserved **completely unchanged**:

- `packages/web/src/hooks/useAuth.ts` — bearer sync, user/session/authLoading
- `packages/web/src/hooks/useSearchHistory.ts` — persistedEntries, hasMoreHistory, isLoadingMore, isLoadingHistory, **firstItemIndex** (hook keeps it; it just stops being consumed downstream)
- `packages/web/src/hooks/useVoiceSession.ts`
- `packages/web/src/hooks/useTtsPlayback.ts`
- `packages/web/src/lib/apiClient.ts`
- `packages/web/src/lib/metrics.ts`
- `packages/web/src/lib/actorId.ts`
- `packages/web/src/lib/imageResize.ts`
- All entry-rendering leaf components: `TranscriptEntry`, `NutritionCard`, `MenuDishItem`, `MenuDishList`, `ContextConfirmation`, `EmptyState`, `HistoryEmptyState`, `HistoryPersistenceNudge`, `ClearHistoryButton`, `DeleteEntryButton`, `LoadingState`
- All composer sub-components: `SubmitButton`, `MicButton`, `PhotoButton`, `PhotoModeToggle`
- Auth/meter/voice components: `LoginCta`, `UsageMeter`, `UserMenu`, `VoiceOverlay`, `RateLimitNudge`
- All existing test files for `useSearchHistory`, `TranscriptEntry`, `NutritionCard`, and all other components not in scope

### Existing Code to Modify

| File | Nature of Change | Lines Affected |
|------|-----------------|----------------|
| `packages/web/src/components/HablarShell.tsx` | (1) Remove `inputBarRef` declaration (line 169). (2) Remove ResizeObserver `useEffect` block (lines 184–198). (3) Remove `outerRef={inputBarRef}` from `<ConversationInput>` call (line 699). (4) Remove `firstItemIndex` from `useSearchHistory` destructure (line 126). (5) Remove `firstItemIndex={firstItemIndex}` from `<TranscriptFeed>` call (line 679). (6) Fix mount-gate placeholder class: remove `pb-[var(--input-bar-height,12rem)]` from the placeholder div (line 669). All other logic preserved verbatim. | ~15 lines net deleted |
| `packages/web/src/components/TranscriptFeed.tsx` | Full rewrite — ~293 lines replaced by ~130 lines. See "Files to Create / Rewrite" section. | All |
| `packages/web/src/components/ConversationInput.tsx` | (1) Remove `outerRef` from `ConversationInputProps` interface (lines 33–37). (2) Remove `outerRef` from destructuring (line 55). (3) Remove `ref={outerRef}` from outer div (line 83). (4) Replace `fixed bottom-0 left-0 right-0` with `w-full` in the outer div className (line 84). All internal logic preserved verbatim. | ~5 lines changed |
| `packages/web/src/__tests__/components/TranscriptFeed.test.tsx` | Full rewrite — ~531 lines. Remove all Virtuoso-specific assertions (`jest.mock('react-virtuoso')`, `capturedVirtuosoProps`, `followOutput`, `startReached`, `initialTopMostItemIndex`, `firstItemIndex` pass-through). Replace with native-div contract assertions: `role="feed"`, `aria-label`, pin-aware scroll logic (via `jsdom` ref manipulation), load-more guard, items rendered. | All |
| `packages/web/src/__tests__/components/TranscriptFeed.fu6-qa.edge-cases.test.tsx` | DELETE this file entirely — all tests are Virtuoso-specific (`scrollToIndex` spy, `followOutput`, `startReached`, `firstItemIndex` pass-through, `atBottomStateChange`). The GAP-7 (dedup guard reset) concept is preserved in the new `TranscriptFeed.test.tsx` under the native-scroll load-more dedup section. | All |
| `packages/web/src/__tests__/components/HablarShell.fu6-qa.edge-cases.test.tsx` | Update HGAP-5 section (lines 426–484): remove Virtuoso-Header-context assertions. Replace with direct DOM queries (e.g., `ClearHistoryButton` is now rendered directly by `TranscriptFeed`, not via a Virtuoso Header context slot). Other HGAP-1 through HGAP-4 tests are unaffected. | Lines 426–484 |
| `packages/web/src/__tests__/components/HablarShell.fWebHistory.test.tsx` | Remove `firstItemIndex` from all `mockUseSearchHistory.mockReturnValue(...)` calls (where present). In practice, review of the file confirms `firstItemIndex` is NOT in any mock return value — no changes needed (verified: grep found no `firstItemIndex` in this file). | 0 changes needed |
| `packages/web/package.json` | Remove `"react-virtuoso": "^4.18.7"` from `dependencies`. | 1 line |

### Files to Delete

| File | Reason |
|------|--------|
| `packages/web/__mocks__/react-virtuoso.tsx` | Jest manual mock for `react-virtuoso`. No longer needed once `react-virtuoso` is removed from the codebase. Deleting it is required because Jest will error if a `__mocks__` file exists for a package that is not installed. |
| `packages/web/src/__tests__/components/TranscriptFeed.fu6-qa.edge-cases.test.tsx` | 100% Virtuoso-specific. All test logic (scrollToIndex spy, followOutput, firstItemIndex pass-through, startReached dedup) is inapplicable after the native-div rewrite. Behavioral gaps it covered (pin-aware settle, load-more dedup) are re-covered in the rewritten `TranscriptFeed.test.tsx`. |

Note: `HablarV2Shell.tsx` and the `/hablar-v2` route do NOT exist on the current branch (`chore/lockfile-types-react-bump` / develop) — they only exist on the prototype branch. When the developer creates the `rebuild/F-WEB-HISTORY-FU7-rebuild-scroll-wrapper` branch, they should confirm whether these files exist there. Per AC29, they must be absent from the merge commit. If the branch was cut from develop, they will not be present and no action is needed.

### Files to Create

| File | Purpose |
|------|---------|
| `packages/web/src/components/TranscriptFeed.tsx` (rewrite, same path) | New native-div implementation. See architecture below. |

**`TranscriptFeed.tsx` architecture (new):**

The new file implements:
- `TranscriptFeedProps` interface: same as current but with `firstItemIndex` removed. Keep `isLoadingHistory: boolean` (Q1 decision).
- `feedRef: React.useRef<HTMLDivElement>` on the scroll container.
- `wasNearBottomRef: React.useRef<boolean>` — initialized `true`, updated on every `onScroll`.
- `prevLastLoadingRef: React.useRef<boolean>` — tracks last entry `isLoading` for settle detection.
- `savedScrollDeltaRef: React.useRef<number | null>` — captures `scrollHeight - scrollTop` before `loadMore` resolves, for prepend anchoring.
- `loadMoreInFlightRef: React.useRef<boolean>` — dedup guard, same concept as current.
- **On mount `useEffect`**: `el.scrollTop = el.scrollHeight; wasNearBottomRef.current = true`.
- **Pin-aware settle `useEffect`** (deps: `[entries]`): detects `prevLastLoadingRef.current === true && currentLastLoading === false`; if `wasNearBottomRef.current`, fires `requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })`.
- **Prepend-anchor `useEffect`** (deps: `[entries, isLoadingMore]` — SAFER variant per /review-plan round 1 Codex IMPORTANT): when `isLoadingMore` flips `true`, save `el.scrollHeight - el.scrollTop` into `savedScrollDeltaRef`. The restore only fires when `isLoadingMore === false` AND `savedScrollDeltaRef.current !== null` (entries has been re-rendered with the prepended items). This guards against the order issue in `useSearchHistory.loadMore()` where `setPersistedEntries` runs in `.then()` but `setIsLoadingMore(false)` runs in `.finally()` — without the `entries` dep + null-check, restore would race the prepend rendering. After restore, null the ref to prevent re-fire.
- **`onScroll` handler**: updates `wasNearBottomRef.current = distanceFromBottom < 100`. Also triggers `loadMore` when within 100px of the **top** (`el.scrollTop < 100`) if `hasMoreHistory && !isLoadingMore && !loadMoreInFlightRef.current`.
- Scroll container JSX: `<div ref={feedRef} role="feed" aria-label="Historial de consultas" className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 lg:max-w-2xl lg:mx-auto w-full" onScroll={handleScroll}>`.
- Leading content (before entries map): sr-only keyboard button, isLoadingMore skeleton, ClearHistoryButton, HistoryPersistenceNudge, HistoryEmptyState, EmptyState — same logic as current `VirtuosoHeader` but as direct JSX children of the scroll div.
- Items: `entries.map((entry, idx) => (...))` — each wrapped in a `<div key={entry.entryId}>` with `<TranscriptEntry>` + conditional `<hr>` divider (not after last).
- No `VirtuosoHandle`, no `VirtuosoFooter`, no `VirtuosoHeader`, no `FeedContext`, no `loadMoreInFlightRef` in Virtuoso sense (the new `loadMoreInFlightRef` guards the scroll-triggered `onLoadMore`).

**New `TranscriptFeedProps` interface:**
```typescript
interface TranscriptFeedProps {
  entries: TranscriptEntryData[];
  isAuthenticated: boolean;
  isLoadingHistory: boolean;          // kept for API compat (unused in component body — AC4 gate is in HablarShell)
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
```
`firstItemIndex` is NOT in this interface (dropped per ticket spec).

---

### Implementation Order

**Step 1 — RED tests: rewrite `TranscriptFeed.test.tsx` + delete `TranscriptFeed.fu6-qa.edge-cases.test.tsx`**
- Delete `TranscriptFeed.fu6-qa.edge-cases.test.tsx`.
- Rewrite `TranscriptFeed.test.tsx` to:
  - Remove `jest.mock('react-virtuoso')` + `capturedVirtuosoProps` spy machinery.
  - Remove all Virtuoso prop-wiring assertions (`followOutput`, `startReached`, `firstItemIndex`, `initialTopMostItemIndex`, `atBottomStateChange`).
  - Update `defaultProps` to remove `firstItemIndex: 1_000_000`.
  - Add assertions for new native-div contract:
    - Feed container has `role="feed"` and `aria-label="Historial de consultas"` (AC21).
    - Items render correctly from `entries` array (existing render assertions preserved).
    - Empty states still visible (preserved — these were in VirtuosoHeader, now direct children).
    - Header slot content (load-more button, ClearHistoryButton, nudge) renders correctly.
    - Pin-aware settle: simulate `scrollTop`, set last entry `isLoading=false`, assert `requestAnimationFrame` triggers scroll. Use jsdom `Object.defineProperty` on `feedRef.current` to set scroll dimensions (same pattern as existing tests that mock scroll).
    - Load-more dedup guard: assert `onLoadMore` called once on rapid double-scroll-to-top trigger.
    - Prepend anchor: assert `scrollTop` restores correctly after `isLoadingMore` cycle.
  - Tests FAIL at this point (TypeScript error: `firstItemIndex` prop no longer in interface after Step 2).
- Also update `HablarShell.fu6-qa.edge-cases.test.tsx` HGAP-5 section: remove Virtuoso-Header-context assertions; replace with direct DOM queries for ClearHistoryButton/EmptyState.
- Verification: `npm run typecheck -w @foodxplorer/web` — expect TypeScript errors (RED phase).

**Step 2 — REWRITE `TranscriptFeed.tsx`**
- Implement the new native-div `TranscriptFeed` per the architecture description above.
- Key refs: `feedRef`, `wasNearBottomRef`, `prevLastLoadingRef`, `savedScrollDeltaRef`, `loadMoreInFlightRef`.
- Move header slot content from `VirtuosoHeader` into the scroll `div` as direct children.
- Remove `VirtuosoHeader`, `VirtuosoFooter`, `FeedContext` interface, `Virtuoso` import, `VirtuosoHandle` import.
- `'use client'` directive is required (refs, effects).
- Verification: `npm run typecheck -w @foodxplorer/web` — TypeScript errors from Step 1 resolve. Tests still fail (mocking setup needs matching).

**Step 3 — UPDATE `HablarShell.tsx`**
- Remove `inputBarRef` declaration (line 169).
- Remove the stale comment block describing the ResizeObserver/input-bar-height contract (lines 165–168, per /review-plan round 1 Gemini SUGGESTION — comment would become misleading after the underlying machinery is removed).
- Remove the ResizeObserver `useEffect` block (lines 184–198, ~15 lines).
- Remove `outerRef={inputBarRef}` from the `<ConversationInput>` call (line 699).
- Remove `firstItemIndex` from `useSearchHistory` destructure (line 126).
- Remove `firstItemIndex={firstItemIndex}` from `<TranscriptFeed>` call (line 679).
- Fix the mount-gate placeholder className: remove `pb-[var(--input-bar-height,12rem)]`, keep `flex-1 overflow-y-auto overflow-x-hidden px-4 pt-4 lg:max-w-2xl lg:mx-auto w-full`.
- Verification: `npm run typecheck -w @foodxplorer/web` — should be clean if Steps 1–3 are consistent.

**Step 4 — UPDATE `ConversationInput.tsx`**
- Remove `outerRef` from `ConversationInputProps` interface (lines 33–37).
- Remove `outerRef` from destructuring (line 55).
- Remove `ref={outerRef}` from outer div (line 83).
- Replace `fixed bottom-0 left-0 right-0` with `w-full` in the outer div className (line 84).
- Keep all other logic verbatim.
- Verification: `npm run typecheck -w @foodxplorer/web`.

**Step 5 — VERIFY `react-virtuoso` is fully eliminated**
- `grep -rn "react-virtuoso\|Virtuoso\|VirtuosoHandle" packages/web/src/` — must be empty.
- `grep -rn "outerRef\|inputBarRef\|--input-bar-height\|ResizeObserver" packages/web/src/` — must be empty.
- If any dangling references remain, fix them before Step 6.

**Step 6 — REMOVE `react-virtuoso` from package.json + delete mock**
- Delete `packages/web/__mocks__/react-virtuoso.tsx`.
- Remove `"react-virtuoso": "^4.18.7"` from `packages/web/package.json` dependencies.
- Run `npm install` (or `npm install`) from the repo root to update `package-lock.json`.
- This step must come AFTER Steps 1–4 so the codebase no longer imports `react-virtuoso`.
- Verification: `npm ls react-virtuoso --prefix packages/web` — should resolve with "not installed".

**Step 7 — FINALIZE ADR-030 + clean stale Virtuoso references in `ui-components.md`**
- Change `**Status:** Draft — pending Step 6 finalization.` to `**Status:** Accepted — F-WEB-HISTORY-FU7 implementation complete.` in `docs/project_notes/decisions.md` ADR-030 (line 1096).
- **Doc cleanup `ui-components.md`** (per /review-plan round 1 Codex IMPORTANT-2): the Step 2a update added the new ADR-030 section but left earlier sections internally contradictory. Verify and fix:
  - Line ~2482: references to `Virtuoso` component contract — replace with `<div>` contract per the new TranscriptFeed entry.
  - Line ~2658: text saying "HablarShell's gate ensures Virtuoso mounts" → replace with "HablarShell's gate ensures the native scroll container mounts".
  - Line ~2684: text saying `loadMore` is called via Virtuoso `startReached` → replace with "`loadMore` is called via `onScroll` handler when `el.scrollTop < 100`".
  - Stale prop table for `onRetry`/`onDishSelect` callback signatures → align with the new TranscriptFeed prop table.
- Verification: `grep -n "Virtuoso\|startReached\|firstItemIndex\|VirtuosoHeader\|VirtuosoFooter" docs/specs/ui-components.md` — should return 0 matches (or only matches in historical "previously…" notes that are clearly marked as obsolete).
- key_facts.md, design-guidelines.md, hablar-design-guidelines.md were already cleaned in Step 2a (commit `c1c286e`); spot-check with similar greps.

**Step 8 — GATES (full quality suite)**
```bash
npm run lint -w @foodxplorer/web
npm run typecheck -w @foodxplorer/web
npm test -w @foodxplorer/web
npm run build -w @foodxplorer/web
git diff --stat   # verify net code reduction ≥ 150 lines
```
- Target: all 4 commands exit 0, zero errors, test count ≥ 796.
- Measure bundle before/after for Completion Log (remove `react-virtuoso` ~50 KB gzip expected).

---

### Testing Strategy

**Test files to rewrite:**
- `packages/web/src/__tests__/components/TranscriptFeed.test.tsx` — full rewrite (531 lines → ~280 lines target)

**Test files to delete:**
- `packages/web/src/__tests__/components/TranscriptFeed.fu6-qa.edge-cases.test.tsx` — all 446 lines are Virtuoso-specific

**Test files requiring surgical edits only:**
- `packages/web/src/__tests__/components/HablarShell.fu6-qa.edge-cases.test.tsx` — HGAP-5 section (lines 426–484): remove Virtuoso-Header-context language; assert the same behaviors through direct DOM queries (ClearHistoryButton is now a direct descendant of the feed div)
- All other HablarShell test files: only need `useSearchHistory` mock returns to NOT include `firstItemIndex` — verified these mocks already don't include it, so NO changes needed

**Key test scenarios for new `TranscriptFeed.test.tsx`:**

| Scenario | How to test in jsdom |
|----------|---------------------|
| Feed container role/aria | RTL `getByRole('feed', { name: /historial/i })` |
| Empty state (anon) | Render with `entries=[]`, `isAuthenticated=false` — assert `EmptyState` visible |
| Empty state (auth) | Render with `entries=[]`, `isAuthenticated=true` — assert `HistoryEmptyState` visible |
| Entries render | Render with 2 entries, assert both `TranscriptEntry` stubs in DOM |
| Divider between entries | Assert `<hr>` present between entry 1 and 2, absent after last entry |
| ClearHistoryButton visible | `isAuthenticated=true`, entries with `isPersisted=true` → button visible |
| Persistence nudge | `showPersistenceNudge=true` → nudge visible; `false` → absent |
| Load-more sr-only button | `hasMoreHistory=true`, `isLoadingMore=false` → sr-only button exists |
| Load-more dedup guard | Fire scroll twice rapidly, assert `onLoadMore` called once |
| Pin-aware settle (near-bottom) | Set `feedRef` scroll dimensions, set `wasNearBottomRef=true`, flip last entry `isLoading` false → assert `requestAnimationFrame` fires with `scrollTop = scrollHeight` |
| Pin-aware settle (scrolled-up) | Set `wasNearBottomRef=false`, flip last entry `isLoading` false → assert `requestAnimationFrame` NOT fired |
| Mount scroll-to-bottom | Assert `scrollTop = scrollHeight` fires on mount |
| Prepend anchor | Mock `isLoadingMore` cycling `false→true→false` with new entries prepended → assert `scrollTop` restores to pre-prepend relative position |

**Mocking strategy:**
- `TranscriptEntry`, `EmptyState`, `HistoryEmptyState`, `HistoryPersistenceNudge`, `ClearHistoryButton` — all mocked as simple div stubs (same pattern as `TranscriptFeed.edge-cases.test.tsx` lines 14–38).
- `react-virtuoso` — no mock needed (package removed).
- Scroll arithmetic in jsdom: use `Object.defineProperty` on `feedRef.current` to define `scrollHeight`, `scrollTop`, `clientHeight` as configurable properties. Pattern: set `scrollHeight=1000`, `clientHeight=600`, `scrollTop=900` (near-bottom) or `scrollTop=0` (top).
- `requestAnimationFrame`: jsdom does not run rAF automatically — use `jest.spyOn(global, 'requestAnimationFrame')` and capture the callback; invoke manually in the assertion block.
- Per `feedback_jsdom_layout_ac_gap`: BUG A/B visual layout ACs (AC6, AC8, AC9) CANNOT be closed by jsdom tests. They require operator smoke on `app-dev.nutrixplorer.com`. Tests close the logic gates only; operator smoke closes the visual ACs.

---

### Key Patterns

- **Pin-aware scroll pattern** — from validated prototype `HablarV2Shell.tsx` (branch `prototype/hablar-v2-in-column-composer` @ `e285711`): `wasNearBottomRef` updated on every `onScroll`, `prevLastLoadingRef` for settle detection, `requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })` on settle. Copy this pattern verbatim.
- **Prepend anchor** — `savedScrollDeltaRef` captures `el.scrollHeight - el.scrollTop` when `isLoadingMore` flips true; restores `el.scrollTop = el.scrollHeight - savedScrollDeltaRef.current` when it flips false. This is spec-defined, not prototype-validated (see Edge Cases).
- **Load-more via `onScroll`** — trigger `onLoadMore` when `el.scrollTop < 100` AND `hasMoreHistory && !isLoadingMore && !loadMoreInFlightRef.current`. Set `loadMoreInFlightRef.current = true` before calling. Reset when `isLoadingMore` flips false (via `useEffect([isLoadingMore])`). This replaces Virtuoso's `startReached` prop.
- **`useRef<HTMLDivElement>(null)` + scroll pattern** — consistent with `feedback_mock_boundary_integration_gap`: test the hook→component data-flow (entries array → rendered items), not just mocked Virtuoso internals.
- **`'use client'` directive** — required on `TranscriptFeed.tsx` and `ConversationInput.tsx` (both use refs and browser APIs). `HablarShell.tsx` already has it.
- **No `behavior: 'smooth'`** — the new scroll uses direct `el.scrollTop = el.scrollHeight` assignment (NOT `behavior: 'smooth'`). Smooth scroll on the native div can fail in jsdom and is not validated for the settle case. The prototype uses direct assignment.
- **`hasPersisted` local var** — `const hasPersisted = entries.some((e) => e.isPersisted)` — same as current `TranscriptFeed.tsx` line 239. Used for ClearHistoryButton visibility.

**Gotchas:**

1. `TranscriptFeed.edge-cases.test.tsx` (199 lines) does NOT mock `react-virtuoso` at all in some tests — it relies on `__mocks__/react-virtuoso.tsx`. After deleting the manual mock, it will still work because it doesn't import `react-virtuoso` directly; it imports `TranscriptFeed` which will no longer use Virtuoso. The `defaultProps` in this file includes `firstItemIndex: ...` — this line must be removed when the prop is dropped from `TranscriptFeedProps`. Check line 62–75 of this file.
2. `HablarShell.fWebHistory.test.tsx`: `mockUseSearchHistory.mockReturnValue(...)` calls on lines 344, 362, 387, 428, 482, 505, 540, 556, 598, 622, 645, 670 do NOT include `firstItemIndex` — confirmed by grep. No changes needed here.
3. `HablarShell.test.tsx` line 53: `useSearchHistory` mock returns object does not include `firstItemIndex` — no changes needed.
4. The mount-gate placeholder div in `HablarShell.tsx` (line 669) currently has `pb-[var(--input-bar-height,12rem)]`. After removing the CSS var, this becomes meaningless (the var is unset). The class must be removed. The correct replacement is no padding-bottom — the placeholder is gated out before `TranscriptFeed` mounts, so it only shows during loading and has no clearance concern.
5. `ConversationInput.tsx` import of `type { Ref }` from React — verify whether `Ref` is still needed after removing `outerRef`. `micButtonRef?: Ref<HTMLButtonElement>` still uses it, so the import stays.
6. The `TranscriptFeed.edge-cases.test.tsx` `defaultProps` object (line 62) includes the `firstItemIndex` key (value not visible in current grep — must confirm when reading the rewrite). After removing `firstItemIndex` from `TranscriptFeedProps`, passing this prop will cause a TypeScript error. The developer must update this file's `defaultProps` to remove `firstItemIndex`.

---

### Plan Self-Review

**Risks the implementer should know:**

1. **Prepend anchoring (AC7) is SPEC-DEFINED, NOT prototype-validated.** The `savedScrollDeltaRef` mechanism is the canonical approach but has not been run against the real API in this stack. After deploy to `app-dev`, the implementer must verify AC7 manually before marking it PASS. **Plan now requires the SAFER pattern up-front** (post /review-plan round 1 Codex IMPORTANT-1): `useEffect([entries, isLoadingMore])` with null-check on `savedScrollDeltaRef.current` — see Step 2 implementation spec. The order issue in `useSearchHistory.loadMore()` (`setPersistedEntries` in `.then()`, `setIsLoadingMore(false)` in `.finally()`) means a dep on `isLoadingMore` alone would race the prepend render; the `entries` dep + null-check guards this.

2. **jsdom cannot validate BUG A / BUG B (AC6, AC8, AC9, AC26).** Per `feedback_jsdom_layout_ac_gap`: these ACs depend on real browser layout (scroll, DVH, iOS keyboard). Tests close the logic branches only. Operator smoke on `app-dev.nutrixplorer.com` on Chrome desktop, Safari desktop, and real iOS Safari is mandatory.

3. **`react-virtuoso` removal order.** Package.json removal (Step 6) MUST come after Steps 1–4. If the developer runs `npm install` before the `TranscriptFeed.tsx` rewrite is complete, the codebase will have an import of `react-virtuoso` that is no longer installed — build and tests will fail. The plan orders this correctly (Step 6 last among code changes).

4. **`HablarShell.tsx` comment block cleanup.** Lines 165–168 contain the comment `// FU6-FU2 — outer ref to ConversationInput...` that documents `inputBarRef`. This comment should be deleted along with the ref declaration to avoid misleading future readers.

5. **iOS keyboard regression risk (LOW — empirically mitigated).** The prototype validated on real iPhone that `dvh` + in-column composer keeps the composer visible. However, the production `ConversationInput` is more complex than the prototype (inline error, PhotoModeToggle). If the inline error expands the composer height, it will simply push the feed up (expected behavior in flex layout) — no regression risk. PhotoModeToggle adds height below the text row — also handled naturally.

6. **`TranscriptFeed.edge-cases.test.tsx`** includes `firstItemIndex` in its `defaultProps` (line 68 area). This is NOT in the "Files to Delete" list — this file is kept. The developer must remove `firstItemIndex` from the `defaultProps` in this file (likely a single line change).

**Known unknowns resolved:**
- Q1–Q4 answered above.
- The prototype does not exist on the current develop branch — no cleanup needed (AC29 is vacuously satisfied if the branch was cut from develop after the prototype branch was never merged).

---

### Verification Commands Run

- `find packages/web/__mocks__ -type f` → `packages/web/__mocks__/react-virtuoso.tsx` confirmed — the manual mock exists and must be deleted.
- `cat packages/web/package.json | grep -A2 "react-virtuoso"` → `"react-virtuoso": "^4.18.7"` in dependencies — confirmed present, will be removed.
- `grep -rn "react-virtuoso|Virtuoso|VirtuosoHandle" packages/web/src/` → found in `TranscriptFeed.tsx` (import lines 12–13), `TranscriptFeed.test.tsx` (jest.mock + prop capture), `TranscriptFeed.fu6-qa.edge-cases.test.tsx` (scrollToIndex spy + prop assertions), `HablarShell.fu6-qa.edge-cases.test.tsx` (HGAP-5 context description) — scope of Virtuoso references confirmed.
- `grep -rn "firstItemIndex" packages/web/src/` (excluding tests) → `useSearchHistory.ts` (exported, stays), `HablarShell.tsx` (lines 126 + 679, both to be removed), `TranscriptFeed.tsx` (prop interface + usage, to be removed). No other consumers.
- `grep -rn "firstItemIndex" packages/web/src/__tests__/` → confirmed in `TranscriptFeed.test.tsx` defaultProps (line 143), `TranscriptFeed.fu6-qa.edge-cases.test.tsx` (GAP-1/2 describe block), `HablarShell.fWebHistory.test.tsx` (NOT in mock returns — grep returned zero results for that file). Clean picture.
- `grep -rn "inputBarRef|outerRef|--input-bar-height" packages/web/src/` → `HablarShell.tsx` (lines 169, 184–198, 699), `ConversationInput.tsx` (lines 33–37, 55, 83, 84) — exactly the lines to change, no other consumers.
- `grep -rn "ResizeObserver" packages/web/src/` → only `HablarShell.tsx` lines 184–198 — the ResizeObserver block being deleted. No other consumers.
- `wc -l packages/web/src/__tests__/components/TranscriptFeed*.tsx packages/web/src/__tests__/components/HablarShell*.tsx` → confirmed test surface: TranscriptFeed.test.tsx 531 lines, TranscriptFeed.fu6-qa.edge-cases.test.tsx 446 lines, TranscriptFeed.edge-cases.test.tsx 199 lines; HablarShell test files total 3,133 lines across 7 files.
- `git show e285711:packages/web/src/components/HablarV2Shell.tsx` → prototype file read from commit `e285711` (branch `prototype/hablar-v2-in-column-composer`). Confirmed: `wasNearBottomRef`, `prevLastLoadingRef`, `el.scrollTop = el.scrollHeight`, `requestAnimationFrame`, `NEAR_BOTTOM_THRESHOLD_PX = 100`, in-column composer div with `flex-shrink-0`, `pb-[calc(12px+env(safe-area-inset-bottom))]`.
- `grep -rn "hablar-v2|HablarV2Shell|HablarV2" packages/web/src/` → zero results on current branch — confirms the prototype files do NOT exist on develop/current branch. AC29 is vacuously satisfied if working branch is cut from develop.
- `Read: packages/web/src/components/TranscriptFeed.tsx` → confirmed full 292-line content including `VirtuosoHeader`, `VirtuosoFooter`, `FeedContext`, `firstItemIndex` prop, `scrollToIndex` imperative call — all to be replaced.
- `Read: packages/web/src/components/HablarShell.tsx` → confirmed `inputBarRef` at line 169, ResizeObserver block at lines 184–198, `outerRef={inputBarRef}` at line 699, `firstItemIndex={firstItemIndex}` at line 679, mount-gate placeholder with `pb-[var(--input-bar-height,12rem)]` at line 669.
- `Read: packages/web/src/components/ConversationInput.tsx` → confirmed `outerRef?: Ref<HTMLDivElement>` at lines 33–37, `outerRef` destructured at line 55, `ref={outerRef}` at line 83, `fixed bottom-0 left-0 right-0` at line 84.
- `grep -n "6.3|breakpoint|2-column|grid.*col" docs/specs/hablar-design-guidelines.md` → Section 6.3 breakpoint table describes `grid-cols-2` at tablet/desktop. `grep -n "grid.*col" packages/web/src/components/TranscriptEntry.tsx` → confirmed `md:grid-cols-2` is in `TranscriptEntry.tsx` (not `TranscriptFeed`). Q4 deferred correctly.
- `grep -n "ADR-030|Status.*Draft" docs/project_notes/decisions.md` → ADR-030 at line 1094, Status line 1096 is `Draft — pending Step 6 finalization` — confirmed this is the line to update in Step 7.
- `grep -n "ADR-030|react-virtuoso" docs/project_notes/key_facts.md` → Line 31–32 confirmed already updated with ADR-030 addendum. No doc work needed for key_facts.md.
- `grep -n "W18|in-column|react-virtuoso" docs/specs/design-guidelines.md` → W18 section at line 1442 already updated with ADR-030 revision. Layout diagram at line 1360 already shows `flex-shrink-0`. No further doc work needed.
- `grep -n "TranscriptFeed|in-column|firstItemIndex" docs/specs/ui-components.md` → Lines 2485–2532 already updated with native-scroll contract, `firstItemIndex` dropped note at line 2485, prepend-anchor mechanism described at line 2520. No further doc work needed.
- `grep -n "in-column|padding-bottom|ADR-030" docs/specs/hablar-design-guidelines.md` → Lines 144–155 already updated with in-column composer spec. Line 436 shows in-column layout diagram. Line 443 shows no clearance note. No further doc work needed.
- `Read: packages/web/src/__tests__/components/TranscriptFeed.edge-cases.test.tsx:62-75` → `defaultProps` at line 62 does NOT include `firstItemIndex` — confirmed. Wait, line 63 is `entries: []`, not `firstItemIndex`. Cross-checked with the file: `defaultProps` in `edge-cases.test.tsx` does NOT include `firstItemIndex` (lines 62–75 confirmed). No changes needed here beyond verifying the mock doesn't blow up when `TranscriptFeedProps` drops `firstItemIndex`.
- `grep -n "defaultProps|firstItemIndex" packages/web/src/__tests__/components/TranscriptFeed.edge-cases.test.tsx` → Confirmed: `defaultProps` at line 62 does not include `firstItemIndex`. No change needed in this file.

---

## Acceptance Criteria

### AC1 — Anonymous empty state
- [x] An unauthenticated user visiting `/hablar` sees `EmptyState` rendered inside the feed area, vertically above the input bar with no overlap.

### AC2 — Authenticated empty state
- [x] An authenticated user with no history sees `HistoryEmptyState` rendered inside the feed area, vertically above the input bar with no overlap.

### AC3 — Mount gate (auth loading)
- [x] While `authLoading` is true, the feed renders a placeholder `div` with `role="feed"` and `aria-busy="true"`. `TranscriptFeed` is NOT mounted.

### AC4 — Mount gate (history loading)
- [x] For an authenticated user, while `isLoadingHistory` is true, `TranscriptFeed` is NOT mounted. Once `isLoadingHistory` becomes false, `TranscriptFeed` mounts once with the full `allEntries` array.

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
- [x] Completing a voice query via `VoiceOverlay` appends a new `TranscriptEntry` at the bottom of the feed. The entry is fully visible above the input bar after settle (same constraint as AC6).

### AC11 — Photo flow: result appended to feed
- [x] Selecting a photo triggers a shimmer pending entry, which resolves to a photo result card. The resolved card is fully visible above the input bar after settle (same constraint as AC6).

### AC12 — Delete persisted entry
- [x] Tapping the delete button on a persisted entry removes it from the feed visually and calls the API delete. Session entries' delete button (if rendered) removes only from local state.

### AC13 — Clear all: persisted only, session preserved
- [x] Tapping "Borrar historial" clears all persisted entries from the feed. Any session entries (added in the current browser session) are NOT cleared. They remain visible in the feed after `clearAll` resolves.

### AC14 — Persistence nudge shown then dismissable
- [x] An anonymous user who has submitted ≥2 queries sees `HistoryPersistenceNudge` in the feed. Tapping dismiss removes it from view and it does not reappear in the same session.

### AC15 — RateLimitNudge sibling (anonymous 429)
- [x] When an anonymous user receives a 429 rate-limit error, `RateLimitNudge` renders as a sibling below the feed (above the input bar), not inside the feed. It is visible and not overlapping the input bar.

### AC16 — Inline error in composer
- [x] When `inlineError` is non-null, it renders above the textarea inside the composer. The composer height increases to accommodate it. The feed bottom-of-last-entry clearance remains sufficient (BUG A does not regress when inline error appears).

### AC17 — PhotoModeToggle visible
- [x] `PhotoModeToggle` (auto / solo este plato) is visible below the input row inside the composer. It is not clipped.

### AC18 — Error entry with Reintentar
- [x] A failed query renders an error entry in the feed with a "Reintentar" button. Tapping it calls `handleRetry` which appends a new query entry.

### AC19 — Auth slot: LoginCta when anonymous
- [x] An unauthenticated user sees `LoginCta` in the app bar header (top right area). `UsageMeter` and `UserMenu` are NOT rendered.

### AC20 — Auth slot: UsageMeter + UserMenu when authenticated
- [x] An authenticated user sees `UsageMeter` and `UserMenu` in the app bar header. `LoginCta` is NOT rendered.

### AC21 — Accessibility: role="feed" + aria-label on feed container
- [x] The scroll container rendered by `TranscriptFeed` has `role="feed"` and `aria-label="Historial de consultas"`.

### AC22 — Accessibility: role="article" per entry
- [x] Each `TranscriptEntry` renders with `role="article"`. (No change to `TranscriptEntry` itself — verify it is unaffected by the rebuild.)

### AC23 — Accessibility: aria-busy on mount gate placeholder
- [x] The mount gate placeholder `div` has `role="feed"` and `aria-busy="true"`. Once `TranscriptFeed` mounts, `aria-busy` is removed (or the placeholder is unmounted).

### AC24 — Load-more sr-only keyboard button
- [x] When `hasMoreHistory` is true and `isLoadingMore` is false, a `sr-only` focusable "Cargar más historial" button is rendered at the top of the feed for keyboard users.

### AC25 — Pin-aware auto-scroll on settle
- [x] Auto-scroll on entry settle (last entry `isLoading` flips `true → false`): if the feed `scrollTop` was within 100px of `scrollHeight` (near-bottom) before the settle, the feed scrolls to bottom via `requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })`. If the user had scrolled up (>100px from bottom), the viewport position is preserved — the new settled card is NOT forced into view.

### AC26 — iOS keyboard: composer visible on focus
- [ ] On Safari iOS mobile, tapping the textarea in the composer does not push the composer off-screen below the keyboard. The composer remains fully visible above the keyboard after the virtual keyboard opens. Verified by operator on a real iOS device.

### AC27 — All tests pass (zero failures)
- [x] `npm test -w @foodxplorer/web` passes with zero failures (**795/795** at final state in commit `fd18399` — baseline pre-FU7 was 783; net +12 from new `TranscriptFeed.fu7-qa.edge-cases.test.tsx` added during Step 5 qa-engineer review). Tests that previously mocked `react-virtuoso` are rewritten to test the plain `div` equivalent.

### AC28 — Lint, typecheck, build clean
- [x] `npm run lint -w @foodxplorer/web`, `npm run typecheck -w @foodxplorer/web`, and `npm run build -w @foodxplorer/web` all exit 0 with zero errors.

### AC29 — Prototype files deleted
- [x] `packages/web/src/components/HablarV2Shell.tsx` is absent from the merge commit. The `/hablar-v2` route (page file) is absent. Verified by `git show --name-only HEAD` in the Completion Log.

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
- [ ] All 29 Acceptance Criteria above met (23/29 code-verified — 6 await operator: AC5/6/7/8/9/26)
- [x] All web tests passing (`npm test -w @foodxplorer/web` — **795/795** at final state; intermediate Steps 1-8 were 783/783 before qa-engineer added +12 fu7-qa tests in `fd18399`)
- [x] `npm run lint -w @foodxplorer/web` clean (zero errors)
- [x] `npm run typecheck -w @foodxplorer/web` clean (zero errors)
- [x] `npm run build -w @foodxplorer/web` succeeds — `/hablar` 20 kB / 209 kB First Load (vs pre-FU7 39.1 kB / 228 kB)
- [x] `react-virtuoso` removed from `packages/web/package.json` (commit `b0b029a`)
- [x] No new dependencies added
- [x] Net code reduction ≥ 150 lines documented in Completion Log (**-345 lines** in `packages/web/src/`, 130% over target)
- [x] Bundle size delta documented in Completion Log (**-19 kB on /hablar route + -19 kB on First Load JS**)
- [x] Prototype files deleted: vacuously satisfied — prototype branch `prototype/hablar-v2-in-column-composer` never merges into FU7 rebuild branch (planner confirmation, AC29 PASS)
- [x] ADR-030 written in `docs/project_notes/decisions.md`: full Context / Decision / Consequences / Cross-references format (Status: Accepted, commit `b9582ea`)
- [x] `docs/project_notes/key_facts.md` line 31 addended (commit `c1c286e`)
- [x] `docs/specs/ui-components.md` updated (commits `c1c286e` + `b9582ea`): TranscriptFeed section + Component Hierarchy + loadMore behavior + Mount gate all reflect native scroll + in-column composer
- [x] `docs/specs/design-guidelines.md` updated (commit `c1c286e`): W16 + W18 reflect native scroll + in-column. `behavior:'smooth'` → instant `scrollTop` corrected
- [x] `docs/specs/hablar-design-guidelines.md` updated (commit `c1c286e`): Section 6.2 ASCII diagram + Section 4.1 ConversationInput reflect in-column. `padding-bottom: 84px` clearance removed
- [x] Cross-model `/review-spec` Round 2 APPROVED (Gemini APPROVED + Codex REVISE 3 → rev 2.1 direct edits closed all)
- [x] Cross-model `/review-plan` APPROVED (Gemini APPROVED + Codex REVISE 3 → rev 1.1 direct edits closed all)
- [x] Code reviewed by `code-review-specialist` — **APPROVE** (zero BLOCKER + zero MAJOR; 3 MINOR + 3 NIT all deferrable, addressed where critical via commit `fd18399`)
- [x] QA pass by `qa-engineer` — **QA PASS WITH FOLLOW-UPS** — 1 HIGH (RACE-1 prepend overwrite, FIXED `fd18399` + 12 new tests file `TranscriptFeed.fu7-qa.edge-cases.test.tsx`), 1 MEDIUM (sr-only focus relative anchor, FIXED `fd18399`), 1 LOW (mount-gate placeholder cruft, FIXED `fd18399`), 6 operator ACs identified for post-deploy reverify (AC5/6/7/8/9/26)

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated, ticket `## Spec` written (Revision 1)
- [x] Step 0: Composer position ADR decision resolved — in-column (Axis 2 locked, empirically validated)
- [x] Step 0: Spec Revision 2 — cross-model REVISE findings applied + prototype validation incorporated
- [x] Step 0: Cross-model `/review-spec` Round 2 APPROVED (Gemini + Codex via rev 2.1 close)
- [x] Step 1: Branch `rebuild/F-WEB-HISTORY-FU7-rebuild-scroll-wrapper` created, tracker updated
- [x] Step 2: `ui-ux-designer` reviewed (commit `c1c286e` — 4 docs updated)
- [x] Step 2: `frontend-planner` executed, Implementation Plan written and APPROVED (commit `e4954f8`)
- [x] Step 2: Cross-model `/review-plan` APPROVED (Gemini + Codex via rev 1.1 close)
- [x] Step 3: `frontend-developer` executed with TDD (5 commits Steps 1-5, owner-approved + Steps 6-8 direct execution)
- [x] Step 3: `react-virtuoso` import removed from `packages/web/package.json` (commit `b0b029a`)
- [x] Step 3: `--input-bar-height` CSS var usage confirmed absent (grep clean)
- [x] Step 3: `HablarV2Shell.tsx` + `/hablar-v2` route AC29 vacuously satisfied (prototype branch isolated)
- [x] Step 4: Quality gates pass (lint + typecheck + build + tests **795/795** final; was 783/783 at Step 8 commit before qa-engineer +12 tests in `fd18399`)
- [x] Step 5: `code-review-specialist` executed, findings addressed (commit `fd18399`)
- [x] Step 5: `qa-engineer` executed (commit `fd18399` + new test file). Operator smoke tests AC6/AC8/AC9/AC26 (+ AC5/AC7) tracked separately for post-deploy reverify — NOT a merge blocker per memory `feedback_jsdom_layout_ac_gap` (these 6 ACs are operator-empirical and cannot be closed pre-deploy)
- [x] Step 6: Completion Log filled, tracker updated, branch deleted (2026-06-09 housekeeping commit)

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-06-08 | Step 0 — Spec Revision 1 drafted by spec-creator | Composer position ADR decision pending owner |
| 2026-06-09 | Step 0 — Spec Revision 2 by spec-creator | Cross-model REVISE findings applied; prototype validation ALL 4 PASS incorporated; architecture locked (in-column); ADR-030 reversal documented |
| 2026-06-09 | Step 0 — /review-spec round 2 cross-model | Gemini APPROVED + Codex REVISE (2 IMPORTANT + 1 SUGGESTION). Findings: RateLimitNudge sibling slot omitted from Axis 2; lg:max-w-2xl mx-auto dropped from feed contract; prepend not prototype-validated; AC30 redundant with DoD |
| 2026-06-09 | Step 0 — Spec Revision 2.1 direct edits | All 4 round-2 findings closed: (1) RateLimitNudge sibling slot added to Axis 2 shell; (2) `lg:max-w-2xl lg:mx-auto w-full` added to Axis 1 + UI Changes; (3) Prepend SPEC-DEFINED-NOT-PROTOTYPE-VALIDATED note in Edge Cases; (4) AC30 collapsed into DoD (AC count 30→29). 4/4 closed without need for round 3 |
| 2026-06-09 | Step 1 — Branch + tracker + ADR-030 draft (commit `ad668e5`) | Branch `rebuild/F-WEB-HISTORY-FU7-rebuild-scroll-wrapper` from develop @ `803378f`. product-tracker.md Active Session updated. ADR-030 stub appended to decisions.md (Status: Draft, finalized in Step 7) |
| 2026-06-09 | Step 2a — ui-ux-designer doc updates (commit `c1c286e`) | 4 design/reference docs updated: hablar-design-guidelines.md (Section 6.2 + 4.1), design-guidelines.md (W16 + W18), ui-components.md (HablarShell + ConversationInput + TranscriptFeed entries), key_facts.md addendum preserving historical lesson. behavior:'smooth' → instant scrollTop assignment corrected |
| 2026-06-09 | Step 2b — frontend-planner implementation plan (commit `e4954f8`) | 8-step TDD-ordered plan. 7M + 2D + 0C file ops. Q1-Q4 resolved (isLoadingHistory KEEP passthrough; onRetry/onDishSelect already FU6; firstItemIndex hook LEAVE; Section 6.3 grid drift DEFER). Highest risk = AC7 prepend (savedScrollDeltaRef) flagged with mitigation. AC29 vacuously satisfied (prototype branch doesn't merge) |
| 2026-06-09 | Step 2c — /review-plan round 1 cross-model | Gemini APPROVED (1 SUGGESTION: stale comment in HablarShell). Codex REVISE (3 IMPORTANT): AC7 safer pattern as primary (not fallback); ui-components.md still has stale Virtuoso references in earlier sections; pnpm commands need npm normalization |
| 2026-06-09 | Step 2c — Plan revision 1.1 direct edits | All 4 round-1 findings closed: (1) prepend pattern `useEffect([entries, isLoadingMore])` + null-check now PRIMARY in Step 2 spec; (2) Step 3 includes lines 165-168 comment cleanup; (3) Step 7 expanded with ui-components.md doc cleanup + verification grep; (4) ALL pnpm commands normalized to npm `npm test -w @foodxplorer/web` etc. (16 occurrences) |
| 2026-06-09 | Step 3 — TDD implementation (commits `58b67f4`..`9334aef`) | 5 commits across Steps 1-5: (1) RED tests — rewrite TranscriptFeed.test.tsx + delete fu6-qa.edge-cases.test.tsx + surgical HablarShell HGAP-5 edit; (2) TranscriptFeed native scroll rewrite + pin-aware + prepend anchor; (3) HablarShell drop ResizeObserver + --input-bar-height + comment 165-168; (4) ConversationInput in-column (drop position:fixed + outerRef); (5) Verify grep clean for Virtuoso/--input-bar-height/outerRef. 783/783 tests PASS post Step 5. HablarShell voice/photo/auth/etc. byte-for-byte unchanged. PAUSE for owner sign-off pre-Step 6 |
| 2026-06-09 | Step 6 — Remove react-virtuoso dep + delete mock (commit `b0b029a`) | Owner-approved post Step 5 checkpoint. `npm uninstall react-virtuoso` (removed from packages/web/package.json + root package-lock.json cleaned of transitive deps). Deleted `packages/web/__mocks__/react-virtuoso.tsx`. Irreversible step; revert would require re-install + restoring 2-5 commits |
| 2026-06-09 | Step 7 — ADR-030 Accepted + ui-components.md cleanup (commit `b9582ea`) | `decisions.md` ADR-030 Status: Draft → Accepted with full trail (cross-model R1+R2 spec; R1 plan + rev 1.1; 8-step TDD; -345 LOC; 783/783; dep removed). `ui-components.md` cleanup: Component Hierarchy block rewritten (Virtuoso tree → native-scroll tree); loadMore behavior (Virtuoso startReached → onScroll handler); Mount gate description (Virtuoso mounts → native scroll container). Remaining Virtuoso refs all contextual/historical. |
| 2026-06-09 | Step 8 — Full gates GREEN | Lint ✓ 0 errors. Typecheck ✓ 0 errors. Tests ✓ 67 suites / 783 tests PASS. Build ✓ — `/hablar` route: **20 kB / 209 kB First Load** (vs pre-FU7 39.1 kB / 228 kB — net **-19 kB on route + -19 kB on First Load JS**, react-virtuoso removal confirmed). AC27/AC28 satisfied. Net code reduction packages/web/src: **-345 lines** (target ≥150, exceeded 130%) |
| 2026-06-09 | Step 5 — code-review-specialist + qa-engineer + fixes (commit `fd18399`) | code-review-specialist: **APPROVE** (0 BLOCKER, 0 MAJOR, 3 MINOR + 3 NIT all deferrable). qa-engineer: **QA PASS WITH FOLLOW-UPS** — 1 HIGH (RACE-1 prepend-anchor overwrite — confirmed by new failing test, FIXED via first-write-wins guard `if (savedScrollDeltaRef.current === null)`), 1 MEDIUM (sr-only focus:absolute without relative parent — FIXED via `relative` on feed className), 1 LOW (mount-gate `overflow-x-hidden` cruft → `overscroll-contain` — FIXED). New test file `TranscriptFeed.fu7-qa.edge-cases.test.tsx` (12 tests). **Tests post-fix: 795/795** (68 suites, +12 from 783). 6 operator ACs identified for post-deploy reverify (AC5/6/7/8/9/26 per memory `feedback_jsdom_layout_ac_gap`) — tracked separately, NOT a merge blocker |
| 2026-06-09 | Step 5 — /audit-merge skill + fixes (commit `6ec7c80`) | First run: MCE table empty placeholders + tracker Step 1/6 stale + Features table row missing for FU7. Fixes applied: (1) MCE 9 rows filled with concrete evidence (commit hashes, doc refs, counts); (2) DoD code-review + qa-engineer flipped to [x] with verdicts; (3) Workflow Step 5 reviews flipped to [x]; (4) tracker Last Updated + Active Feature both → Step 5/6; (5) Features table row inserted before FU6 with full description (in-progress, 5/6). Second audit: 12/12 structural PASS + drift clean (1 systemic P5 NIT — 54 frozen tickets, pre-existing repo-wide, not specific to FU7) |
| 2026-06-09 | Step 5 — CI green confirm + auditor B2/B3 fixes (this commit) | First CI rerun on `6ec7c80` blocked by transient `next/font Inter ETIMEDOUT` (Google Fonts network glitch). `gh run rerun --failed` → all checks PASS run `27202567565`: test-web 2m6s ✓, all 7 workspaces ✓, ci-success ✓, Vercel deployed (foodyassistance + nutrixplorer). External auditor flagged 3 doc fixes: (B2) MCE row 9 claims `/audit-merge` ran but Audit Merge Output section was empty — now filled with actual output table; (B3) test count drift 783↔795↔796 across ticket — reconciled to 795/795 final (AC27 threshold removed, DoD/Workflow updated, Completion Log historical rows kept verbatim); (B4) Vercel preview URL surfaced for owner pre-merge operator reverify on actual rebuild commit (NOT the prototype) |
| 2026-06-09 | Step 6 — Squash merge + operator AC reverify on app-dev | PR #320 squash-merged to develop @ `b6eecc5` (2026-06-09 14:26 UTC). Branch `rebuild/F-WEB-HISTORY-FU7-rebuild-scroll-wrapper` deleted (local + remote). Vercel auto-deployed to `app-dev.nutrixplorer.com`. **Operator AC reverify 2026-06-09: 11/14 scenarios PASS — core architecture validated** (AC5 hydration web ✓, AC6 BUG A scroll-on-settle web+móvil ✓, AC7 prepend web+móvil ✓, AC8 BUG B iOS móvil ✓, AC9 BUG B web ✓, AC26 iOS keyboard ✓). **3 precision bugs identified for follow-up** (NOT architectural — header strip CSS + mount-timing): (1) DeleteEntryButton invisible on web due to `md:opacity-0 md:group-hover:opacity-100` hover-reveal pattern; (2) Query echo `truncate` should be `line-clamp-2` for multi-line wrap; (3) Mobile initial scroll mid-screen — mount useEffect needs `requestAnimationFrame` deferral (iOS Safari scrollHeight not stable at post-commit). Tracked in `BUG-WEB-FU7-HEADER-AND-MOBILE-SCROLL` bugfix ticket (Path A Quick). |
| 2026-06-09 | Step 6 — Housekeeping (this commit) | Ticket Status: Ready for Merge → Done. Workflow Step 6 → [x]. product-tracker.md: Active Session refreshed (FU7 done 6/6, bugfix BUG-WEB-FU7-HEADER-AND-MOBILE-SCROLL queued); Features table row → done | 6/6. bugs.md: BUG-WEB-FEED-SCROLL-SETTLE-001 + related → operator confirmed PASS (3 follow-up precision bugs scope-distinct). Memories saved: project_fweb_history_fu7_closed + feedback_empirical_prototype_validated. F-WEB-HISTORY 8-iter cadena (FU1→FU7) closed architecturally. |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Empirical Validation, ADR-030, Locked Architecture, UI Changes, Edge Cases, Implementation Plan, AC (29 header form), Implementation Targets, DoD (20 items), Workflow Checklist (16 items), Completion Log (13+ rows), MCE, References |
| 1. Mark all items | [x] | AC: **23/29 done** (6 deferred operator-empirical AC5/6/7/8/9/26 per memory `feedback_jsdom_layout_ac_gap`), DoD: 18/20 (2 deferred operator), Workflow: 15/16 (Step 6 housekeeping pending merge) |
| 2. Verify product tracker | [x] | Active Session: F-WEB-HISTORY-FU7 step 5/6, Features table: row added in this commit |
| 3. Update key_facts.md | [x] | Updated commit `c1c286e` — addendum to line 31 preserving historical lesson + ADR-030 reference |
| 4. Update decisions.md | [x] | ADR-030 added commit `ad668e5` (Draft) → `b9582ea` (Accepted) — full Context / Decision / Consequences / Cross-references |
| 5. Commit documentation | [x] | All doc changes committed: `c1c286e` (Step 2a ui-ux-designer 4 docs), `ad668e5` (ADR-030 draft + tracker), `b9582ea` (ADR-030 Accepted + ui-components.md cleanup), `eb8fb94` (ticket finalization) |
| 6. Verify clean working tree | [x] | `git status`: clean (only `.claude/scheduled_tasks.lock` modified, owned by harness, not relevant) |
| 7. Verify branch up to date | [x] | merge-base: `git merge-base --is-ancestor origin/develop HEAD` → UP TO DATE with origin/develop (no merge needed) |
| 9. Run `/audit-merge` | [x] | See § "Audit Merge Output" below — 12 structural + 16 drift all PASS (1 systemic P5 advisory non-blocking — 54 frozen tickets, pre-existing) |

## Audit Merge Output

> Paste the FULL verbatim output of `/audit-merge` below. The block must include both tables
> (structural + drift), all rows, the combined verdict, AND the final self-verification line
> in the form `Structural: N/N PASS | Drift: K advisory | Verdict: <APPROVE|REVISE>`. Do NOT
> abbreviate, summarize, or omit failing rows. Required for the D1 structural check to PASS.

```text
## Merge Compliance Audit — F-WEB-HISTORY-FU7
Run date: 2026-06-09 post commit `6ec7c80` (audit-merge fixes) +
post-rerun CI green confirmation on run `27202567565`.

### Structural (1-12) — blocking merge gate

| # | Check | Status | Detail |
|---|-------|:------:|--------|
| 1 | Ticket Status | PASS | "Ready for Merge" |
| 2 | Acceptance Criteria | PASS | 23/29 marked (6 deferred operator-empirical AC5/6/7/8/9/26 per memory feedback_jsdom_layout_ac_gap; form: header). MCE row 1 claim "AC: 23/29 done" matches actual. |
| 3 | Definition of Done | PASS | 18/20 marked. 2 deferred operator post-deploy. |
| 4 | Workflow Checklist | PASS | 15/16 marked. Step 6 housekeeping pending merge (correct pre-merge state). |
| 5 | Merge Checklist Evidence | PASS | 9/9 rows [x] with concrete evidence. |
| 6 | Completion Log | PASS | 16 dated rows covering all executed steps. No bugs.md mentions. |
| 7 | Tracker Sync | PASS | Active Session Step 5/6. Features table row inserted in `6ec7c80`. |
| 8 | key_facts.md | PASS | Updated `c1c286e` — addendum line 31 preserving FU6 historical lesson + ADR-030 ref. |
| 9 | Merge Base | PASS | UP TO DATE with origin/develop. |
| 10 | Working Tree | PASS | clean. |
| 11 | Data Files | PASS | N/A — no JSON seed files in diff. |
| 12 | CI State | PASS | PR #320 run `27202567565` post-rerun: all 7 workspaces ✓, ci-success ✓, Vercel deployed. First run had transient next/font ETIMEDOUT (Google Fonts network glitch — not code). |

**STRUCTURAL: READY FOR MERGE**

### Drift (13-28) — advisory

| # | Pattern | Status | Detail |
|---|---------|:------:|--------|
| 13 | P1 PR body test count stale | ADVISORY | PR body 783/783 vs ticket terminal 795/795. PR body refresh recommended pre-merge. |
| 14 | P2 Aspirational Evidence | PASS | All 9 MCE rows past-tense + concrete. |
| 15 | P3 Post-merge actions | PASS | N/A pre-merge. |
| 16 | P4 Remote branch orphan | PASS | Not checked pre-merge. |
| 17 | P5 Frozen ticket Status | ADVISORY (systemic) | FROZEN_COUNT=54 — repo-wide pre-existing drift. NOT specific to FU7. |
| 18 | P6 AC count off-by-N | PASS | MCE row 1 "AC: 23/29 done" exact match to actual (form: header). |
| 19 | P7 Intra-ticket test drift | PASS | Terminal 795/795. AC27 threshold removed; DoD/Workflow text updated to 795/795 final. Historical CL rows retain accurate 783/783 timestamps. |
| 20 | P8 Completion Log gap | PASS | Every [x] Step has dedicated Completion Log entry. |
| 21 | P9 Tracker header stale | PASS | Last Updated Step 5/6 = Active Feature Step 5/6. |
| 22 | P10 Duplicate log rows | PASS | No duplicates. |
| 23 | P11 Tracker status mismatch | PASS | tracker=in-progress matches ticket=Ready for Merge. |
| 24 | P12 Tracker HEAD reference | PASS | No HEAD SHAs in tracker header lines. |
| 25 | P13 key_facts delta | PASS | N/A — no quantified atom/dish deltas. |
| 26 | P14 MCE Action 1 stale | PASS | N/A pre-merge. |
| 27 | P15 Post-deploy AC w/o evidence | PASS | 6 operator ACs intentionally [ ] — correct pattern. |
| 28 | P16 Feature missing tracker | PASS | Row inserted commit `6ec7c80`. |

**DRIFT: 2 advisories non-blocking** (P1 PR body refresh; P5 systemic frozen tickets pre-existing). 14/16 PASS.

### Combined verdict

Structural: 12/12 PASS | Drift: 2 advisory | Verdict: APPROVE

**READY FOR MERGE PENDING OWNER FINAL OK** + operator AC5/6/7/8/9/26 reverify on app-dev post-deploy.
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
