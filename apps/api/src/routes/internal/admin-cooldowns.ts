import { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../../db/client";
import { requireInternal } from "../../middleware/require-internal";

const E164 = z.string().regex(/^\+\d{7,15}$/, "Must be E.164 phone format");

const BodySchema = z.object({
  tenantId: z.string().uuid(),
  customerPhone: E164,
  closeOpen: z.boolean().optional(),
});

/**
 * POST /internal/admin/cooldowns/clear
 *
 * Operational tool for pilot debugging: removes the
 * conversation_cooldowns row that blocks a customer phone from being
 * re-engaged within 1 hour of a previous conversation closing.
 *
 * Optional `closeOpen: true` also closes any currently-open
 * conversation rows for that (tenant, customerPhone) pair so the next
 * inbound call/SMS opens a fresh thread instead of resuming.
 *
 * Internal-only — guarded by requireInternal (x-internal-key header).
 */
export async function adminCooldownsRoute(app: FastifyInstance) {
  app.post(
    "/admin/cooldowns/clear",
    { preHandler: [requireInternal] },
    async (request, reply) => {
      const parsed = BodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Validation failed",
          details: parsed.error.issues.map(
            (i) => `${i.path.join(".")}: ${i.message}`
          ),
        });
      }

      const { tenantId, customerPhone, closeOpen } = parsed.data;

      const cooldownRows = await query<{ id: string }>(
        `DELETE FROM conversation_cooldowns
          WHERE tenant_id = $1 AND customer_phone = $2
          RETURNING tenant_id AS id`,
        [tenantId, customerPhone]
      );
      const deleted = cooldownRows.length;

      let closed: number | undefined;
      if (closeOpen) {
        const closedRows = await query<{ id: string }>(
          `UPDATE conversations
              SET status = 'closed',
                  close_reason = 'admin_cleared',
                  closed_at = NOW()
            WHERE tenant_id = $1
              AND customer_phone = $2
              AND status = 'open'
            RETURNING id`,
          [tenantId, customerPhone]
        );
        closed = closedRows.length;
      }

      request.log.info(
        { tenantId, customerPhone, deleted, closed: closed ?? null },
        "admin/cooldowns/clear"
      );

      return reply.status(200).send(
        closeOpen
          ? { ok: true, deleted, closed }
          : { ok: true, deleted }
      );
    }
  );
}
