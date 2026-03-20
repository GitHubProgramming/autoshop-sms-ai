-- Rotate admin password to invalidate static hashes from migrations 011 and 025.
--
-- Migrations 011 and 025 set static bcrypt hashes in committed files, which is
-- a credential artifact in git history. This migration replaces the hash with a
-- random value that nobody knows the plaintext for.
--
-- After this migration runs, the admin must use the bootstrap endpoint to set
-- a new password:
--
--   POST /auth/admin-bootstrap
--   Header: x-internal-key: <ADMIN_BOOTSTRAP_KEY from Render Dashboard>
--   Body: {"email":"mantas.gipiskis@gmail.com","password":"<new-password>","force":true}
--
-- The operator must first set ADMIN_BOOTSTRAP_KEY in Render Dashboard if not
-- already configured.

UPDATE tenants
SET password_hash = '$2b$12$PyU8/.9z/csUpdP9vb9ZL.uSFFhuK4u7Ej2mTAkhM0DjNQle6fFVy'
WHERE owner_email = 'mantas.gipiskis@gmail.com';
