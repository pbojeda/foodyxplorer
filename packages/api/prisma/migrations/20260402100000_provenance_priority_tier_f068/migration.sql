-- F068: Provenance Graph — Add priority_tier to data_sources (ADR-015)
--
-- Tier 0: Brand/restaurant official (chain PDFs, supermarket packaging)
-- Tier 1: National reference (BEDCA lab data)
-- Tier 2: International reference (USDA)
-- Tier 3: Estimated (engine L2-L4, LLM-bootstrapped, community)

ALTER TABLE "data_sources" ADD COLUMN "priority_tier" INTEGER;

-- Backfill existing sources
UPDATE "data_sources" SET "priority_tier" = 0 WHERE "type" = 'scraped';
UPDATE "data_sources" SET "priority_tier" = 2 WHERE "name" ILIKE '%USDA%';
UPDATE "data_sources" SET "priority_tier" = 3 WHERE "type" = 'estimated';
UPDATE "data_sources" SET "priority_tier" = 2 WHERE "type" = 'official' AND "priority_tier" IS NULL;
