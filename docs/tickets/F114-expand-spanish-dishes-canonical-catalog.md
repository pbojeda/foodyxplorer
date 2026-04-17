# F114: Expand Spanish canonical dishes JSON — add Chuletón, Chorizo embutido, Arroz blanco

**Feature:** F114 | **Type:** Backend-Feature | **Priority:** Medium
**Status:** In Progress | **Branch:** feature/F114-expand-spanish-dishes
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-17 | **Dependencies:** BUG-PROD-009 (explicit-map generator must land first so new entries can be mapped correctly)

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

_Pending — to be generated by `backend-planner` in Step 2._

---

## Acceptance Criteria

- [ ] AC1: Three new entries added to `packages/api/prisma/seed-data/spanish-dishes.json`: Chuletón de buey, Chorizo ibérico embutido, Arroz blanco cocido. Each has all required fields (externalId, dishId, nutrientId, name, nameEs, aliases, category, portionGrams, confidenceLevel, estimationMethod, source, nutrients).
- [ ] AC2: Validator `packages/api/prisma/seed-data/validateSeedData.ts` passes on the extended JSON (no schema violations, no duplicate dishIds).
- [ ] AC3: `PRIORITY_DISH_MAP` (from BUG-PROD-009) updated with three new keys pointing at the new dishIds. Generator runs cleanly and produces 12 new CSV rows (3 dishes × 4 terms).
- [ ] AC4: Portion values researched for the 3 new dishes × 4 terms (12 rows total) using the same methodology as 2026-04-17 research round. Values recorded in CSV with `confidence` + `notes` + `reviewed_by='pbojeda'`.
- [ ] AC5: Seed pipeline run on dev DB — new rows present in `standard_portions`. Old Tier 3 queries ("una ración de chuletón") now return `portionAssumption.source === 'per_dish'`.
- [ ] AC6: Embeddings regenerated for the 3 new dishes: `npm run embeddings:generate -w @foodxplorer/api`. Verify via `SELECT COUNT(*) FROM dish_embeddings WHERE dish_id IN (<new ids>)` = 3.
- [ ] AC7: Integration test asserts embedding-based semantic matching: query embedding of "chuletón" → nearest dish is the new chuletón, not Entrecot de ternera.
- [ ] AC8: Unit tests added for JSON structure validation of new entries.
- [ ] AC9: No regressions in existing seed/estimation tests (5000+ baseline green).
- [ ] AC10: Production rollout: embeddings + seed applied in prod. Smoke test passes: query "una ración de chuletón" returns `grams ≈ 700`, `source === 'per_dish'`.
- [ ] AC11: `docs/project_notes/key_facts.md` "Spanish canonical dishes catalog" reference updated with the 3 new entries and their dishIds.

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] Integration tests added and passing
- [ ] Code follows project standards
- [ ] No linting errors
- [ ] Build succeeds
- [ ] `key_facts.md` reflects final catalog state
- [ ] Embeddings regenerated on both dev and prod

---

## Workflow Checklist

- [ ] Step 0: `spec-creator` executed (optional — this ticket contains the full spec; spec-creator may only need to verify alignment with `docs/research/product-evolution-analysis-2026-03-31.md`)
- [ ] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 2: `backend-planner` executed, plan approved
- [ ] Step 3: `backend-developer` executed with TDD
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-17 | Ticket created | Split from BUG-PROD-009 to separate the bug-fix (mapping) from the data enhancement (new canonical dishes). Recommended by cross-model consult (Codex + Gemini) to avoid delaying the urgent mapping fix. |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | Sections verified: (list) |
| 1. Mark all items | [ ] | AC: _/11, DoD: _/8, Workflow: _/8 |
| 2. Verify product tracker | [ ] | Active Session: step _/6, Features table: _/6 |
| 3. Update key_facts.md | [ ] | Updated: Spanish canonical dishes catalog |
| 4. Update decisions.md | [ ] | N/A (no architectural decision; follows ADR from BUG-PROD-009) |
| 5. Commit documentation | [ ] | Commit: (hash) |
| 6. Verify clean working tree | [ ] | `git status`: clean |
| 7. Verify branch up to date | [ ] | merge-base: up to date / merged origin/develop |

---

*Ticket created: 2026-04-17*
