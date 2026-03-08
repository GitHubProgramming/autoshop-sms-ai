import { FastifyInstance } from "fastify";
import { z } from "zod";
import * as bcrypt from "bcryptjs";
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
  password: z.string().min(1),
});

export async function loginRoute(app: FastifyInstance) {
  /**
   * POST /auth/login
   *
   * Looks up the tenant by owner_email and verifies the password.
   * Returns { token, tenantId, shopName }.
   *
   * Password enforcement:
   *   - If password_hash IS SET: bcrypt.compare() must pass. Invalid password → 401.
   *   - If password_hash IS NULL: pilot mode — any password accepted (log warning).
   *     To set a password: UPDATE tenants SET password_hash = '<bcrypt-hash>' WHERE owner_email = '...';
   *     Generate hash: node -e "const b=require('bcryptjs'); b.hash('yourpassword',12).then(console.log)"
   */
  app.post("/login", async (request, reply) => {
    const parsed = LoginBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Email and password are required" });
    }

    const { email, password } = parsed.data;

    const rows = await query<{
      id: string;
      shop_name: string;
      owner_email: string;
      password_hash: string | null;
    }>(
      "SELECT id, shop_name, owner_email, password_hash FROM tenants WHERE owner_email = $1 LIMIT 1",
      [email]
    );
    const tenant = rows[0];

    if (!tenant) {
      // Generic message — do not reveal whether email exists
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    if (tenant.password_hash) {
      // Real password enforcement
      const match = await bcrypt.compare(password, tenant.password_hash);
      if (!match) {
        return reply.status(401).send({ error: "Invalid credentials" });
      }
    } else {
      // Pilot mode: no password set — allow login, log warning
      request.log.warn(
        { tenantId: tenant.id },
        "Login without password_hash — pilot mode. Set password_hash in tenants table to enforce authentication."
      );
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
