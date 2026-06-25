import { FastifyRequest, FastifyReply } from "fastify";

export async function requireBbAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const decoded = await request.jwtVerify();
    const payload = decoded as { userId?: string; email?: string; tenantId?: string };
    if (!payload.userId || payload.tenantId) {
      return reply
        .status(401)
        .send({ error: "Invalid token — buyback auth required." });
    }
  } catch {
    return reply
      .status(401)
      .send({ error: "Unauthorized — valid session token required." });
  }
}
