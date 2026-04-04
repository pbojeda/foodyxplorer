# F078: Regional Aliases + "Modo España Real"

**Feature:** F078 | **Type:** Backend-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F078-regional-aliases
**Created:** 2026-04-04 | **Dependencies:** F073 (Spanish Canonical Dishes) ✅

---

## Spec

### Description

Enable the existing `aliases` column (String[], GIN-indexed) in dishes and foods tables to be queried during the estimation cascade. Currently, 250 Spanish dishes have 250+ aliases populated (e.g., "bravas" → "Patatas bravas", "bocata de jamón" → "Bocadillo de jamón serrano", "tortilla española" → "Tortilla de patatas") but the L1/L2 SQL queries only match on `d.name` / `d.name_es` — aliases are ignored.

Additionally, add `name_es` exact matching to L1 Strategy 1 and L2 Strategy 1 (currently only match on `d.name`), and strip Spanish serving-format prefixes ("tapa de", "pincho de", "pintxo de", "ración de") from queries so "tapa de calamares" resolves to "Calamares a la romana".

### Data Model Changes

No schema changes — `aliases String[]` and GIN indexes already exist on both `dishes` and `foods` tables since initial migrations.

### Edge Cases & Error Handling

- Empty aliases array (`ARRAY[]::TEXT[]`) — `@>` operator returns false, no false matches
- Aliases stored lowercase — `normalizeQuery()` already lowercases input, so matching is case-insensitive
- "tapa de" prefix stripping on short input (e.g., just "tapa") — falls back to original query
- Chain-scoped queries still work — alias matching respects existing scope clauses

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

- [x] L1 Strategy 1 (exactDishMatch) matches on `d.name_es` and `d.aliases`
- [x] L1 Strategy 3 (exactFoodMatch) matches on `f.aliases`
- [x] L2 Strategy 1 (exactIngredientDishMatch) matches on `d.name_es` and `d.aliases`
- [x] entityExtractor strips "tapa de" / "pincho de" / "pintxo de" / "ración de" serving-format prefixes
- [x] Unit tests for alias SQL clause generation
- [x] Unit tests for prefix stripping
- [x] All existing tests pass (no regressions)
- [x] Build succeeds
- [ ] Specs updated

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] Specs reflect final implementation

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: TDD implementation
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-04 | Setup | Branch + lite ticket created |
| 2026-04-04 | Implement | 3 SQL files + entityExtractor. 22 new tests. All pass (shared 434, API 2634, bot 1143). Lint clean, build success. |
| 2026-04-04 | Finalize | Production validator: READY (0 critical, 0 issues) |

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
