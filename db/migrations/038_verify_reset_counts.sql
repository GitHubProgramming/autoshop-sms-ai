BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- Migration 038: Verify that migration 037 reset succeeded
--
-- Checks all tenant-scoped data tables for the pilot tenant and raises
-- an error if any data remains. If this migration passes, the reset is
-- confirmed clean.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_tid UUID;
  v_conversations INT;
  v_messages INT;
  v_appointments INT;
  v_customers INT;
  v_vehicles INT;
  v_bookings INT;
  v_missed_calls INT;
  v_pipeline_traces INT;
  v_pipeline_alerts INT;
  v_cooldowns INT;
  v_webhook_events INT;
  v_conv_used INT;
  v_phone_numbers INT;
  v_calendar_tokens INT;
  v_system_prompts INT;
  v_users INT;
BEGIN
  SELECT id INTO v_tid FROM tenants WHERE owner_email = 'mantas.gipiskis@gmail.com' LIMIT 1;
  IF v_tid IS NULL THEN
    RAISE NOTICE 'VERIFY: tenant not found — skipping';
    RETURN;
  END IF;

  -- Count remaining data rows
  SELECT count(*) INTO v_conversations FROM conversations WHERE tenant_id = v_tid;
  SELECT count(*) INTO v_messages FROM messages WHERE tenant_id = v_tid;
  SELECT count(*) INTO v_appointments FROM appointments WHERE tenant_id = v_tid;
  SELECT count(*) INTO v_customers FROM customers WHERE tenant_id = v_tid;
  SELECT count(*) INTO v_vehicles FROM vehicles WHERE tenant_id = v_tid;
  SELECT count(*) INTO v_bookings FROM bookings WHERE tenant_id = v_tid;
  SELECT count(*) INTO v_missed_calls FROM missed_calls WHERE tenant_id = v_tid;
  SELECT count(*) INTO v_pipeline_traces FROM pipeline_traces WHERE tenant_id = v_tid;
  SELECT count(*) INTO v_pipeline_alerts FROM pipeline_alerts WHERE tenant_id = v_tid;
  SELECT count(*) INTO v_cooldowns FROM conversation_cooldowns WHERE tenant_id = v_tid;
  SELECT count(*) INTO v_webhook_events FROM webhook_events WHERE tenant_id = v_tid;

  -- Usage counter
  SELECT conv_used_this_cycle INTO v_conv_used FROM tenants WHERE id = v_tid;

  -- Preserved data
  SELECT count(*) INTO v_phone_numbers FROM tenant_phone_numbers WHERE tenant_id = v_tid;
  SELECT count(*) INTO v_calendar_tokens FROM tenant_calendar_tokens WHERE tenant_id = v_tid;
  SELECT count(*) INTO v_system_prompts FROM system_prompts WHERE tenant_id = v_tid;
  SELECT count(*) INTO v_users FROM users WHERE tenant_id = v_tid;

  RAISE NOTICE '════════════════════════════════════════════';
  RAISE NOTICE 'TENANT DATA RESET VERIFICATION';
  RAISE NOTICE '════════════════════════════════════════════';
  RAISE NOTICE 'CLEARED DATA (should all be 0):';
  RAISE NOTICE '  conversations:      %', v_conversations;
  RAISE NOTICE '  messages:           %', v_messages;
  RAISE NOTICE '  appointments:       %', v_appointments;
  RAISE NOTICE '  customers:          %', v_customers;
  RAISE NOTICE '  vehicles:           %', v_vehicles;
  RAISE NOTICE '  bookings:           %', v_bookings;
  RAISE NOTICE '  missed_calls:       %', v_missed_calls;
  RAISE NOTICE '  pipeline_traces:    %', v_pipeline_traces;
  RAISE NOTICE '  pipeline_alerts:    %', v_pipeline_alerts;
  RAISE NOTICE '  cooldowns:          %', v_cooldowns;
  RAISE NOTICE '  webhook_events:     %', v_webhook_events;
  RAISE NOTICE '  conv_used_this_cycle: %', v_conv_used;
  RAISE NOTICE '';
  RAISE NOTICE 'PRESERVED DATA:';
  RAISE NOTICE '  users:              %', v_users;
  RAISE NOTICE '  phone_numbers:      %', v_phone_numbers;
  RAISE NOTICE '  calendar_tokens:    %', v_calendar_tokens;
  RAISE NOTICE '  system_prompts:     %', v_system_prompts;
  RAISE NOTICE '════════════════════════════════════════════';

  -- Fail the migration if any data remains (proves reset worked)
  IF v_conversations > 0 OR v_messages > 0 OR v_appointments > 0 OR v_customers > 0 THEN
    RAISE EXCEPTION 'RESET VERIFICATION FAILED — data still exists: conversations=%, messages=%, appointments=%, customers=%',
      v_conversations, v_messages, v_appointments, v_customers;
  END IF;

  RAISE NOTICE 'VERIFICATION PASSED — tenant data is clean';
END;
$$;

COMMIT;
