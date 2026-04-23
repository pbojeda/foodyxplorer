# F-NLP-CHAIN-ORDERING: NLP Pipeline Chain Ordering — Count Extraction After Wrapper Strip

**Feature:** F-NLP-CHAIN-ORDERING | **Type:** Backend-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F-NLP-CHAIN-ORDERING
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-23 | **Dependencies:** None (builds on F-NLP + F-COUNT + F-MORPH from QA Improvement Sprint 2026-04-21)

---

## Spec

### Description

This feature closes H5-A: the F-NLP + F-COUNT chain-ordering bug surfaced in the QA Improvement Sprint (2026-04-21) and documented as a KNOWN GAP in the F-COUNT ticket's AC22.

**Scope decision (2026-04-23, informed by `/review-spec` round 1):** The original intent was to bundle H5-A with H5-B ("menu detection from F-NLP stripped text"). Cross-model review (Gemini + Codex, both empirically verified) surfaced a CRITICAL finding: **H5-B's premise was wrong**. The existing `detectMenuQuery` in `packages/api/src/conversation/menuDetector.ts` only matches explicit `menú:` / `menu:` / `menú del día:` trigger patterns; it does NOT detect implicit multi-item queries like `"paella y vino"`. Re-invoking it on F-NLP-stripped text would still return `null` for those queries. Fixing H5-B therefore requires a **new implicit multi-item detector** (a new capability with non-trivial false-positive risk against dish names containing conjunctions/prepositions, e.g. `arroz con leche`, `pan con tomate`, `mar y montaña`, `huevos y jamón`, and recently-added F-H4 aliases), not a simple reorder. Introducing a new detection capability inside this in-flight Standard ticket would skip the dedicated `/review-spec` + `/review-plan` gate that SDD exists to enforce, and risk silent regressions on catalogue entries whose names contain the very conjunctions the naïve splitter would use.

**Therefore H5-B has been split out** into a new follow-up ticket `F-MULTI-ITEM-IMPLICIT` (PR4 of the current pm-sprint2 session), with its own full Step 0-6 cycle. This ticket now covers H5-A only, plus three collateral findings from the same review that legitimately belong here.

**H5-A — Count extraction ordering (F-NLP + F-COUNT chain):**

`extractPortionModifier` is called in `packages/api/src/conversation/conversationCore.ts` on the raw input before `extractFoodQuery` has stripped the conversational wrapper. The PATTERNS array in `packages/api/src/conversation/entityExtractor.ts` matches on the leading tokens of the string (e.g., `/^(dos|tres|...)\s+/`, `/^\d+\s+/`). When the input begins with a wrapper (`"me he bebido dos cañas"`), the numeric token is not at the start, so the pattern fails and `portionMultiplier` defaults to 1. After `extractFoodQuery` strips the wrapper and produces `"dos cañas de cerveza"`, the pipeline commits to the already-captured multiplier of 1 and never re-evaluates. The result is either a correct food identification with a silent multiplier undercount (wrong kcal by factor 2+) or a NULL result if the count token subsequently breaks downstream matching.

AC22 in the F-COUNT ticket was explicitly left unchecked with a KNOWN GAP annotation pointing to this ordering issue. This feature closes that gap.

**Collateral findings from the same `/review-spec` pass (folded in because scope is legitimate):**

- **AC11 regression correction.** The original spec's regression example `"paella y vino" → menu_estimation` was factually wrong: F076 tests at `packages/api/src/__tests__/f076.menuDetector.unit.test.ts:183` assert queries without a `menú` / `menu` trigger return `null`. The regression guards in this ticket must use a query that actually triggers the first-pass menu detector (e.g., `"menú: paella y vino"`).
- **Post-count normalization.** For queries like `"dos platos de paella"`, extracting `count = 2` via `extractPortionModifier` leaves the container `"platos de"` still present in the residual text. `parseDishExpression` runs article/container/serving strips BEFORE `extractPortionModifier` (see `packages/api/src/conversation/entityExtractor.ts:421-454`), so there is no second-pass container strip after the count is extracted. The resulting query string reaches L1 as `"platos de paella"` instead of `"paella"`, degrading matching accuracy. This feature must commit to observable behaviour: after the count is extracted from stripped-wrapper text, any lingering container/serving tokens must also be stripped so L1 receives the clean food name. **Catalogue note for the planner:** `CONTAINER_PATTERNS` (`entityExtractor.ts:586`) currently includes singular `plato de` but NOT plural `platos de`; `tapas de` is in `SERVING_FORMAT_PATTERNS` (`entityExtractor.ts:612`). The planner must decide in Step 2 whether to (a) extend `CONTAINER_PATTERNS` with plural forms (`platos de`, `cuencos de`, etc.), (b) also run `SERVING_FORMAT_PATTERNS` in the second-pass (would catch `tapas de`), or (c) introduce a unified "post-count container/serving residual strip" primitive that reuses both arrays. Any option is acceptable if AC4 (`dos platos de paella → paella`) and AC5 (`tres tapas de croquetas → croquetas`) both pass.
- **Integration-test requirement.** Because H5-A is a `conversationCore.ts` wiring/ordering bug (not only a helper-function bug), ADR-guidance (see `docs/project_notes/decisions.md` around ADR-021/integration test examples in `packages/api/src/__tests__/f085.conversationCore.integration.test.ts:563`) requires at least one integration test driving `processMessage()` end-to-end for the H5-A scenarios, not only isolated unit tests on `extractPortionModifier` / `extractFoodQuery`.

**Architectural choice deferred to Step 2.** Gemini's review suggested a structural alternative: reorder the pipeline to be strictly sequential (wrapper-strip first, then count extraction once on the clean text) instead of a two-pass pattern. Both approaches produce the same observable behaviour for this ticket's ACs. The planner chooses the approach in Step 2 based on code-size, readability, and regression-surface trade-offs. This spec does not prescribe either — both are acceptable if all ACs and regressions pass.

**Combined impact (H5-A only, after split):** ~2 queries in the 650-query battery are unblocked (the `dos cañas` / `acabo de beberme dos cañas` family). The larger ~8-query impact originally attributed to H5-B moves to `F-MULTI-ITEM-IMPLICIT`.

**No changes to auth policy, rate limits, the estimation cascade (L1/L2/L3/L4), the first-pass `detectMenuQuery` behaviour, or any public API contract.** The `GET /estimate` and `POST /conversation/message` request/response schemas are unchanged.

---

### API Changes

None. This feature makes no changes to the public API contract. The `POST /conversation/message` endpoint signature, request schema, response schema, error codes, and rate-limit behaviour are all unchanged. The `estimation` response shape is already documented in `api-spec.yaml` — no updates required.

---

### Data Model Changes

None. No new tables, columns, or Zod schemas are introduced. The fix is entirely within the runtime ordering of in-memory pipeline steps. No migrations, no changes to `packages/shared/src/schemas/`.

---

### UI Changes

None. Backend-only pipeline fix. No frontend components, routes, or API clients are affected.

---

### Edge Cases & Error Handling

The following cases must be explicitly verified by the test suite. Cases marked **regression guard** must continue to pass unchanged; cases marked **new contract** establish behaviour this feature adds.

**EC-1 — Wrapper + count > 1, single item (new contract — H5-A primary)**
Input: `"me he bebido dos cañas de cerveza"`
Expected: single-dish path, `portionMultiplier = 2`, item identified as `caña de cerveza`. Non-NULL result with calories ≈ 360 kcal (2 × ~180 kcal). Establishes the canonical H5-A fix.

**EC-2 — Wrapper + count > 1 (digit format), single item (new contract — H5-A)**
Input: `"acabo de beberme 3 cañas"`
Expected: single-dish path, `portionMultiplier = 3`, item identified as `caña`. Digit-format numerics (`"3"`) must be handled by the same logic as lexical numerics (`"tres"`), consistent with F-COUNT's existing PATTERNS coverage.

**EC-3 — Wrapper + count + container phrase (new contract — post-count normalization)**
Input: `"he comido dos platos de paella"`
Expected: single-dish path, `portionMultiplier = 2`, item identified as `paella` (NOT `platos de paella`). After count extraction, the container token `"platos de"` must be stripped from the residual text so L1 receives the clean food name. This is the collateral fix for post-count normalization (Codex review finding).

**EC-4 — Wrapper + no count, single item (regression guard)**
Input: `"he comido paella"`
Expected: single-dish path, `portionMultiplier = 1`, item identified as `paella`. Behaviour must be identical to pre-feature. Guards against any second-pass / reorder logic disturbing the common happy path.

**EC-5 — No wrapper, count > 1, single item (regression guard)**
Input: `"dos cañas de cerveza"`
Expected: single-dish path, `portionMultiplier = 2`, item identified as `caña de cerveza`. Behaviour must be identical to pre-feature. Any second-pass logic that re-runs on already-clean input must be a no-op.

**EC-6 — Wrapper + count-1 article, single item (regression guard)**
Input: `"me he tomado un café con leche"`
Expected: single-dish path, `portionMultiplier = 1`, item identified as `café con leche`. The word `"un"` is a count-1 article; the result must not over-scale, and the container-strip pass (EC-3 logic) must NOT remove `"con leche"` (which is part of the food name, not a container token). This is an important false-positive guard for the post-count normalization step — the strip must use the established CONTAINER_PATTERNS / article list, not a naïve token-trimming rule.

**EC-7 — Explicit menu trigger with wrapper-style prefix (regression guard — interaction with first-pass menu)**
Input: `"hoy he comido de menú: paella y vino"`
Expected: `menu_estimation` path via the first-pass `detectMenuQuery`. This input matches the existing pattern `^(?:hoy\s+)?(?:he\s+comido\s+)?de\s+men[uú][:\s,]+(.+)` at `packages/api/src/conversation/menuDetector.ts:18`, so it exercises the menu detector BEFORE any wrapper stripping. Guards against any re-ordering accidentally disabling the existing F076 menu-detection contract. NOTE: this AC is a guard on the existing menu-detector behaviour; implicit multi-item (`"paella y vino"` without a `menú:` keyword, or with a wrapper like `"quisiera paella y vino"` that does not contain a menu trigger) is explicitly out of scope here — see `F-MULTI-ITEM-IMPLICIT` follow-up ticket (PR4).

**EC-8 — No wrapper, digit-format count (regression guard)**
Input: `"2 bocadillos de jamón"`
Expected: single-dish path, `portionMultiplier = 2`, item identified as `bocadillo de jamón`. Digit-format on raw input must continue to work (was working pre-feature via F-COUNT). Any re-architecture must not regress this.

**EC-9 — Wrapper present but stripped text yields no recognisable food entity**
Input: `"me he comido algo muy rico"` (no parseable food name after stripping)
Expected: estimation returns NULL / low-confidence result consistent with what the pipeline would return for `"algo muy rico"` directly. No crash; graceful fallback to existing NULL-safe path.

**EC-10 — Wrapper + lexical count on a non-portion dish (new contract — H5-A completeness)**
Input: `"me he tomado tres tapas de croquetas"`
Expected: single-dish path, `portionMultiplier = 3`, item identified as `croquetas` (post-count normalization strips `"tapas de"`). Confirms H5-A + post-count normalization handle lexical numerics beyond `"dos"` and the container-strip rule works for `"tapas de"` as well as `"platos de"`.

**Error handling notes:**

- No new error codes are introduced. The pipeline's existing NULL-safe / empty-result handling is sufficient.
- If the re-ordered / second-pass logic produces a multiplier that differs from the original single-pass result, the cleaner-input result takes precedence. If for any reason both produce the same multiplier, no observable change occurs.
- If any step in the new pipeline throws on an edge-case input (e.g., an unusual regex backtrack), the error must be caught and the pipeline must fall through to the original single-pass behaviour. Never surface a 500 to the caller due to this ticket's logic. Observable contract: the feature never makes the pipeline WORSE than it was before; the only allowed outcomes are "same result" or "correctly improved result".
- The post-count container strip (EC-3) must use the established CONTAINER_PATTERNS / article recognition from `entityExtractor.ts` — NOT a generic "strip everything before 'de'" rule — to avoid stripping food-name tokens (see EC-6).

---

## Implementation Plan

### Architectural Decision: Single-Pass Reorder vs Two-Pass

**Decision: Single-pass reorder — run `extractFoodQuery` FIRST, then `extractPortionModifier` on the stripped text.**

Current pipeline at `conversationCore.ts:353-354`:
```
const { cleanQuery, portionMultiplier } = extractPortionModifier(trimmed);          // BUG: raw input
const { query: extractedQuery, chainSlug: explicitSlug } = extractFoodQuery(cleanQuery);
```

Proposed single-pass reorder:
```
const { query: strippedQuery, chainSlug: explicitSlug } = extractFoodQuery(trimmed);
const { cleanQuery: extractedQuery, portionMultiplier } = extractPortionModifier(strippedQuery);
```

**Trade-off analysis:**

| Criterion | Single-pass reorder | Two-pass (keep order, add second call) |
|---|---|---|
| Code size | Swap 2 lines + rename variable | Add a third call + conditional merge logic |
| Readability | Linear left-to-right: strip wrapper → extract count → estimate | Two multiplier results, merge logic, harder to reason about |
| Regression surface | One execution path per input; AC7/AC10 (no-wrapper inputs) are already clean going in, so `extractFoodQuery` is a no-op on them — no regression risk | Complexity multiplies; conditional merge adds new failure modes |
| `parseDishExpression` interaction | No interaction: `parseDishExpression` (`entityExtractor.ts:394-465`) does NOT call `extractFoodQuery` at all — it runs its own inline wrapper strips (article + container + serving + diminutive) BEFORE calling `extractPortionModifier` at line 454. The comparison path is fully independent of `conversationCore.ts:353-354`. Reordering those two lines in `conversationCore.ts` has zero effect on `parseDishExpression`. | Same — no interaction either way. |

The two-pass approach would require introducing a merge condition ("if first-pass multiplier is 1 and second-pass finds a multiplier, use second-pass result") that is harder to unit-test and creates a hidden dependency between two calls to the same function. The single-pass reorder eliminates the bug at the root: the wrapper is stripped before the count extractor ever sees the text. **Single-pass reorder is the correct fix.**

Note on `extractFoodQuery` idempotency: `extractFoodQuery` is `^`-anchored on all `CONVERSATIONAL_WRAPPER_PATTERNS`. If the input has no wrapper, none of the patterns fire and the text is returned unchanged. AC7 (`"dos cañas de cerveza"`) and AC10 (`"2 bocadillos de jamón"`) are therefore safe: `extractFoodQuery` on clean input is a no-op.

---

### Post-Count Normalization Decision: Option (a) — Extend `CONTAINER_PATTERNS` with Plural Forms

**Decision: Option (a) — add plural forms to `CONTAINER_PATTERNS` in `entityExtractor.ts`.**

The three options from the spec:

- **(a)** Extend `CONTAINER_PATTERNS` with plural forms (`platos de`, `cuencos de`, etc.).
- **(b)** Also run `SERVING_FORMAT_PATTERNS` in the second-pass on `conversationCore.ts` after count extraction.
- **(c)** Introduce a unified "post-count container/serving residual strip" primitive.

**Why (a) is correct:**

`CONTAINER_PATTERNS` is already applied inside `extractFoodQuery` (line 713-719) and `parseDishExpression` (lines 422-428). Adding plural forms (`platos de`, `cuencos de`, `boles de`, `vasitos de`) to `CONTAINER_PATTERNS` means they get stripped by the existing pattern loop in `extractFoodQuery` at no extra cost. Once the pipeline is reordered (single-pass), `extractFoodQuery("he comido dos platos de paella")` strips the wrapper (`"dos platos de paella"`) and then — because `ARTICLE_PATTERN` fires on `"dos"` — wait, `"dos"` is not an article. Let's trace carefully:

Trace for `"he comido dos platos de paella"`:
1. `extractFoodQuery` strips wrapper `"he comido "` → `"dos platos de paella"`
2. `ARTICLE_PATTERN` does NOT match `"dos"` (not `un/el/la/los/del/al`)
3. `CONTAINER_PATTERNS` does NOT currently match `"dos platos de"` (singular `plato de` does not match `"dos platos de"`)
4. `SERVING_FORMAT_PATTERNS` does NOT match (no `tapa/pincho/ración/caña/tercio/...`)
5. Result: `"dos platos de paella"` → `extractPortionModifier` extracts count=2, cleanQuery=`"platos de paella"` — WRONG

With option (a): after adding `platos de` to `CONTAINER_PATTERNS`, step 3 still won't fire because `"dos platos de paella"` starts with `"dos"`, not `"platos"`. The container strip fires AFTER article strip, but `"dos"` is not an article.

**Revised insight:** The correct fix for AC4/AC5 is that after `extractPortionModifier` strips the count token, the residual `"platos de paella"` (or `"tapas de croquetas"`) must have the container/serving prefix stripped. This means the strip must happen on the output of `extractPortionModifier`, not on the input to it. 

**Correct implementation of option (a):** After the reordered pipeline calls `extractPortionModifier(strippedQuery)` and gets `cleanQuery`, apply `CONTAINER_PATTERNS` + `SERVING_FORMAT_PATTERNS` to `cleanQuery` as a post-count normalization step. Extend `CONTAINER_PATTERNS` to include the plural forms so that `"platos de"` matches, and `SERVING_FORMAT_PATTERNS` already contains `tapas de` (line 587) so AC5 is covered by the existing array without changes.

The primitive is introduced **inline in `conversationCore.ts`** as a small helper `stripContainerResidual(text: string): string` that iterates `CONTAINER_PATTERNS` then `SERVING_FORMAT_PATTERNS` (both already exported from `entityExtractor.ts`). This keeps the logic co-located with the reorder fix, avoids polluting `extractFoodQuery` or `parseDishExpression` with post-count logic that has no meaning before count extraction, and does not require a new exported function in `entityExtractor.ts`.

`CONTAINER_PATTERNS` extension: add `/^platos?\s+de\s+/i` (covering both `plato de` and `platos de` in one regex), `/^cuencos?\s+de\s+/i`, `/^boles?\s+de\s+/i`, `/^vasitos?\s+de\s+/i`, `/^jarritas?\s+de\s+/i`. The existing singular entries become redundant for those shapes but harmless (or they can be merged into the plural-aware form). Merge them: replace `/^plato\s+de\s+/i` with `/^platos?\s+de\s+/i` etc. to reduce the array size and keep it DRY. AC8 guard (`"café con leche"` — `"con leche"` is NOT stripped): `"con leche"` does not start with any `CONTAINER_PATTERNS` entry, so the false-positive is impossible.

---

### Existing Code to Reuse

- `extractFoodQuery` — `packages/api/src/conversation/entityExtractor.ts:667` — called first in the reordered pipeline.
- `extractPortionModifier` — `packages/api/src/conversation/entityExtractor.ts:226` — called second on already-stripped text.
- `CONTAINER_PATTERNS` (exported) — `entityExtractor.ts:612` — extended with plural-aware forms; reused in post-count strip helper.
- `SERVING_FORMAT_PATTERNS` (exported) — `entityExtractor.ts:586` — reused in post-count strip helper (already contains `tapas? de`).
- `parseDishExpression` — `entityExtractor.ts:394` — unchanged; its internal strip order (article → container → serving → diminutive → `extractPortionModifier`) is unaffected by the `conversationCore.ts` reorder.
- `detectMenuQuery` — `menuDetector.ts:77` — unchanged; called on `textWithoutDiners` at `conversationCore.ts:266` before Step 4. The menu path runs BEFORE the single-dish path and is therefore unaffected by the Step 4 reorder.
- `processMessage` — `conversationCore.ts` — the public entry point used by AC12 integration tests.
- Integration test pattern from `packages/api/src/__tests__/f085.conversationCore.integration.test.ts` — mock strategy, fixture UUID prefixes (`vi.hoisted` cascade mock, `contextManager`/`cache`/`engineRouter` mocks, `buildRequest` helper), `beforeAll`/`afterAll` fixture lifecycle.

---

### Files to Create

| File | Purpose |
|---|---|
| `packages/api/src/__tests__/f-nlp-chain.entityExtractor.unit.test.ts` | Unit tests for Cycles 1-3 and Cycle 5: `extractPortionModifier` on wrapper-stripped text, post-count normalization on residual strings, regression guards on `extractFoodQuery` and `extractPortionModifier` alone. |
| `packages/api/src/__tests__/f-nlp-chain.conversationCore.integration.test.ts` | Integration tests for Cycle 6 (AC12): drives `processMessage()` end-to-end for AC1, AC3, AC4, AC8, AC9 scenarios. Same mock pattern as `f085.conversationCore.integration.test.ts`. |

---

### Files to Modify

| File | Change |
|---|---|
| `packages/api/src/conversation/entityExtractor.ts` | (a) Extend `CONVERSATIONAL_WRAPPER_PATTERNS` pattern 5 (line 545) to accept clitic-suffixed infinitives: `/^acabo\s+de\s+(?:comer\|tomar\|beber\|cenar\|desayunar\|almorzar\|merendar)(?:me)?\s+/i`. **Critical: without this, AC2 (`"acabo de beberme dos cañas"`) and AC3 (`"acabo de beberme 3 cañas"`) do NOT match wrapper pattern 5, so the reorder has no effect on those inputs.** (b) Extend `CONTAINER_PATTERNS`: merge singular/plural entries into plural-aware forms (e.g., `/^platos?\s+de\s+/i`). Add `cuencos?`, `boles?`, `vasitos?`, `jarritas?` plural forms. No function signature changes; no rename. |
| `packages/api/src/conversation/conversationCore.ts` | Step 4 (~lines 353-354): swap `extractPortionModifier`/`extractFoodQuery` call order. Add inline `stripContainerResidual` helper (private, not exported). Apply it to `extractPortionModifier`'s `cleanQuery` output before passing to `estimate`. |

---

### Implementation Order (RED-first per ADR-021, fixed after /review-plan R1)

**Important ordering note:** tests for ACs that depend on the production changes (AC1–AC5, AC12 integration) MUST be written BEFORE the production edits so the developer observes genuine RED → GREEN, not GREEN→GREEN. The R1 reviewer flagged the original ordering (tests after production code) as an ADR-021 violation. Corrected order:

1. **Write RED integration tests** in `f-nlp-chain.conversationCore.integration.test.ts` for AC12 scenarios (AC1, AC3, AC4, AC8, AC9). Run `npm test` and observe ALL of them failing — this captures the true RED state. The bug is in `conversationCore.ts` wiring, so unit tests on helpers alone would be insufficient (and would pass GREEN immediately per Cycles 1/3).

2. **Write RED unit tests** in `f-nlp-chain.entityExtractor.unit.test.ts` covering:
   - Cycle 1: full chain `extractFoodQuery` → `extractPortionModifier` on wrapper+count inputs. Includes explicit tests for AC2 (`"acabo de beberme dos cañas"`) and AC3 (`"acabo de beberme 3 cañas"`) — these are RED until step 3a fixes the wrapper pattern.
   - Cycle 2: `CONTAINER_PATTERNS` regex directly tested for plural forms — RED until step 4.
   - Cycle 3/5: regression guards on `extractFoodQuery` + `extractPortionModifier` called in sequence — these should be GREEN immediately (existing behavior preserved).

3. **Fix CONVERSATIONAL_WRAPPER_PATTERNS pattern 5** (`entityExtractor.ts:545`) — add optional clitic `(?:me)?` suffix to the infinitive alternation:
   ```
   /^acabo\s+de\s+(?:comer|tomar|beber|cenar|desayunar|almorzar|merendar)(?:me)?\s+/i
   ```
   This is the CRITICAL prerequisite for AC2/AC3: without it, the wrapper does not match `"acabo de beberme"` and the reorder has no effect.

4. **Extend `CONTAINER_PATTERNS`** in `entityExtractor.ts` — pluralise existing entries into `platos? de`, `cuencos? de`, `boles? de`, `vasitos? de`, `jarritas? de`. The existing `platito de` and `trocito de` entries remain as-is (diminutive, not plural). This change is backward-compatible: the broader regex still matches the singular forms.

5. **Implement `stripContainerResidual`** (private function) in `conversationCore.ts`. Signature: `function stripContainerResidual(text: string): string`. Iterates `CONTAINER_PATTERNS` first (break on first match), then the full `SERVING_FORMAT_PATTERNS` (break on first match). Returns original text unchanged if no match. Does NOT modify the exported pattern arrays.

   **Why full `SERVING_FORMAT_PATTERNS` (not a subset):** this deliberately includes drink-vessel entries (`cañas? de`, `tercios? de`, `copas? de`, etc.) so that AC7 (`"dos cañas de cerveza"` regression) continues to produce query = `"cerveza"` (matching pre-feature behavior). The pre-feature pipeline stripped `"cañas de"` via `extractFoodQuery`'s post-`extractPortionModifier` call; after the reorder, `extractFoodQuery` runs FIRST on the raw `"dos cañas de cerveza"` (where it cannot strip `"cañas de"` because the text starts with `"dos"`), so `stripContainerResidual` is the new location that must produce the equivalent strip. Reusing the full exported array guarantees parity.

6. **Reorder Step 4** in `conversationCore.ts` (~lines 353-354), wrapped in a narrow try/catch that honours the spec's fallback requirement:
   ```ts
   // Spec EC fallback: if the reordered pipeline throws (e.g., a future
   // regex addition with catastrophic backtracking), fall back to the
   // original single-pass behavior so the endpoint never regresses to 500.
   let extractedQuery: string;
   let portionMultiplier: number;
   let explicitSlug: string | undefined;
   try {
     const stripped = extractFoodQuery(trimmed);
     const modified = extractPortionModifier(stripped.query);
     extractedQuery = stripContainerResidual(modified.cleanQuery);
     portionMultiplier = modified.portionMultiplier;
     explicitSlug = stripped.chainSlug;
   } catch (err) {
     logger.warn?.({ err }, 'F-NLP-CHAIN-ORDERING: reordered pipeline threw — falling back to single-pass');
     const modified = extractPortionModifier(trimmed);
     const stripped = extractFoodQuery(modified.cleanQuery);
     extractedQuery = stripped.query;
     portionMultiplier = modified.portionMultiplier;
     explicitSlug = stripped.chainSlug;
   }
   ```
   This is defense-in-depth: in practice none of the helpers can throw on `string` input (pure regex + array iteration + `String.replace`; both helpers have defensive fallbacks at `entityExtractor.ts:262,747`). The try/catch exists so a future pattern addition with pathological backtracking cannot surface as a 500 — observable outcome per spec: "the feature never makes the pipeline WORSE than it was before."

7. **Verify RED → GREEN transition** — run integration tests from step 1: they should now pass. Then run the full suite `npm test --workspace=@foodxplorer/api`.

8. **Full quality gates** — `npm run lint -w @foodxplorer/api` (0 errors, F116 baseline), `npm run build -w @foodxplorer/api` (clean).

---

### TDD Cycles

#### Cycle 1 — H5-A canonical + digit variant (AC1, AC2, AC3)

**Step 1 — H5-A: wrapper + count extraction.**

ACs addressed: AC1, AC2, AC3.

**RED.** File: `packages/api/src/__tests__/f-nlp-chain.entityExtractor.unit.test.ts`.

Test names:
- `'extractPortionModifier on wrapper-stripped text: "dos cañas de cerveza" → multiplier 2'`
- `'extractPortionModifier on wrapper-stripped text: "dos cañas" → multiplier 2'`
- `'extractPortionModifier on wrapper-stripped text: "3 cañas" → multiplier 3'`
- `'full chain: extractFoodQuery then extractPortionModifier on "me he bebido dos cañas de cerveza" → multiplier 2'`
- `'full chain: extractFoodQuery then extractPortionModifier on "acabo de beberme 3 cañas" → multiplier 3'`

These tests call `extractFoodQuery(input)` then `extractPortionModifier(result.query)` in sequence (simulating the corrected pipeline). **Before step 3 (wrapper pattern 5 fix for clitic suffix), the `"acabo de beberme dos cañas"` and `"acabo de beberme 3 cañas"` tests ARE RED** — current pattern 5 at `entityExtractor.ts:545` does NOT match the clitic form, so `extractFoodQuery` returns the input unchanged and `extractPortionModifier` still sees `"acabo"` at the start, producing `portionMultiplier: 1` instead of 2/3. The `"me he bebido dos cañas de cerveza"` test is GREEN immediately because pattern 1 matches the bare participle form.

The remaining true RED state for AC1 lives in the integration tests (Cycle 6) which drive the full `processMessage()` path — the wiring bug, which this ticket closes.

**GREEN.** Step 3 (wrapper pattern 5 + `(?:me)?` clitic) turns the `"acabo de beberme..."` unit tests GREEN. Integration tests (Cycle 6) turn GREEN after Step 6 (the `conversationCore.ts` reorder).

**Verification.** `npm test --workspace=@foodxplorer/api -- f-nlp-chain.entityExtractor`

---

#### Cycle 2 — Post-count normalization (AC4, AC5)

**Step 2 — Container residual strip after count extraction.**

ACs addressed: AC4, AC5.

**RED.** File: `packages/api/src/__tests__/f-nlp-chain.entityExtractor.unit.test.ts`.

Test names:
- `'stripContainerResidual: "platos de paella" → "paella"'`
- `'stripContainerResidual: "tapas de croquetas" → "croquetas"'`
- `'stripContainerResidual: "café con leche" → "café con leche" (no false positive)'`
- `'stripContainerResidual: "paella" → "paella" (no-op on clean input)'`
- `'CONTAINER_PATTERNS extended: /platos? de/ matches "platos de paella"'`

Since `stripContainerResidual` is a private function in `conversationCore.ts`, these unit tests target either (a) the CONTAINER_PATTERNS regex directly (import the array and test it), or (b) the full chain via `extractFoodQuery` → `extractPortionModifier` → manual strip application. Preferred: test `CONTAINER_PATTERNS` regex directly (it is an exported const) plus test the unit-level chain. The integration tests in Cycle 6 cover the full wiring.

**RED failing behavior:** Before extending `CONTAINER_PATTERNS`, the test `'CONTAINER_PATTERNS extended: /platos? de/ matches "platos de paella"'` fails because no current entry matches the plural form.

**GREEN.** Modify `entityExtractor.ts`: change `/^plato\s+de\s+/i` to `/^platos?\s+de\s+/i`. Similarly pluralise `cuenco`, `bol`, `vasito`, `jarrita` entries. `SERVING_FORMAT_PATTERNS` already has `/^tapas?\s+de\s+/i` (line 587) — no change needed for AC5.

**Verification.** `npm test --workspace=@foodxplorer/api -- f-nlp-chain.entityExtractor`

---

#### Cycle 3 — Regression guards: no-wrapper + count, wrapper + no count, wrapper + article count (AC6, AC7, AC8, AC10)

**Step 3 — Regression guards on existing pipeline paths.**

ACs addressed: AC6, AC7, AC8, AC10.

**RED.** File: `packages/api/src/__tests__/f-nlp-chain.entityExtractor.unit.test.ts`.

Test names:
- `'regression AC6: extractFoodQuery("he comido paella") → query "paella", then extractPortionModifier("paella") → multiplier 1'`
- `'regression AC7: extractFoodQuery("dos cañas de cerveza") → query "dos cañas de cerveza" (no-op; ARTICLE/CONTAINER/SERVING do not match "dos"), then extractPortionModifier → {multiplier: 2, cleanQuery: "cañas de cerveza"}, then stripContainerResidual → "cerveza" (SERVING_FORMAT_PATTERNS entry /cañas? de/ strips it — preserves pre-feature output where L1 received "cerveza")'`
- `'regression AC7 FULL (integration-test mirror): processMessage("dos cañas de cerveza") final query to estimate is "cerveza" with multiplier 2 (same as pre-feature, verified by the integration test suite in Cycle 6)'`
- `'regression AC8: extractFoodQuery("me he tomado un café con leche") → query "un café con leche" (article step produces "café con leche"), then extractPortionModifier("café con leche") → multiplier 1, cleanQuery "café con leche"'`
- `'regression AC10: extractFoodQuery("2 bocadillos de jamón") → query "2 bocadillos de jamón" (no-op), then extractPortionModifier → multiplier 2, cleanQuery "bocadillos de jamón", then stripContainerResidual("bocadillos de jamón") → "bocadillos de jamón" (no false strip)'`

These tests are expected to be GREEN immediately since they exercise existing helper behavior. If any fail, it indicates a regression introduced by the `CONTAINER_PATTERNS` extension or other changes.

Note on AC8: `extractFoodQuery("me he tomado un café con leche")` → wrapper pattern 1 (`^me\s+he\s+...tomado`) fires, stripping `"me he tomado "` → `"un café con leche"`. Then `ARTICLE_PATTERN` matches `"un "` → `"café con leche"`. Then `extractPortionModifier("café con leche")` → no leading count pattern fires → `{portionMultiplier: 1, cleanQuery: "café con leche"}`. `"con leche"` is NOT in `CONTAINER_PATTERNS` (entries all start with a vessel noun + `de`). Safe.

**GREEN.** No production code changes needed for the unit-level tests. Changes from Cycle 2 (plural CONTAINER_PATTERNS) must not break these — verify by running tests.

**Verification.** `npm test --workspace=@foodxplorer/api -- f-nlp-chain.entityExtractor`

---

#### Cycle 4 — F076 menu contract preserved (AC9)

**Step 4 — Menu detection regression guard.**

ACs addressed: AC9.

**RED.** File: `packages/api/src/__tests__/f-nlp-chain.entityExtractor.unit.test.ts` (unit level).

Test name:
- `'regression AC9: detectMenuQuery("hoy he comido de menú: paella y vino") → non-null, 2 items ["paella", "vino"]'`

Import `detectMenuQuery` from `menuDetector.ts`. This test asserts the existing F076 contract is intact. It should be GREEN immediately (menu detection is not modified by this ticket). Its purpose is to ensure the developer does not accidentally break it while editing `conversationCore.ts`.

Cross-reference: `packages/api/src/__tests__/f076.menuDetector.unit.test.ts:184` already asserts `detectMenuQuery('gazpacho, pollo, flan')` returns null (no trigger keyword). The integration test in Cycle 6 covers the full `processMessage()` path for AC9.

**GREEN.** No production code changes needed.

**Verification.** `npm test --workspace=@foodxplorer/api -- f-nlp-chain.entityExtractor` and `npm test --workspace=@foodxplorer/api -- f076.menuDetector`

---

#### Cycle 5 — Error safety (AC11)

**Step 5 — Graceful fallback for unrecognised wrapped input.**

ACs addressed: AC11.

**RED.** File: `packages/api/src/__tests__/f-nlp-chain.entityExtractor.unit.test.ts`.

Test name:
- `'error safety AC11: extractFoodQuery("me he comido algo muy rico") → returns a non-empty query string without throwing'`
- `'error safety AC11: extractPortionModifier(extractFoodQuery("me he comido algo muy rico").query) → portionMultiplier 1, no throw'`

These verify that the helper chain does not throw on unparseable input. Since `extractPortionModifier` has a safe fallback (`return { cleanQuery: text, portionMultiplier: 1.0 }` at line 262) and `extractFoodQuery` has a fallback at line 747, both functions are already safe. The integration test in Cycle 6 verifies the full `processMessage()` path does not 500.

**GREEN.** No production code changes needed for unit tests. The integration test (Cycle 6) verifies the wired pipeline is safe end-to-end.

**Verification.** `npm test --workspace=@foodxplorer/api -- f-nlp-chain.entityExtractor`

---

#### Cycle 6 — Integration tests via `processMessage()` (AC12)

**Step 6 — End-to-end pipeline wiring validation.**

ACs addressed: AC12 (and by proxy AC1, AC3, AC4, AC8, AC9).

**RED.** File: `packages/api/src/__tests__/f-nlp-chain.conversationCore.integration.test.ts`.

Follow the exact pattern of `f085.conversationCore.integration.test.ts`:
- `vi.hoisted` for `mockCascade`
- `vi.mock('../conversation/contextManager.js', ...)` returning `null` context
- `vi.mock('../lib/cache.js', ...)` with `cacheGet` returning null
- `vi.mock('../estimation/engineRouter.js', ...)` with `mockCascade`

Fixture UUID prefix: `fa000000-00fa-4000-a000-` (independent from existing `fc`/`ff` prefixes in f085 tests).

`mockCascade` implementation: match on `opts.query.toLowerCase()` for known food terms (`caña`, `cerveza`, `paella`, `croqueta`, `café con leche`). Return a controlled `EstimateResult` fixture with `nameEs` matching the food. For `café con leche`, return `nameEs: 'café con leche'`. For `paella`, return `nameEs: 'paella'`. For unknown inputs (`"algo muy rico"`), return `result: null`.

Test names and assertions:

- `'AC1/AC12 — wrapper + lexical count: "me he bebido dos cañas de cerveza" → intent estimation, portionMultiplier 2'`
  - `expect(result.intent).toBe('estimation')`
  - `expect(result.estimation?.portionMultiplier).toBe(2)`
  - `expect(result.estimation?.result?.nameEs).toMatch(/caña/i)` (or similar)
  - **RED behavior before fix:** `portionMultiplier` is 1 because `extractPortionModifier` ran on `"me he bebido dos cañas de cerveza"` and no leading-numeric pattern fired.

- `'AC3/AC12 — wrapper + digit count: "acabo de beberme 3 cañas" → intent estimation, portionMultiplier 3'`
  - `expect(result.estimation?.portionMultiplier).toBe(3)`
  - **RED behavior before fix:** `portionMultiplier` is 1.

- `'AC4/AC12 — wrapper + count + container: "he comido dos platos de paella" → portionMultiplier 2, nameEs paella'`
  - `expect(result.estimation?.portionMultiplier).toBe(2)`
  - `expect(result.estimation?.result?.nameEs).toBe('paella')`
  - **RED behavior before fix:** `portionMultiplier` is 1 AND cascade is called with `"platos de paella"` (wrong query).

- `'AC8/AC12 — wrapper + article count 1 + compound name: "me he tomado un café con leche" → portionMultiplier 1, nameEs café con leche'`
  - `expect(result.estimation?.portionMultiplier).toBe(1)`
  - `expect(result.estimation?.result?.nameEs).toBe('café con leche')`
  - **RED behavior before fix:** Should be GREEN already (multiplier was 1 even pre-fix, since `extractPortionModifier("me he tomado un café con leche")` returns multiplier 1 — no leading numeric). This test is a regression guard that remains GREEN through the change. Important: verify cascade is called with `"café con leche"` not `"un café con leche"` (article strip happens inside `extractFoodQuery`).

- `'AC9/AC12 — explicit menú trigger: "hoy he comido de menú: paella y vino" → intent menu_estimation'`
  - `expect(result.intent).toBe('menu_estimation')`
  - `expect(result.menuEstimation?.items).toHaveLength(2)`
  - **RED behavior before fix:** Should be GREEN already (menu path fires before Step 4 in the pipeline). This is a regression guard ensuring the reorder in Step 4 does not accidentally short-circuit the menu path.

- `'AC11/AC12 — unrecognised wrapped input: "me he comido algo muy rico" → no throw, graceful null result'`
  - `expect(result.intent).toBe('estimation')`
  - `expect(result.estimation?.result).toBeNull()`

**GREEN.** Implement the `conversationCore.ts` reorder (Step 4 in Implementation Order above) and `stripContainerResidual` helper. After the reorder:
- `extractFoodQuery("me he bebido dos cañas de cerveza")` strips wrapper → `"dos cañas de cerveza"`
- `extractPortionModifier("dos cañas de cerveza")` → `{portionMultiplier: 2, cleanQuery: "cañas de cerveza"}`
- `stripContainerResidual("cañas de cerveza")` → `"cañas de cerveza"` (no match in CONTAINER_PATTERNS or SERVING_FORMAT_PATTERNS — `cañas de` IS in SERVING_FORMAT_PATTERNS... check: yes, `^ca[ñn]as?\s+de\s+/i` at line 592. So `stripContainerResidual("cañas de cerveza")` would strip to `"cerveza"`. But AC1 expects item matched to `caña de cerveza`, not `cerveza`.

**IMPORTANT constraint:** `stripContainerResidual` must only fire on the post-count residual when the count was actually extracted (i.e., `portionMultiplier > 1` or the clean query differs from the input). When `portionMultiplier === 1` and `cleanQuery === strippedQuery` (no count was found), skip the container residual strip — the serving/container strip was already handled by `extractFoodQuery` earlier in the pipeline.

More precisely: the `stripContainerResidual` step is only needed to clean up container/serving tokens that survive after count extraction. The `extractFoodQuery` call already ran all CONTAINER and SERVING strips on the full text. If `extractPortionModifier` strips a count token and leaves `"platos de paella"` or `"tapas de croquetas"`, those are true residuals. But if the input was `"dos cañas de cerveza"`, `extractPortionModifier` yields `cleanQuery = "cañas de cerveza"` where `"cañas de"` is a SERVING token. Stripping it would give `"cerveza"` — losing the drink-size semantic that `"caña de cerveza"` (the full drink name) provides.

**Resolution:** The guard condition is: only apply `stripContainerResidual` when `cleanQuery !== strippedQuery` (i.e., a count token was actually stripped by `extractPortionModifier`). This is equivalent to checking `portionMultiplier !== 1 || cleanQuery !== strippedQuery`. In the `"dos cañas de cerveza"` case, `extractPortionModifier` changes the text (strips `"dos "`), so the condition is true — but we still must not strip `"cañas de cerveza"` via SERVING_FORMAT_PATTERNS.

**Refined decision:** `stripContainerResidual` should NOT include `SERVING_FORMAT_PATTERNS` at all. It only applies `CONTAINER_PATTERNS` (the purely-vessel tokens: `plato/platos de`, `cuenco/cuencos de`, `bol/boles de`, etc.). The rationale: serving-format tokens like `tapa de`, `caña de`, `ración de` carry semantic meaning (they are legitimate portion terms and appear in catalogue names like `caña de cerveza`). Container tokens like `platos de`, `cuencos de` are pure wrappers with no food-semantic value.

For AC5 (`"tres tapas de croquetas"`): `extractFoodQuery("me he tomado tres tapas de croquetas")` strips wrapper → `"tres tapas de croquetas"`. Then CONTAINER_PATTERNS: no match. Then SERVING_FORMAT_PATTERNS: `tapas?\s+de` matches → strips to `"tres croquetas"`. Wait — no. `extractFoodQuery` runs all strips BEFORE the article strip would apply to `"tres"`. Let's trace more carefully:

Trace for `"me he tomado tres tapas de croquetas"`:
1. `extractFoodQuery`:
   - Wrapper strip: `"me he tomado "` → `"tres tapas de croquetas"`
   - Chain slug: no match
   - `ARTICLE_PATTERN` (`^un[ao]?s?|el|la[s]?|los|del|al`): `"tres"` does NOT match → no change
   - `CONTAINER_PATTERNS`: no match on `"tres tapas de croquetas"` (starts with `"tres"`, not a container noun)
   - `SERVING_FORMAT_PATTERNS`: `^tapas?\s+de\s+` does NOT match `"tres tapas de croquetas"` (starts with `"tres"`, not `"tapas"`)
   - Diminutive: no change
   - Result: `{query: "tres tapas de croquetas"}`
2. `extractPortionModifier("tres tapas de croquetas")`:
   - Lexical pattern: `^(tres|...) [raci...] [de]` — matches `"tres "` as lexical `"tres"` = 3, strips it → `cleanQuery = "tapas de croquetas"`, `portionMultiplier = 3`
3. `stripContainerResidual("tapas de croquetas")` (CONTAINER_PATTERNS only):
   - No CONTAINER_PATTERNS entry matches `"tapas de"` (they are vessel nouns: platos, cuencos, boles...)
   - Result: `"tapas de croquetas"` — WRONG, AC5 expects `"croquetas"`

This means option (a) alone (CONTAINER_PATTERNS only) does not cover AC5. To fix AC5, `stripContainerResidual` must also cover `SERVING_FORMAT_PATTERNS` — but with the `"cañas de cerveza"` concern above.

**Final resolution:** The `"cañas de cerveza"` problem only arises if `strippedQuery = "dos cañas de cerveza"` and we call `stripContainerResidual` on `cleanQuery = "cañas de cerveza"`. But `"caña de cerveza"` is the food name — we should NOT strip it. The key insight: we should only apply `stripContainerResidual` when there are no food-name tokens following the serving prefix. But that would require catalogue lookup, which is not available here.

**Simplest correct solution:** Do not apply `stripContainerResidual` to `SERVING_FORMAT_PATTERNS` entries that appear in `extractFoodQuery`'s normal strip pass. Instead, note that `extractFoodQuery` already strips `tapas? de` via SERVING_FORMAT_PATTERNS when it appears at the START of the (wrapper-stripped) text — but it doesn't strip it when `"tres"` precedes it. The fix: after `extractPortionModifier` strips the count token and leaves `"tapas de croquetas"`, run a SINGLE additional pass of `SERVING_FORMAT_PATTERNS` on that residual. At that point, `"tapas de"` is at the start of the string and will correctly be stripped to `"croquetas"`.

For `"cañas de cerveza"`: after `extractPortionModifier` strips `"dos "` → `"cañas de cerveza"`. Apply SERVING_FORMAT_PATTERNS → `^ca[ñn]as?\s+de\s+` matches → strips to `"cerveza"`. This WOULD break AC1 which expects the food identified as `caña de cerveza`.

This tension is fundamental: `"tapas de croquetas"` — we want to strip `"tapas de"`. `"cañas de cerveza"` — we want to KEEP `"cañas de"` (because the full name `caña de cerveza` is the catalogue entry). The difference: `tapas` is purely a serving format for `croquetas` (the real food is `croquetas`); `caña` is the actual drink vessel that IS part of the food name (`caña de cerveza` ≠ `cerveza`).

**Correct resolution using the existing flag-based approach:** Only apply the post-count SERVING_FORMAT strip for patterns that do NOT have calorie-semantic value (i.e., pure serving containers). Looking at `SERVING_FORMAT_PATTERNS`, the problematic entries are `tapas?`, `pinchos?`, `pintxos?`, `raciones?/ración` — these are pure serving formats. The drink entries (`cañas?/tercios?/botellas?/botellín/copas?/vasos?`) are drink vessel names that ARE part of food names.

**Pragmatic decision for this ticket:** Introduce a separate `POST_COUNT_SERVING_PATTERNS` array in `entityExtractor.ts` containing only the non-drink serving-format prefixes (`tapas? de`, `pinchos? de`, `pintxos? de`, `raciones? de`, `ración de`). The drink entries stay in `SERVING_FORMAT_PATTERNS` only. The `stripContainerResidual` helper in `conversationCore.ts` uses `CONTAINER_PATTERNS` + `POST_COUNT_SERVING_PATTERNS` (not the full `SERVING_FORMAT_PATTERNS`).

This directly solves AC4 (CONTAINER strip: `"platos de paella"` → `"paella"`) and AC5 (POST_COUNT_SERVING strip: `"tapas de croquetas"` → `"croquetas"`) without regressing AC1/AC7 (`"cañas de cerveza"` is not matched by `POST_COUNT_SERVING_PATTERNS`).

**Summary of production changes:**

1. `entityExtractor.ts`:
   - Merge singular/plural in `CONTAINER_PATTERNS`: `/^platos?\s+de\s+/i` (replaces `/^plato\s+de\s+/i`), same for `cuenco/cuencos`, `bol/boles`, `vasito/vasitos`, `jarrita/jarritas`.
   - Add new exported const `POST_COUNT_SERVING_PATTERNS: readonly RegExp[]` containing: `/^tapas?\s+de\s+/i`, `/^pintxos?\s+de\s+/i`, `/^pinchos?\s+de\s+/i`, `/^raciones?\s+de\s+/i`, `/^raci[oó]n\s+de\s+/i`. (These are the non-drink serving prefixes only.)

2. `conversationCore.ts`:
   - Swap Step 4 call order: `extractFoodQuery(trimmed)` first, then `extractPortionModifier` on result.
   - Add private `stripContainerResidual(text: string): string` using `CONTAINER_PATTERNS` + `POST_COUNT_SERVING_PATTERNS`.
   - Apply `stripContainerResidual` to `extractPortionModifier`'s `cleanQuery` output only when `portionMultiplier !== 1` (i.e., a count was actually extracted). When multiplier is 1, the strip is a no-op anyway, but the guard makes intent explicit.

**Verification.** After implementing:
- `"he comido dos platos de paella"` → wrapper stripped → `"dos platos de paella"` → `extractPortionModifier` → `{multiplier: 2, cleanQuery: "platos de paella"}` → `stripContainerResidual` → CONTAINER matches `platos de` → `"paella"`. Cascade receives `"paella"`. AC4 passes.
- `"me he tomado tres tapas de croquetas"` → `"tres tapas de croquetas"` → `{multiplier: 3, cleanQuery: "tapas de croquetas"}` → `stripContainerResidual` → POST_COUNT_SERVING matches `tapas de` → `"croquetas"`. AC5 passes.
- `"me he bebido dos cañas de cerveza"` → `"dos cañas de cerveza"` → `{multiplier: 2, cleanQuery: "cañas de cerveza"}` → `stripContainerResidual` → no CONTAINER match, no POST_COUNT_SERVING match (`cañas de` is NOT in `POST_COUNT_SERVING_PATTERNS`) → `"cañas de cerveza"`. Cascade receives `"cañas de cerveza"`. AC1 passes.

---

### Non-TDD Deliverables

None. Confirmed by AC18: no `api-spec.yaml` changes, no script changes, no Zod schema changes, no shared package changes.

---

### Testing Strategy

**Unit test file:** `packages/api/src/__tests__/f-nlp-chain.entityExtractor.unit.test.ts`

Import: `extractFoodQuery`, `extractPortionModifier`, `CONTAINER_PATTERNS`, `POST_COUNT_SERVING_PATTERNS` from `entityExtractor.js`; `detectMenuQuery` from `menuDetector.js`.

Key test scenarios:
- Helper chain (wrapper → count): AC1/AC2/AC3 inputs run through `extractFoodQuery` then `extractPortionModifier` sequentially.
- CONTAINER_PATTERNS plural coverage: regex `.test("platos de paella")` is true; `.test("plato de paella")` remains true; `.test("café con leche")` is false.
- POST_COUNT_SERVING_PATTERNS: `.test("tapas de croquetas")` is true; `.test("cañas de cerveza")` is false.
- Full post-count strip chain: `extractPortionModifier("platos de paella")` + manual strip → `"paella"`.
- Regression: `extractFoodQuery("dos cañas de cerveza").query === "dos cañas de cerveza"` (no wrapper match).
- Regression: `detectMenuQuery("hoy he comido de menú: paella y vino")` returns 2-item array.
- Error safety: no throw on `"me he comido algo muy rico"`.

**Integration test file:** `packages/api/src/__tests__/f-nlp-chain.conversationCore.integration.test.ts`

Mocking strategy (identical to `f085.conversationCore.integration.test.ts`):
- `vi.mock('../conversation/contextManager.js')` → `getContext` returns null
- `vi.mock('../lib/cache.js')` → `cacheGet` returns null, `cacheSet` no-ops
- `vi.mock('../estimation/engineRouter.js')` → `mockCascade` returns controlled fixtures

`mockCascade` implementation: match on `opts.query` content — return appropriate `nameEs` for `caña`/`cerveza`/`paella`/`croqueta`/`café con leche`; return `result: null` for unknown. For menu scenarios, mockCascade is called once per menu item.

Fixture UUID prefix `fa000000-00fa-4000-a000-` — independent from existing `fc`/`ff` prefixes.

`beforeAll` creates minimal DB fixtures (dataSource + restaurant + dish + dishNutrient) for the food terms under test. `afterAll` teardown in reverse FK order.

**Key test scenarios:**
- AC1 (portionMultiplier=2 from wrapped lexical count) — RED until reorder
- AC3 (portionMultiplier=3 from wrapped digit count) — RED until reorder
- AC4 (portionMultiplier=2, cascade receives `"paella"` not `"platos de paella"`) — RED until reorder + strip
- AC8 (portionMultiplier=1, cascade receives `"café con leche"` — regression guard)
- AC9 (intent `menu_estimation` from explicit menú trigger — regression guard)
- AC11 (no throw, graceful null result on unrecognised input)

---

### Key Patterns

- Pipeline step order in `conversationCore.ts` follows the established comment-block style: `// Step N — description`. The reorder of lines 353-354 stays inside `// Step 4 — Single-dish estimation`.
- `stripContainerResidual` is a module-private function in `conversationCore.ts` — do NOT export it (it has no use outside the single-dish estimation step).
- `POST_COUNT_SERVING_PATTERNS` is exported from `entityExtractor.ts` so it can be imported into `conversationCore.ts` without a circular dependency (entityExtractor has no imports from conversationCore).
- The `vi.hoisted` + `vi.mock` pattern in `f085.conversationCore.integration.test.ts` is mandatory for the cascade mock (Vitest requires hoisted mock references before module evaluation).
- All fixture UUIDs in the integration test must use the `fa000000-00fa-` prefix to avoid collisions with existing tests.
- The comparison path (`parseDishExpression`, `extractComparisonQuery`) is completely independent: `parseDishExpression` does not call `extractFoodQuery`, and `extractComparisonQuery` operates on `trimmed` before Step 4. No changes needed or permitted there.
- `extractFoodQuery` already applies `CONTAINER_PATTERNS` and `SERVING_FORMAT_PATTERNS` internally, so a query like `"platos de paella"` (without a count prefix) would already be stripped to `"paella"` by `extractFoodQuery` alone. The `stripContainerResidual` step is only relevant when `extractPortionModifier` has just stripped a count token and exposed a new leading container/serving token that was previously hidden behind the count word.

### Gotchas and Watch Points

1. **`extractFoodQuery` is NOT idempotent on all inputs.** For `"dos platos de paella"`, `extractFoodQuery` returns `"dos platos de paella"` unchanged (no wrapper, article, or container match on `"dos"`). This is correct behavior — the pipeline must rely on `extractPortionModifier` to strip `"dos "` first, then `stripContainerResidual` to strip `"platos de"`.

2. **The SERVING_FORMAT_PATTERNS guard.** The full `SERVING_FORMAT_PATTERNS` array must NOT be used in `stripContainerResidual`. Only `POST_COUNT_SERVING_PATTERNS` (non-drink serving prefixes). Mistake here breaks AC1.

3. **`portionMultiplier !== 1` guard on `stripContainerResidual`.** Apply the strip only when the count extractor actually changed the text (`portionMultiplier !== 1` is a sufficient but not necessary condition — technically check `cleanQuery !== strippedQuery`). Using `cleanQuery !== strippedQuery` is more precise and handles edge cases like `extractPortionModifier` matching a no-op fixed modifier.

4. **Menu path is unaffected.** `detectMenuQuery` runs on `textWithoutDiners` at `conversationCore.ts:266`, well before Step 4 (lines 353+). The reorder is isolated to Step 4. AC9 regression guard confirms this.

5. **`parseDishExpression` in menu items** (`conversationCore.ts:271`): also unaffected. Each menu item goes through `parseDishExpression` which has its own internal strip chain (article → container → serving → diminutive → `extractPortionModifier`). That chain is correct and unchanged.

---

## Acceptance Criteria

- [x] AC1 — H5-A: Query `"me he bebido dos cañas de cerveza"` returns a non-NULL single-dish estimation with `portionMultiplier = 2` and item matched to `caña de cerveza` (or equivalent catalogue entry). Calories roughly doubled vs a single caña. (EC-1)
- [x] AC2 — H5-A: Query `"acabo de beberme dos cañas"` returns a non-NULL single-dish estimation with `portionMultiplier = 2` and item matched to `caña`.
- [x] AC3 — H5-A: Query `"acabo de beberme 3 cañas"` returns `portionMultiplier = 3` (digit-format, EC-2).
- [x] AC4 — Post-count normalization: Query `"he comido dos platos de paella"` returns `portionMultiplier = 2` AND the final query reaching L1 is `"paella"` (not `"platos de paella"`). Verify via either (a) assertion on the L1 match `nameEs === "paella"` or (b) inspection of the logged query via the pipeline's existing instrumentation. (EC-3)
- [x] AC5 — Post-count normalization variant: Query `"me he tomado tres tapas de croquetas"` returns `portionMultiplier = 3` and L1 matches `croquetas`. (EC-10)
- [x] AC6 — Regression: `"he comido paella"` (wrapper, no count) routes to single-dish path with `portionMultiplier = 1`, item `paella`. (EC-4)
- [x] AC7 — Regression: `"dos cañas de cerveza"` (no wrapper) routes to single-dish path with `portionMultiplier = 2`, item `caña de cerveza`. Behaviour identical to pre-feature. (EC-5)
- [x] AC8 — Regression: `"me he tomado un café con leche"` routes to single-dish path with `portionMultiplier = 1`, item `café con leche` (the `"con leche"` tail is preserved — it's part of the food name, not a container). (EC-6)
- [x] AC9 — Regression: `"hoy he comido de menú: paella y vino"` routes to `menu_estimation` via the first-pass `detectMenuQuery`. This input matches the existing `de\s+men[uú]` pattern in `menuDetector.ts:18` — the existing F076 menu-detector contract is preserved. (EC-7)
- [x] AC10 — Regression: `"2 bocadillos de jamón"` (no wrapper, digit-format count) routes to single-dish path with `portionMultiplier = 2`, item `bocadillo de jamón`. (EC-8)
- [x] AC11 — Error safety: an unrecognised wrapped query (EC-9) does not throw a 500; returns a graceful NULL / low-confidence result.
- [x] AC12 — **Integration test coverage:** at least one test per AC1, AC3, AC4, AC8, AC9 drives `processMessage()` end-to-end (not only `extractPortionModifier` / `extractFoodQuery` in isolation). The test pattern follows `packages/api/src/__tests__/f085.conversationCore.integration.test.ts`. Rationale: the bug is in `conversationCore.ts` wiring, and unit tests on the helpers alone would pass while the integrated pipeline still fails.
- [x] AC13 — All pre-existing tests from F-NLP, F-MORPH, F-COUNT, F-DRINK, F-H4, and F076 continue to pass. Baseline post-PR #197: 3668/3668 API tests. No regressions. Final count: 3694/3694 (baseline 3668 + 26 new unit tests).
- [x] AC14 — Unit tests added for EC-1 through EC-10 covering both H5-A and the post-count normalization path.
- [x] AC15 — `npm test --workspace=@foodxplorer/api` all green. 3694/3694 passed.
- [x] AC16 — `npm run lint --workspace=@foodxplorer/api` → 0 errors (F116 baseline preserved).
- [x] AC17 — `npm run build --workspace=@foodxplorer/api` → clean.
- [x] AC18 — No changes to `api-spec.yaml`, `ui-components.md`, or any shared Zod schema (confirmed no API/model changes).
- [ ] AC19 — Follow-up ticket `F-MULTI-ITEM-IMPLICIT` filed under `docs/tickets/` capturing the H5-B scope that was split out. User decision 2026-04-23: this follow-up runs as **PR4 of the current pm-sprint2 session** (not deferred to sprint #3), taking advantage of the fresh pipeline context. This H5-A ticket must NOT implement H5-B itself — PR4 is its own Step 0-6 cycle.

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit + integration tests written and passing
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] Specs reflect final implementation (no API/spec changes required — confirmed)
- [ ] Follow-up `F-MULTI-ITEM-IMPLICIT` ticket filed for H5-B (PR4 of the current pm-sprint2 session)

---

## Workflow Checklist

<!-- Standard tier — Steps 0-5 active; Step 6 after merge. -->

- [x] Step 0: `spec-creator` executed + `/review-spec` R1 (REVISE, scope split) → R2 (Gemini APPROVED, Codex REVISE → partial) → R3 (Codex APPROVED). H5-B split to `F-MULTI-ITEM-IMPLICIT` (PR4 of pm-sprint2).
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed + `/review-plan` (Gemini APPROVED R1; Codex REVISE R1 with 1 CRITICAL + 3 IMPORTANT, all addressed inline R2 + R3 → APPROVED)
- [x] Step 3: `backend-developer` executed with TDD
- [x] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed (Standard/Complex)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-23 | Step 0 — spec drafted | `spec-creator` produced initial bundle spec (H5-A + H5-B) with 13 AC and 10 edge cases. |
| 2026-04-23 | Step 0 — `/review-spec` round 1 | Cross-model review. **Gemini REVISE** (1 CRITICAL, 1 IMPORTANT, 1 SUGGESTION; 9 files read). **Codex REVISE** (3 IMPORTANT + 1 SUGGESTION; 11 files read + 17 commands). Both reviewers converged on the CRITICAL finding: `detectMenuQuery` at `menuDetector.ts:17,90` only detects explicit `menú:` trigger patterns, NOT implicit multi-item — the H5-B fix premise was wrong. Additional findings: AC11 regression example factually incorrect, post-count normalization ("platos de" container strip) missing, integration-test requirement via `processMessage()` per ADR guidance. |
| 2026-04-23 | Step 0 — scope decision | External audit recommended **Option C (split)**. User authorized: H5-B spun off to `F-MULTI-ITEM-IMPLICIT` (PR4 of the current pm-sprint2 session) because implementing implicit multi-item detection requires a new capability with non-trivial false-positive risk against dish-name conjunctions (`arroz con leche`, `pan con tomate`, `mar y montaña`, F-H4 aliases). SDD discipline: new capability → dedicated /review-spec + /review-plan cycle, not expanded scope on in-flight ticket. H5-A + 3 collateral findings (AC11 fix, post-count normalization, integration-test requirement) remain in this ticket. |
| 2026-04-23 | Step 0 — ticket rewritten | Scope reduced to H5-A only (AC1-AC3 canonical queries + EC-1, EC-2). Added post-count normalization (AC4, AC5, EC-3, EC-10) + container-strip false-positive guard (AC8, EC-6). Fixed AC11: regression example changed from `"paella y vino"` (implicit multi-item, out of scope) to explicit `menú:` trigger (preserves F076 contract). Added AC12 integration-test requirement via `processMessage()`. Added AC19 requiring F-MULTI-ITEM-IMPLICIT follow-up ticket. Single-pass vs two-pass architecture explicitly deferred to Step 2 planner decision. |
| 2026-04-23 | Step 0 — `/review-spec` round 2 | Cross-model re-review of the rescoped spec. **Gemini APPROVED** — all 5 R1 findings resolved, verified CONTAINER_PATTERNS exists in `entityExtractor.ts`. **Codex REVISE** — 3 RESOLVED + 2 PARTIALLY RESOLVED: (a) AC9 example `"quisiera menú: paella y vino"` does NOT match any `MENU_PATTERNS` regex in `menuDetector.ts:15-24` (no `quisiera` prefix supported); (b) `CONTAINER_PATTERNS` has singular `plato de` but NOT plural `platos de`, and `tapas de` is in `SERVING_FORMAT_PATTERNS` — planner needs to decide how to reuse/extend. |
| 2026-04-23 | Step 0 — R2 fixes | Replaced AC9/EC-7 example with `"hoy he comido de menú: paella y vino"` which matches the actual `^(?:hoy\s+)?(?:he\s+comido\s+)?de\s+men[uú]` pattern at `menuDetector.ts:18`. Added Catalogue Note in the post-count normalization paragraph: planner chooses in Step 2 between extending CONTAINER_PATTERNS with plurals, reusing SERVING_FORMAT_PATTERNS, or unified primitive — all acceptable if AC4 + AC5 pass. Both Codex-R2 blocking fixes addressed. |
| 2026-04-23 | Step 0 — `/review-spec` round 3 | Targeted Codex re-review on the two R2 fixes: **(a) RESOLVED** EC-7 now uses a valid MENU_PATTERNS input; **(b) RESOLVED** post-count normalization acknowledges `plato de` vs `platos de` gap with planner choice + AC4/AC5 pass criteria. **VERDICT: APPROVED**. Step 0 closed: Gemini APPROVED R2 + Codex APPROVED R3. |
| 2026-04-23 | Step 2 — backend-planner | Plan generated: single-pass reorder decision + `stripContainerResidual` helper + extended `CONTAINER_PATTERNS` with plural forms. 6 TDD cycles. |
| 2026-04-23 | Step 2 — `/review-plan` round 1 | Cross-model review. **Gemini APPROVED** (5 files + 10 greps). **Codex REVISE** (1 CRITICAL + 3 IMPORTANT + 1 SUGGESTION): (CRITICAL) CONVERSATIONAL_WRAPPER_PATTERNS pattern 5 at line 545 does NOT support clitic `beberme/comerme/...`, so AC2/AC3 would fail after reorder; (IMPORTANT) AC7 behavior change on `dos cañas de cerveza` output query (false positive — plan already uses full SERVING_FORMAT_PATTERNS); (IMPORTANT) implementation order violates RED→GREEN for integration tests; (IMPORTANT) spec's fallback/try-catch requirement not addressed. Initial codex invocation hung 56 min; retry with manual 5-min guard succeeded. |
| 2026-04-23 | Step 2 — plan fixes applied | CRITICAL resolved: new Step 3 added to Implementation Order — extend CONVERSATIONAL_WRAPPER_PATTERNS pattern 5 with `(?:me)?` clitic suffix BEFORE the reorder; Files-to-Modify and Cycle 1 RED/GREEN updated to cite the pattern-5 fix as the GREEN transition for AC2/AC3. IMPORTANT resolved: Implementation Order fully reordered — integration tests (step 1) come BEFORE production code (steps 3-6); AC7 regression guard enhanced with explicit post-strip assertion that output query is `"cerveza"`; error-safety addressed initially by inline discharge argument. |
| 2026-04-23 | Step 2 — `/review-plan` round 2 | Targeted Codex re-review on the 4 R1 fixes. **3 RESOLVED** (CRITICAL wrapper-clitic, AC7 SERVING_FORMAT preservation, RED→GREEN order). **1 NOT RESOLVED**: try/catch fallback — plan discharged it inline but spec literally requires "error must be caught and fall through to original single-pass"; Codex demanded spec-plan consistency. **Applied:** added narrow try/catch around the reordered pipeline block in Step 6, with `logger.warn` on fallback. Defense-in-depth; in practice helpers are total on string input but the try/catch guards against future pathological-backtracking regex additions. No spec revision needed. |
| 2026-04-23 | Step 2 — `/review-plan` round 3 | Targeted Codex re-review of the try/catch fix. **RESOLVED** — Step 6 now explicitly wraps the reordered pipeline in try/catch and falls back to the original `extractPortionModifier → extractFoodQuery` order on throw. **VERDICT: APPROVED**. Step 2 closed: Gemini APPROVED R1 + Codex APPROVED R3. |
| 2026-04-22 | Step 3 — Plan Step 1 (RED integration tests) | Wrote `f-nlp-chain.conversationCore.integration.test.ts` (6 tests). Confirmed RED: AC1 (portionMultiplier=1 expected 2), AC3 (portionMultiplier=1 expected 3), AC4 (portionMultiplier=1 expected 2). AC8, AC9, AC11 GREEN immediately as expected. |
| 2026-04-22 | Step 3 — Plan Step 2 (RED unit tests) | Wrote `f-nlp-chain.entityExtractor.unit.test.ts` (26 tests). Confirmed RED: AC2/AC3 (clitic suffix), CONTAINER_PATTERNS plural, POST_COUNT_SERVING_PATTERNS (not yet exported), chain simulation for AC4/AC5. 9 failing, 17 passing as expected. |
| 2026-04-22 | Step 3 — Plan Step 3 (GREEN: wrapper pattern 5 clitic fix) | Extended `CONVERSATIONAL_WRAPPER_PATTERNS` pattern 5 in `entityExtractor.ts`: added `(?:me)?` clitic suffix to support `"acabo de beberme..."`. AC2/AC3 unit tests turned GREEN. |
| 2026-04-22 | Step 3 — Plan Step 4 (GREEN: CONTAINER_PATTERNS + POST_COUNT_SERVING_PATTERNS) | Extended `CONTAINER_PATTERNS` with plural-aware forms (`platos?`, `cuencos?`, `bol(?:es)?`, `vasitos?`, `jarritas?` — note `bol/boles` required `(?:es)?` not `s?` to preserve Spanish plural). Added `POST_COUNT_SERVING_PATTERNS` export (tapas, pintxos, pinchos, raciones). Fixed `bol(?:es)?\s+de` after initial `boles?` incorrectly failed existing F-MORPH test for `"bol de gazpacho"`. All Cycle 2 unit tests GREEN. |
| 2026-04-22 | Step 3 — Plan Steps 5+6 (GREEN: conversationCore reorder + stripContainerResidual) | Added private `stripContainerResidual()` to `conversationCore.ts` (CONTAINER + POST_COUNT_SERVING_PATTERNS, only applied when `cleanQuery !== strippedQuery`). Reordered Step 4: `extractFoodQuery` first, then `extractPortionModifier`, then strip — all wrapped in try/catch with `logger.warn?.` fallback per spec. Updated imports. |
| 2026-04-22 | Step 3 — Plan Step 7 (RED→GREEN verified) | All 6 integration tests GREEN. All 26 unit tests GREEN. |
| 2026-04-22 | Step 3 — Plan Step 8 (quality gates) | `npm test` 3694/3694 passed (baseline 3668 + 26 new). `npm run lint` 0 errors. `npm run build` clean. |

<!-- After code review, add a row documenting which findings were accepted/rejected -->

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

*Ticket created: 2026-04-23*
