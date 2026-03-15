-- One-time admin password reset for mantas.gipiskis@gmail.com
-- Sets password to the value provided by the project owner.
-- Idempotent: only updates if tenant exists; creates if not.

DO $$
BEGIN
  -- Try to update existing tenant's password
  IF EXISTS (SELECT 1 FROM tenants WHERE owner_email = 'mantas.gipiskis@gmail.com') THEN
    UPDATE tenants
    SET password_hash = '$2b$12$Yg24uuzAaf08nx3mnSWaWeyqD7OJ.7S9/GhqeT93ovOx/mAgW3TB6'
    WHERE owner_email = 'mantas.gipiskis@gmail.com';
    RAISE NOTICE 'Admin password updated for mantas.gipiskis@gmail.com';
  ELSE
    -- Create admin tenant if it doesn't exist
    INSERT INTO tenants (shop_name, owner_name, owner_email, password_hash, billing_status,
                         trial_started_at, trial_ends_at, trial_conv_limit,
                         conv_limit_this_cycle, conv_used_this_cycle)
    VALUES ('Admin', 'Admin', 'mantas.gipiskis@gmail.com',
            '$2b$12$Yg24uuzAaf08nx3mnSWaWeyqD7OJ.7S9/GhqeT93ovOx/mAgW3TB6',
            'trial', NOW(), NOW() + INTERVAL '365 days', 9999, 9999, 0);
    RAISE NOTICE 'Admin tenant created for mantas.gipiskis@gmail.com';
  END IF;
END $$;
