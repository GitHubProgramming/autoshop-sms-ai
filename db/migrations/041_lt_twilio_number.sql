-- Migration 041: Wire LT pilot tenant to purchased Twilio LT mobile number
--
-- Replaces the Zadarma virtual number (+37045512300) with the real Twilio
-- LT mobile number (+37066806130) for two-way SMS capability.
--
-- The old Zadarma row is suspended (not deleted) to preserve audit trail.
-- The new Twilio row enables the inbound webhook pipeline:
--   customer SMS → Twilio → POST /webhooks/twilio/sms → getTenantByPhoneNumber(To)
--   → matches +37066806130 → routes to LT pilot tenant → AI conversation
--
-- Idempotent: uses ON CONFLICT for insert, WHERE guards for update.

DO $$
DECLARE
  v_tid UUID;
BEGIN
  -- Resolve LT pilot tenant
  SELECT id INTO v_tid
    FROM tenants
   WHERE owner_email = 'mantas.gipiskis+lt@gmail.com'
   LIMIT 1;

  IF v_tid IS NULL THEN
    RAISE NOTICE 'LT pilot tenant not found — skipping';
    RETURN;
  END IF;

  -- Suspend old Zadarma number (preserve audit trail)
  UPDATE tenant_phone_numbers
     SET status = 'suspended',
         suspended_at = NOW()
   WHERE tenant_id = v_tid
     AND phone_number = '+37045512300'
     AND status = 'active';

  -- Insert new Twilio LT mobile number
  INSERT INTO tenant_phone_numbers (
    tenant_id, twilio_sid, phone_number, status, forward_to
  ) VALUES (
    v_tid,
    'PN4424f5163dd2e6ab0e17b5cc1f056863',
    '+37066806130',
    'active',
    '+37067577829'
  )
  ON CONFLICT (phone_number) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id,
        twilio_sid = EXCLUDED.twilio_sid,
        status = 'active',
        forward_to = EXCLUDED.forward_to;

  RAISE NOTICE 'LT pilot wired to Twilio number +37066806130 (tenant=%)', v_tid;
END $$;
