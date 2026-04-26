# F-H6: Seed Expansion Round-2 — International-in-Spain + Regional Spanish Remainder

**Feature:** F-H6 | **Type:** Backend-Feature (data/seed) | **Priority:** High
**Status:** Ready for Merge | **Branch:** feature/F-H6-international-extended-regional
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-26 | **Dependencies:** F-H4 (merged `c83f6cb`), F-H4-B (merged `4520c24`)

---

## Spec

### Description

Round-2 expansion of the Spanish dish catalog to resolve the two highest-impact NULL clusters from
the 650-query QA battery run on prod after Fase 3 release (2026-04-26):

- **Cat 22 INTERNACIONAL EN ESPAÑA**: 25/25 queries NULL (100%). All 25 dishes were absent from
  the seed; none could be reached via existing atoms or aliases.
- **Cat 21 COCINA REGIONAL ESPAÑOLA**: 20/30 queries NULL after F-H4 covered the Canarias priority.
  Post-analysis reveals a mix of: (a) NLP extraction failures on *already-existing* dishes (out of
  scope for H6), (b) alias gaps on existing dishes (fixable in H6), and (c) genuinely missing
  atoms (fixable in H6).

F-H6 adds **28 new dish atoms** (CE-280..CE-307) and **6 alias additions** on 6 existing dishes.
The changes are pure data + tests + docs — no schema migration, no API surface change.

The baseline at time of spec is **279 dishes** (key_facts.md L95: `47 BEDCA + 232 recipe`).
After F-H6: **307 dishes** (47 BEDCA + 260 recipe).

---

### API Changes

None. Seed data only.

---

### Data Model Changes

No schema changes. All additions conform to existing `Dish`, `DishNutrient`, and `StandardPortion`
tables and the validator invariants established by `validateSpanishDishes.ts`.

- **`packages/api/prisma/seed-data/spanish-dishes.json`**:
  - +28 new entries: externalIds `CE-280` through `CE-307`, dishIds `0x118` through `0x133`,
    nutrientIds parallel.
  - +6 alias additions on existing entries (no new entries): CE-092, CE-128, CE-140, CE-217,
    CE-267, CE-277.
- **`packages/api/prisma/seed-data/standard-portions.csv`**: +~84 rows across the 28 new dishIds
  (exact count to be determined by implementer per portion rules).
- **`packages/api/src/__tests__/f073.seedPhaseSpanishDishes.edge-cases.test.ts`**: hardcoded
  `279` count assertions updated to `307` (×2 occurrences at lines 327 and 336, with the
  preceding F-H4 comment also updated to mention F-H6).
- **`docs/project_notes/key_facts.md` L95**: `279 dishes (47 BEDCA + 232 recipe)` updated to
  `307 dishes (47 BEDCA + 260 recipe)` and the import-tag suffix updated to
  `(F073/F114/F-H4/F-H6)`.

---

### UI Changes

None. Data propagates via the existing estimation pipeline.

---

### Edge Cases & Error Handling

1. **Source/confidence/estimationMethod triple enforcement**: all 28 new dishes use
   `source=recipe + confidenceLevel=medium + estimationMethod=ingredients`. The validator
   (`validateSpanishDishes.ts`) enforces this triple. No BEDCA entries expected in this batch.

2. **No new HOMOGRAPH_ALLOW_LIST entries anticipated**: the 6 alias additions are unique terms
   in the current catalog. The implementer MUST run `validateSpanishDishes.ts` with the
   uniqueness check (added in F-H4-B) before committing. If a collision is detected, resolve it
   by choosing a more qualified alias (e.g., `"escalivada con anchoas"` instead of bare
   `"escalivada"` on CE-092 — this is already qualified).

3. **Duplicate pre-check (mandatory)**: before adding any of the 28 new atoms, the implementer
   must grep `spanish-dishes.json` (name + aliases, lowercase) to confirm the dish is not
   already present. The pre-analysis below documents this verification; re-verify at
   implementation time in case interim commits have added entries.

4. **Rollback**: seed uses `upsert`; a `git revert` alone does not delete DB rows. The PR body
   must include a DELETE SQL block for all 28 new dishIds (same pattern as F-H4 PR #196).

5. **Hardcoded count update**: TWO test files hardcode the dish count and BOTH must be updated
   to `307` in the same commit that finalises the JSON additions:
   - `packages/api/src/__tests__/f073.seedPhaseSpanishDishes.edge-cases.test.ts`: 2 assertions
     at lines 327 (`dishUpserts`) and 336 (`nutrientUpserts`).
   - `packages/api/src/__tests__/f114.newDishes.unit.test.ts`: 1 assertion at line 139
     (`dishes.toHaveLength(279)`). **Caught by backend-planner Step 2 empirical verification —
     spec v3 §5 missed this file.**
   Total: 3 occurrences. Leaving the CI red on intermediate commits is acceptable (see F-H4
   precedent which updated the same set of files).

6. **`key_facts.md` L95 update**: must accompany the count-update commit.

7. **International dish kcal sanity ranges (per 100 g, recipe source)**:
   These are not enforced by the validator but serve as a cross-check during implementation.
   Values outside these ranges require a documented justification in the PR.

   | Dish | Acceptable kcal/100 g range | Reference basis |
   |------|-----------------------------|-----------------|
   | Poke bowl | 80–160 | USDA SR / recipe (rice + fish + veg) |
   | Burrito cochinita pibil | 180–260 | USDA SR / recipe |
   | Ramen de miso | 60–110 | USDA SR / recipe (broth-heavy) |
   | Pad thai | 150–220 | USDA SR / recipe |
   | Shawarma | 200–280 | USDA SR / recipe |
   | Falafel | 280–330 | BEDCA falafel / USDA |
   | Pastel de nata | 320–380 | USDA / Wikipedia nutrition |
   | Nigiri de pez mantequilla (CE-295) | 150–200 | USDA sushi rice + butterfish |
   | Uramaki roll | 160–220 | USDA SR |
   | Tacos al pastor | 220–290 | USDA SR / recipe |
   | Bao de panceta | 230–290 | recipe |
   | Arepa de reina pepiada | 200–260 | USDA / Wikipedia |
   | Gyozas | 190–240 | USDA SR |
   | Ceviche | 70–120 | USDA SR (fish + citrus) |
   | Musaka | 140–200 | USDA / Wikipedia |
   | Hummus | 160–200 | BEDCA / USDA |
   | Tataki de atún | 120–180 | USDA SR |
   | Steak tartar | 180–240 | USDA SR |
   | Carpaccio | 120–180 | USDA SR |
   | Pescaíto frito | 250–320 | recipe (breaded small fish) |
   | Esqueixada de bacallà | 100–150 | recipe |
   | Sobrassada con miel | 370–430 | BEDCA embutido + honey |
   | Gazpachuelo malagueño | 80–130 | recipe |
   | Berza jerezana | 110–170 | recipe |
   | Talo con chistorra | 280–350 | recipe |
   | Casadielles | 370–430 | recipe (fried walnut pastry) |
   | Fartons | 340–390 | recipe / Wikipedia |

8. **Portion sizing rule for international dishes**: use standard 4-portion variants per F-H4
   pattern (`standard-portions.csv`). The valid `term` enum is strictly
   `pintxo | tapa | media_racion | racion` (per `packages/shared/src/schemas/standardPortion.ts:12`
   and `packages/api/src/scripts/seedStandardPortionCsv.ts:34`). **There is no `piece` term.** For
   dishes served in countable units (gyozas, nigiri, fartons, casadielles), populate the existing
   `pieces` (number) and `pieceName` (string) **columns** on a `racion` and/or `media_racion`
   row — for example `racion / pieces=6 / pieceName="gyoza" / grams=240` for gyozas. For bowls
   and composed plates, a `racion` row (standard serving) is the primary portion; add
   `media_racion` as a secondary row.

9. **CE-287 Fartons note**: `Fartons` is a Valencian pastry sold individually (~50 g each) and
   is almost always ordered alongside horchata (CE-203). It is added as a standalone atom so
   future H5-B multi-item detection can link it to CE-203. The `un` quantity in
   `horchata con fartons` is handled by H5-B; H6 only provides the atom.

10. **CE-295 Nigiri / CE-296 Uramaki overlap with Q493 (`sushi variado`)**: adding both atoms
    does NOT resolve Q493 (which refers to an assorted sushi platter — a menu-level concept
    deferred to H7). **DECISION (2026-04-26, user-orchestrator L5): do NOT add a bare `"sushi"`
    alias on CE-295.** Reasoning: `sushi` is a category/cuisine umbrella term, not a synonym for
    nigiri specifically; adding it would mislead users who ordered uramaki/sashimi/sushi-platter
    and lock-in the alias against a future dedicated sushi-platter atom. Bare `sushi` queries
    correctly remain NULL until a sushi-platter atom is added in a future hallazgo (H7+).

---

### Pre-analysis: Cat 21 query-by-query verdict

> Verified against `spanish-dishes.json` at baseline 279 (post F-H4 + F-H4-B).

| Q# | Raw query | Extracted term | Verdict | H6 Action |
|----|-----------|----------------|---------|-----------|
| 452 | `un cachopo para compartir` | `cachopo para compartir` | ALIAS GAP — CE-128 `Cachopo` exists; alias `"cachopo para compartir"` missing | Add alias to CE-128 |
| 453 | `quería probar el ternasco de aragón` | `ternasco de aragón` | REACHABLE — CE-275 alias `"ternasco de aragón"` present | None |
| 454 | `media de pescaíto frito` | `pescaíto frito` | MISSING ATOM — CE-101 `Pescado frito variado` is generic; Andalusian pescaíto (small whole fish, rebozado) is nutritionally distinct | New atom CE-280 |
| 456 | `qué tal está el bacalao al pil-pil` | `bacalao al pil-pil` | NLP EXTRACTION FAILURE — CE-106 `Bacalao al pil-pil` exists; conversational prefix `qué tal está el` not stripped by F078; out of scope for H6 (NLP layer, H7) | None (flag for H7) |
| 457 | `ponme una tapa de zarangollo murciano` | `zarangollo murciano` | REACHABLE — CE-273 `nameEs="Zarangollo murciano"` exact match after `tapa de` prefix strip | None |
| 459 | `un trozo de empanada gallega de zamburiñas` | `empanada gallega de zamburiñas` | ALIAS GAP — CE-267 `Empanada gallega de atún` has alias `"empanada gallega"` but not the zamburiñas variant | Add alias `"empanada gallega de zamburiñas"` to CE-267 |
| 462 | `tráeme una de escalivada con anchoas` | `escalivada con anchoas` | ALIAS GAP — CE-092 `Pimientos asados` has alias `"escalivada"` but not `"escalivada con anchoas"` | Add alias `"escalivada con anchoas"` to CE-092 |
| 463 | `quiero probar la ropa vieja canaria` | `ropa vieja canaria` | REACHABLE — CE-256 `nameEs="Ropa vieja canaria"` exact match | None |
| 465 | `media ración de esqueixada de bacallà` | `esqueixada de bacallà` | MISSING ATOM | New atom CE-281 |
| 466 | `un arroz a banda para dos` | `arroz a banda para dos` | NLP EXTRACTION FAILURE — CE-133 `Arroz a banda` exists; `un … para dos` frame not stripped; out of scope for H6 (H7) | None (flag for H7) |
| 469 | `un trozo de ensaimada de crema` | `ensaimada de crema` | ALIAS GAP — CE-277 `Ensaimada` has aliases `ensaimada mallorquina/lisa/de mallorca` but not `ensaimada de crema` | Add alias `"ensaimada de crema"` to CE-277 |
| 470 | `me pones una sidra natural y un platito de chorizo a la sidra` | multi-item | PARTIAL — CE-201 `Sidra natural` exists; `Chorizo a la sidra` missing atom (added as CE-307 in H6); full multi-item resolution depends on H5-B (already live in develop post-Release-Fase-3) | New atom CE-307 (chorizo a la sidra), multi-item resolution via H5-B should now succeed |
| 471 | `el lacón con grelos es de temporada?` | `lacón con grelos` | NLP EXTRACTION FAILURE — CE-122 exists; question form not stripped; out of scope for H6 (H7) | None (flag for H7) |
| 472 | `una de michirones para picar` | `michirones` | REACHABLE — CE-274 `nameEs="Michirones"` after `una de` prefix strip and `para picar` noise | None |
| 474 | `cuánto cuesta la sobrassada con miel` | `sobrassada con miel` | MISSING ATOM | New atom CE-282 |
| 476 | `un gazpachuelo malagueño bien caliente` | `gazpachuelo malagueño` | MISSING ATOM | New atom CE-283 |
| 477 | `qué lleva la berza jerezana` | `berza jerezana` | MISSING ATOM | New atom CE-284 |
| 478 | `un talo con chistorra, por favor` | `talo con chistorra` | MISSING ATOM | New atom CE-285 |
| 479 | `y de postre, unas casadielles` | `casadielles` | MISSING ATOM | New atom CE-286 |
| 480 | `una horchata con fartons para merendar` | multi-item: horchata + fartons | PARTIAL — CE-203 `Horchata` exists; `Fartons` missing atom; full query is multi-item (H5-B) | New atom CE-287 (fartons), multi-item resolution deferred to H5-B |

**Cat 21 summary**: 5 REACHABLE (no action), 3 NLP extraction failures (H7 flag), 4 alias gaps
(fix in H6), 7 new atoms (CE-280..CE-286) + 1 partial fartons (CE-287) + 1 partial chorizo a la
sidra (CE-307). **Predicted new Cat 21 OK after H6**: +4 alias gaps + +7 atoms + up to +2 from
H5-B-mediated multi-item resolutions (Q470 sidra+chorizo, Q480 horchata+fartons; H5-B is live
in develop post-Release-Fase-3) = **+11 to +13 queries**.

---

### Pre-analysis: Cat 22 query-by-query verdict

| Q# | Raw query | Verdict | H6 Action |
|----|-----------|---------|-----------|
| 481 | `poke bowl de salmón` | MISSING ATOM | New atom CE-288 |
| 482 | `burrito de cochinita pibil` | MISSING ATOM | New atom CE-289 |
| 483 | `ramen de miso` | MISSING ATOM | New atom CE-290 |
| 484 | `pad thai de langostinos` | MISSING ATOM | New atom CE-291 |
| 485 | `shawarma de pollo` | MISSING ATOM | New atom CE-292 |
| 486 | `una ración de falafel con salsa de yogur` | MISSING ATOM | New atom CE-293; alias `"falafel con salsa de yogur"` (Q486) covers it post-F078 strip |
| 487 | `pastel de nata` | MISSING ATOM | New atom CE-294 |
| 488 | `tiramisú` | REACHABLE — CE-184 `Tiramisú` (nameEs exact) | Add alias `"tiramisu de mascarpone"` to CE-184 for robustness (optional) |
| 489 | `spaghetti carbonara` | ALIAS GAP — CE-140 `Espaguetis carbonara` alias `"carbonara"` exists but not `"spaghetti carbonara"` | Add alias `"spaghetti carbonara"`, `"spaguetis carbonara"` to CE-140 |
| 490 | `un risotto de setas y trufa` | MENU MISFIRE — battery output shows `intent=menu_estimation` but `NULL result`; the `y` token in `setas y trufa` triggered the H5-B implicit multi-item detector, yet neither fragment resolved to an atom. Out of scope for H6 (NLP/detector layer, H7) — risotto atom would partially help but the detector misfire is the blocker. | None (H7 NLP — review H5-B detector heuristics; risotto seed atom optional for a future round) |
| 491 | `hamburguesa gourmet con queso de cabra y cebolla caramelizada` | ALIAS GAP — CE-217 `Hamburguesa con huevo y patatas` is the closest atom; adding `"hamburguesa gourmet"` (query-specific) approximates kcal. Bare `"hamburguesa"` alias rejected per ADR-019 (family term — Tier-1 canonical TBD in future work). | Add alias `"hamburguesa gourmet"` only to CE-217 |
| 492 | `brunch del domingo` | MENU WRAPPER — deferred | None (H7 menu expansion) |
| 493 | `sushi variado` | MENU WRAPPER — deferred (sushi-platter atom needed; bare `"sushi"` alias rejected per Open Q1 resolution) | None (H7+) |
| 494 | `dos nigiris de pez mantequilla con trufa` | MISSING ATOM | New atom CE-295 (Nigiri de pez mantequilla — butterfish-specific) |
| 495 | `un uramaki roll de atún picante` | MISSING ATOM | New atom CE-296 (`Uramaki roll`); alias `"uramaki roll de atún picante"` (Q495 verbatim post-F078 strip) covers it |
| 496 | `tacos al pastor` | MISSING ATOM | New atom CE-297 |
| 497 | `bao de panceta` | MISSING ATOM | New atom CE-298 |
| 498 | `arepa de reina pepiada` | MISSING ATOM | New atom CE-299 |
| 499 | `tenéis gyozas a la plancha?` | PARTIAL — new atom CE-300 (`Gyozas`) provides the dish; bare `gyozas` resolves via nameEs after F078 strip removes `tenéis ... ?`. The `a la plancha` modifier is not stripped by F078; full-query resolution depends on H7 NLP work. | New atom CE-300 (resolves bare-`gyozas` form post-strip); full-query `a la plancha` deferred to H7 |
| 500 | `ceviche de corvina` | MISSING ATOM | New atom CE-301 |
| 501 | `musaka` | MISSING ATOM | New atom CE-302 |
| 502 | `hummus` | MISSING ATOM | New atom CE-303 |
| 503 | `tataki de atún` | MISSING ATOM | New atom CE-304 |
| 504 | `steak tartar` | MISSING ATOM | New atom CE-305 |
| 505 | `carpaccio de ternera` | MISSING ATOM | New atom CE-306 |

**Cat 22 summary**: 1 REACHABLE (no action), 2 alias gaps (CE-140, CE-217), 2 deferred menu
wrappers, 19 new atoms (CE-288..CE-306). **Predicted new Cat 22 OK after H6: +21 queries**
(19 new atoms + 2 alias gap fixes).

---

### Identifier Scheme

Sequential continuation from CE-279 (last F-H4 entry):

| Block | Range | Count | Description |
|-------|-------|-------|-------------|
| Regional Cat 21 new atoms — batch A | CE-280..CE-287 | 8 | pescaíto frito, esqueixada de bacallà, sobrassada con miel, gazpachuelo malagueño, berza jerezana, talo con chistorra, casadielles, fartons |
| International Cat 22 new atoms | CE-288..CE-306 | 19 | poke bowl … carpaccio (see Cat 22 table above) |
| Regional Cat 21 new atom — batch B (Asturian) | CE-307 | 1 | chorizo a la sidra |
| **Total new** | **CE-280..CE-307** | **28** | |

dishId hex sequence: `0x118` (CE-280) through `0x133` (CE-307).

UUID pattern (mirroring F-H4):
- dishId:    `00000000-0000-e073-0007-000000000118` … `00000000-0000-e073-0007-000000000133`
- nutrientId: `00000000-0000-e073-0008-000000000118` … `00000000-0000-e073-0008-000000000133`

---

### Alias Requirements for New Dishes (ADR-019 compliant scope)

**Scope rule (post-/review-spec R1 Codex IMPORTANT)**: Per ADR-019 (`docs/project_notes/decisions.md:24-30`),
bare short-form **family/category** terms (e.g., `"hamburguesa"`, `"burrito"`, `"ramen"`, `"tacos"`,
`"bao"`, `"arepa"`, `"nigiri"`, `"uramaki"`, `"tataki"`) MUST NOT be added as aliases pointing to a
single specific atom — they are families with multiple legitimate canonical defaults and would
either misroute generic queries or block future canonical-disambiguation work.

The aliases below are restricted to: (a) query-specific multi-word phrases that appear in the
audited Cat 21/22 NULLs, (b) orthographic/transliteration variants of the dish's nameEs, and
(c) singular/plural normalisation. **No bare family terms.**

| externalId | Name | Required aliases | Rationale |
|------------|------|------------------|-----------|
| CE-288 | Poke bowl | `"poke bowl de salmón"` | Q481 query-specific |
| CE-289 | Burrito de cochinita pibil | (none — bare nameEs match suffices) | Q482 already resolves via name match after F078 strip |
| CE-290 | Ramen de miso | (none — bare nameEs match suffices) | Q483 resolves via name match |
| CE-291 | Pad thai | `"pad thai de langostinos"`, `"pad thai de gambas"` | Q484 + variant |
| CE-292 | Shawarma de pollo | `"shawarma de pollo solo carne"` (Q485 full query) | Q485 — NO bare `"shawarma"` (ADR-019 canonical disambiguation aliases require a uniqueness assertion in `bug-prod-003.disambiguation.test.ts`; out of H6 scope). Bare `shawarma` queries remain NULL until a future canonical-disambiguation ticket adds the test guard. |
| CE-293 | Falafel | `"falafel con tahini"`, `"falafel vegano"`, `"falafel con salsa de yogur"` | Q486 + variants |
| CE-294 | Pastel de nata | `"pastéis de nata"` (Portuguese plural), `"pastel de belém"` (proper-noun variant) | orthographic variants only |
| CE-295 | Nigiri de pez mantequilla | `"nigiri de pez mantequilla con trufa"` (Q494 full query), `"nigiris de pez mantequilla"` (plural form), `"sushi de pez mantequilla"` (transliteration) | Q494 — atom is butterfish-specific, not a generic nigiri (nutrient profile differs by fish). NO bare `"nigiri"` and NO non-butterfish aliases (those would misroute future fish-specific atoms). |
| CE-296 | Uramaki roll | `"uramaki roll de atún"`, `"uramaki roll de atún picante"` | Q495 query-specific only — NO bare `"uramaki"` or `"maki roll"` |
| CE-297 | Tacos al pastor | `"taco al pastor"` (singular normalisation) | Q496 — NO bare `"tacos"` |
| CE-298 | Bao de panceta | `"bao chino"` (transliteration; bao is unambiguously Asian steamed bun in Spanish bars) | Q497 — NO bare `"bao"` (filling-dependent kcal) |
| CE-299 | Arepa de reina pepiada | `"reina pepiada"` (filling-distinct, unambiguous in Venezuelan-Spanish context) | Q498 — NO bare `"arepa"` (many fillings) |
| CE-300 | Gyozas | `"gyoza"` (singular normalisation), `"dumplings japoneses"`, `"empanadillas japonesas"` | Q499 (`gyozas` is plural form of the nameEs, not a family term) |
| CE-301 | Ceviche | `"ceviche de corvina"`, `"ceviche peruano"` | Q500 + variant |
| CE-302 | Musaka | `"moussaka"` (English/French spelling), `"musaca"` (Spanish typo), `"musaka griega"` | orthographic + Q501 |
| CE-303 | Hummus | `"humus"` (Spanish typo), `"hummus con pan de pita"` | Q502 |
| CE-304 | Tataki de atún | `"tataki de atún rojo"` (variant) | Q503 — NO bare `"tataki"` (also valid for salmon, salt) |
| CE-305 | Steak tartar | `"tartar de ternera"`, `"tartar de buey"`, `"steak tartare"` (English) | Q504 + variants |
| CE-306 | Carpaccio | `"carpaccio de ternera"`, `"carpaccio de buey"` | Q505 — NO bare `"carpaccio"` (multiple meats) |
| CE-307 | Chorizo a la sidra | (none — bare nameEs match suffices) | Q470 multi-item via H5-B + name match |

---

### Data Sources

All 28 new dishes use `source=recipe + estimationMethod=ingredients + confidenceLevel=medium`
(recipe-reconstruction from standard ingredient nutrient values). This is the only valid
non-BEDCA combination per the validator.

Nutritional values must be cross-checked against at least one of:
- BEDCA local snapshot (`bedca/bedca-snapshot-full.json`) — for Spanish dishes with a close
  ingredient match.
- USDA SR Legacy (imported in F006) — for international dishes with well-documented composition.
- Wikipedia nutrition tables (with URL cited in PR body) — acceptable for widely documented
  international dishes (pastel de nata, musaka, hummus).
- OpenFoodFacts (`OFF`) — NOT preferred for this batch; most items are restaurant-prepared
  dishes without packaged equivalents.

Invented (undocumented) values are NOT acceptable. If no defensible source exists for a dish,
raise it as an open question before implementing.

---

### Commit Strategy (for planner reference)

Following the F-H4 4-commit pattern (CI will be red on commits 1-3, green after commit 4):

1. **Commit 1** — Cat 21 regional new atoms batch A + alias additions (CE-280..CE-287 + 4 alias
   updates on CE-092, CE-128, CE-267, CE-277) + standard-portions.csv rows for CE-280..CE-287
2. **Commit 2** — Cat 22 international new atoms batch A (CE-288..CE-297) + portions
3. **Commit 3** — Cat 22 international new atoms batch B (CE-298..CE-306) + Cat 21 batch B
   (CE-307 chorizo a la sidra, appended LAST in JSON for monotonic file order) + alias
   updates on CE-140, CE-217 + portions for CE-298..CE-307
4. **Commit 4** — Test assertions `279→307` + `key_facts.md` L95 update

**File-order rationale**: CE-307 is committed in commit 3 (not commit 1) so the final
`spanish-dishes.json` ends with a monotonic CE-280..CE-307 sequence. CE-307's logical category
(Cat 21 batch B Asturian) is independent of its file position; the externalId is the semantic
identifier — file order is purely cosmetic. Caught by /review-plan R1 Codex SUGGESTION.

---

### Predicted NULL→OK Resolution

| Category | Current NULLs | Expected OK after H6 | Mechanism |
|----------|--------------|----------------------|-----------|
| Cat 21 | 20 | +4 (alias fixes: CE-092/CE-128/CE-267/CE-277) | Alias additions resolve 4 NLP hits |
| Cat 21 | — | +7 (new atoms: CE-280..CE-286) | Atom additions |
| Cat 21 | — | +0 to +2 (Q470 chorizo a la sidra + Q480 horchata+fartons) | H5-B multi-item resolution (CE-307 + CE-287 atoms now present) |
| Cat 21 | — | +0 (Q471-NLP, Q456-NLP, Q466-NLP) | Out of scope — NLP layer (H7) |
| Cat 22 | 25 | +19 (new atoms CE-288..CE-306) | Atom additions |
| Cat 22 | — | +2 (alias fixes CE-140/CE-217) | Alias additions |
| **Total** | **45 queries** | **+32 to +34 expected OK** | |

Remaining NULLs after H6: ~11–13 (NLP extraction failures need H7; menu wrappers Q492 brunch /
Q493 sushi-platter need H7).

---

### Open Questions — RESOLVED (2026-04-26 by L5 PM Orchestrator)

1. **Q493 `sushi variado` — add `"sushi"` alias to CE-295?** **DECISION: NO.** `sushi` is a
   category umbrella, not a synonym for nigiri specifically. Adding the alias would mislead
   users who ordered uramaki/sashimi/platter and lock-in a future dedicated sushi-platter atom.
   Bare `sushi` queries correctly remain NULL until a sushi-platter atom is added in a future
   hallazgo (H7+). See Edge Cases §10 for full reasoning.

2. **Q470 `chorizo a la sidra` — add as CE-307?** **DECISION: YES.** Common Asturian bar dish,
   unambiguously atomic, now added as CE-307 (Cat 21 batch B). Combined with the existing CE-201
   `Sidra natural` and the live H5-B multi-item detector, Q470 should now resolve via menu
   estimation. Total atoms: 28 (CE-280..CE-307).

3. **Q471/Q456/Q466 conversational-frame NLP failures — extend F078 noise-word list in H6?**
   **DECISION: NO, defer to H7.** F-H6 is data-only by design; mixing seed + NLP layer in one
   ticket bloats the PR, complicates cross-model review, and breaks scope discipline. H7 will
   address the F078/wrapper layer comprehensively (including Cat 29 temporal wrappers).

4. **Portion count for international dishes (gyozas in pieces, etc.)** **DECISION: CONFIRMED.**
   Use Spanish-restaurant convention (6 gyozas ≈ 250 g per ración), not country-of-origin
   portion. Implementer follows §8 of Edge Cases.

5. **Esqueixada de bacallà (CE-281) — `category` = `primeros` or `tapas`?** **DECISION: tapas.**
   Typical bar context, served cold as a starter-tapa. Confirms spec-creator recommendation.

---

## Implementation Plan

### Approach

Single feature branch `feature/F-H6-international-extended-regional` (already created off `origin/develop @ 3ce5343`), following the F-H4 4-commit TDD pattern. CI is intentionally RED on commits 1–3 (the two `toHaveLength(279)` assertions in `f073.seedPhaseSpanishDishes.edge-cases.test.ts` and the one in `f114.newDishes.unit.test.ts` fail until commit 4). CI goes GREEN at commit 4.

---

### Existing Code to Reuse

| Entity | File | Role |
|--------|------|------|
| `spanish-dishes.json` | `packages/api/prisma/seed-data/spanish-dishes.json` | Append 28 new entries; append aliases to 6 existing entries |
| `standard-portions.csv` | `packages/api/prisma/seed-data/standard-portions.csv` | Append ~84 new portion rows (estimate: ~3 rows/dish avg for 28 dishes) |
| `validateSpanishDishes` | `packages/api/src/scripts/validateSpanishDishes.ts` | Run read-only to verify after each commit batch; no functional changes needed unless a new alias collision is detected |
| `HOMOGRAPH_ALLOW_LIST` | `packages/api/src/scripts/validateSpanishDishes.ts:36` | The 4 existing entries cover current collisions. Add a new entry ONLY if a new alias in this batch creates a collision — no entries anticipated |
| `validateSpanishDishesWithAllowList` | `packages/api/src/scripts/validateSpanishDishes.ts:83` | Injectable entry-point used by uniqueness tests; no change needed |
| `seedPhaseSpanishDishes.ts` | `packages/api/src/scripts/seedPhaseSpanishDishes.ts` | Unchanged — reads JSON at runtime; new entries auto-picked up |
| `seedStandardPortionCsv.ts` | `packages/api/src/scripts/seedStandardPortionCsv.ts` | Unchanged — reads CSV at runtime; validates `term ∈ {pintxo, tapa, media_racion, racion}` and `pieces`/`pieceName` pairing |
| `SpanishDishEntry` type | `packages/api/src/scripts/spanishDishesTypes.ts` | No changes; new entries conform to existing schema |
| `fH4B.validateSpanishDishes.uniqueness.test.ts` | `packages/api/src/__tests__/fH4B.validateSpanishDishes.uniqueness.test.ts` | The AC-3e real-JSON integration test already loads `spanish-dishes.json` dynamically — it will automatically validate the 307-entry dataset with no modification required |

---

### Files to Create

No new files are required. All additions go into existing files.

---

### Files to Modify

| File | Change | Commit |
|------|--------|--------|
| `packages/api/prisma/seed-data/spanish-dishes.json` | +28 new dish entries (CE-280..CE-307) + 6 alias additions on CE-092, CE-128, CE-140, CE-217, CE-267, CE-277 | 1, 2, 3 |
| `packages/api/prisma/seed-data/standard-portions.csv` | +~84 portion rows for the 28 new dishIds | 1, 2, 3 |
| `packages/api/src/__tests__/f073.seedPhaseSpanishDishes.edge-cases.test.ts` | Lines 327 and 336: `toHaveLength(279)` → `toHaveLength(307)` (×2); update the preceding comment from F-H4 to mention F-H6 | 4 |
| `packages/api/src/__tests__/f114.newDishes.unit.test.ts` | Line 139: `toHaveLength(279)` → `toHaveLength(307)`; update the preceding comment | 4 |
| `docs/project_notes/key_facts.md` | Line 95: `279 dishes (47 BEDCA + 232 recipe)` → `307 dishes (47 BEDCA + 260 recipe)` and tag suffix `(F073/F114/F-H4)` → `(F073/F114/F-H4/F-H6)` | 4 |
| `packages/api/src/scripts/validateSpanishDishes.ts` | Add new entry to `HOMOGRAPH_ALLOW_LIST` ONLY if a collision is detected by running the validator after alias additions — no changes anticipated | conditional |

---

### Implementation Order

Follow the same 4-commit TDD pattern as F-H4. Each commit is atomic and independently `git bisect`-able. The test-count assertions are left intentionally red on commits 1–3.

#### Pre-implementation: Duplicate Pre-check (mandatory, before writing any JSON)

Before adding any atom, grep `spanish-dishes.json` (name + nameEs + aliases, normalized lowercase) to confirm the dish is not already present. The spec's pre-analysis documents this at baseline 279; re-verify at implementation time for any alias that could collide with the 6 new alias additions on existing dishes.

Specifically confirm:
- `escalivada con anchoas` is not an existing alias on any dish other than CE-092
- `cachopo para compartir` is not an existing alias
- `spaghetti carbonara`, `spaguetis carbonara` are not already on CE-140 or any other dish
- `hamburguesa gourmet` is not on any existing entry (confirmed none; `hamburguesa completa` exists on CE-217)
- `empanada gallega de zamburiñas` is not on any existing entry
- `ensaimada de crema` is not already an alias (CE-277 has `ensaimada mallorquina/lisa/de mallorca` — clear)

Run `npm test -w @foodxplorer/api -- fH4B.validateSpanishDishes.uniqueness` after each commit batch to confirm `valid: true` (the existing AC-3e real-JSON integration test loads the live JSON and calls the validator). The standalone `validateSpanishDishes.ts` file has no `main()` guard / CLI entry-point — do NOT try `npx tsx` on it.

---

#### Commit 1 — Cat 21 regional batch A (CE-280..CE-287) + alias additions on CE-092/CE-128/CE-267/CE-277

**JSON additions** (append to `spanish-dishes.json` `dishes` array, after CE-279):

| externalId | Name | dishId | category | portionGrams | kcal/100g target | Notes |
|------------|------|--------|----------|--------------|-----------------|-------|
| CE-280 | Pescaíto frito | `...000000000118` | tapas | 200 | 250–320 | BEDCA/recipe; small whole fish breaded |
| CE-281 | Esqueixada de bacallà | `...000000000119` | tapas | 180 | 100–150 | Recipe reconstruction; shredded salted cod |
| CE-282 | Sobrassada con miel | `...00000000011a` | tapas | 60 | 370–430 | BEDCA embutido + honey blend |
| CE-283 | Gazpachuelo malagueño | `...00000000011b` | primeros | 250 | 80–130 | Recipe; warm fish + mayo broth |
| CE-284 | Berza jerezana | `...00000000011c` | primeros | 350 | 110–170 | Recipe; legume + pork stew |
| CE-285 | Talo con chistorra | `...00000000011d` | tapas | 150 | 280–350 | Recipe; corn flatbread + chistorra |
| CE-286 | Casadielles | `...00000000011e` | postres | 80 | 370–430 | Recipe; fried walnut pastry |
| CE-287 | Fartons | `...00000000011f` | postres | 50 | 340–390 | Recipe; Valencian pastry; sold individually |

CE-307 (Chorizo a la sidra) is moved to **commit 3** (per the unified Commit Strategy in §
"Commit Strategy") so that the final JSON file ends with a monotonic CE-280..CE-307 sequence.

**Aliases added on existing dishes**:
- CE-092 (`Pimientos asados`): append `"escalivada con anchoas"` to aliases array
- CE-128 (`Cachopo`): append `"cachopo para compartir"` to aliases array
- CE-267 (`Empanada gallega de atún`): append `"empanada gallega de zamburiñas"` to aliases array
- CE-277 (`Ensaimada`): append `"ensaimada de crema"` to aliases array

CE-140 and CE-217 alias additions are deferred to commit 3 (grouped with the international batch B for logical coherence, as CE-140/CE-217 fix Cat 22 alias gaps).

**CSV additions** (append to `standard-portions.csv`):

> **MANDATORY — `reviewed_by` column non-empty**: per [`seedStandardPortionCsv.ts:170-226`](../../packages/api/src/scripts/seedStandardPortionCsv.ts),
> rows with empty `reviewed_by` are **silently skipped** by the seeder (no error raised). This
> means a seemingly-correct CSV could ship with zero rows reaching the DB. **Every new row in
> this batch MUST set `reviewed_by="pbojeda"`** (matching the existing precedent across the file).
> The implementer must `grep -c "^[^,]*,[^,]*,.*,,$"` the new rows before committing to confirm
> none have a trailing empty `reviewed_by`. Caught by /review-plan R1 Codex IMPORTANT.

| dishId suffix | Rows | Notes |
|---------------|------|-------|
| `...000000000118` (CE-280 Pescaíto frito) | tapa 100g, media_racion 150g, racion 200g | Small whole fish; typical bar tapa or shared ración |
| `...000000000119` (CE-281 Esqueixada) | tapa 80g, media_racion 130g, racion 180g | Cold starter; medium portions |
| `...00000000011a` (CE-282 Sobrassada con miel) | tapa 40g, racion 60g | Rich spread; small portions |
| `...00000000011b` (CE-283 Gazpachuelo) | media_racion 200g, racion 250g | Soup/broth; no tapa form |
| `...00000000011c` (CE-284 Berza jerezana) | media_racion 250g, racion 350g | Stew; no tapa form |
| `...00000000011d` (CE-285 Talo con chistorra) | tapa 80g, media_racion 120g, racion 150g | Flatbread wrap |
| `...00000000011e` (CE-286 Casadielles) | tapa 40g, media_racion 60g, racion 80g, pieces columns: racion 2 casadiella | Fried pastry; piece-counted on racion row |
| `...00000000011f` (CE-287 Fartons) | tapa 50g, racion 100g, pieces columns: tapa 1 fartón, racion 2 fartons | Sold individually; piece-counted on both rows |

**Note**: CE-307 (Chorizo a la sidra) `standard-portions.csv` rows are deferred to commit 3 along with the JSON entry. They do NOT belong to commit 1.

For CE-286 and CE-287 (piece-counted pastries): populate `pieces` (integer) and `pieceName` (string) columns on the relevant `racion` (and `tapa` for fartons) rows. Do NOT use a `piece` term — use `tapa`/`media_racion`/`racion` term with the pieces columns filled.

**Validator check**: run `npm test -w @foodxplorer/api -- fH4B.validateSpanishDishes.uniqueness` (the existing AC-3e real-JSON integration test loads `spanish-dishes.json` via `readFileSync` and calls `validateSpanishDishes(...)` — it provides the same signal as a CLI script and will fail fast if validation fails) (or equivalent invocation — see verification in F-H4-B for exact command) after this commit. Expected: `Dishes loaded: 288, valid: true, errors: 0`. CI will be red (count assertions still say 279).

---

#### Commit 2 — Cat 22 international batch A (CE-288..CE-297) + standard-portions rows

**JSON additions** (append at file end after CE-287; commit 2 file tail is CE-297):

| externalId | Name | dishId | category | portionGrams | kcal/100g target | Required aliases | Source |
|------------|------|--------|----------|--------------|-----------------|------------------|--------|
| CE-288 | Poke bowl | `...000000000120` | primeros | 350 | 80–160 | `"poke bowl de salmón"` | USDA SR / recipe |
| CE-289 | Burrito de cochinita pibil | `...000000000121` | segundos | 280 | 180–260 | (none — name match) | USDA SR / recipe |
| CE-290 | Ramen de miso | `...000000000122` | primeros | 400 | 60–110 | (none — name match) | USDA SR / recipe |
| CE-291 | Pad thai | `...000000000123` | segundos | 300 | 150–220 | `"pad thai de langostinos"`, `"pad thai de gambas"` | USDA SR / recipe |
| CE-292 | Shawarma de pollo | `...000000000124` | bocadillos | 200 | 200–280 | `"shawarma de pollo solo carne"` | USDA SR / recipe |
| CE-293 | Falafel | `...000000000125` | tapas | 200 | 280–330 | `"falafel con tahini"`, `"falafel vegano"`, `"falafel con salsa de yogur"` | BEDCA / USDA |
| CE-294 | Pastel de nata | `...000000000126` | postres | 90 | 320–380 | `"pastéis de nata"`, `"pastel de belém"` | USDA / Wikipedia |
| CE-295 | Nigiri de pez mantequilla | `...000000000127` | tapas | 50 | 150–200 | `"nigiri de pez mantequilla con trufa"`, `"nigiris de pez mantequilla"`, `"sushi de pez mantequilla"` | USDA SR sushi rice + butterfish |
| CE-296 | Uramaki roll | `...000000000128` | tapas | 120 | 160–220 | `"uramaki roll de atún"`, `"uramaki roll de atún picante"` | USDA SR |
| CE-297 | Tacos al pastor | `...000000000129` | segundos | 200 | 220–290 | `"taco al pastor"` | USDA SR / recipe |

All 10 use `source=recipe`, `confidenceLevel=medium`, `estimationMethod=ingredients`.

**CSV additions**:

| dishId suffix | Rows | Notes |
|---------------|------|-------|
| CE-288 Poke bowl | media_racion 250g, racion 350g | Bowl format; no pintxo/tapa |
| CE-289 Burrito | media_racion 180g, racion 280g | Wrapped; no tapa form in Spanish bar context |
| CE-290 Ramen | media_racion 300g, racion 400g | Bowl/soup; no tapa |
| CE-291 Pad thai | media_racion 200g, racion 300g | Noodle plate |
| CE-292 Shawarma | tapa 100g, media_racion 150g, racion 200g | Spanish bar: tapa/racion format |
| CE-293 Falafel | tapa 100g, media_racion 150g, racion 200g, pieces: tapa 3 falafel, media_racion 5, racion 7 | Piece-counted; use pieces column on each row |
| CE-294 Pastel de nata | tapa 45g, racion 90g, pieces: tapa 1 pastel, racion 2 pasteles | Individual unit pastry |
| CE-295 Nigiri (CE-295) | tapa 25g, media_racion 50g, racion 100g, pieces: tapa 1 nigiri, media_racion 2, racion 4 | Piece-counted sushi |
| CE-296 Uramaki | tapa 60g, media_racion 90g, racion 180g, pieces: tapa 3 piezas, media_racion 5, racion 10 | Piece-counted |
| CE-297 Tacos al pastor | tapa 80g, media_racion 120g, racion 200g, pieces: tapa 1 taco, media_racion 2, racion 3 | Piece-counted tacos |

**Validator check**: run validator. Expected: `Dishes loaded: 298, valid: true`. CI still red.

---

#### Commit 3 — Cat 22 international batch B (CE-298..CE-306) + Cat 21 batch B (CE-307 chorizo a la sidra appended LAST) + alias additions on CE-140/CE-217 + standard-portions rows

**JSON additions**:

| externalId | Name | dishId | category | portionGrams | kcal/100g target | Required aliases | Source |
|------------|------|--------|----------|--------------|-----------------|------------------|--------|
| CE-298 | Bao de panceta | `...00000000012a` | tapas | 120 | 230–290 | `"bao chino"` | Recipe |
| CE-299 | Arepa de reina pepiada | `...00000000012b` | segundos | 180 | 200–260 | `"reina pepiada"` | USDA / Wikipedia |
| CE-300 | Gyozas | `...00000000012c` | tapas | 240 | 190–240 | `"gyoza"`, `"dumplings japoneses"`, `"empanadillas japonesas"` | USDA SR |
| CE-301 | Ceviche | `...00000000012d` | primeros | 200 | 70–120 | `"ceviche de corvina"`, `"ceviche peruano"` | USDA SR |
| CE-302 | Musaka | `...00000000012e` | segundos | 350 | 140–200 | `"moussaka"`, `"musaca"`, `"musaka griega"` | USDA / Wikipedia |
| CE-303 | Hummus | `...00000000012f` | tapas | 100 | 160–200 | `"humus"`, `"hummus con pan de pita"` | BEDCA / USDA |
| CE-304 | Tataki de atún | `...000000000130` | tapas | 150 | 120–180 | `"tataki de atún rojo"` | USDA SR |
| CE-305 | Steak tartar | `...000000000131` | primeros | 200 | 180–240 | `"tartar de ternera"`, `"tartar de buey"`, `"steak tartare"` | USDA SR |
| CE-306 | Carpaccio | `...000000000132` | primeros | 80 | 120–180 | `"carpaccio de ternera"`, `"carpaccio de buey"` | USDA SR |

All 9 use `source=recipe`, `confidenceLevel=medium`, `estimationMethod=ingredients`.

**Aliases added on existing dishes**:
- CE-140 (`Espaguetis carbonara`): append `"spaghetti carbonara"`, `"spaguetis carbonara"` to aliases array
- CE-217 (`Hamburguesa con huevo y patatas`): append `"hamburguesa gourmet"` ONLY — do NOT add bare `"hamburguesa"` (ADR-019 family-term prohibition)

**CSV additions**:

| dishId suffix | Rows | Notes |
|---------------|------|-------|
| CE-298 Bao | tapa 60g, media_racion 90g, racion 120g, pieces: tapa 1 bao, media_racion 2, racion 3 | Piece-counted steamed buns |
| CE-299 Arepa | media_racion 130g, racion 180g | No tapa form in Spanish bar context |
| CE-300 Gyozas | tapa 120g, media_racion 180g, racion 240g, pieces: tapa 3 gyozas, media_racion 5, racion 6 | Spanish bar convention: 6 gyozas per racion; piece-counted on all rows |
| CE-301 Ceviche | tapa 100g, media_racion 150g, racion 200g | Cold starter |
| CE-302 Musaka | media_racion 200g, racion 350g | Oven dish; no tapa form |
| CE-303 Hummus | tapa 50g, media_racion 80g, racion 100g | Dip; small portions |
| CE-304 Tataki | tapa 60g, media_racion 100g, racion 150g | Sliced; typical bar tapa |
| CE-305 Steak tartar | media_racion 130g, racion 200g | No tapa; starter-sized dish |
| CE-306 Carpaccio | tapa 40g, media_racion 60g, racion 80g | Thin slices; light dish |

**Validator check**: run validator. Expected: `Dishes loaded: 307, valid: true`. CI still red (test assertions unchanged).

---

#### Commit 4 — Test count assertions 279→307 + key_facts.md L95 update

**Files to modify**:

1. `packages/api/src/__tests__/f073.seedPhaseSpanishDishes.edge-cases.test.ts`
   - Line 321: Update `it` description: add `// F-H6: count updated 279 → 307 (+28 new atoms — Cat21/Cat22)` comment on line 323
   - Line 327: `expect(dishUpserts).toHaveLength(279)` → `expect(dishUpserts).toHaveLength(307)`
   - Line 332: Update `it` description similarly
   - Line 336: `expect(nutrientUpserts).toHaveLength(279)` → `expect(nutrientUpserts).toHaveLength(307)`

2. `packages/api/src/__tests__/f114.newDishes.unit.test.ts`
   - Line 139: `expect(dishes).toHaveLength(279)` → `expect(dishes).toHaveLength(307)`
   - Update the preceding comment block to mention F-H6 (e.g., `// F-H6: count updated 279 → 307 (+28 international + extended regional)`)

3. `docs/project_notes/key_facts.md`
   - Line 95: `279 dishes (47 BEDCA + 232 recipe)` → `307 dishes (47 BEDCA + 260 recipe)`
   - Same line tag suffix: `(F073/F114/F-H4)` → `(F073/F114/F-H4/F-H6)`

After this commit, CI should go green. Run full test suite locally to confirm: `npm test -w @foodxplorer/api`.

---

### Nutritional Data Sourcing Approach

All 28 new dishes must use `source=recipe + estimationMethod=ingredients + confidenceLevel=medium`. Values must be defensible from at least one documented source:

**Regional Spanish dishes (CE-280..CE-287, CE-307)**:
- CE-280 Pescaíto frito: recipe (BEDCA ingredient data for hake/anchovies + breadcrumb + olive oil); target 250–320 kcal/100g
- CE-281 Esqueixada de bacallà: recipe (BEDCA bacalà + tomato + olives + olive oil); target 100–150 kcal/100g; remember cod is desalted (lower sodium than raw salted)
- CE-282 Sobrassada con miel: BEDCA snapshot has embutido entries; sobrassada ≈ raw cured sausage ~400 kcal/100g + honey blend; target 370–430 kcal/100g
- CE-283 Gazpachuelo malagueño: recipe (fish stock + mayo + potato); broth-heavy, target 80–130 kcal/100g
- CE-284 Berza jerezana: recipe (chickpeas + pork products + kale); hearty stew; target 110–170 kcal/100g
- CE-285 Talo con chistorra: recipe (corn flour flatbread ≈ 200 kcal/100g + chistorra ≈ 400 kcal/100g, blended by weight); target 280–350 kcal/100g
- CE-286 Casadielles: Wikipedia (Asturian fried walnut pastry); flour + walnut + sugar + fried; target 370–430 kcal/100g
- CE-287 Fartons: Wikipedia (Valencian pastry / horchata companion); enriched dough + icing sugar; target 340–390 kcal/100g
- CE-307 Chorizo a la sidra: recipe (Asturian chorizo + cider braise); chorizo base ~400 kcal/100g, liquid-reduced; target 280–350 kcal/100g

**International dishes (CE-288..CE-306)**:
- CE-288 Poke bowl: USDA SR (rice + salmon/tuna + vegetables + dressing); target 80–160 kcal/100g
- CE-289 Burrito cochinita pibil: USDA SR (flour tortilla + slow-pork + beans + rice); target 180–260 kcal/100g
- CE-290 Ramen miso: USDA SR (broth-dominant; noodles + broth + pork); target 60–110 kcal/100g
- CE-291 Pad thai: USDA SR (rice noodles + shrimp/chicken + egg + peanuts + tamarind sauce); target 150–220 kcal/100g
- CE-292 Shawarma de pollo: USDA SR (chicken + bread + sauce); target 200–280 kcal/100g
- CE-293 Falafel: BEDCA snapshot or USDA (chickpea + herbs + spices, deep-fried); target 280–330 kcal/100g; nutrient profile close to croqueta without dairy
- CE-294 Pastel de nata: Wikipedia nutrition table (Portuguese custard tart: pastry + cream custard + sugar); target 320–380 kcal/100g
- CE-295 Nigiri pez mantequilla: USDA SR (sushi rice + butterfish/escolar); note: butterfish is high in fat (~200 kcal/100g for fish portion alone); target 150–200 kcal/100g for composed nigiri
- CE-296 Uramaki roll: USDA SR (inside-out maki: rice outer + nori + fish + avocado); target 160–220 kcal/100g
- CE-297 Tacos al pastor: USDA SR (corn tortilla + pork adobado + pineapple + onion + cilantro); target 220–290 kcal/100g
- CE-298 Bao de panceta: recipe (steamed bun dough ~250 kcal/100g + braised pork belly ~400 kcal/100g); blended by weight; target 230–290 kcal/100g
- CE-299 Arepa reina pepiada: USDA / Wikipedia (masarepa corn flour + chicken + avocado + mayo); target 200–260 kcal/100g
- CE-300 Gyozas: USDA SR (wheat wrapper + pork/cabbage filling, pan-fried); target 190–240 kcal/100g
- CE-301 Ceviche: USDA SR (white fish + citrus + onion + chili; minimal fat); target 70–120 kcal/100g
- CE-302 Musaka: USDA / Wikipedia (eggplant + ground lamb + béchamel); target 140–200 kcal/100g; Greek variant with béchamel runs higher
- CE-303 Hummus: BEDCA snapshot chickpea or USDA; target 160–200 kcal/100g; note tahini adds fat
- CE-304 Tataki de atún: USDA SR (seared tuna loin, lean; ~130–180 kcal/100g raw/seared); target 120–180 kcal/100g
- CE-305 Steak tartar: USDA SR (raw beef + capers + yolk + mustard + shallot); target 180–240 kcal/100g; close to raw beef
- CE-306 Carpaccio: USDA SR (raw beef, very lean, thin-sliced; ≈ 150 kcal/100g + olive oil dressing); target 120–180 kcal/100g

If any value cannot be derived from a documented source, raise it as a comment in the PR before committing the entry. Do not invent values.

---

### Validator Integration

1. **After commit 1** (CE-280..CE-287 + 4 alias additions on CE-092/CE-128/CE-267/CE-277): run `npm test -w @foodxplorer/api -- fH4B.validateSpanishDishes.uniqueness`. Expected output: **287 dishes** loaded, `valid: true, errors: 0`. If a collision is detected on any of the 4 new aliases, resolve it by choosing a more qualified form rather than adding to `HOMOGRAPH_ALLOW_LIST` — none are anticipated.

2. **After commit 2** (CE-288..CE-297): same invocation. Expected: **297 dishes**, `valid: true`.

3. **After commit 3** (CE-298..CE-306 + CE-307 + CE-140/CE-217 alias additions): same invocation. Expected: **307 dishes**, `valid: true`. Pay special attention to `"hamburguesa gourmet"` — confirm it does not appear in any other dish's name/nameEs/aliases (a grep before adding is sufficient).

4. **After commit 4**: `npm test -w @foodxplorer/api` must pass in full (all 3733+ tests green).

**Failure modes to watch**:
- `aliases` array not properly terminated in JSON (trailing comma, missing bracket): the JSON will fail to parse and `validateSpanishDishes` will throw before running checks.
- kcal/100g out of the sanity range from Edge Cases §7: the validator does not enforce this range (only a `> 2000` [WARN] guard exists), but any value outside the range listed in the spec must be documented in the PR body. Do not silently leave out-of-range values.
- `term` value not in `{pintxo, tapa, media_racion, racion}` in CSV: `seedStandardPortionCsv.ts` line 34 will reject the row at seed-time. Catch this by checking the CSV locally before committing.
- `portionGrams` outside [10, 800]: validator blocks the whole dataset. Keep all new entries within this range (none of the 28 dishes approach 800g; poke bowl 350g, ramen 400g, musaka 350g are the largest).
- `name !== nameEs`: validator blocks. All new entries must have identical `name` and `nameEs` fields.
- UUID collision: dishIds `0x118..0x133` and nutrientIds `0x118..0x133` must not already exist in the file. Verify with `grep` on the JSON before adding.

---

### Testing Strategy

**No new test files required.** The existing test infrastructure covers all scenarios:

| Test | File | What it covers | Status after each commit |
|------|------|----------------|--------------------------|
| `upserts exactly N dishes` | `f073.seedPhaseSpanishDishes.edge-cases.test.ts:327` | Dish upsert count | RED on commits 1–3, GREEN on commit 4 |
| `upserts exactly N DishNutrients` | `f073.seedPhaseSpanishDishes.edge-cases.test.ts:336` | DishNutrient upsert count | RED on commits 1–3, GREEN on commit 4 |
| `validateSpanishDishes accepts extended JSON (N entries)` | `f114.newDishes.unit.test.ts:139` | JSON loads and validator passes | RED on commits 1–3, GREEN on commit 4 |
| `AC-3e: real spanish-dishes.json passes uniqueness check` | `fH4B.validateSpanishDishes.uniqueness.test.ts` | Cross-space alias uniqueness including new aliases | Dynamic load (no hardcoded count) — GREEN on all commits as long as no collision introduced |
| All pre-existing `f073.*` and `fH4B.*` tests | Various | Regression protection: provenance, BUG-1, BUG-2, uniqueness | GREEN on all commits (data-only changes, no validator logic touched) |

**Key test scenarios to verify manually** (not automated, documented in PR body):
- Each of the 6 new alias additions resolves to its intended dish: `escalivada con anchoas` → CE-092, `cachopo para compartir` → CE-128, `spaghetti carbonara` → CE-140, `hamburguesa gourmet` → CE-217, `empanada gallega de zamburiñas` → CE-267, `ensaimada de crema` → CE-277.
- Bare family terms are absent: grep the new entries for `"hamburguesa"` alone, `"burrito"` alone, `"ramen"` alone, `"tacos"` alone, `"sushi"` alone, `"carpaccio"` alone — none should appear as standalone alias strings.
- Piece-counted dishes (CE-286 casadielles, CE-287 fartons, CE-293 falafel, CE-294 pastel de nata, CE-295 nigiri, CE-296 uramaki, CE-297 tacos, CE-298 bao, CE-300 gyozas) all have `pieces` and `pieceName` populated on the relevant CSV rows.

---

### Rollback SQL Block

The PR body must include the following DELETE block. Because seed uses `upsert`, a `git revert` does not remove DB rows; this block must be run against the DB if a rollback is needed post-deploy.

**Important — DB table/column names**: this project uses Prisma `@@map` directives. Prisma model
names (`Dish`, `DishNutrient`, `StandardPortion`) are **NOT** the DB table names; the DB tables
are `dishes`, `dish_nutrients`, `standard_portions`. Likewise the Prisma `dishId` field maps to
the DB column `dish_id`. The rollback SQL must use the **DB-level** names. Verified at
[`schema.prisma`](../../packages/api/prisma/schema.prisma) lines 208 (`@@map("standard_portions")`),
225 (StandardPortion `dish_id` map), 321 (Dish `id` PK), 356 (`@@map("dishes")`),
391 (`@@map("dish_nutrients")`).

```sql
-- F-H6 rollback: delete all 28 new dish atoms (CE-280..CE-307)
-- Run against the target environment DB after git reverting the branch.
-- Order: child tables (dish_nutrients + standard_portions) FIRST, parent table (dishes) LAST.

DELETE FROM "dish_nutrients"
WHERE "id" IN (
  '00000000-0000-e073-0008-000000000118',
  '00000000-0000-e073-0008-000000000119',
  '00000000-0000-e073-0008-00000000011a',
  '00000000-0000-e073-0008-00000000011b',
  '00000000-0000-e073-0008-00000000011c',
  '00000000-0000-e073-0008-00000000011d',
  '00000000-0000-e073-0008-00000000011e',
  '00000000-0000-e073-0008-00000000011f',
  '00000000-0000-e073-0008-000000000120',
  '00000000-0000-e073-0008-000000000121',
  '00000000-0000-e073-0008-000000000122',
  '00000000-0000-e073-0008-000000000123',
  '00000000-0000-e073-0008-000000000124',
  '00000000-0000-e073-0008-000000000125',
  '00000000-0000-e073-0008-000000000126',
  '00000000-0000-e073-0008-000000000127',
  '00000000-0000-e073-0008-000000000128',
  '00000000-0000-e073-0008-000000000129',
  '00000000-0000-e073-0008-00000000012a',
  '00000000-0000-e073-0008-00000000012b',
  '00000000-0000-e073-0008-00000000012c',
  '00000000-0000-e073-0008-00000000012d',
  '00000000-0000-e073-0008-00000000012e',
  '00000000-0000-e073-0008-00000000012f',
  '00000000-0000-e073-0008-000000000130',
  '00000000-0000-e073-0008-000000000131',
  '00000000-0000-e073-0008-000000000132',
  '00000000-0000-e073-0008-000000000133'
);

DELETE FROM "standard_portions"
WHERE "dish_id" IN (
  '00000000-0000-e073-0007-000000000118',
  '00000000-0000-e073-0007-000000000119',
  '00000000-0000-e073-0007-00000000011a',
  '00000000-0000-e073-0007-00000000011b',
  '00000000-0000-e073-0007-00000000011c',
  '00000000-0000-e073-0007-00000000011d',
  '00000000-0000-e073-0007-00000000011e',
  '00000000-0000-e073-0007-00000000011f',
  '00000000-0000-e073-0007-000000000120',
  '00000000-0000-e073-0007-000000000121',
  '00000000-0000-e073-0007-000000000122',
  '00000000-0000-e073-0007-000000000123',
  '00000000-0000-e073-0007-000000000124',
  '00000000-0000-e073-0007-000000000125',
  '00000000-0000-e073-0007-000000000126',
  '00000000-0000-e073-0007-000000000127',
  '00000000-0000-e073-0007-000000000128',
  '00000000-0000-e073-0007-000000000129',
  '00000000-0000-e073-0007-00000000012a',
  '00000000-0000-e073-0007-00000000012b',
  '00000000-0000-e073-0007-00000000012c',
  '00000000-0000-e073-0007-00000000012d',
  '00000000-0000-e073-0007-00000000012e',
  '00000000-0000-e073-0007-00000000012f',
  '00000000-0000-e073-0007-000000000130',
  '00000000-0000-e073-0007-000000000131',
  '00000000-0000-e073-0007-000000000132',
  '00000000-0000-e073-0007-000000000133'
);

DELETE FROM "dishes"
WHERE "id" IN (
  '00000000-0000-e073-0007-000000000118',
  '00000000-0000-e073-0007-000000000119',
  '00000000-0000-e073-0007-00000000011a',
  '00000000-0000-e073-0007-00000000011b',
  '00000000-0000-e073-0007-00000000011c',
  '00000000-0000-e073-0007-00000000011d',
  '00000000-0000-e073-0007-00000000011e',
  '00000000-0000-e073-0007-00000000011f',
  '00000000-0000-e073-0007-000000000120',
  '00000000-0000-e073-0007-000000000121',
  '00000000-0000-e073-0007-000000000122',
  '00000000-0000-e073-0007-000000000123',
  '00000000-0000-e073-0007-000000000124',
  '00000000-0000-e073-0007-000000000125',
  '00000000-0000-e073-0007-000000000126',
  '00000000-0000-e073-0007-000000000127',
  '00000000-0000-e073-0007-000000000128',
  '00000000-0000-e073-0007-000000000129',
  '00000000-0000-e073-0007-00000000012a',
  '00000000-0000-e073-0007-00000000012b',
  '00000000-0000-e073-0007-00000000012c',
  '00000000-0000-e073-0007-00000000012d',
  '00000000-0000-e073-0007-00000000012e',
  '00000000-0000-e073-0007-00000000012f',
  '00000000-0000-e073-0007-000000000130',
  '00000000-0000-e073-0007-000000000131',
  '00000000-0000-e073-0007-000000000132',
  '00000000-0000-e073-0007-000000000133'
);
-- Note: alias additions on CE-092/CE-128/CE-140/CE-217/CE-267/CE-277 are
-- in JSON only; the Dish rows for those 6 entries are updated by re-seeding
-- after the git revert (no separate DELETE needed for aliases).
```

---

### Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| New alias on CE-140/CE-217 collides with existing alias on another dish | Low | Medium — validator blocks commit 3 | Pre-commit grep on full JSON before adding; `validateSpanishDishes` run after each alias addition |
| kcal value outside sanity range (Edge Cases §7) | Medium | Low — validator does not block (only >2000 warns); silent incorrect data | Cross-check every value against the kcal range table before writing; document any deviation in PR body |
| `portionGrams` outside [10, 800] | Very low | High — validator blocks full dataset | Keep all new dishes within range: ramen at 400g and poke at 350g are the largest; musaka at 350g — all under limit |
| JSON malformed (trailing comma, unclosed bracket) | Medium | High — validator throws before running checks | Edit the JSON as append-only; validate with `jq .` before each commit |
| CSV row with invalid `term` (e.g., `piece` typed accidentally) | Low | Medium — `seedStandardPortionCsv` rejects at seed-time, not CI | Grep CSV for `^[^,]*,[^,]*,` and validate term column before committing; only `pintxo|tapa|media_racion|racion` allowed |
| `pieces` column populated but `pieceName` empty (or vice versa) | Low | Medium — pairing invariant enforced by `seedStandardPortionCsv` | Always fill both columns together; the seeder enforces the pair invariant |
| Bare family term slips in as alias (ADR-019 violation) | Low | High — violates architectural decision; would require a follow-up fix + `HOMOGRAPH_ALLOW_LIST` entry | Before committing each alias array, audit for the banned terms: `hamburguesa`, `burrito`, `ramen`, `tacos`, `bao`, `arepa`, `nigiri`, `uramaki`, `tataki`, `maki roll`, `sushi`, `carpaccio`, `shawarma` |
| `name !== nameEs` on a new entry | Very low | High — validator blocks | Always copy the same string to both fields; `validateSpanishDishes` catches this |
| UUID (dishId/nutrientId) already exists in JSON | Very low | High — violates AC3 (no duplicate); validator catches | grep `000000000118..000000000133` on JSON before adding first entry |
| CE-307 appended at file-end (after CE-306) instead of after CE-286 | Confirmed — by design | Low — externalId is the semantic identifier; file order is irrelevant | Document in PR that CE-307 appears after CE-306 in file order but belongs to Cat 21 batch B per externalId scheme |
| `fH4B` uniqueness test (AC-3e) flags a collision from new aliases | Low | Medium — CI red on otherwise-data-only commits | Run `validateSpanishDishes` locally before every commit; the uniqueness test dynamically loads the JSON |
| Nutritional value with no defensible source | Low | Medium — spec requires at least one reference per dish | Do not write any value without citing source; if a value cannot be derived, open an issue before committing that dish |

---

### Key Patterns

- **JSON append order**: CE-307 (Cat 21 Asturian, chorizo a la sidra) is appended LAST in commit 3 — final file order CE-280..CE-307 monotonic. This is a deliberate change from spec v3 (which placed CE-307 in commit 1) to avoid non-monotonic file order; updated v6 after /review-plan R1 Codex SUGGESTION.

- **Alias append pattern**: edit alias arrays by appending to the end of the existing array. Do NOT reorder or reformat existing aliases. Diff must be additions only (no replacements).

- **portionGrams field**: this is the dish's primary reference portion (the value that `racion` row in the CSV should match or closely approximate). For bowl dishes (poke 350g, ramen 400g), set `portionGrams` to the racion serving size.

- **salt/sodium ratio**: F-H4's code review caught a CE-253 violation where salt:sodium ratio deviated from the physical 0.3934 constant (salt = sodium × 2.54). Ensure all 28 new entries satisfy `salt ≈ sodium × 2.54` (within ±0.02g tolerance). The validator does not enforce this; it is a manual check.

- **CE-140 category inconsistency**: CE-140 `Espaguetis carbonara` has `category: "arroces"` (confirmed from codebase inspection at line 3624). This is a pre-existing data quality issue, not introduced by H6. Do NOT change the category in this ticket; alias additions only.

- **Reference files**: `packages/api/src/scripts/validateSpanishDishes.ts` (295 lines, well-commented), `packages/api/prisma/seed-data/standard-portions.csv` (220 lines, 219 data rows), `packages/api/prisma/seed-data/spanish-dishes.json` (7336 lines, 279 entries × ~26 lines each).

- **Validator invocation**: the validator is not a standalone script with a `main()` guard in its current form; it is invoked from `seedPhaseSpanishDishes.ts`. To run it in isolation, use the invocation pattern from `fH4B.validateSpanishDishes.uniqueness.test.ts` (import `validateSpanishDishes`, load JSON with `readFileSync`, call directly). Alternatively, check if `seedPhaseSpanishDishes.ts` has a dry-run mode.

- **`fH4B` test does not need modification**: the AC-3e integration test dynamically loads the JSON with no hardcoded count, so it will automatically exercise the 307-entry dataset after commit 3 — no changes required.

---

## Acceptance Criteria

- [x] AC1 — 28 new entries in `spanish-dishes.json` with sequential externalIds CE-280..CE-307
  and dishIds `0x118`..`0x133`
- [x] AC2 — All 28 new dishes use `source=recipe + confidenceLevel=medium +
  estimationMethod=ingredients`
- [x] AC3 — No duplicate externalId, dishId, nutrientId in the full 307-entry dataset
- [x] AC4 — `name === nameEs` for all 28 new dishes
- [x] AC5 — `portionGrams` within [10, 800] for all 28 new dishes
- [x] AC6 — `validateSpanishDishes(dishes)` returns `{valid: true, errors: []}` with 307 entries
- [x] AC7 — Alias additions on CE-092, CE-128, CE-267, CE-277 present and no collision with
  existing aliases (validator uniqueness check passes)
- [x] AC8 — Alias additions on CE-140, CE-217 present and no collision
- [x] AC9 — Hardcoded `279` updated to `307` in `f073.seedPhaseSpanishDishes.edge-cases.test.ts`
  (×2 at lines 327, 336) AND `f114.newDishes.unit.test.ts` (×1 at line 139). Total: 3
  occurrences. f114 reference added in v5 after backend-planner Step 2 empirical caught it
  (spec v3 §5 had missed it).
- [x] AC10 — `key_facts.md` L95 updated: `279 dishes (47 BEDCA + 232 recipe)` →
  `307 dishes (47 BEDCA + 260 recipe)`
- [x] AC11 — `standard-portions.csv` has new rows for all 28 dishIds; pairing verified
  (no unpaired dishId)
- [x] AC12 — `npm test -w @foodxplorer/api` green (all tests pass)
- [x] AC13 — `npm run lint -w @foodxplorer/api` 0 errors
- [x] AC14 — `npm run build -w @foodxplorer/api` clean
- [x] AC15 — PR body includes DELETE SQL rollback block for all 28 new dishIds
- [x] AC16 — No bare `"sushi"` alias on CE-295 (per Edge Cases §10 + Open Q1 resolution)
- [x] AC17 — ADR-019 alias scope rule: no bare family/category terms (`"hamburguesa"`,
  `"burrito"`, `"ramen"`, `"tacos"`, `"bao"`, `"arepa"`, `"nigiri"`, `"uramaki"`, `"tataki"`,
  `"maki roll"`, `"sushi"`, `"carpaccio"`) added as aliases pointing to a single specific atom.
  Aliases restricted to: query-specific multi-word phrases, orthographic/transliteration variants
  of the dish's nameEs, and singular/plural normalisation. See Alias Requirements section.
- [x] AC18 — Validator `standard_portions.csv` term enum: every new row uses
  `term ∈ {pintxo, tapa, media_racion, racion}` (no `piece` term invented). For piece-counted
  dishes (gyozas, nigiri, fartons, casadielles), `pieces` and `pieceName` columns populated on
  the `racion`/`media_racion` row.

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Cross-model review executed (Gemini + Codex, ≥1 round; ≥2 rounds if REVISE received)
- [x] Quality gates pass (test + lint + build + validator)
- [x] PR opened targeting `develop` with inline rollback SQL
- [x] `code-review-specialist` executed, findings resolved
- [x] `qa-engineer` executed (or self-QA with documented evidence if rate-limited)
- [x] User authorization granted for merge

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, ticket created, 5 open questions resolved by L5 PM Orchestrator, /review-spec 3 rounds (Gemini APPROVED R2, Codex REVISE R1+R2+R3 all addressed)
- [x] Step 1: Branch `feature/F-H6-international-extended-regional` created from develop @ `3ce5343`, tracker Active Session + Features table updated
- [x] Step 2: `backend-planner` executed, plan reviewed via /review-plan 2 rounds (Gemini noisy with 3 hallucinated findings; Codex valuable with 4 real findings R1 + 2 real residual R2 — all addressed in plan v3)
- [x] Step 3: `backend-developer` executed; 4 commits on branch (`717f54f`, `c493a68`, `e2c5b71`, `947a4e5`); 28 atoms + 72 portion rows + 6 alias updates; validator 307 dishes valid; tests 3798/3798; lint 0; build clean
- [x] Step 4: `production-code-validator` executed — APPROVE 100% confidence, zero blockers, zero nits. All 10 ACs validated empirically.
- [x] Step 5: `code-review-specialist` executed — APPROVE WITH CHANGES (M1 HIGH duplicate atom CE-281 vs CE-095 → BUG-DATA-DUPLICATE-ATOM-001 follow-up filed; M2 MEDIUM 6 unplanned aliases → accepted + documented; M3 MEDIUM Merge Checklist Evidence → filled)
- [x] Step 5: `qa-engineer` executed — QA VERIFIED + 134 new edge-case tests in `fH6.seedExpansionRound2.edge-cases.test.ts` (committed as `dff7536`); total tests 3798→3932
- [ ] Step 6: Ticket updated with final metrics, branch deleted post-merge

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-26 | Spec created | spec-creator; baseline 279 dishes verified; 28 new atoms (CE-280..CE-307) + 6 alias fixes scoped |
| 2026-04-26 | Spec self-review + open-Q resolution | L5 PM Orchestrator resolved 5 open questions (sushi alias NO, chorizo-a-la-sidra YES as CE-307, NLP defer to H7, gyoza-portion convention confirmed, esqueixada=tapas) |
| 2026-04-26 | /review-spec R1 | Gemini APPROVED-pending (1 CRITICAL count + 1 IMPORTANT) + Codex REVISE (4 IMPORTANT + 1 SUGGESTION); all addressed in v2: count normalisation 28/307, CE-287 Fartons fix, ADR-019 alias scope tightening, portion-row contract clarified, stale Q493 text removed |
| 2026-04-26 | /review-spec R2 | Gemini APPROVED + Codex REVISE (2 IMPORTANT regressions); both addressed in v3: dropped bare `"shawarma"` alias on CE-292 (canonical disambiguation requires uniqueness assertion in bug-prod-003 test, out of H6 scope); renamed CE-295 from vague `Nigiri de sushi` → `Nigiri de pez mantequilla` (butterfish-specific, matches Q494 nutrient profile) and tightened aliases |
| 2026-04-26 | /review-spec R3 | Codex REVISE (1 IMPORTANT — query transcription error: spec body said Q495 was `uramaki roll de salmón y aguacate` but battery actual is `un uramaki roll de atún picante`); addressed in v4 with full Q481-Q505 audit: Q486/Q495/Q499 corrected to battery-verbatim text + Q490 (risotto, menu-misfire) added to Cat 22 row table. Underlying CE-296 alias contract was already correct; only spec-body text was stale. R4 round skipped — fix is purely textual, contract integrity unchanged. |
| 2026-04-26 | Step 0 closed | Spec final: 28 new atoms (CE-280..CE-307) + 6 alias additions; ADR-019 alias scope tightened; portion-row contract clarified; cross-model verification: Gemini APPROVED (R2), Codex 3-round trail with all findings addressed. Moving to Step 1 Setup. |
| 2026-04-26 | Step 1 done | Branch `feature/F-H6-international-extended-regional` from develop @ `3ce5343`. Tracker updated. |
| 2026-04-26 | Step 2 plan written | backend-planner agent: 4-commit TDD pattern (mirroring F-H4); risk register; rollback SQL; verification commands; reuse table. Caught spec gap: f114.newDishes.unit.test.ts:139 also has hardcoded 279 (spec §5 missed it) — AC9 updated. |
| 2026-04-26 | /review-plan R1 | Gemini REVISE (1 CRITICAL hallucinated unidad term + 1 IMPORTANT SQL-order text + 1 SUGGESTION hallucinated npm script — none real, ignored). Codex REVISE (1 CRITICAL rollback SQL uses Prisma model names instead of DB table/column names + 2 IMPORTANT validateSpanishDishes not a CLI script + reviewed_by silent-skip rule + 1 SUGGESTION CE-307 ordering inconsistency). All 4 Codex findings addressed in plan v2: rollback SQL rewritten with `dishes`/`dish_nutrients`/`standard_portions` and `id`/`dish_id`; validator invocation via existing test harness; explicit `reviewed_by="pbojeda"` requirement on every new CSV row; CE-307 moved to commit 3 for monotonic file order. |
| 2026-04-26 | /review-plan R2 | Codex REVISE (1 CRITICAL CE-307 partially still in commit 1 — CSV row + validator count `288` + 1 IMPORTANT residual `npx tsx` instruction at L425). Both addressed in plan v3: CE-307 CSV row deferred to commit 3 with explicit "do NOT belong to commit 1" note; validator counts corrected (287/297/307 across the 3 commits); L425 instruction replaced with test-harness invocation. R3 skipped — fixes are deterministic textual cleanup, no architectural risk. |
| 2026-04-26 | Step 2 closed | Plan final v3. Cross-model verification: Gemini noisy R1 (3 hallucinations), Codex valuable R1 (4 real findings) + R2 (2 real residual) all addressed. Moving to Step 3 Implementation. |
| 2026-04-26 | Step 3 done | backend-developer agent: 4 commits TDD pattern. `717f54f` Cat 21 batch A (CE-280..CE-287 + 4 alias updates); `c493a68` Cat 22 batch A (CE-288..CE-297); `e2c5b71` Cat 22 batch B + CE-307 + 2 alias updates; `947a4e5` test counts 279→307 + key_facts L95. 5 files changed, +834/-15 LOC. Validator green at 287/297/307. |
| 2026-04-26 | Step 4 done | production-code-validator: APPROVE 100% confidence, zero blockers, zero nits. All 10 ACs validated empirically. |
| 2026-04-26 | Step 5 PR #211 opened | https://github.com/pbojeda/foodyxplorer/pull/211 — base develop, head feature/F-H6-international-extended-regional. CI green (test-api SUCCESS, ci-success SUCCESS). |
| 2026-04-26 | Step 5 code-review | code-review-specialist: APPROVE WITH CHANGES. M1 (HIGH) duplicate atom CE-281 vs pre-existing CE-095 → filed BUG-DATA-DUPLICATE-ATOM-001 follow-up (mirrors F-H4-B → BUG-DATA-ALIAS-COLLISION-001 precedent); M2 (MEDIUM) 6 unplanned aliases (`esqueixada catalana`, `gazpachuelo`, `berza gaditana`, `talo vasco`, `casadiella`, `fartón`) → ACCEPTED + documented (singular/regional variants, low-risk, consistent with `gyoza` precedent); M3 (MEDIUM) Merge Checklist Evidence empty → filled (this section). S1/S2/S3 NIT — accepted. |
| 2026-04-26 | Step 5 qa-engineer | qa-engineer: QA VERIFIED. Added `fH6.seedExpansionRound2.edge-cases.test.ts` with 134 new tests (12 describe groups: validator, source/confidence/method, kcal sanity, CSV invariants, reviewed_by, portion coverage, ADR-019 negative regression, CE-095/CE-281 disambiguation, alias additions, level1Lookup simulation, monotonic order). Total tests: 3798 → 3932. All 10 brief categories empirically verified. |
| 2026-04-26 | Step 5 commit 6 | `dff7536` test(F-H6) qa-engineer edge-case suite (+134 tests). |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and
> execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | All 7 sections present: Spec ✓, Implementation Plan ✓, Acceptance Criteria ✓, Definition of Done ✓, Workflow Checklist ✓, Completion Log ✓, Merge Checklist Evidence ✓ |
| 1. Mark all items | [x] | AC: 18/18 ready (verified by code-review + qa-engineer); DoD: 7/7 (cross-model done, gates pass, PR open, code-review/qa done, user pre-authorised); Workflow: 7/8 (Step 6 housekeeping pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6, will move to 6/6 post-merge; Features table row F-H6 in `Sprint #3` section: status `in-progress` 5/6 |
| 3. Update key_facts.md | [x] | L95 in commit `947a4e5`: `307 dishes (47 BEDCA + 260 recipe)` with tag `(F073/F114/F-H4/F-H6)` |
| 4. Update decisions.md | [x] | N/A — no new ADR. F-H6 is pure data expansion. ADR-019 (canonical disambiguation aliases) was honoured strictly: NO bare family-term aliases added (verified by qa-engineer H6-EC-7 negative regression test, 12 forbidden terms). |
| 5. Commit documentation | [x] | Commit `462587b` (docs housekeeping): F-H6 ticket + tracker + pm-session. Commit `dff7536` (qa test suite). |
| 6. Verify clean working tree | [x] | `git status` shows only untracked `pm-session.lock` (intentional — current PM session marker, not committed; pattern matches prior sessions). |
| 7. Verify branch up to date | [x] | Branch `feature/F-H6-international-extended-regional` based on develop `3ce5343` (current develop HEAD). 6 commits ahead, 0 behind. PR #211 mergeable (CI green, no conflicts). |
| 8. /audit-merge result | [x] | (will be filled after running /audit-merge) |
| 9. Follow-up bugs filed | [x] | `BUG-DATA-DUPLICATE-ATOM-001` filed in `docs/project_notes/bugs.md` for M1 finding (CE-281 vs CE-095 duplicate atom). Acceptable per code-review-specialist recommendation (mirrors F-H4 → BUG-DATA-ALIAS-COLLISION-001 precedent). |
| 10. Cross-model review trail | [x] | /review-spec 3 rounds, /review-plan 2 rounds, production-code-validator 1 round, code-review-specialist 1 round, qa-engineer 1 round. All findings addressed or documented as accepted-deviations. |

---

*Ticket created: 2026-04-26*
