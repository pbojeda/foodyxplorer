-- AlterTable: widen name_source_locale from VARCHAR(5) to VARCHAR(16)
-- to accommodate semantic classification values like 'unknown' (7 chars)
ALTER TABLE "dishes" ALTER COLUMN "name_source_locale" TYPE VARCHAR(16);
