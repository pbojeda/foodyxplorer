-- F002: Prisma Schema Migration — Dishes & Restaurants
-- Adds: cooking_methods, dish_categories, restaurants, dishes, dish_nutrients,
--       dish_ingredients, dish_cooking_methods, dish_dish_categories
-- DO NOT MODIFY F001 or F001b migration files.

-- ---------------------------------------------------------------------------
-- Section 1 — New enum: dish_availability
-- ---------------------------------------------------------------------------

CREATE TYPE "dish_availability" AS ENUM ('available', 'seasonal', 'discontinued', 'regional');

-- ---------------------------------------------------------------------------
-- Section 2 — Lookup table: cooking_methods
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Section 3 — Lookup table: dish_categories
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Section 4 — Seed rows for cooking_methods and dish_categories
-- Deterministic UUIDs in 00000000-0000-4000-c000-XXXXXXXXXXXX namespace (cooking)
-- and 00000000-0000-4000-d000-XXXXXXXXXXXX namespace (dish categories)
-- ---------------------------------------------------------------------------

INSERT INTO "cooking_methods" ("id", "name", "name_es", "slug", "updated_at") VALUES
    ('00000000-0000-4000-c000-000000000001', 'Grilled',  'A la parrilla',   'grilled',  NOW()),
    ('00000000-0000-4000-c000-000000000002', 'Baked',    'Al horno',        'baked',    NOW()),
    ('00000000-0000-4000-c000-000000000003', 'Fried',    'Frito',           'fried',    NOW()),
    ('00000000-0000-4000-c000-000000000004', 'Steamed',  'Al vapor',        'steamed',  NOW()),
    ('00000000-0000-4000-c000-000000000005', 'Raw',      'Crudo',           'raw',      NOW()),
    ('00000000-0000-4000-c000-000000000006', 'Boiled',   'Hervido',         'boiled',   NOW()),
    ('00000000-0000-4000-c000-000000000007', 'Roasted',  'Asado',           'roasted',  NOW()),
    ('00000000-0000-4000-c000-000000000008', 'Stewed',   'Estofado',        'stewed',   NOW());

INSERT INTO "dish_categories" ("id", "name", "name_es", "slug", "sort_order", "updated_at") VALUES
    ('00000000-0000-4000-d000-000000000001', 'Starters',      'Entrantes',          'starters',      0, NOW()),
    ('00000000-0000-4000-d000-000000000002', 'Main Courses',  'Platos principales', 'main-courses',  1, NOW()),
    ('00000000-0000-4000-d000-000000000003', 'Side Dishes',   'Guarniciones',       'side-dishes',   2, NOW()),
    ('00000000-0000-4000-d000-000000000004', 'Desserts',      'Postres',            'desserts',      3, NOW()),
    ('00000000-0000-4000-d000-000000000005', 'Beverages',     'Bebidas',            'beverages',     4, NOW()),
    ('00000000-0000-4000-d000-000000000006', 'Snacks',        'Tentempiés',         'snacks',        5, NOW()),
    ('00000000-0000-4000-d000-000000000007', 'Salads',        'Ensaladas',          'salads',        6, NOW()),
    ('00000000-0000-4000-d000-000000000008', 'Soups',         'Sopas',              'soups',         7, NOW());

-- ---------------------------------------------------------------------------
-- Section 5 — Table: restaurants
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Section 6 — Table: dishes
-- ---------------------------------------------------------------------------

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
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dishes_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "dishes" ADD CONSTRAINT "dishes_restaurant_id_fkey"
  FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dishes" ADD CONSTRAINT "dishes_food_id_fkey"
  FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "dishes" ADD CONSTRAINT "dishes_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dishes"
  ADD CONSTRAINT "dishes_portion_grams_check" CHECK (portion_grams > 0),
  ADD CONSTRAINT "dishes_price_eur_check" CHECK (price_eur >= 0);

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

-- ---------------------------------------------------------------------------
-- Section 7 — Table: dish_nutrients
-- ---------------------------------------------------------------------------

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

ALTER TABLE "dish_nutrients" ADD CONSTRAINT "dish_nutrients_dish_id_fkey"
  FOREIGN KEY ("dish_id") REFERENCES "dishes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dish_nutrients" ADD CONSTRAINT "dish_nutrients_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dish_nutrients"
  ADD CONSTRAINT "dish_nutrients_calories_check"
    CHECK (calories >= 0 AND calories <= 9000),
  ADD CONSTRAINT "dish_nutrients_nutrients_non_negative_check"
    CHECK (proteins >= 0 AND carbohydrates >= 0 AND sugars >= 0 AND fats >= 0
           AND saturated_fats >= 0 AND fiber >= 0 AND salt >= 0 AND sodium >= 0),
  ADD CONSTRAINT "dish_nutrients_extended_nutrients_non_negative_check"
    CHECK (trans_fats >= 0 AND cholesterol >= 0 AND potassium >= 0
           AND monounsaturated_fats >= 0 AND polyunsaturated_fats >= 0);

-- ---------------------------------------------------------------------------
-- Section 8 — Table: dish_ingredients
-- ---------------------------------------------------------------------------

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

ALTER TABLE "dish_ingredients" ADD CONSTRAINT "dish_ingredients_dish_id_fkey"
  FOREIGN KEY ("dish_id") REFERENCES "dishes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dish_ingredients" ADD CONSTRAINT "dish_ingredients_ingredient_food_id_fkey"
  FOREIGN KEY ("ingredient_food_id") REFERENCES "foods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dish_ingredients"
  ADD CONSTRAINT "dish_ingredients_amount_check" CHECK (amount > 0),
  ADD CONSTRAINT "dish_ingredients_sort_order_check" CHECK (sort_order >= 0),
  ADD CONSTRAINT "dish_ingredients_gram_weight_check" CHECK (gram_weight >= 0);

-- ---------------------------------------------------------------------------
-- Section 9 — Junction tables
-- ---------------------------------------------------------------------------

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
