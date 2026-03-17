-- F019: add embedding_updated_at to foods and dishes
-- Used for skip-detection: NULL = needs embedding, non-NULL = already embedded
ALTER TABLE "foods" ADD COLUMN IF NOT EXISTS "embedding_updated_at" TIMESTAMPTZ;
ALTER TABLE "dishes" ADD COLUMN IF NOT EXISTS "embedding_updated_at" TIMESTAMPTZ;
