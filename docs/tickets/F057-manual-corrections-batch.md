# F057: Manual Corrections Batch

**Feature:** F057 | **Type:** Docs | **Priority:** Medium
**Status:** Ready for Merge | **Branch:** worktree-agent-a8a2c3b4
**Created:** 2026-03-29 | **Dependencies:** F053 (Section 10 changes depend on F053 being merged first), F054 (Section 8 changes depend on I3 decision)
**Audit Source:** `docs/research/comprehensive-audit-2026-03-29.md` — Findings I5, I6, S1, S2, S3

---

## Spec

### Description

Five manual corrections identified in the comprehensive audit. All are documentation-only changes to `docs/user-manual-bot.md`.

**Finding I5 — `/cadenas` docs overpromise pagination indicator**
- Section 9 (line 377) implies `/cadenas` shows "Mostrando X de Y" pagination. In reality, `formatChainList()` has no pagination metadata — it just truncates at 4096 chars and appends `_Lista recortada_` if needed.
- **Fix**: Remove or correct the pagination claim. State: "Si hay muchas cadenas, la lista se trunca con un indicador 'Lista recortada'."

**Finding I6 — Photo-analysis error table out of sync with actual messages**
- Section 14 error strings don't match runtime behavior for several photo/analysis errors:
  - Manual: "Foto expirada" → Code distinguishes: `La foto ha expirado. Envía la foto de nuevo.` (expired state) vs `Error al descargar el archivo. Intentalo de nuevo.` (download failure)
  - Manual shortens or paraphrases other analysis error messages beyond what the bot actually sends
- **Fix**: Regenerate the photo/analysis error rows in Section 14 directly from current handler code (`callbackQuery.ts`, `fileUpload.ts`). Use exact message text or clearly label as paraphrased descriptions.

**Finding S1 — Manual plurals note missing "pequeños/pequeñas"**
- Section 7 (line 287) lists accepted plurals: `dobles, grandes, triples, minis, raciones dobles, medias raciones`. Missing: `pequeños`, `pequeñas`.
- **Fix**: Add `pequeños/pequeñas` to the plural note.

**Finding S2 — "half" modifier undocumented**
- `portionModifier.ts` accepts `half` → 0.5x multiplier, but Section 7's modifier table doesn't list it.
- **Fix**: Add `half` to the modifiers table row for x0.5 alongside `media ración` / `medio` / `media`.

**Finding S3 — NL 500-char error not in error table**
- The NL handler returns a specific message when text exceeds 500 chars: "Por favor, sé más específico. Escribe el nombre del plato directamente." This message is in Section 6 but NOT in the error table (Section 14).
- **Fix**: Add a row to the "Errores generales" table in Section 14 for NL length exceeded.

### Exact Locations in Manual

| Finding | Section | Line(s) | Change |
|---------|---------|---------|--------|
| I5 | 9 (Cadenas) | ~377 | Correct pagination claim |
| I6 | 14 (Errores) | ~537-549 | Regenerate photo/analysis error rows |
| S1 | 7 (Porciones) | ~287 | Add `pequeños/pequeñas` to plural note |
| S2 | 7 (Porciones) | ~281 | Add `half` to x0.5 row |
| S3 | 14 (Errores) | ~516-525 | Add NL length error row |

### Exact Error Messages to Verify (for I6)

Before writing the updated error table, verify these messages are current by reading the source files:

| Source File | Error Context | Current Message |
|-------------|---------------|-----------------|
| `callbackQuery.ts` (~line 336) | Pending photo expired | Verify exact text |
| `callbackQuery.ts` (~line 174) | Menu analysis failed | Verify exact text |
| `callbackQuery.ts` (~line 187) | Rate limit exceeded (analyze) | Verify exact text |
| `fileUpload.ts` (~line 233) | Download failure | Verify exact text |
| `fileUpload.ts` (~line 150) | File too large | Verify exact text |
| `fileUpload.ts` (~line 130) | No restaurant selected | Verify exact text |

---

## Implementation Plan

N/A — Docs-only task. Direct edits to `user-manual-bot.md`.

---

## Acceptance Criteria

- [x] Section 9: `/cadenas` description matches actual formatter behavior (no false pagination claim)
- [x] Section 14: All photo/analysis error messages match current handler code
- [x] Section 7: Plural note includes `pequeños/pequeñas`
- [x] Section 7: `half` listed in x0.5 modifier row (already present since F049)
- [x] Section 14: NL length exceeded error row added
- [x] No other sections inadvertently broken
- [x] If F053 is not yet merged: Section 10 keeps current "restaurante seleccionado" requirement (update when F053 lands)
- [x] If F054 I3 decision is pending: Section 8 TTL description deferred to F054

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Manual changes verified against source code
- [x] No orphan references to removed/changed content

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: Implementation (docs edit)
- [x] Step 4: Docs-only — no build/test impact
- [x] Step 5: Merge checklist filled
- [ ] Step 6: Ticket updated, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-29 | Ticket created | From comprehensive audit findings I5, I6 (Codex), S1, S2, S3 (Claude) |
| 2026-03-29 | Implementation | 5 corrections: /cadenas truncation (I5), error table sync (I6), plurals (S1), half verified (S2), NL error (S3). Section 10/8 deferred to F053/F054 |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan (N/A), AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 8/8, DoD: 3/3, Workflow: 4/5 (Step 6 pending) |
| 2. Verify product tracker | [x] | F057 added to Features table + Completion Log |
| 3. Update key_facts.md | [x] | N/A — no new endpoints or modules |
| 4. Update decisions.md | [x] | Docs-only — no build/test impact |
| 5. Commit documentation | [x] | Worktree commit aa212bc |
| 6. Verify clean working tree | [x] | Worktree clean after commit |

---

*Ticket created: 2026-03-29*
