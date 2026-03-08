-- 007_auth_tables.sql
-- Add users table (auth identity → tenant mapping) and signup_attempts audit trail.
-- Safe to apply to existing DBs — all IF NOT EXISTS.

BEGIN;

-- users: one row per auth identity linked to a tenant.
-- Supports email/password and Google OAuth identities.
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  auth_provider TEXT NOT NULL DEFAULT 'email'
                CHECK (auth_provider IN ('email', 'google')),
  google_sub    TEXT,  -- Google OAuth subject ID (unique per Google account)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(email, auth_provider)
);

CREATE INDEX IF NOT EXISTS users_tenant_id_idx ON users(tenant_id);
CREATE INDEX IF NOT EXISTS users_google_sub_idx ON users(google_sub)
  WHERE google_sub IS NOT NULL;

-- signup_attempts: lightweight audit trail for signup visibility.
-- Records both successful and failed/abandoned signup attempts.
CREATE TABLE IF NOT EXISTS signup_attempts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT,
  provider       TEXT NOT NULL DEFAULT 'email'
                 CHECK (provider IN ('email', 'google')),
  status         TEXT NOT NULL DEFAULT 'started'
                 CHECK (status IN ('started', 'completed', 'failed', 'abandoned')),
  failure_reason TEXT,
  tenant_id      UUID REFERENCES tenants(id) ON DELETE SET NULL,
  ip_address     TEXT,
  user_agent     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS signup_attempts_email_idx ON signup_attempts(email);
CREATE INDEX IF NOT EXISTS signup_attempts_created_at_idx ON signup_attempts(created_at DESC);
CREATE INDEX IF NOT EXISTS signup_attempts_status_idx ON signup_attempts(status);

COMMIT;
