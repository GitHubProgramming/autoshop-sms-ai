import { FastifyInstance, FastifyBaseLogger } from "fastify";
import { z } from "zod";
import { validateTwilioSignature } from "../../middleware/twilio-validate";
import { getTenantByPhoneNumber, getBlockReason } from "../../db/tenants";
import { smsInboundQueue, checkMissedCallDedupe } from "../../queues/redis";
import { deduplicateWebhook } from "../../db/webhook-events";
import { startTrace, resumeTrace } from "../../services/pipeline-trace";
import { handleMissedCallSms, type MissedCallInput } from "../../services/missed-call-sms";

const TwilioVoiceStatusBody = z.object({
  CallSid: z.string(),
  CallStatus: z.string().optional(),     // from statusCallback
  DialCallStatus: z.string().optional(), // from <Dial action="...">
  To: z.string(),         // shop's number
  From: z.string(),       // customer's number
  Direction: z.string().optional(),
});

/**
 * Twilio calls this when a call to the shop's number ends.
 *
 * Two trigger paths:
 *   1. <Dial action="..."> callback → sends DialCallStatus (no-answer, busy, failed, completed)
 *   2. StatusCallback URL → sends CallStatus
 *
 * If status = 'no-answer' | 'busy' | 'failed' → trigger missed-call SMS flow.
 */
export async function twilioVoiceStatusRoute(app: FastifyInstance) {
  app.post(
    "/voice-status",
    { preHandler: validateTwilioSignature },
    async (request, reply) => {
      const parsed = TwilioVoiceStatusBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid body" });
      }

      // DialCallStatus takes priority (from <Dial action>), fall back to CallStatus
      const { CallSid, DialCallStatus, To, From } = parsed.data;
      const CallStatus = DialCallStatus ?? parsed.data.CallStatus ?? "";

      const MISSED_STATUSES = ["no-answer", "busy", "failed"];
      if (!MISSED_STATUSES.includes(CallStatus)) {
        // Not a missed call — ignore
        return reply.status(200).type("text/xml").send("<Response/>");
      }

      // ── Idempotency (two-tier: Redis + PostgreSQL) ────────────────────────
      // MUST run before any DB writes (including startTrace) to prevent
      // duplicate pipeline traces on Twilio retries.
      const dedup = await deduplicateWebhook("twilio_voice_status", CallSid);
      if (dedup.isDuplicate) {
        request.log.info(
          { CallSid, source: "twilio_voice_status", event: "webhook_duplicate_detected" },
          "Duplicate voice-status webhook — skipping"
        );
        return reply.status(200).type("text/xml").send("<Response/>");
      }

      // ── Start execution trace ──────────────────────────────────────────
      let traceId: string | null = null;
      try {
        const trace = await startTrace({
          triggerType: "missed_call",
          triggerId: CallSid,
          customerPhone: From,
        });
        traceId = trace.id;
        await trace.step("webhook_received", "ok", `POST /webhooks/twilio/voice-status — ${CallStatus}`);
      } catch {
        // Non-fatal
      }

      const tenant = await getTenantByPhoneNumber(To);
      if (!tenant) {
        request.log.warn({ to: To }, "No tenant found for voice status webhook");
        if (traceId) {
          try {
            const t = await resumeTrace(traceId);
            await t.step("tenant_resolved", "fail", `No tenant for ${To}`);
            await t.fail(`No tenant found for phone number ${To}`);
          } catch { /* non-fatal */ }
        }
        return reply.status(200).type("text/xml").send("<Response/>");
      }

      if (traceId) {
        try {
          const t = await resumeTrace(traceId);
          await t.setTenant(tenant.id);
          await t.step("tenant_resolved", "ok", `${tenant.shop_name ?? "unknown"} (${tenant.id.slice(0, 8)})`);
        } catch { /* non-fatal */ }
      }

      // ── Caller dedupe (tenant + phone + 5min window) ────────────────────
      // Prevents duplicate missed-call flows when the same caller produces
      // multiple CallSids (redials, busy retries, forwarding loops).
      try {
        const isDuplicateCaller = await checkMissedCallDedupe(tenant.id, From);
        if (isDuplicateCaller) {
          request.log.info(
            { tenantId: tenant.id, from: From, CallSid, event: "missed_call_caller_dedupe" },
            "Duplicate missed-call for same caller within 5min window — skipping"
          );
          if (traceId) {
            try {
              const t = await resumeTrace(traceId);
              await t.step("caller_dedupe", "skip", `Duplicate caller ${From} within 5min`);
              await t.complete();
            } catch { /* non-fatal */ }
          }
          return reply.status(200).type("text/xml").send("<Response/>");
        }
      } catch (err) {
        // Redis failure — fall through and process (same as webhook dedup policy)
        request.log.warn({ err }, "Missed-call caller dedupe check failed — proceeding");
      }

      // ── Billing enforcement ────────────────────────────────────────────
      // Don't send missed-call SMS for blocked tenants (canceled, paused, etc.)
      const blockReason = getBlockReason(tenant);
      if (blockReason) {
        request.log.info(
          { tenantId: tenant.id, blockReason },
          "Tenant blocked — skipping missed-call SMS"
        );
        if (traceId) {
          try {
            const t = await resumeTrace(traceId);
            await t.step("billing_check", "fail", `Blocked: ${blockReason}`);
            await t.fail(`Tenant blocked: ${blockReason}`);
          } catch { /* non-fatal */ }
        }
        return reply.status(200).type("text/xml").send("<Response/>");
      }

      // Enqueue missed-call SMS trigger
      // This must fire within 5–20 seconds — worker sends the first SMS
      // If Redis is down, fall back to direct synchronous processing so the
      // customer still gets the SMS (never silently drop a missed call).
      const missedCallInput: MissedCallInput = {
        tenantId: tenant.id,
        customerPhone: From,
        ourPhone: To,
        callSid: CallSid,
        callStatus: CallStatus,
      };

      try {
        await smsInboundQueue.add(
          "missed-call-trigger",
          {
            ...missedCallInput,
            triggerType: "missed_call",
            traceId,
          },
          {
            jobId: `missed-call-${CallSid}`,
            priority: 1, // High priority — speed matters for first SMS
          }
        );

        request.log.info(
          { tenantId: tenant.id, callSid: CallSid, callStatus: CallStatus },
          "Missed call job enqueued"
        );

        if (traceId) {
          try {
            const t = await resumeTrace(traceId);
            await t.step("job_enqueued", "ok", "sms-inbound / missed-call-trigger");
          } catch { /* non-fatal */ }
        }
      } catch (err) {
        request.log.error(
          { err, tenantId: tenant.id, callSid: CallSid, customerPhone: From },
          "Redis unavailable — falling back to synchronous missed-call SMS"
        );
        if (traceId) {
          try {
            const t = await resumeTrace(traceId);
            await t.step("job_enqueued", "fail", `Redis error — using sync fallback: ${(err as Error).message}`);
          } catch { /* non-fatal */ }
        }

        // Fire-and-forget: process the missed call directly so Twilio
        // gets 200 immediately while we still attempt the SMS.
        runMissedCallFallback(missedCallInput, traceId, request.log);
      }

      return reply.status(200).type("text/xml").send("<Response/>");
    }
  );
}

/**
 * Synchronous fallback for missed-call SMS when Redis/BullMQ is unavailable.
 *
 * Runs via setImmediate so the Twilio webhook response is not blocked.
 * Has its own try/catch so a failure here can never crash the process.
 */
function runMissedCallFallback(
  input: MissedCallInput,
  traceId: string | null,
  log: FastifyBaseLogger
): void {
  setImmediate(async () => {
    try {
      const result = await handleMissedCallSms(input);

      if (result.success) {
        log.info(
          { tenantId: input.tenantId, smsSent: result.smsSent, conversationId: result.conversationId },
          "Sync fallback: missed-call SMS processed successfully"
        );
        if (traceId) {
          try {
            const t = await resumeTrace(traceId);
            await t.step("sync_fallback", "ok", `SMS sent=${result.smsSent}`);
            await t.complete();
          } catch { /* non-fatal */ }
        }
      } else {
        log.error(
          { tenantId: input.tenantId, customerPhone: input.customerPhone, error: result.error },
          "Sync fallback: missed-call SMS FAILED"
        );
        if (traceId) {
          try {
            const t = await resumeTrace(traceId);
            await t.step("sync_fallback", "fail", result.error ?? "unknown");
            await t.fail(`Sync fallback failed: ${result.error}`);
          } catch { /* non-fatal */ }
        }
      }
    } catch (fallbackErr) {
      log.error(
        { tenantId: input.tenantId, customerPhone: input.customerPhone, err: fallbackErr },
        "CRITICAL: missed-call SMS lost — both queue and sync fallback failed"
      );
      if (traceId) {
        try {
          const t = await resumeTrace(traceId);
          await t.step("sync_fallback", "fail", (fallbackErr as Error).message);
          await t.fail(`Both queue and fallback failed: ${(fallbackErr as Error).message}`);
        } catch { /* non-fatal */ }
      }
    }
  });
}
