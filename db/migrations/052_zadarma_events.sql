-- Audit log for Zadarma webhook events received by the backend proxy.
-- Used for debugging missed-call flow and verifying n8n forwarding.

CREATE TABLE IF NOT EXISTS zadarma_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at   timestamptz NOT NULL DEFAULT now(),
  event_type    text,
  caller_id     text,
  called_did    text,
  call_status   text,
  raw_payload   jsonb NOT NULL DEFAULT '{}',
  forwarded_to_n8n  boolean NOT NULL DEFAULT false,
  n8n_response_status integer
);

CREATE INDEX idx_zadarma_events_received_at ON zadarma_events (received_at DESC);
