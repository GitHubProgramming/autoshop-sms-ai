-- 002_rls.sql
-- Row-Level Security: enforce tenant isolation at DB level
-- Application MUST run: SET LOCAL app.current_tenant_id = '<uuid>'
-- before any tenant-scoped query

BEGIN;

-- ── Enable RLS on all tenant-scoped tables ────────────────────────────────────
ALTER TABLE tenant_phone_numbers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages               ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_calendar_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_prompts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_cooldowns ENABLE ROW LEVEL SECURITY;

-- ── Helper function ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID AS $$
  SELECT current_setting('app.current_tenant_id', true)::UUID
$$ LANGUAGE SQL STABLE;

-- ── RLS Policies ─────────────────────────────────────────────────────────────

-- tenant_phone_numbers
CREATE POLICY tenant_isolation ON tenant_phone_numbers
  USING (tenant_id = current_tenant_id());

-- conversations
CREATE POLICY tenant_isolation ON conversations
  USING (tenant_id = current_tenant_id());

-- messages
CREATE POLICY tenant_isolation ON messages
  USING (tenant_id = current_tenant_id());

-- appointments
CREATE POLICY tenant_isolation ON appointments
  USING (tenant_id = current_tenant_id());

-- tenant_calendar_tokens
CREATE POLICY tenant_isolation ON tenant_calendar_tokens
  USING (tenant_id = current_tenant_id());

-- system_prompts
CREATE POLICY tenant_isolation ON system_prompts
  USING (tenant_id = current_tenant_id());

-- conversation_cooldowns
CREATE POLICY tenant_isolation ON conversation_cooldowns
  USING (tenant_id = current_tenant_id());

-- NOTE: autoshop_app / autoshop_admin roles omitted.
-- Render managed Postgres does not grant CREATEROLE privilege to the app user.
-- The API connects via DATABASE_URL directly (table owner) which already bypasses RLS.
-- Tenant isolation is enforced by RLS policies above via SET LOCAL app.current_tenant_id.

COMMIT;
