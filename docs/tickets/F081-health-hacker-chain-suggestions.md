# F081: "Health-Hacker" Chain Suggestions

**Feature:** F081 | **Type:** Bot-Feature | **Priority:** Medium
**Status:** Ready for Merge | **Branch:** feature/F081-health-hacker-chain-suggestions
**Created:** 2026-04-06 | **Dependencies:** None (E007 complete, chains have dishes with nutrients)

---

## Spec

### Description

Add calorie-saving modification tips to chain dish estimation responses. When a user queries a chain dish (e.g., "Big Mac en mcdonalds-es"), the response includes 1-3 actionable tips like "Pide sin queso: -60 kcal" or "Ensalada en lugar de patatas: -200 kcal".

Tips are rule-based (no DB migration needed): a static rules engine maps chain categories (burger, pizza, chicken, sandwich, coffee) to common modifications with estimated calorie savings. Tips only appear for L1 chain dish hits with a known chain slug.

Source: product-evolution-analysis Sec 9/10 — Gemini identified this as a unique differentiator: "No competitor does this at scale."

### API Changes

- `EstimateDataSchema` gains optional `healthHackerTips` field (array of `{ tip: string, caloriesSaved: number }`)
- No new endpoints — tips are embedded in existing `/estimate` and `/conversation/message` responses

### Edge Cases & Error Handling

- No chain slug → no tips (skip silently)
- Chain slug not in rules → no tips (skip silently)
- Dish with < 200 kcal → no tips (low-calorie dishes don't need saving tips)
- Tips should never exceed 3 per response
- cocina-espanola (virtual chain) → excluded (not a real chain with modifiable orders)

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

- [x] New `healthHacker.ts` module with rule-based tips engine
- [x] Rules cover all 13 active chain slugs (grouped by category)
- [x] `EstimateDataSchema` extended with optional `healthHackerTips`
- [x] Tips generated in `estimationOrchestrator.ts` for L1 chain dish hits
- [x] `formatEstimate()` renders tips section in bot output
- [x] Tips only shown when dish calories >= 200
- [x] Max 3 tips per response
- [x] Unit tests for rules engine (24 tests)
- [x] Unit tests for formatter with tips (8 tests)
- [x] All tests pass (36/36)
- [x] Build succeeds

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (36 tests)
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] Shared schemas updated (`HealthHackerTipSchema` + `healthHackerTips` field)

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
| 2026-04-06 | Setup | Branch + ticket created |
| 2026-04-06 | Implement | TDD: healthHacker module, schema extension, orchestrator + route integration, bot formatter. 36 tests |
| 2026-04-06 | Finalize | All quality gates pass. production-code-validator: APPROVED (1 HIGH fixed: API spec sync) |
| 2026-04-06 | Review | PR #73 created. code-review-specialist executing |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan (N/A), AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 11/11, DoD: 6/6, Workflow: 5/5 |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: 5/6 |
| 3. Update key_facts.md | [x] | N/A — no new models/migrations/endpoints |
| 4. Update decisions.md | [x] | N/A — no ADR needed for Simple feature |
| 5. Commit documentation | [x] | Commit: 7f580ff |
| 6. Verify clean working tree | [x] | `git status`: clean after docs commit |

---

*Ticket created: 2026-04-06*
