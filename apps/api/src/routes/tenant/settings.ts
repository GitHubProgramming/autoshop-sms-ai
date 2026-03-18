import { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../../db/client";
import { requireAuth } from "../../middleware/require-auth";

const UpdateSettingsSchema = z.object({
  shop_name: z.string().min(1).max(200),
});

/**
 * PUT /tenant/settings
 *
 * Updates tenant settings (currently shop_name).
 * Protected by JWT auth — tenantId comes from the verified token.
 */
export async function tenantSettingsRoute(app: FastifyInstance) {
  app.put("/settings", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };

    const parsed = UpdateSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`),
      });
    }

    const { shop_name } = parsed.data;

    await query(
      `UPDATE tenants SET shop_name = $1, updated_at = NOW() WHERE id = $2`,
      [shop_name, tenantId]
    );

    return reply.status(200).send({ success: true, shop_name });
  });
}
