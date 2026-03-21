-- backfill-analysis.sql
-- Run this BEFORE the backfill migration to understand what can be recovered.
-- Safe read-only queries. Run with: psql $DATABASE_URL -f scripts/backfill-analysis.sql

-- 1. Subscription amount backfill coverage
SELECT '=== SUBSCRIPTION AMOUNT BACKFILL ===' as section;
SELECT
  'Tenants with synced amount' as metric,
  COUNT(*) FILTER (WHERE subscription_amount_cents IS NOT NULL) as count
FROM tenants WHERE is_test = FALSE AND billing_status IN ('active', 'scheduled_cancel', 'past_due', 'paused');

SELECT
  'Tenants missing amount (backfillable from billing_events)' as metric,
  COUNT(DISTINCT t.id) as count
FROM tenants t
JOIN billing_events be ON be.tenant_id = t.id
  AND be.event_type IN ('customer.subscription.created', 'customer.subscription.updated')
  AND be.payload IS NOT NULL
  AND be.payload::jsonb -> 'items' -> 'data' -> 0 -> 'price' ->> 'unit_amount' IS NOT NULL
WHERE t.is_test = FALSE
  AND t.subscription_amount_cents IS NULL
  AND t.billing_status IN ('active', 'scheduled_cancel', 'past_due', 'paused');

SELECT
  'Tenants missing amount (NOT backfillable - no billing_events)' as metric,
  COUNT(*) as count
FROM tenants t
WHERE t.is_test = FALSE
  AND t.subscription_amount_cents IS NULL
  AND t.billing_status IN ('active', 'scheduled_cancel', 'past_due', 'paused')
  AND NOT EXISTS (
    SELECT 1 FROM billing_events be
    WHERE be.tenant_id = t.id
      AND be.event_type IN ('customer.subscription.created', 'customer.subscription.updated')
      AND be.payload IS NOT NULL
  );

-- 2. SMS segments backfill coverage
SELECT '=== SMS SEGMENTS BACKFILL ===' as section;
SELECT
  'Messages with real sms_segments' as metric,
  COUNT(*) FILTER (WHERE sms_segments IS NOT NULL AND sms_segments > 0) as count
FROM messages;

SELECT
  'Messages using default sms_segments (1)' as metric,
  COUNT(*) FILTER (WHERE sms_segments IS NULL OR sms_segments = 0) as count
FROM messages;

-- NOTE: Historical SMS segments CANNOT be backfilled.
-- Twilio does not store num_segments in the message logs accessible via API
-- in a way that's reliably batchable. The segment count is only available:
--   - In the REST API response when creating a message (outbound)
--   - In the webhook payload when receiving a message (inbound)
-- Both are point-in-time and not stored in our DB historically.
-- The default of 1 segment is used for all legacy messages.
SELECT 'Historical SMS segments are NOT backfillable from Twilio' as note;

-- 3. Token split backfill coverage
SELECT '=== TOKEN SPLIT BACKFILL ===' as section;
SELECT
  'Messages with prompt_tokens split' as metric,
  COUNT(*) FILTER (WHERE prompt_tokens IS NOT NULL) as count
FROM messages WHERE tokens_used IS NOT NULL;

SELECT
  'Messages with only total tokens_used (no split)' as metric,
  COUNT(*) FILTER (WHERE prompt_tokens IS NULL AND tokens_used IS NOT NULL) as count
FROM messages;

-- NOTE: Token splits CANNOT be backfilled.
-- The OpenAI API returns prompt_tokens and completion_tokens in the response,
-- but we only stored total_tokens historically. The individual counts were
-- not captured and cannot be derived from total alone.
SELECT 'Historical token splits are NOT backfillable' as note;

-- 4. Funnel integrity snapshot
SELECT '=== FUNNEL INTEGRITY ===' as section;
SELECT 'Orphan bookings (no conversation_id)' as metric,
  COUNT(*) as count FROM appointments WHERE conversation_id IS NULL;

SELECT 'Booked conversations with no appointment' as metric,
  COUNT(*) as count FROM conversations c
  WHERE c.status = 'booked'
    AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.conversation_id = c.id);

SELECT 'Conversations with multiple appointments' as metric,
  COUNT(*) as count FROM (
    SELECT conversation_id FROM appointments
    WHERE conversation_id IS NOT NULL
    GROUP BY conversation_id HAVING COUNT(*) > 1
  ) x;
