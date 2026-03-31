import { FastifyRequest, FastifyReply } from "fastify";
import twilio from "twilio";
import { getConfig } from "../db/app-config";

/**
 * Validates Twilio webhook signature.
 * Must be applied to ALL Twilio webhook endpoints.
 *
 * Twilio signs every request with HMAC-SHA1 using your auth token.
 * Without this, anyone can forge SMS webhooks.
 */
export async function validateTwilioSignature(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authToken = await getConfig("TWILIO_AUTH_TOKEN");

  if (!authToken) {
    request.log.error("TWILIO_AUTH_TOKEN not set — rejecting webhook");
    await reply.status(500).send({ error: "Server misconfiguration" });
    return;
  }

  // Skip validation if explicitly disabled (local dev only — never production)
  if (process.env.SKIP_TWILIO_VALIDATION === "true") {
    if (process.env.NODE_ENV === "production") {
      request.log.error("SKIP_TWILIO_VALIDATION=true is forbidden in production — rejecting webhook");
      await reply.status(403).send({ error: "Webhook validation required in production" });
      return;
    }
    request.log.warn(`⚠️  Twilio signature validation DISABLED (SKIP_TWILIO_VALIDATION=true, NODE_ENV=${process.env.NODE_ENV})`);
    return;
  }

  const signature = request.headers["x-twilio-signature"] as string;
  if (!signature) {
    await reply.status(403).send({ error: "Missing Twilio signature" });
    return;
  }

  // Reconstruct the full URL Twilio signed
  const protocol = request.headers["x-forwarded-proto"] ?? "http";
  const host = request.headers["x-forwarded-host"] ?? request.hostname;
  const url = `${protocol}://${host}${request.url}`;

  const body = request.body as Record<string, string>;
  const isValid = twilio.validateRequest(authToken, signature, url, body);

  if (!isValid) {
    request.log.warn({ url, signature }, "Invalid Twilio signature — rejecting");
    await reply.status(403).send({ error: "Invalid Twilio signature" });
    return;
  }
}
