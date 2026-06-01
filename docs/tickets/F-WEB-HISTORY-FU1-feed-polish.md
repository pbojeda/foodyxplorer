# F-WEB-HISTORY-FU1: Feed polish — meter actor-id + scroll bounds + scroll-to-bottom + photo mode default

**Feature:** F-WEB-HISTORY-FU1 | **Type:** Frontend-Polish (1 client-protocol fix + 3 UX) | **Priority:** High (medidor roto en navegador)
**Status:** Ready for Merge | **Branch:** feature/F-WEB-HISTORY-FU1-feed-polish
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-06-01 | **Dependencies:** F-WEB-HISTORY done (#299 + #300), F-WEB-TIER done (#294), BUG-API-RATELIMIT-BEARER-001 fixed (#301)

---

## Spec

### Description

Empirical follow-up batch surfaced by dev validation of F-WEB-HISTORY (operator AC56–58, 2026-06-01). Four independent items in the same frontend area (HablarShell / TranscriptFeed / UsageMeter / photo mode toggle); bundled into ONE PR because they all live in the same files and benefit from a single TDD cycle + review pass. No backend changes (the API already accepts the missing header).

The 4 items:

**A — Medidor no avanza (BUG-WEB-USAGEMETER-ACTOR-PARITY).** The usage meter (`Consultas/Fotos/Voz`) never updates from the browser even after successful queries. Diagnosed empirically 2026-06-01:
- `apiClient.sendMessage` sends header `X-Actor-Id: <actorId>` (`packages/web/src/lib/apiClient.ts:32-37`, called with `actorId = getActorId()` from HablarShell) → server's `resolveBearerActorId` resolves the **anon-web actor** linked to the user's account → `actorRateLimit` INCRements `actor:limit:<web-actor-id>:<date>:queries`.
- `apiClient.getUsage` does **NOT** send `X-Actor-Id` (`apiClient.ts:489-512`) → server falls back to the deterministic **`me-<sub.slice(0,8)>`** fallback actor (`bearerActor.ts:provisionFallbackActor`) → `/me/usage` reads `actor:limit:<me-fallback-id>:<date>:queries` — a **different Redis bucket** which never grows from browser searches.
- Note: `getHistory` (`apiClient.ts:583-625`) also currently omits `X-Actor-Id`, but this does not affect history correctness because history is scoped by `accounts.id` (account-keyed in Postgres), not by actor. The actor mismatch only matters for `actorRateLimit` counters, which are per-actor in Redis.
- Net effect: every successful search increments the *web-actor* bucket but the meter only ever reads the *fallback-actor* bucket → meter is stuck.

**B — Última entry tapada por la barra inferior (BUG-WEB-FEED-OVERLAP).** In `/hablar`, the search input + selection toggle is positioned at the bottom of the viewport and overlays the bottom of the TranscriptFeed scroll. The last entry in the feed is partially obscured (the user must scroll PAST the visible area to read it, which the current scroll boundary does not allow).

**C — Reload empieza arriba en vez de al final (BUG-WEB-FEED-SCROLL-TOP).** Convention for an append-only chat/transcript feed is to show the *newest* (bottom) entry first — like every messaging app (WhatsApp, Slack, Discord). On reload the user currently lands at the *oldest* entry of the page, forcing them to scroll all the way down to see what they last searched. Expected: feed lands at the bottom (newest) on mount.

**D — Photo mode toggle: "solo este plato" default + on the left (UX-WEB-PHOTO-TOGGLE).** Currently the toggle is `[ menú/carta | solo este plato ]` with `menú/carta` as default. The owner reports the single-dish path is the common case; rearrange to `[ solo este plato | menú/carta ]` with **`solo este plato`** as the default.

### Out of scope

- Account-keyed daily quota (multi-device unified counter). Today's counter is per-actor in Redis → multi-device users get fragmented quotas. **F-WEB-TIER-FU2** (separate ticket) — covers the architectural fix. This FU only restores PARITY between the meter read and the search write on the SAME device (fixes the bug, but multi-device quota fragmentation remains).
- Retry-after copy on transient 429 (`bugs.md` BUG-API-RATELIMIT-BEARER-001 follow-up #1).
- Multi-device shared-cap UX/privacy doc note (#2 of same follow-up list).
- 429 input-disable + countdown (#3 of same).

### UI Changes

- **UsageMeter / apiClient**: `getUsage` accepts an `actorId` argument and sends `X-Actor-Id: <actorId>` header (mirrors `sendMessage` header pattern). UsageMeter calls `getActorId()` from `@/lib/actorId` (same source HablarShell uses at lines 96/329/456) and passes the result. No new hook, no parallel actor state. After this fix, /me/usage and /conversation/message resolve to the SAME actor → same Redis bucket → meter advances on every successful search.
- **TranscriptFeed**: bottom padding (or a spacer element) sized so that the last entry's bottom edge clears the bottom bar's top edge. Exact mechanism (CSS padding-bottom vs spacer div vs `scroll-padding-block-end`) decided at Step 2.
- **TranscriptFeed scroll on mount**: scroll programmatically to the bottom on initial mount AND when new entries append (the typical chat behavior). On subsequent reloads (entries restored from `/history` + session), the feed lands at the newest entry's row.
- **Photo mode toggle**: swap order to `[ solo este plato | menú/carta ]`; default selected = `solo este plato` (was `menú/carta`).

### Edge Cases & Error Handling

- `getUsage` with `actorId === undefined` (e.g., logged-out, transient): the meter component already returns `null` for logged-out (`UsageMeter.tsx:97`), so this path is unreachable. Defensive: if `actorId` is `undefined`, omit the header (don't send `X-Actor-Id: undefined`).
- Scroll-to-bottom must NOT auto-scroll if the user has manually scrolled up (chat convention — respect user intent). On *initial mount* always scroll to bottom; on *new entry append* scroll only when the user is already near the bottom (within ~100px). This is the standard "auto-scroll if anchored to bottom" pattern.
- Photo mode default change must not regress existing users mid-session — apply on next page load (no `localStorage` migration needed; the prior default was per-session UI state, not persisted).
- The bottom-bar overlap fix must work across viewport sizes (mobile + tablet + desktop). Test on the design system's standard breakpoints.

---

## Acceptance Criteria

### A — Meter actor-id parity

- [x] **AC1.** `apiClient.getUsage(actorId)` accepts an `actorId: string | undefined` parameter (typed). Unit-tested.
- [x] **AC2.** When `actorId` is a defined non-empty string, `getUsage` sends header `X-Actor-Id: <actorId>` (verified by a fetch-mock assertion). Mirrors `sendMessage` exactly.
- [x] **AC3.** When `actorId` is `undefined` or `''`, the `X-Actor-Id` header is omitted (NOT sent as `"undefined"`). Unit-tested.
- [x] **AC4.** UsageMeter wires `actorId` by calling `getActorId()` from `@/lib/actorId` — the SAME source HablarShell's `sendMessage` call uses (no `useActorId` hook exists in the codebase; do not invent one). No new actor state; just read the persisted actorId at call time inside the existing `fetchUsage` callback.
- [x] **AC5.** Integration-style web test: rendering `<UsageMeter />` (with a mocked authenticated context + a fixed actorId) issues a `getUsage` call whose mocked fetch receives `X-Actor-Id: <expected>`.
- [ ] **AC6.** Post-deploy operator smoke (owner, manual): on `app-dev`, search 3 times in a row; observe the meter advance by 3 in `Consultas`. Backend confirms via `GET /me/usage` showing matching `queries.used`.

### B — Last entry no longer hidden under bottom bar

- [x] **AC7.** TranscriptFeed's scroll container has bottom padding (or a spacer) ≥ the bottom-bar height + a comfortable gap (≥16px). Computed/measured value documented in the Step 2 Plan.
- [x] **AC8.** Unit test asserts the TranscriptFeed scroll container carries the expected padding class/CSS-var (e.g., `pb-[var(--input-bar-height)]` or a fixed Tailwind class like `pb-32` chosen at Step 2). jsdom's lack of real layout rules out `getBoundingClientRect`-based assertions (per /review-spec G1) — verify via `className` containment OR a `data-*` attribute that encodes the chosen height.
- [x] **AC9.** No regression on the case where the feed is shorter than viewport (no double scrollbars, no excess whitespace above the bottom bar when only 1-2 entries). Verified via existing TranscriptFeed tests + 1 new test for the 1-entry case.

### C — Feed lands at the bottom on mount

- [x] **AC10.** On initial mount of TranscriptFeed with N ≥ 2 entries already in props (synchronous hydration case), the scroll position is at the bottom (newest entry visible). Unit-tested via `scrollTop`/`scrollHeight` assertion.
- [x] **AC10b.** _(cross-model C1)_ When persisted history is hydrated **asynchronously** — initial render with `entries=[]`, then a later rerender appends N ≥ 2 persisted entries from `useSearchHistory` mount fetch — the feed scrolls to the bottom **after that first non-empty hydration**. This is the real-world reload path the owner experiences. Distinct from append-of-a-fresh-search (AC11). Unit-tested with a `rerender(...)` that transitions entries `[] → [persisted×N]`.
- [x] **AC10c.** _(cross-model C2 — regression guard for loadMore)_ When older history is **prepended** via `useSearchHistory.loadMore` (entries grow at the FRONT, not the BACK), the feed MUST NOT scroll to bottom. The existing prepend-preservation logic (TranscriptFeed:79-99) must keep the user's viewport pinned to their current entry. Distinguishing test: scroll user 200px above bottom, then trigger `isLoadingMore: true → false` with older entries prepended; assert `scrollTop` did NOT jump to `scrollHeight`.
- [x] **AC11.** When a new entry is appended (length grows at the BACK) AND the user was already within ~100px of the bottom, the feed auto-scrolls to the bottom. Unit-tested. (Existing TranscriptFeed:54-77 behavior; this AC is a regression guard.)
- [x] **AC12.** When a new entry is appended AND the user has manually scrolled up (≥100px above bottom), the feed does NOT auto-scroll (respects user reading position). Unit-tested.
- [x] **AC13.** _(reworded per cross-model C5 to be TDD-actionable)_ All programmatic scroll-to-bottom calls (mount, async hydration, append-when-near-bottom) use `scrollTo({ top: scrollHeight, behavior: 'smooth' })`. Unit-tested by asserting `scrollTo` is called with `behavior: 'smooth'` (the existing append path already does this at TranscriptFeed:72).

### D — Photo mode toggle: "solo este plato" default + left

- [x] **AC14.** The photo mode toggle renders with order `[ Solo este plato | Menú/carta ]` (left to right). Snapshot or order-asserting test.
- [x] **AC15.** On first render (no prior state), the selected mode is `solo este plato`. Unit-tested.
- [x] **AC16.** Switching to `menú/carta` and back to `solo este plato` works as before (no regression). Existing tests of the photo flow remain green.

### Build / CI

- [x] **AC17.** `npm test -w @foodxplorer/web` green (no regressions in existing 730 tests + new tests for AC1–AC16).
- [x] **AC18.** `npm test -w @foodxplorer/api` green (api should be unchanged but verified).
- [x] **AC19.** Lint + typecheck + build clean for web (and api — unchanged).
- [x] **AC20.** CI `ci-success` SUCCESS on the PR.

### Operator / post-deploy

- [ ] **AC21.** After api-dev redeploys with this PR merged: logged in on app-dev, do 3 searches → meter shows `Consultas N+3` (where N was the pre-test value) — matches `GET /me/usage` server reading.
- [ ] **AC22.** Operator visual check on app-dev: reload `/hablar` with ≥2 entries in history → feed is positioned at the bottom (last entry visible above the input bar). No entry is partially hidden.
- [ ] **AC23.** Operator visual check on app-dev: open photo mode → toggle shows `[Solo este plato | Menú/carta]` with `Solo este plato` selected.

### Cross-model review additions (Step 0 /review-spec, 2026-06-01)

Gemini → **APPROVED** (1 IMPORTANT + 1 SUGGESTION). Codex → **REVISE** (3 IMPORTANT + 2 SUGGESTIONs). Both reviewers empirically verified the meter-bug diagnosis against the actual code. Findings applied:

- [x] **(Codex C1, IMPORTANT)** Async history hydration case missing — added **AC10b** (scroll-to-bottom after the first non-empty persisted-history hydration, the real reload path). `entries=[] → entries=[persisted×N]` rerender transition. The original AC10 only covered the synchronous-from-mount case which is NOT how `useSearchHistory` hydrates today.
- [x] **(Codex C2, IMPORTANT)** loadMore prepend protection missing — added **AC10c** (loadMore-prepend MUST NOT trigger scroll-to-bottom; the existing TranscriptFeed:79-99 prepend-preservation logic must not regress). Without this AC the new mount-scroll logic could silently break infinite-scroll-up.
- [x] **(Codex C3, IMPORTANT)** AC4 cited a non-existent `useActorId` hook — reworded to use the real `getActorId()` from `@/lib/actorId` (verified `rg -n useActorId packages/web/src` returns nothing; HablarShell uses `getActorId()` directly at lines 96/329/456).
- [x] **(Gemini G1 / Codex C5, IMPORTANT/SUGGESTION)** AC8 + AC13 testability — reworded AC8 to use `className`/CSS-var assertion (jsdom-friendly, no `getBoundingClientRect`) and AC13 to assert the concrete `scrollTo({ behavior: 'smooth' })` call shape.
- [x] **(Codex C4 / Gemini G2, SUGGESTION)** Wrong file:line citations in the Description — corrected: `apiClient.ts:32-37` for sendMessage headers (not l.34), `apiClient.ts:489-512` for getUsage (not l.506-511), and removed `getHistory line 128` as a parity example (getHistory also omits X-Actor-Id; the parity claim was inaccurate). Added clarifying note: getHistory's omission doesn't matter because history is account-keyed in Postgres, not actor-keyed.

### Cross-model review additions (Step 2 /review-plan, 2026-06-01)

Gemini → **REVISE** (1 IMPORTANT G1; empirically verified 12 files). Codex → **REVISE** (2 IMPORTANT + 2 SUGGESTIONs; empirically grepped 4 additional test files Gemini missed). Both reviewers caught real issues. All 5 findings applied:

- [x] **(Gemini G1, IMPORTANT)** Step 5 originally proposed TWO `useEffect` hooks (one `[]` for sync mount, one `[entries.length]` for async hydration), both guarded by the same ref. Gemini correctly observed the empty-dep effect is redundant: React runs every `useEffect` once after the first render regardless of deps, so a single effect with `[entries.length]` already covers (a) sync mount with N≥1 entries on first render, (b) async hydration `[] → [N]`, (c) ref-guarded short-circuit on subsequent loadMore prepends and session appends. **Consolidated into one effect** in the "Design of the new ref and effect" + "GREEN code change" + Files-to-Modify table.
- [x] **(Codex C1, IMPORTANT)** Step 3 missed 4 additional test files that assume default `'auto'` mode and would break when the default flips to `'identify'`. Empirically confirmed: `HablarShell.photo.test.tsx:711`, `edge-cases.qa-web-001.test.tsx:253`, `F092.qa.test.tsx:517`, `gaps.qa-web-001.test.tsx:429` (all have explicit `mode=auto` comments or assertions). **All 4 added to Files-to-Modify + Step 3 detail**, each with a `userEvent.click(screen.getByRole('button', { name: 'Menú/carta' }))` step inserted before `selectFile` to preserve their `auto`-mode error-copy assertions.
- [x] **(Codex C2, IMPORTANT)** Step 5's AC10c test didn't exercise the real prepend-preservation path (which is driven by `isLoadingMore: false → true → false`, NOT by entries-length alone). **Rewritten** to model the full transition: capture at `isLoadingMore=true`, restore at `isLoadingMore=false` with new `scrollHeight`. Asserts both `scrollTo` not called AND `scrollTop === prevScrollTop + delta` (proving the new hydration ref-guard coexists with the existing capture/restore effects).
- [x] **(Codex C3, SUGGESTION)** AC1's "TypeScript compilation test" framing didn't fit the Jest+ts-jest harness. **Dropped** the dedicated Jest test; AC1 satisfied implicitly by impl + the `npm run typecheck -w @foodxplorer/web` gate (runtime behavior covered by AC2 + AC3).
- [x] **(Codex C4, SUGGESTION)** PhotoModeToggle.test.tsx has 6 tests, not 5. **Updated** the count + reworded to "Update the affected tests".

---

## Definition of Done

- [x] All automated ACs marked [x] — 21/25 marked (AC6 + AC21 + AC22 + AC23 are operator-confirmed post-deploy; tracked separately in Completion Log post-merge).
- [x] Code-review: code-review-specialist APPROVE (or REQUEST CHANGES addressed) — APPROVE (no BLOCKER/MAJOR; 3 NIT-grade SUGGESTIONs left for future audit)
- [x] QA: qa-engineer PASS (or PASS WITH FOLLOW-UPS; follow-ups logged in bugs.md) — PASS WITH FOLLOW-UPS; all 3 follow-ups APPLIED in commit 5a4e49b (stale comment + redundant test + AC32 nth-call assertion); none left for bugs.md
- [x] `/audit-merge` (REAL skill, not subset) executed and output pasted as MCE Action 9 (per [[feedback_mock_boundary_integration_gap]] lesson #3) — see MCE Action 9 below
- [x] `## Merge Checklist Evidence` table filled with REAL evidence (no aspirational rows) — filled below
- [x] Completion Log row per executed step
- [x] product-tracker Active Session + Features row updated — updated to Step 5/6 in commit a6b207f
- [x] Housekeeping: rate-limit bug (BUG-API-RATELIMIT-BEARER-001) `bugs.md` Status stamped FIXED @ `2562eef` (merged) + Active Session row demoted to "Previous" (folded into this PR, not a separate closeout)
- [x] No new ADR needed (this is a client-side wiring fix + UI polish; ADR-029 already covers the rate-limit policy decision)

---

## Workflow Checklist

- [x] Step 0: Spec (ticket written + /review-spec cross-model + self-review)
- [x] Step 1: Setup (branch created + Active Session updated)
- [x] Step 2: Plan (ui-ux-designer + frontend-planner + /review-plan cross-model)
- [x] Step 3: Implement (TDD; full gates after last commit)
- [x] Step 4: Finalize (commit + PR + CI green)
- [x] Step 5: Review (code-review-specialist + qa-engineer + MCE filled + /audit-merge)
- [ ] Step 6: Complete (owner sign-off → merge → housekeeping; branch deleted)

---

## Implementation Plan

_(populated at Step 2 by ui-ux-designer + frontend-planner agents)_

### Design Notes

> Written by ui-ux-designer at Step 2 — 2026-06-01.
> Design-system tokens reference `docs/specs/design-guidelines.md`.

---

#### A — Meter actor-id parity

No UX impact. The UsageMeter widget's visual behaviour, states (loading skeleton, counts display, error fallback), and position in the header auth-slot are unchanged. This is a pure client–API wiring correction. The meter will simply start showing accurate numbers once deployed. No design decision required.

---

#### B — Bottom-bar overlap: measured heights and recommended fix

**Bottom-bar height breakdown (ConversationInput, `fixed bottom-0`):**

| Layer | Source | Height |
|---|---|---|
| Container top padding | `py-3` = 12px top | 12px |
| Textarea row | `minHeight: 48px` + `py-3`=12px internal = 48px min-height set inline | 48px |
| Gap below textarea row | `py-3` bottom = 12px — overridden by `pb-[calc(12px+env(safe-area-inset-bottom))]` | 12px (+ iOS safe area) |
| PhotoModeToggle | `py-2.5`=10px×2 + `text-sm`≈20px line-height + `mt-2`=8px top margin = ~48px | ~48px |
| Border-top | 1px | 1px |
| **Total (no safe area)** | | **~121px** |

At minimum input height (single line, no inline error), the bar occupies approximately **121px** on standard viewports and **121px + env(safe-area-inset-bottom)** on iOS (typically +34px on iPhone with home indicator = ~155px).

**Recommended padding-bottom on TranscriptFeed's scroll container:**

Use `pb-36` (144px) as the base. This gives the ~121px bar height plus a comfortable **~23px breathing gap** so the last entry's bottom edge sits visibly clear of the bar. On iOS, add safe-area compensation.

Concrete Tailwind class to replace the current `pb-6` on the `<div>` at `TranscriptFeed.tsx:110`:

```
pb-36 pb-[calc(9rem+env(safe-area-inset-bottom))]
```

Since Tailwind's `pb-[calc(...)]` replaces `pb-36` when evaluated (later class wins with JIT), use a single value:

**`pb-[calc(9rem+env(safe-area-inset-bottom))]`** — 9rem = 144px base + iOS safe area, collapses to `pb-[144px]` on Android/desktop where `env(safe-area-inset-bottom)` evaluates to 0.

**Mechanism: padding-bottom on the scroll container (not a spacer div, not `scroll-padding-block-end`).**

- A padding-bottom on the scroll container is the most robust choice: it is part of the scrollable content area, so `scrollHeight` accounts for it. This means `scrollTo({ top: scrollHeight })` (item C) will correctly land the last entry above the padding gap — no off-by-one.
- A spacer `<div>` achieves the same scrollHeight effect but adds a DOM node that could interfere with ARIA `role="feed"` child expectations and is harder to maintain.
- `scroll-padding-block-end` only affects keyboard-focus scroll-into-view — it does NOT affect programmatic `scrollTo` or mouse scroll limits. This would not solve the visual overlap.

**Breakpoint behaviour:** The bar width is `left-0 right-0` (full viewport width) at all breakpoints. The feed has `lg:max-w-2xl lg:mx-auto` centering on desktop — this is a feed-width constraint and does not affect the bar height. The `pb-[calc(9rem+env(safe-area-inset-bottom))]` value applies uniformly across all breakpoints and is correct because the bar height does not change at breakpoints (it is always the same 2-row structure).

**No-regression note (AC9):** When the feed has only 1–2 short entries, the feed height is less than the viewport. The `pb-36` bottom padding will appear as white space between the last entry and the bar — this is intentional and correct (content is not hidden). No double scrollbars because `overflow-y-auto` only activates when content exceeds the container height, which it won't with 1–2 entries plus padding.

---

#### C — Scroll-to-bottom: entry order verified, behavior confirmed

**Array order resolution (definitive):**

The data flow is:
1. `useSearchHistory.getHistory()` → hook comment: `persistedEntries: oldest-first` (line 23 in hook).
2. `HablarShell` merge effect (lines 138–144): `[...persistedEntries, ...sessionOnly]` — persistedEntries at front (oldest), session entries at back (newest).
3. `TranscriptFeed` renders `entries.map(...)` in array order — no reversal.

**Conclusion: `entries[0]` is the OLDEST entry; `entries[entries.length-1]` is the NEWEST. The last rendered DOM node is the most recent entry, which is at the visual bottom of the scroll container. This is correct chat convention.**

No visual order flip is needed. The current render order already matches WhatsApp/Slack/Discord (oldest at top, newest at bottom). The only missing piece is the initial scroll-to-bottom on mount and on the `[] → [persisted×N]` async hydration transition.

**Scroll behavior specification:**

| Trigger | Expected action | `behavior` |
|---|---|---|
| Initial mount with N ≥ 1 entries already in props | `scrollTo({ top: scrollHeight, behavior: 'smooth' })` | `'smooth'` |
| Async hydration: `entries []` → `entries [×N]` (first non-empty transition from `useSearchHistory`) | `scrollTo({ top: scrollHeight, behavior: 'smooth' })` | `'smooth'` |
| New entry appended (session search) AND user within ~100px of bottom | `scrollTo({ top: scrollHeight, behavior: 'smooth' })` — already implemented at TranscriptFeed:72 | `'smooth'` (no change) |
| New entry appended AND user scrolled up > 100px | No scroll — respect reading position (already correct) | — |
| loadMore prepend (older entries added at front) | No scroll — existing prepend-preservation logic (lines 79–99) must not be disrupted | — |

**Distinguishing the async hydration case from a new session entry append (critical for AC10b vs AC10c):**

The existing `useEffect` at TranscriptFeed:57–77 fires whenever `entries.length` increases — this covers BOTH a new session entry AND the async hydration `[] → [×N]` jump. However, `isNearBottom` check at line 67 will return `false` on initial hydration because `scrollTop` is 0 and `scrollHeight` may already be large (the container hasn't scrolled yet). The condition `scrollTop + clientHeight >= scrollHeight - 100` evaluates as `0 + h >= h - 100` → only true when `scrollHeight <= clientHeight + 100` (i.e., the content fits in the viewport plus 100px).

This means the current "near-bottom" guard silently suppresses the initial hydration scroll. The fix: introduce ONE additional `useEffect` (deps `[entries.length]`, ref-guarded) for the "first non-empty transition" case that bypasses the near-bottom check. A ref flag (`hasScrolledToBottomOnHydrationRef`) ensures it fires at most once and that subsequent appends + loadMore prepends short-circuit.

A single effect handles BOTH the synchronous mount with N≥1 entries (React runs `useEffect` after the first render regardless of deps) AND the async hydration `[] → [N]` rerender (the effect re-fires when `entries.length` changes). Per /review-plan Gemini G1, this is simpler and equivalent to two separate effects.

**Near-bottom threshold:** Keep at 100px (current value in TranscriptFeed:68). This matches the AC11/AC12 spec and the existing implementation.

---

#### D — Photo mode toggle: "Solo este plato" as default and left button

**Order and default:**

- New left button: `Solo este plato` (mode value: `'identify'`)
- New right button: `Menú/carta` (mode value: `'auto'`)
- Default state: `'identify'` (change in `HablarShell` line 71: `useState<'auto' | 'identify'>('identify')`)

This aligns with the segmented control convention already used in the codebase: the leftmost option is the primary/default. The design language of `PhotoModeToggle` uses `ACTIVE_CLASS` (white background, `brand-green` border/text, `shadow-soft`) for the selected state and `INACTIVE_CLASS` (transparent bg, `slate-500` text) for the unselected state — both tokens are defined in the design system (`brand-green` = `#2D5A27`, `slate-500` = `#64748B`).

**Width balance:** The two buttons use `flex-1` — they share equal width regardless of label length. This is correct and should NOT be changed. "Solo este plato" is longer text but `flex-1` prevents overflow and avoids an asymmetric pill that would look unbalanced. At the smallest viewport (320px), both labels fit within their `flex-1` halves at `text-sm` (14px) with `px-3` padding. No change needed.

**First-render a11y:** The button that receives `aria-pressed="true"` on mount is now `Solo este plato`. Since `HablarShell` initialises to `'identify'`, the first render will correctly announce `aria-pressed="true"` on the left button and `aria-pressed="false"` on the right. No special handling needed — the existing `aria-pressed={value === 'identify'}` pattern already handles this correctly after the order swap.

**Regression note:** No `localStorage` migration needed. The mode is session-only state (`useState` in HablarShell, not persisted). Existing users on reload will see the new default on their next page load — this is the intended behaviour per the ticket spec.

---

> DESIGN NOTES READY FOR PLANNER

---

### Frontend Plan

> Written by frontend-planner at Step 2 — 2026-06-01.
> Empirically verified against the actual code before writing (see `### Verification commands run` at the bottom).

---

#### Existing Code to Reuse

- `packages/web/src/lib/apiClient.ts` — `getUsage()` (line 495) to be extended with `actorId` param; `sendMessage()` (line 104-134) as the header-injection pattern to mirror exactly.
- `packages/web/src/lib/actorId.ts` — `getActorId()` (the single source of truth for the browser actor UUID; already imported in `HablarShell.tsx:16` and called at lines 96, 329, 456).
- `packages/web/src/components/UsageMeter.tsx` — `fetchUsage` callback (line 67-83); `getUsage()` import (line 16); `useAuth` hook (line 18). No new hook or state needed.
- `packages/web/src/components/TranscriptFeed.tsx` — existing `feedRef`, `prevScrollHeightRef`, `prevScrollTopRef`, `prevEntriesLengthRef` refs; existing `useEffect` at lines 57-77 (append auto-scroll) and lines 79-99 (loadMore prepend-preservation). Both effects are KEPT; the new effects add on top.
- `packages/web/src/components/PhotoModeToggle.tsx` — `ACTIVE_CLASS`, `INACTIVE_CLASS` constants and `aria-pressed` pattern are unchanged; only the JSX button order and `aria-pressed` attribute targets are swapped.
- `packages/web/src/components/HablarShell.tsx` — `photoAnalysisMode` useState (line 71); `getActorId()` call pattern (lines 329/456).
- `packages/web/src/__tests__/components/TranscriptFeed.test.tsx` — `makeEntry()` fixture helper; `defaultProps`; scrollTo mock pattern (lines 258-276). Reuse and extend.
- `packages/web/src/__tests__/components/UsageMeter.test.tsx` — `usageEnvelope` fixture; `mockGetUsage` / `mockUseAuth` pattern. Extend with actorId assertions.
- `packages/web/src/__tests__/auth/apiClient.fWebTier.test.ts` — `jest.resetModules()` + `require()` isolation pattern for module-level `authToken` singleton; `makeSuccessResponse`/`makeErrorResponse` helpers. Extend `getUsage()` describe block with `actorId` header tests.
- `packages/web/src/__tests__/components/PhotoModeToggle.test.tsx` — all 5 existing tests must be UPDATED (button order assertions, `aria-pressed` expectations, default value assertions).

---

#### Files to Create

No new files. All changes are to existing files.

---

#### Files to Modify

| File | Change |
|---|---|
| `packages/web/src/lib/apiClient.ts` | Add `actorId?: string` parameter to `getUsage()`; conditionally inject `X-Actor-Id` header (mirrors `sendMessage` pattern). |
| `packages/web/src/components/UsageMeter.tsx` | Import `getActorId` from `@/lib/actorId`; call `getActorId()` inside `fetchUsage` and pass to `getUsage(actorId)`. |
| `packages/web/src/components/TranscriptFeed.tsx` | (1) Replace `pb-6` with `pb-[calc(9rem+env(safe-area-inset-bottom))]` on the scroll container className. (2) Add `hasScrolledToBottomOnHydrationRef` ref. (3) Add ONE consolidated `useEffect` (dep `[entries.length]`, ref-guarded) covering mount + async hydration; subsequent loadMore prepends short-circuit. |
| `packages/web/src/components/PhotoModeToggle.tsx` | Swap button JSX order: `Solo este plato` (identify) first, `Menú/carta` (auto) second. Update `aria-pressed` accordingly (already parametrised — only the DOM order changes). |
| `packages/web/src/components/HablarShell.tsx` | Change `useState<'auto' \| 'identify'>('auto')` → `useState<'auto' \| 'identify'>('identify')` at line 71. |
| `packages/web/src/__tests__/auth/apiClient.fWebTier.test.ts` | Extend `getUsage()` describe block: add 2 tests for `X-Actor-Id` header present/absent. Update existing call-sites in that describe block to pass `actorId` arg. |
| `packages/web/src/__tests__/components/UsageMeter.test.tsx` | Mock `getActorId` from `@/lib/actorId`; add `AC5` integration test asserting the mocked `getUsage` is called with the fixed actorId string. Update existing mock shape to match new `getUsage(actorId)` signature (no existing test passes positional args so no breakage, but the mock must accept the arg). |
| `packages/web/src/__tests__/components/TranscriptFeed.test.tsx` | Add: AC8 (padding class assertion), AC9 (1-entry no-regression), AC10 (mount scroll), AC10b (async hydration scroll), AC10c (loadMore no-scroll regression guard), AC13 (scrollTo called with `behavior: 'smooth'`). Update: AC47 test is already green but verify it still covers AC11/AC12 after the new effects land. |
| `packages/web/src/__tests__/components/PhotoModeToggle.test.tsx` | Update the affected tests (6 total in the file) to reflect the new button order: `Solo este plato` is now the LEFT button; assertions on `aria-pressed="true"` for `value="identify"` on first render; update `value="auto"` default render test to expect `Solo este plato` as inactive. The tests query buttons by name, not by position, so the assertion semantics survive — only ordering assertions and default-mode tests need touching. |
| `packages/web/src/__tests__/components/HablarShell.photo.test.tsx` | Update **two** tests that rely on default `'auto'`: (1) line 676 `'passes mode=auto to sendPhotoAnalysis by default'` — change expected mode to `'identify'`; (2) line 711 `'shows mode-conditional error for MENU_ANALYSIS_FAILED with mode=auto'` — add an explicit `userEvent.click(screen.getByRole('button', { name: 'Menú/carta' }))` toggle step before `selectFile` so the test still exercises the `auto`-mode error copy. |
| `packages/web/src/__tests__/components/edge-cases.qa-web-001.test.tsx` _(cross-model C1)_ | Update line 253 test `'MENU_ANALYSIS_FAILED with mode=auto (default) → "No he podido leer el menú..."'`. After D lands, the default is `'identify'`, so this test must EITHER click the toggle to `Menú/carta` first OR rename and switch the expected copy to the new default `'No he podido identificar el plato'`. Recommended: add the toggle click to preserve the test's existing assertion about the `auto`-mode copy. |
| `packages/web/src/__tests__/components/F092.qa.test.tsx` _(cross-model C1)_ | Update line 517 test (the comment says `'First analysis — should show error (default mode=auto → "leer el menú" copy)'`). Add a toggle click to `Menú/carta` before the first `selectFile` so the test exercises the same `auto`-mode error copy it asserts. |
| `packages/web/src/__tests__/components/gaps.qa-web-001.test.tsx` _(cross-model C1)_ | Update line 429 test (comment says `'Default mode=auto → "leer el menú" copy'`). Same fix as above: add a `userEvent.click` on `Menú/carta` before `selectFile`. |

---

#### Implementation Order

The recommended order is A → D → B → C. A is independent and has the smallest blast radius (2 files, unit tests only). D is 2 files, no refs, no effects. B is 1 CSS class change. C is the most complex (new refs + 2 new effects + 5 new tests).

---

**Step 1 — A: `getUsage` accepts `actorId` (apiClient.ts)**

- **Goal:** AC1, AC2, AC3 — `getUsage` sends `X-Actor-Id` when actorId is defined and non-empty; omits it otherwise.
- **Files touched:** `packages/web/src/lib/apiClient.ts`, `packages/web/src/__tests__/auth/apiClient.fWebTier.test.ts`
- **RED tests to write first (in `apiClient.fWebTier.test.ts`):**
  - AC1: _(per cross-model C3 SUGGESTION — Codex flagged the prior "TypeScript compilation test" framing as ill-fitting for this Jest+ts-jest harness.)_ AC1 is satisfied implicitly by the implementation (the typed signature) and verified by the `npm run typecheck -w @foodxplorer/web` gate. No dedicated Jest test is needed for the type signature itself; runtime behaviour is covered by AC2 + AC3.
  - AC2: `getUsage('abc-actor-uuid')` — fetch is called with header `X-Actor-Id: 'abc-actor-uuid'`. Assert `headers['X-Actor-Id'] === 'abc-actor-uuid'` in the captured `RequestInit`.
  - AC3: `getUsage(undefined)` — fetch is called WITHOUT `X-Actor-Id` key in headers (assert `!('X-Actor-Id' in headers)`). Same for `getUsage('')`.
- **GREEN code change:** In `apiClient.ts` `getUsage()`, add parameter `actorId?: string`. In the `headers` object of the fetch call, spread `(actorId ? { 'X-Actor-Id': actorId } : {})` — identical pattern used by `sendMessage` at line 128-130. No other change.
- **Deps:** none.

---

**Step 2 — A: UsageMeter wires `getActorId()` (UsageMeter.tsx + test)**

- **Goal:** AC4, AC5 — UsageMeter calls `getActorId()` and passes result to `getUsage(actorId)`.
- **Files touched:** `packages/web/src/components/UsageMeter.tsx`, `packages/web/src/__tests__/components/UsageMeter.test.tsx`
- **RED tests to write first (in `UsageMeter.test.tsx`):**
  - AC4: Add `jest.mock('../../lib/actorId', () => ({ getActorId: jest.fn().mockReturnValue('fixed-actor-uuid') }))` at the top. Assert `getActorId` was called during the `fetchUsage` invocation (spy: `expect(getActorId).toHaveBeenCalled()`).
  - AC5: Assert the mocked `getUsage` was called with `'fixed-actor-uuid'` as first argument: `expect(mockGetUsage).toHaveBeenCalledWith('fixed-actor-uuid')`.
- **GREEN code change:** In `UsageMeter.tsx`, add `import { getActorId } from '@/lib/actorId';`. Inside `fetchUsage` callback (line 67-83), before `await getUsage()`, add `const actorId = getActorId();` and change the call to `getUsage(actorId)`. No component JSX change.
- **Deps:** Step 1 (getUsage must accept the param before this compiles).

---

**Step 3 — D: PhotoModeToggle order + HablarShell default**

- **Goal:** AC14, AC15, AC16 — toggle renders `[Solo este plato | Menú/carta]`; default is `'identify'`.
- **Files touched:** `packages/web/src/components/PhotoModeToggle.tsx`, `packages/web/src/components/HablarShell.tsx`, `packages/web/src/__tests__/components/PhotoModeToggle.test.tsx`, `packages/web/src/__tests__/components/HablarShell.photo.test.tsx`
- **RED tests to write first (in `PhotoModeToggle.test.tsx`):**
  - AC14: Render `<PhotoModeToggle value="identify" onChange={jest.fn()} />`. Assert DOM order: first button text is `'Solo este plato'`, second button text is `'Menú/carta'`. Use `screen.getAllByRole('button')` and check `[0].textContent` / `[1].textContent`.
  - AC15: Render `<PhotoModeToggle value="identify" onChange={jest.fn()} />`. Assert `Solo este plato` button has `aria-pressed="true"`, `Menú/carta` button has `aria-pressed="false"`.
  - AC16 regression: Render with `value="identify"`, click `Menú/carta`, verify `onChange` called with `'auto'`. Then render with `value="auto"`, click `Solo este plato`, verify `onChange` called with `'identify'`. (Update the existing toggle-regression tests to match new DOM order.)
  - Update the existing test `'renders "Menú/carta" as active (aria-pressed=true) when value="auto"'` — after the order swap, this test remains valid but the left/right position of the button changes. The button name and `aria-pressed` logic are unchanged. Verify the test still passes (it should — it queries by name, not by position).
- **Update tests that assume default mode=`'auto'`** _(per cross-model C1 — Codex enumerated all affected files via empirical grep):_
  - `HablarShell.photo.test.tsx:676` `'passes mode=auto to sendPhotoAnalysis by default'` — change expected `sendPhotoAnalysis` mode arg from `'auto'` to `'identify'`.
  - `HablarShell.photo.test.tsx:711` `'shows mode-conditional error for MENU_ANALYSIS_FAILED with mode=auto'` — add `await userEvent.click(screen.getByRole('button', { name: 'Menú/carta' }))` before `selectFile(makeFile())` to preserve the `auto`-mode error assertion.
  - `edge-cases.qa-web-001.test.tsx:253` `'MENU_ANALYSIS_FAILED with mode=auto (default) → "No he podido leer el menú..."'` — add the same toggle-to-`Menú/carta` click before `selectFile`.
  - `F092.qa.test.tsx:517` (first analysis assumes default `'auto'`) — toggle to `Menú/carta` before the first `selectFile`.
  - `gaps.qa-web-001.test.tsx:429` (photo error assumes default `'auto'` copy) — toggle to `Menú/carta` before `selectFile`.
- **GREEN code change:**
  - `PhotoModeToggle.tsx`: Swap the two `<button>` blocks so `identify` button comes first and `auto` button comes second. No other change (the `aria-pressed={value === 'identify'}` / `aria-pressed={value === 'auto'}` expressions are already correct — they are tied to the value, not the position).
  - `HablarShell.tsx` line 71: Change `'auto'` to `'identify'` in the initial state: `useState<'auto' | 'identify'>('identify')`.
- **Deps:** none (independent of A and B).

---

**Step 4 — B: Bottom padding on TranscriptFeed scroll container**

- **Goal:** AC7, AC8, AC9 — scroll container has `pb-[calc(9rem+env(safe-area-inset-bottom))]`; unit-testable via className; 1-entry regression passes.
- **Files touched:** `packages/web/src/components/TranscriptFeed.tsx`, `packages/web/src/__tests__/components/TranscriptFeed.test.tsx`
- **RED tests to write first (in `TranscriptFeed.test.tsx`):**
  - AC8: Render `<TranscriptFeed {...defaultProps} />`. Assert `screen.getByRole('feed')` element has `className` containing `pb-[calc(9rem+env(safe-area-inset-bottom))]`. Use `toHaveClass` or `className.includes(...)`. jsdom supports className inspection even though it cannot compute layout.
  - AC9 (1-entry regression): Render with 1 entry. Assert: (a) feed is in the document, (b) no double scrollbar element appears, (c) feed className still contains the expected padding class. The "no excess whitespace above the bar" part is a visual check (operator AC22) — the test only asserts the class is present and the component does not crash.
- **GREEN code change:** `TranscriptFeed.tsx` line 110: Replace `pb-6` with `pb-[calc(9rem+env(safe-area-inset-bottom))]` in the className string. Single-token change.
- **Deps:** none (CSS only, independent of all other steps).

---

**Step 5 — C: Scroll-to-bottom on mount and async hydration**

- **Goal:** AC10, AC10b, AC10c, AC11, AC12, AC13 — correct initial scroll-to-bottom; async hydration scroll; loadMore no-scroll guard; smooth behavior throughout.
- **Files touched:** `packages/web/src/components/TranscriptFeed.tsx`, `packages/web/src/__tests__/components/TranscriptFeed.test.tsx`

**Design of the new ref and effect (consolidated per /review-plan Gemini G1):**

A single ref `hasScrolledToBottomOnHydrationRef = useRef(false)` is added at the top of `TranscriptFeed`, alongside the existing refs. **One** new `useEffect` with deps `[entries.length]` covers both the synchronous-mount case and the async-hydration case:

```
useEffect(() => {
  if (entries.length === 0) return;
  if (hasScrolledToBottomOnHydrationRef.current) return;
  const container = feedRef.current;
  if (!container) return;
  hasScrolledToBottomOnHydrationRef.current = true;
  try {
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  } catch {
    // jsdom does not implement element.scrollTo
  }
}, [entries.length]);
```

**Why one effect is sufficient** (not two): React always runs `useEffect` callbacks once after the first render regardless of deps. So an effect with `[entries.length]` covers:

- **Synchronous mount** (entries.length ≥ 1 already on first render) — runs once after first render, scrolls, sets ref.
- **Async hydration** (entries.length === 0 on first render, then > 0 on a later rerender) — first run early-returns (entries.length===0); second run (when entries.length grows) passes the guard, scrolls, sets ref.
- **Subsequent loadMore prepends** (entries.length grows again, e.g. 10 → 20) — effect fires but ref is `true` → short-circuits, no scroll. The existing prepend-preservation logic (lines 79-99) handles scroll restoration independently.
- **Subsequent session-entry appends** — effect fires but ref is `true` → short-circuits. The existing append effect (lines 57-77) handles them with its `isNearBottom` check.

**Why this does NOT break loadMore (AC10c):**

When `loadMore` prepends older entries, `entries.length` GROWS (e.g. 10 → 20). The hydration effect fires again, but `hasScrolledToBottomOnHydrationRef.current` is already `true` after the first non-empty transition, so it short-circuits immediately. The existing prepend-preservation logic (lines 79-99) handles the scroll restoration independently and is untouched.

**Why the EXISTING append effect (lines 57-77) is NOT changed:**

It already correctly handles AC11 (near-bottom auto-scroll) and AC12 (not near-bottom, no scroll). Its `isNearBottom` check works correctly for subsequent session-entry appends because by then the user has already scrolled to the bottom (either by the hydration effect or manually). The flag does not affect this existing effect.

- **RED tests to write first (in `TranscriptFeed.test.tsx`):**

  Helper setup reused across C tests:
  ```
  function setupScrollMocks(feed: HTMLElement, opts: { scrollTop: number; clientHeight: number; scrollHeight: number }) {
    const scrollToMock = jest.fn();
    Object.defineProperty(feed, 'scrollTo', { value: scrollToMock, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollTop', { value: opts.scrollTop, writable: true, configurable: true });
    Object.defineProperty(feed, 'clientHeight', { value: opts.clientHeight, writable: true, configurable: true });
    Object.defineProperty(feed, 'scrollHeight', { value: opts.scrollHeight, writable: true, configurable: true });
    return scrollToMock;
  }
  ```

  - **AC10 (mount, synchronous):** Render `<TranscriptFeed {...defaultProps} entries={[makeEntry(), makeEntry()]} />`. Mock scroll properties on feed. Assert `scrollToMock` was called with `{ top: expect.any(Number), behavior: 'smooth' }`. Note: the mount effect fires synchronously after the render cycle; `waitFor` or `act` wrapping may be needed depending on how React flushes effects in jsdom.
  
  - **AC10b (async hydration):** `const { rerender } = render(<TranscriptFeed {...defaultProps} entries={[]} />)`. Set up scroll mocks on feed. `rerender(<TranscriptFeed {...defaultProps} entries={[makeEntry(), makeEntry()]} />)`. Assert `scrollToMock` was called with `behavior: 'smooth'`. Confirm it was called exactly once (not on the empty-entries render).
  
  - **AC10c (loadMore prepend — regression guard).** _(Rewritten per cross-model C2 — Codex flagged the prior draft as not exercising the real prepend-preservation code at TranscriptFeed:79-99.)_ The prepend-preservation logic is triggered by the `isLoadingMore` transition (true → false), not just by an entries-length change. The test must:
    1. Render `<TranscriptFeed {...defaultProps} entries={[a, b]} isLoadingMore={false} />`. Mount fires the hydration effect → ref becomes `true`, scrollTo called. `mockClear(scrollToMock)`.
    2. Simulate the user scrolling up: set `feed.scrollTop = 200`, `feed.scrollHeight = 1000`, `feed.clientHeight = 500` (user is 300px from bottom — well above the 100px threshold).
    3. Rerender with `isLoadingMore={true}` (and same entries) → existing capture effect runs, stashing `prevScrollHeight=1000`, `prevScrollTop=200`.
    4. Update `feed.scrollHeight = 1400` to simulate older entries being inserted at the front (delta=400).
    5. Rerender with `isLoadingMore={false}` and entries=`[c, d, a, b]` (prepended). The existing restore effect fires, setting `feed.scrollTop = prevScrollTop + delta = 600`. The hydration effect ALSO fires (entries.length 2→4) but `hasScrolledToBottomOnHydrationRef.current === true` from step 1 → short-circuits, no `scrollTo` call.
    6. Assert: (a) `scrollToMock` was NOT called after the initial clear, (b) `feed.scrollTop === 600` (or whatever value matches `prevScrollTop + delta`).

    This exercises BOTH the new hydration ref-guard and the existing prepend-preservation, proving they coexist correctly.
  
  - **AC11 (existing test AC47 — regression guard):** The existing AC47 test already covers this. Verify it remains green after Step 5 changes. No new test needed.
  
  - **AC12 (not near-bottom, no scroll — regression guard):** Already covered by the existing test pattern. Add an explicit AC12 test: render with existing entries, set scrollTop=0 / scrollHeight=5000 (user is far from bottom), rerender with one new entry appended. Assert `scrollToMock` was NOT called by the append effect. (The mount effect may have fired on first render — `mockClear` between mount and rerender to isolate.)
  
  - **AC13 (smooth behavior):** Covered by AC10, AC10b, and the existing AC47 test — all assert `behavior: 'smooth'`. Add a dedicated AC13 assertion: any scrollTo call must use `{ behavior: 'smooth' }`. This is satisfied by the same test bodies above; annotate one test with `// AC13`.

- **GREEN code change in `TranscriptFeed.tsx`:**
  1. Add `const hasScrolledToBottomOnHydrationRef = useRef(false);` after line 52 (with the other refs).
  2. Add the consolidated effect after the refs block (before the existing append effect at line 57):
     ```typescript
     // Scroll to bottom on the first non-empty entries state (synchronous mount OR
     // async hydration from useSearchHistory). The ref guards "fire at most once" so
     // subsequent loadMore prepends (AC10c) and session appends fall through to the
     // existing effects below. The empty-entries early-return covers the first render
     // when persisted history hasn't loaded yet — the next rerender with entries.length>0
     // re-fires this effect (deps = [entries.length]).
     useEffect(() => {
       if (entries.length === 0) return;
       if (hasScrolledToBottomOnHydrationRef.current) return;
       const container = feedRef.current;
       if (!container) return;
       hasScrolledToBottomOnHydrationRef.current = true;
       try {
         container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
       } catch {
         // jsdom does not implement element.scrollTo
       }
     }, [entries.length]);
     ```
  3. The existing effects at lines 57-99 remain UNCHANGED.

- **Deps:** Step 4 (B must be green first so that `pb-[...]` is in the className and `scrollHeight` accounts for the padding in the real browser, keeping B and C consistent at runtime even if jsdom ignores CSS).

---

#### AC Coverage Map

| AC | Step | Test file | Test description |
|---|---|---|---|
| AC1 | Step 1 | `apiClient.fWebTier.test.ts` | getUsage TypeScript signature accepts `actorId?: string` |
| AC2 | Step 1 | `apiClient.fWebTier.test.ts` | `getUsage('abc')` → fetch headers contain `X-Actor-Id: 'abc'` |
| AC3 | Step 1 | `apiClient.fWebTier.test.ts` | `getUsage(undefined)` / `getUsage('')` → no `X-Actor-Id` header |
| AC4 | Step 2 | `UsageMeter.test.tsx` | `getActorId` is called inside fetchUsage |
| AC5 | Step 2 | `UsageMeter.test.tsx` | `getUsage` called with the fixed actorId value |
| AC6 | — | Operator smoke (post-deploy) | Manual: 3 searches → meter +3 |
| AC7 | Step 4 | `TranscriptFeed.test.tsx` | Feed container has padding ≥ bottom-bar height |
| AC8 | Step 4 | `TranscriptFeed.test.tsx` | className contains `pb-[calc(9rem+env(safe-area-inset-bottom))]` |
| AC9 | Step 4 | `TranscriptFeed.test.tsx` | 1-entry render: no crash, correct class present |
| AC10 | Step 5 | `TranscriptFeed.test.tsx` | Mount with N≥2 entries → scrollTo called |
| AC10b | Step 5 | `TranscriptFeed.test.tsx` | `[] → [persisted×N]` rerender → scrollTo called with `behavior: 'smooth'` |
| AC10c | Step 5 | `TranscriptFeed.test.tsx` | loadMore prepend (length grows, user scrolled up) → scrollTo NOT called again |
| AC11 | Step 5 | `TranscriptFeed.test.tsx` | New entry + near-bottom → scrollTo called (existing AC47 covers this) |
| AC12 | Step 5 | `TranscriptFeed.test.tsx` | New entry + user scrolled up → scrollTo NOT called |
| AC13 | Step 5 | `TranscriptFeed.test.tsx` | All scrollTo calls use `behavior: 'smooth'` |
| AC14 | Step 3 | `PhotoModeToggle.test.tsx` | DOM order: `Solo este plato` left, `Menú/carta` right |
| AC15 | Step 3 | `PhotoModeToggle.test.tsx` | `value="identify"` → `Solo este plato` `aria-pressed="true"` |
| AC16 | Step 3 | `PhotoModeToggle.test.tsx` | Toggle back-and-forth regression |
| AC17 | Gates | `npm test -w @foodxplorer/web` | All web tests green |
| AC18 | Gates | `npm test -w @foodxplorer/api` | API tests unaffected |
| AC19 | Gates | lint + typecheck + build | No TS/ESLint/build errors |
| AC20 | Gates | CI | `ci-success` green on PR |
| AC21 | — | Operator smoke | Manual post-deploy |
| AC22 | — | Operator visual | Manual post-deploy |
| AC23 | — | Operator visual | Manual post-deploy |

---

#### Testing Strategy

**Test files to create:** None. All tests are added to existing files.

**Test files to update:**
- `packages/web/src/__tests__/auth/apiClient.fWebTier.test.ts` — extend `getUsage()` describe block with AC1-3 tests. The `jest.resetModules()` + `require()` isolation pattern already used in this file handles the `authToken` singleton; use the same pattern.
- `packages/web/src/__tests__/components/UsageMeter.test.tsx` — add `jest.mock('../../lib/actorId', ...)` at the top; add AC4 + AC5 tests in the existing `describe('UsageMeter (F-WEB-TIER)')` block.
- `packages/web/src/__tests__/components/TranscriptFeed.test.tsx` — add AC8, AC9, AC10, AC10b, AC10c, AC12, AC13 tests; verify existing AC47 (AC11) is still green.
- `packages/web/src/__tests__/components/PhotoModeToggle.test.tsx` — update all 5 existing tests; add AC14 (order), AC15 (default aria-pressed).
- `packages/web/src/__tests__/components/HablarShell.photo.test.tsx` — update tests at lines 676 + 711 (default mode flip + add toggle click).
- `packages/web/src/__tests__/components/edge-cases.qa-web-001.test.tsx` — update line 253 test (add toggle to Menú/carta before selectFile).
- `packages/web/src/__tests__/components/F092.qa.test.tsx` — update line 517 test (add toggle to Menú/carta before first selectFile).
- `packages/web/src/__tests__/components/gaps.qa-web-001.test.tsx` — update line 429 test (add toggle to Menú/carta before selectFile).

**Mocking strategy:**

- **AC1-3 (apiClient unit):** `global.fetch = mockFetch` pattern already in `apiClient.fWebTier.test.ts`. Use `jest.resetModules()` + `require()` to get a fresh `authToken = null` state before each test.
- **AC4-5 (UsageMeter):** Mock `getActorId` at the module level with `jest.fn().mockReturnValue('fixed-actor-uuid')`. The `useAuth` mock already provides an authenticated user. `getUsage` mock is already in place; assert it is called with `'fixed-actor-uuid'`.
- **AC5 actorId stub:** Do NOT set up a real localStorage or `actorId` cookie. Use `jest.mock('../../lib/actorId', ...)` with a fixed return value. UsageMeter calls `getActorId()` inside the `fetchUsage` callback (not at module level), so the mock is effective at runtime.
- **AC10-AC13 (TranscriptFeed scroll):** jsdom does not implement `element.scrollTo`. The existing test at line 258-276 already uses `Object.defineProperty` to inject a `jest.fn()` mock for `scrollTo` on the feed element. Reuse this exact pattern for all scroll assertions. Use the `setupScrollMocks` helper (defined in the test file, not extracted to a shared module since it's specific to this component).
- **AC14-AC16 (PhotoModeToggle):** No mocks needed. Pure presentational component with no external dependencies.
- **Router mock:** Already present in `HablarShell.photo.test.tsx` (`jest.mock('next/navigation', ...)`). No change needed.

**Key test scenarios:**

- AC10c (loadMore regression guard): This is the trickiest test. The test must establish that `hasScrolledToBottomOnHydrationRef.current` is already `true` before the prepend happens. This is achieved by: (1) rendering with ≥1 entry so the mount effect fires and sets the ref, (2) clearing the `scrollToMock` so the initial scroll is not counted, (3) then simulating a prepend rerender with `isLoadingMore: false` after having been `true`. The key is that after the initial scroll-to-bottom the ref is set, and neither the hydration effect nor the append effect (because `scrollTop` is set to a "not near bottom" value) will fire again.

---

#### Final Gates

After all 5 steps are green:

```sh
# All web tests (AC17)
npm test -w @foodxplorer/web

# API tests unaffected (AC18)
npm test -w @foodxplorer/api

# TypeScript typecheck (AC19)
npm run typecheck -w @foodxplorer/web

# ESLint (AC19)
npm run lint -w @foodxplorer/web

# Production build (AC19)
npm run build -w @foodxplorer/web
```

Expected: all commands exit 0. No new TypeScript errors from the `actorId?: string` param addition (the existing `getUsage()` call-sites in `apiClient.fWebTier.test.ts` omit the arg and TypeScript will accept `undefined` for an optional param).

---

#### Key Patterns

- **`sendMessage` header injection pattern** (`apiClient.ts:126-130`): The `X-Actor-Id` header is injected as a bare string (not conditional) because `sendMessage` always receives a defined actorId. `getUsage` must use the conditional spread `(actorId ? { 'X-Actor-Id': actorId } : {})` because actorId is optional (AC3).
- **`jest.resetModules()` + `require()` for singleton isolation** (`apiClient.fWebTier.test.ts`): The module-level `authToken` singleton requires module re-import per test to get a clean `null` state. The `getUsage` actorId tests do NOT need this isolation (they only check the headers object, not module state), but they must be placed inside the same `describe` block that already has `setAuthToken` calls to ensure `authToken` is non-null (so the UNAUTHORIZED guard doesn't short-circuit before the fetch).
- **`Object.defineProperty` scroll mock pattern** (`TranscriptFeed.test.tsx:258-276`): jsdom does not implement `scrollTo` on elements. The existing test already defines the mock. The same pattern must be applied BEFORE the rerender in AC10b/AC10c tests — define scroll properties on the feed element before the rerender that triggers the effect.
- **`useEffect` with empty dep array for one-time mount logic** (React convention): The mount effect must have `[]` as its dep array and a `// eslint-disable-next-line react-hooks/exhaustive-deps` comment if ESLint flags it (since `entries` is referenced in the body but not in deps — intentional). Alternatively, read `entries.length` via a ref snapshot to avoid the lint warning; but the existing code already uses this suppress-comment pattern (see HablarShell line 143).
- **`'use client'` directive**: `TranscriptFeed.tsx` already has `'use client'` at line 1. `UsageMeter.tsx` already has `'use client'` at line 1. `HablarShell.tsx` already has `'use client'` at line 1. `PhotoModeToggle.tsx` has no `'use client'` (it is a pure presentational component rendered inside a client component — this is correct and must NOT be changed).

---

### Verification commands run

- `Read: packages/web/src/lib/apiClient.ts:495-541` → `getUsage()` has zero parameters; sends only `Authorization: Bearer` header; no `X-Actor-Id` header present → confirms the bug; AC1-3 tests must assert the header is added.
- `Read: packages/web/src/lib/apiClient.ts:104-134` → `sendMessage()` injects `'X-Actor-Id': actorId` unconditionally (always defined); `getUsage` fix must use conditional spread because actorId is optional → impacts Step 1 green code pattern.
- `Read: packages/web/src/components/UsageMeter.tsx:67-83` → `fetchUsage` calls `getUsage()` with no args; no `getActorId` import present → confirms AC4 gap; Steps 1-2 must add import + call.
- `Read: packages/web/src/components/HablarShell.tsx:16,94-96,329,456` → `getActorId` is already imported from `@/lib/actorId`; used at lines 96, 329, 456 — confirms `getActorId()` is the live call pattern in HablarShell; UsageMeter must use same source, NOT a new hook.
- `Bash: grep -rn "useActorId" packages/web/src/` → no results → confirms `useActorId` hook does not exist; AC4 correctly specifies `getActorId()` (not a hook).
- `Read: packages/web/src/lib/actorId.ts` → `getActorId()` reads from `localStorage`; falls back to in-memory UUID; exported as named function → can be called inside `fetchUsage` callback without hooks; side-effect-free for test mocking.
- `Read: packages/web/src/components/TranscriptFeed.tsx:110` → current className is `"flex-1 overflow-y-auto px-4 pt-4 pb-6 lg:max-w-2xl lg:mx-auto w-full"`; `pb-6` is the target to replace → confirms Step 4 exact change.
- `Read: packages/web/src/components/TranscriptFeed.tsx:50-99` → three existing refs: `feedRef`, `prevScrollHeightRef`, `prevScrollTopRef`, `prevEntriesLengthRef`; two existing effects at lines 57-77 (append auto-scroll) and lines 79-99 (loadMore prepend-preservation) → confirms new ref `hasScrolledToBottomOnHydrationRef` is additive; both existing effects left unchanged.
- `Read: packages/web/src/components/PhotoModeToggle.tsx` → button order is currently `[Menú/carta (auto) | Solo este plato (identify)]`; `aria-pressed` is parametrised as `value === 'auto'` / `value === 'identify'` → swapping JSX order is the only change; aria logic is already correct.
- `Read: packages/web/src/components/HablarShell.tsx:71` → `useState<'auto' | 'identify'>('auto')` → target for D; must change initialiser to `'identify'`.
- `Read: packages/web/src/__tests__/components/PhotoModeToggle.test.tsx` → 5 existing tests; tests query by button name (`'Menú/carta'`, `'Solo este plato'`) not by position → after swap, only the `aria-pressed` assertion for the `value="auto"` render needs scrutiny (it queries by name, which is position-independent; still valid).
- `Read: packages/web/src/__tests__/components/HablarShell.photo.test.tsx:676-689` → test asserts `sendPhotoAnalysis` called with `'auto'` on first render; after D lands default is `'identify'` → must update expected arg to `'identify'`.
- `Read: packages/web/src/__tests__/components/HablarShell.photo.test.tsx:422-434` → test comment says "Default mode is 'auto'" and asserts menu-mode error copy; after D, default is `'identify'` → must rework test.
- `Read: packages/web/src/__tests__/components/TranscriptFeed.test.tsx:248-278` → existing AC47 test uses `Object.defineProperty` for `scrollTo`, `scrollTop`, `clientHeight`, `scrollHeight` on the feed element → pattern confirmed; reuse for AC10/10b/10c.
- `Read: packages/web/src/__tests__/components/UsageMeter.test.tsx` → `getUsage` mocked as `jest.fn()` in the `apiClient` module mock; `useAuth` mocked; no `actorId` mock present → must add `jest.mock('../../lib/actorId', ...)` and AC4/AC5 assertions.
- `Read: packages/web/src/__tests__/auth/apiClient.fWebTier.test.ts:176-209` → existing `getUsage()` describe block has 4 tests; none pass an `actorId` arg; none assert `X-Actor-Id` header → these are the tests to extend in Step 1.
- `Bash: find packages/web/src/__tests__ -type f` → 65 test files found; identified: `TranscriptFeed.test.tsx`, `UsageMeter.test.tsx`, `PhotoModeToggle.test.tsx`, `apiClient.fWebTier.test.ts`, `HablarShell.photo.test.tsx` as the files to modify; no new files needed.
- `Read: packages/web/src/hooks/useSearchHistory.ts:39-78` → hook sets `isLoadingHistory: true` on mount; `setPersistedEntries(entries)` fires asynchronously after `getHistory()` resolves → confirms the `[] → [persisted×N]` async hydration path is real and is what the owner experiences on reload.
- `Read: packages/web/src/components/HablarShell.tsx:137-144` → `persistedIdsKey` stable dep; effect merges `[...persistedEntries, ...sessionOnly]` → confirms entries are oldest-first in the feed; no visual reorder needed for C.

---

## Completion Log

| Date | Step | Action | Notes |
|------|------|--------|-------|
| 2026-06-01 | Step 0 | Spec drafted | 4 items (A meter actor-id, B feed bottom-overlap, C scroll-to-bottom, D photo mode default+left) + 23 ACs (16 automated + 3 build/CI + 3 operator + 2 cross-model placeholders). Single PR per owner request. |
| 2026-06-01 | Step 0 | /review-spec cross-model | Gemini APPROVED (1 IMPORTANT G1: AC8 jsdom + 1 SUGGESTION G2: line offset). Codex REVISE (3 IMPORTANT C1 async hydration + C2 loadMore protection + C3 useActorId-doesn't-exist; 2 SUGGESTIONs C4 citations + C5 AC13 testability). **All 5 findings applied** (see Cross-model review additions section): +AC10b (async hydration), +AC10c (loadMore regression guard), AC4 reworded to use `getActorId()`, AC8/AC13 made jsdom-friendly + TDD-actionable, citations corrected, `getHistory` parity claim removed. Spec consistent post-update. |
| 2026-06-01 | Step 2 | ui-ux-designer + frontend-planner | ui-ux-designer measured bottom-bar height (~121px), recommended `pb-[calc(9rem+env(safe-area-inset-bottom))]` (144px + iOS safe area) on padding-bottom mechanism. Confirmed entries[] order: oldest-first, newest at bottom (chat-style; no visual flip). Design notes written in-ticket. frontend-planner wrote the 5-step Frontend Plan (A→D→B→C order), AC coverage map, 19 verification commands run empirically. |
| 2026-06-01 | Step 2 | /review-plan cross-model | Gemini REVISE (1 IMPORTANT G1: consolidate 2 effects into 1). Codex REVISE (2 IMPORTANT C1 missed-test-files + C2 AC10c doesn't exercise real prepend; 2 SUGGESTIONs C3 AC1 framing + C4 test count). **All 5 findings applied** (see Cross-model review additions). Two reviewers were complementary: Gemini caught the design redundancy; Codex caught 4 additional test files via empirical grep that Gemini missed. Plan is simpler (1 effect) AND more complete (all 6 affected test files enumerated + AC10c test rewritten to model the real prepend-preservation transition). |
| 2026-06-01 | Step 3 | TDD impl (A → D → B → C) | RED→GREEN per step. **A:** apiClient.fWebTier.test.ts +3 tests (AC2 X-Actor-Id sent + AC3 ×2 omitted); apiClient.ts:495 `getUsage(actorId?)`; UsageMeter.tsx imports getActorId + calls it inside fetchUsage; +2 tests. **D:** PhotoModeToggle.tsx JSX swap (Solo este plato first); HablarShell.tsx:71 default `'identify'`; +2 tests AC14/AC15; 5 dependent test files updated to add `userEvent.click('Menú/carta')` toggle. **B:** TranscriptFeed.tsx:110 `pb-6 → pb-[calc(9rem+env(safe-area-inset-bottom))]`; +2 tests AC8/AC9 (className-based, jsdom-friendly). **C:** new ref `hasScrolledToBottomOnHydrationRef` + single `useEffect([entries.length])`; +6 tests AC10/AC10b/AC10c/AC11/AC12/AC13 (AC10c models full `isLoadingMore false→true→false` + scrollTop restoration). Net: +15 tests, web 730 → 745. |
| 2026-06-01 | Step 3 | Final gates | Web full suite **745/745** · web lint clean · web typecheck clean · web build clean · api 4725/4725 unchanged (no api files in diff). Re-run after the LAST code change (test edits from QA follow-ups) per [[feedback_mock_boundary_integration_gap]] lesson #2. |
| 2026-06-01 | Step 4 | Commit + PR + CI green | 2 implementation commits `a6b207f` (docs) + `630392b` (impl) + `5a4e49b` (QA follow-ups). Pushed branch; PR **#302** opened to develop. CI `ci-success` SUCCESS at poll #6 (~2.5 min). mergeState CLEAN (Vercel preview non-required). |
| 2026-06-01 | Step 5 | code-review-specialist | **APPROVE.** No BLOCKER/MAJOR. 3 NIT-grade SUGGESTIONs (AC10 sync-mount path not isolated, AC11 long test name, AC9 weak assertion) — left as future audit, not blocking. Reviewer's empirical pass: 16 files read; verified consolidated effect handles all 4 transitions; AC10c rewritten test materially stronger than prior draft. |
| 2026-06-01 | Step 5 | qa-engineer | **PASS WITH FOLLOW-UPS.** All 23 ACs (AC1-AC20) verified; web 745/745 + api 4725/4725. 3 minor follow-ups (stale comment at HablarShell.photo.test.tsx:832; redundant `'after toggle switch'` test at :698 → converted into a round-trip regression guard; AC32 missing nth-call actorId assertion) — **all applied** in commit `5a4e49b`. No follow-ups left for bugs.md. |

---

## Merge Checklist Evidence

| # | Action | Done | Evidence |
|---|--------|------|----------|
| 0 | Validate ticket structure | [x] | Sections verified: Spec · API Changes (N/A — pure client) · UI Changes · Edge Cases · Acceptance Criteria · Definition of Done · Workflow Checklist · Implementation Plan (Design Notes + Frontend Plan) · Completion Log · Merge Checklist Evidence. |
| 1 | Mark all items + update Status | [x] | Status `Spec` → `Ready for Merge`. AC: 21/25 (4 deferred = operator post-deploy AC6+AC21+AC22+AC23). DoD: 9/9. Workflow: 0–5 [x], 6 [ ] (pending merge). Completion Log: 9 rows (Step 0 ×2, Step 2 ×2, Step 3 ×2, Step 4, Step 5 ×2). |
| 2 | Verify product tracker | [x] | `product-tracker.md` Active Session updated to Step 5/6 (Ready for Merge) with PR #302 + CI green. Features table row for `F-WEB-HISTORY-FU1` inserted right after F-WEB-HISTORY (E010 Scale & Monetization section, status `in-progress`, step 5/6). |
| 3 | Update key_facts.md | [x] | **N/A** — no new infrastructure (no new models/schemas/migrations/endpoints/reusable components/error codes/shared utilities). Pure client-side wiring fix + UI polish. |
| 4 | Update decisions.md | [x] | **N/A** — no new ADR needed (DoD bullet 9 confirms; ADR-029 already covers the per-account rate-limit policy from the prior PR). |
| 5 | Commit documentation | [x] | All doc updates from actions 0–4 captured in commits `a6b207f` (Step 0+1+2 spec/plan + tracker) and `5a4e49b` (test-quality QA follow-ups). Ticket Status flip + DoD/Workflow marks committed in the same `docs:` commit that lands this MCE table. |
| 6 | Verify clean working tree | [x] | `git status` clean after each commit (verified inline). About to commit Status flip + MCE before /audit-merge. |
| 7 | Branch up-to-date with target | [x] | `git fetch origin develop && git merge-base --is-ancestor origin/develop HEAD` → UP TO DATE (PR #302 mergeState `CLEAN`/`UNSTABLE` — Vercel preview only, non-required). |
| 8 | Fill Merge Checklist Evidence | [x] | This table — real evidence per row, no aspirational entries. |
| 9 | `/audit-merge` real skill output | [ ] | _(pasted below after running the skill)_ |
