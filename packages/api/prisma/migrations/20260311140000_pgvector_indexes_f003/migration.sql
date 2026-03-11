-- F003: pgvector IVFFlat Indexes
-- Creates IVFFlat indexes on embedding columns for cosine similarity searches.
-- IVFFlat chosen over HNSW: lower memory, faster builds, good enough for <100k rows.
-- lists = 100 is a safe default; re-tune when row count exceeds 100k.

-- Foods embedding index (cosine similarity)
CREATE INDEX IF NOT EXISTS "foods_embedding_idx"
  ON "foods" USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100);

-- Dishes embedding index (cosine similarity)
CREATE INDEX IF NOT EXISTS "dishes_embedding_idx"
  ON "dishes" USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100);
