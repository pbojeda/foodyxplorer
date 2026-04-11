# BUG-AUDIT-C4: Fix POST Empty Body → 500

**Feature:** BUG-AUDIT-C4 | **Type:** Backend-Bugfix | **Priority:** Medium
**Status:** Done | **Branch:** feature/bug-audit-c4-post-empty-body-500 (deleted)
**Created:** 2026-04-08 | **Dependencies:** None

---

## Spec

### Description

POST endpoints (`/calculate/recipe`, `/conversation/message`) return 500 INTERNAL_ERROR when the request body is missing or contains invalid JSON. Should return 400 VALIDATION_ERROR.

Root cause: Fastify's JSON body parser throws a `SyntaxError` (invalid JSON) or `FST_ERR_CTP_EMPTY_JSON_BODY` (missing body) before Zod validation runs. The global error handler doesn't have cases for these error types, so they fall through to the generic 500 handler.

### Edge Cases & Error Handling

- No body at all (Content-Type: application/json, no payload) → 400
- Invalid JSON (`not json`) → 400
- Empty string body → 400
- Valid but empty JSON `{}` → 400 VALIDATION_ERROR (from Zod, already works)

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

- [x] POST with no body returns 400 VALIDATION_ERROR (not 500)
- [x] POST with invalid JSON returns 400 VALIDATION_ERROR (not 500)
- [x] Existing valid POST requests unchanged
- [x] Unit tests for empty/invalid body scenarios (5 tests)
- [x] All tests pass (3148 API)
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
- [x] Step 4: Quality gates pass (3148 API tests, lint clean, build OK)
- [x] Step 5: PR #83 created, code review: APPROVED (1 fix applied: operator precedence)
- [ ] Step 6: Ticket updated, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-08 | Step 1: Setup | Branch + lite ticket |
| 2026-04-08 | Step 3: TDD | 5 tests, SyntaxError + FST_ERR_CTP_EMPTY_JSON_BODY handlers |
| 2026-04-08 | Step 4: Finalize | 3148 API tests pass, lint clean, build OK |
| 2026-04-08 | Step 5: PR #83 | code-review: 1 fix (operator precedence), +1 mapError unit test |

---

## Merge Checklist Evidence

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | All 7 sections present |
| 1. Mark all items | [x] | AC: 6/6, DoD: 4/4, Workflow: Steps 1,3,4,5 |
| 2. Verify product tracker | [x] | Active Session + Features table updated |
| 3. Update key_facts.md | [x] | N/A — no new models/endpoints |
| 4. Update decisions.md | [x] | N/A |
| 5. Commit documentation | [x] | Included in this commit |
| 6. Clean working tree | [x] | Verified |
| 7. Branch up to date | [x] | Based on develop, no divergence |
| 8. Evidence table filled | [x] | This table |
