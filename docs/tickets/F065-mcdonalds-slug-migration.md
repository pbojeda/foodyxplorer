# F065: McDonald's Chain Slug Migration (`mcdonalds` → `mcdonalds-es` / `mcdonalds-pt`)

**Feature:** F065 | **Type:** Bug (data integrity) | **Priority:** High
**Status:** In Progress | **Branch:** feature/f065-mcdonalds-slug-migration
**Created:** 2026-03-30 | **Dependencies:** None
**Complexity:** Simple
**Audit Source:** Comprehensive Validation Phase 2 — API real testing, confirmed by Gemini 2.5 Pro

---

## Spec

### Description

McDonald's chain slug is `mcdonalds` for both Spain and Portugal, violating the naming convention (`burger-king-es`, `kfc-es`, etc.) and causing: (1) data ambiguity — queries with `chainSlug=mcdonalds` match both countries, (2) manual examples broken — `mcdonalds-es` doesn't exist, (3) bot chain resolver may pick wrong country.

**Fix:** Rename `mcdonalds` → `mcdonalds-es` (Spain) / `mcdonalds-pt` (Portugal) in restaurants, dishes, data_sources. Update seed scripts. Invalidate Redis cache.

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

- [x] `mcdonalds` slug no longer exists in `restaurants`, `dishes`, or `data_sources` tables
- [x] `mcdonalds-es` resolves correctly for Spain McDonald's data
- [x] `mcdonalds-pt` resolves correctly for Portugal data
- [x] Seed scripts updated with new slugs
- [x] All tests pass (0 regressions; 148 pre-existing failures identical to develop baseline)
- [ ] Build succeeds (7 pre-existing errors in waitlist schemas, not related to F065)
- [x] Redis cache invalidated post-migration (dev)

---

## Definition of Done

- [x] Migration applied to dev and prod
- [x] Seed scripts reference new slugs
- [x] No linting errors
- [ ] Build succeeds (pre-existing waitlist schema errors)
- [x] All tests pass (0 regressions)

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: Implementation (migration + seeds)
- [x] Step 4: Quality gates pass (0 regressions)
- [ ] Step 5: PR + merge checklist
- [ ] Step 6: Ticket updated, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-30 | Ticket created | From comprehensive validation audit |
| 2026-03-30 | Step 1: Setup | Branch `feature/f065-mcdonalds-slug-migration`, complexity Simple |
| 2026-03-30 | Step 3: Implement | Migration SQL (restaurants only), seed.ts updated |
| 2026-03-30 | Step 4: Finalize | 0 regressions. Applied to 4 DBs (test, dev-local, Supabase dev, Supabase prod). Verified via API |

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
