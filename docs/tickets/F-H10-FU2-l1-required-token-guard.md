# F-H10-FU2: L1 Required-Token Guard — Q649 algorithm fix (Jaccard insufficient)

**Feature:** F-H10-FU2 | **Type:** Backend-Feature (NLP/Search) | **Priority:** High
**Status:** In Progress | **Branch:** feature/F-H10-FU2-l1-required-token-guard
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-28 | **Dependencies:** F-H10-FU (PR #225, merged at `73e1c97`)

---

## Spec

### Description

F-H10-FU2 adds a **required-token check** on top of F-H10-FU's existing Jaccard guard in `packages/api/src/estimation/level1Lookup.ts`. The combined guard is exposed as a new private function `passesGuardL1(query, nameEs, name)` that replaces all direct calls to `passesGuardEither` at the two FTS-strategy injection points inside `runCascade()`.

**Why this is needed.** F-H10-FU shipped `passesGuardEither` with Jaccard threshold 0.25. Operator post-deploy verification on 2026-04-28 (commit `73e1c97`) proved Q649 (`queso fresco con membrillo` → `CROISSANT CON QUESO FRESCO`) is still accepted. Root cause: the original spec computed Jaccard against the truncated display string `CROISSANT CON QUESO FRESC` (0.20 → would-reject). The actual full `nameEs` is `CROISSANT CON QUESO FRESCO`; Jaccard against the full name = 2/4 = 0.50 ≥ 0.25 → guard passes incorrectly. Threshold tuning alone cannot fix this — any threshold above 0.50 would also reject single-token queries such as `paella` → `Paella valenciana` (Jaccard = 0.50), which are legitimate and common. The 2026-04-28 QA battery (650 queries) also surfaced 5 additional false positives with the same structural signature (high-Jaccard semantic mismatch: Q178, Q312, Q345, Q378, Q580).

**The algorithm — Option A (required-token check).** The check layers a second condition after the existing Jaccard gate. A query token is "high-information" (HI) if it is ≥ 4 characters long AND not in `FOOD_STOP_WORDS_EXTENDED`. **The semantics is "every HI token must be present" (per `bugs.md` Option A: "if any HI token absent from candidate, reject"). If the query has ≥ 1 HI token AND any of those HI tokens does NOT appear in the candidate name (after NFD normalization + punctuation strip), the candidate is rejected regardless of its Jaccard score.** The check uses OR semantics across both names — accept if EVERY HI token is present in `nameEs` OR EVERY HI token is present in `name`, matching `passesGuardEither`'s bilingual contract.

**`FOOD_STOP_WORDS_EXTENDED` starter list.** This set is defined locally in `level1Lookup.ts` (not imported from `level3Lookup.ts` whose private `SPANISH_STOP_WORDS` must NOT be re-exported). It MUST include all tokens from `SPANISH_STOP_WORDS` (de, del, con, la, el, los, las, un, una, al, y, a, en, por) PLUS the following food-domain modifiers that frequently appear in queries but do not distinguish dishes: `queso`, `fresco`, `leche`, `agua`, `plato`, `racion`, `tapa`, `pintxo`, `media`, `caliente`, `frio`, `natural`. Criteria for adding a token to this list: it is semantically common across many dish types (not a distinguishing ingredient), its presence alone does not justify a match, and removing it does not cause false negatives on any known query in the QA battery. The list is intentionally conservative — over-aggressive extension causes false negatives (legitimate matches silently dropped).

**Combined guard function signature (pseudocode — not implementation code):**

```
passesGuardL1(query, nameEs, name):
  Step 1 — Jaccard gate (existing F-H10-FU passesGuardEither):
    if NOT passesGuardEither(query, nameEs, name) → REJECT
  Step 2 — Required-token check (NEW — every-HI-token semantics):
    queryHI = getHighInformationTokens(query)
    if queryHI is empty → ACCEPT (fall through; preserve existing Jaccard-only behavior)
    if nameEs is non-null AND every token in queryHI is in normalize(nameEs).tokens → ACCEPT
    if every token in queryHI is in normalize(name).tokens → ACCEPT
    → REJECT
```

The implementation must use `Array.prototype.every` (or equivalent), NOT `Array.prototype.some`. Using `some` would only reject when ALL HI tokens are absent (zero-overlap) and would still accept Q178/Q312 because `cola` is present in `Huevas cocidas de merluza de cola patagónia` — verified empirically during round 1 review.

`passesGuardL1` is private to `level1Lookup.ts`. It is NOT exported. Call sites: the two FTS strategy injection blocks inside `runCascade()` (Strategy 2 `ftsDishRow` and Strategy 4 `ftsFoodRow`), replacing the existing `passesGuardEither` calls identically.

**Helper `getHighInformationTokens(s)` (pseudocode):** normalize(s) → punctuation-strip (replace `[^a-z\s]` with empty) → split on whitespace → filter tokens where `token.length >= 4 AND token NOT IN FOOD_STOP_WORDS_EXTENDED`. Returns a `Set<string>`. If the result is empty, caller falls through to Jaccard-only behavior.

**Normalization (full token-comparison contract).** Token comparison MUST use the SAME pipeline as `computeTokenJaccard` in `level3Lookup.ts:67-74`:
1. `s.toLowerCase()`
2. `.normalize('NFD').replace(/[̀-ͯ]/g, '')` (NFD diacritic strip — equivalent to `/[̀-ͯ]/g` in the existing code; the spec uses the explicit `\u` escape form for clarity)
3. `.replace(/[^a-z\s]/g, '')` (punctuation strip — REQUIRED so candidate names with hyphens, commas, parentheses tokenize cleanly)
4. `.split(/\s+/)` (whitespace tokenize)

This ensures `caña` matches `cana`, `café` matches `cafe`, `Crème brûlée` matches `creme brulee`, and so on. The `normalize` function in `level3Lookup.ts` is private; `level1Lookup.ts` must replicate the FULL pipeline locally (NOT just the 3-line `normalize` — also the punctuation strip from `tokenize` inside `computeTokenJaccard`).

**Expected outcomes for known false positives (every-HI-token semantics — verified empirically with `node -e` during round 1 review):**

| Query | Candidate nameEs | queryHI tokens | All HI tokens in candidate? | F-H10-FU2 result |
|---|---|---|---|---|
| queso fresco con membrillo | CROISSANT CON QUESO FRESCO | {membrillo} | `membrillo` absent → fail | REJECT (Q649 fixed at Step 2) |
| una coca cola | Huevas cocidas de merluza de cola patagónia | {coca, cola} | `coca` absent → fail | REJECT (Q178 fixed at Step 2) |
| coca cola grande | Huevas cocidas de merluza de cola patagónia | {coca, cola, grande} | `coca` absent → fail | REJECT (Q312 fixed at Step 2) |
| un poco de todo | Patatas aptas para todo uso culinario | {poco, todo} | `poco` absent → fail | REJECT (Q345 fixed at Step 2 — also rejected at Step 1 by Jaccard 0.143; Step 2 is primary gate) |
| una copa de oporto | Paté fresco de vino de Oporto | {copa, oporto} | `copa` absent → fail | REJECT (Q378 fixed at Step 2 — `oporto` present but `copa` missing means `every` fails) |
| pollo al curri con arro blanco | Foccacia Pollo al Curry | {pollo, curri, arro, blanco} | `curri` ≠ `curry`, `arro` absent, `blanco` absent → fail | REJECT (Q580 fixed at Step 2 — `pollo` present but the other 3 missing means `every` fails. Catalog gap remains; correct behavior is to return null and let user re-query) |
| paella | Paella valenciana | {paella} | `paella` present → all match | ACCEPT (preserved) |
| gazpacho | Gazpacho andaluz | {gazpacho} | `gazpacho` present → all match | ACCEPT (preserved) |
| tortilla | Tortilla de patatas | {tortilla} | `tortilla` present → all match | ACCEPT (preserved) |
| croquetas | Croquetas de jamón | {croquetas} | `croquetas` present → all match | ACCEPT (preserved) |
| chorizo ibérico | Chorizo ibérico embutido | {chorizo, iberico} (NFD) | both present → all match | ACCEPT (preserved) |

**Important consequence of `every` semantics:** Q378 and Q580 — both flagged "out of scope" in the original spec draft (round 1) — are actually rejected by the correct algorithm. F-H10-FU2 fixes ALL 5 known false positives, not just 3. There is no longer a remaining "out of scope" set for F-H10-FU2.

**False-negative trade-off — over-rejection on elaborated queries.** With `every` semantics, queries that contain HI tokens NOT in the canonical catalog name will be rejected at L1 even when they refer to the same dish. Example: `tarta de queso casera` → `Tarta de queso`: queryHI = {tarta, casera} (queso is in `FOOD_STOP_WORDS_EXTENDED`); `casera` is not in the candidate → REJECT at L1. This is acceptable because the L3 embedding semantic check (active per ADR-024) acts as a safety net for such elaborated queries. The spec accepts this delegation pattern: L1 stays strict to suppress noise; L3 catches semantic equivalents. If empirical QA confirms specific quality modifiers (e.g., `casero/casera`, `grande`, `pequeño`, `mediano`) cause systematic L1 rejection of legitimate matches, the planner may extend `FOOD_STOP_WORDS_EXTENDED` in Phase 0 — but this is not pre-committed in the spec.

**ADR-024 addendum.** A second addendum to ADR-024 must be written documenting: (a) the empirical failure mode (Jaccard insufficient for multi-token semantic mismatches), (b) the required-token algorithm with `every`-HI-token semantics, (c) `FOOD_STOP_WORDS_EXTENDED` criteria, (d) the L1→L3 delegation pattern for elaborated queries (over-rejection at L1 is rescued by L3 embedding semantic check), and (e) the `token.length >= 4` heuristic rationale.

**Scope of changes.**
- **Production logic — single file**: `packages/api/src/estimation/level1Lookup.ts`. No changes to `level3Lookup.ts`, `engineRouter.ts`, `conversationCore.ts`, `api-spec.yaml`, `ui-components.md`, shared Zod schemas, seed data, or any other production file. Do NOT export any new symbols from `level1Lookup.ts`.
- **Tests**: 1 NEW file `packages/api/src/__tests__/fH10FU2.l1RequiredTokenGuard.unit.test.ts`. Existing 4 F-H10-FU test files (`fH10FU.l1LexicalGuard.unit.test.ts`, `fH10FU.l1LexicalGuard.edge-cases.test.ts`, `fH10FU.q649.unit.test.ts`, `fH10FU.h7SeamRegression.unit.test.ts`) MUST continue to pass without modification (regression gate; see AC5).
- **Documentation**: ADR-024 receives a SECOND addendum in `docs/project_notes/decisions.md` (covering required-token rationale, FOOD_STOP_WORDS_EXTENDED criteria, every-vs-some justification, and the L1→L3 delegation pattern for over-rejection). `key_facts.md` Level 1 module bullet may need a one-line update mentioning the layered guard.
- **Operator artifact (post-merge, post-deploy)**: `docs/project_notes/F-H10-FU-jaccard-preflight.md` (or a new sibling artifact) updated with Q649/Q178/Q312/Q345/Q378/Q580 post-deploy verification table. This is a release deliverable, not a code-level acceptance criterion (see "Post-deploy verification" subsection below).

### API Changes (if applicable)

None. This is an internal NLP/search algorithm change confined to `level1Lookup.ts`. No API contracts, request/response schemas, or OpenAPI spec entries are affected.

### Data Model Changes (if applicable)

None. No schema migrations, seed data changes, or Zod schema changes.

### UI Changes (if applicable)

None.

### Edge Cases & Error Handling

**EC-1: Query with zero HI tokens (e.g., `tapa`, `agua`, `media racion`).**
All query tokens are either `< 4` characters or members of `FOOD_STOP_WORDS_EXTENDED`. `getHighInformationTokens` returns an empty set. `passesGuardL1` skips the required-token step entirely and falls through to the existing Jaccard gate result. Behavior is byte-identical to F-H10-FU. This preserves short-query search for catalog items that are themselves stop-wordable terms.

**EC-2: Query where all non-stop tokens are exactly 3 characters (e.g., `pan`, `té`, `ron`).**
Same as EC-1 — length filter `>= 4` means 3-char tokens do not contribute HI tokens. `pan` (3), `té` (2), `ron` (3) all fall below threshold. Required-token step is skipped; Jaccard gate applies. Spec accepts this as a known heuristic limit: these are very short Spanish food words that appear in many candidate names (pan is in `pan de cristal`, `pan tumaca`, `mollete con pan`) and would produce false negatives if treated as HI tokens. Follow-up: if a future QA battery surfaces false positives caused by 3-char queries slipping through Jaccard, consider adding specific terms to `FOOD_STOP_WORDS_EXTENDED` rather than lowering the length cutoff.

**EC-3: Bilingual OR semantics — every-HI present in either name suffices (not in both).**
Example: query `cordero asado` → candidate `nameEs = 'Cordero asado al horno'`, `name = 'Roasted lamb'`. queryHI = {cordero, asado}. nameEs tokens = {cordero, asado, al, horno} → BOTH HI tokens present → every passes on the Spanish side → ACCEPT (English side not consulted). OR semantics: ACCEPT if EVERY HI token is in `nameEs` OR EVERY HI token is in `name`. Mixed split (e.g., `cordero` only in `nameEs`, `asado` only in `name`) does NOT trigger ACCEPT — the contract is conjunction-on-each-side, disjunction-across-sides. This mirrors how `passesGuardEither` evaluates Jaccard independently per side and accepts on the better-scoring side.

**EC-4: NFD + punctuation normalization in required-token comparison.**
`caña` query (post-normalize: `cana`) must match `Caña de cerveza` candidate. Normalization MUST apply to both query AND candidate tokens BEFORE set comparison. queryHI = {cana}. Candidate post-normalize: `cana de cerveza` → tokens {cana, de, cerveza} → `cana` present → every passes → ACCEPT. Similarly `café` → `Café solo` → ACCEPT. `Crème brûlée` candidate (with grave/acute accents AND a possible final period or comma in `nameEs`) must normalize to `creme brulee` cleanly — punctuation strip is essential here. The full pipeline (NFD diacritic + punctuation `[^a-z\s]` strip) MUST be identical to `computeTokenJaccard`'s `tokenize` step in `level3Lookup.ts:67-74`. Replicate locally; do NOT export from level3Lookup.

**EC-5: Single-token query against a 2-content-token candidate — the Jaccard parity edge.**
`paella` (1 HI token: `paella`) → `Paella valenciana` (2 content tokens after stop-word strip: `paella`, `valenciana`). queryHI = {paella}. `paella` is present in candidate → ACCEPT at required-token step (does not even reach rejection). This confirms the required-token check does NOT break the single-token use case that threshold tuning would have broken.

**EC-6: Two-pass cascade preservation (BUG-PROD-012).**
`level1Lookup` calls `runCascade` up to twice: first with `minTier=1` (Tier≥1 preferred pass for non-branded unscoped queries), then with no tier filter (unfiltered fallback). `passesGuardL1` is called from inside `runCascade` at the FTS strategy injection points. The required-token check therefore applies in BOTH passes independently. A Q649-class false positive that is present in both Tier≥1 and the full catalog will be rejected in BOTH passes and correctly return null. No new interaction with the two-pass logic is introduced — the guard is purely post-retrieval within a single cascade execution.

**EC-7: Candidate with `nameEs = null`.**
`passesGuardEither` (Step 1) already handles null `nameEs` by skipping the Spanish-side Jaccard check. `passesGuardL1` must apply the same null-guard semantics for the required-token side: if `nameEs` is null or undefined, the required-token step evaluates ONLY `name` (English side). The OR-semantics short-circuit applies: a non-null `nameEs` is evaluated first — if EVERY HI token is in nameEs tokens → return ACCEPT immediately; otherwise proceed to evaluate `name`. If `nameEs` is null, skip directly to `name` evaluation. If both fail (or `name` fails when `nameEs` is null), → REJECT.

**EC-8: `FOOD_STOP_WORDS_EXTENDED` false-negative risk.**
If a legitimate query token is accidentally included in `FOOD_STOP_WORDS_EXTENDED`, queries containing that token will silently lose HI coverage and fall back to Jaccard-only. Example: if `pollo` were added to the extended list, `pollo asado` would have queryHI = {asado} only — and a candidate without `asado` would still incorrectly match via Jaccard. The spec prohibits adding terms that are commonly the primary distinguishing ingredient in a query. The starter list (see Description) was validated against the known Q649, Q178, Q312, Q345, Q378, Q580 cases (all 6 rejected) and preserves acceptance of `paella`, `gazpacho`, `tortilla`, `croquetas`, `jamón`, `bocadillo`, `boquerones`, `chorizo`, `natilla` from the QA battery.

**EC-9: High-frequency filler HI tokens (Q345 verified rejection path).**
Generic Spanish words like `todo` (4 chars) and `poco` (4 chars) pass the length-4 filter and are not in `FOOD_STOP_WORDS_EXTENDED`, so they qualify as HI tokens. With `every` semantics, BOTH must be present in the candidate to ACCEPT. For Q345 (`un poco de todo` → `Patatas aptas para todo uso culinario`), queryHI = {poco, todo}; the candidate contains `todo` but NOT `poco` → `every` fails → REJECT at Step 2. As a defence-in-depth bonus, Step 1 (Jaccard 0.143 < 0.25) ALSO rejects this query independently — so Q345 is double-rejected. The required-token check is the primary gate for this case; Jaccard is the safety net. **Future hardening (still out of scope for F-H10-FU2):** if a future QA battery surfaces a long-query false positive where ALL filler HI tokens (e.g., both `todo` AND `poco`) happen to overlap with the candidate, candidates are (a) add the offending tokens to `FOOD_STOP_WORDS_EXTENDED`, OR (b) escalate to TF-IDF/BM25 weighted scoring (Option B in `bugs.md` 2026-04-28). The L3 embedding semantic check remains the ultimate safety net for any case both gates miss.

---

## Implementation Plan

_Pending — to be generated by the `backend-planner` agent in Step 2._

---

## Post-deploy Verification (operator action — not TDD-verifiable)

> **Run AFTER squash-merge to develop AND after operator-triggered Render deploy on `api-dev`.** This is a release deliverable, not a code-level acceptance criterion. Captured separately so the implementation/review/QA cycle is not blocked on deploy availability.

- [ ] **PD1** — Re-run extended `qa-exhaustive.sh` (650-query battery) against `https://api-dev.nutrixplorer.com` post-deploy.
- [ ] **PD2** — Verify Q649 (`después de la siesta piqué queso fresco con membrillo`) is NOT in the OK list. Expected: NULL or a non-CROISSANT match if catalog gains a `queso fresco con membrillo` entry. Battery output captured at `/tmp/qa-dev-post-fH10FU2-<YYYYMMDD-HHMM>.txt`.
- [ ] **PD3** — Verify Q178, Q312, Q345, Q378, Q580 are NOT in the OK list with their previously-observed wrong matches.
- [ ] **PD4** — Compare the Jaccard distribution against the F-H10-FU pre-flight (`docs/project_notes/F-H10-FU-jaccard-preflight.md`): no NEW false-negative regressions on the 435 OK queries from the 2026-04-28 battery. Acceptable: ≤ 5 OK→NULL conversions on Cat 22/29 elaborated queries (delegated to L3, not a regression).
- [ ] **PD5** — Update `docs/project_notes/F-H10-FU-jaccard-preflight.md` (or create `F-H10-FU2-postdeploy-<date>.md`) with the verification table mirroring AC3's 6 cases: per-query before/after status, candidate name, queryHI tokens, all-HI-present? boolean, final result.
- [ ] **PD6** — File any newly-surfaced false positives or false negatives in `bugs.md`. If ≥ 3 new false negatives on legitimate queries, escalate to F-H10-FU3 with a proposed `FOOD_STOP_WORDS_EXTENDED` expansion or Option B (TF-IDF) algorithm change.

---

## Acceptance Criteria

- [ ] **AC1** — `passesGuardL1(query, nameEs, name)` private function exists in `level1Lookup.ts`. It calls `passesGuardEither` as Step 1 (Jaccard gate) and applies the required-token check as Step 2. It is NOT exported. All FTS injection points inside `runCascade()` (Strategy 2 and Strategy 4) call `passesGuardL1` instead of `passesGuardEither` directly.
- [ ] **AC2** — `FOOD_STOP_WORDS_EXTENDED` is a `Set<string>` defined locally in `level1Lookup.ts`. It is a superset of `SPANISH_STOP_WORDS` (de, del, con, la, el, los, las, un, una, al, y, a, en, por) plus the food-domain modifiers listed in the spec Description. It is NOT imported from `level3Lookup.ts`.
- [ ] **AC3** — All 6 known L1 false positives from the 2026-04-28 QA battery are rejected by `passesGuardL1` in unit tests, using the FULL `nameEs` (not the QA-output 25-char truncation). Each test must produce `passesGuardL1(...) === false`:
  - Q649: `queso fresco con membrillo` → `CROISSANT CON QUESO FRESCO`
  - Q178: `una coca cola` → `Huevas cocidas de merluza de cola patagónia`
  - Q312: `coca cola grande` → `Huevas cocidas de merluza de cola patagónia`
  - Q345: `un poco de todo` → `Patatas aptas para todo uso culinario`
  - Q378: `una copa de oporto` → `Paté fresco de vino de Oporto`
  - Q580: `pollo al curri con arro blanco` → `Foccacia Pollo al Curry`
- [ ] **AC4** — Legitimate single-token and 2-token queries are accepted by `passesGuardL1` in unit tests: `paella` → `Paella valenciana` (ACCEPT), `gazpacho` → `Gazpacho andaluz` (ACCEPT), `tortilla` → `Tortilla de patatas` (ACCEPT), `croquetas` → `Croquetas de jamón` (ACCEPT), `jamón` → `Bocadillo de jamón york` (ACCEPT — `jamon` HI present), `chorizo ibérico` → `Chorizo ibérico embutido` (ACCEPT — both HI present). None may produce `passesGuardL1(...) === false`.
- [ ] **AC5** — All existing F-H10-FU regression suite passes without modification. The suite spans 4 files totaling 40 tests (verified 2026-04-28 via `node -e` count): `packages/api/src/__tests__/fH10FU.l1LexicalGuard.unit.test.ts` (12 tests), `fH10FU.l1LexicalGuard.edge-cases.test.ts` (20 tests), `fH10FU.q649.unit.test.ts` (4 tests), `fH10FU.h7SeamRegression.unit.test.ts` (4 tests). The npm test gate must show ≥ 40 passing tests across this glob `fH10FU.*.test.ts` after F-H10-FU2 lands. No regression on pre-existing Jaccard-gate behavior. (If a fixture query needs updating because `every` semantics newly rejects it, that test must be updated AND a justification recorded in the ticket Completion Log.)
- [ ] **AC6** — New test file `packages/api/src/__tests__/fH10FU2.l1RequiredTokenGuard.unit.test.ts` covers: EC-1 (zero HI tokens → fallback to Jaccard), EC-2 (3-char tokens → not HI), EC-3 (HI in nameEs only → ACCEPT via OR), EC-4 (NFD match for accented tokens), EC-5 (single-token parity edge `paella`), EC-7 (null nameEs), EC-9 (Q345 filler-HI double-rejection path), plus the 6 AC3 false positives and the AC4 legitimate matches. Minimum 15 tests.

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] E2E tests updated (if applicable)
- [ ] Code follows project standards
- [ ] No linting errors
- [ ] Build succeeds
- [ ] Specs reflect final implementation

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated (Spec /review-spec 2 rounds: Gemini APPROVED R1; Codex REVISE R1 → APPROVED R2; all CRITICAL/IMPORTANT findings addressed; auto-approved per L5)
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
| 2026-04-28 | Ticket created | Skeleton scaffolded post-recovery; F-H10-FU operator AC3 fail filed F-H10-FU2; user authorized via "vamos a por el A" |
| 2026-04-28 | Spec /review-spec round 1 | Gemini APPROVED (1 SUGGESTION cosmetic regex format) + Codex REVISE (1 CRITICAL `some` vs `every` semantics empirically verified, 2 IMPORTANT scope contradiction + AC5 test count, 2 SUGGESTION normalization punctuation strip + AC7 not TDD-verifiable). All addressed: pseudocode → `every`; outcomes table updated with Q378+Q580 rejected; scope rewritten; AC5 → 4 files/40 tests; punctuation strip required in normalize pipeline; AC7 moved to new `## Post-deploy Verification` subsection (PD1-PD6). |
| 2026-04-28 | Spec /review-spec round 2 | Codex VERIFIED FIXED all 5 round-1 findings (1 CRITICAL + 2 IMPORTANT + 2 SUGGESTION). Empirical `node -e` simulation reproduced the spec's outcomes table: Q178/Q312/Q345/Q378/Q580/Q649 all rejected; paella/gazpacho/tortilla/croquetas/chorizo ibérico all accepted. No new critical issues. **Codex R2 VERDICT: APPROVED**. Spec converged in 2 rounds; confidence > 85%. Step 0 Spec Approval auto-approved per L5 PM Auto. |

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

*Ticket created: 2026-04-28*
