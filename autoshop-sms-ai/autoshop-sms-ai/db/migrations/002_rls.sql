-- ============================================================
-- Migration 002: Row-Level Security
-- ============================================================
-- Strategy: Application sets app.current_tenant_id at transaction
-- start via SET LOCAL. RLS acts as a second layer of defence.
-- Service role (used by API) bypasses RLS via BYPASSRLS privilege.
-- Dashboard queries use the tenant-scoped role.

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE twilio_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_calendar_integrations ENABLE ROW LEVEL SECURITY;

-- Policy: tenants can only access their own rows
CREATE POLICY tenant_isolation_conversations ON conversations
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

CREATE POLICY tenant_isolation_messages ON messages
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

CREATE POLICY tenant_isolation_appointments ON appointments
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

CREATE POLICY tenant_isolation_usage ON usage_records
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

CREATE POLICY tenant_isolation_twilio ON twilio_numbers
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

CREATE POLICY tenant_isolation_gcal ON google_calendar_integrations
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

-- NOTE: The API service role has BYPASSRLS and enforces tenant_id
-- in every WHERE clause. RLS is a belt-and-suspenders guard only.
-- webhook_events and tenants tables do NOT use RLS — they are
-- accessed by the service role only, never by tenant-scoped queries.
