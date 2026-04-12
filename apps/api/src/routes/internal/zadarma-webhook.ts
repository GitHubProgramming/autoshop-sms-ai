import { FastifyInstance } from "fastify";
import { query } from "../../db/client";
import { fetchWithTimeout } from "../../utils/fetch-with-timeout";

/**
 * GET + POST /internal/zadarma-webhook
 *
 * Proxy between Zadarma PBX Notifications and our n8n webhook.
 *
 * WHY THIS EXISTS:
 *   Zadarma's Notifications URL configuration does NOT support custom auth
 *   headers — it only sends raw POST payloads and expects the endpoint to
 *   respond to a GET ?zd_echo=<token> URL-verification challenge.
 *   Our n8n webhook requires an x-zadarma-secret header for auth.
 *   This endpoint bridges the two: it accepts unauthenticated calls from
 *   Zadarma, then forwards events to n8n with the correct auth header.
 *
 * SECURITY NOTE:
 *   This route is registered WITHOUT the requireInternal middleware even
 *   though it lives under /internal/*. This is intentional — Zadarma
 *   cannot send our x-internal-key header. The GET handler is idempotent
 *   (just echoes a string), and the POST handler only forwards to a
 *   hardcoded internal URL — no data is exposed or mutated externally.
 */

const DEFAULT_N8N_URL =
  "https://bandomasis.app.n8n.cloud/webhook/lt-zadarma-missed-call";

export async function zadarmaWebhookRoute(app: FastifyInstance) {
  // ── GET: Zadarma URL verification (zd_echo) + health check ──────────
  app.get(
    "/zadarma-webhook",
    async (request, reply) => {
      const { zd_echo } = request.query as { zd_echo?: string };

      if (zd_echo) {
        request.log.info({ zd_echo }, "Zadarma URL verification challenge");
        return reply
          .status(200)
          .header("Content-Type", "text/plain")
          .send(zd_echo);
      }

      // No zd_echo — treat as health check
      return reply.status(200).send({ ok: true, status: "ready" });
    }
  );

  // ── POST: Forward Zadarma event payload to n8n ──────────────────────
  app.post(
    "/zadarma-webhook",
    async (request, reply) => {
      const payload = request.body as Record<string, unknown> | null;

      request.log.info(
        { zadarma_event: payload },
        "Zadarma webhook event received"
      );

      const webhookSecret = process.env.ZADARMA_WEBHOOK_SECRET;
      if (!webhookSecret) {
        request.log.warn(
          "ZADARMA_WEBHOOK_SECRET not set — cannot forward to n8n"
        );
        // Still return 200 so Zadarma doesn't retry
        return reply
          .status(200)
          .send({ ok: false, error: "webhook_secret_not_configured" });
      }

      const n8nUrl =
        process.env.N8N_LT_ZADARMA_WEBHOOK_URL ?? DEFAULT_N8N_URL;

      let n8nStatus: number | null = null;
      let forwarded = false;

      try {
        const res = await fetchWithTimeout(
          n8nUrl,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-zadarma-secret": webhookSecret,
            },
            body: JSON.stringify(payload ?? {}),
          },
          10_000
        );
        n8nStatus = res.status;
        forwarded = true;
        request.log.info(
          { n8n_status: n8nStatus },
          "Zadarma event forwarded to n8n"
        );
      } catch (err) {
        request.log.error(
          { err: err instanceof Error ? err.message : String(err) },
          "Failed to forward Zadarma event to n8n"
        );
      }

      // Persist audit row — best-effort, never block the 200 response.
      try {
        await query(
          `INSERT INTO zadarma_events
             (event_type, caller_id, called_did, call_status, raw_payload, forwarded_to_n8n, n8n_response_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            (payload as Record<string, unknown>)?.event ?? null,
            (payload as Record<string, unknown>)?.caller_id ?? null,
            (payload as Record<string, unknown>)?.called_did ?? null,
            (payload as Record<string, unknown>)?.call_status ?? null,
            JSON.stringify(payload ?? {}),
            forwarded,
            n8nStatus,
          ]
        );
      } catch (err) {
        request.log.error(
          { err: err instanceof Error ? err.message : String(err) },
          "Failed to persist zadarma_events audit row"
        );
      }

      // Always return 200 — Zadarma retries aggressively on non-200.
      return reply.status(200).send({
        ok: true,
        forwarded,
        n8n_status: n8nStatus,
      });
    }
  );
}
