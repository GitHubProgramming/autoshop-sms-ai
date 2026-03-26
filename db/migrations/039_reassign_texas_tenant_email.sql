-- Migration 039: Reassign Texas pilot tenant email
--
-- The Texas pilot tenant currently uses mantas.gipiskis@gmail.com.
-- Reassign it to mantas@autoshopsmsai.com so the gmail address can be
-- used for the LT pilot tenant (Proteros Servisas).
--
-- This ONLY changes the email and owner_name on the existing Texas tenant.
-- No phone numbers, calendar tokens, conversations, or billing are touched.
-- The users table auth record is also updated to match.

DO $$
DECLARE
  v_tid UUID;
BEGIN
  -- Find the Texas pilot tenant
  SELECT id INTO v_tid
    FROM tenants
   WHERE owner_email = 'mantas.gipiskis@gmail.com'
   LIMIT 1;

  IF v_tid IS NULL THEN
    RAISE NOTICE 'Tenant with mantas.gipiskis@gmail.com not found — skipping';
    RETURN;
  END IF;

  -- Guard: make sure the target email is not already taken
  IF EXISTS (SELECT 1 FROM tenants WHERE owner_email = 'mantas@autoshopsmsai.com') THEN
    RAISE NOTICE 'mantas@autoshopsmsai.com already exists — skipping reassign';
    RETURN;
  END IF;

  -- Update tenant email
  UPDATE tenants
     SET owner_email = 'mantas@autoshopsmsai.com',
         updated_at  = NOW()
   WHERE id = v_tid;

  -- Update users table to match
  UPDATE users
     SET email = 'mantas@autoshopsmsai.com'
   WHERE tenant_id = v_tid
     AND email = 'mantas.gipiskis@gmail.com';

  RAISE NOTICE 'Texas tenant % email changed to mantas@autoshopsmsai.com', v_tid;
END $$;
