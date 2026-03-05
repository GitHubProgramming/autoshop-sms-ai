// ============================================================
// AutoShop SMS AI — Billing Service
// Implements the billing state machine.
// DB is source of truth. NEVER calls Stripe API in hot path.
// ============================================================

import { query, withTenant } from '../db/client';
import { BillingState, PLAN_LIMITS, PlanId } from '@autoshop/shared';

export interface BillingUpdate {
  billing_state?: BillingState;
  plan_id?: PlanId;
  monthly_limit?: number;
  billing_cycle_start?: Date;
  past_due_since?: Date | null;
}

// ──────────────────────────────────────────────────────────
// State machine transitions (called from Stripe webhook handler)
// ──────────────────────────────────────────────────────────

/**
 * customer.subscription.created or .updated
 */
export async function handleSubscriptionActive(
  tenantId: string,
  stripeSubscriptionId: string,
  stripePriceId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<void> {
  const planId = resolvePlanFromPriceId(stripePriceId);
  const monthlyLimit = PLAN_LIMITS[planId] ?? 150;

  await query(
    `UPDATE tenants SET
       billing_state = 'active',
       plan_id = $2,
       monthly_limit = $3,
       billing_cycle_start = $4,
       past_due_since = NULL,
       warning_80_sent = FALSE,
       warning_100_sent = FALSE,
       updated_at = NOW()
     WHERE id = $1`,
    [tenantId, planId, monthlyLimit, periodStart]
  );

  // Upsert subscription record
  await query(
    `INSERT INTO subscriptions (tenant_id, stripe_customer_id, stripe_subscription_id,
       stripe_price_id, status, current_period_start, current_period_end)
     VALUES ($1, (SELECT stripe_customer_id FROM subscriptions WHERE tenant_id = $1 LIMIT 1),
       $2, $3, 'active', $4, $5)
     ON CONFLICT (stripe_subscription_id) DO UPDATE SET
       status = 'active',
       stripe_price_id = EXCLUDED.stripe_price_id,
       current_period_start = EXCLUDED.current_period_start,
       current_period_end = EXCLUDED.current_period_end,
       updated_at = NOW()`,
    [tenantId, stripeSubscriptionId, stripePriceId, periodStart, periodEnd]
  );

  // Reset usage record for new billing period
  await query(
    `INSERT INTO usage_records (tenant_id, period_start, period_end, conversations_count)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (tenant_id, period_start) DO NOTHING`,
    [tenantId, periodStart, periodEnd]
  );
}

/**
 * invoice.payment_failed → past_due
 */
export async function handlePaymentFailed(tenantId: string): Promise<void> {
  await query(
    `UPDATE tenants SET
       billing_state = 'past_due',
       past_due_since = COALESCE(past_due_since, NOW()),
       updated_at = NOW()
     WHERE id = $1 AND billing_state = 'active'`,
    [tenantId]
  );

  await query(
    `UPDATE subscriptions SET status = 'past_due', updated_at = NOW()
     WHERE tenant_id = $1`,
    [tenantId]
  );
}

/**
 * invoice.paid → clears past_due
 */
export async function handleInvoicePaid(tenantId: string): Promise<void> {
  await query(
    `UPDATE tenants SET
       billing_state = 'active',
       past_due_since = NULL,
       updated_at = NOW()
     WHERE id = $1 AND billing_state IN ('past_due','suspended')`,
    [tenantId]
  );

  await query(
    `UPDATE subscriptions SET status = 'active', updated_at = NOW()
     WHERE tenant_id = $1`,
    [tenantId]
  );
}

/**
 * customer.subscription.deleted → canceled
 */
export async function handleSubscriptionCanceled(tenantId: string): Promise<void> {
  await query(
    `UPDATE tenants SET
       billing_state = 'canceled',
       updated_at = NOW()
     WHERE id = $1`,
    [tenantId]
  );

  await query(
    `UPDATE subscriptions SET status = 'canceled', updated_at = NOW()
     WHERE tenant_id = $1`,
    [tenantId]
  );
}

/**
 * Run by cron: past_due > 7 days → suspended
 */
export async function suspendOverdueTenants(): Promise<string[]> {
  const { rows } = await query<{ id: string }>(
    `UPDATE tenants SET
       billing_state = 'suspended',
       updated_at = NOW()
     WHERE billing_state = 'past_due'
       AND past_due_since < NOW() - INTERVAL '7 days'
     RETURNING id`
  );
  return rows.map((r) => r.id);
}

/**
 * Check and send usage warnings (80% / 100%).
 * Called after each new conversation opens.
 */
export async function checkUsageWarnings(tenantId: string): Promise<void> {
  const { rows } = await query<{
    monthly_limit: number;
    billing_cycle_start: Date;
    warning_80_sent: boolean;
    warning_100_sent: boolean;
    conversations_count: number;
  }>(
    `SELECT t.monthly_limit, t.billing_cycle_start,
            t.warning_80_sent, t.warning_100_sent,
            COALESCE(u.conversations_count, 0) AS conversations_count
     FROM tenants t
     LEFT JOIN usage_records u ON u.tenant_id = t.id
       AND u.period_start = t.billing_cycle_start
     WHERE t.id = $1`,
    [tenantId]
  );

  if (!rows[0]) return;
  const { monthly_limit, conversations_count, warning_80_sent, warning_100_sent } = rows[0];

  const pct = conversations_count / monthly_limit;

  if (pct >= 1.0 && !warning_100_sent) {
    await query(
      `UPDATE tenants SET warning_100_sent = TRUE, updated_at = NOW() WHERE id = $1`,
      [tenantId]
    );
    // TODO: enqueue email notification job
    console.log(`[BILLING] 100% usage warning for tenant ${tenantId}`);
  } else if (pct >= 0.8 && !warning_80_sent) {
    await query(
      `UPDATE tenants SET warning_80_sent = TRUE, updated_at = NOW() WHERE id = $1`,
      [tenantId]
    );
    // TODO: enqueue email notification job
    console.log(`[BILLING] 80% usage warning for tenant ${tenantId}`);
  }
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────
function resolvePlanFromPriceId(stripePriceId: string): PlanId {
  const map: Record<string, PlanId> = {
    [process.env.STRIPE_PRICE_STARTER || '']: 'starter',
    [process.env.STRIPE_PRICE_PRO || '']: 'pro',
    [process.env.STRIPE_PRICE_PREMIUM || '']: 'premium',
  };
  return map[stripePriceId] || 'starter';
}

/**
 * Ensure Stripe customer exists for tenant (call once during onboarding).
 * Returns existing stripe_customer_id or creates new.
 */
export async function ensureStripeCustomer(
  tenantId: string,
  email: string,
  shopName: string
): Promise<string> {
  const { rows } = await query<{ stripe_customer_id: string }>(
    `SELECT stripe_customer_id FROM subscriptions WHERE tenant_id = $1 LIMIT 1`,
    [tenantId]
  );

  if (rows[0]) return rows[0].stripe_customer_id;

  // Create Stripe customer (lazy import to avoid loading Stripe in hot path)
  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' });

  const customer = await stripe.customers.create({
    email,
    name: shopName,
    metadata: { tenant_id: tenantId },
  });

  await query(
    `INSERT INTO subscriptions (tenant_id, stripe_customer_id, status)
     VALUES ($1, $2, 'trialing')
     ON CONFLICT DO NOTHING`,
    [tenantId, customer.id]
  );

  return customer.id;
}
