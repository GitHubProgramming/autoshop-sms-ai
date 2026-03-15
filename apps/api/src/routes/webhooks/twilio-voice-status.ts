import { FastifyInstance } from "fastify";
import { z } from "zod";
import { validateTwilioSignature } from "../../middleware/twilio-validate";
import { getTenantByPhoneNumber } from "../../db/tenants";
import { smsInboundQueue, checkIdempotency, markIdempotency } from "../../queues/redis";

const TwilioVoiceStatusBody = z.object({
  CallSid: z.string(),
  CallStatus: z.string().optional(),     // from statusCallback
  DialCallStatus: z.string().optional(), // from <Dial action="...">
  To: z.string(),         // shop's number
  From: z.string(),       // customer's number
  Direction: z.string().optional(),
});

/**
 * Twilio calls this when a call to the shop's number ends.
 *
 * Two trigger paths:
 *   1. <Dial action="..."> callback → sends DialCallStatus (no-answer, busy, failed, completed)
 *   2. StatusCallback URL → sends CallStatus
 *
 * If status = 'no-answer' | 'busy' | 'failed' → trigger missed-call SMS flow.
 */
export async function twilioVoiceStatusRoute(app: FastifyInstance) {
  app.post(
    "/voice-status",
    { preHandler: validateTwilioSignature },
    async (request, reply) => {
      const parsed = TwilioVoiceStatusBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid body" });
      }

      // DialCallStatus takes priority (from <Dial action>), fall back to CallStatus
      const { CallSid, DialCallStatus, To, From } = parsed.data;
      const CallStatus = DialCallStatus ?? parsed.data.CallStatus ?? "";

      const MISSED_STATUSES = ["no-answer", "busy", "failed"];
      if (!MISSED_STATUSES.includes(CallStatus)) {
        // Not a missed call — ignore
        return reply.status(200).type("text/xml").send("<Response/>");
      }

      // Idempotency
      const key = `voice:${CallSid}`;
      if (await checkIdempotency(key)) {
        return reply.status(200).type("text/xml").send("<Response/>");
      }
      await markIdempotency(key);

      const tenant = await getTenantByPhoneNumber(To);
      if (!tenant) {
        request.log.warn({ to: To }, "No tenant found for voice status webhook");
        return reply.status(200).type("text/xml").send("<Response/>");
      }

      // Enqueue missed-call SMS trigger
      // This must fire within 5–20 seconds — worker sends the first SMS
      // Wrapped in try/catch: always return 200 to Twilio even if Redis is down.
      try {
        await smsInboundQueue.add(
          "missed-call-trigger",
          {
            tenantId: tenant.id,
            customerPhone: From,
            ourPhone: To,
            callSid: CallSid,
            callStatus: CallStatus,
            triggerType: "missed_call",
          },
          {
            jobId: `missed-call-${CallSid}`,
            priority: 1, // High priority — speed matters for first SMS
          }
        );

        request.log.info(
          { tenantId: tenant.id, callSid: CallSid, callStatus: CallStatus },
          "Missed call job enqueued"
        );
      } catch (err) {
        request.log.error(
          { err, tenantId: tenant.id, callSid: CallSid },
          "Failed to enqueue missed-call job — Redis may be down"
        );
      }

      return reply.status(200).type("text/xml").send("<Response/>");
    }
  );
}
