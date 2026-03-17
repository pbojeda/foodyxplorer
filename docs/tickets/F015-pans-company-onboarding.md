# F015: Chain Onboarding — Pans & Company

**Feature:** F015 | **Type:** Backend-Feature | **Priority:** Medium
**Status:** In Progress | **Branch:** feature/F015-pans-company-onboarding
**Created:** 2026-03-17 | **Dependencies:** F010 (registry), F011 (preprocessor pattern)

---

## Spec

### Description

Onboard Pans & Company (Spain) into the existing PDF ingestion pipeline. Source is vivabem.pt (Ibersol parent company portal, official nutritional data). PDF is in Portuguese — product names are similar to Spanish but may need chain-specific preprocessing. Follows the established chain onboarding pattern: seed IDs, registry entry, preprocessor function, seed phase, and tests.

---

## Implementation Plan

N/A — Simple task

---

## Acceptance Criteria

- [x] `CHAIN_SEED_IDS` includes `PANS_AND_COMPANY_ES` with deterministic UUIDs (0016)
- [x] `chain-pdf-registry.ts` has enabled entry for `pans-and-company-es`
- [x] `chainTextPreprocessor.ts` handles `pans-and-company-es` slug (custom preprocessor — names separated from data)
- [x] `seedPhase6` creates restaurant + dataSource rows for Pans & Company
- [x] `seed.ts` calls `seedPhase6`
- [x] E2E verified: 182 dishes parsed from real PDF (spot check: Ketchup 90 kcal, 1.4g protein)
- [x] Unit tests: 34 preprocessor + 6 seed + 30 registry = 70 new tests
- [x] All tests pass (39 test files)
- [ ] Build succeeds (pre-existing TS errors in batch-ingest scripts only)

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing
- [x] Code follows project standards
- [ ] No new linting errors
- [ ] Build succeeds (pre-existing only)

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: Implementation with TDD
- [ ] Step 4: Quality gates pass
- [ ] Step 5: PR created, code review
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-17 | Setup | Branch + ticket created |
| 2026-03-17 | Implement | Seed IDs, registry, preprocessor (custom — names separated from data), seedPhase6, 70 tests. E2E: 182 dishes from real PDF |
| 2026-03-17 | Bug fix | Fixed isPansMetaLine (real PDF has 'Energia (Kj)' not 'Energia'), Per-100g space-before-tab, N Unidades numeric portion rows |

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

*Ticket created: 2026-03-17*
