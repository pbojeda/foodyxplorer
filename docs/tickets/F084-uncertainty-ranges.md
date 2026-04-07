# F084: Estimation with Uncertainty Ranges

**Feature:** F084 | **Type:** Backend-Feature | **Priority:** Medium
**Status:** In Progress | **Branch:** feature/F084-uncertainty-ranges
**Created:** 2026-04-07 | **Dependencies:** None (estimation engine stable, confidence levels exist)

---

## Spec

### Description

Show calorie uncertainty ranges instead of single numbers: "350 kcal (320-380)" based on confidence level and estimation method. Addresses the key risk "Perceived inaccuracy" — users should understand that non-official data is an estimate, not a precise measurement.

Ranges are computed from the existing `confidenceLevel` (high/medium/low) and `estimationMethod` (official/scraped/ingredients/extrapolation/llm) fields on `EstimateResult`. No DB changes needed.

Same DRY enrichment pattern as F081-F083: `enrichWithUncertainty()` spread helper.

Source: product-evolution-analysis Sec 5 — "Instead of pretending exactitude, show ranges: 320-420 kcal"

### API Changes

- `EstimateDataSchema` gains optional `uncertaintyRange` field (`UncertaintyRange`)
- No new endpoints — ranges are embedded in existing responses

### Edge Cases & Error Handling

- null result → no uncertainty range
- official estimation method + high confidence → tight range (±5%)
- llm estimation method + low confidence → wide range (±30%)
- Range is always symmetrical around the reported value
- Min calories floor at 0 (never negative)

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

- [ ] New `uncertaintyCalculator.ts` module with range calculation
- [ ] `UncertaintyRangeSchema` in shared schemas
- [ ] `EstimateDataSchema` extended with optional `uncertaintyRange` field
- [ ] Uncertainty ranges generated in `estimationOrchestrator.ts` and `estimate.ts` route
- [ ] `formatEstimate()` renders calorie range in bot output
- [ ] Range percentages based on confidence level + estimation method
- [ ] Unit tests for uncertainty calculator
- [ ] Unit tests for formatter with ranges
- [ ] All tests pass
- [ ] Build succeeds

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] Code follows project standards
- [ ] No linting errors
- [ ] Build succeeds
- [ ] Shared schemas updated (`UncertaintyRangeSchema` + `uncertaintyRange` field)

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
