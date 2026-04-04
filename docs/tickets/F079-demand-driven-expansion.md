# F079: Demand-Driven Dish Expansion Pipeline

**Feature:** F079 | **Type:** Backend-Feature | **Priority:** High
**Status:** Done | **Branch:** feature/F079-demand-driven-expansion (deleted)
**Created:** 2026-04-04 | **Dependencies:** F073 (Spanish Canonical Dishes) ✅, F029 (Query Log & Analytics) ✅

---

## Spec

### Description

Build a demand-driven expansion pipeline that surfaces the most frequently missed queries (estimation cascade returning null across all 4 levels) and tracks their resolution status. This closes the feedback loop: users query dishes we don't have → we identify the top gaps → we add them in monthly batches.

**Three deliverables:**
1. **`GET /analytics/missed-queries`** — Admin endpoint returning top N missed queries aggregated by normalized query text, with frequency counts, time range filtering, and exclusion of already-tracked queries.
2. **`missed_query_tracking` table** — Prisma model to record disposition of missed queries: `pending` (new gap), `resolved` (dish added), `ignored` (not a food, spam, gibberish). Prevents re-surfacing resolved items.
3. **`POST /analytics/missed-queries/:id/status`** — Admin endpoint to update tracking status (resolve or ignore a missed query).

### Data Model Changes

New table `missed_query_tracking`:
- `id` UUID PK
- `query_text` VARCHAR(255) UNIQUE — normalized missed query
- `hit_count` INT — snapshot of frequency at time of tracking
- `status` ENUM (pending, resolved, ignored)
- `resolved_dish_id` UUID? — FK to dishes (set when resolved by adding a dish)
- `notes` TEXT? — optional notes (e.g., "added as alias to existing dish")
- `created_at` TIMESTAMPTZ
- `updated_at` TIMESTAMPTZ

### Edge Cases & Error Handling

- Duplicate query_text in tracking table — UNIQUE constraint, upsert on conflict
- Very short queries (1-2 chars) — filter out in aggregation (minimum 3 chars)
- Non-food queries ("hola", "test") — handled via `ignored` status
- Queries with chain context — aggregate by query_text only (chain-agnostic gaps)
- menu_estimation / context_set intents log levelHit=null but aren't real misses — filter by excluding queries that match known non-estimation patterns

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

- [x] Prisma migration creates `missed_query_tracking` table with correct schema
- [x] `GET /analytics/missed-queries` returns top N missed queries with counts
- [x] `GET /analytics/missed-queries` supports `timeRange` (24h/7d/30d/all) and `topN` params
- [x] `GET /analytics/missed-queries` LEFT JOINs tracking table for status context
- [x] `POST /analytics/missed-queries/:id/status` updates tracking entry status
- [x] `POST /analytics/missed-queries/track` batch creates tracking entries (upsert, max 100)
- [x] Short queries (< 3 chars) filtered from results
- [x] Unit tests for all new functionality (76 tests)
- [x] All existing tests pass (no regressions)
- [x] Build succeeds (pre-existing TS errors only)

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (76 tests)
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] Specs reflect final implementation (api-spec.yaml updated)

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: TDD implementation
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [x] Step 5: `code-review-specialist` executed
- [x] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-04 | Setup | Branch + lite ticket created |
| 2026-04-04 | Implement | Prisma migration (21st), 3 endpoints, 68 tests. All pass (shared 434, API 2702, bot 1143). Build: pre-existing TS errors only. |
| 2026-04-04 | Finalize | Production validator: 2 HIGH + 5 MEDIUM found. All fixed: unused imports, error handler pattern, type safety, explicit 'all' case. Re-validated: 68 tests pass. |
| 2026-04-04 | Review | PR #71. Code review: 1 critical (404 swallowed by catch), 2 important (BatchTrackBodySchema local, no batch size limit), 3 suggestions (timeRange dup, SQL text cast, structural tests). Critical + important fixed. +8 tests (76 total). |
| 2026-04-04 | Complete | Squash merged to develop (d56551e). Branch deleted. |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan (N/A), AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 10/10, DoD: 6/6, Workflow: 4/5 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: 5/6 |
| 3. Update key_facts.md | [x] | Updated: F079 entry added (missed query tracking, 3 endpoints, 21st migration) |
| 4. Update decisions.md | [x] | N/A — no new ADR needed |
| 5. Commit documentation | [x] | Commit: f5caaba |
| 6. Verify clean working tree | [x] | `git status`: clean after push |

---

*Ticket created: 2026-04-04*
