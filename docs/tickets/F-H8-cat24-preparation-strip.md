# F-H8: NLP Cat 24 Preparation/Inquiry Modifier Strip

**Feature:** F-H8 | **Type:** Backend-Feature | **Priority:** Medium
**Status:** Done | **Branch:** feature/F-H8-cat24-preparation-strip (deleted post-merge)
**Created:** 2026-04-26 | **Merged:** 2026-04-26 (PR #215, squash commit `2b00b48`) | **Dependencies:** F-H7 (h7TrailingStrip module + retry seam)

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
- [x] Unit tests written and passing (added 34 new unit tests in `fH8.cat24.unit.test.ts`)
- [x] Integration tests written and passing (2 added in `fH7.engineRouter.integration.test.ts` retroactively in drift cleanup PR — verified GREEN)
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
- [x] Step 6: Ticket updated with final metrics, branch deleted, post-merge sanity 4094/4094 ✓

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-26 | Step 1 — Setup | Branch created, lite ticket drafted, tracker Active Session updated |
| 2026-04-26 | Step 3 — TDD | RED: 25 failing tests in `fH8.cat24.unit.test.ts`. GREEN: implemented `applyH8CatDStrip` + Cat D priority-order extension in `h7TrailingStrip.ts`. All 34 new tests pass + 9 identity/regression tests pass = 34/34. F-H7 trailing/temporal/edge-case tests (106) still pass. |
| 2026-04-26 | Step 4 — Quality gates | api tests 4060 → 4094 (+34), lint 0 errors, build clean. Commit `f5c9951`. |
| 2026-04-26 | Step 5 — PR | PR #215 created against `develop`. Simple complexity → code-review-specialist + qa-engineer skipped per workflow. Diff: 5 files, +437/-15. |
| 2026-04-26 | Step 5 — audit-merge | 11/11 PASS (Status, AC 8/8, DoD 8/8, Workflow 4/5, Evidence 8/8, Completion Log 4 entries, Tracker 5/6, key_facts N/A, Merge base UP TO DATE, Working tree clean, Data files N/A). |
| 2026-04-26 | Step 5 — Merge | PR #215 squash-merged at `2b00b48` (mergeStateStatus CLEAN after test-api passed in 4m19s + Vercel previews + ci-success). Branch deleted local + remote. |
| 2026-04-26 | Step 6 — Housekeeping | Status → Done. Workflow Step 6 [x]. Tracker Active Session cleared. pm-session.md F-H8 row moved to Completed. Post-merge sanity: api 4094/4094 ✓. Operator action pending: api-dev manual deploy + QA battery dev to verify +3-6 OK delta. |
| 2026-04-27 | Post-merge drift cleanup — AC-4/AC-5 integration tests added retroactively | External post-merge audit flagged that AC-4 ("Integration test verifies Q547 (`el pollo al ajillo está muy guisado?`) resolves via L1 retry") and AC-5 ("Integration test verifies catalog landmine protection") were marked [x] but only unit tests existed pre-merge. Pattern was systemic with F-H7 AC-1 (end-to-end ACs satisfied at unit level only). Resolution: 2 real integration tests added to `fH7.engineRouter.integration.test.ts` in cleanup PR — `AC-4: "pollo al ajillo está muy guisado?" → Cat D strips state inquiry → L1 retry hit` and `AC-5: "pollo al ajillo" baseline hits L1 Pass 1 — Cat D never fires (landmine protection)`. Both tests use `H8_DISH_POLLO` fixture (Pollo al ajillo, CE-077 equivalent). Verified GREEN locally (8/8 in fH7.engineRouter.integration vs 6/6 baseline). Closes the systemic drift class — future Simple-tier features must NOT mark integration-test ACs without writing them. |

---

## Merge Checklist Evidence

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | All 7 sections present in order: Spec, Implementation Plan (N/A Simple), AC, DoD, Workflow Checklist, Completion Log, Merge Checklist Evidence. |
| 1. Mark all items | [x] | AC: 8/8 [x], DoD: 8/8 [x], Workflow: 5/5 [x] (post-merge final state; pre-merge snapshot was 4/5 with Step 6 pending). |
| 2. Verify product tracker | [x] | Active Session transitioned step 4/6 (pre-PR) → 5/6 (audit-merge) → 6/6 (post-merge housekeeping in PR #216 squash-merged at `e14235d`). |
| 3. Update key_facts.md | [x] | Originally N/A claim — NLP-only, no new infrastructure. Drift cleanup PR updates `key_facts.md:198` test count `4043 → 4094` (covers F-H7 4060 + F-H8 +34 cumulative drift acknowledged-not-fixed in F-H7). Wrapper pattern count unchanged (17 — Cat D is in `h7TrailingStrip.ts`, not in `CONVERSATIONAL_WRAPPER_PATTERNS`). |
| 4. Update decisions.md | [x] | N/A — extends ADR-023 retry-seam pattern with Cat D, no new architectural decision. Cat D is a strip-only category like Cat A/B/C. |
| 5. Commit documentation | [x] | Commit `f5c9951` includes ticket + tracker + pm-session updates alongside code/tests. PR #216 housekeeping at `e14235d`. Drift cleanup PR adds 2 integration tests + docs corrections. |
| 6. Verify clean working tree | [x] | `git status` clean at every commit boundary in PR #215 + PR #216 + drift cleanup PR. |
| 7. Verify branch up to date | [x] | Branch `feature/F-H8-cat24-preparation-strip` based on develop @ `5bf43d9`. No new commits on develop since branch creation (verified via `git fetch origin develop`). Squash-merged with mergeStateStatus CLEAN. |
| 8. Fill Merge Checklist Evidence | [x] | This table — populated pre-merge in PR #215, refreshed post-merge in drift cleanup PR (rows 1, 2, 3, 5 corrected; rows 8/9/10 added retroactively). |
| 9. Run /audit-merge | [x] | 11/11 PASS — see Completion Log row "Step 5 — audit-merge" (Status, AC 8/8, DoD 8/8, Workflow 4/5, Evidence 8/8, Completion Log 4 entries, Tracker 5/6, key_facts N/A claim — refined post-audit, Merge base UP TO DATE, Working tree clean, Data files N/A). |
| 10. Squash-merge | [x] | PR #215 squash-merged to develop at `2b00b48` 2026-04-26T21:32:10Z. Branch deleted local + remote (--delete-branch). PR #216 housekeeping squash-merged at `e14235d`. Drift cleanup integration tests in this PR. |

---

*Ticket created: 2026-04-26 | Drift cleanup applied: 2026-04-27*
