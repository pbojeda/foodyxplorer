# F050: Bot NL Punctuation Fix + Help Update

**Feature:** F050 | **Type:** Bot-Bugfix | **Priority:** Medium
**Status:** In Progress | **Branch:** feature/F050-nl-punctuation-fix
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
- [ ] Step 5: PR created, review
- [ ] Step 6: Ticket updated, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-29 | Ticket created | Simple bugfix, from cross-model manual audit |
| 2026-03-29 | Implementation | TDD: 8 punctuation tests + 3 help tests → fix extractFoodQuery + start.ts. 1066 total passing |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | Sections verified: (list) |
| 1. Mark all items | [ ] | AC: _/_, DoD: _/_, Workflow: _/_ |
| 2. Verify product tracker | [ ] | Active Session: step _/6, Features table: _/6 |
| 3. Update key_facts.md | [ ] | Updated: (list) / N/A |
| 4. Update decisions.md | [ ] | ADR-XXX added / N/A |
| 5. Commit documentation | [ ] | Commit: (hash) |
| 6. Verify clean working tree | [ ] | `git status`: clean |

---

*Ticket created: 2026-03-29*
