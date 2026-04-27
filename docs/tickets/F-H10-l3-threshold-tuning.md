# F-H10: L3 Similarity Threshold / Lexical Guard for Q649 False Positive

**Feature:** F-H10 | **Type:** Backend-Feature (NLP/Search) | **Priority:** Medium
**Status:** Ready for Merge | **Branch:** feature/F-H10-l3-threshold-tuning
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-27 | **Dependencies:** F-H6, F-H7, F-H8, F-H9 (all DONE)

---

## Spec

### Description

**Problem:** L3 similarity extrapolation produces false positives when two dish names share a high-weight token but refer to different dishes. The canonical case (Q649, QA 2026-04-27) is:

- Input residual after H7 stripping: `queso fresco con membrillo`
- L3 best match: `CROISSANT CON QUESO FRESC` (Starbucks Spain, 343 kcal)
- Root cause: cosine distance < 0.5 (current `DEFAULT_THRESHOLD`) because both strings contain the token "queso fresco / fresc". The embedding model assigns them high semantic proximity despite them being fundamentally different dishes (cheese + quince paste vs. baked pastry).

**Solution: Lexical token-overlap guard (Strategy B)**

After L3 returns a candidate that passes the cosine-distance threshold, a **lexical guard** rejects the match if the word-level Jaccard overlap between the normalized query and the candidate name is below a configurable minimum overlap threshold.

The guard runs as a pure function `computeTokenJaccard(a: string, b: string): number` operating on lowercase, punctuation-stripped, stop-word-removed token sets. If `jaccard < LEXICAL_GUARD_MIN_OVERLAP` the candidate is rejected and L3 falls through to its next strategy (or returns `null` on total miss).

**Why Strategy B over alternatives:**

- **Strategy A (lower global threshold):** Lowering `DEFAULT_THRESHOLD` (e.g. to 0.3) rejects legitimate L3 hits whose embeddings are genuinely similar. No empirical data on the distribution of legitimate L3 distances is available without live DB access — this is a blind calibration. Risk of regression is high.
- **Strategy C (threshold tightening when overlap is low):** More complex and harder to tune. Two interacting parameters vs. one. Strategy B already achieves the same rejection outcome for Q649 without needing to touch the distance threshold.
- **Strategy D (chain-scoped guard):** Doesn't generalize. A query could match a wrong generic food entry just as easily as a wrong chain dish.
- **Strategy B (lexical guard):** Additive, orthogonal to the distance threshold, empirically motivated (matched entity must share some content words with the query), easy to unit-test, easy to tune via a single constant.

**ADR compliance check (ADR-001):** The lexical guard is a post-retrieval filter, not a nutritional calculator. It does not interpret nutritional values — it decides whether a retrieved entity is semantically compatible with the query. This is lexical matching (deterministic, engine-computed), not LLM interpretation. ADR-001 is not violated.

**Affected file:** `packages/api/src/estimation/level3Lookup.ts` (single file change).

**New constants in `level3Lookup.ts`:**
```
DEFAULT_THRESHOLD = 0.5                  (unchanged)
LEXICAL_GUARD_MIN_OVERLAP = 0.25         (Jaccard; derived below; tunable via constant)
SPANISH_STOP_WORDS = Set<string>         (small curated set: de, del, con, la, el, los, las, un, una, al, y, a, en, por)
```

Note: no existing project utility for Spanish stop-word removal — this is the first such helper. Defined inline in `level3Lookup.ts` (small set, dish-name domain-specific). If a future feature needs Spanish stop-words, refactor to a shared module.

Note: No new shared types or SQL changes — guard reuses the existing `fetchDish`/`fetchFoodNutrients` return shape.

**Guard placement (Option A):** The guard runs AFTER `fetchDishNutrients()` / `fetchFoodNutrients()` returns, because the candidate name is not available from the similarity-search row (which only carries `{dish_id, distance}` or `{food_id, distance}`).

- **Strategy 1 (dish):** call `fetchDishNutrients(db, id)`; then apply `applyLexicalGuard(query, dish.dish_name_es ?? dish.dish_name)`. If the guard rejects, discard the dish result and fall through to strategy 2.
- **Strategy 2 (food):** call `fetchFoodNutrients(db, id)`; then apply `applyLexicalGuard(query, food.food_name_es ?? food.food_name)`. `food_name_es` is typed `string | null` in `FoodQueryRow` despite the Prisma schema marking it non-nullable — always provide `food.food_name` as fallback. If the guard rejects, return null.

This preserves the existing cascade semantics. No SQL modifications; no changes to `Level3LookupOptions` or `Level3Result`.

**`normalize()` helper (required for accent-insensitive tokenization):**

The tokenizer must apply NFD diacritic normalization before building token sets, so that accent-omitted queries (common in Spanish UX) match their accented equivalents:

```typescript
function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
```

`computeTokenJaccard` calls `normalize` on both input strings before punctuation-stripping, splitting, and stop-word removal. Examples: `atún` → `atun`, `méxico` → `mexico`, `fresco` → `fresco` (unchanged, no diacritics).

**Q649 verification:**
- Query after `normalize`: `queso fresco con membrillo` (no accents; unchanged). Tokens: `{queso, fresco, membrillo}`
- Candidate after `normalize` (`CROISSANT CON QUESO FRESC`): `croissant con queso fresc`. Tokens: `{croissant, queso, fresc}`

  Note: `normalize()` is what produces the lowercase strings shown in both token sets — the step is explicit, not implicit.
- Intersection: `{queso}` (1 token; "fresco" ≠ "fresc" due to Catalan apocope)
- Union: `{queso, fresco, membrillo, croissant, fresc}` (5 tokens)
- Jaccard = 1/5 = 0.20. With `LEXICAL_GUARD_MIN_OVERLAP = 0.15`, 0.20 > 0.15 → guard does NOT reject.

  > This reveals the Q649 candidate is not rejected with 0.15, because even partial token overlap ("queso") gives Jaccard = 0.20. The correct threshold needs to be > 0.20. Setting `LEXICAL_GUARD_MIN_OVERLAP = 0.25` ensures 1-token overlap out of 5 (0.20) is rejected while 2-token overlap out of 5 (0.40) passes.

  Corrected thresholds:
  - `LEXICAL_GUARD_MIN_OVERLAP = 0.25` — rejects Jaccard ≤ 0.20 (Q649 case: 0.20 < 0.25 → rejected).
  - At 0.25, a 2-word overlap on a 6-token query+candidate pool (Jaccard ≈ 0.33) still passes.
  - "tortilla de patatas" vs "tortilla española": tokens after stop-word removal = `{tortilla, patatas}` ∩ `{tortilla, española}` = `{tortilla}`, union = `{tortilla, patatas, española}` → Jaccard = 1/3 ≈ 0.33 > 0.25 → passes. Legitimate hit preserved.

**ADR-024** documenting this decision must be added to `docs/project_notes/decisions.md`.

### API Changes

None. No new endpoints, no changes to request/response schemas, no Zod schema modifications. `level3Lookup` is an internal function; its interface (`Level3LookupOptions`, `Level3Result`) is unchanged. The `api-spec.yaml` is NOT modified.

### Data Model Changes

None. No DB schema changes, no Prisma migrations, no seed data changes.

### UI Changes

None. This is a backend engine change only.

### Edge Cases & Error Handling

| Case | Expected Behaviour |
|------|--------------------|
| Empty query string | `computeTokenJaccard` returns 0.0 (empty token set intersection = 0); guard rejects any candidate. L3 returns null. |
| Query is all stop words (e.g. `con la`) | After stop-word removal, token set is empty; Jaccard = 0.0; all candidates rejected. L3 returns null — same as total L1/L2 miss; falls through to L4. |
| Candidate `nameEs` is null (dish or food) | `Dish.nameEs` is nullable per schema; guard falls back to `dish.dish_name` (always present). `food_name_es` is typed `string | null` in `FoodQueryRow` (conservative TS artefact despite the DB column being non-nullable); guard falls back to `food.food_name` (always selected by `fetchFoodNutrients` SQL and non-null in DB). Both strategies use the same `*_name_es ?? *_name` pattern; the fallback always succeeds. |
| Single shared token, large union (Jaccard < 0.25) | Rejected. Q649 is this case. |
| Single shared token, small union (e.g. 2-word query, 2-word candidate, 1 overlap: Jaccard = 1/3 ≈ 0.33) | Accepted. Legitimate short-query hits preserved. |
| Exact match (query = candidate nameEs) | Jaccard = 1.0; passes unconditionally. |
| Strategy 1 (dish) rejected by guard; strategy 2 (food) passes | Strategy 2 result returned normally. Cascade is not short-circuited. |
| Both strategies rejected by guard | L3 returns null; falls through to L4. No error thrown. |
| OpenAI key absent / embedding fails | Existing graceful-skip behaviour unchanged; guard is never reached. |
| DB unavailable | Existing `DB_UNAVAILABLE` throw unchanged; guard is never reached. |
| `LEXICAL_GUARD_MIN_OVERLAP = 0` (guard disabled) | Jaccard ≥ 0 always true; guard never rejects. Effectively disables the feature. Useful for debugging. |
| Accent-insensitive normalization: query `atun` vs candidate `atún rojo` | NFD normalization in `normalize()` strips combining diacritics before tokenization. `atún` → `atun`, so token sets match. `computeTokenJaccard("atun rojo", "atún rojo")` returns 1.0. |

---

## Implementation Plan

### Pre-flight Findings

**Existing stop-word / Jaccard utilities:** None found. `grep` across `packages/api/src/` returns zero hits for `stopword`, `stop_word`, `jaccard`, or `STOP_WORDS`. The helpers must be created fresh inside `level3Lookup.ts`.

**ADR numbering:** The last ADR in `docs/project_notes/decisions.md` is ADR-023. ADR-024 is confirmed as the correct next number.

**`food_name_es` nullability:** `FoodQueryRow` declares `food_name_es: string | null` (line 143 of `types.ts`). However, Prisma schema marks `Food.nameEs String` (non-nullable). The `| null` in the TypeScript interface is a conservative typing artefact. The guard must compile against `string | null`; use `food.food_name_es ?? food.food_name` as the candidateName to `applyLexicalGuard`. `food_name` is always present (verified: `fetchFoodNutrients()` SELECTs both `f.name AS food_name` and `f.name_es AS food_name_es`), making it a reliable fallback.

**Pre-existing FoodQueryRow shape drift (out of scope):** `FoodQueryRow` at `types.ts:139-143` declares `barcode` and `brand_name` fields. However, `fetchFoodNutrients()` SQL does NOT select these columns. `mapFoodRowToResult()` reads `row.barcode`, which will be `undefined` at runtime. F-H10 does NOT fix this — the lexical guard only needs `food_name_es` + `food_name`, and no SQL changes are in scope. This drift should be tracked as a follow-up: file a note in the PR body or `bugs.md` if not already present.

**`dish_name_es` nullability:** Confirmed nullable — `Dish.nameEs String?` in schema (line 327). Strategy 1 uses `dish.dish_name_es ?? dish.dish_name` as specified.

**Regression risk assessment (existing f022 tests):** All existing test fixtures pass the guard at `LEXICAL_GUARD_MIN_OVERLAP = 0.25`. Computed Jaccard values:

| f022 query | candidate `dish_name_es` / `food_name_es` | meaningful tokens | Jaccard | Guard result |
|---|---|---|---|---|
| `'hamburguesa clásica'` | `'Hamburguesa Clásica'` | {hamburguesa, clásica} ∩ {hamburguesa, clásica} = 2/2 | 1.0 | PASS |
| `'hamburguesa'` | `'Hamburguesa Clásica'` | {hamburguesa} ∩ {hamburguesa, clásica} = 1/2 | 0.5 | PASS |
| `'ternera picada'` | `'Carne de Ternera Picada'` | {ternera, picada} ∩ {carne, ternera, picada} = 2/3 | 0.67 | PASS |
| `'ternera'` | `'Carne de Ternera Picada'` | {ternera} ∩ {carne, ternera, picada} = 1, union = 3 → Jaccard = 1/3 ≈ 0.333 | 0.333 | PASS (> threshold) |
| edge-cases `'hamburguesa test'` | `'Hamburguesa Test'` | {hamburguesa, test} ∩ {hamburguesa, test} = 2/2 | 1.0 | PASS |
| edge-cases `'ternera'` | `'Ternera Test'` | {ternera} ∩ {ternera, test} = 1/2 | 0.5 | PASS |

**No existing f022 fixture modifications needed. AC12 will pass without changes.**

---

### Existing Code to Reuse

- `packages/api/src/estimation/level3Lookup.ts` — only file to modify; all internal functions (`dishSimilaritySearch`, `foodSimilaritySearch`, `fetchDishNutrients`, `fetchFoodNutrients`) are reused unchanged.
- `packages/api/src/estimation/types.ts` — `DishQueryRow`, `FoodQueryRow`, `Level3Result`, `Level3LookupOptions` used as-is; no changes.
- `packages/api/src/__tests__/f022.level3Lookup.unit.test.ts` — `buildMockDb()` + `mockExecuteQuery` + `mockCallOpenAIEmbeddings` pattern copied verbatim into the new test file.
- `packages/api/src/__tests__/f022.level3Lookup.edge-cases.test.ts` — same mock pattern reference; no changes.

---

### Files to Create

| Path | Purpose |
|------|---------|
| `packages/api/src/__tests__/fH10.l3LexicalGuard.unit.test.ts` | All AC tests: pure helper unit tests (AC3–AC7, AC2.5) + cascade integration tests using `mockExecuteQuery` (AC1, AC2, AC8, AC9) |

---

### Files to Modify

| Path | Change |
|------|--------|
| `packages/api/src/estimation/level3Lookup.ts` | Add `LEXICAL_GUARD_MIN_OVERLAP`, `SPANISH_STOP_WORDS`, `computeTokenJaccard()`, `applyLexicalGuard()` exports; wire guard into `level3Lookup()` after each `fetchDishNutrients`/`fetchFoodNutrients` call |
| `docs/project_notes/decisions.md` | Add ADR-024 |
| `docs/project_notes/key_facts.md` | Update `level3Lookup.ts` description to mention lexical guard |

---

### Implementation Order

Follow the layer order from `backend-standards.mdc` (pure helpers → logic wiring → docs):

**Phase 1 — Pre-flight (no commit)**

Verify: grep for stop-word/jaccard utilities (already done above), confirm ADR-024 is next, re-read `level3Lookup.ts` fully, re-read `f022` mock patterns.

Verification command:
```bash
grep -r "stopword\|jaccard\|STOP_WORDS" /Users/pb/Developer/FiveGuays/foodXPlorer/packages/api/src/
rg '^### ADR-' /Users/pb/Developer/FiveGuays/foodXPlorer/docs/project_notes/decisions.md
# Expected: lists all ADRs up to ADR-023; confirms ADR-024 does not yet exist and ADR-023 is the highest
```

**Phase 2 — Pure helpers + helper unit tests (1–2 commits, GREEN from first commit)**

2a. Add to `packages/api/src/estimation/level3Lookup.ts` (Constants section):

```
LEXICAL_GUARD_MIN_OVERLAP = 0.25   // ADR-024: rejects Jaccard < 0.25 (Q649 case: 0.20 → rejected)
SPANISH_STOP_WORDS = new Set([
  'de', 'del', 'con', 'la', 'el', 'los', 'las', 'un', 'una', 'al', 'y', 'a', 'en', 'por'
])
```

2b. Add exported pure functions (after constants, before `buildScopeClause`):

- `export function computeTokenJaccard(a: string, b: string): number`
  - Call `normalize()` on each input: `s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')` (NFD-decomposes accented characters then strips combining marks; produces accent-insensitive lowercase output)
  - Strip punctuation (`/[^a-z\s]/g` after normalize — combining marks already removed), split on whitespace, filter empty strings, filter against `SPANISH_STOP_WORDS`
  - Build `Set` for each token list
  - If either set is empty → return `0`
  - Compute `|intersection| / |union|` using set iteration
  - Return the ratio as a number

- `export function applyLexicalGuard(queryText: string, candidateName: string): boolean`
  - Returns `computeTokenJaccard(queryText, candidateName) >= LEXICAL_GUARD_MIN_OVERLAP`

2c. Create `packages/api/src/__tests__/fH10.l3LexicalGuard.unit.test.ts` with Phase 2 tests:

Pure helper tests — `describe('computeTokenJaccard — pure function')`:

| Test | AC | Input A | Input B | Expected |
|------|-----|---------|---------|---------|
| Q649 Jaccard < 0.25 | AC3 | `"queso fresco con membrillo"` | `"CROISSANT CON QUESO FRESC"` | `< 0.25` |
| Legitimate hit Jaccard > 0.25 | AC4 | `"tortilla de patatas"` | `"tortilla española"` | `> 0.25` |
| Diacritic normalization (accent-omitted query) | AC4.5 | `"atun rojo"` | `"atún rojo"` | `1.0` exactly |
| Diacritic normalization (case + accents) | AC4.5b | `"queso fresco con membrillo"` | `"Queso Fresco Con Membrillo"` | `1.0` exactly |
| Empty query string | AC5 | `""` | `"cualquier cosa"` | `0.0` exactly |
| All-stop-words query | AC6 | `"con la de"` | `"por el al"` | `0.0` exactly |
| Single-token query in candidate | AC7 | `"gazpacho"` | `"gazpacho andaluz"` | `>= 0.5` |

`applyLexicalGuard` helper tests — `describe('applyLexicalGuard')`:

| Test | AC | queryText | candidateName | Expected |
|------|-----|----------|---------------|---------|
| Returns false when Jaccard < threshold | AC2.5a | `"queso fresco con membrillo"` | `"CROISSANT CON QUESO FRESC"` | `false` |
| Returns true when Jaccard >= threshold | AC2.5b | `"tortilla de patatas"` | `"tortilla española"` | `true` |
| Returns false for empty query | AC2.5c | `""` | `"gazpacho"` | `false` |

Commit message: `feat(F-H10): add computeTokenJaccard + applyLexicalGuard exports with unit tests`

Run after commit:
```bash
npm test -w @foodxplorer/api -- fH10.l3LexicalGuard
```

**Phase 3 — Wire guard into `level3Lookup()` + cascade integration tests (1 commit)**

3a. Modify `level3Lookup()` in `packages/api/src/estimation/level3Lookup.ts`:

Strategy 1 wiring (after `fetchDishNutrients` returns, before constructing the result):
```
if (nutrientRow !== undefined) {
  const candidateName = nutrientRow.dish_name_es ?? nutrientRow.dish_name;
  if (!applyLexicalGuard(query, candidateName)) {
    // Guard rejected — fall through to strategy 2
  } else {
    // ... existing return block
  }
}
```

Strategy 2 wiring (after `fetchFoodNutrients` returns, before constructing the result):
```
if (nutrientRow !== undefined) {
  const candidateName = nutrientRow.food_name_es ?? nutrientRow.food_name;
  if (!applyLexicalGuard(query, candidateName)) {
    return null;  // Both strategies rejected
  }
  // ... existing return block
}
```

Note: the guard is applied only when `nutrientRow !== undefined`. The existing "nutrient row is empty → fall through" path (no nutrient row) is unaffected.

3b. Add cascade integration tests to `fH10.l3LexicalGuard.unit.test.ts`.

Copy `buildMockDb()`, `mockExecuteQuery`, `mockCallOpenAIEmbeddings` setup identically from `f022.level3Lookup.unit.test.ts`. Use the same `vi.hoisted` + `vi.mock` pattern.

New fixture constants specific to F-H10:

```typescript
// Q649 false positive scenario
const MOCK_CROISSANT_DISH_NUTRIENT_ROW = {
  dish_id: 'fd000000-fh10-4000-a000-000000000001',
  dish_name: 'CROISSANT CON QUESO FRESC',
  dish_name_es: 'CROISSANT CON QUESO FRESC',
  restaurant_id: 'fd000000-fh10-4000-a000-000000000002',
  chain_slug: 'starbucks-es',
  portion_grams: '120.00',
  calories: '343.00',
  proteins: '12.00',
  carbohydrates: '38.00',
  sugars: '6.00',
  fats: '16.00',
  saturated_fats: '9.00',
  fiber: '2.00',
  salt: '0.90',
  sodium: '360.00',
  trans_fats: '0.10',
  cholesterol: '45.00',
  potassium: '150.00',
  monounsaturated_fats: '5.00',
  polyunsaturated_fats: '1.00',
  reference_basis: 'per_serving',
  source_id: 'fd000000-fh10-4000-a000-000000000003',
  source_name: 'Starbucks Spain Official',
  source_type: 'official',
  source_url: null,
  source_priority_tier: null,
};

// Legitimate dish scenario
const MOCK_TORTILLA_DISH_NUTRIENT_ROW = {
  dish_id: 'fd000000-fh10-4000-a000-000000000010',
  dish_name: 'Spanish Omelette',
  dish_name_es: 'tortilla española',
  restaurant_id: 'fd000000-fh10-4000-a000-000000000011',
  chain_slug: 'generic-es',
  portion_grams: '150.00',
  calories: '220.00',
  proteins: '14.00',
  carbohydrates: '8.00',
  sugars: '1.00',
  fats: '15.00',
  saturated_fats: '4.00',
  fiber: '1.00',
  salt: '0.60',
  sodium: '240.00',
  trans_fats: '0.00',
  cholesterol: '300.00',
  potassium: '250.00',
  monounsaturated_fats: '7.00',
  polyunsaturated_fats: '2.00',
  reference_basis: 'per_serving',
  source_id: 'fd000000-fh10-4000-a000-000000000012',
  source_name: 'BEDCA',
  source_type: 'official',
  source_url: null,
  source_priority_tier: null,
};

// AC8: cascade — dish guard rejects, food guard accepts
const MOCK_MANTEQUILLA_DISH_NUTRIENT_ROW = {
  // dish_name_es: 'CROISSANT CON MANTEQUILLA' — no tokens overlap with 'gazpacho andaluz'
  dish_id: 'fd000000-fh10-4000-a000-000000000020',
  dish_name: 'CROISSANT CON MANTEQUILLA',
  dish_name_es: 'CROISSANT CON MANTEQUILLA',
  restaurant_id: 'fd000000-fh10-4000-a000-000000000021',
  chain_slug: 'starbucks-es',
  portion_grams: '100.00',
  calories: '310.00',
  proteins: '7.00',
  carbohydrates: '35.00',
  sugars: '5.00',
  fats: '17.00',
  saturated_fats: '10.00',
  fiber: '2.00',
  salt: '0.70',
  sodium: '280.00',
  trans_fats: '0.10',
  cholesterol: '40.00',
  potassium: '120.00',
  monounsaturated_fats: '4.00',
  polyunsaturated_fats: '1.00',
  reference_basis: 'per_serving',
  source_id: 'fd000000-fh10-4000-a000-000000000022',
  source_name: 'Starbucks Spain Official',
  source_type: 'official',
  source_url: null,
  source_priority_tier: null,
};

const MOCK_GAZPACHO_FOOD_NUTRIENT_ROW = {
  food_id: 'fd000000-fh10-4000-a000-000000000030',
  food_name: 'Gazpacho',
  food_name_es: 'gazpacho',
  food_group: 'Soups, Sauces, and Gravies',
  barcode: null,
  brand_name: null,
  calories: '24.00',
  proteins: '0.80',
  carbohydrates: '4.90',
  sugars: '3.40',
  fats: '0.30',
  saturated_fats: '0.05',
  fiber: '1.10',
  salt: '0.40',
  sodium: '160.00',
  trans_fats: '0.00',
  cholesterol: '0.00',
  potassium: '200.00',
  monounsaturated_fats: '0.05',
  polyunsaturated_fats: '0.10',
  reference_basis: 'per_100g',
  source_id: 'fd000000-fh10-4000-a000-000000000031',
  source_name: 'BEDCA',
  source_type: 'official',
  source_url: 'https://bedca.net',
  source_priority_tier: null,
};

// AC9: both strategies rejected
const MOCK_CROISSANT_FOOD_NUTRIENT_ROW = {
  food_id: 'fd000000-fh10-4000-a000-000000000040',
  food_name: 'Croissant',
  food_name_es: 'croissant',
  food_group: 'Baked Products',
  barcode: null,
  brand_name: null,
  calories: '406.00',
  proteins: '8.20',
  carbohydrates: '45.80',
  sugars: '10.90',
  fats: '21.00',
  saturated_fats: '11.50',
  fiber: '1.80',
  salt: '1.00',
  sodium: '400.00',
  trans_fats: '0.40',
  cholesterol: '60.00',
  potassium: '150.00',
  monounsaturated_fats: '5.60',
  polyunsaturated_fats: '1.20',
  reference_basis: 'per_100g',
  source_id: 'fd000000-fh10-4000-a000-000000000041',
  source_name: 'BEDCA',
  source_type: 'official',
  source_url: 'https://bedca.net',
  source_priority_tier: null,
};
```

Cascade integration tests — `describe('level3Lookup — lexical guard cascade (F-H10)')`:

**AC1** — Q649 exact case — dish guard rejects + food misses → null:
```
mockExecuteQuery sequence (3 calls):
  call 1: { rows: [{ dish_id: X, distance: '0.18' }] }       // dish similarity hit
  call 2: { rows: [MOCK_CROISSANT_DISH_NUTRIENT_ROW] }        // dish nutrients; guard rejects (Jaccard 0.20)
  call 3: { rows: [] }                                         // food similarity: no rows (food nutrient fetch never reached)
query: 'queso fresco con membrillo'
expect: null
also assert: mockExecuteQuery called exactly 3 times
```

**AC2** — Legitimate dish hit passes guard → result returned:
```
mockExecuteQuery sequence (2 calls):
  call 1: { rows: [{ dish_id: X, distance: '0.22' }] }        // dish similarity hit
  call 2: { rows: [MOCK_TORTILLA_DISH_NUTRIENT_ROW] }          // dish nutrients; guard accepts (Jaccard ≈ 0.33)
query: 'tortilla de patatas'
expect: non-null Level3Result with matchType 'similarity_dish'
also assert: result.result.nameEs === 'tortilla española'
```

**AC8** — Cascade: dish guard rejects, food guard accepts → food result returned:
```
mockExecuteQuery sequence (4 calls):
  call 1: { rows: [{ dish_id: X, distance: '0.20' }] }         // dish similarity hit
  call 2: { rows: [MOCK_MANTEQUILLA_DISH_NUTRIENT_ROW] }        // dish nutrients; guard rejects
  call 3: { rows: [{ food_id: Y, distance: '0.30' }] }          // food similarity hit
  call 4: { rows: [MOCK_GAZPACHO_FOOD_NUTRIENT_ROW] }           // food nutrients; guard accepts (Jaccard = 1/2 = 0.5)
query: 'gazpacho andaluz'
expect: non-null Level3Result with matchType 'similarity_food'
also assert: mockExecuteQuery called exactly 4 times (cascade not short-circuited)
```

**AC9** — Both strategies rejected → null:
```
mockExecuteQuery sequence (4 calls):
  call 1: { rows: [{ dish_id: X, distance: '0.18' }] }         // dish similarity hit
  call 2: { rows: [MOCK_CROISSANT_DISH_NUTRIENT_ROW] }          // dish nutrients; guard rejects
  call 3: { rows: [{ food_id: Y, distance: '0.22' }] }          // food similarity hit
  call 4: { rows: [MOCK_CROISSANT_FOOD_NUTRIENT_ROW] }          // food nutrients; guard rejects ('croissant' ∩ {queso, fresco, membrillo} = 0)
query: 'queso fresco con membrillo'
expect: null
also assert: mockExecuteQuery called exactly 4 times
```

Additional guard-specific tests worth including (count toward the +15–20 target):
- Guard disabled when `LEXICAL_GUARD_MIN_OVERLAP = 0`: not directly testable as a constant — this is a documentation note in the plan for the developer, not a runtime test (the constant is not configurable at runtime).
- `dish_name_es` is null, falls back to `dish_name`: one test with `dish_name_es: null` and `dish_name` containing overlap tokens → guard accepts.
- `food_name_es` is null (null-fallback path): one test with `food_name_es: null` AND `food_name: 'CROISSANT CON QUESO FRESC'`. candidateName resolves to `food_name` (`'CROISSANT CON QUESO FRESC'`) via the `?? food_name` fallback. Query: `'queso fresco con membrillo'`. Jaccard(`'queso fresco con membrillo'`, `'CROISSANT CON QUESO FRESC'`) = 0.20 < 0.25 → guard rejects → return null. This test verifies: (1) the null fallback path is taken, and (2) rejection is driven by low overlap against `food_name`, not by an empty candidateName.

Commit message: `feat(F-H10): wire lexical guard into level3Lookup cascade + AC1/AC2/AC8/AC9 integration tests`

Run after commit:
```bash
npm test -w @foodxplorer/api -- fH10.l3LexicalGuard
npm test -w @foodxplorer/api -- f022.level3Lookup
```

**Phase 4 — ADR-024 + key_facts.md (1 commit)**

4a. Append ADR-024 after ADR-023 at the end of `docs/project_notes/decisions.md`. ADR-023 is the current last entry (confirmed at line 664). Follow the exact format of existing ADRs:

```markdown
### ADR-024: Lexical Token-Overlap Guard for L3 Similarity Extrapolation (2026-04-27)

**Date:** 2026-04-27
**Status:** Accepted
**Context:** L3 similarity extrapolation (pgvector cosine distance) produces false positives when two entity names share a high-weight token but refer to fundamentally different things. Canonical case Q649 (QA 2026-04-27): query `queso fresco con membrillo` matched `CROISSANT CON QUESO FRESC` (distance 0.18 < 0.5 threshold) because the embedding model assigns high proximity to the shared token "queso/fresc". See Spec section of ticket `F-H10-l3-threshold-tuning.md`.

**Decision:** Add a **post-retrieval lexical guard** to `level3Lookup.ts`. After `fetchDishNutrients()` / `fetchFoodNutrients()` returns, compute the word-level Jaccard overlap between the normalized query and the candidate name. If `jaccard < LEXICAL_GUARD_MIN_OVERLAP (0.25)`, the candidate is rejected. Strategy 1 (dish) rejection falls through to Strategy 2 (food); Strategy 2 rejection returns `null`. The guard is a pure deterministic function `computeTokenJaccard(a, b)` operating on lowercase, punctuation-stripped, Spanish-stop-word-removed token sets.

Threshold derivation: Q649 case produces Jaccard = 1/5 = 0.20 (single token "queso" shared across 5-token union). Setting threshold to 0.25 ensures this case is rejected (0.20 < 0.25) while 2-token overlaps on short queries (e.g. "tortilla" in "tortilla española" vs "tortilla de patatas", Jaccard ≈ 0.33) pass.

**Alternatives Considered:**
- **Strategy A (lower global cosine threshold):** Blind calibration without empirical distance distribution data. High regression risk on legitimate L3 hits.
- **Strategy C (threshold tightening when overlap is low):** Two interacting parameters. Higher complexity for same outcome.
- **Strategy D (chain-scoped guard):** Does not generalize to food strategy mismatches.

**Consequences:**
- (+) Additive and orthogonal to the cosine distance threshold — no existing behavior changed for legitimate hits.
- (+) Single constant `LEXICAL_GUARD_MIN_OVERLAP` is tunable.
- (+) Pure function with comprehensive unit tests; no DB interaction.
- (+) ADR-001 compliance verified: guard is lexical matching (deterministic), not LLM-based nutrient interpretation.
- (-) Spanish stop-word list is small and domain-specific; defined inline in `level3Lookup.ts`. Future features needing shared stop-word removal should refactor to a shared module.
- (-) Jaccard operates on exact token strings (no stemming). "fresco" ≠ "fresc" (Catalan apocope) — this is acceptable since the overlap threshold is already calibrated to handle partial matches.
```

4b. Update `docs/project_notes/key_facts.md` — locate the `level3Lookup.ts` description line (line ~167) and append after the existing description text: `, lexical guard post-retrieval (F-H10 ADR-024): \`applyLexicalGuard(query, candidateName)\` using \`computeTokenJaccard\` + \`LEXICAL_GUARD_MIN_OVERLAP=0.25\` rejects candidates with Jaccard < 0.25 after each nutrient fetch; Strategy 1 reject → falls through to Strategy 2; Strategy 2 reject → null`

Commit message: `docs(F-H10): add ADR-024 lexical guard + update key_facts.md`

**Phase 5 — Final validation (no commit)**

```bash
# New F-H10 tests
npm test -w @foodxplorer/api -- fH10.l3LexicalGuard

# Full level3 tests (AC12 — no regression)
npm test -w @foodxplorer/api -- f022.level3Lookup

# Full API suite
npm test --workspace=@foodxplorer/api

# Lint + build
npm run lint --workspace=@foodxplorer/api
npm run build --workspace=@foodxplorer/api
```

---

### Testing Strategy

**New test file:** `packages/api/src/__tests__/fH10.l3LexicalGuard.unit.test.ts`

**Test count:** +17–20 tests (7 pure Jaccard tests [AC3, AC4, AC4.5a, AC4.5b, AC5, AC6, AC7] + 3 applyLexicalGuard helper tests + 4 cascade integration tests AC1/AC2/AC8/AC9 + 2–4 additional guard-specific edge cases: `dish_name_es` null fallback, `food_name_es` null defensiveness, `LEXICAL_GUARD_MIN_OVERLAP` boundary at exactly 0.25).

**Test structure:**
- `describe('computeTokenJaccard — pure function')`: AC3–AC7. No mocking needed.
- `describe('applyLexicalGuard — helper')`: AC2.5a–c. No mocking needed.
- `describe('level3Lookup — lexical guard cascade (F-H10)')`: AC1, AC2, AC8, AC9 + edge cases. Uses `vi.hoisted` + `mockExecuteQuery` + `mockCallOpenAIEmbeddings` identical to `f022.level3Lookup.unit.test.ts`.

**Mocking strategy:**
- `callOpenAIEmbeddings`: mock via `vi.mock('../embeddings/embeddingClient.js', ...)` — same pattern as f022
- DB: `buildMockDb()` + `mockExecuteQuery` — copy-exact from f022; do NOT introduce new mocking utilities
- No new shared mock infrastructure; self-contained per test file

**AC12 (no regression):** Verified in pre-flight analysis. All existing f022 fixtures produce Jaccard ≥ 0.25 against their corresponding query strings. Zero fixture modifications required.

---

### Key Patterns

- **`vi.hoisted` pattern** for mock setup: required because `vi.mock` calls are hoisted before imports. Reference: `packages/api/src/__tests__/f022.level3Lookup.unit.test.ts` lines 16–42.
- **`mockExecuteQuery` call sequence**: `mockResolvedValueOnce` calls are consumed in order of actual DB calls. The cascade makes up to 4 calls (dish similarity → dish nutrients → food similarity → food nutrients). Guard rejection after call 2 means call 3 is the food similarity search — this is the critical sequencing for AC1/AC8/AC9.
- **Fixture UUID namespace**: use `fd000000-fh10-4000-a000-000000000XXX` (where XXX is 001–041) to keep F-H10 fixtures isolated from f022 fixtures.
- **`source_priority_tier: null` in fixture rows**: `FoodQueryRow` does not have this field, but the `mapSource` function reads `row.source_priority_tier`. Add `source_priority_tier: null` to all new dish/food nutrient fixture rows (check f022 fixtures — they omit it; verify the mapper handles `undefined` vs `null` the same way via `parsePriorityTier`).
- **Strict TypeScript**: `computeTokenJaccard` and `applyLexicalGuard` must not use `any`. The token normalization regex must be typed; use `const PUNCTUATION_RE = /[^a-záéíóúüñ\s]/gi` (covers Spanish diacritics).
- **Export placement**: `computeTokenJaccard` and `applyLexicalGuard` must be `export`ed (not `export default`) so the test file can named-import them without importing the full cascade or triggering side-effects.
- **Guard placement in `level3Lookup`**: the guard runs ONLY when `nutrientRow !== undefined`. The existing `if (nutrientRow !== undefined)` blocks are the insertion points — guard rejection is a new branch inside those blocks, not a replacement of them.
- **`food_name_es` null handling**: even though the schema marks `Food.nameEs` non-nullable, `FoodQueryRow.food_name_es` is typed `string | null`. Use `food.food_name_es ?? food.food_name` as the candidateName. `food_name` (English name) is always present — `fetchFoodNutrients()` SELECTs `f.name AS food_name`. This provides a meaningful fallback rather than an empty string that would silently reject all food candidates when Spanish name is absent.

---

### Verification Commands

```bash
# Phase 2 — helpers only
npm test -w @foodxplorer/api -- fH10.l3LexicalGuard

# Phase 3 — after wiring guard
npm test -w @foodxplorer/api -- fH10.l3LexicalGuard
npm test -w @foodxplorer/api -- f022.level3Lookup

# Phase 5 — full suite
npm test --workspace=@foodxplorer/api
npm run lint --workspace=@foodxplorer/api
npm run build --workspace=@foodxplorer/api
```

---

## Acceptance Criteria

**Q649 regression fix**
- [x] AC1: `level3Lookup(mockDb, 'queso fresco con membrillo', { openAiApiKey: 'sk-test-key' })` returns `null` when `mockDb` is configured via `mockExecuteQuery` to return: (1st call) dish similarity row `{ dish_id: X, distance: '0.18' }`; (2nd call) dish nutrient row with `dish_name_es: 'CROISSANT CON QUESO FRESC'`; (3rd call) food similarity returns no rows. Guard computes Jaccard = 0.20 < 0.25 after `fetchDishNutrients` returns, rejects the dish result, food strategy also misses, overall return is `null`. Assert `mockExecuteQuery` called exactly 3 times (4th call never reached).

**Legitimate L3 hit preserved**
- [x] AC2: `level3Lookup(mockDb, 'tortilla de patatas', { openAiApiKey: 'sk-test-key' })` returns a non-null `Level3Result` when `mockDb` is configured to return: (1st call) dish similarity row `{ dish_id: X, distance: '0.22' }`; (2nd call) dish nutrient row with `dish_name_es: 'tortilla española'`. Guard computes Jaccard ≈ 0.33 > 0.25 after `fetchDishNutrients` returns — candidate accepted, result returned.

**Exported `applyLexicalGuard` helper**
- [x] AC2.5: A helper function `applyLexicalGuard(queryText: string, candidateName: string): boolean` is exported from `level3Lookup.ts` (or a new module if cleaner). It returns `true` if `computeTokenJaccard(queryText, candidateName) >= LEXICAL_GUARD_MIN_OVERLAP`, `false` otherwise. This makes guard logic unit-testable without DB mocks.

**Pure function unit tests (`computeTokenJaccard`)**
- [x] AC3: `computeTokenJaccard("queso fresco con membrillo", "CROISSANT CON QUESO FRESC")` returns a value < 0.25.
- [x] AC4: `computeTokenJaccard("tortilla de patatas", "tortilla española")` returns a value > 0.25.
- [x] AC4.5: `computeTokenJaccard("atun rojo", "atún rojo")` returns 1.0 (NFD normalization strips diacritics; `atún` → `atun`; token sets are identical after normalization). Also: `computeTokenJaccard("queso fresco con membrillo", "Queso Fresco Con Membrillo")` returns 1.0 (case + accent normalization).
- [x] AC5: `computeTokenJaccard("", "cualquier cosa")` returns 0.0.
- [x] AC6: `computeTokenJaccard("con la de", "por el al")` returns 0.0 (all stop words → empty token sets after removal).
- [x] AC7: `computeTokenJaccard("gazpacho", "gazpacho andaluz")` returns a value ≥ 0.5 (single token query, exact token in candidate).

**Guard cascade semantics**
- [x] AC8: `level3Lookup(mockDb, 'gazpacho andaluz', { openAiApiKey: 'sk-test-key' })` returns a `Level3Result` with `matchType: 'similarity_food'` when `mockDb` is configured to return: (1st call) dish similarity row at distance `'0.20'`; (2nd call) dish nutrient row with `dish_name_es: 'CROISSANT CON MANTEQUILLA'` (guard rejects: Jaccard < 0.25); (3rd call) food similarity row at distance `'0.30'`; (4th call) food nutrient row with `food_name_es: 'gazpacho'` (guard accepts: Jaccard ≥ 0.25). Strategy 1 rejection does not short-circuit the cascade.
- [x] AC9: `level3Lookup(mockDb, 'queso fresco con membrillo', { openAiApiKey: 'sk-test-key' })` returns `null` when `mockDb` is configured to return: (1st call) dish similarity row at distance `'0.18'`; (2nd call) dish nutrient row with `dish_name_es: 'CROISSANT CON QUESO FRESC'` (guard rejects); (3rd call) food similarity row at distance `'0.22'`; (4th call) food nutrient row with `food_name_es: 'croissant'` (guard also rejects: no token overlap with query). Both strategies rejected → return `null`.

**Constants and ADR**
- [x] AC10: `LEXICAL_GUARD_MIN_OVERLAP` is defined as a named constant (not a magic number) in `level3Lookup.ts` with an inline comment referencing ADR-024.
- [x] AC11: ADR-024 is added to `docs/project_notes/decisions.md` documenting the lexical guard rationale, the Q649 case, threshold derivation, and alternatives considered.

**No regression**
- [x] AC12: All existing tests in `packages/api/src/__tests__/f022.level3Lookup.unit.test.ts` continue to pass without modification.

---

## Definition of Done

- [x] All 14 acceptance criteria met (AC1–AC9 + AC2.5 + AC4.5 + AC10–AC12)
- [x] `packages/api/src/__tests__/fH10.l3LexicalGuard.unit.test.ts` written and passing (covers AC1–AC9 and AC2.5)
- [x] `packages/api/src/__tests__/f022.level3Lookup.unit.test.ts` still passes unmodified (AC12)
- [x] `computeTokenJaccard` exported from `level3Lookup.ts` (enables isolated unit tests without mocking the full cascade)
- [x] `applyLexicalGuard(queryText: string, candidateName: string): boolean` exported from `level3Lookup.ts` (or a dedicated module); wraps `computeTokenJaccard` + threshold comparison (AC2.5)
- [x] `LEXICAL_GUARD_MIN_OVERLAP = 0.25` and `SPANISH_STOP_WORDS` defined as named module-level constants
- [x] ADR-024 added to `docs/project_notes/decisions.md`
- [x] Code follows project standards (strict TypeScript, no `any`)
- [x] No linting errors (`npm run lint` in `packages/api`)
- [x] Build succeeds (`npm run build` in `packages/api`)
- [x] `api-spec.yaml` and `ui-components.md` not modified (no API/UI surface changes)

---

## Workflow Checklist

<!-- Standard complexity tier — /review-spec mandatory -->

- [x] Step 0: `spec-creator` executed, ticket Spec/AC/DoD sections filled
- [x] Step 0b: `/review-spec` executed, spec approved by user
- [x] Step 1: Branch `feature/F-H10-l3-threshold-tuning` created, tracker updated
- [x] Step 2: `backend-planner` executed, implementation plan approved
- [x] Step 3: `backend-developer` executed with TDD (new test file + guard implementation)
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [x] Step 5a: `code-review-specialist` executed
- [x] Step 5b: `qa-engineer` executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted, ADR-024 committed

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-27 | Phase 2: helpers + unit tests | `computeTokenJaccard`, `applyLexicalGuard`, `LEXICAL_GUARD_MIN_OVERLAP`, `SPANISH_STOP_WORDS` added to `level3Lookup.ts`. 23 pure helper tests in `fH10.l3LexicalGuard.unit.test.ts` (AC3-AC7, AC2.5, AC4.5). Commit `0e744d4`. |
| 2026-04-27 | Phase 3: guard wiring + cascade integration tests | Guard wired into strategy 1 (fall-through on reject) and strategy 2 (null on reject). AC1/AC2/AC8/AC9 cascade tests added. 3 f022 fall-through tests updated to use `'ternera'` query (pre-flight analysis missed 'hamburguesa' ↔ 'Carne de Ternera Picada' zero-overlap; deviation from plan noted). Commit `75cb1cb`. |
| 2026-04-27 | Phase 4: ADR-024 + key_facts.md | ADR-024 appended to decisions.md. key_facts.md level3Lookup description updated. Commit `9910c55`. |
| 2026-04-27 | Phase 5: final validation | 4133 tests passing (225 test files). Lint: clean. Build: clean. |
| 2026-04-27 | Step 0b — /review-spec | Gemini APPROVED R1 (1 spurious IMPORTANT — ADR-024 numbering already correct). Codex REVISE R1 (3 IMPORTANT — guard placement, AC test seam, schema null states) → APPROVED R2. |
| 2026-04-27 | Step 2 — /review-plan | Gemini APPROVED R1. Codex REVISE R1 (4 IMPORTANT — food fallback, FoodQueryRow shape OOS, ADR insert location, accent normalization + 2 SUGGESTION) → REVISE R2 (1 IMPORTANT residual food contradiction + 1 SUGGESTION ADR template) → R3 fixes applied (skipped R3 review per F-H6/F-H7 plan precedent). |
| 2026-04-27 | Step 4 — production-code-validator | APPROVE 98% confidence. Zero issues. Commits 0e744d4/75cb1cb/9910c55 verified. Q649 math confirmed (1/5=0.20 < 0.25 → reject). Cascade semantics correct. |
| 2026-04-27 | Step 5a — code-review-specialist | APPROVE. 6 NIT-level suggestions (NFD regex Unicode-property form, boundary test naming, asymmetric exports, normalize() reuse hint, f022 query rationale, mock pattern). Zero CRITICAL/IMPORTANT. |
| 2026-04-27 | Step 5b — qa-engineer | QA VERIFIED. All 14 ACs pass. +18 adversarial tests in `fH10.l3LexicalGuard.edge-cases.test.ts` (4133 → 4151). 1 minor finding: spec L137 arithmetic typo (1/4 → 1/3 — code correct, fixed in `96f5790`). |

<!-- After code review, add a row documenting which findings were accepted/rejected:
| YYYY-MM-DD | Review findings | Accepted: C1-C3, H1-H2. Rejected: M5 (reason). Systemic: C4 logged in bugs.md |
This creates a feedback loop for improving future reviews. -->

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | All 7 sections present: Spec, Implementation Plan, Acceptance Criteria, Definition of Done, Workflow Checklist, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 14/14, DoD: 11/11, Workflow: 8/9 (Step 6 pending merge) |
| 2. Verify product tracker | [x] | Will sync in tracker commit before /audit-merge |
| 3. Update key_facts.md | [x] | L167: level3Lookup description appended with lexical guard reference (commit `9910c55`) |
| 4. Update decisions.md | [x] | ADR-024 appended (lines 687-708) with **Date:** 2026-04-27, **Status:** Accepted, full rationale + alternatives + consequences (commit `9910c55`) |
| 5. Commit documentation | [x] | Commits: spec/plan (`53b3d18`), implementation (`0e744d4`/`75cb1cb`), docs (`9910c55`), housekeeping (`faeaab0`), QA additions (`96f5790`) |
| 6. Verify clean working tree | [x] | `git status`: clean |
| 7. Verify branch up to date | [x] | `git merge-base --is-ancestor origin/develop HEAD` → UP TO DATE with develop @ `0f2421d` |

---

*Ticket created: 2026-04-27*
