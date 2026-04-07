import { createLogger } from "../utils/logger";

const log = createLogger("welcome-email");

/**
 * Format an E.164 US number as "+1 (XXX) XXX-XXXX". If the input does not
 * look like a +1 number with 10 digits after the country code, returns the
 * input unchanged (defensive — caller should already have gated on +1).
 */
export function formatUsPhone(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (!m) return e164;
  return `+1 (${m[1]}) ${m[2]}-${m[3]}`;
}

export interface WelcomeEmailInput {
  to: string;
  businessName: string;
  phoneNumber: string; // E.164, must start with +1 (caller enforces)
  dashboardUrl: string;
  supportEmail: string;
}

/**
 * Build the HTML body for the "number ready" welcome email.
 *
 * Inline CSS only (matches password-reset.ts pattern). Brand colors:
 * dark navy #0D1B2A header, orange #C94B1F accent.
 *
 * Includes the A2P 10DLC pending-review disclaimer because the campaign is
 * still under TCR review at the time of provisioning — without it, customers
 * would think the number is broken when they can't yet send SMS.
 */
export function buildWelcomeEmailHtml(input: WelcomeEmailInput): string {
  const { businessName, phoneNumber, dashboardUrl, supportEmail } = input;
  const formatted = formatUsPhone(phoneNumber);

  return `
    <div style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 600px; margin: 0 auto; color: #0D1B2A;">
      <div style="background: #0D1B2A; color: #fff; padding: 24px; text-align: center;">
        <h1 style="margin: 0; font-size: 22px;">Your AutoShop SMS AI number is ready</h1>
      </div>
      <div style="padding: 24px;">
        <p style="font-size: 16px;">Hi ${businessName},</p>
        <p style="font-size: 15px;">Your dedicated Texas phone number is ready:</p>
        <p style="font-size: 22px; font-weight: 700; color: #0D1B2A; margin: 16px 0;">${formatted}</p>
        <p style="margin: 28px 0; text-align: center;">
          <a href="${dashboardUrl}" style="background: #C94B1F; color: #fff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
            Open Dashboard
          </a>
        </p>
        <div style="background: #FFF6F1; border-left: 4px solid #C94B1F; padding: 14px 18px; margin: 24px 0; font-size: 14px; color: #0D1B2A;">
          <strong>Heads up:</strong> SMS sending from this number is currently pending carrier review (A2P 10DLC). This is a standard US carrier requirement and typically takes 2-3 weeks. Your number is reserved and ready — we'll notify you the moment SMS sending is activated. In the meantime, you can finish setting up your shop profile in the dashboard.
        </div>
        <p style="font-size: 15px; margin-top: 24px;"><strong>What's next:</strong></p>
        <ul style="font-size: 14px; line-height: 1.6; padding-left: 20px;">
          <li>Complete your shop profile (hours, services, pricing)</li>
          <li>Review your AI agent settings and greeting</li>
          <li>Add team members who should get booking notifications</li>
        </ul>
        <p style="font-size: 13px; color: #555; margin-top: 32px;">
          Questions? Reach us at <a href="mailto:${supportEmail}" style="color: #C94B1F;">${supportEmail}</a>.
        </p>
      </div>
    </div>
  `;
}

/**
 * Send the welcome email via Resend. Mirrors the inline-fetch pattern used
 * in routes/auth/password-reset.ts — no shared abstraction.
 *
 * Never throws: all errors are logged and swallowed so the caller (the
 * provisioning worker) cannot fail because of email delivery.
 */
export async function sendWelcomeEmail(
  input: WelcomeEmailInput,
  tenantId: string,
): Promise<{ sent: boolean; reason?: string }> {
  const last4 = input.phoneNumber.slice(-4);
  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail =
    process.env.EMAIL_FROM ?? "AutoShop SMS AI <noreply@autoshopsmsai.com>";

  if (!resendKey) {
    log.warn(
      { tenantId, last4 },
      "RESEND_API_KEY not set — welcome email not sent",
    );
    return { sent: false, reason: "no_resend_key" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [input.to],
        subject: "Your AutoShop SMS AI number is ready",
        html: buildWelcomeEmailHtml(input),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error(
        { tenantId, last4, status: res.status, body },
        "Welcome email send failed",
      );
      return { sent: false, reason: `resend_status_${res.status}` };
    }

    log.info({ tenantId, last4 }, "Welcome email sent");
    return { sent: true };
  } catch (err: any) {
    log.error(
      { tenantId, last4, err: err?.message },
      "Welcome email send threw",
    );
    return { sent: false, reason: "exception" };
  }
}

/**
 * Orchestration for the worker: looks up tenant contact info, enforces the
 * US-only guard (defense-in-depth on top of the LT tenant bypassing the
 * worker entirely), and sends. Never throws.
 */
export async function sendWelcomeEmailForProvisionedTenant(
  tenantId: string,
  phoneNumber: string,
  queryFn: <T = any>(sql: string, params?: any[]) => Promise<T[]>,
): Promise<void> {
  try {
    if (!phoneNumber.startsWith("+1")) {
      const prefix = phoneNumber.slice(0, 4);
      log.info(
        { tenantId, prefix },
        `Skipped welcome email: non-US number (prefix=${prefix})`,
      );
      return;
    }

    const rows = await queryFn<{
      shop_name: string;
      owner_email: string | null;
    }>(
      `SELECT shop_name, owner_email FROM tenants WHERE id = $1 LIMIT 1`,
      [tenantId],
    );
    const tenant = rows[0];
    if (!tenant || !tenant.owner_email) {
      log.warn(
        { tenantId },
        "Skipped welcome email: tenant or owner_email missing",
      );
      return;
    }

    const dashboardUrl =
      (process.env.PUBLIC_ORIGIN ?? "https://autoshopsmsai.com") + "/app";
    const supportEmail =
      process.env.SUPPORT_EMAIL ?? "support@autoshopsmsai.com";

    await sendWelcomeEmail(
      {
        to: tenant.owner_email,
        businessName: tenant.shop_name,
        phoneNumber,
        dashboardUrl,
        supportEmail,
      },
      tenantId,
    );
  } catch (err: any) {
    log.error(
      { tenantId, err: err?.message },
      "sendWelcomeEmailForProvisionedTenant unexpected error",
    );
  }
}
