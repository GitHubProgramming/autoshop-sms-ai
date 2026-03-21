-- 029_metrics_trust_hardening.sql
-- Metrics trust-hardening: scheduled_cancel status, cancel_at tracking,
-- funnel integrity indexes, and backfill support.

BEGIN;

-- ── 1. Add 'scheduled_cancel' to billing_status enum ─────────────────────────
-- A subscription set to cancel at period end still counts toward MRR.
-- It is NOT canceled until the period actually ends.
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_billing_status_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_billing_status_check
  CHECK (billing_status IN (
    'trial','trial_expired','active','scheduled_cancel',
    'past_due','past_due_blocked','canceled','paused'
  ));

-- Track when the subscription is scheduled to end (Stripe cancel_at / current_period_end)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS cancel_at TIMESTAMPTZ;

-- ── 2. Funnel integrity: ensure appointments always reference valid conversations
-- Index for orphan-booking detection queries
CREATE INDEX IF NOT EXISTS idx_appointments_conversation_id
  ON appointments(conversation_id);

-- Index for conversation source tracing
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_status
  ON conversations(tenant_id, status, opened_at);

-- Index for pipeline trace dedup detection
CREATE INDEX IF NOT EXISTS idx_pipeline_traces_trigger_id
  ON pipeline_traces(trigger_id);

COMMIT;
