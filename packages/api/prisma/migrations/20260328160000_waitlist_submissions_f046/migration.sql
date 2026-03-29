-- F046: Waitlist Persistence + Anti-Spam
-- Creates waitlist_submissions table for lead capture from the landing page.

CREATE TABLE waitlist_submissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  phone         TEXT,
  variant       TEXT NOT NULL DEFAULT 'a',
  source        TEXT NOT NULL DEFAULT 'hero',
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  ip_address    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT waitlist_submissions_email_unique UNIQUE (email),
  CONSTRAINT waitlist_submissions_email_check CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$'),
  CONSTRAINT waitlist_submissions_variant_check CHECK (variant IN ('a', 'c', 'f'))
);

CREATE INDEX idx_waitlist_submissions_created_at ON waitlist_submissions (created_at DESC);
