-- 023_booking_fields.sql
-- Data model hardening: store critical booking fields as first-class columns.
--
-- Previously car_model, license_plate, and issue_description were only held
-- transiently in runtime memory during booking validation but never persisted.
-- This migration adds them as explicit nullable columns so existing rows
-- remain valid (backward compatible) while new bookings store full data.

BEGIN;

-- car_model: e.g. "2019 Honda Civic" — extracted from customer SMS
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS car_model TEXT;

-- license_plate: e.g. "ABC 1234" — extracted from customer SMS
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS license_plate TEXT;

-- issue_description: raw customer problem text (separate from classified service_type)
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS issue_description TEXT;

COMMIT;
