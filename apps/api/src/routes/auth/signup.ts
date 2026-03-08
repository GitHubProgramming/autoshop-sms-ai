import { FastifyInstance } from "fastify";
import { z } from "zod";
import * as bcrypt from "bcryptjs";
import { query } from "../../db/client";
import { writeAuditEvent } from "../../db/audit";

const SignupBody = z.object({
  email:     z.string().email("Valid email required"),
  password:  z.string().min(8, "Password must be at least 8 characters"),
  shopName:  z.string().min(2, "Shop name required").max(100),
  ownerName: z.string().min(1, "Your name is required").max(100),
  timezone:  z.string().optional().default("America/Chicago"),
});

import { requireAuth } from "../../middleware/require-auth";

export async function signupRoute(app: FastifyInstance) {
  /**
   * POST /auth/signup
   *
   * Creates a new tenant + user record and starts a 14-day / 50-conversation trial.
   * Returns { token, tenantId, shopName } — same shape as POST /auth/login.
   *
   * Trial rules (enforced by getBlockReason in db/tenants.ts):
   *   - billing_status = 'trial' on creation
   *   - trial_ends_at  = NOW() + 14 days
   *   - conv_limit_this_cycle = 50 (hard block on 51st conversation)
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
        error: "An account with this email already exists. Please sign in.",
      });
    }

    // ── Hash password ────────────────────────────────────────────────────────
    const passwordHash = await bcrypt.hash(password, 12);

    // ── Create tenant with trial state ───────────────────────────────────────
    let tenantId: string;
    try {
      const rows = await query<{ id: string }>(
        `INSERT INTO tenants
           (shop_name, owner_name, owner_email, timezone, billing_status, password_hash,
            trial_started_at, trial_ends_at, trial_conv_limit,
            conv_limit_this_cycle, conv_used_this_cycle)
         VALUES ($1, $2, $3, $4, 'trial', $5,
                 NOW(), NOW() + INTERVAL '14 days', 50,
                 50, 0)
         RETURNING id`,
        [shopName.trim(), ownerName.trim(), normalizedEmail, timezone, passwordHash]
      );
      tenantId = rows[0].id;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unknown";
      request.log.error({ email: normalizedEmail, msg }, "Failed to create tenant during signup");
      await updateAttempt("failed", undefined, "tenant_creation_error");
      return reply.status(500).send({
        error: "Account creation failed. Please try again.",
      });
    }

    // ── Create user record ───────────────────────────────────────────────────
    try {
      await query(
        `INSERT INTO users (tenant_id, email, auth_provider)
         VALUES ($1, $2, 'email')`,
        [tenantId, normalizedEmail]
      );
    } catch {
      // Non-fatal: tenant is the authoritative record; user is supplementary
      request.log.warn({ tenantId }, "Failed to create user record after tenant creation");
    }

    await updateAttempt("completed", tenantId);

    // ── Audit log ────────────────────────────────────────────────────────────
    await writeAuditEvent(tenantId, "account_created", normalizedEmail, {
      shop_name: shopName.trim(),
      auth_provider: "email",
    });

    // ── Issue JWT ────────────────────────────────────────────────────────────
    const token = app.jwt.sign(
      { tenantId, email: normalizedEmail },
      { expiresIn: "24h" }
    );

    request.log.info({ tenantId, email: normalizedEmail }, "New tenant created via email signup — trial started");

    return reply.status(201).send({
      token,
      tenantId,
      shopName: shopName.trim(),
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      message: "Account created. Your 14-day free trial has started.",
    });
  });

  // ── PATCH /auth/onboarding ─────────────────────────────────────────────────
  // Updates shop name, owner phone, and timezone after initial signup.
  // Called by onboarding.html. Non-blocking — all fields optional.
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
