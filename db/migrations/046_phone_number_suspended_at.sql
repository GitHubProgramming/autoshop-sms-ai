-- 046: Add suspended_at timestamp to tenant_phone_numbers
-- Tracks when a number was suspended so the cleanup cron can release
-- numbers that have been suspended for 30+ days.

BEGIN;

ALTER TABLE tenant_phone_numbers
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;

-- Backfill: any number currently 'suspended' gets suspended_at = now().
-- Conservative: they will be eligible for release in 30 days from migration run.
UPDATE tenant_phone_numbers
SET suspended_at = NOW()
WHERE status = 'suspended' AND suspended_at IS NULL;

COMMIT;
