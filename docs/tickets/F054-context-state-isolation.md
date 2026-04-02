# F054: Context State Isolation & NL Footer Consistency

**Feature:** F054 | **Type:** Bug | **Priority:** Medium
**Status:** Done | **Branch:** (merged to develop, deleted)
**Created:** 2026-03-29 | **Dependencies:** None
**Audit Source:** `docs/research/comprehensive-audit-2026-03-29.md` — Findings I3, I4

---

## Spec

### Description

Two related context management issues:

**Bug 1 (I3): Context TTL refreshed by unrelated state writes**

All bot state (`chainContext`, `selectedRestaurant`, `searchResults`, `pendingSearch`, `pendingPhotoFileId`) lives in a single Redis key (`bot:state:{chatId}`) with one shared TTL (7200s). Every `setState()` call — including restaurant searches, photo uploads, and restaurant selection — resets the TTL to 7200s via `redis.setex()`.

This means the `chainContext` expiry is silently extended by unrelated actions. The manual states: *"El contexto expira automáticamente tras 2 horas desde el último cambio de contexto (establecer o borrar). Las consultas normales no reinician el temporizador."* — but `/restaurante`, photo handling, and other state writes DO reiniciate it.

**Bug 2 (I4): NL handler doesn't append "Contexto activo" footer**

The manual (Section 8, line 341) shows an NL query (`big mac`) with active context returning a "Contexto activo: McDonald's Spain" footer. In code, `/estimar` (estimar.ts:90) explicitly appends this footer, but the NL handler (naturalLanguage.ts:222) returns `formatEstimate(data)` directly without it.

Users see "Contexto activo" when using `/estimar big mac` but NOT when typing just `big mac` as natural language — inconsistent behavior for the same underlying operation.

### Files to Modify

**For I3 (context TTL isolation):**

| File | Change |
|------|--------|
| `packages/bot/src/lib/conversationState.ts` | Option A: Separate `chainContext` into its own Redis key (`bot:context:{chatId}`, independent TTL). Option B: Accept current behavior and update manual to say "context expires 2h after last bot interaction" |

**For I4 (NL footer):**

| File | Change |
|------|--------|
| `packages/bot/src/handlers/naturalLanguage.ts` | Append "Contexto activo: {chainName}" footer when `fallbackChainSlug` was used (same logic as estimar.ts:90) |

### Design Considerations

**I3 — Two options:**

- **Option A (separate Redis key)**: Create `bot:context:{chatId}` with its own TTL. Only `/contexto` set/clear and `detectContextSet` write to this key. State reads merge both keys. More code, but accurate TTL behavior.
- **Option B (accept and document)**: Keep shared key, update manual to say "2 horas desde la última interacción con el bot" instead of "desde el último cambio de contexto". Simpler, pragmatic.
- **Recommended**: Option B (YAGNI). The shared TTL is actually better UX — context surviving while the user is actively using the bot makes more sense than expiring mid-session. Just fix the documentation.

**I4 — Straightforward:**

- Read `fallbackChainSlug` and `chainName` from state. If the NL handler used a fallback chain (no explicit `en <chain>`), append the context footer to the formatted result — same pattern as estimar.ts.

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

### I3 — Context TTL
- [x] Manual Section 8 accurately describes when context TTL resets (either "last interaction" or "last context change" depending on chosen approach)
- [x] Manual Section 13 limits table matches the chosen behavior
- [x] If Option B: Manual updated, no code change needed

### I4 — NL Footer
- [x] NL handler appends "Contexto activo: {chainName}" when fallback chain is used
- [x] NL handler does NOT append footer when explicit `en <chain>` is specified
- [x] NL handler does NOT append footer when no context is active
- [x] Footer format matches `/estimar` output exactly (italic `_Contexto activo: ..._`)
- [x] All existing tests pass (no regressions) — 1097 total (1093 + 4 new)
- [x] New tests: 4 in f054.nl-context-footer.test.ts

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds (`tsc --noEmit`)

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket updated, tracker updated
- [x] Step 3: TDD implementation (4 tests, RED→GREEN)
- [x] Step 4: Quality gates pass (1097 tests, tsc clean)
- [x] Step 5: PR created (#49), review
- [x] Step 6: Ticket updated, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-29 | Ticket created | From comprehensive audit findings I3 + I4 (Codex), verified in code |
| 2026-03-29 | Implementation | I3: Option B — updated manual Section 8 + Section 13 (TTL description). I4: added "Contexto activo" footer to NL handler matching /estimar pattern. 4 new tests, 1097 total passing |
| 2026-03-29 | Squash merged to develop | SHA fb9d63b, PR #49. Branch deleted |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan (N/A), AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 9/9 (I3: 3/3, I4: 6/6), DoD: 5/5, Workflow: 4/5 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: 5/6 |
| 3. Update key_facts.md | [x] | N/A — no new endpoints or modules |
| 4. Update decisions.md | [x] | N/A — no ADR needed |
| 5. Commit documentation | [x] | Included in docs commit |
| 6. Verify clean working tree | [x] | Clean after commit (untracked files are pre-existing tickets, not F054) |

---

*Ticket created: 2026-03-29*
