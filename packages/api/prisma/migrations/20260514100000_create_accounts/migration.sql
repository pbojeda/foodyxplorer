-- Migration 1: Create public.accounts table (F107a, ADR-025 R3 §3)
--
-- accounts is the identity + consent + billing anchor for authenticated users.
-- Body/health fields are NOT here — they belong to public.profiles (F099).
--
-- ADR-025 R3 §3: NO hard FK to auth.users(id) — auth_user_id is a logical
-- reference only. Supabase manages auth.users lifecycle; cascades handled via
-- webhook (out of scope F107a).
--
-- F6 self-review: Rollback is `DROP TABLE public.accounts CASCADE;`
-- Additive migration — no data loss for existing rows.

CREATE TABLE public.accounts (
  id                   UUID         NOT NULL DEFAULT gen_random_uuid(),
  auth_user_id         UUID         NOT NULL,
  email                VARCHAR(255) NOT NULL,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_seen_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  consent_marketing    BOOLEAN      NOT NULL DEFAULT false,
  consent_marketing_at TIMESTAMPTZ,
  consent_analytics    BOOLEAN      NOT NULL DEFAULT false,
  consent_analytics_at TIMESTAMPTZ,
  CONSTRAINT accounts_pkey PRIMARY KEY (id),
  CONSTRAINT accounts_auth_user_id_key UNIQUE (auth_user_id)
);

-- Non-unique B-tree index on email for reconciliation queries.
CREATE INDEX accounts_email_idx ON public.accounts (email);
