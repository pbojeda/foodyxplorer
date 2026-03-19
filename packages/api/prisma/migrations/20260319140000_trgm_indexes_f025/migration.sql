-- F025: GIN trigram indexes for dish search
-- NOT CONCURRENTLY: Prisma migrations run inside transactions (incompatible with CONCURRENTLY).
-- Acceptable for current data volume (~900 dishes).
-- pg_trgm extension already exists (created in F024 migration / init-db.sql).
CREATE INDEX IF NOT EXISTS "dishes_name_trgm_idx"
  ON "dishes" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "dishes_name_es_trgm_idx"
  ON "dishes" USING gin ("name_es" gin_trgm_ops);
