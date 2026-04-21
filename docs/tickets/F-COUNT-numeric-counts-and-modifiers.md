# F-COUNT: Explicit Numeric Counts + Extended Size Modifiers

**Feature:** F-COUNT | **Type:** Backend-Feature | **Priority:** Medium
**Status:** Spec | **Branch:** feature/F-COUNT-numeric-counts-and-modifiers
**Created:** 2026-04-21 | **Dependencies:** None (works on develop post F-MORPH)

---

## Spec

### Description

Two related failure classes from the 2026-04-21 QA battery share the same code area — the F042 portion-modifier extractor (`packages/api/src/conversation/entityExtractor.ts` lines 132-148):

**P5 — Explicit numeric counts (Category 5 — 20 queries, 20 NULL)**

Queries starting with a digit (`"6 croquetas"`, `"12 gambas al ajillo"`, `"3 pinchos de tortilla"`) never pass through `extractPortionModifier` cleanly — the regex table has no rule for `^\d+\s+`. The digit stays in the query, and L1 FTS tokenizers can't match `"6 croquetas"` vs a canonical `"croquetas"` row.

Failing queries include:
- `"2 croquetas"`, `"6 croquetas de jamón"`
- `"3 pinchos de tortilla"`, `"4 empanadillas"`, `"12 gambas al ajillo"`
- `"8 aceitunas"`, `"5 churros"`, `"2 huevos fritos"`, `"1 flan"`, `"3 torrijas"`, `"10 mejillones"`
- `"2 cañas de cerveza"`, `"3 copas de vino"`, `"4 albóndigas"`, `"6 pimientos de padrón"`
- `"2 raciones de patatas bravas"` — compound: numeric count × `raciones de`
- `"media docena de croquetas"` — lexical count
- `"un par de tapas de jamón"` — lexical count
- `"tres tapas: croquetas, bravas y boquerones"` — multi-item, goes to menuDetector
- `"he comido 2 bocadillos de jamón"` — F-NLP wrapper + numeric count

**P6 — Extended modifiers (Category 6 — 20 queries, 12 NULL)**

Size words outside the existing vocabulary fail:
- `"ración normal de tortilla"` — `normal` is a no-op modifier, not stripped, F-MORPH + SERVING never fire
- `"una ración extra de croquetas"` — `extra` alone maps to 1.5 (in `extra[\s-]grande`) but `extra` without `grande` doesn't match
- `"ración enorme de cocido"` — `enorme` missing (should ≈ 2.0)
- `"una buena ración de fabada"` — `buena` is subjective (~1.0, treat as no-op strip)
- `"una ración generosa de lentejas"` — `generosa` (~1.3, treat as no-op strip for safety)
- `"un buen plato de paella"` — `buen` (~1.0)
- `"cuarto de ración de jamón"` — `cuarto` = 0.25
- `"ración y media de gambas"` — 1.5
- `"dos raciones de patatas bravas"` — lexical numeric + raciones plural
- `"triple de croquetas"` — `triple` already matches `/\btriples?\b/` but the word PRECEDES the food in `"triple de"` form; the existing regex matches the word but the `de` bridge leaves trailing text

Failing (12/20): `ración normal`, `una ración extra`, `ración enorme`, `una buena ración`, `una ración generosa`, `un buen plato`, `cuarto de ración`, `ración y media`, `dos raciones de`, `triple de`, plus 2 more variants.

### Scope

**In scope (F-COUNT):**

1. **P5.1 — Leading digit count**: `^(\d{1,2})\s+` → strip, set `portionMultiplier = N`. Cap N at 20 to avoid abuse (`"1000000 cañas"` → not meaningful).
2. **P5.2 — Lexical number words**: `una docena de` (12), `media docena de` (6), `un par de` (2), `dos` (2), `tres` (3), `cuatro` (4), `cinco` (5), `media` (0.5 — already partially handled, extend context).
3. **P5.3 — `N raciones de`**: both numeric (`2 raciones`) and lexical (`dos raciones`) — strip, set multiplier = N.
4. **P6.1 — New no-op modifiers**: `normal`, `buen`, `buena`, `buenas`, `buenos`, `generosa`, `generoso` → multiplier = 1.0 (no-op). They should still strip so SERVING/L1 can match the bare dish.
5. **P6.2 — New size modifiers**: `extra` (standalone, not `extra grande`) → 1.5; `enorme(s)` → 2.0.
6. **P6.3 — Fractional / composed**: `cuarto de ración` → 0.25; `ración y media` → 1.5.

**Out of scope:**

- `"tres tapas: croquetas, bravas y boquerones"` — routes to `menuDetector`, not F-COUNT's concern.
- `"triple de croquetas"` — borderline with existing `/\btriples?\b/`; verify behavior, add test if fails.
- Multi-item / ordinal forms (`primero`, `segundo`). Defer.

### Approach

Extend the F042 extractor in `packages/api/src/conversation/entityExtractor.ts` (the existing `PATTERNS` array at line 132-148). Pattern ordering: **longest-first**, consistent with the existing convention.

**Change 1 — numeric prefix (P5.1 + P5.3):**

Two new patterns at the TOP of the array (most specific first):

```ts
// Numeric + "raciones de" compound (must match before bare numeric)
{ regex: /^(\d{1,2})\s+raciones?\s+(?:de\s+)?/i, multiplier: /* captured N */ },

// Numeric bare prefix ("6 croquetas")
{ regex: /^(\d{1,2})\s+/i, multiplier: /* captured N */ },
```

**Architectural choice — capture-group vs fixed multiplier:**

The existing `PATTERNS` array has a fixed `multiplier` number per entry. Numeric-prefix rules need the multiplier to be captured from the regex. Two options:

- **Option A (recommended):** Extend `PatternEntry` to an algebraic `{ kind: 'fixed', regex, multiplier: number } | { kind: 'numeric', regex }`. The numeric kind captures `$1` and parses. Keeps the regex-driven design.
- **Option B:** Handle numeric prefix in a dedicated pre-step (before the PATTERNS loop) that sets `portionMultiplier` then falls through. Simpler but fragments the logic.

Recommend Option A.

**Change 2 — lexical number words (P5.2):**

Map-based approach:

```ts
const LEXICAL_NUMBER_MAP: Record<string, number> = {
  'un par': 2,
  'media docena': 6,
  'una docena': 12,
  'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5, 'seis': 6, 'ocho': 8, 'diez': 10,
};
```

New pattern rules that look for `^(un par|media docena|una docena|dos|tres|cuatro|cinco|seis|ocho|diez)\s+(?:de\s+)?(?:raciones?\s+de\s+)?` → strip, lookup multiplier from map.

**Change 3 — extended no-op + size modifiers (P6.1, P6.2):**

Add to PATTERNS array (longest-first):

```ts
{ regex: /\bextra[\s-]grandes?\b/i, multiplier: 1.5 },  // existing
{ regex: /\braci[oó]n\s+extra\b/i,  multiplier: 1.5 },  // NEW: "ración extra"
{ regex: /\braci[oó]n\s+enorme\b/i, multiplier: 2.0 },  // NEW: "ración enorme"
{ regex: /\bra?ci[oó]n\s+normal\b/i,multiplier: 1.0 },  // NEW: "ración normal" (no-op strip)
{ regex: /\benormes?\b/i,           multiplier: 2.0 },  // NEW: bare enorme
{ regex: /\bextras?\b/i,            multiplier: 1.5 },  // NEW: bare extra
{ regex: /\bbuen[ao]s?\b/i,         multiplier: 1.0 },  // NEW: buen/buena (no-op)
{ regex: /\bgeneros[ao]s?\b/i,      multiplier: 1.0 },  // NEW: generosa (no-op)
```

Ordering risk: `bare extra` will match inside `extra grande` — MUST be declared AFTER `extra grande` so `extra grande` wins on longest-first iteration.

**Change 4 — fractional / composed (P6.3):**

```ts
{ regex: /\bcuarto\s+de\s+raci[oó]n\b/i, multiplier: 0.25 },
{ regex: /\braci[oó]n\s+y\s+media\b/i,   multiplier: 1.5 },
```

### API Changes

None.

### Data Model Changes

None.

### UI Changes

None.

### Edge Cases & Error Handling

1. **Large N clamp** — `"1000 croquetas"`: strip to `"croquetas"` with `multiplier=1000` would produce absurd calories. Cap N at 20. If N > 20, fall back to `multiplier=1` and leave the digit in (lets L1 miss naturally rather than produce nonsense).
2. **N = 1** — `"1 flan"`: valid. `multiplier=1`, strip to `"flan"`.
3. **N = 0 or negative** — `"0 croquetas"`: strip, `multiplier=0` → zero nutrients (edge). Or just don't match (`{1,2}` already excludes 0-length; for `"0 croquetas"` the `\d{1,2}` captures `0` → multiplier=0 → breaks downstream). Decision: require N ≥ 1 via `[1-9]\d?` not `\d{1,2}`.
4. **Compound with F-MORPH** — `"unos 6 boquerones"` (informal "around 6"): ARTICLE strips `unos` → `"6 boquerones"` → numeric extractor fires. Works.
5. **F-NLP chain** — `"he comido 2 bocadillos de jamón"`: F-NLP strips `he comido ` → `"2 bocadillos de jamón"` → F-COUNT numeric fires → `"bocadillos de jamón"` with multiplier=2. Works via order.
6. **"dos" vs "dos mil"** — `"dos"` maps to 2. `"dos mil"` is not in the map → doesn't match — OK.
7. **`triple de croquetas`** — existing regex `/\btriples?\b/` matches `triple`, strips it, leaves `de croquetas`. Then ARTICLE_PATTERN doesn't strip `de` (it's not in the article list). Result: query = `"de croquetas"` which fails L1. FIX: add `/\btriple\s+de\s+/i → 3.0` to preempt the bare `triple` and consume the `de`.
8. **Numeric in middle of query** — `"pasta con 2 huevos"`: only strips leading digits. Preserved downstream. Correct.
9. **"una ración doble"** — existing regex `/\braci[oó]n\s+doble\b/` → 2.0 — still works.
10. **"raciones dobles"** — existing regex → 2.0.

---

## Implementation Plan

### Architecture Decision

**Option A — Tagged-union `PatternEntry`** (as recommended in the Spec).

The existing `PATTERNS` array uses `{ regex, multiplier: number }` (fixed). Numeric-prefix
patterns need the multiplier derived from the regex capture group, not a constant.
Extending to a discriminated union keeps all modifier logic in one declarative table:

```ts
type PatternEntry =
  | { kind: 'fixed';   regex: RegExp; multiplier: number }
  | { kind: 'numeric'; regex: RegExp }; // multiplier = parseInt(capture $1), capped 1-20
```

The loop in `extractPortionModifier` branches on `kind`.

Rationale over Option B (pre-step): keeps the regex-driven design, single scan, easy to
extend, no fragmented control flow.

---

### Final `PatternEntry` type

```ts
type PatternEntry =
  | { kind: 'fixed';   regex: RegExp; multiplier: number }
  | { kind: 'numeric'; regex: RegExp };
```

Existing entries become `{ kind: 'fixed', regex, multiplier }`.

---

### `LEXICAL_NUMBER_MAP`

```ts
const LEXICAL_NUMBER_MAP: Readonly<Record<string, number>> = {
  'un par':      2,
  'media docena': 6,
  'una docena':  12,
  'dos':   2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
  'seis':  6, 'siete': 7, 'ocho':  8, 'nueve': 9, 'diez': 10,
};
```

Matched via a single regex built from sorted-longest-first keys.

---

### New Pattern additions (ordered longest-first relative to existing)

Inserted BEFORE the existing PATTERNS (most-specific first):

1. **`/^([1-9]\d?)\s+raciones?\s+(?:de\s+)?/i`** — `kind:'numeric'` — "2 raciones de X"
2. **`/^([1-9]\d?)\s+/i`** — `kind:'numeric'` — "6 croquetas"
3. **`/^(un par|media docena|una docena|diez|nueve|ocho|siete|seis|cinco|cuatro|tres|dos)\s+(?:raciones?\s+(?:de\s+)?)?(?:de\s+)?/i`**
   — `kind:'fixed'` with multiplier looked up from `LEXICAL_NUMBER_MAP` (implemented in loop)

Inserted into existing PATTERNS (longest-first discipline):

4. **`/\btriple\s+de\s+/i`** → 3.0 — BEFORE existing `/\btriples?\b/` (AC16 fix)
5. **`/\braci[oó]n\s+y\s+media\b/i`** → 1.5 (P6.3)
6. **`/\bcuarto\s+de\s+raci[oó]n\b/i`** → 0.25 (P6.3)
7. **`/\braci[oó]n\s+enorme\b/i`** → 2.0 (P6.2)
8. **`/\braci[oó]n\s+extra\b/i`** → 1.5 (P6.2)
9. **`/\braci[oó]n\s+normal\b/i`** → 1.0 (P6.1 no-op strip)
10. **`/\braci[oó]n\s+generosa\b/i`** → 1.0
11. **`/\braci[oó]n\s+buena\b/i`** → 1.0
12. **`/\benormes?\b/i`** → 2.0 — after `ración enorme` compound
13. **`/\bextras?\b/i`** → 1.5 — after `extra grande` + `ración extra`
14. **`/\bbuen[ao]s?\b/i`** → 1.0 no-op
15. **`/\bgeneros[ao]s?\b/i`** → 1.0 no-op

Cap in `extractPortionModifier` for `kind:'numeric'`: if N < 1 or N > 20, skip match
(treat as no-op, query falls through untouched).

---

### Lexical patterns — implementation detail

A third PatternEntry kind is considered but rejected in favour of keeping the union to two
members. Instead, a dedicated ordered regex (`LEXICAL_PATTERNS`) array handles lexical
numbers separately. Each entry: `{ regex, multiplier }` (all `kind:'fixed'`). Applied
as a NEW first loop in `extractPortionModifier` BEFORE the existing PATTERNS loop.

Final approach: embed lexical entries directly in `PATTERNS` as `kind:'fixed'` with the
correct multiplier per number word (separate entry per word, grouped at top of array).
This is the simplest approach: ~10 extra entries, same iteration logic.

---

### `extractPortionModifier` pseudocode (updated loop)

```
function extractPortionModifier(text):
  for entry of PATTERNS:
    match = entry.regex.exec(text)
    if not match: continue
    if entry.kind == 'numeric':
      N = parseInt(match[1])
      if N < 1 or N > 20: continue   // out-of-range — skip
      multiplier = N
    else:
      multiplier = entry.multiplier
    cleaned = text.replace(entry.regex, '').replace(/\s+/g,' ').trim()
    if cleaned.length == 0: return { cleanQuery: text, portionMultiplier: 1.0 }
    return { cleanQuery: cleaned, portionMultiplier: multiplier }
  return { cleanQuery: text, portionMultiplier: 1.0 }
```

Note: `entry.regex.exec(text)` not `regex.test(text)` — exec needed to capture `$1`.

---

### Test files

- **Append to** `packages/api/src/__tests__/f070.entityExtractor.unit.test.ts` — F042
  regression block (AC20): verify existing multipliers still work.
- **New file** `packages/api/src/__tests__/f-count.entityExtractor.unit.test.ts` — primary
  AC1–AC19 test suite (mirrors F-NLP + F-MORPH split pattern).
- **New file** `packages/api/src/__tests__/f-count.entityExtractor.edge-cases.test.ts` —
  boundary / negative / chain cases.

---

### Test matrix (21 ACs → test cases)

| AC  | Input | Expected multiplier | Expected query |
|-----|-------|--------------------:|----------------|
| AC1  | `"2 croquetas"` | 2 | `"croquetas"` |
| AC2  | `"6 croquetas de jamón"` | 6 | `"croquetas de jamón"` |
| AC3  | `"12 gambas al ajillo"` | 12 | `"gambas al ajillo"` |
| AC4  | `"2 raciones de patatas bravas"` | 2 | `"patatas bravas"` |
| AC5  | `"media docena de croquetas"` | 6 | `"croquetas"` |
| AC6  | `"un par de tapas de jamón"` via extractFoodQuery | 2 | query stripped further |
| AC7  | `"dos raciones de patatas bravas"` | 2 | `"patatas bravas"` |
| AC8  | `"tres tapas"` | 3 | `"tapas"` |
| AC9  | `"una ración extra de croquetas"` via extractFoodQuery | 1.5 | `"croquetas"` |
| AC10 | `"ración enorme de cocido"` | 2.0 | `"cocido"` |
| AC11 | `"ración normal de tortilla"` | 1.0 | `"tortilla"` |
| AC12 | `"una buena ración de fabada"` via extractFoodQuery | 1.0 | `"fabada"` |
| AC13 | `"una ración generosa de lentejas"` via extractFoodQuery | 1.0 | `"lentejas"` |
| AC14 | `"cuarto de ración de jamón"` | 0.25 | `"jamón"` |
| AC15 | `"ración y media de gambas"` | 1.5 | `"gambas"` |
| AC16 | `"triple de croquetas"` | 3.0 | `"croquetas"` |
| AC17 | `"0 croquetas"` | 1.0 | `"0 croquetas"` (no strip) |
| AC18 | `"1000 cañas"` | 1.0 | `"1000 cañas"` (no strip) |
| AC19 | `"he comido 2 bocadillos de jamón"` via extractFoodQuery | multiplier=2 | remainder contains bocadillos |
| AC20 | Regression: `ración doble`, `extra grande`, `media`, `grande`, `pequeña`, `triple`, `doble` | unchanged | unchanged |
| AC21 | structural: tests exist | — | — |

---

### TDD Step Breakdown

1. **RED**: Write AC20 regression block (verify current F042 tests still work — must pass now)
2. **RED**: Write AC1, AC2, AC3 tests (bare numeric prefix) → `extractPortionModifier`
3. **GREEN**: Add `PatternEntry` tagged union type + numeric entries at top of PATTERNS; update loop to use `exec` + cap 1-20
4. **RED**: Write AC4 test (numeric + `raciones de` compound)
5. **GREEN**: Add compound `[1-9]\d?\s+raciones?\s+(?:de\s+)?` pattern BEFORE bare numeric
6. **RED**: Write AC5, AC7, AC8 tests (lexical numbers: `media docena`, `dos`, `tres`)
7. **GREEN**: Add LEXICAL_NUMBER_MAP + lexical entries as `kind:'fixed'` at top of PATTERNS
8. **RED**: Write AC9–AC11 tests (ración extra, ración enorme, ración normal)
9. **GREEN**: Add P6.1/P6.2 `ración X` compound patterns + no-op modifiers
10. **RED**: Write AC12, AC13 tests (buena, generosa — tested via extractFoodQuery for full chain)
11. **GREEN**: Add `buen[ao]s?`, `generos[ao]s?` no-op patterns
12. **RED**: Write AC14, AC15 tests (cuarto de ración, ración y media)
13. **GREEN**: Add fractional compound patterns
14. **RED**: Write AC16 test (`triple de croquetas`)
15. **GREEN**: Add `/\btriple\s+de\s+/i → 3.0` BEFORE existing `/\btriples?\b/`
16. **RED**: Write AC17, AC18 edge tests (out-of-range: 0, 1000)
17. **GREEN**: Verify cap logic in loop (already added in step 3)
18. **RED**: Write AC19 F-NLP chain test
19. **GREEN**: Verify chain works (no code change expected — integration of existing F-NLP + new numeric)
20. Run full test suite, lint, build

---

## Acceptance Criteria

- [ ] AC1 — `"2 croquetas"` → multiplier=2, query=`"croquetas"`
- [ ] AC2 — `"6 croquetas de jamón"` → multiplier=6, query=`"croquetas de jamón"`
- [ ] AC3 — `"12 gambas al ajillo"` → multiplier=12, query=`"gambas al ajillo"`
- [ ] AC4 — `"2 raciones de patatas bravas"` → multiplier=2, query=`"patatas bravas"` (strip `raciones de`)
- [ ] AC5 — `"media docena de croquetas"` → multiplier=6, query=`"croquetas"`
- [ ] AC6 — `"un par de tapas de jamón"` → multiplier=2, remainder goes through SERVING strip → `"jamón"`
- [ ] AC7 — `"dos raciones de patatas bravas"` → multiplier=2, query=`"patatas bravas"`
- [ ] AC8 — `"tres tapas"` alone (no `de`) → multiplier=3, query=`"tapas"` (menu_estimation handled elsewhere for colon variant)
- [ ] AC9 — `"una ración extra de croquetas"` → multiplier=1.5, query=`"croquetas"`
- [ ] AC10 — `"ración enorme de cocido"` → multiplier=2.0, query=`"cocido"`
- [ ] AC11 — `"ración normal de tortilla"` → multiplier=1.0, query=`"tortilla"`
- [ ] AC12 — `"una buena ración de fabada"` → multiplier=1.0, query=`"fabada"` (strip "buena" + "una" + "ración de")
- [ ] AC13 — `"una ración generosa de lentejas"` → multiplier=1.0, query=`"lentejas"`
- [ ] AC14 — `"cuarto de ración de jamón"` → multiplier=0.25, query=`"jamón"`
- [ ] AC15 — `"ración y media de gambas"` → multiplier=1.5, query=`"gambas"`
- [ ] AC16 — `"triple de croquetas"` → multiplier=3.0, query=`"croquetas"`
- [ ] AC17 — Edge: `"0 croquetas"` → no strip, multiplier=1 (safety)
- [ ] AC18 — Edge: `"1000 cañas"` → no strip, multiplier=1 (cap N ≤ 20)
- [ ] AC19 — F-NLP chain: `"he comido 2 bocadillos de jamón"` → multiplier=2, query=`"bocadillos de jamón"`
- [ ] AC20 — Regression: existing F042 tests (`ración doble`, `extra grande`, `media`, `grande`, `pequeña`, `triple`, `doble`) all still pass
- [ ] AC21 — Unit tests added for AC1-AC19 (TDD)
- [ ] All tests pass
- [ ] Lint: 0 errors
- [ ] Build: green

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing (TDD)
- [ ] No regressions in 3477-test api baseline
- [ ] Code follows project standards
- [ ] No linting errors
- [ ] Build succeeds

---

## Workflow Checklist

- [x] Step 0: Spec written (this file)
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed (Implementation Plan written above)
- [x] Step 3: `backend-developer` executed with TDD (56 tests added: 39 unit + 17 edge-cases)
- [ ] Step 4: Quality gates pass
- [ ] Step 5: `code-review-specialist` + `qa-engineer`
- [ ] Step 6: Ticket + tracker finalized

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-21 | Ticket created | Spec based on QA battery 2026-04-21 Categories 5 + 6 (32 target NULLs: 20 numeric + 12 extended modifiers) |
| 2026-04-21 | Implementation Plan written | Option A tagged-union PatternEntry, 20 TDD steps, 21 AC test matrix |
| 2026-04-21 | TDD implementation complete | 56 new tests (3533 total vs 3477 baseline), 0 regressions. Commit: `85bf1e9` |

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
