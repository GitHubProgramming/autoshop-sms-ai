import { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../../db/client";
import { decryptToken, encryptToken } from "../auth/google";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

const ParamsSchema = z.object({
  tenantId: z.string().uuid(),
});

async function refreshAccessToken(
  tenantId: string,
  encryptedRefreshToken: string,
  calendarId: string,
  log: { info: Function; error: Function }
): Promise<{ access_token: string; token_expiry: string } | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    log.error({ tenantId }, "Cannot refresh token: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set");
    return null;
  }

  let refreshToken: string;
  try {
    refreshToken = decryptToken(encryptedRefreshToken);
  } catch {
    log.error({ tenantId }, "Cannot refresh token: refresh_token decryption failed");
    return null;
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    log.error({ tenantId, status: res.status, body }, "Google token refresh failed");

    // Persist failure status so dashboard can surface "reconnect required"
    const errorMsg = `Token refresh failed (HTTP ${res.status}): ${body}`.slice(0, 500);
    const failureStatus = res.status === 401 || res.status === 400 ? "revoked" : "refresh_failed";
    await query(
      `UPDATE tenant_calendar_tokens
       SET integration_status = $1, last_error = $2, updated_at = NOW()
       WHERE tenant_id = $3`,
      [failureStatus, errorMsg, tenantId]
    ).catch((err: Error) => log.error({ tenantId, err }, "Failed to persist integration failure status"));

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

  log.info({ tenantId }, "Google Calendar token refreshed");

  return {
    access_token: data.access_token,
    token_expiry: tokenExpiry.toISOString(),
  };
}

/**
 * GET /internal/calendar-tokens/:tenantId
 *
 * Returns decrypted Google Calendar tokens for a tenant.
 * Auto-refreshes expired tokens using the stored refresh_token.
 * Internal only — called by n8n WF-004 within the Docker network.
 * NOT exposed externally (nginx does not proxy /internal/).
 */
export async function calendarTokensRoute(app: FastifyInstance) {
  app.get("/calendar-tokens/:tenantId", async (request, reply) => {
    const parsed = ParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid tenantId" });
    }

    const { tenantId } = parsed.data;

    const rows = await query<{
      access_token: string;
      refresh_token: string;
      token_expiry: string;
      calendar_id: string;
    }>(
      `SELECT access_token, refresh_token, token_expiry, calendar_id
       FROM tenant_calendar_tokens
       WHERE tenant_id = $1`,
      [tenantId]
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: "No calendar tokens for tenant" });
    }

    const row = rows[0];

    try {
      const expiry = new Date(row.token_expiry);
      const isExpired = expiry.getTime() - Date.now() < TOKEN_REFRESH_BUFFER_MS;

      if (isExpired) {
        const refreshed = await refreshAccessToken(
          tenantId,
          row.refresh_token,
          row.calendar_id,
          request.log
        );

        if (refreshed) {
          return reply.send({
            access_token: refreshed.access_token,
            refresh_token: decryptToken(row.refresh_token),
            token_expiry: refreshed.token_expiry,
            calendar_id: row.calendar_id,
          });
        }
        // Refresh failed — return stale token (n8n will get a 401 and can surface the error)
        request.log.error({ tenantId }, "Token refresh failed, returning stale token");
      }

      return reply.send({
        access_token: decryptToken(row.access_token),
        refresh_token: decryptToken(row.refresh_token),
        token_expiry: row.token_expiry,
        calendar_id: row.calendar_id,
      });
    } catch (err) {
      request.log.error({ tenantId, err }, "Failed to decrypt calendar tokens");
      return reply.status(500).send({ error: "Token decryption failed" });
    }
  });
}
