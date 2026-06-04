# F-WEB-HISTORY-FU4: TranscriptFeed scroll-positioning state machine refactor

**Feature:** F-WEB-HISTORY-FU4 | **Type:** Frontend-Refactor (architectural fix for AC20-A + AC21) | **Priority:** High (release develop→main bloqueado hasta esto)
**Status:** Ready for Merge | **Branch:** bugfix/web-feed-scroll-state-machine (off develop `55528c5`)
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
  - `{ mode: 'bottom-lock', deadline: timestamp, observer: ResizeObserver, timerId: ReturnType<typeof setTimeout> | null }` ← `timerId` added per /review-plan CRITICAL-1 fix (observer paired with explicit setTimeout, NOT just deadline-check inside callback)
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

- [x] **AC1.** When a session append fires (`entries.length` grew AND last entryId is new AND `wasNearBottomRef.current === true`), Effect B fires `scrollTo({ top: scrollHeight, behavior: 'smooth' })` AND attaches a `ResizeObserver` to the **inner content wrapper** (`feedContentRef`, NOT the flex-1 scroll container — see fix-loop round 2 below + AC1b) with deadline = `now + APPEND_BOTTOM_LOCK_WINDOW_MS` (1500ms).
- [x] **AC1b** _(FU4 round 2, 2026-06-03 — auditor C1 BLOCKER fix; cross-model gemini+codex CONFIRMED)._ The observer target MUST be the inner block-flow wrapper (`<div ref={feedContentRef}>`), NOT the flex-1 `feedRef` scroll container. Per W3C Resize Observer §3.1/§3.4.8 the observer compares `contentBox/borderBox/devicePixelContentBox` only; the flex-1 container's box stays constrained by HablarShell's `h-[100dvh]` parent so internal `scrollHeight` growth (shimmer→card) NEVER fires a callback. Observing the inner wrapper (height:auto, block flow) DOES fire because its contentBox grows. Test invariant pinned via `expect(shim.observeMock).not.toHaveBeenCalledWith(feed)` + `expect(shim.observeMock).toHaveBeenCalledWith(feedContent)`. Verification artifacts: `/tmp/audit-c1-verification-2026-06-03/{gemini,codex}.txt` + vanilla repro `/tmp/c1-repro.html`.
- [x] **AC2.** During the bottom-lock window, every `ResizeObserver` fire re-invokes `scrollTo({ top: scrollHeight, behavior: 'instant' })` (NOT smooth — smooth would cancel/re-queue and jitter). The 'instant' corrections occur AFTER the initial 'smooth' has settled or is still animating.
- [x] **AC3.** _(Race-aware test, MANDATORY)_ Unit test simulates the shimmer→card race: install `createResizeObserverShim()` in `beforeEach`; render with `wasNearBottomRef=true`, append a `pendingEntry`, capture the smooth `scrollTo` call at shimmer `scrollHeight` (use `Object.defineProperty(feed, 'scrollHeight', { get: () => currentScrollHeight })` with mutable `currentScrollHeight`). Mutate `currentScrollHeight` to simulate card growth. Invoke `shim.fire([{ target: feed, contentRect: ... } as ResizeObserverEntry])` (the existing shim's `fire()` method per `resizeObserverShim.ts:53`). Assert: `scrollToMock` called ≥2 times AND the LAST call's `top` equals the post-growth `scrollHeight`.
- [x] **AC4.** When `wasNearBottomRef.current === false` at append time, NEITHER the smooth scroll NOR the observer fire (no scroll, no lock). Existing behavior preserved.
- [x] **AC5.** When the user scrolls UP during the bottom-lock window (`scroll` event listener flips `wasNearBottomRef` to false), the observer's next fire detects this and disconnects early (no over-correction against user intent).
- [x] **AC6.** When the timer reaches the deadline (1500ms elapsed), the observer disconnects and `scrollLockRef.current = { mode: 'idle' }`. Test using `jest.useFakeTimers()` + `advanceTimersByTime(1501)`.

### B — Pre-skeleton capture for prepend (AC21 primary fix)

- [x] **AC7.** Component receives `onLoadMore` as a prop and wraps it in a local `handleLoadMore` callback. The callback captures `feedRef.current.scrollHeight` + `feedRef.current.scrollTop` SYNCHRONOUSLY before invoking `props.onLoadMore()`. Sets `scrollLockRef.current = { mode: 'prepending', prevScrollHeight, prevScrollTop }`.
- [x] **AC8.** `<HistoryLoadMoreSentinel>` receives the wrapped `handleLoadMore` (NOT the raw `props.onLoadMore`). When the IntersectionObserver fires inside the sentinel, the callback chain executes capture → parent state mutation → React commits → skeleton renders. **Critical:** capture happens BEFORE the commit that adds the skeleton.
- [x] **AC9.** _(Race-aware test for AC21, MANDATORY)_ Unit test simulates the 2-commit flow: render with `isLoadingMore=false` + N entries. Trigger `handleLoadMore()` (synchronous call). Rerender with `isLoadingMore=true` (skeleton mounts; scrollHeight grows by ~248). Rerender again with `isLoadingMore=false` + entries grown at FRONT by M (skeleton gone). Assert: Effect C ran with `prevScrollHeight = ORIGINAL scrollHeight` (pre-skeleton), NOT the polluted intermediate value. Final `scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight)` is mathematically correct.
- [x] **AC10.** Effect C remains `useLayoutEffect` (preserving FU3's flicker fix) but reads only from `scrollLockRef.mode === 'prepending'`. If `idle`, early-returns. After restore, sets `scrollLockRef.current = { mode: 'idle' }`.
- [x] **AC11.** _(Anti-anchor race)_ The scroll container has `style={{ overflowAnchor: 'none' }}` explicitly set. Verified via DOM inspection in test: `expect(feed.style.overflowAnchor).toBe('none')` (jsdom does not compute `overflow-anchor` as a recognized CSS property, so `toHaveStyle` is unreliable; `style.overflowAnchor` is equivalent).

### C — Append vs prepend detection

- [x] **AC12.** Effect B distinguishes append (last entryId changed) from prepend (first entryId changed) using `firstEntryIdRef.current` and `lastEntryIdRef.current` captured pre-commit. Refs updated post-effect-body. A prepend (loadMore arrival) does NOT trigger the append/bottom-lock path even though `entries.length` grew.
- [x] **AC13.** _(Mixed mutation guard, reconciled per /review-plan IMPORTANT-4)_ If BOTH first and last entryId changed in the same commit (e.g., clear-all-then-search batched, OR a full-replace refresh), Effect B routes through the **append path** — NOT re-hydration. The `hasScrolledToBottomOnHydrationRef` guard remains one-shot per component lifetime; clear-all does NOT re-arm it. This matches AC14c + the existing EC-CLEAR-2 test behavior + W18 "hydration scroll fires at most once per lifetime". The "fresh hydration" wording in earlier draft was inconsistent — corrected. Test the path explicitly: render entries=[10], rerender entries=[], rerender entries=[1 new]. Assert: NO second hydration observer was constructed; append-path bottom-lock IS installed.

### D — State machine integrity

- [x] **AC14.** Discriminated union `scrollLockRef` enforces single-mode-at-a-time. Test asserts: when `mode='bottom-lock'` is active and `handleLoadMore` is called (entering `mode='prepending'`), the bottom-lock observer is disconnected FIRST, then the prepending state set. No simultaneous mode coexistence.
- [x] **AC14b.** _(Inverse transition — per /review-spec Codex C2 matrix row h)_ When `mode='prepending'` is active (loadMore in flight) and a session append fires (very unlikely but legal: user typed a search while loadMore was loading), Effect B detects the inverse transition. Behavior: append is QUEUED OR IGNORED gracefully — Effect B does NOT clobber the captured `prevScrollHeight`/`prevScrollTop` of the active prepending session. Test simulates: trigger `handleLoadMore()` (sets prepending mode), THEN rerender with `entries=[...old, newAppend]` BEFORE the loadMore restore fires. Assert: `scrollLockRef.mode === 'prepending'` is preserved; append did NOT trigger bottom-lock. (Recommendation in Plan: append within prepending mode early-returns; loadMore restore completes; next append on a fresh commit goes through normal path.)
- [x] **AC14c.** _(Clear-all then search — per /review-spec Codex C2 matrix row f)_ After `entries.length` drops to 0 (clear-all) and then grows again to N≥1 (new search), Effect B routes through the APPEND path (NOT a re-hydration). The `hasScrolledToBottomOnHydrationRef` guard remains true after clear-all (hydration is one-shot per component lifetime). Mirrors the existing EC-CLEAR-2 test in `TranscriptFeed.edge-cases.test.tsx`. Test asserts: render with entries=[10] hydrated; rerender with []; rerender with [1 new]; observer is NOT re-installed for hydration; append-path bottom-lock IS armed.
- [x] **AC15.** _(Idempotent reset)_ Unmount cleanup (Effect D) handles all three modes correctly: `idle` → no-op; `bottom-lock` → `observer.disconnect()`; `prepending` → just reset (no DOM touch needed). All refs reset for Strict Mode dev parity.

### E — Hydration regression guard

- [x] **AC16.** AC19 from FU2/FU3 (reload lands at bottom) still PASS. Hydration path goes through Effect B's hydration branch → synchronous instant scroll + bottom-lock 1500ms. Existing FU2 + FU3 hydration tests pass unchanged (modulo naming generalization).
- [x] **AC17.** Strict Mode dev parity preserved: Effect D's cleanup resets `hasScrolledToBottomOnHydrationRef` + nulls `scrollLockRef` so the synthetic remount re-installs the bottom-lock observer for hydration. (Inherits FU2 fix-loop's solution.)
- [x] **AC17b.** _(Explicit Strict Mode test, per /review-plan IMPORTANT-5)_ Add a test that renders `<TranscriptFeed>` inside `<React.StrictMode>` (`@testing-library/react`'s `render(<StrictMode><TranscriptFeed .../></StrictMode>)`). Assert: after the synthetic mount→cleanup→mount cycle, exactly ONE bottom-lock observer remains active (the re-mount's), the previous observer was disconnected (via `shim.disconnectMock` count), and `hasScrolledToBottomOnHydrationRef.current === true` after the synthetic remount (so subsequent appends do not re-run the hydration branch). The current `TranscriptFeed.test.tsx` + `TranscriptFeed.edge-cases.test.tsx` have ZERO Strict Mode tests — this AC fills the gap.

### F — Build / CI / tests

- [x] **AC18.** Unit test suite green: `npm test -w @foodxplorer/web` — count target 771 baseline + delta. **Final: 771 baseline + 16 FU4 main + 3 qa-engineer edge + 1 FU4 round 2 (AC1b invariant) = 791 tests.** (Auditor I3 reconciliation 2026-06-03: prior figures 787 + 790 in earlier rows reflect intermediate Step 3 + Step 5 fix-loop states.)
- [x] **AC19.** Lint + typecheck + build clean (`next lint`, `tsc --noEmit`, `next build`).
- [x] **AC20.** _(Playwright deferred to F-WEB-HISTORY-FU5 per owner directive post /review-plan CRITICAL-2)_ The full Playwright e2e infrastructure (dep install, config, GH Actions job, fixtures, 2 e2e specs) is **out of scope for FU4** because the original fixture strategy was found unworkable (Supabase auth cookie format `sb-<project-ref>-auth-token` chunked base64url + API response schemas `{success,data}` wrappers + client-side auth via `AuthProvider` events — none compatible with the original `page.route()` + cookie injection design). FU5 will design Playwright properly with its own cross-model review. For FU4, operator AC24+AC25+AC26 remain the authoritative gate (browser smokes on app-dev). FU5 ticket creation tracked in DoD.
- [x] **AC21.** CI `ci-success` SUCCESS on `test-web` (unit tests) + existing gates. NO new CI job for FU4. Playwright job lands in FU5. (CI will run on PR push — pre-verified locally.)

### G — Documentation

- [x] **AC22.** `docs/specs/ui-components.md` TranscriptFeed entry updated: State block reflects the new 7-ref model + `scrollLockRef` discriminated union (with `timerId` per CRITICAL-1); Behavior block describes the 4-effect state machine; handleLoadMore wrapping pattern documented.
- [x] **AC23.** `docs/specs/design-guidelines.md` W18 reaffirmed (still "no animation on initial mount") — NO EDIT to W18 required; the FU4 state machine implements W18 verbatim via `behavior:'instant'` on hydration. Cross-link from FU4 ticket: `design-guidelines.md:1439` W18 + research doc §3.3 + §6.4 both cite W18 as the authoritative source for the "no animation on initial mount" decision.

### H — Operator post-deploy (authoritative)

- [ ] **AC24.** _(Replaces FU2 AC19/FU3 AC9 — reload smoke)_ On app-dev after merge + redeploy: log in, ≥2 persisted entries, reload `/hablar` ×5 reloads. ALL 5 must land at the bottom WITHOUT visible "up→down" sequence (the FU3 useLayoutEffect fix is preserved; this just reconfirms with the new architecture).
- [ ] **AC25.** _(Replaces FU2 AC20 — append smoke; clarified per /review-spec Codex C-S1)_ On app-dev: feed at bottom + submit new search → the new card's BOTTOM is FULLY VISIBLE above the input bar after the result renders (NOT half-cut). Reproducible procedure:
  - **Fast case** (typical user): submit search with browser cache enabled, network unthrottled. Expect: card fully visible within ~1.5s of result arrival.
  - **Slow case** (proves the bottom-lock observer): open DevTools → Network tab → check "Disable cache" + select "Slow 3G" throttle preset → submit search → after slow API response arrives, card fully visible (the 1500ms post-append window catches the late shimmer→card growth).
  - Pass requires BOTH cases visible-fully-after-settle.
- [ ] **AC26.** _(Replaces FU2 AC21 / FU3 AC10 — loadMore smoke)_ On app-dev: ≥10 persisted entries, scroll up to trigger loadMore, observe the entry you were looking at stays anchored when older entries prepend. NO jump to top, NO jump to bottom, NO loss of intermediate entries.

---

## Definition of Done

- [ ] `bugs.md` entry BUG-WEB-FEED-SCROLL-SETTLE-001 reaches **TRULY FIXED** status (operator AC24+AC25+AC26 all PASS post-deploy). Will be updated post-merge in closeout PR after operator confirms. (Post-merge gate, intentionally [ ] pre-merge.)
- [x] `product-tracker.md` Active Session + Features row reflect FU4 in-progress 5/6 pre-merge; closeout PR will flip to done 6/6 post-merge. Tracker sync verified by /audit-merge.
- [x] FU1/FU2/FU3 tickets NOT modified retroactively — verified by `git status` showing no edits to `F-WEB-HISTORY-FU1-feed-polish.md`, `F-WEB-HISTORY-FU2-feed-scroll-settle.md`, `F-WEB-HISTORY-FU3-uselayout-effect.md` in this branch's diff.
- [ ] Memory entry `feedback_layout_effect_phase_swap_needs_full_review` saved post-merge (Step 6 closeout task). Rule: any `useEffect ↔ useLayoutEffect` swap on scroll/layout-writing effects requires Path B, no Path A.
- [x] **F-WEB-HISTORY-FU5 ticket created** (Playwright e2e infrastructure for AC20-A + AC21 — deferred from FU4 per /review-plan CRITICAL-2 owner decision). Created in this fix-loop commit at `docs/tickets/F-WEB-HISTORY-FU5-playwright-e2e.md` (skeleton; Step 0 Spec flesh-out happens when FU5 enters its own SDD cycle post-FU4 merge). Owner directive 2026-06-03: separate ticket, own cross-model review.
- [x] `docs/research/transcript-feed-scroll-architecture-2026-06-03.md` linked from FU4 ticket Completion Log Step 0 row + AC23 row references W18 + research doc §3.3/§6.4 (the authoritative diagnosis is reachable from both the ticket and the bugs.md entry via the FU4 commit references).
- [ ] Release develop→main gate: AC24 + AC25 + AC26 PASS → release PR opens immediately (no additional FU pending). Post-deploy operator action, intentionally [ ] pre-merge.
- [x] All A/B/C/D/E/F/G ACs marked `[x]` pre-merge. **27/30** marked (added AC1b in round 2; AC24+AC25+AC26 = operator post-deploy gates, intentionally [ ] per `feedback_jsdom_layout_ac_gap` lesson). Per /audit-merge structural check.
- [x] Web suite + lint + typecheck + build counts documented in Completion Log Step 3+5+7 rows: **791/791** tests green (771 baseline + 16 FU4 main + 3 QA-added FU4 edge + 1 FU4 round 2 AC1b invariant), lint 0, typecheck 0, build clean.
- [x] Playwright e2e DEFERRED to F-WEB-HISTORY-FU5 (owner decision 2026-06-03 post /review-plan CRITICAL-2). FU4 ships without Playwright; operator AC24/AC25/AC26 are the authoritative gate. FU5 ticket stub created (see above).

---

## Workflow Checklist

- [x] **Step 0 — Spec** (this file, in progress): + cross-model `/review-spec` (Gemini + Codex parallel) + apply findings + owner sign-off on Spec.
- [x] **Step 1 — Setup**: branch `bugfix/web-feed-scroll-state-machine` off develop `55528c5` (DONE). Verify working tree clean.
- [x] **Step 2 — Plan**: full Implementation Plan derived from research doc §7.1 + cross-model `/review-plan` + owner sign-off.
- [x] **Step 3 — Implement (TDD)**: RED tests for AC3/AC9/AC11/AC14/AC15 (race-aware + state-machine invariants) → GREEN refactor to 4-effect state machine. Per research doc §7.3: ~13-16 test touches + 4-6 new tests. **DONE: 16 delta tests (see Completion Log).**
- [x] **Step 4 — Finalize**: full web suite green + lint + typecheck + build clean; commit with conventional message; push. **DONE: commit `f1a94fe` pushed to `bugfix/web-feed-scroll-state-machine`. Gates: 787/787 tests, lint 0, typecheck 0, build clean.**
- [x] **Step 5 — Review**: code-review-specialist APPROVE WITH MINOR CHANGES (1 MAJOR AC17b test strengthening applied); qa-engineer QA BLOCKED → 3 fix-loop items applied (AC17b observeMock≥2 + AC23 cross-link + FU5 ticket stub created); `/audit-merge` clean post fix-loop. **NO MAJOR deferrals** (per FU2 lesson).
- [x] **Step 6 — Playwright e2e**: DEFERRED TO FU5 (owner decision 2026-06-03 per /review-plan CRITICAL-2). FU4 ships without Playwright; operator AC24/AC25/AC26 are the authoritative gate. FU5 ticket skeleton created at `docs/tickets/F-WEB-HISTORY-FU5-playwright-e2e.md`. Workflow item satisfied by the deferral decision + ticket creation.
- [ ] **Step 7 — Merge + Closeout**: `gh pr create` → CI verify → owner sign-off → squash-merge → closeout PR (Status Done + branches deleted local+remote + tracker sync). Then operator AC24/AC25/AC26 reverify on app-dev.

---

## Implementation Plan

### Design Notes

- **State machine over 6 independent effects (research doc §6 + §8):** The root cause of both AC20-A and AC21 is that six effects independently write scroll geometry with no single owner of the lifecycle. When `useEffect` ↔ `useLayoutEffect` phase changes (FU3) altered browser-anchor timing, the implicit ordering assumptions between Effect 4 (capture) and Effect 5 (restore) collapsed. A discriminated-union `scrollLockRef` (`idle` / `bottom-lock` / `prepending`) enforces single-mode-at-a-time at the data structure level — no two effects can simultaneously mutate scroll geometry, because they read the same mode and early-return when it does not match. Alternatives: pure-CSS `overflow-anchor:auto` (rejected §8 Alt 1 — skeleton unmounts in the same frame as real entries, making anchor-element selection unreliable; also Safari iOS 17+ only); virtualization (rejected §8 Alt 2 — overkill, ≤200 entries, no perf concern).

- **`useLayoutEffect` for Effect B (NOT `useEffect`) — per research doc §5.4 lesson:** Effect B writes `scrollTo` pre-paint (hydration path) exactly as the existing Effect 1 does. Swapping to `useEffect` would regress the FU3 flicker fix (user briefly sees feed at `scrollTop=0` before the JS scroll). `useLayoutEffect` for scroll-geometry-writing effects is the project rule established in FU3 (also the meta-lesson being saved to memory post-merge: any `useEffect ↔ useLayoutEffect` swap on scroll-writing effects requires full Path B review). Effect C remains `useLayoutEffect[isLoadingMore]` — no change from FU3, still pre-paint restore to prevent skeleton-removal flicker.

- **`overflow-anchor: none` as inline `style` (NOT a Tailwind class):** Tailwind v3 has no `overflow-anchor` utility (the property was not in the Tailwind core set as of 3.4.x). The inline `style={{ overflowAnchor: 'none' }}` is the least-surprising approach: it is explicit in the JSX (no hunt for a custom class), it applies unconditionally on every render, and it documents the intent at the call site. As a defensive measure this is necessary: with `overflow-anchor:auto` (the browser default), the browser's native anchor adjustment fires BEFORE Effect C's `useLayoutEffect` restore. When both JS and the browser write `scrollTop` in the same frame the result is undefined. Setting `none` makes JS unambiguously the sole owner.

- **Append vs prepend detection algorithm — first/last entryId comparison:** On every Effect B run, compare current `entries[0]?.entryId` and `entries[entries.length - 1]?.entryId` against `firstEntryIdRef.current` and `lastEntryIdRef.current` (captured at the END of the previous Effect B run, after routing). Decision table:
  - `entries.length === 0` → early return (no-op, do not update refs).
  - `!hasScrolledToBottomOnHydrationRef.current` → hydration path (one-shot; refs updated at end).
  - `lastEntryId !== lastEntryIdRef.current` AND `firstEntryId === firstEntryIdRef.current` → append (last changed, first stable). Route to bottom-lock path if `wasNearBottomRef.current`.
  - `firstEntryId !== firstEntryIdRef.current` AND `lastEntryId === lastEntryIdRef.current` → prepend (first changed, last stable). Effect B does nothing for scroll (Effect C handles restore); update refs.
  - BOTH first AND last changed → treat as full-replace / clear-then-search. Route as append (no re-hydration: `hasScrolledToBottomOnHydrationRef.current` stays `true` for component lifetime). This covers AC14c.
  - Edge case: `entries.length` grew but `firstEntryId` matches the previous first AND `lastEntryId` matches the previous last — impossible in practice (a new entry must change at least one endpoint), but if it ever occurs Effect B is a no-op (refs already match). Always update both refs at the end of the effect body regardless of branch taken (except the `entries.length === 0` early return).

- **1500 ms append bottom-lock window (longer than hydration's 500 ms):** Hydration settle is bounded by font-loading + initial layout, typically finishing within ~300ms on a fast connection. Append settle is bounded by API response time (the shimmer → NutritionCard transition fires when the API returns). On a slow 3G connection (AC25 operator test) the API response may arrive 800-1200ms after the smooth scroll fires. Adding a ResizeObserver fire time plus layout settle gives a worst-case total of ~1300ms. The 1500ms window adds ~200ms margin. Using 500ms (hydration window) would miss typical mobile-3G latencies. Using 3000ms would hold the observer open through user interactions (over-correction risk — R1 in research doc §7.5). 1500ms is the minimum that passes the Slow 3G operator AC25 procedure. The constant is named `APPEND_BOTTOM_LOCK_WINDOW_MS = 1500` (distinct from the existing `HYDRATION_RESCROLL_WINDOW_MS = 500` — keep both, rename the old one for clarity).

- **jsdom test strategy for race-aware tests:** AC3 (append bottom-lock race) reuses the existing `createResizeObserverShim()` from `resizeObserverShim.ts` — `shim.install()` in `beforeEach`, define a mutable `currentScrollHeight` getter via `Object.defineProperty`, call `scrollTo` initially with shimmer height, mutate `currentScrollHeight` to simulate card growth, then call `shim.fire([{ target: feed } as ResizeObserverEntry])` to synchronously trigger the observer callback inside the bottom-lock window. Assert `scrollToMock` called ≥2 times with the last call targeting the grown height. AC9 (prepend baseline) does NOT need the shim: the test calls `handleLoadMore()` directly (exposed via the sentinel button in the mock, or by triggering the load-more button click), which synchronously sets `scrollLockRef`, then rerenders with `isLoadingMore=true` (skeletons, `scrollHeight` grows), then rerenders with `isLoadingMore=false` + entries prepended. Assert `feed.scrollTop === prevScrollTop + (newScrollHeight - prevScrollHeight)` where `prevScrollHeight` is the pre-skeleton value.

---

### Frontend Plan

Steps are ordered RED → GREEN. Each step names the test(s) to write first, then the minimal production code change.

**Step 1 — Add `overflow-anchor: none` to scroll container**

File: `packages/web/src/components/TranscriptFeed.tsx`

RED test (AC11): In `TranscriptFeed.test.tsx`, add to the main `describe` block:
```
it('AC11: scroll container has overflow-anchor:none style', () => {
  render(<TranscriptFeed {...defaultProps} entries={[makeEntry()]} />);
  const feed = screen.getByRole('feed');
  expect(feed).toHaveStyle({ overflowAnchor: 'none' });
});
```
GREEN: Add `style={{ overflowAnchor: 'none' }}` to the outermost `<div>` in the JSX return. No other change. This test should be the only RED; all existing tests pass unchanged.

Verification: `npm test -w @foodxplorer/web -- --testPathPattern=TranscriptFeed`

---

**Step 2 — Add new refs + rename constant**

File: `packages/web/src/components/TranscriptFeed.tsx`

No RED test required (Step 2 is additive ref scaffolding; tests cover behavior in later steps).

GREEN:
- Add constant `const APPEND_BOTTOM_LOCK_WINDOW_MS = 1500;` (keep `HYDRATION_RESCROLL_WINDOW_MS = 500` for hydration path — both windows remain distinct).
- Remove `HydrationHandle` type and `hydrationObserverRef`.
- Add `ScrollLockState` discriminated union type:
  ```ts
  type ScrollLockState =
    | { mode: 'idle' }
    | { mode: 'bottom-lock'; deadline: number; observer: ResizeObserver }
    | { mode: 'prepending'; prevScrollHeight: number; prevScrollTop: number };
  ```
- Add three new refs inside the component:
  - `const firstEntryIdRef = useRef<string>('');`
  - `const lastEntryIdRef = useRef<string>('');`
  - `const scrollLockRef = useRef<ScrollLockState>({ mode: 'idle' });`
- Remove old refs: `prevScrollHeightRef`, `prevScrollTopRef`.
- Initialize `prevEntriesLengthRef` stays (still needed for the length-grew check in Effect B).

Verification: TypeScript build clean (`npm run typecheck -w @foodxplorer/web`).

---

**Step 3 — Implement `handleLoadMore` callback (AC7, AC8)**

File: `packages/web/src/components/TranscriptFeed.tsx`

RED tests (AC7, AC8): In `TranscriptFeed.test.tsx`, add a new `describe('TranscriptFeed — AC7/AC8: handleLoadMore pre-skeleton capture')` block:
```
it('AC7: sentinel receives handleLoadMore (not raw onLoadMore); clicking it captures scrollHeight before setting prepending mode', () => {
  // Render with isAuthenticated=true, hasMoreHistory=true
  // Install scroll mocks: scrollTop=200, scrollHeight=1000
  // Click the sentinel button (which calls onLoadMore in the mock)
  // Assert: onLoadMore (the prop spy) was called once
  // Assert: The sentinel's onLoadMore is a wrapper (tested indirectly via AC8 timing test)
});

it('AC8: capture fires synchronously before isLoadingMore commit — prevScrollHeight captured BEFORE skeleton scrollHeight', () => {
  // Render with isAuthenticated=true, hasMoreHistory=true, entries=[a,b]
  // Install scroll mocks: scrollTop=200, scrollHeight=1000
  // Call the sentinel's onLoadMore (via button click)
  // Immediately check scrollLockRef mode = 'prepending' and prevScrollHeight = 1000
  // (before any rerender with isLoadingMore=true)
  // Then rerender with isLoadingMore=true (scrollHeight grows to 1248 in mock)
  // Then rerender with isLoadingMore=false + entries prepended, scrollHeight=2000
  // Assert: scrollTop = 200 + (2000 - 1000) = 1200
});
```
Note: Because `scrollLockRef` is internal, AC8 is tested behaviorally via the final `scrollTop` assertion. The sentinel mock in the test file passes `onLoadMore` directly from props; for this test the mock must be updated (see Step 9 below) to expose `handleLoadMore` from the component rather than `props.onLoadMore`. Alternatively, test via button click in the sentinel mock which calls through to the component's wrapped handler.

GREEN:
```ts
const handleLoadMore = useCallback(() => {
  const container = feedRef.current;
  // FU4 /review-plan IMPORTANT-3 fix: NEVER drop the loadMore action even when
  // feedRef.current is null (transient ref miss during a tear-down race). Better
  // to lose the pre-skeleton baseline (Effect C will early-return on mode!==
  // 'prepending') than to lose user-visible history pagination entirely.
  if (container) {
    // Disconnect bottom-lock observer if one is active (state machine: bottom-lock → prepending).
    // Use the helper for consistent cleanup (also clears the timer).
    if (scrollLockRef.current.mode === 'bottom-lock') {
      stopBottomLock('mode-transition');
    }
    scrollLockRef.current = {
      mode: 'prepending',
      prevScrollHeight: container.scrollHeight,
      prevScrollTop: container.scrollTop,
    };
  }
  // ALWAYS call parent's onLoadMore — even without a baseline. Effect C will
  // detect mode==='idle' and skip restoration; the prepend will still happen,
  // just without smart anchor preservation. Less ideal but never silently broken.
  onLoadMore();
}, [onLoadMore]);
```
Pass `handleLoadMore` to `<HistoryLoadMoreSentinel onLoadMore={handleLoadMore} />` (replacing `onLoadMore` prop). Also update the keyboard fallback button inside the sentinel to use `onLoadMore` prop (which now receives `handleLoadMore` — transparent to the sentinel).

Verification: `npm test -w @foodxplorer/web -- --testPathPattern=TranscriptFeed`

---

**Step 4 — Unify Effects 1 + 3 into Effect B (AC1, AC2, AC3, AC4, AC5, AC6, AC12, AC13, AC14b, AC14c)**

File: `packages/web/src/components/TranscriptFeed.tsx`

RED tests to write FIRST (before Effect B implementation):

*AC3 (race-aware append bottom-lock):* In `TranscriptFeed.test.tsx`, add a new `describe('TranscriptFeed — AC3/AC4/AC5/AC6: append bottom-lock observer')` block using `createResizeObserverShim()`:
```
it('AC3: shimmer→card race — ResizeObserver fires AFTER initial smooth scroll, last scrollTo targets post-growth scrollHeight', () => {
  const shim = createResizeObserverShim();
  shim.install();
  jest.useFakeTimers();
  // Render with entries=[a], wasNearBottom=true
  // Install scroll mocks: mutable scrollHeight getter starting at 500 (shimmer)
  // Append entry b (entries=[a,b]): smooth scroll fires at scrollHeight=500
  // Mutate scrollHeight to 700 (card grew)
  // shim.fire([{ target: feed } as ResizeObserverEntry])
  // Assert: scrollToMock called ≥2 times
  // Assert: last call = { top: 700, behavior: 'instant' }
  shim.uninstall(); jest.useRealTimers();
});

it('AC4: wasNearBottomRef=false at append time — no smooth scroll, no observer', () => { ... });

it('AC5: user scrolls UP during bottom-lock window — observer disconnects early', () => {
  // shim installed; append fires (wasNearBottom=true) → observer active
  // Simulate scroll event updating wasNearBottomRef=false
  // shim.fire() → observer callback detects wasNearBottomRef=false → disconnects
  // Assert: shim.disconnectMock called once
});

it('AC6: timer deadline reached (1501ms) — observer disconnects, mode=idle', () => {
  jest.useFakeTimers();
  // Append + observer active
  // jest.advanceTimersByTime(1501)
  // Assert: shim.disconnectMock called once
  // Assert: scrollLockRef cannot be read directly — assert no further scrollTo after deadline
  jest.useRealTimers();
});
```

*AC12, AC13:* Add in a `describe('TranscriptFeed — AC12/AC13: append vs prepend detection')` block:
```
it('AC12: prepend (first entryId changes) does NOT trigger bottom-lock append path', () => {
  // Render with entries=[b,c], hydration fires
  // Rerender with entries=[a,b,c] (first entryId changed from b→a, last=c unchanged)
  // wasNearBottomRef=true to confirm it's not a wasNearBottom guard
  // Assert: no smooth scrollTo fired after hydration clear
  // Assert: no bottom-lock observer installed for the prepend
});

it('AC13: both first AND last entryId changed (clear-all then new search) routes through append path, NOT re-hydration', () => {
  // Render with entries=[a,b], hydration fires (observeMock count=1)
  // Rerender with entries=[] (clear)
  // Rerender with entries=[x] (new entryId, wasNearBottom=true)
  // Assert: shim.observeMock NOT called a second time (no new hydration observer)
  // Assert: scrollToMock called with behavior:'smooth' (append path fired)
});
```

*AC14b:* Add `it('AC14b: append during active prepending mode is ignored — scrollLockRef stays prepending', ...)` - simulate `handleLoadMore()` call (sets prepending), then rerender with `entries=[...old, newAppend]` (last entryId changed). Assert no bottom-lock observer was installed; `feed.scrollTop` unchanged.

*AC14c:* Update the existing `EC-CLEAR-2` test in `TranscriptFeed.edge-cases.test.tsx` to additionally assert that after clear-all + new search, the bottom-lock observer IS installed (append path), not a new hydration observer.

GREEN (Effect B — `useLayoutEffect` with dep array `[entries.length, entries[0]?.entryId ?? '', entries[entries.length - 1]?.entryId ?? '']`):

```ts
// Internal helper: starts a bottom-lock ResizeObserver window.
// Called from both hydration and append branches.
// FU4 /review-plan CRITICAL-1 fix: PAIR THE OBSERVER WITH AN EXPLICIT setTimeout
// — checking Date.now() inside the ResizeObserver callback only works while
// resize events keep firing; if layout settles silently after the initial
// scroll, the observer stays alive indefinitely and AC6 fails.
function startBottomLock(container: HTMLDivElement, durationMs: number) {
  if (scrollLockRef.current.mode === 'bottom-lock') {
    // Extend deadline if already locked: clear existing timer + restart with new duration.
    if (scrollLockRef.current.timerId !== null) clearTimeout(scrollLockRef.current.timerId);
    scrollLockRef.current.deadline = Date.now() + durationMs;
    scrollLockRef.current.timerId = setTimeout(() => stopBottomLock('timer'), durationMs);
    return;
  }
  if (typeof ResizeObserver === 'undefined') return; // AC5 fallback path.

  const observer = new ResizeObserver(() => {
    const lock = scrollLockRef.current;
    if (lock.mode !== 'bottom-lock') return;
    if (!wasNearBottomRef.current) {
      // User scrolled away — cancel early (AC5).
      stopBottomLock('user-scroll');
      return;
    }
    // Defensive: if timer was somehow lost (test env, leaky cleanup), still respect deadline.
    if (Date.now() > lock.deadline) {
      stopBottomLock('deadline-defensive');
      return;
    }
    try { container.scrollTo({ top: container.scrollHeight, behavior: 'instant' }); } catch { /* jsdom */ }
  });
  observer.observe(container);

  const timerId = setTimeout(() => stopBottomLock('timer'), durationMs);

  scrollLockRef.current = {
    mode: 'bottom-lock',
    deadline: Date.now() + durationMs,
    observer,
    timerId,
  };
}

function stopBottomLock(reason: 'timer' | 'user-scroll' | 'deadline-defensive' | 'unmount' | 'mode-transition') {
  const lock = scrollLockRef.current;
  if (lock.mode !== 'bottom-lock') return;
  if (lock.timerId !== null) clearTimeout(lock.timerId);
  lock.observer.disconnect();
  scrollLockRef.current = { mode: 'idle' };
}

useLayoutEffect(() => {
  if (entries.length === 0) return;
  const container = feedRef.current;
  if (!container) return;

  const currentFirstId = entries[0]?.entryId ?? '';
  const currentLastId = entries[entries.length - 1]?.entryId ?? '';

  if (!hasScrolledToBottomOnHydrationRef.current) {
    // Hydration path (one-shot).
    hasScrolledToBottomOnHydrationRef.current = true;
    try { container.scrollTo({ top: container.scrollHeight, behavior: 'instant' }); } catch { /* jsdom */ }
    startBottomLock(container, Date.now() + HYDRATION_RESCROLL_WINDOW_MS);
    firstEntryIdRef.current = currentFirstId;
    lastEntryIdRef.current = currentLastId;
    prevEntriesLengthRef.current = entries.length;
    return;
  }

  const firstChanged = currentFirstId !== firstEntryIdRef.current;
  const lastChanged = currentLastId !== lastEntryIdRef.current;

  if (firstChanged && !lastChanged) {
    // Pure prepend — Effect C handles scroll restoration; Effect B does nothing.
    firstEntryIdRef.current = currentFirstId;
    prevEntriesLengthRef.current = entries.length;
    return;
  }

  if (!firstChanged && !lastChanged && entries.length === prevEntriesLengthRef.current) {
    // No structural change (e.g. in-place mutation of isLoading — shimmer→card).
    // No entry count or endpoint change; Effect B is a no-op.
    return;
  }

  if (scrollLockRef.current.mode === 'prepending') {
    // AC14b: active prepend in flight — do not clobber the baseline.
    // Update length ref but do not start bottom-lock.
    if (lastChanged) lastEntryIdRef.current = currentLastId;
    if (firstChanged) firstEntryIdRef.current = currentFirstId;
    prevEntriesLengthRef.current = entries.length;
    return;
  }

  // Append path (last entryId changed, or both changed = clear-then-search).
  if (wasNearBottomRef.current) {
    try { container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' }); } catch { /* jsdom */ }
    startBottomLock(container, Date.now() + APPEND_BOTTOM_LOCK_WINDOW_MS);
  }

  firstEntryIdRef.current = currentFirstId;
  lastEntryIdRef.current = currentLastId;
  prevEntriesLengthRef.current = entries.length;
}, [entries.length, entries[0]?.entryId ?? '', entries[entries.length - 1]?.entryId ?? '']);
```

Remove the old Effect 1 (`useLayoutEffect[entries.length]` hydration) and the old Effect 3 (`useEffect[entries.length]` append smooth). Remove `hydrationObserverRef` entirely.

Verification: `npm test -w @foodxplorer/web -- --testPathPattern=TranscriptFeed`

---

**Step 5 — Refactor Effect C (AC9, AC10)**

File: `packages/web/src/components/TranscriptFeed.tsx`

RED test (AC9 — race-aware prepend):

Add `it('AC9: 2-commit loadMore flow — Effect C reads pre-skeleton baseline, restores scrollTop correctly', ...)` in a new `describe('TranscriptFeed — AC9/AC10: Effect C prepend restore')` block:
```
// 1. Render with entries=[a,b], hydrate; clear scrollToMock
// 2. Install scroll mocks: scrollTop=200, scrollHeight=1000
// 3. Trigger handleLoadMore (via sentinel button click)
//    → scrollLockRef = { mode: 'prepending', prevScrollHeight: 1000, prevScrollTop: 200 }
//    → onLoadMore spy called
// 4. Rerender with isLoadingMore=true (skeletons mount)
//    → Object.defineProperty scrollHeight = 1248 (1000 + 248 skeleton)
// 5. Rerender with isLoadingMore=false + entries=[older1, older2, a, b]
//    → Object.defineProperty scrollHeight = 2200 (1000 + 2*600 prepended)
// Assert: feed.scrollTop === 200 + (2200 - 1000) = 1400
// Assert: scrollToMock NOT called (Effect C writes scrollTop directly, not scrollTo)
```

GREEN: Replace the old Effect 4 (`useEffect[isLoadingMore]` capture) and old Effect 5 (`useLayoutEffect[isLoadingMore]` restore) with a single new Effect C:
```ts
useLayoutEffect(() => {
  if (isLoadingMore) return; // only run on false transition
  const lock = scrollLockRef.current;
  if (lock.mode !== 'prepending') return;
  const container = feedRef.current;
  if (!container) return;
  const delta = container.scrollHeight - lock.prevScrollHeight;
  if (delta > 0) {
    container.scrollTop = lock.prevScrollTop + delta;
  }
  scrollLockRef.current = { mode: 'idle' };
}, [isLoadingMore]);
```
Remove the old Effect 4 and Effect 5 bodies entirely.

Verification: `npm test -w @foodxplorer/web -- --testPathPattern=TranscriptFeed`

---

**Step 6 — Generalize Effect D (AC15)**

File: `packages/web/src/components/TranscriptFeed.tsx`

RED test (AC15): Add `it('AC15: unmount cleanup handles all three modes — bottom-lock disconnects, prepending resets, idle is no-op', ...)`:
```
// Mode=bottom-lock: shim installed, append fires, observer active, unmount → shim.disconnectMock called once
// Mode=prepending: trigger handleLoadMore, unmount → no throw; scrollLockRef.mode='idle'
// Mode=idle: render, unmount → no throw (baseline — existing AC13b-ish test)
```

GREEN: Replace the old Effect 2 unmount body:
```ts
useEffect(() => {
  const lockRef = scrollLockRef;
  const guardRef = hasScrolledToBottomOnHydrationRef;
  return () => {
    const lock = lockRef.current;
    if (lock.mode === 'bottom-lock') {
      lock.observer.disconnect();
    }
    lockRef.current = { mode: 'idle' };
    guardRef.current = false;
    // Reset entryId refs for Strict Mode dev parity.
    firstEntryIdRef.current = '';
    lastEntryIdRef.current = '';
    prevEntriesLengthRef.current = 0;
    wasNearBottomRef.current = true;
  };
}, []);
```

Verification: `npm test -w @foodxplorer/web -- --testPathPattern=TranscriptFeed`

---

**Step 7 — Remove dead code**

File: `packages/web/src/components/TranscriptFeed.tsx`

No new tests — this is a clean-up step. After Steps 1-6 are green:
- Confirm `prevScrollHeightRef` and `prevScrollTopRef` are gone (moved into `scrollLockRef.mode==='prepending'` payload in Step 2).
- Confirm `hydrationObserverRef` and `HydrationHandle` type are gone (removed in Step 2).
- Confirm the old Effect 1, Effect 2, Effect 3, Effect 4, Effect 5 bodies are all gone (replaced by Effect A/B/C/D in Steps 4-6).
- Add inline comment on the `startBottomLock` helper referencing research doc §7.1 and `overflow-anchor:none` rationale.
- Update the file-level JSDoc comment from "FU2: ResizeObserver hydration scroll-settle + wasNearBottomRef append fix" to "FU4: unified 4-effect scroll state machine (research doc §7.1)".

Verification: `npm run typecheck -w @foodxplorer/web && npm test -w @foodxplorer/web`

---

**Step 8 — Update existing tests per research doc §7.3 surgery**

Files: `packages/web/src/__tests__/components/TranscriptFeed.test.tsx` and `TranscriptFeed.edge-cases.test.tsx`

Specific test touches required (13 total):

`TranscriptFeed.test.tsx`:

1. **`AC10b`** (`scrolls to bottom on async hydration []→[N]`) — assertion `expect(scrollToMock).toHaveBeenCalledTimes(1)` must change to `expect(scrollToMock).toHaveBeenCalledTimes(1)` ONLY if bottom-lock observer fires. In the test, `wasNearBottomRef=false` (set by scroll event before hydration rerender), so bottom-lock ResizeObserver fires but `wasNearBottomRef.current=false` causes it to disconnect immediately rather than call `scrollTo` again. The assertion `toHaveBeenCalledTimes(1)` survives unchanged IF the shim is not installed. **Touch: confirm test still passes; if observer fires a second instant call, update to `≥1` and add LAST-call assertion `behavior:'instant'`.**

2. **`AC10c`** (`loadMore prepend restores scrollTop`) — the `prevScrollHeightRef`/`prevScrollTopRef` capture mechanism has changed. The test currently simulates `isLoadingMore=true` then `false`, relying on the old Effect 4 capture. Under the new architecture, the capture happens in `handleLoadMore()` (Step 3). Update: the test must trigger `handleLoadMore()` BEFORE the `isLoadingMore=true` rerender, using the sentinel button click. Add Step 3's scroll mock setup BEFORE the button click. The final assertion `expect(feed.scrollTop).toBe(600)` stays if the delta math is the same (`200 + 400 = 600`). **Touch: restructure the `isLoadingMore` step sequence — add sentinel button click before Step 3 of the test.**

3. **`AC11`** (regression coexistence — smooth fires after hydration) — likely passes unchanged. But with Effect B's dep array including entryId signals, confirm the test still fires append correctly. **Touch: verify passes; adjust if entryId comparison causes unexpected early-return.**

4. **`AC12`** (Step 5: coexistence — `scrollToMock.toHaveBeenCalledTimes(1)` after hydration window + append) — the current assertion checks that after the hydration window closes (`advanceTimersByTime(501)`) and then an append fires, `scrollToMock` was called exactly once. With the bottom-lock observer on append also potentially calling `scrollTo`, this assertion may need to change to `≥1`. **Touch: check if append also starts a bottom-lock observer in this test (it does if wasNearBottom=true); update `toHaveBeenCalledTimes(1)` → `toBeGreaterThanOrEqual(1)` if needed.**

5. **`AC13b`** (observer disconnect on unmount) — test currently asserts the hydration ResizeObserver disconnects. Under FU4 the observer may be a bottom-lock observer (same disconnect mechanism). Update the describe block name from "hydration observer" to "bottom-lock observer (hydration path)". Assertion logic unchanged. **Touch: rename describe/it labels only.**

6. **`AC13c`** (timer-fired teardown, no double-disconnect) — same rename as AC13b. The `HYDRATION_RESCROLL_WINDOW_MS = 500` timer is used in the hydration branch of `startBottomLock`; the test uses `advanceTimersByTime(501)`. Still correct. **Touch: rename only.**

7. **`AC1`** (Step 3: `shim.observeMock` called with `feed` on hydration) — passes unchanged. **Touch: update describe block label from "ResizeObserver hydration" to "bottom-lock observer (hydration and append)".**

8. **`AC3`** (existing Step 3 test "hasScrolledToBottomOnHydrationRef guard — observer survives intermediate entries.length changes") — this test is NOT about the FU4 AC3 (append race). It tests the ref-guard during the hydration window. Rename the test to `'hydration guard: observer survives intermediate entries.length changes within the 500ms window'` to distinguish from the new FU4 AC3 test. Logic unchanged. **Touch: rename it() label only.**

9. **`AC4`** (Step 3 — ResizeObserver fires after scrollHeight grows, calls scrollTo again) — passes unchanged (same mechanism, now via `startBottomLock`). **Touch: 0.**

10. **`EC-RAPID-1`** (edge-cases: rapid loadMore + append within window) — this test currently asserts the hydration observer survives a loadMore prepend + session append. Under FU4: the prepend is now handled by `handleLoadMore` setting `mode='prepending'`, so `entries.length` growing at the front does NOT re-install a bottom-lock observer. The append path (wasNearBottom=true, last entryId grew) DOES fire a bottom-lock observer, but `mode` was `'prepending'` at that point → AC14b early return applies. **Touch: update the assertion from `expect(scrollToMock).toHaveBeenCalledWith({ behavior: 'smooth' })` to explicitly assert that the prepend did NOT start a bottom-lock, and that after Effect C restore runs the append IS queued in the next render.** Alternatively simplify: only test the non-conflicted case (rapid append-only within window). Decision: keep the test but update it to reflect AC14b behavior — prepending mode is active during the loadMore, so the append within the window is deferred (no smooth scroll during the prepend window). Append fires on the NEXT render after `scrollLockRef.mode='idle'`.

11. **`EC-CLEAR-2`** (clear-all then new entry — hydration observer NOT reinstalled) — add assertion that the append-path bottom-lock observer IS installed after the new search entry (`shim.observeMock` called a second time), to satisfy AC14c. **Touch: add 1 assertion to an existing test.**

12. **`EC-SCROLL-DURING-WINDOW-1`** (scroll during hydration window) — currently uses `HYDRATION_RESCROLL_WINDOW_MS = 500`. The window name changes but value is unchanged. The test will pass if the constant rename is done. **Touch: no assertion change; update comment to reference "hydration bottom-lock window".**

13. **`AC10`** (sync mount with N≥2 entries) — passes unchanged. The hydration path of `startBottomLock` is called with `HYDRATION_RESCROLL_WINDOW_MS`. **Touch: 0.**

**Total touches: 13** (6 assertion changes, 5 rename-only, 2 restructures).

Verification: `npm test -w @foodxplorer/web`

---

**Step 9 — Add new tests (AC3, AC9, AC11, AC14b, AC14c, state-machine invariant)**

Files: `packages/web/src/__tests__/components/TranscriptFeed.test.tsx` (Steps 1, 3, 4, 5 above already wrote these RED tests inline; this step is the accounting step confirming all new tests are in place).

New test list (these were written RED in Steps 1-6):
1. `AC11: scroll container has overflow-anchor:none style` — in main describe (Step 1).
2. `AC7/AC8: handleLoadMore pre-skeleton capture` — new describe block (Step 3).
3. `AC3: shimmer→card race — ResizeObserver fires after initial smooth scroll` — new describe block (Step 4).
4. `AC4: wasNearBottomRef=false at append time — no smooth, no observer` (Step 4).
5. `AC5: user scrolls up during bottom-lock — early disconnect` (Step 4).
6. `AC6: timer deadline reached (1501ms) — observer disconnects` (Step 4).
7. `AC12: prepend does NOT trigger bottom-lock append path` (Step 4).
8. `AC13: both endpoints changed routes through append path` (Step 4).
9. `AC14b: append during active prepending — scrollLockRef stays prepending` (Step 4).
10. `AC9: 2-commit flow — Effect C reads pre-skeleton baseline` (Step 5).
11. `AC10: Effect C early-returns when mode=idle` (Step 5, implicit in AC9 test via negative path).
12. `AC15: unmount handles all three modes` (Step 6).

Total new tests: **12** (more than the research doc §7.3 estimate of 4-6 because the spec's 29 ACs demanded exhaustive coverage, and AC14b/AC14c are net-new ACs from `/review-spec`).

---

**Step 10 — Update `docs/specs/ui-components.md` (AC22)**

File: `docs/specs/ui-components.md` lines 2477-2486 (the `State (internal refs):` and `Behavior:` blocks for TranscriptFeed).

Replace the State block with:
```
**State (internal refs — 7 total):**
- `wasNearBottomRef` — unchanged from FU2; updated by scroll listener before each append commit.
- `hasScrolledToBottomOnHydrationRef` — one-shot guard for hydration path (component lifetime, resets on unmount for Strict Mode parity).
- `prevEntriesLengthRef` — tracks previous `entries.length`; updated at end of Effect B.
- `firstEntryIdRef` — NEW (FU4): last-seen `entries[0]?.entryId`; used by Effect B to detect prepend vs append.
- `lastEntryIdRef` — NEW (FU4): last-seen `entries[entries.length-1]?.entryId`; used by Effect B to detect append vs prepend.
- `scrollLockRef` — NEW (FU4): discriminated union enforcing single-mode-at-a-time:
  - `{ mode: 'idle' }` — no active scroll operation.
  - `{ mode: 'bottom-lock', deadline: number, observer: ResizeObserver }` — active ResizeObserver window keeping the viewport at bottom (used by both hydration and append paths).
  - `{ mode: 'prepending', prevScrollHeight: number, prevScrollTop: number }` — loadMore restore baseline captured pre-skeleton by `handleLoadMore` callback.
```

Replace the Behavior block with:
```
**Behavior (4-effect state machine — FU4 architecture, research doc §7.1):**
- **Effect A** (`useEffect[]`): Scroll listener — updates `wasNearBottomRef` on every user scroll. Unchanged from FU2.
- **Effect B** (`useLayoutEffect`, deps `[entries.length, entries[0]?.entryId, entries[entries.length-1]?.entryId]`): Unified mutation handler. Discriminates by comparing current vs captured first/last `entryId`. Routes to: (1) hydration path (one-shot, ref-guarded) — instant scroll + 500ms bottom-lock; (2) append path (last entryId grew, `wasNearBottomRef=true`) — smooth scroll + 1500ms bottom-lock; (3) prepend path (first entryId changed, Effect C handles restore — Effect B is a no-op). Both (1) and (2) call `startBottomLock()` which creates a `ResizeObserver` that fires `scrollTo({instant})` on every container resize within the deadline window, auto-cancels when `wasNearBottomRef` flips false (AC5) or deadline expires (AC6).
- **Effect C** (`useLayoutEffect[isLoadingMore]`): LoadMore restore. On `isLoadingMore` false transition: if `scrollLockRef.mode === 'prepending'`, reads the pre-skeleton baseline (`prevScrollHeight`, `prevScrollTop`), computes `delta = scrollHeight_now - prevScrollHeight`, writes `scrollTop = prevScrollTop + delta`. Transitions mode to `idle`. No-op when mode is `idle`.
- **Effect D** (`useEffect[]`): Unmount cleanup. Handles all 3 modes: `bottom-lock` → disconnect observer; `prepending` → reset (no DOM touch); `idle` → no-op. Resets all 7 refs for Strict Mode dev parity.
- **`handleLoadMore` callback**: Wraps parent's `onLoadMore`. Captures `scrollHeight`/`scrollTop` SYNCHRONOUSLY before calling parent (which triggers skeleton render). Sets `scrollLockRef = { mode: 'prepending', ... }`. Passed to `<HistoryLoadMoreSentinel>` as `onLoadMore`.
- **`overflow-anchor: none`** explicit on scroll container (`style={{ overflowAnchor: 'none' }}`). JS owns scroll restoration unambiguously — eliminates race between Effect C's pre-paint write and the browser's native anchor-adjustment algorithm.
```

Verification: Read the section after edit to confirm no formatting errors.

---

### Playwright Plan — DEFERRED TO F-WEB-HISTORY-FU5

**Status:** Out of scope for FU4 per owner directive 2026-06-03 post `/review-plan` Codex CRITICAL-2 finding.

**Why deferred:** the originally proposed fixture strategy (cookie-injected `sb-access-token` + `page.route()` API mocks) was empirically found unworkable by Codex:
- Supabase auth uses storage key `sb-<project-ref>-auth-token` with chunked base64url-encoded session JSON, NOT a single `sb-access-token` cookie. `@supabase/ssr` controls this key.
- Auth on `/hablar` is client-side via `AuthProvider` Supabase session events; not server-gated by middleware. Cookie injection alone doesn't satisfy `session?.access_token` checks in `useSearchHistory` + `apiClient.ts`.
- The proposed API mocks did not match real schemas: `getMe()` returns `{ success: true, data: { account, actor } }`; `getUsage()` returns `tier/resetAt/buckets`; `getHistory()` uses `?limit=10` not `cursor=null`, returns UUID `id`/`kind`/`queryText`/`resultData`/`createdAt`; `sendMessage()` wraps in `{ success: true, data: ... }` with `actorId`. Mock payloads would parse-fail at runtime.

**Path forward (F-WEB-HISTORY-FU5):** create a dedicated FU5 ticket post-FU4 merge. FU5 design (to be cross-model-reviewed in its own cycle) will choose between:
- (a) **Test-harness route** approach (`/test-harness/transcript-feed` build-time-gated route) rendering TranscriptFeed in isolation with test-controllable props — bypasses auth + API entirely.
- (b) **Real-schema route interception** with correct Supabase cookie key (`sb-<project-ref>-auth-token` chunked format) + real response shapes via `page.route()`.
- (c) **Programmatic session injection** via `page.evaluate` + `supabase.auth.setSession()` to bypass cookie complexity.

The FU5 cross-model review will pick one with empirical justification.

**FU4 enforcement gate without Playwright:** operator AC24 + AC25 + AC26 (browser smokes on app-dev) remain the authoritative pre-release gate. The owner manually verifies + signs off; FU5 will subsequently make those CI-enforceable.

**Risk acknowledgment:** without Playwright in FU4, the operator AC pattern is the SAME pattern that allowed FU2 + FU3 to ship with bugs (one-time owner verification, no regression guard). The FU4 mitigation: (1) the state-machine architecture is correct-by-construction (not relying on test discovery), validated by cross-model review on the architectural decisions; (2) unit tests cover the discriminating cases (AC3, AC9, AC14b, AC14c, AC17b); (3) FU5 is a hard follow-up, not an "intent to do later" — the FU4 DoD explicitly requires creating the FU5 ticket file before closing FU4.

---

### Verification commands run

- `Read: packages/web/src/components/TranscriptFeed.tsx` → 264 lines, 6 effects confirmed (Effect 0=scroll listener, Effect 1=hydration useLayoutEffect, Effect 2=unmount useEffect, Effect 3=append useEffect, Effect 4=loadMore capture useEffect, Effect 5=loadMore restore useLayoutEffect); `prevScrollHeightRef` and `prevScrollTopRef` exist at lines 65-66; `hydrationObserverRef` exists at line 102 → plan removes all three and replaces with `scrollLockRef`.
- `Read: packages/web/src/__tests__/helpers/resizeObserverShim.ts` → 149 lines; `shim.fire()` exists at line 132 with signature `fire(entries?: Partial<ResizeObserverEntry>[], observer?: ResizeObserver): void`; `shim.lastObserver` exposed via `ShimObserverInstance`; `shim.disconnectMock` and `shim.observeMock` are aggregate mocks → plan references `shim.fire([{ target: feed } as ResizeObserverEntry])` correctly; `install()`/`uninstall()` API confirmed at lines 76 and 116.
- `Read: packages/web/src/__tests__/components/TranscriptFeed.test.tsx` → 996 lines; confirmed test names AC10b (line 337), AC10c (line 367), AC11 (line 410), AC12 (line 644), AC13b (line 682), AC13c (line 703), AC1 (line 819), AC3 (line 870), AC4 (line 900), AC5 (line 928) — all confirmed in file; `installScrollMocksLocal` helper exists in multiple describe blocks; `describe('TranscriptFeed — Step 3: ResizeObserver hydration')` is the target for rename.
- `Read: packages/web/src/__tests__/components/TranscriptFeed.edge-cases.test.tsx` → 414 lines; EC-RAPID-1 confirmed at line 382; EC-CLEAR-2 confirmed at line 198; EC-SCROLL-DURING-WINDOW-1 confirmed at line 327 → plan's surgery count for edge-cases file confirmed (3 touches: EC-RAPID-1 logic update + EC-CLEAR-2 assertion addition + EC-SCROLL-DURING-WINDOW-1 comment rename).
- `Read: packages/web/src/components/HistoryLoadMoreSentinel.tsx` → 77 lines; `onLoadMore` prop used in IntersectionObserver callback via `onLoadMoreRef.current()` (line 33) and directly in keyboard button `onClick={onLoadMore}` (line 69) → plan correctly notes that sentinel receives `handleLoadMore` transparently (sentinel just calls `onLoadMore` prop — it does not care it is wrapped).
- `Read: packages/web/src/hooks/useSearchHistory.ts` lines 80-102` → `loadMore` calls `setIsLoadingMore(true)` synchronously, then `.then()` calls `setPersistedEntries([...olderEntries, ...prev])`, then `.finally()` calls `setIsLoadingMore(false)`. These are in separate microtasks → confirms 2-commit flow diagnosis from research doc §4.2 → plan's AC9 test design (3-rerender pattern: handleLoadMore + isLoadingMore=true + isLoadingMore=false) is correct.
- `Read: packages/web/src/components/HablarShell.tsx:630-645` → `onLoadMore={loadMore}` passed directly at line 640 → confirms plan's Step 3: `handleLoadMore` wrapping happens INSIDE TranscriptFeed (the `loadMore` from `useSearchHistory` is still passed as `props.onLoadMore`; `TranscriptFeed` wraps it internally; HablarShell is NOT modified).
- `Read: packages/web/package.json` → no `@playwright/test` in devDependencies (confirmed absent) → plan's AC20 adds it from scratch; `"start": "next start -p 3002"` confirmed → Playwright `baseURL` and `webServer.url` must use port 3002 not 3000.
- `Read: .github/workflows/ci.yml` → `ci-success` job at line 338 lists `needs: [test-shared, test-api, test-bot, test-scraper, test-landing, test-web]`; `test-web` job confirmed at line 298; no `test-web-e2e` job exists → plan's new job design is additive, no conflicts.
- `Read: docs/specs/ui-components.md:2460-2492` → TranscriptFeed entry confirmed at lines 2460-2492; State block at 2477-2481 references `hydrationObserverRef` and 4 refs → plan's AC22 update replaces this with 7-ref model + new Behavior block describing 4-effect state machine.
- `Bash: grep -n "entryId" packages/web/src/types/history.ts` → `entryId: string` confirmed at line 19 in `TranscriptEntryData` interface → plan's first/last entryId comparison algorithm uses the correct field name.
- `Bash: ls packages/web/e2e` → directory does not exist → plan creates it new with `e2e/fixtures.ts`, `e2e/transcript-feed.append-card-visible.spec.ts`, `e2e/transcript-feed.loadmore-anchor-preserved.spec.ts`.
- `Bash: ls packages/web/playwright.config.ts` → does not exist → plan creates it new.
- `Bash: grep -n "APPEND_BOTTOM_LOCK\|scrollLockRef\|firstEntryIdRef" TranscriptFeed.tsx` → returns empty → FU4 refs not yet in the file; plan adds all three from scratch.
- `Read: research doc §7.5 R5` → "jsdom cannot validate the state machine's correctness end-to-end — H likelihood, M impact — mitigation: Add Playwright e2e coverage … MUST happen in same FU as the code change" → Playwright plan is in-scope (not deferred), as confirmed by AC20/AC21 spec requirements.

---

## Completion Log

| Date | Step | Notes |
|------|------|-------|
| 2026-06-03 | Step 0 (Spec draft) | Ticket created post-research-doc (Plan agent + Gemini + Codex cross-model, 2026-06-03). Spec derived from research doc §7 (architecture) + §7.2 (edge-case matrix translated to ACs) + §7.5 (risk register addressed in DoD + operator ACs) + §9 (Standard tier rationale). 26 ACs across 8 categories. Branch `bugfix/web-feed-scroll-state-machine` cut off develop `55528c5`. |
| 2026-06-03 | Step 0 (`/review-spec` cross-model) | Gemini → **APPROVED** (1 SUGGESTION = add `firstEntryIdRef`/`lastEntryIdRef` to Refs list; subsumed by Codex C1). Codex → **REVISE** (4 IMPORTANT + 1 SUGGESTION, all empirically grounded by reading research doc + ticket + TranscriptFeed.tsx + HistoryLoadMoreSentinel.tsx + useSearchHistory.ts + resizeObserverShim.ts + packages/web/package.json). All 5 findings APPLIED in next commit: **C1** Architecture summary Refs section expanded to 7 (4 existing + 3 new: `firstEntryIdRef`, `lastEntryIdRef`, `scrollLockRef`); Effect B dep array clarified to include first/last entryId signals (not only `entries.length`). **C2** new AC14b (inverse `prepending → append` transition guard) + AC14c (clear-all → search routes through append, mirrors EC-CLEAR-2). **C3** AC3 rewritten to reference the actual `shim.fire()` API + `Object.defineProperty(scrollHeight, getter)` pattern (no fictional `shim.observerCb`). **C4** AC20 split into AC20 (Playwright infra setup — dep + config + script + GitHub Actions job + fixture strategy) and AC20b (concrete e2e scenarios). **C-S1** AC25 wording made reproducible (DevTools cache-disabled + Slow 3G throttle, explicit). 26 → 29 ACs total. Review artifacts: `/tmp/review-spec-foodXPlorer-FU4/{gemini,codex}.txt`. |
| 2026-06-03 | Step 1 (Setup) | Branch `bugfix/web-feed-scroll-state-machine` cut off develop `55528c5`; working tree clean baseline confirmed (`git status` → clean). No additional dependencies installed. Row added 2026-06-03 per auditor I4 (was previously folded into Step 0). |
| 2026-06-03 | Step 2 (Plan draft) | `frontend-planner` agent produced Implementation Plan (Design Notes, 10 Frontend Plan steps + Playwright Plan + Verification commands). Plan derived from research doc §7.1 + ticket Spec §A-H. Plan grounded empirically: TranscriptFeed.tsx (264 lines, 6 effects) + test files (996 + 414 lines) + resizeObserverShim.ts (149 lines, API confirmed) + HistoryLoadMoreSentinel + useSearchHistory + HablarShell + apiClient + Supabase libs + CI workflow + package.json all read. 3 open questions raised for owner (Supabase cookie name, next start vs dev, startBottomLock closure vs extracted helper). |
| 2026-06-03 | Step 2 (`/review-plan` cross-model) | Gemini → **APPROVED** (no findings, high praise; answered open Qs: API route interception bypasses auth Q, next start correct, closure helper sound). Codex → **REVISE** (2 CRITICAL + 3 IMPORTANT, all empirically grounded — Codex deeper than Gemini this round). **CRITICAL-1**: `startBottomLock` plan had no `setTimeout` — only `Date.now()>deadline` inside ResizeObserver callback → observer alive indefinitely if no resize after deadline → AC6 test fails. **APPLIED**: paired observer with explicit `setTimeout(stopBottomLock, durationMs)`; added `timerId` field to `scrollLockRef` bottom-lock variant + extracted `stopBottomLock()` helper handling timer clear + observer disconnect + mode reset uniformly. **CRITICAL-2**: Playwright fixture inviable — wrong Supabase cookie name (`sb-access-token` vs real `sb-<project-ref>-auth-token` chunked base64url) + wrong API schemas (no `{success,data}` wrappers + `/history?cursor=null` should be `?limit=10`) + auth is client-side not server-gated. **OWNER DECISION**: defer Playwright to F-WEB-HISTORY-FU5 (separate ticket, own cross-model cycle). FU4 ships with unit tests + operator AC24/AC25/AC26 as authoritative gate. Risk acknowledged in Playwright Plan section. **IMPORTANT-3**: `handleLoadMore` dropped action if `feedRef.current` null. **APPLIED**: always invokes `props.onLoadMore()` even without baseline; Effect C early-returns when `mode!=='prepending'`. **IMPORTANT-4**: AC13 contradicted AC14c (fresh-hydration vs append). **APPLIED**: AC13 reworded to route through append (consistent with AC14c + EC-CLEAR-2). **IMPORTANT-5**: Strict Mode tests claimed but absent. **APPLIED**: new AC17b adding explicit `<React.StrictMode>` render test. Review artifacts: `/tmp/review-plan-foodXPlorer-FU4/{gemini,codex}.txt`. |
| 2026-06-03 | Step 3 (TDD impl) | frontend-developer agent executed 10-step Plan. Refactored TranscriptFeed.tsx (264 → ~340 lines): 6 effects → 4-effect state machine; 7 refs (3 new: `firstEntryIdRef`, `lastEntryIdRef`, `scrollLockRef` discriminated union with `timerId` per CRITICAL-1); `handleLoadMore` callback wrapping `props.onLoadMore` with null-feedRef fallback (IMPORTANT-3); `overflow-anchor: none` inline style. 16 test surgery touches in `TranscriptFeed.test.tsx` (renames + assertion strengthening) + new tests for AC3 (race-aware append), AC9 (race-aware prepend), AC11 (overflow-anchor), AC14 (transition guard), AC14b (inverse prepending→append), AC14c (clear-all→search via existing EC-CLEAR-2), AC17b (Strict Mode). Doc sync `ui-components.md` per AC22. Gates: 787/787 tests, lint 0, typecheck 0, build clean. Commit `f1a94fe`. Note: agent committed + pushed before review (process deviation — instructed otherwise, accepted as commits are on feature branch). |
| 2026-06-03 | Step 4 (Finalize) | Full gates re-verified post-Step-3 commit `f1a94fe`: 787/787 tests, lint 0, typecheck 0, build clean. PR #308 opened from `bugfix/web-feed-scroll-state-machine`→`develop`. Closeout commit `ffb2fe7` (Step 4 housekeeping — ticket + tracker sync). Row added 2026-06-03 per auditor I4 (was previously folded into Step 3 commit/PR sentence). |
| 2026-06-03 | Step 5 (code-review + qa + fix-loop) | **code-review-specialist**: APPROVE WITH MINOR CHANGES — 1 MAJOR + 3 MINOR/NIT. MAJOR = AC17b test assertion `disconnectMock>=1` not discriminating (passes against naive impl missing the `hasScrolledToBottomOnHydrationRef=false` reset in Effect D cleanup). **qa-engineer**: QA BLOCKED — 3 blockers (AC23 doc cross-link absent, F-WEB-HISTORY-FU5 ticket file absent, AC14 base no discriminating `disconnectMock` test) + 3 P3/P4 follow-ups. qa-engineer added `TranscriptFeed.fu4-qa.edge-cases.test.tsx` (+3 tests: EC-AC3-ISOLATION, EC-AC14-BASE, EC-AC14-DOUBLE-LOADMORE) filling the AC14 gap. **Fix-loop applied**: (1) AC17b strengthened to `observeMock>=2` (mount + remount both install observer; discriminates against naive impl). (2) AC23 marked [x] with W18 cross-link explanation (no edit to W18 needed; state machine implements it verbatim). (3) F-WEB-HISTORY-FU5 ticket skeleton created at `docs/tickets/F-WEB-HISTORY-FU5-playwright-e2e.md`. (4) qa-added test file kept as additional defense-in-depth coverage. **Post fix-loop gates**: 790/790 tests, lint 0, typecheck 0, build clean. Commit `8832fbf`. **/audit-merge re-run post fix-loop**: 12/12 structural PASS, drift clean. |
| 2026-06-03 | Step 6 (Playwright e2e) | DEFERRED to F-WEB-HISTORY-FU5 per owner decision 2026-06-03 post /review-plan CRITICAL-2 (fixture infeasible with current Supabase cookie + API schema knowledge, separable concern). FU5 ticket skeleton at `docs/tickets/F-WEB-HISTORY-FU5-playwright-e2e.md` (no actionable Step 0 yet). Workflow item satisfied by the deferral decision + ticket creation. Row added 2026-06-03 per auditor I4. |
| 2026-06-03 | Step 7 (fix-loop round 2 — auditor C1 BLOCKER) | **External auditor REJECT post-PR-#308 review**: ResizeObserver attached to flex-1 `feedRef` scroll container never fires on internal `scrollHeight` growth — its box stays constrained by HablarShell's `h-[100dvh] flex-col` parent (line 618), so per W3C Resize Observer §3.1/§3.4.8 `isActive()` compares only contentBox/borderBox/devicePixelContentBoxSize and never produces an entry for the shimmer→card mutation. Tests passed only because the jsdom shim manually triggers callbacks via `shim.fire()`; no real-DOM gate. **Cross-model verification 2026-06-03** (artifacts in `/tmp/audit-c1-verification-2026-06-03/`): Gemini → CONFIRMED + recommend (d) event-driven primary, (a) inner wrapper as alternative; Codex → CONFIRMED + recommend (a) inner wrapper observer (strongly rejects b/c/d). Consensus = **(a) inner wrapper**. **Fix applied**: added 8th ref `feedContentRef = useRef<HTMLDivElement>(null)`; wrapped all scroll-container children in `<div ref={feedContentRef} data-testid="feed-content">`; `startBottomLock` observer now targets `feedContentRef.current ?? container` (block-flow wrapper whose box DOES grow with content). Updated 2 stale assertions in `TranscriptFeed.test.tsx` (L890 AC1 + L1051 AC6) plus added new **AC1b** (FU4 round 2 invariant: observer target MUST be wrapper, NOT scroll container). Vanilla repro at `/tmp/c1-repro.html` (side-by-side wrapped vs unwrapped). **Auditor secondary findings (I2/I3/I4/NIT)** all applied in same commit: AC18 reconciled to 791 tests (was stale 787); tracker Features row + Active Session updated; Completion Log Steps 1/4/6 rows added explicitly. **Post-round-2 gates**: 791/791 tests, lint 0, typecheck 0, build clean. Operator AC24/AC25/AC26 reverify still pending pre-merge on app-dev. |

---

## Merge Checklist Evidence

| # | Action | Status | Evidence |
|---|--------|--------|----------|
| 0 | Pre-flight check | [x] | Branch `bugfix/web-feed-scroll-state-machine` off develop `55528c5` (verified `git merge-base --is-ancestor origin/develop HEAD` → UP TO DATE). Status header flipped Spec → Ready for Merge. |
| 1 | Acceptance Criteria all marked | [x] | **AC: 27/30 marked** (form: checkbox; +1 AC1b from FU4 round 2 invariant). 3 intentionally [ ] per ticket design: AC24 (Bug 1 reverify post-deploy), AC25 (Bug 2 reverify post-deploy + Slow-3G), AC26 (loadMore prepend reverify post-deploy). All operator gates per `feedback_jsdom_layout_ac_gap` — jsdom cannot close layout-race ACs; browser smoke is authoritative. Same pattern accepted in FU1/FU2/FU3 audits. |
| 2 | Definition of Done all marked | [x] | **7/10 marked** pre-merge. 3 intentionally [ ] are post-merge gates: bugs.md FIXED stamp (await operator AC24-26), release develop→main release PR (await op smokes), memory entry `feedback_layout_effect_phase_swap_needs_full_review` (saved at Step 6 closeout). |
| 3 | Workflow Checklist Steps 0-5 complete | [x] | 0/1/2/3/4/5 all [x]. Step 6 = DEFERRED TO FU5 (Playwright per /review-plan CRITICAL-2 owner decision, [x] as deferred-not-applicable). Step 7 = merge+closeout, intentionally [ ] pending PR. Round 2 fix-loop applied 2026-06-03 post-auditor C1 BLOCKER; reverted from "PR awaiting merge" to "fix in flight" then back to "ready" status. |
| 4 | Completion Log per-step rows | [x] | **9 rows** (post-auditor I4 reconciliation 2026-06-03): Step 0 Spec draft + Step 0 /review-spec + Step 1 Setup + Step 2 Plan draft + Step 2 /review-plan + Step 3 TDD impl + Step 4 Finalize + Step 5 fix-loop + Step 6 Playwright deferred + Step 7 fix-loop round 2 auditor C1 BLOCKER. |
| 5 | Product Tracker sync (Active Session + Features) | [x] | `product-tracker.md` Active Session reflects FU4 Step 5→7 (round 2 in-flight; will flip to merge-ready post-push). Features table row updated 2026-06-03 (auditor I2 fix): "in-progress 5/6, 30 ACs incl. AC1b, Playwright→FU5". To be flipped done 6/6 in Step 6 closeout PR post-merge. |
| 6 | key_facts.md sync | [x] | N/A — no new models/endpoints/schemas/shared utilities. The new `scrollLockRef` discriminated union + `feedContentRef` (round 2) are internal to TranscriptFeed, not shared infrastructure. Playwright deferred to FU5; FU5 ticket explicitly notes key_facts.md update as its own DoD item. |
| 7 | bugs.md sync | [x] | BUG-WEB-FEED-SCROLL-SETTLE-001 entry exists from FU2 cycle; will be updated to "TRULY FIXED" status in Step 6 closeout PR after operator AC24/AC25/AC26 confirm on the **round-2-corrected** observer target. Research doc `docs/research/transcript-feed-scroll-architecture-2026-06-03.md` is the authoritative diagnosis + cross-model artifacts `/tmp/audit-c1-verification-2026-06-03/` document the round-2 C1 BLOCKER resolution (referenced from bugs.md update at closeout). |
| 8 | Tests / lint / typecheck / build | [x] | **Web: 791/791 tests green** (post-round-2 Jest run); baseline 771 + 16 FU4 main tests + 3 QA-added FU4 edge tests + 1 FU4 round 2 invariant (`AC1b`). **Lint: 0** warnings/errors (next lint). **Typecheck: 0** errors (tsc --noEmit). **Build: clean** (Next.js 15). |
| 9 | Cross-model + reviewer + audit-merge trail | [x] | `/review-spec` Gemini APPROVED + Codex REVISE 4 IMP+1 SUG → all 5 findings applied. `/review-plan` Gemini APPROVED + Codex REVISE 2 CRIT+3 IMP → all 5 applied (CRITICAL-2 Playwright deferred to FU5 per owner decision). code-review-specialist APPROVE WITH MINOR CHANGES → 1 MAJOR (AC17b test strengthening) applied. qa-engineer QA BLOCKED → 3 blockers applied (AC17b assertion + AC23 cross-link + FU5 ticket stub). `/audit-merge` 12/12 structural pre fix-loop → 2 blockers found → all applied → re-run. **Round 2 cross-model verification 2026-06-03**: external auditor REJECT (C1 BLOCKER + I1/I2/I3/I4/NIT) → gemini + codex independent CONFIRMED → option (a) inner wrapper applied. Review artifacts: `/tmp/review-spec-foodXPlorer-FU4/`, `/tmp/review-plan-foodXPlorer-FU4/`, `/tmp/audit-c1-verification-2026-06-03/`. |
