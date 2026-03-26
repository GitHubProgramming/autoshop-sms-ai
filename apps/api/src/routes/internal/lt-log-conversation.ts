import { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../../db/client";
import { requireInternal } from "../../middleware/require-internal";

const BodySchema = z.object({
  tenantId: z.string().uuid(),
  customerPhone: z.string().min(1),
  inboundBody: z.string().min(1),
  outboundBody: z.string().optional(),
  bookingDetected: z.boolean().default(false),
  source: z.enum(["sms", "missed_call", "voice"]).default("sms"),
});

/**
 * POST /internal/lt-log-conversation
 *
 * Lightweight logging-only endpoint for LT n8n workflows to write
 * conversations and messages into Postgres so they appear in the
 * tenant dashboard.
 *
 * This endpoint does NOT send SMS, call OpenAI, or create appointments.
 * It only persists data for dashboard visibility.
 *
 * Called by: LT Proteros n8n workflows (SMS Booking Agent, Missed Call to SMS)
 * Internal only — requires x-internal-key header.
 */
export async function ltLogConversationRoute(app: FastifyInstance) {
  app.post(
    "/lt-log-conversation",
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

      const { tenantId, customerPhone, inboundBody, outboundBody, bookingDetected, source } =
        parsed.data;

      // Verify tenant exists
      const tenantRows = await query<{ id: string }>(
        `SELECT id FROM tenants WHERE id = $1 LIMIT 1`,
        [tenantId]
      );
      if (tenantRows.length === 0) {
        return reply.status(404).send({ error: "Tenant not found" });
      }

      // Get or create conversation (using tenant-scoped function)
      const convRows = await query<{ id: string; status: string }>(
        `SELECT id, status FROM conversations
         WHERE tenant_id = $1 AND customer_phone = $2 AND status = 'open'
         ORDER BY opened_at DESC LIMIT 1`,
        [tenantId, customerPhone]
      );

      let conversationId: string;

      if (convRows.length > 0) {
        conversationId = convRows[0].id;
        // Touch: update last_message_at and increment turn_count
        await query(
          `UPDATE conversations
              SET last_message_at = NOW(), turn_count = turn_count + 1
            WHERE id = $1`,
          [conversationId]
        );
      } else {
        // Create new conversation
        const newConv = await query<{ id: string }>(
          `INSERT INTO conversations (tenant_id, customer_phone, status, opened_at, last_message_at, turn_count)
           VALUES ($1, $2, 'open', NOW(), NOW(), 1)
           RETURNING id`,
          [tenantId, customerPhone]
        );
        conversationId = newConv[0].id;
      }

      // Log inbound message
      await query(
        `INSERT INTO messages (tenant_id, conversation_id, direction, body, sent_at)
         VALUES ($1, $2, 'inbound', $3, NOW())`,
        [tenantId, conversationId, inboundBody]
      );

      // Log outbound message (AI reply) if provided
      if (outboundBody) {
        await query(
          `INSERT INTO messages (tenant_id, conversation_id, direction, body, sent_at)
           VALUES ($1, $2, 'outbound', $3, NOW())`,
          [tenantId, conversationId, outboundBody]
        );
      }

      // If booking detected, update conversation status
      if (bookingDetected) {
        await query(
          `UPDATE conversations SET status = 'booked', closed_at = NOW() WHERE id = $1`,
          [conversationId]
        );
      }

      request.log.info(
        { tenantId, conversationId, customerPhone, source, bookingDetected },
        "LT conversation logged"
      );

      return reply.status(200).send({
        success: true,
        conversationId,
        messagesLogged: outboundBody ? 2 : 1,
        bookingDetected,
      });
    }
  );
}
