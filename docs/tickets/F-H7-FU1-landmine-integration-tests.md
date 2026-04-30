# F-H7-FU1: Landmine integration tests for H7-P5 retry seam (4 missing AC-5 cases)

**Feature:** F-H7-FU1 | **Type:** Backend-Test | **Priority:** Low
**Status:** Done | **Branch:** feature/F-H7-FU1-landmine-integration-tests (squash-merged at `614ea66` 2026-04-29; deleted local + remote)
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-29 | **Dependencies:** F-H7 (PR #213, where this gap was filed by qa-engineer F2 follow-up)

---

## Spec

### Description

F-H7's `fH7.engineRouter.integration.test.ts` only covers 2 of 6 landmine corpus dishes specified for AC-5 verification. Add the missing 4 landmine integration tests so each landmine has explicit end-to-end coverage proving L1 Pass 1 hits the full text (the H7-P5 retry seam never fires). Filed during F-H7 qa-engineer F2 follow-up (`bugs.md` 2026-04-26 entry).

Missing landmines:
1. `sepia a la plancha` — H7-P5 risk if Cat B ("a la plancha") were applied; landmine guarantees it isn't
2. `tostada con tomate y aceite` — H7-P5 risk if Cat C "con tomate y aceite" strip qualified (≥ 2 tokens before `con`); landmine guarantees catalog hit
3. `café con leche` — H7-P5 risk if Cat C "con leche" strip applied; pre-con `café` has 1 token so guard prevents strip, but explicit coverage missing
4. `gambas al ajillo` — H7-P5 risk if Cat B-like or Cat A noise stripped `al ajillo`; landmine confirms L1 Pass 1 hits

Pattern: identical to existing `pan con tomate` landmine test at `fH7.engineRouter.integration.test.ts:190`.

### Implementation Plan

_N/A — Simple task._

Direct steps:
1. Add 4 fixture UUIDs (H7_DISH_SEPIA/TOSTA/CAFE/GAMBAS + their DN counterparts) using the established `f7000000-00f7-4000-a000-000000000XYZ` namespace pattern
2. Add 4 `prisma.dish.create` + `prisma.dishNutrient.create` calls in `beforeAll` (no aliases needed for these tests)
3. Extend `cleanFixtures()` `dishIds` array to include the 4 new IDs
4. Add 4 new `it(...)` blocks in the existing `describe('H7-P5 retry seam — runEstimationCascade() end-to-end')` group, each asserting `levelHit === 1` + `level1Hit === true`

### Acceptance Criteria

- [x] 4 fixture dishes inserted in `beforeAll` (sepia a la plancha, tostada con tomate y aceite, café con leche, gambas al ajillo)
- [x] 4 new `it(...)` tests added covering each landmine with `levelHit === 1` + `level1Hit === true`
- [x] `cleanFixtures()` `dishIds` array extended (no orphan rows post-test)
- [x] Default test suite unchanged (4244/4244 — integration tests are separate config)
- [x] Integration suite: 8 → 12 (+4) for `fH7.engineRouter.integration.test.ts`
- [x] Lint clean: 0 errors
- [x] Build clean

### Definition of Done

- [x] All acceptance criteria met
- [x] PR squash-merged to develop
- [x] bugs.md F-H7-FU1 reference updated to RESOLVED
- [x] Branch deleted local + remote

---

## Workflow Checklist

<!-- Simple flow: Steps 1, 3, 4, 5 only. Step 6 closes the ticket. -->

- [x] Step 1: Branch created, ticket generated
- [x] Step 3: Implementation (4 fixtures + 4 tests) — commit `8b528d9`
- [x] Step 4: Quality gates pass (default 4244/4244, integration 12/12, lint 0, build clean)
- [x] Step 5: PR + code-review-specialist APPROVE (no blockers; 2 NITs optional, accepted as-is)
- [x] Step 6: PR #237 squash-merged at `614ea66`; branch deleted local + remote; tracker + bugs.md synced

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-29 | Ticket created | Branch `feature/F-H7-FU1-landmine-integration-tests` from develop @ `2c5310d`. Lite ticket per Simple workflow. |
| 2026-04-29 | Step 3 implementation | Commit `8b528d9`. Added 4 fixture UUIDs + 4 prisma.dish.create + 4 it(...) tests. Extended cleanFixtures() dishIds array. |
| 2026-04-29 | Step 4 quality gates | Default suite 4244/4244 ✓; integration suite 12/12 ✓ (was 8); lint 0; build clean. |
| 2026-04-29 | Step 5 code-review-specialist | APPROVE (no blockers). 2 NITs optional (raw-query echo assertion + parenthetical descriptions) — accepted as-is per Simple-tier scope. |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.**

| Recipe | Evidence | Status |
|---|---|---|
| B1 build clean | `npm run build -w @foodxplorer/api` exit 0 | ✓ |
| B2 lint clean | `npm run lint -w @foodxplorer/api` exit 0, 0 errors | ✓ |
| B3 tests pass | Default 4244/4244 + integration 12/12 (was 8, +4) | ✓ |
| B4 spec/plan up-to-date | Lite ticket — Simple workflow, no spec/plan | N/A Simple |
| B5 cross-model review | N/A Simple | N/A |
| B6 code-review-specialist | APPROVE (no blockers; 2 NITs optional, accepted as-is) | ✓ |
| B7 audit-merge | N/A — Simple workflow does not require /audit-merge gate | N/A Simple |
