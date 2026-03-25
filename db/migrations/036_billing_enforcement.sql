-- 036: Billing enforcement — downgrade-safe limit handling + overage cap
--
-- pending_conv_limit: when a downgrade sets a lower limit than current usage,
--   store the new limit here and apply at next cycle reset (invoice.payment_succeeded).
--   NULL = no pending change, conv_limit_this_cycle is current.
--
-- overage_cap_pct: hard cap expressed as % of conv_limit_this_cycle.
--   Default 120 = paid tenants hard-blocked at 120% of plan limit.
--   Prevents unbounded cost exposure while giving breathing room.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pending_conv_limit INT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS overage_cap_pct INT NOT NULL DEFAULT 120;
