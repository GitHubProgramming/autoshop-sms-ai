-- ============================================================
-- Migration 003: Stored Procedures
-- Atomic conversation open + usage increment
-- ============================================================

-- Returns: 'opened' | 'blocked_trial' | 'blocked_plan' | 'blocked_state' | 'duplicate_open'
CREATE OR REPLACE FUNCTION open_conversation(
  p_tenant_id       UUID,
  p_customer_phone  TEXT,
  p_twilio_number   TEXT,
  p_trigger_type    TEXT
) RETURNS JSONB AS $$
DECLARE
  v_tenant          RECORD;
  v_usage           RECORD;
  v_period_start    TIMESTAMPTZ;
  v_period_end      TIMESTAMPTZ;
  v_conv_id         UUID;
  v_existing_open   UUID;
  v_count           INT;
  v_pct             NUMERIC;
BEGIN
  -- Lock tenant row
  SELECT billing_state, trial_ends_at, monthly_limit, max_ai_turns,
         plan_id, billing_cycle_start
  INTO v_tenant
  FROM tenants WHERE id = p_tenant_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('result','blocked_state','reason','tenant_not_found');
  END IF;

  -- Check billing state hard blocks
  IF v_tenant.billing_state IN ('trial_expired','suspended','canceled') THEN
    RETURN jsonb_build_object(
      'result', 'blocked_state',
      'reason', v_tenant.billing_state
    );
  END IF;

  -- Trial dual-condition check
  IF v_tenant.billing_state = 'trial' THEN
    IF NOW() >= v_tenant.trial_ends_at THEN
      UPDATE tenants SET billing_state = 'trial_expired', updated_at = NOW()
      WHERE id = p_tenant_id;
      RETURN jsonb_build_object('result','blocked_trial','reason','trial_time_expired');
    END IF;
    -- Count total trial conversations
    SELECT COALESCE(SUM(conversations_count),0) INTO v_count
    FROM usage_records WHERE tenant_id = p_tenant_id;
    IF v_count >= 50 THEN
      UPDATE tenants SET billing_state = 'trial_expired', updated_at = NOW()
      WHERE id = p_tenant_id;
      RETURN jsonb_build_object('result','blocked_trial','reason','trial_conv_limit');
    END IF;
  END IF;

  -- Check for existing open conversation with this phone
  SELECT id INTO v_existing_open
  FROM conversations
  WHERE tenant_id = p_tenant_id
    AND customer_phone = p_customer_phone
    AND status = 'open'
  LIMIT 1;

  IF FOUND THEN
    -- Return existing open conversation — do not double-count
    RETURN jsonb_build_object(
      'result', 'duplicate_open',
      'conversation_id', v_existing_open
    );
  END IF;

  -- Determine billing period
  IF v_tenant.billing_cycle_start IS NOT NULL THEN
    v_period_start := date_trunc('month', v_tenant.billing_cycle_start)
      + (extract(month from age(NOW(), v_tenant.billing_cycle_start)) || ' months')::interval;
    v_period_start := v_tenant.billing_cycle_start
      + (floor(extract(epoch from NOW() - v_tenant.billing_cycle_start) / (30.44 * 86400)) || ' months')::interval;
  ELSE
    v_period_start := date_trunc('month', NOW());
  END IF;
  v_period_end := v_period_start + INTERVAL '1 month';

  -- Upsert usage record for this period
  INSERT INTO usage_records (tenant_id, period_start, period_end)
  VALUES (p_tenant_id, v_period_start, v_period_end)
  ON CONFLICT (tenant_id, period_start) DO NOTHING;

  -- Lock usage record
  SELECT * INTO v_usage
  FROM usage_records
  WHERE tenant_id = p_tenant_id AND period_start = v_period_start
  FOR UPDATE;

  -- Paid plan monthly limit check (soft: never hard-block, only warn)
  -- Only hard check if past monthly_limit AND we decide to block (not required by blueprint)
  -- Blueprint: paid users are NEVER blocked by plan limit; only show warnings.
  -- We still track for warning purposes.

  -- Increment usage count
  UPDATE usage_records
  SET conversations_count = conversations_count + 1,
      updated_at = NOW()
  WHERE tenant_id = p_tenant_id AND period_start = v_period_start;

  -- Check warning thresholds after increment
  v_count := v_usage.conversations_count + 1;
  v_pct := CASE WHEN v_tenant.monthly_limit > 0
    THEN (v_count::NUMERIC / v_tenant.monthly_limit) * 100
    ELSE 0 END;

  -- Open the conversation
  INSERT INTO conversations (
    tenant_id, customer_phone, twilio_number, status,
    trigger_type, max_turns
  ) VALUES (
    p_tenant_id, p_customer_phone, p_twilio_number, 'open',
    p_trigger_type, v_tenant.max_ai_turns
  ) RETURNING id INTO v_conv_id;

  RETURN jsonb_build_object(
    'result', 'opened',
    'conversation_id', v_conv_id,
    'usage_count', v_count,
    'usage_limit', v_tenant.monthly_limit,
    'usage_pct', v_pct,
    'warn_80', (v_pct >= 80 AND NOT v_usage.warning_80_sent),
    'warn_100', (v_pct >= 100 AND NOT v_usage.warning_100_sent),
    'period_start', v_period_start
  );
END;
$$ LANGUAGE plpgsql;

-- Mark warnings as sent
CREATE OR REPLACE FUNCTION mark_warning_sent(
  p_tenant_id UUID,
  p_period_start TIMESTAMPTZ,
  p_level TEXT  -- '80' or '100'
) RETURNS VOID AS $$
BEGIN
  IF p_level = '80' THEN
    UPDATE usage_records SET warning_80_sent = TRUE
    WHERE tenant_id = p_tenant_id AND period_start = p_period_start;
  ELSIF p_level = '100' THEN
    UPDATE usage_records SET warning_100_sent = TRUE
    WHERE tenant_id = p_tenant_id AND period_start = p_period_start;
  END IF;
END;
$$ LANGUAGE plpgsql;
