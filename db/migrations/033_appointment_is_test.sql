-- Migration 033: Add is_test flag to appointments table
--
-- Provides a real discriminator for test/E2E records instead of
-- relying on fragile phone-number or customer-name heuristics.
-- Backfills from known test patterns present in the current dataset.

BEGIN;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN appointments.is_test IS 'When TRUE, appointment is a test/E2E record. Excluded from production KPIs and visually flagged in UI.';

CREATE INDEX IF NOT EXISTS idx_appointments_is_test
  ON appointments (tenant_id, is_test) WHERE is_test = FALSE;

-- Backfill: mark appointments belonging to known test tenants
UPDATE appointments a
SET is_test = TRUE
FROM tenants t
WHERE a.tenant_id = t.id
  AND t.is_test = TRUE;

-- Backfill: mark appointments with known test phone patterns
UPDATE appointments
SET is_test = TRUE
WHERE customer_phone LIKE '+3706000000%'
   OR customer_name ILIKE '%e2e test%'
   OR customer_name ILIKE '%test customer%';

COMMIT;
