# F087: "El Tupper" Meal Prep

**Feature:** F087 | **Type:** Backend-Feature | **Priority:** Medium
**Status:** Ready for Merge | **Branch:** feature/F087-meal-prep-tupper
**Created:** 2026-04-07 | **Dependencies:** F035 (Recipe Calculation), F041 (Bot /receta)

---

## Spec

### Description

Add "meal prep" / "tupper" functionality: divide a recipe's total nutrients by N portions. Users cooking a large batch (e.g., 2kg lentejas) can specify how many tuppers/portions to divide into, and the bot returns per-portion macros alongside the totals.

Two integration points:
1. **API enhancement:** Add optional `portions` parameter to `POST /calculate/recipe` (both structured and free-form modes). When present, response includes `perPortion` nutrients (totalNutrients ÷ portions).
2. **Bot enhancement:** Detect "dividir en N tuppers/porciones/raciones" in `/receta` text, extract it before sending to API. Format per-portion results in the response card.

Source: product-evolution-analysis Sec 8 Scenario 4 — "El Tupper" meal prep.

### API Changes

#### Modified endpoint: `POST /calculate/recipe`

Add optional field to both structured and free-form modes:
- `portions` (number, optional, int, min 1, max 50) — number of portions to divide into

Response adds:
- `portions: number | null` — echoed back, null if not specified
- `perPortion: RecipeNutrients | null` — totalNutrients ÷ portions, null if portions not specified

### Edge Cases & Error Handling

- `portions` not provided → `portions: null`, `perPortion: null` (backward compatible)
- `portions = 1` → `perPortion` equals `totalNutrients` (valid, not an error)
- Null nutrients in total → null in perPortion (don't divide null by N)
- Bot extraction: "dividir en 5 tuppers", "para 5 tuppers", "5 porciones", "5 raciones"
- Bot text: strip the tupper/portion phrase before sending to API (it's not an ingredient)

---

## Implementation Plan

N/A — Simple task

---

## Acceptance Criteria

- [x] `POST /calculate/recipe` accepts optional `portions` field (1-50)
- [x] Response includes `portions` and `perPortion` fields
- [x] `perPortion` correctly divides each nutrient by portions count
- [x] Null nutrients remain null in perPortion
- [x] Backward compatible — existing requests without `portions` work unchanged
- [x] Bot detects "dividir en N tuppers/porciones/raciones" patterns
- [x] Bot strips tupper phrase from text before API call
- [x] Bot formatter shows per-portion breakdown when portions present
- [x] API spec updated (`api-spec.yaml`)
- [x] Unit tests for schema, API, bot extraction, bot formatter (33 tests)
- [x] All tests pass
- [x] Build succeeds

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (33 new tests)
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] API spec updated

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: Implementation with TDD
- [x] Step 4: Quality gates pass
- [x] Step 5: `code-review-specialist` executed — APPROVED WITH MINOR CHANGES (1 fix applied: OpenAPI $ref+nullable)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-07 | Setup | Branch feature/F087-meal-prep-tupper, lite ticket, tracker updated |
| 2026-04-07 | Implement | TDD: shared schemas (12 tests), API route (6 tests), bot extraction (11 tests), bot formatter (4 tests). 33 new tests |
| 2026-04-07 | Finalize | All quality gates pass. Build clean. Lint clean |
| 2026-04-07 | Review | PR #80. Code review: APPROVED WITH MINOR CHANGES (1 fix: OpenAPI $ref+nullable). 0 Critical |

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
| 7. Verify branch up to date | [ ] | merge-base: up to date / merged origin/<branch> |

---

*Ticket created: 2026-04-07*
