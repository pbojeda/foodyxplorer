# F-WEB-HISTORY-FU2: Feed scroll-settle — ResizeObserver hydration + wasNearBottomRef append

**Feature:** F-WEB-HISTORY-FU2 | **Type:** Frontend-Bugfix (2 layout-race fixes in `TranscriptFeed`) | **Priority:** High (visible UX defect on every authenticated `/hablar` reload + every new search)
**Status:** Spec | **Branch:** bugfix/web-feed-scroll-settle (off develop `172fb23`)
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-06-02 | **Dependencies:** F-WEB-HISTORY done (#299/#300), F-WEB-HISTORY-FU1 done (#302/#303), BUG-API-RATELIMIT-BEARER-001 fixed (#301)
**Closes:** BUG-WEB-FEED-SCROLL-SETTLE-001 (HIGH, OPEN — see `docs/project_notes/bugs.md`)
**Methodology:** bug-workflow Path B + cross-model `/review-spec` + `/review-plan` + full review gates (per owner explicit request for feature-grade ceremony on this bug).

---

## Spec

### Description

Two distinct browser-layout races in `packages/web/src/components/TranscriptFeed.tsx`, both surfaced by F-WEB-HISTORY-FU1 operator smokes on app-dev 2026-06-01 (owner bearer `sub b39eaa06…`). Both unit tests in FU1 passed (jsdom uses fixed `scrollHeight` via `Object.defineProperty(..., { value: X })`), but the real browser fails because the production timing depends on async layout growth that jsdom does not model.

**Bug 1 — Reload doesn't land at the bottom (FU1 AC10b regression in browser).** FU1's hydration effect (`TranscriptFeed.tsx:67-78`) fires `container.scrollTo({ top: scrollHeight, behavior: 'smooth' })` the moment persisted entries hydrate. The `behavior: 'smooth'` animation **captures `scrollHeight` at animation start**, but child cards (`NutritionCard`, dish lists, possibly lazy images / fonts) keep growing the layout *during* the animation → the smooth-scroll lands at the **old** target, not the final bottom. Reload visually stops short.

**Bug 2 — New search appends but feed stays where it was (FU1 AC11 regression in browser, NOT introduced by FU1).** Preexisting debt in the F-WEB-HISTORY append effect (`TranscriptFeed.tsx:83-103`). The condition `isNearBottom = scrollTop + clientHeight >= scrollHeight - 100` is evaluated **after React commits the new entry**, so `scrollHeight` has already jumped by the new entry's height (typically >100px for a `NutritionCard`). A user who WAS near the bottom pre-commit is mis-classified as "not near bottom" → no auto-scroll. The 100px threshold is too narrow for rich result cards AND the post-commit timing is fundamentally wrong (must consult pre-commit state).

The fix replaces both effects with patterns that decouple correctness from layout timing:

- **Bug 1 → `ResizeObserver` PRIMARY** on the feed container during a ~500ms window post-hydration. Re-scroll **`behavior: 'instant'`** every time `scrollHeight` grows. (Auditor 2026-06-02: rAF×2 is NOT sufficient — `NutritionCard` async work can span more than 2 frames. ResizeObserver is robust against arbitrary settle time.)
- **Bug 2 → `wasNearBottomRef` PRIMARY** updated by a `scroll` event listener (canonical Slack/Linear/Discord pattern). The ref captures user position BEFORE the append commits → consult in the post-commit effect → decide unconditionally. Decoupled from the buggy post-mutation `scrollHeight` math. Keep `behavior: 'smooth'` on append (no jarring on the actively-engaged user).

### Out of scope

- `ResizeObserver` polyfill for browsers without it (all target browsers — last 2 versions of Chrome/Firefox/Safari/Edge per `packages/web` Browserslist — support it natively since 2020+).
- `MutationObserver` fallback (rejected: ResizeObserver is the canonical primitive for this exact case).
- Account-keyed daily quota (multi-device unified counter) — **F-WEB-TIER-FU2** territory.
- 429 retry-after copy / multi-device shared-cap doc / 429 input-disable+countdown — non-blocking BUG-API-RATELIMIT-BEARER-001 follow-ups in memory `project_ratelimit_followups`.
- Library-angle SDD v0.21.x candidate (`/audit-merge` jsdom-limited AC detector) — out of this PR, tracked in memory `feedback_jsdom_layout_ac_gap`.

### UI Changes

- **TranscriptFeed hydration scroll**: replace the FU1 `useEffect([entries.length])` single-shot smooth-scroll with a ResizeObserver-driven re-scroll loop active during the post-hydration window (~500ms after the ref-guard fires). Use `behavior: 'instant'` (smooth-on-reload is visually jarring and is the source of the race). The ref-guard semantics are preserved (fires at most once per session — loadMore prepends and session appends do NOT re-trigger it).
- **TranscriptFeed append auto-scroll**: replace the post-commit `isNearBottom` math with a `wasNearBottomRef` updated by a `scroll` event listener mounted on the feed container. Read the ref at the top of the post-commit effect; decide deterministically. Keep `behavior: 'smooth'` on append (consistent with chat-app convention for the actively-engaged user case).
- **Cleanup**: both observers / listeners must be torn down on unmount (and the ResizeObserver disconnected when the post-hydration window ends to avoid leaking).

### Edge Cases & Error Handling

- **ResizeObserver unavailable** (older browser, test env without polyfill): degrade gracefully — fall back to a single-shot `scrollTo({ top: scrollHeight, behavior: 'instant' })` on hydration (matches W18 "no animation on initial mount" and AC5). NOT the FU1 `behavior: 'smooth'` (which is the source of the race). No throw. Detect via `typeof ResizeObserver === 'undefined'`.
- **Hydration window already elapsed** before child cards finish growing (e.g., very slow font load): worst-case the user lands close to (but not exactly at) the bottom — better than the current "stops short" because each growth tick re-scrolls within the window. Document the tradeoff in the Plan.
- **User scrolls during the hydration window**: ResizeObserver re-scrolls override user intent during the first ~500ms. This is acceptable because (a) it's the very first paint after reload, the user has barely had time to react, (b) the canonical pattern in chat apps is "scroll to bottom on load, then let the user take over". After the window ends, normal `wasNearBottomRef` logic takes over.
- **Append fires AFTER the hydration window closes** (typical case): only the `wasNearBottomRef` path runs — the ResizeObserver has already disconnected. Two effects do not stack.
- **Empty entries on initial render, no hydration arrives** (true anonymous user): neither effect fires. No regression vs the existing logout-/empty-state path.
- **Rapid successive appends** (multiple search results within ~500ms): each append fires the post-commit effect once; `wasNearBottomRef` is consulted fresh each time (the scroll listener updates it between commits). No drift.
- **Mock environment (jsdom)**: `ResizeObserver` is NOT in jsdom; tests must shim it OR exercise the fallback path. Race-aware shim documented in AC4 (test pattern is MANDATORY — without it the FU can ship green and still fail in browser).

---

## Acceptance Criteria

### A — Hydration scroll-settle (Bug 1)

- [ ] **AC1.** When `TranscriptFeed` mounts (or first transitions from `entries=[]` to `entries.length ≥ 1`) with `ResizeObserver` available, a `ResizeObserver` is attached to the feed container. While active (≤500ms window) it re-invokes `scrollTo({ top: scrollHeight, behavior: 'instant' })` every time the observed `scrollHeight` grows. After the window elapses it disconnects.
- [ ] **AC2.** The hydration scroll uses `behavior: 'instant'` (NOT `'smooth'`). Verified by asserting the `scrollTo` mock receives `behavior: 'instant'` on the hydration call(s).
- [ ] **AC3.** The ref-guard `hasScrolledToBottomOnHydrationRef` introduced in FU1 is preserved — hydration only activates ONCE per component lifetime; loadMore prepends and session appends do NOT re-trigger it.
- [ ] **AC4.** _(race-aware test, MANDATORY per auditor 2026-06-02; refined per /review-spec Codex C1)_ A unit test installs a **controllable `ResizeObserver` shim** that captures the callback passed to `new ResizeObserver(cb)` into a test-scoped handle (e.g., `let observerCb: ResizeObserverCallback | null = null;` set inside the shim's constructor). The test also installs `Object.defineProperty(feed, 'scrollHeight', { get: () => currentScrollHeight })` with a mutable `currentScrollHeight`. After the rerender that hydrates entries, the test (a) mutates `currentScrollHeight` to a larger value, (b) explicitly invokes `observerCb([{ target: feed, contentRect: ... } as ResizeObserverEntry], observer)`, then asserts EITHER `scrollTo` was called ≥2 times (initial + the post-growth re-fire) OR the LAST `scrollTo` call carries the post-growth `scrollHeight`. The `setTimeout`-only variant is rejected — it does not deterministically prove the ResizeObserver path runs. Reproduces the FU1 browser bug deterministically; a green test means the fix actually settles the race.
- [ ] **AC5.** Graceful fallback: when `typeof ResizeObserver === 'undefined'` (older browser / unshimmed test env), the hydration effect falls back to a single-shot `scrollTo({ top: scrollHeight, behavior: 'instant' })`. No throw. Unit-tested by deleting `globalThis.ResizeObserver` in one test case. (`'instant'` matches W18 + the rest of this Spec — NOT FU1's `'smooth'`.)
- [ ] **AC6.** No regression on the FU1 sync-mount case (entries already populated on first render): feed lands at the bottom. The behavior change (smooth→instant) is acceptable on reload per spec; assert via `scrollTo` mock call.

### B — Append scroll-settle (Bug 2)

- [ ] **AC7.** A `wasNearBottomRef` is initialized to `true` (user starts at bottom by convention — matches AC1 hydration semantic). A `scroll` event listener on the feed container updates `wasNearBottomRef.current = (scrollTop + clientHeight >= scrollHeight - 100)` whenever the user scrolls. Both attach on mount + detach on unmount.
- [ ] **AC8.** The append effect (`useEffect([entries.length])` for the count-grew path) reads `wasNearBottomRef.current` at the TOP of the effect (BEFORE any DOM read) and calls `scrollTo({ top: scrollHeight, behavior: 'smooth' })` only when `wasNearBottomRef.current === true`. The OLD post-commit `isNearBottom` math is REMOVED.
- [ ] **AC9.** _(race-aware test for Bug 2)_ A unit test simulates the append race: user is near bottom pre-commit (`wasNearBottomRef.current = true` set via a `scroll` event fire), then a new entry appends and `scrollHeight` jumps >100px from inside the test. The test asserts `scrollTo` IS called — even though a post-commit `isNearBottom` check would have failed. Reproduces the FU1 AC11 browser bug deterministically.
- [ ] **AC10.** When the user has manually scrolled up (≥100px above bottom) BEFORE the new entry appends, `wasNearBottomRef.current === false` → the append effect does NOT call `scrollTo`. Respects user reading position. Unit-tested.
- [ ] **AC11.** No regression on the existing FU1 AC10c (loadMore prepend preservation): when `isLoadingMore` transitions `true → false` and entries grow at the FRONT, the feed must NOT auto-scroll to bottom. The existing prepend-preservation effect at the bottom of `TranscriptFeed` (currently lines 107-125) is untouched.

### C — Coexistence + cleanup

- [ ] **AC12.** When the append path fires AFTER the hydration window has closed (typical case for a search after reload), only the `wasNearBottomRef` logic runs (the ResizeObserver has already disconnected). The two effects do NOT stack into duplicate scrolls.
- [ ] **AC13.** Unmount tears down BOTH the `scroll` listener and the ResizeObserver (if still active). Verified by a unit test that renders + unmounts + asserts the listener / observer cleanup functions were invoked (jest spies on `removeEventListener` + `ResizeObserver.prototype.disconnect`).

### D — Canonical spec sync (per /review-spec Codex C2 + base-standards `ai-specs/specs/base-standards.mdc:12`)

- [ ] **AC14.** `docs/specs/ui-components.md` TranscriptFeed entry (currently lines ~2430-2484) is updated: the `State` line "shouldAutoScroll: boolean — true when scrollTop + clientHeight >= scrollHeight - 100. Checked before each append." is replaced with the new model — `wasNearBottomRef: MutableRefObject<boolean>` updated by a `scroll` event listener (captures pre-commit position), consulted in the append effect for unconditional decision; plus a new `Behavior` line documenting the hydration scroll uses a `ResizeObserver` for ~`HYDRATION_RESCROLL_WINDOW_MS` (≈500ms) post-hydration with `behavior: 'instant'` and ref-guarded single activation. Existing `Accessibility` / `Props` lines untouched.
- [ ] **AC15.** `docs/specs/design-guidelines.md` W18 ("On page load … the feed then scrolls to the bottom immediately on mount (no animation …)") is reaffirmed as still authoritative — no edit needed; cross-link from the ticket Completion Log to W18 + the ui-components.md row.

### E — Build / CI / quality

- [ ] **AC16.** `npm test -w @foodxplorer/web` green (no regressions in existing 745 tests + new tests for AC1–AC13).
- [ ] **AC17.** Lint + typecheck + build clean for web (api unchanged).
- [ ] **AC18.** CI `ci-success` SUCCESS on the PR.

### Cross-model review additions (Step 0 /review-spec, 2026-06-02)

Gemini → **APPROVED** (1 SUGGESTION). Codex → **REVISE** (3 IMPORTANT). Both reviewers empirically verified diagnosis + read TranscriptFeed.tsx + base-standards + design-guidelines W18 + ui-components.md TranscriptFeed row. Findings applied in Spec:

- **(Codex C1, AC4 rewritten)** Race-aware test now mandates a controllable `ResizeObserver` shim that captures the callback into a test-scoped handle + explicit observer notification, not the weaker `setTimeout` variant — that alone does not deterministically prove the ResizeObserver path runs. _Applied: AC4 rewritten with shim-handle pattern._
- **(Codex C2, doc-sync)** Frontend specs require updating `docs/specs/ui-components.md` per base-standards `ai-specs/specs/base-standards.mdc:12`. Old entry at `ui-components.md:2477` still defines the buggy `shouldAutoScroll` post-commit math. _Applied: new section D + AC14 + AC15 for canonical spec sync._
- **(Codex C3, fallback contradiction)** Edge Cases said "FU1 single-shot smooth-scroll" but AC5 + design-guidelines W18 (`design-guidelines.md:1443` — "no animation") + the spec's hydration model all converge on `behavior: 'instant'`. _Applied: Edge Cases line + AC5 wording both normalized to `'instant'`._
- **(Gemini S1, named constant)** `~500ms` should be `HYDRATION_RESCROLL_WINDOW_MS = 500` at top of `TranscriptFeed.tsx`. _Applied: AC14 spec-sync row references the constant; Plan will codify the constant placement during Step 2._

### F — Operator post-deploy (authoritative gate per `feedback_jsdom_layout_ac_gap`)

- [ ] **AC19.** **(Bug 1 reverify, op-smoke)** On app-dev after PR merge + redeploy: log in, have ≥2 persisted entries from a previous session; reload `/hablar`; visually confirm the feed lands at the bottom (last entry fully visible, NOT partially below the fold). Repeat 3 reloads in a row (different network conditions if possible) — all 3 must land cleanly. **Authoritative gate for Bug 1.**
- [ ] **AC20.** **(Bug 2 reverify, op-smoke)** On app-dev after deploy: with the feed scrolled to the bottom, submit a new query; the result card MUST scroll into view (the bottom of the card visible above the input bar). Repeat with: (a) user near bottom + (b) user scrolled up 200px+ — case (a) auto-scrolls, case (b) does NOT (the result still appends but the viewport stays where the user left it). **Authoritative gate for Bug 2.**
- [ ] **AC21.** **(Regression smoke)** On app-dev after deploy: trigger `loadMore` (scroll to top of feed, wait for the older entries to prepend) — viewport stays anchored to the user's current entry (no jump to bottom). FU1 AC10c reconfirmed.

---

## Definition of Done

- [ ] `bugs.md` entry for BUG-WEB-FEED-SCROLL-SETTLE-001 reflects post-merge status (FIXED + commit SHA + AC17/AC18/AC19 op-smoke results).
- [ ] Tracker `product-tracker.md` Active Session updated through Step 6 closeout (Done, branches deleted, AC tally).
- [ ] FU1 ticket `F-WEB-HISTORY-FU1-feed-polish.md` is NOT modified retroactively (per `feedback_jsdom_layout_ac_gap` lesson — FU1 is Done and its unit tests legitimately pass; the gap was at the jsdom↔browser boundary).
- [ ] Release develop→main gate: AC17 + AC18 + AC19 all PASS in browser → only then is the develop→main release PR opened (independent of this ticket's merge).
- [ ] All A/B/C/D ACs marked `[x]` pre-merge (operator E ACs remain `[ ]` until post-deploy).
- [ ] Web test suite count documented in Completion Log (baseline 745 + delta).
- [ ] No new ADR (this is a frontend fix, no architectural decision). If implementation deviates from the spec (e.g., ResizeObserver replaced by a different primitive), document in Completion Log with cross-model concurrence.

---

## Workflow Checklist

- [ ] **Step 0 — Spec** (in progress): this file + cross-model `/review-spec` (Gemini + Codex parallel) + apply findings + owner sign-off on Spec.
- [ ] **Step 1 — Setup**: branch already created (`bugfix/web-feed-scroll-settle` off develop `172fb23`); confirm working tree clean; baseline web suite count.
- [ ] **Step 2 — Plan**: Implementation Plan section below filled with file-level changes + verification commands + cross-model `/review-plan` + owner sign-off on Plan.
- [ ] **Step 3 — Implement (TDD)**: RED tests for AC4 + AC9 + AC5 + AC13 (race-aware + cleanup) → GREEN ResizeObserver + wasNearBottomRef + listener teardown. Keep ref-guard semantics.
- [ ] **Step 4 — Finalize**: full web suite green + lint + typecheck + build clean; commit with conventional message; push branch.
- [ ] **Step 5 — Review**: production-code-validator + code-review-specialist + qa-engineer; apply blockers + criticals; `/audit-merge` 12/12 + drift; Merge Checklist Evidence table filled with real evidence.
- [ ] **Step 6 — Merge + Closeout**: `gh pr create` → CI verify green → owner sign-off → squash-merge to develop → closeout PR (Status Done + branches deleted local+remote + tracker sync). Then prompt operator AC17/AC18/AC19.

---

## Implementation Plan

_(Populated in Step 2 after `/review-spec` sign-off.)_

### Design Notes

_(Reserved for Step 2.)_

### Frontend Plan

_(Reserved for Step 2.)_

### Verification commands run

_(Reserved for Step 2 — populated by backend-planner / frontend-planner with the empirical greps / file reads they used to ground the plan.)_

---

## Completion Log

| Date | Step | Notes |
|------|------|-------|
| 2026-06-02 | Step 0 (Spec draft) | Ticket created post-/compact per owner's context-prompt. Spec drafted from `project_bug_web_feed_scroll_settle` + `feedback_jsdom_layout_ac_gap` memories + auditor refinements 2026-06-02 (ResizeObserver as PRIMARY not ALT; mandatory race-aware test pattern; `wasNearBottomRef` via scroll listener canonical pattern). Branch `bugfix/web-feed-scroll-settle` off develop `172fb23` already cut. bugs.md entry BUG-WEB-FEED-SCROLL-SETTLE-001 added. Tracker Active Session + Features row updated. |
| 2026-06-02 | Step 0 (`/review-spec` cross-model) | Gemini → **APPROVED** (1 SUGGESTION = named constant). Codex → **REVISE** (3 IMPORTANT, all empirically grounded by reading TranscriptFeed.tsx + ui-components.md + design-guidelines.md + base-standards). All 4 findings APPLIED in commit (next): AC4 rewritten with controllable observer-shim handle pattern (C1); AC14+AC15 added for canonical ui-components.md sync + W18 cross-link (C2); Edge Cases + AC5 normalized to `behavior: 'instant'` (C3); HYDRATION_RESCROLL_WINDOW_MS named constant deferred to Step 2 Plan (Gemini S1). Operator ACs renumbered AC17-19 → AC19-21 to accommodate new D section. Review artifacts in `/tmp/review-spec-foodXPlorer-FU2/`. |

---

## Merge Checklist Evidence

_(Populated in Step 5 per `references/merge-checklist.md`. Rows reserved.)_

| # | Action | Status | Evidence |
|---|--------|--------|----------|
| 0 | Pre-flight check | [ ] | — |
| 1 | Acceptance Criteria all marked | [ ] | — |
| 2 | Definition of Done all marked | [ ] | — |
| 3 | Workflow Checklist Steps 0-5 complete | [ ] | — |
| 4 | Completion Log per-step rows | [ ] | — |
| 5 | Product Tracker sync (Active Session + Features) | [ ] | — |
| 6 | key_facts.md sync (N/A — no new infra) | [ ] | — |
| 7 | bugs.md sync | [ ] | — |
| 8 | Tests / lint / typecheck / build | [ ] | — |
| 9 | Cross-model + reviewer + audit-merge trail | [ ] | — |
