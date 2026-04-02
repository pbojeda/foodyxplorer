-- F069: Anonymous Identity — actors table + query_logs actor_id (ADR-016)
--
-- ActorType: anonymous_web (web UUID), telegram (chat_id), authenticated (future)

-- Enum
CREATE TYPE "actor_type" AS ENUM ('anonymous_web', 'telegram', 'authenticated');

-- Actors table
CREATE TABLE "actors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "actor_type" NOT NULL,
    "external_id" VARCHAR(255) NOT NULL,
    "locale" VARCHAR(10),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actors_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: one actor per type+external_id
CREATE UNIQUE INDEX "actors_type_external_id_key" ON "actors"("type", "external_id");

-- Add actor_id to query_logs (nullable, no FK — same pattern as api_key_id)
ALTER TABLE "query_logs" ADD COLUMN "actor_id" UUID;
