-- 030_backfill_stripe_amounts.sql
-- Backfill subscription_amount_cents from billing_events table.
--
-- For tenants that have active/scheduled_cancel subscriptions but no
-- subscription_amount_cents, we attempt to extract the amount from the
-- most recent Stripe subscription webhook payload stored in billing_events.
--
-- This is idempotent: only updates rows where subscription_amount_cents IS NULL.
-- It is safe to run multiple times.
--
-- LIMITATION: billing_events.payload is the raw Stripe event object.
-- The amount is at items.data[0].price.unit_amount in the subscription object.
-- If no billing_events exist for a tenant, this cannot backfill — those tenants
-- will continue using plan-price fallback until the next subscription webhook.

BEGIN;

-- Backfill from billing_events where payload contains subscription data
-- Only targets tenants with NULL subscription_amount_cents
UPDATE tenants t
SET
  subscription_amount_cents = (be.payload::jsonb -> 'items' -> 'data' -> 0 -> 'price' ->> 'unit_amount')::int,
  subscription_currency = COALESCE(be.payload::jsonb -> 'items' -> 'data' -> 0 -> 'price' ->> 'currency', 'usd'),
  subscription_interval = COALESCE(
    be.payload::jsonb -> 'items' -> 'data' -> 0 -> 'price' -> 'recurring' ->> 'interval',
    'month'
  ),
  updated_at = NOW()
FROM (
  SELECT DISTINCT ON (tenant_id)
    tenant_id,
    payload
  FROM billing_events
  WHERE event_type IN ('customer.subscription.created', 'customer.subscription.updated')
    AND tenant_id IS NOT NULL
    AND payload IS NOT NULL
  ORDER BY tenant_id, processed_at DESC
) be
WHERE t.id = be.tenant_id
  AND t.subscription_amount_cents IS NULL
  AND t.billing_status IN ('active', 'scheduled_cancel', 'past_due', 'paused')
  AND be.payload::jsonb -> 'items' -> 'data' -> 0 -> 'price' ->> 'unit_amount' IS NOT NULL;

-- Log how many were updated (visible in migration output)
DO $$
DECLARE
  backfilled INT;
  still_missing INT;
BEGIN
  SELECT COUNT(*) INTO backfilled
  FROM tenants
  WHERE subscription_amount_cents IS NOT NULL
    AND billing_status IN ('active', 'scheduled_cancel', 'past_due', 'paused')
    AND is_test = FALSE;

  SELECT COUNT(*) INTO still_missing
  FROM tenants
  WHERE subscription_amount_cents IS NULL
    AND billing_status IN ('active', 'scheduled_cancel', 'past_due', 'paused')
    AND is_test = FALSE;

  RAISE NOTICE 'Stripe amount backfill: % tenants have real amounts, % still missing',
    backfilled, still_missing;
END $$;

COMMIT;
