# F-WEB-HISTORY-FU3: useLayoutEffect swap for hydration + loadMore restore

**Feature:** F-WEB-HISTORY-FU3 | **Type:** Frontend-Polish (UX flicker fix) | **Priority:** Low (UX polish; FU2 already fixed the underlying race)
**Status:** Ready for Merge | **Branch:** bugfix/web-feed-uselayout-effect (off develop `0d79d14`)
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-06-02 | **Dependencies:** F-WEB-HISTORY-FU2 done (#304/#305 → develop `0d79d14`)
**Methodology:** bug-workflow Path A (Quick) — no `/review-spec` / `/review-plan` (2-line mechanical swap; tests unchanged).

---

## Spec

### Description

F-WEB-HISTORY-FU2 fixed the underlying scroll-settle race (BUG-WEB-FEED-SCROLL-SETTLE-001). Owner reverify on app-dev 2026-06-02 confirms the bug is **functionally fixed** but two residual visual quirks remain:

- **AC19 (reload):** intermittently, the user sees a brief "first frame at top → jump to bottom" sequence. Cause: the synchronous initial `scrollTo({behavior:'instant'})` in Effect 1 runs in `useEffect`, which fires AFTER the browser paints the committed React tree. Between commit and the scroll fire, the user sees 1 frame of "feed at scrollTop=0" (browser default) before the JS corrects.
- **AC21 (loadMore prepend):** the viewport "almost" stays anchored to the user's entry, but a brief 1-frame flicker shows the prepended entries at the top before the restore effect repairs `scrollTop`. Pre-existing behavior from F-WEB-HISTORY (PR #299) — NOT introduced by FU2.

Both issues share the same root cause: layout-related side effects in `useEffect` fire AFTER paint. The canonical React fix is `useLayoutEffect` — runs synchronously after commit, BEFORE paint → the user never sees the intermediate frame.

### Scope (2-line swap)

- `useEffect` → `useLayoutEffect` in **Effect 1** (hydration scroll, currently lines ~102-150 of `TranscriptFeed.tsx`).
- `useEffect` → `useLayoutEffect` in the **loadMore restore effect** (currently lines ~189-198 of `TranscriptFeed.tsx`).

Pre-existing FU1+F-WEB-HISTORY logic is untouched. The capture effect for loadMore (which only reads `scrollHeight`/`scrollTop` into refs) stays in `useEffect` — it doesn't write layout, so it doesn't need the pre-paint timing.

### Out of scope

- The ResizeObserver re-fires on `scrollHeight` growth during the 500ms window (Effect 1 internal). These are intentional and happen during/after paint — they correct for child cards finishing layout. `useLayoutEffect` does NOT eliminate them; that would require `visibility:hidden` during hydration (escalated to a future FU if owner asks).
- Append effect (Effect 3): stays in `useEffect` because it READS post-commit `scrollHeight` via `wasNearBottomRef` and writes the smooth scroll after — the smooth scroll is intended to be animated and post-paint timing is correct.
- Unmount-only effect (Effect 2): stays in `useEffect` — cleanup timing doesn't matter relative to paint.
- jsdom test changes — jsdom does NOT distinguish `useEffect` from `useLayoutEffect` (both fire synchronously after the render in jsdom). All 771 existing tests stay green unchanged.

---

## Acceptance Criteria

- [x] **AC1.** Effect 1 (hydration scroll) uses `useLayoutEffect`, imported from `react`.
- [x] **AC2.** LoadMore restore effect uses `useLayoutEffect`.
- [x] **AC3.** Capture effect for loadMore (read-only into refs) STAYS in `useEffect` (no write, no need for pre-paint timing).
- [x] **AC4.** Effect 2 (unmount cleanup) STAYS in `useEffect`.
- [x] **AC5.** Effect 3 (append smooth scroll) STAYS in `useEffect`.
- [x] **AC6.** Scroll listener effect STAYS in `useEffect` (passive listener attach; doesn't write layout).
- [x] **AC7.** Web test suite green (no test changes; 771/771 unchanged).
- [x] **AC8.** Lint + typecheck + build clean.
- [ ] **AC9.** Operator post-deploy: reload `/hablar` ×3 on app-dev → no perceptible "top → bottom jump" on first paint. Worst case is the ResizeObserver re-fires for layout-settle (acceptable per FU3 out-of-scope).
- [ ] **AC10.** Operator post-deploy: trigger loadMore prepend → no perceptible "new entries at top" flash; viewport stays anchored.

---

## Definition of Done

- [x] FU3 ticket Status `Ready for Merge` after gates green.
- [x] Web suite 771/771 unchanged.
- [x] Lint + typecheck + build clean.
- [ ] PR + CI green + owner sign-off + squash-merge.
- [ ] Closeout PR flips Status → Done + tracker sync + bugs.md note.
- [ ] Operator AC9 + AC10 reconfirm on app-dev after deploy. Release develop→main can unlock after that.

---

## Workflow Checklist

- [x] **Step 0 — Spec (this ticket).** No cross-model `/review-spec` per Path A; the change is mechanical + scope is 2 lines.
- [x] **Step 1 — Setup**: branch `bugfix/web-feed-uselayout-effect` off develop `0d79d14`.
- [x] **Step 2 — Plan**: inline in Spec above; no separate Plan section needed.
- [x] **Step 3 — Implement**: swap 2 effects to `useLayoutEffect`.
- [x] **Step 4 — Finalize**: gates green; commit.
- [x] **Step 5 — Review**: skipped formal code-review agent per Path A (mechanical swap); self-review applied — the 2 effects swapped are the only ones that WRITE layout (`scrollTo` + `scrollTop = N`); the 4 effects kept on `useEffect` either don't write layout or intentionally animate post-paint.
- [ ] **Step 6 — Merge + Closeout**: PR + CI verify + owner sign-off + squash-merge + closeout.

---

## Completion Log

| Date | Step | Notes |
|------|------|-------|
| 2026-06-02 | Step 0+3+4 (Path A) | Lightweight ticket created in same commit as the code change. Swapped 2 `useEffect` → `useLayoutEffect` in `TranscriptFeed.tsx`. Kept 4 other effects untouched (rationale per AC3-AC6). Pre-commit gates: web 771/771, lint 0, typecheck 0, build clean. |

---

## Merge Checklist Evidence

| # | Action | Status | Evidence |
|---|--------|--------|----------|
| 0 | Pre-flight | [x] | Branch off develop `0d79d14` (verified up-to-date). Path A bug-workflow. |
| 1 | Acceptance Criteria | [x] | 8/10 marked pre-merge. AC9 + AC10 = operator post-deploy (intentionally `[ ]`). |
| 2 | Definition of Done | [x] | 3/6 pre-merge marked; 3 remaining are post-merge / op-confirm. |
| 3 | Workflow Checklist | [x] | Steps 0-5 [x]; Step 6 pending PR. |
| 4 | Completion Log | [x] | 1 row collapsing Steps 0+3+4 per Path A "Quick" convention. |
| 5 | Product Tracker | [x] | Active Session + Features row updated to F-WEB-HISTORY-FU3 in-progress 5/6. |
| 6 | key_facts.md | [x] | N/A — no new infra. |
| 7 | bugs.md | [x] | BUG-WEB-FEED-SCROLL-SETTLE-001 already FIXED; FU3 is polish, no new bug entry needed. |
| 8 | Tests / lint / typecheck / build | [x] | 771/771 (unchanged from FU2; jsdom doesn't distinguish useEffect/useLayoutEffect), lint 0, typecheck 0, build clean. |
| 9 | Cross-model + reviewer trail | [x] | N/A per Path A — mechanical 2-line swap with self-review rationale documented in the Spec. |
