import { FastifyInstance, FastifyRequest } from "fastify";
import Stripe from "stripe";
import { query } from "../../db/client";
import { updateBillingStatus } from "../../db/tenants";
import { billingQueue, checkIdempotency, markIdempotency } from "../../queues/redis";

type BillingStatus =
  | "trial" | "trial_expired" | "active"
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

    // ── Idempotency ──────────────────────────────────────────────────────────
    const alreadyProcessed = await checkIdempotency(`stripe:${event.id}`);
    if (alreadyProcessed) {
      return reply.status(200).send({ received: true });
    }
    await markIdempotency(`stripe:${event.id}`);

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

      await query(
        `UPDATE tenants SET
           billing_status     = 'active',
           plan_id            = $1,
           stripe_subscription_id = $2,
           conv_limit_this_cycle  = $3,
           conv_used_this_cycle   = 0,
           warned_80pct       = FALSE,
           warned_100pct      = FALSE,
           cycle_reset_at     = to_timestamp($4),
           updated_at         = NOW()
         WHERE id = $5`,
        [planId, sub.id, convLimit, sub.current_period_end, tenantId]
      );
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
      // TODO: suspend Twilio number (async job)
      break;
    }

    case "charge.dispute.created": {
      await updateBillingStatus(tenantId, "paused");
      // TODO: alert admin channel
      break;
    }

    default:
      // Unhandled events — logged but ignored
      break;
  }
}
