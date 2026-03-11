-- F001b: Schema Enhancements — Nutrition API Alignment
-- Migration layered on top of F001 (init_core_tables).
-- DO NOT MODIFY the F001 migration file.

-- ---------------------------------------------------------------------------
-- New enums
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "food_type" AS ENUM ('generic', 'branded', 'composite');

-- CreateEnum
CREATE TYPE "nutrient_reference_basis" AS ENUM ('per_100g', 'per_serving', 'per_package');

-- ---------------------------------------------------------------------------
-- New columns on foods
-- ---------------------------------------------------------------------------

ALTER TABLE "foods"
  ADD COLUMN "food_type" "food_type" NOT NULL DEFAULT 'generic',
  ADD COLUMN "brand_name" VARCHAR(255),
  ADD COLUMN "barcode" VARCHAR(50);

-- ---------------------------------------------------------------------------
-- New columns on food_nutrients
-- ---------------------------------------------------------------------------

ALTER TABLE "food_nutrients"
  ADD COLUMN "reference_basis" "nutrient_reference_basis" NOT NULL DEFAULT 'per_100g',
  ADD COLUMN "trans_fats" DECIMAL(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN "cholesterol" DECIMAL(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN "potassium" DECIMAL(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN "monounsaturated_fats" DECIMAL(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN "polyunsaturated_fats" DECIMAL(8,2) NOT NULL DEFAULT 0;

-- CHECK constraint for new nutrient columns
ALTER TABLE "food_nutrients"
  ADD CONSTRAINT "food_nutrients_extended_nutrients_non_negative_check"
    CHECK (trans_fats >= 0 AND cholesterol >= 0 AND potassium >= 0
           AND monounsaturated_fats >= 0 AND polyunsaturated_fats >= 0);

-- ---------------------------------------------------------------------------
-- New columns on standard_portions
-- Two-step pattern: add nullable → backfill → set NOT NULL
-- ---------------------------------------------------------------------------

-- Step 1: Add description column as nullable
ALTER TABLE "standard_portions" ADD COLUMN "description" VARCHAR(255);

-- Step 2: Backfill existing rows from notes or use default
UPDATE "standard_portions"
  SET "description" = COALESCE(notes, 'Standard portion')
  WHERE "description" IS NULL;

-- Step 3: Apply NOT NULL constraint
ALTER TABLE "standard_portions" ALTER COLUMN "description" SET NOT NULL;

-- Add is_default column with default
ALTER TABLE "standard_portions"
  ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- New table: recipes
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL,
    "food_id" UUID NOT NULL,
    "servings" INTEGER,
    "prep_minutes" INTEGER,
    "cook_minutes" INTEGER,
    "source_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (UNIQUE on food_id — one recipe per food)
CREATE UNIQUE INDEX "recipes_food_id_key" ON "recipes"("food_id");

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_food_id_fkey"
  FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "recipes" ADD CONSTRAINT "recipes_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints on recipes
ALTER TABLE "recipes"
  ADD CONSTRAINT "recipes_servings_check" CHECK (servings > 0),
  ADD CONSTRAINT "recipes_prep_minutes_check" CHECK (prep_minutes >= 0),
  ADD CONSTRAINT "recipes_cook_minutes_check" CHECK (cook_minutes >= 0);

-- ---------------------------------------------------------------------------
-- New table: recipe_ingredients
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "recipe_ingredients" (
    "id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "ingredient_food_id" UUID NOT NULL,
    "amount" DECIMAL(8,2) NOT NULL,
    "unit" VARCHAR(50) NOT NULL,
    "gram_weight" DECIMAL(8,2),
    "sort_order" INTEGER NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id")
);

-- UNIQUE constraint (Prisma @@unique — generated here)
CREATE UNIQUE INDEX "recipe_ingredients_recipe_id_ingredient_food_id_sort_order_key"
  ON "recipe_ingredients"("recipe_id", "ingredient_food_id", "sort_order");

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_fkey"
  FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_ingredient_food_id_fkey"
  FOREIGN KEY ("ingredient_food_id") REFERENCES "foods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints on recipe_ingredients
ALTER TABLE "recipe_ingredients"
  ADD CONSTRAINT "recipe_ingredients_amount_check" CHECK (amount > 0),
  ADD CONSTRAINT "recipe_ingredients_sort_order_check" CHECK (sort_order >= 0),
  ADD CONSTRAINT "recipe_ingredients_gram_weight_check" CHECK (gram_weight >= 0);

-- ---------------------------------------------------------------------------
-- New indexes
-- ---------------------------------------------------------------------------

-- Btree indexes on foods (generated from Prisma @@index)
CREATE INDEX "foods_food_type_idx" ON "foods" ("food_type");
CREATE INDEX "foods_barcode_idx" ON "foods" ("barcode");

-- Partial index for brand_name WHERE NOT NULL (raw SQL only — Prisma has no WHERE support)
CREATE INDEX "foods_brand_name_partial_idx" ON "foods" ("brand_name") WHERE "brand_name" IS NOT NULL;

-- Indexes on recipe_ingredients (generated from Prisma @@index)
CREATE INDEX "recipe_ingredients_recipe_id_idx" ON "recipe_ingredients" ("recipe_id");
CREATE INDEX "recipe_ingredients_ingredient_food_id_idx" ON "recipe_ingredients" ("ingredient_food_id");
