# F-UX-B — Expose assumptions behind Spanish serving-size terms (pincho / tapa / media ración / ración)

**Feature:** F-UX-B | **Type:** Fullstack-Feature | **Priority:** Standard
**Status:** Spec — awaiting cross-model review
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
3. **Tests validating copy format in every render path**:
   - web `NutritionCard` — assert the rendered text matches `/~\d+ \w+ \(≈ \d+ g\)/` or the gram-only variant
   - bot `estimateFormatter` — same regex on the rendered string
   - ARIA label — see next point
4. **Accessibility** — `aria-label` on the portion assumption line MUST include the Spanish word `"aproximadamente"`, e.g. `"aproximadamente 2 croquetas, unos 50 gramos"`. Screen readers must communicate the uncertainty explicitly. Tests assert this.
5. **Low-confidence weakening** — UI may render weaker copy for rows with `confidence: low` in a follow-up; v1 ships all three confidence levels with the same copy but keeps the field so the hook is there

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
2. **Tier 2 — ración-scaled arithmetic.** If the user typed `media ración` and a `ración` row exists for the dish, derive `grams = ración.grams × 0.5` and `pieces = round(ración.pieces × 0.5)` (clamped to 1). `source: "per_dish"`, `notes: "derived from ración ×0.5"`. This tier is NOT used when the user explicitly stored a `media_racion` row.
3. **Tier 3 — F085 generic fallback.** No per-dish row exists → return the current F085 global range `{ gramsMin, gramsMax }` with `source: "generic"`, `pieces: null`, `pieceName: null`. UI renders the weaker copy.

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

**Paired `superRefine` invariants** (following the F-UX-A pattern):

- If `source === 'per_dish'` → `grams` MUST be present, `gramsRange` MUST be null, `confidence` MUST be present
- If `source === 'generic'` → `gramsRange` MUST be present, `grams` equals `(gramsRange[0] + gramsRange[1]) / 2`, `pieces` MUST be null, `pieceName` MUST be null, `confidence` MUST be null
- If `pieces === null` → `pieceName` MUST be null (and vice versa)
- `grams > 0`, `pieces >= 1` when present

F085's existing `portionSizing` field on the response **remains present** for bot backwards-compatibility (see guarantee below). It is NOT deprecated in v1.

### UI surfacing

**`NutritionCard.tsx` (web)** — currently ignores `portionSizing` entirely. This ticket teaches it to read `portionAssumption`:

- Renders a **new line** below the F-UX-A `PORCIÓN` pill (or below the nutrient grid if no F-UX-A pill is present)
- Layout slot: `<div role="note" aria-label="...">…</div>`
- `aria-label` format: `"aproximadamente N pieceName, G gramos"` (MUST contain "aproximadamente")
- Visual style: secondary text color, smaller than the nutrient numbers, icon optional (TBD by `ui-ux-designer`)

**`estimateFormatter.ts` (bot)** — current emoji line `📏 Porción detectada: tapa (50–80 g)` is enhanced:

- When `portionAssumption.source === 'per_dish'` and `pieces != null`: `📏 Porción detectada: tapa (~2 croquetas, ≈ 50 g)`
- When `portionAssumption.source === 'per_dish'` and `pieces == null`: `📏 Porción detectada: ración (≈ 250 g)`
- When `portionAssumption.source === 'generic'`: **byte-identical** to today's output → `📏 Porción detectada: tapa (50–80 g)` — this is the bot regression guarantee

### Bot regression guarantee (non-negotiable)

The 1198 existing bot tests MUST continue to pass **byte-identical** output for every un-seeded dish. Changes to `estimateFormatter.ts` / `comparisonFormatter.ts` can ONLY:

- ADD new rendering when `portionAssumption.source === 'per_dish'` — a branch that didn't exist before
- NEVER modify the existing branch where `source === 'generic'` is the effective default

Quality gate: `npm test -w @foodxplorer/bot` must report **exactly `Tests: 1198 passed`** before the final commit. Any delta → STOP, reassess scope, do not commit.

### Documentation deliverables (mandatory before merge)

1. **`docs/user-manual-web.md`** — new section on portion-term assumptions (how the card shows tapa/ración assumptions, what the ≈ and ~ symbols mean, what "estimado genérico" means)
2. **`docs/specs/api-spec.yaml`** — add `portionAssumption` to `EstimateData` with the `source: "per_dish" | "generic"` discriminator and every presence rule from `superRefine`
3. **`docs/project_notes/key_facts.md`** — note that `StandardPortion` is now in use (was flagged existing-but-unused in the F-UX-B analysis) and document the 3-tier fallback chain
4. **`docs/project_notes/decisions.md`** — evaluate whether the fallback strategy warrants an ADR. Likely yes — **ADR-020 candidate**: "Per-dish portion assumptions with graceful degradation to F085 generic ranges". Title/scope subject to cross-model review.

---

## Out of scope (v1, document explicitly)

- **User personalization** ("para mí, una ración son 6 croquetas")
- **Overrides por cadena/restaurante** (`StandardPortion` is global, not chain-scoped)
- **Admin UI** for editing `StandardPortion` (analyst uses CSV + seed pipeline in v1)
- **LLM at runtime** — offline backfill script only, zero runtime LLM cost
- **Regional variations** (Andalusian, Catalan, Basque, etc.) beyond the `pincho`/`pintxo` display duality
- **Dishes outside the 30-item priority catalog** — fall back to F085 generic
- **Base macros (protein/carbs/fat)** in the card for F-UX-A's base row — already deferred
- **Weakening copy for low-confidence rows** — field exists and ships, visual degradation is a follow-up

---

## Verification plan

**Automated (in the implementation plan)**
- Shared schema superRefine invariants: unit tests covering all legal + illegal combinations
- API orchestrator: integration test exercising each of the 3 fallback tiers
- Web `NutritionCard`: Testing Library assertions on rendered text AND `aria-label` (must contain `aproximadamente`)
- Bot formatter: new branch tested, existing branches regression-tested (1198 count invariant)
- Copy discipline regex: `/~\d+ [a-záéíóúñ]+ \(≈ \d+ g\)/` matched in every render path test
- Seed pipeline: unreviewed CSV rows are skipped, reviewed rows produce exactly one DB row each

**Manual post-merge (user action)**
- `/hablar` query: "ración grande de croquetas" → card shows `PORCIÓN GRANDE` pill + `Ración ≈ 12 croquetas (≈ 360 g)` line
- `/hablar` query: "tapa de croquetas" → card shows no F-UX-A pill + `Tapa ≈ 2 croquetas (≈ 50 g)` line
- `/hablar` query: "tapa de manchego curado" (not in priority-30) → card shows `Tapa estándar: 50–80 g (estimado genérico)`
- Bot Telegram: same 3 queries → verify bot rendering matches expectations
- Screen reader smoke test (macOS VoiceOver): navigate to the portion line → verify "aproximadamente" is spoken

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

*Analysis complete, Spec written 2026-04-12. Awaiting cross-model spec review next.*
