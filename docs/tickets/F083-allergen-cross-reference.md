# F083: Allergen Cross-Reference

**Feature:** F083 | **Type:** Backend-Feature | **Priority:** Medium
**Status:** In Progress | **Branch:** feature/F083-allergen-cross-reference
**Created:** 2026-04-07 | **Dependencies:** None (estimation engine stable, F081/F082 enrichment pattern established)

---

## Spec

### Description

Rule-based allergen detection from food/dish names. When a user estimates a food, the response flags which of the 14 EU-regulated allergens are potentially present based on keyword matching on the dish/food name (Spanish + English).

Same DRY enrichment pattern as F081 (tips) and F082 (substitutions): `enrichWithAllergens()` spread helper, no DB queries needed.

Source: product-evolution-analysis Sec 9 Tier 2 — "Allergen cross-reference — Ingredient-level allergen detection from L2 data"

### API Changes

- `EstimateDataSchema` gains optional `allergens` field (array of `DetectedAllergen`)
- No new endpoints — allergens are embedded in existing `/estimate` and `/conversation/message` responses

### Edge Cases & Error Handling

- No keyword match → no allergens field (skip silently)
- null result → no allergens
- Multiple allergens can be detected simultaneously (unlike substitutions which are first-match-wins)
- Allergens and F081 tips / F082 substitutions can coexist
- Disclaimer: detection is heuristic, not exhaustive — for informational purposes only

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

- [ ] New `allergenDetector.ts` module with rule-based allergen detection
- [ ] 14 EU allergen categories with Spanish + English keyword patterns
- [ ] `DetectedAllergenSchema` in shared schemas
- [ ] `EstimateDataSchema` extended with optional `allergens` field
- [ ] Allergens generated in `estimationOrchestrator.ts` and `estimate.ts` route
- [ ] `formatEstimate()` renders allergens section in bot output
- [ ] Multiple allergens detected per dish (not first-match-wins)
- [ ] Unit tests for allergen detector
- [ ] Unit tests for formatter with allergens
- [ ] All tests pass
- [ ] Build succeeds

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] Code follows project standards
- [ ] No linting errors
- [ ] Build succeeds
- [ ] Shared schemas updated (`DetectedAllergenSchema` + `allergens` field)

---

## Workflow Checklist

- [ ] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 3: Implementation with TDD
- [ ] Step 4: Quality gates pass, `production-code-validator` executed
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-07 | Setup | Branch + ticket created |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

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

*Ticket created: 2026-04-07*
