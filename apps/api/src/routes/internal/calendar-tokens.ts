import { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../../db/client";
import { decryptToken } from "../auth/google";
import {
  isTokenExpired,
  refreshAccessToken,
} from "../../services/google-token-refresh";

const ParamsSchema = z.object({
  tenantId: z.string().uuid(),
});

/**
 * GET /internal/calendar-tokens/:tenantId
 *
 * Returns decrypted Google Calendar tokens for a tenant.
 * Auto-refreshes expired tokens using the stored refresh_token.
 * Internal only — called by n8n WF-004 within the Docker network.
 * NOT exposed externally (nginx does not proxy /internal/).
 */
export async function calendarTokensRoute(app: FastifyInstance) {
  /**
   * POST /internal/calendar-tokens/:tenantId/force-refresh
   *
   * Diagnostic endpoint: forces a Google OAuth token refresh regardless of
   * expiry, and returns before/after state for verification.
   * Internal only — NOT exposed externally.
   */
  app.post("/calendar-tokens/:tenantId/force-refresh", async (request, reply) => {
    const parsed = ParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid tenantId" });
    }

    const { tenantId } = parsed.data;

    // 1. Read BEFORE state
    const before = await query<{
      access_token: string;
      refresh_token: string;
      token_expiry: string;
      calendar_id: string;
      last_refreshed: string | null;
    }>(
      `SELECT access_token, refresh_token, token_expiry, calendar_id, last_refreshed
       FROM tenant_calendar_tokens WHERE tenant_id = $1`,
      [tenantId]
    );

    if (before.length === 0) {
      return reply.status(404).send({ error: "No calendar tokens for tenant" });
    }

    const beforeRow = before[0];
    const beforeAccessToken = decryptToken(beforeRow.access_token);
    const beforeState = {
      token_expiry: beforeRow.token_expiry,
      access_token_prefix: beforeAccessToken.substring(0, 30),
      access_token_length: beforeAccessToken.length,
      last_refreshed: beforeRow.last_refreshed,
    };

    // 2. Force refresh (bypass expiry check)
    let refreshResult: { accessToken: string; tokenExpiry: string } | null = null;
    let refreshError: string | null = null;
    try {
      refreshResult = await refreshAccessToken(tenantId, beforeRow.refresh_token);
    } catch (err) {
      refreshError = (err as Error).message;
    }

    if (!refreshResult) {
      return reply.status(502).send({
        error: refreshError ?? "Refresh returned null",
        before: beforeState,
      });
    }

    // 3. Read AFTER state from DB
    const after = await query<{
      access_token: string;
      token_expiry: string;
      last_refreshed: string | null;
    }>(
      `SELECT access_token, token_expiry, last_refreshed
       FROM tenant_calendar_tokens WHERE tenant_id = $1`,
      [tenantId]
    );

    const afterRow = after[0];
    const afterAccessToken = decryptToken(afterRow.access_token);

    const afterState = {
      token_expiry: afterRow.token_expiry,
      access_token_prefix: afterAccessToken.substring(0, 30),
      access_token_length: afterAccessToken.length,
      last_refreshed: afterRow.last_refreshed,
    };

    request.log.info({ tenantId }, "Force-refresh completed for diagnostic verification");

    return reply.send({
      tenantId,
      token_changed: beforeAccessToken !== afterAccessToken,
      expiry_moved_forward: new Date(afterRow.token_expiry) > new Date(beforeRow.token_expiry),
      before: beforeState,
      after: afterState,
    });
  });

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
      if (row.token_expiry && isTokenExpired(row.token_expiry)) {
        const refreshed = await refreshAccessToken(
          tenantId,
          row.refresh_token
        );

        if (refreshed) {
          request.log.info({ tenantId }, "Google Calendar token refreshed");
          return reply.send({
            access_token: refreshed.accessToken,
            refresh_token: decryptToken(row.refresh_token),
            token_expiry: refreshed.tokenExpiry,
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
