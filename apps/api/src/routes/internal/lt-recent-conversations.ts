import { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../../db/client";
import { requireInternal } from "../../middleware/require-internal";
import { resolveLtTenantId } from "../../utils/lt-tenant";

/**
 * GET /internal/lt-recent-conversations?tenant=<uuid|slug>&limit=<1..50>
 *
 * Read-side companion to /internal/lt-send-sms and /internal/lt-log-conversation.
 * Returns the most recent messages (both directions) for the LT pilot tenant so
 * smoke tests and the LT dashboard can verify writes end-to-end.
 *
 * Returns 200 with an empty array when no rows match (matches project convention).
 * Internal only — requires x-internal-key header.
 */

const QuerySchema = z.object({
  tenant: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

type Row = {
  id: string;
  customer_phone: string;
  direction: string;
  source: string | null;
  body: string;
  sent_at: string;
};

export async function ltRecentConversationsRoute(app: FastifyInstance) {
  app.get(
    "/lt-recent-conversations",
    { preHandler: [requireInternal] },
    async (request, reply) => {
      const parsed = QuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          ok: false,
          error: "validation_failed",
          details: parsed.error.issues.map(
            (i) => `${i.path.join(".")}: ${i.message}`
          ),
        });
      }

      const { tenant, limit } = parsed.data;
      const tenantUuid = resolveLtTenantId(tenant);
      if (!tenantUuid) {
        return reply.status(400).send({
          ok: false,
          error: "unknown_tenant",
        });
      }

      const rows = await query<Row>(
        `SELECT m.id,
                c.customer_phone,
                m.direction,
                m.source,
                m.body,
                m.sent_at
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
          WHERE m.tenant_id = $1
          ORDER BY m.sent_at DESC
          LIMIT $2`,
        [tenantUuid, limit]
      );

      return reply.status(200).send({
        ok: true,
        count: rows.length,
        conversations: rows.map((r) => ({
          id: r.id,
          caller_number: r.customer_phone,
          direction: r.direction,
          source: r.source,
          message_text: r.body,
          created_at: r.sent_at,
        })),
      });
    }
  );
}
