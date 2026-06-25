import { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../../db/client";
import { requireBbAuth } from "../../middleware/require-bb-auth";

const TaskSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  quadrant: z.enum(["delegation", "replacement", "investment", "production"]),
  money_value: z.enum(["high", "low"]),
  energy_impact: z.enum(["high", "low"]),
  est_hours_week: z.number().positive().optional(),
  hourly_cost: z.number().positive().optional(),
  is_delegated: z.boolean().optional(),
  delegated_to: z.string().optional(),
});

export async function bbDripRoute(app: FastifyInstance) {
  app.get("/drip", { preHandler: [requireBbAuth] }, async (request) => {
    const { userId } = request.user as { userId: string };

    const tasks = await query(
      `SELECT * FROM drip_tasks WHERE user_id = $1 ORDER BY quadrant, created_at`,
      [userId]
    );

    const profileRows = await query(
      `SELECT buyback_rate FROM buyback_users WHERE id = $1`,
      [userId]
    ) as any[];
    const buybackRate = profileRows[0]?.buyback_rate
      ? parseFloat(profileRows[0].buyback_rate)
      : null;

    return { tasks, buybackRate };
  });

  app.post("/drip/tasks", { preHandler: [requireBbAuth] }, async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const parsed = TaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }

    const d = parsed.data;
    const rows = await query(
      `INSERT INTO drip_tasks
         (user_id, name, description, quadrant, money_value, energy_impact,
          est_hours_week, hourly_cost, is_delegated, delegated_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [userId, d.name, d.description || null, d.quadrant, d.money_value, d.energy_impact,
       d.est_hours_week || null, d.hourly_cost || null, d.is_delegated || false, d.delegated_to || null]
    ) as any[];

    return reply.status(201).send(rows[0]);
  });

  app.put("/drip/tasks/:id", { preHandler: [requireBbAuth] }, async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { id } = request.params as { id: string };
    const parsed = TaskSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }

    const d = parsed.data;
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (d.name !== undefined) { sets.push(`name = $${idx++}`); vals.push(d.name); }
    if (d.description !== undefined) { sets.push(`description = $${idx++}`); vals.push(d.description); }
    if (d.quadrant !== undefined) { sets.push(`quadrant = $${idx++}`); vals.push(d.quadrant); }
    if (d.money_value !== undefined) { sets.push(`money_value = $${idx++}`); vals.push(d.money_value); }
    if (d.energy_impact !== undefined) { sets.push(`energy_impact = $${idx++}`); vals.push(d.energy_impact); }
    if (d.est_hours_week !== undefined) { sets.push(`est_hours_week = $${idx++}`); vals.push(d.est_hours_week); }
    if (d.hourly_cost !== undefined) { sets.push(`hourly_cost = $${idx++}`); vals.push(d.hourly_cost); }
    if (d.is_delegated !== undefined) { sets.push(`is_delegated = $${idx++}`); vals.push(d.is_delegated); }
    if (d.delegated_to !== undefined) { sets.push(`delegated_to = $${idx++}`); vals.push(d.delegated_to); }

    if (sets.length === 0) return reply.status(400).send({ error: "No fields to update." });

    sets.push(`updated_at = NOW()`);
    vals.push(id, userId);

    const rows = await query(
      `UPDATE drip_tasks SET ${sets.join(", ")}
       WHERE id = $${idx} AND user_id = $${idx + 1}
       RETURNING *`,
      vals
    ) as any[];

    if (rows.length === 0) return reply.status(404).send({ error: "Task not found." });
    return rows[0];
  });

  app.delete("/drip/tasks/:id", { preHandler: [requireBbAuth] }, async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { id } = request.params as { id: string };

    const rows = await query(
      `DELETE FROM drip_tasks WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId]
    ) as any[];

    if (rows.length === 0) return reply.status(404).send({ error: "Task not found." });
    return { deleted: true };
  });
}
