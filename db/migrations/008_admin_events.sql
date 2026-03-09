-- 008_admin_events.sql
-- Audit log for internal admin events and system lifecycle events.

BEGIN;

CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE SET NULL,
  event_type  TEXT NOT NULL,
  actor       TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_tenant_id_idx  ON audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_event_type_idx ON audit_log(event_type);

COMMIT;
