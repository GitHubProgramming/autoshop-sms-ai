import { FastifyInstance } from "fastify";
import { z } from "zod";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { query } from "../../db/client";
import { requireAuth } from "../../middleware/require-auth";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPES = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email";

// ── Token encryption (AES-256-GCM) ───────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY ?? process.env.JWT_SECRET ?? "";
  if (!secret) throw new Error("ENCRYPTION_KEY or JWT_SECRET is required");
  // Derive a 32-byte key by hashing the secret
  const { createHash } = require("crypto");
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

// ── Routes ────────────────────────────────────────────────────────────────────

const CallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().uuid(), // tenantId passed as state
  error: z.string().optional(),
});

export async function googleAuthRoute(app: FastifyInstance) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const publicOrigin = process.env.PUBLIC_ORIGIN ?? "https://autoshopsmsai.com";

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
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent", // always get refresh_token
      state: tenantId,
    });

    return reply.send({ url: `${GOOGLE_AUTH_URL}?${params.toString()}` });
  });

  /**
   * GET /auth/google/callback?code=...&state=<tenantId>
   * Google redirects here after consent. Exchanges code for tokens and persists.
   */
  app.get("/callback", async (request, reply) => {
    const parsed = CallbackQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid callback parameters" });
    }

    const { code, state: tenantId, error } = parsed.data;

    if (error || !code) {
      request.log.warn({ tenantId, error }, "Google OAuth denied by user");
      return reply.redirect(`${publicOrigin}/app.html?calendar=denied`);
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
    return reply.redirect(`${publicOrigin}/app.html?calendar=connected`);
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
