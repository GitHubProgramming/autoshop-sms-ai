-- 010_calendar_integration_status.sql
-- Enhance per-tenant calendar integration with status tracking and error surfacing.
-- Adds explicit integration_status, last_error, google_account_email to tenant_calendar_tokens.
-- Adds sync_status, sync_error, sync_attempted_at to appointments.

BEGIN;

-- ── tenant_calendar_tokens enhancements ─────────────────────────────────────

ALTER TABLE tenant_calendar_tokens
  ADD COLUMN IF NOT EXISTS google_account_email TEXT,
  ADD COLUMN IF NOT EXISTS integration_status TEXT NOT NULL DEFAULT 'active'
    CHECK (integration_status IN ('active', 'refresh_failed', 'revoked', 'disconnected')),
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── appointments sync tracking enhancements ─────────────────────────────────

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (sync_status IN ('pending', 'synced', 'failed')),
  ADD COLUMN IF NOT EXISTS sync_error TEXT,
  ADD COLUMN IF NOT EXISTS sync_attempted_at TIMESTAMPTZ;

-- ── Backfill existing data ──────────────────────────────────────────────────

-- Appointments already synced → mark as 'synced'
UPDATE appointments SET sync_status = 'synced'
WHERE calendar_synced = TRUE AND sync_status = 'pending';

-- Old unsynced appointments (>1hr) → mark as 'failed'
UPDATE appointments SET sync_status = 'failed'
WHERE calendar_synced = FALSE
  AND google_event_id IS NULL
  AND created_at < NOW() - INTERVAL '1 hour'
  AND sync_status = 'pending';

-- ── Index for sync failure queries ──────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_appointments_sync_status
  ON appointments (tenant_id, sync_status)
  WHERE sync_status = 'failed';

CREATE INDEX IF NOT EXISTS idx_calendar_integration_status
  ON tenant_calendar_tokens (tenant_id, integration_status)
  WHERE integration_status != 'active';

COMMIT;
