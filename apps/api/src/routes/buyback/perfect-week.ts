import { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../../db/client";
import { requireBbAuth } from "../../middleware/require-bb-auth";

const BlockSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  category: z.enum(["deep_work", "people", "admin", "protected"]),
  label: z.string().min(1),
  sort_order: z.number().int().optional(),
});

export async function bbPerfectWeekRoute(app: FastifyInstance) {
  app.get("/perfect-week", { preHandler: [requireBbAuth] }, async (request) => {
    const { userId } = request.user as { userId: string };
    const rows = await query(
      `SELECT * FROM perfect_week_blocks WHERE user_id = $1 ORDER BY day_of_week, start_time`,
      [userId]
    );
    return rows;
  });

  app.post("/perfect-week/blocks", { preHandler: [requireBbAuth] }, async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const parsed = BlockSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }

    const { day_of_week, start_time, end_time, category, label, sort_order } = parsed.data;
    const rows = await query(
      `INSERT INTO perfect_week_blocks (user_id, day_of_week, start_time, end_time, category, label, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [userId, day_of_week, start_time, end_time, category, label, sort_order || 0]
    ) as any[];

    return reply.status(201).send(rows[0]);
  });

  app.put("/perfect-week/blocks/:id", { preHandler: [requireBbAuth] }, async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { id } = request.params as { id: string };
    const parsed = BlockSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }

    const data = parsed.data;
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (data.day_of_week !== undefined) { sets.push(`day_of_week = $${idx++}`); vals.push(data.day_of_week); }
    if (data.start_time !== undefined) { sets.push(`start_time = $${idx++}`); vals.push(data.start_time); }
    if (data.end_time !== undefined) { sets.push(`end_time = $${idx++}`); vals.push(data.end_time); }
    if (data.category !== undefined) { sets.push(`category = $${idx++}`); vals.push(data.category); }
    if (data.label !== undefined) { sets.push(`label = $${idx++}`); vals.push(data.label); }
    if (data.sort_order !== undefined) { sets.push(`sort_order = $${idx++}`); vals.push(data.sort_order); }

    if (sets.length === 0) return reply.status(400).send({ error: "No fields to update." });

    sets.push(`updated_at = NOW()`);
    vals.push(id, userId);

    const rows = await query(
      `UPDATE perfect_week_blocks SET ${sets.join(", ")}
       WHERE id = $${idx} AND user_id = $${idx + 1}
       RETURNING *`,
      vals
    ) as any[];

    if (rows.length === 0) return reply.status(404).send({ error: "Block not found." });
    return rows[0];
  });

  app.delete("/perfect-week/blocks/:id", { preHandler: [requireBbAuth] }, async (request, reply) => {
    const { userId } = request.user as { userId: string };
    const { id } = request.params as { id: string };

    const rows = await query(
      `DELETE FROM perfect_week_blocks WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId]
    ) as any[];

    if (rows.length === 0) return reply.status(404).send({ error: "Block not found." });
    return { deleted: true };
  });
}
