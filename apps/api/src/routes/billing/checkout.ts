import { FastifyInstance } from "fastify";
import { z } from "zod";
import Stripe from "stripe";
import { query } from "../../db/client";
import { getTenantById } from "../../db/tenants";
import { requireAuth } from "../../middleware/require-auth";

const PLAN_PRICE_MAP: Record<string, string | undefined> = {
  starter: process.env.STRIPE_PRICE_STARTER,
  pro: process.env.STRIPE_PRICE_PRO,
  premium: process.env.STRIPE_PRICE_PREMIUM,
};

const CheckoutBody = z.object({
  plan: z.enum(["starter", "pro", "premium"]),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

export async function billingCheckoutRoute(app: FastifyInstance) {
  /**
   * POST /billing/checkout
   *
   * Requires JWT auth. Uses tenantId from the authenticated session.
   * Creates a Stripe Checkout Session for subscription purchase.
   * Returns { url } — redirect the shop owner's browser there.
   */
  app.post("/checkout", { preHandler: [requireAuth] }, async (request, reply) => {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return reply.status(503).send({ error: "Stripe not configured" });
    }

    const parsed = CheckoutBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { plan, successUrl, cancelUrl } = parsed.data;
    const { tenantId } = request.user as { tenantId: string };

    const priceId = PLAN_PRICE_MAP[plan];
    if (!priceId) {
      return reply.status(503).send({
        error: `Stripe price for plan '${plan}' not configured (set STRIPE_PRICE_${plan.toUpperCase()})`,
      });
    }

    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      return reply.status(404).send({ error: "Tenant not found" });
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    // Resolve or create Stripe customer
    let customerId = (tenant as any).stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: tenant.owner_email,
        name: tenant.shop_name,
        metadata: { tenant_id: tenantId },
      });
      customerId = customer.id;

      // Persist the new customer ID
      await query(
        `UPDATE tenants SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2`,
        [customerId, tenantId]
      );

      request.log.info({ tenantId, customerId }, "Created Stripe customer");
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: {
        metadata: { tenant_id: tenantId },
      },
      metadata: { tenant_id: tenantId },
    });

    request.log.info({ tenantId, plan, sessionId: session.id }, "Stripe checkout session created");

    return reply.status(200).send({ url: session.url });
  });
}
