import { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../../db/client";
import { requireAuth } from "../../middleware/require-auth";
import { mergeWithDefaults, getTenantAiPolicy } from "../../services/ai-settings";

const UpdateSettingsSchema = z.object({
  shop_name: z.string().min(1).max(200).optional(),
  ai_settings: z.record(z.unknown()).optional(),
});

/**
 * PUT /tenant/settings
 *
 * Updates tenant settings (shop_name and/or ai_settings).
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

    const { shop_name, ai_settings } = parsed.data;

    // At least one field must be provided
    if (!shop_name && !ai_settings) {
      return reply.status(400).send({
        error: "Validation failed",
        details: ["At least shop_name or ai_settings must be provided"],
      });
    }

    // Build dynamic UPDATE query
    const setClauses: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (shop_name) {
      setClauses.push(`shop_name = $${paramIdx}`);
      params.push(shop_name);
      paramIdx++;
    }

    if (ai_settings) {
      // Merge with defaults to ensure complete structure, then store
      const merged = mergeWithDefaults(ai_settings);
      setClauses.push(`ai_settings = $${paramIdx}`);
      params.push(JSON.stringify(merged));
      paramIdx++;
    }

    params.push(tenantId);

    await query(
      `UPDATE tenants SET ${setClauses.join(", ")} WHERE id = $${paramIdx}`,
      params
    );

    const result: Record<string, unknown> = { success: true };
    if (shop_name) result.shop_name = shop_name;
    if (ai_settings) result.ai_settings = mergeWithDefaults(ai_settings);

    return reply.status(200).send(result);
  });

  /**
   * GET /tenant/ai-policy
   *
   * Returns the computed runtime AI policy for the authenticated tenant.
   * Used by frontend to verify what settings are active.
   */
  app.get("/ai-policy", { preHandler: [requireAuth] }, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string; email: string };
    const policy = await getTenantAiPolicy(tenantId);
    return reply.status(200).send(policy);
  });
}
