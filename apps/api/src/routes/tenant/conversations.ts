import { FastifyInstance } from "fastify";
import { query } from "../../db/client";
import { requireAuth } from "../../middleware/require-auth";

/**
 * GET /tenant/conversations
 *
 * Returns all open conversations for the authenticated tenant.
 * This is the authoritative source for the Conversations page,
 * aligned with the "Open Conversations" KPI (status = 'open').
 */
export async function tenantConversationsRoute(app: FastifyInstance) {
  app.get("/conversations", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };

    const rows = await query(
      `SELECT id, customer_phone, status, turn_count,
              opened_at, last_message_at, closed_at, close_reason
       FROM conversations
       WHERE tenant_id = $1 AND status = 'open'
       ORDER BY last_message_at DESC`,
      [tenantId]
    );

    return reply.status(200).send({
      conversations: rows,
      count: (rows as any[]).length,
    });
  });

  /**
   * GET /tenant/conversations/:id
   *
   * Returns conversation metadata + full message thread for a conversation
   * belonging to the authenticated tenant. Used by the dashboard slide panel.
   */
  app.get("/conversations/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };
    const { id } = request.params as { id: string };

    const [convRows, messagesRows] = await Promise.all([
      query(
        `SELECT id, tenant_id, customer_phone, status, turn_count,
                opened_at, last_message_at, closed_at, close_reason
         FROM conversations
         WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      ),
      query(
        `SELECT id, direction, body, sent_at
         FROM messages
         WHERE conversation_id = $1 AND tenant_id = $2
         ORDER BY sent_at ASC`,
        [id, tenantId]
      ),
    ]);

    if (!(convRows as any[]).length) {
      return reply.status(404).send({ error: "Conversation not found" });
    }

    return reply.status(200).send({
      conversation: (convRows as any[])[0],
      messages: messagesRows,
    });
  });

  /**
   * PATCH /tenant/conversations/:id/resolve
   *
   * Closes a conversation with status='closed', close_reason='user_closed'.
   * Only allowed on conversations that are currently 'open'.
   */
  app.patch("/conversations/:id/resolve", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };
    const { id } = request.params as { id: string };

    const result = await query(
      `UPDATE conversations
       SET status = 'closed', close_reason = 'user_closed', closed_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND status = 'open'
       RETURNING id, status, close_reason`,
      [id, tenantId]
    );

    if (!(result as any[]).length) {
      return reply.status(404).send({ error: "Conversation not found or already closed" });
    }

    return reply.status(200).send((result as any[])[0]);
  });
}
