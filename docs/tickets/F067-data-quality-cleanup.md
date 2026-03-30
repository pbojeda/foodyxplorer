# F067: Data Quality Cleanup

**Feature:** F067 | **Type:** Bug (data quality) | **Priority:** Low
**Status:** In Progress | **Branch:** feature/f067-data-quality-cleanup
**Created:** 2026-03-30 | **Dependencies:** F065 (slug migration)
**Complexity:** Simple
**Audit Source:** Comprehensive Validation Phase 2 — API real testing, Gemini 2.5 Pro review

---

## Spec

### Description

Two data quality issues from the comprehensive validation audit:

**D3 — Leading slashes in BK dish names:** Some names start with `/ ` from PDF parsing. Fix: Prisma migration to clean existing data + sanitization in scraper pipeline.

**D2 — FTS/similarity ranking prefers longer names:** "whopper" returns "Whopper® Spicy Vegetal" before "Whopper®". Fix: Add `length(name) ASC` as secondary sort in similarity queries and `ORDER BY length(name) ASC` in FTS LIMIT 1 queries.

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

- [ ] No dish names start with `/` in the database
- [ ] `/dishes/search?q=whopper` returns "Whopper®" before "Whopper® Spicy Vegetal"
- [ ] `/estimate?query=whopper&chainSlug=burger-king-es` returns plain "Whopper®"
- [ ] Scraper normalization strips leading non-alphanumeric chars
- [ ] All tests pass (0 regressions)
- [ ] Build succeeds

---

## Definition of Done

- [ ] Migration applied
- [ ] Scraper pipeline updated
- [ ] Estimation engine FTS queries prefer shorter matches
- [ ] No linting errors
- [ ] All tests pass

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 3: Implementation
- [ ] Step 4: Quality gates pass
- [ ] Step 5: PR + merge checklist
- [ ] Step 6: Ticket updated, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-30 | Ticket created | From validation audit D2 + D3 |
| 2026-03-30 | Step 1: Setup | Branch `feature/f067-data-quality-cleanup`, Simple |

---

## Merge Checklist Evidence

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | |
| 1. Mark all items | [ ] | |
| 2. Verify product tracker | [ ] | |
| 3. Update key_facts.md | [ ] | |
| 4. Update decisions.md | [ ] | |
| 5. Commit documentation | [ ] | |
| 6. Verify clean working tree | [ ] | |

---

*Ticket created: 2026-03-30*
