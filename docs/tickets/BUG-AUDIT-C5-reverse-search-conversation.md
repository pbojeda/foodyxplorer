# BUG-AUDIT-C5: Fix Silent Error in Reverse Search via Conversation

**Feature:** BUG-AUDIT-C5 | **Type:** Backend-Bugfix | **Priority:** Medium
**Status:** Done | **Branch:** feature/bug-audit-c5-reverse-search-conversation (deleted)
**Created:** 2026-04-08 | **Dependencies:** None

---

## Spec

### Description

The `processMessage()` function in `conversationCore.ts` calls `reverseSearchDishes()` inside a `catch` block (line 161) that silently swallows errors. During the Phase B audit, this caused the reverse_search intent to return no data when the DB had a transient issue — with zero visibility into what went wrong.

Fix: add error logging to the catch block so DB failures are visible in logs.

Note: The underlying query works correctly (verified on staging 2026-04-08). The issue was transient, but the silent catch masks any future failures.

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

- [x] Catch block logs the error with request logger
- [x] Reverse search via conversation returns data when DB is healthy
- [x] Unit test verifies error is logged when reverseSearchDishes throws (2 tests)
- [x] All tests pass (3150 API)
- [x] Build succeeds

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing
- [x] No linting errors
- [x] Build succeeds

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: TDD implementation
- [x] Step 4: Quality gates pass (3150 API tests, lint clean, build OK)
- [x] Step 5: PR created, code review
- [ ] Step 6: Ticket updated, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-08 | Step 1: Setup | Branch + lite ticket |
| 2026-04-08 | Step 3: TDD | Added logger.warn to catch block, 2 new tests |
| 2026-04-08 | Step 4: Finalize | 3150 API tests pass, lint clean, build OK |
| 2026-04-08 | Step 5: PR + review | |

---

## Merge Checklist Evidence

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | All 7 sections present |
| 1. Mark all items | [x] | AC: 5/5, DoD: 4/4, Workflow: Steps 1,3,4,5 |
| 2. Verify product tracker | [x] | Active Session + Features table updated |
| 3. Update key_facts.md | [x] | N/A |
| 4. Update decisions.md | [x] | N/A |
| 5. Commit documentation | [x] | Included in commit |
| 6. Clean working tree | [x] | Verified |
| 7. Branch up to date | [x] | Based on develop |
| 8. Evidence table filled | [x] | This table |
