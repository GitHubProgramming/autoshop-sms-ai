import { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth";
import { query } from "../../db/client";
import { getConfig } from "../../db/app-config";
import { redis } from "../../queues/redis";

const FWD_TEST_TTL = 120; // seconds
const RATE_LIMIT_TTL = 300; // 5 minutes between tests

/**
 * POST /tenant/test-call-forwarding
 *   Initiates a Twilio outbound call from the AI number to the business phone.
 *   The owner should let it ring without answering. If call forwarding is set up,
 *   the call routes back to the AI number and we detect it.
 *
 * GET /tenant/test-call-forwarding/status
 *   Polls for the test result. Returns:
 *   - pending: call still in progress
 *   - forwarding_detected: an inbound call arrived on the AI number during test
 *   - no_answer: call ended with no-answer and no forwarding was detected
 *   - timeout: test took too long
 */
export async function testCallForwardingRoute(app: FastifyInstance) {
  // ── POST: initiate test call ──────────────────────────────────────────────
  app.post(
    "/test-call-forwarding",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string; email: string };

      // 1. Look up tenant's Twilio number and business phone
      const rows = await query<{
        owner_phone: string | null;
        twilio_phone: string | null;
      }>(
        `SELECT t.owner_phone,
                tpn.phone_number AS twilio_phone
         FROM tenants t
         LEFT JOIN tenant_phone_numbers tpn
           ON tpn.tenant_id = t.id AND tpn.status = 'active'
         WHERE t.id = $1`,
        [tenantId]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: "Tenant not found" });
      }

      const { owner_phone, twilio_phone } = rows[0];

      if (!twilio_phone) {
        return reply
          .status(400)
          .send({ error: "No AI phone number provisioned yet. Complete Step 2 first." });
      }
      if (!owner_phone) {
        return reply
          .status(400)
          .send({ error: "No business phone number on file. Go back to Step 1 and enter your shop phone." });
      }

      // 2. Rate limit — 1 test per 5 minutes
      const rateKey = `fwd_test_rate:${tenantId}`;
      try {
        const exists = await redis.get(rateKey);
        if (exists) {
          return reply.status(429).send({
            error: "Please wait a few minutes before testing again.",
          });
        }
      } catch {
        // Redis down — skip rate limit
      }

      // 3. Get Twilio credentials
      const accountSid = await getConfig("TWILIO_ACCOUNT_SID");
      const authToken = await getConfig("TWILIO_AUTH_TOKEN");
      if (!accountSid || !authToken) {
        return reply.status(500).send({ error: "Twilio credentials not configured" });
      }

      // 4. Make outbound call via Twilio REST API
      const twiml = [
        "<Response>",
        '<Say voice="alice">This is a call forwarding test from AutoShop AI. Please do not answer this call. Let it ring and hang up.</Say>',
        '<Pause length="25"/>',
        "</Response>",
      ].join("");

      const callUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;
      const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

      try {
        const res = await fetch(callUrl, {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: [
            `To=${encodeURIComponent(owner_phone)}`,
            `From=${encodeURIComponent(twilio_phone)}`,
            `Twiml=${encodeURIComponent(twiml)}`,
            `Timeout=25`,
          ].join("&"),
          signal: AbortSignal.timeout(15_000),
        });

        const data = (await res.json()) as {
          sid?: string;
          code?: number;
          message?: string;
        };

        if (!res.ok || !data.sid) {
          request.log.error(
            { status: res.status, body: data },
            "Twilio call creation failed"
          );
          return reply.status(500).send({
            error: `Could not place test call: ${data.message || "Twilio error"}`,
          });
        }

        // 5. Store test state in Redis
        const testState = {
          callSid: data.sid,
          tenantId,
          twilioPhone: twilio_phone,
          businessPhone: owner_phone,
          initiatedAt: Date.now(),
          forwardingDetected: false,
        };

        try {
          await redis.setex(
            `fwd_test:${tenantId}`,
            FWD_TEST_TTL,
            JSON.stringify(testState)
          );
          await redis.setex(rateKey, RATE_LIMIT_TTL, "1");
        } catch (err) {
          request.log.warn({ err }, "Failed to store forwarding test state in Redis");
        }

        return reply.status(200).send({
          callSid: data.sid,
          message: "Calling your shop now — let it ring without answering.",
        });
      } catch (err) {
        request.log.error({ err }, "Failed to initiate forwarding test call");
        return reply.status(500).send({
          error: "Could not place test call. Please try again.",
        });
      }
    }
  );

  // ── GET: poll for result ──────────────────────────────────────────────────
  app.get(
    "/test-call-forwarding/status",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string; email: string };

      try {
        const raw = await redis.get(`fwd_test:${tenantId}`);
        if (!raw) {
          return reply.status(200).send({ result: "no_test", message: "No active test found." });
        }

        const testState = JSON.parse(raw) as {
          callSid: string;
          tenantId: string;
          initiatedAt: number;
          forwardingDetected: boolean;
        };

        // If voice webhook already marked forwarding detected
        if (testState.forwardingDetected) {
          return reply.status(200).send({
            result: "forwarding_detected",
            message: "Forwarding works! Your missed calls will be handled automatically.",
          });
        }

        // Check elapsed time
        const elapsed = Date.now() - testState.initiatedAt;
        if (elapsed > 70_000) {
          return reply.status(200).send({
            result: "not_forwarded",
            message: "We didn't detect forwarding. Double-check your carrier settings and try again.",
          });
        }

        // Check call status via Twilio API
        const accountSid = await getConfig("TWILIO_ACCOUNT_SID");
        const authToken = await getConfig("TWILIO_AUTH_TOKEN");
        if (accountSid && authToken) {
          try {
            const statusUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${testState.callSid}.json`;
            const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
            const res = await fetch(statusUrl, {
              headers: { Authorization: `Basic ${auth}` },
              signal: AbortSignal.timeout(15_000),
            });
            if (res.ok) {
              const callData = (await res.json()) as {
                status: string;
                duration: string | null;
              };
              const status = callData.status;
              const duration = parseInt(callData.duration || "0", 10);

              // Call completed with short duration → likely forwarded and answered by TwiML
              if (status === "completed" && duration > 0 && duration < 10) {
                // Update Redis with detection
                testState.forwardingDetected = true;
                await redis.setex(
                  `fwd_test:${tenantId}`,
                  FWD_TEST_TTL,
                  JSON.stringify(testState)
                );
                return reply.status(200).send({
                  result: "forwarding_detected",
                  message: "Forwarding works! Your missed calls will be handled automatically.",
                });
              }

              if (["no-answer", "busy", "failed", "canceled"].includes(status)) {
                return reply.status(200).send({
                  result: "not_forwarded",
                  message: "Call ended without forwarding. Check your carrier settings and try again.",
                });
              }
            }
          } catch {
            // Twilio API check failed — continue with pending
          }
        }

        return reply.status(200).send({
          result: "pending",
          message: "Call in progress — waiting for result...",
        });
      } catch {
        return reply.status(200).send({ result: "pending" });
      }
    }
  );
}
