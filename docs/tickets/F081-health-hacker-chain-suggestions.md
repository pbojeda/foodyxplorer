# F081: "Health-Hacker" Chain Suggestions

**Feature:** F081 | **Type:** Bot-Feature | **Priority:** Medium
**Status:** In Progress | **Branch:** feature/F081-health-hacker-chain-suggestions
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

- [ ] New `healthHacker.ts` module with rule-based tips engine
- [ ] Rules cover all 13 active chain slugs (grouped by category)
- [ ] `EstimateDataSchema` extended with optional `healthHackerTips`
- [ ] Tips generated in `estimationOrchestrator.ts` for L1 chain dish hits
- [ ] `formatEstimate()` renders tips section in bot output
- [ ] Tips only shown when dish calories >= 200
- [ ] Max 3 tips per response
- [ ] Unit tests for rules engine
- [ ] Unit tests for formatter with tips
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
- [ ] Step 3: Implementation with TDD
- [ ] Step 4: Quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-06 | Setup | Branch + ticket created |

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

*Ticket created: 2026-04-06*
