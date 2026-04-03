# F072: Cooking Profiles + Yield Factors

**Feature:** F072 | **Type:** Backend-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F072-cooking-profiles-yield-factors
**Created:** 2026-04-03 | **Dependencies:** None (soft: F071 BEDCA enhances food group matching but is not required)

---

## Spec

### Description

Introduces a `cooking_profiles` table and a lightweight service layer to resolve the
cooking-state ambiguity problem: "100g arroz" could mean 33g dry (≈360 kcal) or 100g
cooked (≈130 kcal) — a 2.8× caloric difference. Without yield-factor correction the
estimation engine silently returns wrong numbers for the most common foods.

The feature provides:
1. A `cooking_profiles` table seeded with ~50 USDA retention-factor entries covering
   high-impact foods (grains, legumes, pasta, meat, fish, vegetables).
2. A `getCookingProfile(foodGroup, foodName?, cookingMethod?)` lookup service.
3. An `applyYieldFactor(nutrients, yieldFactor, fatAbsorption?)` pure utility that
   divides nutrient values by the yield factor (converting cooked-weight nutrients to
   their raw-weight equivalent before scaling).
4. Integration into `POST /calculate/recipe`: callers may declare a `cookingState`
   per ingredient (`raw` | `cooked` | `as_served`). When `cookingState` is omitted,
   default assumptions fire based on food group.
5. A new optional query parameter `cookingState` on `GET /estimate` for single-food
   queries.

**What this feature does NOT do (deferred to F074):**
- LLM extraction of cooking state from natural language
- Bot clarification flow ("¿Los 100g de arroz son en crudo o cocido?")

**Default assumptions (when `cookingState` is unspecified):**

| Food group | Default assumption | Rationale |
|---|---|---|
| `grains`, `legumes`, `pasta` | `cooked` | Users report serving weight |
| `meat`, `fish` | `raw` | Traditional recipe writing convention |
| `vegetables` | `raw` | Consistent with USDA per-100g raw reference |
| `composite`, unknown | `as_served` | No safe assumption possible |

**Caloric correction formula:**

When `cookingState = "raw"` but DB nutrients are stored `per_100g` of the food (which
is per USDA convention always raw-weight):
- No correction needed — nutrients apply directly.

When `cookingState = "cooked"` and DB nutrients are raw-weight (all USDA/BEDCA foods):
- The user's gram weight refers to cooked food.
- Corrected raw weight = `reportedGrams / yieldFactor`
- Apply nutrients at corrected raw weight.

When `cookingState = "as_served"`:
- No yield correction — treat reported grams as final serving weight with no conversion.

**Fat absorption (frying only):**
- `fatAbsorption` (g fat per 100g raw food) is added to total `fats` column only (NOT
  to `saturatedFats` — commercial frying oils are predominantly unsaturated).
- Calories are recalculated: add `fatAbsorption × 9` kcal to account for absorbed fat.
- Only applies when `cookingMethod = "fried"` AND `fatAbsorption` is non-null in the
  profile.

**Food group normalization:**

USDA stores food groups as free-text (e.g., "Poultry Products", "Cereal Grains and
Pasta"). These must be mapped to canonical cooking groups used by this feature. A
`normalizeFoodGroup(rawFoodGroup: string): CookingGroup | null` mapping function
converts DB values to canonical groups:

| Canonical cooking group | Raw `foodGroup` patterns (case-insensitive contains) |
|---|---|
| `grains` | "cereal", "grain" |
| `pasta` | "pasta" |
| `legumes` | "legume", "bean", "lentil", "chickpea" |
| `meat` | "beef", "pork", "lamb", "poultry", "chicken", "meat" |
| `fish` | "fish", "seafood", "shellfish", "finfish" |
| `vegetables` | "vegetable", "potato", "tomato", "pepper" |

Unmatched groups → `null` → treated as `composite` → default `as_served`, no yield.

**Already-cooked DB foods (BEDCA guard):**

BEDCA includes ~85 cooked items (e.g., "Arroz hervido"). If the resolved food's name
contains cooking keywords (`hervido`, `cocido`, `frito`, `asado`, `al horno`,
`boiled`, `cooked`, `fried`, `grilled`, `baked`, `steamed`), the engine assumes the
DB nutrients are already for the cooked state. In this case:
- If user's `cookingState` = `cooked` → **skip yield adjustment** (nutrients already
  match). Set `yieldAdjustment.reason = "db_food_already_cooked"`.
- If user's `cookingState` = `raw` → **skip yield adjustment** and log `warn` (cannot
  reliably reverse a cooked food to raw nutrients). Set reason = `"cannot_reverse_cooked_to_raw"`.

### API Changes

#### 1. `POST /calculate/recipe` — new fields per ingredient

The structured-mode ingredient object gains two optional fields:

```yaml
cookingState:
  type: string
  enum: [raw, cooked, as_served]
  description: |
    Declares whether the reported gram weight is pre-cooking (raw) or
    post-cooking (cooked). When omitted, default assumptions fire based on
    the resolved food's food group.
cookingMethod:
  type: string
  description: |
    Optional cooking method (e.g., "boiled", "fried", "grilled", "baked",
    "steamed"). Used to select the specific yield profile. When omitted,
    the engine uses the default method for the food group (boiled for
    grains/legumes/pasta/vegetables, grilled for meat/fish).
```

The response gains a per-ingredient `yieldAdjustment` object in the `resolvedAs`
block (see `YieldAdjustment` schema in `components/schemas`).

#### 2. `GET /estimate` — new optional query parameters

```yaml
- name: cookingState
  in: query
  required: false
  schema:
    type: string
    enum: [raw, cooked, as_served]
  description: |
    Declares whether the queried quantity refers to raw or cooked food.
    When omitted, default assumptions apply based on food group.
    Only applied when the result is a food (not a restaurant dish — dishes
    are always as_served).
- name: cookingMethod
  in: query
  required: false
  schema:
    type: string
  description: |
    Optional cooking method (e.g., "boiled", "fried", "grilled"). When
    omitted, default method is used per food group.
```

**Cache key impact:** The estimate cache key gains segments:
`fxp:estimate:<query>:<chainSlug>:<restaurantId>:<portionMultiplier>:<cookingState>:<cookingMethod>`
(empty strings when omitted, preserving backward compatibility).

**Response impact:** The `EstimateData` response gains a `yieldAdjustment` object
(same schema as recipe response) so API clients know if/how correction was applied.

#### Default cooking methods per food group

| Cooking group | Default method |
|---|---|
| `grains`, `legumes`, `pasta` | `boiled` |
| `meat`, `fish` | `grilled` |
| `vegetables` | `boiled` |

#### New schemas added to `components/schemas`

- `CookingState` — enum string schema (`raw`, `cooked`, `as_served`)
- `YieldAdjustment` — object with fields:
  - `applied: boolean` — whether yield correction was applied
  - `cookingState: string` — effective cooking state (explicit or default)
  - `cookingStateSource: string` — enum: `explicit` | `default_assumption` | `none`
  - `cookingMethod: string?` — method used for profile lookup
  - `yieldFactor: number?` — factor applied (null if not applied)
  - `fatAbsorptionApplied: boolean` — whether fat absorption was added
  - `reason: string` — one of the following exclusive values:
    - `cooked_state_applied` — yield correction applied (cooked weight → raw equivalent)
    - `raw_state_no_correction` — nutrients already in raw basis, no conversion needed
    - `as_served_passthrough` — caller declared as_served, no conversion
    - `no_profile_found` — no matching cooking profile in DB
    - `dish_always_as_served` — result is a restaurant dish, always as_served
    - `nutrients_not_per_100g` — reference basis is per_serving, cannot apply
    - `db_food_already_cooked` — DB food name indicates already-cooked nutrients
    - `cannot_reverse_cooked_to_raw` — user asked raw but DB food is cooked
    - `invalid_yield_factor` — yieldFactor ≤ 0 in DB (data error)
- `CookingProfile` — shape of a cooking_profiles row (for admin/seed introspection)

#### Shared Zod schemas to update

- `packages/shared/src/schemas/estimate.ts` — add optional `cookingState`,
  `cookingMethod` to `EstimateQuerySchema`; add `yieldAdjustment` to `EstimateDataSchema`
- `packages/shared/src/schemas/recipeCalculate.ts` — add optional `cookingState`,
  `cookingMethod` per ingredient; add `yieldAdjustment` to response

Full schema definitions are in `docs/specs/api-spec.yaml` (see F072 section).

### Data Model Changes

#### New table: `cooking_profiles`

```
model CookingProfile {
  id             String   @id @default(uuid()) @db.Uuid
  foodGroup      String   @map("food_group") @db.VarChar(100)
  foodName       String   @default("*") @map("food_name") @db.VarChar(255)
  cookingMethod  String   @map("cooking_method") @db.VarChar(100)
  yieldFactor    Decimal  @map("yield_factor") @db.Decimal(6, 4)
  fatAbsorption  Decimal? @map("fat_absorption") @db.Decimal(6, 2)
  source         String   @db.VarChar(255)
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  @@unique([foodGroup, foodName, cookingMethod])
  @@index([foodGroup])
  @@index([foodName])
  @@map("cooking_profiles")
}
```

**`foodName` sentinel value:** Group-level defaults use `foodName = '*'` (not NULL).
This ensures the PostgreSQL unique constraint works correctly for upsert idempotency
(NULL ≠ NULL in PG unique indexes). Lookup code treats `'*'` as "any food in group".

**Lookup priority (most to least specific):**
1. Exact match on `(foodGroup, foodName, cookingMethod)` — food-specific override
2. Match on `(foodGroup, '*', cookingMethod)` — group-level default
3. No profile found → no yield correction applied, `yieldAdjustment.applied = false`

**Seed data scope (~50 entries, `source = "USDA retention factors"`):**

Representative entries:

| foodGroup | foodName | cookingMethod | yieldFactor | fatAbsorption |
|---|---|---|---|---|
| grains | rice | boiled | 2.80 | null |
| grains | rice | steamed | 2.70 | null |
| grains | * | boiled | 2.50 | null |
| pasta | spaghetti | boiled | 2.20 | null |
| pasta | * | boiled | 2.10 | null |
| legumes | lentils | boiled | 3.00 | null |
| legumes | chickpeas | boiled | 2.40 | null |
| legumes | black beans | boiled | 2.60 | null |
| legumes | * | boiled | 2.50 | null |
| meat | chicken breast | grilled | 0.85 | null |
| meat | chicken breast | baked | 0.87 | null |
| meat | beef | grilled | 0.75 | null |
| meat | beef | fried | 0.78 | 4.50 |
| meat | pork | grilled | 0.72 | null |
| meat | * | grilled | 0.78 | null |
| fish | salmon | grilled | 0.80 | null |
| fish | cod | baked | 0.82 | null |
| fish | * | grilled | 0.82 | null |
| vegetables | potato | boiled | 0.90 | null |
| vegetables | potato | fried | 0.62 | 14.0 |
| vegetables | broccoli | boiled | 0.91 | null |
| vegetables | spinach | boiled | 0.89 | null |
| vegetables | * | boiled | 0.92 | null |
| vegetables | * | steamed | 0.94 | null |

Full ~50-entry seed list to be defined in the seed file.

**`yieldFactor` semantics:**
- `yieldFactor = cooked_weight / raw_weight`
- Values > 1.0: food absorbs water (grains, legumes, pasta)
- Values < 1.0: food loses moisture (meat, fish, some vegetables)

**No changes to existing tables.** `CookingMethod` (used by F002 for dish tagging)
is a separate model and remains unchanged. The new `cooking_profiles.cookingMethod`
column is a plain `VARCHAR` (not a FK) to avoid coupling with F002's restaurant-dish
domain model.

### UI Changes

None. Backend-only feature.

### Edge Cases & Error Handling

1. **No profile found for food group + method combination:** Return nutrients without
   yield adjustment. Set `yieldAdjustment.applied = false` and `yieldAdjustment.reason =
   "no_profile_found"` in the response. Do NOT error — graceful degradation is required.

2. **`cookingState = "as_served"` with a yield profile present:** Skip correction.
   The caller is asserting the weight is final serving weight. Log at `debug` level only.

3. **`cookingState` provided for a restaurant dish (not a generic food):** Restaurant
   dishes are always `as_served` by definition. Ignore `cookingState`, set
   `yieldAdjustment.applied = false`, `reason = "dish_always_as_served"`.

4. **Nutrient stored as `per_serving` (not `per_100g`):** Cannot apply yield correction
   reliably — set `yieldAdjustment.applied = false`, `reason = "nutrients_not_per_100g"`.

5. **`fatAbsorption` only applies to `cookingMethod = "fried"`:** If a non-frying
   cooking method is matched but the profile row has a `fatAbsorption` value
   (data error), do not apply fat absorption. Log at `warn` level.

6. **Zero or negative `yieldFactor` in DB:** Guard in the service — if
   `yieldFactor <= 0`, treat as no-profile-found and log `error`.

7. **`cookingState` on `GET /estimate` when Level 1 resolves to a dish:** Ignore.
   Only applied when the resolved entity is a `Food` (Level 1/3 food match or
   Level 2/4 ingredient-based result).

8. **`POST /calculate/recipe` free-form mode:** Cooking state cannot be declared
   per-ingredient in free-form mode (the text is parsed by LLM). Default assumptions
   apply to all resolved ingredients. A future F074 can extract cooking states from text.

9. **Idempotency of seed:** The `@@unique([foodGroup, foodName, cookingMethod])`
   constraint ensures the seed script is idempotent (`upsert` on that composite key).
   Group-level defaults use `foodName = '*'` (not NULL) to guarantee PG uniqueness.

10. **Already-cooked BEDCA food matched:** If the resolved food name contains cooking
    keywords (see "Already-cooked DB foods" section), skip yield adjustment and set
    `reason = "db_food_already_cooked"`. Do NOT double-correct.

11. **`cookingMethod` not provided by caller:** Use the default method for the food
    group (see "Default cooking methods per food group" table). If no default exists,
    no profile is found.

---

## Implementation Plan

### Existing Code to Reuse

- `NUMERIC_NUTRIENT_KEYS` and `applyPortionMultiplier` pattern in `packages/api/src/estimation/portionUtils.ts` — same loop-over-keys pattern applies to `applyYieldFactor`
- `parseDecimal()` in `packages/api/src/estimation/types.ts` — use for parsing Decimal columns from the new `cooking_profiles` table
- `buildKey`, `cacheGet`, `cacheSet` from `packages/api/src/lib/cache.ts` — cache key extension for `/estimate`
- `EstimateNutrientsSchema` from `packages/shared/src/schemas/estimate.ts` — nutrient shape used in `YieldAdjustmentSchema`
- `RecipeIngredientInputSchema` from `packages/shared/src/schemas/recipeCalculate.ts` — extend with new optional fields
- `PrismaClient` pattern in `packages/api/prisma/seed.ts` — upsert with deterministic UUIDs for cooking profiles seed
- `packages/api/src/estimation/engineRouter.ts` — `EngineRouterOptions` interface to extend with cooking params
- `packages/api/src/calculation/resolveIngredient.ts` — `ResolvedResult` carries the `FoodQueryRow` which contains `food_name` (needed for BEDCA keyword detection) and `food_group` (needed for normalization)
- Integration test fixture pattern from `packages/api/src/__tests__/migration.f002.integration.test.ts` — `fd000000-00XX-4000-a000-YYYYYYYYYYY` UUIDs, pre-cleanup in `beforeAll`, teardown in `afterAll`

---

### Files to Create

**Shared package — new schema**
- `packages/shared/src/schemas/cookingProfile.ts` — `CookingStateSchema`, `YieldAdjustmentSchema`, `CookingProfileSchema`; exported from `packages/shared/src/index.ts`

**API — pure utilities (no DB dependency)**
- `packages/api/src/estimation/yieldUtils.ts` — `normalizeFoodGroup()`, `applyYieldFactor()`, `getDefaultCookingMethod()`, `getDefaultCookingState()`, `isAlreadyCookedFood()` pure functions; re-exports `NUMERIC_NUTRIENT_KEYS` from `portionUtils` for convenience

**API — DB service (Prisma)**
- `packages/api/src/estimation/cookingProfileService.ts` — `getCookingProfile(prisma, foodGroup, foodName?, cookingMethod?)` — two-query lookup (exact → group wildcard), returns `CookingProfileRow | null`

**API — yield orchestration**
- `packages/api/src/estimation/applyYield.ts` — `resolveAndApplyYield(opts)` — orchestrates all guard checks and calls `getCookingProfile` + `applyYieldFactor`; returns `{ result: EstimateResult; yieldAdjustment: YieldAdjustment }`. Pure orchestration: receives already-resolved `EstimateResult`, `foodName`, `foodGroup`, `cookingState?`, `cookingMethod?`, `prisma`, `logger`.

**API — migration**
- `packages/api/prisma/migrations/20260403140000_cooking_profiles_f072/migration.sql` — creates `cooking_profiles` table, indexes, unique constraint

**Tests**
- `packages/api/src/__tests__/f072.yieldUtils.unit.test.ts` — unit tests for all pure functions in `yieldUtils.ts`
- `packages/api/src/__tests__/f072.cookingProfileService.unit.test.ts` — unit tests for `getCookingProfile` with mocked Prisma
- `packages/api/src/__tests__/f072.applyYield.unit.test.ts` — unit tests for `resolveAndApplyYield` covering all 11 edge cases + reason enum values
- `packages/api/src/__tests__/migration.f072.integration.test.ts` — integration tests: table exists, indexes exist, unique constraint, seed idempotency

---

### Files to Modify

- `packages/api/prisma/schema.prisma` — add `CookingProfile` model after the `WaitlistSubmission` model
- `packages/shared/src/schemas/estimate.ts` — add optional `cookingState`, `cookingMethod` to `EstimateQuerySchema`; add `yieldAdjustment` field to `EstimateDataSchema`
- `packages/shared/src/schemas/recipeCalculate.ts` — add optional `cookingState`, `cookingMethod` to `RecipeIngredientInputSchema`; add `yieldAdjustment` to `ResolvedAsSchema`
- `packages/shared/src/index.ts` — add `export * from './schemas/cookingProfile.js'`
- `packages/api/prisma/seed.ts` — add `seedCookingProfiles(prisma)` function and call it in `main()` with ~50 upsert entries using deterministic UUIDs in the `e000` namespace
- `packages/api/src/estimation/engineRouter.ts` — add `cookingState?`, `cookingMethod?` to `EngineRouterOptions`; call `resolveAndApplyYield` on the `result` after cascade; add `yieldAdjustment` to `EngineRouterResult.data`
- `packages/api/src/routes/estimate.ts` — extract `cookingState`, `cookingMethod` from `request.query`; extend cache key with both segments; pass them into `runEstimationCascade`
- `packages/api/src/routes/recipeCalculate.ts` — in `executeRecipeCalculation`, after each ingredient resolves, call `resolveAndApplyYield` using ingredient's `cookingState`/`cookingMethod`; attach `yieldAdjustment` to the `resolvedAs` block in `displayIngredients`; update `canonicalizeStructured` to include `cookingState`/`cookingMethod` in cache key computation

---

### Implementation Order

Follow this sequence to keep each step independently testable and to avoid merge conflicts between the shared and API layers.

**Step 1 — Shared schemas (foundation)**
- Write `f072.yieldUtils.unit.test.ts` tests for schema shapes first (they will fail until Step 1 is done)
- Create `packages/shared/src/schemas/cookingProfile.ts` with:
  - `CookingStateSchema = z.enum(['raw', 'cooked', 'as_served'])`
  - `CookingStateSourceSchema = z.enum(['explicit', 'default_assumption', 'none'])`
  - `YieldAdjustmentReasonSchema = z.enum([...all 9 reason values from spec...])`
  - `YieldAdjustmentSchema` with all fields from spec
  - `CookingProfileSchema` mirroring the Prisma model shape
- Add `export * from './schemas/cookingProfile.js'` to `packages/shared/src/index.ts`
- Extend `EstimateQuerySchema` with `.extend({ cookingState: CookingStateSchema.optional(), cookingMethod: z.string().max(100).optional() })`
- Extend `EstimateDataSchema` with `yieldAdjustment: YieldAdjustmentSchema.nullable()`
- Extend `RecipeIngredientInputSchema` with `cookingState: CookingStateSchema.optional(), cookingMethod: z.string().max(100).optional()`
- Add `yieldAdjustment: YieldAdjustmentSchema.nullable()` to `ResolvedAsSchema`
- Rebuild `@foodxplorer/shared` and confirm TypeScript sees the new exported types

**Step 2 — Prisma migration + model**
- Add `CookingProfile` model to `packages/api/prisma/schema.prisma` exactly as specified in the Data Model section
- Note: `@@unique([foodGroup, foodName, cookingMethod])` already creates an index on those three columns — do NOT add a redundant `@@index` on the same combination; only add `@@index([foodGroup])` and `@@index([foodName])` as specified
- Run `npx prisma migrate dev --create-only --name cooking_profiles_f072 -w @foodxplorer/api` to generate the SQL skeleton
- Do NOT add a DB-level CHECK constraint — validation for `yieldFactor <= 0` lives in application code (`cookingProfileService.ts`) so the `invalid_yield_factor` reason can be surfaced to API clients
- Run `npx prisma migrate deploy -w @foodxplorer/api` to apply
- Run `npx prisma generate -w @foodxplorer/api` to regenerate Prisma client + Kysely types

**Step 3 — Integration test for migration**
- Write `packages/api/src/__tests__/migration.f072.integration.test.ts`:
  - Verify table exists via `prisma.$queryRaw` on `pg_tables`
  - Verify `@@index([foodGroup])` and `@@index([foodName])` exist via `pg_indexes`
  - Verify the unique constraint on `(food_group, food_name, cooking_method)` exists via `pg_constraint`
  - Verify upsert idempotency: insert same row twice, expect count = 1
  - Verify sentinel `foodName = '*'` stores and retrieves correctly

**Step 4 — Pure utility functions**
- Write `f072.yieldUtils.unit.test.ts` (all tests should now be runnable)
- Create `packages/api/src/estimation/yieldUtils.ts`:
  - `CookingGroup` type: `'grains' | 'pasta' | 'legumes' | 'meat' | 'fish' | 'vegetables' | null`
  - `normalizeFoodGroup(rawFoodGroup: string): CookingGroup` — case-insensitive substring matching per spec table; returns `null` for unmatched
  - `getDefaultCookingMethod(group: CookingGroup): string | null` — per spec table (`'boiled'` / `'grilled'` / `null`)
  - `getDefaultCookingState(group: CookingGroup): 'raw' | 'cooked' | 'as_served'` — per spec default assumptions table
  - `isAlreadyCookedFood(foodName: string): boolean` — checks for cooking keywords (both ES and EN per spec list) case-insensitively
  - `applyYieldFactor(nutrients: EstimateNutrients, yieldFactor: number, fatAbsorption?: number | null): EstimateNutrients` — first adds `fatAbsorption` to `fats` and `fatAbsorption * 9` to `calories` (both are per-100g-raw basis), THEN divides ALL NUMERIC_NUTRIENT_KEYS by `yieldFactor` (converting to per-100g-cooked). Order matters: fat absorption is defined per 100g raw, so it must be added before the raw→cooked conversion. Returns new object (pure, no mutation); use `NUMERIC_NUTRIENT_KEYS` imported from `portionUtils.ts`

**Step 5 — Cooking profile service (DB lookup)**
- Write `f072.cookingProfileService.unit.test.ts` with mocked `prisma.cookingProfile.findFirst`
- Create `packages/api/src/estimation/cookingProfileService.ts`:
  - `CookingProfileRow` interface matching Prisma model columns (use `Decimal` as `string` for numeric fields — consistent with Kysely row patterns; convert with `Number()` in caller)
  - `getCookingProfile(prisma: PrismaClient, foodGroup: string, foodName: string, cookingMethod: string): Promise<{ profile: CookingProfileRow } | { error: 'invalid_yield_factor' } | null>` — two-query strategy:
    1. `prisma.cookingProfile.findFirst({ where: { foodGroup, foodName, cookingMethod } })` — exact
    2. If null: `prisma.cookingProfile.findFirst({ where: { foodGroup, foodName: '*', cookingMethod } })` — group wildcard
  - Returns `null` when both queries miss
  - Validates `yieldFactor > 0`; if not, returns `{ error: 'invalid_yield_factor' }` (no logging here — orchestrator handles logging and reason mapping)

**Step 6 — Yield orchestration layer**
- Write `f072.applyYield.unit.test.ts` covering all 11 edge cases with mocked `getCookingProfile` and mocked logger
- Create `packages/api/src/estimation/applyYield.ts`:
  - `ApplyYieldOptions` interface: `{ result: EstimateResult; foodName: string; rawFoodGroup: string | null; cookingState?: string; cookingMethod?: string; prisma: PrismaClient; logger: Logger }`
  - `resolveAndApplyYield(opts): Promise<{ result: EstimateResult; yieldAdjustment: YieldAdjustment }>` implementing the decision tree:
    1. If `result.entityType === 'dish'` → return `dish_always_as_served` reason (edge case 3)
    2. If `result.nutrients.referenceBasis !== 'per_100g'` → return `nutrients_not_per_100g` (edge case 4)
    3. **Compute all derived values first:** normalize food group via `normalizeFoodGroup(rawFoodGroup)`, resolve `effectiveCookingState` (explicit or `getDefaultCookingState(group)`), resolve `effectiveCookingMethod` (explicit or `getDefaultCookingMethod(group)`), determine `cookingStateSource` (`'explicit'` / `'default_assumption'`)
    4. If `isAlreadyCookedFood(foodName)`:
       - If `effectiveCookingState === 'cooked'` → return `db_food_already_cooked`, no adjustment (edge case 10)
       - If `effectiveCookingState === 'raw'` → log warn, return `cannot_reverse_cooked_to_raw`, no adjustment
    5. If `effectiveCookingState === 'as_served'` → return `as_served_passthrough`
    6. If `effectiveCookingState === 'raw'` → return `raw_state_no_correction`, no adjustment
    7. If `effectiveCookingState === 'cooked'`: call `getCookingProfile`; if `{ error: 'invalid_yield_factor' }` → return `invalid_yield_factor`; if null → `no_profile_found`; if `{ profile }` → call `applyYieldFactor`, apply fat absorption only when `cookingMethod === 'fried'` (guard: log warn if profile has `fatAbsorption` but method ≠ `'fried'` per edge case 5), return `cooked_state_applied`

**Step 7 — Seed cooking profiles**
- Write `seedCookingProfiles(prisma)` function in `packages/api/prisma/seed.ts` (or extract into a helper called from `main()`)
- Use namespace `e000` for deterministic UUIDs: `00000000-0000-0000-e000-000000000001` through `~050`
- Use `upsert` with `where: { foodGroup_foodName_cookingMethod: { foodGroup, foodName, cookingMethod } }` (Prisma composite unique key accessor)
- Include all ~50 rows from the spec's seed data table plus additional entries to reach coverage of all food groups and their wildcard defaults
- Run seed via `npm run db:seed -w @foodxplorer/api`; confirm no duplicates on re-run

**Step 8 — Integration into `GET /estimate` route**
- Modify `packages/api/src/estimation/engineRouter.ts`:
  - Add `cookingState?: string` and `cookingMethod?: string` to `EngineRouterOptions`
  - After cascade produces a non-null `result`, call `resolveAndApplyYield`; pass `result.name` as `foodName` and `result.entityType`-resolved food group (need to extend `EngineRouterResult` with optional `foodGroup` — or fetch it separately; see note below)
  - Add `yieldAdjustment: YieldAdjustment | null` to the returned `data`
  - **Note:** The `EstimateResult` returned by Level 1-4 does not carry `foodGroup`. The engine router must fetch the food's `foodGroup` from the `FoodQueryRow`. The `level1Lookup` and `level3Lookup` return `EstimateResult` objects. To access `foodGroup`, the `EngineRouterResult` should carry the raw food group string alongside the result. Alternatively, fetch it with a minimal Prisma query after resolution. The simplest approach: pass the `rawFoodGroup` extracted from the Level 1/3/4 result's underlying row. Add `rawFoodGroup?: string | null` to the internal routing state and thread it through; populate it in `mapFoodRowToResult` callers by returning it as part of the intermediate result.
  - **Simpler alternative (preferred):** Add `rawFoodGroup?: string | null` to `Level1Result`, `Level3Result`, and the Level 4 result shape, populated from the resolved `FoodQueryRow.food_group` (which is already selected in the SQL queries — confirm this). Then `engineRouter.ts` extracts `rawFoodGroup` from the level result and passes it to `resolveAndApplyYield`.
- Modify `packages/api/src/routes/estimate.ts`:
  - Destructure `cookingState`, `cookingMethod` from `request.query`
  - Extend cache key: `buildKey('estimate', \`\${normalizedQuery}:\${chainSlug ?? ''}:\${restaurantId ?? ''}:\${effectiveMultiplier}:\${cookingState ?? ''}:\${cookingMethod ?? ''}\`)` — maintains backward compatibility (empty strings for absent params)
  - Pass `cookingState` and `cookingMethod` to `runEstimationCascade`

**Step 9 — Integration into `POST /calculate/recipe` route**
- Modify `packages/api/src/routes/recipeCalculate.ts`:
  - In `executeRecipeCalculation`, after each ingredient resolves (in the `displayIngredients` build loop), call `resolveAndApplyYield` for resolved items
  - Pass per-ingredient `cookingState`/`cookingMethod` from `body.ingredients[i]` (structured mode only; free-form mode uses defaults by passing `undefined`)
  - Attach `yieldAdjustment` to the `resolvedAs` block: `resolvedAs: { ..., yieldAdjustment: adj }`
  - Use corrected nutrients (post-yield) for aggregation by replacing the `nutrientRow` equivalent before passing to `aggregateNutrients`. Because `aggregateNutrients` takes `ResolvedIngredientForAggregation` with `nutrientRow: FoodQueryRow` (raw DB strings), the yield correction must happen at the `aggregateNutrients` boundary. The cleanest approach: apply yield correction AFTER `aggregateNutrients` for the per-ingredient nutrient display, but BEFORE passing to totals. Actually: yield must be applied before aggregation so totals are correct. Since `applyYieldFactor` returns `EstimateNutrients` (number-typed), a new aggregation path is needed for yield-corrected ingredients. **Implementation approach:** After resolving each ingredient and computing yield, attach a `yieldCorrectedNutrients?: EstimateNutrients | null` alongside the `nutrientRow`. In the aggregation step, if `yieldCorrectedNutrients` is present, use it (converted back to the string format expected by `aggregateNutrients`); otherwise fall through to raw `nutrientRow`. Add a new `aggregateWithYield` helper in `packages/api/src/calculation/aggregateNutrients.ts` that accepts pre-corrected number nutrients (bypassing `parseNullable`) — or simply extend `ResolvedIngredientForAggregation` with an optional override.
  - Update `canonicalizeStructured` to include `cookingState` and `cookingMethod` per ingredient so the cache key changes when these params are provided

---

### Testing Strategy

**Unit test files:**

`packages/api/src/__tests__/f072.yieldUtils.unit.test.ts`
- `normalizeFoodGroup`: known matches (each canonical group), case-insensitive, unmatched returns `null`
- `getDefaultCookingMethod`: each CookingGroup → expected string, `null` for composite/unknown
- `getDefaultCookingState`: grains/legumes/pasta → `'cooked'`, meat/fish → `'raw'`, null → `'as_served'`
- `isAlreadyCookedFood`: ES keywords (`hervido`, `cocido`, `frito`, `asado`), EN keywords (`boiled`, `cooked`, `fried`), case-insensitive, no false positives (plain food name)
- `applyYieldFactor`: scale-up (grains, yieldFactor=2.8), scale-down (meat, yieldFactor=0.85), fat absorption adds to `fats` not `saturatedFats` + recalculates calories, null `fatAbsorption` skipped, pure (no mutation), result `referenceBasis` unchanged

`packages/api/src/__tests__/f072.cookingProfileService.unit.test.ts`
- Mock `prisma.cookingProfile.findFirst`
- Exact match found on first query → returns `{ profile }`
- Exact miss → second query (group wildcard) → returns `{ profile }`
- Both miss → `null`
- Profile with `yieldFactor <= 0` → returns `{ error: 'invalid_yield_factor' }`
- `getCookingProfile` called with correct `where` clauses in both queries

`packages/api/src/__tests__/f072.applyYield.unit.test.ts`
- Entity type `'dish'` → reason `dish_always_as_served`, `applied: false`
- `referenceBasis = 'per_serving'` → reason `nutrients_not_per_100g`, `applied: false`
- `isAlreadyCookedFood = true` + `cookingState = 'cooked'` → `db_food_already_cooked`, `applied: false`
- `isAlreadyCookedFood = true` + `cookingState = 'raw'` → `cannot_reverse_cooked_to_raw`, logger.warn called
- `cookingState = 'as_served'` (explicit) → `as_served_passthrough`, `applied: false`
- `cookingState = 'raw'` → `raw_state_no_correction`, `applied: false`
- `cookingState = 'cooked'`, profile found → `cooked_state_applied`, `applied: true`, nutrients divided by yieldFactor
- `cookingState = 'cooked'`, no profile → `no_profile_found`, `applied: false`
- Default cookingState fires correctly (grains → `'cooked'`, meat → `'raw'`)
- `cookingStateSource` = `'explicit'` vs `'default_assumption'` per case
- Fat absorption: `cookingMethod = 'fried'`, profile has `fatAbsorption` → applied to `fats`; `cookingMethod ≠ 'fried'` with `fatAbsorption` in profile → not applied, logger.warn called

**Integration test file:**

`packages/api/src/__tests__/migration.f072.integration.test.ts`
- Table `cooking_profiles` exists in `pg_tables`
- Index on `food_group` and `food_name` exist (check `pg_indexes`)
- Unique constraint on `(food_group, food_name, cooking_method)` — second identical insert fails with unique violation
- Sentinel `foodName = '*'` stores and retrieves correctly
- No DB CHECK constraint on yield_factor (validation in application code for `invalid_yield_factor` reason)
- Two upserts of same row → single row in table (idempotency)
- FK teardown: `beforeAll`/`afterAll` only need to delete from `cooking_profiles` (no FK dependencies)

**Mocking strategy:**
- `getCookingProfile` is mocked with `vi.fn()` in `applyYield` tests (inject via parameter or vi.mock of the module)
- All unit tests: no real DB connection, no Redis
- Integration tests: use `DATABASE_URL_TEST` env var, real Prisma client

---

### Key Patterns

**Pure functions — follow `portionUtils.ts` exactly:**
- `applyYieldFactor` must loop over `NUMERIC_NUTRIENT_KEYS` (re-use from `portionUtils.ts`), spread nutrients into a new object, never mutate input
- Return type is `EstimateNutrients` (all fields are `number`, not `string`)

**Prisma Decimal columns:**
- `yieldFactor` and `fatAbsorption` come back from Prisma as `Decimal` objects; convert with `Number()` before arithmetic. Document this in `cookingProfileService.ts`

**Migration timestamp:**
- Use `20260403140000_cooking_profiles_f072` — next in sequence after `20260402120000_anonymous_identity_f069`

**Unique constraint syntax in Prisma upsert:**
- The composite unique `@@unique([foodGroup, foodName, cookingMethod])` generates a Prisma accessor `foodGroup_foodName_cookingMethod` — use this as the `where` clause in `upsert` calls

**Cache key extension:**
- Appending `:<cookingState>:<cookingMethod>` invalidates all existing cached responses (new format `fxp:estimate:<query>:<chainSlug>:<restaurantId>:<portionMultiplier>:<cookingState>:<cookingMethod>`). This is expected and acceptable — Redis cache TTL is 300s so stale entries expire within 5 minutes of deployment
- Empty strings for omitted params ensure consistent key format across all callers

**`foodGroup` threading:**
- `FoodQueryRow` in `packages/api/src/estimation/types.ts` does NOT currently include `food_group`. The SQL queries do not select `f.food_group`. To thread `rawFoodGroup` into the engine:
  1. Add `food_group: string | null` to `FoodQueryRow` type
  2. Add `f.food_group AS food_group` to ALL food-resolving SQL queries: Level 1 (food strategies in `level1Lookup.ts`), Level 2 (`resolveIngredient.ts` — 4 strategies that resolve ingredient foods), Level 3 (`level3Lookup.ts`), and Level 4 (`level4Lookup.ts`). Level 2 is critical because it resolves individual ingredient foods which need yield correction.
  3. Dish strategies in Level 1 set `food_group = null` (dishes are always as_served)
  4. Add `rawFoodGroup?: string | null` to `Level1Result`, `Level2Result`, `Level3Result`, and the Level 4 inline result shape
  5. `engineRouter.ts` extracts and threads `rawFoodGroup` to `resolveAndApplyYield`

**Free-form mode — cooking state:**
- In `recipeCalculate.ts`, free-form mode parsed ingredients have no `cookingState`/`cookingMethod`. Pass `undefined` for both → default assumptions fire. Do NOT try to extract cooking state from free-form text (deferred to F074 per spec).

**Aggregation with yield-corrected nutrients:**
- Concrete approach: after `applyYieldFactor` returns corrected `EstimateNutrients` (number-typed), convert the corrected values back to string format and replace the corresponding fields in a cloned `nutrientRow` (FoodQueryRow). Pass the cloned row to `aggregateNutrients` unchanged — the aggregation code remains unaware of yield correction. This avoids changing the aggregation interface or adding an override field.

**Reason enum — exhaustive:**
- The `reason` field on `YieldAdjustmentSchema` is a string enum with exactly 9 values. The `resolveAndApplyYield` function must cover all 9. Use TypeScript's `satisfies` check or a switch/exhaustive check to prevent drift.

**`invalid_yield_factor` reason:**
- This reason is returned when `getCookingProfile` finds a row but `yieldFactor <= 0`. Handle it inside `resolveAndApplyYield` after the service returns `null`: the service logs the error and returns `null`, so `resolveAndApplyYield` cannot distinguish "not found" from "invalid factor". To surface this reason, change `getCookingProfile` to return `{ profile: CookingProfileRow } | { error: 'invalid_yield_factor' } | null` instead of bare `CookingProfileRow | null`. The orchestrator maps the error variant to the `invalid_yield_factor` reason.

**Test file naming convention:** `f072.<module>.<type>.test.ts` — consistent with `f070`/`f071` naming.

---

## Acceptance Criteria

- [ ] Prisma migration creates `cooking_profiles` table with correct columns, indexes, and unique constraint
- [ ] Seed script populates ~50 cooking profiles; running twice produces no duplicates
- [ ] `getCookingProfile(foodGroup, foodName?, cookingMethod?)` returns most-specific matching profile or `null`
- [ ] `applyYieldFactor(nutrients, yieldFactor, fatAbsorption?)` correctly scales all nutrient columns
- [ ] `POST /calculate/recipe` structured mode: `cookingState` per ingredient triggers yield correction
- [ ] `POST /calculate/recipe` response includes `yieldAdjustment` block per resolved ingredient
- [ ] `GET /estimate` accepts optional `cookingState` query param; correction applied for food results
- [ ] Default assumptions fire correctly by food group when `cookingState` is omitted
- [ ] Fat absorption added to `fats` only (not `saturatedFats`) + calories recalculated (+fat×9)
- [ ] `normalizeFoodGroup()` maps USDA/BEDCA raw food groups to canonical cooking groups
- [ ] Already-cooked BEDCA foods detected by name keywords → yield skipped
- [ ] `cookingMethod` accepted as optional param on both endpoints; defaults per food group
- [ ] All 11 edge cases from spec handled with correct `yieldAdjustment.reason` values
- [ ] Unit tests for `getCookingProfile` (exact match, group fallback, no match)
- [ ] Unit tests for `applyYieldFactor` (scale-down, scale-up, fat absorption + calorie recalc, as_served)
- [ ] Unit tests for `normalizeFoodGroup` mapping
- [ ] Unit tests for already-cooked food detection
- [ ] Unit tests for default cooking method per food group
- [ ] All tests pass
- [ ] Build succeeds
- [ ] Specs updated (`api-spec.yaml` + shared Zod schemas)

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

- [x] Step 0: `spec-creator` executed, specs updated
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
| 2026-04-03 | Spec created | spec-creator agent — F072 cooking profiles + yield factors |
| 2026-04-03 | Spec reviewed | Gemini + Codex: 4 CRITICAL + 5 IMPORTANT. All 9 addressed: fat→calories, BEDCA guard, foodGroup normalization, cookingMethod in API, NULL sentinel, reason enum, Zod schemas, saturated fat, yieldAdjustment in /estimate |
| 2026-04-03 | Plan created | backend-planner agent — 9 steps, 4 new files, 8 modified files |
| 2026-04-03 | Plan reviewed | Gemini + Codex: 2 CRITICAL + 6 IMPORTANT. All addressed: CHECK constraint removed, fat absorption math order, 9 reason values, decision tree reordered, L2 foodGroup threading, service discriminated union, cache invalidation acknowledged, aggregation approach settled |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | Sections verified: (list) |
| 1. Mark all items | [ ] | AC: _/_, DoD: _/_, Workflow: _/_ |
| 2. Verify product tracker | [ ] | Active Session: step _/6, Features table: _/6 |
| 3. Update key_facts.md | [ ] | Updated: (list) / N/A |
| 4. Update decisions.md | [ ] | ADR-XXX added / N/A |
| 5. Commit documentation | [ ] | Commit: (hash) |
| 6. Verify clean working tree | [ ] | `git status`: clean |

---

*Ticket created: 2026-04-03*
