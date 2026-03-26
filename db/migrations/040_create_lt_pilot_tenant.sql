-- Migration 040: Create LT pilot tenant — Proteros Servisas
--
-- Strictly isolated Lithuania test tenant for pilot testing.
-- Does NOT touch Texas tenant, Texas phone mapping, or any shared config.
--
-- Tenant: Proteros Servisas
-- Email:  mantas.gipiskis@gmail.com (freed by migration 039)
-- Phone:  +37045512300 (Zadarma virtual number, not Twilio)
-- Market: LT (Lithuania)
--
-- billing_status = 'trial' so conversations are not blocked by getBlockReason()
-- workspace_mode = 'live_empty' so dashboard shows real data (not demo mode)
-- is_test = FALSE so tenant can see own dashboard data without filtering issues

DO $$
DECLARE
  v_tid UUID;
BEGIN
  -- Only create if not exists
  IF EXISTS (SELECT 1 FROM tenants WHERE owner_email = 'mantas.gipiskis@gmail.com') THEN
    RAISE NOTICE 'LT tenant mantas.gipiskis@gmail.com already exists — skipping';
    RETURN;
  END IF;

  INSERT INTO tenants (
    id,
    shop_name,
    owner_name,
    owner_email,
    owner_phone,
    timezone,
    billing_status,
    workspace_mode,
    provisioning_state,
    is_test,
    trial_started_at,
    trial_ends_at,
    trial_conv_limit,
    conv_limit_this_cycle,
    conv_used_this_cycle
  ) VALUES (
    gen_random_uuid(),
    'Proteros Servisas',
    'Mantas',
    'mantas.gipiskis@gmail.com',
    '+37067577829',
    'Europe/Vilnius',
    'trial',
    'live_empty',
    'ready',
    FALSE,
    NOW(),
    NOW() + INTERVAL '90 days',
    500,
    500,
    0
  )
  RETURNING id INTO v_tid;

  -- Register LT virtual number (Zadarma, not Twilio — SID is a placeholder)
  INSERT INTO tenant_phone_numbers (
    tenant_id, twilio_sid, phone_number, status, forward_to
  ) VALUES (
    v_tid,
    'LT-ZADARMA-37045512300',
    '+37045512300',
    'active',
    '+37067577829'
  )
  ON CONFLICT (phone_number) DO NOTHING;

  -- Create user record for auth
  INSERT INTO users (tenant_id, email, auth_provider)
  VALUES (v_tid, 'mantas.gipiskis@gmail.com', 'email')
  ON CONFLICT (email, auth_provider) DO NOTHING;

  -- Set password hash (same bootstrap flow as Texas tenant — owner can reset via admin-bootstrap)
  -- Leave password_hash NULL; owner uses POST /auth/admin-bootstrap with INTERNAL_API_KEY to set password

  RAISE NOTICE 'LT pilot tenant created: Proteros Servisas (id=%, phone=+37045512300)', v_tid;
END $$;
