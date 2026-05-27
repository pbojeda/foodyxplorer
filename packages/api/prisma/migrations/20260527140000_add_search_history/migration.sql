-- Migration: Add search_history table + enum (F-WEB-HISTORY)
--
-- Rollback: DROP TABLE search_history; DROP TYPE search_history_kind;

CREATE TYPE search_history_kind AS ENUM ('text', 'voice');

CREATE TABLE search_history (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  account_id  uuid        NOT NULL,
  kind        search_history_kind NOT NULL,
  query_text  text        NOT NULL,
  result_jsonb jsonb      NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT search_history_pkey PRIMARY KEY (id),
  CONSTRAINT search_history_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX search_history_account_cursor_idx
  ON search_history (account_id, created_at DESC, id DESC);
