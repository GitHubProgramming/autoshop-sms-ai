-- 020_appointments_kpi_columns.sql
-- Stabilization: add final_price and completed_at to appointments table
-- so KPI endpoints can read from the actual live write path.
--
-- Context: bookings table (019) is never populated by the live SMS→AI flow.
-- The appointments table IS the source of truth. This migration adds the
-- minimal columns needed for revenue tracking and completion marking.

BEGIN;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS final_price NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Index for KPI revenue queries
CREATE INDEX IF NOT EXISTS idx_appointments_completed
  ON appointments(tenant_id, completed_at)
  WHERE completed_at IS NOT NULL;

COMMIT;
