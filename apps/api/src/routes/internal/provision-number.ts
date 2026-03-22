import { FastifyInstance } from "fastify";
import { z } from "zod";
import { provisionNumberQueue } from "../../queues/redis";
import { requireInternal } from "../../middleware/require-internal";

const ProvisionBody = z.object({
  tenantId: z.string().uuid(),
  areaCode: z.string().regex(/^\d{3}$/, "Area code must be 3 digits"),
  shopName: z.string().min(1),
});

/**
 * POST /internal/enqueue-provision-number
 *
 * Twilio number provisioning is NEVER done synchronously.
 * This endpoint enqueues an async job (picked up by n8n or BullMQ worker).
 *
 * Called by:
 *  - Stripe checkout.session.completed webhook handler (after payment confirmed)
 *  - Admin panel (manual re-provision)
 */
export async function provisionNumberRoute(app: FastifyInstance) {
  app.post("/enqueue-provision-number", { preHandler: [requireInternal] }, async (request, reply) => {

    const parsed = ProvisionBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { tenantId, areaCode, shopName } = parsed.data;

    const job = await provisionNumberQueue.add(
      "provision-twilio-number",
      { tenantId, areaCode, shopName },
      {
        jobId: `provision-${tenantId}`,
        attempts: 5,
        backoff: { type: "exponential", delay: 5_000 },
      }
    );

    request.log.info({ tenantId, areaCode, jobId: job.id }, "Provision job enqueued");

    return reply.status(202).send({
      status: "queued",
      jobId: job.id,
      message: "Number provisioning queued — check status via admin panel",
    });
  });
}
