# F077: Alcohol Nutrient Support

**Feature:** F077 | **Type:** Backend-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F077-alcohol-nutrient-support
**Created:** 2026-04-04 | **Dependencies:** F071 (BEDCA Import) ✅

---

## Spec

### Description

Add `alcohol` as a standard nutrient field across the entire estimation pipeline. Alcohol provides 7 kcal/g — a different calculation than the standard Atwater factors (protein=4, carbs=4, fat=9). This is critical for Spanish tapeo culture where beer, wine, and vermouth are common.

BEDCA already includes alcohol content (nutrient ID 221, tagname ALC) and the BEDCA mapper currently stores it in `extra.alcohol_g`. F077 promotes alcohol to a first-class nutrient field in:
- Database: `alcohol Decimal(8,2)` column in FoodNutrient + DishNutrient
- Zod schemas: FoodNutrientSchema, DishNutrientSchema, EstimateNutrientsSchema, MenuEstimationTotalsSchema
- BEDCA mapper: ALC → standard `alcohol` field (not extra)
- Estimation pipeline: NUTRIENT_KEYS constants, yield factor application, menu aggregation
- Bot formatters: display alcohol when > 0
- API spec: updated OpenAPI schemas

### Data Model Changes

- **FoodNutrient**: Add `alcohol Decimal(8,2) @default(0)` column
- **DishNutrient**: Add `alcohol Decimal(8,2) @default(0)` column
- **Migration**: `alcohol_nutrient_f077`

### Edge Cases & Error Handling

- Existing rows get `alcohol = 0` (default) — no data loss
- Foods/dishes without alcohol data naturally have `alcohol = 0`
- Yield factor applies to alcohol the same way as other nutrients (cooking reduces alcohol content)
- `alcohol_kcal` is informational context only — the `calories` field from data sources already includes alcohol calories

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

- [ ] Prisma migration adds `alcohol` column to FoodNutrient and DishNutrient
- [ ] FoodNutrientSchema includes `alcohol` field
- [ ] DishNutrientSchema includes `alcohol` field
- [ ] EstimateNutrientsSchema includes `alcohol` field
- [ ] MenuEstimationTotalsSchema includes `alcohol` field
- [ ] BEDCA mapper writes ALC to standard `alcohol` field (not extra)
- [ ] NUTRIENT_KEYS in conversationCore.ts includes `alcohol`
- [ ] NUMERIC_NUTRIENT_KEYS in yieldUtils.ts includes `alcohol`
- [ ] aggregateNutrients.ts NUTRIENT_KEYS includes `alcohol`
- [ ] Bot estimateFormatter shows alcohol when > 0
- [ ] Bot menuFormatter aggregates alcohol
- [ ] api-spec.yaml schemas updated with `alcohol` field
- [ ] Unit tests for alcohol in nutrient schemas
- [ ] Unit tests for BEDCA alcohol mapping
- [ ] Unit tests for alcohol in yield factor application
- [ ] Unit tests for alcohol in menu aggregation
- [ ] All existing tests pass (no regressions)
- [ ] Build succeeds
- [ ] Specs updated

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

- [x] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 3: TDD implementation
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-04 | Setup | Branch + lite ticket created |

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
