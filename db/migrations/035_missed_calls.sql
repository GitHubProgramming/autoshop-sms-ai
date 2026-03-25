-- Track missed calls for recovery funnel analytics.
-- Inserted from handleMissedCallSms when a missed call enters the SMS recovery pipeline.
-- conversation_id is set immediately when the conversation is created/found.
-- Booking linkage is derived via conversation_id → appointments.conversation_id.

CREATE TABLE IF NOT EXISTS missed_calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_phone  TEXT NOT NULL,
  call_sid        TEXT NOT NULL UNIQUE,
  call_status     TEXT NOT NULL,              -- 'no-answer' | 'busy' | 'failed'
  conversation_id UUID REFERENCES conversations(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for tenant-scoped analytics queries
CREATE INDEX IF NOT EXISTS idx_missed_calls_tenant_created
  ON missed_calls (tenant_id, created_at DESC);

-- Index for dedup lookup by call_sid
CREATE INDEX IF NOT EXISTS idx_missed_calls_call_sid
  ON missed_calls (call_sid);
