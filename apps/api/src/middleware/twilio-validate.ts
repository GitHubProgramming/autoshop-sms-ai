import { FastifyRequest, FastifyReply } from "fastify";
import twilio from "twilio";

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
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!authToken) {
    request.log.error("TWILIO_AUTH_TOKEN not set — rejecting webhook");
    await reply.status(500).send({ error: "Server misconfiguration" });
    return;
  }

  // In development/test, skip validation if explicitly disabled
  if (process.env.NODE_ENV === "development" && process.env.SKIP_TWILIO_VALIDATION === "true") {
    request.log.warn("⚠️  Twilio signature validation DISABLED (dev mode)");
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
