-- Migration 3: Create public.profiles placeholder table (F107a, ADR-025 R3 §3)
--
-- Empty placeholder — all RGPD Art. 9 body/health fields added in F099.
-- No Prisma model until F099 (intentional — Prisma will warn about an
-- unrecognized table during introspection; this is acceptable for F107a).
-- Pattern (c): migration file lives in standard migrations/ directory;
-- prisma migrate deploy applies it without a corresponding model.
--
-- profiles.id == account_id (same UUID) — profiles is a 1:1 extension table.
-- ON DELETE CASCADE: deleting an account removes the profile row.
--
-- F6 self-review: Rollback is `DROP TABLE public.profiles CASCADE;`
-- Additive migration — empty table, no data loss.

CREATE TABLE public.profiles (
  id         UUID NOT NULL,
  account_id UUID NOT NULL,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_account_id_key UNIQUE (account_id),
  CONSTRAINT profiles_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE
);
