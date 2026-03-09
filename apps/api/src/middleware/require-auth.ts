import { FastifyRequest, FastifyReply } from "fastify";

/**
 * Fastify preHandler: verifies a JWT from Authorization: Bearer <token> header.
 * After verification, request.user contains { tenantId, email }.
 *
 * Usage:
 *   app.post('/some-route', { preHandler: [requireAuth] }, handler)
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    return reply
      .status(401)
      .send({ error: "Unauthorized — valid session token required. POST /auth/login to obtain one." });
  }
}
