# F-CATALOG-COV-001: Catalog Coverage Round-3 — Targeted Seed/Alias Expansion

**Feature:** F-CATALOG-COV-001 | **Type:** backend-feature (data) | **Priority:** Medium
**Status:** Planning | **Complexity:** Standard
**Branch:** feature/F-CATALOG-COV-001-catalog-coverage-r3
**Predecessors:** F-H4 (done), F-H6 (done), F-H9 (done)
**Depends on:** F079 (missed_query_tracking telemetry)
**Created:** 2026-05-07 | **Author:** spec-creator agent (PM session pm-conv-polish)
**PM Session:** pm-conv-polish (Pick A — Conversational Polish)

---

## Spec

### Description

**Naming clarification:** This is **catalog coverage Round-3** in the data-expansion sense (predecessors: F-H4 round-1, F-H6 round-2, F-H9 round-cat29). The spec itself has gone through 4 multi-round cross-model review iterations (R1–R4). Downstream tracker, PR title, and feature ID use "Round-3".

Round-3 expansion of the Spanish dish catalog to close the residual NULL gaps that F-H6 and F-H9
left open.

**User-visible problem:** When a user queries a dish that is absent from the catalog, the estimation
pipeline (L1→L2→L3) falls through to L4 (LLM) or returns NULL — producing a "I don't know" response
or no caloric estimate at all. Even one NULL per session creates measurable friction: the user either
re-phrases repeatedly or abandons the query. The QA battery (2026-04-21, 350 queries) recorded
49 residual NULLs post-sprint; the production telemetry table (`missed_query_tracking`, F079)
captures ongoing NULL occurrences from real users.

**What F-H6/F-H9 resolved vs. what remains:**
- F-H6 (2026-04-26): closed Cat 21 (Cocina Regional, 28 atoms + 6 aliases) and Cat 22
  (Internacional en España, 19 atoms + 2 aliases). Total: +28 atoms, +6 aliases on existing.
- F-H9 (2026-04-27): closed Cat 29 (Fecha/Hora/Contexto wrappers, 10 atoms + 1 alias).
  Total: +10 atoms, +1 alias.
- **Residual for R3:** NULLs in categories NOT covered by F-H6/F-H9, surfaced by:
  (a) the 49 remaining QA battery NULLs post-sprint, excluding intentional/script NULLs;
  (b) new production traffic captured in `missed_query_tracking` since those deploys.

**R3 does NOT redo:** Cat 21, Cat 22, or Cat 29 (those are complete). It addresses whatever
NULL-producing query patterns the planner identifies as highest-frequency in the PRIMARY and
SECONDARY sources below.

**Scope:** **Data-first feature with a narrowly-scoped test/export exception:** seed-data additions in `spanish-dishes.json` and `standard-portions.csv`, three new test files (per AC-14), and one one-keyword production export edit (per AC-NEW-export). No other TypeScript modifications. No schema migrations, no NLP-layer changes. Target: 0–60 new atoms AND 0–N new aliases (any mix), provided (a) the ≥75% NULL→OK success metric is met AND (b) at least one data addition exists overall (alias-only fixes are valid if they achieve the coverage target). Follows the F-H4/F-H6/F-H9 multi-batch commit pattern.

**Catalog baseline at spec time:** 319 dishes (50 BEDCA + 269 recipe) per
`docs/project_notes/key_facts.md:95` (F073/F114/F-H4/F-H6/F-H9/F-CHARCUTERIE-001 tags).
The next available externalId is **CE-321** (dishId hex `0x141`).

---

### API Changes

None. Seed data only.

---

### Data Model Changes

No schema changes. All additions conform to the existing `Dish`, `DishNutrient`, and
`StandardPortion` tables and the validator invariants in `validateSpanishDishes.ts`.

- **`packages/api/prisma/seed-data/spanish-dishes.json`**: N new atom entries starting at CE-321
  (exact count determined by planner in Step 2 based on PRIMARY/SECONDARY source ranking); plus M
  alias additions on existing entries. The planner must produce the pre-analysis table (query →
  atom or alias verdict) before committing any JSON.
- **`packages/api/prisma/seed-data/standard-portions.csv`**: new portion rows for each new dishId
  (3–4 rows per dish: `pintxo | tapa | media_racion | racion`). No CSV rows needed for alias-only
  additions.
- **`packages/api/src/__tests__/f073.seedPhaseSpanishDishes.edge-cases.test.ts`**: hardcoded dish
  count assertions updated to `319 + N` (exact lines to be verified empirically at planning time).
- **`packages/api/src/__tests__/f114.newDishes.unit.test.ts`**: count assertions updated to
  `319 + N`.
- **`packages/api/src/__tests__/fH6.seedExpansionRound2.edge-cases.test.ts`**: count assertions
  (L8, L117, L118, L124, L125) updated to `319 + N`. fH6 count assertions may need updating,
  but H6-EC-11 logic (findIndex-based) requires NO change — the `findIndex(d => d.externalId ===
  'CE-280')` locator is invariant to subsequent batch appends; no slice arithmetic adjustment is
  needed after R3 additions.
- **`packages/api/src/__tests__/fH9.cat29.unit.test.ts`**: count references (if any hardcoded
  totals) updated to `319 + N`.
- **`packages/api/src/__tests__/fCOV-001.r3.unit.test.ts`** (NEW): table-driven unit test file
  asserting at least one `level1Lookup` simulation fixture per NULL category closed. Pattern
  follows `fH9.cat29.unit.test.ts` (itself patterned on H6-EC-12).
- **`docs/project_notes/key_facts.md:95`**: dish count updated from `319` to `319 + N`; import-tag
  suffix updated to include `F-CATALOG-COV-001`.

---

### UI Changes

None. Data propagates via the existing estimation pipeline (L1 FTS/GIN exact-alias match →
improved NULL→OK rate transparent to the frontend).

---

### Edge Cases & Error Handling

1. **Source/confidence/estimationMethod triple**: all new recipe atoms use
   `source=recipe + confidenceLevel=medium + estimationMethod=ingredients`. The validator enforces
   this triple. Any atom with `source=bedca` must have `confidenceLevel=high` and
   `estimationMethod=official` — only permissible if the dish has a direct BEDCA ingredient entry.

2. **ADR-019 compliance:** if any new alias is a bare short-form culturally-common Spanish noun
   (single token, e.g. `"pan"`, `"pollo"`, `"queso"`, `"jamon"`), it MUST NOT be added as a
   disambiguation alias unless (a) the canonical target dish is unambiguous, (b) the target atom
   has `source=bedca` or another Tier-1 source (preferred); if only `source=recipe` is available,
   the addition is permitted only with an explicit lower-confidence flag in the Pre-analysis table
   justifying why no Tier-1 source exists, (c) the "exactly one owner" invariant is asserted in
   `packages/api/src/__tests__/bug-prod-003.disambiguation.test.ts`, and (d) the full three-part
   scrutiny (canonical dish? Tier-1 source preferred / recipe with justification? uniqueness test?)
   is documented in the ticket's Pre-analysis table. See `docs/project_notes/decisions.md:20-41`.

3. **HOMOGRAPH_ALLOW_LIST**: run `validateSpanishDishes.ts` (via
   `npm test -w @foodxplorer/api -- fH4B.validateSpanishDishes.uniqueness`) after each commit
   batch. If a collision is detected, qualify the alias further (preferred over adding to
   `HOMOGRAPH_ALLOW_LIST`).

4. **Duplicate pre-check (mandatory)**: before committing any atom, grep `spanish-dishes.json`
   (nameEs + aliases, normalised lowercase) to confirm the dish is absent. The planner's
   pre-analysis table must document this verification for each proposed atom.

5. **Rollback**: seed uses `upsert`; `git revert` alone does not delete DB rows. The PR body must
   include a DELETE SQL block for all new dishIds (same pattern as F-H4 PR #196, F-H6, F-H9).

6. **Hardcoded count updates**: empirically verify all `319` occurrences in the three count-
   assertion test files before the final commit. CI must be GREEN only after the count-update
   commit (intentional RED on intermediate data-only commits is acceptable per F-H4/F-H6/F-H9
   precedent).

7. **UUID hex case**: all dishId/nutrientId UUID strings in JSON must use lowercase hex only
   (validator regex `^[0-9a-f]{...}$` is strict). Hex shorthand in documentation is informational
   only — JSON literals must be lowercase.

8. **fH6 H6-EC-11 findIndex invariant**: the H6-EC-11 test was rewritten (prior to R3) to locate
   the F-H6 batch via `dishes.findIndex(d => d.externalId === 'CE-280')` instead of negative-index
   slicing. This approach is future-proof against subsequent batch appends. R3 appends MUST NOT
   break it because the test locates the F-H6 batch by `findIndex(CE-280)`, which is invariant to
   subsequent appends. AC-10 verifies the test still passes after R3 appends without modification
   to the findIndex logic.

---

## Inputs and Data Sources

### PRIMARY — missed_query_tracking telemetry (production NULL frequency)

**Table:** `missed_query_tracking` (Prisma model added in F079; endpoint:
`GET /analytics/missed-queries`).

**Tracking fields** (per F079 Zod schema `MissedQueryTrackingSchema`):
`id`, `queryText`, `hitCount`, `status`, `resolvedDishId`, `notes`, `createdAt`, `updatedAt`.

**Status field enum** (per F079 Zod schema `MissedQueryStatusSchema`):
- `pending` — new NULL, not yet actioned
- `resolved` — NULL was closed by a data or code fix
- `ignored` — intentionally deferred (opinion/recommendation class, garbage queries, etc.)

**Fallback rule:** If `GET /analytics/missed-queries?timeRange=all&topN=100&minCount=2` returns
zero actionable rows (empty production telemetry, e.g. pre-launch or very low traffic), the
planner uses SECONDARY + TERTIARY sources only and locks `N_LOCKED` from that combined set. This
fallback must be documented in the pre-analysis table preamble so reviewers understand PRIMARY
was not available.

**What the endpoint actually returns:** The endpoint (implemented in
`packages/api/src/routes/missedQueries.ts:77`, confirmed in `docs/specs/api-spec.yaml:3078`)
returns aggregated rows with the fields `{ queryText, count, trackingId, trackingStatus }` over
the **entire** `query_logs` history. It does NOT filter by deploy date, does NOT filter by
tracking status, and does NOT return `first_seen`/`last_seen` timestamps. The planner MUST apply
manual post-fetch filtering:
- Exclude rows where `trackingStatus IN ('resolved', 'ignored')` — these are already-actioned
  or intentionally deferred queries.
- Use the QA-improvement sprint report (2026-04-21) as a date proxy: any query already
  documented in that report's residual table is a "known miss" and should be ranked accordingly.
- If a richer post-H9 ranking is required (e.g. filtering by `queried_at >= F-H9 deploy date`),
  the planner can run a one-off SQL query against `query_logs.queried_at` directly — this is
  NOT part of the F079 endpoint contract and must be run as a manual DB query.

SQL pseudocode for one-off post-H9 ranking (NOT the endpoint contract — manual DB query only):

```sql
-- Ranked NULL candidate list for R3 (manual DB query, not endpoint output)
SELECT
  ql.query_text,
  COUNT(*) AS occurrence_count,
  mqt.status AS tracking_status
FROM query_logs ql
LEFT JOIN missed_query_tracking mqt ON mqt.query_text = ql.query_text
WHERE
  ql.level_hit IS NULL
  AND LENGTH(ql.query_text) >= 3
  AND (mqt.status IS NULL OR mqt.status = 'pending')
  AND ql.queried_at >= '<F-H9 deploy date>'   -- only post-H9 NULLs
GROUP BY ql.query_text, mqt.status
HAVING COUNT(*) >= 2                           -- minCount filter
ORDER BY occurrence_count DESC
LIMIT 100;                                     -- topN=100 (schema max; default is 20)
```

The planner **must** call `GET /analytics/missed-queries?timeRange=all&topN=100&minCount=2`
(explicitly requesting `topN=100`, the schema's max; default is 20) and then apply the manual
filters above. The endpoint response shape is:
`{ data: { missedQueries: [{ queryText, count, trackingId, trackingStatus }], ... } }`.
Queries appearing ≥3 times (after filtering resolved/ignored) are strong candidates for atom or
alias additions.

### SECONDARY — QA battery residual NULLs (post-sprint, 2026-04-21)

**File:** `docs/research/qa-improvement-sprint-report-2026-04-21.md` §5 "The 49 Remaining NULLs"

**How to use during planning:** Cross-reference the sprint report's residual NULL table against the
PRIMARY telemetry. For each residual NULL category, exclude:
- "Intentional NULL (Category D)" — 5 queries, by design, do NOT add.
- "Script-limit (Category 10 menu envelope)" — 6 queries, not a data gap.
- "Garbage / edge case" — 4 queries, intentional NULL.

**Actionable residual candidates (extract for planning):**

| Classification | Count | Addressable by R3? |
|----------------|------:|-------------------|
| P9 typos (deferred) | 6 | Partial — add orthographic aliases for the correctly-spelled form where the dish exists |
| Multi-item / Category C | 8 | No — requires menuDetector extension (NLP layer, out of scope) |
| F-NLP + F-COUNT chain gap | 2 | No — pipeline re-ordering issue (NLP layer, out of scope) |
| Chain/brand detection gaps | 4 | Partial — check if missing atom vs. brand tuning issue |
| Specific-modifier gaps | 6 | No — F-COUNT pattern additions (NLP layer, out of scope) |
| Specific dish miss | 1 | YES — `"croquetas de jamón ibérico"` alias gap on existing atom |
| Other | 7 | Case-by-case; primarily single-dish alias gaps or rare phrasings — planner triages individually |
| **Total actionable** | **~8–14** | subset of the 49 |

The planner must apply the atom-vs-alias decision tree (§Selection Methodology) to each actionable
candidate from this source.

### TERTIARY — Post-2026-04-21 QA artifacts

**How to identify:** List all `docs/research/qa-*.md` files with modification date after
2026-04-21. As of spec time (2026-05-07), no new QA research files exist beyond those from the
April sprint. The planner must verify this at Step 2 with:

```bash
ls -lt docs/research/qa-*.md | head -10
```

If new QA artifact files exist, include their residual NULLs in the candidate pool (same
atom-vs-alias evaluation process as SECONDARY).

---

## Selection Methodology

### Atom vs. Alias Decision Tree

For each NULL-producing query (after normalisation: lowercase, F078-style prefix-strip):

```
1. Does the dish have an existing atom in spanish-dishes.json?
   │
   ├── NO → Is the dish nutritionally distinct from all existing atoms?
   │         │
   │         ├── YES → NEW ATOM (assign next CE-N / 0xHH identifier)
   │         │
   │         └── NO  → TREAT AS ALIAS (map to closest nutritionally-equivalent atom)
   │
   └── YES → Is the query form a synonym, spelling variant, or regionalism of the existing atom?
             │
             ├── YES → NEW ALIAS on existing atom
             │
             └── NO  → Investigate: likely NLP-layer issue (out of scope) or compound query
                        (menu intent — out of scope). Document as DEFERRED.
```

**New atom examples** (from F-H6/F-H9 precedent):
- `Tortilla francesa` — nutritionally distinct from `Tortilla de patatas`; no atom existed → CE-316 new atom.
- `Sobrassada con miel` — cured pork + honey composition distinct from any existing embutido atom → CE-282.

**New alias examples:**
- `"migas con huevo"` → CE-094 Migas (same dish, different preparation descriptor) → alias.
- `"bocata de pavo con queso"` → CE-313 Bocadillo de pavo con queso (slang form) → alias on new atom.
- `"croquetas de jamón ibérico"` → existing croquetas atom (if one exists) → alias.

**Nutritional distinctness test:** two dishes are nutritionally distinct if ANY of the following
hold (use BEDCA/USDA/Wikipedia as arbiters; if in doubt, treat as alias):
- kcal/100g values differ by ≥30%, OR
- any single macronutrient (protein, fat, carbs) gram value per 100g differs by ≥50%, OR
- primary-macronutrient-class differs (e.g., protein-dominant vs. carb-dominant vs. fat-dominant).

### ADR-019 Compliance (Mandatory for Bare Short-Form Aliases)

**Cite:** `docs/project_notes/decisions.md:20-41` (ADR-019).

If any proposed alias is a **bare single-token Spanish noun** (e.g. `"pan"`, `"pollo"`, `"queso"`,
`"jamon"`, `"pescado"`, `"marisco"`, `"cava"`), it falls under ADR-019 canonical disambiguation
scope. Three scrutiny questions MUST be answered before adding it:

1. **Canonical target dish?** — Is there exactly ONE culturally-common Spanish default dish for
   this term? (e.g., `"vino"` → Copa de vino tinto; `"cerveza"` → Cerveza lata in tercio
   semantics.) If ambiguous, do NOT add — defer to the disambiguation backlog audit.
2. **Tier-1 source preferred?** — Does the target atom have `source=bedca` or another Tier-1 data
   source? Tier-1 is strongly preferred per ADR-019. If only `source=recipe` is available, the
   addition is still permitted but the Pre-analysis table MUST include an explicit justification
   explaining why no Tier-1 source exists, plus a lower-confidence flag in the entry.
3. **"Exactly one owner" invariant test?** — A new per-term uniqueness assertion MUST be added to
   `packages/api/src/__tests__/bug-prod-003.disambiguation.test.ts` asserting that the new bare
   alias resolves to exactly the intended atom and to no other.

**ADR-019 forbidden patterns** (from F-H6/F-H9):
- Bare `"hamburguesa"`, `"burrito"`, `"ramen"`, `"tacos"`, `"bao"`, `"arepa"`, `"nigiri"`,
  `"uramaki"`, `"tataki"`, `"carpaccio"`, `"sushi"` — these are family/category umbrella terms
  with multiple legitimate canonical defaults. They remain NULL until a dedicated disambiguation
  ticket adds the required uniqueness test guard.
- Bare `"tortilla"`, `"empanada"`, `"croqueta"`, `"boquerón"`, `"gamba"` — family terms with
  multiple dish variants.

---

## Out of Scope

The following are explicitly excluded from this ticket and must NOT be addressed in the
Implementation Plan:

- **Schema migrations**: this is a pure data feature; no Prisma schema changes.
- **L4 LLM behavior changes**: no prompt engineering or LLM configuration changes.
- **Cat 29 queries** (temporal/contextual wrappers): fully resolved by F-H9. Do not re-examine.
- **Cat 21 / Cat 22 queries** (regional + international Spanish dishes): fully resolved by F-H6.
  Do not re-examine, except to add aliases on F-H6 atoms if a new alias gap is identified in
  PRIMARY telemetry (e.g., a new spelling variant for an existing CE-280..CE-307 dish).
- **Non-Spanish cuisine dishes** already covered in F-H6 (poke, ramen, pad thai, etc.): do not
  add further atoms for non-Spanish cuisines unless PRIMARY telemetry identifies a high-frequency
  miss for a dish not in any existing atom.
- **TypeScript code changes**: no new `.ts` files outside the three new test files listed in AC-14:
  `fCOV-001.r3.qa.test.ts`, `fCOV-001.r3.seed.unit.test.ts`, `fCOV-001.r3.unit.test.ts`. Existing
  test files (`f073`, `f114`, `fH6`, `fH9`, `bug-prod-003`) may be edited only for count updates or
  ADR-019 uniqueness assertions (per AC-14). The one permitted production-code edit is the addition
  of `export` to `stripContainerResidual` in
  `packages/api/src/conversation/conversationCore.ts:66` (one keyword, no logic change — see
  AC-NEW-export and AC-14).
- **NLP-layer fixes** (F-NLP, F-MORPH, F-COUNT, F-DRINK patterns): out of scope. If a NULL is
  caused by an NLP extraction failure, it is DEFERRED (log in the pre-analysis table, do not fix
  here).
- **Multi-item / menu intent queries** (Category C NULLs): require `menuDetector.ts` extension —
  separate ticket scope.
- **Category D intentional NULLs** (opinion/recommendation queries): by design, remain NULL.
- **F098 Premium Tier**: entirely separate session, no interaction with this ticket.
- **Chain/brand tuning** (MCDonald's, Subway gaps): brand detector concern, not seed data
  expansion scope unless the fix is a missing Spanish alias on an existing scraped chain entry.

---

## Target Metrics (Success Criteria)

**N_LOCKED definition:** the count of unique actionable raw queries after **cross-source deduplication using the normalization function below**. The dedup happens at planner-time and is recorded in the Pre-analysis preamble. The Pre-analysis table has one row per unique normalized key.

```typescript
function normalizeQueryKey(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[.,;:!?¿¡]+$/, '')   // strip trailing punctuation
    .replace(/\s+/g, ' ');          // collapse internal whitespace
}
```

Example: `'Croquetas de jamón'` and `'croquetas de jamón.'` (trailing period) both normalize to `'croquetas de jamón'` and count once. **AC-12a's helper MUST use this exact function for fixture deduplication. The Pre-analysis preamble records the function definition verbatim so reviewers can verify.**

| Metric | Target | Measurement method |
|--------|--------|--------------------|
| NULL→OK conversion on actionable candidates | ≥75% of all actionable candidates from PRIMARY ∪ SECONDARY ∪ TERTIARY (whichever sources were used) after cross-source dedup via `normalizeQueryKey` — N_LOCKED unique normalized keys (see N_LOCKED definition above). **Two independent gates:** (a) AC-12a seed-layer fidelity test and (b) AC-NEW-qa-battery production parity gate. Both must pass. | Post-merge: re-run battery queries against dev API; compare NULL vs. OK count (AC-NEW-qa-battery); AC-12a mechanical check in CI |
| New atoms added | 0–60 (any count provided ≥75% target met and ≥1 data addition overall) | Atom delta: `git diff --stat` AND `(post_count - 319) === N_atoms_planned`; post-deploy `grep -c '"externalId"' packages/api/prisma/seed-data/spanish-dishes.json` returns `319 + N_atoms` (where N_atoms is recorded in the Pre-analysis table) |
| New aliases added | 0–N (alias-only resolution valid if target met) | Count alias array delta in JSON diff |
| Regressions on F-H4/F-H6/F-H9 fixture tests | 0 | `npm test -w @foodxplorer/api` green on ALL workspaces |
| New fixture coverage | ≥1 `level1Lookup` simulation assertion per NULL category closed | `fCOV-001.r3.unit.test.ts` test count |
| Seed file row-count assertions | All `319+N` assertions pass | CI green on final count-update commit |
| F079 telemetry status | Queries closed by R3 must flip to `status='resolved'` post-deploy | Manual `POST /analytics/missed-queries/{id}/status` with body `{status:'resolved', resolvedDishId:'...'}` per closed query (documented in Completion Log) |

---

## Acceptance Criteria

- [ ] **AC-01 — Input ranking produced:** The planner (Step 2) produced a ranked NULL candidate
  list from PRIMARY source (`GET /analytics/missed-queries?timeRange=all&topN=100&minCount=2`) and
  annotated each entry with its SECONDARY QA battery residual classification (or "new — not in
  battery").

- [ ] **AC-02 — Pre-analysis table complete:** For every candidate in the ranked list, the
  Implementation Plan contains a query-by-query verdict table with columns: `query |
  extracted_term | verdict (MISSING ATOM / ALIAS GAP / NLP FAILURE / DEFERRED) | R3 Action`.
  Every row documents the duplicate pre-check result (grep confirmed absent or grep confirmed
  existing atom externalId).

- [ ] **AC-03 — Data additions present:** At least 1 data addition exists overall (new atom OR new
  alias on an existing atom). New atoms (if any): upper bound 60, sequential externalId starting
  at CE-321, unique dishId hex starting at `0x141`, parallel nutrientId at the same hex offset.
  Alias-only implementations (0 new atoms, N new aliases) are valid provided AC-12 passes.
  **Verification (atom delta):** `git diff --stat` shows the JSON changed; post-merge
  `grep -c '"externalId"' packages/api/prisma/seed-data/spanish-dishes.json` returns `319 + N_atoms`
  (where `N_atoms` is the value recorded in the Pre-analysis table, i.e. `post_count - 319 === N_atoms_planned`).

- [ ] **AC-04 — Atom structure valid:** All new atoms use
  `source=recipe + confidenceLevel=medium + estimationMethod=ingredients` (or
  `source=bedca + confidenceLevel=high + estimationMethod=official` if BEDCA-backed). The field
  `name === nameEs` for all new atoms (validator enforcement). `portionGrams` within [10, 800].

- [ ] **AC-05 — Alias additions count:** Zero or more new aliases on existing atoms. Each alias
  is a multi-word query-specific phrase, orthographic variant, or singular/plural normalisation.
  No bare single-token family-term aliases unless ADR-019 three-part scrutiny is documented and
  a uniqueness assertion is added to `bug-prod-003.disambiguation.test.ts`.

- [ ] **AC-06 — ADR-019 compliance:** If any bare short-form alias IS added (ADR-019 scope),
  the ticket's pre-analysis table documents: (a) canonical target dish, (b) Tier-1 source
  confirmation or explicit flag, (c) uniqueness test assertion added. If zero bare aliases are
  added, this AC is marked N/A with a note.

- [ ] **AC-07 — Validator green:** `validateSpanishDishes(dishes)` returns `{valid: true, errors: []}`
  on the full post-R3 dataset. Verified via
  `npm test -w @foodxplorer/api -- fH4B.validateSpanishDishes.uniqueness`.

- [ ] **AC-08 — JSON schema integrity:** The updated `spanish-dishes.json` is valid JSON (no
  trailing commas, no duplicate keys). Alias arrays are deduplicated (no repeated strings within
  a single atom's alias list). No trailing whitespace on string values.

- [ ] **AC-09 — CSV integrity:** `standard-portions.csv` rows for new dishIds use only valid
  `term` enum values: `pintxo | tapa | media_racion | racion`. Any dish served in countable units
  uses `pieces` (number) and `pieceName` (string) columns on a `racion` or `media_racion` row
  (not a new `piece` term). Validated by `seedStandardPortionCsv.ts` parser.

- [ ] **AC-10 — Regression: existing fixture tests pass:** All pre-existing test files
  (`f073`, `f114`, `fH6`, `fH9`, `fH4B.validateSpanishDishes.uniqueness`) pass with the updated
  counts. The fH6 H6-EC-11 test uses `findIndex(d => d.externalId === 'CE-280')` and requires
  NO modification after R3 appends — the invariant is already future-proof. The implementer must
  confirm the test passes as-is after adding R3 atoms (see Edge Case §8).

- [ ] **AC-11 — New fixture files:** `packages/api/src/__tests__/fCOV-001.r3.unit.test.ts` exists
  with ≥1 table-driven `level1Lookup` simulation test per NULL category closed. This AC covers
  `fCOV-001.r3.unit.test.ts` specifically (the level1Lookup simulation + alias asserts). The file
  follows the `fH9.cat29.unit.test.ts` pattern: load `spanish-dishes.json` in-memory, define an
  inline `level1Lookup(query)` helper that matches on `name`, `nameEs`, and `aliases`, then assert
  each row in the cases array via `expect(matches.map(d => d.externalId)).toEqual(['CE-XXX'])`.
  For alias-addition cases (no new atom): assert that
  `dishes.find(d => d.externalId === 'CE-XXX')?.aliases.includes('<alias>')` is true.
  Do NOT assert SQL operators (e.g. `aliases @> ARRAY[...]`) in unit tests — these are
  in-memory simulations against the seed JSON only.
  AC-12a and AC-12b cover the other two new test files (`fCOV-001.r3.qa.test.ts` and
  `fCOV-001.r3.seed.unit.test.ts` respectively).

- [ ] **AC-12 — Locked-denominator success-metric tests (two complementary checks):**

  **AC-12a — Data-layer fidelity test** (`fCOV-001.r3.qa.test.ts`, NEW): **SEED-LAYER FIDELITY
  GATE ONLY — NOT a full production simulator.** Contains exactly N_LOCKED raw-query fixtures,
  where N_LOCKED is the count of actionable candidates identified by the planner's pre-analysis
  table (Step 2) and frozen at that point — it MUST NOT be re-counted post-implementation.

  Each fixture: import `extractFoodQuery` from
  `packages/api/src/conversation/entityExtractor.ts`, pipe the raw query through
  `extractFoodQuery(raw).query`, lowercase the result, then do an in-memory exact-match seed
  lookup against `dishes.find(d => d.aliases.includes(...) || d.name === ...)`.

  **4-step helper (imports from production):**
  1. `const stripped = extractFoodQuery(raw.trim())` — wrapper strip. Import from
     `packages/api/src/conversation/entityExtractor.ts`.
  2. `const modified = extractPortionModifier(stripped.query)` — portion/count modifier strip.
     Import from `packages/api/src/conversation/entityExtractor.ts` (or co-located module).
     `extractedTerm = (modified.cleanQuery !== stripped.query && modified.portionMultiplier !== 1)
       ? stripContainerResidual(modified.cleanQuery) : modified.cleanQuery`. **This dual-gate
     condition matches production exactly** (see `conversationCore.ts:688-691`): `stripContainerResidual`
     is only applied when `extractPortionModifier` both changed the text AND produced a
     non-unit multiplier. Import `stripContainerResidual` from
     `packages/api/src/conversation/conversationCore.ts` — exported via AC-NEW-export.
  3. `const q = extractedTerm.toLowerCase().trim()` — lowercase + trim per H9 pattern
     (cite: `packages/api/src/__tests__/fH9.cat29.unit.test.ts:73`).
  4. In-memory seed lookup: `dishes.filter(d => d.name.toLowerCase() === q || d.nameEs.toLowerCase() === q || (d.aliases ?? []).some(a => a.toLowerCase() === q))`.
     **On miss** (empty result): apply `applyH7TrailingStrip(q)` (imported from
     `packages/api/src/estimation/h7TrailingStrip.ts`) — if stripped text differs, retry the
     seed lookup with the stripped text. This models the ADR-023 L1-Retry Seam.

  **EXPLICIT LIMITATION:** This test does NOT model `passesGuardL1` (ADR-024 Jaccard guard),
  full `applyH7TrailingStrip` production context, L3 fuzzy search, or any L4 LLM fallback.
  It is a **SEED-LAYER fidelity gate**. Production parity is verified separately by
  AC-NEW-qa-battery (below).

  Pass criterion: ≥0.75 × N_LOCKED fixtures resolve to a non-null `externalId` (first lookup or
  retry). N_LOCKED is recorded in the Implementation Plan and in the Completion Log.

  **AC-12b — Extracted-term seed integrity test** (`fCOV-001.r3.seed.unit.test.ts`, NEW —
  MANDATORY separate file; must NOT be merged into `fCOV-001.r3.unit.test.ts`): loads
  `spanish-dishes.json` in-memory and asserts that each `extracted_term` from the pre-analysis
  table (post-strip, canonical form) has a matching atom (`name`/`nameEs`) or alias in the seed.
  This is a pure data-integrity guard — it catches cases where the alias was accidentally omitted
  from the JSON but the raw-query test would still fail.

- [ ] **AC-NEW-qa-battery — Production parity gate (human QA):** At Step 4, the QA Engineer runs
  the manual battery from `docs/research/qa-2026-04-21-exhaustive-results.md` against the dev API
  (post-deploy, after data migration applied) and records the post-merge NULL→OK delta in the
  Completion Log. **Pass criterion:** ≥0.75 × N_LOCKED queries return non-NULL on the live dev API.
  This is the **PRODUCTION PARITY gate** — it models `passesGuardL1` (ADR-024 Jaccard guard),
  the full `applyH7TrailingStrip` retry seam, L3 fuzzy fallback, and L4 LLM path, none of which
  are modelled by AC-12a. Both AC-12a (mechanical, in CI) AND AC-NEW-qa-battery (human-verified,
  post-deploy) must pass for the success metric to be considered met.

- [ ] **AC-NEW-export — `stripContainerResidual` exported from production:** The keyword `export`
  is added to `stripContainerResidual` at
  `packages/api/src/conversation/conversationCore.ts:66`. This is a **minimal one-keyword change
  with zero logic modification** — only the visibility of the function changes. The function body
  is untouched. This allows `fCOV-001.r3.qa.test.ts` (AC-12a) to import it directly, avoiding
  any inline-copy drift risk. The production-code-validator and code-review-specialist can verify
  trivially that the diff is `function` → `export function` and nothing else.

- [ ] **AC-13 — F079 telemetry resolution documented:** The Completion Log lists each
  `missed_query_tracking` entry (by `queryText`) that was closed by R3, with its `resolvedDishId`
  (new atom UUID or existing alias target UUID) and the `POST /analytics/missed-queries/{id}/status`
  command used to flip its `status` to `'resolved'`.

  **DEFERRED query hygiene (mandatory):** Queries triaged as `DEFERRED` in the Pre-analysis table
  (verdict column = "DEFERRED") that have a `trackingId != null` MUST be flipped to
  `status='ignored'` (NOT left at `'pending'`). Use
  `POST /analytics/missed-queries/{trackingId}/status` with body
  `{ status: 'ignored' }`. The `notes` field MUST be set to:
  `"Deferred per F-CATALOG-COV-001 — see Pre-analysis verdict column."` The Completion Log must
  list all DEFERRED+ignored flips alongside the RESOLVED flips.

  **Two cases for the planner:**

  **(a) Candidate has `trackingId != null`** — the row exists in `missed_query_tracking`. Use
  `POST /analytics/missed-queries/{trackingId}/status` with body
  `{ status: 'resolved', resolvedDishId: '<uuid>' }` to close it. Document this call in the
  Completion Log.

  **(b) Candidate has `trackingId == null`** — the row does not yet exist in
  `missed_query_tracking` (the query appeared in `query_logs` but was never batch-tracked via
  `POST /analytics/missed-queries/track`). **AC-13 is scoped to already-tracked candidates only
  (case a).** For untracked candidates, no F079 closure action is required: the next time a real
  user issues the same query after R3 is deployed, the pipeline will resolve it (NULL→OK) and the
  system will not generate a new missed-query row. These rows are **self-closing on next user
  query**. The Completion Log must note any untracked candidates by `queryText` and document them
  as "untracked — self-closing on next user query post-deploy."

- [ ] **AC-14 — No code changes outside allowed files:** The PR diff MUST NOT include edits to
  any `.ts` file other than:
  `packages/api/src/conversation/conversationCore.ts` (production — **permitted exception**: add
    `export` keyword to `stripContainerResidual` at line 66 only; zero logic changes; verified by
    diff showing `function` → `export function` and nothing else — per AC-NEW-export),
  `packages/api/src/__tests__/fCOV-001.r3.unit.test.ts` (new — AC-11 level1Lookup fixtures),
  `packages/api/src/__tests__/fCOV-001.r3.qa.test.ts` (new — AC-12a raw-query locked-denominator test),
  `packages/api/src/__tests__/fCOV-001.r3.seed.unit.test.ts` (new — AC-12b extracted-term seed integrity; MANDATORY separate file, NOT merged),
  `packages/api/src/__tests__/f073.seedPhaseSpanishDishes.edge-cases.test.ts` (count update),
  `packages/api/src/__tests__/f114.newDishes.unit.test.ts` (count update),
  `packages/api/src/__tests__/fH6.seedExpansionRound2.edge-cases.test.ts` (count update only — no slice fix needed),
  `packages/api/src/__tests__/fH9.cat29.unit.test.ts` (count update if applicable),
  `packages/api/src/__tests__/bug-prod-003.disambiguation.test.ts` (only if ADR-019 bare alias added).
  Any deviation requires explicit justification in the PR body.

- [ ] **AC-15 — key_facts.md updated:**
  - **If `N_atoms > 0`:** `docs/project_notes/key_facts.md:95` reflects the new dish count
    (`319 + N`) and updated BEDCA/recipe source breakdown.
  - **Always (regardless of N_atoms):** `key_facts.md` feature-tag suffix updated to include
    `F-CATALOG-COV-001`, and a Completion Log entry is added to the ticket.

---

## Definition of Done

- [ ] All 17 Acceptance Criteria met and checked (AC-01 through AC-15, AC-NEW-export, AC-NEW-qa-battery).
- [ ] `npm run lint -w @foodxplorer/api` — 0 errors (F116 baseline preserved).
- [ ] `npm run typecheck -w @foodxplorer/api` (or `tsc --noEmit`) — 0 errors.
- [ ] `npm run build -w @foodxplorer/api` — clean.
- [ ] `npm test --workspace=@foodxplorer/api` — all tests pass (count ≥ pre-R3 baseline + N).
- [ ] Seed file shape integrity: `validateSpanishDishes.ts` returns `{valid: true, errors: []}` on
  the full post-R3 JSON.
- [ ] PR opened targeting `develop` with rollback DELETE SQL block for all new dishIds.
- [ ] AC checklist 100% checked.
- [ ] Completion Log filled with date, step, agent, result for each implementation batch.
- [ ] `key_facts.md:95` updated to reflect new count (AC-15).

---

## Workflow Checklist

- [x] Step 0: Spec produced (this file)
- [x] Step 1: Branch created, ticket committed
- [ ] Step 2: Implementation Plan produced (planner agent — ranked candidate list + pre-analysis
  table + batch commit plan)
- [ ] Step 3: Implementation commits (data batches + final count-update + key_facts commit)
- [ ] Step 4: Quality gates (lint + typecheck + build + test + validator)
- [ ] Step 5: Code review specialist + QA engineer
- [ ] Step 6: Merge + ticket housekeeping (tracker sync, Completion Log final entry, branch delete)

---

## Implementation Plan

_To be filled by the backend-planner agent at Step 2._

---

## Completion Log

| Date | Step | Agent | Result | Notes |
|------|------|-------|--------|-------|
| 2026-05-07 | Step 0 | spec-creator + cross-model R1-R6 | DONE | Spec drafted (15 ACs initial) → 6 cross-model review rounds (Codex + Gemini in parallel). Convergence trail: R1 5 issues, R2 5 issues, R3 6 issues (1 CRITICAL ADR-023 retry seam), R4 4 issues (1 CRITICAL stripContainerResidual visibility), R5 3 IMPORTANT, R6 5 issues (Gemini 1 CRITICAL ADR-024 guard / Codex 2 IMPORTANT denominator+atom delta). R6 final fix: AC-12a strategically re-scoped to data-layer fidelity only; AC-NEW-qa-battery added as production-parity gate. **Final AC count: 17.** Final state: Gemini APPROVED at R5 (R6 dug deeper into ADR-024); Codex REVISE at R6 (asymptotic convergence — wording-only findings). Strategic stop after R6 per F-MULTITURN-001 pattern (heavy review burden + no architectural blockers remaining). |
| 2026-05-07 | Step 1 | claude (PM L5) | DONE | Branch `feature/F-CATALOG-COV-001-catalog-coverage-r3` created from develop @ `b60126b`. Product tracker Active Session updated. Features table row → in-progress 1/6. pm-session.md synced. Ticket Status → Planning. Setup commit pending. |

---

## Merge Checklist Evidence

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | |
| 1. Mark all AC/DoD items | [ ] | |
| 2. Verify product tracker | [ ] | |
| 3. Update key_facts.md | [ ] | |
| 4. Update decisions.md | [ ] | |
| 5. Commit documentation | [ ] | |
| 6. Verify clean working tree | [ ] | |
| 7. Verify branch up to date | [ ] | |

---

## Self-Review Notes

### Issues found and fixed during self-review (step 0.4):

**Fix 1 — fH6 H6-EC-11 slice arithmetic (original self-review) — superseded by Round 1 review.**
Original self-review derived and added the formula `slice(-38-N, -10-N)`. Round 1 review (Codex)
found this was wrong: the implementation already uses `findIndex(d => d.externalId === 'CE-280')`
since the F-H9 structural fix, making negative slicing obsolete. Edge Case §8 and AC-10 have been
updated to reflect the future-proof findIndex invariant. No slice arithmetic update is required.

**Fix 2 — Clarified which SECONDARY NULLs are and are not addressable by R3.**
Initial draft left the sprint report residual as "see report §5" without categorization. After
cross-checking the 49 remaining NULLs against the out-of-scope exclusions (NLP-layer fixes,
menu intent, intentional NULLs, script artifacts), I built an explicit table showing which
classifications are and are not actionable by a data-only ticket. This prevents the planner from
spending Step 2 effort on the 27 NULLs that are NLP or intent problems, not catalog gaps.

**Remaining risks for cross-model review to focus on:**

1. **Baseline dish count confidence:** `key_facts.md:95` shows 319 (50 BEDCA + 269 recipe), but
   the history involves a -1 from BUG-DATA-DUPLICATE-ATOM-001 (2026-04-28) and +3 from
   F-CHARCUTERIE-001. The reviewer should verify this count matches `grep -c '"externalId"'` on
   the current JSON before the planner starts. If the count is off, CE-321 / 0x141 is the wrong
   next identifier.

2. **PRIMARY telemetry availability:** the spec assumes `missed_query_tracking` has been populated
   with real-user NULLs since F-H9 deploy. If the table is sparse (product is pre-launch or
   traffic is low), the planner must fall back entirely to SECONDARY. The spec does not define a
   minimum threshold for "useful" PRIMARY data — the cross-model review should flag whether this
   gap in the spec needs a fallback condition.

3. **Atom count target (30-60) vs. alias count target (50-100) — resolved by Round 1 review.**
   Round 1 review (Codex) flagged a self-contradiction: scope said "fewer if alias-only fixes
   suffice" but AC-03 required ≥1 new atom. Fixed: scope and AC-03 now align on "0–60 atoms AND
   0–N aliases, provided ≥75% target met AND ≥1 data addition overall." The ≥75% NULL→OK
   conversion metric (locked-denominator via AC-12) is the primary success gate.

---

## Review Response

### Round 1 (2026-05-07) — Both verdicts: REVISE

| # | Severity | Source | Summary | Fix applied as | Spec section(s) touched |
|---|----------|--------|---------|----------------|------------------------|
| 1 | CRITICAL / IMPORTANT | Both | H6-EC-11 slice arithmetic: spec required `slice(-38-N, -10-N)` update but implementation already uses future-proof `findIndex(CE-280)` | Deleted slice formula from Edge Case §8 and AC-10; replaced with "findIndex invariant requires no modification after R3 appends" | Edge Case §8, AC-10, AC-14, Self-Review Fix 1 note |
| 2 | IMPORTANT | Codex | F079 telemetry contract wrong: `/admin/missed-queries`, `PATCH`, `normalized_query` all incorrect | Rewrote PRIMARY source section to use `GET /analytics/missed-queries`, `POST /analytics/missed-queries/{id}/status`, `queryText` field, and correct SQL (filtering on `query_logs.queried_at` not tracking timestamps) | Inputs §PRIMARY, Target Metrics row, AC-13 |
| 3 | IMPORTANT | Codex | Self-contradiction: scope allowed alias-only but AC-03 required ≥1 new atom | Adopted consistent rule: 0–60 atoms AND 0–N aliases provided ≥75% target met AND ≥1 data addition overall | Scope paragraph, Target Metrics rows, AC-03 |
| 4 | IMPORTANT | Codex | AC-11 referenced SQL operators (`aliases @> ARRAY[...]`) inside unit tests | Rewrote AC-11 to follow `fH9.cat29.unit.test.ts` in-memory simulation pattern; alias-addition case asserts `.aliases.includes(...)` on seed JSON; no SQL asserted | AC-11 |
| 5 | IMPORTANT | Gemini | "Nutritionally distinct" — "significantly" undefined | Quantified: ≥30% kcal/100g delta OR ≥50% delta in any single macro gram/100g OR primary-macronutrient-class differs | Selection Methodology — Atom vs. Alias Decision Tree |
| 6 | SUGGESTION | Both | Success metric not auto-tested; ≥75% NULL→OK measured manually | Replaced AC-12 (weak "test count +N") with locked-denominator regression test in `fCOV-001.r3.qa.test.ts`; N_LOCKED frozen at Step 2; pass criterion ≥0.75 × N_LOCKED in-memory assertions | AC-12 (rewritten), AC-14 (added qa file to allowed list) |

**Tensions between reviewers:** None. All findings were complementary.

**AC count change:** AC-12 rewritten (not split); old AC-13 (`normalized_query`/PATCH) removed and replaced with correct AC-13 (F079 telemetry, `queryText`/POST). Net AC count: 15 (unchanged).

**New test file added by this revision:** `fCOV-001.r3.qa.test.ts` (locked-denominator batch regression, AC-12). `fCOV-001.r3.unit.test.ts` was already specified in AC-11.

---

### Round 2 (2026-05-07) — Gemini: APPROVED (3 SUGGESTIONS); Codex: REVISE (4 IMPORTANT + 1 SUGGESTION)

| # | Severity | Source | Summary | Fix applied | Spec section(s) touched |
|---|----------|--------|---------|-------------|------------------------|
| 1 | IMPORTANT | Both | `AC-NEW` placeholder never replaced with real AC number — points to nonexistent criterion | Replaced `AC-NEW` with `AC-12` everywhere | AC-03 |
| 2 | IMPORTANT | Codex | ADR-019 Edge Case §2 says "MUST be Tier-1 backed"; spec §ADR-019 says "can still be used but flagged"; project ADR-019 says "prefer" — three-way inconsistency | Unified all three to: prefer Tier-1; if only recipe available, permitted with explicit Pre-analysis justification and lower-confidence flag | Edge Case §2, Selection Methodology §ADR-019 scrutiny question 2 |
| 3 | IMPORTANT | Codex | AC-12 in-memory `aliases.includes(query)` test doesn't model real L1 — raw query hits `extractFoodQuery()` prefix-strip pipeline first, so aliases are never matched against raw text | Split AC-12 into AC-12a (raw-query through `extractFoodQuery` then seed lookup) and AC-12b (extracted-term seed integrity); both in-file; AC-12a imports `extractFoodQuery` from `entityExtractor.ts` | AC-12 (expanded in-place), AC-14 (added `fCOV-001.r3.seed.unit.test.ts` to allowed list) |
| 4 | IMPORTANT | Codex | AC-15 unconditionally required BEDCA/recipe count update even when N_atoms=0 (alias-only scope) | Made AC-15 conditional: count/breakdown update only if N_atoms > 0; feature-tag + Completion Log entry always required | AC-15 |
| 5 | SUGGESTION | Codex | PRIMARY-empty fallback referenced in Self-Review Note §2 but never resolved in spec body | Added Fallback rule paragraph to Inputs §PRIMARY | Inputs §PRIMARY |
| 6 | SUGGESTION | Gemini | "Other" SECONDARY category (7 items) unexplained | Added one-line characterization: "primarily single-dish alias gaps or rare phrasings — planner triages individually" | SECONDARY table |

**Tensions between reviewers:** Gemini approved the R1 revision cleanly; all 4 IMPORTANT findings came from Codex. No conflicting verdicts.

**AC count change:** AC-12 expanded in-place (AC-12a + AC-12b as sub-bullets); no new AC number created. Net AC count: 15 (unchanged). DoD "All 15 AC met" remains accurate.

**New test file added by this revision:** `fCOV-001.r3.seed.unit.test.ts` (AC-12b extracted-term seed integrity; may be merged into `fCOV-001.r3.unit.test.ts` per planner discretion).

**Ready for Round 3 review.**

---

### Round 3 (2026-05-07) — Both verdicts: REVISE (Gemini: 1 CRITICAL + 1 SUGGESTION; Codex: 3 IMPORTANT + 1 SUGGESTION)

| # | Severity | Source | Finding | Fix applied | Spec section(s) touched |
|---|----------|--------|---------|-------------|------------------------|
| 1 | CRITICAL | Gemini | AC-12a didn't model ADR-023 H7-P5 L1-Retry Seam — after in-memory seed lookup miss, `applyH7TrailingStrip` must be applied and L1 retried | Rewrote AC-12a helper to a mandatory 4-step flow: (1) `extractFoodQuery`, (2) `extractPortionModifier` + conditional `stripContainerResidual`, (3) `.toLowerCase().trim()`, (4) seed lookup; on miss apply `applyH7TrailingStrip` + retry — full ADR-023 seam modelled; import path `h7TrailingStrip.ts` cited | AC-12a |
| 2 | IMPORTANT | Codex | PRIMARY source claimed post-H9 deploy-date filter and `first_seen`/`last_seen` timestamps as endpoint output — actual endpoint (`missedQueries.ts:77`, `api-spec.yaml:3078`) only returns `queryText/count/trackingId/trackingStatus` with no deploy-date filter | Rewrote PRIMARY §"What the endpoint actually returns" to honestly document the actual fields; moved SQL pseudocode to "manual DB query only" block; added explicit manual post-fetch filter instructions; updated `topN=100` wording in same pass | Inputs §PRIMARY |
| 3 | IMPORTANT | Codex | Residual `slice(-38, -10)` in Data Model Changes (line 75-77) still described it as a fix needing arithmetic update — contradicts Round 1 findIndex fix | Replaced with: "fH6 count assertions may need updating, but H6-EC-11 logic (findIndex-based) requires NO change" | Data Model Changes |
| 4 | IMPORTANT | Codex | AC-12a modelled only `extractFoodQuery + seed lookup` — missing `extractPortionModifier`, `stripContainerResidual`, and lowercase normalization per H9 pattern | Chose **Option A** (full pre-L1 pipeline): AC-12a now documents the complete `extractFoodQuery → extractPortionModifier → stripContainerResidual → toLowerCase` chain before seed lookup. Rationale: conversationCore.ts:663-706 shows the pipeline is pure string operations (no async, no DB) — fully simulatable in-memory. Cite: `fH9.cat29.unit.test.ts:73` for lowercase pattern | AC-12a |
| 5 | SUGGESTION | Codex | `topN=100` described as "default from MissedQueriesParamsSchema" — actual default is 20, max is 100 | Changed to "the planner explicitly requests `?topN=100` (the schema's max; default is 20)" in both the SQL comment and the endpoint call description | Inputs §PRIMARY (2 occurrences), SQL comment |
| 6 | SUGGESTION | Gemini | AC-12b / AC-14 allowed planner discretion to merge seed integrity test into `fCOV-001.r3.unit.test.ts` | Mandated split: AC-12b MUST live in `fCOV-001.r3.seed.unit.test.ts`; AC-14 updated with full absolute paths for all 3 new test files; "may be merged" language removed | AC-12b, AC-14 |

**Option A vs B (Finding #4):** Chose **Option A** (full pre-L1 pipeline). Reading `conversationCore.ts:663-706` confirmed the pipeline is exclusively pure string operations (regex, `.replace()`, array iteration) — no async, no DB, no side effects. It is fully simulatable inline in a unit test. Option B's disclaimer overhead would have introduced unnecessary spec ambiguity.

**AC count change:** None. AC-12a expanded in-place; AC-12b file path mandated but not renumbered. Net AC count: 15 (unchanged).

**Ready for Round 4 review.** If Round 4 finds zero CRITICAL/IMPORTANT issues, the spec is APPROVED and we proceed to Step 1 (Setup).

---

### Round 4 (2026-05-07) — Gemini: APPROVED (zero issues); Codex: REVISE (1 CRITICAL + 2 IMPORTANT + 1 SUGGESTION)

| # | Severity | Source | Finding | Fix applied | Spec section(s) touched |
|---|----------|--------|---------|-------------|------------------------|
| 1 | CRITICAL | Codex | `stripContainerResidual` is module-private (line 64 comment: "not exported") — AC-12a helper could not import it; AC-14 prohibited production edits; spec was un-implementable | Chose **option (b) — export**: Added AC-NEW-export (one-keyword change, zero logic); updated AC-14 to list `conversationCore.ts` as permitted-exception production file; updated AC-12a import note to reference the exported function | AC-12a (import note), AC-NEW-export (new), AC-14 |
| 2 | IMPORTANT | Codex | Out of Scope listed only `fCOV-001.r3.unit.test.ts` — contradicted AC-14's three test files | Rewrote Out of Scope TypeScript bullet to enumerate all three new test files from AC-14 plus the production export exception; AC-14 remains single source of truth | Out of Scope §TypeScript code changes |
| 3 | IMPORTANT | Codex | N_LOCKED denominator ambiguous on cross-source deduplication — F079 endpoint returns raw grouped rows, no built-in dedup | Added **N_LOCKED definition** subsection in §Target Metrics: unique actionable raw queries after cross-source dedup by lowercased + trimmed raw-query string; trailing-punctuation example given; dedup recorded in Pre-analysis preamble | Target Metrics §N_LOCKED definition |
| 4 | SUGGESTION | Codex | Round naming confusion: ticket is "Round-3" (data sense) but review is now at "round 4" | Added naming clarification one-liner as first paragraph of §Description, distinguishing data-expansion rounds from spec review iterations | §Description (first paragraph) |

**Option (a) vs (b) for Finding 1:** Chose **(b) export**. Reading `conversationCore.ts:66` confirmed the function is ~18 lines of pure string operations (two `for` loops over regex patterns, `.replace()`, `.trim()`), zero side effects, and zero async — the only change needed is the `export` keyword. Option (a) inline-copy would create a ~18-line silent drift risk with no mechanical detection. Option (b) risk: a future refactor could un-export the function; mitigated by the AC-NEW-export assertion (code reviewer checks diff is `function` → `export function` and nothing else).

**AC count change:** +1 (AC-NEW-export added). Net AC count: 16. DoD updated to "All 16 AC met".

---

### Round 5 (2026-05-07) — Gemini: APPROVED (1 SUGGESTION); Codex: REVISE (3 IMPORTANT)

| # | Severity | Source | Finding | Fix applied | Spec section(s) touched |
|---|----------|--------|---------|-------------|------------------------|
| 1 | IMPORTANT | Codex | Scope sentence "Pure data — no TypeScript changes" contradicts AC-NEW-export + 3 test files | Rewrote scope sentence to "Data-first feature with a narrowly-scoped test/export exception" enumerating the three test files and one-keyword export edit; all three occurrences made consistent | §Description Scope paragraph |
| 2 | IMPORTANT | Codex | N_LOCKED normalization self-contradictory: `.trim()` doesn't strip trailing periods as the example implied | Added explicit `normalizeQueryKey()` function definition in §Target Metrics N_LOCKED block; mandated AC-12a use this exact function; Pre-analysis preamble records it verbatim for reviewer verification | Target Metrics §N_LOCKED definition |
| 3 | IMPORTANT | Codex | AC-13 F079 closure flow incomplete for `trackingId = null` rows — POST status-update requires concrete `:id` | Scoped AC-13 to already-tracked candidates only (case a: `trackingId != null`); untracked candidates documented as self-closing on next user query post-deploy; Completion Log must note untracked candidates by queryText | AC-13 |
| 4 | SUGGESTION | Gemini | AC-11 title "New fixture file" (singular) mismatches the three test files in Out of Scope + AC-14 | Renamed AC-11 to "New fixture files" (plural); clarified AC-11 covers `fCOV-001.r3.unit.test.ts` specifically; added closing sentence directing readers to AC-12a/12b for the other two files | AC-11 |

**Finding 3 option chosen:** Scope-down to already-tracked candidates (simpler path). No tracking-row creation call required in AC-13. Rationale: `POST /analytics/missed-queries/track` is a batch endpoint designed for system-generated tracking, not for manual single-row creation during a planner Completion Log step. The self-closing behavior on next user query is semantically correct — R3 fixes the gap, so the next real user query resolves without a NULL and no new missed-query row is emitted.

**AC count change:** None. Net AC count: 16 (unchanged).

---

### Round 6 (FINAL — 2026-05-07) — Gemini: REVISE (1 CRITICAL + 1 IMPORTANT + 1 SUGGESTION); Codex: REVISE (2 IMPORTANT + 2 SUGGESTIONS)

| # | Severity | Source | Finding | Fix applied | Spec section(s) touched |
|---|----------|--------|---------|-------------|------------------------|
| 1 | CRITICAL | Gemini | AC-12a missing `passesGuardL1` simulation — each review round added a new production layer; spec would never converge | **Strategic re-scope:** AC-12a is now explicitly a **seed-layer fidelity gate only** — it disclaims `passesGuardL1` (ADR-024 Jaccard guard), L3 fuzzy, L4 LLM fallback. New AC-NEW-qa-battery added as the PRODUCTION PARITY gate (human QA run at Step 4 against dev API). §Target Metrics updated: success metric has two independent gates (a) AC-12a mechanical CI + (b) AC-NEW-qa-battery human-verified. | AC-12a (rewritten), AC-NEW-qa-battery (new), Target Metrics |
| 2 | IMPORTANT | Gemini | DEFERRED queries in Pre-analysis table left at `status='pending'` in `missed_query_tracking` — telemetry hygiene gap | AC-13 extended: DEFERRED candidates with `trackingId != null` must be flipped to `status='ignored'` with notes `"Deferred per F-CATALOG-COV-001 — see Pre-analysis verdict column."` Completion Log must list all DEFERRED+ignored flips. | AC-13 |
| 3 | SUGGESTION | Gemini | AC-12a helper `stripContainerResidual` conditional logic unverified — possible mismatch with production | Read `conversationCore.ts:663-706`: confirmed CONDITIONAL (dual-gate: text changed AND multiplier ≠ 1). AC-12a helper already documented this gate; added explicit citation `(see conversationCore.ts:688-691)` and "matches production exactly" note. | AC-12a |
| 4 | IMPORTANT | Codex | Denominator in §Target Metrics and multiple locations said "PRIMARY+SECONDARY" only — contradicted TERTIARY and fallback rules | Replaced all "PRIMARY+SECONDARY" instances in spec body with "all actionable candidates from PRIMARY ∪ SECONDARY ∪ TERTIARY (whichever sources were used) after cross-source dedup via `normalizeQueryKey`". | Target Metrics (2 rows) |
| 5 | IMPORTANT | Codex | AC-03 grep measured total catalog size, not delta — planner had no mechanical delta check | AC-03 verification updated: `git diff --stat` + `(post_count - 319) === N_atoms_planned` formula added; Target Metrics "New atoms added" row updated identically. | AC-03, Target Metrics |
| 6 | SUGGESTION | Codex | Scope paragraph line 42 referenced `AC-16` (dead ID) alongside `AC-NEW-export` | Removed `/ AC-16` from scope paragraph — `AC-NEW-export` is the sole canonical ID. | §Description Scope paragraph |
| 7 | SUGGESTION | Codex | AC-15 used "F-CATALOG-COV-001 done" suffix — inconsistent with F-H6/F-H9 plain-tag precedent | Standardized to plain `F-CATALOG-COV-001` tag (no "done" suffix). | AC-15 |

**Strategic decision on Finding 1 (CRITICAL):** AC-12a is a production simulator that was accreting layers each review round (R3: retry seam; R4: container strip; R5: dedup; R6: Jaccard guard). Predecessors F-H4/F-H6/F-H9 used simple in-memory tests + human-QA battery at Step 4. Re-scoping AC-12a to seed-layer fidelity only and elevating the QA battery to AC-NEW-qa-battery restores architectural alignment with predecessor precedent and unblocks convergence.

**Finding 3 — production conditional confirmed:** `conversationCore.ts:688-691` applies `stripContainerResidual` only when `modified.cleanQuery !== stripped.query && modified.portionMultiplier !== 1`. AC-12a helper documents this dual-gate explicitly and matches production behavior.

**AC count change:** +1 (AC-NEW-qa-battery added). Net AC count: 17. DoD updated to "All 17 AC met".
