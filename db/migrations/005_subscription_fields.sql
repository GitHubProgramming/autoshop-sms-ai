-- 005_subscription_fields.sql
-- Add subscription tracking columns for full Stripe state sync.
-- These are additive only — no data loss, safe to apply to existing tenants.

BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS stripe_price_id       TEXT,
  ADD COLUMN IF NOT EXISTS current_period_start  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end  BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
