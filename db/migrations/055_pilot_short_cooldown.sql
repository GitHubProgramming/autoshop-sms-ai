-- Migration 055: 5-minute cooldown for pilot tenants, 1h for everyone else
--
-- The close_conversation() PL/pgSQL function (migration 045) hardcodes
-- a 1-hour cooldown after every conversation close. That window is
-- correct for production US tenants (anti-abuse against rapid thread
-- cycling to bypass conversation limits) but blocks live debugging on
-- the LT pilot — every test call requires either waiting ~1 hour or
-- calling the admin/cooldowns/clear endpoint.
--
-- This migration redefines close_conversation() to look up
-- is_pilot_tenant on the tenant row and use a 5-minute cooldown for
-- pilot tenants; non-pilot (US) behavior is unchanged at 1 hour.
--
-- Function signature is unchanged — no callers need to update.

BEGIN;

CREATE OR REPLACE FUNCTION close_conversation(
  p_conversation_id UUID,
  p_tenant_id       UUID,
  p_status          TEXT,
  p_close_reason    TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_rows_updated      INT;
  v_is_pilot          BOOLEAN;
  v_cooldown_interval INTERVAL;
BEGIN
  -- Step 1: close the conversation (only if not already closed)
  UPDATE conversations
  SET
    counted      = TRUE,
    status       = p_status,
    close_reason = p_close_reason,
    closed_at    = NOW()
  WHERE id        = p_conversation_id
    AND tenant_id = p_tenant_id
    AND status    = 'open';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RETURN FALSE;
  END IF;

  -- Step 2: pick cooldown duration based on tenant type
  SELECT COALESCE(is_pilot_tenant, FALSE) INTO v_is_pilot
  FROM tenants
  WHERE id = p_tenant_id;

  v_cooldown_interval := CASE
    WHEN v_is_pilot THEN INTERVAL '5 minutes'
    ELSE INTERVAL '1 hour'
  END;

  -- Step 3: set cooldown to prevent rapid thread re-creation
  INSERT INTO conversation_cooldowns (tenant_id, customer_phone, cooldown_until)
  SELECT p_tenant_id, c.customer_phone, NOW() + v_cooldown_interval
  FROM conversations c
  WHERE c.id = p_conversation_id
  ON CONFLICT (tenant_id, customer_phone)
  DO UPDATE SET cooldown_until = EXCLUDED.cooldown_until;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMIT;
