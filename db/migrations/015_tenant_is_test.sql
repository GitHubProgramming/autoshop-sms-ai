-- Migration 015: Add is_test flag to tenants
--
-- Allows admin dashboards to exclude test/demo/audit tenants from
-- production metrics while keeping them in the database for reference.

BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN tenants.is_test IS 'When TRUE, tenant is excluded from admin dashboard counts and lists. Used for test, demo, and audit accounts.';

CREATE INDEX IF NOT EXISTS idx_tenants_is_test ON tenants (is_test) WHERE is_test = FALSE;

-- Mark known test/demo/audit tenants
UPDATE tenants SET is_test = TRUE
WHERE owner_email ILIKE '%@example.com'
   OR owner_email ILIKE '%@autoshop.local'
   OR shop_name ILIKE '%test%shop%'
   OR shop_name ILIKE '%audit%test%'
   OR shop_name ILIKE '%demo%'
   OR (shop_name = 'Admin' AND owner_email NOT IN (
       -- Preserve real admin accounts: add real admin emails here if needed
       SELECT unnest(ARRAY[]::text[])
   ));

COMMIT;
