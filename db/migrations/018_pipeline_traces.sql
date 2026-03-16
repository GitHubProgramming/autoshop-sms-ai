-- Pipeline execution traces for pilot live-test visibility.
-- Each trace records the step-by-step execution of a missed-call or inbound-SMS pipeline run.
-- Steps are stored as a JSONB array for simplicity (no second table needed).

CREATE TABLE IF NOT EXISTS pipeline_traces (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID,
  trigger_type  TEXT NOT NULL,           -- 'missed_call' | 'inbound_sms'
  trigger_id    TEXT,                    -- CallSid or MessageSid
  customer_phone TEXT,
  status        TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'completed' | 'failed'
  steps         JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  error_summary TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for admin queries: recent traces per tenant
CREATE INDEX IF NOT EXISTS idx_pipeline_traces_tenant_started
  ON pipeline_traces (tenant_id, started_at DESC);

-- Index for lookup by trigger_id (CallSid / MessageSid)
CREATE INDEX IF NOT EXISTS idx_pipeline_traces_trigger
  ON pipeline_traces (trigger_id);
