import { FastifyRequest, FastifyReply } from "fastify";

/**
 * Fastify preHandler: requires a valid JWT AND that the token's email
 * is in the ADMIN_EMAILS environment variable allowlist.
 *
 * Configuration:
 *   ADMIN_EMAILS=alice@example.com,bob@example.com
 *
 * Returns:
 *   401 — missing or invalid JWT
 *   403 — valid JWT but email not in ADMIN_EMAILS allowlist
 *   503 — ADMIN_EMAILS env var not configured
 */
export async function adminGuard(request: FastifyRequest, reply: FastifyReply) {
  // 1. Verify JWT
  try {
    await request.jwtVerify();
  } catch {
    await reply
      .status(401)
      .send({ error: "Authentication required — POST /auth/login to obtain a token" });
    return;
  }

  // 2. Require ADMIN_EMAILS to be configured
  const adminEmails = new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
  if (adminEmails.size === 0) {
    request.log.error("Admin access attempted but ADMIN_EMAILS env var is not set");
    await reply
      .status(503)
      .send({ error: "Admin access not configured — set ADMIN_EMAILS env var on the server" });
    return;
  }

  // 3. Check allowlist
  const { email } = request.user as { email: string };
  if (!adminEmails.has(email.toLowerCase())) {
    request.log.warn({ email, ip: request.ip }, "Admin access denied — email not in allowlist");
    await reply
      .status(403)
      .send({ error: "Forbidden — your account is not an admin" });
    return;
  }
}
