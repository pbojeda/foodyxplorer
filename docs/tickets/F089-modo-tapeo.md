# F089: "Modo Tapeo" (Shared Portions)

**Feature:** F089 | **Type:** Bot-Feature | **Priority:** Medium
**Status:** Done | **Branch:** (deleted)
**Created:** 2026-04-07 | **Dependencies:** F076 (Menu Estimation)

---

## Spec

### Description

Add "Modo Tapeo" — when users list multiple tapas "para N personas", divide the total nutrients by N diners. Reuses the existing `menu_estimation` pipeline (F076) with two additions: (1) detect "para N personas/comensales/gente" in the text, extract N, and strip it before menu parsing; (2) add `diners` + `perPerson` fields to the response so the formatter can show per-person breakdown.

Two integration points:
1. **ConversationCore enhancement:** Detect "para N personas" in menu_estimation text, extract diners count, compute perPerson totals.
2. **Bot formatter enhancement:** Show per-person section when diners is present in menu estimation response.

### Edge Cases & Error Handling

- No "para N" phrase → `diners: null`, `perPerson: null` (backward compatible)
- `diners = 1` → perPerson equals totals (valid)
- Diners capped at 20 (reasonable max for shared tapas)
- Works with both explicit `/menu` command and NL menu detection
- Existing menu_estimation tests must not break

---

## Implementation Plan

N/A — Simple task

---

## Acceptance Criteria

- [x] Detect "para N personas/comensales/gente" patterns in menu text
- [x] Strip diners phrase from text before dish parsing
- [x] `MenuEstimationDataSchema` includes optional `diners` and `perPerson` fields
- [x] `perPerson` correctly divides totals by diners count
- [x] Backward compatible — existing menu queries without "para N" work unchanged
- [x] Bot formatter shows per-person breakdown when diners present
- [x] Unit tests for detection, schema, ConversationCore, formatter (22 tests)
- [x] All tests pass
- [x] Build succeeds

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (22 new tests)
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: Implementation with TDD
- [x] Step 4: Quality gates pass
- [x] Step 5: `code-review-specialist` executed — APPROVED (0 Critical, 0 fixes needed)
- [x] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-07 | Setup | Branch feature/F089-modo-tapeo, lite ticket, tracker updated |
| 2026-04-07 | Implement | TDD: schema (7), diners extractor (12), formatter (3). 22 new tests |
| 2026-04-07 | Finalize | All quality gates pass. Build clean. Lint clean |
| 2026-04-07 | Review | PR #81. Code review: APPROVED. 0 Critical, 0 fixes needed |
| 2026-04-07 | Complete | Squash merged to develop (ef5dbe6). Branch deleted. Ticket closed |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan, AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 9/9, DoD: 5/5, Workflow: 4/5 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: 5/6 |
| 3. Update key_facts.md | [x] | N/A — no new endpoints, extends existing menu_estimation |
| 4. Update decisions.md | [x] | N/A — no ADR needed |
| 5. Commit documentation | [x] | Commit: (pending with this) |
| 6. Verify clean working tree | [x] | `git status`: clean after commit |
| 7. Verify branch up to date | [x] | merge-base: up to date with origin/develop |

---

*Ticket created: 2026-04-07*
