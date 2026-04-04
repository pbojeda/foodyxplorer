# F074: L4 Cooking State Extraction

**Feature:** F074 | **Type:** Backend-Feature | **Priority:** High
**Status:** Ready for Merge | **Branch:** feature/F074-l4-cooking-state-extraction
**Created:** 2026-04-04 | **Dependencies:** F072 (Cooking Profiles) ✅, F024 (L4 LLM Integration) ✅

---

## Spec

### Description

Enhance the L4 LLM Integration Layer (Strategy B — ingredient decomposition) to extract **per-ingredient cooking state** from natural language queries and apply **per-ingredient yield correction** before nutrient aggregation.

**Problem:** Currently, when a user says "200g arroz cocido con 150g pechuga de pollo a la plancha", Strategy B decomposes into `[{name: "arroz", grams: 200}, {name: "pechuga de pollo", grams: 150}]` — losing the per-ingredient cooking state information. Furthermore, Strategy B's aggregated result has `referenceBasis: 'per_serving'`, which means the F072 yield correction layer (Guard 2 in `applyYield.ts`) **skips it entirely** — no yield correction is applied at all. The correct behavior requires yield correction at the individual ingredient level (when nutrients are still `per_100g`) before aggregation into `per_serving`.

This can produce a **2-3x caloric error** on grain/legume ingredients (e.g., 200g raw rice = 720 kcal vs 200g cooked rice = 260 kcal).

**Solution:** Modify the Strategy B LLM prompt to return `state` and `cookingMethod` per ingredient. Apply yield correction per ingredient inside Strategy B (where each ingredient's nutrients are still `per_100g`) before aggregating into the final `per_serving` result. Signal to the engine router that per-ingredient yield has already been applied, so it preserves the L4-provided `yieldAdjustment`.

**Scope boundaries:**
- **In scope:** Strategy B prompt enhancement, per-ingredient yield correction in L4, shared type updates, engineRouter plumbing
- **Out of scope:** Strategy A changes (single food match — existing route-level cookingState works fine), bot clarification flow ("¿crudo o cocido?"), user-facing transparency text, F035 `parseRecipeFreeForm.ts` alignment (separate ticket — same LLM decomposition pattern but different pipeline). These belong to future features.

### API Changes

**No new endpoints.** No changes to existing HTTP contracts. The `GET /estimate` endpoint already accepts `cookingState` and `cookingMethod` query params (F072).

**Precedence rule:** When explicit `cookingState` or `cookingMethod` query params are provided by the caller, they **override** all LLM-extracted per-ingredient values. This preserves the existing API contract: explicit params always win. LLM extraction only activates when the caller does not provide these params.

**Response shape unchanged:** `EstimateData.yieldAdjustment` already exists. The `cookingStateSource` field gains a new enum value `llm_extracted` to indicate the cooking state came from the LLM decomposition.

### Data Model Changes

**No schema migration.** No new tables or columns. Only Zod schema changes in `@foodxplorer/shared`:

1. **`CookingStateSourceSchema`** — Add `'llm_extracted'` enum value
2. **`YieldAdjustmentReasonSchema`** — Add `'per_ingredient_yield_applied'` enum value

### UI Changes

N/A — backend only.

### Edge Cases & Error Handling

1. **LLM omits `state` field:** Treat as `undefined` → fall back to default assumption from food group via `getDefaultCookingState(foodGroup)`. The `cookingStateSource` for that ingredient is `'default_assumption'`, not `'llm_extracted'`.
2. **LLM returns invalid `state` value:** Ignore invalid values (not in `['raw', 'cooked', 'as_served']`), fall back to default assumption. `cookingStateSource` = `'default_assumption'`.
3. **LLM returns `cookingMethod` but no `state`:** Infer `state: 'cooked'` (if someone says "fried" they mean cooked). `cookingStateSource` = `'llm_extracted'` (the method came from the LLM, the state is directly derived from it).
4. **LLM returns invalid/unrecognized `cookingMethod`:** Ignore the invalid value and fall back to `getDefaultCookingMethod(foodGroup)`. Only canonical methods are accepted: `boiled`, `steamed`, `pressure_cooked`, `grilled`, `baked`, `fried`, `roasted`.
5. **Prisma not available:** When prisma is not injected (e.g., tests without DB), skip per-ingredient yield — aggregate raw nutrients as before (current behavior, graceful degradation). No `perIngredientYieldApplied` flag set.
6. **No cooking profile found for an ingredient:** Pass that ingredient's nutrients through uncorrected (no yield applied for that ingredient).
7. **Mixed resolved/unresolved ingredients:** Only apply yield correction to resolved ingredients. Unresolved ingredients still count toward portionGrams but not nutrients (existing behavior).
8. **Already-cooked food name (e.g., "arroz hervido"):** The `isAlreadyCookedFood` check handles this — nutrients are already in cooked basis, skip yield.
9. **Strategy A path:** No changes. Strategy A matches a single food entity, and yield correction at the cascade level (via route-level cookingState) is correct for single foods.
10. **Backward compatibility:** The LLM prompt asks for `state` as optional. Old format `[{name, grams}]` still parses correctly (legacy array format). The `portion_multiplier` field remains unchanged.
11. **Explicit query params override:** When `cookingState` or `cookingMethod` are explicitly provided in the request, Strategy B does NOT use LLM-extracted values. Instead, the explicit params are applied uniformly to all ingredients (same as current behavior). This prevents conflicts between caller intent and LLM inference.

### Pipeline Sequence (Strategy B with yield)

The per-ingredient yield correction happens within Strategy B in this strict order:

1. **LLM decomposition** → Extract `{name, grams, state?, cookingMethod?}` per ingredient
2. **DB resolution** per ingredient → `fetchFoodByName()` returns `FoodQueryRow` (with `food_group` and `per_100g` nutrients)
3. **Per-ingredient yield correction** → For each resolved ingredient, using that ingredient's state + method + food_group, call `resolveAndApplyYield()`. Nutrients are still `per_100g` at this point.
4. **Nutrient aggregation** → `SUM(corrected_nutrient_per_100g * grams / 100 * portionMultiplier)` across all ingredients → final `per_serving` result

### Aggregate YieldAdjustment Rules

When Strategy B applies per-ingredient yield, the aggregate `yieldAdjustment` returned to the engine router follows these deterministic rules:

- **`applied`:** `true` if at least one ingredient had yield correction applied; `false` if none did
- **`cookingState`:** State of the highest-calorie resolved ingredient (by raw calorie contribution before yield)
- **`cookingStateSource`:** `'llm_extracted'` if ANY ingredient's state came from the LLM (directly or inferred from method); `'default_assumption'` if ALL ingredients fell back to defaults
- **`cookingMethod`:** Method of the highest-calorie resolved ingredient, or `null` if none
- **`yieldFactor`:** Yield factor of the highest-calorie resolved ingredient, or `null` if `applied` is `false`
- **`fatAbsorptionApplied`:** `true` if any ingredient had fat absorption applied
- **`reason`:** `'per_ingredient_yield_applied'` (always, when this path is taken)

### Type Changes

**`Level4LookupFn` return type** (in `engineRouter.ts`):
- Add optional `yieldAdjustment?: YieldAdjustment` to return type
- Add optional `perIngredientYieldApplied?: boolean` flag
- Contract: when `perIngredientYieldApplied === true`, `yieldAdjustment` MUST be present. The engine router uses the L4-provided `yieldAdjustment` directly instead of calling `applyYield`.

**`EngineRouterOptions`** (in `engineRouter.ts`):
- `prisma` is already present (added in F072)

**Level4LookupFn options**:
- Add optional `prisma?: PrismaClient` to the options parameter
- Add optional `cookingState?: string` and `cookingMethod?: string` (explicit params from caller, for override logic)

### Cooking Method Vocabulary

The LLM prompt instructs the model to use these canonical English method names (matching the `cooking_profiles` table):

| Canonical Method | Spanish Variants (accepted by LLM normalization) |
|-----------------|--------------------------------------------------|
| `boiled` | hervido, cocido |
| `steamed` | al vapor |
| `pressure_cooked` | olla a presión |
| `grilled` | a la plancha, a la parrilla, a la brasa |
| `baked` | al horno, horneado |
| `fried` | frito, rebozado |
| `roasted` | asado, rostizado |

The LLM prompt will list these 7 canonical values and instruct the model to pick the closest match. Any value not in this list is treated as unrecognized → falls back to `getDefaultCookingMethod(foodGroup)`.

---

## Implementation Plan

### Existing Code to Reuse

- **`resolveAndApplyYield()`** (`packages/api/src/estimation/applyYield.ts`) — orchestrates the full yield decision tree for a single food entity with `per_100g` nutrients. Called per-ingredient inside Strategy B while nutrients are still `per_100g`. Pass the individual ingredient's `FoodQueryRow` nutrients wrapped in a minimal `EstimateResult`-compatible shape. The function already handles all guards (dish entity, non-per_100g basis, already-cooked food name, as_served passthrough, raw passthrough, cooked+profile lookup).
- **`getCookingProfile()`** (`packages/api/src/estimation/cookingProfileService.ts`) — used indirectly through `resolveAndApplyYield()`. No direct call needed.
- **`normalizeFoodGroup()`, `getDefaultCookingState()`, `getDefaultCookingMethod()`, `isAlreadyCookedFood()`, `applyYieldFactor()`** (`packages/api/src/estimation/yieldUtils.ts`) — called indirectly via `resolveAndApplyYield()`. No direct calls needed in `level4Lookup.ts`.
- **`IngredientItem` interface** (line 410–413 of `level4Lookup.ts`) — extend in-place to add `state?: string` and `cookingMethod?: string` optional fields.
- **`FoodQueryRow`** (`packages/api/src/estimation/types.ts`) — already includes `food_group: string | null` (added in F072). The per-ingredient yield call needs this field to normalize the food group.
- **`parseDecimal()`** (`packages/api/src/estimation/types.ts`) — already used in the aggregation loop; continue using it.
- **`mapFoodRowToResult()`** (`packages/api/src/estimation/types.ts`) — used to build a temporary `EstimateResult` per ingredient to pass into `resolveAndApplyYield()`. The result's nutrients are then read back out for aggregation.
- **Existing mock pattern in `f024.level4Lookup.unit.test.ts`** — `buildMockDb()`, `mockExecuteQuery`, `mockChatCreate`, `makeChatResponse()` — all reuse directly. Add a mock Prisma client alongside them for the new tests.
- **`CookingStateSourceSchema`** and **`YieldAdjustmentReasonSchema`** (`packages/shared/src/schemas/cookingProfile.ts`) — extend with new enum values (two-line edits).
- **`Level4LookupFn` type** and **`EngineRouterOptions`** (`packages/api/src/estimation/engineRouter.ts`) — modify the existing type; no new types.

---

### Files to Create

None. All changes are additive modifications to existing files.

---

### Files to Modify

1. **`packages/shared/src/schemas/cookingProfile.ts`**
   - Add `'llm_extracted'` to `CookingStateSourceSchema` enum values
   - Add `'per_ingredient_yield_applied'` to `YieldAdjustmentReasonSchema` enum values

2. **`packages/api/src/estimation/level4Lookup.ts`**
   - Extend `IngredientItem` interface with `state?: string` and `cookingMethod?: string`
   - Update Strategy B LLM prompt to request `state` and `cookingMethod` per ingredient (7 canonical methods listed)
   - Update ingredient validation block (Step 4b) to also extract `state` and `cookingMethod` from each parsed item
   - Add `runStrategyB` parameter: `options?: { prisma?: PrismaClient; cookingState?: string; cookingMethod?: string }` (passed through from the outer `level4Lookup` function)
   - Add per-ingredient yield correction block after DB resolution and before nutrient aggregation (between Step 5 and Step 8 in the current code). For each resolved ingredient: (a) determine effective state/method applying precedence and validation rules, (b) call `resolveAndApplyYield()` with a temporary `EstimateResult` built from that ingredient's row, (c) read back the corrected nutrients, (d) record per-ingredient yield metadata for aggregate computation
   - Update aggregation loop to use corrected per-100g nutrients (when yield was applied) instead of raw row values
   - Add aggregate `yieldAdjustment` computation: highest-calorie ingredient wins for state/method/factor; `applied = true` if any ingredient had yield applied; `reason = 'per_ingredient_yield_applied'`
   - Update `runStrategyB` return type to include `yieldAdjustment?: YieldAdjustment` and `perIngredientYieldApplied?: boolean`
   - Update `level4Lookup` export to pass `prisma`, `cookingState`, `cookingMethod` from options into `runStrategyB`
   - Add import for `PrismaClient`, `YieldAdjustment` types, and `resolveAndApplyYield`

3. **`packages/api/src/estimation/engineRouter.ts`**
   - Extend `Level4LookupFn` return type to include optional `yieldAdjustment?: YieldAdjustment` and `perIngredientYieldApplied?: boolean`
   - Extend `Level4LookupFn` options parameter to include optional `prisma?: PrismaClient`, `cookingState?: string`, `cookingMethod?: string`
   - In `runEstimationCascade`: pass `prisma`, `cookingState`, `cookingMethod` into the L4 call (lines 220–225)
   - In the L4 result block (lines 233–250): when `lookupResult4.perIngredientYieldApplied === true`, use `lookupResult4.yieldAdjustment` directly instead of calling `applyYield()`; otherwise call `applyYield()` as before (existing path for Strategy A hits)

4. **`packages/api/src/__tests__/f024.level4Lookup.unit.test.ts`**
   - Add fixture rows with `food_group` field (e.g., `'Cereal Grains and Pasta'` for arroz, `'Poultry Products'` for pollo) to existing `MOCK_FOOD_ROW_ARROZ` and `MOCK_FOOD_ROW_POLLO` (currently these fixtures lack `food_group`)
   - Add mock Prisma client factory `buildMockPrisma()` that stubs `cookingProfile.findFirst`
   - Add ~16 new tests in a new `describe` block: `'Strategy B — per-ingredient yield'`

5. **`packages/shared/src/__tests__/f072.cookingProfile.schemas.test.ts`**
   - Update existing enum validation tests to include `'llm_extracted'` in `CookingStateSourceSchema` accepted values
   - Update existing reason code tests to include `'per_ingredient_yield_applied'` in `YieldAdjustmentReasonSchema` accepted values

6. **`packages/api/src/__tests__/f072.engineRouter.unit.test.ts`**
   - Add test: when L4 returns `perIngredientYieldApplied: true` with `yieldAdjustment`, the engine router uses it directly and does NOT call `resolveAndApplyYield()` again

---

### Implementation Order

Follow the layer order: shared schemas first (types that everything depends on), then the core logic in `level4Lookup.ts`, then the router plumbing, then tests last per TDD approach (tests written before or alongside production code, not after).

**However**, because TDD is required, tests for each step should be written and passing before moving to the next step. The order below reflects the dependency chain; write the test stubs first, then implement.

1. **Step 1 — Shared schema extension** (`packages/shared/src/schemas/cookingProfile.ts` + `packages/shared/src/__tests__/f072.cookingProfile.schemas.test.ts`)
   - Add `'llm_extracted'` to `CookingStateSourceSchema`
   - Add `'per_ingredient_yield_applied'` to `YieldAdjustmentReasonSchema`
   - Update existing schema tests to include the new enum values in their accepted-value lists
   - These are backward-compatible additive changes.
   - Verify the shared package builds and tests pass: `pnpm --filter @foodxplorer/shared build && pnpm --filter @foodxplorer/shared test`

2. **Step 2 — Extend `Level4LookupFn` type and `runStrategyB` signature** (`engineRouter.ts` + `level4Lookup.ts`)
   - Extend `Level4LookupFn` return type with `yieldAdjustment?` and `perIngredientYieldApplied?`
   - Extend `Level4LookupFn` options with `prisma?`, `cookingState?`, `cookingMethod?`
   - Add `options` parameter to `runStrategyB` internal function (passed through from the main export). At this step, the options are accepted but yield logic is not yet implemented — `runStrategyB` returns `perIngredientYieldApplied: undefined` (no change in behavior yet)
   - Pass `prisma`, `cookingState`, `cookingMethod` from `level4Lookup` export into `runStrategyB`
   - Run existing tests to confirm no regressions: `pnpm --filter api test f024`

3. **Step 3 — Update L4 router plumbing** (`engineRouter.ts` + `packages/api/src/__tests__/f072.engineRouter.unit.test.ts`)
   - In `runEstimationCascade`, pass `prisma`, `cookingState`, `cookingMethod` to the L4 call
   - Add branch: `if (lookupResult4.perIngredientYieldApplied === true)` → use `lookupResult4.yieldAdjustment` directly; else → call `applyYield()` as before
   - Add test in `f072.engineRouter.unit.test.ts`: when L4 returns `perIngredientYieldApplied: true` with a `yieldAdjustment`, verify the router uses it directly and does NOT call `resolveAndApplyYield()` again (spy-based)
   - Run existing engine router tests to confirm no regressions

4. **Step 4 — Extend Strategy B LLM prompt + parsing** (`level4Lookup.ts`)
   - Rewrite the `userMessage` in `runStrategyB` to request `state` (optional, one of `'raw'|'cooked'|'as_served'`) and `cookingMethod` (optional, one of the 7 canonical values) per ingredient
   - Provide the JSON format example: `{"ingredients": [{"name": "<ingredient>", "grams": <number>, "state": "<state>", "cookingMethod": "<method>"}, ...], "portion_multiplier": <number>}`
   - List the 7 canonical cooking methods in the prompt
   - Update ingredient validation block to extract `state` and `cookingMethod` from each parsed item (Step 4b). Validate `state` against `['raw', 'cooked', 'as_served']` — strip invalid values. Validate `cookingMethod` against `CANONICAL_COOKING_METHODS` set — strip invalid values. If method is present but state is absent, infer `state: 'cooked'`.
   - Extend `IngredientItem` interface
   - **Tests for prompt/parsing are deferred to Step 5** where behavior is observable through yield metadata (state/method parsing cannot be tested via the public `level4Lookup` API until yield logic exists). Only backward-compat test runs here: old LLM format `[{name, grams}]` still produces correct results.

5. **Step 5 — Per-ingredient yield correction inside Strategy B** (`level4Lookup.ts`)
   - Import `resolveAndApplyYield` from `applyYield.ts` and `PrismaClient` type from `@prisma/client`
   - Import `YieldAdjustment` from `@foodxplorer/shared`
   - After the ingredient resolution loop, add a per-ingredient yield block:
     - Skip the entire block when `options?.prisma === undefined` (graceful degradation)
     - For each resolved ingredient (use `for...of` with `await`):
       (a) **Precedence:** If explicit `cookingState`/`cookingMethod` are in options, use them for ALL ingredients (override LLM-extracted values). In this case, `cookingStateSource` = `'explicit'` for that ingredient.
       (b) **LLM-extracted:** If no explicit params, use the ingredient's LLM-extracted `state`/`cookingMethod`. `cookingStateSource` = `'llm_extracted'`.
       (c) **Default fallback:** If neither explicit nor LLM-extracted, use `getDefaultCookingState(foodGroup)` / `getDefaultCookingMethod(foodGroup)`. `cookingStateSource` = `'default_assumption'`.
       (d) Build a temporary `EstimateResult` from `mapFoodRowToResult(row)`, override `name` to the ingredient name (for `isAlreadyCookedFood` detection).
       (e) Call `await resolveAndApplyYield(...)` — pass `effectiveState` and `effectiveMethod`. **IMPORTANT:** The `cookingStateSource` returned by `resolveAndApplyYield` will always be `'explicit'` or `'default_assumption'` (it checks `opts.cookingState !== undefined`). Since we always pass a state, it'll report `'explicit'`. Therefore, compute the CORRECT `cookingStateSource` externally (from step a/b/c above) and do NOT use the value returned by `resolveAndApplyYield().yieldAdjustment.cookingStateSource`.
       (f) Store: corrected nutrients (from `resolveAndApplyYield` result), the externally-computed `cookingStateSource`, and the `yieldAdjustment` (with overridden `cookingStateSource`).
       (g) Capture `rawCalorieContribution: parseDecimal(row.calories) * (grams / 100)` for aggregate computation.
   - Update aggregation loop to use corrected nutrient values when available. **Note:** corrected nutrients from `resolveAndApplyYield` are already parsed numbers, not strings — do NOT call `parseDecimal()` on them again.
   - Compute aggregate `yieldAdjustment` from captured per-ingredient metadata:
     - `applied = perIngredientMetadata.some(m => m.yieldAdjustment.applied)`
     - Highest-calorie ingredient (by `rawCalorieContribution`) determines aggregate `cookingState`, `cookingMethod`, `yieldFactor`
     - `cookingStateSource` precedence: `'explicit' > 'llm_extracted' > 'default_assumption'` — if ANY ingredient has `'explicit'`, aggregate is `'explicit'`; else if ANY has `'llm_extracted'`, aggregate is `'llm_extracted'`; else `'default_assumption'`
     - `fatAbsorptionApplied = perIngredientMetadata.some(m => m.yieldAdjustment.fatAbsorptionApplied)`
     - `reason = 'per_ingredient_yield_applied'`
   - Set `perIngredientYieldApplied = true` on return (only when prisma was present and the block ran)
   - **Tests (all Step 5)**: Write all ~16 tests here including the prompt parsing behavioral tests (observable through yield metadata) — see Testing Strategy section

6. **Step 6 — Final integration check**
   - Run full test suite: `pnpm --filter api test`
   - Run shared package tests: `pnpm --filter @foodxplorer/shared test`
   - Build check: `pnpm build`
   - Verify all 15+ new tests pass and no existing tests regressed

---

### Testing Strategy

**Test file:** `packages/api/src/__tests__/f024.level4Lookup.unit.test.ts` (existing — append new tests)

**Mock strategy:**
- `mockExecuteQuery` — already mocked via Kysely executor; continue using the same pattern
- `mockChatCreate` — already mocked via OpenAI SDK; update LLM response JSON to include `state`/`cookingMethod` fields in new tests
- `mockPrisma` — new mock. Add a `buildMockPrisma()` factory at the top of the test file. It stubs `cookingProfile.findFirst` via `vi.fn()`. Most tests set it to return `null` (no profile found — graceful degradation) or a valid profile row (e.g., `{ yieldFactor: new Decimal('2.80'), fatAbsorption: null, ... }` for grains/rice, `{ yieldFactor: new Decimal('0.85'), ... }` for meat)
- `food_group` in fixture rows — **critical**: the existing `MOCK_FOOD_ROW_ARROZ` and `MOCK_FOOD_ROW_POLLO` fixtures do not have a `food_group` field. Add `food_group: 'Cereal Grains and Pasta'` to `MOCK_FOOD_ROW_ARROZ` and `food_group: 'Poultry Products'` to `MOCK_FOOD_ROW_POLLO`. This is required for `normalizeFoodGroup()` to resolve correctly inside `resolveAndApplyYield()`.

**New describe block:** `describe('Strategy B — per-ingredient yield (F074)')` immediately after the existing `describe('level4Lookup')` block closes, or nested inside it.

**Test scenarios (target: 16 new tests):**

All new tests are in Step 5 (observable through yield metadata and nutrient values). Behavioral tests for prompt parsing (state/method extraction) are verified through their effect on yield outcomes.

*Backward compat:*
- **Test 20:** LLM returns old format `[{name, grams}]` (no `state` field), prisma present → `state` falls back to food group default via `getDefaultCookingState()`; `cookingStateSource: 'default_assumption'` in aggregate

*Prompt parsing (observable through yield metadata):*
- **Test 21:** LLM returns `state: 'cooked'` per ingredient → yield applied with `cookingStateSource: 'llm_extracted'`
- **Test 22:** LLM returns `cookingMethod: 'grilled'` but no `state` → infer `state: 'cooked'`; `cookingStateSource: 'llm_extracted'`
- **Test 23:** LLM returns `state: 'INVALID_VALUE'` → falls back to default assumption; `cookingStateSource: 'default_assumption'`
- **Test 24:** LLM returns `cookingMethod: 'wok_fried'` (not in canonical list) → falls back to `getDefaultCookingMethod(foodGroup)` for that ingredient

*Graceful degradation:*
- **Test 25:** No prisma injected → returns result without `perIngredientYieldApplied` flag, no `yieldAdjustment` (same shape as before F074)

*Core yield path:*
- **Test 26:** Single ingredient (`arroz`, 200g, `state: 'cooked'`, `food_group: 'Cereal Grains and Pasta'`), prisma returns a valid profile (`yieldFactor: 2.80` — rice absorbs water, cooked weight is 2.8x raw weight). The corrected per-100g nutrients = rawNutrients / 2.80. Final: `200 * (rawCals / 2.80) / 100`; `perIngredientYieldApplied: true`; `yieldAdjustment.applied: true`; `yieldAdjustment.reason: 'per_ingredient_yield_applied'`; `yieldAdjustment.cookingStateSource: 'llm_extracted'`
- **Test 27:** Two ingredients (arroz 200g cooked + pollo 150g grilled), both with valid profiles (rice yieldFactor=2.80, chicken yieldFactor=0.85). Raw calorie contributions: arroz 200×360/100=720 kcal, pollo 150×165/100=247.5 kcal → **arroz is dominant** (highest raw calorie contribution). Aggregate `cookingState: 'cooked'`, `cookingMethod: 'boiled'` (from arroz), `yieldFactor: 2.80`; `applied: true`
- **Test 28:** Two ingredients, only one has a profile found (the other returns `null` from `getCookingProfile`) → `applied: true` (at least one was corrected); nutrients for the uncorrected ingredient are aggregated as-is
- **Test 29:** Single ingredient with `food_group: 'Poultry Products'` and `state: 'raw'` → `resolveAndApplyYield` returns `reason: 'raw_state_no_correction'`; nutrients pass through uncorrected; aggregate `applied: false`
- **Test 30:** Ingredient with no `state` and `food_group: null` → `getDefaultCookingState(null) = 'as_served'` → passthrough; `cookingStateSource: 'default_assumption'`

*cookingStateSource aggregate precedence:*
- **Test 31:** One ingredient has `cookingStateSource: 'llm_extracted'`, another has `'default_assumption'` → aggregate is `'llm_extracted'`
- **Test 32:** ALL ingredients have `'default_assumption'` → aggregate is `'default_assumption'`

*Explicit override precedence:*
- **Test 33:** LLM extracts `state: 'raw'` per ingredient, but explicit `cookingState: 'cooked'` is passed in options → all ingredients use `'cooked'`; aggregate `cookingStateSource: 'explicit'`
- **Test 34:** LLM extracts `cookingMethod: 'grilled'` per ingredient, but explicit `cookingMethod: 'boiled'` is passed in options → all ingredients use `'boiled'`; aggregate `cookingStateSource: 'explicit'`

*Engine router (in `f072.engineRouter.unit.test.ts`):*
- **Test 35:** When L4 returns `perIngredientYieldApplied: true` with a `yieldAdjustment`, the engine router uses that `yieldAdjustment` directly and does NOT call `resolveAndApplyYield()` again (verify via spy)

*Existing tests must continue to pass:*
- All 19 existing tests in `f024.level4Lookup.unit.test.ts` — no regressions expected; the new code paths are gated on `options?.prisma !== undefined`

---

### Key Patterns

**Logger adapter in `level4Lookup.ts`:**
The `Logger` interface in `applyYield.ts` uses `(msg: string) => void` while L4's logger uses `(obj: Record<string, unknown>, msg?: string) => void`. When calling `resolveAndApplyYield()` from within `level4Lookup.ts`, build the same adapter used in `engineRouter.ts` (lines 112–115):
```
logger: logger !== undefined
  ? { warn: (msg) => logger.warn({}, msg), error: (msg) => logger.error({}, msg) }
  : { warn: () => {}, error: () => {} }
```
Note that `level4Lookup.ts` currently only types `Logger` with `info/warn/debug` — the adapter needs an `error` method for `applyYield.ts`. Either add `error` to the local `Logger` type in `level4Lookup.ts`, or use a no-op for `error` when the outer logger has no `error` method.

**Building the temporary `EstimateResult` per ingredient:**
Use `mapFoodRowToResult(row)` from `types.ts`. This already maps all nutrient fields and sets `entityType: 'food'`, `referenceBasis: 'per_100g'`. Override the `name` field with the ingredient's `name` string (not the food's DB name) so `isAlreadyCookedFood()` checks the user-facing ingredient name. Example: `{ ...mapFoodRowToResult(row), name: item.name }`.

**Canonical cooking method validation:**
Define a `const CANONICAL_COOKING_METHODS = new Set(['boiled', 'steamed', 'pressure_cooked', 'grilled', 'baked', 'fried', 'roasted'])` inside `level4Lookup.ts`. When processing each ingredient's LLM-extracted `cookingMethod`, check `CANONICAL_COOKING_METHODS.has(method)`. If not in the set, treat as `undefined` (fall back to `getDefaultCookingMethod`).

**`resolveAndApplyYield()` Guard 2 interaction:**
Guard 2 in `applyYield.ts` (line 97) skips yield when `referenceBasis !== 'per_100g'`. Because `fetchFoodByName()` already filters `WHERE fn.reference_basis = 'per_100g'` (line 250 in `level4Lookup.ts`), all resolved ingredient rows will always have `per_100g` basis — Guard 2 will never fire. This is the intended design: yield correction on per-100g nutrients before aggregation into per_serving.

**Return shape when prisma is absent:**
When `options?.prisma` is undefined, `runStrategyB` returns the existing shape with no `perIngredientYieldApplied` field (or explicitly `perIngredientYieldApplied: false`). The engine router checks `lookupResult4.perIngredientYieldApplied === true` — falsy values fall through to the existing `applyYield()` call, which also gracefully returns `null` when prisma is absent. Both paths are safe.

**Highest-calorie ingredient determination:**
Use raw calorie contribution `parseDecimal(row.calories) * (grams / 100)` **before** yield correction to determine the "dominant" ingredient. This ensures the aggregate descriptor represents the ingredient with the largest nutritional impact in the original, uncorrected state — consistent with the spec's determinism requirement.

**No changes to Strategy A path:**
`runStrategyA` returns early (line 403) with `rawFoodGroup`. The engine router calls `applyYield()` on Strategy A results as before. Zero changes to Strategy A code.

**File reference for `mapFoodRowToResult`:**
`packages/api/src/estimation/types.ts` — the function already handles all 14 nutrient columns and the source mapping. Confirmed that `FoodQueryRow` includes `food_group` (line 138 of types.ts).

---

## Acceptance Criteria

- [x] Strategy B LLM prompt requests `state` and `cookingMethod` per ingredient (using 7 canonical methods)
- [x] Strategy B parses `state` and `cookingMethod` from LLM response per ingredient
- [x] Invalid/missing `state` values fall back to `getDefaultCookingState(foodGroup)` with `cookingStateSource: 'default_assumption'`
- [x] When `cookingMethod` is present but `state` is absent, `state` defaults to `'cooked'` with `cookingStateSource: 'llm_extracted'`
- [x] Invalid/unrecognized `cookingMethod` falls back to `getDefaultCookingMethod(foodGroup)`
- [x] Per-ingredient yield correction is applied inside Strategy B before nutrient aggregation (pipeline: resolve → yield → aggregate)
- [x] Explicit `cookingState`/`cookingMethod` query params override LLM-extracted values for all ingredients
- [x] Engine router uses L4-provided `yieldAdjustment` when `perIngredientYieldApplied: true` (skips `applyYield`)
- [x] Aggregate `yieldAdjustment` follows deterministic rules (highest-calorie ingredient for state/method/factor)
- [x] `CookingStateSourceSchema` includes `'llm_extracted'` enum value
- [x] `YieldAdjustmentReasonSchema` includes `'per_ingredient_yield_applied'` enum value
- [x] Strategy A path is unchanged (no regression)
- [x] Backward compatibility: LLM responses without `state` field work correctly
- [x] Prisma absent → graceful degradation (no yield, aggregate as before)
- [x] Unit tests for new functionality — 28 tests (16 unit + 12 QA edge cases)
- [x] All existing tests pass (2511 total, 0 regressions)
- [x] Build succeeds
- [x] Shared schemas updated (`cookingProfile.ts`)

---

## Definition of Done

- [x] All acceptance criteria met (18/18)
- [x] Unit tests written and passing (28 new tests)
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] Shared schemas reflect final implementation

---

## Workflow Checklist

- [x] Step 0: Spec created, reviewed by Gemini+Codex (9 issues fixed)
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: Plan created by backend-planner, reviewed by Gemini+Codex (8 issues fixed)
- [x] Step 3: Implemented with TDD (16 unit tests + 12 QA edge cases)
- [x] Step 4: production-code-validator executed (0 new CRITICAL, 1 MEDIUM fixed), quality gates pass
- [x] Step 5: code-review-specialist executed (APPROVED, 3 findings fixed)
- [x] Step 5: qa-engineer executed (12 edge-case tests, BUG-F074-01 fixed, BUG-F074-02 fixed)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-04 | Ticket created | Spec derived from product-evolution-analysis, F072/F024 code review |
| 2026-04-04 | Spec reviewed by Gemini+Codex | 1 CRITICAL + 4 IMPORTANT + 4 SUGGESTION — all 9 addressed. Key fixes: corrected problem statement (per_serving skip), added precedence rule, pipeline sequence, cooking method vocabulary, aggregate yieldAdjustment rules, cookingStateSource clarity |
| 2026-04-04 | Plan reviewed by Gemini+Codex | 2 IMPORTANT (Gemini) + 5 IMPORTANT + 1 SUGGESTION (Codex) — all 8 addressed. Key fixes: cookingStateSource explicit>llm>default precedence, compute source externally (not from resolveAndApplyYield), add shared schema test file, fix test math (rice yieldFactor=2.80 not 0.65, arroz is dominant), move parsing tests to Step 5, explicit await, name engineRouter test file |
| 2026-04-04 | Implementation complete | backend-developer agent: 16 unit tests, all quality gates pass |
| 2026-04-04 | Production validator | 0 new CRITICAL (2 pre-existing from F072), 1 MEDIUM fixed (sentinel value cleanup) |
| 2026-04-04 | Code review | APPROVED with 3 minor findings: (1) dead branch comment, (2) cookingMethod-only override fix, (3) logger error method. All fixed. |
| 2026-04-04 | QA | 12 edge-case tests added. BUG-F074-01 (logger error→warn, fixed). BUG-F074-02 (runStrategyA return type, fixed). |
| 2026-04-04 | PR created | PR #66, all 2511 tests pass |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | Sections verified: Spec, Implementation Plan, AC, DoD, Workflow, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 18/18, DoD: 6/6, Workflow: 7/8 (Step 6 pending) |
| 2. Verify product tracker | [x] | Active Session: step 5/6, Features table: 5/6 |
| 3. Update key_facts.md | [x] | N/A — no new models, migrations, endpoints, or shared utilities |
| 4. Update decisions.md | [x] | N/A — no ADR needed |
| 5. Commit documentation | [x] | Commit: (pending — this commit) |
| 6. Verify clean working tree | [x] | `git status`: clean after commit |

---

*Ticket created: 2026-04-04*
