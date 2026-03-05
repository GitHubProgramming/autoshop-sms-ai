-- ============================================================
-- Migration 001: Core Schema
-- AutoShop SMS AI — Multi-Tenant SaaS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── TENANTS ─────────────────────────────────────────────────
CREATE TABLE tenants (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clerk_org_id          TEXT UNIQUE NOT NULL,
  shop_name             TEXT NOT NULL,
  phone                 TEXT NOT NULL,
  timezone              TEXT NOT NULL DEFAULT 'America/Chicago'
                          CHECK (timezone IN ('America/Chicago','America/Denver')),
  billing_state         TEXT NOT NULL DEFAULT 'trial'
                          CHECK (billing_state IN (
                            'trial','trial_expired','active',
                            'past_due','suspended','canceled'
                          )),
  trial_started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trial_ends_at         TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  plan_id               TEXT CHECK (plan_id IN ('starter','pro','premium','enterprise')),
  monthly_limit         INT NOT NULL DEFAULT 50,
  max_ai_turns          INT NOT NULL DEFAULT 12,
  billing_cycle_start   TIMESTAMPTZ,
  onboarding_steps      JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── USERS ───────────────────────────────────────────────────
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  clerk_user_id   TEXT UNIQUE NOT NULL,
  email           TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'member'
                    CHECK (role IN ('owner','admin','member')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_tenant ON users(tenant_id);

-- ─── SUBSCRIPTIONS ───────────────────────────────────────────
CREATE TABLE subscriptions (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_customer_id      TEXT UNIQUE NOT NULL,
  stripe_subscription_id  TEXT UNIQUE,
  stripe_price_id         TEXT,
  status                  TEXT NOT NULL DEFAULT 'trialing'
                            CHECK (status IN (
                              'trialing','active','past_due','canceled','unpaid'
                            )),
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  cancel_at_period_end    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_subs_tenant ON subscriptions(tenant_id);

-- ─── USAGE RECORDS ───────────────────────────────────────────
CREATE TABLE usage_records (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_start        TIMESTAMPTZ NOT NULL,
  period_end          TIMESTAMPTZ NOT NULL,
  conversations_count INT NOT NULL DEFAULT 0,
  warning_80_sent     BOOLEAN NOT NULL DEFAULT FALSE,
  warning_100_sent    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, period_start)
);
CREATE INDEX idx_usage_tenant_period ON usage_records(tenant_id, period_start);

-- ─── CONVERSATIONS ───────────────────────────────────────────
CREATE TABLE conversations (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_phone   TEXT NOT NULL,
  twilio_number    TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN (
                       'open','completed','closed_inactive','blocked'
                     )),
  trigger_type     TEXT NOT NULL CHECK (trigger_type IN ('missed_call','sms_inbound')),
  turn_count       INT NOT NULL DEFAULT 0,
  max_turns        INT NOT NULL DEFAULT 12,
  appointment_id   UUID,
  opened_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at        TIMESTAMPTZ,
  close_reason     TEXT
                     CHECK (close_reason IN (
                       'booking_complete','user_explicit','inactivity_24h',
                       'max_turns_reached','blocked_trial','blocked_plan'
                     )),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_conv_tenant ON conversations(tenant_id);
CREATE INDEX idx_conv_tenant_status ON conversations(tenant_id, status);
CREATE INDEX idx_conv_phone ON conversations(tenant_id, customer_phone);
CREATE INDEX idx_conv_last_activity ON conversations(last_activity_at) WHERE status = 'open';

-- ─── MESSAGES ────────────────────────────────────────────────
CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  direction       TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  body            TEXT NOT NULL,
  twilio_sid      TEXT,
  ai_model        TEXT,
  tokens_used     INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_msg_conv ON messages(conversation_id);
CREATE INDEX idx_msg_tenant ON messages(tenant_id);

-- ─── APPOINTMENTS ────────────────────────────────────────────
CREATE TABLE appointments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  customer_phone  TEXT NOT NULL,
  customer_name   TEXT,
  service_type    TEXT,
  scheduled_at    TIMESTAMPTZ NOT NULL,
  duration_mins   INT NOT NULL DEFAULT 60,
  google_event_id TEXT,
  sync_status     TEXT NOT NULL DEFAULT 'pending'
                    CHECK (sync_status IN (
                      'pending','synced','failed','not_connected'
                    )),
  sync_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_appt_tenant ON appointments(tenant_id);
CREATE INDEX idx_appt_scheduled ON appointments(tenant_id, scheduled_at);

-- ─── TWILIO NUMBERS ──────────────────────────────────────────
CREATE TABLE twilio_numbers (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL UNIQUE REFERENCES tenants(id),
  phone_number     TEXT NOT NULL UNIQUE,
  twilio_sid       TEXT NOT NULL UNIQUE,
  area_code        TEXT,
  provisioned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at      TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','released','error'))
);
CREATE INDEX idx_twilio_number_lookup ON twilio_numbers(phone_number) WHERE status = 'active';

-- ─── GOOGLE CALENDAR INTEGRATIONS ────────────────────────────
CREATE TABLE google_calendar_integrations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL UNIQUE REFERENCES tenants(id),
  google_account  TEXT NOT NULL,
  calendar_id     TEXT NOT NULL DEFAULT 'primary',
  access_token    TEXT NOT NULL,   -- encrypted via pgcrypto at app layer
  refresh_token   TEXT NOT NULL,   -- encrypted via pgcrypto at app layer
  token_expiry    TIMESTAMPTZ NOT NULL,
  sync_status     TEXT NOT NULL DEFAULT 'connected'
                    CHECK (sync_status IN ('connected','disconnected','failed')),
  last_error      TEXT,
  connected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── WEBHOOK EVENTS (idempotency + audit) ────────────────────
CREATE TABLE webhook_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source        TEXT NOT NULL CHECK (source IN ('twilio','stripe')),
  event_sid     TEXT NOT NULL,
  tenant_id     UUID REFERENCES tenants(id),
  event_type    TEXT NOT NULL,
  payload       JSONB NOT NULL,
  processed     BOOLEAN NOT NULL DEFAULT FALSE,
  processed_at  TIMESTAMPTZ,
  error         TEXT,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, event_sid)
);
CREATE INDEX idx_webhook_sid ON webhook_events(event_sid);
CREATE INDEX idx_webhook_unprocessed ON webhook_events(processed, received_at) WHERE processed = FALSE;

-- ─── QUARANTINED PHONES (circuit breaker) ────────────────────
CREATE TABLE quarantined_phones (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone       TEXT NOT NULL,
  reason      TEXT NOT NULL,
  quarantined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour'),
  UNIQUE (tenant_id, phone)
);

-- ─── UPDATED_AT TRIGGER ──────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER subs_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER usage_updated_at BEFORE UPDATE ON usage_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER gcal_updated_at BEFORE UPDATE ON google_calendar_integrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
