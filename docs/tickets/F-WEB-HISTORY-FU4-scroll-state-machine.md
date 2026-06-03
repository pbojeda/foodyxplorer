# F-WEB-HISTORY-FU4: TranscriptFeed scroll-positioning state machine refactor

**Feature:** F-WEB-HISTORY-FU4 | **Type:** Frontend-Refactor (architectural fix for AC20-A + AC21) | **Priority:** High (release develop→main bloqueado hasta esto)
**Status:** Spec | **Branch:** bugfix/web-feed-scroll-state-machine (off develop `55528c5`)
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-06-03 | **Dependencies:** F-WEB-HISTORY-FU3 done (#306/#307 → develop `55528c5`)
**Research:** `docs/research/transcript-feed-scroll-architecture-2026-06-03.md` (Plan agent + Gemini + Codex cross-model, 2026-06-03)
**Methodology:** development-workflow Standard tier, MANDATORY full Path B (`/review-spec` + `/review-plan` cross-model + code-review + qa + `/audit-merge` + Playwright e2e). **NO MAJOR DEFERRALS** per meta-lesson §5 of research doc.

---

## Spec

### Description

After 3 iterations (FU1 + FU2 + FU3) we still have two unfixed bugs in the `/hablar` TranscriptFeed scroll behavior:

- **AC20-A (append truncated):** when the user submits a search while at the bottom of the feed, the new card is partially hidden under the input bar. The smooth scroll's target was captured at the **shimmer state** (`~100px`); when the real `NutritionCard` renders (~300px), `entries.length` did NOT change, so the append effect does NOT re-fire. The card's bottom ends up below the smooth-animation's frozen target. Same race as Bug 1 hydration but in append context. **FU2's MAJOR-2 deferral was incorrect** — the "smooth auto-no-ops" rationale was unverified and falsified by the smooth-scroll spec (target is fixed at animation start, not re-evaluated).

- **AC21 (loadMore prepend lands wrong):** the JS-driven anchor restoration math is poisoned by the skeleton placeholder. `Effect 4` (capture, `useEffect[isLoadingMore]`) reads `scrollHeight` AFTER the `HistoryLoadMoreSentinel` skeleton mounts (~248px), then `Effect 5` (restore, `useLayoutEffect[isLoadingMore]`) computes `delta = scrollHeight_after_real_entries − scrollHeight_with_skeleton`, which is wrong in both endpoints. Pre-FU3 the browser's native `overflow-anchor:auto` adjustment absorbed the math break (post-paint useEffect ran AFTER browser anchor adjustment, JS overwrote with nearly-correct value). Post-FU3 (`useLayoutEffect`, pre-paint) JS wins the race — the bug is now fully visible. **FU3 didn't introduce the math break, it removed the browser-side band-aid masking it.**

The diagnostic root cause across both is the same: **TranscriptFeed has 6 effects that each independently mutate scroll geometry, with no single owner of the lifecycle.** The research doc (`docs/research/transcript-feed-scroll-architecture-2026-06-03.md`) §7 proposes a unified 4-effect state machine that fixes both, with cross-model consensus (Gemini + Codex aligned on diagnosis, divergent on solution shape, synthesized into a hybrid).

This ticket implements that architecture. **No more iterations on this feature** — the FU4 must close AC19 + AC20-A + AC20-B + AC21 together on the same PR with Playwright e2e enforcing the operator ACs in CI.

### Goals

1. **Fix AC20-A** by adding a bottom-lock `ResizeObserver` window (~1500ms) on append, parallel to the hydration one. Captures the shimmer→card growth.
2. **Fix AC21** by moving the loadMore capture from `useEffect[isLoadingMore]` (post-paint, skeleton-polluted) into the `handleLoadMore` callback (synchronous, pre-skeleton). Baseline is then known-good.
3. **Set `overflow-anchor: none`** explicitly on the scroll container so JS unambiguously owns scroll restoration (eliminates the JS-vs-native-anchor race).
4. **Unify the 6 effects into a 4-effect state machine** with a `scrollLockRef` discriminated union (`idle` / `bottom-lock` / `prepending`) preventing concurrent mutations.
5. **Re-key the append/prepend detection** to use first/last `entryId` comparison instead of `entries.length` alone (loadMore prepends ALSO grow `entries.length`, currently distinguished only by `wasNearBottomRef`).
6. **Add Playwright e2e** for AC20-A + AC21 (first e2e for this component) so operator ACs become CI-enforceable, not just one-time owner-browser smoke.
7. **Save the methodology lesson** `feedback_layout_effect_phase_swap_needs_full_review` to memory post-merge.

### Out of scope

- Switching to a virtualized list (overkill — alt 2 rejected in research doc §8).
- Pure-declarative path via `scrollIntoView` + native `overflow-anchor:auto` (alt 1 rejected — input-bar padding mismatch + Safari iOS support gap).
- Eliminating skeletons during loadMore (alt 4 rejected — regresses W18 a11y guideline).
- Indefinite bottom-lock window (still 1500ms; if operator AC surfaces a repeatable >1500ms settle case in future, escalate to FU5 — DO NOT widen in this PR).
- ResizeObserver polyfill for production (graceful fallback to single-shot scroll already exists; covers all target browsers).

### Architecture summary

Per research doc §7.1, the 4-effect state machine:

**Refs (7 total — 4 existing + 3 new):**
- `feedRef` — container DOM ref (unchanged).
- `wasNearBottomRef` — scroll listener state (unchanged).
- `prevEntriesLengthRef` — last `entries.length` (unchanged).
- `hasScrolledToBottomOnHydrationRef` — guard for one-shot hydration (unchanged).
- `firstEntryIdRef` — **NEW** last seen `entries[0]?.entryId`; used by Effect B to detect prepend (per /review-spec Codex C1).
- `lastEntryIdRef` — **NEW** last seen `entries[entries.length-1]?.entryId`; used by Effect B to detect append (per /review-spec Codex C1).
- `scrollLockRef` — **NEW** discriminated union:
  - `{ mode: 'idle' }`
  - `{ mode: 'bottom-lock', deadline: timestamp, observer: ResizeObserver }`
  - `{ mode: 'prepending', prevScrollHeight: number, prevScrollTop: number }`

**Effects:**
- **Effect A** (`useEffect[]`) — scroll listener (unchanged from current Effect 0).
- **Effect B** (`useLayoutEffect`, deps include signals for mutation type, NOT only `entries.length`) — unified hydration + append mutation handler. Per /review-spec Codex C1: the dep array MUST include enough signal to fire on first/last entryId changes (e.g., `[entries.length, entries[0]?.entryId ?? '', entries[entries.length-1]?.entryId ?? '']`) so the effect runs when both endpoints flip but length stays equal (rare but possible after a same-commit clear-then-search batch). Effect body compares the captured `firstEntryIdRef`/`lastEntryIdRef` against current values to discriminate append vs prepend vs full-replace. Triggers bottom-lock observer for 1500ms post-hydration AND post-append.
- **Effect C** (`useLayoutEffect[isLoadingMore]`) — loadMore restore. Reads from `scrollLockRef.mode === 'prepending'` baseline (captured pre-skeleton by `handleLoadMore` callback).
- **Effect D** (`useEffect[]`) — unmount cleanup (generalized from current Effect 2; tears down observer + resets all refs).

**Callback (NEW):**
- `handleLoadMore` — wraps the parent's `onLoadMore`. Captures `scrollHeight` + `scrollTop` synchronously BEFORE invoking parent (which triggers `isLoadingMore=true` → skeleton render). Sets `scrollLockRef = { mode: 'prepending', ... }`.

**Container style:**
- `style={{ overflowAnchor: 'none' }}` explicit (NOT in className — Tailwind doesn't have a utility for this).

---

## Acceptance Criteria

### A — Bottom-lock observer (AC20-A primary fix)

- [ ] **AC1.** When a session append fires (`entries.length` grew AND last entryId is new AND `wasNearBottomRef.current === true`), Effect B fires `scrollTo({ top: scrollHeight, behavior: 'smooth' })` AND attaches a `ResizeObserver` to the feed container with deadline = `now + APPEND_BOTTOM_LOCK_WINDOW_MS` (1500ms).
- [ ] **AC2.** During the bottom-lock window, every `ResizeObserver` fire re-invokes `scrollTo({ top: scrollHeight, behavior: 'instant' })` (NOT smooth — smooth would cancel/re-queue and jitter). The 'instant' corrections occur AFTER the initial 'smooth' has settled or is still animating.
- [ ] **AC3.** _(Race-aware test, MANDATORY)_ Unit test simulates the shimmer→card race: install `createResizeObserverShim()` in `beforeEach`; render with `wasNearBottomRef=true`, append a `pendingEntry`, capture the smooth `scrollTo` call at shimmer `scrollHeight` (use `Object.defineProperty(feed, 'scrollHeight', { get: () => currentScrollHeight })` with mutable `currentScrollHeight`). Mutate `currentScrollHeight` to simulate card growth. Invoke `shim.fire([{ target: feed, contentRect: ... } as ResizeObserverEntry])` (the existing shim's `fire()` method per `resizeObserverShim.ts:53`). Assert: `scrollToMock` called ≥2 times AND the LAST call's `top` equals the post-growth `scrollHeight`.
- [ ] **AC4.** When `wasNearBottomRef.current === false` at append time, NEITHER the smooth scroll NOR the observer fire (no scroll, no lock). Existing behavior preserved.
- [ ] **AC5.** When the user scrolls UP during the bottom-lock window (`scroll` event listener flips `wasNearBottomRef` to false), the observer's next fire detects this and disconnects early (no over-correction against user intent).
- [ ] **AC6.** When the timer reaches the deadline (1500ms elapsed), the observer disconnects and `scrollLockRef.current = { mode: 'idle' }`. Test using `jest.useFakeTimers()` + `advanceTimersByTime(1501)`.

### B — Pre-skeleton capture for prepend (AC21 primary fix)

- [ ] **AC7.** Component receives `onLoadMore` as a prop and wraps it in a local `handleLoadMore` callback. The callback captures `feedRef.current.scrollHeight` + `feedRef.current.scrollTop` SYNCHRONOUSLY before invoking `props.onLoadMore()`. Sets `scrollLockRef.current = { mode: 'prepending', prevScrollHeight, prevScrollTop }`.
- [ ] **AC8.** `<HistoryLoadMoreSentinel>` receives the wrapped `handleLoadMore` (NOT the raw `props.onLoadMore`). When the IntersectionObserver fires inside the sentinel, the callback chain executes capture → parent state mutation → React commits → skeleton renders. **Critical:** capture happens BEFORE the commit that adds the skeleton.
- [ ] **AC9.** _(Race-aware test for AC21, MANDATORY)_ Unit test simulates the 2-commit flow: render with `isLoadingMore=false` + N entries. Trigger `handleLoadMore()` (synchronous call). Rerender with `isLoadingMore=true` (skeleton mounts; scrollHeight grows by ~248). Rerender again with `isLoadingMore=false` + entries grown at FRONT by M (skeleton gone). Assert: Effect C ran with `prevScrollHeight = ORIGINAL scrollHeight` (pre-skeleton), NOT the polluted intermediate value. Final `scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight)` is mathematically correct.
- [ ] **AC10.** Effect C remains `useLayoutEffect` (preserving FU3's flicker fix) but reads only from `scrollLockRef.mode === 'prepending'`. If `idle`, early-returns. After restore, sets `scrollLockRef.current = { mode: 'idle' }`.
- [ ] **AC11.** _(Anti-anchor race)_ The scroll container has `style={{ overflowAnchor: 'none' }}` explicitly set. Verified via DOM inspection in test: `expect(feed).toHaveStyle({ overflowAnchor: 'none' })`.

### C — Append vs prepend detection

- [ ] **AC12.** Effect B distinguishes append (last entryId changed) from prepend (first entryId changed) using `firstEntryIdRef.current` and `lastEntryIdRef.current` captured pre-commit. Refs updated post-effect-body. A prepend (loadMore arrival) does NOT trigger the append/bottom-lock path even though `entries.length` grew.
- [ ] **AC13.** _(Mixed mutation guard)_ If BOTH first and last entryId changed in the same commit (e.g., user clears all then a new search fires before commit — extremely unlikely), Effect B treats it as a fresh hydration (re-arm guard if needed). Test the unlikely path explicitly.

### D — State machine integrity

- [ ] **AC14.** Discriminated union `scrollLockRef` enforces single-mode-at-a-time. Test asserts: when `mode='bottom-lock'` is active and `handleLoadMore` is called (entering `mode='prepending'`), the bottom-lock observer is disconnected FIRST, then the prepending state set. No simultaneous mode coexistence.
- [ ] **AC14b.** _(Inverse transition — per /review-spec Codex C2 matrix row h)_ When `mode='prepending'` is active (loadMore in flight) and a session append fires (very unlikely but legal: user typed a search while loadMore was loading), Effect B detects the inverse transition. Behavior: append is QUEUED OR IGNORED gracefully — Effect B does NOT clobber the captured `prevScrollHeight`/`prevScrollTop` of the active prepending session. Test simulates: trigger `handleLoadMore()` (sets prepending mode), THEN rerender with `entries=[...old, newAppend]` BEFORE the loadMore restore fires. Assert: `scrollLockRef.mode === 'prepending'` is preserved; append did NOT trigger bottom-lock. (Recommendation in Plan: append within prepending mode early-returns; loadMore restore completes; next append on a fresh commit goes through normal path.)
- [ ] **AC14c.** _(Clear-all then search — per /review-spec Codex C2 matrix row f)_ After `entries.length` drops to 0 (clear-all) and then grows again to N≥1 (new search), Effect B routes through the APPEND path (NOT a re-hydration). The `hasScrolledToBottomOnHydrationRef` guard remains true after clear-all (hydration is one-shot per component lifetime). Mirrors the existing EC-CLEAR-2 test in `TranscriptFeed.edge-cases.test.tsx`. Test asserts: render with entries=[10] hydrated; rerender with []; rerender with [1 new]; observer is NOT re-installed for hydration; append-path bottom-lock IS armed.
- [ ] **AC15.** _(Idempotent reset)_ Unmount cleanup (Effect D) handles all three modes correctly: `idle` → no-op; `bottom-lock` → `observer.disconnect()`; `prepending` → just reset (no DOM touch needed). All refs reset for Strict Mode dev parity.

### E — Hydration regression guard

- [ ] **AC16.** AC19 from FU2/FU3 (reload lands at bottom) still PASS. Hydration path goes through Effect B's hydration branch → synchronous instant scroll + bottom-lock 1500ms. Existing FU2 + FU3 hydration tests pass unchanged (modulo naming generalization).
- [ ] **AC17.** Strict Mode dev parity preserved: Effect D's cleanup resets `hasScrolledToBottomOnHydrationRef` so the synthetic remount re-installs observer. (Inherits FU2 fix-loop's solution.)

### F — Build / CI / tests

- [ ] **AC18.** Unit test suite green: `npm test -w @foodxplorer/web` — count target 771 baseline + delta. Estimated final ~785-790 (per research doc §7.3 surgery).
- [ ] **AC19.** Lint + typecheck + build clean (`next lint`, `tsc --noEmit`, `next build`).
- [ ] **AC20.** **NEW** Playwright infrastructure setup in `packages/web` (per /review-spec Codex C4 — currently no Playwright dep/config/script). Includes:
  - `@playwright/test` added to `packages/web/devDependencies`.
  - `packages/web/playwright.config.ts` with sensible defaults (Chromium, baseURL, retries, screenshot on failure).
  - `packages/web/package.json` scripts: `"test:e2e": "playwright test"`, `"test:e2e:install": "playwright install --with-deps chromium"`.
  - `.github/workflows/ci.yml` job `test-web-e2e` running after `test-web`: installs Playwright Chromium + starts a Next.js test server (via `npx next start -p <port>` after `next build`) + runs `npm run test:e2e -w @foodxplorer/web` + uploads artifacts on failure. Job is REQUIRED for `ci-success`.
  - Fixture strategy: a Playwright `fixtures.ts` exposing a "logged-in user with N persisted entries" fixture. Implementation in Step 2 Plan: either (a) mock the API responses via Playwright route interception, OR (b) seed the test DB pre-job via a `setup` project. Choose in Step 2 per simplicity vs realism trade-off.
- [ ] **AC20b.** Concrete e2e scenarios:
  - `e2e/transcript-feed.append-card-visible.spec.ts` — log in (via fixture), persisted entry exists, submit search query → wait for result card → assert last card's bottom `getBoundingClientRect().bottom <= inputBar.getBoundingClientRect().top` (card fully visible above input bar).
  - `e2e/transcript-feed.loadmore-anchor-preserved.spec.ts` — log in with ≥10 persisted entries fixture; scroll to top of feed (triggers loadMore); capture anchor entryId from viewport pre-loadMore; await older entries to load; assert same entryId visible at same approximate viewport position post-loadMore (within ±50px tolerance for browser rendering variance).
- [ ] **AC21.** CI `ci-success` SUCCESS including the new `test-web-e2e` job. The job MUST be in the required-checks set for branch protection (configurable post-merge).

### G — Documentation

- [ ] **AC22.** `docs/specs/ui-components.md` TranscriptFeed entry updated: State block reflects the new 5-ref model + `scrollLockRef` discriminated union; Behavior block describes the 4-effect state machine; Props notes the `onLoadMore` wrapping pattern.
- [ ] **AC23.** `docs/specs/design-guidelines.md` W18 reaffirmed (still "no animation on initial mount"). Cross-link from FU4 ticket Completion Log.

### H — Operator post-deploy (authoritative)

- [ ] **AC24.** _(Replaces FU2 AC19/FU3 AC9 — reload smoke)_ On app-dev after merge + redeploy: log in, ≥2 persisted entries, reload `/hablar` ×5 reloads. ALL 5 must land at the bottom WITHOUT visible "up→down" sequence (the FU3 useLayoutEffect fix is preserved; this just reconfirms with the new architecture).
- [ ] **AC25.** _(Replaces FU2 AC20 — append smoke; clarified per /review-spec Codex C-S1)_ On app-dev: feed at bottom + submit new search → the new card's BOTTOM is FULLY VISIBLE above the input bar after the result renders (NOT half-cut). Reproducible procedure:
  - **Fast case** (typical user): submit search with browser cache enabled, network unthrottled. Expect: card fully visible within ~1.5s of result arrival.
  - **Slow case** (proves the bottom-lock observer): open DevTools → Network tab → check "Disable cache" + select "Slow 3G" throttle preset → submit search → after slow API response arrives, card fully visible (the 1500ms post-append window catches the late shimmer→card growth).
  - Pass requires BOTH cases visible-fully-after-settle.
- [ ] **AC26.** _(Replaces FU2 AC21 / FU3 AC10 — loadMore smoke)_ On app-dev: ≥10 persisted entries, scroll up to trigger loadMore, observe the entry you were looking at stays anchored when older entries prepend. NO jump to top, NO jump to bottom, NO loss of intermediate entries.

---

## Definition of Done

- [ ] `bugs.md` entry BUG-WEB-FEED-SCROLL-SETTLE-001 reaches **TRULY FIXED** status (operator AC24+AC25+AC26 all PASS post-deploy). Update existing entry, do NOT create new bug.
- [ ] `product-tracker.md` Active Session + Features row reflect FU4 DONE.
- [ ] FU1/FU2/FU3 tickets NOT modified retroactively (per `feedback_jsdom_layout_ac_gap` lesson — those are Done and their tests legitimately pass; the bug was at jsdom↔browser boundary).
- [ ] Memory entry `feedback_layout_effect_phase_swap_needs_full_review` saved (rule: any `useEffect ↔ useLayoutEffect` swap on scroll/layout-writing effects requires Path B, no Path A).
- [ ] `docs/research/transcript-feed-scroll-architecture-2026-06-03.md` linked from FU4 ticket Completion Log + from updated bugs.md entry as the authoritative diagnosis.
- [ ] Release develop→main gate: AC24 + AC25 + AC26 PASS → release PR opens immediately (no additional FU pending).
- [ ] All A/B/C/D/E/F/G ACs marked `[x]` pre-merge.
- [ ] Web suite + lint + typecheck + build counts documented in Completion Log.
- [ ] Playwright e2e suite added + green on CI. Documented in Completion Log + key_facts.md (new infrastructure).

---

## Workflow Checklist

- [ ] **Step 0 — Spec** (this file, in progress): + cross-model `/review-spec` (Gemini + Codex parallel) + apply findings + owner sign-off on Spec.
- [ ] **Step 1 — Setup**: branch `bugfix/web-feed-scroll-state-machine` off develop `55528c5` (DONE). Verify working tree clean.
- [ ] **Step 2 — Plan**: full Implementation Plan derived from research doc §7.1 + cross-model `/review-plan` + owner sign-off.
- [ ] **Step 3 — Implement (TDD)**: RED tests for AC3/AC9/AC11/AC14/AC15 (race-aware + state-machine invariants) → GREEN refactor to 4-effect state machine. Per research doc §7.3: ~13-16 test touches + 4-6 new tests.
- [ ] **Step 4 — Finalize**: full web suite green + lint + typecheck + build clean; commit with conventional message; push.
- [ ] **Step 5 — Review**: code-review-specialist + qa-engineer + `/audit-merge`. **NO MAJOR deferrals** (per FU2 lesson — every MAJOR is empirically validated against the operator scenario, not deferred on theoretical grounds).
- [ ] **Step 6 — Playwright e2e**: separate sub-step within Step 5; add e2e tests + run locally + push + CI green.
- [ ] **Step 7 — Merge + Closeout**: `gh pr create` → CI verify (including Playwright job) → owner sign-off → squash-merge → closeout PR (Status Done + branches deleted local+remote + tracker sync). Then operator AC24/AC25/AC26 reverify on app-dev.

---

## Implementation Plan

_(To be populated in Step 2 after `/review-spec` sign-off. Will derive from research doc §7.1 + §7.3.)_

### Design Notes

_(Reserved for Step 2.)_

### Frontend Plan

_(Reserved for Step 2.)_

### Playwright Plan

_(Reserved for Step 2.)_

### Verification commands run

_(Reserved for Step 2.)_

---

## Completion Log

| Date | Step | Notes |
|------|------|-------|
| 2026-06-03 | Step 0 (Spec draft) | Ticket created post-research-doc (Plan agent + Gemini + Codex cross-model, 2026-06-03). Spec derived from research doc §7 (architecture) + §7.2 (edge-case matrix translated to ACs) + §7.5 (risk register addressed in DoD + operator ACs) + §9 (Standard tier rationale). 26 ACs across 8 categories. Branch `bugfix/web-feed-scroll-state-machine` cut off develop `55528c5`. |
| 2026-06-03 | Step 0 (`/review-spec` cross-model) | Gemini → **APPROVED** (1 SUGGESTION = add `firstEntryIdRef`/`lastEntryIdRef` to Refs list; subsumed by Codex C1). Codex → **REVISE** (4 IMPORTANT + 1 SUGGESTION, all empirically grounded by reading research doc + ticket + TranscriptFeed.tsx + HistoryLoadMoreSentinel.tsx + useSearchHistory.ts + resizeObserverShim.ts + packages/web/package.json). All 5 findings APPLIED in next commit: **C1** Architecture summary Refs section expanded to 7 (4 existing + 3 new: `firstEntryIdRef`, `lastEntryIdRef`, `scrollLockRef`); Effect B dep array clarified to include first/last entryId signals (not only `entries.length`). **C2** new AC14b (inverse `prepending → append` transition guard) + AC14c (clear-all → search routes through append, mirrors EC-CLEAR-2). **C3** AC3 rewritten to reference the actual `shim.fire()` API + `Object.defineProperty(scrollHeight, getter)` pattern (no fictional `shim.observerCb`). **C4** AC20 split into AC20 (Playwright infra setup — dep + config + script + GitHub Actions job + fixture strategy) and AC20b (concrete e2e scenarios). **C-S1** AC25 wording made reproducible (DevTools cache-disabled + Slow 3G throttle, explicit). 26 → 29 ACs total. Review artifacts: `/tmp/review-spec-foodXPlorer-FU4/{gemini,codex}.txt`. |

---

## Merge Checklist Evidence

_(Populated in Step 5 per `references/merge-checklist.md`.)_

| # | Action | Status | Evidence |
|---|--------|--------|----------|
| 0 | Pre-flight check | [ ] | — |
| 1 | Acceptance Criteria all marked | [ ] | — |
| 2 | Definition of Done all marked | [ ] | — |
| 3 | Workflow Checklist Steps 0-6 complete | [ ] | — |
| 4 | Completion Log per-step rows | [ ] | — |
| 5 | Product Tracker sync | [ ] | — |
| 6 | key_facts.md sync (Playwright = NEW infra) | [ ] | — |
| 7 | bugs.md sync | [ ] | — |
| 8 | Tests / lint / typecheck / build / Playwright e2e | [ ] | — |
| 9 | Cross-model + reviewer + audit-merge trail | [ ] | — |
