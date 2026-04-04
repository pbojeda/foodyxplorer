# F079: Demand-Driven Dish Expansion Pipeline

**Feature:** F079 | **Type:** Backend-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F079-demand-driven-expansion
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

- [ ] Prisma migration creates `missed_query_tracking` table with correct schema
- [ ] `GET /analytics/missed-queries` returns top N missed queries with counts
- [ ] `GET /analytics/missed-queries` supports `timeRange` (24h/7d/30d) and `topN` params
- [ ] `GET /analytics/missed-queries` excludes already-tracked (resolved/ignored) queries
- [ ] `POST /analytics/missed-queries/:id/status` updates tracking entry status
- [ ] Short queries (< 3 chars) filtered from results
- [ ] Unit tests for all new functionality
- [ ] All existing tests pass (no regressions)
- [ ] Build succeeds

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] Code follows project standards
- [ ] No linting errors
- [ ] Build succeeds
- [ ] Specs reflect final implementation

---

## Workflow Checklist

- [ ] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 3: TDD implementation
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-04 | Setup | Branch + lite ticket created |
| 2026-04-04 | Implement | Prisma migration (21st), 3 endpoints, 68 tests. All pass (shared 434, API 2702, bot 1143). Build: pre-existing TS errors only. |
| 2026-04-04 | Finalize | Production validator: 2 HIGH + 5 MEDIUM found. All fixed: unused imports, error handler pattern, type safety, explicit 'all' case. Re-validated: 68 tests pass. |

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

*Ticket created: 2026-04-04*
