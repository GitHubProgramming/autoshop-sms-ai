import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Stripe from 'stripe';
import { getPool, query } from '../../db/client';
import { PLAN_LIMITS } from '@autoshop/shared';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});

// Plan ID → limits mapping from Stripe price IDs
function getPlanFromPriceId(priceId: string): { plan_id: string; monthly_limit: number } | null {
  const map: Record<string, { plan_id: string; monthly_limit: number }> = {
    [process.env.STRIPE_PRICE_STARTER!]: { plan_id: 'starter', monthly_limit: PLAN_LIMITS.starter },
    [process.env.STRIPE_PRICE_PRO!]:     { plan_id: 'pro',     monthly_limit: PLAN_LIMITS.pro },
    [process.env.STRIPE_PRICE_PREMIUM!]: { plan_id: 'premium', monthly_limit: PLAN_LIMITS.premium },
  };
  return map[priceId] || null;
}

export async function stripeRoute(app: FastifyInstance) {
  // Raw body needed for signature validation
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    done(null, body);
  });

  app.post(
    '/stripe',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const sig = req.headers['stripe-signature'] as string;
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
      } catch (err) {
        req.log.warn(err, 'Invalid Stripe signature');
        return reply.code(400).send({ error: 'Invalid signature' });
      }

      // DB idempotency
      const pool = getPool();
      const client = await pool.connect();
      let skip = false;

      try {
        const insertRes = await client.query(
          `INSERT INTO webhook_events (source, event_sid, event_type, payload)
           VALUES ('stripe', $1, $2, $3)
           ON CONFLICT (source, event_sid) DO NOTHING`,
          [event.id, event.type, JSON.stringify(event)]
        );
        if (insertRes.rowCount === 0) skip = true;
      } finally {
        client.release();
      }

      if (skip) return reply.code(200).send({ received: true });

      // Process event — DB is source of truth
      try {
        await handleStripeEvent(event);
        await query(
          `UPDATE webhook_events SET processed = TRUE, processed_at = NOW()
           WHERE source = 'stripe' AND event_sid = $1`,
          [event.id]
        );
      } catch (err) {
        req.log.error(err, 'Stripe event processing error');
        await query(
          `UPDATE webhook_events SET error = $1
           WHERE source = 'stripe' AND event_sid = $2`,
          [(err as Error).message, event.id]
        );
        // Return 200 to Stripe to avoid retries for non-transient errors
      }

      return reply.code(200).send({ received: true });
    }
  );
}

async function handleStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = sub.customer as string;
      const priceId = sub.items.data[0]?.price?.id;
      const planInfo = priceId ? getPlanFromPriceId(priceId) : null;

      let newBillingState = 'active';
      if (sub.status === 'past_due') newBillingState = 'past_due';
      if (sub.status === 'canceled' || sub.status === 'unpaid') newBillingState = 'canceled';

      await query(
        `UPDATE subscriptions SET
           status = $1,
           stripe_subscription_id = $2,
           stripe_price_id = $3,
           current_period_start = to_timestamp($4),
           current_period_end = to_timestamp($5),
           cancel_at_period_end = $6,
           updated_at = NOW()
         WHERE stripe_customer_id = $7`,
        [
          sub.status,
          sub.id,
          priceId,
          sub.current_period_start,
          sub.current_period_end,
          sub.cancel_at_period_end,
          customerId,
        ]
      );

      // Update tenant billing state and plan
      const updateFields: string[] = [`billing_state = '${newBillingState}'`, 'updated_at = NOW()'];
      const params: unknown[] = [customerId];

      if (planInfo) {
        updateFields.push(`plan_id = '${planInfo.plan_id}'`);
        updateFields.push(`monthly_limit = ${planInfo.monthly_limit}`);
        updateFields.push(`billing_cycle_start = to_timestamp(${sub.current_period_start})`);
      }

      await query(
        `UPDATE tenants SET ${updateFields.join(', ')}
         WHERE id = (SELECT tenant_id FROM subscriptions WHERE stripe_customer_id = $1)`,
        params
      );
      break;
    }

    case 'invoice.paid': {
      const inv = event.data.object as Stripe.Invoice;
      await query(
        `UPDATE tenants SET billing_state = 'active', updated_at = NOW()
         WHERE id = (SELECT tenant_id FROM subscriptions WHERE stripe_customer_id = $1)`,
        [inv.customer as string]
      );
      await query(
        `UPDATE subscriptions SET status = 'active', updated_at = NOW()
         WHERE stripe_customer_id = $1`,
        [inv.customer as string]
      );
      break;
    }

    case 'invoice.payment_failed': {
      const inv = event.data.object as Stripe.Invoice;
      // past_due — grace period, not hard block
      await query(
        `UPDATE tenants SET billing_state = 'past_due', updated_at = NOW()
         WHERE id = (SELECT tenant_id FROM subscriptions WHERE stripe_customer_id = $1)`,
        [inv.customer as string]
      );
      await query(
        `UPDATE subscriptions SET status = 'past_due', updated_at = NOW()
         WHERE stripe_customer_id = $1`,
        [inv.customer as string]
      );
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await query(
        `UPDATE tenants SET billing_state = 'canceled', updated_at = NOW()
         WHERE id = (SELECT tenant_id FROM subscriptions WHERE stripe_customer_id = $1)`,
        [sub.customer as string]
      );
      await query(
        `UPDATE subscriptions SET status = 'canceled', updated_at = NOW()
         WHERE stripe_customer_id = $1`,
        [sub.customer as string]
      );
      break;
    }

    default:
      // Unhandled events are logged but not errored
      break;
  }
}
