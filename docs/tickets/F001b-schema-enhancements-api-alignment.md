# F001b: Schema Enhancements — Nutrition API Alignment

**Feature:** F001b | **Type:** Backend-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F001b-schema-enhancements-api-alignment
**Created:** 2026-03-11 | **Dependencies:** F001 complete

---

## Spec

### Description

Enhance the core schema (F001) based on a comparative analysis of 7 major nutrition APIs (USDA FoodData Central, Nutritionix, Edamam, Open Food Facts, Calorie Mama, FatSecret, Spoonacular). The research identified 7 high-priority gaps that should be addressed before building F002 (Dishes & Restaurants).

This migration adds new enums, columns, and tables to align our data model with industry standards and enable proper modeling of branded foods, composite dishes (recipes with ingredients), and standardized nutrient reference bases.

**ADR:** ADR-003 documents the full rationale.

### API Changes

None — F001b is schema-only. API endpoints come in F004/F025.

### Data Model Changes

**New enums:**
- `FoodType`: `generic`, `branded`, `composite` — discriminator on `Food`
- `NutrientReferenceBasis`: `per_100g`, `per_serving`, `per_package` — on `FoodNutrient`

**New columns on existing tables:**

1. `foods.food_type` — `FoodType` enum, NOT NULL, default `generic`
2. `foods.brand_name` — `VARCHAR(255)`, nullable
3. `foods.barcode` — `VARCHAR(50)`, nullable, indexed
4. `food_nutrients.reference_basis` — `NutrientReferenceBasis` enum, NOT NULL, default `per_100g`
5. `food_nutrients.trans_fats` — `DECIMAL(8,2)`, NOT NULL, default 0
6. `food_nutrients.cholesterol` — `DECIMAL(8,2)`, NOT NULL, default 0
7. `food_nutrients.potassium` — `DECIMAL(8,2)`, NOT NULL, default 0
8. `food_nutrients.monounsaturated_fats` — `DECIMAL(8,2)`, NOT NULL, default 0
9. `food_nutrients.polyunsaturated_fats` — `DECIMAL(8,2)`, NOT NULL, default 0
10. `standard_portions.description` — `VARCHAR(255)`, NOT NULL (human-readable: "1 cup", "1 medium slice")
11. `standard_portions.is_default` — `BOOLEAN`, NOT NULL, default false

**New tables:**

12. `recipes` — Links a composite `Food` to its preparation metadata
    - `id` UUID PK
    - `food_id` UUID UNIQUE FK → foods (where food_type = 'composite')
    - `servings` INT nullable
    - `prep_minutes` INT nullable
    - `cook_minutes` INT nullable
    - `source_id` UUID FK → data_sources
    - `created_at`, `updated_at`

13. `recipe_ingredients` — Ingredient composition of a recipe
    - `id` UUID PK
    - `recipe_id` UUID FK → recipes
    - `ingredient_food_id` UUID FK → foods
    - `amount` DECIMAL(8,2) NOT NULL
    - `unit` VARCHAR(50) NOT NULL
    - `gram_weight` DECIMAL(8,2) nullable (resolved weight in grams)
    - `sort_order` INT NOT NULL
    - `notes` TEXT nullable
    - `created_at`, `updated_at`

**New constraints (raw SQL):**
- `food_nutrients`: CHECK `trans_fats >= 0 AND cholesterol >= 0 AND potassium >= 0 AND monounsaturated_fats >= 0 AND polyunsaturated_fats >= 0`
- `recipes.servings` CHECK `servings > 0`
- `recipes.prep_minutes` CHECK `prep_minutes >= 0`
- `recipes.cook_minutes` CHECK `cook_minutes >= 0`
- `recipe_ingredients.amount` CHECK `amount > 0`
- `recipe_ingredients.sort_order` CHECK `sort_order >= 0`
- `recipe_ingredients` UNIQUE `(recipe_id, ingredient_food_id, sort_order)` — prevent duplicate ingredients at same position

**New indexes:**
- `foods.barcode` — btree index (packaged food lookup)
- `foods.food_type` — btree index (filter by type)
- `foods.brand_name` — btree index where NOT NULL (branded food search)
- `recipe_ingredients.recipe_id` — btree (ingredient lookup)
- `recipe_ingredients.ingredient_food_id` — btree (reverse lookup: "which recipes use this food?")

### Edge Cases & Error Handling

- Existing data must be migrated: all existing foods get `food_type = 'generic'`, existing nutrients get `reference_basis = 'per_100g'`, existing portions need a `description` value derived from context/notes
- New nutrient columns default to 0 for existing rows (accurate for the 3 seed foods: chicken, rice, olive oil have known zero/negligible values for these nutrients except chicken cholesterol — update in seed)
- `standard_portions.description` is NOT NULL on a table with existing rows → migration must set default values before adding NOT NULL constraint
- Recipe model requires `food_type = 'composite'` but this is application-level logic (not a DB CHECK, as Prisma doesn't support cross-table CHECKs)

---

## Implementation Plan

### Context Notes for the Developer

- This migration layers on top of F001. The existing migration file must not be touched. A new migration file is created alongside it.
- The `standard_portions.description` column is declared NOT NULL, but existing rows already exist. The migration must SET a DEFAULT value first, add the column, then DROP the default — use a two-step column addition pattern within the same migration file (see Key Patterns section).
- Migration workflow: `npx prisma migrate dev --create-only --name schema_enhancements_f001b -w @foodxplorer/api` → edit the generated SQL → `npx prisma migrate deploy -w @foodxplorer/api`. Never use `migrate dev` to apply (shadow DB lacks pgvector).
- Enum values in Prisma schema are lowercase snake_case and must exactly match the Zod string literals: `'generic'`, `'branded'`, `'composite'`, `'per_100g'`, `'per_serving'`, `'per_package'`.
- `recipes.food_id` is a UNIQUE FK — declare `@@unique([foodId])` in Prisma schema (not raw SQL UNIQUE) so Prisma tracks it. The `recipe_ingredients` UNIQUE `(recipe_id, ingredient_food_id, sort_order)` must also be declared as `@@unique` in Prisma schema.
- `recipe_ingredients` FKs to `recipes` and `foods`: use `onDelete: Restrict` in Prisma schema to match the F001 FK pattern.
- Chicken breast has non-zero cholesterol (~85mg per 100g). The seed `update: {}` blocks must be changed to `update: { cholesterol: 85 }` for that food nutrient record so the new column gets the correct value on re-seed.
- The `recipes` and `recipe_ingredients` tables have FK `source_id → data_sources` on recipes only. No source_id on recipe_ingredients — see spec.
- All new CHECK constraints must be raw SQL in the migration (Prisma cannot express them). Follow the pattern from the F001 migration.
- Zod: `Decimal(8,2)` maps to `z.number().nonnegative()`. New nutrient columns default to 0 at DB level, and Zod validation must accept 0. `recipes.servings` is nullable INT — map to `z.number().int().positive().nullable()`. `prep_minutes`/`cook_minutes` are nullable INT mapping to `z.number().int().nonnegative().nullable()`.
- TDD order: write/update failing tests first, then make them pass.

---

### Existing Code to Reuse

- `packages/api/prisma/schema.prisma` — extend in-place (add new enums and models, modify existing models)
- `packages/api/prisma/migrations/20260310174347_init_core_tables/migration.sql` — reference only; do not modify
- `packages/api/prisma/seed.ts` — extend in-place (update existing upserts, add recipe seed)
- `packages/shared/src/schemas/enums.ts` — add new enum schemas here
- `packages/shared/src/schemas/food.ts` — update FoodSchema / CreateFoodSchema
- `packages/shared/src/schemas/foodNutrient.ts` — update FoodNutrientSchema / CreateFoodNutrientSchema
- `packages/shared/src/schemas/standardPortion.ts` — update StandardPortionSchema / CreateStandardPortionSchema
- `packages/shared/src/index.ts` — add exports for new schema files
- `packages/api/src/__tests__/migration.integration.test.ts` — update `beforeAll` food inserts and `StandardPortion` CRUD tests to include new required fields; existing tests must still pass
- `packages/api/src/__tests__/migration.edge-cases.test.ts` — update any StandardPortion inserts that omit `description`
- `packages/shared/src/__tests__/schemas.test.ts` — add tests for all new schemas

---

### Files to Create

1. **`packages/api/prisma/migrations/<timestamp>_schema_enhancements_f001b/migration.sql`**
   Generated by `prisma migrate dev --create-only` then manually edited to add: raw SQL CHECK constraints, btree indexes, and the two-step pattern for `standard_portions.description NOT NULL`.

2. **`packages/shared/src/schemas/recipe.ts`**
   Zod schemas for `Recipe` and `CreateRecipe`. Fields: `id`, `foodId`, `servings` (nullable positive int), `prepMinutes` (nullable nonnegative int), `cookMinutes` (nullable nonnegative int), `sourceId`, `createdAt`, `updatedAt`. `CreateRecipeSchema` omits `id`, `createdAt`, `updatedAt`. Both `Recipe` and `CreateRecipe` types exported.

3. **`packages/shared/src/schemas/recipeIngredient.ts`**
   Zod schemas for `RecipeIngredient` and `CreateRecipeIngredient`. Fields: `id`, `recipeId`, `ingredientFoodId`, `amount` (positive number), `unit` (string min 1 max 50), `gramWeight` (nullable nonnegative number), `sortOrder` (nonnegative int), `notes` (nullable string), `createdAt`, `updatedAt`. `CreateRecipeIngredientSchema` omits `id`, `createdAt`, `updatedAt`. Both types exported.

4. **`packages/api/src/__tests__/migration.f001b.integration.test.ts`**
   New integration test file covering all F001b additions. Self-contained with own fixture IDs (use `fd000000-...` prefix to avoid collisions with existing test files). See Testing Strategy section for full scenario list.

---

### Files to Modify

1. **`packages/api/prisma/schema.prisma`**
   - Add `FoodType` enum (`generic`, `branded`, `composite`) with `@@map("food_type")`
   - Add `NutrientReferenceBasis` enum (`per_100g`, `per_serving`, `per_package`) with `@@map("nutrient_reference_basis")`
   - On `Food` model: add `foodType FoodType @default(generic) @map("food_type")`, `brandName String? @map("brand_name") @db.VarChar(255)`, `barcode String? @db.VarChar(50)`. Add `recipes Recipe[]` relation. Add `@@index([foodType])`, `@@index([barcode])` — the partial index for brand_name must remain raw SQL only (Prisma does not support WHERE clauses on `@@index`).
   - On `FoodNutrient` model: add `referenceBasis NutrientReferenceBasis @default(per_100g) @map("reference_basis")`, `transFats Decimal @default(0) @map("trans_fats") @db.Decimal(8,2)`, `cholesterol Decimal @default(0) @db.Decimal(8,2)`, `potassium Decimal @default(0) @db.Decimal(8,2)`, `monounsaturatedFats Decimal @default(0) @map("monounsaturated_fats") @db.Decimal(8,2)`, `polyunsaturatedFats Decimal @default(0) @map("polyunsaturated_fats") @db.Decimal(8,2)`.
   - On `StandardPortion` model: add `description String @db.VarChar(255)`, `isDefault Boolean @default(false) @map("is_default")`.
   - Add `Recipe` model: `id UUID PK`, `foodId String @unique @map("food_id") @db.Uuid`, `servings Int?`, `prepMinutes Int? @map("prep_minutes")`, `cookMinutes Int? @map("cook_minutes")`, `sourceId String @map("source_id") @db.Uuid`, `createdAt/updatedAt`. Relations: `food Food`, `source DataSource`, `ingredients RecipeIngredient[]`. `@@unique([foodId])` (Prisma-tracked), `@@map("recipes")`.
   - Add `RecipeIngredient` model: `id UUID PK`, `recipeId String @map("recipe_id") @db.Uuid`, `ingredientFoodId String @map("ingredient_food_id") @db.Uuid`, `amount Decimal @db.Decimal(8,2)`, `unit String @db.VarChar(50)`, `gramWeight Decimal? @map("gram_weight") @db.Decimal(8,2)`, `sortOrder Int @map("sort_order")`, `notes String? @db.Text`, `createdAt/updatedAt`. Relations: `recipe Recipe`, `ingredientFood Food`. `@@unique([recipeId, ingredientFoodId, sortOrder])`, `@@index([recipeId])`, `@@index([ingredientFoodId])`, `@@map("recipe_ingredients")`.
   - Add `recipes Recipe[]` and `recipeIngredients RecipeIngredient[]` back-relations on `DataSource` and `Food` models where appropriate.

2. **`packages/shared/src/schemas/enums.ts`**
   - Add `FoodTypeSchema = z.enum(['generic', 'branded', 'composite'])` and `export type FoodType`
   - Add `NutrientReferenceBasisSchema = z.enum(['per_100g', 'per_serving', 'per_package'])` and `export type NutrientReferenceBasis`

3. **`packages/shared/src/schemas/food.ts`**
   - Import `FoodTypeSchema` from `./enums`
   - Add to `FoodSchema`: `foodType: FoodTypeSchema`, `brandName: z.string().max(255).nullable().optional()`, `barcode: z.string().max(50).nullable().optional()`
   - `CreateFoodSchema` omits `id`, `createdAt`, `updatedAt` — `foodType` will be included with its Zod default (`'generic'` — use `.default('generic')` on `FoodTypeSchema` in the schema definition or handle at the create level)

4. **`packages/shared/src/schemas/foodNutrient.ts`**
   - Import `NutrientReferenceBasisSchema` from `./enums`
   - Add to `FoodNutrientSchema`: `referenceBasis: NutrientReferenceBasisSchema`, `transFats: z.number().nonnegative()`, `cholesterol: z.number().nonnegative()`, `potassium: z.number().nonnegative()`, `monounsaturatedFats: z.number().nonnegative()`, `polyunsaturatedFats: z.number().nonnegative()`
   - `CreateFoodNutrientSchema` already omits `id`/timestamps — new fields will be included automatically. Add `.default(0)` to new nutrient fields in CreateFoodNutrientSchema so callers can omit them (matching DB default).

5. **`packages/shared/src/schemas/standardPortion.ts`**
   - Add to `StandardPortionSchema`: `description: z.string().min(1).max(255)`, `isDefault: z.boolean()`
   - These fields are NOT NULL in DB. `CreateStandardPortionSchema` must require `description` (no default) and allow `isDefault` to default to `false` via `.default(false)`.

6. **`packages/shared/src/index.ts`**
   - Add: `export * from './schemas/recipe';` and `export * from './schemas/recipeIngredient';`

7. **`packages/api/prisma/seed.ts`**
   - Update all three `prisma.food.upsert` `update: {}` blocks to include `food_type: 'generic'` (though this is already the DB default, the upsert update block should reflect current state).
   - Update all three `prisma.foodNutrient.upsert` `update: {}` blocks: for chicken, set `update: { cholesterol: 85 }`. For rice and olive oil, no update needed (their new fields are 0, which is already the DB default).
   - Update all three `prisma.standardPortion.upsert` create blocks to add `description` (derive from `notes` or write contextual text) and `isDefault: true` for the primary per-food portions. Specific values:
     - Chicken portion (`00000000-0000-0000-0003-000000000001`): `description: '1 chicken breast (150g)'`, `isDefault: true`
     - Rice portion (`00000000-0000-0000-0003-000000000002`): `description: '1 side serving of rice (80g)'`, `isDefault: true`
     - Cereals group portion (`00000000-0000-0000-0003-000000000003`): `description: 'Default side portion for cereals (75g)'`, `isDefault: false`
   - Add a composite food (`foodType: 'composite'`) with ID `00000000-0000-0000-0001-000000000004`: name `'Chicken and rice bowl'`, nameEs `'Bol de pollo con arroz'`, then a recipe record linking to it, then 2 recipe_ingredient records (chicken and rice). Use fixed UUIDs in the `fd000000` range for recipe/ingredient rows. Recipe: `servings: 1`, `prepMinutes: 10`, `cookMinutes: 20`. Ingredients: chicken (amount: 150, unit: `'g'`, gramWeight: 150, sortOrder: 0), rice (amount: 80, unit: `'g'`, gramWeight: 80, sortOrder: 1).
   - Use `prisma.recipe.upsert` and `prisma.recipeIngredient.upsert` following the same upsert pattern as existing seed records.

8. **`packages/api/src/__tests__/migration.integration.test.ts`**
   - `beforeAll` food inserts: no change needed — `foodType` defaults to `'generic'`, `brandName`/`barcode` are nullable.
   - `FoodNutrient` CRUD test: add new nutrient fields to the create payload (or omit them — they have DB defaults of 0). Update the test assertion to confirm `Number(fn.transFats)` is `0`.
   - `StandardPortion` CRUD tests: all existing `prisma.standardPortion.create` calls must add `description: 'Test portion'` (or any valid string). There are 2 such tests + the edge-case tests. Fix all failing tests.
   - `beforeAll` standardPortion cleanup already covers all: `await prisma.standardPortion.deleteMany()` — no change needed.

9. **`packages/api/src/__tests__/migration.edge-cases.test.ts`**
   - All `prisma.standardPortion.create` calls: add `description: 'Test portion'` to each create payload.
   - Raw SQL inserts into `standard_portions` using `$executeRaw` in XOR tests and BUG-02 test: add `, description` column and `'Test portion'` value to all those INSERT statements.

10. **`packages/shared/src/__tests__/schemas.test.ts`**
    - Add test blocks for `FoodTypeSchema` and `NutrientReferenceBasisSchema` (accepts all valid values, rejects invalid string).
    - Update `validFoodBase` fixture to include `foodType: 'generic' as const`.
    - Update `FoodSchema` full-record test to include `foodType`.
    - Update `validNutrients` fixture: add `referenceBasis: 'per_100g' as const`; the new nutrient fields (`transFats`, etc.) default to 0 — add them to the fixture or confirm omitting them passes.
    - Update `validPortionWithFood` fixture: add `description: '1 serving'`, `isDefault: false`.
    - Add `CreateFoodNutrientSchema` tests for new fields: fails when `transFats` is negative, fails when `cholesterol` is negative, accepts 0 for all new nutrient fields.
    - Add `CreateStandardPortionSchema` tests: fails when `description` is empty string, passes when `isDefault` is omitted (defaults to false).
    - Add `RecipeSchema`/`CreateRecipeSchema` test block.
    - Add `RecipeIngredientSchema`/`CreateRecipeIngredientSchema` test block.

---

### Implementation Order

1. **Write failing tests first (TDD).**
   - Update `packages/shared/src/__tests__/schemas.test.ts` with all new and modified test cases. Run `npm test -w @foodxplorer/shared` — expect failures.
   - Update `packages/api/src/__tests__/migration.integration.test.ts` and `migration.edge-cases.test.ts` with `description` added to all StandardPortion fixtures. Run integration tests — expect failures (column does not exist yet).
   - Create `packages/api/src/__tests__/migration.f001b.integration.test.ts` with full F001b test suite. Tests will fail (tables/columns do not exist yet).

2. **Update Zod schemas in `packages/shared`.**
   - `packages/shared/src/schemas/enums.ts` — add `FoodTypeSchema` and `NutrientReferenceBasisSchema`
   - `packages/shared/src/schemas/food.ts` — add new fields
   - `packages/shared/src/schemas/foodNutrient.ts` — add new fields
   - `packages/shared/src/schemas/standardPortion.ts` — add `description` and `isDefault`
   - Create `packages/shared/src/schemas/recipe.ts`
   - Create `packages/shared/src/schemas/recipeIngredient.ts`
   - `packages/shared/src/index.ts` — add new exports
   - Run `npm test -w @foodxplorer/shared` — shared unit tests should now pass.

3. **Update `packages/api/prisma/schema.prisma`.**
   - Add new enums, columns, and models as specified in Files to Modify section.
   - Run `npx prisma validate -w @foodxplorer/api` to confirm schema is valid before generating migration.

4. **Generate and edit the migration SQL.**
   - Run: `npx prisma migrate dev --create-only --name schema_enhancements_f001b -w @foodxplorer/api`
   - Edit the generated migration file to:
     a. Add the two-step `standard_portions.description NOT NULL` column (see Key Patterns section)
     b. Add CHECK constraints (new nutrient columns, recipes, recipe_ingredients)
     c. Add raw SQL partial index for `brand_name WHERE NOT NULL`
     d. Verify that Prisma-generated SQL does NOT include UNIQUE for `recipe_ingredients (recipe_id, ingredient_food_id, sort_order)` as a separate raw SQL UNIQUE (it should be generated from `@@unique` in schema) — if it is missing, add it
     e. Confirm that the barcode and food_type btree indexes are present (generated from `@@index` in schema)

5. **Apply the migration to both dev and test databases.**
   - `npx prisma migrate deploy -w @foodxplorer/api` (applies to dev DB using `DATABASE_URL`)
   - `DATABASE_URL=postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test npx prisma migrate deploy -w @foodxplorer/api` (applies to test DB)
   - Run `npx prisma generate -w @foodxplorer/api` to regenerate Prisma Client with new types.

6. **Update `packages/api/prisma/seed.ts`.**
   - Update StandardPortion upserts to add `description` and `isDefault`.
   - Update chicken FoodNutrient upsert `update` block to include `cholesterol`.
   - Add composite food, recipe, and recipe_ingredient records.
   - Run `npm run db:seed -w @foodxplorer/api` to verify seed succeeds.

7. **Run the full test suite.**
   - `npm test -w @foodxplorer/shared` — all unit tests pass
   - `npm test -w @foodxplorer/api` — all integration tests pass
   - `npm run build` — build succeeds with no TypeScript errors

---

### Testing Strategy

**Test files to create:**
- `packages/api/src/__tests__/migration.f001b.integration.test.ts` — new integration tests for F001b

**Test files to modify:**
- `packages/shared/src/__tests__/schemas.test.ts` — new enum/field test blocks
- `packages/api/src/__tests__/migration.integration.test.ts` — fix StandardPortion/FoodNutrient fixtures
- `packages/api/src/__tests__/migration.edge-cases.test.ts` — fix StandardPortion fixtures (add description)

**`migration.f001b.integration.test.ts` — key scenarios:**

The file must be fully self-contained. Use prefix `fd000000-XXXX-4000-a000-000000000001` for fixture IDs. Follow the same `beforeAll`/`afterAll` isolation pattern used in `migration.edge-cases.test.ts` — each `describe` block gets its own source + food IDs and cleans up after itself.

Teardown order in each `afterAll`: `recipeIngredient.deleteMany` → `recipe.deleteMany` → `standardPortion.deleteMany` → `foodNutrient.deleteMany` → `food.deleteMany` → `dataSource.deleteMany`.

Scenarios to cover:

_Food — new columns:_
- Happy path: inserts a `Food` with `foodType: 'branded'`, `brandName: 'Heinz'`, `barcode: '12345'` and reads them back
- Happy path: `foodType` defaults to `'generic'` when not specified
- Index: verify `foods_barcode_idx` exists via `pg_indexes` query
- Index: verify `foods_food_type_idx` exists via `pg_indexes` query
- Index: verify `foods_brand_name_partial_idx` exists via `pg_indexes` query

_FoodNutrient — new columns:_
- Happy path: inserts with all new nutrient fields (`transFats`, `cholesterol`, `potassium`, `monounsaturatedFats`, `polyunsaturatedFats`) and reads them back
- Happy path: new columns default to 0 when omitted
- Happy path: `referenceBasis` defaults to `'per_100g'` when not specified
- CHECK: fails when `transFats` is negative (use `$executeRaw`)
- CHECK: fails when `cholesterol` is negative
- CHECK: fails when `potassium` is negative
- CHECK: fails when `monounsaturated_fats` is negative
- CHECK: fails when `polyunsaturated_fats` is negative

_StandardPortion — new columns:_
- Happy path: inserts with `description` and `isDefault: true`, reads them back
- NOT NULL: `description` is required — fails with raw SQL insert omitting it
- `isDefault` defaults to `false` when not specified

_Recipe — CRUD and constraints:_
- Happy path: inserts a Recipe linked to a composite food and reads it back (include food relation)
- Happy path: `servings`, `prepMinutes`, `cookMinutes` can all be null
- UNIQUE: fails when inserting a second Recipe with the same `foodId`
- CHECK: fails when `servings` = 0 (use `$executeRaw`)
- CHECK: fails when `servings` is negative
- CHECK: fails when `prepMinutes` is negative
- CHECK: fails when `cookMinutes` is negative
- FK: fails when `food_id` references non-existent food (use `$executeRaw`)
- FK: fails when `source_id` references non-existent data source

_RecipeIngredient — CRUD and constraints:_
- Happy path: inserts 2 RecipeIngredients for a recipe and reads them back ordered by `sortOrder`
- Happy path: `gramWeight` and `notes` can be null
- UNIQUE: fails when inserting duplicate `(recipe_id, ingredient_food_id, sort_order)` (use `$executeRaw`)
- CHECK: fails when `amount` = 0
- CHECK: fails when `amount` is negative
- CHECK: fails when `sortOrder` is negative
- FK: fails when `recipe_id` references non-existent recipe
- FK: fails when `ingredient_food_id` references non-existent food
- Index: verify `recipe_ingredients_recipe_id_idx` exists via `pg_indexes`
- Index: verify `recipe_ingredients_ingredient_food_id_idx` exists via `pg_indexes`

_Data migration correctness (verify existing data was migrated):_
- Query `foods` table: all pre-existing rows have `food_type = 'generic'` (not null)
- Query `food_nutrients` table: all pre-existing rows have `reference_basis = 'per_100g'` (not null)
- Query `standard_portions` table: all pre-existing rows have a non-null, non-empty `description`

**Mocking strategy:**
- Integration tests connect to `foodxplorer_test` via `DATABASE_URL_TEST` env var with hardcoded fallback `postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test` — no mocking.
- Unit tests in `packages/shared` are pure Zod validation — no mocking needed.

---

### Key Patterns

**Migration workflow** (from ADR-002 and F001 practice):
```
npx prisma migrate dev --create-only --name schema_enhancements_f001b -w @foodxplorer/api
# Edit the generated SQL file
npx prisma migrate deploy -w @foodxplorer/api
npx prisma generate -w @foodxplorer/api
```

**Two-step NOT NULL column addition for `standard_portions.description`** (existing rows must get a value before the NOT NULL constraint is enforced):
```sql
-- Step 1: Add column as nullable
ALTER TABLE "standard_portions" ADD COLUMN "description" VARCHAR(255);
-- Step 2: Backfill existing rows
UPDATE "standard_portions" SET "description" = COALESCE(notes, 'Standard portion') WHERE "description" IS NULL;
-- Step 3: Apply NOT NULL constraint
ALTER TABLE "standard_portions" ALTER COLUMN "description" SET NOT NULL;
```

**CHECK constraints in migration SQL** (follow F001 pattern exactly):
```sql
ALTER TABLE "food_nutrients"
  ADD CONSTRAINT "food_nutrients_extended_nutrients_non_negative_check"
    CHECK (trans_fats >= 0 AND cholesterol >= 0 AND potassium >= 0
           AND monounsaturated_fats >= 0 AND polyunsaturated_fats >= 0);
```

**Partial index for brand_name** (must be raw SQL — Prisma `@@index` does not support WHERE clause):
```sql
CREATE INDEX "foods_brand_name_partial_idx" ON "foods" ("brand_name") WHERE "brand_name" IS NOT NULL;
```

**Zod defaults for new nutrient fields in `CreateFoodNutrientSchema`** — wrap the base schema before calling `.omit()`:
```typescript
export const CreateFoodNutrientSchema = FoodNutrientSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  referenceBasis: NutrientReferenceBasisSchema.default('per_100g'),
  transFats: z.number().nonnegative().default(0),
  cholesterol: z.number().nonnegative().default(0),
  potassium: z.number().nonnegative().default(0),
  monounsaturatedFats: z.number().nonnegative().default(0),
  polyunsaturatedFats: z.number().nonnegative().default(0),
});
```

**Seed upsert for recipe** (follow existing upsert pattern with fixed IDs):
```typescript
const compositeFood = await prisma.food.upsert({
  where: { id: '00000000-0000-0000-0001-000000000004' },
  update: {},
  create: { id: '00000000-0000-0000-0001-000000000004', ..., foodType: 'composite' },
});
const recipe = await prisma.recipe.upsert({
  where: { id: '00000000-0000-0000-0004-000000000001' },
  update: {},
  create: { id: '00000000-0000-0000-0004-000000000001', foodId: compositeFood.id, ... },
});
```

**Index verification pattern** (from `migration.edge-cases.test.ts`):
```typescript
type IndexRow = { indexname: string };
const rows = await prisma.$queryRaw<IndexRow[]>`
  SELECT indexname FROM pg_indexes
  WHERE tablename = 'foods' AND indexname = 'foods_barcode_idx'
`;
expect(rows).toHaveLength(1);
```

**Gotchas:**
- `@@index` in Prisma schema generates a btree index with a Prisma-controlled name (`foods_barcode_idx`, `foods_food_type_idx`). The actual name depends on Prisma's naming convention — verify the generated SQL before editing, and use the exact generated name in index verification tests.
- Do NOT add `@@index([brandName])` to Prisma schema — the partial index WHERE clause is not supported by Prisma and you'd get a full index you don't want. Add only the raw SQL partial index.
- The `@@unique([foodId])` on `Recipe` means Prisma will generate `recipes_food_id_key` UNIQUE index — do not also add a raw SQL UNIQUE for this column.
- When Prisma generates the `recipe_ingredients` table DDL from `@@unique([recipeId, ingredientFoodId, sortOrder])`, it will use a constraint name like `recipe_ingredients_recipe_id_ingredient_food_id_sort_order_key` — verify this in the generated SQL and do not duplicate it in raw SQL.
- The `Decimal` Prisma type is returned as a `Prisma.Decimal` object from `prisma.*` client calls. In test assertions, wrap with `Number()`: `expect(Number(fn.transFats)).toBe(0)`.
- Seed `update: {}` blocks for existing food/portion upserts leave existing rows unchanged on re-seed — if you need existing records to get the new `cholesterol` value (chicken), change the `update` block to include it.

---

## Acceptance Criteria

- [ ] `FoodType` enum exists with values `generic`, `branded`, `composite`
- [ ] `NutrientReferenceBasis` enum exists with values `per_100g`, `per_serving`, `per_package`
- [ ] `foods` table has `food_type`, `brand_name`, `barcode` columns
- [ ] `food_nutrients` table has `reference_basis`, `trans_fats`, `cholesterol`, `potassium`, `monounsaturated_fats`, `polyunsaturated_fats` columns
- [ ] `standard_portions` table has `description` and `is_default` columns
- [ ] `recipes` table exists with FK to `foods` and `data_sources`
- [ ] `recipe_ingredients` table exists with FKs to `recipes` and `foods`
- [ ] All CHECK constraints are enforced (test: negative nutrient values fail, etc.)
- [ ] All indexes exist (test: query plan uses index)
- [ ] Existing data migrated correctly (food_type=generic, reference_basis=per_100g, description populated)
- [ ] Seed script updated with new fields and at least 1 recipe with 2+ ingredients
- [ ] Zod schemas updated in shared package for all new fields/tables
- [ ] All existing tests still pass (backward compatible)
- [ ] New tests cover all new constraints, tables, and edge cases
- [ ] All tests pass
- [ ] Build succeeds

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit/integration tests written and passing
- [ ] Code follows project standards
- [ ] No linting errors
- [ ] Build succeeds
- [ ] ADR-003 registered
- [ ] Seed data updated

---

## Workflow Checklist

- [x] Step 0: Spec created (API research + ADR-003)
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed, plan approved
- [x] Step 3: `backend-developer` executed with TDD (153 tests passing)
- [x] Step 4: `production-code-validator` executed, 0 actionable issues (7 findings, all false positives or by-design)
- [x] Step 5: `code-review-specialist` executed (2 important: gram_weight CHECK, test cleanup. Both fixed.)
- [x] Step 5: `qa-engineer` executed (1 bug: BUG-F001b-01 nullable/optional. Fixed. 39 edge-case tests added.)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-11 | Spec created | Based on comparative analysis of 7 nutrition APIs. ADR-003 documented. |
| 2026-03-11 | Branch + ticket | feature/F001b-schema-enhancements-api-alignment |
| 2026-03-11 | Plan approved | Backend planner generated 7-step plan, user approved |
| 2026-03-11 | Implementation | 153 tests (69 unit + 84 integration), all passing |
| 2026-03-11 | Validation | production-code-validator: 0 actionable issues |
| 2026-03-11 | Code review | 2 important: gram_weight CHECK missing, test cleanup. Both fixed. |
| 2026-03-11 | QA | BUG-F001b-01: CreateRecipeSchema nullable/optional. Fixed. 39 edge-case tests added. |
| 2026-03-11 | Final test count | 193 tests (69 shared unit + 124 api), all passing |

---

*Ticket created: 2026-03-11*
