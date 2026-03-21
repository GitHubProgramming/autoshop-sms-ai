import { FastifyRequest, FastifyReply } from "fastify";
import { COOKIE_NAME, parseAdminSessionCookie } from "./admin-session";

/**
 * Fastify preHandler: requires a valid admin session cookie AND that
 * the session's email is in the ADMIN_EMAILS environment variable allowlist.
 *
 * Configuration:
 *   ADMIN_EMAILS=alice@example.com,bob@example.com
 *
 * Returns:
 *   401 — missing, expired, or invalid admin session cookie
 *   403 — valid session but email not in ADMIN_EMAILS allowlist
 *   503 — ADMIN_EMAILS env var not configured
 */
export async function adminGuard(request: FastifyRequest, reply: FastifyReply) {
  // 1. Parse and verify the admin session cookie
  const cookieValue = request.cookies?.[COOKIE_NAME];
  const session = parseAdminSessionCookie(cookieValue);

  if (!session) {
    await reply
      .status(401)
      .send({ error: "Admin session required — visit /admin to authenticate" });
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
  if (!adminEmails.has(session.email.toLowerCase())) {
    request.log.warn({ email: session.email, ip: request.ip }, "Admin access denied — email not in allowlist");
    await reply
      .status(403)
      .send({ error: "Forbidden — your account is not an admin" });
    return;
  }

  // Attach admin email to request for downstream use
  (request as unknown as Record<string, unknown>).adminEmail = session.email;
}
