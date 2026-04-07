# F085: Portion Sizing Matrix

**Feature:** F085 | **Type:** Backend-Feature | **Priority:** Medium
**Status:** Done | **Branch:** (deleted)
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
- "ración para compartir" = 300-400g

Source: product-evolution-analysis — Spanish portion vocabulary ("media ración", "pintxo", "tapa")

### API Changes

- `EstimateDataSchema` gains optional `portionSizing` field (`PortionSizing`)
- No new endpoints — embedded in existing responses

### Edge Cases & Error Handling

- No portion term in query → no portionSizing field (skip silently)
- null result → still detect from query (portion context is useful even without nutritional data)
- Multiple portion terms → first match wins (longest match first to avoid "ración" matching inside "media ración")
- Case-insensitive, accent-insensitive matching
- Word boundary matching prevents false positives ("tapar" ≠ "tapa")

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

- [x] New `portionSizing.ts` module with portion term detection
- [x] 9 Spanish portion terms with gram ranges
- [x] `PortionSizingSchema` in shared schemas
- [x] `EstimateDataSchema` extended with optional `portionSizing` field
- [x] Portion sizing detected in `estimationOrchestrator.ts` and `estimate.ts` route
- [x] `formatEstimate()` renders portion context in bot output
- [x] Longest-match-first + word boundary matching
- [x] Unit tests for portion detector (26 tests)
- [x] Unit tests for formatter with portion sizing (4 tests)
- [x] All tests pass (30/30)
- [x] Build succeeds

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (30 tests)
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] Shared schemas updated (`PortionSizingSchema` + `portionSizing` field)

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
| 2026-04-07 | Implement | TDD: portionSizing module, schema extension, route+orchestrator integration, bot formatter. 27 tests |
| 2026-04-07 | Finalize | All quality gates pass. production-code-validator: NEEDS REVIEW (1 MEDIUM: caña accent, fixed) |
| 2026-04-07 | Review | PR #77. Code review: APPROVED WITH MINOR CHANGES. Added word boundary matching (tapar≠tapa, platón≠plato). +3 false-positive tests → 30 total |
| 2026-04-07 | Complete | Squash merged to develop (2d859f3). Branch deleted. Ticket closed |

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
