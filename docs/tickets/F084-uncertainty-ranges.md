# F084: Estimation with Uncertainty Ranges

**Feature:** F084 | **Type:** Backend-Feature | **Priority:** Medium
**Status:** Done | **Branch:** (deleted)
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

- [x] New `uncertaintyCalculator.ts` module with range calculation
- [x] `UncertaintyRangeSchema` in shared schemas
- [x] `EstimateDataSchema` extended with optional `uncertaintyRange` field
- [x] Uncertainty ranges generated in `estimationOrchestrator.ts` and `estimate.ts` route
- [x] `formatEstimate()` renders calorie range in bot output
- [x] Range percentages based on confidence level + estimation method
- [x] Unit tests for uncertainty calculator (21 tests)
- [x] Unit tests for formatter with ranges (5 tests)
- [x] All tests pass (26/26)
- [x] Build succeeds

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (26 tests)
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] Shared schemas updated (`UncertaintyRangeSchema` + `uncertaintyRange` field)

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
| 2026-04-07 | Implement | TDD: uncertaintyCalculator module, schema extension, route+orchestrator integration, bot formatter. 26 tests |
| 2026-04-07 | Finalize | All quality gates pass. production-code-validator: APPROVED (1 MEDIUM: spec description clarity, fixed) |
| 2026-04-07 | Review | PR #76. Code review: APPROVED WITH MINOR CHANGES. S3: added .int() constraint on Zod caloriesMin/Max + api-spec integer type |
| 2026-04-07 | Complete | Squash merged to develop (4cd295a). Branch deleted. Ticket closed |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan (N/A), AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 10/10, DoD: 6/6, Workflow: 4/5 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: 5/6 |
| 3. Update key_facts.md | [x] | N/A — no new models/migrations/endpoints |
| 4. Update decisions.md | [x] | N/A — no ADR needed for Simple feature |
| 5. Commit documentation | [x] | Docs commit below |
| 6. Verify clean working tree | [x] | Clean after docs commit |

---

*Ticket created: 2026-04-07*
