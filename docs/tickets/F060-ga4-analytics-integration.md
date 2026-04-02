# F060: GA4 Analytics Integration Fix

**Feature:** F060 | **Type:** Frontend-Bugfix | **Priority:** High (launch blocker)
**Status:** Ready for Merge | **Branch:** feature/F060-ga4-analytics-integration
**Created:** 2026-03-29 | **Dependencies:** GA4 Property created (G-X46WMF1NM5)
**Audit Source:** `docs/research/landing-audit-2026-03-29.md` — Finding I1

---

## Spec

### Description

The GA4 analytics integration is non-functional. Two independent auditor models (Claude, Codex) confirmed that custom events are not reaching the GA4 dashboard due to an integration mismatch.

**Problem 1: dataLayer.push() vs gtag()**

`trackEvent()` in `analytics.ts:14` pushes events to `window.dataLayer` as plain objects (GTM event format):
```js
window.dataLayer.push({ event: 'landing_view', variant, lang: 'es', ... });
```

But the page loads gtag.js (`googletagmanager.com/gtag/js?id=G-X46WMF1NM5`), not a full GTM container. gtag.js only processes events sent via `gtag('event', 'name', {params})`. Raw dataLayer pushes in GTM format are ignored by gtag.js.

**Result:** All 9 custom events (landing_view, variant_assigned, scroll_depth, section_view, hero_cta_click, waitlist_cta_click, waitlist_submit_start, waitlist_submit_success, waitlist_submit_error) are pushed to dataLayer but never sent to GA4.

**Problem 2: Events fire before consent/GA4 initialization**

`landing_view` and `variant_assigned` fire in HeroSection's `useEffect` on first render. But GA4 only initializes after the user accepts cookies (CookieBanner). For users who accept cookies after viewing the hero, these two events are lost because `window.gtag` doesn't exist yet.

### Design: Queue + Replay + Consent Gate

**`trackEvent()` logic (priority order):**
1. If no `NEXT_PUBLIC_GA_MEASUREMENT_ID` env var → `console.debug` and return (development mode)
2. If `window.__nxConsentDenied === true` → drop event silently (user rejected cookies)
3. If `window.gtag` exists → call `window.gtag('event', payload.event, restOfPayload)` directly
4. Else → push `payload` to `window.__nxEventQueue` (capped at 50 items, FIFO overflow)

**Queue type:** `window.__nxEventQueue: AnalyticsEventPayload[]` — stores the full payload objects. On replay, each is transformed to `gtag('event', payload.event, params)`.

**New exports from `analytics.ts`:**
- `drainEventQueue()` — called by CookieBanner after GA4 init. Replays all queued events via `gtag('event', ...)` and clears the queue.
- `clearEventQueue()` — called by CookieBanner on reject. Clears the queue and sets `window.__nxConsentDenied = true` so future events are dropped.

**CookieBanner integration:**
- `handleAccept` → GA4 loads → `onLoad` callback calls `drainEventQueue()`
- `handleReject` → calls `clearEventQueue()` (no GA4 loaded, queue discarded, flag set)

**Window interface augmentation** in `analytics.ts`:
```ts
declare global {
  interface Window {
    __nxEventQueue?: AnalyticsEventPayload[];
    __nxConsentDenied?: boolean;
  }
}
```

This solves both problems:
- Events always go through `gtag()` (Problem 1)
- Pre-consent events are queued and replayed when GA4 loads (Problem 2)
- Users who reject cookies have queue cleared + flag set (GDPR compliant)
- Dev mode gets console.debug, not silent queuing
- Adblocker scenario: queue capped at 50 items

### Files to Modify

| File | Change |
|------|--------|
| `packages/landing/src/lib/analytics.ts` | Replace `dataLayer.push()` with `gtag()` call or queue. Export `drainEventQueue()`. |
| `packages/landing/src/components/analytics/CookieBanner.tsx` | Call `drainEventQueue()` after GA4 initializes in `onLoad` callback. |

Note: HeroSection.tsx does NOT need changes — the queue in analytics.ts handles pre-consent events transparently.

### Edge Cases & Error Handling

- **User never accepts cookies**: Queue capped at 50 items. Never replayed. Memory bounded.
- **User rejects cookies**: `clearEventQueue()` clears queue + sets `__nxConsentDenied = true`. All future `trackEvent()` calls are dropped silently.
- **User rejects then later accepts** (via "Gestionar cookies" link from F059): Page reloads on consent change, so `__nxConsentDenied` resets. Fresh session, clean state.
- **gtag becomes available after events queued**: `drainEventQueue()` replays them all in FIFO order.
- **Development mode (no GA_ID)**: `trackEvent()` checks env var first → `console.debug` and return, never queues.
- **Adblocker blocks gtag.js**: `window.gtag` never defined. Queue fills to 50-cap and stops growing. Events lost but no error.
- **Multiple rapid calls to `drainEventQueue()`**: Idempotent — after first drain, queue is empty.
- **SSR**: `trackEvent()` already guards with `typeof window === 'undefined'` check.

---

## Implementation Plan

### Existing Code to Reuse

**Types**
- `AnalyticsEventPayload` from `packages/landing/src/types/index.ts` — already typed with index signature `[key: string]: unknown`, suitable as queue element type without modification.

**Utilities / lib**
- `getUtmParams()` in `packages/landing/src/lib/analytics.ts` — untouched, no changes needed.
- `deleteGaCookies()` in `packages/landing/src/lib/deleteGaCookies.ts` — already called by `handleReject`, no changes needed.
- `safeGetItem` / `safeSetItem` helpers in `CookieBanner.tsx` — already in place, no changes needed.
- `CONSENT_KEY` export in `CookieBanner.tsx` — already exported in F059, no changes needed.

**Components**
- `CookieBanner` in `packages/landing/src/components/analytics/CookieBanner.tsx` — modify (do not recreate).

**Tests**
- `packages/landing/src/__tests__/analytics.test.ts` — extend with new describe blocks; do not delete existing tests.
- `packages/landing/src/__tests__/CookieBanner.test.tsx` — extend with new describe blocks; do not delete existing tests (552+ tests must remain passing).

---

### Files to Create

None. This feature touches exactly two implementation files and their existing test files.

---

### Files to Modify

| File | Changes |
|------|---------|
| `packages/landing/src/lib/analytics.ts` | Replace `Window` augmentation (add `__nxEventQueue`, `__nxConsentDenied`; remove `dataLayer`). Rewrite `trackEvent()` with 4-branch logic. Add `drainEventQueue()` export. Add `clearEventQueue()` export. |
| `packages/landing/src/components/analytics/CookieBanner.tsx` | Import `drainEventQueue` and `clearEventQueue` from `@/lib/analytics`. Call `drainEventQueue()` inside the `onLoad` callback after `window.gtag('config', GA_ID)`. Call `clearEventQueue()` inside `handleReject()`. |
| `packages/landing/src/__tests__/analytics.test.ts` | Replace obsolete `dataLayer` tests. Add new `describe` blocks for `trackEvent` (new behaviour), `drainEventQueue`, and `clearEventQueue`. |
| `packages/landing/src/__tests__/CookieBanner.test.tsx` | Add new `describe` block — "CookieBanner — queue integration (F060)" — testing that `drainEventQueue` is called on accept and `clearEventQueue` is called on reject. |

---

### Implementation Order

Follow TDD strictly: write the failing test first, then write the minimum implementation to make it pass, then move to the next slice.

**Phase 1 — `analytics.ts` changes**

1. `packages/landing/src/__tests__/analytics.test.ts` — **Test slice 1A: new `trackEvent` behaviour**
   - Remove/replace the three existing `dataLayer` tests (they test the old broken behaviour).
   - Add `describe('trackEvent — dev mode (no GA_ID)', ...)`:
     - When `NEXT_PUBLIC_GA_MEASUREMENT_ID` is not set: `trackEvent` calls `console.debug` and returns.
     - When `NEXT_PUBLIC_GA_MEASUREMENT_ID` is not set: `trackEvent` does NOT push to any queue.
   - Add `describe('trackEvent — consent denied flag', ...)`:
     - When `window.__nxConsentDenied === true`: event is dropped silently (no `console.debug`, no queue push, no `gtag` call).
   - Add `describe('trackEvent — gtag available', ...)`:
     - When `window.gtag` is defined and GA_ID is set: calls `window.gtag('event', payload.event, { variant, lang, ... })` (the `event` key is NOT passed as a parameter, only as the event name argument).
     - Does NOT push to `window.__nxEventQueue`.
   - Add `describe('trackEvent — queue path', ...)`:
     - When `window.gtag` is undefined and GA_ID is set: payload is pushed to `window.__nxEventQueue`.
     - Queue is created as an empty array if it does not yet exist.
     - Queue is capped at 50 items; the 51st call does not grow the queue (FIFO: oldest item dropped).
     - Does NOT call `console.debug`.

2. `packages/landing/src/lib/analytics.ts` — **Implement slice 1A**
   - Replace `Window` augmentation: remove `dataLayer: unknown[]`, add `__nxEventQueue?: AnalyticsEventPayload[]` and `__nxConsentDenied?: boolean`. Keep `gtag?: (...args: unknown[]) => void`.
   - Rewrite `trackEvent()` with the four-branch priority order from the spec:
     1. `if (!process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID)` → `console.debug` + return.
     2. `if (window.__nxConsentDenied === true)` → return.
     3. `if (window.gtag)` → destructure `{ event: eventName, ...params }` from payload, call `window.gtag('event', eventName, params)`.
     4. Else → push to `window.__nxEventQueue`; initialise array if needed; enforce 50-item cap by shifting the oldest item when length would exceed 50.
   - Keep the existing `typeof window === 'undefined'` SSR guard at the top (before any branch).

3. `packages/landing/src/__tests__/analytics.test.ts` — **Test slice 1B: `drainEventQueue`**
   - Add `describe('drainEventQueue', ...)`:
     - When queue has items and `window.gtag` is defined: calls `gtag('event', name, params)` for each item in FIFO order.
     - After drain: `window.__nxEventQueue` is empty (length 0 or undefined).
     - Is idempotent: calling a second time with an empty queue does not throw and does not call `gtag`.
     - Does not call `gtag` when queue is empty.

4. `packages/landing/src/lib/analytics.ts` — **Implement `drainEventQueue()`**
   - Export function `drainEventQueue(): void`.
   - Guard: if `typeof window === 'undefined'` or `!window.__nxEventQueue` or queue is empty → return.
   - Copy the queue reference, reset `window.__nxEventQueue` to `[]`, then iterate the copy and call `window.gtag('event', item.event, params)` for each item (same destructuring pattern as `trackEvent`).
   - Only calls `gtag` if `window.gtag` is defined (defensive — adblocker scenario).

5. `packages/landing/src/__tests__/analytics.test.ts` — **Test slice 1C: `clearEventQueue`**
   - Add `describe('clearEventQueue', ...)`:
     - Clears `window.__nxEventQueue` (sets to empty array or deletes).
     - Sets `window.__nxConsentDenied = true`.
     - Subsequent `trackEvent` calls (with GA_ID set, gtag defined) are silently dropped.
     - Does not throw when queue was never initialised (undefined).

6. `packages/landing/src/lib/analytics.ts` — **Implement `clearEventQueue()`**
   - Export function `clearEventQueue(): void`.
   - Guard: `if (typeof window === 'undefined') return`.
   - Set `window.__nxEventQueue = []`.
   - Set `window.__nxConsentDenied = true`.

**Phase 2 — `CookieBanner.tsx` integration**

7. `packages/landing/src/__tests__/CookieBanner.test.tsx` — **Test slice 2: queue integration**
   - Add `describe('CookieBanner — queue integration (F060)', ...)`.
   - Mock `@/lib/analytics`: `jest.mock('../../lib/analytics', () => ({ drainEventQueue: jest.fn(), clearEventQueue: jest.fn() }))`.
   - Before each: `jest.clearAllMocks()`.
   - Test: clicking "Aceptar" → the `onLoad` callback fires (MockScript calls it immediately) → `drainEventQueue` is called once.
   - Test: clicking "Rechazar" → `clearEventQueue` is called once.
   - Test: `drainEventQueue` is NOT called when "Rechazar" is clicked.
   - Test: `clearEventQueue` is NOT called when "Aceptar" is clicked.
   - Note: the existing MockScript mock already calls `onLoad` immediately; this behaviour is relied on here. The mock for `@/lib/analytics` must be scoped to this describe block only (use `jest.isolateModules` or a separate `describe` with its own `jest.mock` at file scope — prefer the latter by adding a module-level mock that is cleared per test, only asserting calls within this describe).

8. `packages/landing/src/components/analytics/CookieBanner.tsx` — **Implement Phase 2**
   - Add import: `import { drainEventQueue, clearEventQueue } from '@/lib/analytics';`
   - In `onLoad` callback: after `window.gtag('config', GA_ID);`, add `drainEventQueue();`.
   - In `handleReject()`: after `deleteGaCookies();`, add `clearEventQueue();`.
   - No other changes to the component.

**Phase 3 — Edge-case tests and quality gates**

9. `packages/landing/src/__tests__/analytics.test.ts` — **Test slice 3: edge cases**
   - Add `describe('trackEvent — SSR guard', ...)`:
     - Verifying the existing SSR guard still works (typeof window guard; can be done with a module-level jest spy or by confirming the existing SSR test still passes).
   - Add `describe('drainEventQueue — no gtag defined', ...)`:
     - When queue has items but `window.gtag` is undefined: does not throw, queue is cleared anyway (items are not re-queued — they are lost, as per adblocker spec).
   - Add `describe('trackEvent — queue cap boundary', ...)`:
     - Explicitly verify: after 50 calls, queue length stays at 50.
     - Verify: the oldest item (first pushed) is the one dropped when the 51st item arrives.

10. Run quality gates (not implementation — these are developer commands to verify):
    - `npm run lint -w @foodxplorer/landing` — must exit 0.
    - `npm run type-check -w @foodxplorer/landing` (or `tsc --noEmit`) — must exit 0.
    - `npm test -w @foodxplorer/landing` — all 552+ existing tests plus new tests must pass.
    - `npm run build -w @foodxplorer/landing` — must exit 0.

---

### Testing Strategy

**Test files to modify**
- `packages/landing/src/__tests__/analytics.test.ts`
- `packages/landing/src/__tests__/CookieBanner.test.tsx`

**Key test scenarios**

For `analytics.test.ts`:

| Scenario | Technique |
|----------|-----------|
| Dev mode (no GA_ID) | `delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID` in `beforeEach`; restore in `afterEach` |
| gtag available path | `window.gtag = jest.fn()` in `beforeEach`; assert call shape: `('event', eventName, paramsWithoutEventKey)` |
| Queue creation | Assert `window.__nxEventQueue` is an array after first queued call |
| Queue cap at 50 | Loop 51 `trackEvent` calls; assert length stays 50; assert first item pushed is gone |
| drainEventQueue order | Push 3 events to queue; call `drainEventQueue`; assert `gtag` mock called 3 times in order |
| drainEventQueue idempotent | Call twice; assert `gtag` called only 3 times total (not 6) |
| clearEventQueue | Assert queue empty and `__nxConsentDenied === true` after call |
| consent-denied gate | Set flag, call `trackEvent` with `window.gtag` defined; assert `gtag` not called |

For `CookieBanner.test.tsx`:

| Scenario | Technique |
|----------|-----------|
| `drainEventQueue` called on accept | `jest.mock('../../lib/analytics')` at top of file or describe; click "Aceptar"; assert mock called once |
| `clearEventQueue` called on reject | Click "Rechazar"; assert mock called once |
| Cross-call isolation | Assert `drainEventQueue` not called when "Rechazar" clicked, and vice versa |

**Mocking strategy**

- `window.gtag`: assign `jest.fn()` directly to `window.gtag` in `beforeEach`; delete in `afterEach` to isolate tests.
- `window.__nxEventQueue` and `window.__nxConsentDenied`: delete both properties from `window` in `beforeEach` using `delete (window as Window & {...}).propertyName`.
- `process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID`: set/delete directly; restore to original value in `afterEach` using a `const original = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID` saved before the suite.
- `@/lib/analytics` in CookieBanner tests: `jest.mock('../../lib/analytics', () => ({ drainEventQueue: jest.fn(), clearEventQueue: jest.fn() }))` at the top of the file. Use `jest.clearAllMocks()` in `beforeEach` of the new describe block only, so existing tests are not affected.
- `next/script`: the existing MockScript mock (calls `onLoad` immediately) is already in place; it is relied upon to trigger `drainEventQueue` in the accept test.
- `console.debug`: `jest.spyOn(console, 'debug').mockImplementation(() => {})` — already present in existing suite; extend into new dev-mode describe block.

---

### Key Patterns

**`trackEvent` destructuring for gtag call** — The `event` property from `AnalyticsEventPayload` must be used as the second argument to `gtag('event', ...)`, and the remaining properties as the third argument. Use `const { event: eventName, ...params } = payload;` and call `window.gtag('event', eventName, params)`. Do NOT pass the `event` key inside the params object (GA4 ignores/conflicts with it).

**Queue FIFO overflow** — Cap enforcement must drop the _oldest_ item, not the newest. After pushing the new item, if `queue.length > 50`, call `queue.shift()`. This pattern matches the spec (FIFO overflow).

**`drainEventQueue` — copy-then-clear** — Copy the queue to a local variable and reset `window.__nxEventQueue = []` before iterating, so that any `gtag` side-effect that triggers another `trackEvent` during replay does not cause infinite growth. Pattern: `const pending = window.__nxEventQueue.splice(0)` or `const pending = [...queue]; window.__nxEventQueue = [];`.

**`process.env` check for GA_ID** — Use `process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID` (not the local `GA_ID` const from `CookieBanner.tsx`). In test environment, set `process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = 'G-TEST123'` when testing the queue/gtag paths; delete it when testing dev mode.

**`CookieBanner` already has `'use client'`** — No directive changes needed.

**`analytics.ts` has no `'use client'`** — It is a pure utility module. It must remain without the directive. The `typeof window === 'undefined'` guard handles SSR.

**Window augmentation scope** — The `declare global { interface Window { ... } }` block lives in `analytics.ts`. After changes it will declare `__nxEventQueue` and `__nxConsentDenied`. The `dataLayer` declaration can be removed from this file (CookieBanner.tsx uses a local cast `(window as Window & { dataLayer?: unknown[] })` pattern or initialises it directly in the `onLoad` callback — the existing `onLoad` code initialises `window.dataLayer` inline and does not rely on the type declaration).

**Existing GA4 initialization in `onLoad` must not change** — The `window.dataLayer = window.dataLayer || []` + `window.gtag = function(...)` initialization block is tested by the "GA4 initialization (F047)" describe block. Leave it intact; only append `drainEventQueue()` after `window.gtag('config', GA_ID)`.

**Test environment GA_ID** — In Jest, `process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID` is typically `undefined` unless set in `jest.config.js` or `jest.setup.ts`. Confirm this before writing the dev-mode test. If it is already set in the test env, the dev-mode test must temporarily `delete` it.


---

## Acceptance Criteria

- [x] `trackEvent()` uses `window.gtag('event', ...)` when gtag is available
- [x] Pre-consent events are queued in `window.__nxEventQueue` (capped at 50)
- [x] Queued events are replayed after GA4 initialization via `drainEventQueue()`
- [x] Events fired after consent go directly through `gtag()`
- [x] Development mode (no GA_ID) logs to console.debug, does NOT queue
- [x] Users who reject cookies: queue cleared, `__nxConsentDenied` set, future events dropped
- [x] CookieBanner `onLoad` calls `drainEventQueue()` after `gtag('config', ...)`
- [x] CookieBanner `handleReject` calls `clearEventQueue()`
- [x] All existing 552+ tests pass (592 total)
- [x] New tests verify:
  - [x] Events queued when gtag not available (and GA_ID set)
  - [x] Queued events replayed when drainEventQueue called with gtag available
  - [x] Events use gtag('event', name, params) format
  - [x] Queue empty after drain; drainEventQueue idempotent
  - [x] clearEventQueue clears queue and sets consent-denied flag
  - [x] trackEvent drops events when consent-denied flag is set
  - [x] console.debug fallback in development mode (no GA_ID)
  - [x] Queue capped at 50 items
  - [x] CookieBanner onLoad calls drainEventQueue
  - [x] CookieBanner handleReject calls clearEventQueue
- [x] Build succeeds
- [x] Lint clean

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (592 tests, 51 suites)
- [x] Code follows project standards (TypeScript strict, no `any`)
- [x] No linting errors
- [x] Build succeeds
- [x] Specs reflect final implementation

---

## Workflow Checklist

- [x] Step 0: Spec reviewed (self-review + Gemini + Codex)
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `frontend-planner` executed, plan approved (Gemini + Codex review)
- [x] Step 3: `frontend-developer` executed with TDD (3 phases)
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [x] Step 5: `code-review-specialist` executed (APPROVED WITH NOTES)
- [x] Step 5: `qa-engineer` executed (VERIFIED, 17 QA tests added)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-29 | Spec created | From landing audit finding I1 |
| 2026-03-30 | GA4 property created | G-X46WMF1NM5, env var set in Vercel + local |
| 2026-03-30 | Spec self-review | Removed HeroSection from files to modify (queue handles it), added edge cases (reject, memory, idempotent), updated GA ID |
| 2026-03-30 | Worktree created | `../foodXPlorer-F060` from develop (SHA 77e8ef3) |
| 2026-03-30 | Spec reviewed by Gemini + Codex | 1C+1I+4S. All addressed: consent-denied flag, dev mode check, queue cap, Window augmentation, CookieBanner AC, queue shape |
| 2026-03-30 | Plan created by frontend-planner | 10 steps across 3 phases, 4 files modified |
| 2026-03-30 | Plan self-review | jest.mock path issue identified |
| 2026-03-30 | Plan reviewed by Gemini + Codex | 1I+1S (both models). Fixed: jest.mock relative path |
| 2026-03-30 | Implementation complete | 3 phases, TDD. 5 files changed. 592 tests (40 new) |
| 2026-03-30 | Production validator | READY — 0 issues |
| 2026-03-30 | Code review | APPROVED WITH NOTES — 3 MEDIUM (pre-existing tech debt, not blockers) |
| 2026-03-30 | QA | VERIFIED — 17 QA tests added, 0 regressions |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Implementation Plan, AC, DoD, Workflow, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 22/22, DoD: 6/6, Workflow: 7/8 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: in-progress |
| 3. Update key_facts.md | [x] | N/A — no new endpoints, models, or shared utilities |
| 4. Update decisions.md | [x] | N/A — no ADR needed |
| 5. Commit documentation | [x] | Commit: (this commit) |
| 6. Verify clean working tree | [x] | `git status`: clean after docs commit |

---

*Ticket created: 2026-03-29*
