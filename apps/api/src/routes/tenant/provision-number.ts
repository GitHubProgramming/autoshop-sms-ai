import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../middleware/require-auth";
import { provisionNumberQueue } from "../../queues/redis";
import { query } from "../../db/client";

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

    // Fetch shop name from tenant record (never trust client-supplied values for provisioning)
    const tenantRows = await query<{ shop_name: string }>(
      `SELECT shop_name FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const shopName = tenantRows[0]?.shop_name ?? "My Shop";

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
}
