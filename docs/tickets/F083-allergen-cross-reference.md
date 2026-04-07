# F083: Allergen Cross-Reference

**Feature:** F083 | **Type:** Backend-Feature | **Priority:** Medium
**Status:** Done | **Branch:** (deleted)
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

- [x] New `allergenDetector.ts` module with rule-based allergen detection
- [x] 14 EU allergen categories with Spanish + English keyword patterns
- [x] `DetectedAllergenSchema` in shared schemas
- [x] `EstimateDataSchema` extended with optional `allergens` field
- [x] Allergens generated in `estimationOrchestrator.ts` and `estimate.ts` route
- [x] `formatEstimate()` renders allergens section in bot output
- [x] Multiple allergens detected per dish (not first-match-wins)
- [x] Unit tests for allergen detector (41 tests)
- [x] Unit tests for formatter with allergens (7 tests)
- [x] All tests pass (48/48)
- [x] Build succeeds

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (48 tests)
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] Shared schemas updated (`DetectedAllergenSchema` + `allergens` field)

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
| 2026-04-07 | Implement | TDD: allergenDetector module, schema extension, route+orchestrator integration, bot formatter. 44 tests |
| 2026-04-07 | Finalize | All quality gates pass. production-code-validator: APPROVED (0 issues) |
| 2026-04-07 | Review | PR #75. Code review: APPROVED WITH MINOR CHANGES. I1: removed 'crema' from dairy (false positive on vegetable soups). I2: bare 'pan' → compound patterns (panacota/panaché false positives). +6 tests → 50 total |
| 2026-04-07 | Complete | Squash merged to develop (bf16e6e). Branch deleted. Ticket closed |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan (N/A), AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 11/11, DoD: 6/6, Workflow: 4/5 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: 5/6 |
| 3. Update key_facts.md | [x] | N/A — no new models/migrations/endpoints |
| 4. Update decisions.md | [x] | N/A — no ADR needed for Simple feature |
| 5. Commit documentation | [x] | Docs commit below |
| 6. Verify clean working tree | [x] | Clean after docs commit |

---

*Ticket created: 2026-04-07*
