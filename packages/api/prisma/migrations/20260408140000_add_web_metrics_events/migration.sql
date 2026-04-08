CREATE TABLE "web_metrics_events" (
  "id"                    UUID NOT NULL DEFAULT gen_random_uuid(),
  "query_count"           INTEGER NOT NULL,
  "success_count"         INTEGER NOT NULL,
  "error_count"           INTEGER NOT NULL,
  "retry_count"           INTEGER NOT NULL,
  "intents"               JSONB NOT NULL,
  "errors"                JSONB NOT NULL,
  "avg_response_time_ms"  INTEGER NOT NULL,
  "session_started_at"    TIMESTAMPTZ NOT NULL,
  "received_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
  "ip_hash"               VARCHAR(64),
  CONSTRAINT "web_metrics_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "web_metrics_events_received_at_idx" ON "web_metrics_events" ("received_at" DESC);
