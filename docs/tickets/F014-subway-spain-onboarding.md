# F014: Subway Spain Chain Onboarding

**Feature:** F014 | **Type:** Backend-Feature | **Priority:** Medium
**Status:** Done | **Branch:** feature/F014-subway-spain-onboarding
**Created:** 2026-03-16 | **Dependencies:** F009 (pdf-url pipeline), F010 (registry), F011 (preprocessor pattern)

---

## Spec

### Description

Add Subway Spain to the PDF ingestion pipeline. Subway ES publishes official nutritional PDFs at subwayspain.com with full EU nutrients (kcal, fat, saturates, carbs, sugars, fiber, protein, salt) per serving and per 100g. Quarterly update cycle (C1-C4). Config-only onboarding following F011/F012 pattern.

### API Changes (if applicable)

N/A — reuses existing `POST /ingest/pdf-url` with `chainSlug: "subway-es"`.

### Data Model Changes (if applicable)

N/A — new seed data only (1 restaurant + 1 dataSource row via seedPhase5).

---

## Implementation Plan

N/A — Simple task. Pattern established in F011/F012.

---

## Acceptance Criteria

- [x] SUBWAY_ES added to chain-seed-ids with correct UUID pair (segment 0006/0000, ...0015)
- [x] subway-es entry in chain-pdf-registry (enabled, quarterly, HTTPS URL)
- [x] seedPhase5 creates Subway Spain restaurant + dataSource (idempotent)
- [x] chainTextPreprocessor handles subway-es (passthrough)
- [x] Unit tests for seed IDs, registry, preprocessor
- [x] Integration tests for seedPhase5 (create + idempotency)
- [x] All tests pass
- [x] Build succeeds (no new errors)

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit + integration tests written and passing (47 new)
- [x] Code follows project standards
- [x] No new linting errors
- [x] Build succeeds (pre-existing errors only)
- [x] key_facts.md updated with SUBWAY_ES entries

---

## Workflow Checklist

- [x] Step 1: Branch created, tracker updated
- [x] Step 3: backend-developer executed with TDD (47 tests)
- [x] Step 4: production-code-validator executed — APPROVED
- [x] Step 5: PR #14 created, merge checklist executed
- [x] Step 6: Ticket updated, tracker updated, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-16 | Branch created | feature/F014-subway-spain-onboarding from develop |
| 2026-03-16 | Implementation (Step 3) | chain-seed-ids, chain-pdf-registry, seedPhase5, preprocessor passthrough. 47 new tests. backend-developer agent |
| 2026-03-16 | Finalize (Step 4) | production-code-validator: APPROVED. Lint clean on F014 files. 1008 total tests |
| 2026-03-16 | Review (Step 5) | PR #14 created. Merge checklist executed |
| 2026-03-16 | Complete (Step 6) | Squash merged to develop (67b1404). Branch deleted. Tracker + key_facts updated |

---

## Merge Checklist Evidence

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Implementation Plan, AC, DoD, Workflow, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 8/8, DoD: 6/6, Workflow: 5/5 (Simple — steps 1,3,4,5,6) |
| 2. Verify product tracker | [x] | Active Session: step 5/6 (Review), Features table: 5/6 in-progress |
| 3. Update key_facts.md | [x] | Updated: chain-seed-ids (6 chains), chain-pdf-registry (5 entries), chainTextPreprocessor (Subway passthrough), seedPhase5 |
| 4. Update decisions.md | [x] | N/A — no new ADR needed (ADR-008 already covers Subway research) |
| 5. Commit documentation | [x] | Commit: ab6bb83 (docs: update key_facts and tracker for F014) |
| 6. Verify clean working tree | [x] | `git status`: clean after merge |

---

*Ticket created: 2026-03-16*
