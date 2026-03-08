import { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../../db/client";

// Extend @fastify/jwt types so request.user is typed throughout the app
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { tenantId: string; email: string };
    user: { tenantId: string; email: string };
  }
}

const LoginBody = z.object({
  email: z.string().email(),
  // password field accepted but not validated yet — see SECURITY NOTE below
  password: z.string().optional(),
});

export async function loginRoute(app: FastifyInstance) {
  /**
   * POST /auth/login
   *
   * Looks up the tenant by owner_email and issues a 24-hour JWT.
   * Returns { token, tenantId, shopName }.
   *
   * SECURITY NOTE — REMAINING BLOCKER:
   *   Password validation is NOT YET IMPLEMENTED. Any caller knowing
   *   a valid owner_email can authenticate. This grants real server-issued
   *   tokens (not forgeable localStorage blobs) but without a password check.
   *
   *   Full fix requires:
   *     1. ALTER TABLE tenants ADD COLUMN password_hash TEXT
   *     2. Migration to set initial passwords (via reset flow)
   *     3. bcrypt/argon2 verification here
   *
   *   For the pilot phase this is acceptable because:
   *   - Only owner emails of onboarded shops can authenticate
   *   - Tokens expire in 24 hours
   *   - Protected routes now reject cross-tenant access even with valid tokens
   *   - The localStorage forgery attack (no server validation at all) is eliminated
   */
  app.post("/login", async (request, reply) => {
    const parsed = LoginBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Valid email is required" });
    }

    const { email } = parsed.data;

    const rows = await query<{ id: string; shop_name: string; owner_email: string }>(
      "SELECT id, shop_name, owner_email FROM tenants WHERE owner_email = $1 LIMIT 1",
      [email]
    );
    const tenant = rows[0];

    if (!tenant) {
      // Generic message — do not reveal whether email exists
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    const token = app.jwt.sign(
      { tenantId: tenant.id, email: tenant.owner_email },
      { expiresIn: "24h" }
    );

    request.log.info({ tenantId: tenant.id }, "Session token issued");

    return reply.status(200).send({
      token,
      tenantId: tenant.id,
      shopName: tenant.shop_name,
    });
  });

  /**
   * GET /auth/me
   * Returns the authenticated user's session info.
   * Useful for the dashboard to verify token on page load.
   */
  app.get("/me", async (request, reply) => {
    try {
      await request.jwtVerify();
      return reply.status(200).send({ user: request.user });
    } catch {
      return reply.status(401).send({ error: "Unauthorized" });
    }
  });
}
