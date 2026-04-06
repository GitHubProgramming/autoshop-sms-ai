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

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_SECONDS = 15 * 60; // 15 minutes

export async function loginRoute(app: FastifyInstance) {
  /**
   * POST /auth/login
   *
   * Looks up the tenant by owner_email and verifies the password.
   * Returns { token, tenantId, shopName }.
   *
   * Per-email brute force protection: after 5 failed attempts within
   * 15 minutes, rejects with 429. Counter resets on successful login.
   */
  app.post("/login", async (request, reply) => {
    const parsed = LoginBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Email and password are required" });
    }

    const { email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase().trim();
    const rateLimitKey = `login_fail:${normalizedEmail}`;

    // ── Per-email rate limit check (BEFORE password comparison) ────────
    try {
      const { redis } = await import("../../queues/redis");
      const attempts = await redis.get(rateLimitKey);
      if (attempts && parseInt(attempts, 10) >= LOGIN_MAX_ATTEMPTS) {
        request.log.warn({ email: normalizedEmail }, "Login rate-limited — too many failed attempts");
        return reply.status(429).send({
          error: "Too many failed login attempts. Please try again in 15 minutes.",
        });
      }
    } catch {
      // Redis down — skip rate limiting (fail-open: allow login)
    }

    const rows = await query<{
      id: string;
      shop_name: string;
      owner_email: string;
      password_hash: string | null;
    }>(
      "SELECT id, shop_name, owner_email, password_hash FROM tenants WHERE owner_email = $1 LIMIT 1",
      [normalizedEmail]
    );
    const tenant = rows[0];

    if (!tenant) {
      // Increment rate limit counter even for non-existent accounts
      // (prevents email enumeration via timing + rate limit differences)
      try {
        const { redis } = await import("../../queues/redis");
        const count = await redis.incr(rateLimitKey);
        if (count === 1) await redis.expire(rateLimitKey, LOGIN_WINDOW_SECONDS);
      } catch { /* Redis down — skip */ }
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    if (!tenant.password_hash) {
      request.log.error(
        { tenantId: tenant.id },
        "Login attempt on account with no password_hash — rejecting."
      );
      try {
        const { redis } = await import("../../queues/redis");
        const count = await redis.incr(rateLimitKey);
        if (count === 1) await redis.expire(rateLimitKey, LOGIN_WINDOW_SECONDS);
      } catch { /* Redis down — skip */ }
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, tenant.password_hash);
    if (!match) {
      try {
        const { redis } = await import("../../queues/redis");
        const count = await redis.incr(rateLimitKey);
        if (count === 1) await redis.expire(rateLimitKey, LOGIN_WINDOW_SECONDS);
      } catch { /* Redis down — skip */ }
      request.log.info({ email: normalizedEmail }, "Failed login attempt");
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    // ── Success: clear rate limit counter ──────────────────────────────
    try {
      const { redis } = await import("../../queues/redis");
      await redis.del(rateLimitKey);
    } catch { /* Redis down — skip */ }

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
