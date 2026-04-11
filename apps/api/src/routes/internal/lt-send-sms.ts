import { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../../db/client";
import { requireInternal } from "../../middleware/require-internal";
import { signZadarmaRequest } from "../../utils/zadarma";
import { fetchWithTimeout } from "../../utils/fetch-with-timeout";
import { resolveLtTenantId } from "../../utils/lt-tenant";

/**
 * POST /internal/lt-send-sms
 *
 * Backend wrapper around the Zadarma SMS API for the LT pilot. n8n cannot
 * compute the HMAC-SHA1 signature Zadarma requires inside a stock HTTP
 * Request node, and the free n8n tier has no env vars for API credentials —
 * so the signing + credential management lives here on the backend instead.
 *
 * Flow:
 *   1. Validate body (E.164 `to`, message length, tenant_id).
 *   2. Resolve tenant slug/UUID → canonical tenant UUID.
 *   3. Read ZADARMA_API_KEY / ZADARMA_API_SECRET from env. Return 503 if
 *      either is missing (fail-closed — do not throw at startup).
 *   4. Build a signed, form-urlencoded request and POST it to Zadarma.
 *   5. On Zadarma success, persist an outbound message row (reusing the
 *      existing conversations/messages pattern from lt-log-conversation).
 *   6. Return 200 either way — success with { ok: true, ... } or logical
 *      failure with { ok: false, error, zadarma_response } so n8n never
 *      retries a 5xx (SMS would double-send).
 *
 * Internal only — requires x-internal-key header.
 */

const BodySchema = z.object({
  to: z
    .string()
    .regex(/^\+\d{6,20}$/, "to must be E.164 starting with +"),
  message: z.string().min(1).max(1600),
  tenant_id: z.string().min(1),
  source: z.string().min(1).max(64).optional().default("zadarma-missed-call"),
});

// LT Proteros Servisas DID — fixed sender for all outbound LT pilot SMS.
const LT_SENDER_CALLER_ID = "+37045512300";

// Full URL + signed path. The path (with trailing slash) is part of the signed
// string, so it must NOT include the domain.
const ZADARMA_URL = "https://api.zadarma.com/v1/sms/send/";
const ZADARMA_PATH = "/v1/sms/send/";

type ZadarmaResponseShape = {
  status?: string;
  [k: string]: unknown;
};

export async function ltSendSmsRoute(app: FastifyInstance) {
  app.post(
    "/lt-send-sms",
    { preHandler: [requireInternal] },
    async (request, reply) => {
      const parsed = BodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          ok: false,
          error: "validation_failed",
          details: parsed.error.issues.map(
            (i) => `${i.path.join(".")}: ${i.message}`
          ),
        });
      }

      const { to, message, tenant_id, source } = parsed.data;

      const tenantUuid = resolveLtTenantId(tenant_id);
      if (!tenantUuid) {
        return reply.status(400).send({
          ok: false,
          error: "unknown_tenant",
          details: [
            `tenant_id "${tenant_id}" is neither a UUID nor a known LT slug`,
          ],
        });
      }

      // Fail-closed: missing credentials → 503 at request time, not startup.
      // This keeps the server bootable even if Zadarma creds are not yet set
      // on the Render service (per CLAUDE.md: visibility of blockers).
      const apiKey = process.env.ZADARMA_API_KEY;
      const apiSecret = process.env.ZADARMA_API_SECRET;
      if (!apiKey || !apiSecret) {
        request.log.warn(
          "ZADARMA_API_KEY/ZADARMA_API_SECRET not set — lt-send-sms unavailable"
        );
        return reply.status(503).send({
          ok: false,
          error: "zadarma_credentials_not_configured",
        });
      }

      // Build signed Zadarma request (pure helper — see utils/zadarma.ts).
      const signed = signZadarmaRequest(
        ZADARMA_PATH,
        { caller_id: LT_SENDER_CALLER_ID, message, number: to },
        apiKey,
        apiSecret
      );

      // Send — Zadarma expects form-urlencoded with the literal `apiKey:sig`
      // Authorization header (no "Bearer " prefix).
      let zadarmaResponse: ZadarmaResponseShape | { raw: string } | null = null;
      let zadarmaOk = false;
      try {
        const res = await fetchWithTimeout(
          ZADARMA_URL,
          {
            method: "POST",
            headers: {
              Authorization: signed.authHeader,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: signed.body.toString(),
          },
          15_000
        );
        const text = await res.text();
        try {
          zadarmaResponse = JSON.parse(text) as ZadarmaResponseShape;
        } catch {
          zadarmaResponse = { raw: text };
        }
        zadarmaOk =
          res.ok &&
          typeof zadarmaResponse === "object" &&
          zadarmaResponse !== null &&
          (zadarmaResponse as ZadarmaResponseShape).status === "success";
      } catch (err) {
        request.log.error(
          { err: err instanceof Error ? err.message : String(err) },
          "Zadarma SMS request failed (network/timeout)"
        );
        return reply.status(200).send({
          ok: false,
          error: "zadarma_request_failed",
          zadarma_response: {
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }

      if (!zadarmaOk) {
        request.log.warn(
          { zadarmaResponse, to },
          "Zadarma SMS send returned non-success"
        );
        return reply.status(200).send({
          ok: false,
          error: "zadarma_send_failed",
          zadarma_response: zadarmaResponse,
        });
      }

      // Success — persist to conversations/messages for dashboard visibility.
      // DB failure must not fail the response: the SMS already went out.
      let conversationId: string | null = null;
      try {
        const tenantRows = await query<{ id: string }>(
          `SELECT id FROM tenants WHERE id = $1 LIMIT 1`,
          [tenantUuid]
        );
        if (tenantRows.length === 0) {
          request.log.warn(
            { tenantUuid, to },
            "Zadarma SMS sent but tenant row missing — skipping log"
          );
        } else {
          const convRows = await query<{ id: string }>(
            `SELECT id FROM conversations
               WHERE tenant_id = $1 AND customer_phone = $2 AND status = 'open'
               ORDER BY opened_at DESC
               LIMIT 1`,
            [tenantUuid, to]
          );
          if (convRows.length > 0) {
            conversationId = convRows[0].id;
            await query(
              `UPDATE conversations
                  SET last_message_at = NOW(), turn_count = turn_count + 1
                WHERE id = $1`,
              [conversationId]
            );
          } else {
            const newConv = await query<{ id: string }>(
              `INSERT INTO conversations
                 (tenant_id, customer_phone, status, opened_at, last_message_at, turn_count)
               VALUES ($1, $2, 'open', NOW(), NOW(), 1)
               RETURNING id`,
              [tenantUuid, to]
            );
            conversationId = newConv[0].id;
          }
          await query(
            `INSERT INTO messages
               (tenant_id, conversation_id, direction, body, source, sent_at)
             VALUES ($1, $2, 'outbound', $3, $4, NOW())`,
            [tenantUuid, conversationId, message, source]
          );
        }
      } catch (err) {
        request.log.error(
          { err: err instanceof Error ? err.message : String(err) },
          "Failed to persist Zadarma SMS log (SMS already sent)"
        );
      }

      return reply.status(200).send({
        ok: true,
        zadarma_status: zadarmaResponse,
        conversation_id: conversationId,
      });
    }
  );
}
