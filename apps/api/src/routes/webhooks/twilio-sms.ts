import { FastifyInstance } from "fastify";
import { z } from "zod";
import { validateTwilioSignature } from "../../middleware/twilio-validate";
import { getTenantByPhoneNumber, getBlockReason } from "../../db/tenants";
import {
  smsInboundQueue,
  checkIdempotency,
  markIdempotency,
} from "../../queues/redis";
import { startTrace } from "../../services/pipeline-trace";

// Twilio sends form-encoded body
const TwilioSmsBody = z.object({
  MessageSid: z.string(),
  AccountSid: z.string(),
  From: z.string(), // customer's phone
  To: z.string(),   // our Twilio number (= tenant's number)
  Body: z.string(),
  NumMedia: z.string().optional(),
});

export async function twilioSmsRoute(app: FastifyInstance) {
  app.post(
    "/sms",
    { preHandler: validateTwilioSignature },
    async (request, reply) => {
      const parsed = TwilioSmsBody.safeParse(request.body);
      if (!parsed.success) {
        request.log.warn({ body: request.body }, "Invalid Twilio SMS body");
        return reply.status(400).send({ error: "Invalid body" });
      }

      const { MessageSid, From, To, Body } = parsed.data;

      // ── 0. Start execution trace ──────────────────────────────────────────
      let traceId: string | null = null;
      try {
        const trace = await startTrace({
          triggerType: "inbound_sms",
          triggerId: MessageSid,
          customerPhone: From,
        });
        traceId = trace.id;
        await trace.step("webhook_received", "ok", `POST /webhooks/twilio/sms from ${From}`);
      } catch {
        // Non-fatal: tracing must never break the pipeline
      }

      // ── 1. Idempotency (Twilio retries if no 200 within 15s) ──────────────
      const alreadyProcessed = await checkIdempotency(`twilio:${MessageSid}`);
      if (alreadyProcessed) {
        request.log.info({ MessageSid }, "Duplicate webhook — skipping");
        return reply.status(200).type("text/xml").send("<Response/>");
      }
      await markIdempotency(`twilio:${MessageSid}`);

      // ── 2. Tenant lookup by inbound phone number ───────────────────────────
      const tenant = await getTenantByPhoneNumber(To);
      if (!tenant) {
        request.log.warn({ to: To }, "No tenant found for phone number");
        if (traceId) {
          const { resumeTrace } = await import("../../services/pipeline-trace");
          const t = await resumeTrace(traceId);
          await t.step("tenant_resolved", "fail", `No tenant for ${To}`);
          await t.fail(`No tenant found for phone number ${To}`);
        }
        // Return 200 to Twilio (avoid retry storms), but don't process
        return reply.status(200).type("text/xml").send("<Response/>");
      }

      if (traceId) {
        try {
          const { resumeTrace } = await import("../../services/pipeline-trace");
          const t = await resumeTrace(traceId);
          await t.setTenant(tenant.id);
          await t.step("tenant_resolved", "ok", `${tenant.shop_name ?? "unknown"} (${tenant.id.slice(0, 8)})`);
        } catch { /* non-fatal */ }
      }

      // ── 3. Enforcement check ───────────────────────────────────────────────
      const blockReason = getBlockReason(tenant);
      if (blockReason) {
        request.log.info(
          { tenantId: tenant.id, blockReason },
          "Tenant blocked — sending auto-reply"
        );
        if (traceId) {
          try {
            const { resumeTrace } = await import("../../services/pipeline-trace");
            const t = await resumeTrace(traceId);
            await t.step("billing_check", "fail", `Blocked: ${blockReason}`);
            await t.fail(`Tenant blocked: ${blockReason}`);
          } catch { /* non-fatal */ }
        }
        // Send polite auto-reply via TwiML so the customer isn't left hanging
        const autoReply = getBlockedAutoReply(blockReason, tenant.shop_name);
        const twiml = `<Response><Message>${escapeXml(autoReply)}</Message></Response>`;
        return reply.status(200).type("text/xml").send(twiml);
      }

      // ── 4. Check if active plan is at soft limit (paid, 100% used) ─────────
      const atSoftLimit =
        tenant.billing_status === "active" &&
        tenant.conv_used_this_cycle >= tenant.conv_limit_this_cycle;

      // ── 5. Enqueue for async processing — respond to Twilio immediately ────
      // Wrapped in try/catch: always return 200 to Twilio to prevent retry storms,
      // even if Redis/BullMQ is temporarily unavailable.
      try {
        await smsInboundQueue.add(
          "process-sms",
          {
            tenantId: tenant.id,
            customerPhone: From,
            ourPhone: To,
            body: Body,
            messageSid: MessageSid,
            atSoftLimit,
            traceId,
          },
          {
            jobId: `sms-${MessageSid}`, // BullMQ dedup key
          }
        );

        request.log.info(
          { tenantId: tenant.id, from: From, messageSid: MessageSid },
          "SMS job enqueued"
        );

        if (traceId) {
          try {
            const { resumeTrace } = await import("../../services/pipeline-trace");
            const t = await resumeTrace(traceId);
            await t.step("job_enqueued", "ok", "sms-inbound / process-sms");
          } catch { /* non-fatal */ }
        }
      } catch (err) {
        request.log.error(
          { err, tenantId: tenant.id, messageSid: MessageSid },
          "Failed to enqueue SMS job — Redis may be down"
        );
        if (traceId) {
          try {
            const { resumeTrace } = await import("../../services/pipeline-trace");
            const t = await resumeTrace(traceId);
            await t.step("job_enqueued", "fail", `Redis error: ${(err as Error).message}`);
            await t.fail(`Failed to enqueue job: ${(err as Error).message}`);
          } catch { /* non-fatal */ }
        }
      }

      // Must respond with TwiML — empty = no immediate reply (worker sends reply)
      return reply.status(200).type("text/xml").send("<Response/>");
    }
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns a polite auto-reply message for blocked tenants.
 * The customer should never get silence — that damages the shop's reputation.
 */
export function getBlockedAutoReply(
  blockReason: string,
  shopName: string | null
): string {
  const name = shopName ?? "this business";

  switch (blockReason) {
    case "trial_expired":
    case "trial_limit_reached":
      return (
        `Thank you for reaching out! ${name}'s automated messaging ` +
        `service is temporarily unavailable. Please call them directly ` +
        `for assistance.`
      );
    case "service_canceled":
      return (
        `Thank you for your message. ${name}'s automated messaging ` +
        `is no longer active. Please call them directly.`
      );
    case "payment_failed":
      return (
        `Thank you for reaching out! ${name}'s messaging service is ` +
        `temporarily unavailable. Please call them directly for assistance.`
      );
    case "service_paused":
      return (
        `Thank you for your message. ${name}'s messaging service is ` +
        `temporarily paused. Please call them directly.`
      );
    default:
      return (
        `Thank you for reaching out! ${name} is currently unavailable ` +
        `via text. Please call them directly for assistance.`
      );
  }
}

/** Escape special XML characters for TwiML body. */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
