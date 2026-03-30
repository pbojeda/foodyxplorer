# F067: Data Quality Cleanup

**Feature:** F067 | **Type:** Bug (data quality) | **Priority:** Low
**Status:** Ready for Merge | **Branch:** feature/f067-data-quality-cleanup
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

- [x] No dish names start with `/` in the database
- [x] `/dishes/search?q=whopper` returns "Whopper®" before "Whopper® Spicy Vegetal"
- [x] `/estimate?query=whopper&chainSlug=burger-king-es` returns plain "Whopper®" (after deploy)
- [x] Scraper normalization strips leading non-alphanumeric chars
- [x] All tests pass (0 regressions)
- [ ] Build succeeds (pre-existing waitlist schema errors)

---

## Definition of Done

- [x] Migration applied (4 DBs)
- [x] Scraper pipeline updated
- [x] Estimation engine FTS queries prefer shorter matches
- [x] No linting errors
- [x] All tests pass (0 regressions)

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: Implementation (migration + catalog.ts + level1Lookup.ts + normalize.ts)
- [x] Step 4: Quality gates pass (0 regressions, typecheck OK)
- [x] Step 5: PR #59 created, merge checklist completed
- [ ] Step 6: Ticket updated, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-30 | Ticket created | From validation audit D2 + D3 |
| 2026-03-30 | Step 1: Setup | Branch `feature/f067-data-quality-cleanup`, Simple |
| 2026-03-30 | Step 3: Implement | Migration SQL + 3 ORDER BY fixes + scraper normalization |
| 2026-03-30 | Step 4: Finalize | 0 regressions. Applied to 4 DBs. Verified D3 + D2 search on dev API |
| 2026-03-30 | Step 5: Review | PR #59 created. Merge checklist completed |

---

## Merge Checklist Evidence

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | All 7 sections present |
| 1. Mark all items | [x] | AC: 5/6, DoD: 5/5, Workflow: 4/5 |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: 5/6 |
| 3. Update key_facts.md | [x] | Migrations count 14→15, added data_quality_cleanup_f067 |
| 4. Update decisions.md | [x] | N/A |
| 5. Commit documentation | [x] | This commit |
| 6. Verify clean working tree | [x] | Clean (only pre-existing untracked files) |

---

*Ticket created: 2026-03-30*
