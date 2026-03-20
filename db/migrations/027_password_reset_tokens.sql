-- 027_password_reset_tokens.sql
-- Secure password reset token storage.
-- Tokens are hashed (SHA-256) — the plaintext is only sent to the user via email.

BEGIN;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_hash_idx
  ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS password_reset_tokens_tenant_idx
  ON password_reset_tokens(tenant_id);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_idx
  ON password_reset_tokens(expires_at);

COMMIT;
