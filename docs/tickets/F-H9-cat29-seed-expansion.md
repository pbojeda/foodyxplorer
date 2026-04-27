# F-H9: Cat 29 Seed Expansion — Date/Time/Context-Wrapped Spanish Dishes

**Feature:** F-H9 | **Type:** Backend-Feature (data) | **Priority:** High
**Status:** Planning | **Branch:** feature/F-H9-cat29-seed-expansion
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-27 | **Dependencies:** F-H6 (DONE), F-H7 (DONE), F-H8 (DONE)

---

## Spec

### Description

Round-3 expansion of the Spanish dish catalog to resolve the 11 NULL clusters in QA battery dev
Category 29 (Fecha/Hora/Contexto wrappers — temporal and contextual query framing, e.g.
"esta noche quiero…", "para cenar…", "a mediodía suelo tomar…").

**Context:** F-H7 Phase-1 (P1) and Phase-2 (P2) NLP wrappers strip temporal/contextual prefixes
correctly, leaving a clean residual dish query. However, 11 stripped queries still return NULL
because the catalog has no atom (or no alias) for the residual dish. F-H9 fixes this data gap.
The NLP layer itself is NOT touched in this ticket.

**Scope:** QA battery dev run 2026-04-27 13:06 UTC (`/tmp/qa-dev-post-fH8-20260427-1306.txt`),
Cat 29 verified queries. Two queries are explicitly out of scope:
- Q635 `tostadas con aguacate y huevo` → routes to `intent=menu_estimation` (H5-B territory).
- Q649 `queso fresco con membrillo` → false positive `CROISSANT CON QUESO FRESC` (L3 threshold
  tuning, separate ticket F-H10).

The 11 addressable queries resolve via two mechanisms:

**A. New atoms (10 cases):** Dishes absent from the catalog entirely (confirmed by empirical grep
on `spanish-dishes.json` 2026-04-27). Includes Tortilla francesa (no existing atom — previous
assumption was wrong) and Brownie (no existing atom — same finding).

| externalId | dishId hex | Dish | Required alias | Stripped query |
|------------|-----------|------|----------------|----------------|
| CE-308 | 0x134 | Salmón con verduras al horno | — | `salmón con verduras al horno` |
| CE-309 | 0x135 | Nachos con queso | — | `nachos con queso` |
| CE-310 | 0x136 | Noodles con pollo y verduras | — | `noodles con pollo y verduras` |
| CE-311 | 0x137 | Yogur con granola | — | `yogur con granola` |
| CE-312 | 0x138 | Barrita energética de frutos secos | — | `barrita energética de frutos secos` |
| CE-313 | 0x139 | Bocadillo de pavo con queso | `"bocata de pavo con queso"` | `bocata de pavo con queso` |
| CE-314 | 0x13A | Arroz con atún y maíz | — | `arroz con atún y maíz` |
| CE-315 | 0x13B | Empanadilla de carne | — | `empanadilla de carne` |
| CE-316 | 0x13C | Tortilla francesa | `"tortilla francesa con champiñones"` | `tortilla francesa con champiñones` |
| CE-317 | 0x13D | Brownie | `"porción de brownie"` | `porción de brownie` (H7-P1 ARTICLE_PATTERN residual) |

> CE-313 requires alias `"bocata de pavo con queso"` because the stripped query is the slang form;
> FTS on nameEs `"Bocadillo de pavo con queso"` alone would not match. Precedent: CE-151 Bocadillo
> de jamón serrano carries alias `"bocata de jamón"`.
>
> CE-317 alias `"porción de brownie"` resolves the H7-P1 ARTICLE_PATTERN edge where
> `"una porción de"` is not fully stripped. This is a data fix, not an NLP fix; no NLP code
> changes in this ticket.

**B. Alias addition on existing atom (1 case):** Dish exists; alias gap prevents resolution.

| externalId | dishId | Existing atom | Missing alias | Stripped query |
|------------|--------|---------------|---------------|----------------|
| CE-094 | `00000000-0000-e073-0007-00000000005e` | Migas | `"migas con huevo"` | `migas con huevo` |

**Net additions after F-H9:**
- Baseline at spec time: **307 dishes** (47 BEDCA + 260 recipe) — key_facts.md L95.
- Expected after F-H9: **317 dishes** (47 BEDCA + 270 recipe) — 10 new atoms, all deterministic.

**Predicted QA impact:** +11 OK deterministic on Cat 29. All 11 queries (Q631, Q632, Q637, Q638,
Q639, Q640, Q643, Q644, Q645, Q646, Q650) resolve deterministically via seed data alone. Q638
(`noodles con pollo y verduras`) is deterministic: once CE-310 exists in the catalog,
`level1Lookup(db, "noodles con pollo y verduras", {})` returns CE-310 at H5-B Guard 2, which
causes H5-B to return null and routes the query to single-dish estimation — no conditional branch.
Q635 and Q649 remain excluded from this count.

The changes are pure data + tests + docs — no schema migration, no API surface change, no NLP
code changes.

---

### API Changes

None. Seed data only.

---

### Data Model Changes

No schema changes. All additions conform to the existing `Dish`, `DishNutrient`, and
`StandardPortion` tables and the validator invariants established by `validateSpanishDishes.ts`.

- **`packages/api/prisma/seed-data/spanish-dishes.json`**:
  - +10 new entries: externalIds `CE-308` through `CE-317`, dishIds `0x134` through `0x13D`,
    nutrientIds parallel (same hex offset).
  - +1 alias addition on existing entry: CE-094 Migas — add `"migas con huevo"`.
  - Required aliases on new atoms: CE-313 `"bocata de pavo con queso"`, CE-316
    `"tortilla francesa con champiñones"`, CE-317 `"porción de brownie"`.
- **`packages/api/prisma/seed-data/standard-portions.csv`**: +~30–40 rows across the 10 new
  dishIds (3–4 portion rows per dish following F-H4/F-H6 pattern: `pintxo | tapa | media_racion
  | racion`). No new portion rows for the alias-only addition on CE-094 Migas.
- **`packages/api/src/__tests__/f073.seedPhaseSpanishDishes.edge-cases.test.ts`**: hardcoded
  `307` count assertions updated to `317`. Empirically verified occurrences:
  - Line 321: `it` title `'upserts exactly 307 dishes'` → `'upserts exactly 317 dishes'`
  - Line 328: `toHaveLength(307)` → `toHaveLength(317)`
  - Line 331: `it` title `'upserts exactly 307 DishNutrients'` → `'upserts exactly 317 DishNutrients'`
  - Line 338: `toHaveLength(307)` → `toHaveLength(317)`
  - Comments at lines 324 and 334 (update if they reference `307`).
- **`packages/api/src/__tests__/f114.newDishes.unit.test.ts`**: hardcoded count assertions
  updated from `307` to `317`. Empirically verified occurrences:
  - Line 132: comment referencing `307`
  - Line 135: comment referencing `307`
  - Line 137: `describe` title referencing `307`
  - Line 138: `it` title referencing `307`
  - Line 140: `toHaveLength(307)` → `toHaveLength(317)`
- **`packages/api/src/__tests__/fH6.seedExpansionRound2.edge-cases.test.ts`**: count assertions
  and H6-EC-11 structural fix. See Edge Case §8 for full detail. Summary:
  - L8, L117, L118, L124, L125: `307` → `317` (comment + describe/it titles + toHaveLength).
  - L427: `dishes.slice(-28)` → `dishes.slice(-38, -10)` (H6-EC-11 structural fix).
  - L426 it title updated to reflect new semantic (see Edge Case §8).
- **`docs/project_notes/key_facts.md` L95**: `307 dishes (47 BEDCA + 260 recipe)` updated to
  `317 dishes (47 BEDCA + 270 recipe)` and import-tag suffix updated to include `F-H9`.

---

### UI Changes

None. Data propagates via the existing estimation pipeline.

---

### Edge Cases & Error Handling

1. **Source/confidence/estimationMethod triple enforcement**: all 10 new dishes must use
   `source=recipe + confidenceLevel=medium + estimationMethod=ingredients`. The validator
   (`validateSpanishDishes.ts`) enforces this triple. No BEDCA entries expected in this batch.

2. **ADR-019 alias scope — ZERO bare family-term aliases**: per `docs/project_notes/decisions.md`
   ADR-019, bare short-form category terms MUST NOT be added as aliases on any single atom.
   Aliases in this batch are restricted to:
   (a) multi-word query-specific phrases from the audited Cat 29 NULLs,
   (b) orthographic/transliteration variants of the dish's nameEs,
   (c) singular/plural normalisation.
   Examples of FORBIDDEN bare aliases in this batch: `"salmón"`, `"noodles"`, `"yogur"`,
   `"barrita"`, `"bocadillo"`, `"empanadilla"`, `"arroz con atún"`, `"migas"`, `"tortilla"`,
   `"brownie"`.

3. **HOMOGRAPH_ALLOW_LIST** (F-H4-B precedent): run `validateSpanishDishes.ts` (via
   `npm test -w @foodxplorer/api -- fH4B.validateSpanishDishes.uniqueness`) after each commit
   batch. If a new alias collides with an existing alias or nameEs, either qualify the alias
   further (preferred) or add a new entry to the `HOMOGRAPH_ALLOW_LIST` in
   `packages/api/src/scripts/validateSpanishDishes.ts`. No new allow-list entries are
   anticipated for this batch, but must be verified.

4. **Duplicate pre-check (mandatory)**: before adding any atom, grep `spanish-dishes.json`
   (nameEs + aliases, normalised lowercase) to confirm the dish is absent. Key lookups:
   - `"salmón con verduras"` — not present (CE-216 `Salmón a la plancha` is a different atom).
   - `"nachos"` — not present (confirmed pre-analysis).
   - `"noodles"` — not present.
   - `"yogur con granola"` — not present (CE-172 `Yogur natural` is a different atom).
   - `"barrita energética"` — not present.
   - `"bocadillo de pavo"` — not present (CE-151 `Bocadillo de jamón serrano` exists but is a
     different variant; verify externalId and confirm no overlap).
   - `"arroz con atún"` — not present (CE-229 `Arroz blanco`, CE-133 `Arroz a banda`, etc. —
     none cover this compound).
   - `"empanadilla de carne"` — not present (CE-300 `Gyozas` alias `"empanadillas japonesas"`
     exists; the new CE-315 `Empanadilla de carne` is a Spanish-style variant — nutritionally
     distinct; confirm no alias collision).
   - `"migas con huevo"` — not currently an alias on Migas (CE-094, confirmed by grep).
   - `"tortilla francesa con champiñones"` — not applicable as alias; Tortilla francesa has no
     existing atom (confirmed by grep). CE-316 is a new atom with this alias.
   - `"porción de brownie"` — Brownie has no existing atom (confirmed by grep). CE-317 is a
     new atom; the alias resolves the H7-P1 ARTICLE_PATTERN residual deterministically.

5. **`noodles con pollo y verduras` — H5-B Guard 2 verified protection (SAFETY NOTE)**: the `y`
   token in the stripped query could superficially trigger H5-B implicit multi-item detection.
   This is NOT a risk in practice. Empirically verified at
   `packages/api/src/conversation/implicitMultiItemDetector.ts:122`: H5-B Guard 2 calls
   `level1Lookup(db, text, {})` on the whole text before any splitting. Once CE-310
   `Noodles con pollo y verduras` exists in the catalog, Guard 2 returns CE-310 and H5-B returns
   null deterministically — Q638 routes to single-dish estimation. No conditional behavior; no
   action required in the PR body unless the empirical post-deploy QA contradicts this analysis.

6. **Portion sizing rule**: use standard 3–4 portion variants per F-H4/F-H6 pattern. Valid
   `term` enum: `pintxo | tapa | media_racion | racion`. For dishes that are typically consumed
   as single-serve snacks (barrita energética, yogur con granola, brownie), a `racion` row at
   realistic single-serve grams is the primary portion; add `media_racion` for smaller servings.
   For composed plates (salmón con verduras al horno, noodles con pollo y verduras), follow
   standard main-course sizing (racion ~400–500 g). For bocadillo and empanadilla, follow F-H6
   sandwich/snack sizing. For tortilla francesa, follow F-H6 omelette sizing.

7. **Rollback**: seed uses `upsert`; a `git revert` alone does not delete DB rows. The PR body
   must include a DELETE SQL block for all new dishIds (CE-308..CE-317), following the same
   pattern as F-H4 PR #196 and F-H6.

8. **Hardcoded count update — empirically verified occurrences across 3 test files**: CI will
   be intentionally RED on intermediate data commits and GREEN only after the final test-update
   commit. All `307` → `317`:
   - `packages/api/src/__tests__/f073.seedPhaseSpanishDishes.edge-cases.test.ts`:
     lines 321 (it title), 328 (toHaveLength), 331 (it title), 338 (toHaveLength), plus
     comments at 324 and 334.
   - `packages/api/src/__tests__/f114.newDishes.unit.test.ts`:
     lines 132 (comment), 135 (comment), 137 (describe title), 138 (it title), 140 (toHaveLength).
   - `packages/api/src/__tests__/fH6.seedExpansionRound2.edge-cases.test.ts`:
     - L8 comment `"across all 307 entries"` → `"across all 317 entries"`.
     - L117 describe title `'H6-EC-1: no duplicate name/nameEs/alias across 307 entries'` → `317`.
     - L118 it title `'validateSpanishDishes returns valid: true with 0 errors on the full 307-entry dataset'` → `317`.
     - L124 it title `'total dish count is 307'` → `317`.
     - L125 `expect(dishes).toHaveLength(307)` → `toHaveLength(317)`.
     - **H6-EC-11 (L425-430) — requires structural change, not a simple count swap**:
       Current assertion `dishes.slice(-28)` asserts the *last* 28 entries are CE-280..CE-307.
       After F-H9 appends CE-308..CE-317 (10 entries), the last 28 are no longer CE-280..CE-307.
       Required fix: change `dishes.slice(-28)` to `dishes.slice(-38, -10)` — this selects
       the 28 entries at the F-H6 batch position (entries -38 through -11), which remain
       CE-280..CE-307 after the 10 new atoms are appended. The describe/it titles should also
       reflect the semantic: `'the F-H6 batch (CE-280..CE-307) remains in monotonic order at its
       appended position'`. This is minimally invasive and preserves the original intent of
       verifying CE-280..CE-307 are still in monotonic order at the position they were inserted.
       The `expected` array generation (Array.from length 28 from CE-280) does not need to change.

   > CE-280..CE-307 references in H6-EC-2 through H6-EC-10 and H6-EC-12 are F-H6 batch-specific
   > tests (they filter `isNew` or use hardcoded externalIds for F-H6 atoms). These must NOT be
   > changed — they test F-H6 data specifically and remain valid regardless of F-H9 additions.

9. **kcal sanity ranges for new atoms (per 100 g, recipe source)**: not enforced by the
   validator but serve as a cross-check. Values outside these ranges require a documented
   justification in the PR.

   | Dish | Acceptable kcal/100 g range | Reference basis |
   |------|-----------------------------|-----------------|
   | Salmón con verduras al horno | 100–160 | BEDCA salmón (~180) + veg dilution |
   | Nachos con queso | 380–460 | USDA SR tortilla chips + cheddar |
   | Noodles con pollo y verduras | 100–150 | USDA SR noodles + chicken + veg |
   | Yogur con granola | 140–200 | BEDCA yogur + granola recipe |
   | Barrita energética de frutos secos | 380–470 | USDA SR nut/seed bars |
   | Bocadillo de pavo con queso | 220–280 | BEDCA pan + pavo + queso recipe |
   | Arroz con atún y maíz | 130–180 | BEDCA arroz + atún + maíz |
   | Empanadilla de carne | 240–300 | recipe (fried/baked dough + carne picada) |
   | Tortilla francesa | 150–210 | BEDCA eggs + oil (no potato) |
   | Brownie | 380–460 | recipe (chocolate, butter, sugar, flour) |

10. **Identifier continuity**: CE-308 is the next available externalId after F-H6's CE-307.
    dishId hex sequence continues from `0x134` (CE-308) through `0x13D` (CE-317).
    UUID pattern (all hex digits MUST be lowercase — validator regex is `^[0-9a-f]{...}$` strictly):
    - dishId:    `00000000-0000-e073-0007-000000000134` … `00000000-0000-e073-0007-00000000013d`
    - nutrientId: `00000000-0000-e073-0008-000000000134` … `00000000-0000-e073-0008-00000000013d`

    > Note: hex shorthands `0x134..0x13D` in table headers and prose above are informational
    > references for human readability. JSON literal UUID strings must use lowercase hex only
    > (e.g. `13d`, not `13D`) per the validator regex at
    > `packages/api/src/scripts/validateSpanishDishes.ts:19`.

---

### Existing Code to Reuse

| Entity | File | Role |
|--------|------|------|
| `spanish-dishes.json` | `packages/api/prisma/seed-data/spanish-dishes.json` | Append 10 new entries (CE-308..CE-317) + alias addition on CE-094 Migas |
| `standard-portions.csv` | `packages/api/prisma/seed-data/standard-portions.csv` | Append ~30–40 portion rows for the 10 new dishIds |
| `validateSpanishDishes.ts` | `packages/api/src/scripts/validateSpanishDishes.ts` | Run read-only via test suite after each commit batch; extend `HOMOGRAPH_ALLOW_LIST` only if a collision is detected |
| `fH4B.validateSpanishDishes.uniqueness.test.ts` | `packages/api/src/__tests__/fH4B.validateSpanishDishes.uniqueness.test.ts` | Real-JSON integration test — loads `spanish-dishes.json` dynamically; no modification required; automatically validates the expanded dataset |
| `fH6.seedExpansionRound2.edge-cases.test.ts` | `packages/api/src/__tests__/fH6.seedExpansionRound2.edge-cases.test.ts` | Requires count updates (L8, L117, L118, L124, L125: `307`→`317`) AND H6-EC-11 structural fix (L427: `slice(-28)` → `slice(-38, -10)`). F-H6 batch-specific tests (H6-EC-2..H6-EC-10, H6-EC-12) must NOT be modified. |
| `fH9.cat29.unit.test.ts` (new) | `packages/api/src/__tests__/fH9.cat29.unit.test.ts` | NEW — table-driven level1Lookup simulation for all 11 deterministic Cat 29 queries (AC-12). Pattern follows H6-EC-12 in fH6.seedExpansionRound2.edge-cases.test.ts L437-455. Q638 (`noodles con pollo y verduras` → CE-310) included as the 11th case — deterministic per H5-B Guard 2. |
| `seedPhaseSpanishDishes.ts` | `packages/api/src/scripts/seedPhaseSpanishDishes.ts` | Unchanged — reads JSON at runtime; new entries auto-picked up |
| `seedStandardPortionCsv.ts` | `packages/api/src/scripts/seedStandardPortionCsv.ts` | Unchanged — validates `term ∈ {pintxo, tapa, media_racion, racion}` and `pieces`/`pieceName` pairing |
| `SpanishDishEntry` type | `packages/api/src/scripts/spanishDishesTypes.ts` | No changes; new entries conform to existing schema |

**Verification commands (to be run by the planner and developer):**

```bash
# Run uniqueness/integrity test after each commit batch (fast, CI-equivalent)
npm test -w @foodxplorer/api -- fH4B.validateSpanishDishes.uniqueness

# Confirm total entry count in the JSON catalog
grep -c '"externalId"' packages/api/prisma/seed-data/spanish-dishes.json

# Run full API test suite
npm test --workspace=@foodxplorer/api
```

---

## Implementation Plan

_Pending — to be generated by the planner agent in Step 2._

---

## Acceptance Criteria

**Seed integrity**
- [ ] AC-1: All 10 new atoms (CE-308..CE-317) are present in `spanish-dishes.json` with
  `source=recipe`, `confidenceLevel=medium`, `estimationMethod=ingredients` — validator enforces
  this triple; `validateSpanishDishes.ts` (via uniqueness test) reports `valid: true`.
- [ ] AC-2: `standard-portions.csv` contains 3–4 portion rows per new atom (terms:
  `pintxo | tapa | media_racion | racion`); no `piece` term used; `pieces`/`pieceName` columns
  populated where applicable per F-H6 §8 pattern.
- [ ] AC-3: externalIds are monotonically sequential (`CE-308` through `CE-317`); dishId UUIDs
  follow the `0x134..0x13D` hex scheme; no gaps or duplicates.

**Alias rules**
- [ ] AC-4: Required aliases are present on their respective new atoms: CE-313 carries
  `"bocata de pavo con queso"`, CE-316 carries `"tortilla francesa con champiñones"`,
  CE-317 carries `"porción de brownie"`. Alias `"migas con huevo"` is added to the existing
  CE-094 Migas atom.
- [ ] AC-5: Zero bare family-term aliases added in this batch (ADR-019 enforced). Forbidden
  bare terms include but are not limited to: `"salmón"`, `"noodles"`, `"yogur"`, `"barrita"`,
  `"bocadillo"`, `"empanadilla"`, `"migas"`, `"tortilla"`, `"brownie"`.

**Validator and uniqueness**
- [ ] AC-6: `fH4B.validateSpanishDishes.uniqueness.test.ts` passes against the post-F-H9
  `spanish-dishes.json` (real-JSON integration test — no mock). If a new alias collision is
  detected, it is resolved by qualifying the alias further (preferred) or by adding a justified
  entry to `HOMOGRAPH_ALLOW_LIST`; no collision is left unresolved.

**Test coverage**
- [ ] AC-7: `f073.seedPhaseSpanishDishes.edge-cases.test.ts` — all `307` occurrences updated
  to `317` (it titles at lines 321, 331; toHaveLength at lines 328, 338; comments at 324, 334).
- [ ] AC-8: `f114.newDishes.unit.test.ts` — all `307` occurrences updated to `317`
  (comments at 132, 135; describe title at 137; it title at 138; toHaveLength at 140).
- [ ] AC-9: Full API test suite passes (`npm test --workspace=@foodxplorer/api`).

**Automated Cat 29 resolution test**
- [ ] AC-12: `packages/api/src/__tests__/fH9.cat29.unit.test.ts` exists and passes. This file
  contains a table-driven level1Lookup simulation (pattern: H6-EC-12 at
  `fH6.seedExpansionRound2.edge-cases.test.ts` L437-455) exercising all 11 deterministic
  stripped queries against the new seed entries. Each test case asserts `query → expectedEid`:

  | Stripped query | Expected externalId |
  |----------------|---------------------|
  | `salmón con verduras al horno` | CE-308 |
  | `migas con huevo` | CE-094 |
  | `nachos con queso` | CE-309 |
  | `noodles con pollo y verduras` | CE-310 |
  | `yogur con granola` | CE-311 |
  | `barrita energética de frutos secos` | CE-312 |
  | `bocata de pavo con queso` | CE-313 |
  | `arroz con atún y maíz` | CE-314 |
  | `empanadilla de carne` | CE-315 |
  | `tortilla francesa con champiñones` | CE-316 |
  | `porción de brownie` | CE-317 |

  Q638 (`noodles con pollo y verduras` → CE-310) is included as the 11th deterministic case.
  H5-B Guard 2 (`level1Lookup` whole-text check at `implicitMultiItemDetector.ts:122`) returns
  CE-310 once the atom exists and prevents any multi-item split — behavior is deterministic, not
  conditional (Edge Case §5). AC-12 failing on any of these 11 queries blocks merge.

**Predicted QA delta (release-validation, observational)**
- [ ] AC-10: All 11 addressable Cat 29 queries (Q631, Q632, Q637, Q638, Q639, Q640, Q643, Q644,
  Q645, Q646, Q650) return a non-NULL result in the next QA battery dev run after seed
  deployment. Q635 and Q649 remain excluded. Failure of any of these 11 is a merge blocker.
  Q638 (`noodles con pollo y verduras`) is deterministic via H5-B Guard 2 — see Edge Case §5.

**Documentation**
- [ ] AC-11: `docs/project_notes/key_facts.md` L95 updated: dish count to `317 dishes
  (47 BEDCA + 270 recipe)`, recipe count, and import-tag suffix include `F-H9`.

---

## Definition of Done

- [ ] DoD-1: All 11 Acceptance Criteria checked (AC-1 through AC-12, where AC-10 is a single merged criterion).
- [ ] DoD-2: `npm test --workspace=@foodxplorer/api` exits green (CI equivalent); no regressions
  in any other workspace.
- [ ] DoD-3: `fH4B.validateSpanishDishes.uniqueness` test passes on the final dataset.
- [ ] DoD-4: No lint errors (`npm run lint --workspace=@foodxplorer/api` clean).
- [ ] DoD-5: `docs/project_notes/key_facts.md` L95 updated with correct count (`317`) and tag.
- [ ] DoD-6: PR body includes: (a) DELETE SQL rollback block for CE-308..CE-317 dishIds,
  (b) Q638 confirmation note citing Guard 2 deterministic pass (Edge Case §5).
- [ ] DoD-7: Product tracker and ticket status updated to `Done`; branch deleted post-merge.

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed — `## Spec`, `## Acceptance Criteria`, `## Definition of Done` filled; `/review-spec` cross-model review completed (Standard complexity — mandatory). 3R Codex (REVISE→REVISE→APPROVED), 2R Gemini (APPROVED both).
- [x] Step 1: Branch `feature/F-H9-cat29-seed-expansion` created off `develop` @ `6128115`; ticket status → `Planning`; product tracker Active Session updated.
- [ ] Step 2: `backend-planner` executed — Implementation Plan generated and approved; commit strategy (data commits 1–N-1 intentionally red, final count/test commit green) confirmed
- [ ] Step 3: `backend-developer` executed with TDD — data additions in `spanish-dishes.json` + `standard-portions.csv`; count assertions updated across all 3 test files (f073, f114, fH6 including H6-EC-11 structural fix); new `fH9.cat29.unit.test.ts` created (AC-12); validator passes
- [ ] Step 4: `production-code-validator` executed — all quality gates pass (lint, build, tests, validator)
- [ ] Step 5: `code-review-specialist` executed — findings triaged and logged in Completion Log
- [ ] Step 5: `qa-engineer` executed — QA battery dev re-run confirms all 11 addressable queries OK on Cat 29; delta documented
- [ ] Step 6: Ticket Completion Log updated with metrics; Merge Checklist Evidence filled; branch deleted post-merge; product tracker updated to `Done`

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-27 | Step 0 — Spec | spec-creator agent invoked. Initial draft + 2 SendMessage corrections (empirical: Brownie + Tortilla francesa do NOT exist in catalog; re-scoped 8 atoms+2 aliases → 10 atoms+1 alias on Migas, count 307→317; UUID lowercase fix; AC structure split 10a/10b; AC-12 automated repo-side test added). Self-review: clean. |
| 2026-04-27 | Step 0 — /review-spec R1 | Gemini APPROVED. Codex REVISE — 3 IMPORTANT (fH6 test missing, UUID case, AC-10 inconsistent) + 1 SUGGESTION (AC-10 not automatable → AC-12 repo test). All addressed in R2. |
| 2026-04-27 | Step 0 — /review-spec R2 | Gemini APPROVED. Codex REVISE — 2 IMPORTANT (Q638 deterministic per H5-B Guard 2 not conditional; CE-??? placeholders → CE-151). All addressed in R3. |
| 2026-04-27 | Step 0 — /review-spec R3 | Codex APPROVED (Gemini already APPROVED twice). Spec ready for planning. |

<!-- After code review, add a row documenting which findings were accepted/rejected:
| YYYY-MM-DD | Review findings | Accepted: C1-C3, H1-H2. Rejected: M5 (reason). Systemic: C4 logged in bugs.md |
This creates a feedback loop for improving future reviews. -->

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
| 7. Verify branch up to date | [ ] | merge-base: up to date / merged origin/<branch> |

---

*Ticket created: 2026-04-27*
