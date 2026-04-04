-- F079: Missed Query Tracking — Demand-Driven Expansion Pipeline
-- New enum + table to track missed queries and their resolution status.

-- CreateEnum
CREATE TYPE "missed_query_status" AS ENUM ('pending', 'resolved', 'ignored');

-- CreateTable
CREATE TABLE "missed_query_tracking" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "query_text" VARCHAR(255) NOT NULL,
    "hit_count" INTEGER NOT NULL,
    "status" "missed_query_status" NOT NULL DEFAULT 'pending',
    "resolved_dish_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "missed_query_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "missed_query_tracking_query_text_key" ON "missed_query_tracking"("query_text");

-- CreateIndex
CREATE INDEX "missed_query_tracking_status_idx" ON "missed_query_tracking"("status");

-- AddForeignKey
ALTER TABLE "missed_query_tracking" ADD CONSTRAINT "missed_query_tracking_resolved_dish_id_fkey" FOREIGN KEY ("resolved_dish_id") REFERENCES "dishes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
