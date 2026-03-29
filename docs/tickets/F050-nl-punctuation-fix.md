# F050: Bot NL Punctuation Fix + Help Update

**Feature:** F050 | **Type:** Bot-Bugfix | **Priority:** Medium
**Status:** Done | **Branch:** (merged to develop, deleted)
**Created:** 2026-03-29 | **Dependencies:** None

---

## Spec

### Description

Fix BUG-AUDIT-01: `extractFoodQuery` does not strip leading `¿¡` or trailing `?!` before prefix pattern matching, causing queries like `¿cuántas calorías tiene un big mac?` to bypass all prefix patterns and be sent literally to the API. Also update `/start` help text to include `/comparar`, `/contexto`, and `/restaurante`.

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

- [x] `extractFoodQuery` strips `¿¡` from start and `?!` from end before prefix matching
- [x] `¿cuántas calorías tiene un big mac?` extracts `big mac`
- [x] `/start` help text includes `/comparar`, `/contexto`, `/restaurante`
- [x] All existing tests pass (no regressions) — 1066 total
- [x] New tests for `¿`/`?` handling added (8 tests) + help text tests (3 tests)

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: TDD implementation
- [x] Step 4: Quality gates pass
- [x] Step 5: PR created, review
- [x] Step 6: Ticket updated, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-29 | Ticket created | Simple bugfix, from cross-model manual audit |
| 2026-03-29 | Implementation | TDD: 8 punctuation tests + 3 help tests → fix extractFoodQuery + start.ts. 1066 total passing |
| 2026-03-29 | Squash merged to develop | SHA d243c1e, PR #43. Branch deleted |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan, AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 5/5, DoD: 5/5, Workflow: 4/5 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: 5/6 |
| 3. Update key_facts.md | [x] | N/A — no new endpoints or modules |
| 4. Update decisions.md | [x] | N/A — no ADR needed |
| 5. Commit documentation | [x] | Commit: 9b4d94d |
| 6. Verify clean working tree | [x] | `git status`: clean after docs commit |

---

*Ticket created: 2026-03-29*
