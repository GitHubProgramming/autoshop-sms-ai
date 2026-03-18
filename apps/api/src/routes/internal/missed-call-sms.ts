import { FastifyInstance } from "fastify";
import { z } from "zod";
import { handleMissedCallSms } from "../../services/missed-call-sms";
import { resumeTrace } from "../../services/pipeline-trace";
import { alertFromTraceFailure } from "../../services/pipeline-alerts";

const BodySchema = z.object({
  tenantId: z.string().uuid(),
  customerPhone: z.string().min(1),
  ourPhone: z.string().min(1),
  callSid: z.string().min(1),
  callStatus: z.string().min(1),
  traceId: z.string().uuid().nullable().optional(),
});

/**
 * POST /internal/missed-call-sms
 *
 * Entry point of the core pipeline: handles a missed call by sending
 * the initial outbound SMS that starts the AI conversation flow.
 *
 * Called by the sms-inbound worker when job.name === "missed-call-trigger".
 * Internal only — NOT exposed externally.
 */
export async function missedCallSmsRoute(app: FastifyInstance) {
  app.post("/missed-call-sms", async (request, reply) => {
    const parsed = BodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`
        ),
      });
    }

    const { traceId, ...missedCallInput } = parsed.data;
    const trace = traceId ? await resumeTrace(traceId).catch(() => null) : null;

    if (trace) {
      await trace.step("worker_picked_up", "ok", "missed-call-sms handler started");
    }

    const result = await handleMissedCallSms(missedCallInput);

    // ── Record trace steps from result ──────────────────────────────────
    if (trace) {
      try {
        if (result.conversationId) {
          await trace.step("conversation_created", "ok", `conv: ${result.conversationId.slice(0, 8)}`);
        }
        if (result.smsSent) {
          await trace.step("sms_sent", "ok", `Initial SMS sent (sid: ${result.twilioSid?.slice(0, 10) ?? "n/a"})`);
        } else {
          await trace.step("sms_sent", "fail", result.error ?? "SMS not sent");
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
        callSid: parsed.data.callSid,
        success: result.success,
        smsSent: result.smsSent,
        conversationId: result.conversationId,
      },
      result.success
        ? "Missed call SMS sent"
        : `Missed call SMS failed: ${result.error}`
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

      const status =
        result.error === "Tenant not found"
          ? 404
          : result.error === "Tenant billing is blocked"
            ? 402
            : 500;
      return reply.status(status).send(result);
    }

    return reply.status(200).send(result);
  });
}
