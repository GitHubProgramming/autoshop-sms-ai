-- ============================================================
-- AutoShop SMS AI — Migration 002: Billing Tables
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- SUBSCRIPTIONS
-- ──────────────────────────────────────────────────────────
CREATE TABLE subscriptions (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_customer_id      TEXT UNIQUE NOT NULL,
  stripe_subscription_id  TEXT UNIQUE,
  stripe_price_id         TEXT,
  status                  TEXT NOT NULL DEFAULT 'trialing'
                            CHECK (status IN (
                              'trialing','active','past_due','canceled','unpaid','incomplete'
                            )),
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  cancel_at_period_end    BOOLEAN DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subs_tenant ON subscriptions(tenant_id);
CREATE INDEX idx_subs_stripe_customer ON subscriptions(stripe_customer_id);
CREATE INDEX idx_subs_stripe_sub ON subscriptions(stripe_subscription_id);

CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ──────────────────────────────────────────────────────────
-- USAGE RECORDS (monthly aggregation per tenant)
-- ──────────────────────────────────────────────────────────
CREATE TABLE usage_records (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_start        TIMESTAMPTZ NOT NULL,
  period_end          TIMESTAMPTZ NOT NULL,
  conversations_count INT NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, period_start)
);

CREATE INDEX idx_usage_tenant_period ON usage_records(tenant_id, period_start);

-- ──────────────────────────────────────────────────────────
-- PLAN CONFIG (static reference table)
-- ──────────────────────────────────────────────────────────
CREATE TABLE plan_configs (
  plan_id           TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  monthly_limit     INT NOT NULL,
  stripe_price_id   TEXT,
  max_turns         INT NOT NULL DEFAULT 12
);

INSERT INTO plan_configs (plan_id, display_name, monthly_limit, max_turns) VALUES
  ('trial',      'Free Trial',  50,   12),
  ('starter',    'Starter',     150,  12),
  ('pro',        'Pro',         400,  15),
  ('premium',    'Premium',     1000, 20),
  ('enterprise', 'Enterprise',  9999, 30);
