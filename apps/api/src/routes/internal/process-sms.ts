import { FastifyInstance } from "fastify";
import { z } from "zod";
import { processSms } from "../../services/process-sms";

const BodySchema = z.object({
  tenantId: z.string().uuid(),
  customerPhone: z.string().min(1),
  ourPhone: z.string().min(1),
  body: z.string().min(1),
  messageSid: z.string().min(1),
  atSoftLimit: z.boolean().default(false),
});

/**
 * POST /internal/process-sms
 *
 * Full AI conversation processing for inbound SMS replies.
 * Replaces n8n WF-001 + WF-002 with an API-native flow:
 *   inbound SMS → conversation → AI response → booking detection
 *   → appointment creation → calendar sync → SMS reply
 *
 * Called by: sms-inbound worker for "process-sms" jobs.
 * Internal only — NOT exposed externally.
 */
export async function processSmsRoute(app: FastifyInstance) {
  app.post("/process-sms", async (request, reply) => {
    const parsed = BodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`
        ),
      });
    }

    const result = await processSms(parsed.data);

    request.log.info(
      {
        tenantId: parsed.data.tenantId,
        conversationId: result.conversationId,
        success: result.success,
        smsSent: result.smsSent,
        isBooked: result.isBooked,
        calendarSynced: result.calendarSynced,
      },
      result.success
        ? "SMS processed"
        : `SMS processing failed: ${result.error}`
    );

    if (!result.success) {
      return reply.status(500).send(result);
    }

    return reply.status(200).send(result);
  });
}
