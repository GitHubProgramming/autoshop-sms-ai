-- 050_add_is_pilot_tenant.sql
-- Step 1 of LT Proteros pilot isolation plan.
-- Additive boolean column to mark free pilot tenants (currently only LT Proteros Servisas)
-- so subsequent steps can guard US-specific logic (Stripe area code extraction,
-- Texas number provisioning, A2P 10DLC checks) without breaking the pilot.
-- Schema-only — no code reads this column yet.

ALTER TABLE tenants
  ADD COLUMN is_pilot_tenant BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN tenants.is_pilot_tenant IS 'TRUE = free pilot tenant (e.g. LT Proteros Servisas) that must bypass US-specific logic like Stripe area code extraction, Texas number provisioning, A2P 10DLC checks. Added as additive guard mechanism; will be replaced by proper region logic if multi-region launch is planned. See memory/docs for LT/US strategy.';

UPDATE tenants
   SET is_pilot_tenant = TRUE
 WHERE timezone = 'Europe/Vilnius'
   AND owner_phone LIKE '+370%';

-- Verify: SELECT id, shop_name, is_pilot_tenant FROM tenants WHERE is_pilot_tenant = TRUE; should return exactly 1 row (Proteros Servisas).
