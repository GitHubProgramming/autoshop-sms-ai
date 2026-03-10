import { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../../db/client";
import { decryptToken } from "../auth/google";

const ParamsSchema = z.object({
  tenantId: z.string().uuid(),
});

/**
 * GET /internal/calendar-tokens/:tenantId
 *
 * Returns decrypted Google Calendar tokens for a tenant.
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
