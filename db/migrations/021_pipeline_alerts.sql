-- Pipeline alerts: proactive notifications when the core flow fails.
-- Created from failed pipeline traces. Operators must acknowledge to clear.

CREATE TABLE IF NOT EXISTS pipeline_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID,
  trace_id        UUID REFERENCES pipeline_traces(id),
  severity        TEXT NOT NULL DEFAULT 'critical',  -- 'critical' | 'warning'
  alert_type      TEXT NOT NULL,                     -- 'sms_send_failed' | 'ai_error' | 'booking_failed' | 'calendar_sync_failed' | 'worker_exhausted' | 'pipeline_failed'
  summary         TEXT NOT NULL,
  details         TEXT,
  owner_notified  BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged    BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT,                              -- admin email
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin queries: unacknowledged alerts, most recent first
CREATE INDEX IF NOT EXISTS idx_pipeline_alerts_unacked
  ON pipeline_alerts (acknowledged, created_at DESC);

-- Per-tenant alert lookup
CREATE INDEX IF NOT EXISTS idx_pipeline_alerts_tenant
  ON pipeline_alerts (tenant_id, created_at DESC);
