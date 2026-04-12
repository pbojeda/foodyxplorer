# F-UX-B — Expose assumptions behind Spanish serving-size terms (pincho / tapa / media ración / ración)

**Feature:** F-UX-B | **Type:** Fullstack-Feature | **Priority:** Standard
**Status:** Analysis — awaiting user review before planning/implementation
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

## Open questions for you (block implementation until answered)

These are the decisions I need from you before writing the final spec + plan + code. The cross-model analysis surfaced enough ambiguity that guessing would waste cycles.

### Q1 — Scope: start narrow or cover all catalog?

- **Option A (narrow, recommended):** Seed ~30 countable Spanish tapas/raciones where pieces have real value (croquetas, patatas bravas, gambas, aceitunas, pintxos, boquerones, jamón, queso, calamares, chopitos, …). Everything else falls back to F085 global ranges. Ships in one PR, ~1–2 days.
- **Option B (broad):** Seed all ~250 Spanish dishes with at least a `ración` row, even if `tapa` is null for most. Bigger data-entry effort but fewer fallbacks. ~2–3 days.
- **Option C (minimal):** Only fix the web parity gap — render the existing F085 global ranges on the card. Skip the per-dish table entirely. Ships in hours, solves the "invisible on web" bug but doesn't address the "pieces" ask.

### Q2 — Piece scaling for size modifiers

When the user types `ración grande de croquetas`, should the card show:
- **Option A (my recommendation):** `~12 croquetas (≈360 g)` — multiply both nutrients and pieces by 1.5, round pieces.
- **Option B (Codex):** `~8 croquetas (≈360 g)` — scale nutrients only, keep pieces at the term default. Visually confusing.
- **Option C:** Don't scale pieces at all when a size modifier is present; show the term default and let the user do the math.

### Q3 — LLM backfill

- **Option A (recommended):** I write a small offline script that prompts `codex` / `gemini` once per top-30 dish for `{ grams, pieces, piece_name }` per term, outputs a CSV, you review and commit. Seed pipeline reads the CSV.
- **Option B:** I seed a smaller set manually (top 10) with no LLM involvement.
- **Option C:** No seeding at all in v1 — only the web parity fix (Option C in Q1 above).

### Q4 — UI placement in the NutritionCard

- **Option A (recommended):** Add a new line below the F-UX-A PORCIÓN pill. Two orthogonal slots for two orthogonal concerns.
- **Option B:** Merge F-UX-A pill and F-UX-B line into a single combined block: `Ración grande · ~12 croquetas (≈360 g) · base ~240 g`. Richer but denser.
- **Option C:** Replace F-UX-A pill with F-UX-B line. Single concept wins, loses F-UX-A's visual distinction.

### Q5 — Copy strategy for pieces

- **Option A (recommended):** `~N X (≈ G g)` everywhere — e.g. `~2 croquetas (≈ 50 g)`.
- **Option B:** Use `unas` (Spanish informal), e.g. `unas 2 croquetas (≈ 50 g)`. More natural reading but more characters.
- **Option C:** Only show pieces when `confidence >= high`; otherwise drop to `~ 50 g` without the piece count.

### Q6 — Term to display pincho vs pintxo

Basque spelling `pintxo` is more common in the Basque Country, `pincho` elsewhere. Options:
- **Option A (recommended):** Detect both in queries, store under a single internal key (`pintxo`), display using the spelling the user typed.
- **Option B:** Always display `pincho` on the card regardless of input.
- **Option C:** Add a regional setting (future scope).

### Q7 — Should F085's existing global map stay as the fallback?

- **Option A (recommended):** Yes — F085 becomes the fallback when no `StandardPortion` row exists. UI marks it as `assumption: "generic"` so the copy can be weaker. Bot's existing output keeps working for un-seeded dishes.
- **Option B:** Delete F085 and require a `StandardPortion` row for every term detection. Stricter but breaks bot output on un-seeded dishes.

---

## What happens next

**Once you answer Q1–Q7, I will:**
1. Write the final spec + implementation plan section in this ticket
2. Run `ui-ux-designer` for the card copy and placement details
3. Run cross-model review (Codex + Gemini) on the **plan** (not just the analysis)
4. Implement via TDD in order: shared schema → Prisma migration → seed data → API orchestrator → bot formatter → web NutritionCard
5. Quality gates → review agents → merge checklist → merge

**Estimated implementation effort after you approve:**
- Option A (Q1 narrow) + my recommended defaults for Q2–Q7: ~1 day of focused work including tests, reviews, and docs.
- Option B (broad) + my defaults: ~2–3 days (mostly data entry/review).
- Option C (minimal, web parity only): ~2 hours.

---

*Analysis phase complete. Awaiting user decisions on Q1–Q7 before proceeding to spec + plan + implementation.*
