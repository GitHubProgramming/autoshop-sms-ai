-- 045: Race condition fix — atomic conversation counting at OPEN time
--
-- BREAKING CHANGE: Usage counting moves from close_conversation() to
-- get_or_create_conversation(). This prevents trial users from opening
-- unlimited conversations before any get counted.
--
-- Changes:
--   1. close_conversation(): REMOVE conv_used_this_cycle increment
--      (counting now happens at open time, not close time)
--   2. get_or_create_conversation(): ADD FOR UPDATE on tenant row,
--      ADD atomic usage increment when creating a new conversation,
--      ADD trial enforcement (block if limit reached or expired)
--
-- BACKFILL NOTE: Any currently open conversations with counted=FALSE
-- were opened before this migration. They will NOT be double-counted
-- because close_conversation() no longer increments. The counts may be
-- slightly under-reported for one billing cycle — acceptable tradeoff
-- vs. the race condition risk.

BEGIN;

-- ── close_conversation (v3) ──────────────────────────────────────────────────
-- Closes a conversation. NO LONGER increments tenant usage counter.
-- Usage counting now happens at open time (get_or_create_conversation).
-- Keeps: status update, counted flag, cooldown insert.

CREATE OR REPLACE FUNCTION close_conversation(
  p_conversation_id UUID,
  p_tenant_id       UUID,
  p_status          TEXT,
  p_close_reason    TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_rows_updated INT;
BEGIN
  -- Step 1: Close the conversation (only if not already closed)
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

  -- Step 2: Set cooldown (1h) to prevent rapid thread re-creation
  INSERT INTO conversation_cooldowns (tenant_id, customer_phone, cooldown_until)
  SELECT p_tenant_id, c.customer_phone, NOW() + INTERVAL '1 hour'
  FROM conversations c
  WHERE c.id = p_conversation_id
  ON CONFLICT (tenant_id, customer_phone)
  DO UPDATE SET cooldown_until = EXCLUDED.cooldown_until;

  -- NOTE: No conv_used_this_cycle increment here.
  -- Counting now happens at conversation OPEN time.

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;


-- ── get_or_create_conversation (v2) ──────────────────────────────────────────
-- Returns existing open conversation, or creates a new one with atomic counting.
-- Uses FOR UPDATE on tenant row to prevent race conditions on usage increment.
-- Returns: conversation_id, is_new, blocked (true if trial limit hit), block_reason

CREATE OR REPLACE FUNCTION get_or_create_conversation(
  p_tenant_id      UUID,
  p_customer_phone TEXT
) RETURNS TABLE(conversation_id UUID, is_new BOOLEAN) AS $$
DECLARE
  v_conv_id        UUID;
  v_cooldown       TIMESTAMPTZ;
  v_tenant         RECORD;
BEGIN
  -- Check for existing open conversation
  SELECT id INTO v_conv_id
  FROM conversations
  WHERE tenant_id      = p_tenant_id
    AND customer_phone = p_customer_phone
    AND status         = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    RETURN QUERY SELECT v_conv_id, FALSE;
    RETURN;
  END IF;

  -- Check cooldown
  SELECT cooldown_until INTO v_cooldown
  FROM conversation_cooldowns
  WHERE tenant_id      = p_tenant_id
    AND customer_phone = p_customer_phone;

  IF v_cooldown IS NOT NULL AND v_cooldown > NOW() THEN
    RETURN QUERY SELECT NULL::UUID, FALSE;
    RETURN;
  END IF;

  -- Lock tenant row to prevent concurrent count races
  SELECT id, billing_status, conv_used_this_cycle, conv_limit_this_cycle,
         trial_ends_at
  INTO v_tenant
  FROM tenants
  WHERE id = p_tenant_id
  FOR UPDATE;

  -- Trial enforcement (trial users blocked at limit or expiry)
  IF v_tenant.billing_status IN ('trial', 'trial_expired') THEN
    IF v_tenant.trial_ends_at IS NOT NULL AND NOW() > v_tenant.trial_ends_at THEN
      -- Trial expired — return NULL to signal block
      RETURN QUERY SELECT NULL::UUID, FALSE;
      RETURN;
    END IF;
    IF v_tenant.conv_used_this_cycle >= v_tenant.conv_limit_this_cycle THEN
      -- Trial limit reached — return NULL to signal block
      RETURN QUERY SELECT NULL::UUID, FALSE;
      RETURN;
    END IF;
  END IF;

  -- Blocked statuses: never allow new conversations
  IF v_tenant.billing_status IN ('canceled', 'paused', 'past_due_blocked', 'demo') THEN
    RETURN QUERY SELECT NULL::UUID, FALSE;
    RETURN;
  END IF;

  -- Increment usage counter atomically (same transaction, row is locked)
  -- Skip for demo tenants (handled above, but defense-in-depth)
  UPDATE tenants
  SET conv_used_this_cycle = conv_used_this_cycle + 1,
      updated_at           = NOW()
  WHERE id = p_tenant_id
    AND billing_status != 'demo';

  -- Create new conversation (counted = true since we just incremented)
  INSERT INTO conversations (tenant_id, customer_phone, counted)
  VALUES (p_tenant_id, p_customer_phone, TRUE)
  RETURNING id INTO v_conv_id;

  RETURN QUERY SELECT v_conv_id, TRUE;
END;
$$ LANGUAGE plpgsql;

COMMIT;
