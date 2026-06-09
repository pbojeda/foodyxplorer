# F-WEB-HISTORY-FU2: Feed scroll-settle — ResizeObserver hydration + wasNearBottomRef append

**Feature:** F-WEB-HISTORY-FU2 | **Type:** Frontend-Bugfix (2 layout-race fixes in `TranscriptFeed`) | **Priority:** High (visible UX defect on every authenticated `/hablar` reload + every new search)
**Status:** Done | **Branch:** bugfix/web-feed-scroll-settle (squash-merged to develop `be7ebcf` via PR #304, 2026-06-02 12:05Z)
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

- [x] **AC1.** When `TranscriptFeed` mounts (or first transitions from `entries=[]` to `entries.length ≥ 1`) with `ResizeObserver` available, a `ResizeObserver` is attached to the feed container. While active (≤500ms window) it re-invokes `scrollTo({ top: scrollHeight, behavior: 'instant' })` every time the observed `scrollHeight` grows. After the window elapses it disconnects.
- [x] **AC2.** The hydration scroll uses `behavior: 'instant'` (NOT `'smooth'`). Verified by asserting the `scrollTo` mock receives `behavior: 'instant'` on the hydration call(s).
- [x] **AC3.** The ref-guard `hasScrolledToBottomOnHydrationRef` introduced in FU1 is preserved — hydration only activates ONCE per component lifetime; loadMore prepends and session appends do NOT re-trigger it.
- [x] **AC4.** _(race-aware test, MANDATORY per auditor 2026-06-02; refined per /review-spec Codex C1)_ A unit test installs a **controllable `ResizeObserver` shim** that captures the callback passed to `new ResizeObserver(cb)` into a test-scoped handle (e.g., `let observerCb: ResizeObserverCallback | null = null;` set inside the shim's constructor). The test also installs `Object.defineProperty(feed, 'scrollHeight', { get: () => currentScrollHeight })` with a mutable `currentScrollHeight`. After the rerender that hydrates entries, the test (a) mutates `currentScrollHeight` to a larger value, (b) explicitly invokes `observerCb([{ target: feed, contentRect: ... } as ResizeObserverEntry], observer)`, then asserts EITHER `scrollTo` was called ≥2 times (initial + the post-growth re-fire) OR the LAST `scrollTo` call carries the post-growth `scrollHeight`. The `setTimeout`-only variant is rejected — it does not deterministically prove the ResizeObserver path runs. Reproduces the FU1 browser bug deterministically; a green test means the fix actually settles the race.
- [x] **AC5.** Graceful fallback: when `typeof ResizeObserver === 'undefined'` (older browser / unshimmed test env), the hydration effect falls back to a single-shot `scrollTo({ top: scrollHeight, behavior: 'instant' })`. No throw. Unit-tested by deleting `globalThis.ResizeObserver` in one test case. (`'instant'` matches W18 + the rest of this Spec — NOT FU1's `'smooth'`.)
- [x] **AC6.** No regression on the FU1 sync-mount case (entries already populated on first render): feed lands at the bottom. The behavior change (smooth→instant) is acceptable on reload per spec; assert via `scrollTo` mock call.

### B — Append scroll-settle (Bug 2)

- [x] **AC7.** A `wasNearBottomRef` is initialized to `true` (user starts at bottom by convention — matches AC1 hydration semantic). A `scroll` event listener on the feed container updates `wasNearBottomRef.current = (scrollTop + clientHeight >= scrollHeight - 100)` whenever the user scrolls. Both attach on mount + detach on unmount.
- [x] **AC8.** The append effect (`useEffect([entries.length])` for the count-grew path) reads `wasNearBottomRef.current` at the TOP of the effect (BEFORE any DOM read) and calls `scrollTo({ top: scrollHeight, behavior: 'smooth' })` only when `wasNearBottomRef.current === true`. The OLD post-commit `isNearBottom` math is REMOVED.
- [x] **AC9.** _(race-aware test for Bug 2)_ A unit test simulates the append race: user is near bottom pre-commit (`wasNearBottomRef.current = true` set via a `scroll` event fire), then a new entry appends and `scrollHeight` jumps >100px from inside the test. The test asserts `scrollTo` IS called — even though a post-commit `isNearBottom` check would have failed. Reproduces the FU1 AC11 browser bug deterministically.
- [x] **AC10.** When the user has manually scrolled up (≥100px above bottom) BEFORE the new entry appends, `wasNearBottomRef.current === false` → the append effect does NOT call `scrollTo`. Respects user reading position. Unit-tested.
- [x] **AC11.** No regression on the existing FU1 AC10c (loadMore prepend preservation): when `isLoadingMore` transitions `true → false` and entries grow at the FRONT, the feed must NOT auto-scroll to bottom. The existing prepend-preservation effect at the bottom of `TranscriptFeed` (currently lines 107-125) is untouched.

### C — Coexistence + cleanup

- [x] **AC12.** When the append path fires AFTER the hydration window has closed (typical case for a search after reload), only the `wasNearBottomRef` logic runs (the ResizeObserver has already disconnected). The two effects do NOT stack into duplicate scrolls.
- [x] **AC13.** Unmount tears down BOTH the `scroll` listener and the ResizeObserver (if still active). Verified by a unit test that renders + unmounts + asserts the listener / observer cleanup functions were invoked (jest spies on `removeEventListener` + `ResizeObserver.prototype.disconnect`).

### D — Canonical spec sync (per /review-spec Codex C2 + base-standards `ai-specs/specs/base-standards.mdc:12`)

- [x] **AC14.** `docs/specs/ui-components.md` TranscriptFeed entry (currently lines ~2430-2484) is updated: the `State` line "shouldAutoScroll: boolean — true when scrollTop + clientHeight >= scrollHeight - 100. Checked before each append." is replaced with the new model — `wasNearBottomRef: MutableRefObject<boolean>` updated by a `scroll` event listener (captures pre-commit position), consulted in the append effect for unconditional decision; plus a new `Behavior` line documenting the hydration scroll uses a `ResizeObserver` for ~`HYDRATION_RESCROLL_WINDOW_MS` (≈500ms) post-hydration with `behavior: 'instant'` and ref-guarded single activation. Existing `Accessibility` / `Props` lines untouched.
- [x] **AC15.** N/A — cross-link only; W18 (design-guidelines.md:1443) reaffirmed authoritative without edit; ui-components.md TranscriptFeed Props+State+Behavior+Accessibility updated per AC14.

### E — Build / CI / quality

- [x] **AC16.** `npm test -w @foodxplorer/web` green (745 baseline + 16 new = 761 tests).
- [x] **AC17.** Lint + typecheck + build clean for web (api unchanged).
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

- [x] `bugs.md` entry for BUG-WEB-FEED-SCROLL-SETTLE-001 reflects post-merge status: FIXED @ `be7ebcf` via PR #304 (2026-06-02). AC19/AC20/AC21 op-smoke results will be appended after operator confirmation on app-dev.
- [x] Tracker `product-tracker.md` Active Session updated through Step 6 closeout (Done, branches deleted, AC tally 18/21 + AC15 N/A + 3 op-pending).
- [x] FU1 ticket `F-WEB-HISTORY-FU1-feed-polish.md` is NOT modified retroactively (per `feedback_jsdom_layout_ac_gap` lesson — FU1 is Done and its unit tests legitimately pass; the gap was at the jsdom↔browser boundary).
- [ ] Release develop→main gate: AC19 + AC20 + AC21 all PASS in browser → only then is the develop→main release PR opened (independent of this ticket's merge). **Pending operator confirmation on app-dev post-deploy.**
- [x] All A/B/C/D ACs marked `[x]` pre-merge (operator F ACs remain `[ ]` until post-deploy).
- [x] Web test suite count documented in Completion Log (baseline 745 + 16 delta = 761).
- [x] No new ADR (this is a frontend fix, no architectural decision). If implementation deviates from the spec (e.g., ResizeObserver replaced by a different primitive), document in Completion Log with cross-model concurrence.

---

## Workflow Checklist

- [x] **Step 0 — Spec** (in progress): this file + cross-model `/review-spec` (Gemini + Codex parallel) + apply findings + owner sign-off on Spec.
- [x] **Step 1 — Setup**: branch already created (`bugfix/web-feed-scroll-settle` off develop `172fb23`); confirm working tree clean; baseline web suite count.
- [x] **Step 2 — Plan**: Implementation Plan section below filled with file-level changes + verification commands + cross-model `/review-plan` + owner sign-off on Plan.
- [x] **Step 3 — Implement (TDD)**: RED tests for AC4 + AC9 + AC5 + AC13 (race-aware + cleanup) → GREEN ResizeObserver + wasNearBottomRef + listener teardown. Keep ref-guard semantics.
- [x] **Step 4 — Finalize**: full web suite green (771/771) + lint clean + typecheck clean + build clean; commit `9477df2` (TDD impl), `bugfix/web-feed-scroll-settle` branch.
- [x] **Step 5 — Review**: code-review-specialist APPROVE WITH MINOR CHANGES (2 MAJOR + 5 MINOR/NIT); qa-engineer PASS WITH FOLLOW-UPS (+10 edge-case tests, 1 P3 BUG fixed in same PR); fix-loop applied (MAJOR-1 Strict Mode reset, MINOR-1/2/3, P3 BUG shim guard); MAJOR-2 deferred to FU3 with rationale. `/audit-merge` to follow.
- [x] **Step 6 — Merge + Closeout**: PR #304 squash-merged to develop `be7ebcf` (2026-06-02 12:05Z). Branch `bugfix/web-feed-scroll-settle` deleted local + remote. This closeout PR flips Status→Done + tracker sync. Operator AC19/AC20/AC21 to follow post-deploy.

---

## Implementation Plan

### Design Notes

- **Why `ResizeObserver` over `MutationObserver` / `IntersectionObserver` / `rAF`-loop.** `rAF×2` is NOT sufficient — `NutritionCard` async work (font load, lazy images) can span more than two frames. `MutationObserver` fires on DOM mutations (node insertion/removal), not on layout dimension changes — it would need to read `scrollHeight` on every child insertion and could miss async image-driven growth. `IntersectionObserver` detects when the container or a sentinel crosses viewport thresholds, not when the container's own `scrollHeight` grows. `ResizeObserver` is the canonical browser API for reacting to dimension changes on a specific element; it fires whenever `scrollHeight` grows regardless of cause (text, images, fonts) and is zero-cost once disconnected. Auditor reasoning 2026-06-02: use `ResizeObserver` as PRIMARY, not alternative.

- **Why `wasNearBottomRef` via `scroll` listener over `useLayoutEffect`-based pre-commit DOM read.** `useLayoutEffect` runs synchronously after the DOM commit — i.e., AFTER React has already updated `scrollHeight` with the new entry's height. Reading `scrollHeight` there still measures the post-commit state. The canonical Slack/Linear/Discord pattern captures position in a `scroll` event listener, which runs on user-initiated scroll events BEFORE any new commit; the ref always holds the last known user position. This decouples the "was the user at the bottom?" decision from the post-commit DOM state entirely. It is unconditional: the effect simply reads a ref, no DOM math required.

- **`HYDRATION_RESCROLL_WINDOW_MS = 500` constant (Gemini S1).** Placement: top-of-file module constant in `TranscriptFeed.tsx`, above the component function, in UPPER_SNAKE_CASE per project naming convention (`ai-specs/specs/frontend-standards.mdc:35`). Value 500ms represents the post-hydration window during which child cards are expected to settle. Tradeoff: if fonts / lazy images take >500ms the user lands "close but not exactly at the bottom" — this is better than the current "stops short visibly" and is documented as non-goal for FU2 (escalate to FU3 if operator AC19 surfaces a repeatable >500ms case).

- **Effect ordering / coexistence (AC12) + lifecycle decoupling (per /review-plan Codex P-C1).** The hydration `ResizeObserver` lives in a module-scoped `useRef` (`hydrationObserverRef`), NOT in a `useEffect` cleanup. Reason: the hydration effect is keyed to `entries.length` (it has to detect first-non-empty), but if any subsequent `entries.length` change (loadMore prepend, session append) occurs within the 500ms window, React would run the prior effect's cleanup → disconnect the observer → re-run the effect → early-return on `hasScrolledToBottomOnHydrationRef` guard → observer is gone. The fix: the entries-length effect SETS UP the observer + timer (assigns to the ref) and returns an EMPTY cleanup. Teardown happens ONLY via (a) the 500ms `setTimeout` callback (`observer.disconnect()` + ref clear), or (b) a separate `useEffect(() => () => teardownIfActive(), [])` unmount cleanup. Subsequent `entries.length` changes hit the hydration effect, immediately early-return on the guard, and do NOT touch the ref-held observer. After the timer fires (or unmount), the append effect (which reads `wasNearBottomRef`) is the only path running. At most one `scrollTo` per append in the post-hydration steady state.

- **jsdom limitations + test shim.** jsdom does not implement `ResizeObserver`, `scrollTo`, or live layout dimensions (`scrollHeight`, `clientHeight`, `scrollTop` all return `0`). The existing `jest.setup.ts:228-236` installs a no-op `MockResizeObserver` (guarded by `if (typeof globalThis.ResizeObserver === 'undefined')`), which means the production `ResizeObserver` constructor call will NOT throw in test env — but the callback is never fired, so the re-scroll loop is never exercised unless tests replace the global. The new `resizeObserverShim.ts` test helper is designed to: (a) override `globalThis.ResizeObserver` with a controllable implementation that captures the callback, (b) expose a `fire()` method for deterministic callback invocation, and (c) restore the prior `globalThis.ResizeObserver` on `uninstall()` so the no-op stub from `jest.setup.ts` is preserved for all other tests.

---

### Frontend Plan

**Step 1 — Create `resizeObserverShim.ts` reusable test helper (no production change)**

File: `packages/web/src/__tests__/helpers/resizeObserverShim.ts` (new file; new `helpers/` subdirectory under `__tests__/`; the existing `__tests__/` root holds `fixtures.ts` and `fixtures.auth.ts` as flat files, but a subdirectory is correct here for a reusable cross-test utility).

No RED/GREEN cycle needed — this is a pure test-infrastructure step. Write and verify types compile.

Helper exported API (exact shape — extended per /review-plan Codex P-C2 to support AC13 disconnect assertions):

```
export interface ResizeObserverShim {
  install(): void;
  uninstall(): void;
  lastObserverCb: ResizeObserverCallback | null;
  lastObserver: ShimObserverInstance | null;   // NEW (P-C2): exposes the instance so tests can spy on its disconnect / observe
  disconnectMock: jest.Mock;                    // NEW (P-C2): convenience counter — incremented on EVERY instance's disconnect() call (across multiple `new ResizeObserver(...)` calls in one test if any)
  observeMock: jest.Mock;                       // NEW (P-C2): same shape for observe(); useful for AC1 attach-was-called assertions
  fire(entries?: Partial<ResizeObserverEntry>[], observer?: ResizeObserver): void;
  reset(): void;
}

export interface ShimObserverInstance {
  observe: jest.Mock;
  unobserve: jest.Mock;
  disconnect: jest.Mock;
  cb: ResizeObserverCallback;
}

export function createResizeObserverShim(): ResizeObserverShim
```

Implementation contract:
- `install()`: saves `globalThis.ResizeObserver` into `_prior`, then replaces it with a class whose constructor (a) assigns `this.cb = cb`, (b) creates `this.observe = jest.fn()` / `this.unobserve = jest.fn()` / `this.disconnect = jest.fn()`, (c) stores the instance in `shim.lastObserver` AND `shim.lastObserverCb = cb`, and (d) wires `this.disconnect` and `this.observe` to ALSO call `shim.disconnectMock` / `shim.observeMock` (so tests can assert via the shim handle without retrieving the instance).
- `fire(entries?, observer?)`: invokes `shim.lastObserverCb(entries ?? [], observer ?? (shim.lastObserver as unknown as ResizeObserver))`. Throws descriptively if `lastObserverCb` is null (shim not installed or component not mounted yet).
- `uninstall()`: restores `globalThis.ResizeObserver = _prior`. Also nulls `lastObserverCb` and `lastObserver`. Calls `disconnectMock.mockReset()` + `observeMock.mockReset()` so the next install starts clean.
- `reset()`: nulls `lastObserverCb` and `lastObserver` without restoring the global (useful in `beforeEach` within a describe block that uses `install()` once). Also `disconnectMock.mockReset()` + `observeMock.mockReset()`.

Verification (per /review-plan Codex P-C2): `npx tsc -p packages/web/tsconfig.json --noEmit` does NOT typecheck this file because `packages/web/tsconfig.json:37` excludes `src/__tests__/**`. The helper IS typechecked indirectly via ts-jest when any test imports it. Use this verification instead:
1. Write the helper file.
2. Immediately add an `import { createResizeObserverShim } from '../helpers/resizeObserverShim';` at the top of `TranscriptFeed.test.tsx` (used by Step 3 tests anyway).
3. Run `npm test -w @foodxplorer/web -- --testPathPattern=TranscriptFeed` — ts-jest will compile + typecheck both files; any `TS` error blocks the run.
4. Optionally (defense in depth): add a 1-line smoke test in the same file (`describe('resizeObserverShim sanity', () => { it('install/uninstall does not throw', () => { const s = createResizeObserverShim(); s.install(); s.uninstall(); }); });`) to ensure ts-jest exercises the public API even if the larger tests are skipped.

---

**Step 2 — Add `HYDRATION_RESCROLL_WINDOW_MS`, `wasNearBottomRef`, and `scroll` listener (refactor — no observable behavior change yet)**

File modified: `packages/web/src/components/TranscriptFeed.tsx`

Changes:
1. Add module-level constant after the import block: `const HYDRATION_RESCROLL_WINDOW_MS = 500;`
2. Add `wasNearBottomRef` declaration alongside `feedRef` (line 50 area): `const wasNearBottomRef = useRef<boolean>(true);` — initialized to `true` (user conventionally starts at bottom; AC7).
3. Add a `useEffect([], [])` (empty deps, runs once on mount) that:
   - Gets `container = feedRef.current`; if null, returns.
   - Defines `handleScroll = () => { wasNearBottomRef.current = container.scrollTop + container.clientHeight >= container.scrollHeight - 100; }`
   - Calls `container.addEventListener('scroll', handleScroll)`
   - Returns cleanup: `container.removeEventListener('scroll', handleScroll)`

RED tests to write FIRST (reference AC7 + AC13 teardown):

Test name: `"AC7: mounts a scroll listener on the feed container that updates wasNearBottomRef"`
- Strategy: spy on `feed.addEventListener` before render; assert it was called with `'scroll'` and a function.
- Note: because `feedRef` is internal, spy via `Object.defineProperty` on the rendered `feed` element returned by `screen.getByRole('feed')`. Use a `render(<TranscriptFeed .../>)` with `entries=[]`, get the feed element, spy, then trigger a rerender to get the effect to re-fire — or mount fresh with `addEventListener` already spied. Simpler: spy BEFORE render using `jest.spyOn(HTMLDivElement.prototype, 'addEventListener')`.

Test name: `"AC13a: scroll listener is removed on unmount"`
- Strategy: spy on `HTMLDivElement.prototype.removeEventListener`; render + unmount (`unmount()` from `render`); assert `removeEventListener` was called with `'scroll'`.

GREEN code: the `useEffect` described above. `prevEntriesLengthRef` declaration stays in place (still needed by the append effect for the `entryCountGrew` guard — it is NOT removed in this step).

Verification: `npm test -w @foodxplorer/web -- --testPathPattern=TranscriptFeed` — must stay green (no behavior change).

---

**Step 3 — Replace hydration `useEffect` with ResizeObserver-driven re-scroll loop (AC1–AC6)**

File modified: `packages/web/src/components/TranscriptFeed.tsx`

Remove lines 67–78 (the FU1 `useEffect([entries.length])` hydration scroll with `behavior: 'smooth'`). Replace with the following pattern — note that the observer + timer live in a `useRef` so the entries-length effect's React cleanup does NOT tear them down (P-C1 fix: any `entries.length` change during the 500ms window would otherwise run cleanup → re-run effect → guard-early-return → observer gone; this is why a single `useEffect` keyed to `entries.length` is structurally wrong here):

```typescript
// Module-scoped ref-typed handle for the observer + timer. Lives outside React's
// effect-cleanup cycle so loadMore prepends / session appends during the
// HYDRATION_RESCROLL_WINDOW_MS window cannot collapse it.
type HydrationHandle = { observer: ResizeObserver | null; timer: ReturnType<typeof setTimeout> | null };
const hydrationObserverRef = useRef<HydrationHandle>({ observer: null, timer: null });

// Effect 1 — setup, keyed to entries.length so it FIRES on first non-empty.
// Returns an EMPTY cleanup on purpose; teardown is owned by the timer + unmount effect.
useEffect(() => {
  if (entries.length === 0) return;
  if (hasScrolledToBottomOnHydrationRef.current) return;
  const container = feedRef.current;
  if (!container) return;
  hasScrolledToBottomOnHydrationRef.current = true;

  // First scroll (covers both branches — synchronous bottom-land before the observer would fire).
  try { container.scrollTo({ top: container.scrollHeight, behavior: 'instant' }); } catch { /* jsdom */ }

  if (typeof ResizeObserver === 'undefined') return; // AC5 fallback path — already scrolled above.

  const observer = new ResizeObserver(() => {
    try { container.scrollTo({ top: container.scrollHeight, behavior: 'instant' }); } catch { /* jsdom */ }
  });
  observer.observe(container);

  const timer = setTimeout(() => {
    observer.disconnect();
    hydrationObserverRef.current.observer = null;
    hydrationObserverRef.current.timer = null;
  }, HYDRATION_RESCROLL_WINDOW_MS);

  hydrationObserverRef.current.observer = observer;
  hydrationObserverRef.current.timer = timer;

  // Intentional: NO cleanup returned. Teardown is owned by the timer above + the unmount effect below.
}, [entries.length]);

// Effect 2 — unmount-only teardown. Guarantees no leak if the component unmounts mid-window.
useEffect(() => {
  return () => {
    const handle = hydrationObserverRef.current;
    if (handle.timer !== null) clearTimeout(handle.timer);
    if (handle.observer !== null) handle.observer.disconnect();
    handle.observer = null;
    handle.timer = null;
  };
}, []);
```

Why this shape (P-C1 + auditor refinements):
- The setup effect has NO React cleanup → React's effect re-run on `entries.length` change does not touch the observer.
- The observer disconnects ONLY via (a) the 500ms timer (success path) or (b) the unmount effect (defensive path).
- The hydration ref-guard prevents the setup body from running twice; on second `entries.length` change, the effect early-returns and observer keeps running until the timer fires.
- A synchronous `scrollTo({ behavior: 'instant' })` runs ONCE before installing the observer — this gives an initial bottom-land even in the AC5 fallback path (without ResizeObserver) and seeds the position before the observer's first re-fire.

RED tests to write FIRST (write before making the GREEN change above):

Test name: `"AC1: ResizeObserver is attached on hydration (observe + lastObserverCb both set)"`
- Install `resizeObserverShim` in `beforeEach` / `afterEach`.
- Render `<TranscriptFeed entries={[]} .../>`, install `scrollToMock` + mutable `scrollHeight` getter on the feed element.
- Rerender with `entries=[makeEntry('p1'), makeEntry('p2')]` → effect fires.
- Assert `shim.lastObserverCb !== null` (observer was constructed) AND `shim.observeMock` was called at least once with the feed element.

Test name: `"AC2: hydration scrollTo uses behavior:'instant' not 'smooth'"`
- Same setup; rerender. Assert the FIRST `scrollTo` call carries `{ behavior: 'instant' }` (the synchronous initial bottom-land), AND that every subsequent ResizeObserver re-fire also uses `'instant'`.

Test name: `"AC3: hasScrolledToBottomOnHydrationRef guard — observer survives subsequent entries.length changes within the window"`
- Per /review-plan Codex P-C1 fix: the observer lifecycle must NOT collapse on intermediate `entries.length` re-renders.
- Render with `entries=[]`; rerender with `entries=[p1]` → observer installed, `shim.disconnectMock` call count = 0.
- Rerender AGAIN with `entries=[oldEntry, p1]` (simulating a loadMore prepend arriving 100ms later, within the window).
- Assert `shim.disconnectMock` was NOT called (observer is still alive) AND `shim.lastObserverCb` is still the same reference (no new construction).
- This test would FAIL against the naïve `useEffect([entries.length])` shape (it would disconnect-then-recreate on each rerender) and PASSES against the ref-held shape.

Test name: `"AC4: race-aware — scrollTo is called again after ResizeObserver fires with grown scrollHeight"`
- Exactly as specified in AC4: rerender to hydrate (initial `scrollTo` fires with `currentScrollHeight = 1000`); mutate `currentScrollHeight = 1500`; invoke `shim.fire([{target: feed, contentRect: {} as DOMRectReadOnly, borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: []} as ResizeObserverEntry])`.
- Assert `scrollToMock` was called ≥2 times AND the LAST call carries `{ top: 1500, behavior: 'instant' }`.

Test name: `"AC5: fallback — when ResizeObserver is undefined, single-shot instant scroll fires (no throw)"`
- Within the test: `const prior = globalThis.ResizeObserver; delete (globalThis as any).ResizeObserver;` (do this BEFORE rendering; `shim.install()` is NOT called in this test).
- Render with `entries=[]`, install scrollTo mock, rerender with `entries=[p1]`.
- Assert `scrollToMock` called exactly once with `{ behavior: 'instant' }`. No throw.
- Restore: `globalThis.ResizeObserver = prior;` (in `afterEach` defensively).

Test name: `"AC6: no regression — sync-mount case (entries already populated on first render) lands at bottom with 'instant'"`
- Render directly with `entries=[p1, p2]` (no empty first render).
- Assert `scrollToMock` called at least once with `{ behavior: 'instant' }`.
- **NOTE on FU1 test edits:** the existing FU1 hydration tests at `TranscriptFeed.test.tsx:333`, `:355`, `:449` assert `behavior: 'smooth'` on hydration calls and MUST be updated to assert `behavior: 'instant'` (the FU1 behavior changed by this fix). The append-path tests at `:276` (AC47) and `:407` (AC11) must REMAIN `behavior: 'smooth'`. Codex /review-plan verified these line numbers empirically.

Verification: `npm test -w @foodxplorer/web -- --testPathPattern=TranscriptFeed` — all new RED tests green, no regressions.

---

**Step 4 — Replace append effect's post-commit `isNearBottom` math with `wasNearBottomRef` read (AC7–AC11)**

File modified: `packages/web/src/components/TranscriptFeed.tsx`

Remove lines 83–103 (the existing append effect with `isNearBottom = scrollTop + clientHeight >= scrollHeight - 100`). Replace with:

```
const prevEntriesLengthRef = useRef(entries.length);
useEffect(() => {
  const container = feedRef.current;
  if (!container) return;

  const entryCountGrew = entries.length > prevEntriesLengthRef.current;
  prevEntriesLengthRef.current = entries.length;

  if (!entryCountGrew) return;
  if (!wasNearBottomRef.current) return;   // pre-commit position captured by scroll listener

  try {
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  } catch {
    // jsdom does not implement element.scrollTo — safe to ignore in tests
  }
}, [entries.length]);
```

RED tests to write FIRST:

Test name: `"AC8: append effect reads wasNearBottomRef BEFORE DOM and calls scrollTo when true"`
- Render with `entries=[p1, p2]` (hydration fires, ref locks).
- Set `wasNearBottomRef` to `true` via simulating a scroll event on the feed element near the bottom (fire a `scroll` event after setting scrollTop/scrollHeight such that the listener computes `true`).
- Rerender with `entries=[p1, p2, new]` (entryCountGrew).
- Assert `scrollToMock` called with `{ behavior: 'smooth' }`.

Test name: `"AC9: race-aware — append scrolls even when post-commit scrollHeight has jumped >100px"`
- Set `wasNearBottomRef.current = true` via firing scroll event near bottom.
- Simulate the append: rerender; then immediately set `scrollHeight` to a value >100px higher than it was.
- Assert `scrollToMock` called (it consulted the ref, not the post-commit DOM math).

Test name: `"AC10: user scrolled up (≥100px from bottom) — append does NOT scroll"`
- After hydration, fire a `scroll` event with `scrollTop=0, scrollHeight=2000, clientHeight=500` → listener sets `wasNearBottomRef.current = false`.
- Rerender with new entry appended.
- Assert `scrollToMock` NOT called.

Test name: `"AC11: loadMore prepend does NOT trigger append auto-scroll (regression guard)"`
- This is the existing `AC10c` test scenario. Verify it still passes with the new code. The prepend-preservation effects at lines 107-125 are untouched; this test just confirms coexistence.

Note: the existing `AC47` test at line 250–277 asserts the append path with `behavior: 'smooth'` — this test should CONTINUE to pass and covers the basic append case. Update it only if it breaks due to the `wasNearBottomRef` change (it sets `scrollTop=400, clientHeight=500, scrollHeight=500`, which means `400+500 >= 500-100 = 400` → `900 >= 400` → near bottom → the scroll event listener will compute `true`). However, since the test does NOT fire a `scroll` event on the element, `wasNearBottomRef` remains at its initial value of `true` → `scrollTo` is still called. The existing test passes without modification.

Verification: `npm test -w @foodxplorer/web -- --testPathPattern=TranscriptFeed`

---

**Step 5 — AC12 coexistence test + AC13 ResizeObserver disconnect cleanup test**

File modified: `packages/web/src/__tests__/components/TranscriptFeed.test.tsx`

Test name: `"AC12: after hydration window closes, append path only runs wasNearBottomRef logic (no ResizeObserver stacking)"`
- Install `resizeObserverShim` in `beforeEach`.
- Set `jest.useFakeTimers()`.
- Render with `entries=[]`; rerender with `entries=[p1]` → observer installed; `shim.disconnectMock` call count = 0.
- `jest.advanceTimersByTime(HYDRATION_RESCROLL_WINDOW_MS + 1)` → 500ms timer fires → observer disconnect runs.
- Assert `shim.disconnectMock` was called once.
- Reset `scrollToMock.mockClear()`.
- Fire a `scroll` event on the feed element with `scrollTop=400, clientHeight=500, scrollHeight=900` → listener sets `wasNearBottomRef.current = true`.
- Rerender with `entries=[p1, new_session]` → append effect fires.
- Assert `scrollToMock` called exactly ONCE with `{ behavior: 'smooth' }` (the append path) — NOT twice (no observer re-fire because it's already disconnected).
- `jest.useRealTimers()` in `afterEach`.

Test name: `"AC13b: ResizeObserver disconnect is called on unmount (if still active)"`
- Install `resizeObserverShim` in `beforeEach`.
- Render `entries=[]`; rerender `entries=[p1]` → observer active (no timer fired yet).
- Capture `shim.lastObserver` reference into a local for assertion.
- Call `unmount()` (from `render()` return value).
- Assert the captured `lastObserver.disconnect` jest fn was called once AND `shim.disconnectMock` was called once (the shim aggregate matches the per-instance assertion).
- This proves the unmount-only cleanup effect (Effect 2 of Step 3) executed correctly.

Test name: `"AC13c: timer-fired teardown nulls the ref handle (no double-disconnect on subsequent unmount)"`
- Install `resizeObserverShim`. `jest.useFakeTimers()`.
- Render `entries=[]`; rerender `entries=[p1]` → observer active.
- `jest.advanceTimersByTime(HYDRATION_RESCROLL_WINDOW_MS + 1)` → timer fires, observer disconnects (`disconnectMock` count = 1).
- Call `unmount()`.
- Assert `shim.disconnectMock` count is STILL 1 (the unmount effect saw `handle.observer === null` and skipped the call). Prevents `Cannot read property 'disconnect' of null` regressions if the impl forgets the null-check.

Test name: `"AC13a: scroll listener removeEventListener called on unmount"` — already written in Step 2; confirm it passes alongside the new AC13b + AC13c.

Verification: `npm test -w @foodxplorer/web -- --testPathPattern=TranscriptFeed`

---

**Step 6 — Update `docs/specs/ui-components.md` per AC14 (widened per /review-plan Codex P-C3)**

File modified: `docs/specs/ui-components.md`

**Three stale assertions to fix (all in the TranscriptFeed section, ~lines 2460-2484):**

1. **Props row (line ~2475)** — Codex empirically verified: spec says `onNudgeDismiss` but `TranscriptFeed.tsx:28` (the `interface TranscriptFeedProps`) declares `onDismissPersistenceNudge: () => void`. Spec is wrong.
2. **State block (line ~2477)** — the buggy `shouldAutoScroll: boolean — true when scrollTop + clientHeight >= scrollHeight - 100. Checked before each append.` definition. Spec describes the bug, not the fix.
3. **Accessibility block (line ~2480)** — Codex empirically verified: spec says `aria-busy={isLoadingMore}` but `TranscriptFeed.tsx:135` uses `aria-busy={isLoadingHistory ? true : undefined}`. Spec is wrong; FU2 will not modify this attribute, but the doc sync must correct it to match what the component already does.

**Edit 1 — Props row.** Change `onNudgeDismiss` → `onDismissPersistenceNudge` in the row that currently reads:
```markdown
| `onNudgeDismiss` | `() => void` | No | — | Dismiss callback for HistoryPersistenceNudge. |
```
to:
```markdown
| `onDismissPersistenceNudge` | `() => void` | No | — | Dismiss callback for HistoryPersistenceNudge. |
```

**Edit 2 — replace ENTIRE `**State:**` block.** From:
```markdown
**State:**
- `shouldAutoScroll: boolean` — true when `scrollTop + clientHeight >= scrollHeight - 100`. Checked before each append.
```
to:
```markdown
**State (internal refs):**
- `wasNearBottomRef: MutableRefObject<boolean>` — initialized `true`; updated by a `scroll` event listener on the feed container capturing the user's position BEFORE each append commits. The append effect reads this ref unconditionally; no post-commit DOM math.
- `hasScrolledToBottomOnHydrationRef: MutableRefObject<boolean>` — ref-guard ensuring the hydration scroll fires at most once per component lifetime.
- `prevEntriesLengthRef: MutableRefObject<number>` — tracks previous `entries.length` to detect appends vs. prepends.
- `hydrationObserverRef: MutableRefObject<{ observer, timer } | nulls>` — holds the `ResizeObserver` instance + window timer outside React's effect cleanup cycle (prevents premature disconnect on intermediate `entries.length` changes during the 500ms hydration window).
```

**Edit 3 — insert new `**Behavior:**` block** immediately after `**State (internal refs):**` and BEFORE `**Accessibility:**`:
```markdown
**Behavior:**
- **Hydration scroll (Bug 1 fix):** On first non-empty `entries` render, fires a synchronous `scrollTo({ behavior: 'instant' })` then attaches a `ResizeObserver` to the feed container for `HYDRATION_RESCROLL_WINDOW_MS` (500ms). Every time the container's `scrollHeight` grows within that window, the instant re-scroll re-fires (W18: "no animation on initial mount"). After 500ms the observer disconnects via its own timer; the observer survives intermediate `entries.length` changes within the window (held in a ref, not a `useEffect` cleanup). Fallback: when `typeof ResizeObserver === 'undefined'`, only the synchronous initial scroll fires.
- **Append auto-scroll (Bug 2 fix):** When `entries.length` grows, the append effect reads `wasNearBottomRef.current` (pre-commit position captured by a `scroll` listener on the container) and calls `scrollTo({ behavior: 'smooth' })` only when `true`. No post-commit `scrollHeight` math; decoupled from layout race.
- **LoadMore prepend preservation:** When `isLoadingMore` transitions `true → false`, the existing prepend-preservation effect restores `scrollTop` to maintain the user's viewport anchor.
```

**Edit 4 — Accessibility row** — change `aria-busy={isLoadingMore}` → `aria-busy={isLoadingHistory ? true : undefined}` to match `TranscriptFeed.tsx:135`. Reason: the doc was stale pre-FU2; this is a drive-by doc-sync correction, not an FU2 behavior change.

**Leave the rest of the section untouched** (the iOS `-webkit-overflow-scrolling` note in Accessibility, the `Props` table header + other rows, the AC32 / AC34 / AC37 / AC45 / AC46 / AC47 comments — none changed).

**NOTE on AC15:** `docs/specs/design-guidelines.md` W18 is reaffirmed as authoritative WITHOUT modification. W18 already states "the feed then scrolls to the bottom immediately on mount (no animation …)" — this is consistent with `behavior: 'instant'` as implemented. No edit to `design-guidelines.md` is required or permitted. The Completion Log row for AC15 must read: `"N/A — cross-link only; W18 (design-guidelines.md:1443) reaffirmed authoritative without edit; ui-components.md TranscriptFeed Props+State+Behavior+Accessibility updated per AC14."` The MCE table row for AC15 should ALSO read N/A — do NOT leave it as `[ ]` (per owner directive on AC15 N/A handling).

**Verification:**
1. `grep -n "shouldAutoScroll\|onNudgeDismiss\|isLoadingMore" docs/specs/ui-components.md` — must return ZERO matches inside the TranscriptFeed section after the edits.
2. `grep -n "wasNearBottomRef\|hydrationObserverRef\|HYDRATION_RESCROLL_WINDOW_MS" docs/specs/ui-components.md` — must show the new entries inserted.
3. `git diff docs/specs/ui-components.md` — visually confirm scope is contained to the TranscriptFeed section (no accidental edits elsewhere).

---

**Step 7 — Full suite + lint + typecheck + build; record counts**

Commands (in order):

1. `npm test -w @foodxplorer/web` — must be green; record final test count (baseline 745 + delta from new tests). Document in Completion Log.
2. `npm run lint -w @foodxplorer/web` — zero new lint errors.
3. `npx tsc -p packages/web/tsconfig.json --noEmit` — zero type errors.
4. `npm run build -w @foodxplorer/web` — clean build.

Note on `>500ms post-window settle escalation`: if operator AC19 surfaces a repeatable case where `scrollHeight` is still growing >500ms after hydration (very slow font / lazy image load on a real device), escalate to F-WEB-HISTORY-FU3. Do NOT widen the `HYDRATION_RESCROLL_WINDOW_MS` window inside this PR — the constant is intentionally a named value to make that future change traceable.

---

### Out of Scope

- New ADR (no architectural decision; this is a targeted frontend fix).
- Any modification to `packages/web/src/hooks/useSearchHistory.ts` or `packages/web/src/components/HablarShell.tsx` or any consumer.
- The loadMore prepend-preservation effects (`TranscriptFeed.tsx` lines 107-125 pre-FU2 numbering) — must remain untouched.
- `ResizeObserver` polyfill for production browsers (all target browsers support it natively since 2020+; AC5 fallback is for older/unshimmed test environments only).
- Backend changes (none).
- Indefinite observer window (do not replace `HYDRATION_RESCROLL_WINDOW_MS` with an always-on observer — it leaks and overrides user intent after initial load).

---

### Verification commands run

- `Read: packages/web/src/components/TranscriptFeed.tsx:1-186` → confirmed current production code (develop@172fb23): hydration effect at lines 67-78 uses `behavior: 'smooth'`; append effect at lines 83-103 uses post-commit `isNearBottom = scrollTop + clientHeight >= scrollHeight - 100`; loadMore effects at lines 107-125; no `wasNearBottomRef`, no `HYDRATION_RESCROLL_WINDOW_MS`, no `ResizeObserver` → confirms both bugs exist in the file to be modified; line numbers cited in Plan are accurate.
- `Read: packages/web/src/__tests__/components/TranscriptFeed.test.tsx:1-452` → confirmed existing test patterns: `installScrollMocks` helper (lines 306-316) uses `Object.defineProperty` for scroll properties; AC10b test at line 336 asserts `behavior: 'smooth'` (MUST be updated to `'instant'` in Step 3); AC13 test at line 438 asserts `behavior: 'smooth'` for the hydration path (MUST also be updated to `'instant'`); AC47 test at line 250 asserts `behavior: 'smooth'` for the append path (must REMAIN `'smooth'`); `AC12` test at line 411 tests scroll-up-no-scroll using post-commit DOM math (needs revision for `wasNearBottomRef` path) → Plan Step 4 accounts for all affected existing tests.
- `Read: packages/web/jest.setup.ts:226-236` → confirmed `ResizeObserver` stub at lines 228-236: installed conditionally (`if (typeof globalThis.ResizeObserver === 'undefined')`); the stub is a no-op class (observe/unobserve/disconnect are jest.fn()); the callback is NEVER captured or fired → confirms the no-op stub does not interfere with the new controllable shim (shim's `install()` will override `globalThis.ResizeObserver` for targeted tests and `uninstall()` restores the no-op stub).
- `Bash: ls packages/web/src/__tests__/` → directory contains `api/`, `auth/`, `components/`, `config/`, `hooks/`, `lib/` subdirectories plus root-level `fixtures.ts` and `fixtures.auth.ts`; NO `helpers/` subdirectory exists → Plan correctly specifies creating `packages/web/src/__tests__/helpers/resizeObserverShim.ts` in a new `helpers/` subdirectory.
- `Bash: grep -rn "ResizeObserver" packages/web/src/__tests__/` → no matches → confirms no prior ResizeObserver test helper exists anywhere in `__tests__`; new helper is novel, not duplicating existing code.
- `Read: docs/specs/ui-components.md:2460-2484` → confirmed TranscriptFeed spec entry: `**State:**` block at line 2477 reads `shouldAutoScroll: boolean — true when scrollTop + clientHeight >= scrollHeight - 100. Checked before each append.` — this is the exact stale line AC14 requires replacing. `**Props:**` table at lines 2465-2475 and `**Accessibility:**` at lines 2480-2482 are untouched. Exact line range: 2460-2484.
- `Read: docs/specs/design-guidelines.md:1439-1484` → confirmed W18 at line 1443 reads: "The feed then scrolls to the bottom immediately on mount (no animation — the initial position should feel like arriving at the current state, not replaying history)." → W18 is fully consistent with `behavior: 'instant'`; no edit needed; AC15 is "N/A — cross-link only" as directed by owner.
- `Read: packages/web/src/hooks/useSearchHistory.ts:1-143` → confirmed hook interface and reconciliation pattern; no changes to this file; entries hydrate asynchronously via `setPersistedEntries` in the mount fetch promise → the `[] → [N entries]` async hydration path is confirmed.
- `Read: packages/web/src/components/HablarShell.tsx:120-220` → confirmed reconciliation effect at lines 139-145 fires on `persistedIdsKey` change (not on every render); confirms session entries (`isPersisted: false`) preserved below persisted entries; no changes to this file.
- `Bash: grep -n "ResizeObserver\|wasNearBottom\|HYDRATION_RESCROLL" packages/web/src/components/TranscriptFeed.tsx` → zero matches → confirms no FU2 artifacts pre-exist in the file; Plan starts from clean state.
- `Read: ai-specs/specs/frontend-standards.mdc:35` → confirmed naming convention: constants are UPPER_SNAKE_CASE → `HYDRATION_RESCROLL_WINDOW_MS` is correct.
- `Bash: find packages/web -name "jest.setup*" -o -name "jest.config*"` → found `packages/web/jest.setup.ts` and `packages/web/jest.config.js` → setup file confirmed; no secondary setup files that might double-install ResizeObserver.

---

## Completion Log

| Date | Step | Notes |
|------|------|-------|
| 2026-06-02 | Step 0 (Spec draft) | Ticket created post-/compact per owner's context-prompt. Spec drafted from `project_bug_web_feed_scroll_settle` + `feedback_jsdom_layout_ac_gap` memories + auditor refinements 2026-06-02 (ResizeObserver as PRIMARY not ALT; mandatory race-aware test pattern; `wasNearBottomRef` via scroll listener canonical pattern). Branch `bugfix/web-feed-scroll-settle` off develop `172fb23` already cut. bugs.md entry BUG-WEB-FEED-SCROLL-SETTLE-001 added. Tracker Active Session + Features row updated. |
| 2026-06-02 | Step 0 (`/review-spec` cross-model) | Gemini → **APPROVED** (1 SUGGESTION = named constant). Codex → **REVISE** (3 IMPORTANT, all empirically grounded by reading TranscriptFeed.tsx + ui-components.md + design-guidelines.md + base-standards). All 4 findings APPLIED in commit (next): AC4 rewritten with controllable observer-shim handle pattern (C1); AC14+AC15 added for canonical ui-components.md sync + W18 cross-link (C2); Edge Cases + AC5 normalized to `behavior: 'instant'` (C3); HYDRATION_RESCROLL_WINDOW_MS named constant deferred to Step 2 Plan (Gemini S1). Operator ACs renumbered AC17-19 → AC19-21 to accommodate new D section. Review artifacts in `/tmp/review-spec-foodXPlorer-FU2/`. |
| 2026-06-02 | Step 0 (Spec sign-off) | Owner APPROVED Spec via AskUserQuestion + 4 Plan-side directives: (1) AC15 marked N/A in MCE (cross-link only, no edit); (2) ResizeObserver shim must be reusable helper at `packages/web/src/__tests__/helpers/resizeObserverShim.ts`; (3) AC14 ~line range is NIT-documentary, OK with ~; (4) >500ms post-window settle escalation to FU3 (don't widen window inside FU2). |
| 2026-06-02 | Step 2 (Plan draft) | `frontend-planner` agent produced Implementation Plan (Design Notes, 7 Frontend Plan steps, Out of Scope, Verification commands run). All 4 owner directives reflected in Plan. Helper API + helper subdirectory choice (`__tests__/helpers/`) confirmed not previously existing. Plan grounded empirically: TranscriptFeed.tsx + .test.tsx + jest.setup.ts ResizeObserver no-op stub + ui-components.md:~2477 stale shouldAutoScroll line + design-guidelines.md:1443 W18 verified verbatim. |
| 2026-06-02 | Step 2 (`/review-plan` cross-model) | Gemini → **APPROVED** (no findings; empirically grounded — re-verified test line numbers 333/355/449 + helpers/ dir absence + jest.setup.ts ResizeObserver shim). Codex → **REVISE** (3 IMPORTANT, all empirically grounded against the actual codebase): P-C1 hydration observer lifecycle wrong (effect keyed to entries.length → cleanup-on-re-fire collapses observer within window) — required ref-held observer pattern with empty effect cleanup; P-C2 helper verification step invalid (tsconfig excludes src/__tests__) + helper API missing `lastObserver`/`disconnectMock` for AC13 — required ts-jest verification path + extended shim shape; P-C3 AC14 under-scoped (ui-components.md TranscriptFeed Props row `onNudgeDismiss`→`onDismissPersistenceNudge` + Accessibility row `aria-busy={isLoadingMore}`→`aria-busy={isLoadingHistory}` stale beyond the State block). All 3 findings APPLIED in commit (next): Design Notes coexistence bullet rewritten; Step 1 helper API extended + verification switched to npm test ts-jest path; Step 3 hydration effect rewritten with ref-held observer + separate unmount effect + synchronous initial `'instant'` scroll; Step 3 RED tests updated (AC1 split into observe/cb assertion + AC3 rewritten to assert observer SURVIVES intermediate entries.length changes); Step 5 AC12/AC13 tests use disconnectMock + add AC13c double-disconnect guard; Step 6 widened to 4 edits (Props + State + Behavior + Accessibility). Review artifacts in `/tmp/review-plan-foodXPlorer-FU2/`. |

| 2026-06-02 | Step 3 (TDD Implement) | **Tests:** 745 baseline + 16 new = 761 total (all green). **Lint:** clean. **Typecheck:** clean. **Build:** clean. **Files modified:** `packages/web/src/__tests__/helpers/resizeObserverShim.ts` (new), `packages/web/src/__tests__/components/TranscriptFeed.test.tsx` (+16 tests, 3 FU1 hydration assertions updated smooth→instant, 4 FU1 tests updated with scroll event dispatch), `packages/web/src/components/TranscriptFeed.tsx` (HYDRATION_RESCROLL_WINDOW_MS constant, wasNearBottomRef, scroll listener, ResizeObserver hydration effect with ref-held handle, unmount cleanup effect, append effect wasNearBottomRef), `docs/specs/ui-components.md` (TranscriptFeed: Props onNudgeDismiss→onDismissPersistenceNudge, State block replaced, new Behavior block, Accessibility aria-busy corrected). **AC15:** N/A — cross-link only; W18 (design-guidelines.md:1443) reaffirmed authoritative without edit. **Deviations from Plan:** (1) FU1 tests AC10b + AC10c + AC12 + AC13 required `feed.dispatchEvent(new Event('scroll'))` calls before test rerenders where user-is-far-from-bottom is the precondition — the old isNearBottom post-commit math suppressed scroll silently; wasNearBottomRef requires explicit scroll events to set state. This is semantically correct (matches real browser behavior) and does not deviate from the implementation spec. (2) Step 5 tests AC12/AC13b/AC13c passed GREEN immediately (no RED phase) — the lifecycle was already correct after Step 3 implementation; these are confirmatory tests. Noted for review. |
| 2026-06-02 | Step 5 (code-review + qa + fix-loop) | **code-review-specialist:** APPROVE WITH MINOR CHANGES — 2 MAJOR + 5 MINOR/NIT findings. **qa-engineer:** PASS WITH FOLLOW-UPS — 1 P3 BUG + 3 P4 suggestions; QA added `TranscriptFeed.edge-cases.test.tsx` (+10 tests covering deletion, clear-all, shim defensive cases, scroll-during-window, rapid loadMore+append). **Applied in fix-loop:** (a) MAJOR-1 Strict Mode reset — Effect 2 cleanup now resets `hasScrolledToBottomOnHydrationRef = false` so React 18 dev mount→cleanup→mount cycle correctly re-installs observer on remount (prod next-start unaffected; was a dev-only break). (b) MINOR-1 + P4 — `HYDRATION_RESCROLL_WINDOW_MS` + `HydrationHandle` type moved below imports to module scope. (c) MINOR-2 — `| nulls>` typo in ui-components.md:2481 fixed to full type signature `{ observer: ResizeObserver \| null; timer: ReturnType<typeof setTimeout> \| null }`. (d) MINOR-3 — unnecessary `eslint-disable-next-line react-hooks/exhaustive-deps` removed (deps array was complete). (e) P3 BUG-SHIM-UNINSTALL-001 — `_installed: boolean` guard added to `resizeObserverShim.uninstall()`; FIXED status logged in bugs.md. **Deferred to FU3:** MAJOR-2 (append double-fire on hydration). Initial implementation (`isHydrationWindowActive` via `observer !== null`) broke 7 valid append-path tests because it blocked ALL appends during the 500ms window, not just the hydration commit. A surgically precise fix would require a render-scoped flag (Effect 1 sets, Effect 3 reads+resets) — significant test surgery for a "currently benign no-op" concern (Effect 3's `smooth` scroll targets the same scrollHeight as Effect 1's `instant` and is optimized to no-op by browsers). ResizeObserver re-fires within the window guarantee correctness either way. Documented as in-source comment + Completion Log entry. **Skipped (acceptable as-is):** NIT-2 (`as unknown as ResizeObserver` cast in shim — known shim pattern, JSDoc covers intent), NIT-3 (`@ts-expect-error` directives in shim — narrowly scoped). **Post fix-loop gates:** Tests 745 baseline + 16 FU2 + 10 QA edge = **771/771** green; Lint: 0; Typecheck: 0; Build: clean. Review artifacts captured. |
| 2026-06-02 | Step 5 (/audit-merge) | 12/12 structural PASS (with 2 documented partials: AC 17/21 = 4 deferred per ticket design — AC15 N/A + AC19-21 op-pending; DoD 4/7 = 3 post-merge gates) + 14/16 drift PASS + 2 N/A + 1 ADVISORY P5 systemic pre-existing (53 frozen tickets — out of scope for this PR; tracked in `project_fweb_history_followups` memory). P9 false-positive caught + fixed inline (commit `d9e453c` — stale `Active Feature:` line referenced F-WEB-HISTORY 62/65 ACs and was extracted as a step number; refreshed to F-WEB-HISTORY-FU2 5/6). Combined verdict: **READY FOR MERGE**. |
| 2026-06-02 | Step 6 (PR + CI + merge + closeout) | PR #304 opened to develop. CI failure 1: `npm ci` rejected lockfile because `@types/react` resolved to 18.3.30 while lockfile pinned 18.3.29 (same drift pattern as develop@`2eed8ac`). Fix: `npm install --package-lock-only` regenerated 3-line bump in commit `b4c3a72`. CI re-ran: ci-success SUCCESS + mergeStateStatus CLEAN. Owner external-audit APPROVE (verified PR state + Bug 1+2 fix rigor + Strict Mode catch + race-aware tests + shim guard + AC14 doc-sync + FU1 loadMore preservation intact; flagged 1 IMPORTANT meta-finding: audit ran pre-PR so C12 was N/A "no PR open" — for future audits run post-push). Squash-merged to develop **`be7ebcf`** at 2026-06-02 12:05Z. Remote branch deleted via `--delete-branch`. Closeout PR (this PR) flips ticket Status `Ready for Merge → Done`, marks Workflow Step 6 [x] + DoD post-merge bullets [x] + MCE Action 1 row updated with squash SHA, updates tracker Active Session + Features row in-progress→done 5/6→6/6, stamps `bugs.md` BUG-WEB-FEED-SCROLL-SETTLE-001 FIXED @ `be7ebcf`. **Pending post-deploy:** operator AC19+AC20+AC21 browser smokes on app-dev (Bug 1 reload×3 + Bug 2 append near/far + FU1 AC10c loadMore prepend preservation); release develop→main remains ON HOLD until those reconfirm. |

---

## Merge Checklist Evidence

| # | Action | Status | Evidence |
|---|--------|--------|----------|
| 0 | Pre-flight check | [x] | Branch `bugfix/web-feed-scroll-settle` off develop `172fb23` (verified clean ancestor). Status header updated `Spec → Ready for Merge`. |
| 1 | Acceptance Criteria all marked | [x] | A/B/C/D = 16/16 marked `[x]` pre-merge. **AC15 = N/A** (cross-link only; `design-guidelines.md:1443` W18 reaffirmed without edit per owner directive). **F (operator) AC19/AC20/AC21 deliberately remain `[ ]`** — per `feedback_jsdom_layout_ac_gap` lesson these MUST stay unmarked until post-deploy browser smoke; not a structural fault. Total: 18/21 marked (3 op pending). |
| 2 | Definition of Done all marked | [x] | 6/7 DoD items now `[x]` (Step 6 closeout flipped: bugs.md FIXED + tracker sync + FU1 not modified). 1 item (release develop→main gate) remains `[ ]` pending operator AC19+AC20+AC21 browser smokes on app-dev. |
| 3 | Workflow Checklist Steps 0-5 complete | [x] | 0/1/2/3/4/5/6 all `[x]` post-closeout. Step 6 stamped with `be7ebcf` + remote branch deleted. |
| 4 | Completion Log per-step rows | [x] | 9 rows covering Step 0 (×3) + Step 2 (×2) + Step 3 + Step 5 (×2 including /audit-merge) + Step 6 (PR/CI/merge/closeout). |
| 5 | Product Tracker sync (Active Session + Features) | [x] | `product-tracker.md` Active Session shows F-WEB-HISTORY-FU2 DONE 6/6 squash `be7ebcf`. Features table row flipped `in-progress 5/6 → done 6/6`. |
| 6 | key_facts.md sync (N/A) | [x] | N/A — no new models/endpoints/schemas/shared utilities. The new `resizeObserverShim.ts` is a test-only helper, not production infrastructure. |
| 7 | bugs.md sync | [x] | BUG-WEB-FEED-SCROLL-SETTLE-001 stamped **FIXED in code @ `be7ebcf`** (operator AC19/AC20/AC21 reverify still pending — release develop→main remains ON HOLD until those reconfirm). BUG-SHIM-UNINSTALL-001 (discovered + fixed in this PR's Step 5 fix-loop) marked FIXED with commit reference. |
| 8 | Tests / lint / typecheck / build | [x] | **Tests:** 745 baseline + 16 FU2 + 10 QA edge = **771/771** green (jest, 4.1s). **Lint:** zero warnings/errors (`next lint`). **Typecheck:** zero (`tsc --noEmit`). **Build:** clean (Next.js 15). All gates re-confirmed post fix-loop. |
| 9 | Cross-model + reviewer + audit-merge trail | [x] | `/review-spec` (Gemini APPROVED + Codex REVISE 3 IMPORTANT, all 4 findings applied: AC4 shim handle, AC14+15 doc-sync, Edge Cases instant). `/review-plan` (Gemini APPROVED + Codex REVISE 3 IMPORTANT, all applied: P-C1 ref-held lifecycle, P-C2 helper API extended, P-C3 doc-sync widened to 4 edits). code-review-specialist APPROVE WITH MINOR CHANGES (2 MAJOR + 5 MINOR/NIT; MAJOR-1 + 4 MINORs applied + MAJOR-2 deferred to FU3 with rationale). qa-engineer PASS WITH FOLLOW-UPS (+10 edge-case tests added; 1 P3 BUG fixed inline). `/audit-merge` to follow. Review artifacts: `/tmp/review-spec-foodXPlorer-FU2/`, `/tmp/review-plan-foodXPlorer-FU2/`. |
