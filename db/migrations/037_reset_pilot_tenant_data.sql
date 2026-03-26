BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- Migration 037: Reset pilot tenant data for clean-slate dashboard
--
-- Deletes ALL historical conversation, message, appointment, customer,
-- pipeline, and operational data for the pilot tenant (mantas.gipiskis@gmail.com).
--
-- PRESERVES: tenant record, users, billing, phone mapping, calendar tokens,
--            system prompts, tenant services, AI settings, onboarding config.
--
-- This is a one-time data reset — idempotent (safe to re-run).
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_tid UUID;
  v_shop TEXT;
BEGIN
  -- Identify target tenant
  SELECT id, shop_name INTO v_tid, v_shop
  FROM tenants
  WHERE owner_email = 'mantas.gipiskis@gmail.com'
  LIMIT 1;

  IF v_tid IS NULL THEN
    RAISE NOTICE 'Tenant mantas.gipiskis@gmail.com not found — skipping reset';
    RETURN;
  END IF;

  RAISE NOTICE 'Resetting data for tenant % (%) ...', v_tid, v_shop;

  -- Delete in FK-safe dependency order (leaves → roots)

  -- 1. Pipeline alerts (FK → pipeline_traces)
  DELETE FROM pipeline_alerts WHERE tenant_id = v_tid;

  -- 2. Pipeline traces
  DELETE FROM pipeline_traces WHERE tenant_id = v_tid;

  -- 3. Webhook events
  DELETE FROM webhook_events WHERE tenant_id = v_tid;

  -- 4. Conversation cooldowns
  DELETE FROM conversation_cooldowns WHERE tenant_id = v_tid;

  -- 5. Missed calls (FK → conversations)
  DELETE FROM missed_calls WHERE tenant_id = v_tid;

  -- 6. Messages (FK → conversations)
  DELETE FROM messages WHERE tenant_id = v_tid;

  -- 7. Bookings (FK → customers, vehicles, conversations)
  DELETE FROM bookings WHERE tenant_id = v_tid;

  -- 8. Null out conversation→appointment FK before deleting appointments
  UPDATE conversations SET appointment_id = NULL WHERE tenant_id = v_tid;

  -- 9. Appointments
  DELETE FROM appointments WHERE tenant_id = v_tid;

  -- 10. Conversations
  DELETE FROM conversations WHERE tenant_id = v_tid;

  -- 11. Vehicles (FK → customers)
  DELETE FROM vehicles WHERE tenant_id = v_tid;

  -- 12. Customers
  DELETE FROM customers WHERE tenant_id = v_tid;

  -- Reset usage counters
  UPDATE tenants
  SET conv_used_this_cycle = 0,
      warned_80pct = FALSE,
      warned_100pct = FALSE
  WHERE id = v_tid;

  -- Audit log entry
  INSERT INTO audit_log (id, tenant_id, event_type, actor, metadata, created_at)
  VALUES (
    gen_random_uuid(),
    v_tid,
    'migration_tenant_data_reset',
    'migration_037',
    '{"reason": "clean-slate dashboard reset for pilot tenant"}'::jsonb,
    NOW()
  );

  RAISE NOTICE 'Tenant data reset complete for %', v_tid;
END;
$$;

COMMIT;
