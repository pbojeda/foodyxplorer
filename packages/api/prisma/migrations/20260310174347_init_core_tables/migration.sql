-- CreateEnum
CREATE TYPE "data_source_type" AS ENUM ('official', 'estimated', 'scraped', 'user');

-- CreateEnum
CREATE TYPE "confidence_level" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "estimation_method" AS ENUM ('official', 'ingredients', 'extrapolation', 'scraped');

-- CreateEnum
CREATE TYPE "portion_context" AS ENUM ('main_course', 'side_dish', 'dessert', 'starter', 'snack');

-- CreateTable
CREATE TABLE "data_sources" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" "data_source_type" NOT NULL,
    "url" TEXT,
    "last_updated" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "foods" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "name_es" VARCHAR(255) NOT NULL,
    "aliases" TEXT[],
    "food_group" VARCHAR(100),
    "source_id" UUID NOT NULL,
    "external_id" VARCHAR(100),
    "confidence_level" "confidence_level" NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "foods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_nutrients" (
    "id" UUID NOT NULL,
    "food_id" UUID NOT NULL,
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
    "source_id" UUID NOT NULL,
    "confidence_level" "confidence_level" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "food_nutrients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standard_portions" (
    "id" UUID NOT NULL,
    "food_id" UUID,
    "food_group" VARCHAR(100),
    "context" "portion_context" NOT NULL,
    "portion_grams" DECIMAL(8,2) NOT NULL,
    "source_id" UUID NOT NULL,
    "notes" TEXT,
    "confidence_level" "confidence_level" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "standard_portions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "foods_external_id_source_id_key" ON "foods"("external_id", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "food_nutrients_food_id_source_id_key" ON "food_nutrients"("food_id", "source_id");

-- AddForeignKey
ALTER TABLE "foods" ADD CONSTRAINT "foods_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_nutrients" ADD CONSTRAINT "food_nutrients_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_nutrients" ADD CONSTRAINT "food_nutrients_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standard_portions" ADD CONSTRAINT "standard_portions_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standard_portions" ADD CONSTRAINT "standard_portions_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints on food_nutrients
ALTER TABLE "food_nutrients"
  ADD CONSTRAINT "food_nutrients_calories_check"
    CHECK (calories >= 0 AND calories <= 900),
  ADD CONSTRAINT "food_nutrients_nutrients_non_negative_check"
    CHECK (proteins >= 0 AND carbohydrates >= 0 AND sugars >= 0
           AND fats >= 0 AND saturated_fats >= 0
           AND fiber >= 0 AND salt >= 0 AND sodium >= 0);

-- XOR CHECK constraint on standard_portions
ALTER TABLE "standard_portions"
  ADD CONSTRAINT "standard_portions_food_xor_group_check"
    CHECK (
      (food_id IS NOT NULL AND food_group IS NULL) OR
      (food_id IS NULL AND food_group IS NOT NULL)
    );

-- Full-text search indexes on foods (English and Spanish)
CREATE INDEX "foods_name_en_fts_idx"
  ON "foods" USING GIN (to_tsvector('english', "name"));

CREATE INDEX "foods_name_es_fts_idx"
  ON "foods" USING GIN (to_tsvector('spanish', "name_es"));

-- GIN index on aliases array
CREATE INDEX "foods_aliases_gin_idx"
  ON "foods" USING GIN ("aliases");

-- Partial indexes on standard_portions
CREATE INDEX "standard_portions_food_id_partial_idx"
  ON "standard_portions" ("food_id")
  WHERE "food_id" IS NOT NULL;

CREATE INDEX "standard_portions_food_group_partial_idx"
  ON "standard_portions" ("food_group")
  WHERE "food_group" IS NOT NULL;

CREATE INDEX "standard_portions_food_group_context_idx"
  ON "standard_portions" ("food_group", "context");

-- CHECK constraint on standard_portions portion_grams
ALTER TABLE "standard_portions"
  ADD CONSTRAINT "standard_portions_portion_grams_check"
    CHECK (portion_grams > 0);

-- Index on food_nutrients source_id (food_id index is redundant — covered by UNIQUE(food_id, source_id))
CREATE INDEX "food_nutrients_source_id_idx" ON "food_nutrients" ("source_id");

-- Index on data_sources type
CREATE INDEX "data_sources_type_idx" ON "data_sources" ("type");
