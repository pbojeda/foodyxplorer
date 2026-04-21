# F-MORPH: Spanish Morphological Normalization (plurals + diminutives)

**Feature:** F-MORPH | **Type:** Backend-Feature | **Priority:** Medium
**Status:** Spec | **Branch:** feature/F-MORPH-plurals-and-diminutives
**Created:** 2026-04-21 | **Dependencies:** None (works on develop post F-NLP)

---

## Spec

### Description

The 2026-04-21 QA battery surfaced two related failure classes that share the same root cause (no morphological normalization in the pre-cascade pipeline):

**P3 — Plural forms (Category 8 — 15 queries, 9 NULL)**

`packages/api/src/conversation/entityExtractor.ts` `ARTICLE_PATTERN` (line 465) only covers singular articles `un/una/uno/el/la/las/los/del/al`. The plural determiners **`unas`** and **`unos`** are NOT matched. So `"unas tapas de croquetas"` never has its leading article stripped, and then `SERVING_FORMAT_PATTERNS` (which expects the serving term at the start) never fires — the entire string `"unas tapas de croquetas"` is passed down to L1, which fails FTS.

Failing queries (9/15):

- `unas tapas de croquetas`
- `unos pinchos de tortilla`
- `unas raciones de gambas`
- `unas patatas bravas`
- `unas cañas`
- `unas copas de vino`
- `unos mejillones`
- `unas gambas al ajillo`
- `unos churros`

**P4 — Diminutives (Category 4 — 20 queries, 18 NULL)**

Spanish diminutive suffixes (`-ita/-ito/-itas/-itos/-ico/-cito/-ecillo/...`) are not normalized. Examples:

- `tapita` should resolve to `tapa` (F085 PORTION_RULES)
- `cañita` → `caña`
- `copita` → `copa`
- `pintxito` → `pintxo`
- `croquetitas` → `croquetas`
- `gambitas` → `gambas`
- `boqueronitos` → `boquerones`
- `racioncita` → `ración`

Colloquial container diminutives (`platito`, `vasito`, `jarrita`, `cuenco`, `bol`) are non-portion-terms that should be stripped (they carry no calorie semantics — a `platito de patatas bravas` is just `patatas bravas` for matching purposes). Note: `plato`, `cuenco`, and `bol` aren't in PORTION_RULES either — they're pure containers. They currently fail because the container word is not stripped and not a known portion term.

Failing queries (18/20):

- `una tapita de aceitunas`
- `un platito de patatas bravas`
- `una racioncita de gambas`
- `un pintxito de tortilla`
- `una cañita de cerveza`
- `una copita de vino`
- `unas croquetitas`
- `un poquito de paella`
- `unas gambitas al ajillo`
- `unos boqueronitos`
- `un trocito de tortilla`
- `un poco de gazpacho` (not a diminutive but a "colloquial quantity")
- `un cuenco de fabada`
- `un bol de gazpacho`
- `un vasito de horchata`
- `una jarrita de sangría`
- `un par de croquetas` (quantity — belongs to F-COUNT)
- `un pellizco de jamón` (quantity — belongs to F-COUNT)

The last two (`un par de`, `un pellizco de`) are pure quantity wrappers and MOVE to the F-COUNT ticket. Containers (`plato`, `cuenco`, `bol`) should be treated as no-op wrappers here in F-MORPH.

### Scope

**In scope (F-MORPH):**
1. Extend `ARTICLE_PATTERN` to cover `unas/unos` (P3).
2. Add a diminutive normalization pass that maps `-it[ao]s?` / `-cit[ao]s?` suffixes to their base forms, targeting tokens that match known portion/food terms (P4).
3. Add a `CONTAINER_PATTERNS` strip (similar to SERVING_FORMAT_PATTERNS) for the pure-container words `plato de`, `cuenco de`, `bol de` (not a portion size, just a vessel).
4. Handle the `poquito / poco de` diminutive-adjective pair as a container-like strip (colloquial quantity with no calorie semantics).

**Out of scope:**
- `un par de` / `un pellizco de` / `media docena de` — move to F-COUNT (they carry multiplier semantics).
- Stem-changing diminutives (e.g., `-ecito`, `-ecillo`) — low frequency, defer.
- Non-Spanish diminutives (Italian `-ino`, Portuguese `-inho`).

### Approach

Extend `packages/api/src/conversation/entityExtractor.ts`:

**Change 1 — ARTICLE_PATTERN (P3):**

```ts
// Before
export const ARTICLE_PATTERN = /^(?:un[ao]?|el|la[s]?|los|del|al)\s+/i;

// After — add plural articles
export const ARTICLE_PATTERN = /^(?:un[ao]?s?|el|la[s]?|los|del|al)\s+/i;
```

The only change is `un[ao]?` → `un[ao]?s?`. This now matches: `un, una, uno, unas, unos`.

**Change 2 — New CONTAINER_PATTERNS (P4, container subset):**

```ts
export const CONTAINER_PATTERNS: readonly RegExp[] = [
  /^plato\s+de\s+/i,
  /^platito\s+de\s+/i,       // diminutive container
  /^cuenco\s+de\s+/i,
  /^bol\s+de\s+/i,
  /^vaso\s+de\s+/i,          // NOTE: "vaso de X" is a container — but "un vaso de vino" is a DRINK portion (handled in F-DRINK)
  /^vasito\s+de\s+/i,
  /^jarra\s+de\s+/i,
  /^jarrita\s+de\s+/i,
  /^poqu?[ií]?to?\s+de\s+/i, // "poco de", "poquito de"
];
```

Applied AFTER `ARTICLE_PATTERN` and BEFORE `SERVING_FORMAT_PATTERNS`. Single-pass, first-match-wins (same convention as other pattern arrays).

**WARNING:** `vaso de / vasito de` conflicts with F-DRINK's "drink portion" semantics. F-DRINK will add `vaso` to `PORTION_RULES`. F-MORPH should either (a) not strip `vaso de` (leave for F-DRINK to handle), or (b) only strip `vasito de` (diminutive). Recommend (b) — F-MORPH strips ONLY diminutive containers (`vasito de`), letting F-DRINK handle full `vaso de vino` as a drink portion.

Revised CONTAINER_PATTERNS (F-MORPH scope only):

```ts
export const CONTAINER_PATTERNS: readonly RegExp[] = [
  /^plato\s+de\s+/i,
  /^platito\s+de\s+/i,
  /^cuenco\s+de\s+/i,
  /^bol\s+de\s+/i,
  /^vasito\s+de\s+/i,
  /^jarrita\s+de\s+/i,
  /^poqu?[ií]?to?\s+de\s+/i,
];
```

**Change 3 — Diminutive normalization (P4, suffix subset):**

Add a `normalizeDiminutive(text)` function + a curated lookup (to avoid over-stripping):

Option A (preferred): curated map of known diminutives → base forms.

```ts
const DIMINUTIVE_MAP: Record<string, string> = {
  'tapita': 'tapa',
  'tapitas': 'tapas',
  'cañita': 'caña',
  'cañitas': 'cañas',
  'copita': 'copa',
  'copitas': 'copas',
  'pintxito': 'pintxo',
  'pinchito': 'pincho',
  'racioncita': 'ración',
  'racioncitas': 'raciones',
  'croquetita': 'croqueta',
  'croquetitas': 'croquetas',
  'gambita': 'gamba',
  'gambitas': 'gambas',
  'boqueronito': 'boquerón',
  'boqueronitos': 'boquerones',
  'trocito': 'trozo',
  'trocitos': 'trozos',
};
```

Option B: regex-based suffix stripping (e.g., `/([a-záéíóúñ]+)(it[ao]s?)$/` → replace `$1a/o/as/os`). Simpler to maintain but RISKY — stems with `-it-` infix will false-positive (e.g., `patatita` → `patato` breaks; `mamita` is not a food; `cerveza` never dim-ifies so false matches on non-food words are OK but not on actual food names like `mantequita` or stressed forms).

**Decision:** Start with Option A (curated 20-entry map). It handles the failing QA queries deterministically. If future batteries surface more diminutives, extend the map. YAGNI over regex magic.

The `normalizeDiminutive` pass runs on TOKENS of `remainder`, not on the full string. Tokens are matched against the map (case-insensitive). Matched tokens replaced with base form.

**Order in extractFoodQuery:**
1. Conversational wrapper strip (F-NLP, existing)
2. PREFIX_PATTERNS (existing)
3. ARTICLE_PATTERN (existing, now including unas/unos) ← P3 fix
4. **CONTAINER_PATTERNS strip** ← NEW (P4 container subset)
5. SERVING_FORMAT_PATTERNS (existing)
6. **normalizeDiminutive on tokens** ← NEW (P4 suffix subset)
7. Fallback

### API Changes

None. `extractFoodQuery` signature unchanged.

### Data Model Changes

None.

### UI Changes

None.

### Edge Cases & Error Handling

1. **False-positive diminutive** — e.g., `mamita` is a name, not a food. The curated map in Option A avoids this by only mapping known-food diminutives.
2. **Double diminutive + serving** — `"una tapita de aceitunas"`: ARTICLE strips `"una"` → `"tapita de aceitunas"` → no container match → SERVING doesn't match `"tapita"` (pattern is `tapas?\s+de`) → normalizeDiminutive runs on `"tapita"` token → `"tapa"` → query becomes `"tapa de aceitunas"` → at this point SERVING_FORMAT would strip `"tapa de"` IF it ran again — but it only ran once. Decision: either (a) run SERVING again post-normalize, or (b) extend the normalization to ALSO strip the trailing preposition if the normalized portion term is immediately followed by `de`. Option (a) is simpler — re-run SERVING after normalize.
3. **"unas tapas variadas"** — strip `unas` → `tapas variadas`. SERVING_FORMAT strips `tapas de`? No, pattern is `/^tapas?\s+de\s+/i` — requires `de`. `tapas variadas` has no `de`, so no strip. Result: `tapas variadas` → L1 misses. This is a QA edge case where the dish itself is plural (no base dish called "tapas variadas"). Accept as intentional NULL.
4. **Empty after strip** — existing fallback rule fires.
5. **Order interaction with F-NLP** — F-NLP strips wrappers first. After F-NLP, the remainder could contain `unas` (e.g., `"me he tomado unas croquetas"` → `"unas croquetas"`). The new ARTICLE_PATTERN covers this → correct.
6. **`vasito de X` inside F-DRINK scope** — F-MORPH strips `vasito de X` as a container (diminutive), leaving `X`. If F-DRINK later adds `vasito` as a drink portion... conflict. Decision (see Change 2): F-MORPH owns `vasito de`, F-DRINK owns `vaso de`. Document in the plan's risk section.

---

## Implementation Plan

### Architecture Decisions

**Option A (curated DIMINUTIVE_MAP) chosen over Option B (regex suffix stripping)**

Rationale: The QA battery produces a finite, known set of failing diminutives. Option A maps them deterministically with zero false-positive risk. Option B's regex (`/([a-záéíóúñ]+)(it[ao]s?)$/`) would produce incorrect stems for Spanish words with `-it-` infix (e.g., `patatita` → `patato`). YAGNI applies — 18 entries cover all 18 failing QA queries; extension is trivial.

**vasito de ownership**: F-MORPH owns `vasito de` (diminutive container strip). F-DRINK will own `vaso de` (drink portion semantics). Documented as a risk: if F-DRINK later adds `vasito` to PORTION_RULES, a conflict exists — resolve at F-DRINK time.

**AC6 double-serving problem**: After `normalizeDiminutive` converts `tapita` → `tapa`, the remainder is `tapa de aceitunas`. SERVING_FORMAT_PATTERNS already ran and didn't match `tapita de`. Solution: re-run a single SERVING pass after `normalizeDiminutive`. This is simpler than extending the map to also strip the trailing `de`.

### Existing Code to Reuse

- `entityExtractor.ts` line 459–465: `SERVING_FORMAT_PATTERNS` and `ARTICLE_PATTERN` — extend in-place.
- `entityExtractor.ts` line 496–525: `extractFoodQuery` body — insert CONTAINER pass between ARTICLE and SERVING; insert normalizeDiminutive + second SERVING pass after SERVING.
- Test file convention: F-NLP used `f070.entityExtractor.unit.test.ts` for developer ACs and a separate `f-nlp.entityExtractor.edge-cases.test.ts` for QA edge cases. F-MORPH will follow the same pattern: append new `describe` blocks to `f070.entityExtractor.unit.test.ts` for the 17 AC tests, and create `f-morph.entityExtractor.edge-cases.test.ts` for any additional edge-case coverage.

### Precise Code Changes

**Change 1 — ARTICLE_PATTERN (line 468)**

```ts
// Before
export const ARTICLE_PATTERN = /^(?:un[ao]?|el|la[s]?|los|del|al)\s+/i;

// After
export const ARTICLE_PATTERN = /^(?:un[ao]?s?|el|la[s]?|los|del|al)\s+/i;
```

`un[ao]?s?` now matches: `un`, `una`, `uno`, `unas`, `unos`.

**Change 2 — New CONTAINER_PATTERNS (after ARTICLE_PATTERN, before SERVING)**

```ts
// F-MORPH: Container/vessel strip — pure wrappers with no calorie semantics.
// vasito de is owned by F-MORPH; vaso de is reserved for F-DRINK.
export const CONTAINER_PATTERNS: readonly RegExp[] = [
  /^plato\s+de\s+/i,
  /^platito\s+de\s+/i,
  /^cuenco\s+de\s+/i,
  /^bol\s+de\s+/i,
  /^vasito\s+de\s+/i,
  /^jarrita\s+de\s+/i,
  /^poqu?[ií]?to?\s+de\s+/i,
];
```

**Change 3 — DIMINUTIVE_MAP + normalizeDiminutive**

```ts
// F-MORPH: Curated diminutive → base form map (Option A).
// Only known food/portion diminutives — avoids false-positive on non-food words.
export const DIMINUTIVE_MAP: Readonly<Record<string, string>> = {
  tapita: 'tapa',
  tapitas: 'tapas',
  cañita: 'caña',
  cañitas: 'cañas',
  copita: 'copa',
  copitas: 'copas',
  pintxito: 'pintxo',
  pinchito: 'pincho',
  racioncita: 'ración',
  racioncitas: 'raciones',
  croquetita: 'croqueta',
  croquetitas: 'croquetas',
  gambita: 'gamba',
  gambitas: 'gambas',
  boqueronito: 'boquerón',
  boqueronitos: 'boquerones',
  trocito: 'trozo',
  trocitos: 'trozos',
};

// Replace each whitespace-separated token if found in the map (case-insensitive).
export function normalizeDiminutive(text: string): string {
  return text
    .split(/\s+/)
    .map((token) => DIMINUTIVE_MAP[token.toLowerCase()] ?? token)
    .join(' ');
}
```

**Change 4 — extractFoodQuery new step ordering**

```
// Pseudocode of new step order in extractFoodQuery:
1. Strip ¿¡ / ?!  (unchanged)
2. Chain slug extraction  (unchanged)
3. CONVERSATIONAL_WRAPPER_PATTERNS  (unchanged, F-NLP)
4. PREFIX_PATTERNS  (unchanged)
5. ARTICLE_PATTERN  (NOW includes unas/unos — P3 fix)
6. CONTAINER_PATTERNS  (NEW — P4 container subset)
7. SERVING_FORMAT_PATTERNS  (unchanged)
8. normalizeDiminutive on remainder  (NEW — P4 suffix subset)
9. Second SERVING pass  (NEW — handles tapita→tapa creating new SERVING candidate)
10. Fallback: remainder.trim() || originalTrimmed
```

### Test Matrix — 20 AC → Test Cases

| AC | Input | Expected output | Mechanism |
|----|-------|-----------------|-----------|
| AC1 | `unas tapas de croquetas` | `croquetas` | ARTICLE(unas) → SERVING(tapas de) |
| AC2 | `unos pinchos de tortilla` | `tortilla` | ARTICLE(unos) → SERVING(pinchos de) |
| AC3 | `unas raciones de gambas` | `gambas` | ARTICLE(unas) → SERVING(raciones de) |
| AC4 | `unas patatas bravas` | `patatas bravas` | ARTICLE(unas) only, no `de` |
| AC5 | `unas cañas` | `cañas` | ARTICLE(unas) only |
| AC6 | `una tapita de aceitunas` | `aceitunas` | ARTICLE(una) → DIMINUTIVE(tapita→tapa) → 2nd SERVING(tapa de) |
| AC7 | `una cañita de cerveza` | `cerveza` | ARTICLE(una) → DIMINUTIVE(cañita→caña) → 2nd SERVING(caña de) |
| AC8 | `unas croquetitas` | `croquetas` | ARTICLE(unas) → DIMINUTIVE(croquetitas→croquetas) |
| AC9 | `un plato de lentejas` | `lentejas` | ARTICLE(un) → CONTAINER(plato de) |
| AC10 | `un cuenco de fabada` | `fabada` | ARTICLE(un) → CONTAINER(cuenco de) |
| AC11 | `un bol de gazpacho` | `gazpacho` | ARTICLE(un) → CONTAINER(bol de) |
| AC12 | `un vasito de horchata` | `horchata` | ARTICLE(un) → CONTAINER(vasito de) |
| AC13 | `una jarrita de sangría` | `sangría` | ARTICLE(una) → CONTAINER(jarrita de) |
| AC14 | `un poco de gazpacho` | `gazpacho` | ARTICLE(un) → CONTAINER(poco de) |
| AC15 | `un vaso de vino tinto` | `vaso de vino tinto` | NOT stripped (F-DRINK territory) |
| AC16 | `patatitas` | `patatitas` | Not in DIMINUTIVE_MAP → unchanged |
| AC17 | `me he tomado unas croquetitas` | `croquetas` | F-NLP(me he tomado) → ARTICLE(unas) → DIMINUTIVE(croquetitas→croquetas) |
| AC18 | all existing tests | pass | regression |
| AC19 | exports | CONTAINER_PATTERNS, DIMINUTIVE_MAP, normalizeDiminutive exported | structural |
| AC20 | all 17 AC cases | have tests | TDD compliance |

### TDD Step Breakdown

**Step 1 (RED)**: Write tests for AC1–AC5 (plural articles `unas/unos`). Run → RED.
**Step 1 (GREEN)**: Change `ARTICLE_PATTERN` from `un[ao]?` to `un[ao]?s?`. Run → GREEN.

**Step 2 (RED)**: Write tests for AC9–AC14 (CONTAINER_PATTERNS strip). Run → RED.
**Step 2 (GREEN)**: Add `CONTAINER_PATTERNS` constant + insert CONTAINER pass in `extractFoodQuery`. Run → GREEN.

**Step 3 (RED)**: Write AC15 negative test (`vaso de` NOT stripped). Run → verify it passes (no `vaso de` in CONTAINER_PATTERNS).

**Step 4 (RED)**: Write tests for AC8, AC16, AC19 (DIMINUTIVE_MAP + normalizeDiminutive + export). Run → RED.
**Step 4 (GREEN)**: Add `DIMINUTIVE_MAP`, `normalizeDiminutive`, export both. Insert normalizeDiminutive call in `extractFoodQuery` (step 8). Run → GREEN.

**Step 5 (RED)**: Write test for AC6 + AC7 (double-serving: tapita/cañita → re-run SERVING). Run → RED (normalizeDiminutive fires but no second SERVING pass yet).
**Step 5 (GREEN)**: Add second SERVING pass after normalizeDiminutive. Run → GREEN.

**Step 6 (RED)**: Write AC17 (integration: F-NLP + ARTICLE + DIMINUTIVE). Run → should already be GREEN given steps above.

**Step 7 (RED)**: Write AC18 regression block (assert all existing extractFoodQuery tests still pass). Run → GREEN if no regressions.

**Step 8 (REFACTOR)**: Tidy export order, ensure `readonly` on all new constants, no `any`, no non-null assertions.

**Step 9 (VERIFY)**: Run full suite. Assert 3399+ total tests, 0 failures.

### Risk Log

- `vaso de` is NOT in CONTAINER_PATTERNS. If F-DRINK adds `vasito` to PORTION_RULES, a conflict arises. Mitigate at F-DRINK ticket time.
- `caña de cerveza` in `normalizeDiminutive`: `cañita de cerveza` → `caña de cerveza` → second SERVING pass. `caña de` is not a SERVING_FORMAT_PATTERN, so SERVING won't strip it — result is `caña de cerveza`. AC7 expects `cerveza`. To satisfy AC7, `caña de` must be added to SERVING_FORMAT_PATTERNS. Plan adjustment: add `/^ca[ñn]as?\s+de\s+/i` to SERVING_FORMAT_PATTERNS.

---

## Acceptance Criteria

- [x] AC1 — `unas tapas de croquetas` → ARTICLE strips `unas` → SERVING strips `tapas de` → `croquetas` → L1 match
- [x] AC2 — `unos pinchos de tortilla` → `tortilla` → L1 match
- [x] AC3 — `unas raciones de gambas` → `gambas` → L1 match
- [x] AC4 — `unas patatas bravas` → ARTICLE strips `unas` → `patatas bravas` → L1 match (no SERVING because no "de")
- [x] AC5 — `unas cañas` → ARTICLE strips `unas` → `cañas` → L1 match (or F-DRINK via portion term)
- [x] AC6 — `una tapita de aceitunas` → ARTICLE strips `una` → normalizeDiminutive `tapita` → `tapa` → re-run SERVING strips `tapa de` → `aceitunas` → L1 match
- [x] AC7 — `una cañita de cerveza` → `cerveza` (diminutive strip keeps `cerveza`)
- [x] AC8 — `unas croquetitas` → `croquetas` (diminutive plural)
- [x] AC9 — `un plato de lentejas` → CONTAINER strips `plato de` → `lentejas` → L1 match
- [x] AC10 — `un cuenco de fabada` → `fabada`
- [x] AC11 — `un bol de gazpacho` → `gazpacho`
- [x] AC12 — `un vasito de horchata` → CONTAINER strips `vasito de` → `horchata`
- [x] AC13 — `una jarrita de sangría` → CONTAINER strips → `sangría`
- [x] AC14 — `un poco de gazpacho` → CONTAINER strips → `gazpacho`
- [x] AC15 — Negative: `un vaso de vino tinto` → NOT stripped by F-MORPH (F-DRINK territory)
- [x] AC16 — Negative: `patatitas` alone (not in diminutive map) → unchanged
- [x] AC17 — Integration: `me he tomado unas croquetitas` → F-NLP strips `me he tomado` → F-MORPH strips `unas` + normalizes `croquetitas` → `croquetas` → L1
- [x] AC18 — Regression: all existing `extractFoodQuery` tests pass
- [x] AC19 — `CONTAINER_PATTERNS`, `DIMINUTIVE_MAP`, `normalizeDiminutive` exported for testability
- [x] AC20 — Unit tests added for all 17 AC cases (AC1-AC17); TDD (RED → GREEN)
- [x] All tests pass
- [x] `npm run lint --workspace=@foodxplorer/api` → 0 errors
- [x] `npm run build` → green

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing (TDD)
- [x] No regressions in 3399-test api baseline (3455 total after F-MORPH, 0 failures)
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds

---

## Workflow Checklist

- [x] Step 0: Spec written (this file)
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed (inlined in this ticket)
- [x] Step 3: `backend-developer` executed with TDD
- [ ] Step 4: Quality gates pass
- [ ] Step 5: `code-review-specialist` + `qa-engineer`
- [ ] Step 6: Ticket + tracker finalized

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-21 | Ticket created | Spec based on QA battery 2026-04-21 Categories 4 + 8 (27 target NULLs: 9 plural + 18 diminutive/container) |
| 2026-04-21 | Implementation Plan written | Option A (curated DIMINUTIVE_MAP); CONTAINER_PATTERNS; SERVING extended with caña de; second SERVING pass added |
| 2026-04-21 | TDD implementation complete | 56 new tests (f-morph.entityExtractor.unit.test.ts); 3455 total / 0 regressions; lint + build green |

---

## Merge Checklist Evidence

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | |
| 1. Mark all items | [ ] | |
| 2. Verify product tracker | [ ] | |
| 3. Update key_facts.md | [ ] | |
| 4. Update decisions.md | [ ] | |
| 5. Commit documentation | [ ] | |
| 6. Verify clean working tree | [ ] | |
| 7. Verify branch up to date | [ ] | |

---

*Ticket created: 2026-04-21 as part of QA Improvement Sprint (pm-session pm-qai)*
