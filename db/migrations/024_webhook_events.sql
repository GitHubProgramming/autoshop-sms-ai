-- Persistent webhook idempotency table.
-- Redis TTL-based idempotency expires after 24h; this table is the permanent
-- source of truth to prevent duplicate processing on webhook replays.

CREATE TABLE IF NOT EXISTS webhook_events (
  id            BIGSERIAL PRIMARY KEY,
  source        TEXT NOT NULL,          -- 'twilio_sms' | 'twilio_voice' | 'twilio_voice_status' | 'stripe'
  event_sid     TEXT NOT NULL,          -- MessageSid / CallSid / Stripe event.id
  tenant_id     UUID,                   -- nullable (may not be known at dedup time)
  processed     BOOLEAN NOT NULL DEFAULT TRUE,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source, event_sid)
);

-- Index for fast lookups during webhook handling
CREATE INDEX IF NOT EXISTS idx_webhook_events_source_sid
  ON webhook_events (source, event_sid);

-- Index for monitoring/cleanup queries
CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at
  ON webhook_events (received_at);
