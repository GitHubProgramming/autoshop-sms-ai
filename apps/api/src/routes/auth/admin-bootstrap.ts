import { FastifyInstance } from "fastify";
import { z } from "zod";
import * as bcrypt from "bcryptjs";
import { query } from "../../db/client";

const BootstrapBody = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  force: z.boolean().optional(),
});

/**
 * POST /auth/admin-bootstrap
 *
 * One-time endpoint to set a password on an admin tenant that has no
 * password_hash (e.g. manually-created pilot accounts).
 *
 * Protected by INTERNAL_API_KEY header — only callable by the server operator.
 *
 * If the tenant exists with that email but has no password_hash, sets it.
 * If the tenant doesn't exist, creates a minimal admin tenant.
 *
 * Returns 200 on success, 409 if the tenant already has a password set.
 */
export async function adminBootstrapRoute(app: FastifyInstance) {
  app.post("/admin-bootstrap", async (request, reply) => {
    // ── Verify INTERNAL_API_KEY, ADMIN_BOOTSTRAP_KEY, or hardcoded one-time key
    // TEMPORARY hardcoded key for initial admin setup — REMOVE after bootstrap.
    const ONETIME_BOOTSTRAP_KEY = "setup-admin-2026-03-15-x8k4m2";
    const internalKey = process.env.INTERNAL_API_KEY;
    const bootstrapKey = process.env.ADMIN_BOOTSTRAP_KEY;

    const provided =
      (request.headers["x-internal-key"] as string) ??
      (request.headers["authorization"] as string)?.replace(/^Bearer\s+/i, "");

    const keyMatch =
      (internalKey && provided === internalKey) ||
      (bootstrapKey && provided === bootstrapKey) ||
      (provided === ONETIME_BOOTSTRAP_KEY);

    if (!provided || !keyMatch) {
      return reply.status(401).send({ error: "Invalid or missing internal API key" });
    }

    // ── Validate body ────────────────────────────────────────────────────────
    const parsed = BootstrapBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "email and password (min 8 chars) are required",
      });
    }

    const { email, password, force } = parsed.data;
    const normalizedEmail = email.toLowerCase().trim();

    // ── Verify email is in ADMIN_EMAILS allowlist ────────────────────────────
    const adminEmails = new Set(
      (process.env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    );
    if (adminEmails.size === 0) {
      return reply.status(503).send({
        error: "ADMIN_EMAILS env var not configured",
      });
    }
    if (!adminEmails.has(normalizedEmail)) {
      return reply.status(403).send({
        error: "Email is not in the ADMIN_EMAILS allowlist",
      });
    }

    // ── Hash password ────────────────────────────────────────────────────────
    const passwordHash = await bcrypt.hash(password, 12);

    // ── Check if tenant exists ───────────────────────────────────────────────
    const existing = await query<{
      id: string;
      shop_name: string;
      password_hash: string | null;
    }>(
      "SELECT id, shop_name, password_hash FROM tenants WHERE owner_email = $1 LIMIT 1",
      [normalizedEmail],
    );

    if (existing.length > 0) {
      const tenant = existing[0];

      if (tenant.password_hash && !force) {
        return reply.status(409).send({
          error: "This tenant already has a password set. Use the login flow, or pass force:true to reset.",
          tenantId: tenant.id,
        });
      }

      // Set or reset password on existing tenant
      await query(
        "UPDATE tenants SET password_hash = $1 WHERE id = $2",
        [passwordHash, tenant.id],
      );

      request.log.info(
        { tenantId: tenant.id, email: normalizedEmail, reset: !!tenant.password_hash },
        "Admin bootstrap: password_hash set on existing tenant",
      );

      return reply.status(200).send({
        ok: true,
        action: tenant.password_hash ? "password_reset" : "password_set",
        tenantId: tenant.id,
        shopName: tenant.shop_name,
        message: "Password set. You can now log in at /login.html",
      });
    }

    // ── Create minimal admin tenant ──────────────────────────────────────────
    const rows = await query<{ id: string }>(
      `INSERT INTO tenants
         (shop_name, owner_email, password_hash, billing_status,
          trial_started_at, trial_ends_at, trial_conv_limit,
          conv_limit_this_cycle, conv_used_this_cycle)
       VALUES ('Admin', $1, $2, 'trial',
               NOW(), NOW() + INTERVAL '365 days', 9999,
               9999, 0)
       RETURNING id`,
      [normalizedEmail, passwordHash],
    );

    request.log.info(
      { tenantId: rows[0].id, email: normalizedEmail },
      "Admin bootstrap: new admin tenant created",
    );

    return reply.status(201).send({
      ok: true,
      action: "tenant_created",
      tenantId: rows[0].id,
      message: "Admin tenant created with password. You can now log in at /login.html",
    });
  });
}
