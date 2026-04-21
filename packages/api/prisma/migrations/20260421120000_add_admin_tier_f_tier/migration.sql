-- F-TIER: Add 'admin' value to api_key_tier enum
-- Idempotent: ADD VALUE IF NOT EXISTS is safe to re-run
ALTER TYPE "api_key_tier" ADD VALUE IF NOT EXISTS 'admin';
