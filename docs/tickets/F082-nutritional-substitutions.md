# F082: Nutritional Substitutions

**Feature:** F082 | **Type:** Backend-Feature | **Priority:** Medium
**Status:** In Progress | **Branch:** feature/F082-nutritional-substitutions
**Created:** 2026-04-07 | **Dependencies:** None (F081 Health-Hacker tips complete, estimation engine stable)

---

## Spec

### Description

Rule-based substitution engine that suggests healthier food alternatives with detailed nutrient comparisons. When a user estimates a food/dish, the response includes up to 2 substitution suggestions showing multi-nutrient differences (calories, proteins, fats, carbs, fiber).

Unlike F081 (chain-category tips with calorie-only savings), F082 works on food-name keyword matching and provides full macronutrient diffs. It applies to ALL estimations (not just chain dishes).

Example: User estimates "patatas fritas" → response includes "Ensalada verde: -275 kcal, -15g grasas, +2g fibra".

Source: product-evolution-analysis Sec 9 Tier 2 — "Nutritional substitutions: Si cambias patatas fritas por ensalada, ahorras 200 kcal"

### API Changes

- `EstimateDataSchema` gains optional `substitutions` field (array of `NutritionalSubstitution`)
- No new endpoints — substitutions are embedded in existing `/estimate` and `/conversation/message` responses

### Edge Cases & Error Handling

- No keyword match in dish/food name → no substitutions (skip silently)
- Dish with < 200 kcal → no substitutions (low-calorie items don't need alternatives)
- Max 2 substitutions per response (avoid clutter)
- null result → no substitutions
- Substitutions and F081 Health-Hacker tips can coexist (different sections, different triggers)

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

- [ ] New `substitutions.ts` module with rule-based substitution engine
- [ ] Substitution rules cover common food categories (sides, drinks, proteins, sauces, bread, dairy)
- [ ] `NutritionalSubstitutionSchema` in shared schemas with multi-nutrient diffs
- [ ] `EstimateDataSchema` extended with optional `substitutions` field
- [ ] Substitutions generated in `estimationOrchestrator.ts` and `estimate.ts` route
- [ ] `formatEstimate()` renders substitutions section in bot output
- [ ] Substitutions only shown when dish calories >= 200
- [ ] Max 2 substitutions per response
- [ ] Unit tests for substitution engine
- [ ] Unit tests for formatter with substitutions
- [ ] All tests pass
- [ ] Build succeeds

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] Code follows project standards
- [ ] No linting errors
- [ ] Build succeeds
- [ ] Shared schemas updated

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: Implementation with TDD
- [x] Step 4: Quality gates pass, `production-code-validator` executed
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-07 | Setup | Branch + ticket created |
| 2026-04-07 | Implement | TDD: substitutions module, schema extension, route+orchestrator integration, bot formatter. 36 tests |
| 2026-04-07 | Finalize | All quality gates pass. production-code-validator: APPROVED (1 LOW: broad arroz pattern, acceptable) |

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

*Ticket created: 2026-04-07*
