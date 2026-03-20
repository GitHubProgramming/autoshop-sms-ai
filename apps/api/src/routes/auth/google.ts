import { FastifyInstance } from "fastify";
import { z } from "zod";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { query } from "../../db/client";
import { requireAuth } from "../../middleware/require-auth";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const CALENDAR_SCOPES = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email";
const LOGIN_SCOPES = "openid email profile";

// ── Token encryption (AES-256-GCM) ───────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY ?? process.env.JWT_SECRET ?? "";
  if (!secret) throw new Error("ENCRYPTION_KEY or JWT_SECRET is required");
  // Derive a 32-byte key by hashing the secret
  return createHash("sha256").update(secret).digest();
}

export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv(hex):tag(hex):ciphertext(hex)
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptToken(encoded: string): string {
  const key = getEncryptionKey();
  const [ivHex, tagHex, dataHex] = encoded.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const data = Buffer.from(dataHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final("utf8");
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function upsertCalendarTokens(
  tenantId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  calendarId = "primary",
  googleEmail?: string
): Promise<void> {
  const tokenExpiry = new Date(Date.now() + expiresIn * 1000);
  const encAccess = encryptToken(accessToken);
  const encRefresh = encryptToken(refreshToken);

  await query(
    `INSERT INTO tenant_calendar_tokens
       (tenant_id, access_token, refresh_token, token_expiry, calendar_id, google_account_email, integration_status, connected_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET
       access_token         = EXCLUDED.access_token,
       refresh_token        = EXCLUDED.refresh_token,
       token_expiry         = EXCLUDED.token_expiry,
       calendar_id          = EXCLUDED.calendar_id,
       google_account_email = EXCLUDED.google_account_email,
       integration_status   = 'active',
       last_error           = NULL,
       last_refreshed       = NOW(),
       updated_at           = NOW()`,
    [tenantId, encAccess, encRefresh, tokenExpiry.toISOString(), calendarId, googleEmail ?? null]
  );
}

/**
 * Fetches the Google account email using the access token.
 */
async function fetchGoogleEmail(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { email?: string };
    return data.email;
  } catch {
    return undefined;
  }
}

// ── OAuth state store (server-side, in-memory with TTL) ──────────────────────
// Stores login nonces for CSRF validation. Single-use, 10-minute expiry.

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const STATE_CLEANUP_INTERVAL_MS = 60 * 1000; // sweep every minute

interface StoredState {
  createdAt: number;
}

export const oauthStateStore = new Map<string, StoredState>();

// Periodic cleanup of expired states
const stateCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, val] of oauthStateStore) {
    if (now - val.createdAt > STATE_TTL_MS) {
      oauthStateStore.delete(key);
    }
  }
}, STATE_CLEANUP_INTERVAL_MS);
stateCleanupTimer.unref(); // don't keep process alive

// ── One-time auth code store (replaces JWT-in-URL) ───────────────────────────
// After successful Google login, server stores code → session data.
// Frontend exchanges code for JWT via POST (no token in URL/history/referrer).

const AUTH_CODE_TTL_MS = 60 * 1000; // 1 minute — must be exchanged quickly

interface StoredAuthCode {
  jwt: string;
  tenantId: string;
  shopName: string;
  email: string;
  createdAt: number;
}

export const authCodeStore = new Map<string, StoredAuthCode>();

const authCodeCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, val] of authCodeStore) {
    if (now - val.createdAt > AUTH_CODE_TTL_MS) {
      authCodeStore.delete(key);
    }
  }
}, STATE_CLEANUP_INTERVAL_MS);
authCodeCleanupTimer.unref();

// ── State helpers ─────────────────────────────────────────────────────────────

/** Login state: "login:<random-nonce>" — distinguishable from calendar state (UUID). */
function isLoginState(state: string): boolean {
  return state.startsWith("login:");
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Relaxed schema: state can be UUID (calendar) or "login:<nonce>" (login)
const CallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1),
  error: z.string().optional(),
}).passthrough(); // Google sends extra params (scope, authuser, hd, prompt)

export async function googleAuthRoute(app: FastifyInstance) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const publicOrigin = process.env.PUBLIC_ORIGIN ?? "https://autoshopsmsai.com";

  /**
   * GET /auth/google/login/start
   * Unauthenticated — initiates Google OAuth for LOGIN.
   * Redirects browser to Google consent screen.
   * State nonce is persisted server-side for validation on callback.
   */
  app.get("/login/start", async (_request, reply) => {
    if (!clientId || !redirectUri) {
      return reply.status(503).send({ error: "Google OAuth not configured" });
    }

    // Generate a cryptographic nonce and persist it server-side
    const nonce = randomBytes(16).toString("hex");
    oauthStateStore.set(nonce, { createdAt: Date.now() });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: LOGIN_SCOPES,
      access_type: "online", // login doesn't need offline/refresh
      prompt: "select_account",
      state: `login:${nonce}`,
    });

    return reply.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  });

  /**
   * POST /auth/google/exchange
   * Exchanges a one-time auth code (from Google login callback redirect)
   * for a JWT + session metadata. The auth code is single-use and short-lived.
   * This replaces passing JWT in URL query parameters.
   */
  app.post("/exchange", async (request, reply) => {
    const body = z.object({ code: z.string().min(1) }).safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Auth code is required" });
    }

    const stored = authCodeStore.get(body.data.code);
    // Delete immediately — single-use regardless of validity
    authCodeStore.delete(body.data.code);

    if (!stored) {
      return reply.status(400).send({ error: "Invalid or expired auth code" });
    }

    if (Date.now() - stored.createdAt > AUTH_CODE_TTL_MS) {
      return reply.status(400).send({ error: "Auth code expired" });
    }

    return reply.send({
      token: stored.jwt,
      tenantId: stored.tenantId,
      shopName: stored.shopName,
      email: stored.email,
    });
  });

  /**
   * GET /auth/google/url
   * Requires Bearer token in Authorization header.
   * Returns the Google consent URL as JSON — frontend redirects the browser.
   * No JWT in query params.
   */
  app.get("/url", { preHandler: [requireAuth] }, async (request, reply) => {
    if (!clientId || !redirectUri) {
      return reply.status(503).send({ error: "Google OAuth not configured" });
    }

    const { tenantId } = request.user as { tenantId: string };

    // Verify tenant exists before generating OAuth URL
    const [tenant] = await query<{ id: string }>(
      `SELECT id FROM tenants WHERE id = $1`,
      [tenantId]
    );
    if (!tenant) {
      request.log.error({ tenantId }, "OAuth URL requested for non-existent tenant");
      return reply.status(400).send({ error: "Tenant not found — cannot initiate OAuth" });
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: CALENDAR_SCOPES,
      access_type: "offline",
      prompt: "consent", // always get refresh_token
      state: tenantId,
    });

    return reply.send({ url: `${GOOGLE_AUTH_URL}?${params.toString()}` });
  });

  /**
   * GET /auth/google/callback?code=...&state=...
   * Google redirects here after consent.
   *
   * State routing:
   *   - "login:<nonce>" → Google login flow (nonce validated server-side)
   *   - UUID → calendar token flow (existing)
   */
  app.get("/callback", async (request, reply) => {
    const parsed = CallbackQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid callback parameters" });
    }

    const { code, state, error } = parsed.data;

    // ── Google Login callback ─────────────────────────────────────────────────
    if (isLoginState(state)) {
      // Validate the nonce server-side — reject missing, expired, or reused
      const nonce = state.slice("login:".length);
      const storedState = oauthStateStore.get(nonce);
      // Delete immediately — single-use regardless of outcome
      oauthStateStore.delete(nonce);

      if (!storedState) {
        request.log.warn({ state }, "Google login: invalid or reused OAuth state");
        return reply.redirect(
          `${publicOrigin}/login?error=Invalid+login+session.+Please+try+again.`
        );
      }

      if (Date.now() - storedState.createdAt > STATE_TTL_MS) {
        request.log.warn({ state }, "Google login: expired OAuth state");
        return reply.redirect(
          `${publicOrigin}/login?error=Login+session+expired.+Please+try+again.`
        );
      }

      if (error || !code) {
        request.log.warn({ error }, "Google login OAuth denied by user");
        return reply.redirect(
          `${publicOrigin}/login?error=Google+sign-in+was+cancelled`
        );
      }

      if (!clientId || !clientSecret || !redirectUri) {
        return reply.status(503).send({ error: "Google OAuth not configured" });
      }

      // Exchange authorization code for tokens
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }).toString(),
      });

      if (!tokenRes.ok) {
        const body = await tokenRes.text().catch(() => "");
        request.log.error(
          { status: tokenRes.status, body },
          "Google login token exchange failed"
        );
        return reply.redirect(
          `${publicOrigin}/login?error=Google+sign-in+failed.+Please+try+again.`
        );
      }

      const tokens = (await tokenRes.json()) as {
        access_token: string;
        id_token?: string;
      };

      if (!tokens.access_token) {
        request.log.error("Missing access_token in Google login response");
        return reply.redirect(
          `${publicOrigin}/login?error=Google+sign-in+failed.+Please+try+again.`
        );
      }

      // Get user's Google email
      const googleEmail = await fetchGoogleEmail(tokens.access_token);
      if (!googleEmail) {
        request.log.error("Could not retrieve email from Google");
        return reply.redirect(
          `${publicOrigin}/login?error=Could+not+retrieve+your+Google+email.+Please+try+again.`
        );
      }

      const normalizedEmail = googleEmail.toLowerCase().trim();

      // Look up existing tenant by owner_email — LOGIN ONLY, no account creation.
      // Identity model: this app uses owner-only login. Each tenant has exactly one
      // owner (tenants.owner_email). Google login matches against owner_email.
      // The users table exists for future multi-user support but is not used for login.
      const rows = await query<{
        id: string;
        shop_name: string;
        owner_email: string;
      }>(
        `SELECT id, shop_name, owner_email FROM tenants WHERE owner_email = $1 LIMIT 1`,
        [normalizedEmail]
      );

      const tenant = rows[0];

      if (!tenant) {
        request.log.info(
          { googleEmail: normalizedEmail },
          "Google login attempt — no matching account found"
        );
        return reply.redirect(
          `${publicOrigin}/login?error=No+account+found+for+this+Google+email.+Please+sign+up+first.`
        );
      }

      // Issue JWT — same format as email/password login
      const jwt = app.jwt.sign(
        { tenantId: tenant.id, email: tenant.owner_email },
        { expiresIn: "24h" }
      );

      request.log.info(
        { tenantId: tenant.id, googleEmail: normalizedEmail },
        "Google login successful"
      );

      // Store a one-time auth code; redirect with only the opaque code in the URL.
      // Frontend exchanges code → JWT via POST /auth/google/exchange.
      // JWT never appears in URL, browser history, logs, or referrer headers.
      const authCode = randomBytes(32).toString("hex");
      authCodeStore.set(authCode, {
        jwt,
        tenantId: tenant.id,
        shopName: tenant.shop_name,
        email: tenant.owner_email,
        createdAt: Date.now(),
      });

      return reply.redirect(
        `${publicOrigin}/login?google_code=${encodeURIComponent(authCode)}`
      );
    }

    // ── Calendar token callback (existing flow) ───────────────────────────────
    // Validate state as UUID for the calendar flow
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(state)) {
      return reply.status(400).send({ error: "Invalid callback state" });
    }

    const tenantId = state;

    if (error || !code) {
      request.log.warn({ tenantId, error }, "Google OAuth denied by user");
      return reply.redirect(`${publicOrigin}/app/dashboard?calendar=denied`);
    }

    if (!clientId || !clientSecret || !redirectUri) {
      return reply.status(503).send({ error: "Google OAuth not configured" });
    }

    // Verify tenant exists before exchanging tokens (prevents FK violation)
    const [tenant] = await query<{ id: string }>(
      `SELECT id FROM tenants WHERE id = $1`,
      [tenantId]
    );
    if (!tenant) {
      request.log.error({ tenantId }, "OAuth callback for non-existent tenant");
      return reply.status(400).send({ error: "Invalid tenant in OAuth state" });
    }

    // Exchange authorization code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text().catch(() => "");
      request.log.error({ tenantId, status: tokenRes.status, body }, "Google token exchange failed");
      return reply.status(502).send({ error: "Google token exchange failed" });
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    if (!tokens.access_token || !tokens.refresh_token) {
      request.log.error({ tenantId }, "Missing tokens in Google response");
      return reply.status(502).send({ error: "Incomplete tokens from Google" });
    }

    const googleEmail = await fetchGoogleEmail(tokens.access_token);

    await upsertCalendarTokens(
      tenantId,
      tokens.access_token,
      tokens.refresh_token,
      tokens.expires_in ?? 3600,
      "primary",
      googleEmail
    );

    request.log.info({ tenantId, googleEmail }, "Google Calendar connected for tenant");

    // Redirect back to the app dashboard with a success flag
    return reply.redirect(`${publicOrigin}/app/dashboard?calendar=connected`);
  });

  /**
   * DELETE /auth/google/disconnect
   * Removes the tenant's Google Calendar tokens, effectively disconnecting.
   */
  app.delete("/disconnect", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string };

    await query(
      `DELETE FROM tenant_calendar_tokens WHERE tenant_id = $1`,
      [tenantId]
    );

    request.log.info({ tenantId }, "Google Calendar disconnected for tenant");
    return reply.send({ ok: true });
  });
}
