import { FastifyInstance } from "fastify";
import { query } from "../../db/client";
import { handleMissedCallSms } from "../../services/missed-call-sms";

/**
 * GET + POST /internal/zadarma-webhook
 *
 * Direct handler for Zadarma PBX Notifications. Replaces the previous
 * n8n-mediated flow (n8n free plan expired 2026-05-09 — workflow
 * webhook returns 404, breaking missed-call SMS).
 *
 * Flow:
 *   Zadarma → POST /internal/zadarma-webhook
 *     → audit-log raw event
 *     → if NOTIFY_END with valid external caller, call handleMissedCallSms()
 *     → SMS sent via Twilio (LT pilot routes through `From=<ourPhone>`)
 *
 * SECURITY:
 *   This route is registered WITHOUT requireInternal middleware. Zadarma
 *   cannot send our x-internal-key header. The GET handler is idempotent
 *   (echoes the zd_echo verification token); the POST handler only acts
 *   on a hardcoded LT pilot tenant ID and is safe to invoke unauth'd.
 */
const LT_PILOT_TENANT_ID = "7d82ab25-e991-4d13-b4ac-846865f8b85a";
const LT_PILOT_OUR_PHONE = "+37066806130";

function normalizePhone(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

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

      return reply.status(200).send({ ok: true, status: "ready" });
    }
  );

  // ── POST: Process Zadarma event directly (no n8n) ───────────────────
  app.post(
    "/zadarma-webhook",
    async (request, reply) => {
      const payload = (request.body ?? {}) as Record<string, unknown>;

      request.log.info(
        { zadarma_event: payload },
        "Zadarma webhook event received"
      );

      const eventType =
        typeof payload.event === "string" ? payload.event : null;
      const callerRaw = payload.caller_id;
      const calledRaw = payload.called_did;
      const customerPhone = normalizePhone(callerRaw);
      const calledNumber = normalizePhone(calledRaw);
      const callStatus =
        typeof payload.call_status === "string" ? payload.call_status : null;
      const pbxCallId =
        typeof payload.pbx_call_id === "string" ? payload.pbx_call_id : null;

      // Trigger missed-call SMS only on NOTIFY_END (one event per call
      // lifecycle — START/INTERNAL would triple-fire). Skip self-calls
      // and events with no external caller.
      let processed = false;
      let processStatus: number | null = null;
      if (
        eventType === "NOTIFY_END" &&
        customerPhone &&
        customerPhone !== calledNumber
      ) {
        try {
          const result = await handleMissedCallSms({
            tenantId: LT_PILOT_TENANT_ID,
            ourPhone: LT_PILOT_OUR_PHONE,
            customerPhone,
            callSid: `zadarma-${pbxCallId ?? Date.now()}`,
            callStatus: "no-answer",
          });
          processed = true;
          processStatus = result.success ? 200 : 500;
          request.log.info(
            {
              tenant_id: LT_PILOT_TENANT_ID,
              customer_phone: customerPhone,
              sms_sent: result.smsSent,
              twilio_sid: result.twilioSid,
              service_error: result.error,
            },
            "Missed-call SMS processed"
          );
        } catch (err) {
          // Never let a service failure escape — Zadarma retries on non-200.
          request.log.error(
            { err: err instanceof Error ? err.message : String(err) },
            "handleMissedCallSms threw — Zadarma still gets 200"
          );
          processStatus = 500;
        }
      }

      // Persist audit row — best-effort, never block the 200 response.
      // The forwarded_to_n8n / n8n_response_status columns now record
      // direct-processing outcome (kept for schema stability).
      try {
        await query(
          `INSERT INTO zadarma_events
             (event_type, caller_id, called_did, call_status, raw_payload, forwarded_to_n8n, n8n_response_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            eventType,
            callerRaw ?? null,
            calledRaw ?? null,
            callStatus,
            JSON.stringify(payload),
            processed,
            processStatus,
          ]
        );
      } catch (err) {
        request.log.error(
          { err: err instanceof Error ? err.message : String(err) },
          "Failed to persist zadarma_events audit row"
        );
      }

      return reply.status(200).send({ ok: true, processed });
    }
  );
}
