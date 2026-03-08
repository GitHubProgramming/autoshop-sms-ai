import { FastifyInstance } from "fastify";
import { z } from "zod";
import { validateTwilioSignature } from "../../middleware/twilio-validate";
import { getTenantByPhoneNumber, getBlockReason } from "../../db/tenants";
import {
  smsInboundQueue,
  checkIdempotency,
  markIdempotency,
} from "../../queues/redis";

// Twilio sends form-encoded body
const TwilioSmsBody = z.object({
  MessageSid: z.string(),
  AccountSid: z.string(),
  From: z.string(), // customer's phone
  To: z.string(),   // our Twilio number (= tenant's number)
  Body: z.string(),
  NumMedia: z.string().optional(),
});

export async function twilioSmsRoute(app: FastifyInstance) {
  app.post(
    "/sms",
    { preHandler: validateTwilioSignature },
    async (request, reply) => {
      const parsed = TwilioSmsBody.safeParse(request.body);
      if (!parsed.success) {
        request.log.warn({ body: request.body }, "Invalid Twilio SMS body");
        return reply.status(400).send({ error: "Invalid body" });
      }

      const { MessageSid, From, To, Body } = parsed.data;

      // ── 1. Idempotency (Twilio retries if no 200 within 15s) ──────────────
      const alreadyProcessed = await checkIdempotency(`twilio:${MessageSid}`);
      if (alreadyProcessed) {
        request.log.info({ MessageSid }, "Duplicate webhook — skipping");
        return reply.status(200).type("text/xml").send("<Response/>");
      }
      await markIdempotency(`twilio:${MessageSid}`);

      // ── 2. Tenant lookup by inbound phone number ───────────────────────────
      const tenant = await getTenantByPhoneNumber(To);
      if (!tenant) {
        request.log.warn({ to: To }, "No tenant found for phone number");
        // Return 200 to Twilio (avoid retry storms), but don't process
        return reply.status(200).type("text/xml").send("<Response/>");
      }

      // ── 3. Enforcement check ───────────────────────────────────────────────
      const blockReason = getBlockReason(tenant);
      if (blockReason) {
        request.log.info(
          { tenantId: tenant.id, blockReason },
          "Tenant blocked — queuing service-unavailable reply"
        );
        // Enqueue "service unavailable" SMS reply so the customer gets feedback.
        // WF-001 in n8n must handle jobName="service-unavailable-reply" payloads.
        await smsInboundQueue.add(
          "service-unavailable-reply",
          {
            type: "service-unavailable-reply",
            tenantId: tenant.id,
            customerPhone: From,
            ourPhone: To,
            blockReason,
          },
          { jobId: `block-${MessageSid}` }
        );
        return reply.status(200).type("text/xml").send("<Response/>");
      }

      // ── 4. Check if active plan is at soft limit (paid, 100% used) ─────────
      const atSoftLimit =
        tenant.billing_status === "active" &&
        tenant.conv_used_this_cycle >= tenant.conv_limit_this_cycle;

      // ── 5. Enqueue for async processing — respond to Twilio immediately ────
      await smsInboundQueue.add(
        "process-sms",
        {
          tenantId: tenant.id,
          customerPhone: From,
          ourPhone: To,
          body: Body,
          messageSid: MessageSid,
          atSoftLimit,
        },
        {
          jobId: `sms-${MessageSid}`, // BullMQ dedup key
        }
      );

      request.log.info(
        { tenantId: tenant.id, from: From, messageSid: MessageSid },
        "SMS job enqueued"
      );

      // Must respond with TwiML — empty = no immediate reply (worker sends reply)
      return reply.status(200).type("text/xml").send("<Response/>");
    }
  );
}
