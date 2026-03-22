import { FastifyRequest, FastifyReply } from "fastify";

/**
 * Fastify preHandler: requires a valid internal API key in the
 * x-internal-key header. Rejects all requests without it.
 *
 * Configuration:
 *   INTERNAL_API_KEY — shared secret known only to internal services
 *                      (BullMQ workers, n8n webhooks, admin scripts)
 *
 * Returns:
 *   403 — missing or invalid key
 *   503 — INTERNAL_API_KEY not configured (fail-closed in production)
 */
export async function requireInternal(request: FastifyRequest, reply: FastifyReply) {
  const configuredKey = process.env.INTERNAL_API_KEY;

  // Fail-closed: if the env var is not set, reject all requests
  // in production. In development, allow through with a warning.
  if (!configuredKey) {
    if (process.env.NODE_ENV === "production") {
      request.log.error("INTERNAL_API_KEY not configured — rejecting internal request");
      await reply.status(503).send({ error: "Internal API not configured" });
      return;
    }
    // Development: warn but allow (so local dev works without extra config)
    request.log.warn("INTERNAL_API_KEY not set — allowing internal request in dev mode");
    return;
  }

  const providedKey = request.headers["x-internal-key"] as string | undefined;

  if (!providedKey || providedKey !== configuredKey) {
    request.log.warn(
      { hasKey: !!providedKey },
      "Internal endpoint called without valid x-internal-key"
    );
    await reply.status(403).send({ error: "Forbidden" });
    return;
  }
}
