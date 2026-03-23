-- 032_demo_mode.sql
-- Demo mode lifecycle: demo → trial → active
--
-- New signup creates demo accounts (no trial timer, no provisioning).
-- Trial starts only after billing activation (card capture).
-- Adds workspace_mode and provisioning_state for explicit lifecycle tracking.

BEGIN;

-- ── 1. Add 'demo' to billing_status enum ────────────────────────────────────
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_billing_status_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_billing_status_check
  CHECK (billing_status IN (
    'demo','trial','trial_expired','active','scheduled_cancel',
    'past_due','past_due_blocked','canceled','paused'
  ));

-- ── 2. Add workspace_mode ───────────────────────────────────────────────────
-- demo       = sample data only, no live infrastructure
-- live_empty = trial/active but no activity yet (fresh after upgrade)
-- live_active = has real conversations/bookings
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS workspace_mode TEXT NOT NULL DEFAULT 'live_active'
  CHECK (workspace_mode IN ('demo', 'live_empty', 'live_active'));

-- ── 3. Add provisioning_state ───────────────────────────────────────────────
-- not_started    = no provisioning attempted (demo accounts)
-- pending_setup  = trial activated, awaiting onboarding
-- provisioning   = Twilio number purchase in progress
-- ready          = phone number active, system operational
-- error          = provisioning failed
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS provisioning_state TEXT NOT NULL DEFAULT 'ready'
  CHECK (provisioning_state IN ('not_started', 'pending_setup', 'provisioning', 'ready', 'error'));

-- ── 4. Make trial dates nullable for demo accounts ──────────────────────────
-- Existing tenants keep their values. New demo signups will have NULL.
ALTER TABLE tenants
  ALTER COLUMN trial_started_at DROP NOT NULL,
  ALTER COLUMN trial_ends_at DROP NOT NULL;

-- ── 5. Backfill existing tenants ────────────────────────────────────────────
-- Active/paid tenants: workspace=live_active, provisioning=ready
UPDATE tenants
SET workspace_mode = 'live_active',
    provisioning_state = 'ready'
WHERE billing_status IN ('active', 'scheduled_cancel', 'past_due', 'past_due_blocked');

-- Trial tenants with phone numbers: live_active, ready
UPDATE tenants t
SET workspace_mode = 'live_active',
    provisioning_state = 'ready'
WHERE t.billing_status IN ('trial', 'trial_expired')
  AND EXISTS (
    SELECT 1 FROM tenant_phone_numbers tpn
    WHERE tpn.tenant_id = t.id AND tpn.status = 'active'
  );

-- Trial tenants without phone numbers: live_empty, pending_setup
UPDATE tenants t
SET workspace_mode = 'live_empty',
    provisioning_state = 'pending_setup'
WHERE t.billing_status IN ('trial', 'trial_expired')
  AND NOT EXISTS (
    SELECT 1 FROM tenant_phone_numbers tpn
    WHERE tpn.tenant_id = t.id AND tpn.status = 'active'
  );

-- Canceled/paused tenants: keep live_active (they had active service), ready
UPDATE tenants
SET workspace_mode = 'live_active',
    provisioning_state = 'ready'
WHERE billing_status IN ('canceled', 'paused');

-- ── 6. Index for workspace_mode queries ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tenants_workspace_mode
  ON tenants(workspace_mode) WHERE workspace_mode = 'demo';

COMMIT;
