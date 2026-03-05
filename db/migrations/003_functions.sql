-- 003_functions.sql
-- Atomic DB functions for conversation lifecycle management

BEGIN;

-- ── close_conversation ────────────────────────────────────────────────────────
-- Atomically closes a conversation AND increments tenant usage counter.
-- The counted=FALSE guard prevents double-counting on retry.
-- Returns TRUE if the conversation was closed (and counted), FALSE if already closed.

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

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;


-- ── get_or_create_conversation ────────────────────────────────────────────────
-- Returns existing open conversation for (tenant, customer_phone),
-- or creates a new one. Enforces cooldown check.
-- Returns conversation_id and whether it was newly created.

CREATE OR REPLACE FUNCTION get_or_create_conversation(
  p_tenant_id      UUID,
  p_customer_phone TEXT
) RETURNS TABLE(conversation_id UUID, is_new BOOLEAN) AS $$
DECLARE
  v_conv_id   UUID;
  v_cooldown  TIMESTAMPTZ;
BEGIN
  -- Check for existing open conversation
  SELECT id INTO v_conv_id
  FROM conversations
  WHERE tenant_id     = p_tenant_id
    AND customer_phone = p_customer_phone
    AND status        = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    RETURN QUERY SELECT v_conv_id, FALSE;
    RETURN;
  END IF;

  -- Check cooldown (anti-abuse: 1h after close before new thread)
  SELECT cooldown_until INTO v_cooldown
  FROM conversation_cooldowns
  WHERE tenant_id    = p_tenant_id
    AND customer_phone = p_customer_phone;

  IF v_cooldown IS NOT NULL AND v_cooldown > NOW() THEN
    -- Still in cooldown — return NULL to signal blocked
    RETURN QUERY SELECT NULL::UUID, FALSE;
    RETURN;
  END IF;

  -- Create new conversation
  INSERT INTO conversations (tenant_id, customer_phone)
  VALUES (p_tenant_id, p_customer_phone)
  RETURNING id INTO v_conv_id;

  RETURN QUERY SELECT v_conv_id, TRUE;
END;
$$ LANGUAGE plpgsql;


-- ── check_usage_warnings ─────────────────────────────────────────────────────
-- After counting a conversation, check if 80%/100% warnings should fire.
-- Returns ('none' | 'warn_80' | 'warn_100').

CREATE OR REPLACE FUNCTION check_usage_warnings(
  p_tenant_id UUID
) RETURNS TEXT AS $$
DECLARE
  v_tenant tenants%ROWTYPE;
  v_pct    NUMERIC;
BEGIN
  SELECT * INTO v_tenant FROM tenants WHERE id = p_tenant_id;

  IF v_tenant.conv_limit_this_cycle = 0 THEN
    RETURN 'none';
  END IF;

  v_pct := (v_tenant.conv_used_this_cycle::NUMERIC / v_tenant.conv_limit_this_cycle) * 100;

  IF v_pct >= 100 AND NOT v_tenant.warned_100pct THEN
    UPDATE tenants SET warned_100pct = TRUE, updated_at = NOW() WHERE id = p_tenant_id;
    RETURN 'warn_100';
  ELSIF v_pct >= 80 AND NOT v_tenant.warned_80pct THEN
    UPDATE tenants SET warned_80pct = TRUE, updated_at = NOW() WHERE id = p_tenant_id;
    RETURN 'warn_80';
  END IF;

  RETURN 'none';
END;
$$ LANGUAGE plpgsql;


-- ── update_conversation_last_active ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_conversation(
  p_conversation_id UUID,
  p_tenant_id       UUID
) RETURNS VOID AS $$
BEGIN
  UPDATE conversations
  SET last_message_at = NOW(),
      turn_count      = turn_count + 1
  WHERE id        = p_conversation_id
    AND tenant_id = p_tenant_id
    AND status    = 'open';
END;
$$ LANGUAGE plpgsql;

COMMIT;
