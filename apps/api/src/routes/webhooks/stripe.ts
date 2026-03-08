import { FastifyInstance, FastifyRequest } from "fastify";
import Stripe from "stripe";
import { query } from "../../db/client";
import { getTenantById, updateBillingStatus, BillingStatus } from "../../db/tenants";
import { billingQueue, provisionNumberQueue, checkIdempotency, markIdempotency } from "../../queues/redis";

const PLAN_LIMITS: Record<string, number> = {
  starter: 150,
  pro: 400,
  premium: 1000,
};

function getPlanFromStripePrice(priceId: string): string {
  const map: Record<string, string> = {};
  if (process.env.STRIPE_PRICE_STARTER) map[process.env.STRIPE_PRICE_STARTER] = "starter";
  if (process.env.STRIPE_PRICE_PRO)     map[process.env.STRIPE_PRICE_PRO]     = "pro";
  if (process.env.STRIPE_PRICE_PREMIUM) map[process.env.STRIPE_PRICE_PREMIUM] = "premium";
  const plan = map[priceId];
  if (!plan) {
    // Unknown price ID — throw so billing state machine does not silently mis-classify
    throw new Error(`Unknown Stripe price ID: ${priceId}. Set STRIPE_PRICE_STARTER/PRO/PREMIUM env vars.`);
  }
  return plan;
}

/**
 * Map Stripe subscription status to our billing_status.
 * Returns null for ambiguous states (incomplete, trialing) — caller preserves current status.
 */
function stripeSubStatusToBillingStatus(subStatus: string): BillingStatus | null {
  switch (subStatus) {
    case "active":             return "active";
    case "past_due":           return "past_due";
    case "canceled":           return "canceled";
    case "unpaid":             return "past_due";
    case "incomplete_expired": return "canceled";
    default:                   return null; // incomplete, trialing — do not override
  }
}

/**
 * Resolve tenant ID from a Stripe event.
 * 1. metadata.tenant_id — set on checkout session, propagated to subscription by Stripe.
 * 2. stripe_customer_id DB lookup — fallback for events without metadata (e.g. manual invoices).
 */
async function resolveTenantId(event: Stripe.Event): Promise<string | undefined> {
  const obj = event.data.object as Record<string, unknown>;

  const metadata = obj.metadata as Record<string, string> | undefined;
  if (metadata?.tenant_id) return metadata.tenant_id;

  // customer field is present on Subscription and Invoice objects
  const customer = obj.customer;
  const customerId = typeof customer === "string" ? customer : (customer as Stripe.Customer | null)?.id;
  if (customerId) {
    const rows = await query<{ id: string }>(
      `SELECT id FROM tenants WHERE stripe_customer_id = $1 LIMIT 1`,
      [customerId]
    );
    if (rows[0]) return rows[0].id;
  }

  return undefined;
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
      app.log.info({ eventId: event.id }, "Stripe event already processed — skipping");
      return reply.status(200).send({ received: true });
    }
    await markIdempotency(`stripe:${event.id}`);

    // ── Resolve tenant ───────────────────────────────────────────────────────
    const tenantId = await resolveTenantId(event);

    // ── Log to billing_events ────────────────────────────────────────────────
    await query(
      `INSERT INTO billing_events (stripe_event_id, tenant_id, event_type, payload)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (stripe_event_id) DO NOTHING`,
      [event.id, tenantId ?? null, event.type, JSON.stringify(event.data.object)]
    );

    // ── State machine routing ────────────────────────────────────────────────
    if (tenantId) {
      try {
        await routeStripeEvent(app, event, tenantId);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        // Log but return 200 — Stripe retries are futile if our data is the problem;
        // the billing_events log preserves the raw payload for manual recovery.
        app.log.error(
          { eventType: event.type, eventId: event.id, tenantId, message },
          "Stripe event handler failed"
        );
      }
    } else {
      app.log.warn(
        { eventType: event.type, eventId: event.id },
        "Stripe event: could not resolve tenant — logged only"
      );
    }

    return reply.status(200).send({ received: true });
  });
}

async function routeStripeEvent(
  app: FastifyInstance,
  event: Stripe.Event,
  tenantId: string
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      // Payment confirmed — trigger async Twilio number provisioning
      const session = event.data.object as Stripe.Checkout.Session;
      const areaCode = session.metadata?.area_code ?? "512"; // default Texas area code
      const tenant = await getTenantById(tenantId);
      if (tenant) {
        await provisionNumberQueue.add(
          "provision-twilio-number",
          { tenantId, areaCode, shopName: tenant.shop_name },
          {
            jobId: `provision-${tenantId}`,
            attempts: 5,
            backoff: { type: "exponential", delay: 5_000 },
          }
        );
        app.log.info({ tenantId, areaCode }, "checkout.session.completed — Twilio provisioning queued");
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const priceId = sub.items.data[0]?.price.id ?? "";
      const planId = getPlanFromStripePrice(priceId);
      const convLimit = PLAN_LIMITS[planId] ?? 150;
      const billingStatus = stripeSubStatusToBillingStatus(sub.status) ?? "active";
      const resetUsage = billingStatus === "active";
      const customerId =
        typeof sub.customer === "string" ? sub.customer : (sub.customer as Stripe.Customer).id;

      await query(
        `UPDATE tenants SET
           billing_status         = $1,
           plan_id                = $2,
           stripe_customer_id     = COALESCE(stripe_customer_id, $3),
           stripe_subscription_id = $4,
           stripe_price_id        = $5,
           conv_limit_this_cycle  = $6,
           conv_used_this_cycle   = CASE WHEN $7 THEN 0 ELSE conv_used_this_cycle END,
           warned_80pct           = CASE WHEN $7 THEN FALSE ELSE warned_80pct END,
           warned_100pct          = CASE WHEN $7 THEN FALSE ELSE warned_100pct END,
           current_period_start   = to_timestamp($8),
           cycle_reset_at         = to_timestamp($9),
           cancel_at_period_end   = $10,
           updated_at             = NOW()
         WHERE id = $11`,
        [
          billingStatus,
          planId,
          customerId,
          sub.id,
          priceId,
          convLimit,
          resetUsage,
          sub.current_period_start,
          sub.current_period_end,
          sub.cancel_at_period_end,
          tenantId,
        ]
      );
      app.log.info(
        { tenantId, planId, billingStatus, subId: sub.id, cancelAtPeriodEnd: sub.cancel_at_period_end },
        `${event.type} — tenant subscription upserted`
      );
      break;
    }

    case "invoice.paid":
    case "invoice.payment_succeeded": {
      // invoice.paid   — fires when Stripe marks the invoice status as "paid"
      // invoice.payment_succeeded — fires when the payment attempt succeeds
      // Both indicate the subscription cycle renewed; treat identically.
      const inv = event.data.object as Stripe.Invoice;
      const periodEnd = (inv as unknown as { period_end: number }).period_end;
      await query(
        `UPDATE tenants SET
           billing_status       = 'active',
           conv_used_this_cycle = 0,
           warned_80pct         = FALSE,
           warned_100pct        = FALSE,
           cycle_reset_at       = to_timestamp($1),
           updated_at           = NOW()
         WHERE id = $2`,
        [periodEnd, tenantId]
      );
      app.log.info({ tenantId, eventType: event.type }, "Invoice paid — tenant set active, usage reset");
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
      app.log.warn({ tenantId }, "invoice.payment_failed — tenant set past_due, grace period scheduled");
      break;
    }

    case "customer.subscription.deleted": {
      await updateBillingStatus(tenantId, "canceled");
      // Enqueue async Twilio number suspension — n8n WF-007 handles deactivation
      await provisionNumberQueue.add(
        "suspend-twilio-number",
        { tenantId },
        { jobId: `suspend-${tenantId}`, attempts: 3 }
      );
      app.log.info({ tenantId }, "customer.subscription.deleted — tenant canceled, Twilio suspension queued");
      break;
    }

    case "charge.dispute.created": {
      await updateBillingStatus(tenantId, "paused");
      // Queue admin alert — disputes can escalate to chargebacks; requires manual review
      await billingQueue.add(
        "admin-alert-dispute",
        { tenantId, eventId: event.id, type: "dispute" },
        { jobId: `dispute-${event.id}` }
      );
      app.log.warn({ tenantId, eventId: event.id }, "charge.dispute.created — tenant paused, admin alert queued");
      break;
    }

    default:
      // Unhandled event types — logged to billing_events, ignored here
      app.log.debug({ eventType: event.type, tenantId }, "Stripe event type not routed");
      break;
  }
}
