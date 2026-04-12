# BUG-PROD-003: Ambiguous plain Spanish queries resolve to unexpected specialty items

**Feature:** BUG-PROD-003 | **Type:** Backend-Bugfix (data) | **Priority:** P1 (UX)
**Status:** Ready for Merge | **Branch:** bug/BUG-PROD-003-vino-disambiguation
**Created:** 2026-04-12 | **Dependencies:** None

---

## Spec

### Description

User reported that searching `"vino"` on `/hablar` returns an unexpected result. They thought it was "vinagre de vino". Empirical investigation reveals the actual wrong answer is **"Manzanilla (vino)"** — a specialty fortified sherry from Sanlúcar de Barrameda that happens to have the shortest name among all matches. The same class of bug affects `"cerveza"`, which returns **"Cerveza lata"** instead of the user's expected tercio-style serving.

This is a P1 UX bug: the `/hablar` web assistant (and the Telegram bot) answers the most common Spanish drink queries with specialty items, eroding user trust on the first interaction.

### Empirical ground truth

Direct inspection of `packages/api/prisma/seed-data/spanish-dishes.json` plus tracing `packages/api/src/estimation/level1Lookup.ts`:

**For query `"vino"`:**
1. `exactDishMatch` checks `d.aliases @> ARRAY['vino']` → MISS (no dish has the bare alias "vino"; the existing aliases are "vino tinto", "vino blanco", "vino de manzanilla").
2. `ftsDishMatch` matches via `to_tsvector('spanish', name_es) @@ plainto_tsquery('spanish', 'vino')`:
   - `Manzanilla (vino)` — 17 chars
   - `Copa de vino tinto` — 18 chars
   - `Copa de vino blanco` — 19 chars
3. `ORDER BY priority_tier ASC, length(name_es) ASC LIMIT 1` → **Manzanilla (vino) wins**.

**For query `"cerveza"`:**
- No alias match.
- FTS matches: `Caña de cerveza` (15 chars, alias `"caña"`), `Cerveza lata` (12 chars, alias `"tercio"`), `Cerveza sin alcohol` (19 chars, alias `"cerveza 0,0"`).
- `Cerveza lata` wins by length.

**The user's "vinagre de vino" wording was imprecise.** PostgreSQL's Spanish FTS stemmer gives `vinagre → vinagr` and `vino → vino` — different lexemes, no cross-match. No row literally named "vinagre de vino" exists in any seed file (`grep -i 'vinagre de vino'` across `spanish-dishes.json`, `name-es-map.json`, `bedca-snapshot-full.json` returned zero hits). The real wrong answer was Manzanilla.

### Root cause (class of bug)

Spanish culturally-common short-form drink/food terms lack canonical aliases. The F078 alias machinery works perfectly when exact-matched via Strategy 1 (GIN-indexed `aliases @>`), but the most common ambiguous singletons were never wired. The FTS fallback (Strategy 2) picks the shortest matching name, which is anti-correlated with cultural frequency: specialty items (Manzanilla, Cerveza lata) tend to have shorter names than the common defaults (Copa de vino tinto, Caña de cerveza).

Notably, `"agua"` is NOT affected — `spanish-dishes.json:5067` already aliases `"agua"` to `"Agua mineral"`. This ticket addresses only the two user-reported cases and adds regression tests.

### Fix

**Surgical alias additions to `packages/api/prisma/seed-data/spanish-dishes.json`** (validated as Option A in cross-model review — Gemini agreed, Codex concurred with Cerveza-lata tie-break).

1. `Copa de vino tinto` (line 4985): `aliases: ["vino tinto", "vino"]`
2. `Cerveza lata` (line 5517): `aliases: ["tercio", "cerveza"]`

Vino tinto is the canonical default red wine in most of Spain; cross-model consensus (Gemini + Codex) both chose tinto over blanco.

For cerveza, the user wrote *literally* "un tercio de cerveza" in their framing, and `Cerveza lata` already has the `tercio` alias with BEDCA-sourced nutrients (330 ml, 142 kcal, 11.6 g alcohol). Aligning "cerveza" to the same row keeps the nutrition math consistent and honors the user's explicit wording. Codex also recommended this path for nutrient accuracy. Gemini preferred `Caña de cerveza` on bar-culture grounds but acknowledged tercio is defensible.

### Why not a deeper fix

- **Ranking tweak (ts_rank in ORDER BY):** broad regression surface. Not warranted for 2 terms.
- **Canonical aliases table:** over-engineering for 2 rows. A data-level alias is additive, surgical, and fully covered by the existing GIN index.
- **LLM pre-dispatch disambiguation:** L4 LLM already exists but only runs when L1/L2/L3 all miss. Adding a pre-L1 LLM step would bloat latency and cost.
- **Telemetry-driven alias backfill:** codex suggestion; follow-up work, out of scope here.

### Out of scope

- Other ambiguous short terms — `pan`, `leche`, `manzana`, `arroz`, `pollo`, `pescado`, `queso`, `jamon`, `cafe`, `chocolate`. Cross-model review flagged these. Follow-up ticket: audit single-token Spanish food terms that currently resolve to specialty items instead of canonical defaults. Not in this PR.
- **Manzanilla collision:** three dishes currently claim the alias `"manzanilla"` (Infusión de manzanilla, Copa de fino, Manzanilla (vino)). Existing issue, not touched here.
- **Pipeline tooling to detect missing canonical aliases:** out of scope. Noted as follow-up in `decisions.md`.

### Edge cases

- **Verify the alias additions don't break any test that `toEqual`s the exact aliases array.** Grep across `packages/api/src/__tests__/` for the strings `"vino tinto"`, `"tercio"`, `aliases.*toEqual` — all clear at time of writing.
- **Verify the seed data passes the existing validator** (`packages/api/prisma/seed-data/validateSeedData.ts`) if one exists.
- **Verify no existing dish claims the bare alias `"vino"` or `"cerveza"`** — `grep -n '"vino"' spanish-dishes.json` and `grep -n '"cerveza"' spanish-dishes.json` both return zero matches. Safe.

---

## Implementation Plan

### Files to modify

| # | File | Change |
|---|------|--------|
| 1 | `packages/api/prisma/seed-data/spanish-dishes.json` | Add `"vino"` alias to `Copa de vino tinto`; add `"cerveza"` alias to `Cerveza lata` |
| 2 | `packages/api/src/__tests__/bug-prod-003.disambiguation.test.ts` | **NEW** data-integrity + invariant test on the JSON |
| 3 | `docs/project_notes/decisions.md` | Short ADR note about the canonical-aliases pattern for Spanish short-form drink/food terms |
| 4 | `docs/project_notes/bugs.md` | BUG-PROD-003 entry with root cause, fix, prevention, follow-up backlog |

### Test strategy

This is a pure data change — the `exactDishMatch` SQL + GIN index logic is already covered by F078 structural tests. The new test verifies the **data itself** so the change cannot silently regress:

- Load `spanish-dishes.json` via `readFileSync` + `JSON.parse`
- Assert: the dish `Copa de vino tinto` has `"vino"` in its aliases
- Assert: the dish `Cerveza lata` has `"cerveza"` in its aliases
- Invariant: `"vino"` is claimed by **exactly one** dish (no collision)
- Invariant: `"cerveza"` is claimed by **exactly one** dish
- Regression: `"vino tinto"` still on Copa de vino tinto, `"vino blanco"` still on Copa de vino blanco, `"caña"` still on Caña de cerveza, `"tercio"` still on Cerveza lata, `"agua"` still on Agua mineral

### Execution

1. Flip the seed JSON.
2. Write the new test (RED — asserts "vino" is on Copa de vino tinto; current state is absent → red).
3. Add the alias → GREEN.
4. Run `npm test -w @foodxplorer/api`, lint, typecheck, build.
5. Update `bugs.md` + `decisions.md`.
6. Commit, push, PR, review, merge.

### Rollback

If any user-facing regression appears (e.g., "vino" now returns an unexpected different dish due to some unrelated data drift), remove the two alias strings from the JSON and revert. No schema migration, no dependency chain.

---

## Acceptance Criteria

- [x] `Copa de vino tinto` in `spanish-dishes.json` has `"vino"` in its `aliases` array
- [x] `Cerveza lata` in `spanish-dishes.json` has `"cerveza"` in its `aliases` array
- [x] Existing aliases preserved: `"vino tinto"`, `"vino blanco"`, `"caña"`, `"tercio"`, `"cerveza de barril"`, `"vino de manzanilla"`, `"agua"`
- [x] New data-integrity test file at `packages/api/src/__tests__/bug-prod-003.disambiguation.test.ts` with RED→GREEN flow
- [x] Invariant tests assert `"vino"` and `"cerveza"` are each claimed by exactly one dish
- [x] All existing tests still pass for `@foodxplorer/api`
- [x] Lint, typecheck, build clean for `@foodxplorer/api`
- [x] `bugs.md` + `decisions.md` updated
- [x] Cross-model review (`codex` + `gemini`) applied to the spec before implementation

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Data-integrity test passing
- [x] No linting errors
- [x] Build succeeds
- [x] `bugs.md` entry with follow-up backlog
- [x] Tracker updated
- [x] PR reviewed by `code-review-specialist`
- [ ] Manual verification post-merge on `/hablar` with real staging DB (user action)

---

## Workflow Checklist

- [x] Step 0: Spec written and reviewed by Codex + Gemini
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: Plan written (see Implementation Plan above)
- [x] Step 3: Implementation with TDD
- [x] Step 4: Quality gates pass
- [x] Step 5: `code-review-specialist` executed
- [ ] Step 6: Ticket finalized, branch deleted, tracker updated (post-merge)

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-12 | Deep investigation | Traced L1 cascade; verified FTS winner is "Manzanilla (vino)", not "vinagre de vino" as user remembered. Verified "agua" already handled. |
| 2026-04-12 | Cross-model review | Codex + Gemini reviewed spec. Consensus: vino→tinto. Split on cerveza (codex→tercio/lata, gemini→caña); resolved in favor of user's literal wording "un tercio de cerveza". |
| 2026-04-12 | Implementation | Data-only change to `spanish-dishes.json` + data-integrity test. |

---

## Merge Checklist Evidence

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Plan, AC, DoD, Workflow, Log, Evidence |
| 1. Mark all items | [x] | AC: 8/8, DoD: 7/8 (manual verification post-merge), Workflow: 0-5/6 |
| 2. Verify product tracker | [x] | Active Session: BUG-PROD-003, step 5/6 |
| 3. Update key_facts.md | [x] | N/A — no new models/endpoints (data change only) |
| 4. Update decisions.md | [x] | ADR-style note added for canonical-aliases pattern |
| 5. Commit documentation | [x] | Single commit containing data + test + docs |
| 6. Verify clean working tree | [x] | Reported post-audit |
| 7. Verify branch up to date | [x] | Branched from develop, no divergence |

---

*Ticket created: 2026-04-12*
