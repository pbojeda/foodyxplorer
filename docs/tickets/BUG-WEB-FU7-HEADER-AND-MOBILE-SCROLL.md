# BUG-WEB-FU7-HEADER-AND-MOBILE-SCROLL: TranscriptEntry header strip visibility + mobile initial scroll timing

**Feature:** BUG-WEB-FU7-HEADER-AND-MOBILE-SCROLL | **Type:** Frontend-Bugfix | **Priority:** Medium (UX polish on shipped FU7 architecture; blocks release develop→main)
**Status:** Done | **Branch:** `bugfix/web-fu7-header-and-mobile-scroll` (deleted post-merge) | **Merged:** `5cba621` via PR #322 (2026-06-09)
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-06-09 | **Tier:** Simple (Path A Quick) | **Dependencies:** F-WEB-HISTORY-FU7 done @ `b6eecc5`

---

## Spec

### Description

F-WEB-HISTORY-FU7 (PR #320 @ `b6eecc5`) rebuilt the `/hablar` scroll architecture — operator AC reverify on `app-dev.nutrixplorer.com` 2026-06-09 confirmed **11/14 PASS** for core architectural ACs (AC5/AC6/AC7/AC8/AC9/AC26). Three precision bugs surfaced in operator empirical testing remain — none architectural; all in TranscriptEntry header strip CSS + TranscriptFeed mount-timing scope.

**Owner verbatim (2026-06-09)**: *"como ves, practicamente lo tenemos solucionado todo, al menos el core del funcionamiento. Ahora solo es ajustar la franja pequeña de encima de las tarjetas y el scroll inicial o tras recarga, que si ya está solucionado en chrome web y también lo conseguimos hacer tras una búsqueda, seguro que es sencillo."*

### Bug 1 — DeleteEntryButton invisible on web (Chrome + Safari)

**Where:** TranscriptEntry header strip (timestamp + query echo + delete button row above each NutritionCard), persisted entries only.

**Symptom:** Trash icon (papelera) does not appear on desktop. The header strip renders correctly (timestamp + query echo + "Guardado" badge visible), but the delete affordance is invisible to the user.

**Root cause:** `packages/web/src/components/DeleteEntryButton.tsx:105` uses the Tailwind hover-reveal pattern `opacity-60 md:opacity-0 md:group-hover:opacity-100`. The `md:` prefix (≥768px = desktop) overrides the mobile-visible `opacity-60` with `opacity-0` by default, and only reveals to `opacity-100` when the parent `.group` is hovered. The parent `.group` is the entire header row (`TranscriptEntry.tsx:262`). In practice the affordance is undiscoverable on web (no hover state visible without precise pointer hover over the row).

**Owner-confirmed UX decision:** Always-visible discreta — `opacity-60` base + `hover:opacity-100 + focus-visible:opacity-100` on interaction. Preserve the subtle visual but guarantee discoverability across pointer and keyboard.

### Bug 2 — Query echo truncates with ellipsis instead of wrapping

**Where:** TranscriptEntry header strip query text span (web + móvil, both browsers).

**Symptom:** Long queryText is truncated to a single line with `…` ellipsis instead of wrapping naturally.

**Root cause:** `packages/web/src/components/TranscriptEntry.tsx:322` uses Tailwind `truncate` class which expands to `overflow:hidden + text-overflow:ellipsis + white-space:nowrap` — single-line ellipsis by definition.

**Owner-confirmed UX decision:** `line-clamp-2` — cap to 2 lines maximum, ellipsis if longer. Maintains predictable header strip height (FU7 layout requires bounded sibling heights for `flex-1` feed). `title` attribute on the span already surfaces full text on hover.

### Bug 3 — Mobile initial scroll lands mid-screen on load + reload

**Where:** TranscriptFeed mount on iOS Safari + Chrome móvil (both browsers, both load + reload paths). Web desktop UNAFFECTED.

**Symptom:** When `/hablar` mounts with persisted history, the feed's initial scroll position is mid-screen instead of at the bottom (latest entry). Post-search auto-scroll (via pin-aware settle effect) works correctly on mobile — only the initial mount-time scroll fails.

**Root cause hypothesis (high confidence):** `packages/web/src/components/TranscriptFeed.tsx:77-82` mount useEffect runs after React commit but BEFORE iOS Safari's layout pipeline has stabilized `scrollHeight`. NutritionCard contents (text, lazy-loading images, font fallback to webfont swap) continue to grow the layout post-commit. The `el.scrollTop = el.scrollHeight` assignment uses a stale (smaller) scrollHeight → user lands mid-feed. On desktop the layout settles faster and within the same effect tick, so the assignment lands at the actual final bottom.

**Fix approach:** Wrap the scroll assignment in `requestAnimationFrame` (same defer pattern as the settle effect at TranscriptFeed.tsx:95). rAF fires after the browser's next layout opportunity, giving iOS Safari time to compute final `scrollHeight`. If single rAF proves insufficient under operator empirical iPhone reverify, fallback options (in order of escalation): double rAF; ResizeObserver-based settle wait.

### What is NOT Changing

- TranscriptFeed scroll architecture (ADR-030 — native `<div overflow-y-auto>` + pin-aware + prepend anchor)
- HablarShell mount gate, voice/photo/auth/error/metrics paths
- ConversationInput in-column composer
- DeleteEntryButton internal state machine (idle → confirming, 5s auto-revert, Escape cancel)
- TranscriptEntry semantic structure (article, aria-label, modality icons, "Guardado" badge)

---

## Acceptance Criteria

### AC1 — DeleteEntryButton visible on web (Chrome + Safari)

**Given** a persisted entry rendered in TranscriptFeed
**When** the page renders on desktop (≥768px viewport)
**Then** the trash icon (DeleteEntryButton) is visible at `opacity-60` base (matching mobile)
**And** hovering anywhere within the entry's header row OR focusing the button via keyboard transitions to `opacity-100`
**And** the existing `idle → confirming` interaction flow is preserved

**Status:** PASS 2026-06-09 — operator web Chrome + Safari smoke required.

### AC2 — Query echo wraps to 2 lines maximum

**Given** a TranscriptEntry whose `queryText` exceeds the single-line container width
**When** the header strip renders (any viewport)
**Then** the query text wraps to 2 visible lines using `line-clamp-2`
**And** queries exceeding 2 lines are truncated with ellipsis at the end of line 2
**And** the `title` attribute continues to expose full text on hover
**And** layout height remains bounded (no arbitrary header strip growth)

**Status:** PASS 2026-06-09 — operator web + móvil Chrome + Safari smoke required.

### AC3 — Mobile initial scroll lands at the bottom (Chrome + Safari móvil)

**Given** an authenticated user with ≥1 persisted entries on iOS Safari OR Chrome móvil
**When** they navigate to `/hablar` (initial load OR reload F5)
**Then** the feed's initial scroll position is at the bottom, showing the latest entry above the composer
**And** no mid-screen landing position is observed
**And** no visible scroll jump animation occurs (instant position, not smooth)

**Status:** PASS 2026-06-09 — operator iPhone Safari + Android Chrome smoke required per memory `feedback_jsdom_layout_ac_gap`.

### AC4 — Web desktop behavior unchanged

**Given** the web desktop (Chrome + Safari) experience that operator confirmed PASS on FU7 reverify
**When** these bugfixes ship
**Then** AC5/AC6/AC7/AC9 hydration + scroll behaviors remain PASS on desktop (no regression)
**And** the 6 operator-validated ACs from FU7 continue to behave correctly

**Status:** PASS 2026-06-09 — operator web Chrome + Safari smoke required (regression check).

### AC5 — Existing tests remain green

**Given** the existing 795/795 web test suite
**When** the 3 fixes are applied
**Then** `npm test -w @foodxplorer/web` runs 795+ tests with 0 failures
**And** lint + typecheck + build remain green

**Status:** Pending — automated gate.

---

## Implementation Plan

### Step 1 — Bug 1 fix (DeleteEntryButton.tsx:105)

**File:** `packages/web/src/components/DeleteEntryButton.tsx`

Replace the `className` of the idle-state button (line 105):

**Before:**
```tsx
className="p-1.5 rounded-md text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1 opacity-60 md:opacity-0 md:group-hover:opacity-100"
```

**After:**
```tsx
className="p-1.5 rounded-md text-slate-300 hover:text-red-400 hover:bg-red-50 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1 opacity-60 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
```

**Rationale:** drop `md:opacity-0` (the hidden desktop state) and `md:group-hover:opacity-100` (the desktop-only reveal). Keep `opacity-60` as the always-visible base. Add `hover:opacity-100` for direct pointer hover on the button itself, `focus-visible:opacity-100` for keyboard a11y, `group-hover:opacity-100` so hovering anywhere in the parent row still emphasizes the affordance. Use `transition-all` so the opacity transition is animated alongside color/bg.

### Step 2 — Bug 2 fix (TranscriptEntry.tsx:322)

**File:** `packages/web/src/components/TranscriptEntry.tsx`

Replace the `className` of the query text span (line 322):

**Before:**
```tsx
<span
  className="text-sm font-medium text-slate-600 truncate flex-1 min-w-0"
  title={entry.queryText}
>
```

**After:**
```tsx
<span
  className="text-sm font-medium text-slate-600 line-clamp-2 flex-1 min-w-0 break-words"
  title={entry.queryText}
>
```

**Rationale:** drop `truncate` (single-line ellipsis), add `line-clamp-2` (cap to 2 lines via `-webkit-line-clamp:2 + -webkit-box-orient:vertical + overflow:hidden`). Add `break-words` so very long unbroken tokens (URLs, no-space text) wrap rather than overflow.

**Layout sanity:** the parent flex container `flex items-center gap-2 mb-3 group` uses `items-center` — when the query text grows to 2 lines, all other items (icon, timestamp, badge, delete button) stay vertically centered. `flex-1 min-w-0` is preserved so the span yields to siblings for `truncate`/`line-clamp` to engage. Tailwind v3 ships `line-clamp-*` utilities natively (no plugin needed — verified Tailwind 3.x default config).

### Step 3 — Bug 3 fix (TranscriptFeed.tsx:77-82)

**File:** `packages/web/src/components/TranscriptFeed.tsx`

Replace the mount useEffect (lines 77-82):

**Before:**
```tsx
useEffect(() => {
  const el = feedRef.current;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
  wasNearBottomRef.current = true;
}, []);
```

**After:**
```tsx
useEffect(() => {
  const el = feedRef.current;
  if (!el) return;
  // Defer to next animation frame so iOS Safari has time to settle the layout
  // pipeline (NutritionCard content + font swap + lazy images grow scrollHeight
  // post-commit; reading it synchronously on mount yields a stale smaller value
  // → user lands mid-feed on mobile). Same defer pattern as the settle effect
  // below (line ~95). Desktop unaffected — layout already settled within tick.
  requestAnimationFrame(() => {
    const current = feedRef.current;
    if (!current) return;
    current.scrollTop = current.scrollHeight;
    wasNearBottomRef.current = true;
  });
}, []);
```

**Rationale:** rAF fires after the browser's next layout opportunity. On iOS Safari this gives the layout pipeline time to compute final `scrollHeight` post-font-swap and post-lazy-image-stabilization. The re-check of `feedRef.current` inside the rAF callback guards against component unmount between commit and rAF execution (defensive; rare in practice but cheap).

**Fallback escalation if AC3 still fails operator reverify:**
- Variant B: `requestAnimationFrame(() => requestAnimationFrame(() => { ... }))` (double rAF — wait for two layout passes)
- Variant C: `ResizeObserver`-based settle (observe the feed element, retry scroll on each `scrollHeight` change for ~500ms, then disconnect — similar to FU2 pattern but mount-scoped, NOT for ongoing settle which FU7 already handles correctly)

### Step 4 — Tests

**File:** `packages/web/src/__tests__/components/DeleteEntryButton.test.tsx` (existing — verify still green; add 1 regression test for always-visible base)
**File:** `packages/web/src/__tests__/components/TranscriptEntry.test.tsx` (existing — add 1 test asserting `line-clamp-2` class)
**File:** `packages/web/src/__tests__/components/TranscriptFeed.test.tsx` (existing — verify mount scroll test still asserts `scrollTop = scrollHeight` and the rAF wrap doesn't break the test mock)

If existing tests fail post-rAF wrap, update them to await the rAF callback using `act(() => new Promise(r => requestAnimationFrame(r)))` or jest fake timer pattern.

**No new test file required** — Path A Quick scope.

### Verification commands run

```bash
# Verify Tailwind v3 line-clamp utility is available (no plugin needed in v3+)
grep -E "tailwindcss.*\"\\^?3\\." packages/web/package.json
# Expected: "tailwindcss": "^3.x.x"

# Verify the 3 target file:line references are accurate (post-FU7 develop tip)
sed -n '105p' packages/web/src/components/DeleteEntryButton.tsx
sed -n '322p' packages/web/src/components/TranscriptEntry.tsx
sed -n '77,82p' packages/web/src/components/TranscriptFeed.tsx
```

---

## Definition of Done

- [x] AC1 satisfied — papelera visible at base on web, hover/focus reveals 100% (operator PASS 2026-06-09)
- [x] AC2 satisfied — long query text wraps to 2 lines + ellipsis if longer (operator PASS 2026-06-09)
- [x] AC3 satisfied — mobile (iOS Safari + Chrome móvil) initial scroll lands at bottom on load + reload (operator PASS 2026-06-09)
- [x] AC4 satisfied — no regression on web desktop FU7-validated behaviors AC5/6/7/9 of FU7 (operator PASS 2026-06-09)
- [x] AC5 satisfied — 799/799 tests green (+4 from 795 baseline), lint 0, typecheck 0, build clean (`/hablar` 20 kB / 209 kB unchanged)
- [x] code-review-specialist executed and findings addressed — N/A per Path A Quick scope (3 mechanical fixes, owner-approved direct execution)
- [x] `/audit-merge` skill executed, all structural checks PASS — N/A per Path A Quick scope (Simple tier — skipped formal audit)
- [x] product-tracker.md updated (status `pending` → `done`, Active Feature refreshed) — done in this housekeeping commit
- [x] bugs.md updated (entry for this bugfix added) — done in this housekeeping commit
- [x] Operator iPhone + web Chrome/Safari reverify confirmed for all ACs per memory `feedback_jsdom_layout_ac_gap` — PASS 2026-06-09 ("Todo funciona correctamente. por fin lo damos por bueno.")

---

## Workflow Checklist

- [x] Step 0: Spec drafted (this section, Path A Quick scope — cross-model review skipped per Simple tier + mechanical-fix scope per owner go-ahead)
- [x] Step 1: Branch `bugfix/web-fu7-header-and-mobile-scroll` created off develop @ `3b1a259`
- [x] Step 2: Implementation Plan written (this section, 4 steps + verification commands)
- [x] Step 3: TDD implementation — 3 code edits + 4 test updates (commit `1bde47b`)
- [x] Step 4: Quality gates pass — lint 0 / typecheck 0 / 799 tests / build clean
- [x] Step 5: code-review-specialist + `/audit-merge` skill — SKIPPED per Path A Quick (3 mechanical CSS/timing fixes, owner-approved direct path)
- [x] Step 6: Squash merge to develop (`5cba621` via PR #322) + operator iPhone + web Chrome/Safari reverify PASS + housekeeping (this commit)

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-06-09 | Step 0 — Spec drafted (Path A Quick) | 3 precision bugs from FU7 operator reverify. Owner UX decisions: papelera always-visible-discreta + line-clamp-2 + requestAnimationFrame mount wrap. Cross-model review skipped per Simple tier (3 mechanical fixes ~30min). Operator iPhone reverify obligatorio para AC3 per memory `feedback_jsdom_layout_ac_gap`. |
| 2026-06-09 | Step 1 — Branch created | `bugfix/web-fu7-header-and-mobile-scroll` off develop @ `3b1a259` (post-FU7-housekeeping merge). |
| 2026-06-09 | Step 2 — Plan written | 4 steps: (1) DeleteEntryButton.tsx:105 opacity classes; (2) TranscriptEntry.tsx:322 truncate→line-clamp-2; (3) TranscriptFeed.tsx:77-82 rAF wrap; (4) test updates. Fallback escalation documented for Bug 3 (double rAF, ResizeObserver). |
| 2026-06-09 | Step 3 — TDD implementation (commit `1bde47b`) | 3 fixes applied: (1) DeleteEntryButton.tsx:105 — drop `md:opacity-0 md:group-hover:opacity-100`, add `hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100`, transition-colors→transition-all; (2) TranscriptEntry.tsx:322 — `truncate` → `line-clamp-2 break-words`; (3) TranscriptFeed.tsx:77-89 — mount scroll wrapped in `requestAnimationFrame` + `feedRef.current` re-check. Tests: +1 DeleteEntryButton opacity assertion, +2 TranscriptEntry (line-clamp-2 + title attr preservation), TranscriptFeed mount-scroll test rewritten with rAF mock + execute callback + defensive null-mount test, 2 AC25 settle tests + 1 FU7 QA edge-case updated with `rafCallbacks.length = 0` after mount (discard mount rAF before settle action). |
| 2026-06-09 | Step 4 — Quality gates GREEN | Tests **799/799** (+4 from FU7 baseline 795), lint 0 errors, typecheck 0 errors, build clean. Bundle `/hablar` 20 kB / 209 kB First Load (unchanged from FU7 — fixes are CSS classes + 4 LoC JS, no bundle impact). |
| 2026-06-09 | Step 6 — Squash merge + operator reverify PASS | PR #322 squash-merged to develop @ `5cba621` (2026-06-09 15:40 UTC). Branch `bugfix/web-fu7-header-and-mobile-scroll` deleted (local + remote). Vercel auto-deployed to `app-dev.nutrixplorer.com`. **Operator reverify on app-dev 2026-06-09 = ALL 3 BUGS PASS** ("Todo funciona correctamente. por fin lo damos por bueno."). AC1 papelera + AC2 line-clamp-2 wrap + AC3 mobile initial scroll bottom + AC4 no regression web desktop = all PASS. F-WEB-HISTORY 8-iter cadena (FU1→FU7→this bugfix) **TRULY closed**. Release develop→main UNBLOCKED. |
| 2026-06-09 | Step 6 — Housekeeping (this commit) | Ticket Status Spec → Done; Workflow Step 6 → [x]; all DoD items checked; MCE filled. product-tracker.md: Active Session refreshed (bugfix done 6/6, no active feature, release unblocked); Features table BUG row → done 6/6. bugs.md: new entry for this bugfix summarizing 3 fixes + operator confirmation. Memorias: `project_fweb_history_fu7_closed` updated (chain TRULY closed, release unblocked); MEMORY.md index reflects closure. |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections present: Spec, ACs (5 header-form), Implementation Plan, DoD (10 items), Workflow (7 items), Completion Log (6 rows), MCE, References |
| 1. Mark all items | [x] | AC: 5/5 done (operator-PASS confirmed). DoD: 10/10. Workflow: 7/7. |
| 2. Verify product tracker | [x] | Active Session refreshed; Features table BUG row → done 6/6; this commit |
| 3. Update key_facts.md | [x] | N/A — no new infrastructure (CSS classes + 4 LoC JS) |
| 4. Update decisions.md | [x] | N/A — no ADR-level decision (3 mechanical fixes within ADR-030 architecture) |
| 5. Commit documentation | [x] | Bugfix commit `1bde47b` (impl) + this housekeeping commit (ticket + tracker + bugs.md + memories) |
| 6. Verify clean working tree | [x] | `git status`: clean (only `.claude/scheduled_tasks.lock` modified, harness-owned, not relevant) |
| 7. Verify branch up to date | [x] | merge-base: UP TO DATE with origin/develop (no merge needed) |
| 9. Run `/audit-merge` | [x] | N/A per Path A Quick scope (Simple tier, 3 mechanical fixes, operator empirical reverify PASS) |

---

## References

- F-WEB-HISTORY-FU7 ticket: `docs/tickets/F-WEB-HISTORY-FU7-rebuild-scroll-wrapper.md` (merged @ `b6eecc5` via PR #320)
- ADR-030 (native scroll architecture): `docs/project_notes/decisions.md` line ~1094
- Memory: `project_fweb_history_fu7_closed.md` — 8-iter chain resolution
- Memory: `feedback_jsdom_layout_ac_gap.md` — operator-empirical reverify obligatorio for layout/iOS ACs
- Memory: `feedback_hand_rolled_scroll_anti_pattern.md` (REFINED 2026-06-09) — anti-pattern is overlay+arithmetic combo
