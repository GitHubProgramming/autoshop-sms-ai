-- 001_init.sql
-- AutoShop SMS AI — Initial schema
-- Multi-tenant: ALL tenant-scoped tables have tenant_id FK

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── tenants ───────────────────────────────────────────────────────────────────
CREATE TABLE tenants (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_name               TEXT NOT NULL,
  owner_name              TEXT NOT NULL,
  owner_email             TEXT UNIQUE NOT NULL,
  owner_phone             TEXT,
  timezone                TEXT NOT NULL DEFAULT 'America/Chicago',

  -- Billing
  stripe_customer_id      TEXT UNIQUE,
  stripe_subscription_id  TEXT UNIQUE,
  billing_status          TEXT NOT NULL DEFAULT 'trial'
                          CHECK (billing_status IN (
                            'trial','trial_expired','active',
                            'past_due','past_due_blocked','canceled','paused'
                          )),
  plan_id                 TEXT CHECK (plan_id IN ('starter','pro','premium','enterprise')),

  -- Trial
  trial_started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trial_ends_at           TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  trial_conv_limit        INT NOT NULL DEFAULT 50,

  -- Usage (resets each billing cycle)
  conv_used_this_cycle    INT NOT NULL DEFAULT 0,
  conv_limit_this_cycle   INT NOT NULL DEFAULT 50,
  cycle_reset_at          TIMESTAMPTZ,

  -- Warning flags
  warned_80pct            BOOLEAN NOT NULL DEFAULT FALSE,
  warned_100pct           BOOLEAN NOT NULL DEFAULT FALSE,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── tenant_phone_numbers ──────────────────────────────────────────────────────
CREATE TABLE tenant_phone_numbers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  twilio_sid      TEXT UNIQUE NOT NULL,
  phone_number    TEXT UNIQUE NOT NULL, -- E.164: +15125551234
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','suspended','released')),
  provisioned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at     TIMESTAMPTZ
);

-- ── conversations ─────────────────────────────────────────────────────────────
CREATE TABLE conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_phone  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','booked','closed','expired')),
  close_reason    TEXT CHECK (close_reason IN (
                    'booking_completed','user_closed',
                    'inactivity_24h','system_blocked','turn_limit'
                  )),
  turn_count      INT NOT NULL DEFAULT 0,
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at       TIMESTAMPTZ,
  appointment_id  UUID,
  counted         BOOLEAN NOT NULL DEFAULT FALSE
);

-- ── messages ──────────────────────────────────────────────────────────────────
CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction       TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  body            TEXT NOT NULL,
  twilio_sid      TEXT UNIQUE,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tokens_used     INT,
  model_version   TEXT
);

-- ── appointments ──────────────────────────────────────────────────────────────
CREATE TABLE appointments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id     UUID REFERENCES conversations(id),
  customer_phone      TEXT NOT NULL,
  customer_name       TEXT,
  service_type        TEXT,
  scheduled_at        TIMESTAMPTZ NOT NULL,
  duration_minutes    INT NOT NULL DEFAULT 60,
  notes               TEXT,
  google_event_id     TEXT,
  calendar_synced     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── tenant_calendar_tokens ────────────────────────────────────────────────────
CREATE TABLE tenant_calendar_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID UNIQUE NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  access_token    TEXT NOT NULL,  -- AES-256 encrypted at app layer
  refresh_token   TEXT NOT NULL,  -- AES-256 encrypted at app layer
  token_expiry    TIMESTAMPTZ,
  calendar_id     TEXT NOT NULL DEFAULT 'primary',
  connected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_refreshed  TIMESTAMPTZ
);

-- ── billing_events ────────────────────────────────────────────────────────────
CREATE TABLE billing_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id),
  stripe_event_id TEXT UNIQUE NOT NULL,
  event_type      TEXT NOT NULL,
  payload         JSONB,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── system_prompts ────────────────────────────────────────────────────────────
CREATE TABLE system_prompts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version     INT NOT NULL DEFAULT 1,
  prompt_text TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, version)
);

-- ── conversation_cooldowns ────────────────────────────────────────────────────
-- Prevents rapid thread cycling to game conversation limits
CREATE TABLE conversation_cooldowns (
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_phone  TEXT NOT NULL,
  cooldown_until  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, customer_phone)
);

COMMIT;
