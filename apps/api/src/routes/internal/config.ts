import { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../../db/client";

const SetConfigBody = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
});

const ALLOWED_KEYS = new Set([
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
]);

/**
 * POST /internal/config
 * GET  /internal/config/:key
 *
 * Runtime configuration endpoint for secrets that can't be set via env vars.
 * Only allows a whitelist of keys to prevent misuse.
 * Internal only — NOT exposed externally.
 */
export async function configRoute(app: FastifyInstance) {
  app.post("/config", async (request, reply) => {
    const parsed = SetConfigBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "key and value required" });
    }

    const { key, value } = parsed.data;

    if (!ALLOWED_KEYS.has(key)) {
      return reply
        .status(403)
        .send({ error: `Key '${key}' is not in the allowed list` });
    }

    await query(
      `INSERT INTO app_config (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, value]
    );

    request.log.info({ key }, "Config key set");
    return reply.status(200).send({ ok: true, key });
  });

  app.get("/config/:key", async (request, reply) => {
    const { key } = request.params as { key: string };
    const rows = await query<{ value: string }>(
      "SELECT value FROM app_config WHERE key = $1",
      [key]
    );
    if (rows.length === 0) {
      return reply.status(404).send({ error: "Key not found" });
    }
    return reply.send({ key, value: rows[0].value });
  });
}
