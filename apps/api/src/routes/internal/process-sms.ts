import { FastifyInstance } from "fastify";
import { z } from "zod";
import { processSms } from "../../services/process-sms";
import { resumeTrace } from "../../services/pipeline-trace";
import { alertFromTraceFailure } from "../../services/pipeline-alerts";
import { requireInternal } from "../../middleware/require-internal";

const BodySchema = z.object({
  tenantId: z.string().uuid(),
  customerPhone: z.string().min(1),
  ourPhone: z.string().min(1),
  body: z.string().min(1),
  messageSid: z.string().min(1),
  atSoftLimit: z.boolean().default(false),
  traceId: z.string().uuid().nullable().optional(),
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
  app.post("/process-sms", { preHandler: [requireInternal] }, async (request, reply) => {
    const parsed = BodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`
        ),
      });
    }

    const { traceId, ...smsInput } = parsed.data;
    const trace = traceId ? await resumeTrace(traceId).catch(() => null) : null;

    if (trace) {
      await trace.step("worker_picked_up", "ok", "process-sms handler started");
    }

    const result = await processSms(smsInput);

    // ── Record trace steps from result ──────────────────────────────────
    if (trace) {
      try {
        if (result.conversationId) {
          await trace.step("conversation_resolved", "ok", `conv: ${result.conversationId.slice(0, 8)}`);
        }
        if (result.aiResponse) {
          await trace.step("ai_replied", "ok", `${result.aiResponse.length} chars`);
        } else if (result.error?.includes("OpenAI")) {
          await trace.step("ai_replied", "fail", result.error);
        }
        if (result.isBooked) {
          await trace.step("booking_detected", "ok", `appointment: ${result.appointmentId?.slice(0, 8) ?? "n/a"}`);
        }
        if (result.calendarSynced) {
          await trace.step("calendar_synced", "ok", "Google Calendar event created");
        } else if (result.isBooked) {
          await trace.step("calendar_synced", result.bookingState === "FAILED" ? "fail" : "skip",
            result.error?.includes("Calendar") ? result.error : "Calendar sync not completed");
        }
        if (result.smsSent) {
          await trace.step("sms_sent", "ok", `Reply SMS sent to customer`);
        } else if (result.error?.includes("SMS")) {
          await trace.step("sms_sent", "fail", result.error);
        }

        if (result.success) {
          await trace.complete();
        } else {
          await trace.fail(result.error ?? "Unknown error");
        }
      } catch { /* non-fatal */ }
    }

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
      // Raise pipeline alert (non-fatal)
      try {
        await alertFromTraceFailure(
          parsed.data.tenantId,
          traceId ?? null,
          result.error,
          parsed.data.customerPhone
        );
      } catch { /* non-fatal */ }

      return reply.status(500).send(result);
    }

    return reply.status(200).send(result);
  });
}
