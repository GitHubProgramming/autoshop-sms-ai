import { FastifyInstance } from "fastify";
import { z } from "zod";
import { validateTwilioSignature } from "../../middleware/twilio-validate";
import { query } from "../../db/client";

const TwilioVoiceBody = z.object({
  CallSid: z.string(),
  To: z.string(), // shop's Twilio number
  From: z.string(), // customer's phone
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

      const { To, From } = parsed.data;

      // Look up the forwarding number for this Twilio number
      let forwardTo: string | null = null;
      let shopName: string | null = null;
      try {
        const rows = await query<{
          forward_to: string | null;
          shop_name: string | null;
        }>(
          `SELECT tpn.forward_to, t.shop_name
           FROM tenant_phone_numbers tpn
           JOIN tenants t ON t.id = tpn.tenant_id
           WHERE tpn.phone_number = $1
             AND tpn.status = 'active'
           LIMIT 1`,
          [To]
        );

        if (rows.length > 0) {
          forwardTo = rows[0].forward_to;
          shopName = rows[0].shop_name;
        }
      } catch (err) {
        request.log.error({ err, to: To }, "Failed to look up forwarding number");
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
