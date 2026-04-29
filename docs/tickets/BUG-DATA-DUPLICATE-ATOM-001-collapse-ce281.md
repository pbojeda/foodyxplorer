# BUG-DATA-DUPLICATE-ATOM-001: Collapse duplicate atom CE-281 → CE-095 (Esqueixada)

**Feature:** BUG-DATA-DUPLICATE-ATOM-001 | **Type:** Backend-Bugfix (data) | **Priority:** Medium
**Status:** Done | **Branch:** bugfix/BUG-DATA-DUPLICATE-ATOM-001-collapse-ce281 (squash-merged at `f70271f` 2026-04-28; deleted local + remote)
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-28 | **Dependencies:** F-H6 (PR #211, where CE-281 was introduced)

---

## Spec

### Description

Collapse the duplicate atom **CE-281 `Esqueixada de bacallà`** into the pre-existing **CE-095 `Esqueixada`** (same Catalan codfish salad — long-form Catalan name vs Spanish form). The duplicate was introduced by F-H6 because the spec's pre-check used lowercase grep on alias strings; the Catalan spellings `bacallà`/`bacalà` did not match `bacalao` so detection failed. See `bugs.md` 2026-04-26 entry.

### Implementation Plan

_N/A — Simple task._

Direct steps:
1. **`packages/api/prisma/seed-data/spanish-dishes.json`**: remove CE-281 entry; merge its 3 aliases (`esqueixada de bacalà`, `esqueixada catalana`, plus the canonical name `esqueixada de bacallà`) into CE-095's `aliases` array.
2. **Test count updates** (317 → 316):
   - `packages/api/src/__tests__/f073.seedPhaseSpanishDishes.edge-cases.test.ts:321-340` (2 assertions + 2 comments)
   - `packages/api/src/__tests__/fH6.seedExpansionRound2.edge-cases.test.ts` (lines 8, 114, 117, 118, 124-125; remove H6-EC-8 disambiguation block at lines 278-291; remove CE-281 kcal range entry at line 156; update line 454 fixture from `'esqueixada de bacallà' → CE-281` to `→ CE-095`)
3. **`docs/project_notes/key_facts.md:95`**: catalog count `317` → `316`.

No standard-portions.csv changes (CE-281 has no row there).

### Acceptance Criteria

- [x] CE-281 entry removed from `spanish-dishes.json`
- [x] CE-281's aliases (`esqueixada de bacalà`, `esqueixada catalana`, `esqueixada de bacallà`) appear in CE-095's `aliases` array
- [x] All catalog-count assertions updated from 317 to 316 (5 files: f073, f114, fH6 + key_facts.md)
- [x] H6-EC-8 refactored to verify CE-281 absence + alias migration
- [x] Alias-resolution test fixture resolves `esqueixada de bacallà` to CE-095
- [x] `key_facts.md` catalog count updated to 316
- [x] All tests pass: 4244/4244 (+1 orphan-row guard)
- [x] Lint clean: 0 errors
- [x] Build clean
- [x] **C1 fix-loop**: Orphan rows removed from `standard-portions.csv` (CE-281 dishId 0x119 — would have FK-violated at deploy)

### Definition of Done

- [x] All acceptance criteria met
- [x] Tests passing (4244/4244)
- [x] No linting errors
- [x] Build succeeds
- [x] bugs.md entry updated to RESOLVED with PR #231 / commit `f70271f`

---

## Workflow Checklist

<!-- Simple flow: Steps 1, 3, 4, 5 only. Step 6 closes the ticket. -->

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: Implementation with TDD (data fix) — commit `b088c14`
- [x] Step 4: Quality gates pass (tests 4244/4244, lint 0, build clean)
- [x] Step 5: PR + code-review-specialist APPROVE WITH CHANGES (C1 orphan rows in CSV) → fix-loop applied at `ac33a40`
- [x] Step 6: PR #231 squash-merged at `f70271f`; branch deleted local + remote; tracker + bugs.md updated

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-28 | Ticket created | Branch `bugfix/BUG-DATA-DUPLICATE-ATOM-001-collapse-ce281` from develop @ `23a409a`. Lite ticket per Simple workflow. |
| 2026-04-28 | Step 3+4 implementation | Commit `b088c14`. Removed CE-281 from spanish-dishes.json; migrated 3 aliases to CE-095; updated 5 test files + key_facts.md. 4189→4243 tests (one fixture dropped). Lint+build clean. |
| 2026-04-28 | Step 5 code-review-specialist | REVISE → 1 CRITICAL (C1 orphan rows in standard-portions.csv at lines 224-226 referencing deleted CE-281 dishId 0x119 — FK violation at deploy time). 1 IMPORTANT (I1 H6-EC-6 silently masked the orphan rows). 1 SUGGESTION S2 (cross-validator JSON↔CSV — out of scope, may file as new ticket). |
| 2026-04-28 | Step 5 fix-loop | Commit `ac33a40`. Removed 3 orphan rows from standard-portions.csv. Updated H6-EC-6 to skip n=281 + added positive guard test (CE-281 hex suffix has zero portion rows). Final: 4244/4244 tests. |
| 2026-04-28 | Step 6 close | PR #231 squash-merged at `f70271f`; PR #232 housekeeping at `3c7cbf6`; branch deleted local + remote; tracker + bugs.md synced; ticket Status → Done. |
| 2026-04-29 | Operator reseed dev+prod completed | `reseed-all-envs.sh --prod` → 316 dishes upserted in both. Manual cleanup `_delete_ce281.mts` removed CE-281 row + 1 DishNutrient + 3 StandardPortion from dev + prod (seed is upsert-only; explicit delete required). CE-095 verified with 4 aliases (1 original + 3 migrated) in both envs. Total cocina-espanola dishes: 316 ✓. |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.**

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Spec, Workflow Checklist, Completion Log, Merge Checklist Evidence (lite ticket per Simple workflow) |
| 1. Mark all items | [x] | AC: 10/10, DoD: 5/5, Workflow: 5/5 (Step 6 done at `3c7cbf6`) |
| 2. Verify product tracker | [x] | Active Session synced; Features table=done 5/5 (post-merge `3c7cbf6`) |
| 3. Update key_facts.md | [x] | Line 95: catalog count 317 → 316 with attribution to BUG-DATA-DUPLICATE-ATOM-001 |
| 4. Update decisions.md | [x] | N/A — data fix only, no architectural decision |
| 5. Commit documentation | [x] | `b088c14` (data fix) + `ac33a40` (C1 fix-loop) + `b8f6d32` (MCE prep) + `de27a27` (Step 6 housekeeping merged at `3c7cbf6`) |
| 6. Verify clean working tree | [x] | `git status` clean post-housekeeping |
| 7. Verify branch up to date | [x] | branched from develop @ `23a409a`; merged via PR #231 → `f70271f` |

---

*Ticket created: 2026-04-28*
