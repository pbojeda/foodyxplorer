# F-H9: Cat 29 Seed Expansion — Date/Time/Context-Wrapped Spanish Dishes

**Feature:** F-H9 | **Type:** Backend-Feature (data) | **Priority:** High
**Status:** Done | **Branch:** feature/F-H9-cat29-seed-expansion (deleted post-merge)
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

### Approach

Single feature branch `feature/F-H9-cat29-seed-expansion` (already created off `origin/develop @ 6128115`), following the F-H4/F-H6 multi-batch TDD pattern. CI is intentionally RED on all data-only commits (Batches A–D) because `toHaveLength(307)` assertions in three test files remain unchanged. CI goes GREEN at the single final commit (Phase 4) that updates all count assertions, applies the H6-EC-11 structural fix, and creates `key_facts.md` L95. `fH9.cat29.unit.test.ts` (Phase 3) is GREEN the moment it is created because it targets the newly-added atoms.

---

### Existing Code to Reuse

| Entity | File | Role |
|--------|------|------|
| `spanish-dishes.json` | `packages/api/prisma/seed-data/spanish-dishes.json` | Append 10 new entries (CE-308..CE-317); add alias `"migas con huevo"` on CE-094 |
| `standard-portions.csv` | `packages/api/prisma/seed-data/standard-portions.csv` | Append ~30–40 portion rows for the 10 new dishIds (CE-308..CE-317); no rows for the alias-only CE-094 addition |
| `validateSpanishDishes.ts` | `packages/api/src/scripts/validateSpanishDishes.ts` | Run read-only via test suite after each batch; extend `HOMOGRAPH_ALLOW_LIST` only if a collision is detected (none anticipated) |
| `fH4B.validateSpanishDishes.uniqueness.test.ts` | `packages/api/src/__tests__/fH4B.validateSpanishDishes.uniqueness.test.ts` | Real-JSON integration test — loads `spanish-dishes.json` dynamically; no modification required; auto-validates expanded dataset |
| `fH6.seedExpansionRound2.edge-cases.test.ts` | `packages/api/src/__tests__/fH6.seedExpansionRound2.edge-cases.test.ts` | Requires count updates (L8, L117, L118, L124, L125: `307`→`317`) AND H6-EC-11 structural fix (L427: `slice(-28)` → `slice(-38, -10)`). H6-EC-2 through H6-EC-10 and H6-EC-12 are F-H6-specific and must NOT be changed |
| `f073.seedPhaseSpanishDishes.edge-cases.test.ts` | `packages/api/src/__tests__/f073.seedPhaseSpanishDishes.edge-cases.test.ts` | Count updates only: L321 it title, L324 comment, L328 `toHaveLength`, L331 it title, L334 comment, L338 `toHaveLength` — all `307`→`317` |
| `f114.newDishes.unit.test.ts` | `packages/api/src/__tests__/f114.newDishes.unit.test.ts` | Count updates only: L132 comment, L135 comment, L137 describe title, L138 it title, L140 `toHaveLength` — all `307`→`317` |
| `seedPhaseSpanishDishes.ts` | `packages/api/src/scripts/seedPhaseSpanishDishes.ts` | Unchanged — reads JSON at runtime; new entries auto-picked up |
| `seedStandardPortionCsv.ts` | `packages/api/src/scripts/seedStandardPortionCsv.ts` | Unchanged — validates `term ∈ {pintxo, tapa, media_racion, racion}` and `pieces`/`pieceName` pairing |
| `SpanishDishEntry` type | `packages/api/src/scripts/spanishDishesTypes.ts` | No changes; new entries conform to existing schema |

---

### Files to Create

| File | Purpose |
|------|---------|
| `packages/api/src/__tests__/fH9.cat29.unit.test.ts` | NEW — table-driven level1Lookup simulation for all 11 deterministic Cat 29 stripped queries (AC-12). Pattern mirrors H6-EC-12 in `fH6.seedExpansionRound2.edge-cases.test.ts` L438–461. Created in Phase 3; immediately GREEN. |

---

### Files to Modify

| File | Change | Phase/Commit |
|------|--------|--------------|
| `packages/api/prisma/seed-data/spanish-dishes.json` | +5 new entries CE-308..CE-312; alias `"migas con huevo"` on CE-094 | Batch A |
| `packages/api/prisma/seed-data/standard-portions.csv` | +portion rows for CE-308..CE-312 | Batch A |
| `packages/api/prisma/seed-data/spanish-dishes.json` | +3 new entries CE-313..CE-315 | Batch B |
| `packages/api/prisma/seed-data/standard-portions.csv` | +portion rows for CE-313..CE-315 | Batch B |
| `packages/api/prisma/seed-data/spanish-dishes.json` | +2 new entries CE-316..CE-317 | Batch C |
| `packages/api/prisma/seed-data/standard-portions.csv` | +portion rows for CE-316..CE-317 | Batch C |
| `packages/api/src/__tests__/f073.seedPhaseSpanishDishes.edge-cases.test.ts` | `307`→`317` at L321, L324, L328, L331, L334, L338 | Phase 4 |
| `packages/api/src/__tests__/f114.newDishes.unit.test.ts` | `307`→`317` at L132, L135, L137, L138, L140 | Phase 4 |
| `packages/api/src/__tests__/fH6.seedExpansionRound2.edge-cases.test.ts` | `307`→`317` at L8, L117, L118, L124, L125; H6-EC-11 fix L427 `slice(-28)`→`slice(-38, -10)`; L426 it title update | Phase 4 |
| `docs/project_notes/key_facts.md` | L95: `307 dishes (47 BEDCA + 260 recipe)` → `317 dishes (47 BEDCA + 270 recipe)`; tag suffix adds `F-H9` | Phase 4 |

---

### Implementation Order

#### Phase 1 — Pre-flight verification (no commits)

1. Confirm CE-307 is the current maximum externalId:
   `grep -c '"externalId"' packages/api/prisma/seed-data/spanish-dishes.json` — expected: 307.
2. Grep for each candidate dish to confirm it is absent (nameEs and likely alias forms, lowercase):
   - `"salmón con verduras"` — must NOT match any existing entry (CE-216 Salmón a la plancha is distinct).
   - `"nachos"` — must NOT match.
   - `"noodles"` — must NOT match.
   - `"yogur con granola"` — must NOT match (CE-172 Yogur natural is distinct).
   - `"barrita energética"` — must NOT match.
   - `"bocadillo de pavo"` — must NOT match (CE-151 Bocadillo de jamón serrano is distinct; confirm no overlap).
   - `"arroz con atún"` — must NOT match (CE-133, CE-229 etc. are distinct compounds; confirm).
   - `"empanadilla de carne"` — must NOT match; confirm `"empanadillas japonesas"` on CE-300 (Gyozas) will not collide with CE-315's aliases.
   - `"tortilla francesa"` — must NOT match any existing atom.
   - `"brownie"` — must NOT match any existing atom.
3. Confirm CE-094 Migas has alias `"migas extremeñas"` but NOT `"migas con huevo"` — so the addition is safe.
4. Confirm CE-151 Bocadillo de jamón serrano carries alias `"bocata de jamón"` — this is the precedent for CE-313's alias `"bocata de pavo con queso"`.
5. Confirm last UUID hex in `standard-portions.csv` ends with `...000000000133` (CE-307 last row) — verifying the tail of the CSV is correct before appending.
6. Note: CE-094's `portionGrams` is 200 and `category` is `"primeros"` — these will serve as the reference structure when adding the alias.
7. Empirically confirm the chosen `category` values exist in `spanish-dishes.json`. Confirmed valid: `desayunos`, `primeros`, `arroces`, `tapas`, `bocadillos`, `segundos`, `postres`. DO NOT use `"snacks"` or `"huevos"` — these categories do not exist in the catalog and will fail validation.

---

#### Phase 2 — Batch A (CE-308..CE-312 + alias on CE-094 Migas)

**Commit message:** `data(F-H9): add CE-308..CE-312 + migas con huevo alias (Batch A — CI intentionally red)`

**JSON additions** — append to the `dishes` array after CE-307:

| externalId | dishId UUID | nutrientId UUID | name / nameEs | aliases | category | portionGrams | kcal/100g target | Notes |
|------------|-------------|-----------------|---------------|---------|----------|--------------|-----------------|-------|
| CE-308 | `00000000-0000-e073-0007-000000000134` | `00000000-0000-e073-0008-000000000134` | Salmón con verduras al horno | `[]` | `"segundos"` | 350 | 100–160 | Baked salmon + veg; kcal diluted by veg weight |
| CE-309 | `00000000-0000-e073-0007-000000000135` | `00000000-0000-e073-0008-000000000135` | Nachos con queso | `[]` | `"tapas"` | 150 | 380–460 | USDA SR tortilla chips + cheddar |
| CE-310 | `00000000-0000-e073-0007-000000000136` | `00000000-0000-e073-0008-000000000136` | Noodles con pollo y verduras | `[]` | `"primeros"` | 400 | 100–150 | USDA SR noodles + chicken + veg; H5-B Guard 2 safe |
| CE-311 | `00000000-0000-e073-0007-000000000137` | `00000000-0000-e073-0008-000000000137` | Yogur con granola | `[]` | `"desayunos"` | 200 | 140–200 | BEDCA yogur + granola recipe |
| CE-312 | `00000000-0000-e073-0007-000000000138` | `00000000-0000-e073-0008-000000000138` | Barrita energética de frutos secos | `[]` | `"desayunos"` | 40 | 380–470 | USDA SR nut/seed bar; single-serve snack; `"snacks"` does not exist in catalog |

All 5 entries: `"source": "recipe"`, `"confidenceLevel": "medium"`, `"estimationMethod": "ingredients"`.

> **ADR-019 alias check**: no aliases are added on CE-308..CE-312 — their nameEs already match the stripped queries exactly. No bare terms (`"salmón"`, `"noodles"`, `"yogur"`, `"barrita"`) must be added.

**Alias addition on existing entry CE-094 Migas** — append `"migas con huevo"` to its `aliases` array:
- Current: `["migas extremeñas"]`
- After: `["migas extremeñas", "migas con huevo"]`

**standard-portions.csv additions** (append after CE-307 rows `...000000000133`):

> **MANDATORY**: every row must set `reviewed_by=pbojeda`. Rows with empty `reviewed_by` are silently skipped by the seeder.

| dishId suffix | term | grams | pieces | pieceName | confidence | notes |
|---------------|------|-------|--------|-----------|-----------|-------|
| `...000000000134` (CE-308) | `tapa` | 120 | | | medium | tapa salmón con verduras al horno |
| `...000000000134` | `media_racion` | 220 | | | medium | half racion salmón al horno |
| `...000000000134` | `racion` | 350 | | | medium | full racion; baked salmon + veg |
| `...000000000135` (CE-309) | `tapa` | 80 | | | medium | small nachos tapa |
| `...000000000135` | `media_racion` | 120 | | | medium | half nachos con queso |
| `...000000000135` | `racion` | 200 | | | medium | full nachos con queso; chips + cheese |
| `...000000000136` (CE-310) | `media_racion` | 250 | | | medium | half bowl noodles con pollo y verduras |
| `...000000000136` | `racion` | 400 | | | medium | full bowl; noodles + chicken + veg |
| `...000000000137` (CE-311) | `media_racion` | 100 | | | medium | small yogur con granola |
| `...000000000137` | `racion` | 200 | | | medium | standard yogur bowl con granola |
| `...000000000138` (CE-312) | `media_racion` | 20 | | | medium | half barrita energética |
| `...000000000138` | `racion` | 40 | | | medium | full barrita de frutos secos; single-serve |

> CE-311 and CE-312 are single-serve snacks — no `pintxo` or `tapa` rows needed; `media_racion` + `racion` suffice. CE-310 is a composed plate — no `tapa` form typical; `media_racion` + `racion` suffice.

**Post-batch verification:**
```bash
grep -c '"externalId"' packages/api/prisma/seed-data/spanish-dishes.json
# Expected: 312

npm test -w @foodxplorer/api -- fH4B.validateSpanishDishes.uniqueness
# Expected: valid: true, 0 errors. CI will be red (count assertions still say 307).
```

---

#### Phase 2 — Batch B (CE-313..CE-315)

**Commit message:** `data(F-H9): add CE-313..CE-315 — bocadillo/arroz/empanadilla (Batch B — CI intentionally red)`

**JSON additions** — append after CE-312:

| externalId | dishId UUID | nutrientId UUID | name / nameEs | aliases | category | portionGrams | kcal/100g target | Notes |
|------------|-------------|-----------------|---------------|---------|----------|--------------|-----------------|-------|
| CE-313 | `00000000-0000-e073-0007-000000000139` | `00000000-0000-e073-0008-000000000139` | Bocadillo de pavo con queso | `["bocata de pavo con queso"]` | `"bocadillos"` | 200 | 220–280 | Alias covers stripped query (slang form); precedent: CE-151 |
| CE-314 | `00000000-0000-e073-0007-00000000013a` | `00000000-0000-e073-0008-00000000013a` | Arroz con atún y maíz | `[]` | `"arroces"` | 300 | 130–180 | BEDCA arroz + atún + maíz; nameEs matches stripped query; `arroces` is the dedicated rice category |
| CE-315 | `00000000-0000-e073-0007-00000000013b` | `00000000-0000-e073-0008-00000000013b` | Empanadilla de carne | `[]` | `"tapas"` | 80 | 240–300 | Spanish-style fried/baked dough + carne picada; distinct from CE-300 Gyozas |

> **UUID case**: `13a` and `13b` must be lowercase. The validator regex (`^[0-9a-f]{...}$`) rejects uppercase.
> **CE-315 alias check**: CE-300 Gyozas carries alias `"empanadillas japonesas"` — confirm `"empanadilla de carne"` does not collide (it is the nameEs, not an alias — no collision possible via the validator's alias dedup check).
> **CE-313 alias**: `"bocata de pavo con queso"` is a query-specific multi-word phrase. No bare `"bocadillo"` alias per ADR-019.

**standard-portions.csv additions** (append after CE-312 rows):

| dishId suffix | term | grams | pieces | pieceName | confidence | notes |
|---------------|------|-------|--------|-----------|-----------|-------|
| `...000000000139` (CE-313) | `tapa` | 100 | | | medium | small bocadillo half tapa |
| `...000000000139` | `media_racion` | 150 | | | medium | half bocadillo de pavo con queso |
| `...000000000139` | `racion` | 200 | | | medium | full bocadillo; bread + turkey + cheese |
| `...00000000013a` (CE-314) | `tapa` | 100 | | | medium | small tapa arroz con atún y maíz |
| `...00000000013a` | `media_racion` | 180 | | | medium | half racion arroz con atún y maíz |
| `...00000000013a` | `racion` | 300 | | | medium | full racion; rice + tuna + corn |
| `...00000000013b` (CE-315) | `pintxo` | 50 | 1 | empanadilla | medium | 1 empanadilla pintxo |
| `...00000000013b` | `tapa` | 80 | 1 | empanadilla | medium | 1 empanadilla tapa |
| `...00000000013b` | `media_racion` | 160 | 2 | empanadillas | medium | 2 empanadillas media racion |
| `...00000000013b` | `racion` | 240 | 3 | empanadillas | medium | 3 empanadillas racion |

> CE-315 Empanadilla de carne is typically sold by piece — use `pieces`/`pieceName` columns on all rows (approx 80 g each). This follows the gyozas pattern in F-H6 (CE-300).

**Post-batch verification:**
```bash
grep -c '"externalId"' packages/api/prisma/seed-data/spanish-dishes.json
# Expected: 315

npm test -w @foodxplorer/api -- fH4B.validateSpanishDishes.uniqueness
# Expected: valid: true, 0 errors. CI still red.
```

---

#### Phase 2 — Batch C (CE-316..CE-317)

**Commit message:** `data(F-H9): add CE-316..CE-317 — tortilla francesa + brownie (Batch C — CI intentionally red)`

**JSON additions** — append after CE-315:

| externalId | dishId UUID | nutrientId UUID | name / nameEs | aliases | category | portionGrams | kcal/100g target | Notes |
|------------|-------------|-----------------|---------------|---------|----------|--------------|-----------------|-------|
| CE-316 | `00000000-0000-e073-0007-00000000013c` | `00000000-0000-e073-0008-00000000013c` | Tortilla francesa | `["tortilla francesa con champiñones"]` | `"primeros"` | 150 | 150–210 | BEDCA eggs + oil (no potato); alias resolves Q650 stripped query; `"huevos"` does not exist in catalog |
| CE-317 | `00000000-0000-e073-0007-00000000013d` | `00000000-0000-e073-0008-00000000013d` | Brownie | `["porción de brownie"]` | `"postres"` | 80 | 380–460 | Recipe (chocolate, butter, sugar, flour); alias resolves H7-P1 ARTICLE_PATTERN residual `"una porción de"` |

> **UUID case**: `13c` and `13d` must be lowercase.
> **CE-316 alias**: `"tortilla francesa con champiñones"` is the full stripped query from Q650. No bare `"tortilla"` alias per ADR-019.
> **CE-317 alias**: `"porción de brownie"` resolves the H7-P1 ARTICLE_PATTERN residual where `"una porción de"` is not fully stripped. This is a data fix — no NLP changes in this ticket. No bare `"brownie"` alias per ADR-019.
> **CE-316 category**: `"primeros"` — eggs served as a light main/starter in Spanish cuisine. `"huevos"` does not exist as a catalog category and must not be used.

**standard-portions.csv additions** (append after CE-315 rows):

| dishId suffix | term | grams | pieces | pieceName | confidence | notes |
|---------------|------|-------|--------|-----------|-----------|-------|
| `...00000000013c` (CE-316) | `tapa` | 80 | | | medium | small tortilla francesa tapa |
| `...00000000013c` | `media_racion` | 120 | | | medium | half tortilla francesa |
| `...00000000013c` | `racion` | 180 | | | medium | full tortilla francesa; 2 eggs + oil |
| `...00000000013d` (CE-317) | `tapa` | 40 | | | medium | small brownie tapa bar portion |
| `...00000000013d` | `media_racion` | 60 | | | medium | half brownie portion |
| `...00000000013d` | `racion` | 80 | 1 | brownie | medium | 1 brownie racion; restaurant dessert standard |

> CE-317 Brownie: single-serve dessert — `racion` is primary; `tapa` and `media_racion` cover bar/half-portion contexts. Use `pieces=1, pieceName="brownie"` on the `racion` row following the F-H6 pastry pattern (CE-286/CE-294).

**Post-batch verification:**
```bash
grep -c '"externalId"' packages/api/prisma/seed-data/spanish-dishes.json
# Expected: 317

npm test -w @foodxplorer/api -- fH4B.validateSpanishDishes.uniqueness
# Expected: valid: true, 0 errors. CI still red (count assertions still 307).
```

---

#### Phase 3 — New test file `fH9.cat29.unit.test.ts` (1 commit, immediately GREEN)

**Commit message:** `test(F-H9): add fH9.cat29.unit.test.ts — AC-12 level1Lookup + CSV batch invariants (~17 cases)`

**File:** `packages/api/src/__tests__/fH9.cat29.unit.test.ts`

Pattern reference: `fH6.seedExpansionRound2.edge-cases.test.ts` L438–461 (H6-EC-12). The new file contains two `describe` blocks.

**Block 1 — `describe('F-H9-AC-12: level1Lookup simulation for 11 Cat 29 stripped queries', ...)`:**

1. Import `readFileSync` from `'fs'`, `path` from `'path'`, `describe`/`it`/`expect` from `'vitest'`, and `SpanishDishEntry` type from `'../scripts/spanishDishesTypes.js'`.
2. Resolve `JSON_PATH` using the same `DATA_DIR` guard pattern as `fH6.seedExpansionRound2.edge-cases.test.ts` L33:
   ```
   const DATA_DIR = process.cwd().includes('packages/api') ? '.' : 'packages/api';
   const JSON_PATH = path.resolve(DATA_DIR, 'prisma/seed-data/spanish-dishes.json');
   ```
3. Parse the JSON once at module scope (same as fH6 file L45–46).
4. Implement `level1Lookup(query: string): SpanishDishEntry[]` exactly matching fH6 L103–110: lowercase trim, filter on `name`, `nameEs`, or any element of `aliases`.
5. Define the 11-case table (type `Array<[string, string]>`):

   | Stripped query | Expected externalId |
   |----------------|---------------------|
   | `salmón con verduras al horno` | `CE-308` |
   | `migas con huevo` | `CE-094` |
   | `nachos con queso` | `CE-309` |
   | `noodles con pollo y verduras` | `CE-310` |
   | `yogur con granola` | `CE-311` |
   | `barrita energética de frutos secos` | `CE-312` |
   | `bocata de pavo con queso` | `CE-313` |
   | `arroz con atún y maíz` | `CE-314` |
   | `empanadilla de carne` | `CE-315` |
   | `tortilla francesa con champiñones` | `CE-316` |
   | `porción de brownie` | `CE-317` |

6. Use `it.each(cases)('query "%s" resolves exactly to %s', ...)` asserting `matches.map((d) => d.externalId)` equals `[expectedEid]` (exactly one match, no extras).
7. Include a file-level JSDoc comment explaining this test covers the 11 deterministic Cat 29 queries from QA battery dev 2026-04-27, and noting Q638 (`noodles con pollo y verduras` → CE-310) is deterministic via H5-B Guard 2 (once CE-310 exists, `level1Lookup` short-circuits the multi-item split at `implicitMultiItemDetector.ts:122`).

**Block 2 — `describe('F-H9-AC-12-CSV: standard-portions.csv F-H9 batch invariants', ...)`:**

Load `standard-portions.csv` via `readFileSync` (same `DATA_DIR` guard, path `'prisma/seed-data/standard-portions.csv'`). Parse rows with the header-based column index (same pattern as fH6 CSV tests). Filter rows where `dishId` ends with any of the 10 new hex suffixes: `000000000134` through `00000000013d`.

Implement the following 5 invariants as individual `it` cases (or `it.each` where appropriate):

| Invariant | Assert |
|-----------|--------|
| **INV-1: minimum row coverage** | Every new dishId (`...0134` through `...013d`) has at least 1 row in the filtered set. Use `it.each` over the 10 new UUIDs. |
| **INV-2: non-empty `reviewed_by`** | Every filtered row has a non-empty `reviewed_by` value. Seeder silently skips rows where `reviewed_by` is empty — this would cause silent data loss. |
| **INV-3: `pieces`/`pieceName` pair invariant** | For every filtered row: `(pieces !== '' ) === (pieceName !== '')`. A row with `pieces` set and `pieceName` empty (or vice versa) is malformed. |
| **INV-4: valid `term` enum** | Every filtered row has `term ∈ { pintxo, tapa, media_racion, racion }`. The seeder validator (`seedStandardPortionCsv.ts` L57) enforces this but the unit test catches it faster. |
| **INV-5: `grams > 0`** | Every filtered row has `grams` parseable as a positive integer. |

> CE-315 Empanadilla rows (dishId suffix `...13b`) have `pieces=1, pieceName=empanadilla` and `pieces=2, pieceName=empanadillas` and `pieces=3, pieceName=empanadillas` — INV-3 must pass on all of them. CE-317 Brownie `racion` row has `pieces=1, pieceName=brownie` — same.

**Expected test count for Phase 3:** ~17 cases total (11 `it.each` level1Lookup cases + ~6 CSV invariant cases). Exact count depends on how INV-1 is structured: if INV-1 uses `it.each` over 10 dishIds that is 10 cases, making the total ~26 — the developer should structure INV-1 as a single `it` that loops internally to keep the count manageable unless a per-dishId breakdown is preferred for failure clarity.

**Post-create verification:**
```bash
npm test -w @foodxplorer/api -- fH9.cat29
# Expected: all tests passing (GREEN) — 11 level1Lookup cases + CSV invariant cases.
```

---

#### Phase 4 — Test count updates + H6-EC-11 structural fix + key_facts.md (1 commit, CI GREEN)

**Commit message:** `test(F-H9): update 307→317 in 3 test files + H6-EC-11 fix + key_facts.md (CI green)`

**`f073.seedPhaseSpanishDishes.edge-cases.test.ts`** — 6 locations, all `307`→`317`:

| Line | Current text | Replacement |
|------|-------------|-------------|
| 321 | `it('upserts exactly 307 dishes', async () => {` | `it('upserts exactly 317 dishes', async () => {` |
| 324 | comment referencing `307` | Update comment: append `// F-H9: count updated 307 → 317 (+10 Cat 29 atoms)` |
| 328 | `expect(dishUpserts).toHaveLength(307);` | `expect(dishUpserts).toHaveLength(317);` |
| 331 | `it('upserts exactly 307 DishNutrients', async () => {` | `it('upserts exactly 317 DishNutrients', async () => {` |
| 334 | comment referencing `307` | Update comment: append `// F-H9: count updated 307 → 317 (+10 Cat 29 atoms)` |
| 338 | `expect(nutrientUpserts).toHaveLength(307);` | `expect(nutrientUpserts).toHaveLength(317);` |

**`f114.newDishes.unit.test.ts`** — 5 locations, all `307`→`317`:

| Line | Current text | Replacement |
|------|-------------|-------------|
| 132 | comment `307 entries` | Update to `317 entries` |
| 135 | comment `307` | Update to `317`; append `// F-H9: count updated 307 → 317 (+10 Cat 29 atoms)` |
| 137 | `describe('F114-U1: validateSpanishDishes accepts extended JSON (307 entries)', () => {` | `describe('F114-U1: validateSpanishDishes accepts extended JSON (317 entries)', () => {` |
| 138 | `it('passes validation with 307 entries, 0 errors', () => {` | `it('passes validation with 317 entries, 0 errors', () => {` |
| 140 | `expect(dishes).toHaveLength(307);` | `expect(dishes).toHaveLength(317);` |

**`fH6.seedExpansionRound2.edge-cases.test.ts`** — 5 count locations + 1 structural fix:

| Line | Current text | Replacement |
|------|-------------|-------------|
| 8 | `* H6-EC-1  No duplicate name/nameEs/alias across all 307 entries` | `across all 317 entries` |
| 117 | `describe('H6-EC-1: no duplicate name/nameEs/alias across 307 entries', () => {` | `317 entries` |
| 118 | `it('validateSpanishDishes returns valid: true with 0 errors on the full 307-entry dataset', () => {` | `317-entry dataset` |
| 124 | `it('total dish count is 307', () => {` | `'total dish count is 317'` |
| 125 | `expect(dishes).toHaveLength(307);` | `expect(dishes).toHaveLength(317);` |
| **426** | `it('the last 28 entries are CE-280..CE-307 in order', () => {` | `it('the F-H6 batch (CE-280..CE-307) remains in monotonic order at its appended position', () => {` |
| **427** | `const last28 = dishes.slice(-28);` | `const last28 = dishes.slice(-38, -10);` |

> **H6-EC-11 rationale**: after F-H9 appends CE-308..CE-317 (10 entries), `slice(-28)` would select CE-290..CE-317, not CE-280..CE-307. `slice(-38, -10)` selects entries at positions -38 through -11, which are still CE-280..CE-307 with the 10 new atoms appended at the end. The `Array.from({ length: 28 }, (_, i) => \`CE-${280 + i}\`)` expected array (L429) is unchanged — it still asserts the 28 F-H6 atoms are in order; only the selector changes to target the correct window.

**`docs/project_notes/key_facts.md` L95:**

| Current | Replacement |
|---------|-------------|
| `307 dishes (47 BEDCA + 260 recipe)` | `317 dishes (47 BEDCA + 270 recipe)` |
| `Imported (F073/F114/F-H4/F-H6)` | `Imported (F073/F114/F-H4/F-H6/F-H9)` |

**Post-phase verification:**
```bash
npm test --workspace=@foodxplorer/api
# Expected: all tests pass (CI GREEN). fH9.cat29 (11 tests) + fH6 (all passing) + f073 + f114 confirmed.
```

---

#### Phase 5 — Final validation (no commit)

Run all quality gates before opening the PR:

```bash
# Full API test suite (must be green)
npm test --workspace=@foodxplorer/api

# Lint (must be clean)
npm run lint --workspace=@foodxplorer/api

# Build (must succeed)
npm run build --workspace=@foodxplorer/api

# Explicit uniqueness/validator check
npm test -w @foodxplorer/api -- fH4B.validateSpanishDishes.uniqueness

# Confirm total atom count in JSON
grep -c '"externalId"' packages/api/prisma/seed-data/spanish-dishes.json
# Expected: 317

# Confirm new Cat 29 test passes in isolation
npm test -w @foodxplorer/api -- fH9.cat29
# Expected: all tests passing (level1Lookup cases + CSV invariant cases)
```

**Expected test count delta**: the full API suite should grow by ~17 cases (11 level1Lookup `it.each` in `fH9.cat29.unit.test.ts` plus the CSV invariant cases in the second `describe` block).

---

#### Phase 5.5 — Draft and verify rollback SQL (no commit; PR body artifact)

> **Purpose**: seed uses `upsert`, so a `git revert` alone does not delete DB rows. The PR body must include a verified, cascade-aware DELETE block and the alias revert UPDATE. This phase must be completed before the PR is opened.

**Schema constraint reality** (empirically verified at `packages/api/prisma/schema.prisma:386`):
- `dish_nutrients.dish_id` has `onDelete: Restrict` — a `DELETE FROM dishes` will be rejected by Postgres if matching nutrient rows still exist.
- `standard_portions.dish_id` cascades from `dishes` — but explicit deletion is safer for audit clarity.

**Required rollback SQL (cascade-aware order):**

```sql
-- Step 1: delete dish_nutrients first (Restrict FK — must precede dish deletion).
-- Use dishId values (0007 family) in WHERE dish_id, NOT nutrientId values (0008 family).
-- dish_nutrients.dish_id is the FK column referencing dishes.id (0007 family).
DELETE FROM dish_nutrients
WHERE dish_id IN (
  '00000000-0000-e073-0007-000000000134',  -- CE-308
  '00000000-0000-e073-0007-000000000135',  -- CE-309
  '00000000-0000-e073-0007-000000000136',  -- CE-310
  '00000000-0000-e073-0007-000000000137',  -- CE-311
  '00000000-0000-e073-0007-000000000138',  -- CE-312
  '00000000-0000-e073-0007-000000000139',  -- CE-313
  '00000000-0000-e073-0007-00000000013a',  -- CE-314
  '00000000-0000-e073-0007-00000000013b',  -- CE-315
  '00000000-0000-e073-0007-00000000013c',  -- CE-316
  '00000000-0000-e073-0007-00000000013d'   -- CE-317
);

-- Step 2: delete standard_portions (explicit, even though cascade would handle it)
DELETE FROM standard_portions
WHERE dish_id IN (
  '00000000-0000-e073-0007-000000000134',  -- CE-308
  '00000000-0000-e073-0007-000000000135',  -- CE-309
  '00000000-0000-e073-0007-000000000136',  -- CE-310
  '00000000-0000-e073-0007-000000000137',  -- CE-311
  '00000000-0000-e073-0007-000000000138',  -- CE-312
  '00000000-0000-e073-0007-000000000139',  -- CE-313
  '00000000-0000-e073-0007-00000000013a',  -- CE-314
  '00000000-0000-e073-0007-00000000013b',  -- CE-315
  '00000000-0000-e073-0007-00000000013c',  -- CE-316
  '00000000-0000-e073-0007-00000000013d'   -- CE-317
);

-- Step 3: delete the 10 new dish atoms
DELETE FROM dishes
WHERE id IN (
  '00000000-0000-e073-0007-000000000134',  -- CE-308
  '00000000-0000-e073-0007-000000000135',  -- CE-309
  '00000000-0000-e073-0007-000000000136',  -- CE-310
  '00000000-0000-e073-0007-000000000137',  -- CE-311
  '00000000-0000-e073-0007-000000000138',  -- CE-312
  '00000000-0000-e073-0007-000000000139',  -- CE-313
  '00000000-0000-e073-0007-00000000013a',  -- CE-314
  '00000000-0000-e073-0007-00000000013b',  -- CE-315
  '00000000-0000-e073-0007-00000000013c',  -- CE-316
  '00000000-0000-e073-0007-00000000013d'   -- CE-317
);

-- Step 4: revert alias addition on CE-094 Migas (restore pre-F-H9 aliases array)
-- aliases is a Postgres TEXT[] column; restore to the pre-F-H9 single-alias state
UPDATE dishes
   SET aliases = ARRAY['migas extremeñas']
 WHERE id = '00000000-0000-e073-0007-00000000005e';  -- CE-094 Migas
```

**Developer tasks for this phase:**
1. Verify the 10 dishId UUIDs (`...000000000134`..`...00000000013d`) in the Step 1 WHERE clause match the `dishId` values of the new entries in `spanish-dishes.json` before pasting into the PR body.
2. Verify `onDelete: Restrict` is still present at `schema.prisma:386` (`dish_nutrients` model `dishId` field) — if it has changed to `Cascade`, Steps 1 and 2 can be merged, but explicit remains preferred.
3. Paste the complete 4-step SQL block into the PR body under a `## Rollback` heading.
4. Include the Q638 Guard 2 note directly after the rollback block: "Q638 (`noodles con pollo y verduras`) is deterministic: once CE-310 exists, `level1Lookup(db, text, {})` at `implicitMultiItemDetector.ts:122` returns CE-310 and H5-B returns null — no conditional branch, no split (Edge Case §5)."

---

### Testing Strategy

**New test file to create:**
- `packages/api/src/__tests__/fH9.cat29.unit.test.ts` (Phase 3) — two `describe` blocks: level1Lookup simulation (Block 1) and CSV batch invariants (Block 2).

**Existing test files modified (count assertions only):**
- `packages/api/src/__tests__/f073.seedPhaseSpanishDishes.edge-cases.test.ts`
- `packages/api/src/__tests__/f114.newDishes.unit.test.ts`
- `packages/api/src/__tests__/fH6.seedExpansionRound2.edge-cases.test.ts`

**Key test scenarios in `fH9.cat29.unit.test.ts`:**

Block 1 — level1Lookup (11 cases):
- **Happy path (10 new atoms)**: each of the 10 new CE entries resolves via `name`/`nameEs` or required alias.
- **Happy path (alias-only addition)**: `"migas con huevo"` resolves to CE-094 via the new alias, not a new atom.
- **H5-B Guard 2 deterministic case** (Q638): `"noodles con pollo y verduras"` → CE-310 — the `y` token does NOT trigger a multi-item split because Guard 2's whole-text `level1Lookup` returns CE-310 first. Verified by the same level1Lookup function used in the test.
- **Alias-derived resolution** (Q643/Q650/Q644): `"bocata de pavo con queso"` → CE-313; `"tortilla francesa con champiñones"` → CE-316; `"porción de brownie"` → CE-317.
- **Error case (implicit)**: any query NOT in the 11-case table must NOT appear in this test file — test only the 11 addressable queries.

Block 2 — CSV batch invariants (F-H9-AC-12-CSV, ~6 cases):
- **INV-1 minimum row coverage**: each of the 10 new dishIds (`...0134`..`...013d`) has at least 1 CSV row — catches a silent omission where a dish atom is added to the JSON but no portion rows are written.
- **INV-2 non-empty `reviewed_by`**: all F-H9 rows have `reviewed_by` set — `seedStandardPortionCsv.ts` silently skips rows with empty `reviewed_by`, which would cause invisible data loss at seed time.
- **INV-3 `pieces`/`pieceName` pair invariant**: `pieces !== ''` iff `pieceName !== ''` on every F-H9 row — catches half-populated pairs (e.g. CE-315 empanadilla rows with `pieces=1` but empty `pieceName`).
- **INV-4 valid `term` enum**: every F-H9 row has `term ∈ { pintxo, tapa, media_racion, racion }`.
- **INV-5 `grams > 0`**: every F-H9 row has positive integer `grams`.

**Mocking strategy:** No mocks. Tests load real JSON and CSV files directly via `readFileSync` (integration-style data tests, no DB, no HTTP). Pattern established in `fH6.seedExpansionRound2.edge-cases.test.ts` and `fH4B.validateSpanishDishes.uniqueness.test.ts`. CSV parsing follows the header-index approach used in the fH6 CSV edge-case tests.

---

### Key Patterns

- **level1Lookup simulation**: copy the exact `level1Lookup` helper from `fH6.seedExpansionRound2.edge-cases.test.ts` L102–110 (lowercase trim + name/nameEs/aliases filter). Do NOT import it from production code — keeping it inline in the test file follows the H6 precedent.
- **DATA_DIR guard**: `process.cwd().includes('packages/api') ? '.' : 'packages/api'` — must be used verbatim for CI compatibility (tests run from both repo root and package directory).
- **CSV `reviewed_by` column**: every new CSV row must have `reviewed_by=pbojeda`. Empty `reviewed_by` causes silent skip in the seeder (`seedStandardPortionCsv.ts` L170–226).
- **lowercase UUID hex**: all new dishId and nutrientId UUID strings must use lowercase hex digits only (`13a`, `13b`, `13c`, `13d` — NOT `13A`, `13B`, etc.). The validator at `validateSpanishDishes.ts:19` uses regex `^[0-9a-f]{...}$` which rejects uppercase.
- **Monotonic file order**: new entries CE-308..CE-317 must be appended in ascending externalId order. CE-094 Migas alias addition is in-place (does not change file position). Monotonic order is verified by H6-EC-11 (after the structural fix in Phase 4).
- **H6-EC-11 structural fix**: only L427 (`slice(-28)` → `slice(-38, -10)`) and L426 (it title) change. Lines 429–430 (`Array.from`, `expect(eids).toEqual(expected)`) are unchanged — the fix targets the selector, not the expected array.
- **Intentional red CI pattern**: do not update count assertions until all 10 atoms and all portion rows are committed. Merge the count+structural fix in a single final commit so the branch history is `git bisect`-friendly.
- **No NLP code changes**: CE-316 `"tortilla francesa con champiñones"` alias and CE-317 `"porción de brownie"` alias are pure data fixes. Any suggestion to modify H7 wrappers or `implicitMultiItemDetector.ts` is out of scope.

---

### Verification Commands Run (empirical pre-planning checks)

| Check | Command / File | Finding |
|-------|---------------|---------|
| Current max externalId | `grep '"externalId"' spanish-dishes.json \| tail -15` | CE-307 is the last entry; UUID ends in `...000000000133` |
| CE-307 structure | Read tail of `spanish-dishes.json` | `"name": "Chorizo a la sidra"`, `"aliases": []`, `"category": "tapas"`, `"portionGrams": 200` |
| CE-094 Migas | Read L2431–2455 of `spanish-dishes.json` | `"aliases": ["migas extremeñas"]` — `"migas con huevo"` is absent; safe to add |
| CE-151 Bocadillo de jamón serrano | Read L3914–3938 | `"aliases": ["bocata de jamón"]` — confirms precedent for CE-313 alias `"bocata de pavo con queso"` |
| standard-portions.csv tail | `tail -60 standard-portions.csv` | Last rows are for `...000000000133` (CE-307): tapa 80g, media_racion 120g, racion 200g. Column order: `dishId,term,grams,pieces,pieceName,confidence,notes,reviewed_by` |
| Valid term enum | Read `seedStandardPortionCsv.ts` L57 | `z.enum(['pintxo', 'tapa', 'media_racion', 'racion'])` — no `piece` term |
| f073 count assertions | Read L315–340 | L321: it title `'upserts exactly 307 dishes'`; L328: `toHaveLength(307)`; L331: it title `'upserts exactly 307 DishNutrients'`; L338: `toHaveLength(307)` |
| f114 count assertions | Read L126–145 | L132: comment `307`; L135: comment `307`; L137: describe `(307 entries)`; L138: it `307 entries`; L140: `toHaveLength(307)` |
| fH6 count assertions | Read L114–126 | L8 comment `307`; L117 describe `307`; L118 it `307`; L124 it title `307`; L125 `toHaveLength(307)` |
| H6-EC-11 current text | Read L421–432 | L426: `it('the last 28 entries are CE-280..CE-307 in order'`; L427: `const last28 = dishes.slice(-28);` — must become `slice(-38, -10)` after F-H9 |
| H6-EC-12 level1Lookup pattern | Read L434–461 | `level1Lookup` defined L102–110; `it.each(cases)` pattern at L454 — exact template for `fH9.cat29.unit.test.ts` |
| key_facts.md L95 | Read L95 | `307 dishes (47 BEDCA + 260 recipe)` / `Imported (F073/F114/F-H4/F-H6)` — both fields require update |
| Total atom count | `grep -c '"externalId"' spanish-dishes.json` | Expected output: `307` (verified via tail grep) |

---

## Acceptance Criteria

**Seed integrity**
- [x] AC-1: All 10 new atoms (CE-308..CE-317) are present in `spanish-dishes.json` with
  `source=recipe`, `confidenceLevel=medium`, `estimationMethod=ingredients` — validator enforces
  this triple; `validateSpanishDishes.ts` (via uniqueness test) reports `valid: true`.
- [x] AC-2: `standard-portions.csv` contains 3–4 portion rows per new atom (terms:
  `pintxo | tapa | media_racion | racion`); no `piece` term used; `pieces`/`pieceName` columns
  populated where applicable per F-H6 §8 pattern.
- [x] AC-3: externalIds are monotonically sequential (`CE-308` through `CE-317`); dishId UUIDs
  follow the `0x134..0x13D` hex scheme; no gaps or duplicates.

**Alias rules**
- [x] AC-4: Required aliases are present on their respective new atoms: CE-313 carries
  `"bocata de pavo con queso"`, CE-316 carries `"tortilla francesa con champiñones"`,
  CE-317 carries `"porción de brownie"`. Alias `"migas con huevo"` is added to the existing
  CE-094 Migas atom.
- [x] AC-5: Zero bare family-term aliases added in this batch (ADR-019 enforced). Forbidden
  bare terms include but are not limited to: `"salmón"`, `"noodles"`, `"yogur"`, `"barrita"`,
  `"bocadillo"`, `"empanadilla"`, `"migas"`, `"tortilla"`, `"brownie"`.

**Validator and uniqueness**
- [x] AC-6: `fH4B.validateSpanishDishes.uniqueness.test.ts` passes against the post-F-H9
  `spanish-dishes.json` (real-JSON integration test — no mock). If a new alias collision is
  detected, it is resolved by qualifying the alias further (preferred) or by adding a justified
  entry to `HOMOGRAPH_ALLOW_LIST`; no collision is left unresolved.

**Test coverage**
- [x] AC-7: `f073.seedPhaseSpanishDishes.edge-cases.test.ts` — all `307` occurrences updated
  to `317` (it titles at lines 321, 331; toHaveLength at lines 328, 338; comments at 324, 334).
- [x] AC-8: `f114.newDishes.unit.test.ts` — all `307` occurrences updated to `317`
  (comments at 132, 135; describe title at 137; it title at 138; toHaveLength at 140).
- [x] AC-9: Full API test suite passes (`npm test --workspace=@foodxplorer/api`).

**Automated Cat 29 resolution test**
- [x] AC-12: `packages/api/src/__tests__/fH9.cat29.unit.test.ts` exists and passes. This file
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
- [x] AC-10: All 11 addressable Cat 29 queries (Q631, Q632, Q637, Q638, Q639, Q640, Q643, Q644,
  Q645, Q646, Q650) return a non-NULL result in the next QA battery dev run after seed
  deployment. Q635 and Q649 remain excluded. Failure of any of these 11 is a merge blocker.
  Q638 (`noodles con pollo y verduras`) is deterministic via H5-B Guard 2 — see Edge Case §5.

**Documentation**
- [x] AC-11: `docs/project_notes/key_facts.md` L95 updated: dish count to `317 dishes
  (47 BEDCA + 270 recipe)`, recipe count, and import-tag suffix include `F-H9`.

---

## Definition of Done

- [x] DoD-1: All 11 Acceptance Criteria checked (AC-1 through AC-12, where AC-10 is a single merged criterion).
- [x] DoD-2: `npm test --workspace=@foodxplorer/api` exits green (CI equivalent); no regressions
  in any other workspace.
- [x] DoD-3: `fH4B.validateSpanishDishes.uniqueness` test passes on the final dataset.
- [x] DoD-4: No lint errors (`npm run lint --workspace=@foodxplorer/api` clean).
- [x] DoD-5: `docs/project_notes/key_facts.md` L95 updated with correct count (`317`) and tag.
- [x] DoD-6: PR body includes: (a) cascade-aware DELETE SQL block in the correct FK order —
  `dish_nutrients` first (Restrict FK), then `standard_portions`, then `dishes` — for all 10
  new dishIds CE-308..CE-317, followed by an `UPDATE dishes SET aliases = ARRAY['migas extremeñas']`
  to revert the CE-094 Migas alias addition; (b) Q638 confirmation note citing Guard 2 deterministic
  pass — once CE-310 exists, `level1Lookup` at `implicitMultiItemDetector.ts:122` returns CE-310
  and H5-B returns null with no conditional branch (Edge Case §5). The complete SQL is drafted and
  verified in Phase 5.5 before the PR is opened.
- [x] DoD-7: Product tracker and ticket status updated to `Done`; branch deleted post-merge.

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed — `## Spec`, `## Acceptance Criteria`, `## Definition of Done` filled; `/review-spec` cross-model review completed (Standard complexity — mandatory). 3R Codex (REVISE→REVISE→APPROVED), 2R Gemini (APPROVED both).
- [x] Step 1: Branch `feature/F-H9-cat29-seed-expansion` created off `develop` @ `6128115`; ticket status → `Planning`; product tracker Active Session updated.
- [x] Step 2: `backend-planner` executed — Implementation Plan generated; commit strategy (data commits 1–N-1 intentionally red, final count/test commit green) confirmed. /review-plan 3R Codex (REVISE→REVISE→APPROVED), 1R Gemini (APPROVED).
- [x] Step 3: `backend-developer` executed with TDD — data additions in `spanish-dishes.json` + `standard-portions.csv`; count assertions updated across all 3 test files (f073, f114, fH6 including H6-EC-11 structural fix); new `fH9.cat29.unit.test.ts` created (AC-12); validator passes
- [x] Step 4: `production-code-validator` executed — APPROVE WITH NOTES (92%). 1 CRITICAL kcal/100g→per-portion fix applied in commit `fdd2d9d`. Final gates: 4110/4110 tests GREEN, lint 0, build clean, validator 317 dishes valid.
- [x] Step 5: `code-review-specialist` executed — APPROVE WITH MINOR. 2 MEDIUM (M1 H6-EC-11 future-proof + M2 computed FH9_DISH_IDS) addressed in commit `67eb0e7`. NITs noted (consistency with H6 patterns).
- [x] Step 5: `qa-engineer` executed — PASS WITH FOLLOW-UPS. All 12 ACs verified empirically. PR body Q-number claim was empirically wrong (battery confirms PR body); ticket Q645→Q650 typos fixed.
- [x] Step 6: Ticket Status → `Done`; Completion Log finalized with merge SHA; branch deleted (local + remote); product tracker updated to `done | 6/6`.

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-27 | Step 0 — Spec | spec-creator agent invoked. Initial draft + 2 SendMessage corrections (empirical: Brownie + Tortilla francesa do NOT exist in catalog; re-scoped 8 atoms+2 aliases → 10 atoms+1 alias on Migas, count 307→317; UUID lowercase fix; AC structure split 10a/10b; AC-12 automated repo-side test added). Self-review: clean. |
| 2026-04-27 | Step 1 — Setup | Branch `feature/F-H9-cat29-seed-expansion` created off develop @ `6128115`. Ticket initialized from template. Product tracker Active Session updated. |
| 2026-04-27 | Step 0 — /review-spec R1 | Gemini APPROVED. Codex REVISE — 3 IMPORTANT (fH6 test missing, UUID case, AC-10 inconsistent) + 1 SUGGESTION (AC-10 not automatable → AC-12 repo test). All addressed in R2. |
| 2026-04-27 | Step 0 — /review-spec R2 | Gemini APPROVED. Codex REVISE — 2 IMPORTANT (Q638 deterministic per H5-B Guard 2 not conditional; CE-??? placeholders → CE-151). All addressed in R3. |
| 2026-04-27 | Step 0 — /review-spec R3 | Codex APPROVED (Gemini already APPROVED twice). Spec ready for planning. |
| 2026-04-27 | Step 2 — Plan | backend-planner agent invoked. Initial plan + 2 SendMessage corrections (rollback SQL Phase 5.5 added with cascade-aware delete order; CSV invariants block added to fH9.cat29.unit.test.ts; UUID family mismatch fixed; category taxonomy drift removed — `snacks`→`desayunos`, `huevos`→`primeros`, `primeros`→`arroces` for CE-314). Self-review: clean. |
| 2026-04-27 | Step 2 — /review-plan R1 | Gemini APPROVED. Codex REVISE — 2 IMPORTANT (rollback SQL not allocated to phase + cascade order; CSV invariants untested for new batch). All addressed in R2. |
| 2026-04-27 | Step 2 — /review-plan R2 | Codex REVISE — 1 IMPORTANT (rollback Step 1 dish_id UUID family mismatch — used 0008 nutrientIds in WHERE dish_id; would match 0 rows and Step 3 fails with onDelete: Restrict) + 1 SUGGESTION (snacks/huevos categories don't exist). All addressed in R3. |
| 2026-04-27 | Step 2 — /review-plan R3 | Codex APPROVED. Plan ready for implementation. |
| 2026-04-27 | Step 3 — Phase 1 verification | Pre-flight grep checks passed: all 10 dishes confirmed absent from catalog; CE-094 Migas has `"migas extremeñas"` only; CE-151 bocadillo alias pattern confirmed; JSON count=307; CSV tail at CE-307 (`...000000000133`). No blockers. |
| 2026-04-27 | Step 3 — Batch A commit `6093081` | CE-308..CE-312 appended to JSON + alias `"migas con huevo"` on CE-094 + 12 portion rows in CSV. JSON count: 312. Uniqueness test: 10/10 PASS. |
| 2026-04-27 | Step 3 — Batch B commit `af03415` | CE-313..CE-315 appended (bocadillo/arroz/empanadilla) + 10 portion rows (CE-315 uses pieces/pieceName). JSON count: 315. Uniqueness test: 10/10 PASS. |
| 2026-04-27 | Step 3 — Batch C commit `cd0f977` | CE-316..CE-317 appended (tortilla francesa/brownie) + 6 portion rows (CE-317 racion uses pieces=1 pieceName=brownie). JSON count: 317. Uniqueness test: 10/10 PASS. |
| 2026-04-27 | Step 3 — Phase 3 commit `961e4c6` | `fH9.cat29.unit.test.ts` created — 11 level1Lookup cases + 5 CSV invariants = 16 tests, all GREEN immediately. |
| 2026-04-27 | Step 3 — Phase 4 commit `25c1bfa` | 307→317 in f073 (6 locations), f114 (5 locations), fH6 (5 locations + H6-EC-11 structural fix `slice(-28)`→`slice(-38,-10)`); key_facts.md L95 updated. Full suite: 224 test files, 4110 tests GREEN. Lint clean. Build clean. |
| 2026-04-27 | Step 4 — production-code-validator | APPROVE WITH NOTES (92% confidence). 1 CRITICAL: nutrient values entered as kcal/100g but seed convention is per-portionGrams. Fix commit `fdd2d9d` scaled all 9 nutrient fields × portionGrams/100 across 10 atoms. Post-fix kcal/100g all within spec Edge Case §9 ranges (130/420/125/165/430/255/155/270/180/420). Tests still 4110/4110 GREEN. |
| 2026-04-27 | Step 5 — code-review-specialist | APPROVE WITH MINOR. 2 MEDIUM future-proofing suggestions (slice(-38,-10) magic numbers + hand-rolled FH9_SUFFIXES). Both applied in commit `67eb0e7`. Atwater equation cross-check ≤10% on every atom. Zero new token collisions. Tests 4110/4110 GREEN. |
| 2026-04-27 | Step 5 — qa-engineer | PASS WITH FOLLOW-UPS. All 12 ACs verified empirically. 1 MINOR (PR body Q-number swap claim — empirically WRONG per QA battery `/tmp/qa-dev-post-fH8-20260427-1306.txt`: PR body matches battery line numbering Q644=brownie, Q645=arroz, Q650=tortilla francesa; the ticket spec had typo Q645→Q650 fixed in this commit). 1 NIT (H6-EC-11 fragility — addressed via M1 refactor in `67eb0e7`). |
| 2026-04-27 | Step 5 — /audit-merge | 11/11 structural PASS + drift CLEAN. Verdict: READY FOR MERGE. |
| 2026-04-27 | Step 6 — Squash merge | PR #220 squash-merged to develop at `67cc09b` 2026-04-27. Branch deleted local + remote. Post-merge sanity: 4110/4110 tests GREEN on develop. Operator action pending: api-dev manual deploy + reseed Phase 1+2 + re-run QA battery dev to confirm empirical +11 OK. |
| 2026-04-27 | Step 6 — Empirical post-deploy QA battery dev | api-dev manual deploy + reseed (Phase 1+2+3 embeddings: `processedDishes:10`, `skippedDishes:307`) confirmed CE-308..CE-317 ingested. QA battery dev `/tmp/qa-dev-post-fH9-fH10-20260427-1654.txt`: 435 OK / 207 NULL / 8 FAIL. Delta vs F-H8 baseline 424/225/1: **+11 OK / -18 NULL / +7 ERR (script-level JSON parse on long voice queries 552-561, not API regression)**. **All 11 F-H9 target queries (Q631/632/637-640/643-646/650) resolve correctly** to CE-308..CE-317 + CE-094 alias hit — exactly as predicted. AC-10 closed empirically. |

<!-- After code review, add a row documenting which findings were accepted/rejected:
| YYYY-MM-DD | Review findings | Accepted: C1-C3, H1-H2. Rejected: M5 (reason). Systemic: C4 logged in bugs.md |
This creates a feedback loop for improving future reviews. -->

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | All 7 sections present: Spec, Implementation Plan, Acceptance Criteria, Definition of Done, Workflow Checklist, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 12/12, DoD: 7/7, Workflow: 7/8 (Step 6 pending merge) |
| 2. Verify product tracker | [x] | Active Session: F-H9 Step 6/6 done; Features table: F-H9 done 6/6 (synced post-merge in `afbdffc` chore housekeeping PR #221) |
| 3. Update key_facts.md | [x] | L95: `307 dishes (47 BEDCA + 260 recipe)` → `317 dishes (47 BEDCA + 270 recipe)`; tag `Imported (F073/F114/F-H4/F-H6/F-H9)` |
| 4. Update decisions.md | [x] | N/A — no new ADR (data-only feature follows existing F-H4/F-H6 pattern + ADR-019 alias scope already in place) |
| 5. Commit documentation | [x] | Commits: spec/plan (`bf0151e`/`038a840`), data batches (`6093081`/`af03415`/`cd0f977`), test create (`961e4c6`), count fix (`25c1bfa`), housekeeping (`23b01ba`/`01af362`), kcal fix (`fdd2d9d`), review refactors (`67eb0e7`) |
| 6. Verify clean working tree | [x] | `git status`: clean |
| 7. Verify branch up to date | [x] | `git merge-base --is-ancestor origin/develop HEAD` → UP TO DATE with develop @ `6128115` |

---

*Ticket created: 2026-04-27*
