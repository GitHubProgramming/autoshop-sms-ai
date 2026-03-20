import { FastifyInstance } from "fastify";
import { z } from "zod";
import * as bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";
import { query } from "../../db/client";

// ── Token helpers ────────────────────────────────────────────────────────────

/** Generate a cryptographically secure reset token (48 bytes → 64-char hex). */
function generateResetToken(): string {
  return randomBytes(48).toString("hex");
}

/** Hash token with SHA-256 for storage (never store plaintext). */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const TOKEN_EXPIRY_MINUTES = 60; // 1 hour

// ── Schemas ──────────────────────────────────────────────────────────────────

const ForgotPasswordBody = z.object({
  email: z.string().email(),
});

const ResetPasswordBody = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// ── Route ────────────────────────────────────────────────────────────────────

export async function passwordResetRoute(app: FastifyInstance) {
  const publicOrigin = process.env.PUBLIC_ORIGIN ?? "https://autoshopsmsai.com";

  /**
   * POST /auth/forgot-password
   *
   * Accepts { email } and always returns a neutral success message.
   * If the account exists, generates a reset token and attempts to send an email.
   * Safe against account enumeration.
   */
  app.post("/forgot-password", async (request, reply) => {
    const parsed = ForgotPasswordBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Valid email is required" });
    }

    const normalizedEmail = parsed.data.email.toLowerCase().trim();

    // Always return the same response regardless of account existence
    const neutralResponse = {
      message:
        "If an account exists with that email, you will receive a password reset link shortly.",
    };

    // Look up tenant
    const rows = await query<{ id: string }>(
      "SELECT id FROM tenants WHERE owner_email = $1 LIMIT 1",
      [normalizedEmail]
    );
    const tenant = rows[0];

    if (!tenant) {
      // No account — return neutral response without leaking info
      return reply.status(200).send(neutralResponse);
    }

    // Invalidate any existing unused tokens for this tenant
    await query(
      `UPDATE password_reset_tokens
       SET used_at = NOW()
       WHERE tenant_id = $1 AND used_at IS NULL`,
      [tenant.id]
    );

    // Generate and store new token
    const plainToken = generateResetToken();
    const tokenHash = hashToken(plainToken);
    const expiresAt = new Date(
      Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000
    ).toISOString();

    await query(
      `INSERT INTO password_reset_tokens (tenant_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [tenant.id, tokenHash, expiresAt]
    );

    // Build reset URL
    const resetUrl = `${publicOrigin}/reset-password?token=${plainToken}`;

    // Attempt email delivery via Resend API (if configured)
    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail =
      process.env.EMAIL_FROM ?? "AutoShop SMS AI <noreply@autoshopsmsai.com>";

    if (resendKey) {
      try {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromEmail,
            to: [normalizedEmail],
            subject: "Reset your AutoShop SMS AI password",
            html: `
              <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
                <h2 style="color: #0D1B2A;">Password Reset</h2>
                <p>You requested a password reset for your AutoShop SMS AI account.</p>
                <p>Click the link below to set a new password. This link expires in ${TOKEN_EXPIRY_MINUTES} minutes.</p>
                <p style="margin: 24px 0;">
                  <a href="${resetUrl}" style="background: #C94B1F; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">
                    Reset Password
                  </a>
                </p>
                <p style="font-size: 13px; color: #666;">If you didn't request this, you can safely ignore this email.</p>
                <p style="font-size: 12px; color: #999; margin-top: 32px;">
                  Or copy this URL: ${resetUrl}
                </p>
              </div>
            `,
          }),
        });

        if (!emailRes.ok) {
          const body = await emailRes.text().catch(() => "");
          request.log.error(
            { status: emailRes.status, body },
            "Failed to send password reset email via Resend"
          );
        } else {
          request.log.info(
            { tenantId: tenant.id },
            "Password reset email sent"
          );
        }
      } catch (err) {
        request.log.error({ err }, "Error sending password reset email");
      }
    } else {
      // No email service configured — log the reset URL for admin retrieval
      request.log.warn(
        {
          tenantId: tenant.id,
          email: normalizedEmail,
          resetUrl,
          note: "RESEND_API_KEY not configured — email not sent. Set RESEND_API_KEY env var to enable email delivery.",
        },
        "Password reset token generated (email delivery not configured)"
      );
    }

    return reply.status(200).send(neutralResponse);
  });

  /**
   * POST /auth/reset-password
   *
   * Accepts { token, password } and resets the password if the token is valid.
   * Enforces: expiry, single-use, secure hashing.
   */
  app.post("/reset-password", async (request, reply) => {
    const parsed = ResetPasswordBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Token and a password (min 8 characters) are required",
      });
    }

    const { token, password } = parsed.data;
    const tokenHash = hashToken(token);

    // Look up the token — must be unused and not expired
    const rows = await query<{
      id: string;
      tenant_id: string;
      expires_at: Date;
      used_at: Date | null;
    }>(
      `SELECT id, tenant_id, expires_at, used_at
       FROM password_reset_tokens
       WHERE token_hash = $1
       LIMIT 1`,
      [tokenHash]
    );

    const resetToken = rows[0];

    if (!resetToken) {
      return reply.status(400).send({
        error: "Invalid or expired reset link. Please request a new one.",
      });
    }

    if (resetToken.used_at) {
      return reply.status(400).send({
        error:
          "This reset link has already been used. Please request a new one.",
      });
    }

    if (new Date(resetToken.expires_at) < new Date()) {
      return reply.status(400).send({
        error: "This reset link has expired. Please request a new one.",
      });
    }

    // Hash the new password (same approach as signup: bcrypt, 12 rounds)
    const passwordHash = await bcrypt.hash(password, 12);

    // Update tenant password and mark token as used (in sequence, not a transaction,
    // but safe because token is marked used after success)
    await query(
      `UPDATE tenants SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [passwordHash, resetToken.tenant_id]
    );

    await query(
      `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`,
      [resetToken.id]
    );

    request.log.info(
      { tenantId: resetToken.tenant_id },
      "Password reset completed"
    );

    return reply.status(200).send({
      message: "Password has been reset successfully. You can now sign in.",
    });
  });
}
