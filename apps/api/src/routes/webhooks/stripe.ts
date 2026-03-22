import { FastifyInstance, FastifyRequest } from "fastify";
import Stripe from "stripe";
import { query } from "../../db/client";
import { updateBillingStatus } from "../../db/tenants";
import { billingQueue, provisionNumberQueue } from "../../queues/redis";
import { deduplicateWebhook } from "../../db/webhook-events";
import { assignSharedTestNumber } from "../../utils/test-tenant";

type BillingStatus =
  | "trial" | "trial_expired" | "active" | "scheduled_cancel"
  | "past_due" | "past_due_blocked" | "canceled" | "paused";

const PLAN_LIMITS: Record<string, number> = {
  starter: 150,
  pro: 400,
  premium: 1000,
};

function getPlanFromStripePrice(priceId: string): string {
  // TODO: map Stripe price IDs to plan slugs via env or DB lookup
  // e.g. STRIPE_PRICE_STARTER=price_xxx
  const map: Record<string, string> = {
    [process.env.STRIPE_PRICE_STARTER ?? ""]: "starter",
    [process.env.STRIPE_PRICE_PRO ?? ""]: "pro",
    [process.env.STRIPE_PRICE_PREMIUM ?? ""]: "premium",
  };
  return map[priceId] ?? "starter";
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
      const convLimit = PLAN_LIMITS[planId] ?? 150;

      // Determine billing status: if cancel_at_period_end is set, the subscription
      // is still active (customer keeps service) but scheduled to cancel.
      // MRR must include scheduled_cancel tenants until the period actually ends.
      const billingStatus =
        sub.status === "active" && sub.cancel_at_period_end
          ? "scheduled_cancel"
          : sub.status === "active"
            ? "active"
            : sub.status === "past_due"
              ? "past_due"
              : "active"; // default for other active-like states

      // Extract real subscription amount from Stripe (cents)
      const priceItem = sub.items.data[0]?.price;
      const subscriptionAmountCents = priceItem?.unit_amount ?? null;
      const subscriptionCurrency = priceItem?.currency ?? "usd";
      const subscriptionInterval = priceItem?.recurring?.interval ?? "month";
      const cancelAt = sub.cancel_at_period_end
        ? sub.current_period_end
        : null;

      // On subscription.created: reset usage counters.
      // On subscription.updated: preserve usage (user may just be changing cancel state).
      if (event.type === "customer.subscription.created") {
        await query(
          `UPDATE tenants SET
             billing_status     = $1, plan_id = $2, stripe_subscription_id = $3,
             conv_limit_this_cycle = $4, conv_used_this_cycle = 0,
             warned_80pct = FALSE, warned_100pct = FALSE,
             cycle_reset_at = to_timestamp($5),
             subscription_amount_cents = $6, subscription_currency = $7,
             subscription_interval = $8, cancel_at = $9,
             updated_at = NOW()
           WHERE id = $10`,
          [billingStatus, planId, sub.id, convLimit, sub.current_period_end,
           subscriptionAmountCents, subscriptionCurrency, subscriptionInterval,
           cancelAt ? new Date(cancelAt * 1000).toISOString() : null, tenantId]
        );
      } else {
        await query(
          `UPDATE tenants SET
             billing_status     = $1, plan_id = $2, stripe_subscription_id = $3,
             conv_limit_this_cycle = $4,
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

          // Test tenants: assign shared number, never buy from Twilio
          if (tenantRows[0]?.is_test) {
            await assignSharedTestNumber(tenantId);
            console.info(`[stripe] Test tenant ${tenantId} — shared test number assigned (no Twilio purchase)`);
          } else {
            const areaCode =
              tenantRows[0]?.owner_phone?.replace(/\D/g, "").slice(1, 4) || "512";
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
            console.info(
              `[stripe] Provisioning Twilio number for tenant ${tenantId} (area code ${areaCode})`
            );
          }
        }
      }
      break;
    }

    case "invoice.payment_succeeded": {
      const inv = event.data.object as Stripe.Invoice;
      await query(
        `UPDATE tenants SET
           billing_status       = 'active',
           conv_used_this_cycle = 0,
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
        `UPDATE tenant_phone_numbers SET status = 'suspended', updated_at = NOW()
         WHERE tenant_id = $1 AND status = 'active'`,
        [tenantId]
      );
      console.info(`[stripe] Suspended Twilio number(s) for canceled tenant ${tenantId}`);
      break;
    }

    case "charge.dispute.created": {
      await updateBillingStatus(tenantId, "paused");
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
