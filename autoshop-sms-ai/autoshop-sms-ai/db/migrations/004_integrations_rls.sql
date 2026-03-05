-- ============================================================
-- AutoShop SMS AI — Migration 004: Integrations & Webhooks
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- TWILIO NUMBERS
-- ──────────────────────────────────────────────────────────
CREATE TABLE twilio_numbers (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number     TEXT NOT NULL UNIQUE,  -- E.164 e.g. +12145551234
  twilio_sid       TEXT NOT NULL UNIQUE,
  area_code        TEXT,
  provisioned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at      TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','released','error'))
);

CREATE INDEX idx_twilio_phone ON twilio_numbers(phone_number);
CREATE INDEX idx_twilio_tenant ON twilio_numbers(tenant_id);

-- ──────────────────────────────────────────────────────────
-- GOOGLE CALENDAR INTEGRATIONS
-- ──────────────────────────────────────────────────────────
CREATE TABLE google_calendar_integrations (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  google_account   TEXT NOT NULL,
  calendar_id      TEXT NOT NULL DEFAULT 'primary',
  -- Tokens encrypted at rest via pgcrypto (app layer does AES-256 encryption)
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  token_expiry     TIMESTAMPTZ NOT NULL,
  sync_status      TEXT NOT NULL DEFAULT 'connected'
                     CHECK (sync_status IN ('connected','disconnected','failed')),
  last_error       TEXT,
  connected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER gci_updated_at
  BEFORE UPDATE ON google_calendar_integrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ──────────────────────────────────────────────────────────
-- WEBHOOK EVENTS (idempotency + audit log)
-- ──────────────────────────────────────────────────────────
CREATE TABLE webhook_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source        TEXT NOT NULL CHECK (source IN ('twilio','stripe')),
  event_sid     TEXT NOT NULL,  -- Twilio MessageSid/CallSid or Stripe event ID
  tenant_id     UUID REFERENCES tenants(id),  -- null before tenant lookup
  event_type    TEXT NOT NULL,
  payload       JSONB NOT NULL,
  processed     BOOLEAN NOT NULL DEFAULT FALSE,
  processed_at  TIMESTAMPTZ,
  error         TEXT,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source, event_sid)  -- IDEMPOTENCY CONSTRAINT
);

CREATE INDEX idx_webhook_sid ON webhook_events(event_sid);
CREATE INDEX idx_webhook_unprocessed ON webhook_events(processed, received_at)
  WHERE processed = FALSE;

-- ──────────────────────────────────────────────────────────
-- CIRCUIT BREAKER EVENTS
-- ──────────────────────────────────────────────────────────
CREATE TABLE circuit_breaker_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  phone_number TEXT NOT NULL,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message_count INT NOT NULL,
  window_mins   INT NOT NULL DEFAULT 10,
  auto_released_at TIMESTAMPTZ
);

-- ──────────────────────────────────────────────────────────
-- ROW-LEVEL SECURITY
-- ──────────────────────────────────────────────────────────
-- Application sets: SET LOCAL app.current_tenant_id = '<uuid>'
-- at the start of every request transaction via tenantGuard middleware.
-- RLS provides a second enforcement layer.

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE twilio_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_calendar_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Create a non-superuser application role for RLS enforcement
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user;
  END IF;
END
$$;

-- Helper function to get current tenant from session variable
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
$$;

-- RLS Policies
CREATE POLICY tenant_isolation ON conversations
  USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON messages
  USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON appointments
  USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON usage_records
  USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON twilio_numbers
  USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON google_calendar_integrations
  USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON subscriptions
  USING (tenant_id = current_tenant_id());

-- ──────────────────────────────────────────────────────────
-- ATOMIC CONVERSATION OPEN STORED PROCEDURE
-- ──────────────────────────────────────────────────────────
-- Returns: { conversation_id UUID, blocked BOOL, block_reason TEXT }
CREATE OR REPLACE FUNCTION open_conversation(
  p_tenant_id       UUID,
  p_customer_phone  TEXT,
  p_twilio_number   TEXT,
  p_trigger_type    TEXT
) RETURNS TABLE(
  conversation_id UUID,
  blocked         BOOLEAN,
  block_reason    TEXT
) LANGUAGE plpgsql AS $$
DECLARE
  v_tenant          tenants%ROWTYPE;
  v_usage           usage_records%ROWTYPE;
  v_period_start    TIMESTAMPTZ;
  v_period_end      TIMESTAMPTZ;
  v_max_turns       INT := 12;
  v_conv_id         UUID;
  v_existing_id     UUID;
BEGIN
  -- Lock tenant row
  SELECT * INTO v_tenant FROM tenants WHERE id = p_tenant_id FOR UPDATE;

  -- Check billing state hard blocks
  IF v_tenant.billing_state IN ('trial_expired','suspended','canceled') THEN
    RETURN QUERY SELECT NULL::UUID, TRUE, v_tenant.billing_state;
    RETURN;
  END IF;

  -- Check if open conversation already exists for this phone (dedup)
  SELECT id INTO v_existing_id
  FROM conversations
  WHERE tenant_id = p_tenant_id
    AND customer_phone = p_customer_phone
    AND status = 'open'
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Return existing conversation, not blocked, no new count increment
    RETURN QUERY SELECT v_existing_id, FALSE, NULL::TEXT;
    RETURN;
  END IF;

  -- Determine billing period
  IF v_tenant.billing_state = 'trial' THEN
    v_period_start := v_tenant.trial_started_at;
    v_period_end   := v_tenant.trial_ends_at;

    -- Trial time check
    IF NOW() >= v_tenant.trial_ends_at THEN
      -- Expire trial
      UPDATE tenants SET billing_state = 'trial_expired', updated_at = NOW()
        WHERE id = p_tenant_id;
      RETURN QUERY SELECT NULL::UUID, TRUE, 'trial_expired';
      RETURN;
    END IF;
  ELSE
    v_period_start := v_tenant.billing_cycle_start;
    v_period_end   := v_tenant.billing_cycle_start + INTERVAL '1 month';
  END IF;

  -- Get or create usage record (lock it)
  INSERT INTO usage_records (tenant_id, period_start, period_end, conversations_count)
  VALUES (p_tenant_id, v_period_start, v_period_end, 0)
  ON CONFLICT (tenant_id, period_start) DO NOTHING;

  SELECT * INTO v_usage FROM usage_records
  WHERE tenant_id = p_tenant_id AND period_start = v_period_start
  FOR UPDATE;

  -- Check limit
  IF v_usage.conversations_count >= v_tenant.monthly_limit THEN
    IF v_tenant.billing_state = 'trial' THEN
      UPDATE tenants SET billing_state = 'trial_expired', updated_at = NOW()
        WHERE id = p_tenant_id;
      RETURN QUERY SELECT NULL::UUID, TRUE, 'trial_expired_count';
      RETURN;
    END IF;
    -- Paid plans: soft block only — emit warning but allow
    -- per Blueprint: "NO hard-block for paid users"
    -- We continue and allow conversation, but warnings will be sent
  END IF;

  -- Get max_turns from plan config
  SELECT pc.max_turns INTO v_max_turns
  FROM plan_configs pc
  WHERE pc.plan_id = COALESCE(v_tenant.plan_id, 'trial');

  -- Increment usage counter
  UPDATE usage_records
  SET conversations_count = conversations_count + 1
  WHERE tenant_id = p_tenant_id AND period_start = v_period_start;

  -- Create conversation
  INSERT INTO conversations (tenant_id, customer_phone, twilio_number, trigger_type, max_turns)
  VALUES (p_tenant_id, p_customer_phone, p_twilio_number, p_trigger_type, COALESCE(v_max_turns, 12))
  RETURNING id INTO v_conv_id;

  RETURN QUERY SELECT v_conv_id, FALSE, NULL::TEXT;
END;
$$;
