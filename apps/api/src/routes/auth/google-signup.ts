/**
 * Google OAuth for SIGN-UP / SIGN-IN (identity auth).
 *
 * This is separate from /auth/google (Google Calendar OAuth).
 * Scopes here: openid email profile  (not calendar).
 * Redirect URI: GOOGLE_SIGNUP_REDIRECT_URI env var.
 *
 * Flow:
 *   GET /auth/google/signup/start  → redirect to Google consent screen
 *   GET /auth/google/signup/callback → exchange code, create/find tenant, issue JWT
 *   → redirect to /onboarding.html (new user) or /app.html (returning user)
 */

import { FastifyInstance } from "fastify";
import { randomBytes } from "crypto";
import { query } from "../../db/client";
import { redis } from "../../queues/redis";

const GOOGLE_AUTH_URL   = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL  = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO   = "https://www.googleapis.com/oauth2/v2/userinfo";
const SIGNUP_SCOPES     = "openid email profile";

export async function googleSignupRoute(app: FastifyInstance) {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  // GOOGLE_SIGNUP_REDIRECT_URI is the callback URL registered in Google Cloud Console
  // for the identity (signup) OAuth — separate from GOOGLE_REDIRECT_URI (calendar).
  const redirectUri  = process.env.GOOGLE_SIGNUP_REDIRECT_URI;

  /**
   * GET /auth/google/signup/start
   * Initiates Google OAuth sign-up / sign-in.
   * Returns 503 if GOOGLE_CLIENT_ID or GOOGLE_SIGNUP_REDIRECT_URI are not set.
   */
  app.get("/signup/start", async (request, reply) => {
    if (!clientId || !redirectUri) {
      return reply
        .status(503)
        .send({ error: "Google sign-in is not configured (GOOGLE_CLIENT_ID / GOOGLE_SIGNUP_REDIRECT_URI missing)" });
    }

    // CSRF state: random nonce stored in Redis for 10 minutes
    const nonce = randomBytes(16).toString("hex");
    await redis.set(`gsignup_nonce:${nonce}`, "1", "EX", 600);

    const params = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  redirectUri,
      response_type: "code",
      scope:         SIGNUP_SCOPES,
      access_type:   "online",   // no refresh token needed for identity login
      state:         nonce,
      prompt:        "select_account",
    });

    return reply.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  });

  /**
   * GET /auth/google/signup/callback
   * Google redirects here after consent.
   * Creates or retrieves the tenant+user, issues JWT, redirects to app.
   */
  app.get("/signup/callback", async (request, reply) => {
    const q = request.query as Record<string, string>;
    const code  = q.code;
    const state = q.state;
    const error = q.error;

    if (error) {
      return reply.redirect(
        `/signup.html?error=${encodeURIComponent("Google sign-in was cancelled or denied")}`
      );
    }

    if (!code || !state) {
      return reply.redirect("/signup.html?error=invalid_callback");
    }

    // Validate CSRF nonce
    const nonceKey = `gsignup_nonce:${state}`;
    const valid    = await redis.get(nonceKey);
    if (!valid) {
      return reply.redirect("/signup.html?error=session_expired");
    }
    await redis.del(nonceKey);

    if (!clientId || !clientSecret || !redirectUri) {
      return reply.redirect("/signup.html?error=not_configured");
    }

    // ── Exchange code for access token ───────────────────────────────────────
    let accessToken: string;
    try {
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body:    new URLSearchParams({
          code,
          client_id:     clientId,
          client_secret: clientSecret,
          redirect_uri:  redirectUri,
          grant_type:    "authorization_code",
        }).toString(),
      });

      if (!tokenRes.ok) {
        const body = await tokenRes.text().catch(() => "");
        request.log.error({ status: tokenRes.status, body }, "Google token exchange failed (signup)");
        return reply.redirect("/signup.html?error=token_exchange_failed");
      }

      const tokens = (await tokenRes.json()) as { access_token: string };
      accessToken = tokens.access_token;
    } catch (err) {
      request.log.error({ err }, "Google token exchange threw (signup)");
      return reply.redirect("/signup.html?error=token_exchange_failed");
    }

    // ── Get userinfo ─────────────────────────────────────────────────────────
    let googleEmail: string;
    let googleSub: string;
    let displayName: string;

    try {
      const userRes = await fetch(GOOGLE_USERINFO, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!userRes.ok) {
        return reply.redirect("/signup.html?error=userinfo_failed");
      }

      const info = (await userRes.json()) as {
        id:          string;
        email:       string;
        name?:       string;
        given_name?: string;
      };

      if (!info.email || !info.id) {
        return reply.redirect("/signup.html?error=missing_userinfo");
      }

      googleEmail = info.email.toLowerCase();
      googleSub   = info.id;
      displayName = info.name ?? info.given_name ?? "Shop Owner";
    } catch {
      return reply.redirect("/signup.html?error=userinfo_failed");
    }

    // ── Log signup attempt ───────────────────────────────────────────────────
    let attemptId: string | null = null;
    try {
      const rows = await query<{ id: string }>(
        `INSERT INTO signup_attempts (email, provider, status, ip_address)
         VALUES ($1, 'google', 'started', $2) RETURNING id`,
        [googleEmail, request.ip]
      );
      attemptId = rows[0]?.id ?? null;
    } catch { /* non-fatal */ }

    const updateAttempt = async (status: string, tenantId?: string, reason?: string) => {
      if (!attemptId) return;
      try {
        await query(
          `UPDATE signup_attempts
           SET status=$1, tenant_id=$2, failure_reason=$3, completed_at=NOW()
           WHERE id=$4`,
          [status, tenantId ?? null, reason ?? null, attemptId]
        );
      } catch { /* non-fatal */ }
    };

    // ── Look up existing user by Google sub ──────────────────────────────────
    const existingByGoogle = await query<{ tenant_id: string }>(
      `SELECT tenant_id FROM users WHERE google_sub = $1 LIMIT 1`,
      [googleSub]
    );

    if (existingByGoogle.length > 0) {
      // Returning Google user — log them in
      const tenantId = existingByGoogle[0].tenant_id;
      await updateAttempt("completed", tenantId);
      return issueJwtAndRedirect(app, reply, tenantId, googleEmail, false);
    }

    // ── Look up by email in tenants (e.g. they signed up with email first) ───
    const existingByEmail = await query<{ id: string }>(
      `SELECT id FROM tenants WHERE owner_email = $1 LIMIT 1`,
      [googleEmail]
    );

    if (existingByEmail.length > 0) {
      const tenantId = existingByEmail[0].id;
      // Link the Google identity to this tenant
      try {
        await query(
          `INSERT INTO users (tenant_id, email, auth_provider, google_sub)
           VALUES ($1, $2, 'google', $3)
           ON CONFLICT (email, auth_provider) DO UPDATE SET google_sub = EXCLUDED.google_sub`,
          [tenantId, googleEmail, googleSub]
        );
      } catch { /* non-fatal */ }

      await updateAttempt("completed", tenantId);
      return issueJwtAndRedirect(app, reply, tenantId, googleEmail, false);
    }

    // ── New user — create tenant + user record ───────────────────────────────
    // Use email domain as placeholder shop name, to be completed in onboarding
    const domain          = googleEmail.split("@")[1] ?? "";
    const shopPlaceholder = domain
      .replace(/\.(com|net|org|io|biz|us)$/i, "")
      .replace(/[^a-zA-Z0-9 ]/g, " ")
      .trim()
      .slice(0, 60) || "My Shop";

    let tenantId: string;
    try {
      const rows = await query<{ id: string }>(
        `INSERT INTO tenants
           (shop_name, owner_name, owner_email, billing_status,
            trial_started_at, trial_ends_at, trial_conv_limit,
            conv_limit_this_cycle, conv_used_this_cycle)
         VALUES ($1, $2, $3, 'trial',
                 NOW(), NOW() + INTERVAL '14 days', 50,
                 50, 0)
         RETURNING id`,
        [shopPlaceholder, displayName, googleEmail]
      );
      tenantId = rows[0].id;

      await query(
        `INSERT INTO users (tenant_id, email, auth_provider, google_sub)
         VALUES ($1, $2, 'google', $3)`,
        [tenantId, googleEmail, googleSub]
      );

      request.log.info({ tenantId, email: googleEmail }, "New tenant created via Google signup — trial started");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unknown";
      request.log.error({ email: googleEmail, msg }, "Failed to create tenant via Google signup");
      await updateAttempt("failed", undefined, "tenant_creation_error");
      return reply.redirect("/signup.html?error=account_creation_failed");
    }

    await updateAttempt("completed", tenantId);
    return issueJwtAndRedirect(app, reply, tenantId, googleEmail, true);
  });
}

/**
 * Issue a JWT and redirect to app/onboarding.
 * Uses URL fragment (#) so the token never appears in server logs.
 */
async function issueJwtAndRedirect(
  app: FastifyInstance,
  reply: any,
  tenantId: string,
  email: string,
  isNewUser: boolean
): Promise<void> {
  const rows = await query<{ shop_name: string }>(
    `SELECT shop_name FROM tenants WHERE id = $1`,
    [tenantId]
  );
  const shopName = rows[0]?.shop_name ?? "";

  const token = app.jwt.sign(
    { tenantId, email },
    { expiresIn: "24h" }
  );

  // Fragment (#) never sent to the server — avoids JWT in server logs
  const dest   = isNewUser ? "onboarding.html" : "app.html";
  const params = `token=${encodeURIComponent(token)}&tenantId=${encodeURIComponent(tenantId)}&shopName=${encodeURIComponent(shopName)}`;

  return reply.redirect(`/${dest}#${params}`);
}
