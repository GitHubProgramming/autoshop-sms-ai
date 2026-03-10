import { FastifyInstance } from "fastify";
import Stripe from "stripe";
import { query } from "../../db/client";
import { requireAuth } from "../../middleware/require-auth";

export async function billingPortalRoute(app: FastifyInstance) {
  /**
   * GET /billing/portal
   *
   * Requires JWT auth. Creates a Stripe Customer Portal session
   * so the tenant can manage subscription, update payment method,
   * and view invoices. Returns { url } — redirect the browser there.
   */
  app.get("/portal", { preHandler: [requireAuth] }, async (request, reply) => {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return reply.status(503).send({ error: "Stripe not configured" });
    }

    const { tenantId } = request.user as { tenantId: string };

    const rows = await query<{ stripe_customer_id: string | null }>(
      `SELECT stripe_customer_id FROM tenants WHERE id = $1`,
      [tenantId]
    );

    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId) {
      return reply.status(400).send({
        error: "No Stripe customer on file. Subscribe to a plan first.",
      });
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    const returnUrl =
      (process.env.PUBLIC_ORIGIN || "https://autoshopsmsai.com") + "/app.html";

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    request.log.info({ tenantId, customerId }, "Stripe portal session created");

    return reply.status(200).send({ url: session.url });
  });
}
