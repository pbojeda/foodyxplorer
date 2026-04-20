# BUG-PROD-011 — Nutrients not scaled to portionAssumption.grams

**Status:** Spec v2 (cross-model reviewed, ready for planning)
**Type:** Bug (architectural)
**Severity:** P0 (misleading nutritional data displayed to users)
**Path:** B (Standard) — escalated from bug-workflow due to architectural scope
**Branch:** TBD (post-plan)
**Affects:** All queries with a portion term (tapa/pintxo/media_racion/racion) where `standard_portions.grams ≠ dish.portionGrams`

---

## 1. Problem Statement

When a user queries "ración de croquetas", the API response contains:
- `portionAssumption.grams = 360` (from standard_portions: ración of croquetas = 360g)
- `result.nutrients.calories = 290` (from dish: croquetas per portionGrams=120g)
- `result.portionGrams = 120`

The user sees: **"Ración: 360g — 290 kcal"** — which implies 290 kcal for 360g (80 kcal/100g). The real value is 290 kcal for 120g (242 kcal/100g). The correct display should be **~870 kcal for 360g**.

## 2. Root Cause

F-UX-B (ADR-020) was explicitly designed as label-only metadata:
> "portionAssumption shows the user what portion size the system assumes for their term, but does NOT modify the nutritional calculation."

This made sense when all portion data used the same reference (dish.portionGrams). But now that standard_portions has term-specific grams that differ from dish.portionGrams, the label and nutrients are contradictory.

## 3. Design Decision: Option A — API Scales

**Decision:** The API scales `result.nutrients` AND `result.portionGrams` by the ratio `portionAssumption.grams / result.portionGrams` when a per-dish portionAssumption is resolved.

**Rationale:**
- The API is the single source of truth for nutritional data
- Frontend (web + bot) should never perform nutritional arithmetic (ADR-001 spirit)
- One fix location covers all consumers (solo, comparison, menu paths)

### 3.1 Edge Case 1: `result.portionGrams` consistency

**Decision:** When nutrients are scaled by the portion ratio, `result.portionGrams` is ALSO updated to `portionAssumption.grams`.

Post-scaling, the response is self-consistent:
- `result.nutrients.calories = 870` (for 360g)
- `result.portionGrams = 360`
- `portionAssumption.grams = 360`

### 3.2 Edge Case 2: Fix location — INSIDE the orchestrator

**Decision:** Scaling is applied inside `estimationOrchestrator.ts` (conversation path) and inside `estimate.ts` (standalone path), at the point where `portionAssumption` is attached.

This ensures:
- Solo-dish path inherits scaling automatically
- Comparison path (BUG-PROD-007) inherits automatically
- Menu path (BUG-PROD-007) inherits automatically
- GET /estimate also works correctly

### 3.3 Interaction with F042 portionMultiplier (REVISED per cross-model review)

**The ratio is computed from resolved values, not from formulas.**

```
portionRatio = portionAssumption.grams / scaledResult.portionGrams
```

Both values are already their final resolved state at this point in the pipeline. Do NOT assume the same multiplier was applied to both sides — the `media_racion` guard (`portionMultiplierForAssumption=1.0` in conversation path) deliberately breaks that symmetry.

**Examples:**

"ración de croquetas" (multiplier=1):
- scaledResult.portionGrams = 120 (dish reference, no multiplier)
- portionAssumption.grams = 360 (from standard_portions, multiplier=1 passed)
- ratio = 360/120 = 3
- scaled calories = 290 × 3 = 870 kcal for 360g ✓

"ración grande de croquetas" (multiplier=1.5):
- scaledResult.portionGrams = 120 × 1.5 = 180
- portionAssumption.grams = 360 × 1.5 = 540
- ratio = 540/180 = 3
- scaled calories = 290 × 1.5 × 3 = 1305 kcal for 540g ✓

"media ración de croquetas" (multiplier=0.5 from F042, but guard passes 1.0 to resolver):
- scaledResult.portionGrams = 120 × 0.5 = 60
- portionAssumption.grams = 180 (Tier 2: racion.grams × 0.5 × multiplier=1.0 = 360 × 0.5 = 180)
- ratio = 180/60 = 3
- scaled calories = 290 × 0.5 × 3 = 435 kcal for 180g ✓

### 3.4 When NOT to scale

Scaling ONLY applies when ALL conditions are met:
1. `portionAssumption` is defined
2. `portionAssumption.source === 'per_dish'` (Tier 1 or Tier 2 — NOT Tier 3 generic)
3. `result.portionGrams !== null`
4. `portionAssumption.grams !== result.portionGrams` (actually different)

For Tier 3 (generic fallback), `portionAssumption.grams` is a midpoint of a range — scaling by it would introduce false precision. Leave Tier 3 as label-only.

### 3.5 `baseNutrients` / `basePortionGrams` semantics (REVISED per cross-model review)

**Post-BUG-PROD-011:** `baseNutrients` = the cascade's raw result (pre-multiplier AND pre-ratio). Always sourced from `baseResult` as returned by `runEstimationCascade` / `engineRouter`.

**Schema change required:** The `superRefine` in `EstimateDataSchema` currently rejects `baseNutrients` when `portionMultiplier === 1.0`. This must be relaxed to allow `baseNutrients` when EITHER `portionMultiplier !== 1` OR portionRatio was applied.

When `baseNutrients` is populated:
- `baseNutrients` + `basePortionGrams` = "the dish's reference serving as stored in DB" (e.g., 120g, 290 kcal)
- `result.nutrients` + `result.portionGrams` = "what you actually asked for" (e.g., 360g, 870 kcal)

### 3.6 Enrichment order (ADDED per cross-model review)

`uncertaintyRange` is calorie-dependent (computed from `result.nutrients.calories`). It must be recomputed AFTER portionAssumption scaling. The pipeline order is:

1. `applyPortionMultiplier` (F042)
2. `resolvePortionAssumption` (F-UX-B Tier lookup)
3. **`applyPortionAssumptionScaling` (BUG-PROD-011 — this fix)**
4. `enrichWithUncertainty` (must use scaled calories)
5. `enrichWithTips` / `enrichWithSubstitutions` / `enrichWithAllergens` (name-based, order independent)
6. Cache write + response

Note: `enrichWithPortionSizing` (F085) is query-based (not calorie-dependent) — its current position is fine.

## 4. Acceptance Criteria

### API backend (this ticket)

- [ ] AC1: "ración de croquetas" → `result.nutrients.calories ≈ 870`, `result.portionGrams = 360`
- [ ] AC2: "tapa de croquetas" → `result.nutrients.calories = 290`, `result.portionGrams = 120` (ratio=1, no change)
- [ ] AC3a: conversation "ración grande de croquetas" → calories ≈ 1305, portionGrams = 540
- [ ] AC3b: `GET /estimate?query=ración+de+croquetas&portionMultiplier=1.5` → same result as AC3a
- [ ] AC4: "ración de chuletón" → calories = 1960, portionGrams = 700 (ratio=1, already equal)
- [ ] AC5: Tier 3 fallback (no standard_portions row) → NO scaling, nutrients unchanged
- [ ] AC6: `baseNutrients` populated when ratio ≠ 1, sourced from cascade baseResult (pre-any-scaling)
- [ ] AC7: `EstimateDataSchema.superRefine` updated — allows `baseNutrients` when portionRatio applied (not only when multiplier≠1)
- [ ] AC8: "media ración de croquetas" → correct scaling (portionAssumption.grams=180, ratio=180/60=3, calories=145)
- [ ] AC9: `/conversation/message` path works (estimationOrchestrator.ts)
- [ ] AC10: `GET /estimate` path works (estimate.ts)
- [ ] AC11: Comparison path → both sides scaled correctly by their own ratios
- [ ] AC12: Menu path → each dish scaled by its own ratio
- [ ] AC13: `uncertaintyRange` uses post-scaling calories (not pre-scaling)
- [ ] AC14: No regressions on existing F-UX-B tests
- [ ] AC15: No regressions on existing F-UX-A tests (updated for new superRefine)
- [ ] AC16: ADR-020 updated to reflect new behavior (label + scaling, not label-only)

### Frontend follow-up (separate commit, same PR)

- [ ] AC17: Web `NutritionCard` shows base calories when portionRatio applied (not only when `hasModifier`)
- [ ] AC18: Bot `estimateFormatter` shows base reference when portionRatio applied

## 5. Implementation Plan (draft — refine during planning step)

### 5.1 New utility function

```typescript
// packages/api/src/estimation/portionUtils.ts
export function applyPortionAssumptionScaling(
  result: EstimateResult,
  portionAssumption: PortionAssumption,
): EstimateResult | null {
  if (portionAssumption.source !== 'per_dish') return null;
  if (result.portionGrams === null) return null;
  if (portionAssumption.grams === result.portionGrams) return null;

  const ratio = portionAssumption.grams / result.portionGrams;
  const scaled = { ...result };
  scaled.portionGrams = portionAssumption.grams;
  scaled.nutrients = { ...result.nutrients };
  for (const key of NUMERIC_NUTRIENT_KEYS) {
    scaled.nutrients[key] = Math.round(scaled.nutrients[key] * ratio * 100) / 100;
  }
  return scaled;
}
```

### 5.2 Integration (both paths)

```typescript
// After resolvePortionAssumption:
if (portionAssumption !== undefined) {
  estimateData.portionAssumption = portionAssumption;

  // BUG-PROD-011: scale nutrients to match portionAssumption.grams
  if (scaledResult !== null) {
    const portionScaled = applyPortionAssumptionScaling(scaledResult, portionAssumption);
    if (portionScaled !== null) {
      estimateData.result = portionScaled;
      // baseNutrients always from cascade's raw baseResult (pre-any-scaling)
      estimateData.baseNutrients = { ...baseResult.nutrients };
      estimateData.basePortionGrams = baseResult.portionGrams;
    }
  }
}

// THEN recompute calorie-dependent enrichments:
estimateData = { ...estimateData, ...enrichWithUncertainty(estimateData.result) };
```

### 5.3 Schema change (REVISED per plan review)

`packages/shared/src/schemas/estimate.ts` — relax `superRefine` to allow `baseNutrients` when:
- `portionMultiplier !== 1.0` (existing), OR
- portionRatio was applied: `data.result?.portionGrams != null && data.portionAssumption?.source === 'per_dish' && data.result.portionGrams !== data.basePortionGrams` (new)

**Key corrections from plan review:**
- Compare against `data.result.portionGrams` (post-scaling), NOT `data.portionAssumption.grams` vs `basePortionGrams`
- Use `!= null` (loose) for `basePortionGrams` check — field is `nullable + optional`
- Require `result.portionGrams !== null` explicitly to prevent impossible payloads

### 5.4 Files to modify

| File | Change |
|------|--------|
| `packages/api/src/estimation/portionUtils.ts` | Add `applyPortionAssumptionScaling()` |
| `packages/api/src/conversation/estimationOrchestrator.ts` | Apply scaling + reorder uncertainty enrichment |
| `packages/api/src/routes/estimate.ts` | Same pattern |
| `packages/shared/src/schemas/estimate.ts` | Relax superRefine for baseNutrients |
| `packages/web/src/components/NutritionCard.tsx` | Show base when portionRatio applied (AC17) |
| `packages/bot/src/formatters/estimateFormatter.ts` | Show base when portionRatio applied (AC18) |
| `docs/project_notes/decisions.md` | Update ADR-020 |
| Tests (new) | AC1-AC18 integration tests |

### 5.5 Plan review corrections (ADDED)

7 findings from cross-model plan review (Gemini + Codex, both REVISE):

1. **superRefine condition** (CRITICAL): compare `portionAssumption.grams` against `result.portionGrams`, not `basePortionGrams`
2. **Loose equality**: use `!= null` for `basePortionGrams` (nullable + optional)
3. **Route variable name**: use `portionDetectionQuery` (already defined), not bare `query`
4. **Null portionGrams guard**: schema must require `result.portionGrams !== null` for ratio-applied state
5. **AC11/AC12 tests**: must use `processMessage()` not just `estimate()` — comparison/menu paths have additional parsing
6. **AC17 test**: add NutritionCard ratio-only fixture (`portionMultiplier: 1`, `baseNutrients` present)
7. **AC18 test**: add bot formatter ratio-only fixture (MarkdownV2 output assertion)

Deferred: aria-label accessibility for ratio-only (suggestion, not blocking)

## 6. Resolved Open Questions

| Question | Resolution | Source |
|----------|-----------|--------|
| basePortionGrams when multiplier=1 but ratio applies? | Yes — always from cascade baseResult | Gemini CRITICAL + Codex IMPORTANT |
| superRefine update needed? | Yes — must allow baseNutrients for ratio-only cases | Both reviewers, verified at estimate.ts:332 |
| Any consumer relies on portionGrams === dish.portionGrams? | No — grep found no such invariant in code | Codex searched all packages |
| Confidence gates scaling? | No — all per_dish sources (high/medium/low) scale equally | Not flagged by either reviewer |

## 7. Workflow Checklist

- [x] Step 1: Triage (P0, Path B escalated)
- [x] Step 2: Investigation (root cause + flow trace + formula)
- [x] Step 3: Spec written (v1 → v2 after cross-model review)
- [x] Step 4: Cross-model spec review (Gemini + Codex — both REVISE, 4 findings → spec v2)
- [x] Step 5: Plan written (backend-planner) + cross-model plan review (7 findings → plan v2)
- [ ] Step 6: Implementation (TDD)
- [ ] Step 7: Validate (production-code-validator + code-review + QA)
- [ ] Step 8: Document + PR + merge

## 8. Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-20 | Triage | P0. Discovered during smoke test by external agent |
| 2026-04-20 | Investigation | Confirmed per_serving convention. Flow traced in both paths. Formula validated |
| 2026-04-20 | Spec v1 | Option A confirmed by user. Edge cases incorporated |
| 2026-04-20 | Cross-model review | Gemini REVISE (1 CRITICAL + 1 IMPORTANT + 1 SUGGESTION). Codex REVISE (3 IMPORTANT + 2 SUGGESTION). 4 findings incorporated into v2: superRefine schema change, baseResult sourcing, media_racion formula, uncertainty reorder. 1 deferred (frontend display). 1 clarified (AC split). |
| 2026-04-20 | Spec v2 | All review findings incorporated. Ready for planning step. |
| 2026-04-20 | Plan v1 | backend-planner wrote §9 (8 subsections, 7 ordered steps, AC mapping, commit structure) |
| 2026-04-20 | Plan review | Gemini REVISE (1 CRITICAL + 2 IMPORTANT) + Codex REVISE (4 IMPORTANT + 1 SUGGESTION). 7 findings incorporated: superRefine condition fix, loose equality, route variable, null guard, processMessage tests, frontend tests. |

---

## 9. Implementation Plan (Final)

### 9.1 Existing Code to Reuse

| Symbol | File | Role |
|--------|------|------|
| `applyPortionMultiplier` | `packages/api/src/estimation/portionUtils.ts` | Pattern to follow exactly for the new function — same pure-function contract, `NUMERIC_NUTRIENT_KEYS` loop, `Math.round(x * 100) / 100` precision |
| `NUMERIC_NUTRIENT_KEYS` | `packages/api/src/estimation/portionUtils.ts` | Import directly into the new function — do not duplicate |
| `resolvePortionAssumption` | `packages/api/src/estimation/portionAssumption.ts` | Unchanged; new scaling step runs immediately after its call site in both paths |
| `enrichWithUncertainty` | `packages/api/src/estimation/uncertaintyCalculator.ts` | Call site moves to after the ratio-scaling block in both paths |
| `EstimateDataSchema` (superRefine) | `packages/shared/src/schemas/estimate.ts` lines 318–342 | Only the second `if (hasBase && data.portionMultiplier === 1.0)` block changes |
| `f-ux-a.estimate.schema.test.ts` | `packages/shared/src/__tests__/f-ux-a.estimate.schema.test.ts` | Existing tests for the pairing invariant — add one new case, update the "rejects when multiplier 1.0" case |
| `f070.portionUtils.unit.test.ts` | `packages/api/src/__tests__/f070.portionUtils.unit.test.ts` | Pattern for pure-function unit tests for `portionUtils` — follow the same fixture style |
| `f-ux-b.estimateRoute.portionAssumption.integration.test.ts` | `packages/api/src/__tests__/f-ux-b.estimateRoute.portionAssumption.integration.test.ts` | Reuse fixture IDs namespace strategy (`fb000000-…`); reuse `cleanFixtures` pattern |
| ADR-021 canonical examples | `f-ux-b.conversationCore.integration.test.ts` | Required by ADR-021: at least one `processMessage()` end-to-end test for the conversation path |

---

### 9.2 Files to Create

| File | Purpose |
|------|---------|
| `packages/api/src/__tests__/bug-prod-011.portionAssumptionScaling.unit.test.ts` | Unit tests for `applyPortionAssumptionScaling` — covers AC1–AC5, AC6 (pure function, no DB) |
| `packages/api/src/__tests__/bug-prod-011.orchestrator.integration.test.ts` | Integration tests for the orchestrator path (AC9, AC11, AC12) — calls `estimate()` with real Prisma, mocked `runEstimationCascade` and cache (ADR-021 pattern) |
| `packages/api/src/__tests__/bug-prod-011.estimateRoute.integration.test.ts` | Integration tests for `GET /estimate` route path (AC10, AC3b) — calls route handler via Fastify inject, mocked cascade |

---

### 9.3 Files to Modify

| File | Lines affected | Change summary |
|------|---------------|----------------|
| `packages/api/src/estimation/portionUtils.ts` | After line 89 (end of file) | Add `applyPortionAssumptionScaling()` export |
| `packages/shared/src/schemas/estimate.ts` | Lines 334–341 (second `if (hasBase…)` block inside `superRefine`) | Relax condition: allow `baseNutrients` when multiplier is 1.0 IF a portionRatio was applied |
| `packages/api/src/conversation/estimationOrchestrator.ts` | Lines 162–198 (F-UX-B block + enrichWithUncertainty call site) | Apply scaling after `portionAssumption` is resolved; reorder `enrichWithUncertainty` to after the scaling block |
| `packages/api/src/routes/estimate.ts` | Lines 231–248 (F-UX-B block + enrichWithUncertainty call site at line 226) | Same pattern as orchestrator |
| `packages/shared/src/__tests__/f-ux-a.estimate.schema.test.ts` | Line 89 (the "rejects when multiplier 1.0" test) | Update to expect acceptance when portionRatio was applied; add new test case for the ratio-only path |
| `packages/web/src/components/NutritionCard.tsx` | Lines 83–93 (baseCalories derivation block) | AC17: show base calories when `portionAssumption?.source === 'per_dish'` even when `!hasModifier` |
| `packages/bot/src/formatters/estimateFormatter.ts` | Lines 110–127 (F-UX-B block) | AC18: show base reference line when `baseNutrients` is present (regardless of portionMultiplier) |
| `docs/project_notes/decisions.md` | Line 607 (ADR-020 Decision paragraph) | Amend to state that `portionAssumption` now ALSO scales nutrients and portionGrams (label + scaling, not label-only) |

---

### 9.4 Implementation Order

Steps are ordered to honour the TDD mandate (ADR-021): each step starts with a failing test and ends with the test going green. Backend before frontend.

#### Step 1 — Schema relaxation (Commit 1: `fix(schema): relax superRefine to allow baseNutrients when portionRatio applied`)

**Estimated effort: 20 min**

1a. Read `packages/shared/src/__tests__/f-ux-a.estimate.schema.test.ts`.

1b. Add a new test case to `f-ux-a.estimate.schema.test.ts`:

```
it('accepts baseNutrients + basePortionGrams when multiplier is 1.0 AND portionRatio was applied')
```

The test supplies `portionMultiplier: 1.0`, `baseNutrients`, `basePortionGrams`, and a `portionAssumption` with `source: 'per_dish'` and `grams` different from `result.portionGrams`. The test expects `success: true`.

Also update the existing test at line 89 (`'rejects baseNutrients when portionMultiplier is 1.0'`) to be scoped only to the case where NO portionAssumption with a different ratio is present — or simply add a companion test that proves the opposite.

1c. Run `npx vitest run packages/shared/src/__tests__/f-ux-a.estimate.schema.test.ts` — expect the new test to FAIL.

1d. In `packages/shared/src/schemas/estimate.ts` lines 334–341, replace:

```typescript
if (hasBase && data.portionMultiplier === 1.0) {
```

with:

```typescript
const portionRatioApplied =
  data.portionAssumption?.source === 'per_dish' &&
  data.result?.portionGrams !== undefined &&
  data.basePortionGrams !== undefined &&
  data.basePortionGrams !== null &&
  data.portionAssumption.grams !== data.basePortionGrams;

if (hasBase && data.portionMultiplier === 1.0 && !portionRatioApplied) {
```

1e. Run the full shared schema test suite — all existing tests must still pass plus the new one.

**Risk flag:** The updated superRefine condition reads `data.result?.portionGrams` via optional chaining because `result` is nullable in the schema. Using `data.basePortionGrams` (the pre-scaling grams from cascade) is the reliable comparator — `data.portionAssumption.grams` is always the post-scaling value.

---

#### Step 2 — Pure utility function + unit tests (Commit 2: `feat(portionUtils): add applyPortionAssumptionScaling`)

**Estimated effort: 30 min**

2a. Create `packages/api/src/__tests__/bug-prod-011.portionAssumptionScaling.unit.test.ts`.

Write **red** tests covering:

| Test | AC | Input | Expected output |
|------|----|-------|-----------------|
| ración de croquetas, ratio=3 | AC1 | portionGrams=120, assumption.grams=360 | calories×3, portionGrams=360 |
| tapa de croquetas, ratio=1 | AC2 | portionGrams=120, assumption.grams=120 | returns null (no scaling) |
| ración grande ×1.5, ratio=3 | AC3a | portionGrams=180, assumption.grams=540 | calories×3, portionGrams=540 |
| ratio=1 (chuletón already equal) | AC4 | portionGrams=700, assumption.grams=700 | returns null |
| Tier 3 generic source | AC5 | assumption.source='generic' | returns null |
| baseNutrients sourced pre-any-scaling | AC6 | caller provides pre-multiplier base | function does NOT touch base; it only returns scaled result |
| portionGrams=null | guard | result.portionGrams=null | returns null |
| media ración, multiplier=0.5, ratio=3 | AC8 | portionGrams=60, assumption.grams=180 | calories×3, portionGrams=180 |
| All NUMERIC_NUTRIENT_KEYS scaled | completeness | ratio=2 | every key in NUMERIC_NUTRIENT_KEYS doubled |
| Pure function — does not mutate input | purity | any input | original result object unchanged |

2b. Run tests — all FAIL (function does not yet exist).

2c. Add `applyPortionAssumptionScaling` to `packages/api/src/estimation/portionUtils.ts` after line 89:

```typescript
import type { PortionAssumption } from '@foodxplorer/shared';

/**
 * Scale result.nutrients and result.portionGrams to match portionAssumption.grams.
 * Only applies when portionAssumption.source === 'per_dish' and grams differ.
 * Returns null when no scaling is needed (ratio === 1, Tier 3 generic, or portionGrams=null).
 * Pure function — does not mutate the input result.
 *
 * BUG-PROD-011: portionAssumption was previously label-only (ADR-020 original intent).
 * Now that standard_portions rows carry term-specific grams that differ from dish.portionGrams,
 * the label and nutrients must be made consistent.
 */
export function applyPortionAssumptionScaling(
  result: EstimateResult,
  portionAssumption: PortionAssumption,
): EstimateResult | null {
  if (portionAssumption.source !== 'per_dish') return null;
  if (result.portionGrams === null) return null;
  if (portionAssumption.grams === result.portionGrams) return null;

  const ratio = portionAssumption.grams / result.portionGrams;
  const scaledNutrients = { ...result.nutrients };
  for (const key of NUMERIC_NUTRIENT_KEYS) {
    scaledNutrients[key] = Math.round(scaledNutrients[key] * ratio * 100) / 100;
  }

  return {
    ...result,
    portionGrams: portionAssumption.grams,
    nutrients: scaledNutrients,
  };
}
```

Note: `EstimateResult` is already imported at line 9. Add `PortionAssumption` to the import. No other imports change.

2d. Run unit tests — all pass. Run existing `f070.portionUtils.unit.test.ts` — must remain green.

---

#### Step 3 — Orchestrator integration (Commit 3: `fix(orchestrator): apply portionAssumption scaling + reorder uncertainty enrichment`)

**Estimated effort: 40 min**

3a. Create `packages/api/src/__tests__/bug-prod-011.orchestrator.integration.test.ts`.

Follow the ADR-021 pattern from `f-ux-b.conversationCore.integration.test.ts` — call `estimate()` from `estimationOrchestrator.ts` directly, mock `runEstimationCascade` (via `vi.mock('../estimation/engineRouter.js')`), mock `cacheGet`/`cacheSet`/`buildKey` (via `vi.mock('../lib/cache.js')`), supply real Prisma pointed at `DATABASE_URL_TEST`.

Seed a dish fixture in `beforeAll` with:
- A `dishNutrient` row: `portionGrams=120, calories=290` (croquetas reference values from spec §3.3)
- A `standardPortion` row: `term='racion', grams=360, confidence='high'`

Write **red** integration tests:

| Test | AC | Assertion |
|------|----|-----------|
| `estimate()` with `originalQuery='ración de croquetas'` returns `result.nutrients.calories ≈ 870`, `result.portionGrams=360` | AC1, AC9 | Exact value check |
| `portionAssumption.grams === result.portionGrams` (self-consistent response) | AC1 | Structural check |
| `baseNutrients.calories === 290` (pre-any-scaling), `basePortionGrams === 120` | AC6 | Base from cascade raw result |
| `uncertaintyRange` computed from scaled `result.nutrients.calories` (~870), not from 290 | AC13 | `uncertaintyRange.caloriesMin > 700` (rough check) |
| media ración: `result.nutrients.calories ≈ 435`, `result.portionGrams=180` | AC8 | With `originalQuery='media ración de croquetas'`, `portionMultiplier=0.5` |
| ración grande ×1.5: calories ≈ 1305, portionGrams=540 | AC3a | With `portionMultiplier=1.5` |
| Tier 3 fallback: no standard_portion row → nutrients unchanged | AC5 | Use unseeded dish ID |
| No mutation: base cascade result unchanged after scaling | AC6 | Read back mock return value |

3b. Run tests — all FAIL.

3c. Modify `packages/api/src/conversation/estimationOrchestrator.ts`:

**Import change (line 18):** Add `applyPortionAssumptionScaling` to the import from `'../estimation/portionUtils.js'`.

**Block: lines 130–198** — the current `estimateData` assembly and F-UX-B block.

The change has three parts:

Part A — Move `enrichWithUncertainty` OUT of the initial `estimateData` spread. Currently at line 158 it is inside the object literal:
```
...enrichWithUncertainty(scaledResult),
```
Remove it from the spread.

Part B — Replace lines 162–198 (the F-UX-B block) with:

```typescript
// F-UX-B: Resolve per-dish portion assumption (3-tier fallback chain).
// Runs after enrichWithPortionSizing so portionSizing is already on estimateData.
// Only executes when prisma is available; silently skips otherwise.
if (prisma !== undefined) {
  const detectedTerm = detectPortionTerm(portionDetectionQuery);
  const dishId =
    scaledResult?.entityType === 'dish' ? scaledResult.entityId : null;

  const isMediaRacion =
    detectedTerm !== null &&
    (detectedTerm.term.toLowerCase() === 'media ración' ||
      detectedTerm.term.toLowerCase() === 'media racion');
  const portionMultiplierForAssumption =
    originalQuery !== undefined && isMediaRacion ? 1.0 : effectiveMultiplier;

  const { portionAssumption } = await resolvePortionAssumption(
    prisma,
    dishId,
    detectedTerm,
    portionDetectionQuery,
    portionMultiplierForAssumption,
    logger as Parameters<typeof resolvePortionAssumption>[5],
  );

  if (portionAssumption !== undefined) {
    estimateData.portionAssumption = portionAssumption;

    // BUG-PROD-011: scale nutrients + portionGrams to match portionAssumption.grams
    // when a per_dish assumption was resolved and grams differ.
    if (scaledResult !== null) {
      const portionScaled = applyPortionAssumptionScaling(scaledResult, portionAssumption);
      if (portionScaled !== null) {
        estimateData.result = portionScaled;
        // baseNutrients always sourced from cascade's raw baseResult (pre-any-scaling).
        // Defensive shallow clone prevents aliasing between base and scaled rows.
        estimateData.baseNutrients = { ...baseResult.nutrients };
        estimateData.basePortionGrams = baseResult.portionGrams;
      }
    }
  }
}

// F084: Uncertainty range — MUST run after portionAssumption scaling (AC13).
// enrichWithUncertainty depends on result.nutrients.calories; if called before
// scaling, it would compute a range against pre-ratio calories.
estimateData = { ...estimateData, ...enrichWithUncertainty(estimateData.result) };
```

Note: `estimateData` must change from `const` to `let` at the declaration (line 130) because the `estimateData = { ...estimateData, ...enrichWithUncertainty(...) }` re-assignment requires it. The `EstimateData` type already allows this — it is a plain interface, not readonly.

3d. Run integration tests — all pass. Run existing F-UX-B, F-UX-A, and F042 test suites:
- `f-ux-b.estimateRoute.portionAssumption.integration.test.ts`
- `f-ux-b.portionAssumption.unit.test.ts`
- `f-ux-a.estimateRoute.baseNutrients.test.ts`
- `f042.estimate.edge-cases.test.ts`

All must remain green.

**Risk flag:** Changing `const estimateData` to `let estimateData` is the only structural change to the outer orchestrator logic. The TypeScript compiler will catch any type-narrowing issues. Verify the cache write at line 201 still uses `estimateData` (unchanged — it does).

---

#### Step 4 — GET /estimate route (Commit 4: `fix(route/estimate): apply portionAssumption scaling + reorder uncertainty enrichment`)

**Estimated effort: 30 min**

4a. Create `packages/api/src/__tests__/bug-prod-011.estimateRoute.integration.test.ts`.

Follow `f-ux-b.estimateRoute.portionAssumption.integration.test.ts` pattern — inject Fastify request via `app.inject()`, mock cascade, real Prisma on test DB, reuse the same croquetas fixture from Step 3 (same dish ID, same standard_portion row — no re-seeding needed if the integration test file shares `beforeAll`/`afterAll`, or re-seed independently).

Write **red** tests:

| Test | AC | Assertion |
|------|----|-----------|
| `GET /estimate?query=ración+de+croquetas` → `data.result.nutrients.calories ≈ 870` | AC10 | HTTP 200, value check |
| `GET /estimate?query=ración+de+croquetas&portionMultiplier=1.5` → calories ≈ 1305, portionGrams=540 | AC3b | Value check |
| `data.portionAssumption.grams === data.result.portionGrams` self-consistency | AC1 | Structural |
| `data.baseNutrients.calories === 290` when ratio applied | AC6 | Pre-scaling value |
| `data.uncertaintyRange` computed from scaled calories | AC13 | `caloriesMin > 700` |

4b. Run tests — all FAIL.

4c. Modify `packages/api/src/routes/estimate.ts`:

**Import change:** Add `applyPortionAssumptionScaling` to the import from `'../estimation/portionUtils.js'` (line 29).

**Parallel change to Step 3** for the route handler — same two-part edit:

Part A — Remove `...enrichWithUncertainty(scaledResult),` from the `estimateData` spread (line 226). Change `const estimateData` to `let estimateData` at the declaration (line 206).

Part B — Replace lines 231–248 (the F-UX-B block) with the identical pattern from Step 3c Part B above, adjusted for the route's variable names (`request.log` instead of the logger parameter, `query` instead of `portionDetectionQuery`). The route path has no `originalQuery`/`portionMultiplierForAssumption` guard because it does not strip F042 terms — pass `effectiveMultiplier` directly to `resolvePortionAssumption` as before.

Append after the F-UX-B block:
```typescript
// F084: Uncertainty range — after portionAssumption scaling (AC13)
estimateData = { ...estimateData, ...enrichWithUncertainty(estimateData.result) };
```

4d. Run route integration tests — all pass. Run existing route test suites to confirm no regressions:
- `f020`–`f024`, `f029`, `f038` estimate route tests
- `f042.estimate.edge-cases.test.ts`

---

#### Step 5 — Frontend: NutritionCard base calories gate (Commit 5: `fix(NutritionCard): show base calories when portionRatio applied`)

**Estimated effort: 20 min**

No new test file required (frontend component tests are out of scope for this project at this time). However, the change is small and self-contained.

5a. In `packages/web/src/components/NutritionCard.tsx` lines 83–93:

Current logic:
```typescript
const hasModifier = portionLabel !== '';
const baseCalories =
  hasModifier && estimateData.baseNutrients !== undefined
    ? Math.round(estimateData.baseNutrients.calories)
    : null;
```

New logic:
```typescript
const hasModifier = portionLabel !== '';
// AC17: show base calories when portionMultiplier applied (hasModifier) OR
// when a portionRatio was applied by BUG-PROD-011 scaling (baseNutrients present
// even with multiplier=1.0 because portionAssumption.grams differed from dish.portionGrams).
const hasPortionRatio =
  !hasModifier &&
  estimateData.baseNutrients !== undefined &&
  estimateData.portionAssumption?.source === 'per_dish';
const baseCalories =
  (hasModifier || hasPortionRatio) && estimateData.baseNutrients !== undefined
    ? Math.round(estimateData.baseNutrients.calories)
    : null;
```

The `ariaLabel` at line 98 and the `{baseCalories !== null && ...}` render block at line 144 already consume `baseCalories` — no further changes needed in the render tree.

**Risk flag:** The `portionHeadingId` section visibility at line 115 uses `(hasModifier || portionAssumption)`. After this fix, when portionRatio is applied without a multiplier, `hasModifier=false` but `portionAssumption` will still be defined (it was the trigger for scaling). The section will render correctly — the F-UX-B portion assumption line will show, and below it the base calories subtitle will show. No layout change needed.

---

#### Step 6 — Frontend: bot estimateFormatter base reference (Commit 6: `fix(estimateFormatter): show base reference when portionRatio applied`)

**Estimated effort: 15 min**

6a. In `packages/bot/src/formatters/estimateFormatter.ts` lines 37–49 (the portion modifier line block):

Current logic shows the portion line only when `data.portionMultiplier !== 1.0`. After BUG-PROD-011 scaling, when ratio is applied with multiplier=1.0, users need to see the base reference in the bot output too.

Add a new block after the existing multiplier check (before line 51 `lines.push('')`):

```typescript
// BUG-PROD-011 / AC18: show base reference when portionRatio was applied
// (multiplier=1.0 but portionAssumption.grams differed from dish.portionGrams).
if (
  data.portionMultiplier === 1.0 &&
  data.baseNutrients !== undefined &&
  data.portionAssumption?.source === 'per_dish' &&
  data.result?.portionGrams !== null
) {
  const basePortionLine = data.basePortionGrams !== null && data.basePortionGrams !== undefined
    ? `Referencia base: ${escapeMarkdown(String(data.basePortionGrams))} g → ${escapeMarkdown(String(Math.round(data.baseNutrients.calories)))} kcal`
    : `Referencia base: ${escapeMarkdown(String(Math.round(data.baseNutrients.calories)))} kcal`;
  lines.push(basePortionLine);
}
```

The existing `portionMultiplier !== 1.0` block at lines 38–49 and the F-UX-B block at lines 110–127 are unchanged — they already handle the multiplier path and the per_dish portion display respectively.

---

#### Step 7 — ADR-020 documentation update (Commit 7: `docs: update ADR-020 to reflect BUG-PROD-011 scaling behavior`)

**Estimated effort: 10 min**

In `docs/project_notes/decisions.md` at line 607, amend the Decision paragraph for ADR-020. Append to the existing text:

> **BUG-PROD-011 amendment (2026-04-17):** When `portionAssumption.source === 'per_dish'` and `portionAssumption.grams !== result.portionGrams`, the API now ALSO scales `result.nutrients` and `result.portionGrams` by the ratio `portionAssumption.grams / result.portionGrams`. The original label-only behavior was correct when all portions used `dish.portionGrams` as their reference, but became contradictory once `standard_portions` introduced term-specific gram values that differ from the dish default. Post-fix, `portionAssumption.grams` and `result.portionGrams` are always equal for `per_dish` sources. `baseNutrients` + `basePortionGrams` preserve the pre-scaling (cascade raw) values. Tier 3 generic is still label-only.

---

### 9.5 TDD Mapping — AC to Test Coverage

| AC | Test file | Test description |
|----|-----------|-----------------|
| AC1 | `bug-prod-011.portionAssumptionScaling.unit.test.ts` + `bug-prod-011.orchestrator.integration.test.ts` + `bug-prod-011.estimateRoute.integration.test.ts` | ración→870 kcal, portionGrams=360 |
| AC2 | `bug-prod-011.portionAssumptionScaling.unit.test.ts` | tapa ratio=1 → null (no scaling) |
| AC3a | `bug-prod-011.portionAssumptionScaling.unit.test.ts` + `bug-prod-011.orchestrator.integration.test.ts` | ración grande ×1.5 → 1305 kcal |
| AC3b | `bug-prod-011.estimateRoute.integration.test.ts` | GET /estimate?portionMultiplier=1.5 → 1305 kcal |
| AC4 | `bug-prod-011.portionAssumptionScaling.unit.test.ts` | ratio=1 (chuletón equal) → null |
| AC5 | `bug-prod-011.portionAssumptionScaling.unit.test.ts` + `bug-prod-011.orchestrator.integration.test.ts` | Tier 3 generic → no scaling |
| AC6 | `bug-prod-011.portionAssumptionScaling.unit.test.ts` + both integration tests | `baseNutrients` = cascade raw (pre-any-scaling) |
| AC7 | `packages/shared/src/__tests__/f-ux-a.estimate.schema.test.ts` (updated) | superRefine accepts baseNutrients when portionRatio applied + multiplier=1.0 |
| AC8 | `bug-prod-011.portionAssumptionScaling.unit.test.ts` + `bug-prod-011.orchestrator.integration.test.ts` | media ración → 435 kcal, portionGrams=180 |
| AC9 | `bug-prod-011.orchestrator.integration.test.ts` | estimationOrchestrator.estimate() path |
| AC10 | `bug-prod-011.estimateRoute.integration.test.ts` | GET /estimate route path |
| AC11 | `bug-prod-011.orchestrator.integration.test.ts` | Comparison: each side scaled by its own ratio (two different dishes, two different standard_portions) |
| AC12 | `bug-prod-011.orchestrator.integration.test.ts` | Menu: each dish scaled independently (multiple estimate() calls) |
| AC13 | Both integration tests | `uncertaintyRange.caloriesMin` uses post-scaling calories |
| AC14 | Existing `f-ux-b.*` tests — must stay green | No regressions on F-UX-B |
| AC15 | Existing `f-ux-a.estimate.schema.test.ts` — updated in Step 1 | No regressions on F-UX-A |
| AC16 | `docs/project_notes/decisions.md` edit (Step 7) | ADR-020 amended |
| AC17 | Manual / visual check (`NutritionCard.tsx` change) | Base calories shown for ratio-only case |
| AC18 | Manual / visual check (`estimateFormatter.ts` change) | Bot shows base reference for ratio-only case |

---

### 9.6 Commit Structure

```
Commit 1:  fix(schema): relax superRefine to allow baseNutrients when portionRatio applied
           packages/shared/src/schemas/estimate.ts
           packages/shared/src/__tests__/f-ux-a.estimate.schema.test.ts

Commit 2:  feat(portionUtils): add applyPortionAssumptionScaling pure function
           packages/api/src/estimation/portionUtils.ts
           packages/api/src/__tests__/bug-prod-011.portionAssumptionScaling.unit.test.ts

Commit 3:  fix(orchestrator): apply portionAssumption scaling + reorder uncertainty enrichment
           packages/api/src/conversation/estimationOrchestrator.ts
           packages/api/src/__tests__/bug-prod-011.orchestrator.integration.test.ts

Commit 4:  fix(route/estimate): apply portionAssumption scaling + reorder uncertainty enrichment
           packages/api/src/routes/estimate.ts
           packages/api/src/__tests__/bug-prod-011.estimateRoute.integration.test.ts

Commit 5:  fix(NutritionCard): show base calories when portionRatio applied (AC17)
           packages/web/src/components/NutritionCard.tsx

Commit 6:  fix(estimateFormatter): show base reference when portionRatio applied (AC18)
           packages/bot/src/formatters/estimateFormatter.ts

Commit 7:  docs: update ADR-020 to reflect BUG-PROD-011 scaling behavior
           docs/project_notes/decisions.md
```

Commits 3 and 4 MUST come after Commit 1 (schema change) and Commit 2 (utility function) — they import the new function and rely on the relaxed schema. Commits 5, 6, 7 are independent of each other and can be reordered.

---

### 9.7 Key Patterns and Gotchas

**Pattern: pure function returns null for no-op**
`applyPortionAssumptionScaling` returns `null` (not the unchanged result) when no scaling is needed. The call sites must check for `null` before overwriting `estimateData.result`. This is consistent with the existing `shouldScale` boolean pattern for `applyPortionMultiplier` in both paths.

**Gotcha: `const` → `let` for `estimateData`**
In both `estimationOrchestrator.ts` (line 130) and `routes/estimate.ts` (line 206), `estimateData` is declared `const`. Moving `enrichWithUncertainty` to after the F-UX-B block requires re-assigning the variable, which needs `let`. This is the only `const`-to-`let` change; it does not affect the type or downstream use. TypeScript will enforce type correctness at the re-assignment site.

**Gotcha: `baseResult` is always the cascade's raw output**
In both paths, `baseResult = routerResult.data.result` is assigned immediately after the cascade (before any `applyPortionMultiplier` call). When both a multiplier and a portionRatio are applied, `baseNutrients` must come from this `baseResult`, NOT from `scaledResult` (post-multiplier). The spec §3.5 and Commit 3 above use `{ ...baseResult.nutrients }` explicitly. Do not accidentally use `scaledResult.nutrients` as the base.

**Gotcha: `enrichWithUncertainty` currently called with `scaledResult` (nullable)**
`enrichWithUncertainty` accepts `EstimateResult | null`. After the move, call it with `estimateData.result` instead of the original `scaledResult` binding, because `estimateData.result` is the post-ratio-scaling value (or still the post-multiplier `scaledResult` if no ratio scaling occurred). The function signature does not change.

**Gotcha: route path media_racion guard difference**
The orchestrator path has a `portionMultiplierForAssumption` guard (`1.0` for media_racion when `originalQuery` is defined). The route path does not have this guard — it always passes `effectiveMultiplier`. This pre-existing asymmetry is intentional (spec §3.3 footnote on GET /estimate). Do NOT add the guard to the route path.

**Pattern: Tier 3 remains label-only**
`applyPortionAssumptionScaling` short-circuits on `portionAssumption.source !== 'per_dish'`. No change needed in `buildGenericResult` in `portionAssumption.ts`. The existing Tier 3 behavior is preserved by the function's guard, not by call-site logic.

**Fixture namespace for new integration tests**
Use `b011xxxx` prefix for fixture UUIDs to avoid collisions with existing `fb000000` (F-UX-B) fixtures. Suggested: `b0110000-0001-4000-a000-000000000001` etc. Both new integration test files (orchestrator + route) should use independent fixture IDs and independent `beforeAll`/`afterAll` teardown blocks.

**ADR-021 compliance check**
AC9 requires at least one `estimate()` call (not just `applyPortionAssumptionScaling()`) that goes through the full wiring with real Prisma. The orchestrator integration test in Step 3 satisfies this. The unit test in Step 2 alone would NOT satisfy ADR-021 for AC9.

---

### 9.8 Estimated Total Effort

| Step | Description | Effort |
|------|-------------|--------|
| Step 1 | Schema relaxation + test update | 20 min |
| Step 2 | Pure utility + unit tests | 30 min |
| Step 3 | Orchestrator integration | 40 min |
| Step 4 | GET /estimate route | 30 min |
| Step 5 | NutritionCard frontend | 20 min |
| Step 6 | Bot formatter | 15 min |
| Step 7 | ADR-020 docs | 10 min |
| **Total** | | **~2h 45min** |
