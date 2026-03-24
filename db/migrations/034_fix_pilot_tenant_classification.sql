-- Migration 034: Fix pilot tenant classification
--
-- The pilot tenant (mantas.gipiskis@gmail.com) was incorrectly classified
-- as is_test=TRUE because the test-detection regex matched the base email
-- in addition to plus-alias variants. This caused:
--   1. Pilot tenant hidden from admin dashboards
--   2. Pilot tenant appointments backfilled to is_test=TRUE (migration 033)
--   3. KPI and customer data zeroed out by test filters
--
-- This migration:
--   1. Sets the pilot tenant to is_test=FALSE
--   2. Resets appointments for the pilot tenant to is_test=FALSE
--      (genuinely test appointments are re-tagged by pattern matching)
--
-- RULE: tenant-facing endpoints must NEVER filter a tenant's own data
-- using is_test. The is_test flag is for admin/global cross-tenant
-- reporting only (excluding demo/QA accounts from aggregate metrics).

BEGIN;

-- Step 1: Reclassify the pilot tenant
UPDATE tenants
SET is_test = FALSE
WHERE owner_email = 'mantas.gipiskis@gmail.com'
  AND is_test = TRUE;

-- Step 2: Reset pilot tenant appointments to real (not test)
UPDATE appointments a
SET is_test = FALSE
FROM tenants t
WHERE a.tenant_id = t.id
  AND t.owner_email = 'mantas.gipiskis@gmail.com'
  AND a.is_test = TRUE;

-- Step 3: Re-tag genuinely test appointments by known test patterns
-- (these are E2E/synthetic records, regardless of tenant)
UPDATE appointments
SET is_test = TRUE
WHERE is_test = FALSE
  AND (
    customer_phone LIKE '+3706000000%'
    OR customer_name ILIKE '%e2e test%'
    OR customer_name ILIKE '%test customer%'
  );

COMMIT;
