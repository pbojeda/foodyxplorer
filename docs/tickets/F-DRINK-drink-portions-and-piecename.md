# F-DRINK: Drink Portion Terms + pieceName Plural Fix

**Feature:** F-DRINK | **Type:** Backend-Simple | **Priority:** Low
**Status:** In Progress | **Branch:** feature/F-DRINK-drink-portions-and-piecename
**Created:** 2026-04-21 | **Dependencies:** None

---

## Spec

### Description

Two small, independent follow-ups from the 2026-04-21 QA battery:

**P7 — Drink-specific portion terms not recognized (Category 3, 3 NULLs)**

`packages/api/src/estimation/portionSizing.ts` `PORTION_RULES` (F085) does not include:
- `tercio` — standard Spanish beer bottle (~330 ml), "un tercio de cerveza" is the most common order
- `vaso` — standard glass (varies: 150-200 ml water, 150 ml wine); "un vaso de vino tinto"
- `botella` — standard bottle (750 ml wine, 330 ml beer); "una botella de vino tinto"

Failing queries from the QA battery Category 3 (30 drink queries, 27 OK, 3 NULL):
- `"un tercio de cerveza"` → NULL (tercio not recognized)
- `"un vaso de vino tinto"` → NULL (vaso not recognized — clashes with F-MORPH diminutive note: F-MORPH owns `vasito`, F-DRINK owns `vaso`)
- `"una botella de vino tinto"` → NULL (botella not recognized)

`caña` IS already in PORTION_RULES as a drink portion (200ml). `copa` is NOT — should also be added since "una copa de vino" is common.

**P8 — pieceName singular in seed CSV (cosmetic)**

`packages/api/prisma/seed-data/standard-portions.csv` uses singular pieceNames:
- Line 2-5: `pieceName=croqueta` — should be `croquetas`
- Line 10-13: `pieceName=gamba` — should be `gambas`
- Line 14-17: `pieceName=aceituna` — should be `aceitunas`
- Line 26-29: `pieceName=boquerón` — should be `boquerones`

User expectation noted 2026-04-21 (user feedback `project_portion_display_gap.md`): cards/bot display should use plurals when count > 1. The singular stored in CSV is shown verbatim, producing "4 croqueta" / "6 gamba" — grammatically incorrect in Spanish.

### Scope

**In scope (F-DRINK):**
1. Extend PORTION_RULES with drink-specific terms: `tercio` (330ml), `vaso` (150ml default), `botella` (750ml default, or 330ml for beer context), `copa` (150ml wine).
2. Fix pieceName plurals in standard-portions.csv for known multi-piece items.

**Out of scope:**
- Context-aware portion sizing (vaso de vino vs vaso de agua) — defer.
- Frontend/bot display logic changes — the CSV fix alone will flow through.
- `vasito` (F-MORPH diminutive container).

### Approach

**Change 1 — PORTION_RULES additions in `packages/api/src/estimation/portionSizing.ts`:**

```ts
{ patterns: ['copa de cava'],          term: 'copa cava',    gramsMin: 100, gramsMax: 150, description: 'Copa de cava (100-150 ml)' },
{ patterns: ['copa de vino', 'copita de vino'], term: 'copa vino', gramsMin: 120, gramsMax: 150, description: 'Copa de vino estándar (120-150 ml)' },
{ patterns: ['copa'],                  term: 'copa',         gramsMin: 120, gramsMax: 150, description: 'Copa estándar (vino/cava)' },
{ patterns: ['tercio'],                term: 'tercio',       gramsMin: 330, gramsMax: 330, description: 'Tercio de cerveza (330 ml)' },
{ patterns: ['botellín'],              term: 'botellín',     gramsMin: 250, gramsMax: 250, description: 'Botellín de cerveza (250 ml)' },
{ patterns: ['botella'],               term: 'botella',      gramsMin: 330, gramsMax: 750, description: 'Botella estándar (330 ml cerveza / 750 ml vino)' },
{ patterns: ['vaso de agua'],          term: 'vaso agua',    gramsMin: 200, gramsMax: 250, description: 'Vaso de agua (200-250 ml)' },
{ patterns: ['vaso'],                  term: 'vaso',         gramsMin: 150, gramsMax: 200, description: 'Vaso estándar (150-200 ml)' },
```

Longest-first discipline: compound `copa de cava`, `copa de vino`, `copita de vino`, `vaso de agua` entries must come BEFORE bare `copa` / `vaso`. Follow existing PORTION_RULES convention (see `media ración`/`ración para compartir` example).

**Change 2 — CSV pieceName plurals:**

```csv
# Before            After
croqueta         → croquetas
gamba            → gambas
aceituna         → aceitunas
boquerón         → boquerones
```

Only change plurals for items where `pieces > 1` (i.e., when the grams represent multiple units). Items with `pieces = 1` (e.g., pintxo = 1 croqueta) should stay singular — but actually the CSV stores pieceName as a TYPE label (what ONE piece is called), so singular is arguably correct for the unit. Decision: since user feedback says display shows "4 croqueta" (ungrammatical), the display layer should pluralize based on pieces count. Either:
- (A) Fix in CSV (current scope — simpler)
- (B) Fix in display logic — requires bot + web changes (out of scope)

Going with (A): change the CSV to plurals, accept the minor inconsistency that `pieceName=croquetas` is shown for ALL portions (pintxo=1 piece also shows "croquetas"). Downstream display should either show "1 croqueta" or "1 croquetas" — the latter is grammatically wrong but a smaller UX issue than "4 croqueta". A future ticket can improve pluralization logic.

**Alternative decision:** Only pluralize when `pieces > 1` (e.g., pintxo keeps `croqueta`, tapa/media_racion/racion use `croquetas`). This preserves grammatical correctness at both ends.

**Final decision:** Alternative — pluralize based on pieces count. Cleaner.

### API Changes

None.

### Data Model Changes

CSV-only. Migration: re-run seed after deploy (standard process, see `docs/tickets/BUG-PROD-009-portion-csv-dishid-mapping.md` for prior CSV rollout pattern).

### UI Changes

None directly. Bot/web display will automatically show plurals when CSV is re-seeded.

### Edge Cases & Error Handling

1. **F-MORPH `vasito` vs F-DRINK `vaso`** — boundary: F-MORPH CONTAINER_PATTERNS strips `vasito de X` (diminutive). F-DRINK's `vaso` PORTION_RULE matches `vaso` or `vaso de agua`. They don't overlap — `vasito` is a container (not a drink portion measure); `vaso` is a drink portion.
2. **`vaso de vino` vs `copa de vino`** — both are ~150ml. The compound `vaso` matches `/\bvaso\b/` (word boundary), so `"un vaso de vino tinto"` matches `vaso` (150-200 ml). Acceptable.
3. **Pre-seed vs post-seed** — if the CSV change lands but no re-seed happens, pieceNames in DB remain singular. Include a note in the ticket's Completion Log/follow-up about re-seed.
4. **Order in PORTION_RULES** — put compounds BEFORE singletons. Existing convention at lines 41-54 demonstrates this.

---

## Implementation Plan

### Architecture Decision

Option (A) from Spec: pluralize pieceName when `pieces > 1` in CSV (not a blanket rename). Preserves grammatical correctness.

For PORTION_RULES: extend the array with drink-specific rules in longest-first order. No new function needed — existing `detectPortionTerm` already iterates rules in order.

### Files to Modify

- `packages/api/src/estimation/portionSizing.ts` — add 8 new portion rules (copa de cava, copa de vino, copita de vino, copa, tercio, botellín, botella, vaso de agua, vaso). Ordered longest-first.
- `packages/api/prisma/seed-data/standard-portions.csv` — pluralize pieceName where pieces > 1 (tapa/media_racion/racion for croqueta→croquetas, gamba→gambas, aceituna→aceitunas, boquerón→boquerones).

### Files NOT Modified

- `entityExtractor.ts` (already handled F-MORPH/F-NLP/F-COUNT; drinks go through PORTION_RULES not F042 modifiers).
- Bot / web formatters.

### Test Matrix

| AC | Test | File |
|----|------|------|
| AC1 | `detectPortionTerm('un tercio de cerveza')` → `{ term: 'tercio', gramsMin: 330, gramsMax: 330 }` | `f085.portionSizing.unit.test.ts` (extend) |
| AC2 | `detectPortionTerm('un vaso de vino tinto')` → `{ term: 'vaso', gramsMin: 150, gramsMax: 200 }` | same |
| AC3 | `detectPortionTerm('una botella de vino tinto')` → `{ term: 'botella', gramsMin: 330, gramsMax: 750 }` | same |
| AC4 | `detectPortionTerm('una copa de vino tinto')` → `{ term: 'copa vino', ... }` | same |
| AC5 | `detectPortionTerm('una copa de cava')` → `{ term: 'copa cava', ... }` | same |
| AC6 | `detectPortionTerm('un vaso de agua')` → `{ term: 'vaso agua', gramsMin: 200, gramsMax: 250 }` | same |
| AC7 | Longest-first: `'una copa de vino'` returns `copa vino` (not `copa`) | same |
| AC8 | Existing rules preserved (caña, pintxo, tapa, ración, etc.) | existing |
| AC9 | CSV regression: `pieces > 1` rows have plural pieceName | `f085.portionSizing.csv-integrity.test.ts` (existing — may need update) |

### TDD Steps

1. Add AC1-AC7 tests as failing (RED).
2. Add 8 new entries to PORTION_RULES (longest-first).
3. Confirm tests GREEN.
4. Update CSV pieceName plurals (croqueta→croquetas, gamba→gambas, aceituna→aceitunas, boquerón→boquerones) for `pieces > 1` rows.
5. Run full suite to catch any snapshot tests that may regress.
6. Lint + build clean.
7. Commit atomically.

### Notes

- `caña` already in PORTION_RULES (line 99-104) — no change.
- `copa` / `copita` — `copita` not added separately here; F-MORPH's DIMINUTIVE_MAP handles `copita → copa`.

---

## Acceptance Criteria

- [ ] AC1 — `"un tercio de cerveza"` resolves to PORTION_RULE `tercio` with 330ml
- [ ] AC2 — `"un vaso de vino tinto"` resolves to PORTION_RULE `vaso` with 150-200ml
- [ ] AC3 — `"una botella de vino tinto"` resolves to PORTION_RULE `botella`
- [ ] AC4 — `"una copa de vino tinto"` resolves to compound PORTION_RULE `copa vino` (longest-first)
- [ ] AC5 — `"una copa de cava"` resolves to compound PORTION_RULE `copa cava`
- [ ] AC6 — `"un vaso de agua"` resolves to compound `vaso agua`
- [ ] AC7 — Longest-first invariant verified (compound wins over bare)
- [ ] AC8 — Existing PORTION_RULES behavior unchanged (caña, pintxo, tapa, ración, media ración, bocadillo, plato, montadito)
- [ ] AC9 — CSV pieceName pluralized where pieces > 1 (croquetas, gambas, aceitunas, boquerones)
- [ ] Unit tests for AC1–AC9 added (TDD)
- [ ] `npm test --workspace=@foodxplorer/api` all green
- [ ] `npm run lint --workspace=@foodxplorer/api` → 0 errors
- [ ] `npm run build` → green

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] No regressions
- [ ] CSV follows established format (RFC 4180 via existing parseCsvString)
- [ ] Seed re-run noted as follow-up (manual, post-merge)
- [ ] Lint/build clean

---

## Workflow Checklist

- [x] Step 0: Spec written (this file — Simple tier, plan written inline)
- [ ] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 2: Plan (Simple — inline in ticket)
- [ ] Step 3: TDD implementation
- [ ] Step 4: Quality gates
- [ ] Step 5: PR + code review + QA
- [ ] Step 6: Ticket + tracker finalized

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-21 | Ticket created | Simple tier: plan inline. QA battery Category 3 (3 NULLs) + CSV cosmetic |

---

## Merge Checklist Evidence

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | |
| 1. Mark all items | [ ] | |
| 2. Verify product tracker | [ ] | |
| 3. Update key_facts.md | [ ] | |
| 4. Update decisions.md | [ ] | |
| 5. Commit documentation | [ ] | |
| 6. Verify clean working tree | [ ] | |
| 7. Verify branch up to date | [ ] | |

---

*Ticket created: 2026-04-21 — last ticket of QA Improvement Sprint (pm-session pm-qai)*
