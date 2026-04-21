# F-NLP: Natural Language Query Pre-Processing

**Feature:** F-NLP | **Type:** Backend-Feature | **Priority:** High
**Status:** Spec | **Branch:** feature/F-NLP-natural-language-preprocessing
**Created:** 2026-04-21 | **Dependencies:** None (works on develop post BUG-PROD-012)

---

## Spec

### Description

The 350-query QA battery (2026-04-21, Category 12 — "Natural language / conversational") returned 18 NULLs out of 20 queries. Real users frequently phrase food queries as conversational sentences ("me he tomado...", "acabo de comer...", "hoy he almorzado...") but the current entity extractor only strips a narrow set of information-request wrappers ("cuántas calorías tiene", "dame info de"...). Past-tense self-reference verbs and temporal markers are not stripped, so the downstream cascade receives wrappers like `me he tomado una ración de croquetas` unchanged, and FTS/exact-match all miss.

**Pattern taxonomy of the 20 failing queries** (`/tmp/qa-exhaustive.sh` lines 294-314):

| Category | Example | Coverage |
|----------|---------|----------|
| A — past-tense self-reference | `me he tomado una ración de croquetas` | NOT covered — add |
| A — past-tense self-reference | `acabo de comer paella` | NOT covered — add |
| A — past-tense self-reference | `he desayunado café con leche y tostada` | NOT covered — add |
| A — past-tense self-reference | `para cenar tuve ensalada mixta` | NOT covered — add |
| A — past-tense self-reference | `anoche cené tortilla de patatas con ensalada` | NOT covered — add |
| A — past-tense self-reference | `me he bebido dos cañas de cerveza` | NOT covered — add |
| A — past-tense self-reference | `he merendado churros con chocolate` | NOT covered — add |
| A — intent-to-eat | `me voy a pedir una tapa de queso manchego` | NOT covered — add |
| A — intent-to-eat | `me pido unas bravas y unos boquerones` | NOT covered — add |
| B — info request | `quiero saber las calorías de un bocadillo de jamón` | NOT covered — add |
| B — info request | `cuánto engorda una ración de croquetas` | NOT covered — add |
| B — info request | `necesito saber los nutrientes del gazpacho` | NOT covered — add |
| B — info request | `cuánta proteína tiene el pollo a la plancha` | PARTIAL — existing pattern covers only `calorías`; extend to nutrients |
| B — info request (already covered) | `cuántas calorías tiene una ración de patatas bravas` | COVERED (verify) |
| B — info request (already covered) | `información nutricional de la fabada` | COVERED (verify) |
| C — multi-dish (menu_estimation intent) | `hoy he comido lentejas y de postre flan` | Multi-item, goes to menuDetector — not in F-NLP scope if menu intent fires correctly |
| C — multi-dish (menu_estimation intent) | `me pido unas bravas y unos boquerones` | Same — verify menu intent |
| D — opinion / non-food | `es sano comer pulpo a la gallega` | Intentional NULL — skip |
| D — recommendation | `quiero comer algo ligero` | Intentional NULL — skip |
| D — recommendation | `recomiéndame algo con pocas calorías` | Intentional NULL — skip |

**Target:** move 10-13 queries from NULL to OK (Categories A + B). Category D (opinion/recommendation) intentionally stays NULL — scope creep warning: do NOT add generic "quiero" or "algo" stripping that would turn D queries into garbage food lookups.

### Approach

Extend `packages/api/src/conversation/entityExtractor.ts`:
- Add new `CONVERSATIONAL_WRAPPER_PATTERNS` array — Spanish past-tense self-reference + intent-to-eat + extended info requests.
- Run this pass BEFORE the existing `PREFIX_PATTERNS` step in `extractFoodQuery`.
- Preserve the single-pass first-match-wins convention (no cascading strips).
- Respect the fallback rule: if stripping leaves empty, fall back to original — already implemented on line 483.

No LLM integration — pure regex. The sprint plan mentioned "may need LLM integration decision" but YAGNI: 15-20 well-formed regexes handle the 20 queries; LLM adds latency, cost, and non-determinism for marginal gain.

**Regex groups to add** (longest-first discipline):

1. **Past-tense + object pronoun** — `me\s+he\s+(tomado|bebido|comido|cenado|desayunado|almorzado|merendado)\s+` → strip
2. **Past-tense impersonal** — `(?:ayer|anoche|anteayer|hoy|esta\s+ma[nñ]ana|esta\s+noche)\s+(?:me\s+)?(?:cen[eé]|desayun[eé]|almorc[eé]|com[ií]|merend[eé]|tom[eé]|beb[ií])\s+` → strip
3. **"he + past-participle"** — `^(?:hoy\s+)?he\s+(tomado|bebido|comido|cenado|desayunado|almorzado|merendado)\s+` → strip
4. **"acabo de + infinitive"** — `acabo\s+de\s+(comer|tomar|beber|cenar|desayunar|almorzar|merendar)\s+` → strip
5. **"para + time + past-tense"** — `para\s+(cenar|desayunar|comer|almorzar|merendar)\s+tuve\s+` → strip
6. **Intent-to-eat** — `me\s+(?:voy\s+a\s+pedir|pido|voy\s+a\s+comer|voy\s+a\s+tomar|voy\s+a\s+beber)\s+` → strip
7. **"quiero saber / necesito saber"** — `(?:quiero|necesito)\s+saber\s+(?:las?|los?)?\s*(?:calor[ií]as?|nutrientes|informaci[oó]n|valores?\s+nutricionales?)\s+(?:de[l]?\s+)?` → strip
8. **"cuánto engorda"** — `cu[aá]nto\s+engorda\s+(?:un[ao]?\s+)?` → strip
9. **"cuánta + nutrient + tiene"** — `cu[aá]nt[ao]s?\s+(prote[ií]nas?|grasas?|carbohidratos|hidratos|fibra|sodio|sal)\s+(?:tiene|hay\s+en|lleva|contiene)\s+(?:un[ao]?\s+|el\s+|la\s+)?` → strip
10. **"necesito los nutrientes"** — `necesito\s+(?:saber\s+)?(?:los?|las?)?\s*(?:nutrientes|valores|calor[ií]as)\s+(?:de[l]?\s+)?` → strip

Each pattern runs once (first-match-wins). Patterns that strip to empty (e.g., `"he comido"` alone) fall back to original text — already implemented.

### API Changes

None. `extractFoodQuery` signature unchanged. Pure internal transformation.

### Data Model Changes

None.

### UI Changes

None.

### Edge Cases & Error Handling

1. **Double wrapper** — e.g., `"cuántas calorías tiene una ración de paella"` — existing `PREFIX_PATTERNS` handles `cuántas calorías tiene` + `ARTICLE_PATTERN` handles `una` + `SERVING_FORMAT_PATTERNS` handles `ración de`. Verify F-NLP additions run BEFORE so they don't interfere. Pattern ordering matters.
2. **Multi-dish in wrapper** — `"hoy he comido lentejas y de postre flan"`. After stripping `hoy he comido`, remainder is `lentejas y de postre flan`. The `menuDetector.ts` should fire on the `y` separator and produce `menu_estimation` intent. F-NLP does not need to handle multi-item — just strip the wrapper. Confirm `menuDetector` is triggered by verifying test AC7.
3. **Ambiguous "me he tomado X"** where X is non-food — falls through to normal cascade, which returns NULL. Acceptable.
4. **Recommendation queries** (Category D) — `"quiero comer algo ligero"`, `"recomiéndame algo con pocas calorías"`. These must NOT be matched by any F-NLP pattern (would produce nonsense queries like `algo ligero`). Verify by explicit negative tests (AC10, AC11, AC12).
5. **Opinion queries** (Category D) — `"es sano comer X"`. Pattern `es\s+sano\s+comer\s+` COULD be added but strips to `pulpo a la gallega` which IS a valid food query — would improve the battery. TRADE-OFF: the user's intent is "is this healthy?" (a different intent), not "what are the calories?" — answering with calories is misleading. SAFER: don't add this pattern; let opinion queries return NULL (intentional, current behavior).
6. **Order interaction with existing PREFIX_PATTERNS** — existing `PREFIX_PATTERNS` for `cuántas calorías tiene` is at `entityExtractor.ts:407`. F-NLP patterns must run either BEFORE (if their prefix extends `cuántas calorías`) or AFTER (if they are disjoint). Recommend running NEW F-NLP pass before existing `PREFIX_PATTERNS` but ensure overlap patterns (like `cuánta proteína tiene`) are mutually-exclusive with existing `cuántas calorías tiene`.

---

## Implementation Plan

### Architecture Decisions

**Decision 1 — Ordering of the new pass (NEW pass runs FIRST)**

The new `CONVERSATIONAL_WRAPPER_PATTERNS` pass runs BEFORE the existing `PREFIX_PATTERNS` loop. Justification:

- Category A patterns (past-tense, temporal markers) occupy the full front of the sentence — there is no overlap with existing `PREFIX_PATTERNS`. Running them first is safe and means `"me he tomado una ración de croquetas"` strips the wrapper and hands `"una ración de croquetas"` cleanly to `ARTICLE_PATTERN` then `SERVING_FORMAT_PATTERNS` in the normal chain.
- Category B extensions (`cuánto engorda`, `quiero saber`, `necesito saber`, `cuánta proteína tiene`) ALSO occupy the full sentence front. They must run first so that, e.g., `"quiero saber las calorías de un bocadillo de jamón"` is fully stripped by the new pass rather than partially matched by the existing `/^cu[aá]ntas?\s+calor[ií]as?\s+/i` entry.
- Disjoint guarantee: `cuánta proteína tiene` (new pattern group 9) vs `cuántas calorías tiene` (existing `PREFIX_PATTERNS[0]`) are mutually exclusive because `proteína/grasas/etc` vs `calorías` are different noun slots. No regex touches both.
- Final execution order in `extractFoodQuery`: ① chain-slug extraction → ② **CONVERSATIONAL_WRAPPER_PATTERNS** (NEW) → ③ `PREFIX_PATTERNS` (existing) → ④ `ARTICLE_PATTERN` (existing) → ⑤ `SERVING_FORMAT_PATTERNS` (existing) → ⑥ fallback.

**Decision 2 — Single array (`CONVERSATIONAL_WRAPPER_PATTERNS`)**

Use Option X: one array of 12 regexes ordered longest/most-specific first. Rationale: the existing codebase uses exactly this pattern (`PREFIX_PATTERNS` is a single flat array with comments). Splitting into `PAST_TENSE_WRAPPER_PATTERNS` + `INFO_REQUEST_EXTENSION_PATTERNS` adds a second loop and two exports for no measurable testability gain — the per-pattern comments embedded in the array are sufficient documentation.

**Decision 3 — Export**

`CONVERSATIONAL_WRAPPER_PATTERNS` must be exported (same as `PREFIX_PATTERNS`, `SERVING_FORMAT_PATTERNS`, `ARTICLE_PATTERN`). Test files import the constant directly to run structural assertions (e.g., length check, `.some(p => p.test(...))` checks) — this is the established pattern in `f078.regional-aliases.unit.test.ts:14`.

**Decision 4 — Fallback rule (no change)**

The existing fallback on line 483 (`const query = remainder.trim() || originalTrimmed;`) fires for any stripping that produces an empty string — including the new pass. No change required. An input like `"he comido"` alone would strip to `""`, then fall back to `"he comido"`, which produces a NULL downstream. That is correct and acceptable behavior.

---

### Existing Code to Reuse

| Entity | File | Lines | Role |
|--------|------|-------|------|
| `PREFIX_PATTERNS` | `packages/api/src/conversation/entityExtractor.ts` | 405-422 | Model for pattern array shape and `// comment` documentation style |
| `SERVING_FORMAT_PATTERNS` | same | 426-432 | Model for exported pattern array; applied AFTER the new pass |
| `ARTICLE_PATTERN` | same | 435 | Applied AFTER the new pass, before SERVING_FORMAT_PATTERNS |
| `extractFoodQuery` | same | 441-486 | The function being extended — only a new loop inserted at lines 461-468 |
| `f070.entityExtractor.unit.test.ts` | `packages/api/src/__tests__/` | 216-260 | Existing `extractFoodQuery` describe block — new ACs are appended to this file |
| `f078.regional-aliases.unit.test.ts` | same | 128-151 | Pattern for testing exported constants (length check + `.some(p.test(...))`) |

---

### Files to Create

None. All changes land in existing files (see Files to Modify).

---

### Files to Modify

| File | Change |
|------|--------|
| `packages/api/src/conversation/entityExtractor.ts` | Add `CONVERSATIONAL_WRAPPER_PATTERNS` export (before `PREFIX_PATTERNS`); insert a new loop in `extractFoodQuery` before the existing PREFIX_PATTERNS loop |
| `packages/api/src/__tests__/f070.entityExtractor.unit.test.ts` | Append new `describe('F-NLP — CONVERSATIONAL_WRAPPER_PATTERNS', ...)` block with 15 test cases (ACs 1-12 + 3 structural/regression) |

---

### Precise Regex Literals

All patterns use flag `i` (case-insensitive). All are anchored with `^`. All use `\s+` between tokens. Listed longest-first within each semantic group — the array order in code must match this table.

| # | Group | Regex literal | Strips | Example input → remainder |
|---|-------|---------------|--------|--------------------------|
| 1 | Past-tense + object pronoun | `/^me\s+he\s+(?:tomado\|bebido\|comido\|cenado\|desayunado\|almorzado\|merendado)\s+/i` | `me he tomado ` | `me he tomado una ración de croquetas` → `una ración de croquetas` |
| 2 | Past-tense impersonal with temporal (longest form with pronoun) | `/^(?:ayer\|anoche\|anteayer\|hoy\|esta\s+ma[nñ]ana\|esta\s+noche)\s+me\s+(?:cen[eé]\|desayun[eé]\|almorc[eé]\|com[ií]\|merend[eé]\|tom[eé]\|beb[ií])\s+/i` | `anoche me cené ` | (handles "anoche me cené X") |
| 3 | Past-tense impersonal without pronoun (temporal marker) | `/^(?:ayer\|anoche\|anteayer\|hoy\|esta\s+ma[nñ]ana\|esta\s+noche)\s+(?:cen[eé]\|desayun[eé]\|almorc[eé]\|com[ií]\|merend[eé]\|tom[eé]\|beb[ií])\s+/i` | `anoche cené ` | `anoche cené tortilla de patatas con ensalada` → `tortilla de patatas con ensalada` |
| 4 | "he + participle" bare (with optional hoy) | `/^(?:hoy\s+)?he\s+(?:tomado\|bebido\|comido\|cenado\|desayunado\|almorzado\|merendado)\s+/i` | `he desayunado ` / `hoy he comido ` | `he desayunado café con leche y tostada` → `café con leche y tostada` |
| 5 | "acabo de + infinitive" | `/^acabo\s+de\s+(?:comer\|tomar\|beber\|cenar\|desayunar\|almorzar\|merendar)\s+/i` | `acabo de comer ` | `acabo de comer paella` → `paella` |
| 6 | "para + meal + tuve/comí" | `/^para\s+(?:cenar\|desayunar\|comer\|almorzar\|merendar)\s+(?:tuve\|comí\|tomé)\s+/i` | `para cenar tuve ` | `para cenar tuve ensalada mixta` → `ensalada mixta` |
| 7 | Intent-to-eat (me voy a pedir / me pido) | `/^me\s+(?:voy\s+a\s+(?:pedir\|comer\|tomar\|beber)\|pido)\s+/i` | `me voy a pedir ` / `me pido ` | `me voy a pedir una tapa de queso manchego` → `una tapa de queso manchego` |
| 8 | "me he bebido" (drink variant — subsumed by pattern 1 via `bebido`) | Covered by pattern 1 (`bebido` is already in the alternation) | — | `me he bebido dos cañas de cerveza` → `dos cañas de cerveza` |
| 9 | "quiero saber / necesito saber" + nutrient phrase | `/^(?:quiero\|necesito)\s+saber\s+(?:las?\s+\|los?\s+)?(?:calor[ií]as?\|nutrientes\|informaci[oó]n\s+nutricional\|valores?\s+nutricionales?)\s+(?:de[l]?\s+)?/i` | `quiero saber las calorías de ` | `quiero saber las calorías de un bocadillo de jamón` → `un bocadillo de jamón` |
| 10 | "cuánto engorda" | `/^cu[aá]nto\s+engorda\s+(?:un[ao]?\s+)?/i` | `cuánto engorda una ` | `cuánto engorda una ración de croquetas` → `ración de croquetas` |
| 11 | "cuánta/cuántos + nutrient + tiene/hay en/lleva" | `/^cu[aá]nt[ao]s?\s+(?:prote[ií]nas?\|grasas?\|carbohidratos?\|hidratos?\|fibra\|sodio\|sal\|az[uú]car)\s+(?:tiene[n]?\|hay\s+en\|lleva\|contiene)\s+(?:un[ao]?\s+\|el\s+\|la\s+\|del?\s+\|al\s+)?/i` | `cuánta proteína tiene el ` | `cuánta proteína tiene el pollo a la plancha` → `pollo a la plancha` |
| 12 | "necesito los nutrientes de[l]" | `/^necesito\s+(?:saber\s+)?(?:los?\s+\|las?\s+)?(?:nutrientes\|valores\s+nutricionales?\|calor[ií]as?)\s+(?:de[l]?\s+)?/i` | `necesito saber los nutrientes del ` | `necesito saber los nutrientes del gazpacho` → `gazpacho` |

**Notes on trickiest patterns:**

- **Pattern 11** (`cuánta proteína tiene`): must NOT match `cuántas calorías tiene` (handled by `PREFIX_PATTERNS[0]`). The nutrient alternation explicitly excludes `calor[ií]as?` — that word is not listed. This makes the two patterns disjoint regardless of array order.
- **Pattern 9** (`quiero saber`): the trailing `(?:de[l]?\s+)?` is optional because some phrasings say `quiero saber las calorías del gazpacho` (with `del`) and others `quiero saber los nutrientes gazpacho` (without). The remainder `un bocadillo de jamón` is then further stripped by `ARTICLE_PATTERN` → `bocadillo de jamón`.
- **Pattern 10** (`cuánto engorda una ración de croquetas`): the `(?:un[ao]?\s+)?` inside the pattern strips the article early so the remainder passed to `SERVING_FORMAT_PATTERNS` is `ración de croquetas` not `una ración de croquetas`. This correctly chains into `SERVING_FORMAT_PATTERNS` → `croquetas`.

---

### Change to `extractFoodQuery`

The only structural change is inserting a new loop between the chain-slug extraction block (ends around line 459) and the existing `PREFIX_PATTERNS` loop (starts at line 462). Pseudocode:

```
// [lines 441-459 unchanged — punctuation strip, chain-slug extraction]

// Step 2a — NEW: Conversational wrapper stripping (F-NLP)
// Single pass, first match wins. Runs before PREFIX_PATTERNS so that
// extended info-request and past-tense wrappers are stripped cleanly.
for (const pattern of CONVERSATIONAL_WRAPPER_PATTERNS) {
  const stripped = remainder.replace(pattern, '');
  if (stripped !== remainder) {
    remainder = stripped;
    break;
  }
}

// Step 2b — Prefix stripping (existing PREFIX_PATTERNS, single pass, first match wins)
for (const pattern of PREFIX_PATTERNS) {
  // [lines 463-468 unchanged]
}

// [lines 470-485 unchanged — ARTICLE_PATTERN, SERVING_FORMAT_PATTERNS, fallback]
```

The new constant declaration is placed immediately above `PREFIX_PATTERNS` (before line 405) with the same documentation comment style.

---

### Test Matrix

All 15 ACs map to tests in `packages/api/src/__tests__/f070.entityExtractor.unit.test.ts`, appended as a new `describe` block after the existing `extractFoodQuery` describe block.

| AC | Test type | `describe` / `it` title | Input | Expected `query` |
|----|-----------|-------------------------|-------|-----------------|
| AC1 | Unit — positive | `F-NLP — extractFoodQuery / strips "me he tomado" wrapper and resolves to dish` | `me he tomado una ración de croquetas` | `croquetas` |
| AC2 | Unit — positive | `F-NLP — extractFoodQuery / strips "acabo de comer" wrapper` | `acabo de comer paella` | `paella` |
| AC3 | Unit — positive (menu routing) | `F-NLP — extractFoodQuery / strips "he desayunado" wrapper leaving multi-item remainder` | `he desayunado café con leche y tostada` | `café con leche y tostada` |
| AC4 | Unit — positive (menu routing) | `F-NLP — extractFoodQuery / strips temporal "anoche cené" wrapper leaving multi-item remainder` | `anoche cené tortilla de patatas con ensalada` | `tortilla de patatas con ensalada` |
| AC5 | Unit — positive | `F-NLP — extractFoodQuery / strips "me he bebido" wrapper` | `me he bebido dos cañas de cerveza` | `dos cañas de cerveza` |
| AC6 | Unit — positive | `F-NLP — extractFoodQuery / strips "quiero saber las calorías de" then article` | `quiero saber las calorías de un bocadillo de jamón` | `bocadillo de jamón` |
| AC7 | Unit — positive (chain strip) | `F-NLP — extractFoodQuery / strips "cuánto engorda una ración de" via chain` | `cuánto engorda una ración de croquetas` | `croquetas` |
| AC8 | Unit — positive | `F-NLP — extractFoodQuery / strips "cuánta proteína tiene el" wrapper` | `cuánta proteína tiene el pollo a la plancha` | `pollo a la plancha` |
| AC9 | Unit — positive | `F-NLP — extractFoodQuery / strips "necesito saber los nutrientes del" wrapper` | `necesito saber los nutrientes del gazpacho` | `gazpacho` |
| AC10 | Unit — negative | `F-NLP — extractFoodQuery / does NOT strip "quiero comer algo ligero" (Category D)` | `quiero comer algo ligero` | `quiero comer algo ligero` (unchanged) |
| AC11 | Unit — negative | `F-NLP — extractFoodQuery / does NOT strip "recomiéndame algo con pocas calorías" (Category D)` | `recomiéndame algo con pocas calorías` | `recomiéndame algo con pocas calorías` (unchanged) |
| AC12 | Unit — negative | `F-NLP — extractFoodQuery / does NOT strip "es sano comer pulpo a la gallega" (opinion)` | `es sano comer pulpo a la gallega` | `es sano comer pulpo a la gallega` (unchanged) |
| AC13 | Regression | `F-NLP — extractFoodQuery / existing "cuántas calorías tiene el big mac" still strips (regression)` | `cuántas calorías tiene el big mac` | `big mac` |
| AC14 | Regression | `F-NLP — extractFoodQuery / "cuántas calorías tiene una ración de patatas bravas" still strips via chain (regression)` | `cuántas calorías tiene una ración de patatas bravas` | `patatas bravas` |
| AC15 | Structural | `F-NLP — CONVERSATIONAL_WRAPPER_PATTERNS / is exported as readonly RegExp array with 12 entries` | import constant | `CONVERSATIONAL_WRAPPER_PATTERNS` has length 12, all items `instanceof RegExp` |

**Negative test structure (AC10/AC11/AC12):**
```
it('does NOT strip "quiero comer algo ligero" (Category D)', () => {
  const result = extractFoodQuery('quiero comer algo ligero');
  expect(result.query).toBe('quiero comer algo ligero');
});
```
The assertion is `toBe(input)` (exact equality) — not just "length > 0". This prevents false-positive passes if a pattern accidentally matches but strips to a non-empty garbage value.

---

### Regression Risk

The following existing tests assert specific strip behavior in `f070.entityExtractor.unit.test.ts` and must not be broken:

| Existing test (line) | Input | Expected | Risk |
|---------------------|-------|----------|------|
| Line 223 | `cuántas calorías tiene el big mac` | `big mac` | No overlap with new patterns — `PREFIX_PATTERNS[0]` handles `cuántas calorías` |
| Line 228 | `cuántas calorías big mac` | `big mac` | Same |
| Line 233 | `qué lleva el big mac` | `big mac` | No overlap |
| Line 238 | `big mac en mcdonalds-es` | `big mac` + chain | No overlap |
| Line 244 | `¿cuántas calorías tiene el big mac?` | `big mac` | No overlap |
| Line 250 | `cuántas calorías` | length > 0 (fallback) | No overlap |
| Line 257 | `big mac en mcdonalds` | no chainSlug | No overlap |

Additionally, `f078.regional-aliases.unit.test.ts` imports `SERVING_FORMAT_PATTERNS` — adding a new export above it does not affect that import.

The `f085.conversationCore.integration.test.ts` (598 lines) runs against the full `processMessage` pipeline; it does not import `CONVERSATIONAL_WRAPPER_PATTERNS` directly. No structural risk, but the TDD cycle must include a run of the full test suite (`npm test --workspace=@foodxplorer/api`) to catch any integration-level regressions.

---

### Step Breakdown (TDD)

1. **Read** `packages/api/src/conversation/entityExtractor.ts` lines 395-486 in full to confirm current line numbers before editing.
2. **Read** `packages/api/src/__tests__/f070.entityExtractor.unit.test.ts` in full to confirm import list and the last line number of the file.
3. **RED** — Append the new `describe('F-NLP — CONVERSATIONAL_WRAPPER_PATTERNS', ...)` block to `f070.entityExtractor.unit.test.ts` with all 15 test cases (ACs 1-15). Import `CONVERSATIONAL_WRAPPER_PATTERNS` in the import statement at the top of the test file. Run `npm test --workspace=@foodxplorer/api -- --reporter=verbose f070` — expect 15 failures (export does not exist yet).
4. **GREEN step A** — Add the `CONVERSATIONAL_WRAPPER_PATTERNS` export to `entityExtractor.ts` (constant declaration only, placed immediately before `PREFIX_PATTERNS`). Include all 12 regex literals from the Precise Regex Literals table, ordered as shown (patterns 1-7 then 9-12; note pattern 8 is subsumed by pattern 1). Run test step again — AC15 (structural test) should now pass; ACs 1-12 still fail because the loop is not wired.
5. **GREEN step B** — Insert the new loop in `extractFoodQuery` (between chain-slug block and existing PREFIX_PATTERNS loop). The loop mirrors the PREFIX_PATTERNS loop exactly (single-pass, first-match-wins, `break` on first strip). Run `npm test --workspace=@foodxplorer/api -- --reporter=verbose f070` — all 15 tests should pass.
6. **Verify chain strip for AC7** — `cuánto engorda una ración de croquetas`: new pass strips `cuánto engorda una ` → remainder `ración de croquetas` → ARTICLE_PATTERN no-ops (no article) → SERVING_FORMAT_PATTERNS strips `ración de ` → `croquetas`. Confirm this manually by tracing the test output.
7. **Verify AC6 chain** — `quiero saber las calorías de un bocadillo de jamón`: new pass strips `quiero saber las calorías de ` → remainder `un bocadillo de jamón` → ARTICLE_PATTERN strips `un ` → `bocadillo de jamón`. Correct.
8. **Run regression suite** — `npm test --workspace=@foodxplorer/api` (full suite). Confirm the 7 existing `extractFoodQuery` tests still pass. Confirm `f078.regional-aliases.unit.test.ts` still passes.
9. **Run lint** — `npm run lint --workspace=@foodxplorer/api`. Fix any issues (no `any`, `readonly RegExp[]` type on constant, standard comment style).
10. **Run build** — `npm run build`. Fix any type errors.
11. **Negative test final check** — Manually confirm AC10, AC11, AC12 assert `toBe(originalInput)` not just `toEqual` or length check. If any accidentally strip due to a too-broad pattern, narrow the offending regex.
12. **Final full suite run** — `npm test --workspace=@foodxplorer/api` clean pass. Record test count delta in commit message.

---

### Key Patterns

- Pattern constant shape: `export const CONVERSATIONAL_WRAPPER_PATTERNS: readonly RegExp[] = [ ... ];` — mirror `PREFIX_PATTERNS` at line 405 exactly (same `readonly RegExp[]` type, same `export const`, inline `// "example" — description` comments before each regex).
- Loop shape: mirror the `PREFIX_PATTERNS` loop at lines 462-468 verbatim — same `for...of`, same `remainder.replace(pattern, '')`, same `if (stripped !== remainder) { remainder = stripped; break; }`.
- Test describe naming: `'F-NLP — <ConstantOrFunction> / <what it does>'` — mirrors existing `'F078 — SERVING_FORMAT_PATTERNS constant'` style from f078 test.
- Import additions in test file: add `CONVERSATIONAL_WRAPPER_PATTERNS` to the destructured import from `'../conversation/entityExtractor.js'` on the existing import line — do not add a second import statement.
- Pattern 11 (`cuánta proteína tiene`) is the trickiest: the trailing `(?:un[ao]?\s+|el\s+|la\s+|del?\s+|al\s+)?` must be optional and exhaustive enough to strip `el`, `la`, `del`, `al` inline, so the remainder is the bare dish name without a leading article. Alternatively, since `ARTICLE_PATTERN` runs immediately after, the trailing optional article group can be simplified to just strip up to the verb+preposition — but the inline strip avoids a second pass for simple cases. Both approaches pass the tests; inline strip is preferred for consistency with patterns 9 and 10.
- Do NOT add `es sano comer` as a new pattern (AC12 is a negative test — it must remain unmatched).

---

## Acceptance Criteria

- [ ] AC1 — `"me he tomado una ración de croquetas"` → extracts `"croquetas"` (after SERVING_FORMAT_PATTERNS) → L1 cocina-española match
- [ ] AC2 — `"acabo de comer paella"` → extracts `"paella"` → L1 cocina-española match
- [ ] AC3 — `"he desayunado café con leche y tostada"` → stripped to `"café con leche y tostada"` → routed to menu_estimation via menuDetector (2 items)
- [ ] AC4 — `"anoche cené tortilla de patatas con ensalada"` → stripped to `"tortilla de patatas con ensalada"` → menu_estimation via menuDetector
- [ ] AC5 — `"me he bebido dos cañas de cerveza"` → stripped to `"dos cañas de cerveza"` → passes to F-COUNT-handled multiplier (post-F-COUNT) or single dish
- [ ] AC6 — `"quiero saber las calorías de un bocadillo de jamón"` → stripped to `"bocadillo de jamón"` → L1 match
- [ ] AC7 — `"cuánto engorda una ración de croquetas"` → stripped to `"croquetas"` (via chain: strip cuánto engorda → strip "una" → strip "ración de") → L1 match
- [ ] AC8 — `"cuánta proteína tiene el pollo a la plancha"` → stripped to `"pollo a la plancha"` → L1 match
- [ ] AC9 — `"necesito saber los nutrientes del gazpacho"` → stripped to `"gazpacho"` → L1 match
- [ ] AC10 — Negative test: `"quiero comer algo ligero"` → NOT stripped to `"algo ligero"` (Category D — keep original, produces NULL as intended)
- [ ] AC11 — Negative test: `"recomiéndame algo con pocas calorías"` → NOT stripped
- [ ] AC12 — Negative test: `"es sano comer pulpo a la gallega"` → NOT stripped (intent is opinion, NULL is acceptable)
- [ ] AC13 — Regression: all existing `extractFoodQuery` tests in `packages/api/src/__tests__/entityExtractor.*.test.ts` still pass
- [ ] AC14 — Regression: `"cuántas calorías tiene una ración de patatas bravas"` still works (must not break existing pattern)
- [ ] AC15 — Unit tests added for all 12 ACs above; TDD (RED → GREEN)
- [ ] `npm test --workspace=@foodxplorer/api` → all green
- [ ] `npm run lint --workspace=@foodxplorer/api` → 0 errors
- [ ] `npm run build` → green

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing (TDD)
- [ ] No regressions in conversationCore integration tests (5300+ tests)
- [ ] Code follows project standards (no `any`, exported constants for new patterns)
- [ ] `CONVERSATIONAL_WRAPPER_PATTERNS` array exported (parallel to `PREFIX_PATTERNS`, `SERVING_FORMAT_PATTERNS`) for testability
- [ ] No linting errors
- [ ] Build succeeds

---

## Workflow Checklist

- [x] Step 0: Spec written (this file, Category-A/B/C/D taxonomy with explicit negatives AC10-12 to prevent scope creep)
- [x] Step 1: Branch created (feature/F-NLP-natural-language-preprocessing), ticket registered (this file), tracker updated
- [x] Step 2: `backend-planner` executed, plan approved
- [x] Step 3: `backend-developer` executed with TDD
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-21 | Ticket created | Spec based on QA battery 2026-04-21 Category 12 (20 queries; 10-13 fixable, 7-10 intentional NULLs) |
| 2026-04-21 | backend-developer complete | TDD: 15 new tests (56/56 f070 file), full suite 3373/3373 green. Lint 0 errors, build clean. Committed. |

---

## Merge Checklist Evidence

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | Sections verified: (list) |
| 1. Mark all items | [ ] | AC: _/_, DoD: _/_, Workflow: _/_ |
| 2. Verify product tracker | [ ] | Active Session: step _/6, Features table: _/6 |
| 3. Update key_facts.md | [ ] | Updated: (list) / N/A |
| 4. Update decisions.md | [ ] | ADR-XXX added / N/A |
| 5. Commit documentation | [ ] | Commit: (hash) |
| 6. Verify clean working tree | [ ] | `git status`: clean |
| 7. Verify branch up to date | [ ] | merge-base: up to date |

---

*Ticket created: 2026-04-21 as part of QA Improvement Sprint (pm-session pm-qai)*
