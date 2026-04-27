# F-H10-FU: L1 Lexical Guard Extension — Q649 False Positive Mitigation at FTS Layer

**Feature:** F-H10-FU | **Type:** Backend-Feature (NLP/Search) | **Priority:** High
**Status:** Planning | **Branch:** feature/F-H10-FU-l1-lexical-guard
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-27 | **Dependencies:** F-H10 (done — exports `applyLexicalGuard`, `computeTokenJaccard`, `LEXICAL_GUARD_MIN_OVERLAP`. `SPANISH_STOP_WORDS` is module-private inside `level3Lookup.ts` and intentionally NOT exported.)

---

## Spec

### Description

**Problem — Q649 false positive survives F-H10 deploy (empirically confirmed)**

Post-deploy QA battery dev run on 2026-04-27 16:54 (`/tmp/qa-dev-post-fH9-fH10-20260427-1654.txt`, line 710) confirms:

```
649. después de la siesta piqué queso fresco con membrillo
     OK CROISSANT CON QUESO FRESC | 343kcal | Noneg | m=1 | - | - | Starbucks Spain
```

Q649 (`queso fresco con membrillo`) returns `CROISSANT CON QUESO FRESC` (Starbucks Spain, 343 kcal) — identical behaviour to pre-F-H10. F-H10's stated AC-1 (Q649 fix) is NOT empirically satisfied.

**Root cause — false positive is at L1 FTS, not L3**

F-H10's `applyLexicalGuard()` was wired exclusively into `level3Lookup.ts`. The CROISSANT entry is a chain PDF ingest (Starbucks Spain), not in `spanish-dishes.json`, so it exists only in the `dishes` table. The L1 FTS cascade in `level1Lookup.ts` — specifically `ftsDishMatch()` (Strategy 2) — matches the `queso fresco` tokens from the query against `QUESO FRESC` in `d.name_es` via `to_tsvector('spanish', COALESCE(d.name_es, d.name)) @@ plainto_tsquery('spanish', ...)`. The match succeeds with high tsrank, returning the CROISSANT before the cascade ever reaches L2 or L3. The L3 lexical guard never executes for this query path.

**Solution — extend `applyLexicalGuard()` to the L1 FTS cascade**

Wire `applyLexicalGuard(query, candidateName)` into `runCascade()` in `level1Lookup.ts` after each FTS strategy hit (Strategies 2 and 4), before constructing and returning the `Level1Result`. Exact-match strategies (Strategies 1 and 3) are exempt — an exact or alias match is inherently a lexical identity and cannot be a false positive of this type.

When the guard rejects an FTS hit, the cascade falls through to the next strategy — mirroring F-H10's pattern at L3 (Strategy 1 dish reject → fall through to Strategy 2 food; Strategy 2 food reject → return null).

**Scope**

- Production source file: `packages/api/src/estimation/level1Lookup.ts` (guard insertion + small `passesGuardEither` helper)
- New test files:
  - `packages/api/src/__tests__/fH10FU.l1LexicalGuard.unit.test.ts` — single-pass scoped unit tests + dual-name helper unit tests
  - `packages/api/src/__tests__/fH10FU.q649.integration.test.ts` — two-pass cascade integration test for the Q649 fixture (mock DB) per `bugs.md` 2026-04-27 entry
- QA tooling: minor extension to `packages/api/scripts/qa-exhaustive.sh` adding optional `matchType` emission so AC3 (pre-flight Jaccard analysis) is mechanically reproducible. Backwards-compatible (existing OK/NULL/FAIL counters preserved).
- ADR-024 addendum documenting the L1 extension (preferred over a new ADR-025 because the threshold + helper set is the same decision; planner agent confirms at Step 2)
- `docs/project_notes/key_facts.md` — Level 1 estimation-module bullet updated to reflect the lexical guard now applies at L1 FTS strategies 2 and 4 (per documentation-standards: behavior changes in core modules require key_facts updates)
- No changes to `level3Lookup.ts`, `engineRouter.ts`, `api-spec.yaml`, `ui-components.md`, or Zod schemas

**Out of scope**

- Changing L3 guard logic or threshold (already shipped and correct)
- Changing FTS query construction (no SQL modifications)
- Applying the guard to exact-match strategies (Strategy 1 exact dish, Strategy 3 exact food)
- Applying the guard to `offBrandedFoodMatch()` or `offFallbackFoodMatch()` (different failure modes; not implicated in Q649)

**Code reuse — CRITICAL**

`applyLexicalGuard`, `computeTokenJaccard`, and `LEXICAL_GUARD_MIN_OVERLAP` are exported from `packages/api/src/estimation/level3Lookup.ts` (verified empirically: lines 44, 67, 99). `SPANISH_STOP_WORDS` is declared as module-private `const` (line 47, no `export`) and is consumed internally by `computeTokenJaccard` — `level1Lookup.ts` has no reason to import it directly. These exported symbols must be imported, not duplicated. A grep for `function applyLexicalGuard` must show exactly ONE definition (in `level3Lookup.ts`) and ≥2 call sites (one in `level3Lookup.ts`, ≥1 new ones in `level1Lookup.ts`) after this feature ships.

**Cascade fall-through semantics**

After guard rejects an FTS hit at L1, the cascade continues to the next strategy in order:

| Strategy rejected | Falls through to |
|---|---|
| Strategy 2 (`ftsDishMatch`) rejected | Strategy 3 (`exactFoodMatch`) |
| Strategy 4 (`ftsFoodMatch`) rejected | `runCascade` returns null → triggers next pass / L2 |

This is consistent with F-H10's "strategy 1 reject → fall through to strategy 2" pattern.

**H7-P5 retry seam — interaction with new null returns**

Pre-F-H10-FU, the H7-P5 retry seam (`engineRouter.ts:171-209`) fires when `lookupResult1 === null` AND `applyH7TrailingStrip(normalizedQuery)` returns a string DIFFERENT from `normalizedQuery` (verified at line 178: `if (h7StrippedQuery !== normalizedQuery)`). The seam does NOT retry on identical strip output — for queries that don't match any wrapper pattern, the seam is a no-op regardless of how L1 reached null.

F-H10-FU expands the set of inputs that produce `null` at L1 (queries where every FTS strategy hit gets guard-rejected). The interaction with H7-P5 is:

- **Q649 (`queso fresco con membrillo`)**: query has no H7-P5 wrapper match → `applyH7TrailingStrip` returns the same string → seam does NOT fire. L1 null propagates directly to L2/L3. No retry. (The query as written is already wrapper-free; the original `después de la siesta piqué queso fresco con membrillo` had `después de la siesta piqué` stripped earlier in the wrapper extraction phase, which already happened before L1.)
- **Hypothetical query `comí pan con tomate y resultó delicioso, verdad?`**: wrapper-strip produces `pan con tomate` (different from input). Pre-F-H10-FU: original L1 may have hit a false positive on the long form. Post-F-H10-FU: guard rejects the false positive, L1 returns null, H7-P5 fires with stripped `pan con tomate`, retry hits a legitimate L1 match. **This is the desirable retry-unmask path enabled by F-H10-FU.**

**No infinite loop risk**: the seam fires at most ONCE per request (gated on `h7StrippedQuery !== normalizedQuery`). Even if F-H10-FU causes the retry to also produce null (because the stripped query also gets guard-rejected on its own FTS hit), the seam does not iterate — it just propagates the null to L2.

A regression test must explicitly cover **two paths**:
1. **Guard-induced null on a non-strippable query** (e.g., Q649): L1 returns null, H7-P5 seam does NOT fire (same input post-strip), L2 invoked directly. Verifies the seam is not over-eager.
2. **Guard-induced null on a strippable query**: L1 returns null on long form, H7-P5 fires, retry succeeds with the stripped query. Verifies the unmask path works.

**BUG-PROD-012 two-pass cascade interaction**

`level1Lookup` (lines 581-606) invokes `runCascade` up to **TWO** times depending on options:
- `hasExplicitBrand=true`: Tier=0 first → unfiltered fallthrough
- `hasExplicitBrand=false` AND no `chainSlug` AND no `restaurantId`: minTier≥1 first → unfiltered fallthrough
- Otherwise: single unfiltered pass

The guard is inside `runCascade`, so it applies on **every** pass independently. For Q649 (no brand, no scope), the guard rejects CROISSANT in BOTH passes (Tier≥1 has no other match because CROISSANT is Tier 0; unfiltered fallthrough also rejects CROISSANT). Final result: null, correct.

Implications for tests:
- **Single-pass unit tests** must set `chainSlug` (or `restaurantId`) to force single-pass behaviour, isolating guard logic from BUG-PROD-012's two-pass.
- **Two-pass integration test** must NOT set `chainSlug`, exercising the unscoped path explicitly.

**L1 FTS bilingual matching — guard must accept either Spanish or English candidate name**

Empirical verification of L1 FTS SQL (`level1Lookup.ts:182-185` for dishes, `:312-313` for foods):

```sql
WHERE (
  to_tsvector('spanish', COALESCE(d.name_es, d.name)) @@ plainto_tsquery('spanish', ${normalizedQuery})
  OR to_tsvector('english', d.name) @@ plainto_tsquery('english', ${normalizedQuery})
)
```

L1 FTS is **bilingual**: a query can match via the Spanish branch (against `COALESCE(name_es, name)` with Spanish stemmer) OR via the English branch (against `name` with English stemmer). The matched branch is not exposed in the result row — we only get `name_es` and `name` columns back.

**Implication for the guard**: comparing the query against `name_es ?? name` alone may incorrectly reject a legitimate English-branch hit. Example: an English query `bacon eggs` matches `Bacon and Eggs` via the English branch (`name = "Bacon and Eggs"`); the row also has `name_es = "Beicon con huevos"`. Guard against `name_es` alone: query `bacon eggs` vs candidate `Beicon con huevos` → Jaccard ≈ 0 → REJECT (false negative). Symmetrical case: a Spanish query matches via Spanish branch but English `name` differs significantly.

**Decision: dual-name guard with OR semantics**. The guard at L1 must compute Jaccard against BOTH `name_es` AND `name` (when present) and accept if **either** clears the threshold:

```typescript
function passesGuardEither(query: string, nameEs: string | null | undefined, name: string): boolean {
  if (nameEs && applyLexicalGuard(query, nameEs)) return true;
  return applyLexicalGuard(query, name);
}
```

This adds a tiny helper local to `level1Lookup.ts` (NOT to `level3Lookup.ts` — L3 only sees Spanish-side candidate names). The helper composes `applyLexicalGuard` rather than duplicating it. Q649 still gets rejected because both `dish_name_es` (`CROISSANT CON QUESO FRESC`) and `dish_name` (`CROISSANT WITH FRESH CHEESE` or similar English form) lack token overlap with `queso fresco membrillo`. Legitimate bilingual matches pass via whichever side aligns with the query language.

The pre-flight Jaccard distribution analysis (AC4) MUST evaluate both sides separately, record both component scores per hit (for auditability), and validate the **OR-semantics gate**: a legitimate hit passes if `max(jaccard_es, jaccard_en) ≥ 0.25`. Failing only when BOTH sides drop below 0.25 (the actual runtime semantics) is the correct gate. Reporting `min` would falsely fail legitimate bilingual matches where one side aligns with the query and the other does not.

**Threshold risk analysis and decision — L1 FTS characteristics vs L3**

The threshold `LEXICAL_GUARD_MIN_OVERLAP = 0.25` was calibrated against L3 pgvector similarity hits. L1 FTS hits are higher-confidence lexical matches — FTS requires token presence, not mere semantic proximity. This raises a legitimate risk: the guard may over-reject legitimate single-token FTS matches.

Analysis of concerning single-token query patterns against multi-token candidates (using the shared `computeTokenJaccard` + `SPANISH_STOP_WORDS` logic):

| Query | L1 FTS candidate | Tokens after stop-word strip | Jaccard | Guard result at 0.25 |
|---|---|---|---|---|
| `paella` | `Paella valenciana` | `{paella}` ∩ `{paella, valenciana}` = 1, union = 2 | 0.50 | PASS |
| `tortilla` | `Tortilla de patatas` | `{tortilla}` ∩ `{tortilla, patatas}` = 1, union = 2 | 0.50 | PASS |
| `salmón` (→ `salmon` after NFD) | `Salmón a la plancha` (→ `salmon plancha`) | `{salmon}` ∩ `{salmon, plancha}` = 1, union = 2 | 0.50 | PASS |
| `gazpacho` | `Gazpacho andaluz` | `{gazpacho}` ∩ `{gazpacho, andaluz}` = 1, union = 2 | 0.50 | PASS |
| `queso fresco con membrillo` | `CROISSANT CON QUESO FRESC` (→ `croissant queso fresc`) | `{queso, fresco, membrillo}` ∩ `{croissant, queso, fresc}` = 1, union = 5 | 0.20 | REJECT (correct) |

The analysis shows that single-token queries against 2-token candidates produce Jaccard = 0.50, well above 0.25. The risk of false negatives (legitimate hits rejected) only materialises if a single-token query matches a candidate whose meaningful token set after stop-word removal does not include that token. FTS already guarantees token presence in the document vector — so a valid FTS hit will always share at least one content token with the query. The minimum Jaccard for a 1-content-token query against an N-content-token candidate = 1/(1 + N - 1) = 1/N. For the guard to reject a legitimate hit, N would need to be > 4 (Jaccard < 0.25). This means a 1-word query matching a 5-meaningful-word candidate name where only 1 token overlaps. This is an extremely unlikely legitimate FTS hit — FTS uses `plainto_tsquery` which matches documents containing ALL query tokens; if the query is a single token and it is present in the document, the candidate name will contain that token.

**Decision: retain threshold 0.25 for L1** — same constant as L3. No query-length-aware branching or tsrank bypass is required. The pre-flight Jaccard distribution analysis (AC requirement below) must confirm this before shipping.

**Note on `SPANISH_STOP_WORDS` export**

`SPANISH_STOP_WORDS` is currently declared as a module-level `const` in `level3Lookup.ts` WITHOUT the `export` keyword (verified: line 47 reads `const SPANISH_STOP_WORDS = new Set([...])`). It is not exported. `applyLexicalGuard` and `computeTokenJaccard` use it internally — no caller needs to import `SPANISH_STOP_WORDS` directly. `level1Lookup.ts` only needs to import `applyLexicalGuard` and `LEXICAL_GUARD_MIN_OVERLAP`. No export change to `level3Lookup.ts` is required.

**`runCascade` guard insertion points**

`runCascade()` currently reads:

```typescript
// Strategy 2: FTS dish
const ftsDishRow = await ftsDishMatch(db, normalizedQuery, options, tierFilter, minTier);
if (ftsDishRow !== undefined) {
  return { matchType: 'fts_dish', result: mapDishRowToResult(ftsDishRow), rawFoodGroup: null };
}

// Strategy 4: FTS food
const ftsFoodRow = await ftsFoodMatch(db, normalizedQuery, tierFilter, minTier);
if (ftsFoodRow !== undefined) {
  return { matchType: 'fts_food', result: mapFoodRowToResult(ftsFoodRow), rawFoodGroup: ftsFoodRow.food_group };
}
```

After this feature, Strategy 2 becomes:

```
if (ftsDishRow !== undefined) {
  if (passesGuardEither(normalizedQuery, ftsDishRow.dish_name_es, ftsDishRow.dish_name)) {
    return { matchType: 'fts_dish', result: mapDishRowToResult(ftsDishRow), rawFoodGroup: null };
  }
  // Guard rejected on both Spanish and English sides — fall through to Strategy 3
}
```

Strategy 4 becomes:

```
if (ftsFoodRow !== undefined) {
  if (passesGuardEither(normalizedQuery, ftsFoodRow.food_name_es, ftsFoodRow.food_name)) {
    return { matchType: 'fts_food', result: mapFoodRowToResult(ftsFoodRow), rawFoodGroup: ftsFoodRow.food_group };
  }
  // Guard rejected on both Spanish and English sides — fall through to null (runCascade returns null)
}
```

`dish_name_es` is nullable (`Dish.nameEs String?` in Prisma schema). `food_name_es` is typed `string | null` in `FoodQueryRow` (conservative TS artefact — DB column non-nullable, but typed defensively as in F-H10). `passesGuardEither` handles the null case for `*_name_es` by skipping that side and only checking the English `*_name` side, which is always non-null in the SQL projection.

**ADR requirement**

At implementation time, an ADR-024 addendum (or new ADR-025 if cleaner) must be added to `docs/project_notes/decisions.md` documenting: (1) the L1 extension decision, (2) the threshold analysis showing 0.25 is safe for L1 FTS characteristics, and (3) the empirical pre-flight Jaccard distribution data. The planner agent should determine whether an addendum to ADR-024 or a new ADR-025 is cleaner given the decisions.md structure.

---

### API Changes

N/A. `level1Lookup.ts` is an internal estimation function. No endpoints, request/response schemas, or `api-spec.yaml` changes are required. The `Level1Result` interface and `Level1LookupOptions` type are unchanged.

---

### Data Model Changes

N/A. No DB schema changes, no Prisma migrations, no seed data modifications.

---

### UI Changes

N/A. Backend engine change only.

---

### Edge Cases & Error Handling

| Case | Expected Behaviour |
|------|--------------------|
| **Q649 canonical case** — `queso fresco con membrillo` hits `CROISSANT CON QUESO FRESC` via FTS Strategy 2 | Guard computes Jaccard(`queso fresco membrillo`, `croissant queso fresc`) = 1/5 = 0.20 < 0.25. Guard rejects. Cascade falls through Strategy 3 (exact food) → Strategy 4 (FTS food). Both miss for Q649. `runCascade` returns null. `level1Lookup` returns null. `engineRouter` proceeds to L2. |
| **Single-token query, 2-content-token candidate** — e.g. `paella` → `Paella valenciana` | Jaccard = 1/2 = 0.50 ≥ 0.25. Guard accepts. No regression. |
| **Stop-word-only query** — e.g. `con`, `de` | After stop-word removal, query token set is empty. `computeTokenJaccard` returns 0.0 for empty set. Guard rejects. This query would have produced a nonsensical FTS hit anyway; rejection is correct. Cascade continues to next strategy. |
| **English-branch FTS match (Spanish `name_es` differs)** — e.g. query `bacon eggs` matches `Bacon and Eggs` via the English FTS branch; `name_es = "Beicon con huevos"` | `passesGuardEither(query, name_es, name)` evaluates BOTH sides. Spanish side: Jaccard(`bacon eggs`, `beicon huevos`) → low → REJECT. English side: Jaccard(`bacon eggs`, `bacon eggs`) = 1.0 → ACCEPT. Helper returns true on either-OR. Result returned. No false negative. |
| **Spanish-branch FTS match (English `name` differs)** — e.g. query `tortilla patatas` matches `Tortilla de patatas` via Spanish; `name = "Spanish potato omelette"` | Spanish side: Jaccard(`tortilla patatas`, `tortilla patatas`) = 1.0 → ACCEPT. Helper returns true. Result returned. |
| **`dish_name_es` is null in FTS row** | `passesGuardEither` skips Spanish side when `name_es` is null/undefined, evaluates English side only. `ftsDishMatch` SQL SELECTs `d.name AS dish_name` which is always non-null in DB. Guard operates on English name. |
| **`food_name_es` is null in FTS row** | `passesGuardEither` skips Spanish side when `name_es` is null, evaluates English side only. `food_name` is always non-null (DB constraint + SQL projection). |
| **High tsrank, low Jaccard** — FTS match confident but semantically thin | Guard rejects regardless of tsrank. Q649 is exactly this case. Tsrank is not consulted. |
| **Diacritic mismatch in query vs candidate** — e.g. query `atun` vs candidate `Atún rojo` | NFD normalization in `computeTokenJaccard` (inherited from `level3Lookup.ts`) strips diacritics before tokenization. `atún` → `atun`, `salmón` → `salmon`. Token sets match. NFD logic is in the imported helper — no duplication needed in `level1Lookup.ts`. |
| **Query with emojis or special chars** — e.g. `🍕 pizza` | `computeTokenJaccard` applies `.replace(/[^a-z\s]/g, '')` after NFD normalization (the `normalize()` helper in `level3Lookup.ts`). Emoji and special chars are stripped. Remaining tokens are meaningful food words. Guard operates on clean token set. |
| **Empty or whitespace-only query** | `normalizeQuery()` already trims/collapses whitespace. An empty-string query after normalization produces an empty token set; Jaccard = 0.0; guard rejects any FTS hit. In practice, Zod schema on the route validates minimum query length before reaching `level1Lookup`. |
| **Guard rejects Strategy 2, exact Strategy 3 hit exists** | Cascade falls through naturally to `exactFoodMatch()`. The Strategy 3 exact-match is not subject to the guard (exact matches are inherently non-false-positives). Correct result returned. |
| **Guard rejects Strategy 4, no further strategies** | `runCascade` returns null. `level1Lookup` returns null. `engineRouter` proceeds to L2, then L3, etc. Standard cascade fall-through. |
| **BUG-PROD-012 Tier≥1 pre-cascade path (unscoped query)** — `level1Lookup` calls `runCascade` TWICE: minTier≥1 first, then unfiltered fallthrough | The guard is inside `runCascade`, applied independently on each pass. For Q649: Tier≥1 pass (no CROISSANT in Tier≥1 as it's Tier 0) → all strategies miss → null. Unfiltered fallthrough → Strategy 2 hits CROISSANT → guard rejects → Strategy 3 misses → Strategy 4 misses → null. Both passes return null. Final: null. Tests must explicitly cover both passes — single-pass unit tests with `chainSlug` set, two-pass integration test without scope. |
| **F068 branded Tier 0 pre-cascade (`hasExplicitBrand=true`)** | `level1Lookup` calls `runCascade` TWICE: Tier=0 first, then unfiltered fallthrough. Guard applies in both. Branded queries are scoped by chain so the false-positive pattern is constrained, but the guard is additive and safe. |
| **H7-P5 retry seam interaction with guard-induced null** — L1 returns null because guard rejected the FTS hit | The seam at `engineRouter.ts:178` is gated on `if (h7StrippedQuery !== normalizedQuery)`. **Identity-strip case (Q649-class)**: when `applyH7TrailingStrip(normalizedQuery)` returns the same string, the seam does NOT fire at all — L1 null propagates directly to L2/L3 without retry. **Strip-changes-query case (unmask path)**: when the strip produces a different string, the seam fires once with the stripped query. Retry can succeed (legitimate hit unmasked, desirable) or also return null (correct propagation). The seam fires at most ONCE per request — no iteration, no infinite loop. |
| **DB unavailable** | The existing `try/catch` in `level1Lookup` wrapping `runCascade` re-throws `{ code: 'DB_UNAVAILABLE' }`. The guard runs after the DB call returns successfully; it is not reached when DB fails. Existing error handling unchanged. |
| **Pre-flight Jaccard distribution analysis (AC4)** — uses `qa-exhaustive.sh` extension that emits `matchType` per query | Implementer extends the awk parser at lines 130-139 of `qa-exhaustive.sh` to print `matchType` (e.g., `OK CROISSANT \| 343kcal \| ... \| mt=fts_dish \| ...`). Runs the script against api-dev (post-F-H9+F-H10 baseline). Greps for `mt=fts_dish` and `mt=fts_food` lines. For each such hit, computes Jaccard(query, name_es) AND Jaccard(query, name) using the exported helpers (or equivalent local script). **Records both component scores per hit** (for auditability) and validates the **OR-semantics gate**: a legitimate hit passes if `max(jaccard_es, jaccard_en) ≥ 0.25` — matching the runtime `passesGuardEither` semantics. Failing only when BOTH sides drop below 0.25. Artifact: a markdown table with columns `q | matchType | name_es | name | jaccard_es | jaccard_en | max | gate_pass` committed at `docs/project_notes/F-H10-FU-jaccard-preflight.md` (or referenced in the ADR addendum). |

---

## Implementation Plan

_Pending — to be generated by the planner agent in Step 2._

---

## Acceptance Criteria

**Q649 fix — single-pass scoped unit test**
- [ ] AC1: `level1Lookup` (called with `chainSlug` set to force single-pass `runCascade`) returns `null` for query `queso fresco con membrillo` when the DB is mocked to return a single FTS dish hit with `dish_name_es: 'CROISSANT CON QUESO FRESC'` and `dish_name` (English variant). `passesGuardEither` evaluates BOTH sides; both fall below 0.25; both rejected → result null. Assert mock DB called ≥2 times (FTS dish query + at least one subsequent strategy attempt within the same pass).

**Q649 fix — two-pass unscoped integration test**
- [ ] AC2: New file `packages/api/src/__tests__/fH10FU.q649.integration.test.ts` exists. Mocks `level1Lookup` invocation **without** `chainSlug`/`restaurantId`/`hasExplicitBrand`, exercising BUG-PROD-012's two-pass flow. Both passes (minTier≥1 first, unfiltered fallthrough) apply the guard. Tier≥1 pass returns null (no Tier≥1 candidate). Unfiltered pass returns CROISSANT from FTS dish, guard rejects, cascade continues, all subsequent strategies miss → null. Final return: null.

**Empirical post-deploy verification (operator action)**
- [ ] AC3: After api-dev deploy, re-run QA battery dev (`qa-exhaustive.sh`). Q649 line (`después de la siesta piqué queso fresco con membrillo`) must show `NULL result` (or a correct non-CROISSANT entity). Evidence (battery file path + line + commit SHA of deploy) recorded in Completion Log. Marked done at Step 6 housekeeping (post-merge operator action).

**Pre-flight Jaccard distribution analysis (executable mechanism)**
- [ ] AC4: Before the first implementation commit (after Step 1, before Step 3 Phase 1):
  1. Extend `packages/api/scripts/qa-exhaustive.sh` parser (lines 130-139) to emit `mt={matchType}` in the OK output (e.g., `OK NAME | KCAL | ... | mt=fts_dish | ...`). Commit this tooling change separately.
  2. Run the extended script against api-dev (post-F-H9+F-H10 baseline, no F-H10-FU deployed).
  3. Grep for `mt=fts_dish` and `mt=fts_food` lines. For each hit, compute Jaccard(query, name_es) AND Jaccard(query, name) using the exported helpers via a small ad-hoc script or REPL.
  4. Record both component scores per hit. Compute `max(jaccard_es, jaccard_en)` per hit (the OR-semantics gate matching `passesGuardEither` runtime behaviour).
  5. Confirm every legitimate hit has `max(jaccard_es, jaccard_en) ≥ 0.25`. A hit failing only when BOTH sides drop below 0.25 is the correct rejection criterion. If any legitimate hit fails the OR-gate, halt and revise threshold/strategy.
  6. Commit artifact at `docs/project_notes/F-H10-FU-jaccard-preflight.md` (table columns: `q | matchType | name_es | name | jaccard_es | jaccard_en | max | gate_pass`) and reference it in the ADR addendum.

**No regressions outside Q649 — surgical comparison (operator action, post-deploy)**
- [ ] AC5: Full QA battery dev (650 queries) after F-H10-FU deploy. Compare per-query OK/NULL/FAIL classification line-by-line vs the F-H10 baseline `/tmp/qa-dev-post-fH9-fH10-20260427-1654.txt`. **Only acceptable diff**: Q649 changes from `OK CROISSANT...` to `NULL result` (or correct non-CROISSANT match). **Any other Q-number flipping OK→NULL or OK→different-entity → blocker, investigate**. Per-query diff committed or pasted in Completion Log. NOTE: raw `OK count` may decrease by exactly 1 (Q649). This is the intentional fix, not a regression.

**Code reuse — no duplicate definition**
- [ ] AC6: `grep -rE "^[[:space:]]*(export[[:space:]]+)?function[[:space:]]+applyLexicalGuard" packages/api/src/` returns exactly 1 hit (in `level3Lookup.ts`). `level1Lookup.ts` uses an `import` from `./level3Lookup`, not a local definition. The `passesGuardEither` helper (local to `level1Lookup.ts`) composes `applyLexicalGuard` rather than duplicating its logic.

**Unit tests — single-pass cascade behaviour**
- [ ] AC7: New file `packages/api/src/__tests__/fH10FU.l1LexicalGuard.unit.test.ts` exists and passes. All `level1Lookup` invocations use `chainSlug` (or `restaurantId`) to force single-pass execution. Covers at minimum:
  - **Guard reject** path on FTS Strategy 2 (dish): both name_es and name fail → fall-through to Strategy 3
  - **Guard reject** path on FTS Strategy 4 (food): both fail → `runCascade` returns null
  - **Guard accept** path on FTS Strategy 2 (dish): name_es passes → result returned
  - **Guard accept** path on FTS Strategy 4 (food): name_es passes → result returned
  - **English-branch acceptance**: name_es fails but name passes (e.g., English query) → result returned (verifies dual-name OR semantics)
  - **`dish_name_es` null** + name passes → result returned (skips Spanish side correctly)
  - **`food_name_es` null** + name passes → result returned
  - **Exact Strategy 1 (dish) and Strategy 3 (food) hits**: NOT subject to guard (pass unconditionally even if Jaccard < 0.25 against the candidate name)

**Unit tests — `passesGuardEither` helper**
- [ ] AC8: Unit tests for the new `passesGuardEither(query, nameEs, name)` helper covering: (a) name_es null + name passes → true; (b) name_es null + name fails → false; (c) both pass → true; (d) name_es passes, name fails → true; (e) name_es fails, name passes → true; (f) both fail → false; (g) name_es undefined treated as null.

**H7-P5 retry seam regression test (two paths)**
- [ ] AC9: New unit test(s) covering BOTH paths of the H7-P5 retry seam interaction with F-H10-FU's guard-induced nulls:
  - **Path A — non-strippable query (Q649-class)**: query has no H7-P5 wrapper. Strip is no-op (`h7StrippedQuery === normalizedQuery`). L1 returns null due to guard rejection. Seam does NOT fire (gated on strip-changes-query at `engineRouter.ts:178`). L2 invoked directly. Verifies the seam is not over-eager on identity strips.
  - **Path B — strippable query (unmask path)**: query has an H7-P5 wrapper that produces a DIFFERENT stripped form. Pre-strip L1 returns null (guard rejects the long-form FTS hit). Seam fires. Retry with stripped query exercises a different FTS code path. The retry can succeed (legitimate hit unmasked) or also return null (correct propagation). Verifies the seam terminates without iteration.
  Mock the L1 + retry chain.

**Single-token boundary tests**
- [ ] AC10: Unit tests for single-token queries against 2-content-token candidates (e.g. `paella` → `Paella valenciana`, Jaccard = 0.50) confirm `passesGuardEither` accepts on Spanish side. Document the threshold safety margin for single-word queries.

**ADR documentation**
- [ ] AC11: ADR-024 addendum added to `docs/project_notes/decisions.md` (or new ADR-025 if planner determines it cleaner). Documents: (1) L1 FTS extension rationale, (2) bilingual matching → dual-name OR semantics decision, (3) threshold 0.25 safety analysis for L1 FTS characteristics, (4) reference to the pre-flight Jaccard distribution artifact.

**key_facts.md update**
- [ ] AC12: `docs/project_notes/key_facts.md` Level 1 estimation-module bullet (around line 167) updated to note the lexical guard now applies at L1 FTS Strategies 2 and 4 with dual-name OR semantics. Reference ADR-024 / 025.

**All tests pass, build clean**
- [ ] AC13: Full API test suite passes (`npm test --workspace=@foodxplorer/api`). Lint clean. Build succeeds.

---

## Definition of Done

- [ ] All 13 acceptance criteria met (AC1-AC13)
- [ ] Unit tests written and passing (`fH10FU.l1LexicalGuard.unit.test.ts`)
- [ ] Integration test written and passing (`fH10FU.q649.integration.test.ts`)
- [ ] H7-P5 retry seam regression test included
- [ ] Code follows project standards (no `any`, English-only identifiers, TDD)
- [ ] No linting errors
- [ ] Build succeeds
- [ ] ADR-024 addendum (or ADR-025) committed to `decisions.md`
- [ ] `key_facts.md` Level 1 module bullet updated (AC12)
- [ ] Pre-flight Jaccard artifact committed at `docs/project_notes/F-H10-FU-jaccard-preflight.md`
- [ ] `qa-exhaustive.sh` matchType extension committed (separately or with ticket)
- [ ] Specs reflect final implementation (api-spec.yaml unchanged — internal feature)

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated
- [x] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 2: `backend-planner` executed, plan approved
- [ ] Step 3: `backend-developer` executed with TDD
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed (Standard)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-27 | Step 1: Setup | Branch `feature/F-H10-FU-l1-lexical-guard` created from develop @ `36be921`. Ticket created from `references/ticket-template.md` with all 7 sections. Tracker Active Session updated to point at F-H10-FU step 0/6. pm-h6plus archived to `pm-session-pm-h6plus.md`; new `pm-session.md` (session id `pm-h6plus2`) initialized. |
| 2026-04-27 | Step 0: Spec — `spec-creator` agent executed | Spec written into ticket. Spec-creator read 7 reference files empirically (level1Lookup.ts, level3Lookup.ts, F-H10 ticket, bugs.md, decisions.md, prisma schema, QA battery). Open questions raised: (1) pre-flight Jaccard mechanism; (2) ADR-024 addendum vs ADR-025; (3) `SPANISH_STOP_WORDS` not exported (corrected); (4) `runCascade` private function mock strategy. |
| 2026-04-27 | Step 0: Self-Review | Re-read full spec critically. Identified gaps in AC3 mechanism + H7-P5 retry interaction (left for cross-model). |
| 2026-04-27 | Step 0: `/review-spec` R1 | Gemini APPROVED text-only; Codex REVISE empirically grounded — 2 CRITICAL (AC4 raw OK count gate flawed; AC3 not executable) + 4 IMPORTANT (English FTS branch; BUG-PROD-012 two-pass; SPANISH_STOP_WORDS contradiction; key_facts.md missing) + 1 SUGGESTION (H7-P5 wording). All addressed in R2 revision. |
| 2026-04-27 | Step 0: `/review-spec` R2 | Gemini APPROVED; Codex REVISE — 2 IMPORTANT (H7-P5 retry seam still imprecise re strip-changes-query gate; pre-flight Jaccard `min` contradicted dual-name OR semantics — should be `max`). Both addressed in R3. |
| 2026-04-27 | Step 0: `/review-spec` R3 | Codex 1 IMPORTANT (Edge Cases row reintroduced contradiction). Fixed inline. Spec consistent throughout. |
| 2026-04-27 | Step 0: APPROVED at L5 (auto) | Multi-round confidence >85% per `feedback_multi_round_review.md`. 3R Codex + 2R Gemini cross-model trail. 13 ACs (AC1-AC13) testable. Spec ready for Step 2 Plan. Ticket Status: Spec → Planning. |

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
