# F002: Prisma Schema Migration — Dishes & Restaurants

**Feature:** F002 | **Type:** Backend-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F002-dishes-restaurants
**Created:** 2026-03-11 | **Dependencies:** F001 + F001b complete

---

## Spec

### Description

Create the Prisma schema and migration for the restaurant/dish layer of foodXPlorer: `restaurants`, `dishes`, `dish_nutrients`, `dish_ingredients`, `cooking_methods`, `dish_categories`, plus two junction tables (`dish_cooking_methods`, `dish_dish_categories`).

These tables model what appears on restaurant menus and their nutritional information. A dish belongs to a restaurant, optionally links to a `food` (when composition is known), and has its own nutritional values tracked per source with confidence levels.

**Key design decisions (from database-architect review):**

1. **`cooking_methods` and `dish_categories` are tables, not enums.** Tables support i18n (`name_es`), flexible ordering (`sort_order`), and new entries via INSERT instead of schema migrations. `DishAvailability` remains an enum (stable state machine, no labels needed).

2. **`dishes.foodId` is a nullable FK with `ON DELETE SET NULL`.** A dish can exist before its food composition is known. The food analysis side and restaurant data side are decoupled.

3. **`dish_nutrients` defaults to `per_serving` reference basis** (not `per_100g` like `food_nutrients`). Restaurant nutritional disclosures are always per-serving.

4. **`restaurants` uses `(chain_slug, country_code)` unique constraint.** McDonald's Spain and McDonald's Portugal are different entities with different menus. Supports international expansion without schema changes.

5. **`estimation_method` on both `dishes` and `dish_nutrients`.** How the dish was identified (scraped/manual) is independent from how nutrients were derived (official/calculated/extrapolated).

6. **Many-to-many relationships** for cooking methods and categories via junction tables with composite PKs. `ON DELETE CASCADE` from dish, `ON DELETE RESTRICT` from lookup side.

7. **Dishes get `embedding` column** (pgvector) for similarity search, same pattern as `foods`.

### API Changes

None — F002 is schema-only. API endpoints come in F004/F025.

### Data Model Changes

**New enum:**
- `DishAvailability`: available, seasonal, discontinued, regional

**New tables:**

1. `cooking_methods` — Lookup table: name, nameEs, slug (unique), description
2. `dish_categories` — Lookup table: name, nameEs, slug (unique), description, sortOrder
3. `restaurants` — Chain restaurants: name, nameEs, chainSlug, website, logoUrl, countryCode (default 'ES'), isActive
4. `dishes` — Menu items: name, nameEs, description, externalId, availability, portionGrams, priceEur, confidenceLevel, estimationMethod, aliases[], embedding. FKs to restaurant, food (nullable), data_source
5. `dish_nutrients` — Nutritional values per dish per source: same 14 nutrient columns as food_nutrients + estimation_method + reference_basis (default per_serving)
6. `dish_ingredients` — Ingredient composition: links dish → food with amount, unit, gramWeight, sortOrder (same pattern as recipe_ingredients)
7. `dish_cooking_methods` — Junction: dish ↔ cooking_method (composite PK)
8. `dish_dish_categories` — Junction: dish ↔ dish_category (composite PK)

**Back-relations added to existing models:**
- `Food.dishes` — Dish[]
- `DataSource.dishes` — Dish[]
- `DataSource.dishNutrients` — DishNutrient[]

**Constraints (raw SQL in migration):**

| Table | Constraint | Expression |
|---|---|---|
| `restaurants` | `restaurants_country_code_check` | `country_code ~ '^[A-Z]{2}$'` |
| `dishes` | `dishes_portion_grams_check` | `portion_grams > 0` |
| `dishes` | `dishes_price_eur_check` | `price_eur >= 0` |
| `dish_nutrients` | `dish_nutrients_calories_check` | `calories >= 0 AND calories <= 9000` |
| `dish_nutrients` | `dish_nutrients_nutrients_non_negative_check` | 9 core nutrients `>= 0` |
| `dish_nutrients` | `dish_nutrients_extended_nutrients_non_negative_check` | 5 extended nutrients `>= 0` |
| `dish_ingredients` | `dish_ingredients_amount_check` | `amount > 0` |
| `dish_ingredients` | `dish_ingredients_sort_order_check` | `sort_order >= 0` |
| `dish_ingredients` | `dish_ingredients_gram_weight_check` | `gram_weight >= 0` |

**Indexes (raw SQL for non-Prisma expressible):**

| Index | Type | Rationale |
|---|---|---|
| `dishes(restaurant_id)` | B-tree | List dishes per restaurant |
| `dishes(food_id) WHERE NOT NULL` | Partial B-tree | Sparse lookup |
| `dishes(availability)` | B-tree | Filter available dishes |
| `dishes(name) GIN tsvector english` | GIN | English FTS |
| `dishes(COALESCE(name_es, name)) GIN tsvector spanish` | GIN | Spanish FTS with fallback |
| `dishes(aliases)` | GIN | Array containment search |
| `restaurants(chain_slug)` | B-tree | Chain lookup |
| `restaurants(is_active)` | B-tree | Active chain filter |
| `restaurants(chain_slug, country_code)` | Unique | One chain per country |
| `dishes(restaurant_id, external_id) WHERE external_id IS NOT NULL` | Partial Unique | Dedup dishes per restaurant |
| `dish_nutrients(dish_id, source_id)` | Unique | One row per dish+source |
| `dish_nutrients(source_id)` | B-tree | Source audit queries |
| `dish_ingredients(dish_id, ingredient_food_id, sort_order)` | Unique | Dedup ingredients |
| `dish_cooking_methods(cooking_method_id)` | B-tree | Reverse lookup |
| `dish_dish_categories(dish_category_id)` | B-tree | Reverse lookup |

### Edge Cases & Error Handling

- **Dish without food link:** Valid — portionGrams/priceEur optional, dish exists for menu listing before composition analysis
- **Dish with null nameEs:** FTS falls back to `COALESCE(name_es, name)` so Spanish search still works
- **Restaurant name collision:** Different countries can have same chain via `(chain_slug, country_code)` unique
- **Calories upper bound 9000:** Higher than food_nutrients (900) because dish serving sizes can be very large (combos, family platters)
- **Deleting a cooking method/category in use:** RESTRICT prevents deletion
- **Deleting a dish:** CASCADE removes junction rows automatically
- **Deleting a food linked to dishes:** SET NULL on dishes (dish survives, loses food link)

---

## Implementation Plan

### Existing Code to Reuse

**Enums (packages/shared/src/schemas/enums.ts)**
- `ConfidenceLevelSchema` — used on `dishes` and `dish_nutrients`
- `EstimationMethodSchema` — used on `dishes` (how the dish was identified) and `dish_nutrients` (how nutrients were derived)
- `NutrientReferenceBasisSchema` — used on `dish_nutrients` (default `per_serving`)

**Prisma schema patterns**
- `Unsupported("vector(1536)")?` on `Food.embedding` — same pattern for `Dish.embedding`
- `@@unique`, `@@index`, `@@map` conventions established in existing models
- `@default(uuid())`, `@default(now())`, `@updatedAt` conventions

**Zod schema patterns**
- `FoodNutrientSchema` / `CreateFoodNutrientSchema` — exact 14-column nutrient pattern to mirror for `DishNutrientSchema`; the `CreateDishNutrientSchema` must also use `.extend()` for `referenceBasis: NutrientReferenceBasisSchema.default('per_serving')` and `.default(0)` on 5 extended nutrients
- `RecipeIngredientSchema` / `CreateRecipeIngredientSchema` — exact pattern to mirror for `DishIngredientSchema`
- `FoodSchema` — embedding column comment pattern: `// embedding column is not represented here — it is a vector(1536) DB column`

**Migration SQL patterns (F001b)**
- `CREATE TABLE "table" ( ... CONSTRAINT "table_pkey" PRIMARY KEY ("id") )` block structure
- `ALTER TABLE "table" ADD CONSTRAINT "name" FOREIGN KEY ... ON DELETE ... ON UPDATE CASCADE`
- `ALTER TABLE "table" ADD CONSTRAINT "name" CHECK (...)`
- `CREATE INDEX "name" ON "table" ("col")`
- `CREATE UNIQUE INDEX "name" ON "table" ("col1", "col2")`
- GIN FTS indexes already in F001 init migration — same tsvector pattern
- Lookup table rows via `INSERT INTO ... VALUES ...` in migration SQL

**Seed patterns (packages/api/prisma/seed.ts)**
- `prisma.$executeRaw` for vector writes: `UPDATE ... SET embedding = ${ZERO_VECTOR}::vector WHERE id = ${id}::uuid`
- `upsert` with deterministic UUIDs in the `00000000-0000-XXXX-YYYY-ZZZZZZZZZZZZ` namespace
- Seed namespace `0006` for restaurants, `0007` for dishes, `0008` for dish_nutrients

**Test patterns (migration.f001b.integration.test.ts)**
- `fd000000-00XX-4000-a000-000000000YYY` fixture UUIDs
- `beforeAll` pre-cleanup then create fixtures; `afterAll` reverse-order cleanup
- `prisma.$queryRaw` to verify indexes exist via `pg_indexes`
- `prisma.$executeRaw` for raw-SQL constraint violation checks

---

### Files to Create

1. **`packages/shared/src/schemas/restaurant.ts`**
   Zod schemas: `RestaurantSchema` and `CreateRestaurantSchema`

2. **`packages/shared/src/schemas/dish.ts`**
   Zod schemas: `DishSchema` and `CreateDishSchema`
   Note: embedding excluded (same comment pattern as `food.ts`)

3. **`packages/shared/src/schemas/dishNutrient.ts`**
   Zod schemas: `DishNutrientSchema` and `CreateDishNutrientSchema`
   Mirrors `foodNutrient.ts` exactly but with `referenceBasis` defaulting to `per_serving`

4. **`packages/shared/src/schemas/dishIngredient.ts`**
   Zod schemas: `DishIngredientSchema` and `CreateDishIngredientSchema`
   Mirrors `recipeIngredient.ts` replacing `recipeId` with `dishId` and `ingredientFoodId` kept

5. **`packages/shared/src/schemas/cookingMethod.ts`**
   Zod schemas: `CookingMethodSchema` and `CreateCookingMethodSchema`

6. **`packages/shared/src/schemas/dishCategory.ts`**
   Zod schemas: `DishCategorySchema` and `CreateDishCategorySchema`

7. **`packages/api/prisma/migrations/20260311130000_dishes_restaurants_f002/migration.sql`**
   The hand-edited SQL migration for all F002 changes (see Step 5 detail below)

8. **`packages/api/src/__tests__/migration.f002.integration.test.ts`**
   Integration tests verifying constraints, indexes, FK behavior, defaults, and junction table operations

---

### Files to Modify

1. **`packages/shared/src/schemas/enums.ts`**
   Add `DishAvailabilitySchema` enum: `z.enum(['available', 'seasonal', 'discontinued', 'regional'])`
   Add exported `DishAvailability` type

2. **`packages/shared/src/index.ts`**
   Add barrel exports for all 6 new schema files and the new enum

3. **`packages/api/prisma/schema.prisma`**
   - Add `DishAvailability` enum (maps to `dish_availability`)
   - Add 8 new models: `CookingMethod`, `DishCategory`, `Restaurant`, `Dish`, `DishNutrient`, `DishIngredient`, `DishCookingMethod`, `DishDishCategory`
   - Add back-relations to `Food`: `dishes Dish[]` and `dishIngredients DishIngredient[]`
   - Add back-relations to `DataSource`: `dishes Dish[]`, `dishNutrients DishNutrient[]`

4. **`packages/api/prisma/seed.ts`**
   Add restaurant, dish, dish_nutrient, cooking_method, dish_category seed sections with junction rows. Cooking methods and dish_categories are seeded here too (in addition to being INSERTed in migration SQL for the dev DB, the seed script must also upsert them to be idempotent on repeated runs).

5. **`packages/shared/src/__tests__/schemas.test.ts`**
   Add test blocks for all 6 new schemas and the new enum, following existing describe/it patterns

---

### Implementation Order

**Step 1 — Zod enum: `packages/shared/src/schemas/enums.ts`**
Add `DishAvailabilitySchema` with values `['available', 'seasonal', 'discontinued', 'regional']` and exported `DishAvailability` type. No dependencies.

**Step 2 — Zod schema: `packages/shared/src/schemas/cookingMethod.ts`**
```
CookingMethodSchema: { id, name, nameEs, slug, description?, createdAt, updatedAt }
CreateCookingMethodSchema: omit id/timestamps; slug: z.string().min(1).max(100); name/nameEs: z.string().min(1).max(255)
```
No FK dependencies — pure lookup table.

**Step 3 — Zod schema: `packages/shared/src/schemas/dishCategory.ts`**
```
DishCategorySchema: { id, name, nameEs, slug, description?, sortOrder, createdAt, updatedAt }
CreateDishCategorySchema: omit id/timestamps; sortOrder: z.number().int().nonnegative().default(0)
```
No FK dependencies — pure lookup table.

**Step 4 — Zod schema: `packages/shared/src/schemas/restaurant.ts`**
```
RestaurantSchema: { id, name, nameEs?, chainSlug, website?, logoUrl?, countryCode, isActive, createdAt, updatedAt }
CreateRestaurantSchema: omit id/timestamps
  countryCode: z.string().length(2).regex(/^[A-Z]{2}$/).default('ES')
  isActive: z.boolean().default(true)
  nameEs: z.string().min(1).max(255).nullable().optional()
```
No FK dependencies.

**Step 5 — Zod schema: `packages/shared/src/schemas/dish.ts`**
```
DishSchema: {
  id, restaurantId, foodId (nullable), sourceId,
  name, nameEs?, description?, externalId?,
  availability (DishAvailabilitySchema),
  portionGrams (nullable), priceEur (nullable),
  confidenceLevel, estimationMethod,
  aliases: z.array(z.string()),
  // embedding excluded — same comment pattern as food.ts
  createdAt, updatedAt
}
CreateDishSchema: omit id/timestamps
  availability: DishAvailabilitySchema.default('available')
  portionGrams: z.number().positive().nullable().optional()
  priceEur: z.number().nonnegative().nullable().optional()
  foodId: z.string().uuid().nullable().optional()
```
Depends on Step 1 (DishAvailabilitySchema).

**Step 6 — Zod schema: `packages/shared/src/schemas/dishNutrient.ts`**
Mirror `foodNutrient.ts` exactly but:
- Replace `foodId` with `dishId: z.string().uuid()`
- Add `estimationMethod: EstimationMethodSchema` field
- Change `calories`: `z.number().nonnegative().max(9000)` (not 900)
- `CreateDishNutrientSchema`: extend with `referenceBasis: NutrientReferenceBasisSchema.default('per_serving')` and `.default(0)` on the 5 extended nutrients

Depends on Steps 1 and 5 for enum imports.

**Step 7 — Zod schema: `packages/shared/src/schemas/dishIngredient.ts`**
Mirror `recipeIngredient.ts` exactly but replace `recipeId` with `dishId: z.string().uuid()`. Keep `ingredientFoodId`, `amount`, `unit`, `gramWeight`, `sortOrder`, `notes`.

**Step 8 — Barrel exports: `packages/shared/src/index.ts`**
Append the following exports (in this order, after existing exports):
```
export * from './schemas/cookingMethod';
export * from './schemas/dishCategory';
export * from './schemas/restaurant';
export * from './schemas/dish';
export * from './schemas/dishNutrient';
export * from './schemas/dishIngredient';
```
The new enum is already exported via `./schemas/enums` which already exists in the barrel.

**Step 9 — Prisma schema: `packages/api/prisma/schema.prisma`**

Add `DishAvailability` enum block:
```prisma
enum DishAvailability {
  available
  seasonal
  discontinued
  regional

  @@map("dish_availability")
}
```

Add back-relations to existing models (no new SQL needed — Prisma-only):
- `Food`: add `dishes Dish[]` and `dishIngredients DishIngredient[]`
- `DataSource`: add `dishes Dish[]` and `dishNutrients DishNutrient[]`

Add 8 new models. Key design notes per model:

`CookingMethod`:
- `id String @id @default(uuid()) @db.Uuid`
- `name String @db.VarChar(255)`, `nameEs String @map("name_es") @db.VarChar(255)`
- `slug String @unique @db.VarChar(100)`
- `description String? @db.Text`
- `createdAt`, `updatedAt` standard pattern
- `dishes DishCookingMethod[]`
- `@@map("cooking_methods")`

`DishCategory`:
- Same as CookingMethod plus `sortOrder Int @default(0) @map("sort_order")`
- `dishes DishDishCategory[]`
- `@@map("dish_categories")`

`Restaurant`:
- `id`, `name @db.VarChar(255)`, `nameEs? @db.VarChar(255) @map("name_es")`, `chainSlug @db.VarChar(100) @map("chain_slug")`, `website? @db.Text`, `logoUrl? @db.Text @map("logo_url")`, `countryCode @db.VarChar(2) @default("ES") @map("country_code")`, `isActive Boolean @default(true) @map("is_active")`, `createdAt`, `updatedAt`
- `dishes Dish[]`
- `@@unique([chainSlug, countryCode])` — Prisma generates this unique index; the raw SQL migration must also add the named index `restaurants_chain_slug_country_code_key` matching Prisma conventions, and separate B-tree indexes for `chain_slug` and `is_active`
- `@@map("restaurants")`

`Dish`:
- `id`, `restaurantId @db.Uuid @map("restaurant_id")`, `foodId? @db.Uuid @map("food_id")` (nullable FK)
- `sourceId @db.Uuid @map("source_id")`
- `name @db.VarChar(255)`, `nameEs? @db.VarChar(255) @map("name_es")`, `description? @db.Text`, `externalId? @db.VarChar(100) @map("external_id")`
- `availability DishAvailability @default(available)`, `portionGrams Decimal? @map("portion_grams") @db.Decimal(8,2)`, `priceEur Decimal? @map("price_eur") @db.Decimal(8,2)`
- `confidenceLevel ConfidenceLevel @map("confidence_level")`, `estimationMethod EstimationMethod @map("estimation_method")`
- `aliases String[]`
- `/// @db.Unsupported — pgvector column; use prisma.$queryRaw / $executeRaw for reads/writes`
- `embedding Unsupported("vector(1536)")?`
- `createdAt`, `updatedAt`
- Relations: `restaurant Restaurant`, `food Food?` (with `onDelete: SetNull`), `source DataSource`
- `nutrients DishNutrient[]`, `ingredients DishIngredient[]`, `cookingMethods DishCookingMethod[]`, `categories DishDishCategory[]`
- `@@index([restaurantId])`, `@@index([availability])`
- Comment: `// Partial indexes (food_id WHERE NOT NULL, FTS, aliases GIN) defined in raw SQL migration only`
- `@@map("dishes")`

`DishNutrient`:
- Mirrors `FoodNutrient` exactly but: `dishId @db.Uuid @map("dish_id")` instead of `foodId`; adds `estimationMethod EstimationMethod @map("estimation_method")`; `referenceBasis` default is `per_serving`; `calories` range enforced only in raw SQL (Prisma has no max check) — add comment
- `@@unique([dishId, sourceId])`, `@@index([sourceId])`
- `@@map("dish_nutrients")`

`DishIngredient`:
- Mirrors `RecipeIngredient` replacing `recipeId` → `dishId`
- `dish Dish @relation(...)`, `ingredientFood Food @relation(...)`
- `onDelete: Restrict` on both FKs (same as RecipeIngredient)
- `@@unique([dishId, ingredientFoodId, sortOrder])`, `@@index([dishId])`, `@@index([ingredientFoodId])`
- `@@map("dish_ingredients")`

`DishCookingMethod` (junction, composite PK):
```prisma
model DishCookingMethod {
  dishId          String   @map("dish_id") @db.Uuid
  cookingMethodId String   @map("cooking_method_id") @db.Uuid

  dish          Dish          @relation(fields: [dishId], references: [id], onDelete: Cascade)
  cookingMethod CookingMethod @relation(fields: [cookingMethodId], references: [id], onDelete: Restrict)

  @@id([dishId, cookingMethodId])
  @@index([cookingMethodId])
  @@map("dish_cooking_methods")
}
```

`DishDishCategory` (junction, composite PK):
```prisma
model DishDishCategory {
  dishId         String @map("dish_id") @db.Uuid
  dishCategoryId String @map("dish_category_id") @db.Uuid

  dish         Dish         @relation(fields: [dishId], references: [id], onDelete: Cascade)
  dishCategory DishCategory @relation(fields: [dishCategoryId], references: [id], onDelete: Restrict)

  @@id([dishId, dishCategoryId])
  @@index([dishCategoryId])
  @@map("dish_dish_categories")
}
```

**Step 10 — Migration SQL file: `packages/api/prisma/migrations/20260311130000_dishes_restaurants_f002/migration.sql`**

Create directory and file manually. Do NOT run `prisma migrate dev` (shadow DB fails with pgvector). Workflow:
1. Run `npx prisma migrate dev --create-only --name dishes_restaurants_f002 -w @foodxplorer/api` to generate the skeleton
2. Replace the generated SQL entirely with hand-crafted SQL following F001b patterns

The migration SQL must contain these sections in order:

**Section 1 — New enum:**
```sql
CREATE TYPE "dish_availability" AS ENUM ('available', 'seasonal', 'discontinued', 'regional');
```

**Section 2 — Lookup table: cooking_methods**
```sql
CREATE TABLE "cooking_methods" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "name_es" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cooking_methods_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cooking_methods_slug_key" ON "cooking_methods"("slug");
```

**Section 3 — Lookup table: dish_categories**
```sql
CREATE TABLE "dish_categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "name_es" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dish_categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dish_categories_slug_key" ON "dish_categories"("slug");
```

**Section 4 — Seed rows for cooking_methods and dish_categories** (deterministic UUIDs):
Insert at minimum these cooking methods (using deterministic UUIDs in `00000000-0000-4000-c000-XXXXXXXXXXXX` namespace):
- grilled, baked, fried, steamed, raw, boiled, roasted, stewed

Insert at minimum these dish categories:
- starters, main-courses, side-dishes, desserts, beverages, snacks, salads, soups

These INSERTs go in the migration so they are applied on first `prisma migrate deploy` on any environment. The seed script must also upsert them for idempotency.

**Section 5 — Table: restaurants**
```sql
CREATE TABLE "restaurants" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "name_es" VARCHAR(255),
    "chain_slug" VARCHAR(100) NOT NULL,
    "website" TEXT,
    "logo_url" TEXT,
    "country_code" VARCHAR(2) NOT NULL DEFAULT 'ES',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "restaurants_chain_slug_country_code_key" ON "restaurants"("chain_slug", "country_code");
CREATE INDEX "restaurants_chain_slug_idx" ON "restaurants"("chain_slug");
CREATE INDEX "restaurants_is_active_idx" ON "restaurants"("is_active");
ALTER TABLE "restaurants"
  ADD CONSTRAINT "restaurants_country_code_check" CHECK (country_code ~ '^[A-Z]{2}$');
```

**Section 6 — Table: dishes**
```sql
CREATE TABLE "dishes" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "food_id" UUID,
    "source_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "name_es" VARCHAR(255),
    "description" TEXT,
    "external_id" VARCHAR(100),
    "availability" "dish_availability" NOT NULL DEFAULT 'available',
    "portion_grams" DECIMAL(8,2),
    "price_eur" DECIMAL(8,2),
    "confidence_level" "confidence_level" NOT NULL,
    "estimation_method" "estimation_method" NOT NULL,
    "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dishes_pkey" PRIMARY KEY ("id")
);
```
FKs:
```sql
ALTER TABLE "dishes" ADD CONSTRAINT "dishes_restaurant_id_fkey"
  FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dishes" ADD CONSTRAINT "dishes_food_id_fkey"
  FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dishes" ADD CONSTRAINT "dishes_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```
CHECK constraints:
```sql
ALTER TABLE "dishes"
  ADD CONSTRAINT "dishes_portion_grams_check" CHECK (portion_grams > 0),
  ADD CONSTRAINT "dishes_price_eur_check" CHECK (price_eur >= 0);
```
Indexes:
```sql
CREATE INDEX "dishes_restaurant_id_idx" ON "dishes"("restaurant_id");
CREATE INDEX "dishes_availability_idx" ON "dishes"("availability");
CREATE INDEX "dishes_food_id_partial_idx" ON "dishes"("food_id") WHERE "food_id" IS NOT NULL;
CREATE UNIQUE INDEX "dishes_restaurant_id_external_id_partial_key"
  ON "dishes"("restaurant_id", "external_id") WHERE "external_id" IS NOT NULL;
CREATE INDEX "dishes_name_fts_en_idx"
  ON "dishes" USING GIN (to_tsvector('english', "name"));
CREATE INDEX "dishes_name_fts_es_idx"
  ON "dishes" USING GIN (to_tsvector('spanish', COALESCE("name_es", "name")));
CREATE INDEX "dishes_aliases_gin_idx" ON "dishes" USING GIN ("aliases");
```

**Section 7 — Table: dish_nutrients**
```sql
CREATE TABLE "dish_nutrients" (
    "id" UUID NOT NULL,
    "dish_id" UUID NOT NULL,
    "calories" DECIMAL(8,2) NOT NULL,
    "proteins" DECIMAL(8,2) NOT NULL,
    "carbohydrates" DECIMAL(8,2) NOT NULL,
    "sugars" DECIMAL(8,2) NOT NULL,
    "fats" DECIMAL(8,2) NOT NULL,
    "saturated_fats" DECIMAL(8,2) NOT NULL,
    "fiber" DECIMAL(8,2) NOT NULL,
    "salt" DECIMAL(8,2) NOT NULL,
    "sodium" DECIMAL(8,2) NOT NULL,
    "extra" JSONB,
    "reference_basis" "nutrient_reference_basis" NOT NULL DEFAULT 'per_serving',
    "trans_fats" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "cholesterol" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "potassium" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "monounsaturated_fats" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "polyunsaturated_fats" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "estimation_method" "estimation_method" NOT NULL,
    "source_id" UUID NOT NULL,
    "confidence_level" "confidence_level" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dish_nutrients_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dish_nutrients_dish_id_source_id_key" ON "dish_nutrients"("dish_id", "source_id");
CREATE INDEX "dish_nutrients_source_id_idx" ON "dish_nutrients"("source_id");
```
FKs and CHECK constraints:
```sql
ALTER TABLE "dish_nutrients" ADD CONSTRAINT "dish_nutrients_dish_id_fkey"
  FOREIGN KEY ("dish_id") REFERENCES "dishes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dish_nutrients" ADD CONSTRAINT "dish_nutrients_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dish_nutrients"
  ADD CONSTRAINT "dish_nutrients_calories_check" CHECK (calories >= 0 AND calories <= 9000),
  ADD CONSTRAINT "dish_nutrients_nutrients_non_negative_check"
    CHECK (proteins >= 0 AND carbohydrates >= 0 AND sugars >= 0 AND fats >= 0
           AND saturated_fats >= 0 AND fiber >= 0 AND salt >= 0 AND sodium >= 0 AND extra IS NOT NULL OR extra IS NULL),
  ADD CONSTRAINT "dish_nutrients_extended_nutrients_non_negative_check"
    CHECK (trans_fats >= 0 AND cholesterol >= 0 AND potassium >= 0
           AND monounsaturated_fats >= 0 AND polyunsaturated_fats >= 0);
```
Note on `dish_nutrients_nutrients_non_negative_check`: check the 9 core nutrient columns non-negative — match the pattern from `food_nutrients` constraints in F001 init migration.

**Section 8 — Table: dish_ingredients**
```sql
CREATE TABLE "dish_ingredients" (
    "id" UUID NOT NULL,
    "dish_id" UUID NOT NULL,
    "ingredient_food_id" UUID NOT NULL,
    "amount" DECIMAL(8,2) NOT NULL,
    "unit" VARCHAR(50) NOT NULL,
    "gram_weight" DECIMAL(8,2),
    "sort_order" INTEGER NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dish_ingredients_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dish_ingredients_dish_id_ingredient_food_id_sort_order_key"
  ON "dish_ingredients"("dish_id", "ingredient_food_id", "sort_order");
CREATE INDEX "dish_ingredients_dish_id_idx" ON "dish_ingredients"("dish_id");
CREATE INDEX "dish_ingredients_ingredient_food_id_idx" ON "dish_ingredients"("ingredient_food_id");
```
FKs and CHECK constraints:
```sql
ALTER TABLE "dish_ingredients" ADD CONSTRAINT "dish_ingredients_dish_id_fkey"
  FOREIGN KEY ("dish_id") REFERENCES "dishes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dish_ingredients" ADD CONSTRAINT "dish_ingredients_ingredient_food_id_fkey"
  FOREIGN KEY ("ingredient_food_id") REFERENCES "foods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dish_ingredients"
  ADD CONSTRAINT "dish_ingredients_amount_check" CHECK (amount > 0),
  ADD CONSTRAINT "dish_ingredients_sort_order_check" CHECK (sort_order >= 0),
  ADD CONSTRAINT "dish_ingredients_gram_weight_check" CHECK (gram_weight >= 0);
```

**Section 9 — Junction tables**
```sql
CREATE TABLE "dish_cooking_methods" (
    "dish_id" UUID NOT NULL,
    "cooking_method_id" UUID NOT NULL,
    CONSTRAINT "dish_cooking_methods_pkey" PRIMARY KEY ("dish_id", "cooking_method_id")
);
CREATE INDEX "dish_cooking_methods_cooking_method_id_idx" ON "dish_cooking_methods"("cooking_method_id");
ALTER TABLE "dish_cooking_methods" ADD CONSTRAINT "dish_cooking_methods_dish_id_fkey"
  FOREIGN KEY ("dish_id") REFERENCES "dishes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dish_cooking_methods" ADD CONSTRAINT "dish_cooking_methods_cooking_method_id_fkey"
  FOREIGN KEY ("cooking_method_id") REFERENCES "cooking_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "dish_dish_categories" (
    "dish_id" UUID NOT NULL,
    "dish_category_id" UUID NOT NULL,
    CONSTRAINT "dish_dish_categories_pkey" PRIMARY KEY ("dish_id", "dish_category_id")
);
CREATE INDEX "dish_dish_categories_dish_category_id_idx" ON "dish_dish_categories"("dish_category_id");
ALTER TABLE "dish_dish_categories" ADD CONSTRAINT "dish_dish_categories_dish_id_fkey"
  FOREIGN KEY ("dish_id") REFERENCES "dishes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dish_dish_categories" ADD CONSTRAINT "dish_dish_categories_dish_category_id_fkey"
  FOREIGN KEY ("dish_category_id") REFERENCES "dish_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

**Step 11 — Apply migration:**
```
npx prisma migrate deploy -w @foodxplorer/api
npx prisma generate -w @foodxplorer/api
```
Do NOT use `prisma migrate dev` — pgvector shadow DB incompatibility.

**Step 12 — Seed script: `packages/api/prisma/seed.ts`**

Add the following sections after the existing recipe/recipeIngredient section. All use `upsert` with deterministic UUIDs.

Namespace allocation:
- `00000000-0000-4000-c000-XXXXXXXXXXXX` — cooking_methods (c = cooking)
- `00000000-0000-4000-d000-XXXXXXXXXXXX` — dish_categories (d = category)
- `00000000-0000-0000-0006-XXXXXXXXXXXX` — restaurants
- `00000000-0000-0000-0007-XXXXXXXXXXXX` — dishes
- `00000000-0000-0000-0008-XXXXXXXXXXXX` — dish_nutrients

**Cooking methods upsert** (8 rows, use `cooking_methods` Prisma model, slug as `@@unique` key for where clause):
grilled, baked, fried, steamed, raw, boiled, roasted, stewed

**Dish categories upsert** (8 rows):
starters, main-courses, side-dishes, desserts, beverages, snacks, salads, soups

**Restaurant upsert** (2 sample restaurants):
- McDonald's Spain: `chainSlug: 'mcdonalds', countryCode: 'ES'`
- McDonald's Portugal: `chainSlug: 'mcdonalds', countryCode: 'PT'`

**Dish upsert** (2 sample dishes linked to McDonald's Spain, use `restaurantId` and existing `dataSource.id`):
- Big Mac: `name: 'Big Mac'`, link to `foodChickenRiceBowl` food (or create a dedicated food — prefer a new food `00000000-0000-0000-0001-000000000005` named 'Big Mac')
- McChicken: `name: 'McChicken'`, nullable foodId (demonstrate dish-without-food-link)

For each dish: set embedding via `prisma.$executeRaw` (same ZERO_VECTOR pattern as foods).

**DishNutrient upsert** (1 per dish per source):
- Big Mac: calories 563, proteins 26, carbohydrates 44, sugars 9, fats 30, saturatedFats 11, fiber 3, salt 1.7, sodium 0.68, referenceBasis `per_serving`, estimationMethod `scraped`, confidenceLevel `medium`
- McChicken: calories 400, reasonable macro estimates, estimationMethod `scraped`

**Junction rows** using `prisma.$executeRaw` (Prisma junction models with composite PKs work via `create`/`upsert` but the Prisma-generated client may not expose them as first-class models — use `prisma.dishCookingMethod.upsert` or raw SQL if Prisma client doesn't expose the junction model. Prefer Prisma client: `prisma.dishCookingMethod.upsert({ where: { dishId_cookingMethodId: {...} }, ... })`):
- Link Big Mac dish to cooking method `grilled`
- Link Big Mac dish to category `main-courses`
- Link McChicken dish to cooking method `fried`
- Link McChicken dish to category `main-courses`

**Step 13 — Unit tests: `packages/shared/src/__tests__/schemas.test.ts`**

Add describe blocks for each new schema after the existing RecipeIngredient block. Each block follows the same structure as existing tests. Key cases to cover:

`DishAvailabilitySchema`:
- Accepts all 4 values: `available`, `seasonal`, `discontinued`, `regional`
- Rejects invalid string

`CreateCookingMethodSchema`:
- Passes with valid name/nameEs/slug
- Fails when slug is empty string
- Fails when name is missing

`CreateDishCategorySchema`:
- Passes with valid fields; sortOrder defaults to 0 when omitted
- Fails when slug is empty

`CreateRestaurantSchema`:
- Passes with valid fields; countryCode defaults to 'ES'; isActive defaults to true
- Fails when countryCode is not 2 uppercase letters (e.g., 'es', 'ESP', '12')
- nameEs is optional/nullable

`CreateDishSchema`:
- Passes with valid fields including nullable foodId
- availability defaults to 'available' when omitted
- portionGrams fails when 0 or negative; passes when null
- priceEur fails when negative; passes when 0 and when null
- aliases is array of strings; fails when not array

`CreateDishNutrientSchema`:
- Passes with valid values; referenceBasis defaults to 'per_serving'
- calories fails when > 9000 (not 900 — different from FoodNutrient)
- calories fails when negative
- Extended nutrients default to 0 when omitted
- All extended nutrients fail when negative
- estimationMethod is required (no default)

`CreateDishIngredientSchema`:
- Mirrors RecipeIngredient tests but uses `dishId` instead of `recipeId`
- amount fails at 0 and negative; passes positive
- sortOrder fails when negative
- gramWeight nullable; fails when negative

**Step 14 — Integration tests: `packages/api/src/__tests__/migration.f002.integration.test.ts`**

Use `fd000000-00XX-4000-a000-000000000YYY` fixture UUID pattern. Allocate ranges:
- Group `0006`: Restaurant tests (SRC=...0001, RESTAURANT=...0002)
- Group `0007`: Dish tests (SRC=...0001, RESTAURANT=...0002, DISH=...0003, FOOD=...0004)
- Group `0008`: DishNutrient tests (SRC=...0001, RESTAURANT=...0002, DISH=...0003)
- Group `0009`: DishIngredient tests (SRC=...0001, RESTAURANT=...0002, DISH=...0003, FOOD_ING=...0004)
- Group `0010`: Junction tests (SRC=...0001, RESTAURANT=...0002, DISH=...0003)
- Group `0011`: Index existence tests (no fixtures needed)
- Group `0012`: FK ON DELETE behavior tests

Each `describe` block follows the `beforeAll` pre-cleanup + `afterAll` reverse-order cleanup pattern.

Teardown order for full cleanup: `dishDishCategory` → `dishCookingMethod` → `dishIngredient` → `dishNutrient` → `dish` → `restaurant` → `food` → `dataSource`

**Describe blocks to write:**

`Restaurant — CRUD and constraints`:
- Inserts restaurant and reads it back
- `(chainSlug, countryCode)` UNIQUE — second insert with same pair fails
- Different countryCode same chainSlug succeeds (McDonald's ES vs PT)
- CHECK fails when `country_code` is lowercase (`'es'`)
- CHECK fails when `country_code` is 3 chars (`'ESP'`)
- CHECK fails when `country_code` is digits (`'12'`)
- countryCode defaults to `'ES'` (raw SQL insert without it)

`Dish — CRUD and constraints`:
- Inserts dish with nullable foodId and reads back; embedding column can be set via raw SQL
- availability defaults to `'available'`
- CHECK fails when portionGrams = 0
- CHECK fails when portionGrams is negative
- CHECK fails when priceEur is negative
- UNIQUE fails on `(restaurant_id, external_id)` when both not null
- Partial unique: two dishes with same restaurant but both null external_id are allowed
- aliases stores and retrieves array correctly

`DishNutrient — CRUD and constraints`:
- Inserts with all fields and reads back; referenceBasis defaults to `'per_serving'`
- UNIQUE fails on `(dish_id, source_id)` duplicate
- CHECK fails when calories > 9000
- CHECK fails when calories is negative
- CHECK fails for each of 9 core nutrients when negative (proteins, carbohydrates, sugars, fats, saturated_fats, fiber, salt, sodium — pick representative subset matching F001b style)
- CHECK fails for each of 5 extended nutrients when negative

`DishIngredient — CRUD and constraints`:
- Inserts 2 ingredients and reads them back ordered by sortOrder
- gramWeight and notes can be null
- UNIQUE fails on `(dish_id, ingredient_food_id, sort_order)` duplicate
- CHECK fails when amount = 0 and when negative
- CHECK fails when sortOrder is negative
- CHECK fails when gramWeight is negative

`Junction tables — dish_cooking_methods and dish_dish_categories`:
- Links dish to cooking method; verifies row exists
- Links dish to category; verifies row exists
- DELETE on dish cascades to junction rows (dish deleted → junction row gone)
- DELETE on cooking_method with dish linked RESTRICTS (must fail)
- DELETE on dish_category with dish linked RESTRICTS (must fail)

`Index existence`:
- Each of the 15+ raw SQL indexes verified via `pg_indexes` query: `dishes_restaurant_id_idx`, `dishes_availability_idx`, `dishes_food_id_partial_idx`, `dishes_restaurant_id_external_id_partial_key`, `dishes_name_fts_en_idx`, `dishes_name_fts_es_idx`, `dishes_aliases_gin_idx`, `restaurants_chain_slug_idx`, `restaurants_is_active_idx`, `restaurants_chain_slug_country_code_key`, `dish_nutrients_dish_id_source_id_key`, `dish_nutrients_source_id_idx`, `dish_ingredients_dish_id_ingredient_food_id_sort_order_key`, `dish_cooking_methods_cooking_method_id_idx`, `dish_dish_categories_dish_category_id_idx`

`FK ON DELETE behavior`:
- Deleting a food linked to a dish: dish survives with `food_id = NULL` (SET NULL behavior)
- Deleting a dish: dish_cooking_method junction row cascades (gone after dish deleted)

---

### Testing Strategy

**Unit tests** (`packages/shared/src/__tests__/schemas.test.ts`):
- Pure Zod validation — no DB, no Prisma
- Run with: `npm test -w @foodxplorer/shared`
- Cover all validation rules described above: defaults, min/max, nullable vs optional, enum rejection

**Integration tests** (`packages/api/src/__tests__/migration.f002.integration.test.ts`):
- Connects to `foodxplorer_test` database via `DATABASE_URL_TEST`
- Run with: `npm test -w @foodxplorer/api`
- Mocking strategy: nothing is mocked — tests hit real PostgreSQL to verify constraints, indexes, and FK behavior

---

### Key Patterns

**Two-step NOT NULL not needed here.** All new tables in this migration start empty — no backfill step required. Only add-column-to-existing-table patterns (like F001b's `standard_portions.description`) need the two-step.

**Prisma `@@unique` generates the unique index.** But because we hand-write the SQL, we must also write the `CREATE UNIQUE INDEX` ourselves. Use Prisma's naming convention: `tablename_col1_col2_key`.

**pgvector embedding on dishes.** Use the exact same Prisma `Unsupported("vector(1536)")?` declaration as on `Food`. The column is NOT included in `DishSchema` (same policy as `FoodSchema`). Set via `$executeRaw` in seed and tests.

**Junction models with composite PK.** In Prisma, `@@id([dishId, cookingMethodId])` generates a composite PK. The Prisma client exposes these models as `prisma.dishCookingMethod` and `prisma.dishDishCategory`. Upsert by `where: { dishId_cookingMethodId: { dishId, cookingMethodId } }`.

**Lookup tables seeded in migration.** Cooking methods and dish categories are inserted via SQL `INSERT INTO ... VALUES (...)` blocks in the migration file (Section 4). This ensures they exist in every environment after `prisma migrate deploy`. The seed script also upserts them for idempotency when seed is re-run.

**Migration filename.** Use timestamp `20260311130000` (one minute after F001b's `20260311120000`) so Prisma applies them in order.

**Calories upper bound difference.** `dish_nutrients` uses `max(9000)` in Zod and `CHECK (calories >= 0 AND calories <= 9000)` in SQL — not 900. This is intentional (combo meals, family platters). Do not copy the 900 cap from `FoodNutrientSchema`.

**`aliases` column default.** In the Prisma schema, Prisma array columns do not support `@default([])` syntax directly. Use `@default(dbgenerated("ARRAY[]::text[]"))` or omit the default in Prisma and specify `NOT NULL DEFAULT ARRAY[]::TEXT[]` only in the SQL. In the Zod Create schema, aliases should have `.default([])` so callers can omit it.

**Back-relations on Food.** The `Food` model gains two new back-relation fields: `dishes Dish[]` (via `dishes.food_id`) and `dishIngredients DishIngredient[]` (via `dish_ingredients.ingredient_food_id`). These are Prisma-only — no SQL change. Prisma requires naming the relation when there are multiple FK paths between two models (Food → Dish via food_id, Food → DishIngredient via ingredient_food_id are separate relations so no naming conflict).

**`dish_nutrients_nutrients_non_negative_check`** should cover the 9 required core nutrient columns: `proteins >= 0 AND carbohydrates >= 0 AND sugars >= 0 AND fats >= 0 AND saturated_fats >= 0 AND fiber >= 0 AND salt >= 0 AND sodium >= 0`. The `calories` upper bound is a separate named constraint.

**F001 init migration must NOT be modified.** If reviewing constraint names from the init migration, do so via `packages/api/prisma/migrations/20260310174347_init_core_tables/migration.sql`.

---

## Acceptance Criteria

- [x] Prisma schema defines 1 new enum, 8 new models with correct types and relations
- [x] Migration runs successfully against PostgreSQL 16 + pgvector
- [x] All CHECK constraints enforced (negative nutrients, portion_grams, price_eur, country_code format)
- [x] UNIQUE constraints prevent duplicates (dish_id+source_id on dish_nutrients, chain_slug+country_code on restaurants, slug on cooking_methods/dish_categories)
- [x] FK ON DELETE behavior correct (RESTRICT on ingredients/nutrients, SET NULL on dish→food, CASCADE on junctions)
- [x] FTS indexes work on dishes (English + Spanish with COALESCE fallback)
- [x] GIN index on dishes.aliases works
- [x] `embedding` column exists as `vector(1536)` on dishes
- [x] Junction tables work (many-to-many: dish ↔ cooking_methods, dish ↔ dish_categories)
- [x] Seed script inserts sample restaurants, dishes, nutrients, cooking methods, categories with junction rows
- [x] Zod schemas created for all new models with proper validation
- [x] All tests pass: 388 total (121 unit + 267 integration)
- [x] Build succeeds

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit/integration tests written and passing
- [x] Code follows project standards
- [x] No linting errors
- [x] Build succeeds
- [x] ADR-004 registered for key design decisions

---

## Workflow Checklist

- [x] Step 0: Spec created (database-architect review + spec drafted)
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: `backend-planner` executed, plan approved
- [x] Step 3: `backend-developer` executed with TDD (300 tests)
- [x] Step 4: `production-code-validator` executed, quality gates pass (0 issues)
- [x] Step 5: `code-review-specialist` executed (0 critical, 2 important fixed, 1 suggestion fixed)
- [x] Step 5: `qa-engineer` executed (0 bugs, 86 edge-case tests added, QA Verified)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-11 | Spec created | Database-architect designed schema: 1 enum, 8 models, M:N junctions, tables over enums for cooking_methods/dish_categories |
| 2026-03-11 | Branch created | feature/F002-dishes-restaurants from develop |
| 2026-03-11 | Plan approved | 14-step implementation plan by backend-planner, approved by user |
| 2026-03-11 | Implementation complete | 300 tests (121 unit + 179 integration), all passing. Lint clean, build succeeds. |
| 2026-03-11 | Validation complete | production-code-validator: 0 issues, production ready |
| 2026-03-11 | Code review | 0 critical. 2 important fixed: $disconnect, foodChickenRiceBowl embedding. 1 suggestion fixed: 2 missing index checks |
| 2026-03-11 | QA | 0 bugs found. 86 edge-case tests added. QA Verified. |
| 2026-03-11 | Final test count | 388 tests (121 shared unit + 57 F002 integration + 86 F002 edge-cases + 124 pre-existing api), all passing |

---

*Ticket created: 2026-03-11*
