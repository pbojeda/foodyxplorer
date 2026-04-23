# F-H4-B: Alias gaps + validator uniqueness enhancement

**Feature:** F-H4-B | **Type:** Backend-Feature (data + tooling) | **Priority:** High
**Status:** Spec | **Branch:** feature/F-H4-B
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-23 | **Dependencies:** F-H4 (`c83f6cb`), F-TOOL-RESEED-003 (`0dca029`)
**Complexity:** Standard

---

## Spec

### Description

F-H4 (`c83f6cb`) added 27 new dishes (CE-253..CE-279) to `packages/api/prisma/seed-data/spanish-dishes.json`. Post-merge QA revealed two classes of defect, both now tracked under `BUG-DATA-ALIAS-COLLISION-001` in `docs/project_notes/bugs.md`:

**Class 1 — Lookup key space collisions (4 pre-existing)**

The L1 lookup (`level1Lookup.ts` ~L100-110) resolves a dish against the union `{d.name, d.name_es} ∪ d.aliases`. Any term that appears in that union for more than one dish is a collision — not just identical alias strings.

| # | Collision term | Dish A | Dish B | Mechanism |
|---|----------------|--------|--------|-----------|
| 1 | `manzanilla` | CE-019 "Infusión de manzanilla" `aliases=["manzanilla","tila"]` | CE-213 "Copa de fino" `aliases=["manzanilla","jerez"]` | alias ↔ alias |
| 2 | `menestra de verduras` | CE-076 `nameEs="Menestra de verduras"` `aliases=["menestra"]` | CE-236 `nameEs="Menestra guarnición"` `aliases=["menestra de verduras"]` | name_es ↔ alias |
| 3 | `pisto manchego` | CE-075 `nameEs="Pisto manchego"` `aliases=["pisto"]` | CE-239 `nameEs="Pisto guarnición"` `aliases=["pisto manchego"]` | name_es ↔ alias |
| 4 | `arroz con verduras` | CE-146 "Paella de verduras" `aliases=["arroz con verduras"]` | CE-247 "Arroz con verduras y huevo" `aliases=["arroz con verduras"]` | alias ↔ alias |

Semantic classification:
- **Collision 1 (`manzanilla`)**: TRUE HOMOGRAPH — chamomile tea and dry sherry from Sanlúcar both legitimately share the bare term; context-of-meal determines which is intended. Cannot be resolved by renaming without breaking valid user queries.
- **Collision 2 (`menestra de verduras`)** and **Collision 3 (`pisto manchego`)**: NEAR-DUPLICATE pairs (main-dish vs. side-dish variant of the same base recipe). The data-content question of whether to merge CE-236 into CE-076 (and CE-239 into CE-075) is **OUT OF SCOPE for this ticket** and is deferred to a follow-up data-content review. This ticket resolves only the collision at the alias/key level. The chosen homograph strategy must work correctly whether or not a future merge is applied — see Homograph Design Decision below.
- **Collision 4 (`arroz con verduras`)**: DISTINCT DISHES sharing a generic alias (paella-style without egg vs. rice-with-egg). Resolvable by removing or qualifying the generic alias on one side.

**Class 2 — Apócope aliases missing from F-H4 Canarian dishes**

Empirical verification on a post-reseed dev API confirms: canonical forms resolve via `name_es`; dialectal apócopes (Canarian dropped-consonant forms) return NULL unless explicitly listed as aliases.

Verified misses:
- `"gofio escaldao"` (CE-257 "Gofio escaldado") → NULL
- `"papas arrugás"` (CE-253 "Papas arrugadas") → NULL

Criterion for inclusion: **add an apócope alias when the shortened form is documented in Canarian dialect usage (e.g., DRAE notes, regional culinary references) AND when the -ado/-adas/-ido suffix drop yields a form meaningfully distinct from the canonical name_es.** Do not add forms that are merely phonetic transcriptions with no documented usage or that would collide with existing aliases.

Candidate apócopes meeting the criterion (to be confirmed by implementer against references before merging):

| CE | nameEs | Proposed alias |
|----|--------|----------------|
| CE-253 | Papas arrugadas | `papas arrugás` |
| CE-254 | Papas arrugadas con mojo picón | `papas arrugás con mojo picón` |
| CE-255 | Papas arrugadas con mojo verde | `papas arrugás con mojo verde` |
| CE-257 | Gofio escaldado | `gofio escaldao` |
| CE-262 | Queso asado con mojo | `queso asao con mojo` |
| CE-275 | Ternasco asado | `ternasco asao` |

CE-261 ("Conejo en salmorejo canario") — the current data already has `conejo en salmorejo` as an alias (this ticket does NOT change that). The collision-risk concern with a future Peninsular salmorejo-rabbit dish is flagged here for visibility; removing or qualifying that alias is OUT of scope and can be revisited when a Peninsular dish is actually added. CE-271 already has `calçots con romesco` as an alias. All other CE-253..CE-279 dishes have no documented apócope form that should be added in this ticket.

**Scope boundary**

IN scope:
1. Add ~5-8 apócope aliases to CE-253..CE-279 dishes per the criterion above.
2. Resolve the 4 alias collisions per the chosen homograph strategy.
3. Extend `validateSpanishDishes.ts` with a cross-space uniqueness check across the full lookup key space (`name_es` ∪ `name` ∪ `aliases`), normalizing to lowercase for comparison.
4. Unit tests: one integration test that runs the real `spanish-dishes.json` through the extended validator (regression), plus focused unit tests for the new uniqueness check.

OUT of scope (future tickets):
- Merging CE-236 into CE-076 or CE-239 into CE-075 (data-content review required).
- Systematic apócope coverage for non-F-H4 dishes or non-Canarian regions.
- Modifying the L1 lookup SQL — current `name OR name_es OR alias` pattern is correct.
- Wholesale `name_es`-to-alias normalization across all 279 dishes (L1 already matches `name_es` directly).

---

### Homograph Design Decision — SELECTED: Option B

**Decision**: Option B — hard uniqueness + explicit allow-list — is adopted for F-H4-B. All 4 current collisions are resolved via `HOMOGRAPH_ALLOW_LIST` entries, with distinct `reason` values that record each collision's semantic classification. No alias data changes are made for the existing collisions; the fix is entirely inside the validator.

Selected after Gemini + Codex cross-model review (2026-04-23):
- Gemini (IMPORTANT): editing aliases on one side of a near-duplicate (collisions 2, 3) is a premature data-content decision. The allow-list should cover all 4 cases and defer data edits to a future content review.
- Codex (IMPORTANT): Option C is observability-only and does not prevent future regressions; it contradicts the bug's prevention goal. Must pick B.

Options A, C, D, E are documented below as considered-and-rejected. Kept for historical record so future contributors understand why B was chosen.


The 4 collisions require a policy decision on how the validator handles terms that legitimately appear in more than one dish's lookup key space. Options A–E are enumerated below with pros/cons. **No option is selected in this spec.** Selection is deferred to user review + cross-model (Gemini + Codex) pressure-test.

**Option A — Hard uniqueness, no exceptions**
Every term in the combined key space must be globally unique. Fix each collision by renaming aliases on one side (e.g., CE-019 keeps bare `manzanilla`; CE-213 must use `manzanilla fino` or `vino fino manzanilla`).
- Pro: Simplest invariant; no allow-list machinery needed; validator stays stateless.
- Con: Forces artificial qualifiers onto terms users actually speak bare (`manzanilla` for sherry is standard Spanish usage); future apócope aliases face the same friction. Breaks real user queries for the non-winner dish.

**Option B — Hard uniqueness + explicit allow-list**
Validator blocks collisions unless the pair is declared in a `HOMOGRAPH_ALLOW_LIST` constant with a structured justification entry. Any collision not on the list is a build-time error.

Allow-list entry schema:
```
{
  alias: string,          // lowercase normalized form of the colliding term; accents PRESERVED (see `calçots`/`calcots` precedent on CE-271)
  dishIds: string[],      // the two (or more) dishIds that legitimately share this term
  reason: string          // human-readable justification (classified as: "True homograph" | "Near-duplicate pending merge review" | "Distinct dishes, generic alias pending data review")
}
```

**All 4 current collisions are added to the allow-list with distinct `reason` values** (per Gemini review — avoids premature data-content decisions for collisions 2, 3, 4):

```
[
  { alias: "manzanilla",             dishIds: [<CE-019>, <CE-213>], reason: "True homograph: chamomile-tea infusion (CE-019) vs Sanlúcar fino sherry (CE-213). Both valid bare-term usage in Spanish." },
  { alias: "menestra de verduras",   dishIds: [<CE-076>, <CE-236>], reason: "Near-duplicate pending merge review: CE-076 main dish vs CE-236 side. Data-content review (follow-up) decides whether to merge." },
  { alias: "pisto manchego",         dishIds: [<CE-075>, <CE-239>], reason: "Near-duplicate pending merge review: CE-075 main dish vs CE-239 side. Data-content review (follow-up) decides whether to merge." },
  { alias: "arroz con verduras",     dishIds: [<CE-146>, <CE-247>], reason: "Distinct dishes, generic alias pending data review: CE-146 paella-style without egg vs CE-247 rice-with-egg. Follow-up may remove the bare alias from one side." }
]
```

- Pro: Precise control; each exception is documented and code-reviewable; prevents silent regression when new dishes are added; decouples validator enforcement from data-content disambiguation (collisions 2, 3, 4 can be revisited independently in a future data review without changing the validator).
- Con: Allow-list is a second data source to maintain; risk of growing silently over time without periodic audits; requires implementer to populate it for all 4 current collisions.
- Merge compatibility: if collisions 2 or 3 are later merged by a data-content ticket, the corresponding allow-list entry is simply removed. If collision 4 is resolved by removing the bare alias from one side, same cleanup.

**Option C — Soft warning, never block**
Validator emits `[WARN]`-prefixed messages for collisions (matching the existing pattern for `calories > 2000`), but `valid` remains `true` and the seed still runs.
- Pro: Zero friction; no allow-list to maintain; discovered collisions are surfaced without blocking.
- Con: Does not prevent regressions — a future seed addition can introduce new collisions and pass CI. Warning fatigue is a known issue in this codebase (e.g., calorie warnings are already present). Does not close `BUG-DATA-ALIAS-COLLISION-001`.

**Option D — Scoped uniqueness per category/source**
Uniqueness enforced within a group (e.g., same `source`, same regional tag, same category), allowed across groups.
- Pro: Closer to real-world semantics (brand-scoped lookup is how L1 already works for restaurant dishes).
- Con: Does not help the actual bug — all 4 collisions are inside `spanish-dishes.json` (same source, no category tag). Would require adding a category field to `SpanishDishEntry`, which is a schema change beyond this ticket's scope.

**Option E — Disambiguation weight metadata**
Store a `preferredWhenAmbiguous: boolean` (or numeric weight) on dishes sharing a term; L1 lookup picks the highest-weight match. Collisions become intentional and resolved at query time.
- Pro: No renaming required; handles true homographs naturally; consistent with how disambiguation is handled in other domains.
- Con: Requires a schema change to `SpanishDishEntry` and `spanish-dishes.json`; L1 lookup SQL must be modified (currently returns LIMIT 1 with no weighting); significantly larger scope than the validator change. Probably overkill for 1 true homograph.

**Rejection notes** (post cross-model review):
- Option A (no exceptions): rejected — forces renaming `manzanilla` on CE-213, breaks valid Spanish usage for sherry.
- Option C (soft warning): rejected — does not close BUG-DATA-ALIAS-COLLISION-001 because the seed only fails on `valid=false`; warnings pass CI and future regressions slip through. Confirmed by Codex review (cites `seedPhaseSpanishDishes.ts:128,135`).
- Option D (scoped uniqueness): rejected — all 4 collisions are inside `spanish-dishes.json` (same source/category), so scoping doesn't help. Also requires schema change.
- Option E (disambiguation weight): rejected — requires schema change + L1 SQL modification. Overkill for one true homograph.

---

### API Changes (if applicable)

None. No HTTP endpoints added or modified. The validator is a CLI script (`validateSpanishDishes.ts`), not an API route.

### Data Model Changes (if applicable)

**`SpanishDishEntry` type** (`packages/api/src/scripts/spanishDishesTypes.ts`): No schema changes required for Options A, B, or C. The new uniqueness check operates entirely at runtime on the existing `name`, `nameEs`, and `aliases` fields.

If Option B is selected: a `HOMOGRAPH_ALLOW_LIST` constant is added to the validator file itself (not to `SpanishDishEntry`) — it is validator logic, not data model.

If Option D or E is selected: `SpanishDishEntry` would need a new field — but these options are out of scope for this ticket.

**`spanish-dishes.json`**: Data-only changes — alias additions and collision resolutions. No structural schema change.

**`validateSpanishDishes.ts` — new check specification**:

The uniqueness check must build a global lookup key space map before the per-dish loop (or as a second pass):

```
keySpaceMap: Map<string (normalized term), string[] (dishIds that own it)>
```

Normalization: lowercase, no accent stripping (accented and unaccented forms are distinct terms — see `calçots`/`calcots` existing pattern). Each dish contributes: `LOWER(name)`, `LOWER(nameEs)`, and all `LOWER(alias)` strings to the map.

After building the map, any term with `dishIds.length > 1` is a collision. If Option B is active, a collision is only an error when the `(alias, dishIds)` pair is NOT present in `HOMOGRAPH_ALLOW_LIST`. If Option A or C, every multi-owner term is an error or warning respectively.

Error message format (consistent with existing validator style):
```
Collision in lookup key space: term "<term>" is shared by dishes [<externalId-A>, <externalId-B>]
```

### UI Changes (if applicable)

N/A — data + validator only, no UI.

### Edge Cases & Error Handling

**1. True homographs (the `manzanilla` case)**
`manzanilla` is a documented homograph in Spanish: it is both chamomile tea and the Sanlúcar de Barrameda style of fino sherry. Both uses are standard, unforced, and appear in RAE. The validator must not silently drop one dish from the seed. Resolution depends on the chosen option (A: qualifier required; B: allow-list; C: warn-only).

**2. Case sensitivity**
The validator's uniqueness check must normalize to lowercase before comparison, consistent with the L1 SQL (`LOWER(d.name) = LOWER(${query})`). A dish with `nameEs = "Papas Arrugadas"` and another with an alias `"papas arrugadas"` would collide at query time, and the validator must catch this.

**3. Accent normalization — do NOT strip accents**
The existing data has a deliberate precedent: `calçots` (with cedilla) and `calcots` (ASCII) coexist as separate alias entries on CE-271. This means accented and unaccented forms are treated as distinct lookup keys. The new uniqueness check must follow the same rule: compare lowercase but preserve accents. Do NOT apply NFD/NFC stripping in the validator. Document this explicitly in the validator source.

**4. `name === nameEs` invariant and the key space**
The validator already enforces `name === nameEs` for all Spanish dishes (line 86-89 of current validator). This means `name` and `nameEs` always contribute the same lowercase string to the key space map. The uniqueness check may therefore deduplicate `LOWER(name)` and `LOWER(nameEs)` per dish to avoid false self-collisions — or simply add both and accept that a dish will always own its own term twice (safe, since the collision check looks at dishIds cross-dish, not within a dish).

**5. Future seed additions introducing new collisions**
The extended validator runs in CI as part of the reseed pipeline (already enforced by F-TOOL-RESEED-003). Any future PR that adds a dish with a colliding term will fail the validator check before merge. If Option B: the author must either rename their alias or add an allow-list entry with justification. This is the primary regression-prevention mechanism.

**6. Aliases array is empty or undefined**
The validator already enforces `Array.isArray(entry.aliases)`. The uniqueness check must guard against this: skip alias iteration if the array is empty (valid, no error). An `undefined` aliases field is already a blocking error before the uniqueness check runs.

**7. Collisions 2 & 3 — deferred dish merge**
If a future ticket merges CE-236 into CE-076 (and CE-239 into CE-075), the collision for `menestra de verduras` and `pisto manchego` will resolve automatically because one dish will no longer exist. The chosen homograph option must not create a structural dependency that prevents this merge (all options A–C are merge-compatible; E would require cleaning up the weight field too).

---

## Implementation Plan

### Overview

TDD-first plan. Tests are written and confirmed failing before any implementation code is touched. Two logical work streams:
- **Stream A**: `spanish-dishes.json` — add 6 apócope aliases (AC-1).
- **Stream B**: `validateSpanishDishes.ts` — add `HOMOGRAPH_ALLOW_LIST` constant + cross-space uniqueness check (AC-2, AC-3).

Both streams are independent and can be implemented in either order, but the integration test (AC-3e) must run against the final JSON, so it is written last.

---

### Existing Code to Reuse

- `packages/api/src/scripts/validateSpanishDishes.ts` — the existing `validateSpanishDishes` function; extend in-place (no new file).
- `packages/api/src/scripts/spanishDishesTypes.ts` — `SpanishDishEntry` type; **no changes required** (uniqueness check uses existing `name`, `nameEs`, `aliases` fields; `HOMOGRAPH_ALLOW_LIST` lives in the validator file, not the types file).
- `packages/api/src/__tests__/f073.validateSpanishDishes.unit.test.ts` — existing unit test file; its `makeEntry`/`makeMinimalDataset` helpers reuse the same alias `"tortilla española"` across all filler dishes, which WILL collide under the new uniqueness check. These helpers MUST be updated (per Codex CRITICAL review finding) — either give each filler a unique alias (e.g., `aliases: [\`tortilla-${i}\`]`) or make fillers use `aliases: []`. Expected behavior (AC-4a) is that existing test assertions continue to pass after the helper change.
- `packages/api/src/__tests__/f073.validateSpanishDishes.edge-cases.test.ts` — same helper issue; same fix required.
- `makeEntry` / `makeMinimalDataset` helpers — the new test file SHOULD replicate fixed helpers locally (aliases unique per filler) to remain isolated from the existing test files' identity. Do not import from the existing files.
- `packages/api/prisma/seed-data/spanish-dishes.json` — the seed file being amended.

---

### Files to Create

| File | Purpose |
|------|---------|
| `packages/api/src/__tests__/fH4B.validateSpanishDishes.uniqueness.test.ts` | New test file for ALL uniqueness-check tests: AC-2-B4..B7, AC-3a..e. Named after this ticket (`fH4B`) to match the convention `f073.*` prefix used for F073 tests. |

---

### Files to Modify

| File | Changes |
|------|---------|
| `packages/api/prisma/seed-data/spanish-dishes.json` | Add 6 apócope aliases per AC-1 table (additions only — no deletions, no changes to collision dishes). |
| `packages/api/src/scripts/validateSpanishDishes.ts` | 1. Add `HOMOGRAPH_ALLOW_LIST` constant. 2. Add `buildKeySpaceMap` helper. 3. Add cross-space uniqueness check as a second pass after the per-dish loop. |
| `packages/api/src/__tests__/f073.validateSpanishDishes.unit.test.ts` | Update `makeMinimalDataset`/`makeEntry` helpers so filler dishes use unique aliases (prevents collision under new uniqueness check). Assertion bodies unchanged. |
| `packages/api/src/__tests__/f073.validateSpanishDishes.edge-cases.test.ts` | Same helper fix as above. Assertion bodies unchanged. |

---

### Implementation Order

Follow TDD strictly: each test step runs, fails (red), then the corresponding implementation step makes it pass (green).

#### Step 1 — Create the new test file (skeleton + helpers)

Create `packages/api/src/__tests__/fH4B.validateSpanishDishes.uniqueness.test.ts`.

Add the following at the top of the file:
- Imports: `import { describe, it, expect } from 'vitest'`, `import { validateSpanishDishes } from '../scripts/validateSpanishDishes.js'`, `import type { SpanishDishEntry } from '../scripts/spanishDishesTypes.js'`
- A local `makeEntry` helper (identical to the one in the unit test file).
- A local `make2DishDataset` helper that returns exactly 250 entries: 248 filler dishes + 2 explicitly configured dishes (dish A and dish B). This keeps the `>= 250` guard satisfied without adding noise.

#### Step 2 — Write failing tests for AC-3a and AC-2-B4 (alias collision, not in allow-list)

These two ACs describe the same scenario: a synthetic 2-dish dataset where both dishes share an alias that is NOT in the allow-list. Write as a single `it()` block:

```
it('AC-3a / AC-2-B4: rejects collision when term is not in allow-list', () => {
  // dish A: externalId=CE-T01, dishId=<uuid-T01>, aliases=['croquetas']
  // dish B: externalId=CE-T02, dishId=<uuid-T02>, aliases=['croquetas']
  // dataset: make2DishDataset(dishA, dishB)
  // expect: result.valid === false
  // expect: result.errors.some(e =>
  //   e.includes('Collision in lookup key space') &&
  //   e.includes('"croquetas"') &&
  //   e.includes('CE-T01') &&
  //   e.includes('CE-T02')
  // )
});
```

Note: the error message uses `externalId` values (e.g. `CE-T01`) not `dishId` UUIDs, per the Spec format: `Collision in lookup key space: term "<term>" is shared by dishes [<externalId-A>, <externalId-B>]`.

#### Step 3 — Write failing test for AC-3b (nameEs ↔ alias cross-space collision)

```
it('AC-3b: rejects cross-space collision (nameEs of dish X equals alias of dish Y)', () => {
  // dish A: nameEs='croquetas caseras', name='croquetas caseras', aliases=[]
  // dish B: nameEs='Plato B', name='Plato B', aliases=['croquetas caseras']
  // collision: LOWER('croquetas caseras') appears in both key spaces
  // expect: result.valid === false
  // expect: result.errors.some(e => e.includes('Collision in lookup key space') && e.includes('"croquetas caseras"'))
});
```

#### Step 4 — Write failing test for AC-3c (case-insensitive collision)

```
it('AC-3c: treats "Pisto" and "pisto" as colliding (case-insensitive)', () => {
  // dish A: aliases=['Pisto']
  // dish B: aliases=['pisto']
  // expect: result.valid === false (both normalize to 'pisto')
  // expect: result.errors.some(e => e.includes('"pisto"'))
});
```

#### Step 5 — Write failing test for AC-3d (accent-distinct forms on same dish — no false collision)

```
it('AC-3d: does not flag accent-distinct forms as a collision when both are on the same dish', () => {
  // dish A: aliases=['calçots', 'calcots']
  // Both normalize to different strings (ç ≠ c) — so no cross-dish collision
  // OR: they are on the SAME dish, so any overlap is within-dish (not cross-dish)
  // expect: result.valid === true
  // expect: result.errors.none that match 'Collision in lookup key space'
});
```

Implementation note for developer: the uniqueness check must track `Map<normalizedTerm, Set<dishId>>`. Within a single dish, `name`, `nameEs`, and all aliases contribute to that dish's key set. The map accumulates across all dishes. A collision is only flagged when `map.get(term).size > 1` (more than one distinct dishId owns the term). Since `calçots` and `calcots` are distinct strings (no NFD stripping), each is its own map key, and both owned by the same dishId — no collision.

#### Step 6 — Write failing test for AC-2-B5 (allow-list hit — valid: true)

```
it('AC-2-B5: accepts a collision that IS in the allow-list (exact alias + dishIds match)', () => {
  // dish A: externalId=CE-T03, dishId='aaaaaaaa-0000-0000-0000-000000000001', aliases=['empanada']
  // dish B: externalId=CE-T04, dishId='bbbbbbbb-0000-0000-0000-000000000002', aliases=['empanada']
  // HOMOGRAPH_ALLOW_LIST contains: { alias: 'empanada', dishIds: ['aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002'], reason: 'Test allow-list entry' }
  // expect: result.valid === true
  // expect: result.errors.none that match 'Collision in lookup key space'
});
```

IMPORTANT: This test requires the allow-list to be configurable or injectable by the test. The developer must make `HOMOGRAPH_ALLOW_LIST` injectable — either by exporting a function `validateSpanishDishesWithAllowList(dishes, allowList)` alongside the existing exported `validateSpanishDishes`, or by making the internal check call a helper that accepts `allowList` as a parameter. The public `validateSpanishDishes(dishes)` continues to use the hardcoded `HOMOGRAPH_ALLOW_LIST` (AC-2-B1). See Key Patterns section for the recommended approach.

#### Step 7 — Write failing test for AC-2-B6 (allow-list wrong dishId — still blocked)

```
it('AC-2-B6: rejects collision when allow-list has correct alias but wrong dishId set', () => {
  // dish A: externalId=CE-T05, dishId='cccccccc-0000-0000-0000-000000000003', aliases=['empanada']
  // dish B: externalId=CE-T06, dishId='dddddddd-0000-0000-0000-000000000004', aliases=['empanada']
  // HOMOGRAPH_ALLOW_LIST contains: { alias: 'empanada', dishIds: ['cccccccc-0000-0000-0000-000000000003', 'zzzzzzzz-0000-0000-0000-000000000099'], reason: '...' }
  //   ← note: second dishId is WRONG (not 'dddddddd...')
  // expect: result.valid === false (allow-list is a STRICT set equality check)
  // expect: result.errors.some(e => e.includes('Collision in lookup key space') && e.includes('"empanada"'))
});
```

#### Step 8 — Implement `HOMOGRAPH_ALLOW_LIST` and uniqueness check in `validateSpanishDishes.ts`

This is the first implementation step. Before writing any code, the developer must resolve the 4 allow-list `dishId` UUIDs from the JSON. They are confirmed here:

| Collision alias | dishId A | dishId B | externalId A | externalId B |
|-----------------|----------|----------|--------------|--------------|
| `manzanilla` | `00000000-0000-e073-0007-000000000013` | `00000000-0000-e073-0007-0000000000d5` | CE-019 | CE-213 |
| `menestra de verduras` | `00000000-0000-e073-0007-00000000004c` | `00000000-0000-e073-0007-0000000000ec` | CE-076 | CE-236 |
| `pisto manchego` | `00000000-0000-e073-0007-00000000004b` | `00000000-0000-e073-0007-0000000000ef` | CE-075 | CE-239 |
| `arroz con verduras` | `00000000-0000-e073-0007-000000000092` | `00000000-0000-e073-0007-0000000000f7` | CE-146 | CE-247 |

The allow-list `alias` values are the exact lowercase collision terms as they appear in the key space (accents preserved, no stripping).

Add to `validateSpanishDishes.ts` (after the existing constants, before the function):

1. A `HomographAllowListEntry` interface: `{ alias: string; dishIds: string[]; reason: string }`.
2. The `HOMOGRAPH_ALLOW_LIST` constant: a `readonly HomographAllowListEntry[]` with exactly 4 entries using the UUIDs above and the `reason` strings from the Spec.
3. Export a `validateSpanishDishesWithAllowList(dishes: SpanishDishEntry[], allowList: HomographAllowListEntry[]): ValidationResult` function that contains the actual implementation.
4. Have the existing `validateSpanishDishes(dishes)` call `validateSpanishDishesWithAllowList(dishes, HOMOGRAPH_ALLOW_LIST)`. This preserves the public API (AC-4a, AC-4b) while enabling test injection (AC-2-B5, AC-2-B6).

**Key space map construction** inside `validateSpanishDishesWithAllowList`, as a second pass after the per-dish loop:

```
// Second pass: cross-space key uniqueness
// keySpaceMap: Map<normalizedTerm, string[]> where values are externalIds
// Normalization: LOWER-case only. No NFD/NFC accent stripping.
// IMPORTANT: Accents are PRESERVED — calçots and calcots are distinct keys.
// This matches the CE-271 precedent (aliases: ["calçots","calcots"]) and the
// L1 lookup SQL which does LOWER() but not unaccent() on the term.
const keySpaceMap = new Map<string, string[]>();

for (const entry of dishes) {
  // name and nameEs are always equal (enforced above), so contribute only once per dish.
  // We add LOWER(nameEs) and then each alias separately.
  // Guard against aliases being null/undefined/non-array — the existing
  // validator records that as a blocking error but CONTINUES iterating (see
  // line ~91 of the current validator). The second pass must not throw on
  // the same input; it returns `[]` so the first-pass error stands alone.
  // (Codex IMPORTANT review finding.)
  const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
  const nameLower = typeof entry.nameEs === 'string' ? entry.nameEs.toLowerCase() : '';
  const terms: string[] = nameLower ? [nameLower] : [];
  for (const alias of aliases) {
    if (typeof alias === 'string') terms.push(alias.toLowerCase());
  }
  // Deduplicate terms within this dish (name === nameEs, avoid self-false-collision)
  const uniqueTerms = [...new Set(terms)];
  for (const term of uniqueTerms) {
    if (!keySpaceMap.has(term)) keySpaceMap.set(term, []);
    keySpaceMap.get(term)!.push(entry.externalId);  // store externalId for error messages
  }
}
```

Note: the map stores `externalId` strings (not `dishId` UUIDs) because the error message format requires `externalId` values. The allow-list matching uses `dishId` — so the collision-check logic must resolve `externalId → dishId` from the dishes array. Build a parallel `externalIdToDishId: Map<string, string>` from the per-dish loop (first pass) to support this lookup.

**Collision detection and allow-list matching logic** (run after building the map):

```
for (const [term, externalIds] of keySpaceMap) {
  if (externalIds.length <= 1) continue;  // no collision

  // Resolve dishIds for the colliding externalIds
  const collidingDishIds = externalIds.map(eid => externalIdToDishId.get(eid)!);

  // Check allow-list: find an entry where alias matches AND dishIds are a strict set-equal match
  const allowed = allowList.some(entry => {
    if (entry.alias !== term) return false;
    // Set equality: same elements regardless of order
    const entrySet = new Set(entry.dishIds);
    const collidingSet = new Set(collidingDishIds);
    if (entrySet.size !== collidingSet.size) return false;
    return [...collidingSet].every(id => entrySet.has(id));
  });

  if (!allowed) {
    errors.push(
      `Collision in lookup key space: term "${term}" is shared by dishes [${externalIds.join(', ')}]`
    );
    hasBlockingError = true;
  }
}
```

Add the `externalIdToDishId` map population in the first pass (per-dish loop), alongside the existing `seenExternalIds` logic.

**Source comment**: add the following comment directly above the `keySpaceMap` construction (per Gemini SUGGESTION 6):

```typescript
// Accent-preservation note: normalization uses toLowerCase() only — no NFD/NFC stripping.
// Accented forms (e.g. calçots, ñ, á) and their unaccented equivalents are distinct keys,
// matching the L1 lookup SQL (LOWER() without unaccent()) and the CE-271 precedent
// where "calçots" and "calcots" coexist as separate aliases on the same dish.
```

#### Step 9 — Run tests (Steps 2–7 should now pass)

Confirm that steps 2–7 (AC-3a, AC-2-B4, AC-3b, AC-3c, AC-3d, AC-2-B5, AC-2-B6) are all green. Also confirm all pre-existing tests still pass (AC-4a).

#### Step 10 — Write failing test for AC-1g (apócope aliases present in JSON) — BEFORE editing JSON

This step comes FIRST in the JSON stream (before Step 11 edits the JSON), to preserve strict TDD red→green ordering (Codex IMPORTANT review finding: the original plan wrote JSON changes before the presence test, giving no red phase for the data change).

Add to `fH4B.validateSpanishDishes.uniqueness.test.ts`:

```
it('AC-1g: all 6 apócope aliases are present in spanish-dishes.json as distinct lowercase strings from nameEs', () => {
  const jsonPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../prisma/seed-data/spanish-dishes.json'
  );
  const { dishes } = JSON.parse(readFileSync(jsonPath, 'utf8'));

  const expected = [
    { externalId: 'CE-253', alias: 'papas arrugás' },
    { externalId: 'CE-254', alias: 'papas arrugás con mojo picón' },
    { externalId: 'CE-255', alias: 'papas arrugás con mojo verde' },
    { externalId: 'CE-257', alias: 'gofio escaldao' },
    { externalId: 'CE-262', alias: 'queso asao con mojo' },
    { externalId: 'CE-275', alias: 'ternasco asao' },
  ];
  for (const { externalId, alias } of expected) {
    const dish = dishes.find((d: any) => d.externalId === externalId);
    expect(dish, `dish ${externalId} not found in JSON`).toBeDefined();
    expect(dish.aliases, `${externalId} aliases must contain "${alias}"`).toContain(alias);
    expect(alias.toLowerCase()).not.toBe(dish.nameEs.toLowerCase());
  }
});
```

This test MUST FAIL at this point (the 6 apócope aliases are not yet in the JSON — verified in the Verification Commands Run section: CE-253 aliases line 6599 lacks `"papas arrugás"`, CE-257 line 6708 lacks `"gofio escaldao"`).

#### Step 11 — Write failing integration test for AC-3e (real JSON, valid: true)

Add to `fH4B.validateSpanishDishes.uniqueness.test.ts`:

```
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

it('AC-3e: real spanish-dishes.json passes the uniqueness check with valid: true', () => {
  const jsonPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../prisma/seed-data/spanish-dishes.json'
  );
  // NOTE: The path above goes 2 levels up from packages/api/src/__tests__ —
  // `..` → `packages/api/src`, `..` → `packages/api`, then `prisma/...`. An
  // earlier draft of this plan had `../../../prisma/...` (3 levels) which
  // incorrectly resolved to `packages/prisma/...` (Codex CRITICAL review
  // finding). Matches the convention used in
  // packages/api/src/__tests__/bug-prod-003.disambiguation.test.ts.
  const { dishes } = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const result = validateSpanishDishes(dishes);
  // Filter out [WARN] entries (non-blocking); only blocking errors matter here
  const blockingErrors = result.errors.filter(e => !e.startsWith('[WARN]'));
  expect(blockingErrors).toHaveLength(0);
  expect(result.valid).toBe(true);
});
```

This test is focused on the uniqueness check — it will PASS once Step 8's allow-list is in place (the 4 live collisions are declared there). The 6 apócope additions are neutral w.r.t. the uniqueness check because they don't introduce new collisions (verified in Step 12 below).

#### Step 12 — Add 6 apócope aliases to `spanish-dishes.json` (AC-1) — turns Step 10 green

Edit `packages/api/prisma/seed-data/spanish-dishes.json`. For each target dish, append the new alias to its `aliases` array. **Do not modify any other field** and **do not touch the 4 collision dishes** (AC-2-B7).

| Dish | Current `aliases` (truncated) | Alias to append |
|------|-------------------------------|-----------------|
| CE-253 | `["papas arrugas","papas arrugadas sin mojo","papas canarias"]` | `"papas arrugás"` |
| CE-254 | `["papas con mojo","papas arrugadas con mojo","papas con mojo picón"]` | `"papas arrugás con mojo picón"` |
| CE-255 | `["papas con mojo verde"]` | `"papas arrugás con mojo verde"` |
| CE-257 | `["gofio amasado","escaldón"]` | `"gofio escaldao"` |
| CE-262 | `["queso a la plancha con mojo","queso asado canario"]` | `"queso asao con mojo"` |
| CE-275 | `["ternasco de aragón","cordero lechal asado","ternasco al horno"]` | `"ternasco asao"` |

Verify no new collisions are introduced: none of these 6 new alias strings appear in any other dish's name, nameEs, or aliases (developer can grep the JSON before committing).

After this step, Step 10 (AC-1g) turns green.

#### Step 13 — Confirm all tests green

Run the full test suite for the affected files:
```
npx vitest run packages/api/src/__tests__/fH4B.validateSpanishDishes.uniqueness.test.ts
npx vitest run packages/api/src/__tests__/f073.validateSpanishDishes.unit.test.ts
npx vitest run packages/api/src/__tests__/f073.validateSpanishDishes.edge-cases.test.ts
```

All three must be green. Confirm zero ESLint errors on the modified/created files.

---

### Testing Strategy

**Test file to create:**
- `packages/api/src/__tests__/fH4B.validateSpanishDishes.uniqueness.test.ts`

**Test files that must not be modified (regression guard):**
- `packages/api/src/__tests__/f073.validateSpanishDishes.unit.test.ts`
- `packages/api/src/__tests__/f073.validateSpanishDishes.edge-cases.test.ts`

**Enumerated test cases (each a distinct `it()` block):**

| # | AC | Description |
|---|----|----|
| T1 | AC-3a / AC-2-B4 | Alias-vs-alias collision NOT in allow-list → `valid: false`, error contains `Collision in lookup key space: term "croquetas"`, both externalIds present |
| T2 | AC-3b | `nameEs` of dish X equals alias of dish Y → `valid: false`, error contains `Collision in lookup key space: term "croquetas caseras"` |
| T3 | AC-3c | Alias `"Pisto"` on dish A and `"pisto"` on dish B → `valid: false`, both normalize to `"pisto"`, error present |
| T4 | AC-3d | `"calçots"` and `"calcots"` both as aliases on the same single dish (250-entry dataset, no other dish has these) → `valid: true`, no collision error |
| T5 | AC-2-B5 | Alias-vs-alias collision with injected allow-list containing exact match → `valid: true` |
| T6 | AC-2-B6 | Alias-vs-alias collision with injected allow-list whose dishId set is incomplete → `valid: false` |
| T7 | AC-2-B7 | (Implicit, via T8) confirmed by running AC-3e against the real JSON; collision dishes' aliases unchanged |
| T8 | AC-3e | Real `spanish-dishes.json` → `valid: true`, zero blocking errors |
| T9 | AC-1g | All 6 apócope aliases present in the real JSON as distinct strings from `nameEs` |

**Mocking strategy:**
- No DB mocking needed — `validateSpanishDishes` is a pure function.
- The allow-list injection for T5 and T6 is achieved by calling `validateSpanishDishesWithAllowList(dishes, customAllowList)` directly — no module mocking required.
- T8 and T9 load the real JSON via `readFileSync` (file system access, no DB).

---

### Key Patterns

**Existing pattern — pure function validator**: `validateSpanishDishes` in `packages/api/src/scripts/validateSpanishDishes.ts` is a pure function with no I/O. The new uniqueness check must follow the same pattern (no file reads inside the validator; caller passes the array).

**Existing pattern — test helpers**: Both existing test files use a local `makeEntry` and `makeMinimalDataset`. The new file replicates these locally. Do not extract to a shared module (out of scope; that is a separate refactor).

**Existing pattern — error accumulation**: All errors are pushed to `errors[]` and `hasBlockingError` is set true. The function never returns early on first error. The uniqueness check follows this pattern.

**Existing pattern — `[WARN]` prefix for non-blocking**: Non-blocking warnings use `[WARN]` prefix (e.g. calorie warnings). The uniqueness check is always blocking — no `[WARN]` variant.

**Key constraint — AC-2-B7**: `git diff` on `spanish-dishes.json` must show ONLY additions (new alias strings appended to CE-253, CE-254, CE-255, CE-257, CE-262, CE-275). No lines deleted or replaced in the collision dishes' alias arrays (CE-019, CE-075, CE-076, CE-146, CE-213, CE-236, CE-239, CE-247).

**Key constraint — allow-list is in-file**: `HOMOGRAPH_ALLOW_LIST` is declared in `validateSpanishDishes.ts`, not in an external JSON or types file. This satisfies AC-2-B1 and makes it code-reviewable.

**Rollback plan**: If an allow-list entry is wrong (wrong UUID, typo in alias, stale after a data-content merge), the real-data integration test T8 (AC-3e) will fail on CI immediately. The failure message will include the exact term and the externalIds of the conflicting dishes, making the root cause immediately visible. Fix = update the allow-list entry or remove it if the data collision was resolved. No separate rollback procedure is needed.

---

### Verification Commands Run

Commands executed and their outputs:

```
$ grep -n "externalId.*CE-019|CE-213|CE-076|CE-236|CE-075|CE-239|CE-146|CE-247" spanish-dishes.json | head -10
476:  CE-019   1936: CE-075   1962: CE-076   3780: CE-146
5540: CE-213   6143: CE-236   6221: CE-239   6430: CE-247
→ All 8 target dishes confirmed present.
```

Resolved dishIds (from JSON extraction):

| externalId | dishId |
|------------|--------|
| CE-019 | `00000000-0000-e073-0007-000000000013` |
| CE-075 | `00000000-0000-e073-0007-00000000004b` |
| CE-076 | `00000000-0000-e073-0007-00000000004c` |
| CE-146 | `00000000-0000-e073-0007-000000000092` |
| CE-213 | `00000000-0000-e073-0007-0000000000d5` |
| CE-236 | `00000000-0000-e073-0007-0000000000ec` |
| CE-239 | `00000000-0000-e073-0007-0000000000ef` |
| CE-247 | `00000000-0000-e073-0007-0000000000f7` |

```
$ ls packages/api/src/__tests__/*validateSpanishDishes*
f073.validateSpanishDishes.edge-cases.test.ts
f073.validateSpanishDishes.unit.test.ts
→ Two existing files. New file: fH4B.validateSpanishDishes.uniqueness.test.ts
```

```
$ grep -n "aliases" validateSpanishDishes.ts | head -10
92: if (!Array.isArray(entry.aliases)) {
93:   errors.push(...)
→ Aliases currently checked only for array type. No per-alias content validation. No uniqueness check.
```

```
$ wc -l spanish-dishes.json
7330 lines  (279 dishes × ~26 lines each)
```

```
Current aliases on apócope target dishes (confirmed from JSON):
CE-253: ["papas arrugas","papas arrugadas sin mojo","papas canarias"]
CE-254: ["papas con mojo","papas arrugadas con mojo","papas con mojo picón"]
CE-255: ["papas con mojo verde"]
CE-257: ["gofio amasado","escaldón"]
CE-262: ["queso a la plancha con mojo","queso asado canario"]
CE-275: ["ternasco de aragón","cordero lechal asado","ternasco al horno"]
```

```
CE-271 calçots pattern confirmed:
aliases: ["calcots con romesco","calçots","calcots","calçotada"]
→ Accented and unaccented forms coexist as separate alias strings on the same dish.
   This is the precedent for accent-preservation in the uniqueness check.
```

---

## Acceptance Criteria

All criteria must be verified by running `validateSpanishDishes.ts` against `spanish-dishes.json` and the unit test suite. "PASS" means the validator returns `valid: true` with zero blocking errors.

### AC-1 — Apócope aliases present and resolving

- AC-1a: `spanish-dishes.json` contains alias `"papas arrugás"` on CE-253.
- AC-1b: `spanish-dishes.json` contains alias `"papas arrugás con mojo picón"` on CE-254.
- AC-1c: `spanish-dishes.json` contains alias `"papas arrugás con mojo verde"` on CE-255.
- AC-1d: `spanish-dishes.json` contains alias `"gofio escaldao"` on CE-257.
- AC-1e: `spanish-dishes.json` contains alias `"queso asao con mojo"` on CE-262.
- AC-1f: `spanish-dishes.json` contains alias `"ternasco asao"` on CE-275.
- AC-1g: A unit test asserts that each of the above queries returns `level1Hit: true` against the seeded dev database (or, if DB is unavailable in CI, asserts that the alias string is present in the JSON and is a distinct lowercase string from `nameEs`).

### AC-2 — All 4 collisions resolved via Option B allow-list

Option B was selected post cross-model review. The 4 existing collisions are declared in `HOMOGRAPH_ALLOW_LIST` with distinct `reason` values; **no alias data edits are made for the existing collisions in this ticket** (collision 1 is a true homograph and collisions 2–4 defer to a future data-content review per Gemini finding).

Universal ACs:
- AC-2a: Running the extended `validateSpanishDishes` on the final `spanish-dishes.json` returns `valid: true` with zero blocking errors from the uniqueness check.
- AC-2b: `"gofio escaldado"` (canonical) still resolves via `name_es` — no regression on existing forms.
- AC-2c: `"papas arrugadas"` (canonical) still resolves — no regression.

Option-B-specific ACs:
- AC-2-B1: `HOMOGRAPH_ALLOW_LIST` constant is declared in `packages/api/src/scripts/validateSpanishDishes.ts` (same file as the validator; not an external JSON) with exactly 4 entries covering the current collisions.
- AC-2-B2: Allow-list schema is `Array<{ alias: string; dishIds: string[]; reason: string }>`. Each `alias` is lowercase with accents preserved (do NOT strip `ç`, `ñ`, accented vowels). Each `dishId` is a valid UUID present in `spanish-dishes.json`. Each `reason` is a non-empty string classifying the collision ("True homograph" | "Near-duplicate pending merge review" | "Distinct dishes, generic alias pending data review").
- AC-2-B3: The 4 entries exist with these exact aliases and dishId pairs (UUIDs resolved at implementation time from `spanish-dishes.json`):
  - `manzanilla` → [CE-019, CE-213], reason "True homograph: …"
  - `menestra de verduras` → [CE-076, CE-236], reason "Near-duplicate pending merge review: …"
  - `pisto manchego` → [CE-075, CE-239], reason "Near-duplicate pending merge review: …"
  - `arroz con verduras` → [CE-146, CE-247], reason "Distinct dishes, generic alias pending data review: …"
- AC-2-B4: A unit test asserts that a synthetic 2-dish dataset with a collision NOT in the allow-list causes `valid: false` and an error message matching `Collision in lookup key space: term "<term>" is shared by dishes [<id>, <id>]`.
- AC-2-B5: A unit test asserts that a synthetic 2-dish dataset with a collision that IS in the allow-list (alias + exact dishIds match) causes `valid: true`.
- AC-2-B6: A unit test asserts that an allow-list entry with the correct alias but WRONG/missing dishId is still flagged as a collision (allow-list is a strict match, not a term-only allow).
- AC-2-B7: No existing alias in `spanish-dishes.json` is modified by this ticket for the 4 collision pairs (verify via `git diff` — only additions for apócopes to CE-253..279 and the allow-list in validator, no deletions or replacements in collision dishes' aliases arrays).

### AC-3 — Validator uniqueness check (Option B)

- AC-3a: A unit test provides a minimal 2-dish dataset sharing an alias (not in allow-list) and asserts `valid: false` + the error message format from AC-2-B4.
- AC-3b: A unit test provides a minimal dataset where `nameEs` of dish X equals an alias of dish Y (cross-space collision, not alias-vs-alias) and asserts the same `valid: false` behavior.
- AC-3c: A unit test provides a minimal dataset where two aliases are identical but differ only in case (e.g., `"Pisto"` vs `"pisto"`) and asserts they are treated as colliding (case-insensitive comparison).
- AC-3d: A unit test provides a dataset where `calçots` and `calcots` appear as two distinct aliases on the same dish — asserts no false collision (accent-distinct forms on the same dish are fine; within a dish, multiple keys are expected and not a cross-dish collision).
- AC-3e: An integration test loads the real `spanish-dishes.json` via `readFileSync` and asserts `validateSpanishDishes(dishes).valid === true` with zero non-warning errors (regression protection against future seed additions introducing unreviewed collisions).

### AC-4 — No regressions

- AC-4a: All pre-existing validator tests pass unchanged.
- AC-4b: The extended validator still enforces all existing rules (source, confidence, portionGrams, nutrient range, UUID format, `name === nameEs`).
- AC-4c: Running `validateSpanishDishes(dishes)` (programmatically via a test or direct invocation) against the final `spanish-dishes.json` returns `{ valid: true, errors: [] }` with zero blocking errors. Note: there is no `npm run validate:spanish-dishes` script today; the validator is invoked from `seedPhaseSpanishDishes.ts` and from the new integration test (AC-3e).
- AC-4d: A post-merge dev reseed via `./packages/api/scripts/reseed-all-envs.sh` (F-TOOL-RESEED-003 wrapper) completes Phase 1 (db:seed) without validator errors — this exercises the same validator in the seed pipeline.

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

- [ ] Step 0: `spec-creator` executed, specs updated
- [ ] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 2: `backend-planner` executed, plan approved
- [ ] Step 3: `backend-developer` executed with TDD
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed (Standard/Complex)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-23 | Ticket skeleton created | F-H4-B, Standard tier, branch `feature/F-H4-B` from `origin/develop@c5012fd` |
| 2026-04-23 | Step 0 Spec drafted | `spec-creator` filled Description, Homograph Design, Data Model, Edge Cases, AC sections. User edited/refined manually. |
| 2026-04-23 | Step 0 `/review-spec` — Gemini + Codex parallel | Gemini: 1 IMPORTANT (all 4 collisions to allow-list, not just manzanilla) + 2 SUGGESTION. Codex: 2 IMPORTANT (Option C insufficient to close bug; AC-4c script path doesn't exist) + 2 SUGGESTION. Verdict: both REVISE. Empirical: Gemini read 5 files, Codex cited specific line numbers. Findings: [REVISE SPEC: Option B selected, all 4 collisions → allow-list, AC-4c path fixed, accent wording clarified, CE-261 scope clarified]. |
| 2026-04-23 | Step 2 Plan drafted | `backend-planner` produced 13-step TDD plan with 2 work streams (JSON data + validator). Verification commands run against actual code (dishId UUIDs resolved for all 4 allow-list entries). Introduced `validateSpanishDishesWithAllowList(dishes, allowList)` exported helper for test injection. |
| 2026-04-23 | Step 2 `/review-plan` — Gemini + Codex parallel | Gemini: APPROVED (empirical — 4 files read, 8 externalIds grepped). Codex: REVISE — 2 CRITICAL + 2 IMPORTANT + 1 SUGGESTION. Findings: (C1) existing test helpers use shared alias `"tortilla española"` → collides under new check, must fix; (C2) real-JSON path was `../../../prisma/...` (3 up → packages/prisma, nonexistent), fixed to `../../prisma/...` (2 up); (I1) second pass could throw on `aliases: null` — added `Array.isArray` guard; (I2) TDD order wrong — AC-1g test now written BEFORE JSON edit (new Step 10). SUGGESTION skipped (split function API is fine). All CRITICAL + IMPORTANT applied. |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | — |
| 1. Mark all items | [ ] | — |
| 2. Verify product tracker | [ ] | — |
| 3. Update key_facts.md | [ ] | — |
| 4. Update decisions.md | [ ] | — |
| 5. Commit documentation | [ ] | — |
| 6. Verify clean working tree | [ ] | — |
| 7. Verify branch up to date | [ ] | — |

---

*Ticket created: 2026-04-23*
