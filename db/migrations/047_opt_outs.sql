-- 047_opt_outs.sql
-- TCPA opt-out enforcement: track customer SMS opt-outs per tenant.
-- Customers who reply STOP/UNSUBSCRIBE/QUIT/CANCEL/END are recorded here.
-- Checked before any outbound SMS to prevent TCPA violations.

BEGIN;

CREATE TABLE IF NOT EXISTS opt_outs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_phone   TEXT NOT NULL,
  opted_out_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opted_back_in_at TIMESTAMPTZ,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(tenant_id, customer_phone)
);

CREATE INDEX idx_opt_outs_lookup
  ON opt_outs(tenant_id, customer_phone)
  WHERE is_active = TRUE;

-- RLS
ALTER TABLE opt_outs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON opt_outs
  USING (tenant_id = current_tenant_id());

COMMIT;
