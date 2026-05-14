-- Migration 2: Add account_id column to public.actors (F107a, ADR-025 R3 §3)
--
-- Enables N actors → 1 account (multi-device support).
-- Non-unique intentional per ADR-025 R3 R2: a UNIQUE constraint would break
-- second-device login where two anonymous actors link to the same account.
--
-- ON DELETE SET NULL: if an account is ever deleted, actors become anonymous
-- again rather than being cascade-deleted (preserving query history / audit).
--
-- F6 self-review: Rollback is:
--   DROP INDEX actors_account_id_idx;
--   ALTER TABLE actors DROP COLUMN account_id;
-- Additive migration — no data loss (column defaults to NULL).

ALTER TABLE public.actors
  ADD COLUMN account_id UUID NULL
  REFERENCES public.accounts(id) ON DELETE SET NULL;

-- Non-unique B-tree index — required for /me join performance.
CREATE INDEX actors_account_id_idx ON public.actors (account_id);
