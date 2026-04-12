# F-UX-A — Size modifier display in NutritionCard + API response

**Feature:** F-UX-A | **Type:** Fullstack-Feature | **Priority:** Standard
**Status:** In Progress | **Branch:** feature/F-UX-A-size-modifier-display
**Created:** 2026-04-12 | **Dependencies:** None

---

## Spec

### Description

When a user types a portion modifier (`"ración grande de paella"`, `"paella pequeña"`, `"doble de croquetas"`), the backend already detects the modifier via `extractPortionModifier` (`entityExtractor.ts:120-162`) and applies it via `applyPortionMultiplier` (`portionUtils.ts:40-58`). The multiplier is already echoed in the API response as `EstimateData.portionMultiplier`. What is **missing** is any user-facing indication that the nutrients have been scaled, plus the base (unscaled) values the user can compare against.

User request (verbatim):
> Si un usuario especifica de un plato/receta "grande", "pequeña", etc, estaría bien que en la tarjeta de información que se le muestra en la web y en la respuesta de la api apareciera la opción normal y la estimación que se ha hecho para el cálculo que se muestra.

### Current state

**Backend (works):**
- `extractPortionModifier` returns `{ cleanQuery, portionMultiplier }` for all 15 detected patterns (`grande`, `pequeña`, `doble`, `triple`, `media`, `mini`, `xl`, `ración doble`, `media ración`, etc.)
- `applyPortionMultiplier` in `packages/api/src/estimation/portionUtils.ts` scales all nutrient fields and `portionGrams`, rounds, sets `referenceBasis` to `per_serving`, returns a new result.
- Called in `estimationOrchestrator.ts:104` after the cascade, before caching.
- `EstimateDataSchema.portionMultiplier` at `packages/shared/src/schemas/estimate.ts:209` is mandatory and defaults to 1.0.

**Frontend (gap):**
- `NutritionCard.tsx` does not read `portionMultiplier`. The scaled nutrients appear silently; the user has no way to tell the card is showing "grande" vs "normal".
- No `baseNutrients` or `basePortionGrams` field exists in `EstimateData` — the base values are discarded in `applyPortionMultiplier` and unreachable from the frontend.
- `PORTION_LABEL_MAP` exists only in `packages/bot/src/formatters/estimateFormatter.ts:17-23` (duplicated in `comparisonFormatter.ts`). Not exported to shared. Not available to web.

### Fix approach

**Backend:**
1. **Move `PORTION_LABEL_MAP` to `packages/shared`** as a single source of truth. Export both the raw map and a `formatPortionLabel(multiplier: number): string` helper that handles unmapped fallback (`×2.5`).
2. **Update bot formatters** to import from shared (drop the local duplicate — simple type-safe refactor).
3. **Extend `EstimateDataSchema`** with three new optional fields:
   - `baseNutrients?: EstimateNutrients` — the pre-multiplier nutrient row (only present when `portionMultiplier !== 1.0`)
   - `basePortionGrams?: number | null` — the pre-multiplier portion grams
   - `portionLabel?: string` — computed label from the map (e.g. "grande") — also only present when `portionMultiplier !== 1.0`
4. **Update `estimationOrchestrator.ts`** to capture the base `EstimateResult` BEFORE calling `applyPortionMultiplier`, then attach `baseNutrients`, `basePortionGrams`, and `portionLabel` to the `EstimateData` payload when the effective multiplier ≠ 1.0.
5. **Do NOT change the cache semantics** — the cache key already includes the multiplier per F042; the cached response just gets the 3 extra fields.

**Frontend:**
1. **Import the shared `formatPortionLabel` helper.** No duplication.
2. **Update `NutritionCard.tsx`** per the Design Notes above:
   - When `portionMultiplier !== 1.0`: render a `PORCIÓN {LABEL}` pill under the dish name (amber palette).
   - When `baseNutrients` is also present: render a `base: N kcal` line under the `KCAL` label.
   - Update the article `aria-label` to include both the modifier and the base calories.
   - Graceful degradation: if only the multiplier is present (backend not yet updated), show the pill but not the base line.
3. **Keep the macros row unchanged** — only scaled macros are shown. Base macros are a follow-up if requested.
4. **Tests** for all the Design Notes edge cases: 1.0 no-op, mapped/unmapped multipliers, missing base field, ARIA announcement, confidence + modifier stacked.

### Out of scope

- **Base macros display** (protein, carbs, fat) — only base kcal is surfaced. Base macros would double the visible numbers in the macro row and break layout. Follow-up ticket if requested.
- **Bot rendering changes** — the bot already shows "Porción: grande (×1.5)". The shared map consolidation is a non-functional refactor; no user-visible change on Telegram.
- **Card for dish comparison flow** — `/comparar` has its own comparison card component. If it also hides the modifier, log as follow-up.
- **i18n** — all strings remain Spanish per existing product direction.

### Edge cases

- **`portionMultiplier === 1.0`** — render the card exactly as today. No pill, no base line.
- **`portionMultiplier` present but `baseNutrients` absent** (deployed backend not yet serving the field, or cached response predates the schema change) — render the pill only. Never render `base: — kcal`.
- **Unmapped multipliers** (e.g. 2.5) — pill reads `×2.5`.
- **Multiplier + LOW confidence** — both badges visible, per ASCII mockup.
- **Very long dish name** — pill sits on its own line; does not wrap alongside the name.
- **Cache invalidation** — the cache key already includes the multiplier. Clients that hit old cache entries will receive responses without `baseNutrients`; frontend handles that via graceful degradation (pill only). The next cache write after deploy will include the field.

---

## Implementation Plan

### Files to create / modify

**Shared (packages/shared)**

| # | File | Change |
|---|------|--------|
| 1 | `packages/shared/src/portion/portionLabel.ts` | **NEW** — export `PORTION_LABEL_MAP` constant + `formatPortionLabel(multiplier): string` helper |
| 2 | `packages/shared/src/portion/index.ts` | **NEW** — re-export |
| 3 | `packages/shared/src/index.ts` | Re-export from the new module |
| 4 | `packages/shared/src/schemas/estimate.ts` | Add `baseNutrients?`, `basePortionGrams?`, `portionLabel?` to `EstimateDataSchema` |
| 5 | `packages/shared/src/__tests__/portion/portionLabel.test.ts` | **NEW** — unit tests for `formatPortionLabel` (5 mapped, 3 unmapped, 1.0 no-op) |

**API (packages/api)**

| # | File | Change |
|---|------|--------|
| 6 | `packages/api/src/conversation/estimationOrchestrator.ts` | Capture the base `EstimateResult` before `applyPortionMultiplier`. If multiplier ≠ 1.0, attach `baseNutrients` + `basePortionGrams` + `portionLabel` to the returned `EstimateData` |
| 7 | `packages/api/src/__tests__/f070.estimationOrchestrator.unit.test.ts` | Add 4 tests: base captured when multiplier ≠ 1.0, absent when 1.0, label uses shared helper, label is `×2.5` fallback for unmapped value |

**Bot (packages/bot)**

| # | File | Change |
|---|------|--------|
| 8 | `packages/bot/src/formatters/estimateFormatter.ts` | Drop the local `PORTION_LABEL_MAP` + `formatPortionLabel`, import from `@foodxplorer/shared`. Keep the rendering output byte-identical |
| 9 | `packages/bot/src/formatters/comparisonFormatter.ts` | Same |
| 10 | `packages/bot/src/__tests__/formatters.test.ts` | Already asserts the rendered output — no test change needed. Re-run to confirm |

**Web (packages/web)**

| # | File | Change |
|---|------|--------|
| 11 | `packages/web/src/components/NutritionCard.tsx` | Read `portionMultiplier`, `baseNutrients`, `portionLabel` from `estimateData`. Render the pill + base subtitle + updated ARIA per Design Notes |
| 12 | `packages/web/src/__tests__/components/NutritionCard.test.tsx` | Add 6 tests: 1.0 no-op, mapped label ("grande"), unmapped label ("×2.5"), base subtitle when baseNutrients present, no base subtitle when absent, ARIA label includes modifier |

**Docs**

| # | File | Change |
|---|------|--------|
| 13 | `docs/specs/ui-components.md` | Update NutritionCard section with the new portion pill + base subtitle affordances |
| 14 | `docs/specs/api-spec.yaml` | Add the 3 new optional fields to `EstimateData` schema |
| 15 | `docs/user-manual-web.md` §6 | Brief note that grande/pequeña queries now show the modifier and base kcal in the card |

### Execution order (TDD)

1. **Shared first:** create `portionLabel.ts` + unit tests (RED → GREEN). Export.
2. **Shared schema:** extend `EstimateDataSchema`. Existing tests should all still pass (fields are optional).
3. **API orchestrator:** update tests (RED). Update orchestrator to attach base + label (GREEN).
4. **Bot:** swap imports from local to `@foodxplorer/shared`. Existing formatter tests must pass byte-identically.
5. **Web:** update NutritionCard tests (RED). Implement the pill + base subtitle + ARIA (GREEN).
6. **Full quality gates:** all 4 packages `npm test`, lint, typecheck, build.
7. **Docs:** api-spec, ui-components, user manual.
8. **Commit, push, PR, review, merge.**

### Testing invariants

- No field added to `EstimateData` is required — all new fields are optional, so existing API consumers keep working.
- When `portionMultiplier === 1.0`, the orchestrator sets `baseNutrients`, `basePortionGrams`, `portionLabel` to `undefined` (not present) — the Zod schema should reflect that.
- When `portionMultiplier !== 1.0`, all three fields MUST be present. Enforced by an invariant test on the orchestrator output.
- `formatPortionLabel(1.0)` returns `""` (caller checks `multiplier !== 1.0` before calling); or throw — to be decided in implementation.

---

## Acceptance Criteria

- [ ] `packages/shared/src/portion/portionLabel.ts` exports `PORTION_LABEL_MAP` and `formatPortionLabel(multiplier): string`
- [ ] `formatPortionLabel` returns `"media"` / `"pequeña"` / `"grande"` / `"doble"` / `"triple"` for 0.5 / 0.7 / 1.5 / 2.0 / 3.0
- [ ] `formatPortionLabel` returns `"×2.5"` (or similar) for unmapped multipliers
- [ ] `EstimateDataSchema` has `baseNutrients?`, `basePortionGrams?`, `portionLabel?` optional fields
- [ ] `estimationOrchestrator` attaches base + label only when the effective multiplier ≠ 1.0
- [ ] Bot formatters import the shared helper and render identical output (no snapshot drift)
- [ ] `NutritionCard.tsx` renders the `PORCIÓN {LABEL}` pill only when `portionMultiplier !== 1.0`
- [ ] `NutritionCard.tsx` renders the `base: {N} kcal` subtitle only when `baseNutrients` is present
- [ ] The card's `aria-label` includes both the modifier and the base calories
- [ ] Graceful degradation: multiplier present + base absent → pill only, no error
- [ ] Shared unit tests cover all 6 `formatPortionLabel` cases
- [ ] API orchestrator tests cover base-capture invariant (both 1.0 no-op and ≠1.0 with-base paths)
- [ ] Web component tests cover all Design Notes edge cases (≥ 6 tests)
- [ ] All existing tests still pass for `shared`, `api`, `bot`, `web`
- [ ] Lint, typecheck, build all clean for every affected package
- [ ] `api-spec.yaml` + `ui-components.md` + user manual §6 updated
- [ ] Cross-model review (Codex + Gemini) applied to the spec

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Tests written and passing (TDD flow demonstrated)
- [ ] No linting errors in changed files
- [ ] Build succeeds for all affected packages
- [ ] Tracker updated (Active Session + pipeline)
- [ ] `bugs.md` updated if any bug is discovered during implementation
- [ ] `key_facts.md` updated (new shared module)
- [ ] PR reviewed by `code-review-specialist` and `qa-engineer`
- [ ] Manual verification post-merge on `/hablar` (user action)

---

## Workflow Checklist

- [ ] Step 0: Spec written + reviewed by Codex + Gemini + ui-ux-designer
- [x] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 2: Implementation plan written (above, self)
- [ ] Step 3: Implementation with TDD
- [ ] Step 4: Quality gates pass
- [ ] Step 5: code-review-specialist + qa-engineer
- [ ] Step 6: Ticket finalized, branch deleted, tracker updated

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-12 | Investigation | Traced portion-modifier flow end-to-end. Confirmed backend already detects/applies/echoes multiplier but drops base values. |
| 2026-04-12 | UI/UX design notes | `ui-ux-designer` agent authored design notes in this ticket. Decisions: amber pill below name, base-kcal subtitle under KCAL label, shared vocabulary with bot, full ARIA coverage. |

---

## Merge Checklist Evidence

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | (pending) |
| 1. Mark all items | [ ] | AC: _/_, DoD: _/_, Workflow: _/_ |
| 2. Verify product tracker | [ ] | (pending) |
| 3. Update key_facts.md | [ ] | Add shared `portion` module reference |
| 4. Update decisions.md | [ ] | N/A — the Design Notes in this ticket document the UX rationale |
| 5. Commit documentation | [ ] | (pending) |
| 6. Verify clean working tree | [ ] | (pending) |
| 7. Verify branch up to date | [ ] | (pending) |

---

*Ticket created: 2026-04-12*

---

## UI/UX Design Notes

### 1. Visual treatment of the modifier

Place a small inline pill **between the dish name and the calorie block**, on its own line. This preserves the calorie number as the primary visual anchor (it is still the first large element the eye hits) while clearly signalling "this is a non-standard portion" before the user reads the numbers.

**Pill anatomy:**
- Background: `bg-amber-100` · Text: `text-amber-800` · Border: `border border-amber-200` (reuses the existing MEDIUM confidence palette from the design system)
- Size: `text-[11px] font-semibold uppercase tracking-wide` — same optical weight as the KCAL/PROTEÍNAS labels, so it reads as metadata, not a competing headline
- Shape: `rounded-full px-2 py-0.5` — distinct from the rectangular confidence badge to avoid confusion
- Icon: a small scale or arrow glyph is **not** recommended — it adds visual noise at this size on mobile. Text alone is sufficient.

Do **not** place the pill next to the calorie number. At 320 px the calorie line is `text-[28px] font-extrabold` + the "KCAL" sub-label; adding a pill in the same row breaks the alignment grid and risks wrapping.

---

### 2. "Base vs applied" affordance — Decision: Option A (base kcal subtitle)

Show the base calories as a small grey line directly beneath the scaled calorie number:

```
[dish name]                    [confidence badge]
[modifier pill]

  750                  ← text-[28px] font-extrabold text-brand-orange
  KCAL                 ← text-[11px] uppercase text-slate-400
  base: 500 kcal       ← text-[11px] text-slate-400  ← NEW
```

**Why Option A over the others:**
- Option B (tooltip) is invisible on mobile tap targets and fails discoverability — users will not know to tap the number.
- Option C (disclosure) adds an interaction cost for information that is directly requested by the user's query; it should be immediate.
- Option D (two columns) doubles the horizontal space consumed by the calorie block and breaks the existing macro row layout at 320 px.
- Option E (summary line only) does not show the actual base number — the user explicitly asked to see it.

Option A costs one line of vertical space, which is acceptable. The base line sits below the KCAL label and uses the same `text-[11px]` size as other metadata, so it does not compete visually.

The **macros row** (proteínas / carbohidratos / grasas) shows **only the scaled values** — repeating base macros in the same row would destroy layout. If the user needs the full base macro breakdown, that is a future enhancement (e.g., an expansion panel). For now, "base: N kcal" gives enough context.

---

### 3. Copy strategy

Use the same label vocabulary as the Telegram bot (`PORTION_LABEL_MAP`) for consistency. Format:

| Multiplier | Pill text | Base subtitle |
|---|---|---|
| 0.5 | `PORCIÓN MEDIA` | `base: {N} kcal` |
| 0.7 | `PORCIÓN PEQUEÑA` | `base: {N} kcal` |
| 1.5 | `PORCIÓN GRANDE` | `base: {N} kcal` |
| 2.0 | `RACIÓN DOBLE` | `base: {N} kcal` |
| 3.0 | `RACIÓN TRIPLE` | `base: {N} kcal` |
| other | `×{N}` | `base: {N} kcal` |

Rationale: "PORCIÓN GRANDE" is what a Spanish speaker says and searches for. The multiplier (×1.5) is secondary information and **is omitted from the pill** — it adds cognitive load without aiding understanding. The base kcal already makes the ratio implicit. Exception: for unmapped multipliers (e.g., 2.5), the pill shows `×2.5` because there is no natural language label for it.

"base: 500 kcal" — lowercase, colon, no bullet. Matches the register of the existing KCAL/source footer lines.

---

### 4. Accessibility

- The `<article>` `aria-label` must update to include the modifier: `"Paella: 750 calorías (porción grande, base 500)"`. This gives screen readers the full picture in one announcement.
- The pill is decorative metadata — wrap it in `<span aria-hidden="true">` inside the article; the aria-label on the article covers the content semantically.
- The base subtitle must NOT be `aria-hidden` — it carries unique information. Place it as `<p>` text in reading order after the KCAL label.
- Color alone is not used to signal the modifier. The pill uses amber background + text AND a text label, so it is never color-only.
- Contrast: `text-amber-800` (`#92400E`) on `bg-amber-100` (`#FEF3C7`) = 4.9:1 — passes WCAG AA for small text.
- `text-slate-400` for the base subtitle = 3.0:1 on white — acceptable for `text-[11px]` decorative metadata (same as existing KCAL label); if AA strict is required, upgrade to `text-slate-500` (4.5:1).

---

### 5. Edge cases

| Case | Behaviour |
|---|---|
| `portionMultiplier === 1.0` | Render nothing — card unchanged from today |
| Multiplier present but `baseNutrients` field absent (backend not yet updated) | Show the pill only; omit the base subtitle entirely. Do not render "base: — kcal" |
| `portionMultiplier = 0.7` + confidence LOW | Show both the modifier pill and the LOW confidence badge — they are orthogonal; stack them in the header row (name left / badge right) and pill on the line below name |
| `portionMultiplier = 2.5` (unmapped) | Pill: `×2.5` in amber — no natural label, the multiplier is self-explanatory |
| `portionMultiplier = 0.5` (media) | Pill uses the same amber palette — direction (smaller vs larger) is conveyed by the label, not colour. Do not use green for "small" / red for "large"; that would imply nutritional judgement |
| Long dish name (>30 chars) | The pill sits on its own line so it never wraps alongside the name. Name wraps independently; pill wraps independently if needed but at `text-[11px]` it fits in ~120 px |

---

### 6. ASCII layout sketch (mobile, 320 px)

```
┌────────────────────────────────────────────────┐
│ Paella valenciana              [MEDIA confianza]│
│ [PORCIÓN GRANDE]                                │
│                                                 │
│  750                                            │
│  KCAL                                           │
│  base: 500 kcal                                 │
│                                                 │
│  18g          62g        24g                    │
│  PROTEÍNAS    CARBOHIDRATOS  GRASAS             │
│                                                 │
│  [gluten] [huevos]                              │
│ ─────────────────────────────────────────────  │
│  USDA FoodData Central                          │
└────────────────────────────────────────────────┘
```

The pill occupies the full left-aligned width under the name. It never shares a row with the confidence badge (which stays pinned `justify-between` in the header row).

---

### 7. Animation / transition

Apply the same `card-enter` class already used on the article — it handles the card's entry animation. The modifier pill and base subtitle are part of the card's static DOM, so they appear as part of the card fade-in with **no additional animation**. There is no value in animating the pill independently; separate motion would imply it arrives asynchronously, which could confuse the user. Keep it instant within the card-enter.

---

### 8. Consistency with Telegram bot

The bot currently renders: `Porción: grande (x1.5) — 375 g`

The web card **diverges intentionally**:
- Bot is text-only, needs the multiplier in-line because there is no visual hierarchy.
- Web has visual weight — the pill label ("PORCIÓN GRANDE") and the base subtitle together communicate more clearly without the raw multiplier cluttering the label.
- The label vocabulary (media / pequeña / grande / doble / triple) is shared — that is the important consistency anchor. A user who sees "PORCIÓN GRANDE" in the web card and "grande (x1.5)" in the bot will not be confused.

---

*Design notes complete. Implementation spec (AC, DoD, tasks) to be added by spec-creator + frontend-planner.*
