/**
 * GET /internal/admin/tenants
 * GET /internal/admin/signup-attempts
 *
 * Protected by X-Internal-Key header (must match INTERNAL_API_KEY env var).
 * Use these to inspect who signed up and who attempted but did not complete.
 *
 * Query with:
 *   curl -H "X-Internal-Key: $INTERNAL_API_KEY" http://localhost:3000/internal/admin/tenants
 *   curl -H "X-Internal-Key: $INTERNAL_API_KEY" http://localhost:3000/internal/admin/signup-attempts
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { query } from "../../db/client";

async function internalKeyGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key = process.env.INTERNAL_API_KEY;
  if (!key) {
    await reply.status(503).send({ error: "INTERNAL_API_KEY not set" });
    return;
  }
  if (request.headers["x-internal-key"] !== key) {
    request.log.warn({ ip: request.ip }, "Unauthorized admin request rejected");
    await reply.status(401).send({ error: "Unauthorized" });
    return;
  }
}

export async function adminRoute(app: FastifyInstance) {
  /**
   * GET /internal/admin/tenants
   *
   * Returns all tenants with:
   *   - created_at, owner_email, shop_name, auth users
   *   - billing_status, plan_id
   *   - trial_days_left (computed)
   *   - conv_used_this_cycle / conv_limit_this_cycle
   *   - onboarding_complete (heuristic: has a phone number provisioned)
   */
  app.get(
    "/admin/tenants",
    { preHandler: [internalKeyGuard] },
    async (_request, reply) => {
      const tenants = await query<{
        id:                   string;
        shop_name:            string;
        owner_email:          string;
        owner_phone:          string | null;
        billing_status:       string;
        plan_id:              string | null;
        trial_started_at:     string;
        trial_ends_at:        string;
        conv_used_this_cycle: number;
        conv_limit_this_cycle:number;
        created_at:           string;
        has_phone:            boolean;
        user_providers:       string;
      }>(
        `SELECT
           t.id,
           t.shop_name,
           t.owner_email,
           t.owner_phone,
           t.billing_status,
           t.plan_id,
           t.trial_started_at,
           t.trial_ends_at,
           t.conv_used_this_cycle,
           t.conv_limit_this_cycle,
           t.created_at,
           EXISTS (
             SELECT 1 FROM tenant_phone_numbers tpn
             WHERE tpn.tenant_id = t.id AND tpn.status = 'active'
           ) AS has_phone,
           COALESCE(
             (SELECT string_agg(DISTINCT u.auth_provider, ',')
              FROM users u WHERE u.tenant_id = t.id),
             'unknown'
           ) AS user_providers
         FROM tenants t
         ORDER BY t.created_at DESC`,
        []
      );

      const enriched = tenants.map((t) => {
        const trialDaysLeft = t.billing_status === "trial"
          ? Math.max(0, Math.ceil(
              (new Date(t.trial_ends_at).getTime() - Date.now()) / 86_400_000
            ))
          : null;

        return {
          ...t,
          trial_days_left:      trialDaysLeft,
          onboarding_complete:  t.has_phone,
          auth_provider:        t.user_providers,
        };
      });

      return reply.status(200).send({
        count:   enriched.length,
        tenants: enriched,
      });
    }
  );

  /**
   * GET /internal/admin/signup-attempts
   *
   * Returns recent signup attempts (up to 500).
   * Use ?status=started|completed|failed|abandoned to filter.
   * Use ?provider=email|google to filter by auth provider.
   */
  app.get(
    "/admin/signup-attempts",
    { preHandler: [internalKeyGuard] },
    async (request, reply) => {
      const q = request.query as Record<string, string>;
      const statusFilter   = q.status   ?? null;
      const providerFilter = q.provider ?? null;

      const attempts = await query(
        `SELECT
           id, email, provider, status, failure_reason,
           tenant_id, ip_address, created_at, completed_at,
           CASE WHEN completed_at IS NOT NULL
             THEN ROUND(EXTRACT(EPOCH FROM (completed_at - created_at)))
             ELSE NULL
           END AS duration_seconds
         FROM signup_attempts
         WHERE ($1::text IS NULL OR status   = $1)
           AND ($2::text IS NULL OR provider = $2)
         ORDER BY created_at DESC
         LIMIT 500`,
        [statusFilter, providerFilter]
      );

      return reply.status(200).send({
        count:    attempts.length,
        attempts,
      });
    }
  );
}
