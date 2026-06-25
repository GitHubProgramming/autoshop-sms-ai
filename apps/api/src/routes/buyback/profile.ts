import { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../../db/client";
import { requireBbAuth } from "../../middleware/require-bb-auth";

const UpdateSchema = z.object({
  name: z.string().optional(),
  timezone: z.string().optional(),
  annual_income: z.number().positive().optional(),
});

export async function bbProfileRoute(app: FastifyInstance) {
  app.get("/profile", { preHandler: [requireBbAuth] }, async (request) => {
    const { userId } = request.user as { userId: string };
    const rows = await query(
      `SELECT id, email, name, timezone, annual_income, buyback_rate, created_at
       FROM buyback_users WHERE id = $1`,
      [userId]
    ) as any[];
    return rows[0] || null;
  });

  app.put("/profile", { preHandler: [requireBbAuth] }, async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const parsed = UpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }

    const { name, timezone, annual_income } = parsed.data;
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (name !== undefined) { sets.push(`name = $${idx++}`); vals.push(name); }
    if (timezone !== undefined) { sets.push(`timezone = $${idx++}`); vals.push(timezone); }
    if (annual_income !== undefined) { sets.push(`annual_income = $${idx++}`); vals.push(annual_income); }

    if (sets.length === 0) {
      return reply.status(400).send({ error: "No fields to update." });
    }

    sets.push(`updated_at = NOW()`);
    vals.push(userId);

    const rows = await query(
      `UPDATE buyback_users SET ${sets.join(", ")} WHERE id = $${idx}
       RETURNING id, email, name, timezone, annual_income, buyback_rate`,
      vals
    ) as any[];

    return rows[0];
  });
}
