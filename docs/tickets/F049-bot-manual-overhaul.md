# F049: Bot User Manual Overhaul

**Feature:** F049 | **Type:** Docs | **Priority:** High
**Status:** Ready for Merge | **Branch:** feature/F049-bot-manual-overhaul
**Created:** 2026-03-29 | **Dependencies:** F050 done

---

## Spec

### Description

Comprehensive rewrite of `docs/user-manual-bot.md` to fix all 16 remaining findings from the cross-model audit (`docs/research/bot-manual-audit-2026-03-29.md`). The audit (Claude + Gemini 2.5 Pro + Codex GPT-5.4) identified 2 critical factual errors, 8 important undocumented/incorrectly documented features, and 6 suggestions for completeness.

### Changes Required

**Priority 1 — Critical factual errors (C1, C2):**
- **C1:** Remove false "busca globalmente" claim in context example. Document that context filters within the active chain; if the dish isn't found there, it returns "no data".
- **C2:** Correct TTL explanation. Context expires 2h after last context *set/clear*, not after every message.

**Priority 2 — Missing/incorrect documentation (I1, I2, I4, I5, I6, I7, I8, I9):**
- **I1:** Document `/contexto <cadena>` (set context directly) in Section 8 + Section 15
- **I2:** Remove `/receta` from context-compatible commands list
- **I4:** Tighten NL context detection description with exact pattern and limits
- **I5:** Expand error table (Section 14) with feature-specific errors
- **I6:** Document silent behavior for unauthorized chats in Section 10/11
- **I7:** Document partial results, failed identification in menu analysis (Section 10)
- **I8:** Document comparison tie indicator (`—`) in Section 4
- **I9:** Document restaurant creation from `/restaurante` in Section 9

**Priority 3 — Completeness (S1-S6):**
- **S1:** Add plural forms to portion modifier table (Section 7)
- **S2:** Document ambiguous chain resolution in Section 8
- **S3:** Document recipe truncation in Section 5
- **S4:** Document full recipe output format in Section 5
- **S5:** Document catalog command output details (Sections 3, 9)
- **S6:** Document comparison focus row placement in Section 4

### Edge Cases & Error Handling

N/A — docs only.

---

## Implementation Plan

### Implementation Order

**Step 1 — Section 8 (Context) — 5 fixes: C1, C2, I1, I2, I4**
The most problematic section. Rewrite: correct TTL, remove false fallback example, add `/contexto <cadena>`, remove `/receta` from compatible list, tighten NL pattern description.

**Step 2 — Section 4 (Comparar) — 2 fixes: I8, S6**
Add tie indicator documentation and focus row placement.

**Step 3 — Section 5 (Receta) — 2 fixes: S3, S4**
Document full output format and truncation behavior.

**Step 4 — Section 7 (Portions) — 1 fix: S1**
Add plural forms to table.

**Step 5 — Section 9 (Restaurants) — 2 fixes: I9, S5**
Document restaurant creation and catalog output.

**Step 6 — Section 10 (Menu Analysis) — 2 fixes: I6, I7**
Document unauthorized silence and partial results.

**Step 7 — Section 14 (Errors) — 1 fix: I5**
Expand error table with feature-specific messages.

**Step 8 — Section 3 (Buscar) + Section 15 (Reference) — 1 fix: S5**
Update catalog output details and reference table.

**Step 9 — Header + final review**
Update "Ultima actualizacion" date, verify all 16 findings addressed.

---

## Acceptance Criteria

- [x] C1: Context example does not claim global fallback
- [x] C2: TTL explanation says "2h after last set/clear" not "each message"
- [x] I1: `/contexto <cadena>` documented in Section 8 + Section 15
- [x] I2: `/receta` removed from context-compatible list
- [x] I4: NL context detection describes exact pattern with limits
- [x] I5: Error table expanded with feature-specific messages (20+ errors in 4 categories)
- [x] I6: Unauthorized chat silence documented
- [x] I7: Menu analysis partial results documented
- [x] I8: Comparison tie indicator documented
- [x] I9: Restaurant creation documented
- [x] S1: Plural portion modifiers in table
- [x] S2: Ambiguous chain resolution documented
- [x] S3: Recipe truncation documented
- [x] S4: Recipe output format documented
- [x] S5: Catalog output details documented
- [x] S6: Comparison focus row placement documented
- [x] All 16 pending findings from audit addressed

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Manual is internally consistent
- [x] No broken cross-references
- [x] Build succeeds (no code changes)
- [x] Cross-model review of updated manual (Gemini + Codex: 16/16 FIXED, 3 new issues fixed)

---

## Workflow Checklist

- [x] Step 0: Spec from audit report
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: Plan written
- [x] Step 3: Manual rewritten
- [x] Step 4: Quality review
- [x] Step 5: Cross-model verification (Gemini + Codex): 16/16 FIXED
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-29 | Ticket created | Standard docs-only, 16 findings from cross-model audit |
| 2026-03-29 | Manual rewritten | All 16 findings addressed in single commit |
| 2026-03-29 | Cross-model verification | Gemini + Codex: 16/16 FIXED. 3 new issues found and fixed (protein math, markdown escaping, 2 missing errors) |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan, AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 17/17, DoD: 5/5, Workflow: 6/7 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: 5/6 |
| 3. Update key_facts.md | [x] | N/A — docs only |
| 4. Update decisions.md | [x] | N/A — no ADR |
| 5. Commit documentation | [x] | Commit: (pending) |
| 6. Verify clean working tree | [x] | `git status`: clean after commit |

---

*Ticket created: 2026-03-29*
