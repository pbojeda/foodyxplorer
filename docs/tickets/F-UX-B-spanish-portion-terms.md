# F-UX-B — Expose assumptions behind Spanish serving-size terms (pincho / tapa / media ración / ración)

**Feature:** F-UX-B | **Type:** Fullstack-Feature | **Priority:** Standard
**Status:** Spec v2.1 — user audit applied (GX2 fall-through + 3 clarifications), awaiting checkpoint approval before plan phase
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

- `scaledPieces = basePieces × multiplier` (float, not yet rounded)
- **Low-multiplier fall-through (updated spec v2.1 after user review of GX2):** if `scaledPieces < 0.75`, do **NOT** render pieces at all — fall through to the existing `pieces === null` render path, which shows only grams + nutrients. Rationale: rounding 0.5 pieces up to 1 and displaying `~1 croqueta (25 kcal)` creates a false semantic mismatch (user reads "1 croqueta = 25 kcal" when the truth is "0.5 croquetas = 25 kcal"). The `~`/`≈` symbols mitigate gram imprecision but cannot mitigate a wrong unit count. Dropping pieces entirely is better than lying with a clamped `1`.
- **High enough to round normally:** if `scaledPieces >= 0.75`, `displayedPieces = Math.max(1, Math.round(scaledPieces))`. The `Math.max(1, …)` guard still protects against exactly-zero edge cases (e.g., `basePieces = 0` via data bug), but the practical floor is now 0.75, which rounds to 1 and is close enough to the user's mental model (you can legitimately display `~1` when the real value is 0.8 of a piece).

**Threshold table:**

| `basePieces` | `multiplier` | `scaledPieces` | Action | Rendered |
|---:|---:|---:|---|---|
| 8 | 1.5 | 12.0 | round → 12 | `~12 croquetas (≈ 360 g)` |
| 2 | 0.5 | 1.0 | round → 1 | `~1 croqueta (≈ 25 g)` |
| 2 | 0.4 | 0.8 | round → 1 (≥ 0.75) | `~1 croqueta (≈ 20 g)` |
| 2 | 0.3 | 0.6 | **fall-through** (< 0.75) | `≈ 15 g` (no pieces) |
| 1 | 0.25 | 0.25 | **fall-through** (< 0.75) | `≈ 12.5 g` (no pieces) |
| 8 | 0.05 | 0.4 | **fall-through** (< 0.75) | `≈ 12 g` (no pieces) |

**Key property:** the fall-through **reuses the existing `pieces === null` render path** — no new conditional branches in UI or bot, no new copy template, no new schema field. The orchestrator decides at build time whether to include `pieces` in the `portionAssumption` response object, and the render layer does what it already does for `pieces === null`. Zero new casuistry downstream.

Example: `ración grande de croquetas` with base 8 croquetas × 1.5 = `~12 croquetas (≈ 360 g)` on the card (normal round path).

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
   - **Explicit non-rule (added after cross-model review — Gemini proposed expanding Tier 2 to `tapa = ración × 0.25` and `pincho = ración × 0.15`, rejected on arbitration):** Tier 2 does NOT apply to `tapa` / `pintxo` queries even when a `ración` row exists. The whole point of the per-dish data model is to reject global ratios — `tapa = ración × 0.25` is exactly the kind of false precision the analysis phase rejected via Explore + Codex + Gemini consensus. Any `tapa`/`pintxo` query that misses Tier 1 falls through directly to Tier 3 generic.
   - **Observability (spec v2.1, clarified after user review):** when a `tapa`/`pintxo` query falls through to Tier 3 *because* only a `ración` row existed (not because the dish is unseeded entirely), the orchestrator sets a discriminator field on the response so it can be captured by structured logging downstream. **Implementation: API response field `portionAssumption.fallbackReason: "no_row" | "tier2_rejected_tapa" | "tier2_rejected_pintxo" | null`.** `null` when `source === 'per_dish'`. `"no_row"` when no row exists for this dish at all. `"tier2_rejected_tapa"` / `"tier2_rejected_pintxo"` when a `ración` row exists but the user asked for a term Tier 2 refuses to derive. The API consumer (web, bot) ignores this field for rendering — it's consumed by structured logs / future analytics. Backend emits a structured log line per response with this field, standard Pino JSON shape. **NOT a DB column, NOT an in-memory counter, NOT a batch metric** — just a response-level discriminator that drops into whatever log pipeline already exists. `backend-planner` wires the log emission; `frontend-planner` confirms the field is ignored by render layers.
3. **Tier 3 — F085 generic fallback.** Any portion term query that fails Tier 1 and is not eligible for Tier 2 (per above) → return the current F085 global range `{ gramsMin, gramsMax }` with `source: "generic"`, `pieces: null`, `pieceName: null`. UI renders the weaker copy.

F042 `portionMultiplier` composes on top of the resolved assumption (per Q2). The multiplier applies to both `nutrients` (F-UX-A's existing behavior) AND `portionAssumption.grams/pieces` (new).

### API contract (`EstimateDataSchema` extension)

New optional field on `EstimateData`:

```ts
portionAssumption?: {
  term: string,                // 'pintxo' | 'tapa' | 'media ración' | 'ración' — canonical key
  termDisplay: string,         // user-typed variant (e.g., "pincho" or "pintxo") for UI rendering
  source: 'per_dish' | 'generic',
  grams: number,               // post-F042-multiplier
  pieces: number | null,       // post-F042 fall-through: null when basePieces×multiplier<0.75
  pieceName: string | null,    // literal string from seed data, no runtime pluralization
  gramsRange: [number, number] | null,  // only when source === 'generic' (from F085 global map)
  confidence: 'high' | 'medium' | 'low' | null,  // null when source === 'generic'
  fallbackReason: 'no_row' | 'tier2_rejected_tapa' | 'tier2_rejected_pintxo' | null
  // null when source === 'per_dish' AND Tier 1 or Tier 2 hit cleanly
  // 'no_row' when source === 'generic' because no row existed for (dishId, term)
  // 'tier2_rejected_*' when source === 'generic' because a ración row existed but the
  //   query asked for a term Tier 2 refuses to derive via arithmetic
  // consumed by backend structured logs (Pino JSON), ignored by web/bot render layers
}
```

**Paired `superRefine` invariants** (following the F-UX-A pattern; tightened after cross-model review):

- **`source === 'per_dish'` branch:**
  - `grams` MUST be a positive integer (> 0)
  - `gramsRange` MUST be null
  - `confidence` MUST be one of `'high' | 'medium' | 'low'` (non-null)
  - `pieces` is null OR a positive integer (≥ 1, low-multiplier fall-through enforced upstream: if `basePieces × multiplier < 0.75` the orchestrator returns `pieces: null`)
  - `pieceName` is null iff `pieces` is null
  - `fallbackReason` MUST be null
- **`source === 'generic'` branch:**
  - `gramsRange` MUST be present as `[gramsMin, gramsMax]` with `gramsMin > 0`, `gramsMax > gramsMin`, both **integers**
  - `grams` MUST equal `Math.round((gramsMin + gramsMax) / 2)` (derived, not free-form)
  - `pieces` MUST be null
  - `pieceName` MUST be null
  - `confidence` MUST be null
  - `fallbackReason` MUST be one of `'no_row' | 'tier2_rejected_tapa' | 'tier2_rejected_pintxo'` (non-null)
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

### Seed CSV pipeline hardening (MANDATORY — added after cross-model review, clarified spec v2.1)

Both Codex and Gemini flagged that "silently skip unreviewed rows" is a good analyst-workflow rule but a terrible error-handling rule. The offline seed script (per Q3) MUST distinguish between the two cases — **and the validation passes run against ALL rows, reviewed or not.** The silent-skip is a workflow gate, not a quality gate.

**Validation order (per CSV run):**

1. **Header validation (whole-file, fail-loud)** — assert the exact set of required columns exists (`dishId`, `term`, `grams`, `pieces`, `pieceName`, `confidence`, `notes`, `reviewed_by`). A missing or typo'd column → **fail loudly** with the column diff; do NOT proceed to any row.
2. **Row-level type validation (every row, reviewed or not, fail-loud)** — for every row in the CSV:
   - `dishId` parses to a positive integer
   - `term` is one of `{pintxo, tapa, media_racion, racion}`
   - `grams` is a positive integer (> 0)
   - `pieces` is null OR a positive integer (≥ 1)
   - `pieceName` is null iff `pieces` is null
   - `confidence` is one of `{high, medium, low}`
   - `reviewed_by` is null OR a non-empty string
   - Any row that fails ANY of these → **fail loudly** with row number + failing field + `reviewed_by` status (so the analyst knows whether this was a structural error in an unreviewed row or in a reviewed row).
   - **Critical (spec v2.1 clarification):** a malformed row with `reviewed_by == null` still halts the run. We do NOT want a typo in an unreviewed row to disappear silently — the unreviewed rows will eventually become reviewed, and a bug planted now would poison the pipeline later. The only silent gate is at Step 4 below, AFTER structural validation has passed.
3. **Uniqueness constraint (whole-file, fail-loud)** — `(dishId, term)` pairs must be unique across the CSV. Duplicates → **fail loudly** with both row numbers.
4. **Review gate — the ONLY silent path, applied AFTER structural validation passes** — once all rows have passed header, type, and uniqueness validation, the script partitions them by `reviewed_by`:
   - `reviewed_by != null` → seeded
   - `reviewed_by == null` → silently skipped (not seeded, not logged per-row)
   At the end, log a single summary line:
   ```
   Seeded N rows. Skipped M unreviewed rows (reviewed_by == null). 0 errors.
   ```
   If M > 0, this is a workflow signal to the analyst (there are still rows to review), NOT an error.
5. **Idempotency** — re-running the seed script against the same CSV must produce the same DB state. Implementation: upsert by `(dishId, term)` within a transaction, or truncate+reseed if the script is used in a reset-style workflow. ADR candidate.

**Rationale (spec v2.1 emphasis):** silent skipping is correct for the analyst workflow (incremental review of a large CSV is normal over days/weeks). Silent corruption of structural errors would let a typo'd column header produce an empty seed with no visible failure. The combination of (a) structural validation on ALL rows regardless of review status + (b) silent review-gate as the last step = the behavior the user needs. The order is important: validate first, gate second.

### F042 × F-UX-B low-multiplier pieces fall-through (spec v2.1)

**Problem addressed:** an earlier draft of this spec documented a hard `clamp-to-1` on `Math.round(basePieces × multiplier) = 0`. Cross-model review (Gemini GX2) flagged that clamping to `1` creates a false semantic mismatch: the nutrient values are correctly scaled (`25 kcal` for `base 2 croquetas × multiplier 0.25`) but the displayed piece count reads `1`, so the user's mental model becomes `"1 croqueta = 25 kcal"` when the truth is `"0.5 croquetas = 25 kcal"`. The `~`/`≈` symbols can communicate gram imprecision but cannot rescue a wrong unit denominator. User agreed on the spec-v2 review and the fix became:

**Rule (definitive):**

- `scaledPieces = basePieces × multiplier`
- **If `scaledPieces < 0.75`** → drop pieces from the response. The orchestrator returns `portionAssumption` with `pieces: null` and `pieceName: null`. The render path is the existing `per_dish` + `pieces === null` path: `{Term} ≈ {grams} g` on the card, `📏 Porción detectada: {term} (≈ {grams} g)` in the bot.
- **If `scaledPieces >= 0.75`** → `displayedPieces = Math.max(1, Math.round(scaledPieces))`. The `Math.max(1, …)` guard is defensive against data bugs (e.g., `basePieces = 0`); in normal operation `scaledPieces >= 0.75` always rounds to at least 1.
- Nutrient scaling (kcal, macros, grams) is **unaffected** — F042 continues to scale nutrients by the exact multiplier regardless of the piece-display decision. The fall-through only suppresses the piece-count rendering, not the nutrient math.

**Why 0.75 and not 0.5:** rounding `0.5` up to `1` still produces the same false precision on a per-piece basis. `0.75` is the smallest value that rounds to `1` without noticeably lying — the user sees `~1 croqueta` when the real count is 3/4 of a piece, which the `~` qualifier honestly communicates as "approximately one". At `0.74` we're asserting "approximately one" for something that's closer to half, which the qualifier cannot rescue.

**Why reuse the `pieces === null` path:**

- Zero new render branches in web or bot
- Zero new schema fields (the field already exists and is nullable per the baseline invariants)
- The `pieces === null` render path was already going to ship for gazpacho/salmorejo/etc., so we're not introducing a new code path — we're reusing one that's already tested
- Symmetric with generic fallback (Tier 3) which also renders gram-only

**Test coverage:**

- Unit test: `multiplier = 0.3, basePieces = 2 → scaledPieces = 0.6 < 0.75 → pieces dropped, response has pieces=null, pieceName=null, grams and nutrients still scaled by 0.3`
- Unit test: `multiplier = 0.4, basePieces = 2 → scaledPieces = 0.8 >= 0.75 → pieces = 1`
- Unit test: `multiplier = 0.5, basePieces = 2 → scaledPieces = 1.0 → pieces = 1`
- Unit test: `multiplier = 1.5, basePieces = 8 → pieces = 12` (happy path regression)
- Rendering test (web + bot): fall-through case produces the same output as a natively-null dish (e.g., gazpacho), validated via snapshot or contains-check
- Threshold boundary test: `scaledPieces = 0.749999 → fall-through`, `scaledPieces = 0.75 → rounds to 1`

**Documentation in `api-spec.yaml` deliverable:** `portionAssumption.pieces` description explicitly states "null when `basePieces × multiplier < 0.75`, to avoid false precision on display" so API consumers know the semantics.

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
| GX2 | Clamp-to-1 behavior (`multiplier = 0.25, basePieces = 1 → ~1 croqueta (≈ 12.5 g)`) is nutritionally imprecise on a per-piece basis and will trigger QA bug reports unless documented as intentional | P1 → **M1 after user checkpoint on spec v2** | **Spec v2.1 upgrade: fix changed from "document as intentional" to "eliminate the semantic mismatch entirely."** User agreed on the spec-v2 checkpoint that the `~`/`≈` qualifiers protect gram imprecision but cannot rescue a wrong unit denominator — clamping `0.5 croquetas` to `~1 croqueta` still tells the user "1 piece = 25 kcal" when the truth is "0.5 pieces = 25 kcal". **New rule: low-multiplier pieces fall-through.** If `basePieces × multiplier < 0.75`, drop pieces entirely and render the existing `pieces === null` path (grams + nutrients only). Reuses the null render path that already ships for gazpacho/salmorejo, zero new casuistry. Threshold 0.75 chosen because it's the smallest value that rounds to 1 without noticeably lying. Q2 rewritten with the new rule + threshold table, "F042 × F-UX-B" subsection renamed "low-multiplier pieces fall-through" with full rationale, test plan replaced clamp tests with fall-through tests, `api-spec.yaml` deliverable documents the threshold. |
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
  - **`generic` → Jest snapshot test with checked-in golden files** (bot regression guarantee, clarified spec v2.1). New test file `packages/bot/src/formatters/__tests__/f-ux-b.generic-byte-identity.test.ts` with a companion `__snapshots__/f-ux-b.generic-byte-identity.test.ts.snap` directory checked into git. Mechanism:
    - The test runs a list of representative queries targeting dishes NOT in the priority-30 seed (so they MUST hit Tier 3 generic)
    - For each query, the test invokes `estimateFormatter.format(...)` with a mocked API response representing Tier 3 generic output
    - The rendered string is compared via `toMatchSnapshot()` against the checked-in golden file
    - **The golden files are generated ONCE from current (pre-F-UX-B) formatter output at the start of implementation, committed to git, and treated as immutable.** Any future PR that modifies them triggers snapshot failures until the author explicitly updates the golden (with a code review on the diff).
    - Uses `toMatchSnapshot()`, NOT `toMatchInlineSnapshot()` — external file on purpose so the golden strings live next to test code and are reviewable as a unit.
  - **Explicit query list for the snapshot suite (queries targeting un-seeded dishes, chosen to cover the term and pieces-modifier axis):**
    1. `"tapa de paella"` — paella is not in the priority-30, tapa term, expect `tapa (50–80 g)`
    2. `"pincho de pulpo"` — pulpo IS in the priority-30 but listed under analyst-decides; for this test we use a different spelling `"pulpo gallego"` or an un-seeded alias to guarantee Tier 3
    3. `"media ración de gambas al horno"` — specifically "al horno" (not "al ajillo", which IS in the priority-30)
    4. `"ración de lentejas"` — lentejas not in the priority-30, ración term
    5. `"tapa de solomillo"` — solomillo not in the priority-30
    6. `"pintxo de txipiron"` — unambiguous un-seeded dish using Basque spelling of the query
    7. `"ración de cocido"` — cocido not in the priority-30
  - **Snapshot creation rule:** the snapshots are generated by running the test suite ONCE against the current formatter BEFORE any F-UX-B formatter changes land. The resulting `.snap` file is committed as part of the first F-UX-B implementation commit. Subsequent commits must not modify it unless the bot formatter's `generic` path intentionally changes — and any such change requires a documented decision in `bugs.md` or `decisions.md`.
  - **Rationale for snapshot (not regex/contains):** regex and contains-checks would let subtle bugs slip through (extra whitespace, wrong emoji, wrong punctuation). Byte-for-byte equality is the only way to enforce the 1198-test regression invariant. Snapshots are the standard Jest mechanism for this and are reviewable in diffs.
- **Copy-discipline regex coverage** — the regex is applied ONLY in the `per_dish` branch tests. The `generic` branch tests use exact-string equality. The split is explicit (correction from the internally contradictory v1 of the spec).
- **Seed pipeline tests:**
  - Header validation: malformed CSV header → script exits with column-diff error
  - Row validation: row with `dishId = "abc"`, `grams = -1`, or `pieceName` set with `pieces = null` → script exits with row number + field
  - Uniqueness: duplicate `(dishId, term)` rows → script exits with both row numbers
  - Review gate: rows with `reviewed_by == null` are silently skipped, counts logged
  - Idempotency: re-run against the same CSV produces the same DB state
- **F042 × F-UX-B composition tests (spec v2.1 — fall-through replaces clamp-to-1):**
  - `multiplier = 1.5`, `basePieces = 8` → `scaledPieces = 12.0 → pieces = 12` (happy path)
  - `multiplier = 0.5`, `basePieces = 2` → `scaledPieces = 1.0 → pieces = 1` (normal round, at the threshold)
  - `multiplier = 0.4`, `basePieces = 2` → `scaledPieces = 0.8 ≥ 0.75 → pieces = 1` (round up legitimately)
  - `multiplier = 0.3`, `basePieces = 2` → `scaledPieces = 0.6 < 0.75 → **pieces dropped** (response has `pieces: null`, `pieceName: null`, grams and nutrients still scaled by 0.3)`
  - `multiplier = 0.25`, `basePieces = 1` → `scaledPieces = 0.25 < 0.75 → **pieces dropped**`
  - Threshold boundary test: `scaledPieces = 0.749999 → pieces dropped`, `scaledPieces = 0.75 → pieces = 1`
  - Render regression: fall-through render output MUST match a natively-null dish's output (e.g., gazpacho) byte-for-byte, validated via snapshot or `toEqual` assertion on the rendered string
  - `multiplier = 1.0`, `basePieces = 0` (edge: should never happen per schema invariants — seed pipeline rejects `pieces = 0`) → schema `superRefine` rejects at build time

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

## UI/UX design notes (ui-ux-designer, 2026-04-13)

### 1. Visual hierarchy

The card has three layers of nutritional information, from primary to tertiary:

1. **Primary** — kcal number (`text-[28px] font-extrabold text-brand-orange`). The number the user asked for.
2. **Secondary** — F-UX-A pill (`PORCIÓN GRANDE`) + F-UX-B portion-assumption line. Both qualify *what* is being measured.
3. **Tertiary** — macros grid (proteins / carbs / fats), allergens, source footer.

The F-UX-B line is secondary, not tertiary — it contextualizes the kcal number just as the F-UX-A pill does. It must be visible at a glance without competing with the kcal.

**Default state (F-UX-B only, no F-UX-A pill):**
```
[Food name]                      [confidence badge]
─────────────────────────────────────────────────
428                                        ← kcal
KCAL
Tapa ≈ ~2 croquetas (≈ 50 g)             ← F-UX-B line
─────────────────────────────────────────────────
12g PROTEÍNAS  38g CARBOHIDRATOS  22g GRASAS
```

**Combined state (F-UX-A pill + F-UX-B line, both present):**
```
[Food name]                      [confidence badge]
[PORCIÓN GRANDE]                             ← F-UX-A pill (amber)
Ración ≈ ~12 croquetas (≈ 360 g)           ← F-UX-B line
─────────────────────────────────────────────────
856                                        ← kcal
KCAL
base: 428 kcal                             ← F-UX-A subtitle
─────────────────────────────────────────────────
24g PROTEÍNAS  76g CARBOHIDRATOS  44g GRASAS
```

### 2. Order of pill / subtitle / F-UX-B line

When both F-UX-A and F-UX-B are present, order is: **PILL → F-UX-B line → kcal block (with `base:` subtitle inside it).**

Rationale: the pill and the F-UX-B line are both portion qualifiers. They belong together, before the number. Splitting them around the kcal block (pill above, subtitle below) would be less confusing for screen readers and visually cohesive. The `base: N kcal` subtitle lives inside the kcal block because it qualifies the number, not the portion.

### 3. Color + typography tokens

| Element | Tailwind classes | Notes |
|---|---|---|
| F-UX-B line container | `mt-1 text-[12px] leading-snug` | Sits directly below the pill or header |
| Term label (`Tapa`, `Ración`) | `font-semibold text-slate-600` | Slightly bolder than the rest of the line. `text-slate-600` (#475569) on `bg-white` = 5.9:1 — passes WCAG AA |
| Piece/gram text (`≈ ~2 croquetas (≈ 50 g)`) | `font-normal text-slate-500` | `text-slate-500` (#64748B) on `bg-white` = 4.6:1 — passes AA at 12px bold-ish context (technically AA Large requires 3:1; AA normal requires 4.5:1 — this passes) |
| `estimado genérico` qualifier | `italic text-slate-400` | Visibly weaker. `text-slate-400` (#94A3B8) on white = 3.3:1. Since this text is 12px italic, it falls below AA 4.5:1. **Use `text-slate-500` instead for AA compliance.** Keep `italic` for visual differentiation. |
| Font size | `text-[12px]` | One step below `text-[11px]` badge labels. Does not compete with `text-lg` macro numbers. |
| Line height | `leading-snug` (1.375) | Comfortable for 2-line wraps on mobile. |
| Letter spacing | none (default) | The uppercase badge already handles tracking; this line uses natural prose spacing. |

### 4. Icon treatment

No icon. Rationale: the `≈` and `~` symbols in the copy are already semantic markers of approximation. Adding a scale icon or ruler emoji would add noise at 12px on a narrow mobile card, and the line sits close enough to the amber pill to inherit its context. The `role="note"` grouping handles screen reader semantics without an icon. If a future iteration adds a `confidence` visual signal, revisit then.

### 5. Spacing

| Gap | Value | Tailwind |
|---|---|---|
| After F-UX-A pill → F-UX-B line | 4px | `mt-1` on F-UX-B container |
| After header (no pill) → F-UX-B line | 6px | `mt-1.5` on F-UX-B container (matches existing pill `mt-1.5`) |
| After F-UX-B line → kcal block | 12px | `mt-3` on the kcal `<div>` — existing value, no change |
| Horizontal padding | inherits card `p-4` / `md:p-5` | No extra indent; flush with card padding |

The card is `p-4` (16px) on mobile and `md:p-5` (20px) on desktop. The F-UX-B line uses full card width — no additional horizontal inset.

### 6. Responsive behavior

The card is capped at ~360px mobile / ~480px desktop. Longest realistic line: `Media ración ≈ ~6 pimientos de padrón (≈ 120 g)` (~48 chars). At `text-[12px]` and ~320px usable width (360px − 2×16px padding), this wraps to two lines.

**Rule: allow natural wrap, never truncate, never shrink font below 12px.** `leading-snug` (1.375) keeps the two-line wrap compact (approx 33px tall). No `truncate`, no `whitespace-nowrap`, no `text-[10px]` fallback. The card is designed for information density; a two-line secondary annotation is expected and fine.

### 7. Animation / transition

The existing card mounts with `card-enter` (a CSS animation class already on `<article>`). The F-UX-B line is inside the card — it appears as part of the card mount, no separate animation needed.

If the line content changes in-place (same card, different query result updating state), match the approach F-UX-A uses: no explicit transition on the pill today, so no transition on the F-UX-B line either. Abrupt swap is acceptable — the card re-render is the user's signal of a new result. TBD — frontend-planner to confirm whether F-UX-A pill has a transition class that should be inherited.

### 8. Empty state

When `portionAssumption` is absent from the API response (e.g., raw ingredients like "100g de croquetas" — no portion term detected), the F-UX-B line **must not render at all**. No placeholder, no dashes, no `—`. The card looks exactly as it does today for these queries. This is a conditional render on `estimateData.portionAssumption !== undefined`.

### 9. Accessibility — JSX skeleton

```jsx
{/* Portion section — wraps F-UX-A pill + F-UX-B line when either is present */}
{(hasModifier || portionAssumption) && (
  <section aria-labelledby="portion-heading" className="mt-1.5">
    <h3 id="portion-heading" className="sr-only">Información de porción</h3>

    {/* F-UX-A pill — existing, unchanged */}
    {hasModifier && (
      <p aria-hidden="true">
        <span className="inline-block rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
          {pillLabel}
        </span>
      </p>
    )}

    {/* F-UX-B portion assumption line */}
    {portionAssumption && (
      <div
        role="note"
        aria-label={portionAssumptionAriaLabel}  // composed below
        className="mt-1 text-[12px] leading-snug"
      >
        {/* rendered copy — see copy templates in spec */}
      </div>
    )}
  </section>
)}
```

**`aria-label` composition per render path** (all paths MUST contain `"aproximadamente"`):

| Path | `aria-label` value |
|---|---|
| `per_dish` + `pieces != null` | `"aproximadamente {pieces} {pieceName}, unos {grams} gramos"` |
| `per_dish` + `pieces == null` | `"aproximadamente {grams} gramos"` |
| `generic` | `"aproximadamente entre {gramsMin} y {gramsMax} gramos, estimado genérico"` |

Focus order: the `<section>` is not focusable. The `<div role="note">` is not focusable. Tab order is unchanged. The `sr-only` heading gives screen readers a landmark label without adding a tab stop.

Deferred: `axe-core` contrast check on the rendered card — noted in OOS as a follow-up axe-core integration.

### 10. Open questions for backend-planner / frontend-planner

1. **Missing `termDisplay`** — the spec says fall back to canonical `term` if `termDisplay` is absent. Frontend-planner should confirm the fallback is a simple `portionAssumption.termDisplay ?? portionAssumption.term` and that the capitalisation helper (first-letter uppercase, rest lowercase) lives in a shared util, not inline in the component.

2. **`gramsRange[0] === gramsRange[1]` in generic path** — the `superRefine` invariant requires `gramsMax > gramsMin`, so this should never reach the UI. Backend-planner to confirm the invariant is enforced before any render path is written for the `{N}–{M}` template.

3. **`section` id collision** — `id="portion-heading"` is a hard-coded string. If two `NutritionCard` components appear on the same page (e.g., comparison view), both will share the same `id`, breaking the `aria-labelledby` link. Frontend-planner to decide: accept the risk (single-card pages are the norm), or generate a unique id per card instance (e.g., via `useId()`).

4. **F-UX-A pill `mt-1.5` removal** — currently the pill is wrapped in `<p className="mt-1.5">` outside any section. When the section wrapper is introduced, that `mt-1.5` moves to the `<section>` itself. Frontend-planner to confirm no visual regression on the pill spacing when this restructure lands.

5. **`card-enter` animation scope** — confirm whether `card-enter` triggers on every state change or only on initial mount. If it re-fires on in-place updates, the F-UX-B line will animate in/out on every query change, which may feel jittery. Frontend-planner to assess.

---

*Analysis complete 2026-04-12. Spec v1 written 2026-04-12 (commit `5eb5e84`). Cross-model spec review (Codex + Gemini) run 2026-04-12 with 7 consensus findings + 1 disagreement arbitrated. Spec v2 (this revision) addresses all M1/M2/M3 findings inline + documents P1/P2 and the D1 disagreement. Awaiting user approval before plan phase.*

---

## Frontend implementation plan (frontend-planner, 2026-04-13)

### 1. Component restructure — before / after

**Current DOM order (NutritionCard.tsx lines 94–142):**
```
<article>
  <header>  ← dish name + ConfidenceBadge
  <p mt-1.5>  ← F-UX-A pill (conditional)
  <div mt-3>  ← kcal + KCAL label + base subtitle (conditional)
  <div mt-3>  ← macro grid
  <div mt-3>  ← allergens (conditional)
  <footer>    ← source (conditional)
</article>
```

**Target DOM order (ui-ux-designer decision — PILL → F-UX-B line → kcal block):**
```
<article>
  <header>   ← unchanged
  <section aria-labelledby="portion-heading-{id}" mt-1.5>  ← NEW wrapper (conditional: hasModifier || portionAssumption)
    <h3 id="portion-heading-{id}" className="sr-only">Información de porción</h3>
    <p aria-hidden="true">  ← F-UX-A pill (unchanged markup, moved inside section)
    <div role="note" aria-label={...} mt-1>  ← NEW F-UX-B line (conditional: portionAssumption)
  </section>
  <div mt-3>  ← kcal + KCAL label + base subtitle (base subtitle stays here)
  <div mt-3>  ← macro grid (unchanged)
  <div mt-3>  ← allergens (unchanged)
  <footer>    ← source (unchanged)
</article>
```

**Elements that move:**
- Lines 104–110 (F-UX-A `<p className="mt-1.5">` pill wrapper) → moves inside `<section>`. The `mt-1.5` migrates from the `<p>` to the `<section>` itself (first item inside section has no top margin; section gets `mt-1.5`).
- Lines 115–119 (`base: N kcal` subtitle) stays in the kcal `<div>` — it qualifies the kcal number, not the portion. No move needed.

**Visual regression check for F-UX-A after restructure:** all existing F-UX-A assertions (`screen.getByText('PORCIÓN GRANDE')`, `screen.getByText('base: 550 kcal')`, macro values) use `getByText` / `getByRole` — none rely on DOM order or structural parent selectors. The restructure is safe without test changes. Confirm by running `npm test -w @foodxplorer/web` after step 4 of the TDD order below.

**Snapshot risk:** grep confirms no `.snap` files for `NutritionCard` in `packages/web`. No snapshot breakage.

**`card-enter` animation scope:** `card-enter` is on `<article>`. The card is fully re-rendered on each new query result (parent component replaces the whole card). It does not re-fire within a stable card instance. No jitter risk for the F-UX-B line.

---

### 2. F-UX-B line: inline JSX block, not a separate file

**Decision: inline JSX inside `NutritionCard.tsx`, not a separate component file.**

Rationale: `portionAssumption` is consumed nowhere else in the codebase. A separate `NutritionCard.PortionAssumption.tsx` would be a single-consumer file that adds indirection with no reuse benefit. The copy-rendering logic (3 branches, one helper function) is compact enough to live inline. The `<section aria-labelledby>` wrapper spans both F-UX-A pill and F-UX-B line, so the wrapper necessarily lives in the card — splitting the inner `<div role="note">` into a subcomponent would require prop-drilling `portionAssumption` + `ariaLabel` anyway.

**Testability:** the new test file tests the card as a whole, which is the right level of isolation for a purely presentational component. No unit-testing benefit from extracting.

---

### 3. Copy rendering logic

**Helper function** `buildPortionAssumptionText(pa: PortionAssumption): string` — extract as a pure function near the top of the component module (below the `MacroItem` subcomponent or in a colocated util), not inline in JSX. This makes it trivially unit-testable and keeps the JSX readable.

**Branch selection: `switch` on `pa.source`**, with a nested ternary for `pieces` inside the `per_dish` branch:

```
switch (pa.source) {
  case 'per_dish':
    return pa.pieces !== null
      ? `{Term} ≈ ~{pa.pieces} {pa.pieceName} (≈ {pa.grams} g)`
      : `{Term} ≈ {pa.grams} g`
  case 'generic':
    return `{Term} estándar: {pa.gramsRange![0]}–{pa.gramsRange![1]} g (estimado genérico)`
}
```

**`{Term}` derivation:** `capitalize(pa.termDisplay ?? pa.term)` where `capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1)`. This one-liner lives inline in the helper. The `termDisplay ?? term` fallback resolves open question #1 from ui-ux-designer: no shared util needed — the fallback is trivial and card-local.

**`estimado genérico` styling:** a `<span className="italic">` wrapping the literal `estimado genérico` substring. The rest of the text renders as plain text nodes inside the `<div>`. Do not use `<em>` — `<em>` adds semantic stress emphasis that screen readers may announce; `<span className="italic">` is purely visual.

**`aria-label` composition** — a second pure helper `buildPortionAssumptionAriaLabel(pa: PortionAssumption): string`:

| Path | aria-label |
|---|---|
| `per_dish` + `pieces != null` | `"aproximadamente {pa.pieces} {pa.pieceName}, unos {pa.grams} gramos"` |
| `per_dish` + `pieces == null` | `"aproximadamente {pa.grams} gramos"` |
| `generic` | `"aproximadamente entre {pa.gramsRange![0]} y {pa.gramsRange![1]} gramos, estimado genérico"` |

---

### 4. Accessibility implementation

**`<section>` id collision (open question #3):** the card appears one at a time on the `/hablar` page today, but the spec's Out-of-Scope lists comparison view as future work, so duplicate `id` is a latent risk. **Decision: use React 18's `useId()` hook** to generate a stable, unique-per-instance id suffix. This requires `'use client'` on the component — see §8 below.

```jsx
const sectionId = useId(); // e.g. ":r0:"
const headingId = `portion-heading-${sectionId}`;
```

**JSX wrapper (when `hasModifier || portionAssumption`):**
```jsx
<section aria-labelledby={headingId} className="mt-1.5">
  <h3 id={headingId} className="sr-only">Información de porción</h3>
  {hasModifier && <p aria-hidden="true">…pill…</p>}
  {portionAssumption && (
    <div role="note" aria-label={buildPortionAssumptionAriaLabel(portionAssumption)}
         className={portionAssumption ? 'mt-1 text-[12px] leading-snug' : ''}>
      …copy…
    </div>
  )}
</section>
```

**F-UX-A pill inside the wrapper:** yes — ui-ux-designer JSX skeleton (lines 703–710 of ticket) explicitly places the F-UX-A pill inside the `<section>`. Both are portion qualifiers; grouping is intentional.

**Focus order:** `<section>` and `<div role="note">` are both non-interactive. No `tabIndex`. Tab order is unchanged. Confirmed by code review; no automated test needed for this property in v1.

**`axe-core`:** deferred, noted in OOS.

---

### 5. Empty state

Guard at the top of the `portionAssumption` render block:
```jsx
{portionAssumption && (
  <div role="note" ...>...</div>
)}
```

The outer `<section>` wrapper itself is also conditional: `{(hasModifier || portionAssumption) && <section>…</section>}`. If neither is present, no section renders — identical DOM to today's F-UX-A baseline for plain queries.

Test: `expect(screen.queryByRole('note')).not.toBeInTheDocument()` when `createEstimateData()` has no `portionAssumption` field (the default fixture already lacks it).

---

### 6. Test plan

**New file:** `packages/web/src/__tests__/components/NutritionCard.f-ux-b.test.tsx`

**Test fixtures (concrete mock objects):**

```ts
// Path A — per_dish, pieces non-null
const paPerDishWithPieces = {
  term: 'tapa', termDisplay: 'tapa', source: 'per_dish' as const,
  grams: 50, pieces: 2, pieceName: 'croquetas',
  gramsRange: null, confidence: 'high' as const, fallbackReason: null,
};

// Path B — per_dish, pieces null
const paPerDishNoPieces = {
  term: 'racion', termDisplay: 'ración', source: 'per_dish' as const,
  grams: 250, pieces: null, pieceName: null,
  gramsRange: null, confidence: 'medium' as const, fallbackReason: null,
};

// Path C — generic
const paGeneric = {
  term: 'tapa', termDisplay: 'tapa', source: 'generic' as const,
  grams: 65, pieces: null, pieceName: null,
  gramsRange: [50, 80] as [number, number],
  confidence: null, fallbackReason: 'no_row' as const,
};
```

**Test matrix:**

| # | Fixture | Assertion |
|---|---|---|
| T1 | `paPerDishWithPieces` | Text contains `~2 croquetas (≈ 50 g)`; `aria-label` matches `/aproximadamente/` |
| T2 | `paPerDishNoPieces` | Text contains `≈ 250 g`; text does NOT contain `~`; `aria-label` matches `/aproximadamente/` |
| T3 | `paGeneric` | Text contains `Tapa estándar: 50–80 g`; `<span class="italic">` wrapping `estimado genérico` present; `aria-label` matches `/aproximadamente/` |
| T4 | Combined (F-UX-A `multiplier=1.5` + `paPerDishWithPieces`) | Both `getByText('PORCIÓN GRANDE')` and `getByRole('note')` exist; both are inside a `<section>` (`closest('section')`) |
| T5 | No `portionAssumption` (default `createEstimateData()`) | `queryByRole('note')` is null |

**Copy-discipline regex (T1 only — `per_dish` + pieces path):**
```ts
expect(screen.getByRole('note').textContent).toMatch(/~\d+ [a-záéíóúñ]+ \(≈ \d+ g\)/);
```

**Existing F-UX-A test file:** `packages/web/src/__tests__/components/NutritionCard.test.tsx` — **no changes required**. All assertions use `getByText`/`getByRole`; none depend on DOM hierarchy. The `mt-1.5` class migration from `<p>` to `<section>` is invisible to these tests. Run as regression after DOM restructure; expect all 19 existing tests to pass.

---

### 7. Tailwind tokens

| Element | Classes | Contrast (light / dark) |
|---|---|---|
| F-UX-B container | `mt-1 text-[12px] leading-snug` | — |
| Term label (`Tapa`, `Ración`) | `font-semibold text-slate-600` | 5.9:1 on white — AA pass |
| Piece/gram text | `font-normal text-slate-500` | 4.6:1 on white — AA pass |
| `estimado genérico` `<span>` | `italic text-slate-500` | 4.6:1 — AA pass (NOT slate-400; ui-ux-designer corrected this) |
| Section `mt` (no pill above) | `mt-1.5` | — |
| Section `mt` (after pill) | pill is first child, no gap class needed on siblings | — |

**Dark theme:** the card uses `bg-white` with no dark variant in the current markup. Dark mode tokens (`dark:text-slate-300`, `dark:text-slate-400`) are listed in ui-ux-designer notes but the card has no `dark:bg-*` class today — applying dark-mode text tokens without a dark background would be premature. **Decision: omit `dark:` variants in v1** (matching F-UX-A's approach — the existing pill uses no dark variant either). Track as a follow-up alongside any future dark-mode card background work.

**`sm:` / `md:` breakpoints:** none. The card itself uses `p-4 md:p-5` but the F-UX-B line inherits card padding. No breakpoint tweaks on the line itself. `leading-snug` handles the two-line wrap at 320px mobile width as documented by ui-ux-designer.

---

### 8. Type wiring

**`portionAssumption` TS type:** imported from `@foodxplorer/shared` after the backend-planner extends `EstimateDataSchema`. Import path: `import type { EstimateData } from '@foodxplorer/shared'` — no new import needed; `portionAssumption` is a field on `EstimateData` itself. The component already imports `EstimateData` at line 6.

The `PortionAssumption` sub-type will be exported from `@foodxplorer/shared` as `z.infer<typeof PortionAssumptionSchema>`. Use `EstimateData['portionAssumption']` for the local variable type to avoid a separate import: `const portionAssumption = estimateData.portionAssumption` — TypeScript infers `PortionAssumption | undefined` from the field type.

**`NutritionCardProps` diff:** no change to the union type. `portionAssumption` lives on `EstimateData` directly; the card reads it from `estimateData.portionAssumption`. No new prop needed.

**`useId` directive:** `NutritionCard.tsx` currently has no `'use client'` directive (line 4 comment confirms this). Adding `useId()` requires `'use client'`. This is a **breaking change in server-render context** — confirm the card is consumed client-side. The `/hablar` page is a client page (it uses Zustand state + event handlers). The card renders inside it and is already effectively client-side. Add `'use client'` at line 1 of `NutritionCard.tsx`.

**No `any` or `unknown` workarounds.** The Zod schema provides full type inference. The `gramsRange` non-null assertion (`pa.gramsRange![0]`) is safe because the `generic` branch is only entered when `source === 'generic'`, and the `superRefine` invariant guarantees `gramsRange` is non-null in that branch. Document with an inline comment: `// superRefine guarantees gramsRange is non-null when source === 'generic'`.

---

### 9. TDD implementation order

**Dependency gate:** the `PortionAssumptionSchema` type must be exported from `@foodxplorer/shared` before the web type import compiles. Backend lands shared schema first; frontend unblocked after.

| Commit | Content | Status |
|---|---|---|
| 1 | Add `PortionAssumptionSchema` + `portionAssumption` field to `EstimateDataSchema` in `packages/shared` (backend ticket); export type | Backend |
| 2 | New test file `NutritionCard.f-ux-b.test.tsx` with all 5 tests + fixtures — all RED | Frontend |
| 3 | Add `'use client'`; DOM restructure (move pill into `<section>`, `useId` wiring); run existing tests — all GREEN, new tests still RED | Frontend |
| 4 | Add F-UX-B `<div role="note">` block with copy helpers (`buildPortionAssumptionText`, `buildPortionAssumptionAriaLabel`) — new tests go GREEN | Frontend |
| 5 | Update `packages/web/src/__tests__/fixtures.ts` fixture comment (no functional change needed — `portionAssumption` is optional so existing fixtures remain valid) | Frontend |
| 6 | Update `docs/user-manual-web.md` portion-term assumptions section | Frontend |

**Estimated commits: 5 frontend commits** (commits 2–6 above). Effort: ~3–4h including test authoring.

**Final quality gate:** `npm test -w @foodxplorer/web` → 34 suites / 358+ tests (33 existing + 1 new suite with 5+ new tests), all green.

---

### 10. Risks and open questions resolved

**Risks:**

| Risk | Mitigation |
|---|---|
| DOM restructure breaks F-UX-A tests | Verified: all existing tests use `getByText`/`getByRole`; no DOM-order dependency. Run suite after commit 3 to confirm. |
| `'use client'` on `NutritionCard` breaks RSC consumers | `/hablar` page is already client-side (Zustand + handlers). No other consumers found via `grep`. Low risk; confirm with a quick grep before commit 3. |
| `gramsRange[0] === gramsRange[1]` renders `50–50 g` | Resolved by spec invariant: `superRefine` enforces `gramsMax > gramsMin`. This degenerate state is rejected at schema parse time. No UI guard needed. |
| `termDisplay` missing from API response | Resolved: `capitalize(pa.termDisplay ?? pa.term)` fallback in the helper. |
| Dark mode contrast | Resolved: omit dark variants in v1, matching F-UX-A precedent. Track as follow-up. |

**Open questions — resolved here:**

1. **`termDisplay` fallback** — `pa.termDisplay ?? pa.term`, capitalized. No shared util, inline in `buildPortionAssumptionText`. Closed.
2. **`gramsRange[0] === gramsRange[1]` degenerate** — impossible per `superRefine`. Backend-planner to confirm the invariant is enforced before this UI code is written. Closed.
3. **`section` id collision** — resolved with `useId()`. Requires `'use client'` on `NutritionCard`. Closed.
4. **F-UX-A `mt-1.5` migration** — `mt-1.5` moves from `<p>` to `<section>`. Visual regression confirmed safe (no test assertions on spacing classes). Closed.
5. **`card-enter` animation** — fires on article mount only; no jitter risk for in-place F-UX-B updates. Closed.

---

## Backend implementation plan (backend-planner, 2026-04-13)

### 1. Prisma migration — REPLACING migration (path c)

**Current `StandardPortion` shape** (`schema.prisma:208–227`): `id UUID PK`, `foodId UUID? FK→foods`, `foodGroup`, `context PortionContext enum`, `portionGrams Decimal`, `sourceId UUID FK→DataSources`, `notes`, `confidenceLevel ConfidenceLevel`, `description`, `isDefault bool`. Maps to `standard_portions`.

**Spec shape**: `dishId UUID FK→dishes`, `term VARCHAR`, `grams INT`, `pieces INT?`, `pieceName VARCHAR?`, `confidence 'high'|'medium'|'low'` (new DB enum distinct from `ConfidenceLevel`), `notes`. Missing entirely: `foodId`, `context`, `portionGrams`, `sourceId`, `description`, `isDefault`. The shapes are fully incompatible.

The table is **unused** (zero rows confirmed; no FK references from other tables — `standardPortions` relation only exists as a Prisma back-relation on `DataSource` and `Food`, both of which hold no FK column; confirmed by grep showing zero query-time references to `prisma.dataSource.standardPortions` or `prisma.food.standardPortions`).

**Path: drop and recreate.**

| Item | Detail |
|---|---|
| Migration filename | `20260413180000_standard_portions_f-ux-b` |
| SQL step 1 | `DROP TABLE standard_portions CASCADE` (removes orphaned indexes and the XOR CHECK constraint) |
| SQL step 2 | `CREATE TYPE portion_confidence AS ENUM ('high', 'medium', 'low')` |
| SQL step 3 | `CREATE TABLE standard_portions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), dish_id UUID NOT NULL REFERENCES dishes(id) ON DELETE CASCADE, term VARCHAR(50) NOT NULL, grams INTEGER NOT NULL CHECK (grams > 0), pieces INTEGER CHECK (pieces >= 1), piece_name VARCHAR(100), confidence portion_confidence NOT NULL, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT std_portions_pieces_name_pairing CHECK ((pieces IS NULL) = (piece_name IS NULL)), UNIQUE (dish_id, term))` |
| Prisma enum | `enum PortionConfidence { high medium low @@map("portion_confidence") }` |
| Index | `@@unique([dishId, term])` in Prisma model maps to the UNIQUE constraint above; no extra `@@index` needed (standards: `@unique` already creates an index) |
| schema.prisma changes | (a) Remove `standardPortions StandardPortion[]` back-relation from `DataSource` and `Food`; (b) remove `PortionContext` enum (only used by the old column — confirm with `grep -r "PortionContext" packages/` before drafting SQL); (c) add `PortionConfidence` enum; (d) replace `StandardPortion` model body; (e) add `standardPortions StandardPortion[]` back-relation on `Dish` model |
| Client regen | `cd packages/api && npx prisma generate` |
| Migration workflow | `prisma migrate dev --create-only --name standard_portions_f-ux-b` → hand-edit SQL → `prisma migrate deploy` |

### 2. Shared schema extension

**File**: `packages/shared/src/schemas/estimate.ts`

Add `PortionAssumptionSchema` above `EstimateDataSchema`. The `term` field uses the canonical DB keys (`media_racion`, `racion`, not display strings). The Zod schema:

```
PortionAssumptionSchema = z.object({
  term: z.enum(['pintxo', 'tapa', 'media_racion', 'racion']),
  termDisplay: z.string().min(1),
  source: z.enum(['per_dish', 'generic']),
  grams: z.number().int().positive(),
  pieces: z.number().int().min(1).nullable(),
  pieceName: z.string().min(1).nullable(),
  gramsRange: z.tuple([z.number().int().positive(), z.number().int().positive()]).nullable(),
  confidence: z.enum(['high', 'medium', 'low']).nullable(),
  fallbackReason: z.enum(['no_row', 'tier2_rejected_tapa', 'tier2_rejected_pintxo']).nullable(),
}).superRefine((d, ctx) => {
  // per_dish branch
  if (d.source === 'per_dish') {
    if (d.gramsRange !== null) issue('gramsRange must be null for per_dish')
    if (d.confidence === null) issue('confidence must be non-null for per_dish')
    if (d.fallbackReason !== null) issue('fallbackReason must be null for per_dish')
    if ((d.pieces === null) !== (d.pieceName === null)) issue('pieces and pieceName must both be null or both non-null')
  }
  // generic branch
  if (d.source === 'generic') {
    if (d.gramsRange === null) issue('gramsRange must be present for generic')
    else {
      if (d.gramsRange[0] <= 0 || d.gramsRange[1] <= d.gramsRange[0]) issue('gramsRange must be [positiveMin, min < max]')
      const derived = Math.round((d.gramsRange[0] + d.gramsRange[1]) / 2)
      if (d.grams !== derived) issue(`grams must equal Math.round(gramsRange midpoint) = ${derived}`)
    }
    if (d.pieces !== null) issue('pieces must be null for generic')
    if (d.pieceName !== null) issue('pieceName must be null for generic')
    if (d.confidence !== null) issue('confidence must be null for generic')
    if (d.fallbackReason === null) issue('fallbackReason must be non-null for generic')
  }
})
```

Add `portionAssumption: PortionAssumptionSchema.optional()` to `EstimateDataSchema` (alongside the existing F-UX-A fields). Export `PortionAssumptionSchema` and `type PortionAssumption = z.infer<typeof PortionAssumptionSchema>` from the file and re-export from `packages/shared/src/index.ts`.

**Test file**: `packages/shared/src/__tests__/f-ux-b.portionAssumption.test.ts` (Vitest, following `f-ux-a.estimate.schema.test.ts` as template).

Illegal combinations — each must return `safeParse().success === false`:

| # | Scenario |
|---|---|
| I1 | `per_dish` + `gramsRange: [50, 80]` (must be null) |
| I2 | `per_dish` + `confidence: null` |
| I3 | `per_dish` + `fallbackReason: 'no_row'` |
| I4 | `per_dish` + `pieces: 2, pieceName: null` |
| I5 | `per_dish` + `pieces: null, pieceName: 'croqueta'` |
| I6 | `per_dish` + `pieces: 0` (min 1) |
| I7 | `generic` + `pieces: 2` (must be null) |
| I8 | `generic` + `pieceName: 'croqueta'` (must be null) |
| I9 | `generic` + `confidence: 'high'` (must be null) |
| I10 | `generic` + `fallbackReason: null` |
| I11 | `generic` + `gramsRange: [0, 80]` (gramsMin must be > 0) |
| I12 | `generic` + `gramsRange: [250, 150]` (must be ordered ascending) |
| I13 | `generic` + `gramsRange: [50, 80]`, `grams: 99` (must equal `Math.round(65)=65`) |
| I14 | `generic` + `gramsRange: null` |
| I15 | `generic` + `gramsRange: [50, 50]` (gramsMax must be strictly > gramsMin) |

Legal combinations to assert `success === true`: `per_dish` with pieces set; `per_dish` with pieces null (gazpacho path); `generic` with `gramsRange: [50, 80]` and `grams: 65`; `portionAssumption` absent from `EstimateDataSchema` payload.

### 3. Seed CSV pipeline

**Generator script** (offline, never invoked at query time):
- Path: `packages/api/src/scripts/generateStandardPortionCsv.ts`
- Reads `packages/api/prisma/seed-data/spanish-dishes.json`, filters to 30 priority dishes by `nameEs`
- Expands each dish × 4 terms = up to 120 rows
- Skip-existing: never overwrites a row where `reviewed_by` is already set — safe to re-run as rows are reviewed incrementally
- For strong-countable bucket: LLM prompt asking for `{grams, pieces, pieceName, confidence}` in JSON
- For sin-pieces bucket (gazpacho, salmorejo): hard-codes `pieces=null, pieceName=null`; LLM prompt asks only for `{grams, confidence}`
- For analyst-decides bucket: sends strong-countable prompt to LLM but writes `pieces=null` in the CSV output by default regardless of LLM answer; analyst overrides by editing CSV manually
- Output: appends to `packages/api/prisma/seed-data/standard-portions.csv` (committed to git)

**CSV header**: `dishId,term,grams,pieces,pieceName,confidence,notes,reviewed_by`

**Seed script** (runs standalone or called from `seed.ts`):
- Path: `packages/api/src/scripts/seedStandardPortionCsv.ts`
- Exports `seedStandardPortions(prisma: PrismaClient): Promise<void>`
- Loads CSV from `packages/api/prisma/seed-data/standard-portions.csv` using `fs.readFileSync` + `new URL(...)` pattern (per memory: avoids Node16 import assertion issues)

**Validation order** (steps 1–3 fail-loud on ALL rows; step 4 is the only silent path):
1. **Header validation**: assert exact column set; diff-error + `process.exit(1)` on mismatch
2. **Row-level types** (every row regardless of `reviewed_by`): `dishId` → positive int; `term` → `{pintxo,tapa,media_racion,racion}`; `grams` → positive int; `pieces` → null or int ≥ 1; `pieceName` null iff `pieces` null; `confidence` → `{high,medium,low}`; `reviewed_by` null or non-empty string — any failure exits with row number + field + `reviewed_by` status
3. **Uniqueness**: `(dishId, term)` unique across all rows; duplicate exits with both row numbers
4. **Review gate** (after 1–3 pass): seed only `reviewed_by != null` rows; silently skip others; log summary: `Seeded N rows. Skipped M unreviewed rows (reviewed_by == null). 0 errors.`
5. **Idempotency**: upsert by `(dishId, term)` in a transaction

**CSV committed to git**: YES — the generator template plus a minimal CSV with 1–2 reviewed example rows to make the pipeline immediately testable.

**Test file**: `packages/api/src/scripts/__tests__/f-ux-b.seedStandardPortionCsv.test.ts`

Scenarios: valid CSV seeds correctly; malformed header exits with diff; `dishId="abc"` exits with row+field; `grams=-1` exits; `pieces=2, pieceName=null` exits; duplicate `(dishId, term)` exits with both row numbers; `reviewed_by=null` rows silently skipped with correct summary counts; empty CSV logs `Seeded 0 rows. Skipped 0 unreviewed rows. 0 errors.`; re-run of same CSV produces identical DB state.

### 4. Orchestrator 3-tier resolution

**New file**: `packages/api/src/estimation/portionAssumption.ts`

Exports:
- `resolvePortionAssumption(prisma, dishId, detectedTerm, originalQuery, multiplier, logger?): Promise<{ portionAssumption?: PortionAssumption }>`
- `computeDisplayPieces(scaledPieces: number | null): number | null` (pure, export for unit testing)

`computeDisplayPieces` lives in `packages/api/src/estimation/portionUtils.ts` alongside `applyPortionMultiplier` (pure utility, no Prisma dependency). `resolvePortionAssumption` imports it.

**Pseudocode — branching logic**:

```
if detectedTerm is null OR dishId is null → return {}

termDisplay = extractTermDisplay(originalQuery, detectedTerm.term)
canonicalTerm = normalizeToCanonicalTerm(detectedTerm.term)
  // 'media ración' → 'media_racion', 'ración' → 'racion', 'pincho'/'pintxo' → 'pintxo', 'tapa' → 'tapa'

// Tier 1 — exact DB lookup
row = await prisma.standardPortion.findUnique({ where: { dishId_term: { dishId, term: canonicalTerm } } })
if row:
  scaledPieces = row.pieces !== null ? row.pieces * multiplier : null
  displayPieces = computeDisplayPieces(scaledPieces)
  return { portionAssumption: { term: canonicalTerm, termDisplay, source: 'per_dish',
    grams: Math.round(row.grams * multiplier), pieces: displayPieces,
    pieceName: displayPieces !== null ? row.pieceName : null,
    gramsRange: null, confidence: row.confidence, fallbackReason: null } }

// Tier 2 — media_racion arithmetic ONLY
if canonicalTerm === 'media_racion':
  racionRow = await prisma.standardPortion.findUnique({ where: { dishId_term: { dishId, term: 'racion' } } })
  if racionRow:
    basePieces = racionRow.pieces !== null ? racionRow.pieces * 0.5 : null
    displayPieces = computeDisplayPieces(basePieces)
    return { portionAssumption: { term: 'media_racion', termDisplay, source: 'per_dish',
      grams: Math.round(racionRow.grams * 0.5 * multiplier), pieces: displayPieces,
      pieceName: displayPieces !== null ? racionRow.pieceName : null,
      gramsRange: null, confidence: racionRow.confidence,
      fallbackReason: null } }   // notes field omitted — not in API schema; annotate in logs

// Tier 3 — F085 generic
fallbackReason = await determineFallbackReason(prisma, dishId, canonicalTerm)
  // checks if a 'racion' row exists for this dish; returns 'tier2_rejected_tapa' |
  // 'tier2_rejected_pintxo' | 'no_row' accordingly
logger?.info({ dishId, term: canonicalTerm, fallbackReason }, 'F-UX-B: Tier 3 generic fallback')
midpoint = Math.round((detectedTerm.gramsMin + detectedTerm.gramsMax) / 2)
return { portionAssumption: { term: canonicalTerm, termDisplay, source: 'generic',
  grams: midpoint, pieces: null, pieceName: null,
  gramsRange: [detectedTerm.gramsMin, detectedTerm.gramsMax],
  confidence: null, fallbackReason } }
```

**`determineFallbackReason`** — helper async function inside `portionAssumption.ts`, exported for unit testing. Executes one `findUnique` for `{ dishId, term: 'racion' }`. Returns the discriminator enum value.

**Low-multiplier fall-through lives in `computeDisplayPieces`** (in `portionUtils.ts`): `null` if `scaledPieces === null || scaledPieces < 0.75`; else `Math.max(1, Math.round(scaledPieces))`. NOT in `applyPortionMultiplier` — keeps that function pure for nutrients only.

**Call-site integration** in BOTH `packages/api/src/conversation/estimationOrchestrator.ts` and `packages/api/src/routes/estimate.ts`:
- Import `resolvePortionAssumption` from `../estimation/portionAssumption.js`
- `dishId = (scaledResult?.entityType === 'dish') ? scaledResult.entityId : null`
- `detectedTerm = detectPortionTerm(query)` — reuse existing call already computed for F085
- Add to the `estimateData` assembly spread: `...(await resolvePortionAssumption(prisma, dishId, detectedTerm, query, effectiveMultiplier, logger))`
- Both files need `prisma` in scope — orchestrator already receives it via `EstimateParams`; route already has it via `opts.prisma`. No signature changes needed.

**Pino log**: emitted inline inside `resolvePortionAssumption` on the Tier 3 path. Structured JSON shape: `{ dishId, term: canonicalTerm, fallbackReason, feature: 'F-UX-B' }`.

**Test files**:
- `packages/api/src/__tests__/f-ux-b.portionAssumption.unit.test.ts` — mocked Prisma; covers Tier1 hit, Tier2 hit, Tier2 non-rule (tapa query + ración row → Tier3), Tier3 no_row, `computeDisplayPieces` 6 boundary cases, `determineFallbackReason` 3 paths
- `packages/api/src/__tests__/f-ux-b.estimateRoute.portionAssumption.integration.test.ts` — real test DB; seeds 1 dish with a `ración` row; exercises all 3 tiers via actual HTTP requests

### 5. Bot formatter enhancement

**File**: `packages/bot/src/formatters/estimateFormatter.ts`

Current F085 block is at lines 111–118. Add a new block ABOVE it:

```
// F-UX-B: per-dish portion assumption
if (data.portionAssumption && data.portionAssumption.source === 'per_dish') {
  const pa = data.portionAssumption;
  let portionLine: string;
  if (pa.pieces !== null) {
    portionLine = `📏 *Porción detectada:* ${escapeMarkdown(pa.termDisplay)} \\(~${pa.pieces} ${escapeMarkdown(pa.pieceName!)}, ≈ ${pa.grams} g\\)`;
  } else {
    portionLine = `📏 *Porción detectada:* ${escapeMarkdown(pa.termDisplay)} \\(≈ ${pa.grams} g\\)`;
  }
  lines.push('');
  lines.push(portionLine);
}
// F085 block: render only when no per_dish assumption (or no portionAssumption at all)
if (data.portionSizing && (!data.portionAssumption || data.portionAssumption.source === 'generic')) {
  // ... existing lines 111-118 code, UNCHANGED ...
}
```

The existing F085 block body is not edited — only a guard condition is added around it. This structural guarantee preserves byte-identity on the generic path.

**`comparisonFormatter.ts`**: apply identical treatment — add the per_dish branch guard above the equivalent F085 rendering block. Bot comparison tests (currently inside the 1198) must remain green.

**New snapshot test file**: `packages/bot/src/formatters/__tests__/f-ux-b.generic-byte-identity.test.ts`

The 7 snapshot queries (all targeting un-seeded dishes → guaranteed Tier 3 generic):
1. `"tapa de paella"` — paella not in priority-30
2. `"media ración de gambas al horno"` — "al horno" variant not seeded
3. `"ración de lentejas"` — not in priority-30
4. `"tapa de solomillo"` — not in priority-30
5. `"pintxo de txipiron"` — unambiguous un-seeded Basque spelling
6. `"ración de cocido"` — not in priority-30
7. `"tapa de manchego curado"` — "curado" variant not seeded

Each test invokes `formatEstimate(mockData)` with a mocked `EstimateData` where `portionAssumption.source === 'generic'` (or `portionSizing` present without `portionAssumption`). Compared via `expect(output).toMatchSnapshot()`.

**Snapshot creation rule**: run `npm test -w @foodxplorer/bot -- --testPathPattern=f-ux-b.generic-byte-identity` ONCE against the pre-change formatter (before any F-UX-B formatter edits). Commit the `.snap` file. Subsequent commits must not modify the snap unless the generic path intentionally changes (requires a documented decision).

### 6. Open questions from UI/UX designer — backend answers

**OQ1 (`termDisplay` fallback)**: confirmed — `portionAssumption.termDisplay ?? portionAssumption.term` is the correct fallback. The capitalisation helper (`capitaliseFirstLetter`) should be added to `packages/shared/src/portion/portionLabel.ts` alongside the existing F-UX-A helper and exported from `packages/shared/src/index.ts`. Frontend-planner can import it from `@foodxplorer/shared`.

**OQ2 (`gramsRange[0] === gramsRange[1]`)**: confirmed — the `superRefine` invariant enforces `gramsMax > gramsMin` (strict inequality). `[X, X]` is rejected at `safeParse` time. The UI `{N}–{M}` template will never receive equal bounds. No UI guard needed.

**OQ3–5**: frontend-planner scope, no backend action needed.

### 7. Documentation deliverables

| File | Addition |
|---|---|
| `docs/specs/api-spec.yaml` | Add `portionAssumption` object under `EstimateData` with all 9 fields, `source` discriminator enum, `fallbackReason` enum with 3 values, description on `pieces` field: "null when `basePieces × multiplier < 0.75` to avoid false precision on display; see F-UX-B spec" |
| `docs/user-manual-web.md` | New section "Información de porción estimada" (~150 words): explain the `~N X (≈ G g)` line, meaning of `~` (aproximadamente N unidades) and `≈` (aproximadamente G gramos), meaning of "estimado genérico" (no dato específico para este plato), that only the top-30 canonical tapas have per-dish data |
| `docs/project_notes/key_facts.md` | Add note: `StandardPortion` model now in active use for F-UX-B per-dish portion assumptions (previously unused); shape `(dishId, term, grams, pieces?, pieceName?, confidence, notes)`; 3-tier fallback: Tier1=DB lookup by `(dishId,term)`, Tier2=media_racion×0.5 from ración row, Tier3=F085 global range |
| `docs/project_notes/decisions.md` | **ADR-020**: "Per-dish portion assumptions with graceful degradation to F085 generic ranges". Problem: F085's global gram ranges (`tapa=50–80g`) are dish-agnostic; they lose the semantic difference between `tapa de croquetas` (2 units, ~50g) and `tapa de gazpacho` (continuous, ~120g). Decision: `StandardPortion` DB table seeded offline via LLM + analyst-reviewed CSV, 3-tier runtime fallback, zero runtime LLM cost. Consequences: per-dish data covers only 30 priority dishes in v1; others degrade transparently to Tier 3; the seed pipeline introduces a review-gate CSV workflow; `StandardPortion` shape is fully replaced from its prior unused form; bot 1198 tests remain byte-identical on the generic path. |

### 8. TDD implementation order

| # | Commit | Files touched |
|---|---|---|
| 1 | shared schema + illegal-combination tests | `packages/shared/src/schemas/estimate.ts`, `packages/shared/src/__tests__/f-ux-b.portionAssumption.test.ts` |
| 2 | `computeDisplayPieces` util + boundary tests | `packages/api/src/estimation/portionUtils.ts`, `packages/api/src/__tests__/f-ux-b.portionUtils.test.ts` |
| 3 | Prisma migration + client regen | `schema.prisma`, migration SQL file, `packages/api/src/generated/` |
| 4 | Seed CSV pipeline | `seedStandardPortionCsv.ts`, `generateStandardPortionCsv.ts`, `standard-portions.csv` (2 example reviewed rows), `f-ux-b.seedStandardPortionCsv.test.ts` |
| 5 | Orchestrator resolution + unit tests | `portionAssumption.ts` (new), `estimationOrchestrator.ts`, `routes/estimate.ts`, `f-ux-b.portionAssumption.unit.test.ts` |
| 6 | Integration test (real DB, all 3 tiers) | `f-ux-b.estimateRoute.portionAssumption.integration.test.ts` |
| 7 | Bot snapshot baseline (commit BEFORE formatter changes) | `f-ux-b.generic-byte-identity.test.ts`, `.snap` file |
| 8 | Bot formatter + per_dish tests | `estimateFormatter.ts`, `comparisonFormatter.ts`, `f-ux-b.estimateFormatter.perDish.test.ts` |
| 9 | `capitaliseFirstLetter` shared util | `packages/shared/src/portion/portionLabel.ts`, `packages/shared/src/index.ts` |
| 10 | API spec + docs + ADR-020 | `api-spec.yaml`, `user-manual-web.md`, `key_facts.md`, `decisions.md` |

**Expected commit count**: 10. **Rough effort**: 2.5–3 days backend (migration + orchestrator + seed pipeline are the heavy parts; bot formatter and docs are lighter).

### 9. Risks and open questions

| Risk | Mitigation |
|---|---|
| Bot regression (byte-identity) | Snapshot test committed BEFORE formatter edits (commit 7). The F085 block body is structurally unchanged — only a guard is added. 1198 tests must all pass before commit 8 merges. |
| `StandardPortion` back-relation removal from `DataSource`/`Food` | Zero query-time references confirmed by grep. Removal is schema-only. Must be atomic with migration to avoid Prisma client generation errors on `prisma generate`. |
| `PortionContext` enum removal | Only used by old `standard_portions.context` column. Safe to drop. Developer must grep `PortionContext` across all packages before drafting SQL to confirm no other reference. |
| Seed CSV rollback | If analyst marks a row reviewed then wants to undo: clearing `reviewed_by` in CSV + re-running seed does NOT delete the already-seeded DB row (upsert skips it silently). Analyst must run `DELETE FROM standard_portions WHERE dish_id = ? AND term = ?` manually, or use a `seed:standard-portions:reset` npm script (truncate + reseed). Document this rule in the seed script header comment. |
| `dishId` extraction from cascade result | `dishId` is set from `scaledResult?.entityId` only when `entityType === 'dish'`. Food-level matches return `dishId = null` → `resolvePortionAssumption` returns `{}` → no `portionAssumption` field. This is correct behaviour. Add a unit test asserting absence of `portionAssumption` when `entityType === 'food'`. |
| Cache key staleness | The existing cache key does not include a portion-term dimension. A generic-path response cached before the seed CSV ships could be served stale after seeding adds a Tier 1 row. Mitigation: the seed script is offline and requires a deploy + cache flush to take effect anyway. No code change needed — document as a deployment note. |

**Open question for user**: `generateStandardPortionCsv.ts` invokes `codex exec` / gemini. Recommend wiring as `npm run generate:standard-portions` in `packages/api/package.json` for discoverability. Confirm preferred invocation pattern before implementation commit 4.
