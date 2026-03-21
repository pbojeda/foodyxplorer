-- F029: Query Log & Analytics
-- Creates query_log_level_hit enum, query_log_source enum, and query_logs table
-- with 4 indexes. No FK constraints on api_key_id or restaurant_id (immutable audit records).

-- Enums
CREATE TYPE "query_log_level_hit" AS ENUM ('l1', 'l2', 'l3', 'l4');
CREATE TYPE "query_log_source" AS ENUM ('api', 'bot');

-- Table
CREATE TABLE "query_logs" (
    "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
    "query_text"       VARCHAR(255) NOT NULL,
    "chain_slug"       VARCHAR(100),
    "restaurant_id"    UUID,
    "level_hit"        "query_log_level_hit",
    "cache_hit"        BOOLEAN      NOT NULL,
    "response_time_ms" INTEGER      NOT NULL,
    "api_key_id"       UUID,
    "source"           "query_log_source" NOT NULL DEFAULT 'api',
    "queried_at"       TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "query_logs_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "query_logs_queried_at_idx"  ON "query_logs" ("queried_at" DESC);
CREATE INDEX "query_logs_chain_slug_idx"  ON "query_logs" ("chain_slug");
CREATE INDEX "query_logs_level_hit_idx"   ON "query_logs" ("level_hit");
CREATE INDEX "query_logs_source_idx"      ON "query_logs" ("source");
