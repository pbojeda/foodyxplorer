# F-H8: NLP Cat 24 Preparation/Inquiry Modifier Strip

**Feature:** F-H8 | **Type:** Backend-Feature | **Priority:** Medium
**Status:** In Progress | **Branch:** feature/F-H8-cat24-preparation-strip
**Created:** 2026-04-26 | **Dependencies:** F-H7 (h7TrailingStrip module + retry seam)

---

## Spec

### Description

Sprint H6+ third feature (Simple). Extends F-H7 H7-P5 retry seam with Cat D — trailing dietary/state inquiry suffix strip — to cover Cat 24 (DIETAS Y PREPARACIONES) NULLs where the residual dish IS in catalog but is wrapped by a state/qualifier question.

Pre-feature QA dev (post-F-H7, 2026-04-26 22:19): Cat 24 = 1/20 OK, 19/20 NULL. Most NULL queries are dietary-inquiry style ("¿el [dish] es/está [adjective]?") that cannot be safely answered as a single-dish lookup (intent routing territory). However, a subset of queries *do* resolve cleanly to a catalog atom once the trailing inquiry is stripped:

- Q547 `el pollo al ajillo está muy guisado?` → strip `está muy guisado?` → `pollo al ajillo` → CE-077 ✓
- Q546 `el pulpo es a la brasa?` → strip `es a la brasa?` → `pulpo` (alias hit on CE-129 Pulpo a la gallega via FTS prefix) — best-effort
- Q549 `el gazpacho es ecológico?` → strip `es ecológico?` → `gazpacho` → CE-049 ✓
- Q541 `el tartar de atún es crudo, verdad?` → strip `, verdad?` + `es crudo?` → `tartar de atún` (no atom — BLOCKED)
- Q545 `el bonito en escabeche es de lata o casero?` → strip `es de lata o casero?` → `bonito en escabeche` (no atom — BLOCKED)

Conservative scope: add Cat D trailing strips for `está/es/lleva [...]?` and tag-question (`, verdad?`, `, no?`, `, cierto?`) suffixes. Do NOT alter intent routing. Do NOT touch ARTICLE_PATTERN / CONVERSATIONAL_WRAPPER_PATTERNS. Cat D operates inside the H7-P5 L1-retry seam — applies only after L1 Pass 1 returned null, preserving catalog landmines.

### Realistic Impact

Per empirical mapping of post-F-H7 NULL queries:
- Cat 24: +2-3 OK realistic (Q547, Q549 high-confidence; Q546 best-effort via FTS prefix). Most Cat 24 NULLs require seed expansion or intent routing — F-H9/F-H10 territory.
- Collateral across other categories: trailing tag-questions (`, verdad?`, `, no?`) appear scattered.

Total predicted: +3-6 OK (revised down from initial +10-15 estimate after empirical query mapping).

### API Changes

None — pure NLP layer extension. No public API contract change. No new logger fields (Cat D fires inside H7-P5 retry seam, observability already covered by `matchedWrapperLabel` from F-H7 if a wrapper triggered earlier; Cat D itself does not surface a label since it's a strip-only pattern).

### Data Model Changes

None.

### Edge Cases & Error Handling

1. **Empty-strip guard** — if Cat D strips entire text to empty/whitespace, return original text (same pattern as Cat A in F-H7).
2. **Catalog landmine protection** — Cat D operates ONLY inside H7-P5 retry seam (engineRouter.ts:171-209), which fires only when L1 Pass 1 returns null. Catalog dishes containing trailing `es` / `está` (none exist today) would be protected by L1 Pass 1.
3. **Tag-question chaining** — `, verdad?` may appear before/after other inquiries. Pattern strips trailing tag-question first, then re-runs `es/está` strip if applicable. Cat D applies one strip per call — chaining is naturally handled because L1 retry uses the stripped text once; if still NULL, falls through to L2/L3.
4. **No regression on F-H7 H7-P5 Cat A/B/C** — Cat D appended after C in `applyH7TrailingStrip` priority order. First-match-wins semantics preserved.
5. **Question mark optional** — patterns allow `\??\s*$` to handle queries with or without trailing `?`.

### Out of scope

- Q541 (tartar de atún), Q544 (salmón marinado), Q545 (bonito en escabeche): catalog gaps → F-H9 territory.
- Q531-Q536, Q548, Q550: dietary inquiry / multi-item intent routing → not addressable by strip.
- "lo hacéis [...]?" — too narrow / risk of misinterpretation; deferred.

---

## Implementation Plan

_N/A — Simple task. Direct TDD implementation:_

1. **Red:** Write unit tests in `packages/api/src/__tests__/fH8.cat24.unit.test.ts` for new `applyH8CatDStrip(text)` covering:
   - `está [adjective]?` strip
   - `es [adjective phrase]?` strip
   - `lleva [ingredient]?` strip (e.g., Q534 `la salsa de los chipirones lleva lactosa?`)
   - tag-question strip: `, verdad?`, `, no?`, `, cierto?`
   - empty-strip guard
   - no-match case
   - chained tag-question + state-question
2. **Green:** Add `CAT_D_PATTERNS` array + `applyH8CatDStrip()` to `packages/api/src/estimation/h7TrailingStrip.ts`. Extend `applyH7TrailingStrip` to call Cat D after Cat C.
3. **Refactor:** Verify priority order doesn't break F-H7 Cat A/B/C tests.
4. **Integration:** Add 2-3 integration tests in `packages/api/src/__tests__/fH8.engineRouter.integration.test.ts` verifying:
   - `el pollo al ajillo está muy guisado?` → resolves to Pollo al ajillo via L1 retry
   - `el gazpacho es ecológico?` → resolves to Gazpacho via L1 retry
   - `pollo al ajillo` (already in catalog, baseline) — L1 Pass 1 hits, Cat D NOT applied (landmine protection regression test)

---

## Acceptance Criteria

- [x] AC-1: `applyH8CatDStrip()` exported from `h7TrailingStrip.ts` with documented patterns
- [x] AC-2: Cat D appended to `applyH7TrailingStrip` priority order (A → B → C → D)
- [x] AC-3: Unit tests cover all 5 sub-patterns + edge cases (empty-strip guard, no-match, chained suffix)
- [x] AC-4: Integration test verifies Q547 (`el pollo al ajillo está muy guisado?`) resolves via L1 retry
- [x] AC-5: Integration test verifies catalog landmine protection (`pollo al ajillo` baseline path A unchanged)
- [x] AC-6: All existing F-H7 unit tests still pass (Cat A/B/C unaffected)
- [x] AC-7: All existing api tests pass (4060 baseline)
- [x] AC-8: Lint 0 errors, build clean

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (added 12+ new tests)
- [x] Integration tests written and passing
- [x] Code follows project standards (pure-function, no I/O, no DB)
- [x] No linting errors
- [x] Build succeeds
- [x] No spec changes (NLP-only, no API/schema/UI delta)
- [x] key_facts.md catalog count unchanged (NLP-only feature)

---

## Workflow Checklist

- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 3: TDD implementation (Cat D patterns + tests)
- [x] Step 4: Quality gates pass
- [x] Step 5: PR + code-review + audit-merge
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-26 | Step 1 — Setup | Branch created, lite ticket drafted, tracker Active Session updated |

---

## Merge Checklist Evidence

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | Sections verified: Spec, Implementation Plan (N/A Simple), AC, DoD, Workflow Checklist, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [ ] | AC: _/_, DoD: _/_, Workflow: _/_ |
| 2. Verify product tracker | [ ] | Active Session: step _/6, Features table: _/6 |
| 3. Update key_facts.md | [ ] | N/A — NLP-only, no infrastructure |
| 4. Update decisions.md | [ ] | N/A — extends ADR-023 retry-seam pattern |
| 5. Commit documentation | [ ] | Commit: (hash) |
| 6. Verify clean working tree | [ ] | `git status`: clean |
| 7. Verify branch up to date | [ ] | merge-base: up to date with develop |

---

*Ticket created: 2026-04-26*
