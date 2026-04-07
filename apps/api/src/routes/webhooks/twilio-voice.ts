import { FastifyInstance } from "fastify";
import { z } from "zod";
import { validateTwilioSignature } from "../../middleware/twilio-validate";
import { query } from "../../db/client";
import { deduplicateWebhook } from "../../db/webhook-events";

// Permissive E.164 — accepts any international phone format Twilio sends
const E164 = z.string().regex(/^\+\d{7,15}$/, "Must be E.164 phone format");

const TwilioVoiceBody = z.object({
  CallSid: z.string(),
  To: E164,        // shop's Twilio number
  From: E164,      // customer's phone
  CallStatus: z.string().optional(),
});

/**
 * Twilio Voice Webhook — handles incoming calls to a shop's Twilio number.
 *
 * Returns TwiML that:
 * 1. Dials the shop's real phone number (forward_to)
 * 2. If no answer after timeout → Twilio fires the voice-status callback
 *    with CallStatus "no-answer", which triggers the missed-call SMS flow.
 *
 * This is the entry point that makes the entire missed-call pipeline work:
 *   incoming call → ring shop phone → no answer → voice-status → SMS → AI → booking
 */
export async function twilioVoiceRoute(app: FastifyInstance) {
  app.post(
    "/voice",
    { preHandler: validateTwilioSignature },
    async (request, reply) => {
      const parsed = TwilioVoiceBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid body" });
      }

      const { CallSid, To, From } = parsed.data;

      // ── Idempotency (Twilio retries voice webhooks on timeout) ────────────
      const dedup = await deduplicateWebhook("twilio_voice", CallSid);
      if (dedup.isDuplicate) {
        request.log.info(
          { CallSid, source: "twilio_voice", event: "webhook_duplicate_detected" },
          "Duplicate voice webhook — skipping"
        );
        return reply.status(200).type("text/xml").send("<Response/>");
      }

      // Look up the forwarding number for this Twilio number
      let forwardTo: string | null = null;
      let shopName: string | null = null;
      let tenantId: string | null = null;
      try {
        const rows = await query<{
          tenant_id: string;
          forward_to: string | null;
          shop_name: string | null;
        }>(
          `SELECT tpn.tenant_id, tpn.forward_to, t.shop_name
           FROM tenant_phone_numbers tpn
           JOIN tenants t ON t.id = tpn.tenant_id
           WHERE tpn.phone_number = $1
             AND tpn.status = 'active'
           LIMIT 1`,
          [To]
        );

        if (rows.length > 0) {
          tenantId = rows[0].tenant_id;
          forwardTo = rows[0].forward_to;
          shopName = rows[0].shop_name;
        }
      } catch (err) {
        request.log.error({ err, to: To }, "Failed to look up forwarding number");
      }

      // ── Forwarding test detection ───────────────────────────────────────
      // If this tenant has an active call-forwarding test, the inbound call
      // is the forwarded test call arriving back. Mark it detected and
      // return a short TwiML response instead of normal call handling.
      if (tenantId) {
        try {
          const { redis: redisClient } = await import("../../queues/redis");
          const fwdTestRaw = await redisClient.get(`fwd_test:${tenantId}`);
          if (fwdTestRaw) {
            const fwdTest = JSON.parse(fwdTestRaw);
            fwdTest.forwardingDetected = true;
            await redisClient.setex(`fwd_test:${tenantId}`, 120, JSON.stringify(fwdTest));
            request.log.info(
              { tenantId, CallSid },
              "Forwarding test — inbound call detected on voice webhook"
            );
            const twiml = [
              '<?xml version="1.0" encoding="UTF-8"?>',
              "<Response>",
              '  <Say voice="alice">Forwarding test successful. You can hang up now.</Say>',
              "  <Hangup/>",
              "</Response>",
            ].join("\n");
            return reply.status(200).type("text/xml").send(twiml);
          }
        } catch {
          // Redis failure — continue normal flow
        }
      }

      // Build the voice-status callback URL for missed-call detection
      const baseUrl = process.env.API_BASE_URL ?? `https://${request.hostname}`;
      const statusCallback = `${baseUrl}/webhooks/twilio/voice-status`;

      if (!forwardTo) {
        // No forwarding number configured — go straight to voicemail-style
        // message and fire the voice-status callback so missed-call SMS triggers.
        request.log.warn(
          { to: To },
          "No forward_to number configured — sending sorry message"
        );

        const twiml = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          "<Response>",
          `  <Say voice="alice">Sorry, we can't take your call right now. We'll text you shortly to help you out.</Say>`,
          "  <Hangup/>",
          "</Response>",
        ].join("\n");

        return reply.status(200).type("text/xml").send(twiml);
      }

      // Forward the call to the shop's real phone.
      // timeout: ring for 20 seconds before giving up.
      // action: Twilio POSTs to voice-status when the Dial completes,
      //   with DialCallStatus = no-answer|busy|failed|completed.
      //
      // The callerId is set to the customer's number so the shop sees who's calling.
      const twiml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<Response>",
        `  <Dial timeout="20" action="${statusCallback}" callerId="${From}">`,
        `    <Number>${forwardTo}</Number>`,
        "  </Dial>",
        "</Response>",
      ].join("\n");

      request.log.info(
        { from: From, to: To, forwardTo, shopName },
        "Forwarding call to shop"
      );

      return reply.status(200).type("text/xml").send(twiml);
    }
  );
}
