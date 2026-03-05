import { FastifyRequest, FastifyReply } from 'fastify';
import twilio from 'twilio';

export async function validateTwilioSignature(
  req: FastifyRequest,
  reply: FastifyReply
) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    req.log.error('TWILIO_AUTH_TOKEN not set');
    return reply.code(500).send({ error: 'Server misconfiguration' });
  }

  const signature = req.headers['x-twilio-signature'] as string;
  if (!signature) {
    return reply.code(403).send({ error: 'Missing Twilio signature' });
  }

  // Reconstruct the full URL Twilio used
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const url = `${proto}://${host}${req.url}`;

  // Parse form body for validation (Twilio sends form-encoded)
  const params = req.body as Record<string, string> || {};

  const valid = twilio.validateRequest(authToken, signature, url, params);
  if (!valid) {
    req.log.warn({ url, signature }, 'Invalid Twilio signature');
    return reply.code(403).send({ error: 'Invalid Twilio signature' });
  }
}
