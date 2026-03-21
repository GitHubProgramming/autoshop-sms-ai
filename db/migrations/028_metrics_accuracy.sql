-- 028_metrics_accuracy.sql
-- Adds columns needed for accurate revenue, cost, and funnel metrics.
--
-- Revenue: store actual Stripe subscription amount (not derived from plan map)
-- Cost: store input/output tokens separately for model-accurate pricing
-- SMS: store segment count for accurate Twilio cost

BEGIN;

-- ── Revenue: actual subscription amount from Stripe ─────────────────────────
-- Populated by Stripe webhook on subscription.created/updated.
-- Amount in cents (Stripe convention). NULL = not yet synced from Stripe.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS subscription_amount_cents INT,
  ADD COLUMN IF NOT EXISTS subscription_currency TEXT DEFAULT 'usd',
  ADD COLUMN IF NOT EXISTS subscription_interval TEXT DEFAULT 'month'
    CHECK (subscription_interval IN ('month', 'year'));

-- ── Cost: input/output token split for model-accurate pricing ───────────────
-- OpenAI API returns prompt_tokens + completion_tokens separately.
-- Existing tokens_used column remains as total (backward compat).
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS prompt_tokens INT,
  ADD COLUMN IF NOT EXISTS completion_tokens INT,
  ADD COLUMN IF NOT EXISTS sms_segments INT DEFAULT 1;

-- ── Funnel: index for missed-call queries joining tenants ───────────────────
CREATE INDEX IF NOT EXISTS idx_pipeline_traces_tenant_trigger
  ON pipeline_traces(tenant_id, trigger_type, started_at);

COMMIT;
