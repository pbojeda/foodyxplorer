# F085: Portion Sizing Matrix

**Feature:** F085 | **Type:** Backend-Feature | **Priority:** Medium
**Status:** In Progress | **Branch:** feature/F085-portion-sizing-matrix
**Created:** 2026-04-07 | **Dependencies:** None (estimation engine stable)

---

## Spec

### Description

Detect standard Spanish portion terms in the user query and enrich the response with gram range context. When a user searches "media ración de calamares", the response includes the portion context: "media ración = 100-125g".

This is informational — it does not modify the nutritional estimation, just provides context about what the detected portion term typically means in grams.

Standard Spanish portion terms:
- "un plato" / "plato" = 250-300g
- "una ración" / "ración" = 200-250g
- "media ración" = 100-125g
- "una tapa" / "tapa" = 50-80g
- "un pintxo" / "pintxo" / "pincho" = 30-60g
- "un montadito" / "montadito" = 40-60g
- "un bocadillo" / "bocadillo" / "bocata" = 200-250g
- "una caña" (beer context) = 200ml

Source: product-evolution-analysis — Spanish portion vocabulary ("media ración", "pintxo", "tapa")

### API Changes

- `EstimateDataSchema` gains optional `portionSizing` field (`PortionSizing`)
- No new endpoints — embedded in existing responses

### Edge Cases & Error Handling

- No portion term in query → no portionSizing field (skip silently)
- null result → still detect from query (portion context is useful even without nutritional data)
- Multiple portion terms → first match wins (longest match first to avoid "ración" matching inside "media ración")
- Case-insensitive, accent-insensitive matching

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

- [ ] New `portionSizing.ts` module with portion term detection
- [ ] 8+ Spanish portion terms with gram ranges
- [ ] `PortionSizingSchema` in shared schemas
- [ ] `EstimateDataSchema` extended with optional `portionSizing` field
- [ ] Portion sizing detected in `estimationOrchestrator.ts` and `estimate.ts` route
- [ ] `formatEstimate()` renders portion context in bot output
- [ ] Longest-match-first to avoid partial matches
- [ ] Unit tests for portion detector
- [ ] Unit tests for formatter with portion sizing
- [ ] All tests pass
- [ ] Build succeeds

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] Code follows project standards
- [ ] No linting errors
- [ ] Build succeeds
- [ ] Shared schemas updated (`PortionSizingSchema` + `portionSizing` field)

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
