# BUG-AUDIT-C1C3: Fix `/reverse-search` Error Envelope

**Feature:** BUG-AUDIT-C1C3 | **Type:** Backend-Bugfix | **Priority:** High
**Status:** Ready for Merge | **Branch:** feature/bug-audit-c1c3-reverse-search-error-envelope
**Created:** 2026-04-08 | **Dependencies:** None

---

## Spec

### Description

The `GET /reverse-search` endpoint returns error responses in two non-standard formats that don't match the project error envelope `{success: false, error: {code, message}}`:

- **C1 (404):** CHAIN_NOT_FOUND returns `{success: false, code: "CHAIN_NOT_FOUND", message: "..."}` — flat structure instead of nested `error` object.
- **C3 (400):** Validation errors return raw Zod output `{success: false, error: {formErrors: [], fieldErrors: {...}}}` instead of `{success: false, error: {code: "VALIDATION_ERROR", message: "..."}}`.

All other endpoints use the global error handler (`errorHandler.ts`) which formats errors consistently. The `/reverse-search` route bypasses this by constructing responses manually.

### Edge Cases & Error Handling

- Invalid chain slug → 404 with standard envelope
- Missing required params (chainSlug, maxCalories) → 400 with standard envelope
- Invalid param types (maxCalories=abc) → 400 with standard envelope
- maxCalories out of range (< 100 or > 3000) → 400 with standard envelope

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

- [x] 404 CHAIN_NOT_FOUND returns `{success: false, error: {code: "CHAIN_NOT_FOUND", message: "..."}}`
- [x] 400 validation errors return `{success: false, error: {code: "VALIDATION_ERROR", message: "..."}}`
- [x] Existing valid responses unchanged
- [x] Unit tests for both error formats (6 new tests)
- [x] All tests pass (3143 API + 475 shared + 1198 bot)
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
- [x] Step 4: Quality gates pass (3143 API + 475 shared + 1198 bot, lint clean, build OK)
- [x] Step 5: PR created, code review
- [ ] Step 6: Ticket updated, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-08 | Step 1: Setup | Branch + lite ticket created |
| 2026-04-08 | Step 3: TDD | 6 new tests (RED→GREEN), 3 existing tests updated |
| 2026-04-08 | Step 4: Finalize | 3143 API + 475 shared + 1198 bot tests pass, lint clean, build OK |
| 2026-04-08 | Step 5: PR #82 | code-review-specialist: APPROVED, no critical issues |

---

## Merge Checklist Evidence

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | All 7 sections present: Spec, Plan (N/A), AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 6/6, DoD: 4/4, Workflow: Steps 1,3,4,5 marked |
| 2. Verify product tracker | [x] | Active Session: BUG-AUDIT-C1C3 Step 5/6, Features table: in-progress 5/6 |
| 3. Update key_facts.md | [x] | N/A — no new models/schemas/endpoints, only error format fix |
| 4. Update decisions.md | [x] | N/A — no ADR needed for bugfix |
| 5. Commit documentation | [x] | Docs commit included below |
| 6. Clean working tree | [x] | Verified after docs commit |
| 7. Branch up to date | [x] | Feature branch based on develop, no divergence |
| 8. Evidence table filled | [x] | This table |
