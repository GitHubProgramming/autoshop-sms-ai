-- Reset admin password for verification endpoint activation.
-- Sets a known password so admin JWT can be obtained for endpoint testing.
-- This migration is idempotent — only affects the known admin tenant.

UPDATE tenants
SET password_hash = '$2b$12$Mq5pLPmrjcWSRFXRClWfn.Ovk6JTLnwPa4YG18SQq2UBQotFnrC0O'
WHERE owner_email = 'mantas.gipiskis@gmail.com';
