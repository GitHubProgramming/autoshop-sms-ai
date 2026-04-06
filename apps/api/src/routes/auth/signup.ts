import { FastifyInstance } from "fastify";
import { z } from "zod";
import * as bcrypt from "bcryptjs";
import { query, withTransaction } from "../../db/client";
import { writeAuditEvent } from "../../db/audit";
import { isTestSignupEmail } from "../../utils/test-tenant";

const SignupBody = z.object({
  email:     z.string().email("Valid email required"),
  password:  z.string().min(8, "Password must be at least 8 characters"),
  shopName:  z.string().min(2, "Shop name required").max(100),
  ownerName: z.string().max(100).optional().default(""),
  timezone:  z.string().optional().default("America/Chicago"),
});

import { requireAuth } from "../../middleware/require-auth";

export async function signupRoute(app: FastifyInstance) {
  /**
   * POST /auth/signup
   *
   * Creates a new tenant + user record and starts a 14-day / 50-conversation trial.
   * Returns { token, tenantId, shopName, trialEndsAt }.
   */
  app.post("/signup", async (request, reply) => {
    const parsed = SignupBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        fields: parsed.error.flatten().fieldErrors,
      });
    }

    const { email, password, shopName, ownerName, timezone } = parsed.data;
    const normalizedEmail = email.toLowerCase().trim();
    const ip        = request.ip;
    const userAgent = (request.headers["user-agent"] as string | undefined) ?? "";

    // ── Per-IP rate limit (5 signups per hour) ───────────────────────────────
    const rateLimitKey = `signup_rate:${ip}`;
    try {
      const { redis } = await import("../../queues/redis");
      const attempts = await redis.get(rateLimitKey);
      if (attempts && parseInt(attempts, 10) >= 5) {
        return reply.status(429).send({
          error: "Too many signup attempts. Please try again later.",
        });
      }
    } catch {
      // Redis down — skip rate limiting (fail-open)
    }

    // ── Log attempt as 'started' ─────────────────────────────────────────────
    let attemptId: string | null = null;
    try {
      const rows = await query<{ id: string }>(
        `INSERT INTO signup_attempts (email, provider, status, ip_address, user_agent)
         VALUES ($1, 'email', 'started', $2, $3)
         RETURNING id`,
        [normalizedEmail, ip, userAgent]
      );
      attemptId = rows[0]?.id ?? null;
    } catch {
      // Non-fatal: audit log failure must not block signup
      request.log.warn({ email: normalizedEmail }, "signup_attempts insert failed");
    }

    const updateAttempt = async (
      status: string,
      tenantId?: string,
      reason?: string
    ) => {
      if (!attemptId) return;
      try {
        await query(
          `UPDATE signup_attempts
           SET status = $1, tenant_id = $2, failure_reason = $3, completed_at = NOW()
           WHERE id = $4`,
          [status, tenantId ?? null, reason ?? null, attemptId]
        );
      } catch { /* non-fatal */ }
    };

    // ── Duplicate check ──────────────────────────────────────────────────────
    const existing = await query<{ id: string }>(
      `SELECT id FROM tenants WHERE owner_email = $1 LIMIT 1`,
      [normalizedEmail]
    );
    if (existing.length > 0) {
      await updateAttempt("failed", undefined, "email_already_registered");
      return reply.status(409).send({
        error: "An account may already exist with this email. Please try signing in instead.",
      });
    }

    // ── Hash password ────────────────────────────────────────────────────────
    const passwordHash = await bcrypt.hash(password, 12);

    // ── Create tenant + user atomically ─────────────────────────────────────
    // Wrapped in a transaction so a failed user INSERT rolls back the tenant.
    let tenantId: string;
    try {
      tenantId = await withTransaction(async (client) => {
        const rows = await client.query(
          `INSERT INTO tenants
             (shop_name, owner_name, owner_email, timezone, billing_status, password_hash,
              trial_started_at, trial_ends_at, trial_conv_limit,
              conv_limit_this_cycle, conv_used_this_cycle,
              workspace_mode, provisioning_state)
           VALUES ($1, $2, $3, $4, 'demo', $5,
                   NULL, NULL, 50,
                   0, 0,
                   'demo', 'not_started')
           RETURNING id`,
          [shopName.trim(), ownerName.trim(), normalizedEmail, timezone, passwordHash]
        );
        const id = rows.rows[0].id;

        // Mark test tenants within the same transaction
        if (isTestSignupEmail(normalizedEmail)) {
          await client.query(`UPDATE tenants SET is_test = TRUE WHERE id = $1`, [id]);
        }

        // Create user record within the same transaction
        await client.query(
          `INSERT INTO users (tenant_id, email, auth_provider)
           VALUES ($1, $2, 'email')`,
          [id, normalizedEmail]
        );

        return id as string;
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unknown";
      request.log.error({ email: normalizedEmail, msg }, "Failed to create tenant during signup");
      await updateAttempt("failed", undefined, "tenant_creation_error");
      return reply.status(500).send({
        error: "Account creation failed. Please try again.",
      });
    }

    if (isTestSignupEmail(normalizedEmail)) {
      request.log.info({ tenantId, email: normalizedEmail }, "Tenant marked as test account");
    }

    await updateAttempt("completed", tenantId);

    // ── Audit log ────────────────────────────────────────────────────────────
    await writeAuditEvent(tenantId, "account_created", normalizedEmail, {
      shop_name: shopName.trim(),
      auth_provider: "email",
    });

    // ── Increment signup rate limit counter ──────────────────────────────────
    try {
      const { redis } = await import("../../queues/redis");
      const count = await redis.incr(rateLimitKey);
      if (count === 1) await redis.expire(rateLimitKey, 3600); // 1 hour TTL
    } catch { /* Redis down — skip */ }

    // ── Issue JWT ────────────────────────────────────────────────────────────
    const token = app.jwt.sign(
      { tenantId, email: normalizedEmail },
      { expiresIn: "24h" }
    );

    request.log.info({ tenantId, email: normalizedEmail }, "New tenant created via email signup — demo mode");

    return reply.status(201).send({
      token,
      tenantId,
      shopName: shopName.trim(),
      billingStatus: "demo",
      workspaceMode: "demo",
      message: "Account created. Explore the dashboard with sample data — start your free trial when ready.",
    });
  });

  // ── PATCH /auth/onboarding ─────────────────────────────────────────────────
  // Updates shop name, owner phone, and timezone after initial signup.
  const OnboardingBody = z.object({
    shopName:   z.string().min(2).max(100).optional(),
    ownerPhone: z.string().max(20).optional(),
    timezone:   z.string().max(60).optional(),
  });

  app.patch("/onboarding", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = OnboardingBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body" });
    }

    const { shopName, ownerPhone, timezone } = parsed.data;
    const { tenantId } = request.user as { tenantId: string; email: string };

    await query(
      `UPDATE tenants SET
         shop_name   = COALESCE($1, shop_name),
         owner_phone = COALESCE($2, owner_phone),
         timezone    = COALESCE($3, timezone),
         updated_at  = NOW()
       WHERE id = $4`,
      [shopName ?? null, ownerPhone ?? null, timezone ?? null, tenantId]
    );

    return reply.status(200).send({ ok: true });
  });
}
