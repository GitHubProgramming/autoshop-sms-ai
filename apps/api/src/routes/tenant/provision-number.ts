import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../middleware/require-auth";
import { provisionNumberQueue } from "../../queues/redis";
import { query } from "../../db/client";
import { getSharedTestNumber } from "../../utils/test-tenant";
import { getTenantById, isDemoMode } from "../../db/tenants";

const ProvisionBody = z.object({
  areaCode: z.string().regex(/^\d{3}$/, "Area code must be 3 digits"),
});

/**
 * POST /tenant/provision-number
 *
 * Tenant-scoped number provisioning endpoint.
 * Protected by JWT auth — tenantId comes from the verified token, NOT from the body.
 * Enqueues an async BullMQ job for Twilio number provisioning.
 */
export async function tenantProvisionNumberRoute(app: FastifyInstance) {
  app.post("/provision-number", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };

    const parsed = ProvisionBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`),
      });
    }

    const { areaCode } = parsed.data;

    // ── Demo mode gate: provisioning requires trial or active account ────────
    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      return reply.status(404).send({ error: "Tenant not found" });
    }
    if (isDemoMode(tenant)) {
      return reply.status(403).send({
        error: "Provisioning requires an active trial or subscription. Start your free trial to activate.",
      });
    }

    // Check if tenant already has an active number
    const existing = await query<{ id: string }>(
      `SELECT id FROM tenant_phone_numbers WHERE tenant_id = $1 AND status = 'active' LIMIT 1`,
      [tenantId]
    );
    if (existing.length > 0) {
      return reply.status(409).send({
        error: "Tenant already has an active phone number",
      });
    }

    // ── Test tenant: assign shared number instead of buying from Twilio ──────
    const tenantRows = await query<{ shop_name: string; is_test: boolean }>(
      `SELECT shop_name, is_test FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const shopName = tenantRows[0]?.shop_name ?? "My Shop";

    if (tenantRows[0]?.is_test) {
      const result = getSharedTestNumber();
      if (!result.ok) {
        return reply.status(500).send({ error: result.error });
      }
      request.log.info({ tenantId }, "Test tenant — returning shared test number (no Twilio purchase)");
      return reply.status(200).send({
        status: "assigned",
        phone_number: result.phoneNumber,
        test: true,
      });
    }

    // ── Real tenant: enqueue Twilio purchase ──────────────────────────────────
    const job = await provisionNumberQueue.add(
      "provision-twilio-number",
      { tenantId, areaCode, shopName },
      {
        jobId: `provision-${tenantId}`,
        attempts: 5,
        backoff: { type: "exponential", delay: 5_000 },
      }
    );

    request.log.info({ tenantId, areaCode, jobId: job.id }, "Provision job enqueued via tenant endpoint");

    return reply.status(202).send({
      status: "queued",
      jobId: job.id,
    });
  });

  /**
   * POST /tenant/provision-number/retry
   *
   * Manual retry for tenants stuck in 'error' or 'pending_setup'. Used by the
   * dashboard "Retry provisioning" action and by ops when a transient Twilio
   * issue caused a permanent failure.
   *
   * Guards:
   *   - 'ready'        → 400 already_provisioned
   *   - 'provisioning' → 409 already_in_progress
   *   - 'demo'         → 403 demo_mode (covered by isDemoMode)
   *   - test tenant    → returns the shared test number, no requeue
   *
   * On accept: clears provisioning_error_reason, enqueues a fresh job, returns 202.
   */
  app.post(
    "/provision-number/retry",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string; email: string };

      const tenant = await getTenantById(tenantId);
      if (!tenant) {
        return reply.status(404).send({ error: "Tenant not found" });
      }
      if (isDemoMode(tenant)) {
        return reply.status(403).send({
          error:
            "Provisioning requires an active trial or subscription. Start your free trial to activate.",
        });
      }
      if (tenant.provisioning_state === "ready") {
        return reply
          .status(400)
          .send({ error: "already_provisioned" });
      }
      if (tenant.provisioning_state === "provisioning") {
        return reply
          .status(409)
          .send({ error: "already_in_progress" });
      }

      // Test tenants short-circuit to the shared test number — same as the
      // initial provisioning endpoint above.
      const tenantRows = await query<{ shop_name: string; is_test: boolean }>(
        `SELECT shop_name, is_test FROM tenants WHERE id = $1`,
        [tenantId],
      );
      if (tenantRows[0]?.is_test) {
        const result = getSharedTestNumber();
        if (!result.ok) {
          return reply.status(500).send({ error: result.error });
        }
        return reply.status(200).send({
          status: "assigned",
          phone_number: result.phoneNumber,
          test: true,
        });
      }

      // Clear stale error_reason before re-enqueue so the dashboard reflects
      // the in-flight retry rather than the previous failure.
      await query(
        `UPDATE tenants
           SET provisioning_state = 'pending_setup',
               provisioning_error_reason = NULL,
               updated_at = NOW()
         WHERE id = $1`,
        [tenantId],
      );

      const shopName = tenantRows[0]?.shop_name ?? "My Shop";

      // Use the same jobId pattern as the Stripe webhook so BullMQ dedups
      // against any in-flight provision job for this tenant. The state
      // guard above already returns 409 for state='provisioning', but the
      // jobId dedup is the safety net for the race window between check
      // and enqueue. Failed/completed jobs with this id need to be removed
      // first so the retry can re-enqueue.
      try {
        const prior = await provisionNumberQueue.getJob(`provision-${tenantId}`);
        if (prior && ((await prior.isFailed()) || (await prior.isCompleted()))) {
          await prior.remove();
        }
      } catch (cleanupErr) {
        request.log.warn(
          { tenantId, err: (cleanupErr as Error).message },
          "failed to clean up prior provision job before retry",
        );
        // Non-fatal — proceed to add()
      }

      const job = await provisionNumberQueue.add(
        "provision-twilio-number",
        { tenantId, shopName },
        {
          jobId: `provision-${tenantId}`,
          attempts: 5,
          backoff: { type: "exponential", delay: 5_000 },
        },
      );

      request.log.info(
        { tenantId, jobId: job.id },
        "Provision retry job enqueued",
      );

      return reply.status(202).send({
        status: "queued",
        jobId: job.id,
      });
    },
  );
}
