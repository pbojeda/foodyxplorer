# BUG-DATA-DUPLICATE-ATOM-001: Collapse duplicate atom CE-281 → CE-095 (Esqueixada)

**Feature:** BUG-DATA-DUPLICATE-ATOM-001 | **Type:** Backend-Bugfix (data) | **Priority:** Medium
**Status:** In Progress | **Branch:** bugfix/BUG-DATA-DUPLICATE-ATOM-001-collapse-ce281
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-28 | **Dependencies:** F-H6 (PR #211, where CE-281 was introduced)

---

## Spec

### Description

Collapse the duplicate atom **CE-281 `Esqueixada de bacallà`** into the pre-existing **CE-095 `Esqueixada`** (same Catalan codfish salad — long-form Catalan name vs Spanish form). The duplicate was introduced by F-H6 because the spec's pre-check used lowercase grep on alias strings; the Catalan spellings `bacallà`/`bacalà` did not match `bacalao` so detection failed. See `bugs.md` 2026-04-26 entry.

### Implementation Plan

_N/A — Simple task._

Direct steps:
1. **`packages/api/prisma/seed-data/spanish-dishes.json`**: remove CE-281 entry; merge its 3 aliases (`esqueixada de bacalà`, `esqueixada catalana`, plus the canonical name `esqueixada de bacallà`) into CE-095's `aliases` array.
2. **Test count updates** (317 → 316):
   - `packages/api/src/__tests__/f073.seedPhaseSpanishDishes.edge-cases.test.ts:321-340` (2 assertions + 2 comments)
   - `packages/api/src/__tests__/fH6.seedExpansionRound2.edge-cases.test.ts` (lines 8, 114, 117, 118, 124-125; remove H6-EC-8 disambiguation block at lines 278-291; remove CE-281 kcal range entry at line 156; update line 454 fixture from `'esqueixada de bacallà' → CE-281` to `→ CE-095`)
3. **`docs/project_notes/key_facts.md:95`**: catalog count `317` → `316`.

No standard-portions.csv changes (CE-281 has no row there).

### Acceptance Criteria

- [ ] CE-281 entry removed from `spanish-dishes.json`
- [ ] CE-281's aliases (`esqueixada de bacalà`, `esqueixada catalana`, `esqueixada de bacallà`) appear in CE-095's `aliases` array
- [ ] All catalog-count assertions updated from 317 to 316
- [ ] H6-EC-8 (CE-095 vs CE-281 disambiguation test) removed or refactored — the disambiguation no longer applies
- [ ] Alias-resolution test fixture at `fH6.seedExpansionRound2.edge-cases.test.ts:454` resolves `esqueixada de bacallà` to CE-095 (was CE-281)
- [ ] `key_facts.md` catalog count updated to 316
- [ ] All tests pass: `npm test --workspace=@foodxplorer/api`
- [ ] Lint clean: `npm run lint --workspace=@foodxplorer/api`
- [ ] Build clean: `npm run build --workspace=@foodxplorer/api`

### Definition of Done

- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] No linting errors
- [ ] Build succeeds
- [ ] bugs.md entry updated to RESOLVED with PR/commit reference

---

## Workflow Checklist

<!-- Simple flow: Steps 1, 3, 4, 5 only. Step 6 closes the ticket. -->

- [x] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 3: Implementation with TDD (data fix)
- [ ] Step 4: Quality gates pass (tests, lint, build)
- [ ] Step 5: PR + code-review-specialist + merge
- [ ] Step 6: Ticket Done, branch deleted, tracker closed

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-28 | Ticket created | Branch `bugfix/BUG-DATA-DUPLICATE-ATOM-001-collapse-ce281` from develop @ `23a409a`. Lite ticket per Simple workflow. |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.**

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | Sections verified: (list) |
| 1. Mark all items | [ ] | AC: _/_, DoD: _/_, Workflow: _/_ |
| 2. Verify product tracker | [ ] | Active Session: step _/6, Features table: _/6 |
| 3. Update key_facts.md | [ ] | Updated: catalog count 317→316 |
| 4. Update decisions.md | [ ] | N/A |
| 5. Commit documentation | [ ] | Commit: (hash) |
| 6. Verify clean working tree | [ ] | `git status`: clean |
| 7. Verify branch up to date | [ ] | merge-base: up to date |

---

*Ticket created: 2026-04-28*
