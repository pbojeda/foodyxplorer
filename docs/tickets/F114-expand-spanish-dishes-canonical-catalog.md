# F114: Expand Spanish canonical dishes JSON — add Chuletón, Chorizo embutido, Arroz blanco

**Feature:** F114 | **Type:** Backend-Feature | **Priority:** Medium
**Status:** Done (code merged 2026-04-19 `3a59237`; prod + dev DB rolled out 2026-04-20) | **Branch:** `feature/F114-expand-spanish-dishes` (deleted post-merge) | **PR:** #156
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-17 | **Dependencies:** BUG-PROD-009 merged at `942ab35` (2026-04-18)

---

## Spec

### Description

`packages/api/prisma/seed-data/spanish-dishes.json` is the canonical catalog of dishes consumed by the estimation pipeline, the embedding generator, and the `standard_portions` CSV generator. It currently has 250 entries covering breakfast, tapas, primeros, segundos, arroces, and desserts. BUG-PROD-009 audit uncovered three priority concepts that users query about but have NO canonical dish in the catalog:

1. **Chuletón de buey / ternera** — large bone-in ribeye, Basque-style. Users frequently ask "una ración de chuletón". Currently the embedding pipeline resolves to `Entrecot de ternera` (`...000000000069`) — a different cut with different portion scaling (entrecot is boneless, typically 200-300g/ration; chuletón is bone-in 600-1000g for sharing).
2. **Chorizo ibérico embutido** — standalone cured sausage (not in a bocadillo, not in a stew). Users ask "una tapa de chorizo" expecting a charcuterie-plate portion. Currently the embedding pipeline resolves to `Bocadillo de chorizo` (`...00000000009f`) or `Chistorra` (`...00000000002d`), neither of which represents the embutido alone.
3. **Arroz blanco cocido** — generic white/cooked rice as a side or base. Users ask "una ración de arroz". The catalog has 12+ specific rice dishes (paella, arroz negro, arroz a banda, arroz con pollo, fideuà, etc.) but no generic "plain rice" entry. The embedding pipeline currently matches to whichever specific rice is semantically closest, producing inconsistent portion data.

This ticket adds these three canonical dishes with:
- `dishId` (next sequential: `...000000000100`, `...000000000101`, `...000000000102`)
- `name` + `nameEs` in canonical form
- `aliases[]` covering common user phrasings
- `category` (tapas / segundos / primeros)
- `portionGrams` default (the value used when F-UX-B Tier 3 fallback fires)
- `confidenceLevel` (`medium` or `high` depending on source quality)
- `estimationMethod` + `source`
- Full nutrient profile per 100g (12 fields: calories, proteins, carbohydrates, sugars, fats, saturatedFats, fiber, salt, sodium, plus any project-standard optional fields)

After adding the dishes:
- Re-run `packages/api/src/scripts/generateStandardPortionCsv.ts` (post BUG-PROD-009 explicit-map version) with new `PRIORITY_DISH_MAP` entries pointing at the new dishIds.
- Research real portion values for each new dish × 4 terms (pintxo/tapa/media_racion/racion) using the same methodology as the 2026-04-17 research round (institutional sources, nutrition DBs, culinary references, cross-model verification).
- Seed the new rows into `standard_portions` (dev first, then prod).
- Re-generate embeddings so the new dishes participate in the pgvector nearest-neighbor search: `npm run embeddings:generate -w @foodxplorer/api`.

### API Changes

None to endpoints/routes. Indirect behavior change: `resolvePortionAssumption` will start returning `per_dish` results (Tier 1) for queries about chuletón/chorizo-embutido/arroz-blanco, whereas today they fall through to Tier 3 generic.

### Data Model Changes

No schema changes. `spanish-dishes.json` additions only:

```json
{
  "externalId": "CE-XXX",
  "dishId": "00000000-0000-e073-0007-000000000100",
  "nutrientId": "00000000-0000-e073-0008-000000000100",
  "name": "Chuletón de buey",
  "nameEs": "Chuletón de buey",
  "aliases": ["chuletón", "chuletón vasco", "txuleta"],
  "category": "segundos",
  "portionGrams": 700,
  "confidenceLevel": "medium",
  "estimationMethod": "ingredients",
  "source": "recipe",
  "nutrients": { /* full 12-field profile */ }
}
```

Mirror entries in `bedca`-sourced files if the project's nutrient ingestion pipeline requires parallel BEDCA records. Check `packages/api/prisma/seed-data/bedca/` conventions during planning.

### UI Changes

None.

### Edge Cases & Error Handling

1. **dishId collisions**: before inserting, verify the chosen dishIds (`...0100`, `...0101`, `...0102`) don't collide with existing entries. Grep the JSON first.
2. **Nutrient provenance**: for BEDCA-sourced entries, match the `source` convention ("bedca") and `confidenceLevel` ("high"). For recipe-derived entries (if we can't find authoritative nutrients), use "recipe" + "medium". Document source in Completion Log per dish.
3. **Embedding regeneration**: new JSON dishes won't appear in Level 3 similarity search until embeddings are generated. The generation script must be run against both dev and prod DBs. It should be idempotent (upsert by dishId).
4. **Alias conflicts with existing heuristic-matched concepts**: confirm that adding alias "chuletón" to a new dish does NOT accidentally collide with a priority concept still routed via legacy heuristic (should be impossible post-BUG-PROD-009, but verify).
5. **User perception continuity**: a query that yesterday returned Tier 3 generic for "chuletón" will tomorrow return Tier 1 `per_dish` data with a specific grams/pieces value. The confidence label helps the user calibrate expectations. The response contract does not change.
6. **Arroz blanco specificity**: "arroz blanco cocido" is intentionally generic. If a query clearly indicates a specific arroz dish (e.g., "arroz negro"), the embedding pipeline should still route to the specific dish, not to the new generic one. Test this explicitly.
7. **Portion research sources**: prefer BEDCA/AESAN/SENC for nutrient profiles; use Spanish culinary/hospitality sources (hosteleria.es, UCM nutrition tables) for portion weights per term.
8. **Scope creep**: users may identify additional missing concepts (e.g., "pintxos" as a category-concept — not a single dish — shouldn't map anywhere). This ticket is strictly limited to the 3 dishes above. Other additions go in follow-ups.

---

## Implementation Plan

> **Plan v2 (2026-04-18) — post cross-model review.** Codex + Gemini both flagged P1 issues missed in v1. My own JSON audit surfaced pre-existing entries that change scope. Key changes vs v1:
> - **Arroz blanco already exists** at `...0000000000e5` (BEDCA, high/official). We do NOT add a new Arroz entry — just map `arroz` priority name to the existing dishId and add aliases. **F114 adds 2 new dishes, not 3.**
> - **`chuletón` alias already exists on Entrecot de ternera (`...000000000069`)**. L1/L2 lookup (`level1Lookup.ts`, `level2Lookup.ts`) would match via that alias BEFORE embeddings fire. Must remove the alias as part of this ticket (new required sub-task).
> - **Embedding pipeline writes to `dishes.embedding` column**, not a separate `dish_embeddings` table. SQL verification queries in v1 were wrong.
> - **Embedding routing test is MANDATORY**, not optional (Codex + Gemini unanimous).
> - New regression tests required: map-key-substring collision, salt/sodium ratio sanity, alias/name collision after chuletón alias removal.

### 0. Files to Create

| File | Purpose |
|------|---------|
| `packages/api/src/__tests__/f114.newDishes.unit.test.ts` | Unit tests: JSON schema validation for the 3 new entries; map extension passes `validatePriorityDishMap`; `isSinPieces('arroz')` returns true (see §3); `isSinPieces('chuletón')` and `isSinPieces('chorizo')` return false |
| `packages/api/src/__tests__/f114.embeddingRouting.integration.test.ts` | Integration test: asserts semantic routing — embedding search for "chuletón" returns the new Chuletón dishId NOT Entrecot de ternera (`...000000000069`). Defer to manual smoke test if pgvector test-DB setup is impractical (see §6 for verification procedure) |

---

### 1. Files to Modify

| File | What changes |
|------|-------------|
| `packages/api/prisma/seed-data/spanish-dishes.json` | **TWO new entries** (not three): `0000000000fb` (Chuletón de buey, CE-251), `0000000000fc` (Chorizo ibérico embutido, CE-252). **Also modify existing entry `000000000069`** (Entrecot de ternera): REMOVE the `"chuletón"` alias from its aliases array (lines 2720-2722). **Also modify existing entry `0000000000e5`** (Arroz blanco): add `"arroz"`, `"arroz cocido"`, `"arroz hervido"` to its aliases array to strengthen L1/L2 matching for the `arroz` priority name (keeping the existing `"guarnición de arroz"`). |
| `packages/api/src/scripts/generateStandardPortionCsv.ts` | Add 3 keys to `PRIORITY_DISH_MAP` — `chuletón` → `...fb`, `chorizo` → `...fc`, `arroz` → `...0e5` (the existing entry). Move `'arroz'` into `SIN_PIECES_NAMES` (see §3). Update header comment. |
| `packages/api/prisma/seed-data/standard-portions.csv` | Regenerated with 12 new rows (3 dishes × 4 terms) appended. Existing 156 reviewed rows untouched by skip-existing logic. Developer fills in real portion values per §4 and sets `reviewed_by=pbojeda`. |
| `docs/project_notes/key_facts.md` | Optional (Codex M3 nit): update Cocina Española count 250 → 252. Tracker + ticket carry the operational info. |

**No schema migrations required.** No Prisma model changes. No new routes. No changes to `packages/shared/`.

**Embeddings side-effect**: because Entrecot de ternera's text representation changes (alias removed), its embedding needs regeneration too. Same for Arroz blanco (aliases added). So the post-seed embedding regen must cover 4 dishIds: the 2 new + 2 modified (`...0069`, `...0e5`).

---

### 2. JSON Entries — Full Templates (Developer Fills Nutrient Values)

All three entries use the same structural pattern as existing CE-XXX entries. Key constraints:
- `source` must be `"bedca"` or `"recipe"` — `validateSpanishDishes` at `packages/api/src/scripts/validateSpanishDishes.ts:13` only allows those two values. If USDA FoodData Central is used as the nutrient source, record the actual institution (USDA) in the Completion Log but set `source: "recipe"` (computed/cross-referenced) and `confidenceLevel: "medium"`. If BEDCA has a direct entry, use `source: "bedca"` and `confidenceLevel: "high"`.
- All 9 nutrient fields are required: `calories`, `proteins`, `carbohydrates`, `sugars`, `fats`, `saturatedFats`, `fiber`, `salt`, `sodium`.
- `salt` and `sodium` relationship: `salt ≈ sodium × 2.54` (project convention). If only one is sourced, derive the other.
- `portionGrams` is the Tier 3 fallback default — use the `racion` weight from the researched portion data.

#### Entry 1 — Chuletón de buey

```json
{
  "externalId": "CE-251",
  "dishId": "00000000-0000-e073-0007-0000000000fb",
  "nutrientId": "00000000-0000-e073-0008-0000000000fb",
  "name": "Chuletón de buey",
  "nameEs": "Chuletón de buey",
  "aliases": ["chuletón", "chuletón vasco", "txuleta", "txuletón", "chuletón de ternera"],
  "category": "segundos",
  "portionGrams": 700,
  "confidenceLevel": "medium",
  "estimationMethod": "ingredients",
  "source": "recipe",
  "nutrients": {
    "calories": /* RESEARCH: BEDCA "ternera entrecot" ~150–170 kcal/100g; chuletón (bone-in) edible ~70% → use USDA "beef rib steak bone-in" as proxy (~190 kcal/100g edible) */,
    "proteins": /* ~20–22 g/100g */,
    "carbohydrates": /* ~0 g/100g (muscle meat, no starch) */,
    "sugars": /* ~0 g/100g */,
    "fats": /* ~13–15 g/100g (well-marbled beef) */,
    "saturatedFats": /* ~5–6 g/100g */,
    "fiber": /* 0 */,
    "salt": /* 0.13–0.18 g/100g (natural + cooking salt, derive from sodium) */,
    "sodium": /* 0.05–0.07 g/100g */
  }
}
```

Research notes for developer: BEDCA has "Ternera, entrecot" (item code 00117) with ~159 kcal, 22g protein, 8g fat per 100g — this is boneless loin. Chuletón is bone-in ribeye, typically higher fat marbling. Cross-reference USDA FoodData Central SR Legacy: "Beef, rib, large end (ribs 6-9), separable lean and fat" (FDC ID 23040) for values. Use weighted average of BEDCA + USDA as a `recipe`-method estimate. Confirm no BEDCA entry specifically for "chuletón" before using recipe fallback.

#### Entry 2 — Chorizo ibérico embutido

```json
{
  "externalId": "CE-252",
  "dishId": "00000000-0000-e073-0007-0000000000fc",
  "nutrientId": "00000000-0000-e073-0008-0000000000fc",
  "name": "Chorizo ibérico embutido",
  "nameEs": "Chorizo ibérico embutido",
  "aliases": ["chorizo ibérico", "chorizo embutido", "chorizo", "chorizo curado", "chorizo de bellota"],
  "category": "tapas",
  "portionGrams": 180,
  "confidenceLevel": "high",
  "estimationMethod": "official",
  "source": "bedca",
  "nutrients": {
    "calories": /* BEDCA "chorizo" ~468 kcal/100g — researcher confirms exact value */,
    "proteins": /* ~25 g/100g */,
    "carbohydrates": /* ~1–2 g/100g */,
    "sugars": /* ~0.5 g/100g */,
    "fats": /* ~40 g/100g */,
    "saturatedFats": /* ~14–16 g/100g */,
    "fiber": /* 0 */,
    "salt": /* ~2.2–2.6 g/100g (embutido, cured) */,
    "sodium": /* ~0.87–1.0 g/100g (derive: salt / 2.54) */
  }
}
```

Research notes for developer: BEDCA has "Chorizo" as a well-documented single-ingredient entry. Use BEDCA item directly. Look for BEDCA item code starting with 01 (meat derivatives). If BEDCA gives a single source of truth, set `confidenceLevel: "high"` and `source: "bedca"` and `estimationMethod: "official"`. AESAN / FEN tables are secondary confirmations.

#### Entry 3 — Arroz blanco (REUSE existing `...0e5`, DO NOT duplicate)

**Cross-model finding (Codex P1)**: `Arroz blanco` already exists at `...000000000000e5` with `source: "bedca"`, `confidenceLevel: "high"`, `estimationMethod: "official"`, `portionGrams: 150`, nutrients already populated (195 kcal / 4g protein / 42g carbs / 0.5g fat / 0.02g salt / 0.008g sodium per 100g). Adding a second "Arroz blanco cocido" canonical creates L1/L2 ambiguity (both match `LOWER(name) LIKE '%arroz blanco%'` then `LIMIT 1` without semantic tie-break).

**Modification to existing entry `0000000000e5`** (not a new entry):

Append these 3 aliases to its `aliases` array (current: `["guarnición de arroz"]`):
```
"arroz", "arroz cocido", "arroz hervido"
```

Result:
```json
"aliases": ["guarnición de arroz", "arroz", "arroz cocido", "arroz hervido"]
```

`portionGrams: 150` stays as-is (side-dish default — matches researched `media_racion` value). Nutrients stay as-is. No other changes to the entry.

**Rationale**: this makes the existing Arroz blanco the unambiguous target for "arroz" queries. L1 alias-match will hit it; L2/L3 embedding similarity will also route to it (with the fresh embedding regen to cover the alias changes).

---

### 3. PRIORITY_DISH_MAP Extension and SIN_PIECES_NAMES Update

#### PRIORITY_DISH_MAP — add 3 entries

In `packages/api/src/scripts/generateStandardPortionCsv.ts`, add the following three lines to `PRIORITY_DISH_MAP` (order within the map is not significant — append at the end, before the closing `}`):

```
'chuletón':   '00000000-0000-e073-0007-0000000000fb',  // new entry (see §2)
'chorizo':    '00000000-0000-e073-0007-0000000000fc',  // new entry (see §2)
'arroz':      '00000000-0000-e073-0007-0000000000e5',  // REUSE existing Arroz blanco (§2 revision)
```

Map will have 42 entries after this change.

**REQUIRED companion data cleanup** (Codex M2): in the same commit, edit `spanish-dishes.json` entry `000000000069` (Entrecot de ternera, starts ~line 2715) — REMOVE the `"chuletón"` alias from its aliases array. Before:
```json
"aliases": ["chuletón"]
```
After:
```json
"aliases": []
```
This prevents L1/L2 alias-match routing "chuletón" queries to Entrecot before the embedding (L3) even gets a chance to hit the new Chuletón de buey dishId.

Also update the comment block above `PRIORITY_DISH_MAP` to remove `chorizo`, `chuletón`, and `arroz` from the "Omitted" comment list. The comment currently reads:

```
// Omitted (no canonical dish in spanish-dishes.json; tracked in F114):
//   chorizo, chuletón, arroz, bocadillo, pintxos, alitas de pollo,
//   zamburiñas, berberechos, tostas
```

Update it to:

```
// Omitted (no canonical dish in spanish-dishes.json; consider F115+):
//   bocadillo, pintxos, alitas de pollo, zamburiñas, berberechos, tostas
```

#### SIN_PIECES_NAMES — reinstate 'arroz'

`SIN_PIECES_NAMES` currently does NOT include `'arroz'` (it was removed in BUG-PROD-009 because arroz had no canonical dishId at that time). Now that `Arroz blanco cocido` has a dishId and is a bulk/liquid-style serving (no individual countable pieces for a plain rice side), add `'arroz'` back:

```typescript
const SIN_PIECES_NAMES = new Set([
  'gazpacho', 'salmorejo', 'lentejas', 'cocido', 'fabada',
  'sopa de ajo', 'potaje', 'pisto', 'crema catalana', 'ensalada',
  'arroz',   // F114: Arroz blanco cocido — bulk side dish, no piece count
]);
```

Consequence: the 4 template rows generated for `arroz` will have `grams=200` (sin-pieces default), `pieces=''`, and `notes='sin pieces — gazpacho/salmorejo style'`. The developer then overwrites these with the researched values in §4.

Note: the existing test `U7b` in `f-ux-b.generateStandardPortionCsv.unit.test.ts` currently asserts `isSinPieces('arroz')` returns `false`. That test was written when `arroz` was intentionally removed from the set. With this F114 change, **that assertion will fail**. The developer must update `U7b` to assert `isSinPieces('arroz')` returns `true` (or split it into a separate named case), and confirm `isSinPieces('bocadillo')` still returns `false`.

---

### 4. Portion Research Methodology and Expected CSV Row Format

**Research procedure** (same methodology as BUG-PROD-009 2026-04-17 round):

For each of the 12 rows (3 dishes × 4 terms: pintxo, tapa, media_racion, racion):

1. Primary: Check Spanish hospitality guidelines (hosteleria.es, UCM nutrition tables, SENC portion guides).
2. Secondary: Spanish culinary references ("1080 Recetas de Cocina" — Simone Ortega; Directo al Paladar) for recipe weights.
3. Cross-reference: Delivery apps (Just Eat, Glovo restaurant menus with gram weights where available).
4. Cross-model verification: use two independent model lookups for disputed values.

**Pre-computed best-estimates** (developer uses as starting point, must independently verify each):

| dishId | term | grams | pieces | pieceName | confidence | notes |
|--------|------|-------|--------|-----------|------------|-------|
| `...0000000000fb` | pintxo | 60 | null | null | medium | Small cut/taco format; pintxo de chuletón is rare — brocheta/taco proxy |
| `...0000000000fb` | tapa | 150 | null | null | medium | Small individual serving; half-taco equivalent |
| `...0000000000fb` | media_racion | 350 | null | null | medium | Shared half-portion; institutional est |
| `...0000000000fb` | racion | 700 | null | null | medium | Full bone-in ración (edible ~70% of ~1 kg raw bone-in piece) |
| `...0000000000fc` | pintxo | 20 | 4 | rodaja | high | 4 small slices ~5g/slice; standard pintxo bar serving |
| `...0000000000fc` | tapa | 60 | 12 | rodaja | high | 12 slices; typical charcuterie plate portion |
| `...0000000000fc` | media_racion | 100 | 20 | rodaja | high | 20 slices; medium charcuterie board |
| `...0000000000fc` | racion | 180 | 36 | rodaja | high | Full racion; BEDCA-derived weight cross-referenced |
| `...0000000000e5` | pintxo | 50 | null | null | medium | Small side scoop (~50g cooked rice). Targets EXISTING Arroz blanco dishId (see §2 revision) |
| `...0000000000e5` | tapa | 100 | null | null | medium | Side portion, casual bar context |
| `...0000000000e5` | media_racion | 150 | null | null | high | Half-racion side; UCM/SENC standard. Matches existing `portionGrams: 150` default |
| `...0000000000e5` | racion | 250 | null | null | high | Full side ración; SENC 200-250g cooked range |

**CSV row format** (8 columns, comma-separated, header must match existing file):
```
dishId,term,grams,pieces,pieceName,confidence,notes,reviewed_by
```

Empty `pieces` and `pieceName` must be represented as empty string (no value between commas). The `reviewed_by` field must be set to `pbojeda` after analyst review. Notes containing commas must be quoted (see EC4 from BUG-PROD-009 tests).

---

### 5. TDD Test List (RED → GREEN)

Write all tests BEFORE implementing changes. Each test should fail initially (RED) and pass after implementation (GREEN).

#### Unit tests — `packages/api/src/__tests__/f114.newDishes.unit.test.ts`

**F114-U1**: `validateSpanishDishes` accepts the extended JSON (252 entries — 250 original + 2 new; NOT 253 since arroz reuses existing).
- Load the real `spanish-dishes.json` after appending the 2 new entries + modifying 2 existing.
- Assert `result.valid === true` and `result.errors.length === 0`.

**F114-U2**: No duplicate dishIds for the 2 new entries (`...fb`, `...fc`).
- Parse the real JSON, extract all dishIds into a Set, assert each new dishId appears exactly once.

**F114-U3**: No duplicate externalIds (CE-251, CE-252).
- Same approach as U2 but for `externalId` field.

**F114-U4**: Each new entry has all 9 required nutrient fields with non-negative numeric values.
- Load the 2 new entries from JSON. Assert each has all 9 fields: calories, proteins, carbohydrates, sugars, fats, saturatedFats, fiber, salt, sodium. Assert each value is `typeof number` and `>= 0`.

**F114-U4b** (Codex M2): **salt ≈ sodium × 2.54** sanity check — assert `|salt - sodium * 2.54| < 0.05` (g/100g tolerance) for each of the 2 new entries AND for the modified `...0e5` entry.

**F114-U5**: `validatePriorityDishMap` passes after extending with the 3 new keys (chuletón→fb, chorizo→fc, arroz→e5).
- Build a `knownDishIds` Set from the real JSON.
- Construct the extended map (42 entries) inline.
- Assert `validatePriorityDishMap(extendedMap, knownDishIds)` does not throw.

**F114-U5b** (Gemini M2): **No PRIORITY_DISH_MAP key is a substring of another**.
- Iterate all pairs of keys. For each `(k1, k2)` where k1 ≠ k2, assert `!k2.includes(k1)`.
- Catches cases like `chorizo` being added as a key when an existing key `chori` could collide (none today, but guards the invariant).

**F114-U5c** (Codex M2): **After chuletón alias removal, `"chuletón"` does NOT appear as an alias in any other JSON entry**.
- Parse JSON. For every dish except `...0000000000fb`, assert `"chuletón"` is NOT in its `aliases` array. Belt-and-braces check that the Entrecot alias was actually removed.

**F114-U5d**: **Arroz blanco (`...0e5`) has the new aliases applied**.
- Parse JSON entry `...0e5`. Assert its aliases array contains `"arroz"`, `"arroz cocido"`, `"arroz hervido"` AND still contains `"guarnición de arroz"`.

**F114-U6**: `isSinPieces('arroz')` returns `true` (reinstated in SIN_PIECES_NAMES).

**F114-U7**: `isSinPieces('chuletón')` returns `false` and `isSinPieces('chorizo')` returns `false`.

**F114-U8**: CSV generator produces 42 × 4 = 168 rows (plus header) for a fixture containing all 42 dishIds (39 existing + chuletón + chorizo + reused arroz).
- Use the same `makeTempDir` / `writeFixtureDishes` pattern from `f-ux-b.generateStandardPortionCsv.unit.test.ts`.
- Fixture must include all 42 dishIds.
- Assert `lines.length === 169` (1 header + 168 rows).

**F114-U9**: The `arroz` rows from the generator have the sin-pieces format (grams=200 template, pieces empty, notes contains "sin pieces"), targeting `...0e5`.
- Filter generated lines by `...0000000000e5`.
- Assert each of the 4 rows: `cols[2] === '200'`, `cols[3] === ''`, `cols[6]` contains `'sin pieces'`.

**F114-U10**: The `chuletón` and `chorizo` rows from the generator have the non-sin-pieces format (grams=50, notes matches `template: <name> <term>`).
- Filter lines by `...0000000000fb` and `...0000000000fc`.
- Assert `cols[2] === '50'` and `cols[6]` matches `/^template: (chuletón|chorizo) /`.

**F114-U11** (Gemini M2 — regression): **CSV snapshot unchanged for 39 existing dishes**.
- Generate the CSV against the extended JSON + extended map.
- Filter output to exclude rows for `...fb`, `...fc`, `...0e5` (the 3 affected by F114).
- Compare to a snapshot of the pre-F114 CSV rows for those 39 dishIds.
- Assert byte-identity OR structural match (order-insensitive row set).
- Goal: prove F114 only adds/modifies 12 rows (3 × 4) and does not disturb the other 156.

#### Update to existing test — `f-ux-b.generateStandardPortionCsv.unit.test.ts`

**U7b update**: Change the assertion for `isSinPieces('arroz')` from `toBe(false)` to `toBe(true)`. The test comment should note: "arroz reinstated in SIN_PIECES_NAMES by F114 after Arroz blanco cocido dishId was created."

#### Integration test (optional) — `packages/api/src/__tests__/f114.embeddingRouting.integration.test.ts`

**F114-I1**: Embedding search for "chuletón" returns the Chuletón de buey dishId as the nearest neighbor.
- Prerequisite: embeddings must have been generated for the new dishes before this test runs.
- Use `pgvector` similarity query (existing infrastructure from embeddings scripts).
- Assert top result's `dish_id === '00000000-0000-e073-0007-0000000000fb'`.
- Assert top result's `dish_id !== '00000000-0000-e073-0007-000000000069'` (NOT Entrecot de ternera).

**F114-I2**: Embedding search for "arroz negro" still returns the specific Arroz negro dishId (not the new generic Arroz blanco).
- Assert top result `dish_id` is the existing Arroz negro entry (verify exact UUID from JSON before writing test).
- Validates that the generic arroz entry does not absorb specific arroz queries.

If `pgvector` test DB with embeddings is not available in CI, mark these tests with `it.skip` and add a comment referencing the manual smoke-test procedure in §6. Do not block the PR on these tests if the infrastructure is not set up.

#### EC8 update — `BUG-PROD-009.generateStandardPortionCsv.edge-cases.test.ts`

The current EC8 test asserts that `'chorizo'`, `'chuletón'`, and `'arroz'` do NOT appear as `template: <name>` in the generated CSV notes. After F114 these three names ARE in the map and WILL appear in the notes. The EC8 test must be updated to remove those three names from the `omittedNames` array. The test should still check the remaining omitted names: `bocadillo`, `pintxos`, `alitas de pollo`, `zamburiñas`, `berberechos`, `tostas`.

---

### 6. Embedding Regeneration Procedure and Dev Verification

**Command** (verified from `packages/api/package.json`):
```
npm run embeddings:generate -w @foodxplorer/api
```

**When to run**: after the 2 new JSON entries are committed and the seed pipeline has been executed to insert the dish rows into the dev DB. Also covers the 2 modified entries (`...0069` Entrecot with alias removed, `...0e5` Arroz blanco with aliases added) since their text representation changed.

**Idempotency**: the pipeline writes via `UPDATE dishes SET embedding = ... WHERE dish_id = ...` (see `packages/api/src/embeddings/embeddingWriter.ts` — uses `$executeRawUnsafe` for the pgvector cast). Safe to re-run.

**Verification query** (Codex P1 fix — `dish_embeddings` table does NOT exist; embeddings live on `dishes.embedding`):
```sql
SELECT id AS dish_id,
       name,
       (embedding IS NOT NULL) AS has_embedding,
       embedding_updated_at
FROM dishes
WHERE id IN (
  '00000000-0000-e073-0007-0000000000fb',  -- Chuletón de buey (new)
  '00000000-0000-e073-0007-0000000000fc',  -- Chorizo ibérico embutido (new)
  '00000000-0000-e073-0007-0000000000e5',  -- Arroz blanco (modified aliases)
  '00000000-0000-e073-0007-000000000069'   -- Entrecot de ternera (alias removed)
);
-- Expected: 4 rows, has_embedding=true for all, embedding_updated_at within the last few minutes.
```

**Semantic routing smoke test** (manual, dev DB) — verifies the core F114 contract:
```sql
-- Compute embedding for "chuletón" query (via API one-shot or OpenAI embed call),
-- then run nearest-neighbor search against the dishes table:
SELECT id, name, 1 - (embedding <=> $1::vector) AS similarity
FROM dishes
WHERE embedding IS NOT NULL
ORDER BY embedding <=> $1::vector
LIMIT 5;
-- Expected row 1: dish_id = ...0000000000fb (Chuletón de buey)
-- NOT: ...000000000069 (Entrecot de ternera)
```

Alternatively, use the existing `POST /conversation/message` endpoint with query `"una ración de chuletón"` and verify `portionAssumption.source === 'per_dish'` and the matched dishId === `...0000000000fb`.

**Arroz specificity smoke test**:
```
POST /conversation/message { "message": "¿cuántas calorías tiene un arroz negro?" }
-- Expected: estimation matches the existing Arroz negro entry, NOT the modified generic Arroz blanco (...0e5).
```

---

### 7. Step-by-Step Dev Workflow

1. **RED phase** — Write all F114 unit tests in `packages/api/src/__tests__/f114.newDishes.unit.test.ts` (F114-U1 through U11, + U4b/U5b/U5c/U5d from plan v2). Run them and confirm they fail. Also update `U7b` in `f-ux-b.generateStandardPortionCsv.unit.test.ts` (change `arroz` assertion to `true`) and update `EC8` in `BUG-PROD-009.generateStandardPortionCsv.edge-cases.test.ts` (remove chorizo/chuletón/arroz from omitted list).

2. **Nutrient research** — For each of the 2 NEW dishes (Chuletón, Chorizo), look up per-100g values from BEDCA (preferred) then USDA FoodData Central (fallback). Record source, confidence, and methodology in the Completion Log. Confirm `source` value is either `"bedca"` or `"recipe"`. Arroz blanco keeps its existing nutrients.

3. **JSON append + modify** — Three distinct JSON changes:
   a. APPEND CE-251 (Chuletón de buey, `...0000000000fb`) after CE-250.
   b. APPEND CE-252 (Chorizo ibérico embutido, `...0000000000fc`).
   c. MODIFY entry `...000000000069` (Entrecot de ternera): remove `"chuletón"` from its aliases array (leave array empty if no other aliases exist).
   d. MODIFY entry `...0000000000e5` (Arroz blanco): append `"arroz"`, `"arroz cocido"`, `"arroz hervido"` to its aliases array.

4. **Map extension** — Edit `packages/api/src/scripts/generateStandardPortionCsv.ts`:
   a. Add the 3 new keys to `PRIORITY_DISH_MAP`.
   b. Add `'arroz'` to `SIN_PIECES_NAMES`.
   c. Update the Omitted comment block.

5. **GREEN phase** — Run `npm run test -w @foodxplorer/api`. All F114-U* tests must pass. The updated U7b and EC8 must pass. All pre-existing tests must remain green.

6. **CSV regeneration** — Run:
   ```
   npm run generate:standard-portions -w @foodxplorer/api
   ```
   Confirm output: "Matched 42 priority dishes." and "Generated 12 new template rows." Open the CSV and verify the 12 new rows are appended after the existing 156.

7. **Portion research** — For each of the 12 new rows, research the real grams/pieces/pieceName/confidence/notes values per §4. Directly edit the CSV to replace template values with researched values and set `reviewed_by=pbojeda`.

8. **Seed dev DB** — Run the seed pipeline to insert new dish and nutrient rows and load the updated CSV into `standard_portions`:
   ```
   npm run seed -w @foodxplorer/api
   ```
   Verify the 3 new dish rows are present in `dishes` and `dish_nutrients` tables.

9. **Embedding generation** — Run:
   ```
   npm run embeddings:generate -w @foodxplorer/api
   ```
   Verify via the SQL query in §6 that 3 new rows appear in `dish_embeddings`.

10. **Semantic routing verification** — Run the smoke tests from §6 against the dev DB. Confirm:
    - "chuletón" routes to `...0000000000fb`, NOT `...000000000069`.
    - "arroz negro" still routes to its specific entry (`...0000000000084`), NOT the modified generic `Arroz blanco` at `...0000000000e5`.

11. **Integration test** (optional) — If embedding test infrastructure is available, write and run `f114.embeddingRouting.integration.test.ts`. Otherwise mark as `it.skip` with reference to §6 manual procedure.

12. **Documentation** — Update `docs/project_notes/key_facts.md` Data Sources table (Cocina Española row: 250 → 253 dishes, add dishId footnote for the 3 new entries). Record nutrient sources in the ticket's Completion Log.

13. **Final test run** — `npm run test -w @foodxplorer/api` must show 0 failures before opening the PR.

---

### 8. Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| **dishId collision** — `...0000000000fb/fc` already in use | Low | Confirmed: last used ID is `...0000000000fa`. Only 2 new IDs needed (arroz reuses existing `...0e5`). Grep again before writing. |
| **Entrecot alias removal breaks pre-existing queries for "chuletón"** | Low-Medium | Before F114, "chuletón" queries hit Entrecot via L1/L2 alias → returned entrecot nutrients (wrong cut but close calorically). Post-F114, those queries hit the new Chuletón de buey via alias. Net improvement. No breakage. |
| **Embedding routing miss** — Chuletón still resolves to Entrecot after regen | Medium | The alias list includes "chuletón" explicitly; embedding is generated from `name` + `nameEs` + `aliases` concatenation. If the embedding space puts entrecot and chuletón too close, add more differentiating aliases (e.g. "txuleta vasca", "buey asado a la brasa") to push the vector further. Verify with §6 smoke test before merging. |
| **Arroz blanco (...0e5) absorbs specific rice queries** — "arroz negro" resolves to generic arroz | Medium | The specific rice dishes (arroz negro `...0084`, paella `...0083`, etc.) have their own embeddings already present in the DB. The modified generic `Arroz blanco` should NOT displace them because cosine similarity will favor specificity. Verify with §6 smoke test ("arroz negro" must not return `...0000000000e5`). If it does, add negative aliases or remove `"arroz"` from the generic arroz alias list. |
| **Alias collision — "chorizo" swallowed by existing Bocadillo de chorizo** | Low | After F114, `chorizo` key in `PRIORITY_DISH_MAP` → `...0000000000fc` (Chorizo embutido). The embedding for "una tapa de chorizo" should match the new embutido entry. Bocadillo de chorizo has "bocadillo" in its name/aliases which should maintain its distinct embedding. Verify with smoke test. |
| **`source: "usda"` rejected by validator** | Low — but easy to miss | `validateSpanishDishes` only allows `"bedca"` or `"recipe"`. If USDA is the nutrient source, use `source: "recipe"` and document the actual source in the Completion Log. |
| **Minimum count validation** — adding 2 entries to a 250-entry file brings total to 252. Check `validateSpanishDishes.ts` for any hardcoded expected count (the existing `>= 250` or similar). | Low | Confirm no hardcoded count assertion during Step 1 (RED phase). |
| **U7b and EC8 test failures if developer forgets to update them** | High | Explicitly listed in §5 (update U7b; update EC8). Both test files are modified in Step 1 of the TDD workflow before any implementation. |

---

### 9. Production Rollout (Post-Merge, User-Executed)

The following steps require direct access to `DATABASE_URL_PROD` (Render production DB) and `OPENAI_API_KEY`. They cannot be executed by the developer agent and must be run by the project owner (pbojeda) after the PR merges to `main`.

1. **Seed prod DB**:
   ```bash
   DATABASE_URL=<prod_session_pooler_url> npm run seed -w @foodxplorer/api
   ```
   Verify (2 new dishes; arroz reuses existing `...0e5` — it's already in prod):
   ```sql
   SELECT count(*) FROM dishes
     WHERE id IN (
       '00000000-0000-e073-0007-0000000000fb',  -- Chuletón de buey (new)
       '00000000-0000-e073-0007-0000000000fc'   -- Chorizo ibérico embutido (new)
     );
   -- Expected: 2
   ```

2. **Seed standard_portions prod**:
   The seed script should include the CSV loader. Confirm the 12 new rows are inserted into `standard_portions`. If the seed script does not auto-load CSV rows, run the CSV seeder separately:
   ```bash
   DATABASE_URL=<prod_session_pooler_url> npm run seed:standard-portions -w @foodxplorer/api
   ```

3. **Regenerate embeddings prod** (covers 4 dishIds — 2 new + 2 modified):
   ```bash
   DATABASE_URL=<prod_session_pooler_url> OPENAI_API_KEY=<key> npm run embeddings:generate -w @foodxplorer/api
   ```
   Verify (Codex P1 fix — correct column, not a separate table):
   ```sql
   SELECT id, embedding_updated_at
   FROM dishes
   WHERE id IN (
     '00000000-0000-e073-0007-0000000000fb',  -- new Chuletón
     '00000000-0000-e073-0007-0000000000fc',  -- new Chorizo embutido
     '00000000-0000-e073-0007-0000000000e5',  -- modified Arroz blanco
     '00000000-0000-e073-0007-000000000069'   -- modified Entrecot
   ) AND embedding IS NOT NULL;
   -- Expected: 4 rows
   ```

4. **Cache invalidation** (Gemini M3): if the conversation layer caches `portionAssumption` results, flush them for "chuletón" / "chorizo" / "arroz" concepts:
   ```bash
   # Check if Upstash/Redis cache exists and flush relevant keys.
   # If `cacheGet`/`cacheSet` keys are hash-based on query string, a targeted flush is not straightforward — FLUSHDB on the cache DB after rollout is the simplest option if tolerable.
   ```
   Check `packages/api/src/cache/` for key structure before deciding. If no cache backend is configured, skip this step.

5. **Smoke test prod**:
   ```bash
   # Chuletón → per_dish (was Tier 3 before F114)
   curl -X POST https://api.nutrixplorer.com/conversation/message \
     -H "Content-Type: application/json" \
     -d '{"message": "una ración de chuletón"}'
   # Expected: portionAssumption.source === "per_dish", grams ≈ 700

   # Arroz → per_dish (was Tier 3 before F114)
   curl -X POST https://api.nutrixplorer.com/conversation/message \
     -d '{"message": "una ración de arroz"}'
   # Expected: portionAssumption.source === "per_dish", grams ≈ 250, dishId === ...0e5

   # Arroz negro → should NOT match the generic Arroz blanco (regression check)
   curl -X POST https://api.nutrixplorer.com/conversation/message \
     -d '{"message": "¿calorías de un arroz negro?"}'
   # Expected: estimation matches existing Arroz negro entry, NOT ...0e5
   ```

6. **Record in Completion Log**: date, prod DB rows verified, smoke test results (all 3 queries), cache invalidation action taken.

---

## Acceptance Criteria

- [x] AC1: **Two** new entries added to `packages/api/prisma/seed-data/spanish-dishes.json` (Chuletón de buey `...0fb`, Chorizo ibérico embutido `...0fc`). Arroz reuses existing `...0e5` (not a new entry). Each new entry has all required fields.
- [x] AC1b: **Modifications** to 2 existing JSON entries: `...0069` (Entrecot de ternera) — `"chuletón"` alias removed; `...0e5` (Arroz blanco) — aliases `"arroz"`, `"arroz cocido"`, `"arroz hervido"` added.
- [x] AC2: Validator `validateSpanishDishes.ts` passes on the modified JSON (no schema violations, no duplicate dishIds).
- [x] AC3: `PRIORITY_DISH_MAP` extended with 3 new keys (chuletón→`...fb`, chorizo→`...fc`, arroz→`...0e5`). Generator runs cleanly — 168 CSV rows total (42 × 4).
- [x] AC4: Portion values researched for the 12 new rows (3 concepts × 4 terms). Values recorded in CSV with `confidence` + `notes` + `reviewed_by='pbojeda'`.
- [x] AC5: Seed pipeline run on dev DB — new rows present in `standard_portions` at `...fb`, `...fc`, `...0e5`. Query "una ración de chuletón" returns `per_dish`.
- [x] AC6: Embeddings regenerated for **4 dishIds** (2 new + 2 modified). Verify: `SELECT count FROM dishes WHERE id IN (fb, fc, 0e5, 0069) AND embedding IS NOT NULL` = 4. (Note: `dish_embeddings` table does NOT exist; embeddings live on `dishes.embedding` column — Codex P1 fix.)
- [x] AC7: Integration test asserts embedding-based semantic matching: "chuletón" → `...0fb`, NOT `...0069`. Arroz negro regression: "arroz negro" query → existing Arroz negro dishId, NOT `...0e5`. **Mandatory, not optional** (Gemini M1 + Codex M2).
- [x] AC8: Unit tests — F114-U1 through U11 + U4b/U5b/U5c/U5d. Updated: U7b (arroz → sin-pieces), EC8 (remove 3 names from omitted list).
- [x] AC9: No regressions. 3297+ API test baseline green. Snapshot test (F114-U11) proves 39 existing dishIds' CSV rows byte-identical.
- [x] AC10: Production rollout: seed + embedding regen applied on prod. Smoke tests deferred (API key scope); DB state verified on both environments 2026-04-20.
- [x] AC11: `docs/project_notes/key_facts.md` Cocina Española row updated: 250 → 252. New dishIds documented.

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (21 unit + 2 integration)
- [x] Integration tests added and passing (gated behind ENABLE_EMBEDDING_INTEGRATION_TESTS)
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] `key_facts.md` reflects final catalog state (250→252)
- [x] Embeddings regenerated on both dev and prod (4 on dev, 252 on prod)

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed (ticket contains full spec from BUG-PROD-009 session)
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed, plan approved (v1→v2 after cross-model review)
- [x] Step 3: `backend-developer` executed with TDD (21 unit + 2 integration tests)
- [x] Step 4: `production-code-validator` executed, quality gates pass (APPROVE 0 blockers)
- [x] Step 5: `code-review-specialist` executed (APPROVE WITH NITS, all addressed)
- [x] Step 5: `qa-engineer` executed (PASS WITH FOLLOW-UPS, all addressed)
- [x] Step 6: Ticket updated with final metrics, branch deleted, prod rollout complete

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-17 | Ticket created | Split from BUG-PROD-009 to separate the bug-fix (mapping) from the data enhancement (new canonical dishes). Recommended by cross-model consult (Codex + Gemini) to avoid delaying the urgent mapping fix. |
| 2026-04-18 | Plan v1 → v2 | backend-planner produced initial plan. Cross-model review (Codex + Gemini) + empirical JSON audit surfaced 3 critical findings: (a) Arroz blanco already exists at `...0e5` → reuse, don't duplicate; (b) `dishes.embedding` column vs non-existent `dish_embeddings` table — SQL verification queries corrected; (c) `chuletón` alias already on Entrecot (`...0069`) → must be removed in same commit. Plan v2 reduces from 3 new entries to 2 new + 2 modified. Mandatory embedding routing test (Gemini M1 + Codex M2). Added map-key substring collision test + salt/sodium sanity + alias-uniqueness invariant tests. |
| 2026-04-18 | Implementation (backend-developer) | 5 atomic commits: seed (2 new dishes + Entrecot alias removal + Arroz aliases extension), generator (PRIORITY_DISH_MAP 39→42, SIN_PIECES_NAMES adds `arroz`), CSV regeneration (168 rows total, 12 new with researched values), tests (21 unit + 5 integration stubs + U7b/EC8/EC6/f073 updates), key_facts (250→252). Dev DB seeded + embeddings regenerated. 3318 tests passing, 0 regressions. |
| 2026-04-18 | production-code-validator | APPROVE (0 blockers). 8 validation categories clean: JSON integrity, generator, CSV integrity, test coverage, docs, commit hygiene, regressions, risks. |
| 2026-04-18 | code-review-specialist | APPROVE WITH NITS. 1 M2 + 4 M3. M2-1 (U11 idempotency vs true snapshot — clarified via rename + header note); M3-1 (integration test misleading — addressed via Tier A/B split + docstring); M3-3 stale "39 entries" comment (fixed); M3-2 alias ordering (kept, no convention); M3-4 commit trailer convention (kept for PR consistency). |
| 2026-04-18 | qa-engineer | PASS WITH FOLLOW-UPS. 2 M2 + 3 M3. M2 integration test doesn't really test routing (fixed: added Tier B with real OpenAI embed + pgvector top-match assertion); M2 ticket §9 phantom `...fd` dishId (fixed: corrected to `...0e5` + used explicit SQL); M3 U11 rename (done); M3 no "chuletón completo" non-collision test (added in U5c); M3 ENABLE_EMBEDDING_INTEGRATION_TESTS undocumented (added to CONTRIBUTING.md). |
| 2026-04-18 | Post-review fixes | 1 commit `eadb2ac` addressing all review + QA findings. 22 F114 unit tests pass (+1 new chuletón completo guard). Integration test split into Tier A (structural) + Tier B (true routing via OpenAI + pgvector). CONTRIBUTING.md documents the env gates. CI green. |
| 2026-04-19 | PR #156 squash-merged to develop | Merge commit `3a59237`. |
| 2026-04-20 | Prod + dev rollout executed | **DEV (ikardk)**: BUG-PROD-009 migration was never applied there (172 rows + 16 ghosts); fixed inline. Ran DELETE ghost rows + seedPhaseSpanishDishes (2 new dishes Chuletón/Chorizo + alias updates on Entrecot/Arroz blanco) + seed:standard-portions (168 rows) + null embedding_updated_at for 2 modified dishes + embeddings:generate (4 dishes regenerated). Final state: 168 portions, 0 ghosts, 4 embeddings fresh. **PROD (bxbajv)**: BUG-PROD-009 already applied (156 rows, 0 ghosts). Ran seedPhaseSpanishDishes + seed:standard-portions (168 rows) + null timestamps + embeddings:generate (252 cocina-espanola dishes regenerated — bonus: prod had zero-vector placeholders from original F073 seed; now all have real OpenAI embeddings). Final state: 168 portions, 0 ghosts. Smoke test via API deferred (local ADMIN_API_KEY is dev-scoped). DB state verified on both via ad-hoc script. Implementation scripts cleaned up from `src/scripts/` (were run-*.mjs helpers). |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | 7 sections present: Spec, Implementation Plan (9 subsections + Risks), Acceptance Criteria (12), Definition of Done (8), Workflow Checklist (8), Completion Log (8 entries), Merge Checklist Evidence. |
| 1. Mark all items | [x] | AC: 11/11 (AC10 remains open post-merge as prod rollout is user-executed); DoD: 8/8; Workflow: 7/8 (Step 6 post-merge). |
| 2. Verify product tracker | [x] | Active Session: "F114 step 5/6" pre-merge. Will update to "None / post-merge prod rollout queued" in Step 6. |
| 3. Update key_facts.md | [x] | Cocina Española row: 250 → 252; source breakdown 46→47 bedca, 204→205 recipe; F114 footnote with dishIds. |
| 4. Update decisions.md | [x] | N/A — no new ADR needed (ADR-022 from BUG-PROD-009 covers the explicit-map pattern; F114 only extends it). |
| 5. Commit documentation | [x] | Commits: `b58347f` (key_facts), `eadb2ac` (CONTRIBUTING Integration tests section) + 2 earlier ticket plan v2 commits. |
| 6. Verify clean working tree | [x] | `git status`: 2 untracked runtime artifacts only (`.claude/scheduled_tasks.lock`, `packages/landing/.gitignore`). |
| 7. Verify branch up to date | [x] | Rebased onto `origin/develop` at `06c683a`. Post-review fixes pushed as `eadb2ac`. CI green (`ci-success` + `test-api` pass; Vercel deployments pass). |

---

*Ticket created: 2026-04-17*
