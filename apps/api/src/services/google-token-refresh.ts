/**
 * Google OAuth Token Refresh Service
 *
 * Shared logic for refreshing expired Google OAuth access tokens.
 * Used by both:
 * - getCalendarTokens() in google-calendar.ts (service layer)
 * - GET /internal/calendar-tokens/:tenantId (HTTP route for n8n)
 *
 * Tokens are refreshed 5 minutes before expiry to avoid race conditions.
 */

import { query } from "../db/client";
import { decryptToken, encryptToken } from "../routes/auth/google";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

/**
 * Returns true if the token is expired or will expire within the buffer window.
 */
export function isTokenExpired(tokenExpiry: string | Date): boolean {
  const expiry = new Date(tokenExpiry);
  return expiry.getTime() - Date.now() < TOKEN_REFRESH_BUFFER_MS;
}

/**
 * Refreshes a Google OAuth access token using the stored refresh_token.
 *
 * On success: updates DB with new encrypted access_token + token_expiry,
 *             returns the plaintext access_token and new expiry.
 * On failure: returns null (caller should handle stale token or error).
 */
export async function refreshAccessToken(
  tenantId: string,
  encryptedRefreshToken: string
): Promise<{ accessToken: string; tokenExpiry: string } | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  let refreshToken: string;
  try {
    refreshToken = decryptToken(encryptedRefreshToken);
  } catch {
    return null;
  }

  let res: Response;
  try {
    res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
  } catch {
    return null;
  }

  if (!res.ok) {
    // Mark integration as failed so dashboard shows correct status.
    // Google returned an error — refresh_token may be revoked or invalid.
    try {
      await query(
        `UPDATE tenant_calendar_tokens
         SET integration_status = 'refresh_failed',
             last_error = $1,
             updated_at = NOW()
         WHERE tenant_id = $2`,
        [`Google token refresh failed: HTTP ${res.status}`, tenantId]
      );
    } catch {
      // Best-effort status update — don't block the caller
    }
    return null;
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  const tokenExpiry = new Date(Date.now() + data.expires_in * 1000);
  const encAccess = encryptToken(data.access_token);

  await query(
    `UPDATE tenant_calendar_tokens
     SET access_token = $1, token_expiry = $2, last_refreshed = NOW(),
         integration_status = 'active', last_error = NULL, updated_at = NOW()
     WHERE tenant_id = $3`,
    [encAccess, tokenExpiry.toISOString(), tenantId]
  );

  return {
    accessToken: data.access_token,
    tokenExpiry: tokenExpiry.toISOString(),
  };
}
