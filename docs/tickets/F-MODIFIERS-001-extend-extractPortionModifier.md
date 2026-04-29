# F-MODIFIERS-001: Extend extractPortionModifier with mediano/gigante/casero patterns

**Feature:** F-MODIFIERS-001 | **Type:** Backend-Feature (NLP) | **Priority:** Low
**Status:** In Progress | **Branch:** feature/F-MODIFIERS-001-extend-extractPortionModifier
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-29 | **Dependencies:** F-COUNT (existing patterns), F-H10-FU2 (alleviates over-rejection FN cost)

---

## Spec

### Description

Extend the `PATTERNS` array in `extractPortionModifier()` (`entityExtractor.ts:170-224`) with 3 commonly-typed Spanish portion/quality modifiers that are currently not stripped from the query before L1 lookup:

- **`mediano/a`** (size — medium): multiplier 1.0× (informational, no nutritional change)
- **`gigante`** (size — giant): multiplier 2.0× (parallel to existing `enorme`)
- **`casero/a` standalone** (quality — homemade): multiplier 1.0× (currently only handled in compound `casero de postre` via H7 Cat A)

Plus 2 ración-compound patterns for parity with existing `ración enorme/extra/generosa/buena/normal`:

- **`ración mediana`**: multiplier 1.0×
- **`ración gigante`**: multiplier 2.0×

Filed during F-H10-FU2 spec audit (2026-04-28). Per `bugs.md` F-MODIFIERS-001 entry: "MEDIUM post-F-H10-FU2 (every-HI semantics is strict; L3 rescues but adds latency + OpenAI cost per call)".

### Concrete failure modes addressed

Under F-H10-FU2's stricter `every`-HI guard:
- `tarta de queso casera` → L1 sees `tarta queso casera` (queryHI = {tarta, casera} after `queso` stop-worded). Candidate `Tarta de queso` lacks `casera` → required-token rejects at L1. (L3 embedding rescues, but unnecessary delegation costs latency + OpenAI $$$.)
- `paella mediana` → queryHI = {paella, mediana}. Candidate `Paella valenciana` lacks `mediana` → reject. Should have been `paella` × 1.0 multiplier.
- `pizza gigante` → queryHI = {pizza, gigante}. Most pizza atoms lack `gigante` → reject. Should have been `pizza` × 2.0 multiplier.

### Catalog conflict analysis (pre-implementation safety check)

`grep` against `spanish-dishes.json`:
- `casero/a` appears in **2 canonical atoms**: `Bizcocho casero`, `Flan casero` — and 3 aliases: `natillas caseras`, `leche frita casera`, `arroz con leche casero`.
- `mediano/a/gigante` appears in **0** catalog entries.

Routing analysis with new bare `casero` strip:
- `flan casero` → strip `casero` → `flan` → L1 FTS Strategy 4 hits `Flan casero` (only flan atom; Jaccard 1/2 = 0.5 ≥ 0.25 → ACCEPT). Same final dish, same nutrients. ✓ NO regression.
- `bizcocho casero` → analogous. ✓
- `natillas caseras` / `leche frita casera` / `arroz con leche casero` → strip `caseras/casera/casero` → bare form hits canonical atom directly via FTS. ✓
- Edge case future-proofing: if catalog ever adds non-casero `Flan` atom alongside `Flan casero`, the strip would route `flan casero` to generic `Flan` instead of homemade variant. Per spec multiplier 1.0× (informational), nutrients are similar — accepted as informational scope.

### Implementation Plan

_N/A — Simple task._

Direct steps:
1. **`packages/api/src/conversation/entityExtractor.ts`**: extend `PATTERNS` array:
   - Add 2 ración-compound entries (after existing `ración normal` line ~193): `ración mediana` (1.0×), `ración gigante` (2.0×)
   - Add 3 bare entries (in bare modifiers group, ~lines 199-206): `mediano/a/s/as` (1.0×), `gigantes?` (2.0×), `casero/a/s/as` (1.0×)
   - Place `gigante` BEFORE bare `\bextras?\b` to avoid accidental shadow (no overlap actually — separate words — but defensive ordering)
2. **`packages/api/src/__tests__/f-modifiers.entityExtractor.unit.test.ts`** (new file): unit tests for each new pattern + regression assertions
3. No other source changes (spec, types, integrations all stable)

### Acceptance Criteria

- [x] `mediano/a/s/as` strips correctly → multiplier 1.0
- [x] `gigantes?` strips correctly → multiplier 2.0
- [x] `casero/a/s/as` strips correctly → multiplier 1.0 (standalone, not just compound)
- [x] `ración mediana` compound → multiplier 1.0 + leading `de` consumed
- [x] `ración gigante` compound → multiplier 2.0 + leading `de` consumed
- [x] No regression on existing `casero de postre` H7 Cat A flow (verified via reasoning: H7 Cat A also has fallback `de postre` pattern that catches the residual after bare `casero` strip)
- [x] No regression on `flan casero` / `bizcocho casero` routing (post-strip bare form hits same atom via FTS)
- [x] All API tests pass
- [x] Lint clean: 0 errors
- [x] Build clean

### Definition of Done

- [x] All acceptance criteria met
- [x] PR squash-merged to develop
- [x] bugs.md F-MODIFIERS-001 entry updated to RESOLVED
- [x] Branch deleted local + remote

---

## Workflow Checklist

<!-- Simple flow: Steps 1, 3, 4, 5 only. Step 6 closes the ticket. -->

- [x] Step 1: Branch created, ticket generated
- [ ] Step 3: Implementation (5 patterns + tests)
- [ ] Step 4: Quality gates pass
- [ ] Step 5: PR + code-review-specialist
- [ ] Step 6: PR squash-merged; branch deleted; tracker + bugs.md synced

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-29 | Ticket created | Branch `feature/F-MODIFIERS-001-extend-extractPortionModifier` from develop @ `a49c0e3`. Lite ticket per Simple workflow. Catalog conflict pre-check completed (grep): 2 canonical atoms + 3 aliases contain `casero` — all post-strip routing verified safe. |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.**

| Recipe | Evidence | Status |
|---|---|---|
| B1 build clean | (filled at Step 4) | pending |
| B2 lint clean | (filled at Step 4) | pending |
| B3 tests pass | (filled at Step 4) | pending |
| B4 spec/plan up-to-date | Lite ticket — Simple workflow, no spec/plan | N/A Simple |
| B5 cross-model review | N/A Simple | N/A |
| B6 code-review-specialist | (filled at Step 5) | pending |
| B7 audit-merge | (filled pre-merge) | pending |
