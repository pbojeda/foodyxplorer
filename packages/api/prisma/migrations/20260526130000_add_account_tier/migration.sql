-- Migration: Add account_tier enum + accounts.tier column (F-WEB-TIER, D1)
--
-- All existing accounts get 'free' via NOT NULL DEFAULT 'free'.
-- No back-fill needed.
-- Rollback: ALTER TABLE accounts DROP COLUMN tier; DROP TYPE account_tier;

CREATE TYPE account_tier AS ENUM ('free', 'pro', 'admin');
ALTER TABLE accounts ADD COLUMN tier account_tier NOT NULL DEFAULT 'free';
