import { FastifyInstance } from "fastify";
import Stripe from "stripe";
import { query } from "../../db/client";
import { requireAuth } from "../../middleware/require-auth";

export async function billingInvoicesRoute(app: FastifyInstance) {
  /**
   * GET /billing/invoices
   *
   * Requires JWT auth. Fetches the tenant's invoice history from Stripe.
   * Returns a normalized array — the frontend never talks to Stripe directly.
   */
  app.get("/invoices", { preHandler: [requireAuth] }, async (request, reply) => {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return reply.status(200).send({ invoices: [] });
    }

    const { tenantId } = request.user as { tenantId: string };

    const rows = await query<{ stripe_customer_id: string | null }>(
      `SELECT stripe_customer_id FROM tenants WHERE id = $1`,
      [tenantId]
    );

    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId) {
      return reply.status(200).send({ invoices: [] });
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    let stripeInvoices;
    try {
      stripeInvoices = await stripe.invoices.list({
        customer: customerId,
        limit: 24,
        expand: ["data.charge"],
      });
    } catch (err: any) {
      // Stale customer ID — clear it and return empty list instead of 502
      if (err.code === "resource_missing") {
        request.log.warn({ tenantId, customerId }, "Stale stripe_customer_id in invoices — clearing");
        await query(`UPDATE tenants SET stripe_customer_id = NULL, updated_at = NOW() WHERE id = $1`, [tenantId]);
        return reply.status(200).send({ invoices: [] });
      }
      request.log.error({ tenantId, customerId, err: err.message }, "Stripe invoice fetch failed");
      return reply.status(502).send({ error: "Could not load invoices from payment provider" });
    }

    const invoices = stripeInvoices.data.map((inv) => {
      // Billing period from line items or invoice period
      const periodStart = inv.period_start
        ? new Date(inv.period_start * 1000).toISOString().slice(0, 10)
        : null;
      const periodEnd = inv.period_end
        ? new Date(inv.period_end * 1000).toISOString().slice(0, 10)
        : null;
      const period =
        periodStart && periodEnd ? `${periodStart} — ${periodEnd}` : "—";

      // Invoice date
      const date = inv.created
        ? new Date(inv.created * 1000).toISOString().slice(0, 10)
        : "—";

      // Amount in dollars
      const amount = (inv.amount_paid ?? inv.total ?? 0) / 100;

      // Status normalization
      let status: string;
      if (inv.status === "paid") status = "Paid";
      else if (inv.status === "open") status = "Open";
      else if (inv.status === "void") status = "Void";
      else if (inv.status === "uncollectible") status = "Uncollectible";
      else if (inv.status === "draft") status = "Draft";
      else status = inv.status ?? "Unknown";

      // Hosted invoice URL (Stripe-hosted page) or receipt URL from charge
      const charge = inv.charge;
      const receiptUrl =
        typeof charge === "object" && charge !== null
          ? charge.receipt_url
          : null;
      const hostedUrl = inv.hosted_invoice_url ?? receiptUrl ?? null;

      return {
        id: inv.number ?? inv.id,
        period,
        date,
        amount,
        status,
        url: hostedUrl,
      };
    });

    return reply.status(200).send({ invoices });
  });
}
