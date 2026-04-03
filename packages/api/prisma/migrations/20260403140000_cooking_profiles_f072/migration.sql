-- F072: Cooking Profiles + Yield Factors
-- Creates the cooking_profiles table with indexes and unique constraint.
-- No DB-level CHECK constraint on yield_factor — validation lives in application code
-- so the invalid_yield_factor reason can be surfaced cleanly to API clients.

CREATE TABLE "cooking_profiles" (
    "id"             UUID         NOT NULL DEFAULT gen_random_uuid(),
    "food_group"     VARCHAR(100) NOT NULL,
    "food_name"      VARCHAR(255) NOT NULL DEFAULT '*',
    "cooking_method" VARCHAR(100) NOT NULL,
    "yield_factor"   DECIMAL(6,4) NOT NULL,
    "fat_absorption" DECIMAL(6,2),
    "source"         VARCHAR(255) NOT NULL,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cooking_profiles_pkey" PRIMARY KEY ("id")
);

-- Unique constraint on (food_group, food_name, cooking_method) for upsert idempotency.
-- Group-level defaults use food_name = '*' (not NULL) so PG unique constraint works.
CREATE UNIQUE INDEX "cooking_profiles_food_group_food_name_cooking_method_key"
    ON "cooking_profiles"("food_group", "food_name", "cooking_method");

-- Individual indexes for efficient lookups by food_group and food_name
CREATE INDEX "cooking_profiles_food_group_idx"
    ON "cooking_profiles"("food_group");

CREATE INDEX "cooking_profiles_food_name_idx"
    ON "cooking_profiles"("food_name");
