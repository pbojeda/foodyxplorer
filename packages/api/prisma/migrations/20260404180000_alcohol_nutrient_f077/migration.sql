-- F077: Add alcohol column to food_nutrients and dish_nutrients
-- Alcohol provides 7 kcal/g, critical for Spanish tapeo (beer, wine, vermouth).
-- BEDCA nutrient ID 221 (tagname ALC) already has this data.

ALTER TABLE "food_nutrients" ADD COLUMN "alcohol" DECIMAL(8,2) NOT NULL DEFAULT 0;
ALTER TABLE "dish_nutrients" ADD COLUMN "alcohol" DECIMAL(8,2) NOT NULL DEFAULT 0;
