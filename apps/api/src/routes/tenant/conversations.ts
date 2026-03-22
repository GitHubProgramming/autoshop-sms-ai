import { FastifyInstance } from "fastify";
import { query } from "../../db/client";
import { requireAuth } from "../../middleware/require-auth";
import { sendTwilioSms } from "../../services/missed-call-sms";

/**
 * GET /tenant/conversations
 *
 * Returns recent conversations (all statuses) for the authenticated tenant.
 * This is the authoritative source for the Conversations page.
 */
export async function tenantConversationsRoute(app: FastifyInstance) {
  app.get("/conversations", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };

    const rows = await query(
      `SELECT id, customer_phone, status, turn_count,
              opened_at, last_message_at, closed_at, close_reason
       FROM conversations
       WHERE tenant_id = $1
       ORDER BY last_message_at DESC
       LIMIT 200`,
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

  /**
   * POST /tenant/conversations/:id/messages
   *
   * Sends a manual outbound SMS to the customer in this conversation.
   * Reuses existing Twilio send infrastructure and message logging pattern.
   */
  app.post("/conversations/:id/messages", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };
    const { id } = request.params as { id: string };
    const { body: messageBody } = (request.body as { body?: string }) || {};

    // Validate body
    const trimmed = (messageBody || "").trim();
    if (!trimmed) {
      return reply.status(400).send({ error: "Message body is required" });
    }
    if (trimmed.length > 1600) {
      return reply.status(400).send({ error: "Message body too long (max 1600 characters)" });
    }

    // Load conversation and verify tenant ownership
    const convRows = await query(
      `SELECT id, customer_phone, status
       FROM conversations
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );

    if (!(convRows as any[]).length) {
      return reply.status(404).send({ error: "Conversation not found" });
    }

    const conv = (convRows as any[])[0];

    // Send SMS via Twilio
    const twilioResult = await sendTwilioSms(conv.customer_phone, trimmed);

    if (twilioResult.error) {
      request.log.error({ err: twilioResult.error }, "Manual SMS send failed");
      return reply.status(502).send({ error: "Failed to send SMS" });
    }

    // Log outbound message (same pattern as AI replies)
    const msgRows = await query(
      `INSERT INTO messages (tenant_id, conversation_id, direction, body, sms_segments)
       VALUES ($1, $2, 'outbound', $3, $4)
       RETURNING id, direction, body, sent_at`,
      [tenantId, id, trimmed, twilioResult.numSegments ?? 1]
    );

    // Touch conversation to update last_message_at
    await query(`SELECT touch_conversation($1, $2)`, [id, tenantId]);

    const msg = (msgRows as any[])[0];

    return reply.status(200).send({
      ok: true,
      message: {
        id: msg.id,
        direction: msg.direction,
        body: msg.body,
        sent_at: msg.sent_at,
        provider_message_id: twilioResult.sid,
      },
    });
  });
}
