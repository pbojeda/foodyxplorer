# F-UX-B — Expose assumptions behind Spanish serving-size terms (pincho / tapa / media ración / ración)

**Feature:** F-UX-B | **Type:** Fullstack-Feature | **Priority:** Standard
**Status:** Spec v2 — cross-model review complete, awaiting user approval before plan phase
**Created:** 2026-04-12 | **Dependencies:** F085 (portion term detection), F-UX-A (card metadata slot)

---

## User request (verbatim, Spanish)

> cuando se utilizan palabras como "pincho", "tapa", "ración", "media ración", ¿qué tenemos en cuenta para hacer los cálculos y las estimaciones? En casos como este también estaría bien informar al usuario en la ui/ux que se está estimando para el cálculo: ejemplo: tapa de croquetas basado en 2 croquetas respecto a una ración que son 8 croquetas. El pincho sería lo más pequeño, luego la tapa, luego la media ración y luego la ración.
>
> (User also explicitly asked for a "deep analysis / plan" phase by me + `codex` + `gemini` + self-review BEFORE implementation.)

---

## Empirical ground truth (from Explore-agent investigation of current state)

### What exists today

| Layer | Mechanism | Status |
|---|---|---|
| **F078** Prefix stripping | `SERVING_FORMAT_PATTERNS` in `entityExtractor.ts` strips `tapa de` / `pincho de` / `ración de` so the cascade matches the base food | Ships |
| **F042** Size modifier | `extractPortionModifier` → `portionMultiplier` (0.5/0.7/1.5/2/3 + extras) scales nutrients + portionGrams | Ships |
| **F085** Portion term detection | `enrichWithPortionSizing(query)` in `portionSizing.ts` runs on the **original** (unstripped) query and detects Spanish portion terms via a hardcoded `PORTION_RULES` map | Ships |
| **F-UX-A** Modifier display | Amber `PORCIÓN GRANDE` pill + `base: N kcal` subtitle on web card for F042 modifiers only | Just shipped (PR #109) |
| **Bot formatter** | `estimateFormatter.ts` renders `📏 Porción detectada: tapa (50–80 g)` when `portionSizing` is present | Ships |
| **Web `NutritionCard`** | **Ignores `portionSizing` entirely** — the field is in the API but the frontend never reads it | **Parity gap** |

### What `PORTION_RULES` currently knows (hardcoded global map in `packages/api/src/estimation/portionSizing.ts`)

| Term | gramsMin | gramsMax | Description |
|---|---:|---:|---|
| pintxo / pincho | 30 | 60 | Pintxo / pincho individual |
| montadito | 40 | 60 | Montadito individual |
| tapa | 50 | 80 | Tapa individual estándar |
| media ración | 100 | 125 | Media ración estándar española |
| ración | 200 | 250 | Ración estándar española |
| ración para compartir | 300 | 400 | Ración para compartir entre 2–3 personas |
| bocadillo / bocata | 200 | 250 | Bocadillo estándar |
| plato | 250 | 300 | Plato estándar español |
| caña | 200 | 200 | Caña de cerveza (200 ml) |

**These ranges are global** — the same `tapa` range applies to *tapa de croquetas*, *tapa de jamón*, *tapa de aceitunas*, *tapa de calamares*. In reality these differ significantly.

### What's NOT modeled anywhere

1. **Pieces-per-serving** — no column or table in Prisma represents "a ración of croquetas is 8 croquetas". The `StandardPortion` Prisma model exists (schema.prisma:356) but is **unused** by the estimation cascade.
2. **Per-dish serving-term overrides** — the 50–80 g tapa range is global.
3. **Web display of `portionSizing`** — never read by `NutritionCard.tsx`. Bot shows it; web doesn't.
4. **F042 × F085 scaling interaction** — searching `ración grande de croquetas` scales nutrients by 1.5 but the `portionSizing.gramsMin/gramsMax` stays at the base ración range (200–250 g, not 300–375 g). The gram range shown to the user is **inconsistent** with the nutrient numbers.

---

## Cross-model analysis — consensus + disagreements

Three independent analyses: my own (via Explore), `codex exec` (gpt-5-codex), and `gemini` (gemini-2.5-pro).

### Consensus (all 3 agree)

1. **Per-dish lookup, not global multipliers.** Global ratios like `tapa = 0.25 × ración` break on the croqueta/jamón/aceituna asymmetry. The model needs per-dish grams + optional per-dish pieces.
2. **Relational table**, not a JSONB column or a hardcoded TS map. Editable by non-engineers via seed CSV or a future admin UI. Codex calls it `dish_serving_assumptions`; Gemini calls it `StandardPortion` (which **already exists in the schema but is unused** — reuse wins).
3. **LLM used OFFLINE for backfill**, not at query time. A batch script seeds the table, an analyst reviews, data ships in the repo. Runtime queries hit the DB only. Zero runtime LLM cost.
4. **`pieces` is nullable.** Gazpacho and other non-countable dishes keep only `grams`. UI degrades gracefully ("≈ 250 g" without "X unidades").
5. **Serving term composes cleanly with F042 size modifier.** "Ración grande de croquetas" = ración as the base unit, then scalar 1.5 on nutrients.

### Disagreement: piece scaling for size modifiers

- **Codex:** apply the multiplier only to nutrients, leave pieces as the term-default (tapa = 2 croquetas always).
- **Gemini:** scale pieces proportionally — "ración grande" = `Math.round(8 * 1.5)` = 12 croquetas.

**My read:** Gemini is right for the user's mental model. If a ración is 8 croquetas and "grande" is 1.5×, a grande ración is 12 croquetas. Codex's view would be confusing — the nutrient numbers say 1.5× but the piece count stays flat. However, we must round and clamp: non-integer pieces don't make sense.

### Disagreement: UI surfacing

- **Codex:** add a new line under the existing `PORCIÓN` pill — "Asumimos: tapa = 2 croquetas (~50 g)". Keeps F-UX-A intact.
- **Gemini:** replace the F-UX-A pill with a richer one — "Tamaño: Tapa (2 ud, ~50g)".

**My read:** Codex is right — F-UX-A just shipped and users will be learning the PORCIÓN pill. Adding orthogonal information on a new line is lower-risk than reshaping the pill. The two concerns (size modifier vs serving term) are semantically distinct and deserve distinct visual slots.

### Disagreement: red flags

- **Gemini raised a legitimate concern:** concrete pieces like "tapa = 2 croquetas" set a false expectation of precision that real-world tapas rarely meet. Could damage trust more than help.
- **Codex acknowledged but dismissed it** — manageable with manual review of the seed data.

**My read:** Gemini is half-right. The mitigation is **copy discipline**: always show qualifiers ("~2", "unas 2-3", "aproximadamente") and always pair pieces with a gram range. Never bare "2 croquetas" — always "~2 croquetas (≈ 50 g)". This communicates the uncertainty without hiding the assumption.

---

## My synthesized recommendation

### Semantic model

A per-dish serving assumption for each of the 4 canonical Spanish terms (`pincho/pintxo`, `tapa`, `media ración`, `ración`), stored in the existing (unused) `StandardPortion` Prisma model, reused here. Each row: `{ dish_id, term, grams, pieces?, piece_name?, confidence, notes }`.

- **Base unit is `ración`** — the 100% reference portion for a dish.
- `media ración` is *not* required as a stored row — it's always `ración × 0.5`. Same for `doble/triple`. These are arithmetic, not data.
- `tapa` and `pincho/pintxo` ARE stored per-dish because their size is not a simple fraction of a ración — a tapa of croquetas (2 units) is different from a tapa of patatas bravas (1 scoop) is different from a tapa of aceitunas (10 units).
- **Derived behavior:** `media ración` and arithmetic variants inherit from `ración` via multiplication. Tapa and pincho are direct lookups.

### Data model

Reuse the existing `StandardPortion` model (schema.prisma:356) rather than introduce a new one. Rename internally to `DishPortionAssumption` only if the existing one has collisions — otherwise extend in place. Populate via the existing `seedPhaseSpanishDishes.ts` seed pipeline.

### Fallback strategy

1. **Exact match** — look up `(dish_id, term)` in `StandardPortion`. If found, use it.
2. **Ración-scaled arithmetic** — if the user typed `media ración de X` and a `ración` row exists, return `grams = ración.grams × 0.5`, `pieces = round(ración.pieces × 0.5)`.
3. **F085 global range** — if neither exists, fall back to the current hardcoded global range (the existing behavior). The response still includes the range but is marked `assumption: "generic"` so the UI can weaken the copy ("tapa estándar ≈ 50–80 g" without pieces).

### F042 × F-UX-B interaction

1. Resolve the serving term first via `StandardPortion` lookup (grams + optional pieces).
2. Apply F042 `portionMultiplier` to the resulting `grams` and `pieces` (rounded, clamped).
3. Final output on the card: `PORCIÓN GRANDE (× 1.5)` pill + `Ración: 12 croquetas (~360 g)` line. Both visible.

### UI surfacing

**Add a new line in `NutritionCard`** below the F-UX-A `PORCIÓN` pill (or replace the F085 grey range line if it was ever added), with copy like:

```
  [PORCIÓN GRANDE]                         ← F-UX-A pill (if size modifier)
  Ración ≈ 12 croquetas (~360 g)           ← F-UX-B new line (serving term)
```

Copy rules:
- Always show a term label (`Pincho`, `Tapa`, `Media ración`, `Ración`).
- Always prefix pieces with `~` or `unas` to communicate uncertainty.
- Always show a gram estimate even when pieces are known.
- If pieces are null (gazpacho), omit the pieces clause: `Ración ≈ 250 g`.
- If the fallback is the generic F085 range, use the range: `Tapa estándar: 50–80 g (estimado genérico)`.

**Bot**: enhance `estimateFormatter.ts` to include pieces in the existing `📏 Porción detectada` line when available. Byte-identical output for dishes that don't have a StandardPortion row yet.

### Scope (v1)

**IN:**
- Schema reuse of `StandardPortion` with `(dish_id, term, grams, pieces?, piece_name?, confidence, notes)`.
- Seed population for the top ~30 canonical Spanish tapas/pinchos/raciones — specifically the countable dishes where piece count has high value (croquetas, patatas bravas, calamares, gambas, aceitunas, pintxos básicos, jamón slices, boquerones). Start narrow, expand later.
- API: extend `EstimateDataSchema` with a new optional `portionAssumption` field. Keep F085's existing `portionSizing` field working so the bot's existing output doesn't break during the migration.
- Web: `NutritionCard.tsx` reads the new field and renders a copy line with the uncertainty qualifiers.
- Bot: existing formatter enhanced to include pieces when the new field is present.
- F042 composition: multiply pieces + grams correctly when both are present.
- Tests: schema invariants, orchestrator lookup, web rendering, bot formatter regression.
- Docs: api-spec, ui-components, user manuals.

**OUT (follow-ups):**
- User personalization ("my ración = 10 pieces")
- Restaurant/chain-specific overrides
- Admin UI for managing entries
- Automated LLM inference at query time (zero runtime LLM cost)
- Regional variations beyond the 4 canonical terms
- Generating entries for non-catalog dishes via LLM at query time
- Backfill of all ~250 Spanish dishes (only top 30 countable ones in v1)

### Red-flag mitigation

Everywhere the card or API says "pieces", the copy must include an uncertainty qualifier (`~`, `unas`, `≈`, `aproximadamente`). Never show a bare integer piece count. The seed data includes a `confidence` field that lets future QA distinguish "analyst-verified" from "LLM-seeded, pending review". The UI may use this to weaken copy for low-confidence rows.

---

## User decisions — Q1–Q7 (locked in 2026-04-12, verbatim)

All 7 recommendations accepted as **Option A**.

### Q1 — Scope: **NARROW (~30 countable dishes)**

Covers 80% of value with F085 as fallback for everything else. **Priority dishes (30, verbatim from user, do not re-order or substitute):**

> croquetas, patatas bravas, gambas al ajillo, aceitunas, pintxos, jamón, queso manchego, boquerones, calamares, chopitos, ensaladilla, tortilla, pan con tomate, chorizo, morcilla, pulpo a la gallega, gazpacho (sin pieces), salmorejo (sin pieces), albóndigas, alitas de pollo, empanadillas, mejillones, navajas, zamburiñas, berberechos, sepia, rabas, champiñones al ajillo, pimientos de padrón, tostas

**Note:** `gazpacho` and `salmorejo` are explicitly tagged `(sin pieces)` — they are included in the 30 because raciones make sense but pieces don't. Their seed rows must have `pieces = null`; the UI drops the pieces clause and renders only `Ración ≈ 250 g`.

**Countable vs. gram-only classification (added post-cross-model review 2026-04-12):**

The verbatim user list is locked (not re-ordered, not substituted). Cross-model review flagged that beyond gazpacho/salmorejo, several dishes on the list are semantically ambiguous about piece semantics (continuous substances, slice-based servings, weight-based servings). The seed-data pipeline uses this classification as a template — analyst may override per-row during CSV review:

- **Strong-countable** (default `pieces != null`, `pieceName` set):
  `croquetas`, `patatas bravas`, `gambas al ajillo`, `aceitunas`, `pintxos`, `boquerones`, `calamares`, `chopitos`, `albóndigas`, `alitas de pollo`, `empanadillas`, `mejillones`, `navajas`, `zamburiñas`, `berberechos`, `sepia`, `rabas`, `champiñones al ajillo`, `pimientos de padrón`
- **User-tagged sin pieces** (MUST `pieces == null`, `pieceName == null`):
  `gazpacho`, `salmorejo`
- **Analyst-decides at seed time** (default `pieces == null` if in doubt — false-negative gram-only copy is safer than false-positive piece count):
  `ensaladilla`, `pulpo a la gallega`, `jamón`, `queso manchego`, `tortilla`, `pan con tomate`, `chorizo`, `morcilla`, `tostas`

**Rule:** for the "analyst-decides" group, the seed script template sets `pieces = null` by default. Analyst may override by filling `pieces` + `pieceName` on that CSV row during review. Rationale: a false-positive "4 lonchas de jamón" on a dish that's actually served by weight is worse UX than the gram-only fallback `≈ G g`. When in doubt, default to null. User can review and override in the CSV.

### Q2 — Piece scaling with F042: **SCALE BOTH**

When a size modifier (F042 `portionMultiplier`) is present together with a portion term (F085) backed by a `StandardPortion` row with `pieces != null`:

- `displayedPieces = Math.round(basePieces × multiplier)`
- **Clamp minimum 1** — if rounding produces `0` (e.g., `Math.round(2 × 0.3)`), use `1` instead so we never render "0 croquetas"
- **Document the edge case** in tests: near-zero multiplier × small piece count → clamp activates; assert the assertion message explains why

Example: `ración grande de croquetas` with base 8 croquetas × 1.5 = `~12 croquetas (≈ 360 g)` on the card.

### Q3 — LLM backfill: **OFFLINE SCRIPT → CSV → REVIEW → SEED**

- A new offline script (ADR-020+ candidate) reads the 30 priority dishes × 4 terms (`pincho/pintxo`, `tapa`, `media ración`, `ración`) and prompts `codex exec` and/or `gemini` for `{ grams, pieces, piece_name, confidence }` per cell
- Output is a **CSV** with an empty `reviewed_by` column
- Analyst (user) fills `reviewed_by` manually in the CSV
- **Seed pipeline reads ONLY rows where `reviewed_by != null`** — unreviewed rows are silently skipped (not errors, not warnings — they simply don't seed)
- **Zero runtime LLM cost** — the script runs once during development; the DB is the only thing hit at query time

### Q4 — UI placement: **NEW LINE BELOW F-UX-A PILL**

The F-UX-A amber `PORCIÓN GRANDE` pill (size modifier) is NOT reshaped. The F-UX-B portion-term assumption is rendered as a **new, visually distinct line below it** — two orthogonal concerns in two orthogonal slots.

Example layout when both F-UX-A and F-UX-B apply:

```
[PORCIÓN GRANDE]                              ← F-UX-A pill (size modifier)
Ración ≈ 12 croquetas (≈ 360 g)              ← F-UX-B new line (per-dish assumption)
```

### Q5 — Copy format: **`~N X (≈ G g)` with uncertainty symbols, always**

- Canonical format with pieces: `~2 croquetas (≈ 50 g)`
- Canonical format without pieces (`pieces == null`): `≈ 250 g` — drop the pieces clause entirely, do NOT render `~null` or `~0`
- Generic fallback (F085, no `StandardPortion` row): `Tapa estándar: 50–80 g (estimado genérico)`
- **Always** prefix pieces with `~` (tilde)
- **Always** prefix grams with `≈` (almost equal)
- **Never** render a bare integer piece count like `2 croquetas` without the qualifiers
- Use the term label the user typed (`Pincho`, `Tapa`, `Media ración`, `Ración`, `Pintxo`) — see Q6

### Q6 — pincho vs pintxo: **DETECT BOTH, STORE AS `pintxo`, DISPLAY USER'S WORDING**

- Query parser normalizes both `pincho` and `pintxo` to the internal canonical key `pintxo` (Basque spelling as the invariant)
- DB stores under `pintxo`
- The UI and bot render using the spelling the user typed in their **original query** — if the user typed "pincho de croquetas" the card says "Pincho", if they typed "pintxo" it says "Pintxo"
- Default when the query didn't come from a typed term (edge case): use `pintxo`

### Q7 — F085 fallback: **KEEP, MARK AS `generic`**

- The API response includes `portionAssumption.source: "per_dish" | "generic"`
- `per_dish` = a `StandardPortion` row was found for `(dish_id, term)` → render the precise copy with pieces
- `generic` = no per-dish row → fall back to F085's existing hardcoded global range (50–80 g for `tapa`, etc.) → render the weaker copy (`Tapa estándar: 50–80 g (estimado genérico)`, no pieces, no `~` qualifier on the term)
- **Bot backwards-compatibility**: un-seeded dishes continue to render exactly like today (see Bot regression guarantee below)

---

## Red-flag mitigation (Gemini concern — MANDATORY)

> **Gemini raised:** *"A ración isn't a standardized unit — showing '2 croquetas' asserts a precision the real world doesn't have. Could damage trust more than help."*

**Non-negotiable mitigations encoded in this spec:**

1. **Copy discipline** — NEVER render bare `N croquetas`; ALWAYS `~N croquetas (≈ G g)` with both uncertainty symbols present
2. **`confidence` field in seed data** — `high | medium | low`, based on analyst review vs raw LLM output
3. **Tests validating copy format — SPLIT BY `source` BRANCH** (updated after cross-model review found this was internally contradictory):
   - **`per_dish` + `pieces != null` path (web + bot)** — rendered text MUST match `/~\d+ [a-záéíóúñ]+ \(≈ \d+ g\)/` (uncertainty symbols both present)
   - **`per_dish` + `pieces == null` path (web + bot)** — rendered text MUST match `/≈ \d+ g/` and MUST NOT contain `~` (no piece clause)
   - **`generic` path (bot)** — rendered text MUST be byte-identical to today's F085 output (e.g., `tapa (50–80 g)`). **No `~`, no `≈`.** This is the bot regression guarantee. A separate regression test asserts exact-string equality against a frozen snapshot of current output.
   - **`generic` path (web)** — new string `{Term} estándar: {N}–{M} g (estimado genérico)`. This is a brand-new render path (web today renders nothing for F085), so no regression concern; assert the exact new string.
4. **Accessibility** — `aria-label` on the portion line MUST include the Spanish word `"aproximadamente"` in EVERY render path (`per_dish` + pieces, `per_dish` gram-only, `generic`). Example: `"aproximadamente 2 croquetas, unos 50 gramos"` or `"aproximadamente 250 gramos"`. Tests assert the presence of `/aproximadamente/` on all three paths.
5. **`confidence` field kept but NOT used for copy in v1** (clarification post-review, originally ambiguous): the field ships in the DB + API response so a future iteration can weaken copy. v1 renders the same copy across all confidence levels. This is **out of scope for v1** per the OOS section — there is no "low-confidence weakening" mitigation to rely on in this release, only the copy-discipline symbols + aria-label.

---

## Spec — final design

### Semantic model

A per-dish serving assumption for each of the 4 canonical Spanish terms (`pintxo`, `tapa`, `media ración`, `ración`), stored in the existing (unused) `StandardPortion` Prisma model. Each row:

```
{
  dishId: number,              // FK to dishes
  term: string,                // 'pintxo' | 'tapa' | 'media_racion' | 'racion'
  grams: number,               // positive integer, mean of analyst-reviewed range
  pieces: number | null,       // null for non-countable dishes (gazpacho, salmorejo)
  pieceName: string | null,    // singular, e.g. 'croqueta', null if pieces is null
  confidence: 'high' | 'medium' | 'low',
  notes: string | null         // analyst commentary, free text
}
```

- **Base unit is `ración`** — the 100% reference portion for a dish
- `media_racion` stored explicitly when analyst review chose to (mostly not — it's derived as `ración × 0.5` via arithmetic)
- `tapa` and `pintxo` always stored per-dish because their sizes do NOT follow a simple fraction of a ración
- Arithmetic-derived terms (like `doble`, `triple`) remain F042's responsibility — this ticket does not introduce new F042 modifiers

### 3-tier fallback chain at query time

When a user query contains a portion term (F085 detection is unchanged):

1. **Tier 1 — per-dish lookup.** Query `StandardPortion` by `(dishId, term)`. If hit, build `portionAssumption` with `source: "per_dish"` and all fields populated from the row.
2. **Tier 2 — ración × 0.5 arithmetic for `media ración` ONLY.** If and only if the user typed `media ración` AND a `ración` row exists for the dish AND no explicit `media_racion` row exists for that dish, derive `grams = ración.grams × 0.5` and `pieces = Math.round(ración.pieces × 0.5)` (clamped to 1). `source: "per_dish"`, `notes: "derived from ración ×0.5"`.
   - **Explicit non-rule (added after cross-model review — Gemini proposed expanding Tier 2 to `tapa = ración × 0.25` and `pincho = ración × 0.15`, rejected on arbitration):** Tier 2 does NOT apply to `tapa` / `pintxo` queries even when a `ración` row exists. The whole point of the per-dish data model is to reject global ratios — `tapa = ración × 0.25` is exactly the kind of false precision the analysis phase rejected via Explore + Codex + Gemini consensus. Any `tapa`/`pintxo` query that misses Tier 1 falls through directly to Tier 3 generic. Log a counter metric (`portionAssumption.tier2_rejected_as_tapa_or_pintxo`) so we can see whether missing per-dish rows cause user-visible "estimado genérico" copy often enough to justify seeding more rows.
3. **Tier 3 — F085 generic fallback.** Any portion term query that fails Tier 1 and is not eligible for Tier 2 (per above) → return the current F085 global range `{ gramsMin, gramsMax }` with `source: "generic"`, `pieces: null`, `pieceName: null`. UI renders the weaker copy.

F042 `portionMultiplier` composes on top of the resolved assumption (per Q2). The multiplier applies to both `nutrients` (F-UX-A's existing behavior) AND `portionAssumption.grams/pieces` (new).

### API contract (`EstimateDataSchema` extension)

New optional field on `EstimateData`:

```ts
portionAssumption?: {
  term: string,                // 'pintxo' | 'tapa' | 'media ración' | 'ración' — display key
  termDisplay: string,         // user-typed variant (e.g., "pincho" or "pintxo") for UI rendering
  source: 'per_dish' | 'generic',
  grams: number,               // post-F042-multiplier
  pieces: number | null,       // post-F042-multiplier with clamp-to-1
  pieceName: string | null,    // singular form
  gramsRange: [number, number] | null,  // only when source === 'generic' (from F085 global map)
  confidence: 'high' | 'medium' | 'low' | null  // null when source === 'generic'
}
```

**Paired `superRefine` invariants** (following the F-UX-A pattern; tightened after cross-model review):

- **`source === 'per_dish'` branch:**
  - `grams` MUST be a positive integer (> 0)
  - `gramsRange` MUST be null
  - `confidence` MUST be one of `'high' | 'medium' | 'low'` (non-null)
  - `pieces` is null OR a positive integer (≥ 1, clamp-to-1 enforced upstream)
  - `pieceName` is null iff `pieces` is null
- **`source === 'generic'` branch:**
  - `gramsRange` MUST be present as `[gramsMin, gramsMax]` with `gramsMin > 0`, `gramsMax > gramsMin`, both **integers**
  - `grams` MUST equal `Math.round((gramsMin + gramsMax) / 2)` (derived, not free-form)
  - `pieces` MUST be null
  - `pieceName` MUST be null
  - `confidence` MUST be null
- **Cross-branch:** the `pieces`/`pieceName` pairing invariant always holds (null iff null, non-null iff non-null). Never `pieces = 2` with `pieceName = null`.

Rationale for tightening: cross-model review found the original invariants allowed `gramsRange = [0, 0]` or `[250, 150]` (reversed), which would pass type validation but render nonsense copy at runtime. The positive-ordered-integer constraint catches CSV slips or data-entry errors at seed/response time.

F085's existing `portionSizing` field on the response **remains present** for bot backwards-compatibility (see guarantee below). It is NOT deprecated in v1.

### UI surfacing

**`NutritionCard.tsx` (web)** — currently ignores `portionSizing` entirely. This ticket teaches it to read `portionAssumption`:

- Renders a **new line** below the F-UX-A `PORCIÓN` pill (or below the nutrient grid if no F-UX-A pill is present)
- When both F-UX-A pill and F-UX-B line are present, they MUST be siblings inside a single container `<section aria-labelledby="portion-heading">` so screen readers group them as one logical unit (post-review a11y requirement from Gemini)
- Layout slot: `<div role="note" aria-label="...">…</div>`
- `aria-label` format: `"aproximadamente N pieceName, G gramos"` or (pieces=null variant) `"aproximadamente G gramos"` — MUST contain `"aproximadamente"` in **every** render path (per_dish+pieces, per_dish+null, generic)
- Visual style: secondary text color, smaller than the nutrient numbers, icon optional (TBD by `ui-ux-designer`)

**Copy templates — exact strings to render:**

| `source` | `pieces` | Rendered text | Example |
|---|---|---|---|
| `per_dish` | non-null | `{Term} ≈ ~{pieces} {pieceName} (≈ {grams} g)` | `Tapa ≈ ~2 croquetas (≈ 50 g)` |
| `per_dish` | null | `{Term} ≈ {grams} g` | `Ración ≈ 250 g` |
| `generic` | (always null) | `{Term} estándar: {gramsMin}–{gramsMax} g (estimado genérico)` | `Tapa estándar: 50–80 g (estimado genérico)` |

**`pieceName` is stored literally — no runtime pluralization.** Seed data stores the exact string that will appear in the piece slot — plural form by default (since most raciones and tapas contain > 1 piece, e.g., `croquetas`, `gambas`, `aceitunas`). For single-piece servings, the analyst stores the singular form in the seed CSV (e.g., `croqueta` for a 1-croqueta pincho). The render layer is literal: `~{pieces} {pieceName}` — no `s`-appending logic, no irregular lookups, no pluralization code. Analyst intent captured once, rendered as-is. This is a deliberate simplification called out in cross-model review.

**Term label rendering (the `{Term}` prefix):** uses the user-typed variant from `portionAssumption.termDisplay` (see Q6). Capitalized first letter, rest lowercase. Fallback to canonical `term` if `termDisplay` is missing (edge case, should not happen in practice).

**Accessibility requirements (UI — tighter post-review):**

1. `aria-label` on the portion line MUST contain `"aproximadamente"` in every render path (tested via `getByLabelText(/aproximadamente/)`)
2. **Focus order** — the portion line appears AFTER the F-UX-A PORCIÓN pill in DOM order. When both are present, they MUST be siblings inside a container `<section aria-labelledby="portion-heading">` (hidden-visually heading for screen reader grouping).
3. **Keyboard** — the line is passive (`role="note"`), not focusable. Tab order skips it.
4. **Contrast** — the secondary text color MUST meet WCAG AA contrast ratio (≥ 4.5:1) against the card background in both light and dark themes. `ui-ux-designer` agent specifies the exact token during plan phase.
5. **Test** — Testing Library assertions: `getByRole('note')`, `getByLabelText(/aproximadamente/)`, and (deferred to follow-up if not blocking v1) an `axe-core` contrast check on the rendered card.

**`estimateFormatter.ts` (bot)** — current emoji line `📏 Porción detectada: tapa (50–80 g)` is enhanced:

- When `portionAssumption.source === 'per_dish'` and `pieces != null`: `📏 Porción detectada: tapa (~2 croquetas, ≈ 50 g)`
- When `portionAssumption.source === 'per_dish'` and `pieces == null`: `📏 Porción detectada: ración (≈ 250 g)`
- When `portionAssumption.source === 'generic'`: **byte-identical** to today's output → `📏 Porción detectada: tapa (50–80 g)` — this is the bot regression guarantee

### Bot regression guarantee (non-negotiable)

The 1198 existing bot tests MUST continue to pass **byte-identical** output for every un-seeded dish. Changes to `estimateFormatter.ts` / `comparisonFormatter.ts` can ONLY:

- ADD new rendering when `portionAssumption.source === 'per_dish'` — a branch that didn't exist before
- NEVER modify the existing branch where `source === 'generic'` is the effective default

Quality gate: `npm test -w @foodxplorer/bot` must report **exactly `Tests: 1198 passed`** before the final commit. Any delta → STOP, reassess scope, do not commit.

### Seed CSV pipeline hardening (MANDATORY — added after cross-model review)

Both Codex and Gemini flagged that "silently skip unreviewed rows" is a good analyst-workflow rule but a terrible error-handling rule. The offline seed script (per Q3) MUST distinguish between the two cases:

1. **Header validation** — assert the exact set of required columns exists (`dishId`, `term`, `grams`, `pieces`, `pieceName`, `confidence`, `notes`, `reviewed_by`). A missing or typo'd column → **fail loudly** with the column diff; do NOT proceed.
2. **Row-level type validation** — for every row:
   - `dishId` parses to a positive integer
   - `term` is one of `{pintxo, tapa, media_racion, racion}`
   - `grams` is a positive integer (> 0)
   - `pieces` is null OR a positive integer (≥ 1)
   - `pieceName` is null iff `pieces` is null
   - `confidence` is one of `{high, medium, low}`
   - `reviewed_by` is null OR a non-empty string
   - Any row that fails ANY of these → **fail loudly** with the row number and the failing field; do NOT proceed.
3. **Uniqueness constraint** — `(dishId, term)` pairs must be unique across the CSV. Duplicates → **fail loudly** with both row numbers; do NOT proceed.
4. **Review gate (the ONLY silent path)** — rows where `reviewed_by == null` but ALL other validation passes are silently skipped. At the end, log:
   ```
   Seeded N rows. Skipped M unreviewed rows (reviewed_by == null). 0 errors.
   ```
5. **Idempotency** — re-running the seed script against the same CSV must produce the same DB state. Implementation: upsert by `(dishId, term)` within a transaction, or truncate+reseed if the script is used in a reset-style workflow. ADR candidate.

Rationale: silent skipping is correct for the analyst workflow (incremental review of a large CSV is normal), but silent corruption of structural errors would let a typo'd column header produce an empty seed with no visible failure. The combination of (a) silent review-gate + (b) loud structural errors is the behavior the user needs.

### F042 × F-UX-B clamp-to-1 known intentional behavior (post-review note)

Per Q2, when `Math.round(basePieces × multiplier) = 0`, the clamp forces `1`. Example: `multiplier = 0.25` + `basePieces = 1` → displays `~1 croqueta (≈ 12.5 g)`. Gemini flagged that this is nutritionally imprecise on a **per-piece basis** (implying "1 piece = 12.5 g", which distorts the food's true density). This is intentional and locked per user decision.

**Mitigation in documentation:**
- `docs/specs/api-spec.yaml` documents the clamp under `portionAssumption.pieces` description as **known intentional behavior**
- A unit test asserts the clamp fires for `multiplier ≤ 0.49` on small piece counts
- The F042 nutrient scaling (kcal, macros, grams) is NOT affected — it remains mathematically accurate. The "distortion" is only on the "1 piece" display denominator, which the copy discipline (`~` and `aproximadamente`) communicates as approximate anyway.

### Documentation deliverables (mandatory before merge)

1. **`docs/user-manual-web.md`** — new section on portion-term assumptions (how the card shows tapa/ración assumptions, what the ≈ and ~ symbols mean, what "estimado genérico" means)
2. **`docs/specs/api-spec.yaml`** — add `portionAssumption` to `EstimateData` with the `source: "per_dish" | "generic"` discriminator and every presence rule from `superRefine`
3. **`docs/project_notes/key_facts.md`** — note that `StandardPortion` is now in use (was flagged existing-but-unused in the F-UX-B analysis) and document the 3-tier fallback chain
4. **`docs/project_notes/decisions.md`** — evaluate whether the fallback strategy warrants an ADR. Likely yes — **ADR-020 candidate**: "Per-dish portion assumptions with graceful degradation to F085 generic ranges". Title/scope subject to cross-model review.

---

## Cross-model spec review — 2026-04-12

Two independent reviews of the v1 spec (before the fixes above were applied):

- **Codex** (`codex exec` gpt-5-codex, 226-line response) — read the ticket file directly
- **Gemini** (`gemini-2.5-pro`, 39-line response) — could not read the file due to workspace restrictions (`.gemini/settings.json` points to the wrong workspace root + was invoked from `/tmp`), reviewed from the prompt context only

Both reviews produced useful findings. Gemini's lack of file access reduced the specificity of its findings (no line-number citations), but the overlap with Codex on key concerns validated them as load-bearing.

### Consensus (both models agree)

| # | Finding | Codex | Gemini | Arbitrated action |
|---|---|---|---|---|
| C1 | Copy-test regex `/~\d+ \w+ \(≈ \d+ g\)/` applied to EVERY render path contradicts the bot regression guarantee (which mandates byte-identical today's `tapa (50–80 g)` string containing neither `~` nor `≈`) | M1 | M1 (framed as bot fragility) | **Fixed in Red-flag mitigation #3.** Split tests by `source` branch: regex applies ONLY to `per_dish` outputs; `generic` bot path uses exact-string byte-identity test against a frozen snapshot. |
| C2 | Seed CSV `reviewed_by` gate is correct for review workflow but silent-skip of structural errors (missing headers, duplicate keys, malformed rows) would hide corruption | M2 | M1 | **Fixed in new Seed CSV pipeline hardening subsection.** Loud fail on headers/types/duplicates, silent skip only for valid rows with `reviewed_by == null`. |
| C3 | `EstimateDataSchema.portionAssumption` `superRefine` invariants are too loose — allow `gramsRange = [0, 0]` or reversed `[250, 150]`, and do not fully tie `pieces`/`pieceName`/`pieces >= 1` | M2 | M1 | **Fixed in tightened `superRefine` invariants.** Positive integer constraints, ordered ranges, full `pieces`/`pieceName` pairing invariant, derived `grams` from `gramsRange` when `source === 'generic'`. |
| C4 | Priority-30 dish list has only `gazpacho` and `salmorejo` tagged `(sin pieces)`. Several other dishes on the list (`ensaladilla`, `pulpo a la gallega`, `jamón`, `queso manchego`, `tortilla`, `pan con tomate`, `chorizo`, `morcilla`, `tostas`) are ambiguous for piece semantics | M2 | M2 | **Fixed with new Countable vs. gram-only classification subsection under Q1.** Three buckets: strong-countable (19 dishes), user-tagged sin pieces (2), analyst-decides-at-seed-time (9) with default `pieces = null` when in doubt. User can override per-row in the CSV during review. Verbatim list still locked. |
| C5 | Verification Plan does not cover the `pieces === null` render path explicitly (web + bot) | — | M2 | **Fixed in Verification Plan.** Explicit tests for `per_dish` + `pieces != null`, `per_dish` + `pieces == null`, and `generic` paths on both web and bot. |
| C6 | UI accessibility spec only mandates `aria-label` content ("aproximadamente"), silent on focus order, color contrast, screen reader grouping between F-UX-A pill and F-UX-B line | P2 | P2 | **Fixed in UI accessibility requirements subsection.** Focus order, `aria-labelledby` grouping container, WCAG AA contrast requirement (tokens TBD by `ui-ux-designer` in plan phase), passive `role="note"` keyboard rule, test assertions. |

### Disagreements (arbitrated inline)

| # | Codex position | Gemini position | My arbitration |
|---|---|---|---|
| D1 | Tier 2 fallback applies ONLY to `media ración` + `ración` row. Any `tapa`/`pintxo` query that misses Tier 1 falls through directly to Tier 3 generic. | Expand Tier 2 to derive `tapa = ración × 0.25` and `pincho = ración × 0.15` when only a `ración` row exists. | **Codex wins.** Gemini's proposal reintroduces the exact global ratios that the analysis-phase consensus explicitly rejected (Explore + Codex + Gemini all agreed in the analysis: "per-dish lookup, not global multipliers"). Expanding Tier 2 would produce false precision for dishes where the ratio varies wildly (croquetas tapa = 25% pieces but jamón tapa = 10% weight). **Decision recorded in the Tier 2 non-rule note** with a counter metric so we can observe whether missing rows produce enough generic fallbacks to justify seeding more, rather than inventing ratios. |

### Codex-unique findings

| # | Finding | Severity | Action |
|---|---|---|---|
| CX1 | Red-flag mitigation #5 ("low-confidence weakening") promises weaker copy for low-confidence rows, but Out-of-Scope explicitly defers that exact behavior to a follow-up → internal inconsistency | M3 | **Fixed.** Mitigation #5 rewritten to state the `confidence` field ships but is NOT used for copy in v1, and the weakening rule is explicitly deferred. OOS note updated to reinforce. |

### Gemini-unique findings

| # | Finding | Severity | Action |
|---|---|---|---|
| GX1 | `pieceName` is in the schema but the spec does not explicitly state it flows through to the UI render path as a literal (no pluralization) | M2 | **Fixed in UI surfacing copy templates.** Explicit statement that seed data stores the exact string to render, no runtime pluralization logic, analyst captures intent literally in the CSV. |
| GX2 | Clamp-to-1 behavior (`multiplier = 0.25, basePieces = 1 → ~1 croqueta (≈ 12.5 g)`) is nutritionally imprecise on a per-piece basis and will trigger QA bug reports unless documented as intentional | P1 | **Fixed in new clamp-to-1 known intentional behavior subsection.** Documented in `api-spec.yaml` deliverable (plan-phase). Unit test asserts clamp fires. Note that F042 nutrient scaling is unaffected — the distortion is only in the display denominator. |
| GX3 | Specific `aria-labelledby` grouping suggestion to tie F-UX-A pill and F-UX-B line together for screen readers | P2 | **Accepted into UI accessibility requirements.** Container is `<section aria-labelledby="portion-heading">` with a visually-hidden heading. |

### Final verdict (both models)

- **Codex:** `APPROVE WITH CHANGES — the contradictions around testing/mitigation and the missing validation rules need to be resolved before implementation proceeds.`
- **Gemini:** `APPROVE WITH CHANGES (Requires schema invariants, strict seed data validation, and expanding the (sin pieces) dish list before implementation).`

All findings addressed inline in the spec above (Red-flag mitigation, Q1 classification, Semantic model Tier 2 non-rule, API contract `superRefine`, UI surfacing + a11y, Seed CSV hardening, F042 × F-UX-B clamp note, Verification plan, OOS). Spec v2 is the result.

---

## Out of scope (v1, document explicitly)

- **User personalization** ("para mí, una ración son 6 croquetas")
- **Overrides por cadena/restaurante** (`StandardPortion` is global, not chain-scoped)
- **Admin UI** for editing `StandardPortion` (analyst uses CSV + seed pipeline in v1)
- **LLM at runtime** — offline backfill script only, zero runtime LLM cost
- **Regional variations** (Andalusian, Catalan, Basque, etc.) beyond the `pincho`/`pintxo` display duality
- **Dishes outside the 30-item priority catalog** — fall back to F085 generic
- **Base macros (protein/carbs/fat)** in the card for F-UX-A's base row — already deferred
- **Weakening copy for low-confidence rows** — field exists and ships, visual degradation is a follow-up (explicitly NOT a v1 mitigation; red-flag mitigation list updated to reflect this after cross-model review)
- **Automated WCAG contrast check** in the Testing Library suite — deferred to a follow-up axe-core integration; v1 relies on `ui-ux-designer`-specified tokens + manual spot-check
- **Runtime pluralization** of `pieceName` — seed data captures the analyst-chosen form literally; no pluralization logic ships
- **Expanded Tier 2 fallback** to derive `tapa`/`pintxo` from `ración` via global ratios — explicitly rejected on arbitration (Gemini proposal, Codex + consensus override)
- **`portionSizing` field deprecation** from the API response — kept in v1 alongside the new `portionAssumption` field for bot backwards-compatibility; deprecation is a follow-up when bot migration is complete

---

## Verification plan

**Automated (in the implementation plan — updated post-cross-model review)**

- **Shared schema `superRefine` invariants** — unit tests covering every legal + illegal combination called out in the tightened invariant list above (`per_dish` with null `gramsRange`, `generic` with `[0,0]` range → must fail, `generic` with `[250, 150]` reversed → must fail, `pieces=2` with `pieceName=null` → must fail, etc.)
- **API orchestrator** — integration tests exercising each of the 3 fallback tiers:
  - Tier 1: seeded dish + matching term → `source: "per_dish"` with populated fields
  - Tier 2: seeded dish with only `ración` row + `media ración` query → derived response with `notes: "derived from ración ×0.5"`
  - Tier 2 non-rule: seeded dish with only `ración` row + `tapa` query → falls through to Tier 3 (assert the generic fallback + counter metric increment)
  - Tier 3: unseeded dish → `source: "generic"` with F085 global range
- **Web `NutritionCard` — tests split by render path:**
  - `per_dish` + `pieces != null` → rendered text matches `/~\d+ [a-záéíóúñ]+ \(≈ \d+ g\)/`, `aria-label` matches `/aproximadamente/`
  - `per_dish` + `pieces == null` → rendered text matches `/≈ \d+ g/` AND must NOT contain `~`, `aria-label` matches `/aproximadamente/`
  - `generic` → rendered text equals exactly `{Term} estándar: {N}–{M} g (estimado genérico)`, `aria-label` matches `/aproximadamente/`
  - F-UX-A + F-UX-B combined → both elements are siblings inside a `<section aria-labelledby="portion-heading">` container
- **Bot `estimateFormatter` — tests split by render path:**
  - `per_dish` + `pieces != null` → matches `/~\d+ [a-záéíóúñ]+, ≈ \d+ g/` (note bot uses comma, not parentheses)
  - `per_dish` + `pieces == null` → matches `/≈ \d+ g/`, no `~`
  - **`generic` → exact string equality test against a frozen snapshot of today's F085 output** (bot regression guarantee — 1198 tests byte-identical invariant). A new test suite `bot/__tests__/f-ux-b.generic-byte-identity.test.ts` asserts that for every dish NOT in the priority-30 seed, the rendered string matches the pre-F-UX-B output character-for-character.
- **Copy-discipline regex coverage** — the regex is applied ONLY in the `per_dish` branch tests. The `generic` branch tests use exact-string equality. The split is explicit (correction from the internally contradictory v1 of the spec).
- **Seed pipeline tests:**
  - Header validation: malformed CSV header → script exits with column-diff error
  - Row validation: row with `dishId = "abc"`, `grams = -1`, or `pieceName` set with `pieces = null` → script exits with row number + field
  - Uniqueness: duplicate `(dishId, term)` rows → script exits with both row numbers
  - Review gate: rows with `reviewed_by == null` are silently skipped, counts logged
  - Idempotency: re-run against the same CSV produces the same DB state
- **F042 × F-UX-B composition tests:**
  - `multiplier = 1.5`, `basePieces = 8` → `displayedPieces = 12` (happy path)
  - `multiplier = 0.25`, `basePieces = 1` → clamp-to-1 fires, `displayedPieces = 1` (clamp test with explicit assertion message)
  - `multiplier = 1.0`, `basePieces = 0` (edge: should never happen per schema invariants, but test anyway) → schema rejects

**Manual post-merge (user action)**
- `/hablar` query: "ración grande de croquetas" → card shows `PORCIÓN GRANDE` pill + `Ración ≈ ~12 croquetas (≈ 360 g)` line inside the grouped section
- `/hablar` query: "tapa de croquetas" → card shows no F-UX-A pill + `Tapa ≈ ~2 croquetas (≈ 50 g)` line
- `/hablar` query: "media ración de gazpacho" → card shows `Media ración ≈ 125 g` (pieces=null path, Tier 2 arithmetic with `pieces` staying null)
- `/hablar` query: "tapa de gazpacho" → Tier 1 hit if seeded, else Tier 3 generic `Tapa estándar: 50–80 g (estimado genérico)` (Tier 2 does NOT apply)
- `/hablar` query: "tapa de manchego curado" (not in priority-30) → card shows `Tapa estándar: 50–80 g (estimado genérico)`
- Bot Telegram: same 5 queries → verify bot rendering matches expectations (and generic path is byte-identical to today's output on at least one un-seeded dish)
- Screen reader smoke test (macOS VoiceOver): navigate to the portion line → verify "aproximadamente" is spoken on all three render paths

---

## What happens next

1. **Cross-model spec review** — Codex (`codex exec` gpt-5-codex) + Gemini (`gemini-2.5-pro`) in parallel, format identical to F-UX-A: table of disagreements arbitrated inline
2. **User approval of spec** (checkpoint — constraint #10, PR-mode, L5 autonomous)
3. **Plan phase:**
   a. `ui-ux-designer` agent (BEFORE any planner agent — feedback memory)
   b. `backend-planner` + `frontend-planner` in parallel
   c. Cross-model plan review (Codex + Gemini)
   d. User approval of plan (checkpoint)
4. **Implementation (TDD, dependency order):** shared → prisma migration + seed → api orchestrator → web NutritionCard → bot formatter
5. **Quality gates → `code-review-specialist` + `qa-engineer` → merge checklist → `/audit-merge` → merge approval → squash-merge → Step 6 finalization → post-merge tracker sync PR**

---

*Analysis complete 2026-04-12. Spec v1 written 2026-04-12 (commit `5eb5e84`). Cross-model spec review (Codex + Gemini) run 2026-04-12 with 7 consensus findings + 1 disagreement arbitrated. Spec v2 (this revision) addresses all M1/M2/M3 findings inline + documents P1/P2 and the D1 disagreement. Awaiting user approval before plan phase.*
