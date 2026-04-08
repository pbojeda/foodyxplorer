# BUG-AUDIT-C1C3: Fix `/reverse-search` Error Envelope

**Feature:** BUG-AUDIT-C1C3 | **Type:** Backend-Bugfix | **Priority:** High
**Status:** In Progress | **Branch:** feature/bug-audit-c1c3-reverse-search-error-envelope
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
- [ ] Step 5: PR created, code review
- [ ] Step 6: Ticket updated, branch deleted

---

## Completion Log

_To be filled on completion._

---

## Merge Checklist Evidence

_To be filled before merge approval._
