-- ============================================================
-- AutoShop SMS AI — Migration 003: Conversations & Messages
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- CONVERSATIONS
-- ──────────────────────────────────────────────────────────
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
  appointment_id   UUID,  -- set after booking (FK added after appointments table)
  opened_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at        TIMESTAMPTZ,
  close_reason     TEXT CHECK (close_reason IN (
                     'booking_complete','user_explicit','inactivity_24h',
                     'max_turns_reached','blocked_trial','blocked_plan',
                     'circuit_breaker'
                   )),
  -- Circuit breaker: quarantine flag
  quarantined      BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_conv_tenant ON conversations(tenant_id);
CREATE INDEX idx_conv_tenant_status ON conversations(tenant_id, status);
CREATE INDEX idx_conv_phone ON conversations(tenant_id, customer_phone);
CREATE INDEX idx_conv_last_activity ON conversations(last_activity_at) WHERE status = 'open';

-- ──────────────────────────────────────────────────────────
-- MESSAGES
-- ──────────────────────────────────────────────────────────
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
CREATE INDEX idx_msg_created ON messages(conversation_id, created_at);

-- ──────────────────────────────────────────────────────────
-- APPOINTMENTS
-- ──────────────────────────────────────────────────────────
CREATE TABLE appointments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  customer_phone  TEXT NOT NULL,
  customer_name   TEXT,
  service_type    TEXT,
  scheduled_at    TIMESTAMPTZ NOT NULL,
  duration_mins   INT NOT NULL DEFAULT 60,
  notes           TEXT,
  google_event_id TEXT,
  sync_status     TEXT NOT NULL DEFAULT 'pending'
                    CHECK (sync_status IN (
                      'pending','synced','failed','not_connected'
                    )),
  sync_error      TEXT,
  sync_attempts   INT NOT NULL DEFAULT 0,
  last_sync_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_appt_tenant ON appointments(tenant_id);
CREATE INDEX idx_appt_scheduled ON appointments(tenant_id, scheduled_at);
CREATE INDEX idx_appt_sync_status ON appointments(sync_status) WHERE sync_status IN ('pending','failed');

-- Add FK from conversations to appointments (circular reference handled with deferrable)
ALTER TABLE conversations
  ADD CONSTRAINT fk_conv_appointment
  FOREIGN KEY (appointment_id) REFERENCES appointments(id)
  DEFERRABLE INITIALLY DEFERRED;
