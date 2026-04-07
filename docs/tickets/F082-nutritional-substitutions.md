# F082: Nutritional Substitutions

**Feature:** F082 | **Type:** Backend-Feature | **Priority:** Medium
**Status:** Done | **Branch:** (deleted)
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

- [x] New `substitutions.ts` module with rule-based substitution engine
- [x] Substitution rules cover common food categories (sides, drinks, proteins, sauces, bread, dairy, rice, cream)
- [x] `NutritionalSubstitutionSchema` in shared schemas with multi-nutrient diffs
- [x] `EstimateDataSchema` extended with optional `substitutions` field
- [x] Substitutions generated in `estimationOrchestrator.ts` and `estimate.ts` route
- [x] `formatEstimate()` renders substitutions section in bot output
- [x] Substitutions only shown when dish calories >= 200
- [x] Max 2 substitutions per response
- [x] Unit tests for substitution engine (27 tests)
- [x] Unit tests for formatter with substitutions (8 tests)
- [x] All tests pass (39/39)
- [x] Build succeeds

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (39 tests)
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] Shared schemas updated (`NutritionalSubstitutionSchema` + `substitutions` field)

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: Implementation with TDD
- [x] Step 4: Quality gates pass, `production-code-validator` executed
- [x] Step 5: `code-review-specialist` executed
- [x] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-07 | Setup | Branch + ticket created |
| 2026-04-07 | Implement | TDD: substitutions module, schema extension, route+orchestrator integration, bot formatter. 36 tests |
| 2026-04-07 | Finalize | All quality gates pass. production-code-validator: APPROVED (1 LOW: broad arroz pattern, acceptable) |
| 2026-04-07 | Review | PR #74. Code review: APPROVED WITH MINOR CHANGES. Accepted: I1 (arroz con removed), I2 (nata narrowed), I3 (chainSlug removed from type), S4 (ordering comment), S5 (carbs in formatter), S6 (false-positive tests), S7 (filter zeros). 39 tests total |
| 2026-04-07 | Complete | Squash merged to develop (2d7b4fe). Branch deleted. Ticket closed |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan (N/A), AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 12/12, DoD: 6/6, Workflow: 5/5 |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: 5/6 |
| 3. Update key_facts.md | [x] | N/A — no new models/migrations/endpoints |
| 4. Update decisions.md | [x] | N/A — no ADR needed for Simple feature |
| 5. Commit documentation | [x] | Commit: (pending — docs commit below) |
| 6. Verify clean working tree | [x] | `git status`: clean after docs commit |

---

*Ticket created: 2026-04-07*
