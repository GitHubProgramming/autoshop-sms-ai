-- 031_close_conversation_cooldown.sql
-- Fix: close_conversation must populate conversation_cooldowns table.
-- Without this, the anti-abuse cooldown in get_or_create_conversation is dead code —
-- it reads conversation_cooldowns but nothing ever wrote to it.
-- Production incident: duplicate missed-call SMS from rapid redials.

BEGIN;

CREATE OR REPLACE FUNCTION close_conversation(
  p_conversation_id UUID,
  p_tenant_id       UUID,
  p_status          TEXT,   -- 'booked' | 'closed' | 'expired'
  p_close_reason    TEXT    -- 'booking_completed' | 'user_closed' | 'inactivity_24h' | ...
) RETURNS BOOLEAN AS $$
DECLARE
  v_rows_updated INT;
BEGIN
  -- Step 1: Close the conversation (only if not already counted)
  UPDATE conversations
  SET
    counted      = TRUE,
    status       = p_status,
    close_reason = p_close_reason,
    closed_at    = NOW()
  WHERE id        = p_conversation_id
    AND tenant_id = p_tenant_id
    AND counted   = FALSE;  -- idempotency guard

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RETURN FALSE; -- Already closed or doesn't belong to tenant
  END IF;

  -- Step 2: Increment tenant usage counter (same transaction)
  UPDATE tenants
  SET conv_used_this_cycle = conv_used_this_cycle + 1,
      updated_at           = NOW()
  WHERE id = p_tenant_id;

  -- Step 3: Set cooldown (1h) to prevent rapid thread re-creation
  INSERT INTO conversation_cooldowns (tenant_id, customer_phone, cooldown_until)
  SELECT p_tenant_id, c.customer_phone, NOW() + INTERVAL '1 hour'
  FROM conversations c
  WHERE c.id = p_conversation_id
  ON CONFLICT (tenant_id, customer_phone)
  DO UPDATE SET cooldown_until = EXCLUDED.cooldown_until;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMIT;
