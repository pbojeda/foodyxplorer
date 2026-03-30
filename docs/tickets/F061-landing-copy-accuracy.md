# F061: Landing Copy Accuracy & Content Fixes

**Feature:** F061 | **Type:** Frontend-Bugfix | **Priority:** High (launch blocker)
**Status:** Ready for Merge | **Branch:** feature/F061-landing-copy-accuracy
**Created:** 2026-03-29 | **Dependencies:** None
**Audit Source:** `docs/research/landing-audit-2026-03-29.md` — Findings I3, I4, I7, S6

---

## Spec

### Description

Four content accuracy issues in the landing page copy that could erode trust or create legal risk. Three are i18n string changes, one is a code comment + signature fix.

**Bug 1 (I3 — IMPORTANT): FAQ overclaims chain coverage**

FAQ answer for "¿Qué restaurantes están disponibles?" states "10 cadenas" but only 7 exist.

**Exact replacement (ES):**
> "Actualmente cubrimos las principales cadenas españolas con datos oficiales: McDonald's, Burger King, KFC, Telepizza, Subway, Domino's y Pans & Company, entre otras. Estamos ampliando la cobertura continuamente."

**Exact replacement (EN):**
> "We currently cover the main Spanish chains with official data: McDonald's, Burger King, KFC, Telepizza, Subway, Domino's, and Pans & Company, among others. We are continuously expanding coverage."

**Bug 2 (I4 — IMPORTANT): Fabricated testimonial attribution**

EmotionalBlock shows "— Usuario beta, Madrid" with no actual beta users.

**Fix:** Change `quoteAuthor` in es.ts from `'Usuario beta, Madrid'` to `'Experiencia que buscamos ofrecer'`.
Change in en.ts accordingly: `'The experience we aim to deliver'`.

**Bug 3 (I7 — IMPORTANT): A/B resolver comment mismatches implementation**

JSDoc says "random 50/50" but implementation always defaults to 'a'. The `random` param is accepted but never called.

**Fix:**
- Update comment: "Priority: URL searchParam > cookie > default 'a'"
- Remove unused `random` parameter from `resolveVariant()` signature
- Remove JSDoc line "The optional `random` param enables deterministic testing."

**Bug 4 (S6 — SUGGESTION): Urgency claim without backing**

WaitlistCTA shows "Plazas limitadas para el acceso anticipado" with no specifics.

**Fix (ES):** `'Apúntate para acceder antes que nadie cuando lancemos'`
**Fix (EN):** `'Sign up to get early access when we launch'`

### Files to Modify

| File | Change |
|------|--------|
| `packages/landing/src/lib/i18n/locales/es.ts` | FAQ chain text (line 236), testimonial author (line 135), urgency copy (line 259) |
| `packages/landing/src/lib/i18n/locales/en.ts` | Same 3 changes in English equivalent |
| `packages/landing/src/lib/ab-testing.ts` | JSDoc comment fix, remove `random` param |

### Edge Cases & Error Handling

- **en.ts type safety**: `en.ts` must match the `Dictionary` type from `es.ts`. TypeScript strict catches mismatches at build time.
- **FAQ JSON-LD**: The FAQ content feeds `FAQPage` JSON-LD schema. The schema uses the same dictionary, so the change propagates automatically.
- **Existing tests**: `ab-testing.test.ts` calls `resolveVariant()` with 2 args only — no tests use the `random` param, so removing it is safe.

---

## Implementation Plan

### Files to Modify

| File | Changes |
|------|---------|
| `packages/landing/src/lib/i18n/locales/es.ts` | FAQ chain answer (line 236), quoteAuthor (line 135), urgency (line 259) |
| `packages/landing/src/lib/i18n/locales/en.ts` | Same 3 changes in English |
| `packages/landing/src/lib/ab-testing.ts` | JSDoc comment, remove `random` param |
| `packages/landing/src/__tests__/edge-cases.f061.test.ts` | New: copy assertions for ES+EN + resolveVariant signature |

### Implementation Order (TDD)

**Phase 1 — Tests first**

1. **`edge-cases.f061.test.ts`** (new) — Write all failing tests:
   - ES FAQ answer exact match (starts with "Actualmente cubrimos las principales cadenas")
   - EN FAQ answer exact match (starts with "We currently cover the main Spanish chains")
   - ES quoteAuthor === "Experiencia que buscamos ofrecer"
   - EN quoteAuthor === "The experience we aim to deliver"
   - ES urgency === "Apúntate para acceder antes que nadie cuando lancemos"
   - EN urgency === "Sign up to get early access when we launch"
   - ab-testing.ts source contains "default 'a'" and does NOT contain "random 50/50" (string grep on source)
   - Run → RED (7+ failures)

**Phase 2 — Implementation**

2. **`es.ts`** — Replace 3 strings:
   - Line 135: `quoteAuthor: 'Experiencia que buscamos ofrecer'`
   - Line 236: FAQ answer with "entre otras" copy
   - Line 259: `urgency: 'Apúntate para acceder antes que nadie cuando lancemos'`

3. **`en.ts`** — Same 3 changes in English equivalent

4. **`ab-testing.ts`** — Update JSDoc, remove `random` param:
   - Line 14: "Priority: URL searchParam > cookie > default 'a'"
   - Remove line 15 ("The optional `random` param...")
   - Line 20: Remove `random: () => number = Math.random` from signature
   - Run → GREEN

**Phase 3 — Quality gates**

5. Full test suite: `npx jest --ci --no-coverage` → all 592+ pass
6. Lint: `npx next lint` → clean
7. Build: `npx next build` → success

### Testing Strategy

Single test file `edge-cases.f061.test.ts` importing the dictionaries directly:
```
import { es } from '../lib/i18n/locales/es';
import { en } from '../lib/i18n/locales/en';
import { resolveVariant } from '../lib/ab-testing';
```
Pure data assertions — no component rendering needed. Fast, deterministic.

---

## Acceptance Criteria

- [x] ES FAQ answer contains "entre otras" and does NOT contain "10 cadenas"
- [x] EN FAQ answer contains "among others" and does NOT contain "10 chains"
- [x] ES testimonial `quoteAuthor` is "Experiencia que buscamos ofrecer" (no "Usuario beta")
- [x] EN testimonial `quoteAuthor` is "The experience we aim to deliver"
- [x] ES urgency is "Apúntate para acceder antes que nadie cuando lancemos" (no "Plazas limitadas")
- [x] EN urgency matches equivalent change
- [x] A/B resolver comment says "default 'a'" (no "random 50/50")
- [x] `random` parameter removed from `resolveVariant()` signature
- [x] All existing 592+ tests pass (605 total)
- [x] New tests assert exact ES+EN copy for FAQ, testimonial, and urgency (13 assertions)
- [x] New test asserts ab-testing.ts source contains "default 'a'" (no "random 50/50")
- [x] Build succeeds
- [x] Lint clean

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (605 tests, 52 suites)
- [x] Code follows project standards (TypeScript strict, no `any`)
- [x] No linting errors
- [x] Build succeeds
- [x] Specs reflect final implementation

---

## Workflow Checklist

- [x] Step 0: Spec reviewed (self-review + Gemini + Codex)
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: Plan created + reviewed (Gemini + Codex), approved
- [x] Step 3: `frontend-developer` executed with TDD (3 phases)
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [x] Step 5: `code-review-specialist` executed (APPROVED)
- [x] Step 5: `qa-engineer` executed (VERIFIED)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-29 | Spec created | From landing audit findings I3, I4, I7, S6 |
| 2026-03-30 | Worktree created | `../foodXPlorer-F061` from develop (SHA 1d635fd, includes F059+F060) |
| 2026-03-30 | Spec self-review | Verified: no tests use random param, en.ts needs same changes, exact copy specified |
| 2026-03-30 | Spec reviewed by Gemini + Codex | Gemini: APPROVED. Codex: 1I+1S (AC missing EN copy, vague tests). Fixed: explicit EN ACs + concrete test assertions |
| 2026-03-30 | Plan created + self-review | 3 phases, 7 steps, 4 files |
| 2026-03-30 | Plan reviewed by Gemini + Codex | Gemini: APPROVED. Codex: 2I (signature test invalid, need exact strings). Fixed: removed .length test, exact string assertions |
| 2026-03-30 | Implementation complete | 3 phases TDD. 4 files (3 modified + 1 new test). 605 tests (13 new) |
| 2026-03-30 | Production validator | READY — 0 issues |
| 2026-03-30 | Code review | APPROVED — 0 issues |
| 2026-03-30 | QA | VERIFIED — 0 bugs, all 13 AC verified |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan, AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 13/13, DoD: 6/6, Workflow: 7/8 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: in-progress |
| 3. Update key_facts.md | [x] | N/A |
| 4. Update decisions.md | [x] | N/A |
| 5. Commit documentation | [x] | Commit: (this commit) |
| 6. Verify clean working tree | [x] | `git status`: clean after commit |

---

*Ticket created: 2026-03-29*
