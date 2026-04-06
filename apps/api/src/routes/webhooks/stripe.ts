import { FastifyInstance, FastifyRequest } from "fastify";
import Stripe from "stripe";
import { query } from "../../db/client";
import { updateBillingStatus } from "../../db/tenants";
import { billingQueue, provisionNumberQueue } from "../../queues/redis";
import { deduplicateWebhook } from "../../db/webhook-events";
import { getSharedTestNumber } from "../../utils/test-tenant";
import { createLogger } from "../../utils/logger";

const log = createLogger("stripe-webhook");

type BillingStatus =
  | "demo" | "trial" | "trial_expired" | "active" | "scheduled_cancel"
  | "past_due" | "past_due_blocked" | "canceled" | "paused";

const PLAN_LIMITS: Record<string, number> = {
  starter: 150,
  pro: 400,
  premium: 1000,
};

function getPlanFromStripePrice(priceId: string): string | null {
  const map: Record<string, string> = {
    [process.env.STRIPE_PRICE_STARTER ?? ""]: "starter",
    [process.env.STRIPE_PRICE_PRO ?? ""]: "pro",
    [process.env.STRIPE_PRICE_PREMIUM ?? ""]: "premium",
  };
  return map[priceId] ?? null;
}

export async function stripeRoute(app: FastifyInstance) {
  // Raw body required for Stripe signature verification
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body)
  );

  app.post("/stripe", async (request: FastifyRequest, reply) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      app.log.error("STRIPE_WEBHOOK_SECRET not set");
      return reply.status(500).send({ error: "Server misconfiguration" });
    }

    const sig = request.headers["stripe-signature"] as string;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
      apiVersion: "2023-10-16",
    });

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        request.body as Buffer,
        sig,
        webhookSecret
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      app.log.warn({ message }, "Stripe signature validation failed");
      return reply.status(400).send({ error: `Webhook error: ${message}` });
    }

    // ── Idempotency (two-tier: Redis + PostgreSQL) ──────────────────────────
    const dedup = await deduplicateWebhook("stripe", event.id);
    if (dedup.isDuplicate) {
      app.log.info(
        { eventId: event.id, source: "stripe", event: "webhook_duplicate_detected" },
        "Duplicate Stripe webhook — skipping"
      );
      return reply.status(200).send({ received: true });
    }

    // ── Log to billing_events ────────────────────────────────────────────────
    // TODO: extract tenantId from event metadata
    const obj = event.data.object as any;
    const tenantId = obj?.metadata?.tenant_id as string | undefined;

    await query(
      `INSERT INTO billing_events (stripe_event_id, tenant_id, event_type, payload)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (stripe_event_id) DO NOTHING`,
      [event.id, tenantId ?? null, event.type, JSON.stringify(event.data.object)]
    );

    // ── State machine routing ────────────────────────────────────────────────
    if (tenantId) {
      await routeStripeEvent(event, tenantId);
    } else {
      app.log.warn({ eventType: event.type, eventId: event.id }, "No tenant_id in Stripe event");
    }

    return reply.status(200).send({ received: true });
  });
}

async function routeStripeEvent(event: Stripe.Event, tenantId: string) {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const priceId = sub.items.data[0]?.price.id ?? "";
      const planId = getPlanFromStripePrice(priceId);
      if (!planId) {
        log.error({ priceId, eventId: event.id }, "Unknown Stripe price ID — cannot map to plan. Set STRIPE_PRICE_* env vars.");
        return;
      }
      const convLimit = PLAN_LIMITS[planId];

      // Determine billing status from Stripe subscription state.
      // 'trialing' = card captured with trial_period_days (demo→trial upgrade).
      // 'active' + cancel_at_period_end = scheduled_cancel (still counts for MRR).
      let billingStatus: BillingStatus;
      if (sub.status === "trialing") {
        billingStatus = "trial";
      } else if (sub.status === "active" && sub.cancel_at_period_end) {
        billingStatus = "scheduled_cancel";
      } else if (sub.status === "active") {
        billingStatus = "active";
      } else if (sub.status === "past_due") {
        billingStatus = "past_due";
      } else {
        billingStatus = "active"; // default for other active-like states
      }

      // Extract real subscription amount from Stripe (cents)
      const priceItem = sub.items.data[0]?.price;
      const subscriptionAmountCents = priceItem?.unit_amount ?? null;
      const subscriptionCurrency = priceItem?.currency ?? "usd";
      const subscriptionInterval = priceItem?.recurring?.interval ?? "month";
      const cancelAt = sub.cancel_at_period_end
        ? sub.current_period_end
        : null;

      // On subscription.created: reset usage counters + handle demo→trial transition.
      // On subscription.updated: preserve usage (user may just be changing cancel state).
      if (event.type === "customer.subscription.created") {
        // Check if this is a demo→trial upgrade
        const currentTenant = await query<{ billing_status: string }>(
          `SELECT billing_status FROM tenants WHERE id = $1`, [tenantId]
        );
        const wasDemo = currentTenant[0]?.billing_status === "demo";

        // Compute trial_ends_at from Stripe's trial_end (if trial sub) or use 14-day default
        const trialEnd = sub.trial_end
          ? new Date(sub.trial_end * 1000).toISOString()
          : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

        await query(
          `UPDATE tenants SET
             billing_status     = $1, plan_id = $2, stripe_subscription_id = $3,
             conv_limit_this_cycle = $4, conv_used_this_cycle = 0,
             warned_80pct = FALSE, warned_100pct = FALSE,
             cycle_reset_at = to_timestamp($5),
             subscription_amount_cents = $6, subscription_currency = $7,
             subscription_interval = $8, cancel_at = $9,
             trial_started_at = COALESCE(trial_started_at, NOW()),
             trial_ends_at = CASE WHEN billing_status = 'demo' OR trial_ends_at IS NULL THEN $11::timestamptz ELSE trial_ends_at END,
             workspace_mode = CASE WHEN workspace_mode = 'demo' THEN 'live_empty' ELSE workspace_mode END,
             provisioning_state = CASE WHEN provisioning_state = 'not_started' THEN 'pending_setup' ELSE provisioning_state END,
             updated_at = NOW()
           WHERE id = $10`,
          [billingStatus, planId, sub.id, convLimit, sub.current_period_end,
           subscriptionAmountCents, subscriptionCurrency, subscriptionInterval,
           cancelAt ? new Date(cancelAt * 1000).toISOString() : null, tenantId,
           trialEnd]
        );

        if (wasDemo) {
          log.info({ tenantId }, "Demo→trial transition");
        }
      } else {
        // Downgrade protection: if the new plan limit is lower than current usage,
        // defer the limit change to next cycle so the customer isn't immediately
        // cut off mid-cycle after paying for the current one.
        const currentTenantRow = await query<{
          conv_used_this_cycle: number;
          conv_limit_this_cycle: number;
        }>(
          `SELECT conv_used_this_cycle, conv_limit_this_cycle FROM tenants WHERE id = $1`,
          [tenantId]
        );
        const currentUsed = currentTenantRow[0]?.conv_used_this_cycle ?? 0;
        const currentLimit = currentTenantRow[0]?.conv_limit_this_cycle ?? 0;
        const isDowngrade = convLimit < currentLimit && currentUsed > convLimit;

        if (isDowngrade) {
          // Store the lower limit as pending — applied on next invoice.payment_succeeded
          await query(
            `UPDATE tenants SET
               billing_status     = $1, plan_id = $2, stripe_subscription_id = $3,
               pending_conv_limit = $4,
               cycle_reset_at = to_timestamp($5),
               subscription_amount_cents = $6, subscription_currency = $7,
               subscription_interval = $8, cancel_at = $9,
               updated_at = NOW()
             WHERE id = $10`,
            [billingStatus, planId, sub.id, convLimit, sub.current_period_end,
             subscriptionAmountCents, subscriptionCurrency, subscriptionInterval,
             cancelAt ? new Date(cancelAt * 1000).toISOString() : null, tenantId]
          );
          log.info(
            { tenantId, currentUsed, currentLimit, newLimit: convLimit },
            "Downgrade deferred — new limit pending next cycle"
          );
        } else {
          await query(
            `UPDATE tenants SET
               billing_status     = $1, plan_id = $2, stripe_subscription_id = $3,
               conv_limit_this_cycle = $4, pending_conv_limit = NULL,
               cycle_reset_at = to_timestamp($5),
               subscription_amount_cents = $6, subscription_currency = $7,
               subscription_interval = $8, cancel_at = $9,
               updated_at = NOW()
             WHERE id = $10`,
            [billingStatus, planId, sub.id, convLimit, sub.current_period_end,
             subscriptionAmountCents, subscriptionCurrency, subscriptionInterval,
             cancelAt ? new Date(cancelAt * 1000).toISOString() : null, tenantId]
          );
        }
      }

      // On first subscription: provision a Twilio number if tenant doesn't have one yet
      if (event.type === "customer.subscription.created") {
        const existing = await query(
          `SELECT id FROM tenant_phone_numbers
           WHERE tenant_id = $1 AND status = 'active' LIMIT 1`,
          [tenantId]
        );
        if (existing.length === 0) {
          const tenantRows = await query<{ shop_name: string; owner_phone: string | null; is_test: boolean }>(
            `SELECT shop_name, owner_phone, is_test FROM tenants WHERE id = $1`,
            [tenantId]
          );

          // Test tenants: skip Twilio purchase entirely — dashboard shows shared number via fallback
          if (tenantRows[0]?.is_test) {
            log.info({ tenantId }, "Test tenant — skipping Twilio purchase (shared test number)");
          } else {
            const areaCode =
              tenantRows[0]?.owner_phone?.replace(/\D/g, "").slice(1, 4) || "512";
            try {
              await provisionNumberQueue.add(
                "provision-twilio-number",
                {
                  tenantId,
                  areaCode,
                  shopName: tenantRows[0]?.shop_name ?? "AutoShop",
                },
                {
                  jobId: `provision-${tenantId}`,
                  attempts: 5,
                  backoff: { type: "exponential", delay: 5_000 },
                }
              );
              log.info({ tenantId, areaCode }, "Provisioning Twilio number");
            } catch (enqueueErr) {
              log.error(
                { tenantId, err: (enqueueErr as Error).message },
                "CRITICAL: Failed to enqueue provisioning — tenant paid but has no number"
              );
              // Mark provisioning as failed so dashboard shows error state
              try {
                await query(
                  `UPDATE tenants SET provisioning_state = 'error', updated_at = NOW() WHERE id = $1`,
                  [tenantId]
                );
              } catch { /* non-fatal */ }
              // Create pipeline alert for operator
              try {
                const { raiseAlert } = await import("../../services/pipeline-alerts");
                await raiseAlert({
                  tenantId,
                  traceId: null,
                  severity: "critical",
                  alertType: "pipeline_failed",
                  summary: "Twilio number provisioning failed to enqueue after Stripe payment",
                  details: `Stripe subscription.created processed but provisionNumberQueue.add() failed: ${(enqueueErr as Error).message}. Tenant was charged but has no phone number. Manual provisioning required.`,
                });
              } catch { /* non-fatal */ }
            }
          }
        }
      }
      break;
    }

    case "invoice.payment_succeeded": {
      const inv = event.data.object as Stripe.Invoice;
      // Apply pending_conv_limit (from mid-cycle downgrade) on cycle reset.
      // COALESCE: if pending exists, apply it and clear; otherwise keep current limit.
      await query(
        `UPDATE tenants SET
           billing_status       = 'active',
           conv_used_this_cycle = 0,
           conv_limit_this_cycle = COALESCE(pending_conv_limit, conv_limit_this_cycle),
           pending_conv_limit   = NULL,
           warned_80pct         = FALSE,
           warned_100pct        = FALSE,
           cycle_reset_at       = to_timestamp($1),
           updated_at           = NOW()
         WHERE id = $2`,
        [(inv as unknown as { period_end: number }).period_end, tenantId]
      );
      break;
    }

    case "invoice.payment_failed": {
      await updateBillingStatus(tenantId, "past_due");
      // Schedule grace period check: if still past_due after 3 days → block
      await billingQueue.add(
        "grace-period-check",
        { tenantId },
        { delay: 3 * 24 * 60 * 60 * 1000, jobId: `grace-${tenantId}` }
      );
      break;
    }

    case "customer.subscription.deleted": {
      await updateBillingStatus(tenantId, "canceled");
      // Suspend Twilio number(s) so inbound messages stop routing to this tenant.
      // Number is NOT released from Twilio (reversible if tenant resubscribes).
      await query(
        `UPDATE tenant_phone_numbers SET status = 'suspended', suspended_at = NOW()
         WHERE tenant_id = $1 AND status = 'active'`,
        [tenantId]
      );
      log.info({ tenantId }, "Suspended Twilio number(s) for canceled tenant");
      break;
    }

    case "charge.dispute.created": {
      await updateBillingStatus(tenantId, "paused");
      // Suspend Twilio number(s) — stop SMS during fraud dispute
      try {
        await query(
          `UPDATE tenant_phone_numbers SET status = 'suspended', suspended_at = NOW()
           WHERE tenant_id = $1 AND status = 'active'`,
          [tenantId]
        );
        log.info({ tenantId }, "Suspended Twilio number(s) for disputed tenant");
      } catch (err) {
        log.error({ tenantId, err: (err as Error).message }, "Failed to suspend Twilio number for disputed tenant");
      }
      // Alert admin via pipeline alerts system
      try {
        const { raiseAlert } = await import("../../services/pipeline-alerts");
        await raiseAlert({
          tenantId,
          traceId: null,
          severity: "critical",
          alertType: "pipeline_failed",
          summary: `Chargeback/dispute filed — tenant paused`,
          details: `Stripe event: charge.dispute.created. Tenant ${tenantId} billing set to paused. Requires admin review.`,
        });
      } catch {
        // Non-fatal: billing state change already applied
      }
      break;
    }

    default:
      // Unhandled events — logged but ignored
      break;
  }
}
