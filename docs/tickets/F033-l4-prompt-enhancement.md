# F033: L4 Prompt Enhancement (Explicit Amounts + Portion Multiplier)

**Feature:** F033 | **Type:** Backend-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F033-l4-prompt-enhancement
**Created:** 2026-03-23 | **Dependencies:** None

---

## Spec

### Description

Enhance Level 4 Strategy B prompt to handle two cases the current prompt ignores:

1. **Explicit gram amounts**: When users specify "200g arroz, 200g pollo", the LLM must use those exact values instead of approximating.
2. **Portion size modifiers**: When users say "plato pequeño de lentejas" or "large plate of lentils", the LLM must return a `portion_multiplier` field (0.7 for small, 1.0 for regular, 1.3 for large). The Node.js engine applies the math (ADR-001: LLM interprets, engine calculates).

### API Changes (if applicable)

No endpoint changes. Internal prompt and aggregation logic only.

### Data Model Changes (if applicable)

None.

### Edge Cases & Error Handling

- LLM omits `portion_multiplier` → default to 1.0
- LLM returns invalid multiplier (<=0, NaN) → default to 1.0
- LLM returns multiplier >5.0 → default to 1.0 (hallucination guard)
- Mixed input: "200g arroz con pollo" → LLM respects 200g for arroz, estimates pollo
- No portion modifier in query → multiplier 1.0 (backward compatible)

---

## Implementation Plan

N/A — Simple task.

---

## Acceptance Criteria

- [x] Strategy B prompt instructs LLM to respect explicit gram amounts
- [x] Strategy B prompt instructs LLM to return `portion_multiplier` for size modifiers
- [x] Aggregation code applies `portion_multiplier` to all nutrient calculations
- [x] Default `portion_multiplier` is 1.0 when absent or invalid
- [x] Tests: explicit grams "200g arroz" → 200g used exactly
- [x] Tests: "plato pequeño" → multiplier < 1.0 applied
- [x] Tests: missing/invalid multiplier → defaults to 1.0
- [x] All tests pass (2728 total: 10 new F033 + 2718 existing)
- [x] Build succeeds (preexisting errors in scraper/ingest routes unrelated to F033)

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: TDD implementation
- [x] Step 4: Quality gates pass
- [x] Step 5: PR created, code review
- [ ] Step 6: Ticket updated, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-23 | Step 1: Setup | Branch feature/F033-l4-prompt-enhancement, lite ticket |
| 2026-03-23 | Step 3: Implement | TDD: 8 new tests (red→green), prompt + parsing + aggregation changes |
| 2026-03-23 | Step 4: Finalize | All 2726 tests pass, lint clean, build clean (preexisting errors unrelated) |
| 2026-03-23 | Step 5: Review | PR #28, code review: 1 IMPORTANT fixed (multiplier upper bound 5.0), 2 tests added. 10 F033 tests total |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Implementation Plan, AC, DoD, Workflow, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 9/9, DoD: 5/5, Workflow: 4/5 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6 (Review), Features table: 5/6 |
| 3. Update key_facts.md | [x] | N/A — no new models, endpoints, or reusable components |
| 4. Update decisions.md | [x] | N/A — ADR-009 already covers portion_multiplier pattern |
| 5. Commit documentation | [x] | Commit: cf7db48 |
| 6. Verify clean working tree | [x] | `git status`: clean after docs commit |

---

*Ticket created: 2026-03-23*
