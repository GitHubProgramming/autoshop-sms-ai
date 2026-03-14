-- 010: Add extended columns to tenant_calendar_tokens
-- Required by the OAuth callback to store google account email and integration status

ALTER TABLE tenant_calendar_tokens
  ADD COLUMN IF NOT EXISTS google_account_email TEXT,
  ADD COLUMN IF NOT EXISTS integration_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
